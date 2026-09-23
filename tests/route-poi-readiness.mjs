import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'
import * as rules from '../src/lib/route-poi-readiness.ts'

const ready = { poiId:'POI-000001',nameRu:'Храм',approvedRu:'Описание храма',descriptionRu:'' }
const ref = (poiId='POI-000001',key='stop') => ({key,poiId})
assert.deepEqual(rules.routePoiIssues([ref()],[ready]),[])
for(const [refs,pois,code] of [
  [[ref('')],[ready],'missing_poi'], [[ref(15)],[ready],'missing_poi'],
  [[ref("POI-000001' OR 1")],[ready],'invalid_poi_id'], [[ref()],[],'unknown_poi'],
  [[ref()],[ready,ready],'duplicate_poi_id'], [[ref()],[{...ready,nameRu:' '}],'empty_name'],
  [[ref()],[{...ready,approvedRu:' ',draftRu:'Черновик'}],'empty_description'],
]) assert.equal(rules.routePoiIssues(refs,pois)[0].code,code)
assert.deepEqual(rules.routePoiIssues([ref()],[{...ready,approvedRu:'',descriptionRu:'Legacy'}]),[])
assert.deepEqual(rules.routePoiIssues([ref()],[{...ready,approvedRu:'',isSystem:true}]),[])
assert.equal(rules.routePoiIssues([ref()],[{...ready,isSystem:true,nameRu:''}])[0].code,'empty_name')
assert.deepEqual(rules.routePoiIssues([ref(),ref('POI-000001','return')],[ready]),[], 'revisit allowed')

function load(file, imports, globals={}, transform=s=>s){
 const src=transform(readFileSync(new URL(file,import.meta.url),'utf8'))
 const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const exports={};vm.runInNewContext(js,{exports,URL,console,process:{env:{AIRTABLE_TOKEN:'fixture',AIRTABLE_BASE_ID:'base'}},...globals,require:id=>{assert.ok(id in imports,`Unexpected import ${id}`);return imports[id]}});return exports
}
let net=[], invalidId='', readFailure=false, duplicate=false
const response = (obj,ok=true) => ({ok,status:ok?200:503,json:async()=>obj,text:async()=>JSON.stringify(obj)})
const liveRead = async(url,opts)=>{
 net.push({url,method:opts?.method||'GET'})
 if(readFailure)return response({},false)
 const requested=Array.from(new URL(url).searchParams.get('filterByFormula').matchAll(/POI-\d{6}/g),m=>m[0])
 const records=requested.filter(id=>id!==invalidId).map(id=>({id:'rec'+id,fields:{'POI ID':id,'POI Name (RU)':'Храм','Description Approved (RU)':'Текст'}}))
 if(duplicate)records.push(records[0])
 return response({records})
}
const gate=load('../src/lib/route-poi-preflight.ts',{'./airtable-schema':{POI_TABLE_ID:'pois'},'./airtable-retry':{fetchAirtableWithRetry:liveRead},'./route-poi-readiness':rules})
await assert.rejects(gate.preflightRoutePois([ref('')]),rules.RoutePoiReadinessError);assert.equal(net.length,0)
await gate.preflightRoutePois([ref()]);assert.equal(net.length,1)
readFailure=true;await assert.rejects(gate.preflightRoutePois([ref()]),/read failed/);readFailure=false
invalidId='POI-000001';await assert.rejects(gate.preflightRoutePois([ref()]),rules.RoutePoiReadinessError);invalidId=''
duplicate=true;await assert.rejects(gate.preflightRoutePois([ref()]),rules.RoutePoiReadinessError);duplicate=false
net=[];await gate.preflightRoutePois(Array.from({length:51},(_,n)=>ref(`POI-${String(n+1).padStart(6,'0')}`)));assert.equal(net.length,2)

let store=new Map(),writes=[]
const apiFetch=async(url,opts={})=>{
 if(opts.method==='POST'||opts.method==='PATCH'){writes.push(JSON.parse(opts.body));return response({id:'recCreated',fields:JSON.parse(opts.body).fields,records:JSON.parse(opts.body).records||[]})}
 const ids=Array.from(new URL(url).searchParams.get('filterByFormula').matchAll(/rec[A-Za-z0-9]+/g),m=>m[0])
 return response({records:ids.flatMap(id=>store.has(id)?[{id,fields:store.get(id)}]:[])})
}
const apiImports={
 '@/lib/route-poi-preflight':gate,'next/cache':{revalidateTag(){}},'next/server':{NextResponse:{json:(data,opts)=>({data,status:opts?.status||200})}},
 '@/lib/airtable':{getPoisByIds:async()=>[]},'@/lib/airtable-schema':{ROUTE_STOPS_TABLE_ID:'stops'},'@/lib/admin-guard':{requireAdminSession:async()=>null},
}
const route=load('../src/app/api/admin/route-stops/stops/route.ts',apiImports,{fetch:apiFetch})
const request=body=>({json:async()=>body})
for(const id of ['', 'POI-999999']){
 invalidId='POI-999999';writes=[];const result=await route.POST(request({routeSlug:'city-tour/takao',poiNameSnapshot:'Составная остановка',poiId:id}));assert.equal(result.status,422);assert.equal(writes.length,0)
}
invalidId='';writes=[];assert.equal((await route.POST(request({routeSlug:'city-tour/takao',poiNameSnapshot:'Храм',poiId:'POI-000001'}))).status,200);assert.equal(writes.length,1)
// Bad eleventh record must prevent even the first ten changes.
store=new Map(Array.from({length:11},(_,i)=>[`rec${i}`,{'Route Stop ID':`stop-${i}`,'Status':'Active','POI ID':'POI-000001'}]))
const batch=Array.from(store.keys(),id=>({id,fields:{'Stop Title Override':'Новое имя'}}))
batch[10].fields['POI ID']='';writes=[]
assert.equal((await route.PATCH(request({records:batch}))).status,422);assert.equal(writes.length,0)
// A text override does not replace a POI, and helper checkbox is not an escape hatch.
for(const fields of [{'POI ID':'','Stop Description Override Approved (RU)':'Текст'},{'POI ID':'','Is Helper':true}]){
 writes=[];assert.equal((await route.PATCH(request({records:[{id:'rec0',fields}]}))).status,422);assert.equal(writes.length,0)
}
writes=[];assert.equal((await route.PATCH(request({records:[{id:'rec0',fields:{'POI ID':'','Status':'Inactive'}}]}))).status,200);assert.equal(writes.length,1,'invalid legacy row can be deactivated')
writes=[];readFailure=true;assert.equal((await route.PATCH(request({records:[{id:'rec1',fields:{'Stop Title Override':'New'}}]}))).status,500);assert.equal(writes.length,0);readFailure=false

// Execute real builder entrypoint: manual POI cannot cause even the route POST.
let builderWrites=0
const storageImports={
 './airtable-schema':{DAY_ITEMS_TABLE_NAME:'Day Items'},'./route-poi-preflight':gate,
 '@/lib/airtable-retry':{fetchAirtableWithRetry:async(_u,o)=>{if(o?.method&&o.method!=='GET')builderWrites++;return response({records:[]})}},
 react:{cache:f=>f},'@/lib/public-data-cache':{publicDataCache:f=>f},'@/lib/prospects':{renameLinkedRouteReferences:async()=>0},
 '@/lib/tour-pricing':{parseRoutePricingData:()=>null},'@/lib/typography':{typoDeep:x=>x},
}
const storage=load('../src/lib/multi-day-builder-storage.ts',storageImports)
for(const sourceMode of ['manual','generated']){
 await assert.rejects(storage.saveMultiDayBuilderRoute({slug:'test',days:[{dayNumber:1,items:[{id:'item',itemType:'poi',sourceMode,internalNotes:''}]}]}),rules.RoutePoiReadinessError)
 assert.equal(builderWrites,0)
}
invalidId='POI-999999'
await assert.rejects(storage.saveMultiDayBuilderRoute({slug:'test',days:[{dayNumber:1,items:[{id:'item',itemType:'poi',sourceMode:'manual',internalNotes:'POI ID: POI-999999'}]}]}),rules.RoutePoiReadinessError)
assert.equal(builderWrites,0);invalidId=''
const validRoute={slug:'test',title:'Test',days:[{dayNumber:1,transportSegments:[],items:[{id:'item',itemType:'poi',sourceMode:'manual',internalNotes:'POI ID: POI-000001'}]}]}
builderWrites=0;assert.equal((await storage.saveMultiDayBuilderRoute(validRoute)).ok,true);assert.ok(builderWrites>0,'ready POI is saved')
net=[];builderWrites=0
assert.equal((await storage.saveMultiDayBuilderRoute({...validRoute,days:[{dayNumber:1,transportSegments:[],items:[{id:'note',itemType:'note',internalNotes:''}]}]})).ok,true)
assert.equal(net.length,0,'actual service notes need no fake POI');assert.ok(builderWrites>0)
writes=[]
await route.PATCH(request({records:[{id:'rec1',fields:{'POI ID':' POI-000002 '}}]}))
assert.equal(writes[0].records[0].fields['POI ID'],'POI-000002')

// Mutation controls execute the same production consumers and named assertions.
function removeOnce(anchor){return s=>{assert.equal(s.split(anchor).length,2,'unique mutation anchor');return s.replace(anchor,'')}}
const postGuard="    await preflightRoutePois([{ key: `${routeSlug}: ${poiNameSnapshot}`, poiId }])"
const postMutant=load('../src/app/api/admin/route-stops/stops/route.ts',apiImports,{fetch:apiFetch},removeOnce(postGuard))
const postBody={routeSlug:'test',poiNameSnapshot:'Name',poiId:''}
const checkPost=r=>assert.equal(r.status,422,'POST blocks unregistered POI')
checkPost(await route.POST(request(postBody)))
const postMutantResult=await postMutant.POST(request(postBody))
assert.throws(()=>checkPost(postMutantResult),/POST blocks unregistered POI/)


const patchMutant=load('../src/app/api/admin/route-stops/stops/route.ts',apiImports,{fetch:apiFetch},removeOnce('    await preflightRoutePois(refs)'))
const checkPatch=r=>assert.equal(r.status,422,'PATCH rejects the invalid eleventh record')
checkPatch(await route.PATCH(request({records:batch})))
const patchResult=await patchMutant.PATCH(request({records:batch}))
assert.throws(()=>checkPatch(patchResult),/PATCH rejects the invalid eleventh record/)
const builderGuard=readFileSync(new URL('../src/lib/multi-day-builder-storage.ts',import.meta.url),'utf8').match(/  await preflightRoutePois\(safeRoute[\s\S]*?\n  const preparedDayItems/)[0].replace('\n  const preparedDayItems','')
const builderMutant=load('../src/lib/multi-day-builder-storage.ts',storageImports,{},removeOnce(builderGuard))
invalidId='POI-000001';builderWrites=0
await assert.rejects(storage.saveMultiDayBuilderRoute(validRoute),rules.RoutePoiReadinessError)
const checkBuilder=()=>assert.equal(builderWrites,0,'builder rejects unknown POI before writes')
checkBuilder();await builderMutant.saveMultiDayBuilderRoute(validRoute)
assert.throws(checkBuilder,/builder rejects unknown POI before writes/);invalidId=''
console.log('✓ Guard mutations killed: POST, whole PATCH batch, builder preflight (3/3; skipped 0)')

// Import CLI refuses incomplete source-link plans without credentials or any network.
const dir=mkdtempSync(path.join(tmpdir(),'route-pois-'))
try{
 const input=path.join(dir,'input.json'),report=path.join(dir,'report.json')
 writeFileSync(input,JSON.stringify({version:1,routeSlug:'city-tour/takao',stops:[ref('')]}))
 const result=spawnSync(process.execPath,['scripts/check-route-pois.mjs','--input',input,'--report',report],{encoding:'utf8'})
 assert.equal(result.status,1,result.stderr);assert.equal(JSON.parse(readFileSync(report)).status,'blocked')
 const original=readFileSync(input,'utf8')
 const self=spawnSync(process.execPath,['scripts/check-route-pois.mjs','--input',input,'--report',input],{encoding:'utf8'})
 assert.equal(self.status,2);assert.equal(readFileSync(input,'utf8'),original)
 // Full audit queue must retain all failures, including Day Items and missing links.
 writeFileSync(path.join(dir,'poi-base.json'),JSON.stringify([{...ready,approvedRu:'',draftRu:'Draft'}]))
 writeFileSync(path.join(dir,'stops.json'),JSON.stringify([{stopId:'blank',routeSlug:'takao',poiId:'',nameSnapshot:'Composite',descriptionOverride:'Override'}]))
 writeFileSync(path.join(dir,'day-items.json'),JSON.stringify(Array.from({length:35},(_,i)=>ref('POI-000001',`day-${i}`))))
 const audit=spawnSync(process.execPath,['scripts/check-poi-integrity.mjs','--fixture',dir,'--json'],{encoding:'utf8'})
 assert.equal(audit.status,1,audit.stderr)
 const findings=JSON.parse(audit.stdout).findings
 assert.equal(findings.find(f=>f.code==='stop_without_poi').level,'FAIL')
 const admission=findings.find(f=>f.code==='route_poi_not_ready')
 assert.equal(admission.count,36);assert.equal(admission.items.length,36,'JSON keeps complete queue, not first 30')
}finally{rmSync(dir,{recursive:true,force:true})}
console.log('✓ Route POI readiness: identities, copy, system services, complete-batch admission, real admin and builder writers, external import preflight')
