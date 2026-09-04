/**
 * Preload для запуска НАСТОЯЩЕГО scripts/refresh-google-coords.mjs без сети:
 *   COORDS_REFRESH_FIXTURE='{"records":[…],"google":{…}}' COORDS_REFRESH_OUT=<файл> \
 *   node --import ./tests/support/coords-refresh-preload.mjs scripts/refresh-google-coords.mjs [--apply]
 * Подмена fetch ставится до загрузки скрипта; при выходе процесса в файл
 * пишутся все запросы, все PATCH и состояние записей после них.
 */
import { writeFileSync } from 'node:fs'
import { installCoordsRefreshFetch } from './coords-refresh-harness.mjs'

const fixture = JSON.parse(process.env.COORDS_REFRESH_FIXTURE ?? '{}')
// `ownerIntervenes: { after: 'google' | 'listing', set: { <recId>: { <fieldId>: value | null } } }` —
// владелец меняет записи после первого запроса к Google (или после первого чтения списка), до PATCH.
// `after`: 'google' | 'listing' | 'patch' | 'freshRead'; `nth` — на каком по счёту запросе этого вида (по умолчанию 1).
const intervene = fixture.ownerIntervenes ?? null
let done = false
let matched = 0
const onRequest = (req, api) => {
  if (!intervene || done) return
  const isFreshRead = req.method === 'GET' && req.host === 'api.airtable.com' && req.url.searchParams.has('filterByFormula')
  const hit = intervene.after === 'listing' ? req.host === 'api.airtable.com' && req.method === 'GET' && !isFreshRead
    : intervene.after === 'patch' ? req.method === 'PATCH'
      : intervene.after === 'freshRead' ? isFreshRead
        : req.host === 'places.googleapis.com'
  if (!hit) return
  matched += 1
  if (matched !== (intervene.nth ?? 1)) return
  done = true
  for (const [id, fields] of Object.entries(intervene.set ?? {})) api.set(id, fields)
}
// `throwOn: { which: 'freshRead' | 'patch', nth, kind: 'revokedProxy' | 'null' | 'symbol' | 'throwingGetter' }` —
// n-й запрос указанного вида бросает враждебное значение (граница чтения/записи).
const throwOn = fixture.throwOn ?? null
let seen = 0
const hostile = {
  revokedProxy: () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy },
  null: () => null,
  symbol: () => Symbol('x'),
  throwingGetter: () => ({ get message() { throw new Error('getter') }, get name() { throw new Error('getter') } }),
}
const onRequestAll = (req, api) => {
  onRequest(req, api)
  if (!throwOn) return
  const isFresh = req.method === 'GET' && req.host === 'api.airtable.com' && req.url.searchParams.has('filterByFormula')
  const isListing = req.method === 'GET' && req.host === 'api.airtable.com' && !req.url.searchParams.has('filterByFormula')
  const hit = throwOn.which === 'freshRead' ? isFresh : throwOn.which === 'listing' ? isListing : req.method === 'PATCH'
  if (!hit) return
  seen += 1
  if (seen === (throwOn.nth ?? 1)) throw hostile[throwOn.kind ?? 'revokedProxy']()
}
const fx = installCoordsRefreshFetch({ records: fixture.records ?? [], google: fixture.google ?? {}, onRequest: onRequestAll })
process.on('exit', (code) => {
  const out = {
    exitCode: code,
    requests: fx.requests,
    patches: fx.patches,
    written: fx.written(),
    after: Object.fromEntries((fixture.records ?? []).map((r) => [r.id, fx.record(r.id)])),
  }
  if (process.env.COORDS_REFRESH_OUT) writeFileSync(process.env.COORDS_REFRESH_OUT, JSON.stringify(out))
})
