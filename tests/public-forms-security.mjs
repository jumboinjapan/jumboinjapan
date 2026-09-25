import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const effects = []
const notifications = []
let verdict = 'pass'
let now = 0
const response = {json: (body, options) => ({body, status: options?.status ?? 200})}
function load(file, ports = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {
    exports, console: {log() {}, warn() {}, error() {}}, URLSearchParams, AbortSignal,
    Date: class extends Date { static now() {return now} },
    process: {env: ports.env ?? {}}, fetch: ports.fetch,
    require: (name) => {
      if (name === 'next/server') return {NextResponse: ports.NextResponse ?? response}
      if (name === 'next/cache') return {revalidateTag() {}}
      if (name === '@/lib/recaptcha') return {verifyRecaptcha: async () => ({verdict, score: 0.9})}
      if (name === '@/lib/prospects') return {
        parseContactFormToProspect: (x) => x,
        createProspect: async (x) => {effects.push(x); return {success: true, record: {factFindUrl: '/profile/test'}}},
      }
      if (name === '@/lib/notifications/telegram') return {notifyNewContact: async (data) => {notifications.push(data)}}
      return {}
    },
  })
  return exports
}
let ip = 0
function request(body, address = String(++ip)) {return {headers: new Headers({'x-forwarded-for': address, origin: 'https://jumboinjapan.com'}), json: async () => body}}
const contact = load('src/app/api/contact/route.ts')
for (const body of [null, [], 'text', 1, {}, {name: 42, contact: 'x'}, {name: 'x', contact: []}, {name: 'x', contact: 'x', interests: {}}, {name: ' ', contact: 'x'}]) {
  assert.equal((await contact.POST(request(body))).status, 400)
}
assert.equal((await contact.POST({...request(null), json: async () => {throw Error('bad JSON')}})).status, 400)
assert.equal(effects.length, 0, 'invalid input performs no writes')
verdict = 'reject'
await contact.POST(request({name: 'Test', contact: 'test', recaptchaToken: 'bad'}))
assert.equal(effects.length, 0, 'reCAPTCHA rejection performs no writes')
verdict = 'pass'
await contact.POST(request({name: 'n'.repeat(400), contact: 'c'.repeat(400), interests: 'i'.repeat(4000), travelDate: 'd'.repeat(4000)}))
assert.equal(effects[0].name.length, 300)
assert.equal(effects[0].contact.length, 300)
assert.equal(effects[0].interests.length, 3000)
assert.equal(effects[0].travelDate.length, 3000)
for (let i = 0; i < 5; i++) assert.equal((await contact.POST(request({name: 'Test', contact: 'test'}, 'limited'))).status, 200)
assert.equal((await contact.POST(request({name: 'Test', contact: 'test'}, 'limited'))).status, 429)
verdict = 'suspicious'
await contact.POST(request({name: 'Test', contact: 'test'}))
assert.match(notifications.at(-1).spamWarning, /reCAPTCHA score/)
let trackCalls = 0
const track = load('src/app/api/track/route.ts', {env: {AIRTABLE_TOKEN: 'test'}, NextResponse: class {constructor(body, options) {this.status = options.status}}, fetch: async () => {trackCalls++; return {ok: true}}})
for (let i = 0; i < 65; i++) assert.equal((await track.POST(request({event: 'questionnaire_step'}, 'one-ip'))).status, 204)
assert.equal(trackCalls, 60, 'IP limit blocks excess analytics writes')
await track.POST(request({event: 'questionnaire_step'}, 'second-ip'))
assert.equal(trackCalls, 61)
now += 600001
await track.POST(request({event: 'questionnaire_step'}, 'one-ip'))
assert.equal(trackCalls, 62, 'window expiry permits subsequent events')
for (const [data, expected] of [[{success: true, score: 0.9}, 'pass'], [{success: true, score: 0.4}, 'suspicious'], [{success: true, score: 0.1}, 'reject'], [{success: false}, 'reject']]) {
  const helper = load('src/lib/recaptcha.ts', {env: {RECAPTCHA_SECRET_KEY: 'test'}, fetch: async () => ({json: async () => data})})
  assert.equal((await helper.verifyRecaptcha('token', 'unknown')).verdict, expected)
  assert.equal((await helper.verifyRecaptcha(null, 'unknown')).verdict, 'reject')
}
console.log('Public forms: malformed input, clipping, reCAPTCHA and IP limits passed without live I/O')
