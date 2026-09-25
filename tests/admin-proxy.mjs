import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { registerHooks, createRequire } from 'node:module'
import { resolve } from './support/alias-loader.mjs'

registerHooks({ resolve: (s, c, next) => c.parentURL?.includes('/node_modules/') ? next(s, c) : resolve(s === 'next/server' ? 'next/server.js' : s, c, next) })
globalThis.AsyncLocalStorage = AsyncLocalStorage
const require = createRequire(import.meta.url)
const { NextRequest } = require('next/server')
const { unstable_doesMiddlewareMatch } = require('next/experimental/testing/server')
const { proxy, config } = await import('../src/proxy.ts')
const { createSignedSessionToken, getSessionCookieName } = await import('../src/lib/admin-auth.ts')
const request = (path, headers = {}) => new NextRequest(`https://example.test${path}`, { headers })
const protectedPaths = ['/admin', '/admin/route-stops', '/api/admin', '/api/admin/route-stops/stops']
for (const url of [...protectedPaths, '/admin/login', '/api/admin/auth/google/start']) {
  assert(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), `protected matcher: ${url}`)
}
for (const url of ['/', '/intercity/hakone', '/from-tokyo/intercity/hakone', '/api/profile', '/api/telegram/webhook', '/robots.txt', '/_next/static/app.js']) {
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), false, `public matcher: ${url}`)
  assert.equal((await proxy(request(url))).headers.get('set-cookie'), null, `no obsolete cookie: ${url}`)
}
for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ADMIN_BASIC_AUTH_USER', 'ADMIN_BASIC_AUTH_PASSWORD', 'ADMIN_BASIC_AUTH_FALLBACK']) delete process.env[key]
process.env.ADMIN_AUTH_SECRET = 'offline-test-secret-at-least-thirty-two-characters'
const checkHeaders = response => {
  assert.match(response.headers.get('x-robots-tag'), /noindex/)
  assert.match(response.headers.get('cache-control'), /no-store/)
}
for (const path of protectedPaths) {
  const response = await proxy(request(path))
  checkHeaders(response)
  if (path.startsWith('/api/')) assert.equal(response.status, 401)
  else assert.equal(new URL(response.headers.get('location')).pathname, '/admin/login')
}
process.env.GOOGLE_CLIENT_ID = 'test-client'
process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
process.env.ADMIN_ALLOWED_EMAILS = 'owner@example.test'
for (const path of protectedPaths) {
  const response = await proxy(request(path, { cookie: `${getSessionCookieName()}=invalid` }))
  checkHeaders(response)
  if (path.startsWith('/api/')) assert.equal(response.status, 401)
  else assert.equal(new URL(response.headers.get('location')).searchParams.get('next'), path)
}
for (const path of ['/admin/login', '/api/admin/auth/google/start', '/api/admin/auth/google/callback', '/api/admin/auth/logout']) {
  const response = await proxy(request(path))
  assert.equal(response.status, 200)
  checkHeaders(response)
}
const token = await createSignedSessionToken({ email: 'owner@example.test', name: 'Owner', picture: '' })
for (const path of protectedPaths) {
  const response = await proxy(request(path, { cookie: `${getSessionCookieName()}=${token}` }))
  assert.equal(response.status, 200)
  checkHeaders(response)
}
assert.equal(new URL((await proxy(request('/admin/login', { cookie: `${getSessionCookieName()}=${token}` }))).headers.get('location')).pathname, '/admin')
delete process.env.GOOGLE_CLIENT_ID
process.env.ADMIN_BASIC_AUTH_FALLBACK = 'true'
process.env.ADMIN_BASIC_AUTH_USER = 'offline-user'
process.env.ADMIN_BASIC_AUTH_PASSWORD = 'offline-password'
for (const path of protectedPaths) {
  assert.equal((await proxy(request(path))).status, 401)
  const response = await proxy(request(path, { authorization: 'Basic ' + Buffer.from('offline-user:offline-password').toString('base64') }))
  assert.equal(response.status, 200)
  checkHeaders(response)
}
console.log('✓ proxy: admin protection and public cookie-free paths')
