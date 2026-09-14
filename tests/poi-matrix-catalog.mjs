import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'
import * as catalog from '../scripts/poi-portals/lib/poi-matrix-catalog.mjs'
import * as categories from '../src/lib/poi-category.ts'
import * as geography from '../src/lib/poi-geography.ts'
import * as schema from '../src/lib/airtable-schema.ts'
import {readFileSync} from 'node:fs'
import {matrixCatalog,readMatrixRecord,searchMatrixCatalog} from '../scripts/poi-portals/lib/poi-matrix-catalog.mjs'
import {buildPoiMatrix,matchesPoiMatrix,projectPoiMatrix} from '../scripts/poi-portals/lib/poi-matrix.mjs'
import {storePoiFacts} from '../src/lib/poi-facts.ts'
import fixtures from './fixtures/poi-matrix-examples.json' with {type:'json'}
let checks=0
const check=async(name,fn)=>{try{await fn();checks++}catch(e){throw new Error(`${name}: ${e.message}`,{cause:e})}}
const empty={groups:[],childAges:[]}
const now=fixtures.observedAt
const records=fixtures.fixtures.map((f,i)=>({id:`rec${String(i).padStart(14,'0')}`,fields:{...f.context.fields,
  ...(f.kind==='legacy'?{}:{Notes:storePoiFacts('',f.context.dossier),'POI Matrix':JSON.stringify(buildPoiMatrix(f.claims,f.context))})}}))
await check('CATALOG conservation legacy invalid system',()=>{
  const result=matrixCatalog([...records,{id:'system',fields:{'Is System':true}},{id:'broken',fields:{'POI Matrix':'{',Notes:'bad'}}],empty,now)
  assert.equal(result.items.length,41);assert.equal(result.matchedIds.length,41)
  assert.deepEqual(result.coverage,{valid:38,missing:2,invalid:1})
  assert(!JSON.stringify(result).includes('Notes'));assert(!JSON.stringify(result).includes('references'))
})
for(const query of [{groups:[{group:'functions',codes:['exhibition','garden_visit'],mode:'any'}],childAges:[]},{groups:[{group:'themes',codes:['history','architecture'],mode:'all'}],childAges:[]},{groups:[{group:'kinds',codes:['kind_aquarium'],mode:'any'}],childAges:[]}]){
  await check(`CATALOG same IDs as M1 ${JSON.stringify(query)}`,()=>{
    const expected=fixtures.fixtures.flatMap((f,i)=>f.kind==='legacy'?[]:matchesPoiMatrix(projectPoiMatrix(buildPoiMatrix(f.claims,f.context),f.context),query)?[records[i].id]:[])
    assert(expected.length>0)
    assert.deepEqual(matrixCatalog(records,query,now).matchedIds,expected)
    assert.deepEqual(matrixCatalog([...records].reverse(),query,now).matchedIds.sort(),[...expected].sort())
  })
}
await check('CATALOG malformed query before read',async()=>{
  let calls=0
  for(const bad of [{},null,{groups:[{group:'functions',codes:['bogus'],mode:'any'}],childAges:[]},{groups:[{group:'audience',codes:['children'],mode:'any'}],childAges:[]}]){
    await assert.rejects(()=>searchMatrixCatalog(bad,async()=>{calls++;return records},now))
  }
  assert.equal(calls,0)
})
await check('CATALOG reader failure is not empty success',async()=>{
  await assert.rejects(()=>searchMatrixCatalog(empty,async()=>{throw Error('offline')},now),/offline/)
})
await check('CATALOG corruption isolated from good rows',()=>{
  const copy=structuredClone(records);copy[0].fields['POI Matrix']='{}'
  const result=matrixCatalog(copy,empty,now)
  assert.equal(result.coverage.invalid,1);assert.equal(result.coverage.valid,37)
  const foreign=structuredClone(records[1].fields);foreign['POI ID']='POI-999999'
  assert.equal(readMatrixRecord(foreign,now).state,'invalid')
  delete foreign['POI ID'];assert.equal(readMatrixRecord(foreign,now).state,'invalid')
})
await check('CATALOG expiry evaluated at request time',()=>{
  const q={groups:[{group:'functions',codes:['exhibition'],mode:'any'}],childAges:[]}
  assert(matrixCatalog(records,q,now).matchedIds.length>0)
  assert.equal(matrixCatalog(records,q,'2030-01-01T00:00:00.000Z').matchedIds.length,0)
})
await check('CATALOG duplicate record rejected',()=>assert.throws(()=>matrixCatalog([records[0],records[0]],empty,now),/matrixCatalogDuplicateRecord/))
await check('CATALOG endpoint authenticated read-only declaration',()=>{
  const source=readFileSync(new URL('../src/app/api/admin/poi-matrix/route.ts',import.meta.url),'utf8')
  assert(source.indexOf('await requireAdminSession(request)')<source.indexOf('assertMatrixQuery(JSON.parse'))
  assert(!/export async function (POST|PATCH|DELETE|PUT)/.test(source))
  assert(source.includes("'private, no-store'"))
})
function load(relative,imports,env={AIRTABLE_TOKEN:'fixture',AIRTABLE_BASE_ID:'fixture'}) {
  const source=readFileSync(new URL(relative,import.meta.url),'utf8')
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const exports={}
  vm.runInNewContext(output,{exports,require:id=>{assert(Object.hasOwn(imports,id),`unexpected import ${id}`);return imports[id]},process:{env},URL,console,JSON})
  return exports
}
function reader(http,env) {
  return load('../src/lib/airtable.ts',{
    '../../scripts/poi-portals/lib/poi-matrix-catalog.mjs':catalog,
    './poi-category.ts':categories,'./poi-geography.ts':geography,'@/lib/airtable-schema':schema,
    '@/lib/airtable-retry':{fetchAirtableWithRetry:http},react:{cache:fn=>fn},'next/cache':{unstable_cache:fn=>fn},
  },env)
}
await check('AIRTABLE complete pagination before selection',async()=>{
  let calls=0
  const api=reader(async(url,init)=>{
    assert.equal(init.method??'GET','GET');calls++
    if(calls===1)return {ok:true,json:async()=>({records:records.slice(0,20),offset:'next'})}
    assert(new URL(url).searchParams.get('offset')==='next')
    return {ok:true,json:async()=>({records:records.slice(20)})}
  })
  assert.equal((await api.getPoiRecordsForMatrix()).length,40);assert.equal(calls,2)
})
await check('AIRTABLE second page failure refuses partial success',async()=>{
  let calls=0
  const api=reader(async()=>++calls===1?{ok:true,json:async()=>({records:records.slice(0,20),offset:'next'})}:{ok:false,status:503})
  await assert.rejects(()=>api.getPoiRecordsForMatrix(),/Airtable read failed/)
})
await check('AIRTABLE missing credentials is an error',async()=>{
  const api=reader(()=>{throw Error('unexpected HTTP')},{})
  await assert.rejects(()=>api.getPoiRecordsForMatrix(),/credentials unavailable/)
})
await check('DETAIL real reader carries validated matrix only internally',async()=>{
  const api=reader(async()=>({ok:true,json:async()=>records[0]}))
  const detail=await api.getPoiByRecordId(records[0].id)
  assert.equal(detail.matrix.state,'valid');assert(detail.matrix.projection.properties.length>0)
})
function route(deny,read) {
  return load('../src/app/api/admin/poi-matrix/route.ts',{
    'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status??200,headers:options?.headers})}},
    '@/lib/admin-guard':{requireAdminSession:async()=>deny},
    '@/lib/airtable':{getPoiRecordsForMatrix:read},
    '../../../../../scripts/poi-portals/lib/poi-matrix-catalog.mjs':catalog,
  })
}
const request=query=>({nextUrl:new URL('http://localhost/api/admin/poi-matrix?query='+encodeURIComponent(JSON.stringify(query)))})
await check('HTTP auth denial before reads',async()=>{
  let calls=0
  const denied={status:401}
  assert.equal(await route(denied,async()=>{calls++;return records}).GET(request(empty)),denied)
  assert.equal(calls,0)
})
await check('HTTP invalid query 400 before reads',async()=>{
  let calls=0
  const result=await route(null,async()=>{calls++;return records}).GET(request({}))
  assert.equal(result.status,400);assert.equal(calls,0)
})
await check('HTTP read failure 503, successful response private',async()=>{
  assert.equal((await route(null,async()=>{throw Error('offline')}).GET(request(empty))).status,503)
  const good=await route(null,async()=>records).GET(request(empty))
  assert.equal(good.status,200);assert.equal(good.body.items.length,40)
  assert.equal(good.headers['Cache-Control'],'private, no-store')
})
console.log(`✓ матрица M2: ${checks} проверок каталога`)
