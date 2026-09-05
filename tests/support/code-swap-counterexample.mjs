/**
 * Контрпример «код подменили, пока шёл прогон» — исполняется ТОЛЬКО в
 * песочнице-копии (10f-Q R3, находка аудита о тестах).
 *
 * Прежняя редакция правила настоящий `src/lib/prefectures.ts` и восстанавливала
 * его в `finally`: прерванный процесс оставил бы подмену в рабочем дереве, а
 * параллельная правка владельца была бы затёрта. Здесь файл правится внутри
 * копии, и рабочее дерево не затрагивается ни при каком исходе.
 *
 * Этот файл кладётся в корень песочницы (`createProductionSandbox({ patch })`)
 * и запускается там: `cwd` — корень песочницы, импорты — относительные.
 * Печатает РОВНО одну строку JSON последней.
 */
import { appendFileSync, writeFileSync } from 'node:fs'

const NL = String.fromCharCode(10)
const HEADERS = ['ID', '名称', '名称_英語', '所在地_都道府県', '所在地_市区町村', '所在地_連結表記', '緯度', '経度', 'URL'].join(',')
const ROW = ['"1"', '"大阪城"', '"Osaka Castle"', '"大阪府"', '"大阪市"', '"大阪府大阪市中央区大阪城1-1"', '"34.6873"', '"135.5259"', '"https://example.invalid/1"'].join(',')
const CSV = [HEADERS, ROW, ''].join(NL)

const stubFetch = async (u) => {
  const url = String(u)
  if (url.includes('package_show')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: {
          license_id: 'cc-by',
          metadata_modified: '2026-03-30T00:00:00',
          resources: [{ format: 'CSV', url: 'https://example.invalid/data.csv', last_modified: '2026-03-30T00:00:00' }],
        },
      }),
    }
  }
  if (url.includes('data.csv')) {
    return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(CSV).buffer }
  }
  throw new Error(`сеть не предусмотрена: ${url}`)
}

const collect = await import('./scripts/poi-portals/collect-pois.mjs')
const opendata = await import('./scripts/poi-portals/lib/opendata-csv.mjs')

writeFileSync('existing.json', JSON.stringify([{
  poiId: 'POI-000700',
  recordId: 'rec700',
  nameRu: 'Ничего похожего',
  nameEn: 'Nothing Alike',
  siteCity: 'tokyo',
  lat: 35.7,
  lon: 139.7,
  placeId: null,
  sourceKey: null,
}]))
writeFileSync('names.json', JSON.stringify({ 'bodik-osaka-tourism:1': { nameRu: 'Замок Осака' } }))

/** Хранилище и резолвер падают на ЛЮБОМ обращении: «не дошли» доказывается ими. */
const calls = { store: 0, resolver: 0 }
const explodingStore = new Proxy({}, {
  get(_target, property) {
    calls.store += 1
    throw new Error(`к хранилищу обратились: ${String(property)}`)
  },
})
const explodingResolver = () => {
  calls.resolver += 1
  throw new Error('к резолверу обратились')
}

/* Подмена — ВНУТРИ песочницы и ровно между первым снимком кода (он снят до
   первого адаптера) и вторым (перед gate). */
const sabotage = process.env.JJ_SABOTAGE === '1'
const adapters = {
  'opendata-csv': async (portal, options) => {
    if (sabotage) appendFileSync('src/lib/prefectures.ts', `${NL}export const PODMENA = true${NL}`)
    return opendata.collectFromOpenDataCsv(portal, { ...options, fetchImpl: stubFetch })
  },
}

const target = { exitCode: 0 }
let persisted = null
let thrown = null
const realLog = console.log
const realErr = console.error
const errored = []
console.log = () => {}
console.error = (...parts) => errored.push(parts.map(String).join(' '))
try {
  await collect.runCli([
    'node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism', '--dry-write',
    '--existing', 'existing.json', '--names', 'names.json', '--out', 'run.json',
  ], {
    adapters,
    persistReport: async (_path, report) => { persisted = report },
    store: explodingStore,
    placeResolver: explodingResolver,
    resolveCodeIdentity: () => ({ commit: '0'.repeat(40), dirty: false }),
    now: new Date('2026-09-04T00:00:00.000Z'),
  }, target)
} catch (error) {
  thrown = error instanceof Error ? error.message : String(error)
} finally {
  console.log = realLog
  console.error = realErr
}

console.log(JSON.stringify({
  thrown,
  errored: errored.join(String.fromCharCode(10)),
  exitCode: target.exitCode,
  calls,
  hasManifest: Boolean(persisted?.manifest),
  graphFiles: persisted?.manifest?.code?.graph?.files ?? null,
}))
