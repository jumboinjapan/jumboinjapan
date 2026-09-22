import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { normalizePoiSearch, poiDestinations, defaultPoiDestination, filterRoutePois } from '../src/lib/route-poi-search.ts'

const poi = (poiId, nameRu, nameEn, siteCity, extra = {}) => ({ poiId, nameRu, nameEn, siteCity, categoryRu: '', isSystem: false, visitPoints: [], ...extra })
const records = [
  poi('POI-000018', 'Аквариум Эносима', 'Enoshima Aquarium', 'enoshima', {photoPath: '/tours/photo-library/aquarium.webp', photoAlt: 'Аквариум Эносима'}),
  poi('POI-000258', 'Эносима Дайси', 'Enoshima Daishi', 'enoshima'),
  poi('POI-000016', 'Сад Самюэля Кокинга', 'Samuel Cocking Garden', 'enoshima'),
  poi('POI-000017', 'Пещеры Ивая', 'Iwaya Caves', 'Enoshima'),
  poi('POI-NEW', 'Бэндзайтэн Накамисэ — торговая улица', 'Benzaiten Nakamise Street', 'enoshima'),
  poi('POI-TOKYO', 'Сэнсодзи', 'Sensoji Temple', 'tokyo'),
  poi('POI-SYSTEM', 'Свободное время', 'Free time', '', { isSystem: true }),
  poi('POI-UNLOCATED', 'Неизвестное направление', 'Unknown destination', ''),
]
const cities = [{ cityId: 'C1', nameRu: 'Эносима', nameEn: 'Enoshima', regionRu: 'Канто' }, { cityId: 'C2', nameRu: 'Токио', nameEn: 'Tokyo', regionRu: 'Канто' }]
const ids = found => found.map(p => p.poiId)
assert.equal(normalizePoiSearch('  БЕНДЗАЙТЕН—НА КАМИСЕ '), 'бендзайтен на камисе')
assert.equal(defaultPoiDestination('intercity/enoshima', [], records), 'enoshima')
assert.equal(defaultPoiDestination('city-tour/day-one', ['POI-TOKYO'], records), 'tokyo')
assert.equal(defaultPoiDestination('intercity/unknown', ['POI-TOKYO', 'POI-000018'], records), '')
assert.equal(defaultPoiDestination('intercity/unknown', [], records), '')
assert.deepEqual(poiDestinations(records, cities).map(d => [d.value, d.label, d.count]), [['tokyo', 'Токио', 1], ['enoshima', 'Эносима', 5]])
assert.equal(filterRoutePois(records, '', 'enoshima', cities).length, 5, 'empty search browses the whole destination')
assert.deepEqual(ids(filterRoutePois(records, 'океанариум', 'enoshima', cities)), ['POI-000018'])
assert.deepEqual(ids(filterRoutePois(records, 'дайси', 'enoshima', cities)), ['POI-000258'])
assert.deepEqual(ids(filterRoutePois(records, 'бендзайтен накамисе', '', cities)), ['POI-NEW'])
assert.deepEqual(ids(filterRoutePois(records, 'Nakamise', '', cities)), ['POI-NEW'])
assert.deepEqual(ids(filterRoutePois(records, 'poi-000017', '', cities)), ['POI-000017'])
assert.equal(filterRoutePois(records, 'Эносима', '', cities).length, 5, 'destination search includes garden and caves without city in title')
assert.equal(filterRoutePois(records, 'ENOSHIMA', '', cities).length, 5)
assert.equal(filterRoutePois(records, 'Сэнсодзи', 'enoshima', cities).length, 0, 'no implicit broadening')
assert.equal(filterRoutePois(records, 'Сэнсодзи', '', cities).length, 1)
assert.equal(filterRoutePois(records, 'неизвестное', '', cities).length, 1, 'unlocated records remain accessible')
assert.deepEqual(ids(filterRoutePois(records, 'свободное', '', cities)), ['POI-SYSTEM'])
assert.equal(filterRoutePois([], '', '', cities).length, 0)
const many = Array.from({length: 65}, (_, i) => poi(`POI-${i}`, `Место ${i}`, '', 'enoshima'))
assert.equal(filterRoutePois(many, '', 'enoshima').length, 65, 'no silent 12-result cutoff')
assert.equal(filterRoutePois(many, 'Место 64', 'enoshima')[0].poiId, 'POI-64')

// Execute the real API handler: auth errors never read the catalog; failures are not empty results.
const source = readFileSync(new URL('../src/app/api/admin/route-stops/pois/route.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
let denied = null, reads = 0, fail = false, refreshed = false
const exports = {}
vm.runInNewContext(compiled, {exports, require(id) {
  if (id === 'next/server') return {NextResponse: {json: (body, options = {}) => ({body, ...options})}}
  if (id === 'next/cache') return {revalidateTag: (tag, options) => { assert.equal(tag, 'airtable:pois'); assert.equal(options.expire, 0); refreshed = true }}
  if (id === '@/lib/admin-guard') return {requireAdminSession: async () => denied}
  if (id === '@/lib/multi-day-builder-data') return {
    listMultiDayBuilderPois: async () => { reads++; if (fail) throw Error('private service details'); return records },
    fetchMultiDayBuilderCities: async () => cities,
  }
  throw Error(id)
}})
let response = await exports.GET({})
assert.equal(response.body.pois.length, 8)
assert.equal(response.headers['Cache-Control'], 'private, no-store')
denied = {status: 401}; reads = 0
assert.equal(await exports.GET({}), denied)
assert.equal(await exports.POST({}), denied)
assert.equal(reads, 0); assert.equal(refreshed, false)
denied = null; fail = true
response = await exports.GET({})
assert.equal(response.status, 503)
assert.equal(Array.isArray(response.body), false)
assert.equal(JSON.stringify(response).includes('private service details'), false)
fail = false
response = await exports.POST({})
assert.equal(refreshed, true); assert.equal(response.body.pois.length, 8)
console.log('✓ Route POI search: destination browsing, names/IDs/synonyms, complete results, auth, refresh and failure states')

// Exercise the actual picker with state/effect/network ports, including selecting a POI.
const pickerSource = readFileSync(new URL('../src/components/admin/RoutePoiPicker.tsx', import.meta.url), 'utf8')
const pickerCompiled = ts.transpileModule(pickerSource, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText
const search = await import('../src/lib/route-poi-search.ts')
function pickerHarness(responses, initialProps = {}) {
  const state = [], effects = [], selected = [], requests = []
  let cursor = 0, effectCursor = 0
  const exports = {}
  const props = {routeSlug: 'intercity/enoshima', stopIds: ['POI-000017'], disabled: false, onSelect: async p => { selected.push(p.poiId) }, ...initialProps}
  vm.runInNewContext(pickerCompiled, {exports, AbortController, Error, window: {setTimeout: () => 1, clearTimeout() {}}, fetch: async (url, options) => {
    requests.push({url, ...options}); const response = responses.shift(); if (response instanceof Error) throw response; return response
  }, require(id) {
    if (id === 'react') return {
      useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }] },
      useMemo: fn => fn(),
      useEffect(fn, deps) { const index = effectCursor++; const previous = effects[index]; if (!previous || deps.some((d, i) => d !== previous.deps[i])) { previous?.cleanup?.(); effects[index] = {deps, run: fn} } },
    }
    if (id === 'react/jsx-runtime') return {jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props}), Fragment: 'fragment'}
    if (id === 'next/image') return { default: 'img' }
    if (id === '@/lib/route-poi-search') return search
    if (id === './ui') return {adminInputClass: '', adminSecondaryButtonClass: ''}
    throw Error(id)
  }})
  function render() { cursor = 0; effectCursor = 0; const tree = exports.RoutePoiPicker(props); for (const effect of effects) if (effect.run) {effect.cleanup = effect.run(); effect.run = null} return tree }
  return {render, selected, requests, props}
}
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)] }
function content(tree) { if (tree == null || typeof tree === 'boolean') return ''; if (typeof tree !== 'object') return String(tree); return [tree.props?.children].flat(Infinity).map(content).join('') }
const tick = async () => { await new Promise(resolve => setImmediate(resolve)) }
const catalogResponse = {ok: true, json: async () => ({pois: records, cities})}
const picker = pickerHarness([catalogResponse])
assert.match(content(picker.render()), /Загружаю места/)
await tick()
let tree = picker.render()
assert.equal(nodes(tree).find(n => n.type === 'select').props.value, 'enoshima')
assert.match(content(tree), /Аквариум Эносима/)
assert.match(content(tree), /Эносима Дайси/)
assert.equal(nodes(tree).find(n => n.type === 'img').props.src, '/tours/photo-library/aquarium.webp')
assert.match(content(tree), /нет фото/)
assert.equal(nodes(tree).find(n => n.type === 'button' && content(n).includes('Пещеры Ивая')).props.disabled, true)
nodes(tree).find(n => n.type === 'button' && content(n).includes('Аквариум Эносима')).props.onClick()
await tick(); assert.deepEqual(picker.selected, ['POI-000018'], 'only the chosen POI is added')
nodes(tree).find(n => n.type === 'input').props.onChange({target: {value: 'океанариум'}})
tree = picker.render()
assert.match(content(tree), /Найдено: 1/)
assert.equal(content(tree).includes('Эносима Дайси'), false)
nodes(tree).find(n => n.type === 'input').props.onChange({target: {value: 'Сэнсодзи'}})
tree = picker.render()
assert.match(content(tree), /В этом направлении совпадений нет/)
nodes(tree).find(n => n.type === 'button' && content(n) === 'Искать во всех направлениях').props.onClick()
tree = picker.render()
assert.match(content(tree), /Сэнсодзи/)
assert.equal(nodes(tree).find(n => n.type === 'select').props.value, '')
const broken = pickerHarness([{ok: false, status: 503}, catalogResponse])
broken.render(); await tick(); tree = broken.render()
assert.match(content(tree), /Не удалось загрузить список POI/)
assert.equal(content(tree).includes('Совпадений нет'), false, 'service failure is not an empty search')
nodes(tree).find(n => n.type === 'button' && content(n) === 'Повторить загрузку').props.onClick()
broken.render(); await tick(); tree = broken.render()
assert.match(content(tree), /Аквариум Эносима/)
assert.equal(broken.requests[1].method, 'POST', 'explicit retry forces a fresh catalog')
const signedOut = pickerHarness([{ok: false, status: 401}])
signedOut.render(); await tick(); assert.match(content(signedOut.render()), /Сессия завершилась/)
const paged = pickerHarness([{ok: true, json: async () => ({pois: many, cities})}])
paged.render(); await tick(); tree = paged.render()
assert.equal(nodes(tree).filter(n => n.type === 'li').length, 12)
nodes(tree).find(n => n.type === 'button' && content(n) === 'Далее').props.onClick()
tree = paged.render(); assert.match(content(tree), /2 \/ 6/)
console.log('✓ RoutePoiPicker runtime: browse, add aquarium, already-added, search, broaden, pagination, errors and retry')
