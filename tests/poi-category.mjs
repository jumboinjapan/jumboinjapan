import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'
import * as categories from '../src/lib/poi-category.ts'
import { poiPrimaryTypes, taxonomyVersion, legacyCategoryMigrations } from '../src/lib/poi-taxonomy.ts'
import { legacyAirtableCategory, REPRESENTABLE_CODES } from '../scripts/poi-portals/lib/legacy-airtable-category-bridge.mjs'
import * as schema from '../src/lib/airtable-schema.ts'
import { taxonomyRecordFields } from '../src/lib/poi-taxonomy-airtable.ts'
import previousV4 from '../config/poi-taxonomy.v4.json' with { type: 'json' }
import previousV3 from '../config/poi-taxonomy.v3.json' with { type: 'json' }
import previous from '../config/poi-taxonomy.v2.json' with { type: 'json' }

let checks = 0
const check = (name, fn) => { try { fn(); checks++ } catch (error) { throw Error(`${name}: ${error.message}`, { cause: error }) } }
const read = categories.readPoiCategory
const canonical = (type = 'museum') => ({ 'POI Type': type, 'Type Source': 'rule', 'Taxonomy Version': taxonomyVersion })
for (const type of poiPrimaryTypes) {
  check(`CANONICAL ${type.code} has registry label`, () => {
    const v = read(canonical(type.code)); assert.equal(v.typeCode, type.code); assert.equal(v.typeLabel, type.labels.ru)
  })
}
for (const type of previous.poiPrimaryTypes) {
  check(`PREVIOUS v2 ${type.code} remains visible`, () => {
    assert.equal(read({ ...canonical(type.code), 'Taxonomy Version': previous.version }).typeCode, type.code)
  })
}
check('PREVIOUS cannot claim a new transport type', () => assert.equal(read({ ...canonical('tourist_transport'), 'Taxonomy Version': previous.version }).origin, 'review'))
check('WRITE rejects previous version even for unchanged type', () => assert.equal(taxonomyRecordFields({ poiPrimaryType: 'museum', classificationSource: 'rule', taxonomyVersion: previous.version }).ok, false))
check('TRANSPORT has owner-selected label', () => assert.equal(read(canonical('tourist_transport')).typeLabel, 'Туристический транспорт'))
check('UNKNOWN version does not acquire current authority', () => assert.equal(read({ ...canonical(), 'Taxonomy Version': 'toString' }).origin, 'review'))
for (const type of previousV3.poiPrimaryTypes) check('V3 preserves '+type.code,()=>assert.equal(read({...canonical(type.code),'Taxonomy Version':previousV3.version}).typeCode,type.code))
for (const [code,label] of [['public_space','Общественное пространство'],['shopping_complex','Торговое пространство'],['transport_hub','Транспортная инфраструктура']]) {
 check('CURRENT label '+code,()=>assert.equal(read(canonical(code)).typeLabel,label))
 check('V3 rejects new '+code,()=>assert.equal(read({...canonical(code),'Taxonomy Version':previousV3.version}).origin,'review'))
}
for (const type of previousV4.poiPrimaryTypes) check('V4 preserves '+type.code,()=>assert.equal(read({...canonical(type.code),'Taxonomy Version':previousV4.version}).typeCode,type.code))
check('V4 cannot claim public space',()=>assert.equal(read({...canonical('public_space'),'Taxonomy Version':previousV4.version}).origin,'review'))
for (const code of REPRESENTABLE_CODES) {
  check(`LEGACY bridge ${code} is exact`, () => assert.equal(read({ 'POI Category (RU)': [legacyAirtableCategory(code).value] }).typeCode, code))
}
for (const migration of legacyCategoryMigrations.filter((m) => m.mode === 'auto')) {
  check(`LEGACY alias ${migration.value}`, () => assert.equal(read({ 'POI Category (RU)': [migration.value] }).typeCode, migration.mapsTo))
}
check('PRIORITY canonical castle wins over legacy architecture', () => {
  const fields = { ...canonical('castle_fortification'), 'POI Category (RU)': ['Архитектурный объект', 'Достопримечательность'] }
  const before = JSON.stringify(fields); const v = read(fields)
  assert.equal(v.typeCode, 'castle_fortification'); assert.equal(v.origin, 'canonical'); assert.equal(JSON.stringify(fields), before)
})
for (const patch of [
  { 'POI Type': 'alien' }, { 'POI Type': ['museum'] }, { 'Taxonomy Version': 'future/v90' },
  { 'Type Source': 'invented' }, { 'POI Facets': ['unknown'] }, { 'POI Facets': 'onsen' },
]) {
  check(`INVALID canonical cannot fall back ${JSON.stringify(patch)}`, () => assert.equal(read({ ...canonical(), ...patch, 'POI Category (RU)': ['Музей'] }).origin, 'review'))
}
for (const legacy of [[], ['Достопримечательность'], ['Городская достопримечательность'], ['Музей', 'Буддийский храм'], ['Музей', 'Шоппинг'], ['Ресторан'], ['Транспортный узел'], ['Городской район'], ['Термальный Источник'], ['Знаковый вид'], ['constructor']]) {
  check(`REVIEW no guessing ${legacy.join('+')}`, () => assert.equal(read({ 'POI Category (RU)': legacy }).typeCode, null))
}
for (const legacy of ['Музей', [3], [''], {}]) check(`MALFORMED legacy ${JSON.stringify(legacy)}`, () => assert.equal(read({ 'POI Category (RU)': legacy }).origin, 'review'))
check('SYNONYMS three park values resolve to one type', () => assert.equal(read({ 'POI Category (RU)': ['Парк', 'Ландшафтный сад', 'Ландшафтный сад / Парк'] }).typeCode, 'park_garden'))
check('BADGE does not become a type or obstruct a known type', () => {
  const view = read({ 'POI Category (RU)': ['Музей', 'Знаковый вид'] })
  assert.equal(view.typeCode, 'museum'); assert.deepEqual(view.badges, ['Знаковый вид'])
  assert.equal(read({ 'POI Category (RU)': ['Знаковый вид'] }).typeCode, null)
})
check('FACETS are separate from primary type', () => {
  const view = read({ ...canonical('public_onsen'), 'POI Facets': ['hot_spring'] })
  assert.equal(view.typeCode, 'public_onsen'); assert.deepEqual(view.facets, ['Природный источник'])
})
const records = [
  { id: 'recMuseum', fields: { 'POI ID': 'POI-01', 'POI Name (RU)': 'Тест музей', ...canonical(), 'POI Category (RU)': ['Достопримечательность'] } },
  { id: 'recPark', fields: { 'POI ID': 'POI-02', 'POI Name (RU)': 'Тест парк', 'POI Category (RU)': ['Ландшафтный сад'] } },
  { id: 'recReview', fields: { 'POI ID': 'POI-03', 'POI Name (RU)': 'Тест вид', 'POI Category (RU)': ['Знаковый вид'] } },
  { id: 'recOldMuseum', fields: { 'POI ID': 'POI-04', 'POI Name (RU)': 'Тест старый музей', 'POI Category (RU)': ['Музей'] } },
]
const views = records.map((r) => read(r.fields))
check('FILTER canonical and legacy museums in same bucket', () => {
  assert.equal(views.filter((v) => categories.matchesPoiType(v, 'museum')).length, 2)
  assert.equal(views.filter((v) => categories.matchesPoiType(v, categories.POI_TYPE_REVIEW)).length, 1)
  assert.equal(views.filter((v) => categories.matchesPoiType(v, 'all')).length, 4)
  assert.equal(views.filter((v) => categories.matchesPoiType(v, 'Музей')).length, 0)
  assert.deepEqual(categories.poiCategoryFilterOptions(views).map((o) => o.value).sort(), ['museum', 'park_garden', categories.POI_TYPE_REVIEW].sort())
})
check('REPORT conservation and original categories survive', () => {
  const report = categories.summarizePoiCategories(records.map((r) => ({ recordId: r.id, fields: r.fields })))
  assert.deepEqual(report.counts, { canonical: 1, legacy: 2, review: 1 })
  assert.equal(report.total, report.rows.length); assert.equal(report.total, Object.values(report.counts).reduce((a, b) => a + b, 0))
  assert.deepEqual(report.rows[2].legacyCategories, ['Знаковый вид'])
})

// Execute the real app readers. Only HTTP, React cache and unrelated dependencies are substituted.
let requests = 0
const http = async (_url, init) => {
  assert.equal(init?.method ?? 'GET', 'GET'); requests++
  return { ok: true, json: async () => ({ records }) }
}
async function load(relative, extra = {}) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  const imports = {
    './poi-category.ts': categories, '@/lib/airtable-schema': schema,
    '@/lib/airtable-retry': { fetchAirtableWithRetry: http },
    react: { cache: (fn) => fn }, 'next/cache': { unstable_cache: (fn) => fn }, ...extra,
  }
  vm.runInNewContext(output, { exports, require: (id) => { if (!(id in imports)) throw Error(`Unexpected import: ${id}`); return imports[id] },
    process: { env: { AIRTABLE_TOKEN: 'fixture', AIRTABLE_BASE_ID: 'fixture' } }, URL, console,
  }, { filename: relative })
  return exports
}
const airtable = await load('../src/lib/airtable.ts')
const actual = await airtable.getAllPoisForAdminList()
check('READER maps canonical types before admin consumes them', () => {
  assert.equal(actual[0].category[0], 'Музей'); assert.equal(actual[1].category[0], 'Сад / парк')
  assert.equal(actual[2].category.length, 0); assert.equal(actual[2].classification.origin, 'review')
  assert.equal(actual.length, records.length)
})
const workspace = await load('../src/lib/admin-workspace.ts', {
  '@/lib/airtable': airtable, '@/lib/poi-facts': {}, '@/lib/admin-seo-llm-storage': { mapWorkspaceFieldsToDraft: () => null }, '@/data/tours': { tours: [] },
})
const items = await workspace.getAdminWorkspaceItems()
check('WORKSPACE carries resolved classification without hiding review rows', () => {
  assert.equal(items.length, records.length); assert.equal(items.filter((r) => categories.matchesPoiType(r.classification, 'museum')).length, 2)
})
const builder = await load('../src/lib/multi-day-builder-data.ts')
const options = await builder.searchMultiDayBuilderPois('Тест')
check('BUILDER uses same types as admin', () => {
  assert.equal(options.length, records.length)
  assert.equal(options.find((r) => r.poiId === 'POI-01').categoryRu, 'Музей')
  assert.equal(options.find((r) => r.poiId === 'POI-03').categoryRu, categories.POI_TYPE_REVIEW_LABEL)
})
check('NETWORK fixture GETs executed', () => assert.equal(requests, 3))
records.push({ id: 'recService', fields: { 'POI ID': 'SYS-01', 'POI Name (RU)': 'Тест заселение', 'Is System': true } })
const serviceOptions = await builder.listMultiDayBuilderServicePois()
check('SERVICE blocks are not classified as unresolved tourist POIs', () => {
  assert.equal(serviceOptions.length, 1); assert.equal(serviceOptions[0].categoryRu, '')
})
records.pop()
const temporary = await mkdtemp(path.join(tmpdir(), 'poi-categories-test-'))
try {
  const cli = fileURLToPath(new URL('../scripts/poi-categories.mjs', import.meta.url))
  await writeFile(path.join(temporary, 'fixture.json'), JSON.stringify(records.map((r) => ({ recordId: r.id, fields: r.fields }))))
  const fixture = spawnSync(process.execPath, [cli, '--fixture', 'fixture.json', '--out', 'out.json'], { cwd: temporary, encoding: 'utf8' })
  check('CLI fixture uses shared projection', () => { assert.equal(fixture.status, 0, fixture.stderr); assert.equal(JSON.parse(fixture.stdout).total, 4) })
  const duplicate = spawnSync(process.execPath, [cli, '--fixture', 'fixture.json', '--out', 'out.json'], { cwd: temporary, encoding: 'utf8' })
  check('CLI cannot overwrite an earlier report', () => assert.notEqual(duplicate.status, 0))
  await writeFile(path.join(temporary, '.env.local'), 'AIRTABLE_TOKEN=fixture\nAIRTABLE_BASE_ID=fixture\n')
  await writeFile(path.join(temporary, 'fetch.mjs'), `
    import assert from 'node:assert/strict';
    globalThis.fetch = async (url, init) => {
      assert.equal(init.method, 'GET');
      assert.equal(url.searchParams.get('filterByFormula'), 'NOT({Is System})');
      assert.ok(url.searchParams.getAll('fields[]').includes('POI Type'));
      return { ok: true, json: async () => ({ records: ${JSON.stringify(records)} }) };
    };
  `)
  const live = spawnSync(process.execPath, ['--import', path.join(temporary, 'fetch.mjs'), cli, '--live', '--out', 'live.json'], { cwd: temporary, encoding: 'utf8' })
  check('CLI live branch GET only with fake transport', () => {
    assert.equal(live.status, 0, live.stderr); const result = JSON.parse(live.stdout)
    assert.equal(result.requests, 1); assert.equal(result.writes, 0); assert.equal(result.total, 4)
  })
} finally { await rm(temporary, { recursive: true }) }
console.log(`poi-category: ${checks} checks passed`)
