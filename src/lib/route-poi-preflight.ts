import { POI_TABLE_ID } from './airtable-schema'
import { fetchAirtableWithRetry } from './airtable-retry'
import { assertRoutePoisReady, RoutePoiReadinessError, type RoutePoiReference, type RouteReadyPoi } from './route-poi-readiness'

/** Fresh, uncached GETs only. No public fallback and no POI creation inside route writes. */
export async function preflightRoutePois(refs: RoutePoiReference[]): Promise<void> {
  const malformed = refs.filter(r => typeof r.poiId !== 'string' || !/^POI-\d{6}$/.test(r.poiId.trim()))
  if (malformed.length) assertRoutePoisReady(malformed, [])
  if (!refs.length) return
  const token = process.env.AIRTABLE_TOKEN?.trim()
  const baseId = process.env.AIRTABLE_BASE_ID?.trim()
  if (!token || !baseId) throw new Error('POI preflight requires Airtable credentials')
  const ids = [...new Set(refs.map(r => (r.poiId as string).trim()))]
  const pois: RouteReadyPoi[] = []
  for (let start = 0; start < ids.length; start += 50) {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${POI_TABLE_ID}`)
    url.searchParams.set('filterByFormula', `OR(${ids.slice(start, start + 50).map(id => `{POI ID}='${id}'`).join(',')})`)
    for (const field of ['POI ID', 'POI Name (RU)', 'Description Approved (RU)', 'Description (RU)', 'Is System']) url.searchParams.append('fields[]', field)
    let offset: string | undefined
    do {
      if (offset) url.searchParams.set('offset', offset)
      const res = await fetchAirtableWithRetry(url.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      if (!res.ok) throw new Error(`POI preflight read failed: ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data.records)) throw new Error('POI preflight returned invalid records')
      for (const record of data.records) {
        if (!record.fields || typeof record.id !== 'string') throw new Error('POI preflight returned invalid record')
        const f = record.fields
        const text = (key: string) => typeof f[key] === 'string' ? f[key] : ''
        pois.push({ poiId: text('POI ID'), nameRu: text('POI Name (RU)'), approvedRu: text('Description Approved (RU)'), descriptionRu: text('Description (RU)'), isSystem: f['Is System'] === true })
      }
      offset = data.offset
    } while (offset)
  }
  assertRoutePoisReady(refs, pois)
}

export { RoutePoiReadinessError }
