import { sha256Bytes } from '../scripts/lib/byte-digest.mjs'
import { factsFixture } from './fixtures/japan-guide-facts.mjs'
import { readPoiFacts } from '../src/lib/poi-facts.ts'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runIntakeCli, parseIntakeArgs, acquireIntakeLock } from '../scripts/poi-portals/intake-japan-guide.mjs'
import { expectedTaxonomyFieldSchema } from '../src/lib/poi-taxonomy-airtable.ts'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'
import { GOOD_NAMED, NAMES_RU, NOW, queuesOf, queueRow, enrichmentOf, enrichedRow, identificationOf, identifiedRow } from './fixtures/japan-guide-pipeline.mjs'
const root = await mkdtemp(path.join(tmpdir(),'jg-intake-cli-'))
let checks=0
const check = (name,fn) => { try { fn(); checks++ } catch(e) { throw new Error(`${name}: ${e.message}`,{cause:e}) } }
const originalLog=console.log
console.log=()=>{}
let forbidden=0
globalThis.fetch=()=>{forbidden++;throw Error('Unexpected live network')}
const baseRow = {id:'rec00000000000042',fields:{'POI ID':'POI-000042','POI Name (RU)':'Посторонний объект','POI Name (EN)':'Unrelated','Site City':'osaka','Source Key':'other:42',Latitude:34.5,Longitude:135.3}}
const keys=[0,1,2].map(i=>`japan-guide:e${70000+i}`)
const queues=queuesOf(keys.map((k,i)=>queueRow(k,`Place ${i}`)))
const enrichment=enrichmentOf(keys.map((k,i)=>enrichedRow(k,`Place ${i}`,GOOD_NAMED(i))),{inputs:{queues:{digest:queues.reportDigest}}})
const identification=identificationOf(keys.map((k,i)=>identifiedRow(k,{placeId:`ChIJ-cli${i}`,lat:34.99+i/5,lon:135.78+i/5})),{inputs:{enrichment:{digest:enrichment.reportDigest}}})
const names=Object.fromEntries(keys.map((k,i)=>[k,{nameRu:NAMES_RU[i],siteCity:'kyoto'}]))
const facts={spec:'poi-japan-guide-facts-batch/v1',rows:keys.map((k,i)=>{
  const row=factsFixture(k)
  Object.assign(row.dossier.facts[0],{subject:NAMES_RU[i],category:'identity'})
  return {...row,subjectAssessment:{role:'place',nameRu:NAMES_RU[i],poiPrimaryType:['buddhist_temple','art_venue','shinto_shrine'][i],factIds:['f1'],reason:'Классификация относится ко всему объекту статьи.'}}
})}
const input={queues,enrichment,identification,names,facts}
const flags=[]
for (const [k,v] of Object.entries(input)) { const file=path.join(root,`${k}.json`); await writeFile(file,JSON.stringify(v)); flags.push(`--${k}`,file) }
const argv=(run,...more)=>['node','intake',...flags,'--run-id',run,...more]
const identity={commit:'a'.repeat(40),dirty:false}
function service() {
  const state={rows:[structuredClone(baseRow)],post:0,get:0,failRead:false,loseResponse:false,drift:false,fullReads:0}
  const fetchImpl=async (url,init={})=>{
    const u=new URL(url); const method=init.method??'GET'
    const response = data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}})
    if (method==='POST') {
      state.post++
      const fields=JSON.parse(init.body).records[0].fields
      state.rows.push({id:`rec${String(100+state.post).padStart(14,'0')}`,fields})
      if(state.loseResponse){state.failRead=true;throw Error('Lost POST response')}
      return response({records:[state.rows.at(-1)]})
    }
    assert.equal(method,'GET','No update/delete transport')
    state.get++
    if(u.pathname.includes('/meta/')) return response({tables:[{id:POI_TABLE_ID,name:'POI',fields:expectedTaxonomyFieldSchema().map(f=>({name:f.name,type:f.type,...(f.choices?{options:{choices:f.choices.map(name=>({name}))}}:{})}))}]})
    const filter=u.searchParams.get('filterByFormula')
    if(filter && state.failRead) throw Error('Read unavailable')
    if(!filter && u.searchParams.getAll('fields[]').includes('Is System')) {
      state.fullReads++
      if(state.drift && state.fullReads===2) state.rows[0].fields['POI Name (RU)']='Changed externally'
    }
    let rows=state.rows
    if(filter){const m=filter.match(/^\{(.+)\}='(.*)'$/);assert(m);rows=rows.filter(r=>r.fields[m[1]]===m[2])}
    return response({records:rows})
  }
  return {state,fetchImpl}
}
async function run(id,svc,more=[],over={}) {
  return runIntakeCli(argv(id,...more),{repoRoot:over.repoRoot??root,now:()=>new Date(NOW),env:{AIRTABLE_TOKEN:'fake'},fetchImpl:svc.fetchImpl,codeIdentity:identity,...over})
}
try {
  check('limit cannot exceed standing batch ceiling',()=>assert.throws(()=>parseIntakeArgs(argv('bad','--write','--limit','26')),/1..25/))
  check('offline is explicit and needs a base',()=>assert.throws(()=>parseIntakeArgs(argv('bad')),/base-file/))
  check('no path traversal',()=>assert.throws(()=>parseIntakeArgs(argv('../bad','--write')),/run ID/))
  check('write cannot consume stale supplied base',()=>assert.throws(()=>parseIntakeArgs(argv('bad','--write','--base-file','x')),/fresh base/))
  const lockRoot=path.join(root,'lock');await mkdir(lockRoot)
  const release=await acquireIntakeLock(lockRoot,'first')
  await assert.rejects(acquireIntakeLock(lockRoot,'second'),/EEXIST/,'parallel startup refused'); checks++
  await release();const release2=await acquireIntakeLock(lockRoot,'second');await release2()
  // A bad text in the final row rejects the whole authored packet before GET.
  const savedFacts=await readFile(path.join(root,'facts.json'))
  const badFacts=structuredClone(facts);badFacts.rows[2].dossier.copy.ru[0].text='История Сэндая.'
  await writeFile(path.join(root,'facts.json'),JSON.stringify(badFacts))
  const badService=service()
  await assert.rejects(run('bad-text',badService,['--write']),/factsCanon/)
  check('all authored rows checked before any live I/O',()=>{assert.equal(badService.state.get,0);assert.equal(badService.state.post,0)})
  await writeFile(path.join(root,'facts.json'),savedFacts)
  const unassessed=structuredClone(facts);delete unassessed.rows[0].subjectAssessment
  await writeFile(path.join(root,'facts.json'),JSON.stringify(unassessed))
  const assessmentService=service()
  const assessmentRoot=path.join(root,'assessment');await mkdir(assessmentRoot)
  const assessed=await run('missing-subject',assessmentService,['--write'],{repoRoot:assessmentRoot})
  check('missing subject assessment stops only its own create',()=>{assert.equal(assessed.exitCode,0,assessed.report.failure);assert.equal(assessmentService.state.post,2);assert.equal(assessed.report.rows[0].execution,'factsReviewRequired');assert.match(assessed.report.rows[0].factsReason,/subjectAssessmentRequired/);assert(!assessmentService.state.rows.some(r=>r.fields['Source Key']===keys[0]))})
  await writeFile(path.join(root,'facts.json'),savedFacts)
  const svc=service()
  const base=path.join(root,'base.json');await writeFile(base,JSON.stringify(svc.state.rows.map(r=>({recordId:r.id,fields:r.fields}))))
  const offline=await run('offline',svc,['--base-file',base])
  check('offline prepares three and does not call transport',()=>{assert.equal(offline.exitCode,0,offline.report.failure);assert.equal(offline.report.prepared,3);assert.equal(svc.state.get,0);assert.equal(svc.state.post,0)})
  const boundInputs=await readFile(path.join(offline.runDir,'execution-inputs.json'))
  const ref=JSON.parse(await readFile(path.join(offline.runDir,'reference.json'),'utf8'))
  check('manifest binds exact facts bytes along with all other inputs',()=>{assert.equal(JSON.parse(boundInputs).facts.base64,Buffer.from(JSON.stringify(facts)).toString('base64'));assert.equal(ref.manifest.portals[0].input.rawPayload.digest,sha256Bytes(boundInputs))})
  const live=await run('first',svc,['--write'])
  check('real production writer creates and verifies all rows',()=>{assert.equal(live.exitCode,0,live.report.failure);assert.equal(svc.state.post,3);assert.equal(live.report.outcomes.length,3);assert(live.report.outcomes.every(r=>r.state==='verified'))})
  check('stored rows are taxonomy drafts without public fields',()=>{for(const r of svc.state.rows.slice(1)){assert.equal(r.fields['Copy Status'],'Draft');assert.equal(r.fields['Fact Check Status'],'Todo');assert.equal(readPoiFacts(r.fields.Notes).dossier.facts.length,16);assert(r.fields['Description Draft (RU)']);assert(r.fields['Description Draft (EN)']);assert(r.fields['POI Type']);assert(!('Description (RU)' in r.fields));assert(!('Approved' in r.fields))}})
  const original=await readFile(path.join(live.runDir,'report.json'))
  const repeat=await run('repeat',svc,['--write'])
  check('repeat skips every applied source without POST',()=>{assert.equal(repeat.exitCode,0,repeat.report.failure);assert.equal(repeat.report.prepared,0);assert.equal(svc.state.post,3)})
  const occupied=await run('first',svc,['--write'])
  check('occupied run ID preserves report',()=>assert.equal(occupied.exitCode,1))
  const persisted=await readFile(path.join(live.runDir,'report.json'))
  check('original report byte identical',()=>assert.deepEqual(original,persisted))
  const scope = async name => { const dir=path.join(root,name);await mkdir(dir);return {repoRoot:dir} }
  const limited=service();const limitedScope=await scope('limited')
  const one=await run('one',limited,['--write','--limit','1'],limitedScope)
  check('batch limit selects only one',()=>{assert.equal(one.exitCode,0,one.report.failure);assert.equal(limited.state.post,1);assert.equal(one.report.counts.notSelected,2)})
  const rest=await run('rest',limited,['--write'],limitedScope)
  check('next batch continues only remaining two',()=>{assert.equal(rest.exitCode,0,rest.report.failure);assert.equal(rest.report.prepared,2);assert.equal(limited.state.post,3)})
  const broken=service();broken.state.loseResponse=true;const brokenScope=await scope('broken')
  const interrupted=await run('interrupted',broken,['--write'],brokenScope)
  check('lost response and unavailable verification stop suffix',()=>{assert.equal(interrupted.exitCode,1);assert.equal(broken.state.post,1);assert.equal(interrupted.report.outcomes[0].state,'unknown');assert.equal(interrupted.report.rows.length,3)})
  const journalFile=path.join(interrupted.runDir,'journal.ndjson')
  const journalBytes=await readFile(journalFile)
  const stillUnknown=await run('still-unknown',broken,['--write'],brokenScope)
  check('unresolved previous effect blocks other rows',()=>{assert.equal(stillUnknown.exitCode,1);assert.match(stillUnknown.report.failure,/Recovery required/);assert.equal(broken.state.post,1)})
  broken.state.loseResponse=false;broken.state.failRead=false
  const recovered=await run('recovered',broken,['--write'],brokenScope)
  check('resolved lost response resumes without repeated POST',()=>{assert.equal(recovered.exitCode,0,recovered.report.failure);assert.equal(broken.state.post,3);assert.equal(recovered.report.prepared,2)})
  const journalAfter=await readFile(journalFile)
  check('recovery preserves original journal bytes',()=>assert.deepEqual(journalAfter,journalBytes))
  broken.state.rows.splice(2,1)
  const deleted=await run('deleted',broken,['--write'],brokenScope)
  check('missing journal-verified record is not recreated',()=>{assert.equal(deleted.exitCode,1);assert.equal(broken.state.post,3)})
  const drift=service();drift.state.drift=true
  const drifted=await run('drift',drift,['--write'],await scope('drift-case'))
  check('fresh base drift refuses before POST',()=>{assert.equal(drifted.exitCode,1);assert.match(drifted.report.failure,/Base drift/);assert.equal(drift.state.post,0)})
  const dirty=service()
  const dirtyRun=await run('dirty',dirty,['--write'],{...await scope('dirty-case'),codeIdentity:{...identity,dirty:true}})
  check('dirty code refuses before POST',()=>{assert.equal(dirtyRun.exitCode,1);assert.match(dirtyRun.report.failure,/Commit verified code/);assert.equal(dirty.state.post,0)})
  const rawIdentification=await readFile(path.join(root,'identification.json'))
  await writeFile(path.join(root,'identification.json'),JSON.stringify({...identification,reportDigest:'sha256:'+'0'.repeat(64)}))
  const damaged=service()
  let damageFailure
  try { damageFailure=(await run('damaged',damaged,['--write'])).report.failure } catch(e) { damageFailure=e.message }
  check('corrupt saved report performs no network',()=>{assert.equal(damaged.state.get,0);assert.equal(damaged.state.post,0)})
  check('corrupt saved report names the failed signature',()=>assert.match(damageFailure,/изменён после подписи/))
  await writeFile(path.join(root,'identification.json'),rawIdentification)
} finally {
  console.log=originalLog
  // Cleanup only this suite's own OS temporary directory.
  await rm(root,{recursive:true,force:true})
}
assert.equal(forbidden,0)
console.log(`✓ Japan Guide intake CLI: ${checks} checks`)
