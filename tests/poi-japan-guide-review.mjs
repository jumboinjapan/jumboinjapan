import {factsFixture} from './fixtures/japan-guide-facts.mjs'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {reviewSelection,reviewIdentificationQueue,prepareReviewedIntake,reviewCatalogDigest,ingestReviewedPoi,parseReviewLinks,REVIEW_LINK_SPEC} from '../scripts/poi-portals/lib/japan-guide-review.mjs'
import {runIntakeCli,parseIntakeArgs} from '../scripts/poi-portals/intake-japan-guide.mjs'
import {runCopy} from '../scripts/poi-portals/copy-japan-guide.mjs'
import {runReviewedIdentification} from '../scripts/poi-portals/identify-reviewed-japan-guide.mjs'
import {buildIdentificationReport} from '../scripts/poi-portals/lib/place-identification.mjs'
import {createSnapshotStore} from '../scripts/poi-portals/lib/base-snapshot.mjs'
import {expectedTaxonomyFieldSchema} from '../src/lib/poi-taxonomy-airtable.ts'
import {POI_TABLE_ID} from '../src/lib/airtable-schema.ts'
import {prefectureJaForSiteCity} from '../src/lib/jp-address.ts'
import {canonicalPrefecture} from '../src/lib/prefectures.ts'
import {parseOfficialPageEvidence} from '../scripts/poi-portals/lib/japan-guide-evidence.mjs'
import {dossierSkeleton} from '../scripts/poi-portals/lib/japan-guide-facts.mjs'
import {sha256Bytes} from '../scripts/lib/byte-digest.mjs'
const root=await mkdtemp(path.join(tmpdir(),'jg-review-'))
const now='2026-09-10T06:00:00.000Z', today='2026-09-10'
let checks=0,liveCalls=0
const check=(label,fn)=>{try{fn();checks++}catch(e){throw new Error(`${label}: ${e.message}`,{cause:e})}}
globalThis.fetch=()=>{liveCalls++;throw Error('Live network forbidden')}
const logs=console.log;console.log=()=>{}
const select=(...sourceKeys)=>({spec:'poi-japan-guide-review/v1',sourceKeys})
const rowFor=(key,over={})=>{
 const item=reviewSelection(select(key))[0]
 return {sourceKey:key,sourceUrl:item.sourceUrl,nameJa:item.subject.nameJa,nameEn:item.subject.nameEn,siteCity:item.subject.siteCity,
 outcome:'resolved',place:{placeId:'ChIJ-'+key,businessStatus:'OPERATIONAL',prefecture:canonicalPrefecture(prefectureJaForSiteCity(item.subject.siteCity)),coordinates:{lat:39.5907,lon:140.5637,observedOn:today,validUntil:'2026-10-10',ttlDays:30}},alternatives:[],called:false,attempts:[],review:false,...over}
}
const identify=rows=>buildIdentificationReport({queue:rows,result:{rows,calls:0},limit:0,priceMicros:0,createdAt:now,inputs:{reviewCatalog:{digest:reviewCatalogDigest}}})
const merchant='japan-guide:e3605',ando=merchant+'-ando'
const selection=select(ando,merchant)
const identification=identify([rowFor(ando)])
const seed={id:'rec00000000000042',fields:{'POI ID':'POI-000042','POI Name (RU)':'Посторонний музей','POI Name (EN)':'Unrelated Museum','Site City':'osaka',Latitude:34.5,Longitude:135.2}}
function service(initial=[seed]) {
 const state={rows:structuredClone(initial),post:0,patch:0,get:0,lose:false}
 const fetchImpl=async(url,init={})=>{
  const u=new URL(url),method=init.method??'GET';const response=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})
  if(method==='POST') {state.post++;const fields=JSON.parse(init.body).records[0].fields;const r={id:`rec${String(100+state.post).padStart(14,'0')}`,fields};state.rows.push(r);return response({records:[r]})}
  if(method==='PATCH'){state.patch++;const row=state.rows.find(r=>r.id===u.pathname.split('/').at(-1));Object.assign(row.fields,JSON.parse(init.body).fields);if(state.lose)throw Error('Lost response');return response(row)}
  assert.equal(method,'GET');state.get++
  if(u.pathname.includes('/meta/'))return response({tables:[{id:POI_TABLE_ID,name:'POI',fields:expectedTaxonomyFieldSchema().map(f=>({name:f.name,type:f.type,...(f.choices?{options:{choices:f.choices.map(name=>({name}))}}:{})}))}]})
  const id=u.pathname.split('/').at(-1);if(id.startsWith('rec'))return response(state.rows.find(r=>r.id===id))
  const filter=u.searchParams.get('filterByFormula');let rows=state.rows
  if(filter){const m=filter.match(/^\{(.+)\}='(.*)'$/);assert(m);rows=rows.filter(r=>r.fields[m[1]]===m[2])}
  return response({records:rows})
 }
 return {state,fetchImpl}
}
const deps=svc=>({repoRoot:root,env:{AIRTABLE_TOKEN:'test'},fetchImpl:svc.fetchImpl,now:()=>new Date(now),codeIdentity:{commit:'a'.repeat(40),dirty:false}})
const file=async(name,value)=>{const f=path.join(root,name);await writeFile(f,JSON.stringify(value));return f}
try{
 const geoKey='japan-guide:e4442-takahama-beach',geoItem=reviewSelection(select(geoKey))[0],g=geoItem.geographyEvidence
 const geoFixture=()=>{
  const row=factsFixture(geoItem.originKey);row.dossier.sourceKey=geoKey
  const text='<html><body><main><p>Address: Nagasaki, Goto, Takahama Beach.</p></main></body></html>'
  const e=parseOfficialPageEvidence({url:g.sourceUrl,text,rawPageDigest:sha256Bytes(Buffer.from(text)),observedAt:now},{sourceKey:geoKey,rootSelector:'main'})
  row.evidence.push(e);row.dossier.sources.push(dossierSkeleton(e,{allowOfficial:true}).sources[0])
  row.dossier.facts.push({id:g.factId,subject:geoItem.subject.nameRu,category:'identity',text:'Адрес пляжа подтверждён официальным источником.',conditions:'',status:'verified',references:[{source:1,blockId:e.blocks[0].id}]})
  row.dossier.coverage.push(...e.blocks.map(b=>({source:1,blockId:b.id,disposition:'facts',reason:''})))
  return {spec:'poi-japan-guide-facts-batch/v2',rows:[row]}
 }
 const geoHit=rowFor(geoKey);geoHit.place.prefecture=null
 const geoReport=identify([geoHit]),geoPacket=geoFixture(),geoBefore=JSON.stringify(geoReport)
 const geoResult=prepareReviewedIntake(select(geoKey),geoReport,[],today,geoPacket)
 check('official geography fills only missing provider prefecture with provenance',()=>{assert.equal(geoResult.requests[0].poi.resolved.prefectureEn,'Nagasaki');assert.equal(geoResult.rows[0].geographyEvidence.kind,'officialSource');assert(geoResult.requests[0].poi.openQuestions.some(s=>s.includes(g.sourceUrl)));assert.equal(JSON.stringify(geoReport),geoBefore)})
 check('missing geography dossier refuses',()=>assert.throws(()=>prepareReviewedIntake(select(geoKey),geoReport,[],today),/Official geography dossier missing/))
 for(const [field,value] of [['subject','Другой пляж'],['status','reported'],['category','history']]){
  const bad=geoFixture();bad.rows[0].dossier.facts.at(-1)[field]=value
  check(`official geography rejects wrong ${field}`,()=>assert.throws(()=>prepareReviewedIntake(select(geoKey),geoReport,[],today,bad),/Official geography fact mismatch/))
 }
 const badRef=geoFixture();badRef.rows[0].dossier.facts.at(-1).references=[{source:0,blockId:'b1'}]
 Object.assign(badRef.rows[0].dossier.coverage.at(-1),{disposition:'irrelevant',reason:'Контрпример: официальный блок не использован.'})
 check('geography cannot cite portal instead of official source',()=>assert.throws(()=>prepareReviewedIntake(select(geoKey),geoReport,[],today,badRef),/Official geography source mismatch/))
 const conflict=structuredClone(geoHit);conflict.place.prefecture=canonicalPrefecture('Tokyo')
 check('official geography never overrides provider conflict',()=>assert.throws(()=>prepareReviewedIntake(select(geoKey),identify([conflict]),[],today,geoPacket),/Identification prefecture mismatch/))
 const malformed=structuredClone(geoHit);malformed.place.prefecture={en:'bad',ru:'bad',ja:'bad'}
 check('invalid provider prefecture is not treated as missing',()=>assert.throws(()=>prepareReviewedIntake(select(geoKey),identify([malformed]),[],today,geoPacket),/Identification prefecture mismatch/))
 const noProof=rowFor(ando);noProof.place.prefecture=null
 check('expected city alone never supplies prefecture',()=>assert.throws(()=>prepareReviewedIntake(select(ando),identify([noProof]),[],today),/Identification prefecture mismatch/))
 const geoSvc=service(),geoSelFile=await file('geo-selection.json',select(geoKey)),geoIdsFile=await file('geo-identification.json',geoReport),badGeoFile=await file('geo-bad-facts.json',badRef)
 await assert.rejects(runIntakeCli(['node','intake','--review-selection',geoSelFile,'--identification',geoIdsFile,'--facts',badGeoFile,'--run-id','geo-invalid','--live-read'],deps(geoSvc)),/Official geography source mismatch/);checks++
 check('CLI validates official geography before database read',()=>assert.equal(geoSvc.state.get,0))
 const goodGeoFile=await file('geo-good-facts.json',geoPacket)
 const goodGeo=await runIntakeCli(['node','intake','--review-selection',geoSelFile,'--identification',geoIdsFile,'--facts',goodGeoFile,'--run-id','geo-valid','--live-read'],deps(geoSvc))
 check('CLI passes evidence through both preparation calls',()=>{assert.equal(goodGeo.exitCode,0);assert.equal(goodGeo.report.rows[0].geographyEvidence.kind,'officialSource');assert(geoSvc.state.get>0);assert.equal(geoSvc.state.post,0)})
 check('parent precedes child regardless of selection order',()=>assert.deepEqual(reviewSelection(selection).map(r=>r.sourceKey),[merchant,ando]))
 check('unknown owner decision cannot be submitted',()=>assert.throws(()=>reviewSelection(select('japan-guide:e999999')),/Unknown reviewed/))
 check('selection cannot repeat a key',()=>assert.throws(()=>reviewSelection(select(ando,ando)),/Duplicate/))
 const full=reviewIdentificationQueue(select('japan-guide:e3602-ishiguro'))[0]
 check('search uses sourced full name and retains short alternative',()=>{assert.equal(full.nameJa,'武家屋敷 石黒家');assert.equal(full.nameJaAlternative,'石黒家');assert.equal(full.prefectureEn,'Akita')})
 check('owner area does not search for the anchor as its own identity',()=>assert.deepEqual(reviewIdentificationQueue(select(merchant)),[]))
 const prepared=prepareReviewedIntake(selection,identification,[],today)
 check('area has representative coordinates without borrowed Place ID',()=>{assert.equal(prepared.requests.length,2);assert(!prepared.requests[0].poi.resolved.placeId);assert(Number.isFinite(prepared.requests[0].poi.lat))})
 check('descriptions and fact sources reach the real request',()=>{assert(prepared.requests[1].poi.descriptionRu);assert(prepared.requests[1].poi.descriptionEn);assert(prepared.requests[1].poi.sources.length);assert.equal(prepared.requests[1].poi.taxonomy.classificationSource,'model')})
 for(const [field,value,label] of [['nameEn','Different museum','name'],['siteCity','tokyo','city'],['sourceUrl','https://example.org/other','source']]){
  const changed=identify([rowFor(ando,{[field]:value})]);check(`identification ${label} drift refuses before intake`,()=>assert.throws(()=>prepareReviewedIntake(select(ando),changed,[],today),/mismatch/))
 }
 const expired=rowFor(ando);expired.place.coordinates={...expired.place.coordinates,observedOn:'2026-08-01',validUntil:'2026-08-31'}
 check('expired Google coordinates are not writable',()=>assert.equal(prepareReviewedIntake(select(ando),identify([expired]),[],today).rows[0].outcome,'coordinatesExpired'))
 const closed=rowFor(ando);closed.place.businessStatus='CLOSED_PERMANENTLY'
 check('closed listing cannot silently become an open draft',()=>assert.equal(prepareReviewedIntake(select(ando),identify([closed]),[],today).rows[0].outcome,'closedSourceListing'))
 const wrongCatalog=identify([rowFor(ando)]);wrongCatalog.inputs.reviewCatalog.digest='sha256:'+'0'.repeat(64)
 check('damaged report fails digest',()=>assert.throws(()=>prepareReviewedIntake(select(ando),wrongCatalog,[],today),/изменён после подписи/))
 const empty=createSnapshotStore([{recordId:seed.id,poiId:'POI-000042',nameRu:seed.fields['POI Name (RU)'],nameEn:'Unrelated Museum',siteCity:'osaka',lat:34.5,lon:135.2,placeId:null,sourceKey:null}])
 assert.equal((await ingestReviewedPoi(prepared.requests[1],empty)).outcome,'parentUnavailable');checks++
 const parentResult=await ingestReviewedPoi(prepared.requests[0],empty)
 const childResult=await ingestReviewedPoi(prepared.requests[1],empty)
 check('same-batch source index resolves new parent',()=>{assert.equal(parentResult.outcome,'created');assert.equal(childResult.outcome,'created');assert.deepEqual(childResult.fields['Parent POI'],[parentResult.recordId])})
 const again=await ingestReviewedPoi(prepared.requests[1],empty)
 check('same source key is idempotent',()=>assert.equal(again.outcome,'already_ingested'))
 const sel=await file('selection.json',selection), ids=await file('identification.json',identification)
 const searchFile=await file('search-selection.json',select(ando))
 let resolverCalls=0
 const searchDeps={env:{GOOGLE_PLACES_API_KEY:'test'},now:()=>new Date(now),resolve:()=>{resolverCalls++;throw Error('Unexpected paid call')}}
 const drySearch=await runReviewedIdentification({selectionFile:searchFile,out:path.join(root,'search-dry.json')},searchDeps)
 check('reviewed search defaults to zero network',()=>{assert.equal(drySearch.effects.google,0);assert.equal(resolverCalls,0)})
 const reuse=await runReviewedIdentification({selectionFile:searchFile,out:path.join(root,'search-reused.json'),reuseFile:ids,live:true,priceMicros:32000},searchDeps)
 check('valid saved lookup is reused without billing another call',()=>{assert.equal(reuse.spend.calls,0);assert.equal(reuse.rows[0].place.placeId,rowFor(ando).place.placeId);assert.equal(resolverCalls,0)})
 await assert.rejects(runReviewedIdentification({selectionFile:searchFile,out:path.join(root,'search-reused.json'),live:true,priceMicros:32000},searchDeps),/EEXIST/);checks++
 check('occupied output rejects before Google',()=>assert.equal(resolverCalls,0))
 assert.deepEqual(JSON.parse(await readFile(path.join(root,'search-reused.json'),'utf8')),reuse);checks++
 const facts=await file('facts.json',{spec:'poi-japan-guide-facts-batch/v1',rows:[merchant,ando].map(key=>{
  const f=factsFixture(merchant),item=reviewSelection(select(key))[0]
  f.dossier.sourceKey=key
  Object.assign(f.dossier.facts[0],{subject:item.subject.nameRu,category:'identity'})
  return {...f,subjectAssessment:{role:key===merchant?'parent':'place',nameRu:item.subject.nameRu,poiPrimaryType:item.proposal.poiPrimaryType,factIds:['f1'],reason:'Тип относится к самостоятельному предмету этой карточки.'}}
 })})
 const argv=run=>['node','intake','--review-selection',sel,'--identification',ids,'--facts',facts,'--write','--run-id',run]
 check('review inputs cannot mix with ordinary candidate files',()=>assert.throws(()=>parseIntakeArgs([...argv('bad'),'--queues','other.json']),/cannot mix/))
 const svc=service();const run=await runIntakeCli(argv('review-live'),deps(svc))
 check('production transport creates two verified drafts',()=>{assert.equal(run.exitCode,0,run.report.failure);assert.equal(svc.state.post,2);assert(run.report.outcomes.every(r=>r.state==='verified'))})
 const savedParent=svc.state.rows.find(r=>r.fields['Source Key']===merchant),savedChild=svc.state.rows.find(r=>r.fields['Source Key']===ando)
 check('stored child references actual live parent ID',()=>assert.deepEqual(savedChild.fields['Parent POI'],[savedParent.id]))
 check('stored area has no anchor Google ID',()=>{assert.equal(savedParent.fields['Coordinate Policy'],'representativePoint');assert(!savedParent.fields['Google Place ID'])})
 check('stored taxonomy and drafts without publication',()=>{for(const r of [savedParent,savedChild]){assert.equal(r.fields['Copy Status'],'Draft');assert.equal(r.fields['Fact Check Status'],'Todo');assert(r.fields['Description Draft (RU)']);assert(r.fields['Description Draft (EN)']);assert(r.fields['POI Type']);assert(!('Approved' in r.fields));assert(!('Description (RU)' in r.fields))}})
 const repeat=await runIntakeCli(argv('review-repeat'),deps(svc))
 check('repeat live invocation never creates again',()=>{assert.equal(repeat.exitCode,0,repeat.report.failure);assert.equal(svc.state.post,2)})
 const sento='japan-guide:e3935';const sentoHit=rowFor(sento);sentoHit.place.coordinates={...sentoHit.place.coordinates,lat:35.0223399,lon:135.7651343}
 const sentoRequest=prepareReviewedIntake(select(sento),identify([sentoHit]),[],today).requests[0]
 const palace={recordId:'rec00000000000612',poiId:'POI-000612',nameRu:'Киотский императорский дворец',nameEn:'Kyoto Imperial Palace',siteCity:'kyoto',placeId:'palace-id',lat:35.0240977,lon:135.7621436,sourceKey:'japan-guide:e3917'}
 // Bind the exact canonical pair (the live name can differ from a translation in a test).
 const pair=reviewSelection(select(sento))[0].distinctFrom.find(r=>r.key==='POI-000612');Object.assign(palace,{nameRu:pair.nameRu,nameEn:pair.nameEn,siteCity:pair.siteCity})
 const one=await ingestReviewedPoi(sentoRequest,createSnapshotStore([palace]))
 check('explicit Sento/Imperial Palace distinction permits own record',()=>assert.equal(one.outcome,'created'))
 const collision={...palace,poiId:'POI-000777',recordId:'rec00000000000777',nameRu:sentoRequest.poi.nameRu,nameEn:sentoRequest.poi.nameEn,sourceKey:'other:777',placeId:'other-id'}
 const stillBlocked=await ingestReviewedPoi(sentoRequest,createSnapshotStore([palace,collision]))
 check('owner pair does not excuse unknown duplicates',()=>assert(['blocked_duplicate','needs_review'].includes(stillBlocked.outcome)))
 const shared=await ingestReviewedPoi(sentoRequest,createSnapshotStore([{...palace,placeId:sentoRequest.poi.resolved.placeId}]))
 check('owner distinction never bypasses same Place ID',()=>assert.equal(shared.outcome,'blocked_duplicate'))
 const changedParent=await ingestReviewedPoi(sentoRequest,createSnapshotStore([{...palace,nameEn:'Kyoto Sento Imperial Palace'}]))
 check('changed other subject loses the exception',()=>assert.notEqual(changedParent.outcome,'created'))
 // Existing published Aoyagi: only link and Notes, never public fields or status.
 const items=reviewSelection(select('japan-guide:e3602','japan-guide:e3602-aoyagi'))
 const rows=items.map((item,i)=>({id:`rec${String(800+i).padStart(14,'0')}`,fields:{'POI ID':item.existingPoiId,'POI Name (RU)':item.subject.nameRu,'POI Name (EN)':item.subject.nameEn,'Site City':item.subject.siteCity,'Copy Status':'Synced','Description (RU)':'Published text',Approved:true,Notes:'Keep original note'}}))
 const linkPacket={spec:REVIEW_LINK_SPEC,rows:[{sourceKey:items[1].sourceKey,recordId:rows[1].id,parentRecordId:rows[0].id}]}
 check('link packet cannot invent an owner decision',()=>assert.throws(()=>parseReviewLinks({...linkPacket,rows:[{...linkPacket.rows[0],sourceKey:'japan-guide:e999999'}]}),/not recorded/))
 const linkFile=await file('links.json',linkPacket),linked=service(rows)
 const linkRun=await runCopy({packetFile:linkFile,runId:'links-first',write:true},deps(linked))
 check('existing record links through verified update',()=>{assert.equal(linkRun.exitCode,0,linkRun.report.failure);assert.equal(linked.state.patch,1);assert.equal(linkRun.report.rows[0].state,'verified')})
 check('published copy and status are byte-preserved',()=>{assert.equal(linked.state.rows[1].fields['Description (RU)'],'Published text');assert.equal(linked.state.rows[1].fields['Copy Status'],'Synced');assert.equal(linked.state.rows[1].fields.Approved,true);assert(linked.state.rows[1].fields.Notes.startsWith('Keep original note'));assert.deepEqual(linked.state.rows[1].fields['Parent POI'],[rows[0].id])})
 const linkAgain=await runCopy({packetFile:linkFile,runId:'links-repeat',write:true},deps(linked))
 check('repeating a link does not PATCH again',()=>{assert.equal(linkAgain.exitCode,0,linkAgain.report.failure);assert.equal(linked.state.patch,1)})
 const cycle=service(rows);cycle.state.rows[0].fields['Parent POI']=[rows[1].id]
 const cyclic=await runCopy({packetFile:linkFile,runId:'links-cycle',write:true},deps(cycle))
 check('parent cycle is rejected before any PATCH',()=>{assert.equal(cyclic.exitCode,1);assert.match(cyclic.report.failure,/cycle/);assert.equal(cycle.state.patch,0)})
}finally{console.log=logs;await rm(root,{recursive:true,force:true})}
assert.equal(liveCalls,0)
console.log(`✓ Japan Guide owner review: ${checks} checks, live network 0`)
