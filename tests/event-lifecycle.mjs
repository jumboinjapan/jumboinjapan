import assert from 'node:assert/strict'
import { normalizeEventLifecycle } from '../src/lib/event-lifecycle.ts'
import { archiveEndedJapanTravelEvents } from '../src/lib/japantravel-event-maintenance.ts'
const at = s => new Date(s)
assert.equal(normalizeEventLifecycle('2026-09-20','2026-09-25','upcoming',at('2026-09-26T00:00:00+09:00')),'ended')
assert.equal(normalizeEventLifecycle('2026-09-25','2026-09-25','ended',at('2026-09-25T23:59:58+09:00')),'live')
assert.equal(normalizeEventLifecycle('2026-09-26','2026-09-27','live',at('2026-09-25T23:59:59+09:00')),'upcoming')
assert.equal(normalizeEventLifecycle('2026-09-25T08:00:00+09:00','2026-09-25T09:00:00+09:00','live',at('2026-09-25T00:01:00Z')),'ended')
assert.equal(normalizeEventLifecycle('','','ended'),'ended')
assert.equal(normalizeEventLifecycle('invalid','invalid',''),'live')
const originalFetch=globalThis.fetch
const previous={token:process.env.AIRTABLE_TOKEN,base:process.env.AIRTABLE_BASE_ID}
process.env.AIRTABLE_TOKEN='test';process.env.AIRTABLE_BASE_ID='test'
const details=[{id:'detail1',fields:{'Resource ID':'event1','Starts At':'2000-01-01','Ends At':'2000-01-02',Lifecycle:'upcoming'}}]
const resources=[{id:'resource1',fields:{'Resource ID':'event1',Title:'Past',Status:'active','Seed Source':'japantravel.com/events importer'}}, {id:'resource2',fields:{'Resource ID':'other',Status:'active','Seed Source':'manual'}}]
const writes=[]
globalThis.fetch=async (url,options={})=>{
 if(options.method==='PATCH') { writes.push({url,body:JSON.parse(options.body)});return Response.json({}) }
 assert.ok(!options.method || options.method==='GET')
 return Response.json({records:String(url).includes('Resource%20Event%20Details') ? details:resources})
}
try {
 const dry=await archiveEndedJapanTravelEvents()
 assert.equal(dry.matched,1,'stale stored lifecycle must not prevent cleanup')
 assert.equal(writes.length,0,'dry-run never writes')
 const applied=await archiveEndedJapanTravelEvents({dryRun:false})
 assert.equal(applied.archived,1)
 assert.equal(writes.length,2)
 assert.equal(writes[0].body.records[0].fields.Status,'archived')
 assert.equal(writes[1].body.records[0].fields.Lifecycle,'ended')
 assert.equal(writes[0].body.records[0].id,'resource1','manual resource untouched')
} finally {
 globalThis.fetch=originalFetch
 for(const [key,value] of [['AIRTABLE_TOKEN',previous.token],['AIRTABLE_BASE_ID',previous.base]]) {if(value===undefined)delete process.env[key];else process.env[key]=value}
}
console.log('Tokyo event boundaries and stale-lifecycle maintenance regression checks passed')
