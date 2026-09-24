import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { matchPoi } from '../src/lib/poi-matching.ts'
import { resolvePoiDestination, resolveSiteCity } from '../src/lib/jp-address.ts'
import { municipalityForIntake, MUNICIPALITY_FIELD, MUNICIPALITY_FIELD_DEFINITION } from '../src/lib/poi-municipality.ts'
import { ingestPoi, ingestPoiBatch, ensureMunicipalitySchemaForWrite } from '../src/lib/poi-ingest.ts'
import { createMemoryPoiStore } from '../src/lib/poi-memory-store.ts'
import { formatAdminCityLabel } from '../src/lib/admin-city-label.ts'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'
import { ensureMunicipality } from '../scripts/poi-geography/ensure-municipality.mjs'
let checks = 0
const test = async (name, fn) => { await fn(); checks++; console.log('✓ ' + name) }
const originalFetch = globalThis.fetch
let network = 0
globalThis.fetch = () => { network++; throw Error('Unexpected network') }
const addresses = ['北見市','美幌町','小清水町','標茶町','鶴居村','中富良野町']
for (const municipality of addresses) await test('UNLISTED_MUNICIPALITY_' + municipality, () => {
  const address = '北海道' + municipality + '123'
  const result = resolvePoiDestination({ address })
  assert.equal(result.municipality, municipality)
  assert.equal(result.siteCity, 'unassigned-hokkaido')
  assert.equal(result.conflict, false)
  assert.equal(resolveSiteCity({ address }).siteCity, '', 'Legacy collector coverage must stay explicit')
})
await test('ONE_HOLDING_GROUP_NOT_SIX_VILLAGE_FILTERS', () => {
  const slugs = new Set(addresses.map(m => resolvePoiDestination({ address: '北海道' + m }).siteCity))
  assert.equal(slugs.size, 1)
  assert.equal(formatAdminCityLabel([...slugs][0]), 'Хоккайдо — направление не назначено')
})
await test('HOLDING_PREFECTURE_IS_NOT_SAME_CITY_EVIDENCE', () => {
  const row={poiId:'POI-000001',nameRu:'Музей истории',siteCity:'unassigned-hokkaido'}
  assert.equal(matchPoi(row,[row])[0].sameCity,false)
  assert.equal(matchPoi({...row,siteCity:'sapporo'},[{...row,siteCity:'sapporo'}])[0].sameCity,true)
})
await test('EXISTING_DIRECTIONS_AND_DISTRICT_ADDRESS', () => {
  assert.equal(resolvePoiDestination({ address: '北海道札幌市中央区北一条' }).siteCity, 'sapporo')
  assert.equal(municipalityForIntake('〒088-1800 北海道厚岸郡浜中町123', 'Hokkaido').municipality, '浜中町')
  assert.equal(municipalityForIntake('東京都港区芝公園4', 'Tokyo').municipality, '港区')
})
await test('NO_INVENTED_MUNICIPALITY_OR_PREFECTURE', () => {
  for (const address of ['北海道','',null,'123']) assert.throws(() => municipalityForIntake(address, 'Hokkaido'), /municipalityAddress/)
  assert.equal(resolvePoiDestination({ address: '中富良野町123' }).siteCity, '')
  assert.throws(() => municipalityForIntake('北海道中富良野町123', 'Tokyo'), /municipalityAddressConflict/)
  assert.throws(() => municipalityForIntake('北海道中富良野町123', ''), /municipalityPointPrefectureRequired/)
  assert.equal(resolvePoiDestination({ address: '北海道中富良野町123', city: '北見市' }).conflict, true)
})
const request = () => ({ source: {kind:'portal-collector',id:'test',externalKey:'municipality'}, poi: {
  nameRu:'Тестовый музей', siteCity:'', sourceAddressJa:'北海道中富良野町123',
  lat:43.4,lon:142.4,resolved:{placeId:'test-municipality',lat:43.4,lon:142.4,prefectureEn:'Hokkaido',prefectureRu:'Хоккайдо'},
  descriptionRu:'Музей истории.',descriptionEn:'A history museum.',categoriesRu:['Музей']
}})
await test('REAL_INTAKE_PERSISTS_ADDRESS_WITHOUT_PUBLICATION', async () => {
  const store = createMemoryPoiStore([])
  const out = await ingestPoi(request(), store)
  assert.equal(out.outcome, 'created', out.explanation)
  assert.equal(out.fields[MUNICIPALITY_FIELD], '中富良野町')
  assert.equal(out.fields['Site City'], 'unassigned-hokkaido')
  assert.equal(out.fields['Prefecture (EN)'], 'Hokkaido')
  assert.equal(out.fields['Copy Status'], 'Draft')
  assert.equal(Object.hasOwn(out.fields, 'Description Approved (RU)'), false)
  assert.equal((await ingestPoi(request(), store)).outcome, 'already_ingested')
})
await test('WRONG_DIRECTION_OR_LATER_BAD_ROW_FAIL_BEFORE_IO', async () => {
  let effects = 0
  const store = { listExisting: async () => { effects++; return [] }, readSchemaTables: async () => { effects++; return [] }, create: async () => { effects++ } }
  const wrong = request(); wrong.poi.siteCity = 'unassigned-tokyo'
  await assert.rejects(() => ingestPoi(wrong, store), /municipalityDirectionConflict/)
  const bad = request(); bad.poi.sourceAddressJa = '東京都港区芝公園4'
  await assert.rejects(() => ingestPoiBatch([request(), bad], store), /municipalityAddressConflict/)
  const evidence = request(); evidence.poi.factDossier = {spec:'poi-facts/v2'}; evidence.poi.factEvidence = [{blocks:[{text:'Other address'}]}]
  await assert.rejects(() => ingestPoi(evidence, store), /municipalityAddressEvidenceMismatch/)
  assert.equal(effects, 0)
})
await test('LIVE_STORE_REQUIRES_EXACT_SCHEMA', async () => {
  const store = fields => ({ readSchemaTables: async () => [{id:POI_TABLE_ID,name:'POI',fields}] })
  await assert.rejects(() => ensureMunicipalitySchemaForWrite(store([]), true), /municipalitySchemaRequired/)
  await assert.rejects(() => ensureMunicipalitySchemaForWrite(store([{name:MUNICIPALITY_FIELD,type:'singleSelect'}]), true), /municipalitySchemaRequired/)
  await ensureMunicipalitySchemaForWrite(store([MUNICIPALITY_FIELD_DEFINITION]), true)
})
function service({fields=[],loseResponse=false,missingAfter=false,badReadback=false}={}) {
  let post=0,get=0
  return {get counts(){return {post,get}}, fetchImpl:async(url,init) => {
    assert.equal(new URL(url).origin,'https://api.airtable.com')
    if(init.method === 'POST') {
      post++; assert(url.endsWith(`/tables/${POI_TABLE_ID}/fields`))
      assert.deepEqual(JSON.parse(init.body),MUNICIPALITY_FIELD_DEFINITION)
      if(!missingAfter)fields.push({...MUNICIPALITY_FIELD_DEFINITION,id:'fldFixture'})
      if(loseResponse)throw Error('lost response')
      return new Response('{}',{status:200})
    }
    get++
    if(badReadback && post)throw Error('network')
    return new Response(JSON.stringify({tables:[{id:POI_TABLE_ID,name:'POI',fields}]}))
  }}
}
await test('SCHEMA_DRY_RUN_AND_RECONCILED_IDEMPOTENT_APPLY', async () => {
  const s = service({loseResponse:true}), events=[]
  const opts={token:'fixture',fetchImpl:s.fetchImpl,journal:async e=>events.push(e)}
  assert.equal((await ensureMunicipality(opts)).state,'missing');assert.equal(s.counts.post,0)
  assert.equal((await ensureMunicipality({...opts,apply:true})).state,'verified')
  assert.equal((await ensureMunicipality({...opts,apply:true})).state,'present')
  assert.deepEqual(s.counts,{post:1,get:4})
  assert.deepEqual(events.map(e=>e.phase),['intent','verified'])
})
await test('SCHEMA_CONFLICT_AND_UNKNOWN_NEVER_RETRY_POST', async () => {
  const wrong=service({fields:[{name:MUNICIPALITY_FIELD,type:'singleSelect'}]})
  await assert.rejects(()=>ensureMunicipality({apply:true,token:'fixture',fetchImpl:wrong.fetchImpl}),/municipalitySchemaRequired/)
  assert.equal(wrong.counts.post,0)
  for(const config of [{missingAfter:true},{badReadback:true}]) {
    const s=service(config),events=[]
    await assert.rejects(()=>ensureMunicipality({apply:true,token:'fixture',fetchImpl:s.fetchImpl,journal:async e=>events.push(e)}),/municipalitySchemaUnverified/)
    assert.equal(s.counts.post,1);assert.equal(events.at(-1).phase,'unverified')
  }
})
await test('SCHEMA_CLI_RUNS_AND_REJECTS_BAD_FLAGS_BEFORE_ENV_OR_NETWORK', () => {
  const script=new URL('../scripts/poi-geography/ensure-municipality.mjs',import.meta.url)
  const result=spawnSync(process.execPath,[script.pathname,'--wrong'],{encoding:'utf8',cwd:'/tmp'})
  assert.notEqual(result.status,0)
  assert.match(result.stderr,/Usage: npm run poi:municipality-schema/)
})
assert.equal(network,0);globalThis.fetch=originalFetch
console.log(`${checks} checks passed`)
