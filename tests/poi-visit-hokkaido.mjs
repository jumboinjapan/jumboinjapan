import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {detail,index,page,origin,date} from './fixtures/visit-hokkaido.mjs'
import {hokkaidoUrl,hokkaidoPairUrls,parseHokkaidoDetail,parseHokkaidoIndex,buildHokkaidoBundle,assertHokkaidoBundle,buildHokkaidoIntake,hokkaidoExpectedInput,hokkaidoResearchRows} from '../scripts/poi-portals/lib/visit-hokkaido.mjs'
import {openHokkaidoReader,readHokkaidoPlaces,discoverHokkaido,collectHokkaidoDiscovery} from '../scripts/poi-portals/lib/visit-hokkaido-reader.mjs'
import {runHokkaidoCli} from '../scripts/poi-portals/read-visit-hokkaido.mjs'
import {evaluatePortalIntakeBatch,assertDiscoveryBoundary} from '../scripts/poi-portals/collect-pois.mjs'
import {getPortal} from '../scripts/poi-portals/registry.mjs'
import {assertPoiFacts,readPoiFacts} from '../src/lib/poi-facts.ts'
import {assertDossierEvidence,dossierDigest} from '../scripts/poi-portals/lib/japan-guide-facts.mjs'
import {EDITORIAL_POLICY,getEditorialPolicyDigest} from '../scripts/poi-portals/lib/poi-copywriter.mjs'
import {ingestPoi} from '../src/lib/poi-ingest.ts'
import {createMemoryPoiStore} from '../src/lib/poi-memory-store.ts'
import {classifyModelResponse} from '../scripts/poi-portals/lib/classification-contract.mjs'

let checks=0
const originalFetch=globalThis.fetch
let unexpectedNetwork=0
globalThis.fetch=()=>{unexpectedNetwork++;throw new Error('unexpected live network in fixture test')}
function check(name,fn){try{fn();checks++;console.log(`✓ ${name}`)}catch(e){throw new Error(`${name}: ${e.message}`,{cause:e})}}
async function test(name,fn){try{await fn();checks++;console.log(`✓ ${name}`)}catch(e){throw new Error(`${name}: ${e.message}`,{cause:e})}}
const ja=detail(),en=detail('en'),pages=[ja,en],attempts=pages.map(p=>({url:p.url,outcome:'fetched',detail:''}))
const bundle=buildHokkaidoBundle(pages,attempts),card=bundle.rows[0].cards[0],batch=buildHokkaidoIntake(bundle),candidate=batch.records[0]
check('LANGUAGES_ONE_ID',()=>{assert.equal(hokkaidoUrl(ja.url).sourceKey,hokkaidoUrl(en.url).sourceKey);assert.deepEqual(hokkaidoPairUrls(en.url),[ja.url,en.url]);assert.equal(bundle.rows.length,1)})
check('PAGE_TITLE_NOT_SITE_HEADER',()=>assert.equal(card.evidence.title,'札幌資料館'))
check('BR_CONDITIONS_PRESERVED',()=>assert(card.fields.find(f=>f.kind==='closed').values[0].includes('\n祝日の場合は翌日。入口は天候により閉鎖。')))
check('REMARKS_CHILD_PROGRAMME',()=>assert(card.fields.find(f=>f.kind==='remarks').values[0].includes('子供向けプログラム')))
check('UNKNOWN_FIELD_RETAINED',()=>assert(card.fields.some(f=>f.kind==='other'&&f.values[0].includes('unknown field'))))
check('EVERY_FIELD_BOUND_TO_BLOCK',()=>{for(const f of card.fields)for(const id of f.blockIds)assert(card.evidence.blocks.some(b=>b.id===id))})
check('ADDRESS_REACHES_COMMON_INTAKE',()=>{assert.equal(candidate.observed.cityJa,'札幌市');assert.equal(candidate.observed.prefectureJa,'北海道');assert.equal(candidate.observed.address,'北海道札幌市中央区北一条');assert.equal(candidate.observed.nameKana,'しりょうかん')})
check('DECLARED_DESTINATION_REACHES_SEARCH',()=>{assert.equal(candidate.observed.lat,43.06);assert.equal(candidate.observed.lon,141.35);assert(candidate.hints.some(h=>h.field==='map_destination'));assert.equal(card.mapDestinations[0].meaning,'publisherDestinationUnverified')})
check('MAP_CREDENTIAL_REMOVED',()=>assert(!JSON.stringify(card).includes('TEST_PUBLIC_EMBED_KEY')))
check('RELATED_NOT_CHILDREN',()=>{assert.deepEqual(card.related.map(l=>l.kind),['nearby','itinerary','article']);assert(card.related.every(l=>l.relationship==='notEstablished'));assert(!JSON.stringify(card.evidence).includes('Nearby park'))})
check('SCRIPTS_NOT_EVIDENCE',()=>assert(!JSON.stringify(card.evidence).includes('Do not execute')))
check('EN_UNIQUE_FACT_RETAINED',()=>assert(JSON.stringify(bundle.rows[0].cards[1].evidence).includes('advance booking')))
const research=hokkaidoResearchRows(bundle)[0]
check('NO_AUTOMATIC_RESTAURANT_HOURS',()=>{assert.equal(research.dossier.visit.hours,'');assert.equal(research.dossier.visit.hoursKind,'unknown');assert(research.practicalFields[0].fields.find(f=>f.kind==='hours').scope==='requiresSubjectAssessment');assert(candidate.hints.some(h=>h.field==='hours'&&h.value.includes('レストラン')))})
check('UNREVIEWED_NOT_WRITABLE',()=>{assert.throws(()=>assertPoiFacts(research.dossier),/facts required/);assert.equal(research.dossier.copy.ru.length,0);assert.equal(research.publisherIndependentSources,1);assert.equal(research.dossier.coverage.length,research.evidence.reduce((n,e)=>n+e.blocks.length,0))})
check('PRODUCTION_EVALUATOR',()=>{const r=evaluatePortalIntakeBatch(getPortal('visit-hokkaido'),batch,hokkaidoExpectedInput(bundle));assert.equal(r.candidates.length,1);assert.equal(r.evaluated[0].candidate.address,candidate.observed.address)})
check('REBUILD_STABLE',()=>assert.deepEqual(assertHokkaidoBundle(bundle),buildHokkaidoBundle(pages,attempts)))
for(const bad of ['https://evil.example/spot/detail_90001.html',ja.url+'?x=1',ja.url+'#x',ja.url.replace('/spot/','/spot/../spot/'),ja.url.replace('90001','%39'+'0001'),ja.url.replace('90001','090001'),new URL(ja.url),ja.url.replace('/spot/','/plan/')])check('STRICT_URL_'+String(bad),()=>assert.throws(()=>hokkaidoUrl(bad)))
for(const [name,change,pattern] of [
  ['CANONICAL_SWAP',s=>s.replace('rel="canonical" href="'+ja.url,'rel="canonical" href="'+en.url),/hokkaidoCanonicalMismatch/],
  ['LANGUAGE_SWAP',s=>s.replace('lang="ja"','lang="en"'),/hokkaidoLanguageMismatch/],
  ['SOFT_404',()=>'<html lang="ja"><h1>Not found</h1></html>',/hokkaidoCanonicalRequired/],
  ['MISSING_LAYOUT',s=>s.replace('id="detail"','id="changed"'),/hokkaidoDetailLayout/],
  ['DUPLICATE_TITLE',s=>s.replace('</h2>','</h2><h2>Other place</h2>'),/hokkaidoDetailTitle/],
])check(name,()=>assert.throws(()=>parseHokkaidoDetail(page(ja.url,change(ja.html))),pattern))
check('RAW_BYTES_DRIFT',()=>assert.throws(()=>parseHokkaidoDetail({...ja,html:ja.html+' '}),/hokkaidoRawDigest/))
check('SIGNED_PROJECTION_NOT_AUTHORITY',()=>{const b=structuredClone(bundle);b.rows[0].cards[0].name='Different place';assert.throws(()=>buildHokkaidoIntake(b),/hokkaidoBundleProjectionDrift/)})
check('GETTER_REJECTED_BEFORE_READ',()=>{let reads=0;const b={...bundle};Object.defineProperty(b,'rows',{enumerable:true,get(){reads++;return []}});assert.throws(()=>assertHokkaidoBundle(b));assert.equal(reads,0)})
check('MISSING_LANGUAGE_ATTEMPT',()=>assert.throws(()=>buildHokkaidoBundle([ja],[attempts[0]]),/hokkaidoBothLocalesAttempted/))
check('ATTEMPT_MUST_BE_CANONICAL',()=>assert.throws(()=>buildHokkaidoBundle([],[{url:'/spot/detail_90001.html',outcome:'absent',detail:''},{url:ja.url,outcome:'absent',detail:''}]),/hokkaidoAttemptIdentity/))
check('ABSENT_LANGUAGE_ALLOWED',()=>{const b=buildHokkaidoBundle([en],[{...attempts[0],outcome:'absent'},attempts[1]]);assert.equal(buildHokkaidoIntake(b).records[0].observed.nameEn,'Test museum');assert.equal(b.counts.collected,1)})
check('FAILED_LANGUAGE_REFUSES_CANDIDATE',()=>{const b=buildHokkaidoBundle([ja],[attempts[0],{...attempts[1],outcome:'unavailable'}]);assert.equal(buildHokkaidoIntake(b).records[0].kind,'refused');assert.equal(b.counts.incomplete,1)})
check('BOTH_ABSENT_ACCOUNTED',()=>assert.equal(buildHokkaidoBundle([],attempts.map(a=>({...a,outcome:'absent'}))).counts.absent,1))
check('COORDINATE_CONFLICT',()=>{const other=detail('en','90001','', '43.20,141.80');const c=buildHokkaidoIntake(buildHokkaidoBundle([ja,other],attempts)).records[0];assert.equal(c.observed.lat,null);assert.equal(c.observed.lon,null);assert(c.hints.some(h=>h.field==='coordinate_conflict'))})
check('VIEWPORT_NOT_DESTINATION',()=>{const p=page(ja.url,ja.html.replace('embed/v1/place?key=TEST_PUBLIC_EMBED_KEY&q=43.06,141.35','embed/v1/view?center=43.06,141.35').replace('/maps/dir//43.06,141.35/','/maps/@43.06,141.35,12z'));assert.equal(parseHokkaidoDetail(p).mapDestinations.length,0)})
check('INDEX_EXCLUDES_FEATURED',()=>{const i=parseHokkaidoIndex(index('ja',1,{next:2,total:4}));assert.equal(i.records.length,2);assert.equal(i.next,origin+'/spot/index_2_2______.html')})
check('INDEX_NEXT_CYCLE',()=>{const p=index('ja',1,{next:1});assert.throws(()=>parseHokkaidoIndex(p),/hokkaidoIndexNextSequence/)})
check('INDEX_DUPLICATE_KEY',()=>assert.throws(()=>parseHokkaidoIndex(index('ja',1,{ids:['90001','90001']})),/hokkaidoIndexDuplicate/))
const collectArgs={monitor:null,limit:null,names:null,existing:null,providerProfileRef:null}
check('COLLECTOR_WRITE_REJECTED_BEFORE_NETWORK',()=>assert.throws(()=>assertDiscoveryBoundary({args:{...collectArgs,write:true},portals:[getPortal('visit-hokkaido')]}),/несовместимо/))
check('MONITOR_NOT_JG_FORMAT',()=>assert.throws(()=>assertDiscoveryBoundary({args:{...collectArgs,monitor:'old.json'},portals:[getPortal('visit-hokkaido')]}),/hokkaidoMonitorUnsupported/))
check('LIMIT_NOT_SILENTLY_REINTERPRETED',()=>assert.throws(()=>assertDiscoveryBoundary({args:{...collectArgs,limit:50},portals:[getPortal('visit-hokkaido')]}),/hokkaidoUsePageLimit/))

const noWait=async()=>{},clock=()=>new Date(date)
function transport(overrides={}){
  const calls=[]
  const fetchImpl=async(url,init)=>{
    calls.push(url);assert.equal(init.method,'GET');assert.equal(init.redirect,'manual')
    if(overrides[url])return overrides[url](url,init)
    if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nDisallow:',{headers:{'content-type':'text/plain'}})
    const u=hokkaidoUrl(url),p=u.kind==='detail'?detail(u.locale,u.id):index(u.locale,u.page)
    return new Response(p.html,{headers:{'content-type':'text/html; charset=UTF-8'}})
  }
  return {calls,fetchImpl,sleep:noWait,now:clock}
}
await test('READER_GET_ONLY_TWO_LOCALES',async()=>{const t=transport(),r=await readHokkaidoPlaces([en.url],t);assert.equal(r.bundle.counts.collected,1);assert.equal(t.calls.length,3);assert.equal(r.network.budget.spent.pageFetch,2)})
await test('BAD_SELECTION_NO_NETWORK',async()=>{const t=transport();await assert.rejects(()=>readHokkaidoPlaces([ja.url,'https://evil.example/spot/detail_3.html'],t));assert.equal(t.calls.length,0)})
await test('DUPLICATE_SELECTION_NO_NETWORK',async()=>{const t=transport();await assert.rejects(()=>readHokkaidoPlaces([ja.url,en.url],t),/hokkaidoSelectionDuplicate/);assert.equal(t.calls.length,0)})
for(const [name,response,outcome,count] of [
  ['ROBOTS_HTML',()=>new Response('<html>OK</html>',{headers:{'content-type':'text/html'}}),'policyUnknown',1],
  ['ROBOTS_DENIED',()=>new Response('User-agent: *\nDisallow: /spot/',{headers:{'content-type':'text/plain'}}),'policyDenied',2],
  ['ROBOTS_REDIRECT',()=>new Response('',{status:302,headers:{location:'/private'}}),'policyUnknown',1],
])await test(name,async()=>{const t=transport({[origin+'/robots.txt']:response}),r=await readHokkaidoPlaces([ja.url],t);assert.equal(r.bundle.attempts[0].outcome,outcome);assert.equal(t.calls.length,count)})
for(const [name,response,outcome] of [
  ['DETAIL_REDIRECT',()=>new Response('',{status:302,headers:{location:'/private'}}),'unavailable'],
  ['DETAIL_ABSENT',()=>new Response('',{status:404}),'absent'],
  ['DETAIL_500',()=>new Response('',{status:500}),'unavailable'],
  ['DETAIL_BAD_UTF8',()=>new Response(new Uint8Array([0xff]),{headers:{'content-type':'text/html'}}),'invalidPage'],
  ['DETAIL_SOFT404',()=>new Response('<html>not found</html>',{headers:{'content-type':'text/html'}}),'invalidPage'],
  ['DETAIL_BAD_TYPE',()=>new Response('{}',{headers:{'content-type':'application/json'}}),'invalidPage'],
  ['DETAIL_OVERSIZED',()=>new Response('a'.repeat(2*1024*1024+1),{headers:{'content-type':'text/html'}}),'unavailable'],
])await test(name,async()=>{const t=transport({[en.url]:response}),r=await readHokkaidoPlaces([ja.url],t);assert.equal(r.bundle.attempts[1].outcome,outcome);assert.equal(t.calls.length,3)})
await test('BUG_NOT_NETWORK_SILENCE',async()=>{const t=transport({[ja.url]:()=>{throw new TypeError('programming defect')}});await assert.rejects(()=>readHokkaidoPlaces([ja.url],t),/programming defect/)})
await test('BUDGET_BEFORE_DISPATCH',async()=>{const t=transport(),r=await readHokkaidoPlaces([ja.url],{...t,maxPages:1});assert.equal(t.calls.length,2);assert.equal(r.bundle.attempts[1].outcome,'budgetNotSpent');assert.equal(r.bundle.counts.incomplete,1)})
await test('PUBLIC_READER_REJECTS_FOREIGN_URL',async()=>{const t=transport(),r=openHokkaidoReader(t);await assert.rejects(()=>r.read('https://evil.example/'));assert.equal(t.calls.length,0)})
await test('CATALOGUE_UNION',async()=>{const t=transport({[origin+'/en/spot/index.html']:()=>new Response(index('en',1,{ids:['90002','90003']}).html,{headers:{'content-type':'text/html'}})});const r=await discoverHokkaido(t);assert.equal(r.complete,true);assert.equal(r.records.length,3);assert.equal(r.records.filter(r=>r.ja&&r.en).length,1)})
await test('CATALOGUE_LIMIT_NOT_COMPLETE',async()=>{const t=transport({[origin+'/spot/index.html']:()=>new Response(index('ja',1,{next:2,total:4}).html,{headers:{'content-type':'text/html'}})});const r=await discoverHokkaido({...t,maxPagesPerLocale:1});assert.equal(r.complete,false);assert.equal(r.locales[0].failures[0].outcome,'pageLimit')})
await test('CATALOGUE_COUNT_MISMATCH',async()=>{const t=transport({[origin+'/spot/index.html']:()=>new Response(index('ja',1,{total:3}).html,{headers:{'content-type':'text/html'}})});const r=await discoverHokkaido(t);assert.equal(r.complete,false);assert.equal(r.locales[0].failures[0].outcome,'countMismatch')})
await test('CATALOGUE_TWO_PAGES',async()=>{
  const overrides={}
  for(const locale of ['ja','en'])for(const number of [1,2]){
    const p=index(locale,number,{ids:number===1?['90001','90002']:['90003','90004'],total:4,next:number===1?2:null})
    overrides[p.url]=()=>new Response(p.html,{headers:{'content-type':'text/html'}})
  }
  const t=transport(overrides),r=await discoverHokkaido(t)
  assert.equal(r.complete,true);assert.equal(r.records.length,4);assert.equal(t.calls.length,5)
})
await test('COLLECTOR_ADAPTER_DISCOVERY_ONLY',async()=>{const r=await collectHokkaidoDiscovery(getPortal('visit-hokkaido'),transport());assert.equal(r.discovery.records.length,2);assert(!Object.hasOwn(r,'candidates'))})

// Real Intake consumer with synthetic researcher/editor work. These labels are
// fixtures, not an assertion that live source prose has received editorial review.
const d=structuredClone(research.dossier)
d.facts=research.evidence.flatMap((e,source)=>e.blocks.map((b,i)=>({id:`s${source}f${i}`,subject:'Тестовый музей',category:i===0?'identity':'visiting',text:i===0?'Музей истории города.':'Сведения для посещения тестового музея.',conditions:'',status:'reported',references:[{source,blockId:b.id}]})))
d.coverage=d.coverage.map(c=>({...c,disposition:'facts',reason:''}))
d.copy={ru:[{text:'Музей знакомит с историей города.',factIds:['s0f0']}],en:[{text:'The museum introduces the history of the town.',factIds:['s0f0']}]}
assertDossierEvidence(d,research.evidence,{allowPortal:true})
const review={spec:'poi-copy-review/v1',dossierDigest:dossierDigest(d),policyDigest:getEditorialPolicyDigest(),author:'fixture-author',reviewer:'fixture-editor',checkedAt:new Date().toISOString(),checks:Object.fromEntries(EDITORIAL_POLICY.reviewDimensions.map(k=>[k,true])),issues:[]}
const classification=classifyModelResponse({entityKind:'tourist_poi',poiPrimaryType:'museum',facets:[],confidence:0.99,reasons:['Музей истории.'],nameRu:'Тестовый музей'},{sourceKey:candidate.sourceKey}).classification
const request={source:{kind:'portal-collector',id:'visit-hokkaido',externalKey:'spot-90001',url:candidate.sourceUrl},poi:{nameRu:'Тестовый музей',siteCity:'sapporo',sourceName:candidate.observed.nameJa,lat:candidate.observed.lat,lon:candidate.observed.lon,resolved:{lat:43.06,lon:141.35,placeId:'fixture-museum'},taxonomy:classification,descriptionRu:d.copy.ru[0].text,descriptionEn:d.copy.en[0].text,factDossier:d,factEvidence:research.evidence,factCopyReview:review,factSubjectAssessment:{role:'place',nameRu:'Тестовый музей',poiPrimaryType:'museum',factIds:['s0f0'],reason:'Музей — самостоятельное место.'}}}
const events=[],store=createMemoryPoiStore([],{observe:e=>events.push(e)})
await test('CORE_CREATE_STORED_FIELDS',async()=>{const r=await ingestPoi(request,store);assert.equal(r.outcome,'created',r.explanation);const f=events.find(e=>e.kind==='create').fields;assert.equal(f['Copy Status'],'Draft');assert.equal(f['Fact Check Status'],'Todo');assert.equal(f['POI Type'],'museum');assert.equal(readPoiFacts(f.Notes).dossier.sources.length,2);assert.equal(f['Description Draft (RU)'],d.copy.ru[0].text);assert(!Object.hasOwn(f,'Description (RU)'));assert.equal(f['Working Hours'],null)})
await test('EXISTING_GOES_TO_FACT_COMPARISON',async()=>{const r=await ingestPoi(request,store);assert.equal(r.outcome,'already_ingested');assert.equal(r.nextAction,'compareFacts');assert.equal(events.filter(e=>e.kind==='create').length,1)})
await test('CORE_REFUSES_UNREVIEWED_BLOCK',async()=>{const r=structuredClone(request);r.poi.factDossier.coverage[0].disposition='unresolved';r.poi.factDossier.coverage[0].reason='Pending';const before=events.length;await assert.rejects(()=>ingestPoi(r,store));assert.equal(events.length,before)})

const dir=await mkdtemp(path.join(os.tmpdir(),'hokkaido-test-'))
try{
  await test('CLI_REAL_DISCOVERY_ARTIFACT',async()=>{const t=transport(),out=path.join(dir,'catalogue');const r=await runHokkaidoCli(['discover',out,'1'],t);assert.equal(r.records,2);const saved=JSON.parse(await readFile(path.join(out,'discovery.json'),'utf8'));assert.equal(saved.complete,true)})
  await test('CLI_EXISTING_OUTPUT_BEFORE_NETWORK',async()=>{const out=path.join(dir,'existing');await mkdir(out);const t=transport();await assert.rejects(()=>runHokkaidoCli(['discover',out,'1'],t),/EEXIST/);assert.equal(t.calls.length,0)})
  await test('CLI_READ_REPLAY_SAME_BUNDLE',async()=>{
    const selection=path.join(dir,'selection.json');await writeFile(selection,JSON.stringify([ja.url]))
    const out=path.join(dir,'read'),t=transport(),reviewEvents=[];await runHokkaidoCli(['read',selection,out],{...t,reviewStore:{append:async e=>{reviewEvents.push(e);return e}}})
    assert.equal(reviewEvents.length,2,'SELECTED_PLACE_AND_READING_RESULT_VISIBLE')
    const replay=path.join(dir,'replay'),replayTransport=transport()
    await runHokkaidoCli(['replay',path.join(out,'bundle.json'),replay],replayTransport)
    assert.equal(replayTransport.calls.length,0)
    assert.equal(await readFile(path.join(out,'intake.json'),'utf8'),await readFile(path.join(replay,'intake.json'),'utf8'))
    const run=JSON.parse(await readFile(path.join(out,'run.json'),'utf8'));assert.equal(run.readyForWrite,false);assert.equal(run.effects.poiWrites,0);assert.equal(run.effects.airtableReviewEvents,2)
  })
  await test('CLI_QUEUE_FAILURE_PREVENTS_SOURCE_REQUESTS',async()=>{
    const selection=path.join(dir,'queue-failure-selection.json');await writeFile(selection,JSON.stringify([ja.url]))
    const out=path.join(dir,'queue-failure'),t=transport()
    await assert.rejects(runHokkaidoCli(['read',selection,out],{...t,reviewStore:{append:async()=>{throw Error('review unavailable')}}}),/review unavailable/)
    assert.equal(t.calls.length,0)
    const pending=JSON.parse(await readFile(path.join(out,'review-selection.json'),'utf8'));assert.equal(pending.items.length,1)
  })
  await test('CLI_PARTIAL_PAGE_FAILURE_REMAINS_IN_REVIEW',async()=>{
    const selection=path.join(dir,'partial-selection.json');await writeFile(selection,JSON.stringify([ja.url]))
    const out=path.join(dir,'partial'),events=[],t=transport({[en.url]:()=>new Response('',{status:503})})
    await runHokkaidoCli(['read',selection,out],{...t,reviewStore:{append:async e=>{events.push(e);return e}}})
    assert.equal(events.length,2);assert.equal(events[1].item.initialStatus,'needs_fix');assert.match(events[1].item.problem,/unavailable/)
    assert.equal(JSON.parse(await readFile(path.join(out,'review-result.json'),'utf8')).items.length,1)
  })
}finally{await rm(dir,{recursive:true,force:true})}
check('NO_LIVE_NETWORK',()=>assert.equal(unexpectedNetwork,0))
globalThis.fetch=originalFetch
console.log(`Visit Hokkaido: ${checks}/${checks} checks passed`)
