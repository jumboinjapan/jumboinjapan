import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as rules from '../src/lib/route-publication.ts'
import * as poiRules from '../src/lib/route-poi-readiness.ts'
import { mergeRouteCatalog } from '../src/lib/route-catalog.ts'
import { executeMigration, KIND_FIELD } from '../scripts/route-registry/migration.mjs'

const rec = (id, fields) => ({ id, fields })
const routeRecord = (id = 'recOne', extra = {}) => rec(id, { Slug: 'intercity/one', 'Route Type': 'intercity', Title: 'One', 'Content Kind': 'Tour', Status: 'Published', ...extra })
const poi = { poiId: 'POI-000001', nameRu: 'Храм', approvedRu: 'Описание', descriptionRu: '' }
const stop = (slug = 'intercity/one', extra = {}) => rec('recStop', { 'Route Slug': slug, 'POI ID': poi.poiId, Status: 'Active', ...extra })
for (const contentKind of [...rules.CONTENT_KINDS, '', 'tour', '__proto__']) {
  for (const status of [...rules.ROUTE_STATUSES, '', 'published']) {
    for (const ready of [false, true]) {
      assert.equal(rules.isPublicRoute({ contentKind, status, ready }),
        status === 'Published' && rules.CONTENT_KINDS.includes(contentKind) && (contentKind !== 'Tour' || ready))
    }
  }
}
assert.equal(rules.isPublicRoute(undefined), false)
assert.throws(() => rules.parseRouteRegistry([routeRecord(), routeRecord('recTwo')]), /Duplicate/)
const initial = rules.parseRouteRegistry([routeRecord()])
assert.equal(rules.isPublicRoute(initial[0]), false, 'status alone cannot publish a tour')
for (const [stops, pois, reason] of [
  [[], [poi], 'empty_tour'], [[stop()], [], 'unknown_poi'], [[stop()], [poi, poi], 'duplicate_poi_id'],
  [[stop('intercity/one', { 'POI ID': '' })], [poi], 'missing_poi'], [[stop()], [{ ...poi, approvedRu: '' }], 'empty_description'],
  [[stop('intercity/one', { Status: 'Inactive' })], [poi], 'empty_tour'], [[stop('intercity/one', { 'Is Helper': true })], [poi], 'empty_tour'],
]) {
  const result = rules.applyRouteReadiness(initial, stops, [], pois)[0]
  assert.equal(rules.isPublicRoute(result), false)
  assert.ok(result.issues[0].includes(reason), reason)
}
const readyRoute = rules.applyRouteReadiness(initial, [stop()], [], [poi])[0]
assert.equal(rules.isPublicRoute(readyRoute), true)
const multi = rules.parseRouteRegistry([routeRecord('recMulti', { Slug: 'multi-day/one' })])
assert.equal(rules.applyRouteReadiness(multi, [stop('multi-day/one')], [], [poi])[0].ready, false, 'multi-day membership never borrowed from stops')
assert.equal(rules.applyRouteReadiness(multi, [], [rec('recItem', { 'Route Slug': 'multi-day/one', 'Item Type': 'poi', 'POI ID': poi.poiId })], [poi])[0].ready, true)
for (const kind of rules.CONTENT_KINDS.filter(k => k !== 'Tour')) {
  const entry = rules.parseRouteRegistry([routeRecord('recKind', { 'Content Kind': kind })])[0]
  assert.equal(rules.isPublicRoute(entry), true)
  assert.equal(rules.isIndexableRoute(entry), kind !== 'Format')
}
const seed = { ...readyRoute, duration: 'Day', image: '/same.jpg' }
assert.equal(mergeRouteCatalog([seed], [], 'intercity').length, 0, 'missing record cannot be revived by code')
for (const status of ['Draft', 'Review', 'Archived']) assert.equal(mergeRouteCatalog([seed], [{ ...readyRoute, status }], 'intercity').length, 0)
const two = { ...readyRoute, slug: 'intercity/two', image: '/same.jpg' }
assert.equal(mergeRouteCatalog([seed], [seed, two], 'intercity').length, 2, 'shared cover is not duplicate identity')

const mountain = { ...readyRoute, slug: 'city-tour/takao', routeType: 'intercity' }
assert.equal(mergeRouteCatalog([], [mountain], 'city-tour').length, 0, 'URL prefix does not choose catalogue')
assert.equal(mergeRouteCatalog([], [mountain], 'intercity').length, 1, 'catalogue follows Route Type')
assert.equal(mergeRouteCatalog([{ ...mountain, duration: '' }], [mountain], 'city-tour').length, 0, 'stale seed cannot override placement')

function load(file, imports, globals = {}, transform = text => text) {
  const js = ts.transpileModule(transform(readFileSync(new URL(file, import.meta.url), 'utf8')), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  vm.runInNewContext(js, { exports, URL, AbortSignal, console, process: { env: { AIRTABLE_TOKEN: 'fixture' } }, ...globals, require: id => { assert.ok(id in imports, `Unexpected import ${id}`); return imports[id] } })
  return exports
}
// Real static-page gate executes before even the POI read.
let lookup = 0
const content = load('../src/lib/route-content.ts', {
  './route-registry': { requirePublicRoute: async () => { throw new Error('404') } },
  react: { cache: f => f }, './public-data-cache': { publicDataCache: f => f },
  './airtable': { getIntercityRouteStopsCached: async () => { lookup++; return [] }, getPoisByIds: async () => [] },
})
await assert.rejects(content.getRouteContent('intercity/one'), /404/)
assert.equal(lookup, 0)
let registry = [readyRoute]
const publicGate = load('../src/lib/route-registry.ts', {
  react: { cache: f => f }, 'next/navigation': { notFound() { throw new Error('404') } },
  './public-data-cache': { publicDataCache: f => f }, './route-registry-store': { readRouteRegistry: async () => registry }, './route-publication': rules,
})
assert.equal((await publicGate.requirePublicRoute('intercity/one', 'Tour')).slug, readyRoute.slug)
registry = [{ ...readyRoute, ready: false }]
await assert.rejects(publicGate.requirePublicRoute('intercity/one', 'Tour'), /404/)
registry = [{ ...readyRoute, contentKind: 'Service' }]
await assert.rejects(publicGate.requirePublicRoute('intercity/one', 'Tour'), /404/)
assert.equal((await publicGate.requirePublicRoute('intercity/one', 'Service')).contentKind, 'Service')

// Bounded migration: validate the whole batch, fresh old-value checks, lost responses, no retry.
const card = { version: 'route-registry-alignment/v1', baseId: 'appBase', tableId: 'tblRoutes', authority: 'owner Package 2', baselineSha256: 'a'.repeat(64), publicBefore: ['intercity/one', 'multi-day/classic'],
  updates: [{ id: 'recOne', old: { Slug: 'intercity/one', Status: 'Draft', 'Content Kind': '', 'Route Type': 'intercity' }, next: { Status: 'Published', 'Content Kind': 'Tour', 'Route Type': 'intercity' } }],
  creates: [{ 'Route ID': 'REG-classic', Slug: 'multi-day/classic', Title: 'Classic', 'Route Type': 'multi-day', Status: 'Published', 'Content Kind': 'Format' }] }
function fixture(options = {}) {
  let rows = [routeRecord('recOne', { Status: 'Draft', 'Content Kind': '' })], fields = [], writes = [], reads = 0, journal = []
  const store = {
    async readRoutes() { reads++; if (options.drift && reads === 2) rows[0].fields.Status = 'Review'; return structuredClone(rows) },
    async readFields() { return structuredClone(fields) },
    async assess(rs) { return rules.applyRouteReadiness(rules.parseRouteRegistry(rs), options.empty ? [] : [stop()], [], [poi]) },
    async createField(f) { writes.push('schema'); fields.push(structuredClone(f)) },
    async updateRoute(id, values) { writes.push('patch'); if (options.patchFails) throw new Error('503'); Object.assign(rows.find(r => r.id === id).fields, values); if (options.lostResponse) throw new Error('timeout') },
    async createRoute(f) { writes.push('post'); rows.push(rec('recNew', structuredClone(f))); if (options.lostResponse) throw new Error('timeout') },
  }
  return { store, writes, journal, run: (apply = true, input = card) => executeMigration(input, store, { apply, journal: async e => journal.push(e) }) }
}
let f = fixture(); assert.equal((await f.run(false)).state, 'ready'); assert.deepEqual(f.writes, [])
f = fixture(); assert.equal((await f.run()).state, 'verified'); assert.deepEqual(f.writes, ['schema', 'patch', 'post']); assert.equal(f.journal.at(-1).phase, 'complete')
await assert.rejects(f.run(), /drift|baseline/); assert.equal(f.writes.length, 3, 'blind replay performs no writes')
f = fixture({ empty: true }); await assert.rejects(f.run(), /publication_not_ready/); assert.deepEqual(f.writes, [])
f = fixture({ patchFails: true }); await assert.rejects(f.run(), /migration_stopped/); assert.deepEqual(f.writes, ['schema', 'patch']); assert.equal(f.journal.at(-1).phase, 'unknown')
f = fixture({ lostResponse: true }); assert.equal((await f.run()).state, 'verified'); assert.deepEqual(f.writes, ['schema', 'patch', 'post'], 'fresh read establishes lost-response outcome without replay')
f = fixture({ drift: true }); await assert.rejects(f.run(), /drift/); assert.deepEqual(f.writes, ['schema'])
for (const mutate of [c => { c.updates[0].next.Status = 'Bogus' }, c => { c.updates[0].next['Route Type'] = 'invalid' }, c => { c.creates[0]['Content Kind'] = 'Tour' }, c => { c.creates[0].Slug = 'intercity/one' }, c => { c.creates[0].Unexpected = 'no' }, c => { c.publicBefore.pop() }]) {
  const invalid = structuredClone(card); mutate(invalid); f = fixture(); await assert.rejects(f.run(true, invalid)); assert.deepEqual(f.writes, [])
}
assert.deepEqual(KIND_FIELD.options.choices.map(c => c.name), [...rules.CONTENT_KINDS])
console.log('✓ Route publication: finite states, readiness, shared covers, static page admission, migration drift/partial/lost response/replay')
// Real paginated registry reader: repeated cursors, bad payloads and HTTP failures stop.
let requests = [], responses = []
const schema = { AIRTABLE_BASE_ID: 'appBase', ROUTES_TABLE_ID: 'routes', ROUTE_STOPS_TABLE_ID: 'stops', DAY_ITEMS_TABLE_NAME: 'items', POI_TABLE_ID: 'pois' }
const reader = load('../src/lib/route-registry-store.ts', {
  './airtable-schema.ts': schema, './route-publication.ts': rules,
  './airtable-retry.ts': { fetchAirtableWithRetry: async (url, opts) => { requests.push({ url: String(url), opts }); const body = responses.shift(); return { ok: body?.ok !== false, status: body?.ok === false ? 503 : 200, json: async () => body } } },
})
responses = [{ records: [routeRecord()], offset: 'next' }, { records: [routeRecord('recTwo', { Slug: 'intercity/two' })] }]
assert.equal((await reader.readRegistryRecords('routes')).length, 2)
assert.equal(new URL(requests[1].url).searchParams.get('offset'), 'next')
for (const fixture of [[{ ok: false }], [{ records: null }], [{ records: [], offset: 'repeat' }, { records: [], offset: 'repeat' }]]) {
  responses = fixture; await assert.rejects(reader.readRegistryRecords('routes'))
}
responses = [{ records: [routeRecord()] }, { records: [stop()] }, { records: [] }, { records: [rec('recPoi', { 'POI ID': poi.poiId, 'POI Name (RU)': poi.nameRu, 'Description Approved (RU)': poi.approvedRu })] }]
assert.equal((await reader.readRouteRegistry())[0].ready, true, 'real reader assembles ready tour')
responses = [{ records: [routeRecord()] }, { records: [] }, { records: [] }]
assert.equal((await reader.readRouteRegistry())[0].ready, false, 'real reader rejects empty tour')
console.log('✓ Registry reader: real assembly, pagination, failure closure')

for (const [anchor, changed, candidate, label] of [
  ["route.status === 'Published'", 'true', { ...readyRoute, status: 'Draft' }, 'Draft never becomes public'],
  ["(route.contentKind !== 'Tour' || route.ready)", 'true', { ...readyRoute, ready: false }, 'Unready tour never becomes public'],
]) {
  const check = subject => assert.equal(subject.isPublicRoute(candidate), false, label)
  check(rules)
  const mutant = load('../src/lib/route-publication.ts', { './route-poi-readiness.ts': poiRules }, {}, source => {
    assert.equal(source.split(anchor).length, 2, 'unique guard mutation anchor')
    return source.replace(anchor, changed)
  })
  assert.throws(() => check(mutant), new RegExp(label))
}
console.log('✓ Publication guard mutations killed: status and POI readiness (2/2)')
// Admin creation writes only a typed Draft; duplicate/read failure blocks all effects.
let apiRows = [], apiWrites = [], readError = false, losePostResponse = false, applyPost = true
const admin = load('../src/app/api/admin/route-stops/routes/route.ts', {
  '@/lib/route-registry-store': { readRegistryRecords: async () => { if (readError) throw new Error('read unavailable'); return structuredClone(apiRows) } },
  'next/server': { NextResponse: { json: (data, options) => ({ data, status: options?.status || 200 }) } },
  'next/cache': { revalidateTag() {} }, '@/lib/airtable-schema': schema,
  '@/lib/admin-guard': { requireAdminSession: async () => null },
}, { fetch: async (_url, opts) => {
  const body = JSON.parse(opts.body); apiWrites.push(body)
  if (applyPost) apiRows.push(rec('recCreated', body.fields))
  if (losePostResponse) throw new Error('lost response')
  return { ok: true, json: async () => ({ id: 'recCreated' }) }
} })
const request = body => ({ json: async () => body })
const input = { title: 'New', section: 'intercity', slugSuffix: 'new', routeType: 'untrusted' }
for (const malformed of [{}, { ...input, title: 3 }, { ...input, slugSuffix: "bad/'slug" }]) assert.equal((await admin.POST(request(malformed))).status, 400)
assert.equal(apiWrites.length, 0)
readError = true; assert.equal((await admin.POST(request(input))).status, 500); assert.equal(apiWrites.length, 0); readError = false
assert.equal((await admin.POST(request(input))).status, 200)
assert.equal(apiWrites[0].fields['Content Kind'], 'Tour'); assert.equal(apiWrites[0].fields.Status, 'Draft'); assert.equal(apiWrites[0].fields['Route Type'], 'intercity')
assert.equal((await admin.POST(request(input))).status, 409); assert.equal(apiWrites.length, 1)
apiRows = []; apiWrites = []; losePostResponse = true
assert.equal((await admin.POST(request(input))).status, 200); assert.equal(apiWrites.length, 1, 'lost response independently verified without another POST')
apiRows = []; apiWrites = []; applyPost = false
assert.equal((await admin.POST(request(input))).status, 503); assert.equal(apiWrites.length, 1)
console.log('✓ Route create API: typed Draft, read failure, duplicate, lost/unconfirmed response')
