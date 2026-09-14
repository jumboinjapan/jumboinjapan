import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {detail,date} from './fixtures/visit-hokkaido.mjs'
import {buildHokkaidoBundle,hokkaidoResearchRows} from '../scripts/poi-portals/lib/visit-hokkaido.mjs'
import {preparePortalDraftBatch,PORTAL_DRAFT_BATCH_SPEC,PORTAL_SUBJECT_BATCH_SPEC} from '../scripts/poi-portals/lib/portal-draft-batch.mjs'
import {buildIdentificationReport,runIdentification} from '../scripts/poi-portals/lib/place-identification.mjs'
import {EDITORIAL_POLICY,getEditorialPolicyDigest} from '../scripts/poi-portals/lib/poi-copywriter.mjs'
import {dossierDigest} from '../scripts/poi-portals/lib/japan-guide-facts.mjs'
import {parsePortalEvidence} from '../scripts/poi-portals/lib/japan-guide-evidence.mjs'
import {relationSubject} from '../scripts/poi-portals/lib/source-relations.mjs'
import {runIntakeCli,parseIntakeArgs} from '../scripts/poi-portals/intake-japan-guide.mjs'
import {ingestPoi} from '../src/lib/poi-ingest.ts'
import {createMemoryPoiStore} from '../src/lib/poi-memory-store.ts'
import {createSnapshotStore} from '../scripts/poi-portals/lib/base-snapshot.mjs'
import {expectedTaxonomyFieldSchema} from '../src/lib/poi-taxonomy-airtable.ts'
import {POI_TABLE_ID} from '../src/lib/airtable-schema.ts'
import {resolveSiteCity,prefectureJaForSiteCity} from '../src/lib/jp-address.ts'
import {KNOWN_CITIES} from '../src/lib/poi-canon.ts'
import {readPoiFacts} from '../src/lib/poi-facts.ts'
import {evaluatePoiCandidate} from '../scripts/poi-portals/lib/scoring.mjs'
import {canonicalJsonBytes} from '../scripts/lib/canonical-contract.mjs'
import {sha256Bytes} from '../scripts/lib/byte-digest.mjs'
let checks=0,network=0
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{network++;throw Error('Unexpected network')}
const test=async(name,f)=>{try{await f();console.log('✓ '+name);checks++}catch(e){throw new Error(name+': '+e.message,{cause:e})}}
const ja=detail(),en=detail('en'),pages=[ja,en]
const bundle=buildHokkaidoBundle(pages,pages.map(p=>({url:p.url,outcome:'fetched',detail:''})))
const research=hokkaidoResearchRows(bundle)[0],d=structuredClone(research.dossier),key=research.sourceKey
// Synthetic authored material for a synthetic page, not editorial approval of live prose.
const name='Тестовый музей'
d.facts=research.evidence.flatMap((e,source)=>e.blocks.map((b,i)=>({id:`s${source}f${i}`,subject:name,category:i===0?'identity':'visiting',text:i===0?'Музей истории города.':'Посещение тестового музея.',conditions:'',status:'reported',references:[{source,blockId:b.id}]})))
d.coverage=d.coverage.map(c=>({...c,disposition:'facts',reason:''}));d.copy={ru:[{text:'Музей знакомит с историей города.',factIds:['s0f0']}],en:[{text:'The museum introduces the history of the town.',factIds:['s0f0']}]}
const review={spec:'poi-copy-review/v1',dossierDigest:dossierDigest(d),policyDigest:getEditorialPolicyDigest(),author:'fixture-author',reviewer:'fixture-editor',checkedAt:new Date().toISOString(),checks:Object.fromEntries(EDITORIAL_POLICY.reviewDimensions.map(k=>[k,true])),issues:[]}
const queue=[{sourceKey:key,sourceUrl:ja.url,nameJa:bundle.rows[0].cards[0].name,nameEn:bundle.rows[0].cards[1].name,address:'北海道札幌市中央区北一条',siteCity:'sapporo'}]
const now=()=>new Date(date)
const result=await runIdentification({queue,limit:1,now,resolve:async()=>({outcome:'resolved',place:{placeId:'fixture-new',lat:43.06,lon:141.35,prefecture:{en:'Hokkaido',ja:'北海道'},businessStatus:'OPERATIONAL'}})})
const identification=buildIdentificationReport({queue,result,limit:1,priceMicros:32000,createdAt:date,inputs:{fixture:true},portal:'visit-hokkaido'})
const packet={spec:PORTAL_DRAFT_BATCH_SPEC,portal:'visit-hokkaido',bundle,identification,rows:[{sourceKey:key,nameRu:name,siteCity:'sapporo',proposal:{entityKind:'tourist_poi',poiPrimaryType:'museum',facets:[],confidence:0.99,reasons:['Музей истории.'],nameRu:name},dossier:d,evidence:structuredClone(research.evidence),subjectAssessment:{role:'place',nameRu:name,poiPrimaryType:'museum',factIds:['s0f0'],reason:'Самостоятельный музей.'},copyReview:review}]}
const seed=[{recordId:'rec00000000000001',poiId:'POI-000001',nameRu:'Другое место',nameEn:null,siteCity:'kyoto',lat:35,lon:135,placeId:'fixture-existing',sourceKey:'japan-guide:existing'}]
const today=date.slice(0,10),prepare=p=>preparePortalDraftBatch(p,seed,today)
const resign=r=>{const body={...r};delete body.reportDigest;r.reportDigest=sha256Bytes(canonicalJsonBytes({...body,createdAt:null},body.spec));return r}
await test('HISTORIC_RESIDENCE_IS_NOT_OVERNIGHT_ACCOMMODATION',()=>{
 const candidate={nameJa:'旧青山別邸（小樽貴賓館）',lat:43.23,lon:141.0,descriptionJa:'旧家の歴史を紹介する建物。'.repeat(30)}
 assert(!evaluatePoiCandidate(candidate).blockingReasons.includes('accommodation'))
 for(const nameJa of ['青山別邸','旧青山別邸ホテル','ホテル旧青山別邸','青山旅荘','ヴィラ青山','旧ホテル青山別邸'])assert(evaluatePoiCandidate({...candidate,nameJa}).blockingReasons.includes('accommodation'),nameJa)
})
await test('SOURCE_BOUND_POSITIVE',()=>{const r=prepare(packet);assert.equal(r.requests.length,1,JSON.stringify(r.rows));assert.equal(r.rows[0].outcome,'writable')})
const signed=p=>{p.rows[0].copyReview.dossierDigest=dossierDigest(p.rows[0].dossier);resign(p.identification);return p}
const subjectPacket=()=>{
 const p=structuredClone(packet),r=p.rows[0]
 p.spec=PORTAL_SUBJECT_BATCH_SPEC
 Object.assign(r,{originKey:key,subjectNames:{nameJa:queue[0].nameJa,nameEn:null},sourceRelations:null,mapSelection:null})
 r.dossier.facts[0].text+=' '+queue[0].nameJa
 p.identification.rows[0].nameEn=null
 return signed(p)
}
const supplement=(p,html)=>{
 const r=p.rows[0],source=r.evidence.length
 const e=parsePortalEvidence({url:'http://operator.example.org/visit',text:html,rawPageDigest:sha256Bytes(Buffer.from(html)),observedAt:date},{sourceKey:r.sourceKey,rootSelector:'main',role:'official'})
 r.evidence.push(e);r.dossier.sources.push({url:e.sourceUrl,observedAt:e.observedAt,evidenceDigest:e.digest,blocks:e.blocks.map(({id,kind,locator,section})=>({id,kind,locator,section}))});r.dossier.coverage.push(...e.blocks.map(b=>({source,blockId:b.id,disposition:'facts',reason:''})))
 return {e,source}
}
await test('V2_CHILD_REUSES_COMPLETE_PORTAL_EVIDENCE',()=>{
 const p=subjectPacket(),r=p.rows[0];r.sourceKey=key+'-museum';r.dossier.sourceKey=r.sourceKey;p.identification.rows[0].sourceKey=r.sourceKey;signed(p)
 const out=prepare(p);assert.equal(out.requests.length,1);assert.equal(out.requests[0].poi.factDossier.sourceKey,r.sourceKey)
 const bad=structuredClone(p);bad.rows[0].subjectNames.nameJa='作った名前';assert.throws(()=>prepare(bad),/portalDraftSubjectNameEvidence/)
})
await test('V2_EXPLICIT_OPERATOR_MAP_IS_REQUIRED_AND_BOUND',()=>{
 const p=subjectPacket(),r=p.rows[0],{e,source}=supplement(p,'<main><p>Museum visitor entrance.</p><iframe src="https://www.google.com/maps?cid=2748"></iframe></main>')
 const b=e.blocks.find(b=>b.mediaType==='iframe')
 r.dossier.facts.push({id:'map',subject:name,category:'identity',text:'Оператор выбрал на карте вход в музей.',conditions:'',status:'verified',references:e.blocks.map(b=>({source,blockId:b.id}))})
 r.mapSelection={source,blockId:b.id,factId:'map',cid:'2748'};p.identification.rows[0].selectedMapCid='2748';signed(p)
 assert.equal(prepare(p).requests.length,1)
 // The same production preparation must support the operator's ordinary map
 // link, not only embedded maps with a query parameter.
 const pathPacket=subjectPacket(),pr=pathPacket.rows[0],extra=supplement(pathPacket,'<main><a href="https://www.google.co.jp/maps/place/Museum/@43,141,14z/data=!4m5!3m4!1s0x123:0xabc!8m2!3d43!4d141">Arrival map</a></main>'),link=extra.e.blocks.find(b=>b.mediaType==='a')
 pr.dossier.facts.push({id:'pathMap',subject:name,category:'identity',text:'Операторская точка прибытия.',conditions:'',status:'verified',references:extra.e.blocks.map(b=>({source:extra.source,blockId:b.id}))})
 pr.mapSelection={source:extra.source,blockId:link.id,factId:'pathMap',cid:'2748'};pathPacket.identification.rows[0].selectedMapCid='2748';signed(pathPacket)
 assert.equal(prepare(pathPacket).requests.length,1,'STRUCTURED_OPERATOR_LINK_REACHES_PREPARATION')
 for(const [change,pattern] of [[x=>x.rows[0].mapSelection=null,/portalMapSelectionUnproven/],[x=>x.identification.rows[0].selectedMapCid='99',/portalMapSelectionIdentification/],[x=>x.rows[0].mapSelection.cid='99',/portalMapSelectionFeature/],[x=>x.rows[0].dossier.facts.at(-1).subject='Другой объект',/portalMapSelectionSubject/]]){const bad=structuredClone(p);change(bad);signed(bad);assert.throws(()=>prepare(bad),pattern)}
})
await test('OPERATOR_MAP_CONTINUATION_BINDS_INDEPENDENT_REVIEW',()=>{
 const p=subjectPacket(),r=p.rows[0],{e,source}=supplement(p,'<main><p>Museum arrival route.</p><a href="https://maps.google.co.jp/maps?daddr=museum">Map</a></main>')
 const b=e.blocks.find(b=>b.mediaType==='a')
 assert(b,'Fixture must contain an actual source map link')
 const c={spec:'poi-map-continuation/v1',fromUrl:b.url,selectedCid:'2748',observedAt:date,method:'browserNavigation',author:'fixture-author',reviewer:r.copyReview.reviewer,artifactDigest:'sha256:'+'a'.repeat(64)}
 r.copyReview.checkedAt=date
 r.dossier.facts.push({id:'continuation',subject:name,category:'identity',text:'Операторская ссылка ведёт к точке прибытия.',conditions:sha256Bytes(canonicalJsonBytes(c,c.spec)),status:'verified',references:e.blocks.map(b=>({source,blockId:b.id}))})
 r.mapSelection={source,blockId:b.id,factId:'continuation',cid:'2748',continuation:c};p.identification.rows[0].selectedMapCid='2748';signed(p)
 assert.equal(prepare(p).requests.length,1)
 for(const [change,pattern] of [
  [x=>x.rows[0].mapSelection.continuation.fromUrl+='&other=1',/portalMapContinuationSource/],
  [x=>x.rows[0].mapSelection.continuation.selectedCid='99',/portalMapContinuationTarget/],
  [x=>x.rows[0].mapSelection.continuation.artifactDigest='sha256:'+'b'.repeat(64),/portalMapContinuationBinding/],
  [x=>x.rows[0].mapSelection.continuation.reviewer='another-editor',/portalMapContinuationReview/],
  [x=>x.rows[0].mapSelection.continuation.author=x.rows[0].mapSelection.continuation.reviewer,/portalMapContinuationReview/],
  [x=>x.rows[0].mapSelection.continuation.observedAt='2099-01-01',/portalMapContinuationDate/],
  [x=>x.rows[0].mapSelection.continuation.observedAt='2000-01-01',/portalMapContinuationDate/],
  [x=>x.rows[0].dossier.facts.at(-1).conditions='',/portalMapContinuationBinding/],
  [x=>x.rows[0].dossier.facts.at(-1).status='reported',/portalMapSelectionSubject/],
 ]){const bad=structuredClone(p);change(bad);signed(bad);assert.throws(()=>prepare(bad),pattern)}
})
await test('OFFICIAL_TEMPORARY_CLOSURE_CREATES_CLOSED_DRAFT_ONLY',async()=>{
 const p=subjectPacket(),r=p.rows[0],{e,source}=supplement(p,'<main><p>Seasonal service is temporarily closed.</p></main>')
 r.dossier.facts.push({id:'closed',subject:name,category:'notice',text:'Музей временно закрыт.',conditions:'',status:'verified',references:[{source,blockId:e.blocks[0].id}]})
 r.dossier.visit={...r.dossier.visit,status:'temporaryClosed',factIds:['closed'],explanation:'Закрытие подтверждено оператором.'};p.identification.rows[0].place.businessStatus='CLOSED_TEMPORARILY';signed(p)
 const req=prepare(p).requests[0];assert(req)
 const out=await ingestPoi(req,createSnapshotStore(seed));assert.equal(out.outcome,'created');assert.equal(out.fields['Operating Status'],'Закрыт временно');assert.equal(out.fields['Copy Status'],'Draft')
 const bad=structuredClone(req);bad.poi.operatingStatus='Работает';await assert.rejects(()=>ingestPoi(bad,createSnapshotStore(seed)),/factTemporaryClosureStatusDrift/)
 const unsigned=structuredClone(p);unsigned.rows[0].dossier.facts.at(-1).status='reported';signed(unsigned);assert.throws(()=>prepare(unsigned),/factsTemporaryClosureAuthority/)
})
const relationPacket=()=>{
 const p=subjectPacket(),r=p.rows[0],parent={...seed[0],nameRu:'Тестовый комплекс',siteCity:'sapporo',lat:43.06001,lon:141.35001}
 r.dossier.facts.push({id:'parent',subject:name,category:'composition',text:'Тестовый комплекс включает самостоятельный музей.',conditions:'',status:'verified',references:[{source:0,blockId:r.evidence[0].blocks[0].id}]})
 r.sourceRelations=[{kind:'parent',target:relationSubject(parent),factIds:['parent'],reason:'Музей и комплекс — разные уровни одного места.'}]
 return {p:signed(p),parent}
}
await test('COMPOSITE_NAME_RETAINS_EVERY_SOURCED_PART',()=>{
 const p=subjectPacket(),r=p.rows[0],{e,source}=supplement(p,'<main><p>札幌資料館</p><p>旧庁舎</p></main>')
 const alias='札幌資料館（旧庁舎）'
 r.dossier.facts.push({id:'compound',subject:name,category:'identity',text:'Поисковое имя «札幌資料館（旧庁舎）」 соединяет название музея и занимаемого им бывшего здания управления.',conditions:'',status:'verified',references:e.blocks.map(b=>({source,blockId:b.id}))})
 r.nameProofs=[{name:alias,field:'nameJa',factId:'compound',parts:e.blocks.map(b=>({text:b.text,source,blockId:b.id}))}]
 p.identification.rows[0].nameJaAlternative=alias;signed(p);assert.equal(prepare(p).requests.length,1)
 const wrongField=structuredClone(p);wrongField.rows[0].nameProofs[0].field='nameEn';assert.throws(()=>prepare(wrongField),/portalDraftAliasEvidence/)
 const malformed=structuredClone(p);malformed.rows[0].nameProofs=null;assert.throws(()=>prepare(malformed),/portalNameProofsShape/)
 for(const [change,pattern] of [[x=>x.rows[0].nameProofs[0].parts[1].text='公園',/portalNameProofEvidence/],[x=>x.rows[0].nameProofs[0].parts.reverse(),/portalNameProofComposition/],[x=>x.rows[0].dossier.facts.at(-1).subject='Другое место',/portalNameProofSubject/],[x=>delete x.rows[0].nameProofs,/portalDraftAliasEvidence/]]){const bad=structuredClone(p);change(bad);signed(bad);assert.throws(()=>prepare(bad),pattern)}
})
await test('SOURCE_PARENT_RELATION_REACHES_SAVED_RECORD',async()=>{
 const {p,parent}=relationPacket(),req=prepare(p).requests[0]
 const without=structuredClone(req);delete without.poi.sourceRelations
 assert.notEqual((await ingestPoi(without,createSnapshotStore([parent]))).outcome,'created')
 const out=await ingestPoi(req,createSnapshotStore([parent]));assert.equal(out.outcome,'created',out.explanation);assert.deepEqual(out.fields['Parent POI'],[parent.recordId])
 const absentEn=await ingestPoi(req,createMemoryPoiStore([{...parent,nameEn:''}]))
 assert.equal(absentEn.outcome,'created','SOURCE_RELATION_EMPTY_EN_IS_SAME_ABSENCE')
 const namedEn={...parent,nameEn:'Different actual name'};await assert.rejects(()=>ingestPoi(req,createSnapshotStore([namedEn])),/sourceRelationTargetDrift/)
 const drift={...parent,nameRu:'Другой комплекс'};await assert.rejects(()=>ingestPoi(req,createSnapshotStore([drift])),/sourceRelationTargetDrift/)
 await assert.rejects(()=>ingestPoi(req,createSnapshotStore([{...seed[0],recordId:'rec00000000000003'}])),/sourceRelationTargetMissing/)
 const same={...parent,placeId:'fixture-new'},bad=structuredClone(req);bad.poi.sourceRelations[0].target=relationSubject(same);await assert.rejects(()=>ingestPoi(bad,createSnapshotStore([same])),/sourceRelationSameGoogleObject/)
 const unknown={...parent,recordId:'rec00000000000002',poiId:'POI-000002',sourceKey:'japan-guide:third',nameRu:'Неизвестный сосед',placeId:'third'}
 assert.notEqual((await ingestPoi(req,createSnapshotStore([parent,unknown]))).outcome,'created','Unrelated neighbour must still block')
})
await test('SOURCE_RELATION_PROOF_FAILS_BEFORE_INTAKE_IO',async()=>{
 const {p}=relationPacket();p.rows[0].sourceRelations[0].factIds=['s0f0'];assert.throws(()=>prepare(p),/sourceRelationFactSubject/)
 const req=prepare(relationPacket().p).requests[0];req.poi.sourceRelations[0].factIds=['s0f0'];let calls=0
 await assert.rejects(()=>ingestPoi(req,{readSchemaTables:async()=>{calls++;throw Error('IO')}}),/sourceRelationFactSubject/);assert.equal(calls,0)
})
await test('MISSING_ENGLISH_TRANSLATION_REACHES_INTAKE',()=>{
 const p=structuredClone(packet),row=p.rows[0]
 p.bundle=buildHokkaidoBundle([ja],[{url:ja.url,outcome:'fetched',detail:''},{url:en.url,outcome:'absent',detail:'404'}])
 row.evidence=row.evidence.slice(0,1);row.dossier.sources=row.dossier.sources.slice(0,1)
 row.dossier.facts=row.dossier.facts.filter(f=>f.references.every(r=>r.source===0))
 row.dossier.coverage=row.dossier.coverage.filter(c=>c.source===0)
 row.copyReview.dossierDigest=dossierDigest(row.dossier)
 p.identification.rows[0].nameEn=null;resign(p.identification)
 assert.equal(prepare(p).requests.length,1)
 p.identification.rows[0].nameEn='Invented translation';resign(p.identification)
 assert.throws(()=>prepare(p),/portalDraftIdentificationName/)
})
await test('CORE_PRESERVES_DOSSIER_AND_DRAFT_ONLY',async()=>{const request=prepare(packet).requests[0],store=createSnapshotStore(seed);const out=await ingestPoi(request,store);assert.equal(out.outcome,'created',out.explanation);assert.equal(out.fields['Copy Status'],'Draft');assert.equal(out.fields['Fact Check Status'],'Todo');assert.equal(readPoiFacts(out.fields.Notes).dossier.sources.length,2);assert.equal(out.fields['Description Draft (RU)'],d.copy.ru[0].text);for(const key of ['Description (RU)','Description (EN)','Approved'])assert(!Object.hasOwn(out.fields,key));assert.equal((await ingestPoi(request,store)).nextAction,'compareFacts')})
for(const [name,change,pattern] of [
 ['REJECT_FOREIGN_ADAPTER',p=>p.portal='other',/portalDraftAdapterUnsupported/],
 ['REJECT_DUPLICATE_INPUT',p=>p.rows.push(p.rows[0]),/portalDraftDuplicate/],
 ['REJECT_MISSING_ROW',p=>p.rows=[],/portalDraftBatchSize/],
 ['REJECT_CHANGED_SOURCE',p=>p.bundle.rows[0].cards[0].name='Fake',/hokkaidoBundleProjectionDrift/],
 ['REJECT_UNREVIEWED_COPY',p=>p.rows[0].dossier.copy.ru[0].text='Другой текст.',/copyReviewDossierDrift/],
 ['REJECT_LOST_SOURCE',p=>{const d=p.rows[0].dossier;d.sources.pop();d.facts=d.facts.filter(f=>f.references.every(r=>r.source===0));d.coverage=d.coverage.filter(c=>c.source===0)},/dossierEvidenceCount/],
 ['REJECT_IDENTITY_DRIFT',p=>{p.identification.rows[0].nameJa='Wrong';resign(p.identification)},/portalDraftIdentificationName/],
 ['REJECT_UNSOURCED_ALIAS',p=>{p.identification.rows[0].nameJaAlternative='Unrelated';resign(p.identification)},/portalDraftAliasEvidence/],
 ['REJECT_PRIMARY_EVIDENCE_DRIFT',p=>p.rows[0].evidence[0].blocks[0].text='Fake',/portalDraftPrimaryEvidenceDrift/],
 ['REJECT_ADDRESS_DRIFT',p=>{p.identification.rows[0].address='Wrong';resign(p.identification)},/portalDraftIdentificationAddress/],
 ['REJECT_FOREIGN_IDENTIFICATION',p=>{p.identification.portal='japan-guide';resign(p.identification)},/portalDraftIdentificationPortal/],
 ['REJECT_CLASSIFICATION_NAME_DRIFT',p=>p.rows[0].proposal.nameRu='Другое имя',/portalDraftNameDrift/],
])await test(name,()=>{const p=structuredClone(packet);change(p);assert.throws(()=>prepare(p),pattern)})
await test('PROVIDER_FAILURE_IS_NOT_WRITABLE',()=>{const p=structuredClone(packet);p.identification.rows[0].outcome='providerError';p.identification.rows[0].place=null;resign(p.identification);const r=prepare(p);assert.equal(r.requests.length,0);assert.equal(r.rows[0].outcome,'identificationPending')})
await test('EXPIRED_COORDINATES_ARE_NOT_WRITABLE',()=>{const r=preparePortalDraftBatch(packet,seed,'2027-01-01');assert.equal(r.requests.length,0);assert.equal(r.rows[0].reason,'coordinatesExpired')})
await test('DO_NOT_MIX_INPUT_FAMILIES',()=>assert.throws(()=>parseIntakeArgs(['node','cli','--portal-batch','p','--facts','f','--base-file','b']),/cannot mix/))
const temp=await mkdtemp(path.join(os.tmpdir(),'poi-portal-execution-'))
try{
 const file=path.join(temp,'packet.json'),base=path.join(temp,'base.json')
 await writeFile(file,JSON.stringify(packet));await writeFile(base,JSON.stringify(seed.map(r=>({recordId:r.recordId,fields:{'POI ID':r.poiId,'POI Name (RU)':r.nameRu,'Site City':r.siteCity,'Latitude':r.lat,'Longitude':r.lon,'Source Key':r.sourceKey,'Google Place ID':r.placeId}}))))
 await test('EXISTING_EXECUTOR_OFFLINE_REHEARSAL',async()=>{const r=await runIntakeCli(['node','cli','--portal-batch',file,'--base-file',base,'--run-id','fixture-portal'],{repoRoot:temp,now,codeIdentity:{commit:'a'.repeat(40),dirty:false}});assert.equal(r.exitCode,0,r.report.failure);assert.equal(r.report.prepared,1);assert.equal(r.report.effects.post,0);const reference=JSON.parse(await readFile(path.join(r.runDir,'reference.json')));assert.equal(reference.manifest.portals[0].portalId,'visit-hokkaido');assert.equal(reference.manifest.portals[0].adapter.version,PORTAL_DRAFT_BATCH_SPEC)})
 const service={rows:seed.map(r=>({id:r.recordId,fields:{'POI ID':r.poiId,'POI Name (RU)':r.nameRu,'Site City':r.siteCity,Latitude:r.lat,Longitude:r.lon,'Source Key':r.sourceKey,'Google Place ID':r.placeId}})),post:0,get:0};
 const response=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})
 const transport=async(url,init={})=>{
   const u=new URL(url),method=init.method??'GET';
   if(method==='POST'){service.post++;const fields=JSON.parse(init.body).records[0].fields;service.rows.push({id:'rec00000000000099',fields});return response({records:[service.rows.at(-1)]})}
   assert.equal(method,'GET');service.get++;
   if(u.pathname.includes('/meta/'))return response({tables:[{id:POI_TABLE_ID,name:'POI',fields:expectedTaxonomyFieldSchema().map(f=>({name:f.name,type:f.type,...(f.choices?{options:{choices:f.choices.map(name=>({name}))}}:{})}))}]});
   const filter=u.searchParams.get('filterByFormula');let rows=service.rows;
   if(filter){const m=filter.match(/^\{(.+)\}='(.*)'$/);assert(m);rows=rows.filter(r=>r.fields[m[1]]===m[2])}
   return response({records:rows})
 }
 const live=id=>runIntakeCli(['node','cli','--portal-batch',file,'--write','--run-id',id],{repoRoot:temp,now,env:{AIRTABLE_TOKEN:'fixture'},fetchImpl:transport,codeIdentity:{commit:'a'.repeat(40),dirty:false}})
 await test('REAL_EXECUTOR_POST_AND_INDEPENDENT_READBACK',async()=>{const r=await live('portal-write');assert.equal(r.exitCode,0,r.report.failure);assert.equal(service.post,1);assert.equal(r.report.outcomes[0].state,'verified');const approval=JSON.parse(await readFile(path.join(r.runDir,'approval.json')));assert.equal(approval.portal,'visit-hokkaido');assert.deepEqual(approval.sourceKeys,[key]);assert.equal(service.rows.at(-1).fields['Source Key'],key)})
 await test('REAL_EXECUTOR_REPEAT_DOES_NOT_POST',async()=>{const r=await live('portal-repeat');assert.equal(r.exitCode,0,r.report.failure);assert.equal(r.report.prepared,0);assert.equal(service.post,1)})
 await test('REAL_STORE_PARENT_ABSENT_EN_MATCHES_SNAPSHOT',async()=>{
  const {p,parent}=relationPacket(),savedRows=service.rows
  p.rows[0].sourceKey=key+'-annex';p.rows[0].dossier.sourceKey=key+'-annex';p.identification.rows[0].sourceKey=key+'-annex';signed(p)
  service.rows=[{id:parent.recordId,fields:{'POI ID':parent.poiId,'POI Name (RU)':parent.nameRu,'Site City':parent.siteCity,Latitude:parent.lat,Longitude:parent.lon,'Google Place ID':parent.placeId,'Source Key':parent.sourceKey}}]
  await writeFile(file,JSON.stringify(p))
  try{const result=await live('portal-parent-absent-en');assert.equal(result.exitCode,0,result.report.failure);assert.equal(result.report.counts.created,1);assert.deepEqual(service.rows.at(-1).fields['Parent POI'],[parent.recordId])}finally{service.rows=savedRows;await writeFile(file,JSON.stringify(packet))}
 })
 await test('WHOLE_PACKET_BEFORE_LIVE_IO',async()=>{const bad=structuredClone(packet);bad.rows[0].dossier.copy.en[0].text='Tampered';await writeFile(file,JSON.stringify(bad));let calls=0;await assert.rejects(()=>runIntakeCli(['node','cli','--portal-batch',file,'--live-read','--run-id','bad'],{repoRoot:temp,now,env:{AIRTABLE_TOKEN:'fixture'},fetchImpl:()=>{calls++;throw Error('no')}}),/copyReviewDossierDrift/);assert.equal(calls,0)})
}finally{await rm(temp,{recursive:true,force:true})}
for(const [municipality,city] of [['紋別市','monbetsu'],['北竜町','hokuryu'],['室蘭市','muroran'],['苫小牧市','tomakomai'],['壮瞥町','sobetsu'],['新ひだか町','shinhidaka']])await test('HOKKAIDO_CITY_'+city,()=>{assert.equal(resolveSiteCity({address:'北海道'+municipality}).siteCity,city);assert.equal(prefectureJaForSiteCity(city),'北海道');assert(KNOWN_CITIES.has(city))})
await test('NO_NETWORK',()=>assert.equal(network,0));globalThis.fetch=originalFetch
console.log(`${checks} checks passed`)
