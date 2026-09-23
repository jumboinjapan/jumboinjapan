/** Shared admission rule for route writers, link imports and the integrity audit. */
export interface RoutePoiReference {
  key: string
  poiId: unknown
}
export interface RouteReadyPoi {
  poiId: string
  nameRu: string
  approvedRu: string
  descriptionRu: string
  isSystem?: boolean
}
export interface RoutePoiIssue {
  key: string
  poiId: string
  code: 'missing_poi' | 'invalid_poi_id' | 'unknown_poi' | 'duplicate_poi_id' | 'empty_name' | 'empty_description'
}

export function routePoiIssues(refs: RoutePoiReference[], pois: RouteReadyPoi[]): RoutePoiIssue[] {
  const byId = new Map<string, RouteReadyPoi[]>()
  for (const poi of pois) byId.set(poi.poiId, [...(byId.get(poi.poiId) ?? []), poi])
  return refs.flatMap(ref => {
    const id = typeof ref.poiId === 'string' ? ref.poiId.trim() : ''
    const issue = (code: RoutePoiIssue['code']) => [{ key: ref.key, poiId: id, code }]
    if (!id) return issue('missing_poi')
    if (!/^POI-\d{6}$/.test(id)) return issue('invalid_poi_id')
    const matches = byId.get(id) ?? []
    if (!matches.length) return issue('unknown_poi')
    if (matches.length !== 1) return issue('duplicate_poi_id')
    const poi = matches[0]
    if (!poi.nameRu?.trim()) return issue('empty_name')
    // Explicit system POIs represent services; they still need a registered identity.
    if (!poi.isSystem && !(poi.approvedRu?.trim() || poi.descriptionRu?.trim())) return issue('empty_description')
    return []
  })
}

export class RoutePoiReadinessError extends Error {
  readonly code = 'ROUTE_POI_NOT_READY'
  readonly issues: RoutePoiIssue[]
  constructor(issues: RoutePoiIssue[]) {
    const labels = { missing_poi: 'не указан POI', invalid_poi_id: 'неверный ID', unknown_poi: 'POI не найден', duplicate_poi_id: 'ID неоднозначен', empty_name: 'нет названия', empty_description: 'нет описания для сайта' }
    super(`Сначала подготовьте POI для всех локаций маршрута: ${issues.map(i => `${i.key} (${i.poiId || 'нет POI ID'}: ${labels[i.code]})`).join('; ')}`)
    this.name = 'RoutePoiReadinessError'
    this.issues = issues
  }
}

export function assertRoutePoisReady(refs: RoutePoiReference[], pois: RouteReadyPoi[]) {
  const issues = routePoiIssues(refs, pois)
  if (issues.length) throw new RoutePoiReadinessError(issues)
}
