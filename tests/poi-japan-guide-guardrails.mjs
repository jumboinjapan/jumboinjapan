import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { factsFixture } from './fixtures/japan-guide-facts.mjs'
import { assertFactsForCreate, assertFactsForRequest, parseFactsPacket, assertDossierCanon } from '../scripts/poi-portals/lib/japan-guide-facts.mjs'
import { DRAFT_REVISION_SPEC, parseDraftRevisionPacket, draftRevisionProposal } from '../scripts/poi-portals/lib/japan-guide-draft-revision.mjs'
import { runCopy, parseCopyPacket, COPY_V2_SPEC } from '../scripts/poi-portals/copy-japan-guide.mjs'
import { expectedTaxonomyFieldSchema } from '../src/lib/poi-taxonomy-airtable.ts'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'
import { readPoiFacts } from '../src/lib/poi-facts.ts'
import { fieldEquals } from '../scripts/poi-portals/lib/verified-write.mjs'
let checks=0, network=0
const check=(name,fn)=>{try{fn();checks++}catch(e){throw Error(`${name}: ${e.message}`,{cause:e})}}
globalThis.fetch=()=>{network++;throw Error('Ambient network forbidden')}
const good=factsFixture()
for(const [name,change] of [
  ['fact subject',d=>d.facts[0].subject='Музей Сэндая'],
  ['fact text',d=>d.facts[0].text='История Канадзавы.'],
  ['conditions',d=>d.facts[0].conditions='Для гостей Сэндая'],
  ['coverage',d=>d.coverage[0].reason='Карта Сэндая'],
  ['hours',d=>{d.visit.hoursKind='stated';d.visit.hours='По времени Сэндая';d.visit.factIds=['f1']}],
  ['visit',d=>d.visit.explanation='Доступно из Сэндая'],
  ['RU copy',d=>d.copy.ru[0].text='История Сэндая.'],
]) {
  const row=structuredClone(good);change(row.dossier)
  check(`CANON ${name} rejects at packet and create boundaries`,()=>{
    assert.throws(()=>parseFactsPacket({spec:'poi-japan-guide-facts-batch/v1',rows:[good,row]}),/factsCanon/)
    assert.throws(()=>assertFactsForCreate(row.dossier),/factsCanon/)
    assert.throws(()=>parseCopyPacket({spec:COPY_V2_SPEC,rows:[{...row,recordId:'rec00000000000001',sourceKey:row.dossier.sourceKey,nameRu:'Музей',descriptionRu:row.dossier.copy.ru[0].text,descriptionEn:row.dossier.copy.en[0].text,previousDossierDigest:null}]}),/factsCanon/)
  })
}
check('CANON valid text is byte-identical',()=>{const before=JSON.stringify(good);assertDossierCanon(good.dossier);assert.equal(JSON.stringify(good),before)})
check('CANON public boundary rejects accessors before execution',()=>{
  const d=structuredClone(good.dossier);let read=0
  Object.defineProperty(d,'facts',{enumerable:true,get(){read++;throw Error('Getter executed')}})
  assert.throws(()=>assertFactsForCreate(d),/accessor/);assert.equal(read,0)
})
const subjectRow=(nameRu='Тестовый музей',poiPrimaryType='museum')=>{
  const row=factsFixture()
  Object.assign(row.dossier.facts[0],{subject:nameRu,category:'identity'})
  row.subjectAssessment={role:'parent',nameRu,poiPrimaryType,factIds:['f1'],reason:'Тип описывает общую локацию, включая самостоятельные места внутри неё.'}
  return row
}
const requestOf=row=>({poi:{nameRu:row.subjectAssessment.nameRu,taxonomy:{poiPrimaryType:row.subjectAssessment.poiPrimaryType}}})
for (const [name,type] of [['Самидзима','tourist_district'],['Годайсан','natural_landmark'],['Старый город Хаги','historic_site']]) {
  const row=subjectRow(name,type),request=requestOf(row)
  check(`SUBJECT whole parent ${type} passes`,()=>assertFactsForRequest(row,request,{knownParent:true}))
  check(`SUBJECT child type cannot replace ${type}`,()=>assert.throws(()=>assertFactsForRequest(row,{poi:{...request.poi,taxonomy:{poiPrimaryType:'museum'}}}),/subjectAssessmentTypeDrift/))
}
for(const [name,change,pattern] of [
  ['missing assessment',r=>delete r.subjectAssessment,/subjectAssessmentRequired/],
  ['wrong role',r=>r.subjectAssessment.role='place',/subjectAssessmentParentRequired/],
  ['foreign name',r=>r.dossier.facts[0].subject='Дочерний храм',/subjectAssessmentWholeSubject/],
  ['missing fact',r=>r.subjectAssessment.factIds=['no'],/subjectAssessmentIdentityFact/],
  ['history only',r=>r.dossier.facts[0].category='history',/subjectAssessmentIdentityFact/],
  ['uncertain fact',r=>r.dossier.facts[0].status='unknown',/subjectAssessmentIdentityFact/],
  ['no reason',r=>r.subjectAssessment.reason='',/subjectAssessmentReason/],
  ['invented type',r=>r.subjectAssessment.poiPrimaryType='invented',/subjectAssessmentType/],
]) {
  const row=subjectRow(),request=requestOf(row);change(row)
  check(`SUBJECT ${name} rejects`,()=>assert.throws(()=>assertFactsForRequest(row,request,{knownParent:true}),pattern))
}

const revisionRow=i=>{
  const row=subjectRow(`Гора Пример ${i}`,'natural_landmark')
  row.dossier.sourceKey=`japan-guide:e${70000+i}`
  const evidence=factsFixture(row.dossier.sourceKey)
  row.dossier.sources=evidence.dossier.sources;row.evidence=evidence.evidence
  return {...row,recordId:`rec${String(i).padStart(14,'0')}`,sourceKey:row.dossier.sourceKey,nameRu:row.subjectAssessment.nameRu,
    previousFields:{'POI ID':`POI-${String(i).padStart(6,'0')}`,'Source Key':row.dossier.sourceKey,'POI Name (RU)':row.subjectAssessment.nameRu,
      'Copy Status':'Draft','Fact Check Status':'Todo','POI Type':'museum','POI Category (RU)':['Музей'],'POI Facets':['old facet'],
      'Description Draft (RU)':'Прежний черновик.','Description Draft (EN)':'Earlier draft.',
      'Description (RU)':'Published untouched',Latitude:35,Longitude:135,Notes:'Original note'},
    classification:{entityKind:'tourist_poi',poiPrimaryType:'natural_landmark',facets:[],confidence:0.95,reasons:['Классифицируется вся гора.'],nameRu:row.subjectAssessment.nameRu}}
}
const packet={spec:DRAFT_REVISION_SPEC,rows:[revisionRow(1),revisionRow(2)]}
check('REVISION projection uses explicit null and preserves old evidence',()=>{
  const row=packet.rows[0],before=JSON.stringify(row)
  const result=draftRevisionProposal(row,{recordId:row.recordId,fields:row.previousFields})
  assert.equal(result.proposed['POI Category (RU)'],null)
  assert.equal(result.proposed['POI Facets'],null)
  assert.equal(result.proposed['Type Source'],'model')
  for(const field of ['Latitude','Copy Status','Description (RU)','Parent POI'])assert(!Object.hasOwn(result.proposed,field))
  assert.equal(JSON.stringify(row),before)
  assert.equal(fieldEquals([],undefined),false,'generic comparison must remain strict')
})
for(const [name,change,pattern] of [
  ['public status',p=>p.rows[1].previousFields['Copy Status']='Approved',/revisionDraftRequired/],
  ['fake human',p=>p.rows[1].classification.classificationSource='human',/revisionClassificationRequired/],
  ['extra write field',p=>p.rows[1].fields={'Approved':true},/draft revision row/],
  ['duplicate row',p=>p.rows.push(p.rows[0]),/revisionDuplicateTarget/],
  ['missing old',p=>delete p.rows[1].previousFields,/draft revision row/],
  ['wrong type',p=>p.rows[1].subjectAssessment.poiPrimaryType='museum',/revisionAssessmentTypeDrift/],
]) {
  const p=structuredClone(packet);change(p)
  check(`REVISION ${name} rejected before I/O`,()=>assert.throws(()=>parseDraftRevisionPacket(p),pattern))
}
const getter=structuredClone(packet);Object.defineProperty(getter.rows[0],'classification',{enumerable:true,get(){throw Error('getter ran')}})
check('REVISION accessor rejected before reading',()=>assert.throws(()=>parseDraftRevisionPacket(getter),/accessor/))

function service(p=packet) {
  const s={rows:p.rows.map(row=>({id:row.recordId,fields:structuredClone(row.previousFields)})),get:0,patch:0,meta:0,lose:false,unavailable:false,badSchema:false,drift:false,bodies:[]}
  const fetchImpl=async(url,init={})=>{
    const u=new URL(url),method=init.method??'GET'
    if(u.pathname.includes('/meta/')){
      assert.equal(method,'GET');s.meta++
      return new Response(JSON.stringify({tables:[{id:POI_TABLE_ID,name:'POI',fields:s.badSchema?[]:expectedTaxonomyFieldSchema().map(f=>({name:f.name,type:f.type,...(f.choices?{options:{choices:f.choices.map(name=>({name}))}}:{})}))}]}))
    }
    const row=s.rows.find(r=>r.id===u.pathname.split('/').at(-1));assert(row)
    if(method==='GET'){
      s.get++;if(s.unavailable)throw Error('Offline read')
      if(s.drift && s.get===5)row.fields['Description Draft (RU)']='Owner edit'
    } else {
      assert.equal(method,'PATCH');s.patch++
      const fields=JSON.parse(init.body).fields;s.bodies.push(fields)
      for(const [key,value] of Object.entries(fields)){if(value===null || (Array.isArray(value)&&!value.length))delete row.fields[key];else row.fields[key]=value}
      if(s.lose){s.unavailable=true;throw Error('Lost response')}
    }
    return new Response(JSON.stringify(row))
  }
  return {s,fetchImpl}
}
const log=console.log;console.log=()=>{}
const roots=[]
async function setup(p=packet){const root=await mkdtemp(path.join(tmpdir(),'jg-rails-'));roots.push(root);const file=path.join(root,'packet.json');await writeFile(file,JSON.stringify(p));const svc=service(p);return {...svc,root,file,run:(id,write=true)=>runCopy({packetFile:file,runId:id,write},{repoRoot:root,env:{AIRTABLE_TOKEN:'fake'},fetchImpl:svc.fetchImpl})}}
try {
  const x=await setup(),dry=await x.run('dry',false)
  check('REVISION readonly prepares complete card without PATCH',()=>{assert.equal(dry.exitCode,0,dry.report.failure);assert.equal(x.s.patch,0);assert(dry.report.rows.every(r=>r.state==='prepared'));assert.equal(x.s.meta,1)})
  const live=await x.run('apply')
  check('REVISION omitted cleared fields verify in production store',()=>{assert.equal(live.exitCode,0,live.report.failure);assert.equal(x.s.patch,2);assert(live.report.rows.every(r=>r.state==='verified'));for(const row of x.s.rows){assert(!Object.hasOwn(row.fields,'POI Facets'));assert(!Object.hasOwn(row.fields,'POI Category (RU)'));assert.equal(row.fields['POI Type'],'natural_landmark');assert(readPoiFacts(row.fields.Notes).dossier);assert.equal(row.fields['Description (RU)'],'Published untouched');assert.equal(row.fields.Latitude,35)}})
  const journal=await readFile(path.join(live.dir,'journal.ndjson')),card=await readFile(path.join(live.dir,'card.json'))
  const repeat=await x.run('repeat')
  check('REVISION repeated completed packet writes nothing',()=>{assert.equal(repeat.exitCode,0,repeat.report.failure);assert.equal(x.s.patch,2);assert(repeat.report.rows.every(r=>r.state==='noChange'))})
  assert.deepEqual(await readFile(path.join(live.dir,'journal.ndjson')),journal);assert.deepEqual(await readFile(path.join(live.dir,'card.json')),card)
  for(const [name,change,pattern] of [
    ['second row old drift',s=>s.rows[1].fields.Notes='External edit',/revisionPreviousFieldsDrift/],
    ['publication changed',s=>s.rows[1].fields['Copy Status']='Approved',/revisionDraftRequired/],
    ['schema drift',s=>s.badSchema=true,/схем|таксоном/],
    ['late edit',s=>s.drift=true,/mismatch/],
  ]) {
    const x=await setup();change(x.s);const r=await x.run('negative')
    check(`REVISION ${name} stops before PATCH`,()=>{assert.equal(r.exitCode,1);assert.match(r.report.failure,pattern);assert.equal(x.s.patch,0)})
  }
  const broken=await setup();broken.s.lose=true;const lost=await broken.run('lost')
  check('REVISION lost response stops suffix',()=>{assert.equal(lost.exitCode,1);assert.equal(broken.s.patch,1);assert.equal(lost.report.rows[0].state,'unknown')})
  const evidence=await readFile(path.join(lost.dir,'journal.ndjson'))
  const blocked=await broken.run('blocked')
  check('REVISION unresolved effect is not retried',()=>{assert.equal(blocked.exitCode,1);assert.equal(broken.s.patch,1)})
  broken.s.lose=false;broken.s.unavailable=false;const recovered=await broken.run('recovered')
  check('REVISION recovery applies only untouched suffix',()=>{assert.equal(recovered.exitCode,0,recovered.report.failure);assert.equal(broken.s.patch,2);assert.equal(recovered.report.rows[0].state,'noChange');assert.equal(recovered.report.rows[1].state,'verified')})
  const recoveryCard=JSON.parse(await readFile(path.join(recovered.dir,'card.json')))
  check('REVISION recovery card contains one remaining target',()=>assert.deepEqual(recoveryCard.rows.map(r=>r.recordId),[packet.rows[1].recordId]))
  assert.deepEqual(await readFile(path.join(lost.dir,'journal.ndjson')),evidence)
  const malformed=structuredClone(packet);malformed.rows[1].dossier.copy.ru[0].text='Из Сэндая.'
  const fail=await setup(malformed)
  await assert.rejects(fail.run('invalid'),/factsCanon/)
  check('REVISION bad final row makes zero network calls',()=>{assert.equal(fail.s.get,0);assert.equal(fail.s.meta,0);assert.equal(fail.s.patch,0)})
} finally {console.log=log;for(const root of roots)await rm(root,{recursive:true,force:true})}
check('No live network',()=>assert.equal(network,0))
console.log(`poi-japan-guide-guardrails: ${checks} named scenarios passed`)
