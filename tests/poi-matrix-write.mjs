import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {factsFixture} from './fixtures/japan-guide-facts.mjs'
import {storePoiFacts} from '../src/lib/poi-facts.ts'
import {ingestPoi,ingestPoiBatch,ensureMatrixSchemaForWrite} from '../src/lib/poi-ingest.ts'
import {createMemoryPoiStore} from '../src/lib/poi-memory-store.ts'
import {classifyModelResponse} from '../scripts/poi-portals/lib/classification-contract.mjs'
import {taxonomyRecordFields,expectedTaxonomyFieldSchema} from '../src/lib/poi-taxonomy-airtable.ts'
import {POI_TABLE_ID} from '../src/lib/airtable-schema.ts'
import {dossierDigest} from '../scripts/poi-portals/lib/japan-guide-facts.mjs'
import {EDITORIAL_POLICY,getEditorialPolicyDigest} from '../scripts/poi-portals/lib/poi-copywriter.mjs'
import {MATRIX_FIELD,MATRIX_WRITE_SPEC,buildPoiMatrix,assertPoiMatrix,matchesPoiMatrix} from '../scripts/poi-portals/lib/poi-matrix.mjs'
import {matrixContext,buildMatrixWrite,reviewedMatrixWrite,assertMatrixWriteReview,matrixWritePolicyDigest,MATRIX_WRITE_POLICY} from '../scripts/poi-portals/lib/poi-matrix-write.mjs'
import {readMatrixRecord} from '../scripts/poi-portals/lib/poi-matrix-catalog.mjs'
import {factSyncProposal,mergePortalFacts,FACT_SYNC_SPEC} from '../scripts/poi-portals/lib/poi-fact-sync.mjs'
import {runCopy} from '../scripts/poi-portals/copy-japan-guide.mjs'
const now=new Date().toISOString(),later=new Date(Date.parse(now)+86400000).toISOString(),clone=structuredClone
let checks=0,ambient=0
const check=async(name,fn)=>{try{await fn();checks++;console.log('PASS '+name)}catch(e){throw new Error(name+': '+e.message,{cause:e})}}
const originalFetch=globalThis.fetch
globalThis.fetch=()=>{ambient++;throw Error('Ambient network forbidden')}
const fixture=factsFixture(),d=fixture.dossier
Object.assign(d,{spec:'poi-facts/v2',history:[]})
Object.assign(d.facts[0],{category:'identity',status:'verified'})
const classification=classifyModelResponse({entityKind:'tourist_poi',poiPrimaryType:'museum',facets:[],confidence:0.99,reasons:['Музей истории.'],nameRu:'Тестовый музей'},{sourceKey:d.sourceKey}).classification
const copyReview=dossier=>({spec:'poi-copy-review/v1',dossierDigest:dossierDigest(dossier),policyDigest:getEditorialPolicyDigest(),author:'fixture-copy-author',reviewer:'fixture-copy-editor',checkedAt:now,checks:Object.fromEntries(EDITORIAL_POLICY.reviewDimensions.map(k=>[k,true])),issues:[]})
const request={source:{kind:'portal-collector',id:'japan-guide',externalKey:'e70000'},poi:{nameRu:'Тестовый музей',siteCity:'kyoto',lat:35.01,lon:135.76,resolved:{lat:35.01,lon:135.76,placeId:'test-museum-id'},taxonomy:classification,descriptionRu:d.copy.ru[0].text,descriptionEn:d.copy.en[0].text,factDossier:d,factEvidence:fixture.evidence,factCopyReview:copyReview(d),factSubjectAssessment:{role:'place',nameRu:'Тестовый музей',poiPrimaryType:'museum',factIds:['f1'],reason:'Самостоятельный музей.'}}}
const fields={'POI ID':null,'Source Key':d.sourceKey,'POI Name (RU)':request.poi.nameRu,...taxonomyRecordFields(classification).fields,Notes:storePoiFacts('',d)}
const cleanFields=JSON.parse(JSON.stringify(fields)),context=matrixContext(cleanFields,now)
const claim=(code='history')=>({code,state:'supported',factIds:['f1'],conditionFactIds:[],ageRange:null,checkedAt:now,validUntil:code==='history'?null:later,rationale:'Синтетическое основание теста.'})
const review=document=>({spec:'poi-matrix-review/v1',matrixDigest:document.digest,policyDigest:matrixWritePolicyDigest(),author:'fixture-matrix-author',reviewer:'fixture-matrix-editor',checkedAt:now,checks:Object.fromEntries(MATRIX_WRITE_POLICY.checks.map(k=>[k,true])),issues:[]})
function assessment(claims,ctx=context,previous=null){const input={claims,assessedAt:now};return {...input,review:review(buildMatrixWrite(input,ctx,previous))}}
request.poi.matrix=assessment([claim()])
await check('CREATE_SOURCE_BOUND_FIRST_POST',async()=>{
 const events=[],store=createMemoryPoiStore([],{observe:e=>events.push(e)})
 const result=await ingestPoi(request,store)
 assert.equal(result.outcome,'created',result.explanation)
 const written=events.find(e=>e.kind==='create').fields
 const matrix=JSON.parse(written[MATRIX_FIELD]);assert.equal(matrix.spec,MATRIX_WRITE_SPEC);assert.equal(matrix.poiId,null)
 const record=JSON.parse(JSON.stringify({...written,'POI ID':result.poiId}));const read=readMatrixRecord(record,now)
 assert.equal(read.state,'valid',read.error);assert.equal(read.projection.poiId,result.poiId)
 assert(matchesPoiMatrix(read.projection,{groups:[{group:'themes',codes:['history'],mode:'all'}],childAges:[]}))
 assert.equal(written['Copy Status'],'Draft');assert.equal(written['Fact Check Status'],'Todo');assert(!Object.hasOwn(written,'Description (RU)'))
 assert.equal((await ingestPoi(request,store)).outcome,'already_ingested');assert.equal(events.filter(e=>e.kind==='create').length,1)
})
await check('CREATE_FINAL_FIELDS_STAY_BOUND',async()=>{
 const r=clone(request);let writes=0
 const store=createMemoryPoiStore([],{observe:event=>{
  if(event.kind==='read')r.poi.factDossier.facts[0].text='Changed after validation'
  if(event.kind==='create')writes++
 }})
 await assert.rejects(()=>ingestPoi(r,store),/matrixDossierDrift/);assert.equal(writes,0)
})
await check('TTL_CANNOT_BE_SIGNED',()=>{
 const long={...claim('exhibition'),validUntil:new Date(Date.parse(now)+31*86400000).toISOString()}
 assert.throws(()=>buildMatrixWrite({claims:[long],assessedAt:now},context),/matrixWriteTtl/)
})
for(const[name,mutate,reason]of[
 ['REVIEW_REQUIRED',r=>delete r.poi.matrix.review,/matrix write/],
 ['REVIEW_BINDING',r=>r.poi.matrix.claims[0].rationale+=' Swap',/matrixReviewDrift/],
 ['REVIEW_INDEPENDENCE',r=>r.poi.matrix.review.reviewer=r.poi.matrix.review.author,/matrixIndependentReview/],
 ['FACT_BOUNDARY',r=>r.poi.matrix.claims[0].factIds=['foreign'],/matrixUnknownFact/],
 ['EVIDENCE_ON_SECOND_ROW',r=>r.poi.factEvidence[0].blocks[0].text='Swapped bytes',/evidenceDigest/],
 ['STORAGE_LIMIT',r=>r.poi.matrix.claims[0].rationale='x'.repeat(91000),/matrixStorageLimit/],
 ['EMPTY_ASSESSMENT',r=>r.poi.matrix.claims=[],/matrixAssessmentEmpty/],
 ['EXPIRED_WRITE',r=>{r.poi.matrix.claims=[{...claim('exhibition'),checkedAt:'2026-09-10T00:00:00.000Z',validUntil:'2026-09-11T00:00:00.000Z'}]},/matrixWriteExpired/],
 ['TTL_BOUNDARY',r=>{r.poi.matrix.claims=[{...claim('exhibition'),validUntil:new Date(Date.parse(now)+31*86400000).toISOString()}]},/matrixWriteTtl/],
 ['EXPLICIT_NULL',r=>r.poi.matrix=null,/matrix write/],
])await check(name+'_BEFORE_IO',async()=>{
 const invalid=clone(request);mutate(invalid);let calls=0
 const store={listExisting(){calls++;throw Error('I/O')},create(){calls++;throw Error('I/O')},readSchemaTables(){calls++;throw Error('I/O')}}
 await assert.rejects(()=>ingestPoiBatch([request,invalid],store),reason);assert.equal(calls,0)
})
await check('PUBLIC_CONTEXT_ACCESSORS_NEVER_EXECUTE',()=>{
 let calls=0
 const ctx=clone(context);Object.defineProperty(ctx,'now',{enumerable:true,get(){calls++;return now}})
 assert.throws(()=>buildMatrixWrite({claims:[claim()],assessedAt:now},ctx),/accessor/i)
 const f=clone(cleanFields);Object.defineProperty(f,'Notes',{enumerable:true,get(){calls++;return cleanFields.Notes}})
 assert.throws(()=>matrixContext(f,now),/accessor/i)
 assert.throws(()=>buildMatrixWrite({claims:[claim()],assessedAt:now},context,ctx),/accessor/i)
 const raw=clone(context);Object.defineProperty(raw,'poiId',{enumerable:true,get(){calls++;return null}})
 assert.throws(()=>buildPoiMatrix([claim()],raw,MATRIX_WRITE_SPEC),/accessor/i)
 const doc=clone(buildMatrixWrite({claims:[claim()],assessedAt:now},context)),receipt=review(doc)
 Object.defineProperty(doc,'digest',{enumerable:true,get(){calls++;return receipt.matrixDigest}})
 assert.throws(()=>assertMatrixWriteReview(receipt,doc,now),/accessor/i);assert.equal(calls,0)
 assert.deepEqual(reviewedMatrixWrite(request.poi.matrix,context),buildMatrixWrite({claims:[claim()],assessedAt:now},context))
})
await check('SOURCE_BOUND_REQUIRES_STORED_SOURCE',()=>{
 const document=buildMatrixWrite({claims:[claim()],assessedAt:now},context)
 for(const source of ['',null,'other:object'])assert.throws(()=>assertPoiMatrix(document,{...context,poiId:'POI-000001',fields:{...cleanFields,'POI ID':'POI-000001','Source Key':source}}),/matrixSourceKeyRequired/)
 assert.throws(()=>assertPoiMatrix({...document,spec:'toString'},context),/matrixVersion/)
})
await check('V1_REMAINS_RECORD_BOUND',()=>{
 const ctx={...context,poiId:'POI-000001',fields:{...cleanFields,'POI ID':'POI-000001'}}
 const v1=buildPoiMatrix([claim()],ctx);assert.equal(v1.spec,'poi-matrix/v1');assertPoiMatrix(v1,ctx)
 assert.throws(()=>assertPoiMatrix(v1,{...ctx,poiId:'POI-000002',fields:{...ctx.fields,'POI ID':'POI-000002'}}),/matrixIdentity/)
})
await check('SCHEMA_MISSING_WRONG_AND_REAL_MEMORY',async()=>{
 await ensureMatrixSchemaForWrite(createMemoryPoiStore([]),true)
 await assert.rejects(()=>ensureMatrixSchemaForWrite({},true),/matrixSchemaReaderRequired/)
 for(const type of [null,'singleLineText'])await assert.rejects(()=>ensureMatrixSchemaForWrite({readSchemaTables:async()=>[{id:POI_TABLE_ID,name:'POI',fields:type?[{name:MATRIX_FIELD,type}]:[]}]},true),/matrixSchemaMissingOrWrongType/)
 await ensureMatrixSchemaForWrite({readSchemaTables:async()=>[{id:POI_TABLE_ID,name:'POI',fields:[{name:MATRIX_FIELD,type:'multilineText'}]}]},true)
})
const prior={...cleanFields,'POI ID':'POI-007000','Copy Status':'Draft','Fact Check Status':'Todo','Description (RU)':'Существующий опубликованный текст',Latitude:35.01,Longitude:135.76}
const oldContext=matrixContext(prior,now)
prior[MATRIX_FIELD]=JSON.stringify(buildPoiMatrix([claim()],oldContext))
const row={recordId:'rec00000000000001',sourceKey:d.sourceKey,nameRu:request.poi.nameRu,previousFields:prior,incoming:d,evidence:fixture.evidence,identity:{reviewer:'fixture-researcher',checkedAt:now,reason:'Тот же предмет.',factIds:['f1']},changes:d.facts.map(f=>({incomingId:f.id,action:'corroborate',previousId:f.id,verification:null})),assessments:{visit:'keep',website:'keep'},copy:d.copy,copyReview:copyReview(d),writeDrafts:false,fieldUpdates:[]}
row.matrix=assessment([claim('exhibition')],matrixContext(prior,now),matrixContext(prior,now))
const proposed=factSyncProposal(row,{recordId:row.recordId,fields:prior},new Date(now)).proposed
await check('SYNC_MERGES_OMITTED_CLAIMS',()=>{
 const matrix=JSON.parse(proposed[MATRIX_FIELD]);assert.equal(matrix.poiId,prior['POI ID']);assert.deepEqual(matrix.claims.map(c=>c.code),['exhibition','history'])
 assert.deepEqual(Object.keys(proposed).sort(),[MATRIX_FIELD,'Notes'].sort())
 assert.deepEqual(factSyncProposal(row,{recordId:row.recordId,fields:{...prior,...proposed}},new Date(now)).proposed,proposed)
})
await check('SYNC_CANNOT_USE_CREATE_IDENTITY',()=>{
 const r=clone(row);r.previousFields['POI ID']=null;delete r.previousFields[MATRIX_FIELD]
 r.matrix=assessment([claim()],matrixContext({...r.previousFields,'POI ID':null},now))
 assert.throws(()=>factSyncProposal(r,{recordId:r.recordId,fields:r.previousFields},new Date(now)),/matrixUpdatePoiIdRequired/)
})
await check('SYNC_FRESH_RECORD_DRIFT',()=>{
 assert.throws(()=>factSyncProposal(row,{recordId:row.recordId,fields:{...prior,'POI Name (RU)':'Чужое место'}},new Date(now)),/syncPreviousFieldsDrift/)
})
await check('SYNC_DOSSIER_CHANGE_REQUIRES_REASSESSMENT',()=>{
 const r=clone(row);delete r.matrix;r.copy.ru[0].text+=' Новое описание.';r.copyReview=copyReview(mergePortalFacts(r,new Date(now)).dossier)
 assert.throws(()=>factSyncProposal(r,{recordId:r.recordId,fields:r.previousFields},new Date(now)),/matrixDossierDrift/)
})
await check('SYNC_REVIEW_COVERS_PRESERVED_CLAIMS',()=>{
 const r=clone(row);const doc=buildMatrixWrite({claims:r.matrix.claims,assessedAt:now},matrixContext(prior,now))
 r.matrix.review=review(doc);assert.throws(()=>factSyncProposal(r,{recordId:r.recordId,fields:prior},new Date(now)),/matrixReviewDrift/)
})
const root=await mkdtemp(path.join(tmpdir(),'matrix-write-test-')),file=path.join(root,'packet.json')
const packet={spec:FACT_SYNC_SPEC,portal:'japan-guide',rows:[row]}
let state=clone(prior),patches=0,schemaType='multilineText',gets=0
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}})
const fetchImpl=async(url,init={})=>{
 const u=new URL(url),method=init.method??'GET'
 if(u.pathname.includes('/meta/'))return response({tables:[{id:POI_TABLE_ID,name:'POI',fields:[...expectedTaxonomyFieldSchema().map(f=>({name:f.name,type:f.type})),{name:MATRIX_FIELD,type:schemaType}]}]})
 assert(u.pathname.endsWith(row.recordId))
 if(method==='PATCH'){patches++;Object.assign(state,JSON.parse(init.body).fields)}else{assert.equal(method,'GET');gets++}
 return response({id:row.recordId,fields:state})
}
await writeFile(file,JSON.stringify(packet))
const run=(id,write=false)=>runCopy({packetFile:file,runId:id,write},{repoRoot:root,env:{AIRTABLE_TOKEN:'fixture'},fetchImpl})
await check('EXECUTOR_DRY_RUN_SCHEMA_NO_PATCH',async()=>{const r=await run('dry');assert.equal(r.exitCode,0,r.report.failure);assert.equal(patches,0);assert.equal(r.report.rows[0].state,'prepared');assert(r.report.changes[0].matrixChange)})
schemaType='singleLineText'
await check('EXECUTOR_SCHEMA_REJECTS_BEFORE_PATCH',async()=>{const r=await run('wrong-schema',true);assert.equal(r.exitCode,1);assert.match(r.report.failure,/matrixSchemaMissingOrWrongType/);assert.equal(patches,0)})
schemaType='multilineText'
await check('EXECUTOR_VERIFIED_MATRIX_WRITE',async()=>{const r=await run('apply',true);assert.equal(r.exitCode,0,r.report.failure);assert.equal(patches,1);assert.equal(r.report.rows[0].state,'verified');assert.equal(readMatrixRecord(state,now).state,'valid');for(const[k,v]of Object.entries(prior))if(k!==MATRIX_FIELD)assert.deepEqual(state[k],v,k)})
await check('EXECUTOR_REPLAY_NO_EXTRA_PATCH',async()=>{const r=await run('repeat',true);assert.equal(r.exitCode,0,r.report.failure);assert.equal(patches,1);assert.equal(r.report.rows[0].state,'noChange');assert(gets>1)})
await check('EXECUTOR_JOURNAL_PERSISTED',async()=>{assert((await readFile(path.join(root,'tmp/poi-jg-copy-runs/apply/journal.ndjson'),'utf8')).includes('verified'))})
await check('LEGACY_REVISION_CANNOT_INVALIDATE_MATRIX',async()=>{
 const isolated=await mkdtemp(path.join(tmpdir(),'matrix-revision-')),packetFile=path.join(isolated,'packet.json')
 const dossier=clone(d);dossier.copy.ru[0].text='История города представлена в экспозиции музея.'
 const revision={spec:'poi-japan-guide-draft-revision/v1',rows:[{recordId:row.recordId,sourceKey:d.sourceKey,nameRu:row.nameRu,previousFields:clone(state),dossier,evidence:fixture.evidence,subjectAssessment:request.poi.factSubjectAssessment,classification:null}]}
 await writeFile(packetFile,JSON.stringify(revision));const beforePatches=patches
 const result=await runCopy({packetFile,runId:'revision',write:true},{repoRoot:isolated,env:{AIRTABLE_TOKEN:'fixture'},fetchImpl})
 assert.equal(result.exitCode,1);assert.match(result.report.failure,/matrixDossierDrift/);assert.equal(patches,beforePatches)
})
for(const failureMode of ['notApplied','unknown','drift'])await check('EXECUTOR_PARTIAL_'+failureMode,async()=>{
 const isolated=await mkdtemp(path.join(tmpdir(),'matrix-partial-'))
 const second=clone(row);second.recordId='rec00000000000002';second.previousFields['POI ID']='POI-007001'
 const secondCtx=matrixContext(second.previousFields,now)
 second.previousFields[MATRIX_FIELD]=JSON.stringify(buildPoiMatrix([claim()],secondCtx))
 second.matrix=assessment([claim('exhibition')],secondCtx,matrixContext(second.previousFields,now))
 const third=clone(second);third.recordId='rec00000000000003';third.previousFields['POI ID']='POI-007002'
 third.previousFields[MATRIX_FIELD]=JSON.stringify(buildPoiMatrix([claim()],matrixContext(third.previousFields,now)))
 third.matrix=assessment([claim('exhibition')],matrixContext(third.previousFields,now),matrixContext(third.previousFields,now))
 const rows=[row,second,third],states=new Map(rows.map(r=>[r.recordId,clone(r.previousFields)])),attempts=[]
 let failed=false
 const transport=async(url,init={})=>{
  const u=new URL(url),method=init.method??'GET',id=u.pathname.split('/').at(-1)
  if(u.pathname.includes('/meta/'))return response({tables:[{id:POI_TABLE_ID,name:'POI',fields:[{name:MATRIX_FIELD,type:'multilineText'}]}]})
  assert(states.has(id))
  if(method==='PATCH'){
   attempts.push(id)
   if(id===second.recordId){failed=true;if(failureMode==='unknown')Object.assign(states.get(id),JSON.parse(init.body).fields);return new Response('Interrupted',{status:500})}
   Object.assign(states.get(id),JSON.parse(init.body).fields)
   if(failureMode==='drift')states.get(second.recordId)['POI Name (RU)']='Changed during first write'
  }
  if(failed&&id===second.recordId&&failureMode==='unknown')throw Error('Verification unavailable')
  return response({id,fields:states.get(id)})
 }
 const packetFile=path.join(isolated,'packet.json');await writeFile(packetFile,JSON.stringify({...packet,rows}))
 const result=await runCopy({packetFile,runId:'partial',write:true},{repoRoot:isolated,env:{AIRTABLE_TOKEN:'fixture'},fetchImpl:transport})
 assert.equal(result.exitCode,1);assert.equal(result.report.rows[0].state,'verified')
 assert(!attempts.includes(third.recordId));assert.deepEqual(states.get(third.recordId),third.previousFields)
 assert.equal(attempts.length,failureMode==='drift'?1:2)
 const journal=await readFile(path.join(isolated,'tmp/poi-jg-copy-runs/partial/journal.ndjson'),'utf8')
 assert(journal.includes('verified'))
 if(failureMode==='unknown'){
  assert.equal(result.report.rows[1].state,'unknown')
  const retry=await runCopy({packetFile,runId:'retry',write:true},{repoRoot:isolated,env:{AIRTABLE_TOKEN:'fixture'},fetchImpl:transport})
  assert.equal(retry.exitCode,1);assert.equal(attempts.length,2,'unknown effect must not be repeated')
 }
})
await check('NO_AMBIENT_NETWORK',()=>assert.equal(ambient,0))
globalThis.fetch=originalFetch
console.log(`poi-matrix-write: ${checks} checks passed`)
