import { fetchAirtableWithRetry } from './airtable-retry.ts'
import { AIRTABLE_BASE_ID, ROUTES_TABLE_ID, ROUTE_STOPS_TABLE_ID, DAY_ITEMS_TABLE_NAME, POI_TABLE_ID } from './airtable-schema.ts'
import { applyRouteReadiness, parseRouteRegistry, routeReferences, type RegistryRecord } from './route-publication.ts'

/** Fresh, paginated reads. Failure is never interpreted as an empty catalogue. */
export async function readRegistryRecords(table: string, fields: string[] = [], formula?: string): Promise<RegistryRecord[]> {
  const token = process.env.AIRTABLE_TOKEN?.trim()
  if (!token) throw new Error('Route registry requires Airtable credentials')
  const records: RegistryRecord[] = []
  const offsets = new Set<string>()
  let offset = ''
  do {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`)
    url.searchParams.set('pageSize', '100')
    fields.forEach(field => url.searchParams.append('fields[]', field))
    if (formula) url.searchParams.set('filterByFormula', formula)
    if (offset) url.searchParams.set('offset', offset)
    const response = await fetchAirtableWithRetry(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(45000) })
    if (!response.ok) throw new Error(`Route registry read failed (${table}): ${response.status}`)
    const data = await response.json()
    if (!Array.isArray(data.records) || data.records.some((r: RegistryRecord) => !r || typeof r.id !== 'string' || !r.fields || typeof r.fields !== 'object' || Array.isArray(r.fields))) throw new Error('Invalid route registry response')
    records.push(...data.records)
    if (data.offset !== undefined && (typeof data.offset !== 'string' || !data.offset || offsets.has(data.offset))) throw new Error('Invalid route registry pagination')
    offset = data.offset ?? ''
    offsets.add(offset)
  } while (offset)
  return records
}
export async function assessRegistryRecords(records: RegistryRecord[]) {
  const routes = parseRouteRegistry(records)
  const publishedTours = routes.filter(r => r.status === 'Published' && r.contentKind === 'Tour')
  if (!publishedTours.length) return routes
  const stops = await readRegistryRecords(ROUTE_STOPS_TABLE_ID, ['Route Slug', 'POI ID', 'Status', 'Is Helper'])
  const items = await readRegistryRecords(DAY_ITEMS_TABLE_NAME, ['Route Slug', 'POI ID', 'Item Type'])
  const ids = [...new Set(publishedTours.flatMap(r => routeReferences(r.slug, stops, items))
    .flatMap(r => typeof r.poiId === 'string' && /^POI-\d{6}$/.test(r.poiId.trim()) ? [r.poiId.trim()] : []))]
  const poiRecords: RegistryRecord[] = []
  for (let i = 0; i < ids.length; i += 50) {
    poiRecords.push(...await readRegistryRecords(POI_TABLE_ID,
      ['POI ID', 'POI Name (RU)', 'Description Approved (RU)', 'Description (RU)', 'Is System'],
      `OR(${ids.slice(i, i + 50).map(id => `{POI ID}='${id}'`).join(',')})`))
  }
  return applyRouteReadiness(routes, stops, items, poiRecords.map(({ fields: f }) => {
    const text = (key: string) => typeof f[key] === 'string' ? f[key] as string : ''
    return { poiId: text('POI ID'), nameRu: text('POI Name (RU)'), approvedRu: text('Description Approved (RU)'), descriptionRu: text('Description (RU)'), isSystem: f['Is System'] === true }
  }))
}

export async function readRouteRegistry() {
  return assessRegistryRecords(await readRegistryRecords(ROUTES_TABLE_ID))
}
