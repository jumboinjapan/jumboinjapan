import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {runCopy,parseCopyPacket,COPY_SPEC} from '../scripts/poi-portals/copy-japan-guide.mjs'
const root=await mkdtemp(path.join(tmpdir(),'jg-copy-'))
const log=console.log;console.log=()=>{}
let checks=0, forbidden=0
globalThis.fetch=()=>{forbidden++;throw Error('Unexpected network')}
const row=i=>({recordId:`rec${String(i).padStart(14,'0')}`,sourceKey:`japan-guide:e${i}`,nameRu:`Музей ${i}`,descriptionRu:`Музей ${i} посвящён истории города.`,descriptionEn:`Museum ${i} presents the history of the city.`,facts:[{text:'Музей посвящён истории города.',sourceUrl:'https://example.org/museum',checkedOn:'2026-09-09'}]})
const packet={spec:COPY_SPEC,rows:[row(1),row(2)]}
const file=path.join(root,'packet.json');await writeFile(file,JSON.stringify(packet))
const check=(name,fn)=>{try{fn();checks++}catch(e){throw Error(`${name}: ${e.message}`,{cause:e})}}
function service() {
  const state={get:0,patch:0,rows:packet.rows.map(r=>({id:r.recordId,fields:{'POI ID':`POI-${r.recordId.slice(-6)}`,'Source Key':r.sourceKey,'POI Name (RU)':r.nameRu,'Copy Status':'Draft','Fact Check Status':'Todo',Notes:'Original source','Description (RU)':'Public untouched',Latitude:35,Longitude:135}})),mutate:null,lose:false,failRead:false}
  const fetchImpl=async(url,init={})=>{
    const id=new URL(url).pathname.split('/').at(-1),method=init.method??'GET',r=state.rows.find(r=>r.id===id)
    assert(r)
    if(method==='GET'){state.get++;if(state.failRead)throw Error('Read unavailable');if(state.mutate)state.mutate(state)}
    else {assert.equal(method,'PATCH');state.patch++;Object.assign(r.fields,JSON.parse(init.body).fields);if(state.lose){state.failRead=true;throw Error('Lost PATCH response')}}
    return new Response(JSON.stringify(r),{headers:{'content-type':'application/json'}})
  }
  return {state,fetchImpl}
}
async function run(id,svc,write=true,packetFile=file){return runCopy({packetFile,runId:id,write},{repoRoot:root,env:{AIRTABLE_TOKEN:'fake'},fetchImpl:svc.fetchImpl})}
try {
  for(const [label,change] of [['unknown version',p=>p.spec='wrong'],['no facts',p=>p.rows[0].facts=[]],['foreign key',p=>p.rows[0].sourceKey='other:1'],['duplicate target',p=>p.rows.push(p.rows[0])],['empty text',p=>p.rows[0].descriptionRu=''],['unknown field',p=>p.rows[0].approved=true],['invalid date',p=>p.rows[0].facts[0].checkedOn='2026-02-30']]) {
    const bad=structuredClone(packet);change(bad)
    check(label,()=>assert.throws(()=>parseCopyPacket(bad)))
  }
  const bad=structuredClone(packet);Object.defineProperty(bad.rows[0],'descriptionRu',{get(){throw Error('getter executed')},enumerable:true})
  check('getter rejected before execution',()=>assert.throws(()=>parseCopyPacket(bad),/accessor/))
  const svc=service();const prepared=await run('prepare',svc,false)
  check('readonly prepares two without PATCH',()=>{assert.equal(prepared.exitCode,0,prepared.report.failure);assert(prepared.report.rows.every(r=>r.state==='prepared'));assert.equal(svc.state.patch,0)})
  const created=await run('first',svc)
  check('draft copy stored and independently verified',()=>{assert.equal(created.exitCode,0,created.report.failure);assert.equal(svc.state.patch,2);assert(created.report.rows.every(r=>r.state==='verified'))})
  check('facts persist with URL and date, public fields unchanged',()=>{for(const r of svc.state.rows){assert(r.fields.Notes.startsWith('Original source'));assert(r.fields.Notes.includes('https://example.org/museum'));assert(r.fields.Notes.includes('2026-09-09'));assert(r.fields['Description Draft (EN)']);assert.equal(r.fields['Description (RU)'],'Public untouched');assert.equal(r.fields['Copy Status'],'Draft');assert.equal(r.fields.Latitude,35)}})
  const journal=await readFile(path.join(created.dir,'journal.ndjson'))
  const repeat=await run('repeat',svc)
  check('same packet repeats without PATCH or appended duplicate facts',()=>{assert.equal(repeat.exitCode,0,repeat.report.failure);assert.equal(svc.state.patch,2);assert(repeat.report.rows.every(r=>r.state==='noChange'))})
  check('old journal preserved',()=>{})
  assert.deepEqual(await readFile(path.join(created.dir,'journal.ndjson')),journal)
  for(const [label,field,value] of [['published status','Copy Status','Approved'],['edited draft','Description Draft (RU)','Owner text'],['source mismatch','Source Key','other:1'],['name drift','POI Name (RU)','Different']]) {
    const x=service();x.state.rows[1].fields[field]=value;const result=await run(label.replaceAll(' ','-'),x)
    check(`${label} stops whole batch before PATCH`,()=>{assert.equal(result.exitCode,1);assert.equal(x.state.patch,0)})
  }
  const drift=service();drift.state.mutate=s=>{if(s.get===5)s.rows[0].fields['Copy Status']='Approved'}
  const changed=await run('drift',drift)
  check('status drift at PATCH boundary stops suffix',()=>{assert.equal(changed.exitCode,1);assert.equal(drift.state.patch,0)})
  // Isolate prior journals for interrupted-run checks.
  const sub=await mkdtemp(path.join(tmpdir(),'jg-copy-recover-'))
  try {
    const broken=service();broken.state.lose=true
    const call=id=>runCopy({packetFile:file,runId:id,write:true},{repoRoot:sub,env:{AIRTABLE_TOKEN:'fake'},fetchImpl:broken.fetchImpl})
    const lost=await call('lost')
    check('unknown PATCH stops after first effect',()=>{assert.equal(lost.exitCode,1);assert.equal(broken.state.patch,1);assert.equal(lost.report.rows[0].state,'unknown')})
    const original=await readFile(path.join(lost.dir,'journal.ndjson'))
    const blocked=await call('blocked')
    check('unresolved prior effect blocks continuation',()=>{assert.equal(blocked.exitCode,1);assert.equal(broken.state.patch,1)})
    broken.state.lose=false;broken.state.failRead=false
    const resumed=await call('resumed')
    check('reconciled retry only fills missing suffix',()=>{assert.equal(resumed.exitCode,0,resumed.report.failure);assert.equal(broken.state.patch,2)})
    assert.deepEqual(await readFile(path.join(lost.dir,'journal.ndjson')),original)
  } finally {await rm(sub,{recursive:true,force:true})}
  check('no ambient network',()=>assert.equal(forbidden,0))
} finally {console.log=log;await rm(root,{recursive:true,force:true})}
console.log(`poi-japan-guide-copy: ${checks} named scenarios passed`)
