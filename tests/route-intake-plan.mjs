import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'
import { assembleRouteIntakePlan as assemble, validateRouteIntakePlan } from '../scripts/lib/route-intake-plan.mjs'
import { ingestPoi, buildSourceKey } from '../src/lib/poi-ingest.ts'
import { createMemoryPoiStore } from '../src/lib/poi-memory-store.ts'
import * as rules from '../src/lib/route-poi-readiness.ts'

const source = { kind: 'manual-import', id: 'route-test', externalKey: 'temple', url: 'https://example.org/temple' }
const plan = { version: 1, routeSlug: 'intercity/example', places: [{ key: 'temple', label: 'Храм из статьи', source }], steps: [
  { key: 'visit', kind: 'poi', placeKey: 'temple', context: 'Два подхода к одному храму.' },
  { key: 'meeting', kind: 'note', text: 'Встреча с гидом' },
  { key: 'return', kind: 'poi', placeKey: 'temple' },
] }
const ready = { poiId: 'POI-000123', sourceKey: buildSourceKey(source), nameRu: 'Храм', approvedRu: 'Описание', descriptionRu: '' }
const run = (p = plan, pois = [ready]) => assemble(p, { loadPois: async () => pois })
const result = await run()
assert.equal(result.status, 'ready')
assert.deepEqual(result.steps.map(s => s.key), ['visit', 'meeting', 'return'])
assert.deepEqual(result.preflight.stops.map(s => s.poiId), ['POI-000123', 'POI-000123'])
assert.equal(result.dayItems[0].shortDescription, plan.steps[0].context)
assert.equal(result.dayItems[1].itemType, 'note')
assert.equal(result.dayItems[1].poiId, undefined)
assert.equal(result.dayItems[0].internalNotes, '')
assert.deepEqual(await run(), result, 'repeat produces identical result')
const explicit = structuredClone(plan); explicit.places = [{ key: 'temple', label: 'Проверенное место', poiId: ready.poiId }]
assert.equal((await run(explicit)).status, 'ready')
let reads = 0
const invalid = async p => {
  await assert.rejects(assemble(p, { loadPois: async () => { reads++; return [] } }))
  assert.equal(reads, 0, 'invalid batch must fail before reads')
}
for (const mutate of [
  p => p.version = 2, p => p.version = 'toString', p => p.routeSlug = '',
  p => p.extra = true, p => p.places = [], p => p.steps = [], p => p.steps.push({ ...p.steps[0] }),
  p => p.places.push({ ...p.places[0] }), p => p.places[0].poiId = ready.poiId,
  p => p.steps[0].placeKey = 'unknown', p => p.steps[0].poiId = ready.poiId,
  p => p.steps[0].context = '', p => p.steps[1].placeKey = 'temple',
  p => p.places[0].source.kind = 'human', p => p.places[0].source.id = 'bad:id',
  p => p.places[0].source.url = 'https://user:pass@example.org',
  p => p.places[0].source.url = 'https://exam\nple.org',
  p => p.places[0].source.externalKey = '', p => p.places[0].source.externalKey = '\ud800',
  p => p.places.push({ ...p.places[0], key: 'alias' }),
  p => p.places.push({ key: 'unused', label: 'Место', poiId: 'POI-000321' }),
  p => p.steps = new Array(2), p => Object.defineProperty(p, 'hidden', { value: true }),
  p => Object.defineProperty(p, 'version', { get() { throw new Error('getter executed') } }),
]) { const p = structuredClone(plan); mutate(p); await invalid(p) }
await invalid(Object.assign(Object.create({ version: 1 }), { routeSlug: plan.routeSlug, places: plan.places, steps: plan.steps }))

for (const [pois, code] of [
  [[], 'needs_registration'], [[ready, ready], 'ambiguous_identity'],
  [[{ ...ready, sourceKey: 'different-source' }], 'needs_registration'],
  [[{ ...ready, approvedRu: '', draftRu: 'Draft' }], 'empty_description'],
  [[{ ...ready, poiId: 'pending-1' }], 'invalid_poi_id'],
  [[{ ...ready, nameRu: '' }], 'empty_name'],
  [[ready, { ...ready, sourceKey: 'another' }], 'duplicate_poi_id'],
]) {
  const report = await run(plan, pois)
  assert.equal(report.status, 'blocked', `block ${code}`)
  assert.equal(report.issues[0].code, code)
  assert.equal(report.steps, undefined, 'blocked plan must have no assembled output')
  assert.equal(report.dayItems, undefined)
  assert.equal(report.preflight, undefined)
}
assert.equal((await run(explicit, [])).issues[0].code, 'unknown_poi')
assert.equal((await run(plan, [])).registrationQueue[0].sourceKey, buildSourceKey(source))
assert.equal((await run(plan, [{ ...ready, approvedRu: '', isSystem: true }])).status, 'ready')
const alias = structuredClone(plan)
alias.places.push({ key: 'alias', label: 'Другое имя того же места', poiId: ready.poiId })
alias.steps.push({ key: 'alias-visit', kind: 'poi', placeKey: 'alias' })
assert.equal((await run(alias)).issues[0].code, 'duplicate_place')
await assert.rejects(assemble(plan, { loadPois: async () => { throw new Error('network failure') } }), /network failure/)
await assert.rejects(assemble(plan, { loadPois: async () => null }), /Invalid POI snapshot/)

// Actual Intake writes to canonical memory store; new registration is NOT publication.
let createdFields
const memory = createMemoryPoiStore([], { observe(event) { if (event.kind === 'create') createdFields = event.fields } })
const request = { source, poi: { nameRu: 'Храм Гокуракудзи', nameEn: 'Gokurakuji Temple', siteCity: 'kamakura',
  descriptionRu: 'Описание храма.', descriptionEn: 'Temple description.', categoriesRu: ['Буддийский храм'],
  lat: 35.308, lon: 139.529, resolved: { placeId: 'fixture-temple', lat: 35.308, lon: 139.529 } } }
const dry = await ingestPoi(request, memory, { dryRun: true })
assert.equal(dry.outcome, 'created'); assert.equal(dry.poiId, null)
assert.equal(createdFields, undefined)
const registered = await ingestPoi(request, memory)
assert.equal(registered.outcome, 'created')
assert.equal((await ingestPoi(request, memory)).outcome, 'already_ingested')
const row = { poiId: registered.poiId, sourceKey: createdFields['Source Key'], nameRu: createdFields['POI Name (RU)'], approvedRu: '', descriptionRu: '' }
assert.equal((await run(plan, [row])).issues[0].code, 'empty_description')
assert.equal((await run(plan, [{ ...row, approvedRu: 'Редакционно принятый текст.' }])).status, 'ready', 'rerun resolves Intake ID without editing plan')

function loadTemplate(transform = x => x) {
  const source = transform(readFileSync(new URL('../src/lib/route-day-template.ts', import.meta.url), 'utf8'))
  const exports = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: id => { assert.equal(id, './route-poi-readiness'); return rules } })
  return exports
}
const template = loadTemplate()
const stop = { id: 'rec1', fields: { 'POI ID': ready.poiId, 'POI Name Snapshot': 'Храм', Status: 'Active' } }
assert.equal(template.templateStopsToDayItems([stop], 'day1')[0].poiId, ready.poiId)
assert.equal(template.templateStopsToDayItems([stop], 'day1')[0].internalNotes, '')
for (const fields of [{ 'Route Stop ID': 'STOP-1' }, { 'POI ID': 'invalid' }]) {
  assert.throws(() => template.templateStopsToDayItems([{ ...stop, fields }], 'day1'), rules.RoutePoiReadinessError, 'STOP ID cannot substitute POI')
}
for (const fields of [{ Status: 'Archived' }, { Status: { name: 'Inactive' } }, { 'Is Helper': true }]) {
  assert.equal(template.templateStopsToDayItems([{ ...stop, fields }], 'day1').length, 0)
}
assert.throws(() => template.activeTemplateStops([stop, stop]), /повторяющиеся/)
assert.throws(() => template.activeTemplateStops([null]), /некорректные/)
assert.throws(() => template.activeTemplateStops({}), /прочитать/)

// Mutation: a real template consumer accepting STOP ID must fail the named regression.
const mutant = loadTemplate(s => {
  const anchor = 'if (structural.length) throw new RoutePoiReadinessError(structural)'
  assert.equal(s.split(anchor).length, 2)
  return s.replace(anchor, '/* removed admission */')
})
assert.throws(() => assert.throws(() => mutant.templateStopsToDayItems([{ ...stop, fields: { 'Route Stop ID': 'STOP-1' } }], 'day1'), rules.RoutePoiReadinessError, 'STOP ID cannot substitute POI'), /STOP ID cannot substitute POI/)
validateRouteIntakePlan(plan)
console.log('✓ Route Intake: strict plan, identity queues, real Intake registration/rerun, no draft admission, ordered revisits, day-template regression + mutation')

// Mutation: disabling the whole-plan barrier must expose forbidden partial output.
const moduleUrl = new URL('../scripts/lib/route-intake-plan.mjs', import.meta.url)
let mutantSource = readFileSync(moduleUrl, 'utf8')
const barrier = 'if (issues.length) return report'
assert.equal(mutantSource.split(barrier).length, 2)
mutantSource = mutantSource.replace(barrier, '/* whole-plan barrier removed */')
mutantSource = mutantSource.replace(/from '([^']+)'/g, (_, spec) => `from '${new URL(spec, moduleUrl).href}'`)
const partialMutant = await import(`data:text/javascript;base64,${Buffer.from(mutantSource).toString('base64')}`)
// Use a ready first place plus an unready second place so both exist but output must be absent.
const twoPlaces = structuredClone(plan)
twoPlaces.places.push({ key: 'draft', label: 'Черновик', poiId: 'POI-000124' })
twoPlaces.steps.push({ key: 'draft-visit', kind: 'poi', placeKey: 'draft' })
const second = { ...ready, poiId: 'POI-000124', sourceKey: 'second', approvedRu: '' }
assert.equal((await run(twoPlaces, [ready, second])).steps, undefined)
// Resolve the projection dependency without changing the readiness result: a
// duplicate-place issue leaves both resolved, exercising the actual barrier.
const leaked = await partialMutant.assembleRouteIntakePlan(alias, { loadPois: async () => [ready] })
assert.throws(() => assert.equal(leaked.steps, undefined, 'blocked plan must have no assembled output'), /blocked plan must have no assembled output/)

const cliDir = mkdtempSync(path.join(tmpdir(), 'route-assemble-'))
try {
  const input = path.join(cliDir, 'plan.json'), mock = path.join(cliDir, 'fetch.mjs')
  writeFileSync(input, JSON.stringify(plan))
  writeFileSync(mock, `globalThis.fetch = async (url, init) => {
    if (init.method && init.method !== 'GET') throw new Error('Unexpected write');
    if (process.env.ROUTE_TEST_FAIL === '1') return new Response('{}', {status:503});
    const second = new URL(url).searchParams.has('offset');
    const row = { id: 'rec1', fields: { 'POI ID': 'POI-000123', 'Source Key': 'route-test:temple', 'POI Name (RU)': 'Храм', 'Description Approved (RU)': 'Описание' } };
    return new Response(JSON.stringify(second ? {records:[row]} : {records:[],offset:'second'}));
  }`)
  const cli = extra => spawnSync(process.execPath, ['--import', mock, 'scripts/assemble-route-intake.mjs', '--input', input], { encoding: 'utf8', env: { ...process.env, AIRTABLE_TOKEN: 'fixture', AIRTABLE_BASE_ID: 'fixture', ...extra } })
  const pass = cli({})
  assert.equal(pass.status, 0, pass.stderr)
  assert.equal(JSON.parse(pass.stdout).steps[0].poiId, ready.poiId, 'CLI reads page two')
  const fail = cli({ ROUTE_TEST_FAIL: '1' })
  assert.equal(fail.status, 2); assert.equal(JSON.parse(fail.stdout).status, 'error')
  const missing = structuredClone(plan); missing.places[0].source.externalKey = 'missing'
  writeFileSync(input, JSON.stringify(missing))
  const blocked = cli({})
  assert.equal(blocked.status, 1); assert.equal(JSON.parse(blocked.stdout).status, 'blocked')
  assert.equal(JSON.parse(blocked.stdout).dayItems, undefined)
  writeFileSync(input, JSON.stringify({ ...plan, version: 2 }))
  const invalid = cli({ ROUTE_TEST_FAIL: '1' })
  assert.equal(invalid.status, 2); assert.match(JSON.parse(invalid.stdout).error, /version/)
} finally { rmSync(cliDir, { recursive: true, force: true }) }
console.log('✓ Route Intake: CLI pagination/error branches; whole-plan barrier mutation killed (no partial output)')
