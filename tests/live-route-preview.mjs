import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { buildCityTourLiveStops } from '../src/lib/city-tour-live-stops.ts'
import { mergeRouteCatalog } from '../src/lib/route-catalog.ts'
import { buildTicketDisplay } from '../src/lib/ticket-display.ts'

function load(file, imports, env = {}, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  vm.runInNewContext(output, { exports, process: { env }, console, ...globals, require: id => {
    assert.ok(id in imports, `Unexpected import ${id}`)
    return imports[id]
  } })
  return exports
}

for (const environment of ['preview', 'production', undefined]) {
  let cacheCalls = 0, value = 1
  const { publicDataCache } = load('../src/lib/public-data-cache.ts', {
    'next/cache': { unstable_cache(fn) { cacheCalls++; let saved; return () => saved ??= fn() } },
  }, { VERCEL_ENV: environment })
  const read = publicDataCache(() => value, ['fixture'], { revalidate: 3600 })
  assert.equal(read(), 1)
  value = 2
  assert.equal(read(), environment === 'preview' ? 2 : 1, 'preview sees edits without invalidation')
  assert.equal(cacheCalls, environment === 'preview' ? 0 : 1)
}

const stop = (recordId, poiId, order, extra = {}) => ({ recordId, routeStopId: recordId, poiId, order,
  poiNameSnapshot: `Snapshot ${recordId}`, status: 'Active', tags: [], sellingHighlights: [], ...extra })
let records = [stop('old', 'POI-1', 2), stop('composite', '', 1, { descriptionOverride: 'Composite copy' }),
  stop('hidden', 'POI-3', 3, { status: 'Inactive' }), stop('helper', 'POI-4', 4, { isHelper: true })]
let pois = [{ poiId: 'POI-1', nameRu: 'Live POI', approvedRu: 'Approved copy', descriptionRu: 'Raw copy', siteCity: 'another-city', tickets: [] }]
const city = buildCityTourLiveStops(records, pois)
assert.deepEqual(city.map(s => s.id), ['composite', 'old'])
assert.equal(city[0].text, 'Composite copy')
assert.equal(city[1].title, 'Live POI')
assert.equal(city[1].text, 'Approved copy')
assert.equal(buildCityTourLiveStops([stop('override', 'POI-1', 1, { titleOverride: 'Override', descriptionOverride: 'Route copy', photoPath: '/photo.webp' })], pois)[0].text, 'Route copy')
assert.deepEqual(buildCityTourLiveStops([], pois), [], 'cleared route must not revive code stops')
const intercity = load('../src/lib/intercity-pois.ts', { '@/lib/ticket-display': { buildTicketDisplay } })
const timeline = intercity.buildIntercityRouteStopsFromAirtable(records, pois)
assert.deepEqual(Array.from(timeline, s => s.title), ['Snapshot composite', 'Live POI'])
assert.equal(timeline[0].description, 'Composite copy', 'intercity preserves stops without a POI')

let selectedIds
const { getRouteContent } = load('../src/lib/route-content.ts', {
  './route-registry': { requirePublicRoute: async () => ({}) },
  react: { cache: fn => fn }, './public-data-cache': { publicDataCache: fn => fn },
  './airtable': {
    getIntercityRouteStopsCached: async () => records,
    getPoisByIds: async ids => { selectedIds = Array.from(ids); return pois },
  },
})
await getRouteContent('city-tour/takao')
assert.deepEqual(selectedIds, ['POI-1', 'POI-4'], 'lookup uses stop IDs, includes helper, excludes inactive')
await getRouteContent('intercity/hakone', ['POI-5', 'POI-1'])
assert.deepEqual(selectedIds, ['POI-1', 'POI-4', 'POI-5'], 'explicit museum suggestions remain available')
records = [stop('new', 'POI-2', 1)]
pois = [{ poiId: 'POI-2', nameRu: 'Added POI', approvedRu: 'Updated copy' }]
const edited = await getRouteContent('city-tour/takao')
assert.deepEqual(selectedIds, ['POI-2'])
assert.deepEqual(buildCityTourLiveStops(Array.from(edited.routeStopRecords), Array.from(edited.pois)).map(s => s.title), ['Added POI'], 'addition and deletion propagate without redeploy')

const seed = { slug: 'intercity/old', title: 'Old', image: '/seed.webp', description: '', duration: 'Day' }
const route = (slug, status, title = slug) => ({ slug, routeType: slug.split('/')[0], status, title, image: '', description: '', contentKind: 'Tour', ready: true })
assert.deepEqual(mergeRouteCatalog([seed], [route(seed.slug, 'Draft', 'Current'), route('intercity/new', 'Published'), route('intercity/private', 'Draft'), route('city-tour/other', 'Published')], 'intercity').map(s => s.title), ['intercity/new'], 'Draft seed must not bypass publication')
assert.deepEqual(mergeRouteCatalog([seed], [route(seed.slug, 'Archived')], 'intercity'), [])

let tick, listener, refreshes = 0, visibility = 'visible', path = '/city-tour/takao'
const refreshImports = { react: { useEffect: fn => { fn() }, useTransition: () => [false, fn => fn()] },
  'next/navigation': { useRouter: () => ({ refresh: () => refreshes++ }), usePathname: () => path } }
const { PreviewRouteRefresh } = load('../src/components/layout/PreviewRouteRefresh.tsx', refreshImports, {}, {
  document: { get visibilityState() { return visibility }, addEventListener: (_event, fn) => { listener = fn }, removeEventListener() {} },
  window: { setInterval: (fn, ms) => { assert.equal(ms, 60000); tick = fn }, clearInterval() {}, addEventListener() {}, removeEventListener() {} },
})
PreviewRouteRefresh(); tick(); assert.equal(refreshes, 1)
visibility = 'hidden'; tick(); assert.equal(refreshes, 1)
visibility = 'visible'; listener(); assert.equal(refreshes, 2)
path = '/admin/route-stops'; tick = null; PreviewRouteRefresh(); assert.equal(tick, null)
console.log('✓ Live preview: no cross-request data cache, live membership/order/copy, composite stops, cross-city POIs, catalog publication gate, visible-tab refresh')
