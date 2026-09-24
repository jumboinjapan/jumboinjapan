/**
 * Страницы форматов поездки не должны попадать в редакторы маршрутов.
 *
 * Зачем. 17.05 их убрали из белого списка «Остановок маршрутов» руками,
 * 05.07 белый список заменили правилом по префиксу — и исключение молча
 * потерялось (разбор 2026-09-25). Тест держит три вещи:
 *   1. список TRAVEL_FORMAT_PAGE_SLUGS совпадает с реальными страницами на
 *      TravelFormatPage — новая страница формата без записи в списке роняет тест;
 *   2. правила отбора: что показывается в «Остановках», что в «Текстах»;
 *   3. проводку: API-роуты берут правила из admin-route-packages.ts, а не
 *      держат свои копии префиксов, и список Routes читается постранично.
 * Сеть не трогается: fetch подменён.
 */
import { registerHooks } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { resolve as resolveAlias } from './support/alias-loader.mjs'

registerHooks({ resolve: resolveAlias })
const packages = await import('../src/lib/admin-route-packages.ts')
const {
  TRAVEL_FORMAT_PAGE_SLUGS,
  isTravelFormatPageSlug,
  isRouteStopsSlug,
  isRouteTextSlug,
  isRouteStopsListEntry,
  fetchAllRoutesRecords,
  AirtableListError,
} = packages

const REPO = path.resolve(import.meta.dirname, '..')
const APP = path.join(REPO, 'src', 'app')

let passed = 0
const equal = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: получено ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(expected)}`)
  }
  passed += 1
}
const ok = (label, value) => equal(label, Boolean(value), true)

/* 1. Список совпадает со страницами на TravelFormatPage. */
function pageFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...pageFiles(full))
    else if (entry.name === 'page.tsx') out.push(full)
  }
  return out
}
const formatPages = pageFiles(APP)
  .filter((file) => /from\s+["']@\/components\/sections\/TravelFormatPage["']/.test(readFileSync(file, 'utf8')))
  .map((file) => path.relative(APP, path.dirname(file)).split(path.sep).join('/'))
  .sort()
ok('найдены страницы на TravelFormatPage', formatPages.length > 0)
equal('TRAVEL_FORMAT_PAGE_SLUGS = страницы на TravelFormatPage', [...TRAVEL_FORMAT_PAGE_SLUGS].sort(), formatPages)

/* 2. Правила отбора. */
for (const slug of TRAVEL_FORMAT_PAGE_SLUGS) {
  ok(`${slug}: страница формата`, isTravelFormatPageSlug(slug))
  equal(`${slug}: не в «Остановках»`, isRouteStopsSlug(slug), false)
  equal(`${slug}: не в «Текстах»`, isRouteTextSlug(slug), false)
}
for (const slug of ['city-tour/day-one', 'city-tour/hidden-spots', 'city-tour/takao', 'intercity/hakone', 'intercity/nokogiriyama']) {
  ok(`${slug}: в «Остановках»`, isRouteStopsSlug(slug))
  ok(`${slug}: в «Текстах»`, isRouteTextSlug(slug))
}
equal('multi-day/*: не в «Остановках»', isRouteStopsSlug('multi-day/japan-first-touch-7-days'), false)
ok('multi-day/*: в «Текстах»', isRouteTextSlug('multi-day/japan-first-touch-7-days'))
for (const hub of ['city-tour', 'intercity', 'multi-day', '']) {
  equal(`хаб «${hub}»: не в «Остановках»`, isRouteStopsSlug(hub), false)
}
equal('похожий, но другой slug не исключается', isTravelFormatPageSlug('city-tour/public-2'), false)
ok('черновик пакета в списке', isRouteStopsListEntry('intercity/osaka', 'Draft'))
ok('опубликованный пакет в списке', isRouteStopsListEntry('intercity/nokogiriyama', 'Published'))
ok('пакет без статуса в списке', isRouteStopsListEntry('city-tour/takao', undefined))
equal('архивный пакет не в списке', isRouteStopsListEntry('intercity/osaka', 'Archived'), false)
equal('страница формата не в списке при любом статусе', isRouteStopsListEntry('city-tour/public', 'Draft'), false)

/* 3a. Чтение Routes постранично. */
const realFetch = globalThis.fetch
const calls = []
globalThis.fetch = async (url) => {
  const u = new URL(String(url))
  calls.push(u)
  const page = u.searchParams.get('offset')
  const body = page === null
    ? { records: [{ id: 'rec1', fields: { Slug: 'intercity/a' } }, { id: 'rec2', fields: { Slug: 'intercity/b' } }], offset: 'itrNEXT' }
    : { records: [{ id: 'rec3', fields: { Slug: 'city-tour/c' } }] }
  return new Response(JSON.stringify(body), { status: 200 })
}
try {
  const records = await fetchAllRoutesRecords({ token: 't', baseId: 'appX', tableId: 'tblY', fields: ['Slug', 'Status'] })
  equal('все страницы собраны', records.map((r) => r.id), ['rec1', 'rec2', 'rec3'])
  equal('два запроса', calls.length, 2)
  equal('offset передан во втором запросе', calls[1].searchParams.get('offset'), 'itrNEXT')
  equal('поля запрошены', calls[0].searchParams.getAll('fields[]'), ['Slug', 'Status'])

  globalThis.fetch = async () => new Response('{"error":"NOT_AUTHORIZED"}', { status: 403 })
  let thrown = null
  try {
    await fetchAllRoutesRecords({ token: 't', baseId: 'appX', tableId: 'tblY', fields: ['Slug'] })
  } catch (err) {
    thrown = err
  }
  ok('ошибка Airtable — исключение, а не пустой список', thrown instanceof AirtableListError)
  equal('статус ошибки сохранён', thrown?.status, 403)
} finally {
  globalThis.fetch = realFetch
}

/* 3b. Проводка: роуты не держат свои копии правил. */
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8')
const routesApi = read('src/app/api/admin/route-stops/routes/route.ts')
const textApi = read('src/app/api/admin/route-text/route.ts')
const stopsApi = read('src/app/api/admin/route-stops/stops/route.ts')
for (const [name, src] of [['route-stops/routes', routesApi], ['route-text', textApi]]) {
  equal(`${name}: нет своей копии префиксов`, /MANAGED_PREFIXES|startsWith\(\s*['"](intercity|city-tour|multi-day)\//.test(src), false)
  equal(`${name}: нет чтения Routes одной страницей`, /pageSize=100|searchParams\.set\(\s*['"]pageSize/.test(src), false)
  ok(`${name}: читает Routes через fetchAllRoutesRecords`, src.includes('fetchAllRoutesRecords('))
}
ok('route-stops/routes GET фильтрует через isRouteStopsListEntry', routesApi.includes('isRouteStopsListEntry('))
ok('route-stops/routes POST не создаёт пакет на адресе страницы формата', routesApi.includes('isTravelFormatPageSlug(slug)'))
ok('route-text GET фильтрует через isRouteTextSlug', textApi.includes('isRouteTextSlug('))
ok('stops POST отклоняет не-маршруты', stopsApi.includes('isRouteStopsSlug(routeSlug)'))

console.log(`admin-route-packages: ${passed} проверок пройдено`)
