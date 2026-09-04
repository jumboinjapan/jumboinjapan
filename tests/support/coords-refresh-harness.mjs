/**
 * Песочница для писателей координат (крон `refresh-coords` и ручной
 * `refresh-google-coords.mjs`): подмена `globalThis.fetch`, которая ведёт себя
 * как Airtable REST и Google Places (v1, маска `location`) на фикстуре и
 * записывает КАЖДЫЙ PATCH. Любой другой адрес — исключение: сети нет.
 *
 * Верность подмены важнее удобства: Airtable отдаёт ТОЛЬКО поля, названные в
 * `fields[]` (по ID при `returnFieldsByFieldId=true`), и подмена делает то же —
 * писатель, не запросивший `Coordinate Policy`, политики не увидит, как и в
 * живой базе. `filterByFormula=OR(RECORD_ID()='…',…)` поддержан ровно в этой
 * форме — так писатель перечитывает записи перед PATCH.
 *
 * `onRequest(req, api)` — хук на КАЖДЫЙ запрос до ответа: им тест меняет
 * состояние «руками владельца» между чтением писателя и его PATCH
 * (`api.set(id, fields)`), воспроизводя гонку без сети и без сна.
 */

export const POI_FIELD = {
  poiId: 'fldy45Q8BDoVBEqN3',
  nameRu: 'fldem9kh1JxrC5jO1',
  lat: 'fldZRgmrRxVNjjWw1',
  lon: 'fldd0EzyStsrS8H0U',
  placeId: 'fldtOfrS1NCSLH69d',
  checkedAt: 'fldTJvNJTvpzaTci2',
  coordinatePolicy: 'fldMbERbAHZe67gNq',
  notes: 'fldB3e6oDzJjuS0oV',
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * @param {object} opts
 * @param {Array<{ id: string, fields: Record<string, unknown> }>} opts.records  записи POI, поля по ID
 * @param {Record<string, { lat: number, lon: number } | { gone: true } | { error: string }>} opts.google  ответ по placeId
 * @param {(req: { index: number, method: string, url: URL, host: string }, api: { set(id: string, fields: Record<string, unknown>): void, get(id: string): Record<string, unknown> | null }) => void} [opts.onRequest]
 */
export function installCoordsRefreshFetch({ records, google, onRequest }) {
  const patches = []
  const requests = []
  const state = new Map(records.map((r) => [r.id, { ...r, fields: { ...r.fields } }]))
  const api = {
    set(id, fields) { const cur = state.get(id); if (!cur) throw new Error(`нет записи ${id}`); for (const [k, v] of Object.entries(fields)) { if (v === null || v === undefined) delete cur.fields[k]; else cur.fields[k] = v } },
    get(id) { return state.get(id)?.fields ?? null },
  }
  const original = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = (init.method ?? 'GET').toUpperCase()
    const entry = { method, url: url.href, body: typeof init.body === 'string' ? init.body : null }
    requests.push(entry)
    onRequest?.({ index: requests.length - 1, method, url, host: url.hostname }, api)
    if (url.hostname === 'places.googleapis.com') {
      const placeId = decodeURIComponent(url.pathname.split('/').pop() ?? '')
      const g = google[placeId]
      if (!g) return json({ error: { status: 'NOT_FOUND', message: 'нет такого места' } }, 404)
      if ('gone' in g) return json({ error: { status: 'NOT_FOUND', message: 'удалено' } }, 404)
      if ('error' in g) return json({ error: { status: 'INTERNAL', message: g.error } }, 500)
      return json({ location: { latitude: g.lat, longitude: g.lon } })
    }
    if (url.hostname === 'api.airtable.com') {
      if (method === 'GET') {
        const wanted = url.searchParams.getAll('fields[]')
        const byId = url.searchParams.get('returnFieldsByFieldId') === 'true'
        if (!byId) throw new Error('подмена Airtable: ожидается returnFieldsByFieldId=true (иначе fields[] — имена)')
        const formula = url.searchParams.get('filterByFormula')
        let pool = [...state.values()]
        if (formula) {
          const m = formula.match(/^OR\((?:RECORD_ID\(\)='rec[^']+'(?:,|\))?)+$/)
          if (!m) throw new Error(`подмена Airtable: поддержан только OR(RECORD_ID()='…',…); получено ${formula}`)
          const ids = new Set([...formula.matchAll(/RECORD_ID\(\)='(rec[^']+)'/g)].map((x) => x[1]))
          pool = pool.filter((r) => ids.has(r.id))
        }
        const out = pool.map((r) => ({
          id: r.id,
          fields: Object.fromEntries(Object.entries(r.fields).filter(([k, v]) => (wanted.length === 0 || wanted.includes(k)) && v !== null && v !== undefined)),
        }))
        return json({ records: out })
      }
      if (method === 'PATCH') {
        const body = JSON.parse(init.body)
        patches.push(body)
        for (const rec of body.records) {
          const cur = state.get(rec.id)
          if (!cur) return json({ error: { type: 'ROW_DOES_NOT_EXIST' } }, 404)
          Object.assign(cur.fields, rec.fields)
          // Как Airtable: поле dateTime хранится с точностью до секунды — миллисекунды
          // записанной отметки не переживают запись и возвращаются как `.000Z`.
          const stamp = cur.fields[POI_FIELD.checkedAt]
          if (typeof stamp === 'string' && Number.isFinite(Date.parse(stamp))) {
            cur.fields[POI_FIELD.checkedAt] = new Date(Math.floor(Date.parse(stamp) / 1000) * 1000).toISOString()
          }
        }
        return json({ records: body.records })
      }
      throw new Error(`подмена Airtable: метод ${method} не ожидался`)
    }
    throw new Error(`сети нет: ${method} ${url.href}`)
  }
  return {
    patches,
    requests,
    /** Текущее состояние записи после всех PATCH. */
    record: (id) => state.get(id)?.fields ?? null,
    /** Все PATCH-записи, расплющенные: [{ id, fields }]. */
    written: () => patches.flatMap((b) => b.records),
    restore: () => { globalThis.fetch = original },
  }
}
