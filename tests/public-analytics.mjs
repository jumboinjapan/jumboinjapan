import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve } from './support/alias-loader.mjs'

registerHooks({ resolve })
const { isPublicAnalyticsUrl, canCollectPublicAnalytics, publicAnalyticsReferrer, filterAnalyticsEvent } = await import('../src/lib/analytics-policy.ts')
const { initializeGoogleAnalytics } = await import('../src/lib/google-analytics.ts')
const { trackEvent } = await import('../src/lib/analytics.ts')

const publicUrls = ['/', '/city-tour/day-one', '/contact', '/profile', '/profile?src=telegram', '/intercity/nikko']
const privateUrls = ['/admin', '/admin/login', '/admin/seo-llm', '/p', '/p/secret', '/profile/secret', '/api/contact', '/%61dmin/poi', '/profile/%73ecret']
for (const path of publicUrls) assert.equal(isPublicAnalyticsUrl(`https://jumboinjapan.com${path}`), true, path)
for (const path of privateUrls) assert.equal(isPublicAnalyticsUrl(`https://jumboinjapan.com${path}`), false, path)
for (const url of ['http://localhost:3212/contact', 'https://preview.vercel.app/contact', 'https://jumboinjapan.com.attacker.test/', 'not a url', 'https://jumboinjapan.com/%ZZ']) {
  assert.equal(isPublicAnalyticsUrl(url), false, url)
}
assert.equal(publicAnalyticsReferrer('https://jumboinjapan.com/p/secret'), '')
assert.equal(publicAnalyticsReferrer('https://accounts.google.com/o/oauth2?code=secret'), '')
assert.equal(publicAnalyticsReferrer('https://chatgpt.com/c/private-conversation'), 'https://chatgpt.com')
assert.equal(publicAnalyticsReferrer('https://google.com/search?q=private'), 'https://google.com')
assert.deepEqual(filterAnalyticsEvent({ type: 'pageview', url: 'https://jumboinjapan.com/contact?email=secret#secret' }), {
  type: 'pageview', url: 'https://jumboinjapan.com/contact',
})
assert.equal(filterAnalyticsEvent({ url: 'https://jumboinjapan.com/p/secret' }), null)

// The production consumer must reject before either telemetry transport runs.
const calls = []
globalThis.window = { location: { href: '', pathname: '' }, gtag: (...args) => calls.push(args) }
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { sendBeacon: (...args) => { calls.push(args); return true } } })
for (const path of privateUrls) {
  window.location = { href: `https://jumboinjapan.com${path}`, pathname: path }
  trackEvent('generate_lead', { form: 'contact' })
}
window.location = { href: 'http://localhost:3212/contact', pathname: '/contact' }
trackEvent('generate_lead')
assert.equal(calls.length, 0, 'private and preview events must not reach GA or Funnel Events')
globalThis.window = { location: { href: 'https://jumboinjapan.com/contact', pathname: '/contact' }, gtag: (...args) => calls.push(args) }
trackEvent('generate_lead', { form: 'contact' })
assert.equal(calls.length, 2, 'public success reaches both independent transports')
assert.equal(calls[0][1], 'generate_lead')
assert.equal(calls[1][0], '/api/track')
assert.equal(JSON.parse(await calls[1][1].text()).params.page, '/contact')
window.gtag = () => { throw Error('blocked GA') }
trackEvent('cta_contact_click')
assert.equal(calls.length, 3, 'GA failure does not suppress first-party telemetry')

// Simulate history changing synchronously, without giving React an effect turn.
delete window.gtag
globalThis.document = { referrer: 'https://accounts.google.com/o/oauth2?code=secret' }
assert.equal(initializeGoogleAnalytics('G-TEST123'), true)
assert.equal(window['ga-disable-G-TEST123'], false)
assert.equal(window.dataLayer.length, 2)
assert.equal(window.dataLayer[1][2].page_referrer, '')
initializeGoogleAnalytics('G-TEST123')
assert.equal(window.dataLayer.length, 2, 'remount must not duplicate config/pageview')
window.location.href = 'https://jumboinjapan.com/admin/poi'
assert.equal(window['ga-disable-G-TEST123'], true, 'private SPA route disables GA immediately')
window.location.href = 'https://jumboinjapan.com/city-tour'
assert.equal(window['ga-disable-G-TEST123'], true, 'return from a private route remains excluded from acquisition')
window['ga-disable-G-TEST123'] = true
assert.equal(window['ga-disable-G-TEST123'], true, 'explicit opt-out remains respected')
window.location.href = 'https://jumboinjapan.com/profile/secret'
assert.equal(initializeGoogleAnalytics('G-OTHER123'), false)
assert.equal(initializeGoogleAnalytics('invalid'), false)
const tabStorage = new Map()
const storage = { getItem: key => tabStorage.get(key), setItem: (key, value) => tabStorage.set(key, value) }
globalThis.window = { location: { href: 'https://jumboinjapan.com/admin' }, sessionStorage: storage }
assert.equal(canCollectPublicAnalytics(), false)
globalThis.window = { location: { href: 'https://jumboinjapan.com/' }, sessionStorage: storage }
assert.equal(canCollectPublicAnalytics(), false, 'private-tab exclusion survives a full reload')
globalThis.window = { location: { href: 'https://jumboinjapan.com/' } }
assert.equal(canCollectPublicAnalytics(), true, 'a fresh public tab remains measurable without storage access')
console.log('public analytics: URL boundaries, both transports, SPA and remount regression passed')
