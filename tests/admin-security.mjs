import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'

function load(source, ports = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {
    exports, URL, TextEncoder, TextDecoder, btoa, atob, crypto: webcrypto,
    process: {env: ports.env ?? {}}, console,
    require: ports.require ?? (() => ({})),
  })
  return exports
}
const env = {ADMIN_AUTH_SECRET: 'test-secret', ADMIN_ALLOWED_EMAILS: 'admin@example.test'}
const auth = load(readFileSync(new URL('../src/lib/admin-auth.ts', import.meta.url), 'utf8'), {env})
const token = await auth.createSignedSessionToken({email: 'admin@example.test', name: 'Admin', picture: ''})
assert.equal((await auth.verifySessionToken(token)).email, 'admin@example.test')
env.ADMIN_ALLOWED_EMAILS = 'other@example.test'
assert.equal(await auth.verifySessionToken(token), null, 'revoked admin rejected on next request')
env.ADMIN_ALLOWED_EMAILS = ''
assert.equal(await auth.verifySessionToken(token), null, 'empty allowlist fails closed')
env.ADMIN_ALLOWED_EMAILS = 'admin@example.test'
assert.equal(await auth.verifySessionToken(await auth.createSignedSessionToken({email: 'admin@example.test', name: '', picture: '', expiresInSeconds: -1})), null)

const guard = load(readFileSync(new URL('../src/lib/admin-guard.ts', import.meta.url), 'utf8'), {
  require: (name) => name === 'next/server' ? {NextResponse: {json: (body, options) => ({body, status: options.status})}} : auth,
})
const originRequest = (origin) => ({headers: new Headers({host: 'preview.example.test', ...(origin ? {origin} : {})}), nextUrl: new URL('https://preview.example.test/api/admin/test')})
assert.equal(guard.requireSameOrigin(originRequest('https://evil.example.test')).status, 403)
assert.equal(guard.requireSameOrigin(originRequest('https://preview.example.test')), null)
assert.equal(guard.requireSameOrigin(originRequest(null)), null)

const denied = {status: 403}
let mutations = 0
function scan(dir) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) scan(file)
    else if (entry.name === 'route.ts') {
      const source = readFileSync(file, 'utf8')
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      for (const node of ast.statements) {
        if (!ts.isFunctionDeclaration(node) || !/^(POST|PUT|PATCH|DELETE)$/.test(node.name?.text ?? '')) continue
        const name = node.name.text
        // Execute the actual handler body with an authorized session and rejected origin.
        const fnSource = node.getText(ast)
        // Load with guards in scope; any access to a writer after rejection throws.
        const exports = {}
        vm.runInNewContext(ts.transpileModule(fnSource, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {
          exports, requireAdminSession: async () => null, requireSameOrigin: () => denied,
        })
        tasks.push(async () => assert.equal(await exports[name]({}, {params: Promise.resolve({id: 'test'})}), denied, `${file} ${name}`))
        mutations++
      }
    }
  }
}
const tasks = []
scan(new URL('../src/app/api/admin/', import.meta.url).pathname)
for (const task of tasks) await task()
assert.ok(mutations > 0)
const effects = []
const route = load(readFileSync(new URL('../src/app/api/revalidate/route.ts', import.meta.url), 'utf8'), {
  env: {REVALIDATE_SECRET: 'test-secret'},
  require: (name) => name === 'next/cache' ? {revalidatePath: (...x) => effects.push(x), revalidateTag: (...x) => effects.push(x)} : {NextResponse: {json: (body, options) => ({body, status: options?.status ?? 200})}},
})
assert.equal(route.GET, undefined)
function request(body, query = '') {return {method: 'POST', headers: new Headers({'content-type': 'application/json'}), nextUrl: new URL('https://example.test/api/revalidate' + query), json: async () => body}}
assert.equal((await route.POST(request({}, '?secret=test-secret&path=/'))).status, 401)
assert.equal(effects.length, 0)
assert.equal((await route.POST(request(null))).status, 401)
assert.equal((await route.POST(request({secret: 'test-secret', path: '/'}))).status, 200)
assert.ok(effects.length > 0)
console.log(`Admin security: ${mutations} mutation handlers reject before effects; session revocation and POST-only revalidation passed`)
