import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
let now = 0
const maps = []
class ObservedMap extends Map {
  constructor(...args) { super(...args); maps.push(this) }
}
function load(path, dependencies = {}, extra = {}) {
  const exports = {}
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(compiled, { exports, Date: { now: () => now }, Map: ObservedMap, Math, console: { log() {}, warn() {}, error() {} }, process: {env:{}}, fetch: () => { throw Error('network forbidden') }, ...extra, require: name => {
    if (!(name in dependencies)) throw Error(`Unexpected dependency ${name}`)
    return dependencies[name]
  } })
  return exports
}
const helper = load('src/lib/form-rate-limit.ts')
const rate = helper.createFormRateLimiter(5)
for (let i=0;i<5;i++) assert.equal(rate('offender'),false)
assert.equal(rate('offender'),true)
for (let i=0;i<10001;i++) {
  assert.equal(rate(`ip-${i}`),i>=4999, 'new IPs rejected at capacity')
  assert.ok(maps[0].size<=5000, 'memory stays bounded after each request')
}
assert.equal(rate('offender'),true,'overflow never resets an active offender')
now=600000
assert.equal(rate('new-window'),false,'expired slots are reclaimed')
assert.equal(maps[0].size,1)
assert.equal(rate('offender'),false,'expired offender receives a fresh window')
for(let i=0;i<4998;i++) assert.equal(rate(`second-${i}`),false)
assert.equal(rate('capacity-again'),true)
now+=600000
assert.equal(rate('third-window'),false,'sweep deadline recovers after a completely emptied map')
assert.equal(maps[0].size,1)

now=0
const staggered=helper.createFormRateLimiter(1,100,2)
assert.equal(staggered('a'),false)
now=50
assert.equal(staggered('b'),false)
assert.equal(staggered('c'),true)
now=100
assert.equal(staggered('c'),false,'only expired a is swept')
assert.equal(staggered('b'),true,'unexpired b retains its count')
now=150
assert.equal(staggered('b'),false,'expired existing IP resets at capacity')
assert.equal(staggered('c'),true)

for (const [name,limit] of [['contact',5],['profile',10]]) {
  let writes=0,notifications=0
  const record={id:'record-test',prospectId:'prospect-test',factFindUrl:'/profile/test'}
  const dependencies={
    '@/lib/form-rate-limit':helper,
    'next/server':{ NextResponse:{ json:(data,options={})=>({data,status:options.status??200}) } },
    'next/cache':{ revalidateTag:()=>{} },
    '@/lib/prospects':{
      parseContactFormToProspect:b=>b,
      createProspect:async()=>{writes++;return {success:true,record}},
      createProspectFromProfile:async()=>{writes++;return {success:true,record}},
      updateProspectFactFind:()=>{throw Error('unexpected update')},
    },
    '@/lib/notifications/telegram':{
      notifyNewContact:async()=>{notifications++},notifyProfileSubmitted:async()=>{notifications++},
    },
    '@/lib/tourist-profile':{sanitizeProfilePayload:payload=>({ok:true,payload}),summarizeProfileForTelegram:()=>[]},
    '@/lib/schema':{BASE_URL:'https://example.test'},
  }
  const {POST}=load(`src/app/api/${name}/route.ts`,dependencies)
  const request=(ip,body)=>({headers:{get:key=>key==='x-forwarded-for'?ip:null},json:async()=>body})
  for(let i=0;i<limit;i++) assert.equal((await POST(request('bot',{hp:'filled'}))).status,200)
  assert.equal((await POST(request('bot',{hp:'filled'}))).status,429)
  assert.equal(writes,0);assert.equal(notifications,0,'honeypot never sends a message')
  const normal={name:'Fixture',contact:'fixture@example.test',elapsedSeconds:60,payload:{contact:{name:'Fixture'}}}
  assert.equal((await POST(request('normal',normal))).status,200)
  assert.equal(writes,1,'valid submission still reaches the isolated writer')
  assert.equal(notifications,1,'notification adapter is mocked, not sent')
  now+=600000
  assert.equal((await POST(request('bot',{hp:'filled'}))).status,200,'HTTP limiter recovers after expiry')
}
console.log('Form rate limits: bounded memory, expiry, offender retention and real route 429/success passed (network and writes isolated)')
