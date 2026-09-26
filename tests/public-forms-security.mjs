import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

// Run the real routes, verifier, sanitizer and Prospects writers. Only external
// I/O and framework caches are replaced; no Google, Airtable or Telegram calls.
let now = 0, ip = 0
const jsonResponse = {json: (body, options) => ({body, status: options?.status ?? 200})}
const request = (body, address = String(++ip)) => ({headers: new Headers({'x-forwarded-for': address, origin: 'https://jumboinjapan.com'}), json: async () => body})
function fixture(options = {}) {
  const writes = [], notifications = [], googleCalls = [], invalidations = [], cache = new Map()
  const record = {id: 'rec00000000000001', fields: {'Prospect ID': 'PRS-test', Name: 'Test', Notes: 'Existing note'}}
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const exports = {}; cache.set(file, exports)
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText, {
      exports, crypto: webcrypto, console: {log() {}, warn() {}, error() {}}, URL, URLSearchParams, AbortSignal,
      Date: class extends Date { static now() {return now} },
      process: {env: {AIRTABLE_TOKEN: 'test-only', RECAPTCHA_SECRET_KEY: options.noSecret ? '' : 'test-only'}},
      fetch: async (url, init) => {
        googleCalls.push({url, init})
        if (options.googleThrows) throw Error('network unavailable')
        return {ok: !options.googleHttpError, json: async () => {
          if (options.badGoogleJson) throw Error('bad JSON')
          return 'googleData' in options ? options.googleData : {success: true, score: 0.9, action: options.action ?? 'contact_submit'}
        }}
      },
      require: (name) => {
        if (name === 'react') return {cache: (fn) => fn}
        if (name === 'next/server') return {NextResponse: jsonResponse}
        if (name === 'next/cache') return {unstable_cache: (fn) => fn, revalidateTag: (...args) => invalidations.push(args)}
        if (name === '@/lib/schema') return {BASE_URL: 'https://example.test'}
        if (name === '@/lib/airtable-schema') return {AIRTABLE_BASE_ID: 'test-base', PROSPECTS_TABLE_ID: 'test-prospects'}
        if (name === '@/lib/airtable-retry') return {fetchAirtableWithRetry: async (url, init) => {
          if (!init.method) return {ok: true, json: async () => ({records: options.noRecord ? [] : [record]})}
          writes.push({url, method: init.method, fields: JSON.parse(init.body).fields})
          if (options.storageThrows) throw Error('storage unavailable')
          return {ok: !options.storageFails, status: 503, json: async () => options.storageFails ? {error: {message: 'unavailable'}} : record}
        }}
        if (name === '@/lib/notifications/telegram') {
          const notify = async (data) => {
            notifications.push(data)
            if (options.notifyThrows) throw Error('notification unavailable')
            return {success: !options.notifyFails}
          }
          return {notifyNewContact: notify, notifyProfileSubmitted: notify}
        }
        if (['recaptcha', 'prospects', 'tourist-profile', 'prospect-labels'].some((part) => name === `@/lib/${part}`)) {
          return load(`src/lib/${name.slice('@/lib/'.length)}.ts`)
        }
        throw Error(`Unexpected dependency ${name}`)
      },
    })
    return exports
  }
  return {load, writes, notifications, googleCalls, invalidations}
}
const contactBody = {name: 'Test', contact: 'test@example.test', interests: 'Kyoto', travelDate: 'October', recaptchaToken: 'test-token', elapsedSeconds: 60}
const profilePayload = {
  dates: {precision: 'month_only', month: '2026-10'}, first_trip: true, first_trip_preference: 'recommend',
  group: {adults: 2, children: []}, mobility: ['none'], interests: ['culture'], pace: 'few_moves',
  hotel_budget_usd: {min: 150, max: 400}, hotel_booking: 'self_no_recs', guide_format: 'partial_tours',
  notes: 'User note', contact: {name: 'Test', channel: 'email', value: 'test@example.test'},
}
const profileBody = {payload: profilePayload, recaptchaToken: 'test-token', elapsedSeconds: 60}
const invalid = fixture(), contact = invalid.load('src/app/api/contact/route.ts')
for (const body of [null, [], 'text', 1, {}, {name: 42, contact: 'x'}, {name: 'x', contact: []}, {name: 'x', contact: 'x', interests: {}}, {name: ' ', contact: 'x'}]) {
  assert.equal((await contact.POST(request(body))).status, 400)
}
assert.equal((await contact.POST({...request(null), json: async () => {throw Error('bad JSON')}})).status, 400)
assert.equal(invalid.writes.length, 0, 'invalid contact input performs no writes')
assert.equal(invalid.googleCalls.length, 0, 'invalid contact input performs no Google I/O')
const badProfile = fixture({action: 'profile_submit'})
for (const body of [null, [], {}, {payload: {}}, {payload: {...profilePayload, contact: {}}}]) {
  assert.equal((await badProfile.load('src/app/api/profile/route.ts').POST(request(body))).status, 400)
}
assert.equal(badProfile.writes.length, 0)
assert.equal(badProfile.googleCalls.length, 0, 'invalid profile is validated before Google I/O')

const cases = [
  ['missing token', {}, {recaptchaToken: undefined}],
  ['empty token', {}, {recaptchaToken: ''}],
  ['wrong token type', {}, {recaptchaToken: 123}],
  ['verification rejected', {googleData: {success: false}}, {}],
  ['low score', {googleData: {success: true, score: 0.1}}, {}],
  ['borderline score', {googleData: {success: true, score: 0.4}}, {}],
  ['wrong action', {googleData: {success: true, score: 0.9, action: 'other'}}, {}],
  ['invalid score', {googleData: {success: true, score: NaN}}, {}],
  ['null response', {googleData: null}, {}],
  ['no secret', {noSecret: true}, {}],
  ['network unavailable', {googleThrows: true}, {}],
  ['HTTP failure', {googleHttpError: true}, {}],
  ['malformed response', {badGoogleJson: true}, {}],
  ['too fast', {}, {elapsedSeconds: 1}],
]
for (const [label, options, bodyOverrides] of cases) {
  for (const form of ['contact', 'profile-new', 'profile-update']) {
    const isProfile = form.startsWith('profile'), action = isProfile ? 'profile_submit' : 'contact_submit'
    const settings = {...options, action}
    if (options.googleData?.success && !options.googleData.action) settings.googleData = {...options.googleData, action}
    const f = fixture(settings)
    const body = {...(isProfile ? profileBody : contactBody), ...bodyOverrides, ...(form === 'profile-update' ? {token: 'test-profile-token'} : {})}
    const result = await f.load(`src/app/api/${isProfile ? 'profile' : 'contact'}/route.ts`).POST(request(body))
    assert.equal(result.status, 200, `${form}: ${label} accepted`)
    assert.equal(f.writes.length, 1, `${form}: ${label} persists exactly once`)
    assert.equal(f.writes[0].method, form === 'profile-update' ? 'PATCH' : 'POST')
    assert.match(f.writes[0].fields.Notes, /Проверить вручную/, `${form}: ${label} persists review warning`)
    assert.match(f.writes[0].fields.Notes, isProfile ? /User note/ : /Kyoto/, 'user notes preserved')
    assert.equal(f.notifications.length, 1)
    assert.match(isProfile ? f.notifications[0].summary.join('\n') : f.notifications[0].spamWarning, /Проверить вручную/)
    if (isProfile) {
      assert.equal(JSON.parse(f.writes[0].fields['Fact Find Answers']).notes, 'User note', 'review metadata must not alter customer answers')
      if (form === 'profile-update') assert.equal(f.writes[0].fields.Stage, undefined, 'profile update cannot change stage')
    } else assert.match(result.body.profileUrl, /^https:\/\/example.test\/profile\//)
  }
}
for (const isProfile of [false, true]) {
  const f = fixture({action: isProfile ? 'profile_submit' : 'contact_submit'})
  const route = f.load(`src/app/api/${isProfile ? 'profile' : 'contact'}/route.ts`)
  const body = isProfile ? profileBody : contactBody
  await route.POST(request({...body, hp: 'bot'}))
  assert.equal(f.writes.length, 0, 'honeypot performs no writes')
  assert.equal(f.googleCalls.length, 0, 'honeypot performs no Google I/O')
  assert.equal(f.notifications.length, 0, 'honeypot sends no notification')
  await route.POST(request({...body, spamWarning: 'client supplied', reviewWarning: 'client supplied'}))
  assert.equal(f.writes.length, 1, 'passing reCAPTCHA writes normally')
  assert.doesNotMatch(f.writes[0].fields.Notes, /Проверить вручную|client supplied/, 'client cannot inject server review flag')
  assert.equal(f.googleCalls.length, 1)
  const max = isProfile ? 10 : 5
  for (let i = 0; i < max; i++) assert.equal((await route.POST(request(body, 'limited'))).status, 200)
  const writesBefore = f.writes.length
  assert.equal((await route.POST(request(body, 'limited'))).status, 429)
  assert.equal(f.writes.length, writesBefore, 'IP limit blocks writes')
}
const clip = fixture()
await clip.load('src/app/api/contact/route.ts').POST(request({...contactBody, name: 'n'.repeat(400), contact: 'c'.repeat(400), interests: 'i'.repeat(4000), travelDate: 'd'.repeat(4000)}))
assert.equal(clip.writes[0].fields.Name.length, 300)
assert.equal(clip.writes[0].fields.Contact.length, 300)
assert.match(clip.writes[0].fields.Notes, new RegExp(`^Dates: d{3000}\\n\\ni{3000}$`))
for (const notifyOptions of [{notifyFails: true}, {notifyThrows: true}]) {
  const f = fixture({storageFails: true, ...notifyOptions})
  const result = await f.load('src/app/api/contact/route.ts').POST(request(contactBody))
  assert.equal(result.status, 502, 'both delivery channels failed: no fake success')
  assert.equal(result.body.ok, false)
  assert.equal(f.invalidations.length, 0)
  const stored = fixture(notifyOptions)
  assert.equal((await stored.load('src/app/api/contact/route.ts').POST(request(contactBody))).status, 200, 'saved contact survives notification failure')
  const savedProfile = fixture({...notifyOptions, action: 'profile_submit'})
  assert.equal((await savedProfile.load('src/app/api/profile/route.ts').POST(request(profileBody))).status, 200, 'saved profile survives notification failure')
}
const fallback = fixture({storageThrows: true})
assert.equal((await fallback.load('src/app/api/contact/route.ts').POST(request(contactBody))).body.fallback, true, 'confirmed Telegram delivery remains a fallback')
for (const token of [undefined, 'test-profile-token']) {
  const f = fixture({storageFails: true, action: 'profile_submit'})
  assert.equal((await f.load('src/app/api/profile/route.ts').POST(request({...profileBody, token}))).status, 502)
  assert.equal(f.notifications.length, 0)
}
const absent = fixture({noRecord: true, action: 'profile_submit'})
assert.equal((await absent.load('src/app/api/profile/route.ts').POST(request({...profileBody, token: 'test-profile-token'}))).status, 404)
assert.equal(absent.writes.length, 0, 'unknown profile token performs no writes')
const oldNotes = fixture({action: 'profile_submit'})
await oldNotes.load('src/app/api/profile/route.ts').POST(request({...profileBody, token: 'test-profile-token', recaptchaToken: null, payload: {...profilePayload, notes: ''}}))
assert.match(oldNotes.writes[0].fields.Notes, /Existing note/, 'review flag preserves existing notes when profile provides none')

// Analytics limiter uses the real handler with a separate fetch port.
let trackCalls = 0
const exports = {}
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/app/api/track/route.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, {
  exports, console, Date: class extends Date {static now() {return now}}, process: {env: {AIRTABLE_TOKEN: 'test'}},
  fetch: async () => {trackCalls++; return {ok: true}},
  require: () => ({NextResponse: class {constructor(body, options) {this.status = options.status}}}),
})
for (let i = 0; i < 65; i++) assert.equal((await exports.POST(request({event: 'questionnaire_step'}, 'one-ip'))).status, 204)
assert.equal(trackCalls, 60, 'IP limit blocks excess analytics writes')
await exports.POST(request({event: 'questionnaire_step'}, 'second-ip'))
assert.equal(trackCalls, 61)
now += 600001
await exports.POST(request({event: 'questionnaire_step'}, 'one-ip'))
assert.equal(trackCalls, 62, 'window expiry permits subsequent events')
console.log('Public forms: actual routes/verifier/writers, review persistence, honeypot, limits and delivery failures passed without live I/O')
