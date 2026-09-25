import { routePoiIssues, type RoutePoiReference, type RouteReadyPoi } from './route-poi-readiness.ts'

/** Routes owns publication. Route Type is geography, Content Kind is the product. */
export const ROUTE_SECTIONS = ['city-tour', 'intercity', 'multi-day'] as const
export const CONTENT_KINDS = ['Tour', 'Collection', 'Service', 'Format'] as const
export type ContentKind = typeof CONTENT_KINDS[number]
export const ROUTE_STATUSES = ['Draft', 'Review', 'Published', 'Archived'] as const
export const CONTENT_KIND_LABELS: Record<ContentKind, string> = {
  Tour: 'Тур', Collection: 'Раздел каталога', Service: 'Услуга', Format: 'Идея поездки',
}
export const ROUTE_STATUS_LABELS = { Draft: 'Черновик', Review: 'На проверке', Published: 'Опубликовано', Archived: 'В архиве' }
export interface RegistryRecord { id: string; fields: Record<string, unknown> }
export interface RoutePublication {
  id: string; slug: string; routeType: string; title: string; description: string; image: string
  contentKind: string; status: string; ready: boolean; issues: string[]
  dayCount: number; startCity: string; endCity: string
}
export function isRouteSlug(value: unknown): value is string {
  return typeof value === 'string' && /^(city-tour|intercity|multi-day)(\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(value)
}
export function isPublicRoute(route: Pick<RoutePublication, 'contentKind' | 'status' | 'ready' | 'routeType'> | undefined, kind?: ContentKind): boolean {
  return Boolean(route && ROUTE_SECTIONS.some(section => section === route.routeType) && route.status === 'Published' && CONTENT_KINDS.includes(route.contentKind as ContentKind)
    && (!kind || route.contentKind === kind) && (route.contentKind !== 'Tour' || route.ready))
}
export function isIndexableRoute(route: RoutePublication): boolean {
  return isPublicRoute(route) && route.contentKind !== 'Format'
}
export function parseRouteRegistry(records: RegistryRecord[]): RoutePublication[] {
  const seen = new Set<string>()
  return records.filter(r => isRouteSlug(r.fields.Slug)).map(({ id, fields: f }) => {
    const text = (key: string) => typeof f[key] === 'string' ? f[key] as string : ''
    const slug = text('Slug')
    if (seen.has(slug)) throw new Error(`Duplicate route slug: ${slug}`)
    seen.add(slug)
    return { id, slug, routeType: text('Route Type'), title: text('Title'), description: text('Preview Subtitle') || text('SEO Description Approved'),
      image: text('Hero Image Path'), status: text('Status'), contentKind: text('Content Kind'), ready: false, issues: [],
      dayCount: typeof f['Day Count'] === 'number' ? f['Day Count'] : 0, startCity: text('Start City'), endCity: text('End City') }
  })
}
/** A multi-day tour owns Day Items; a day tour owns Route Stops. No cross-source repair. */
export function routeReferences(slug: string, stops: RegistryRecord[], items: RegistryRecord[]): RoutePoiReference[] {
  const multiDay = slug.startsWith('multi-day/')
  return (multiDay ? items : stops).filter(({ fields: f }) => f['Route Slug'] === slug && (multiDay
    ? f['Item Type'] === 'poi' || Boolean(f['POI ID'])
    : !['Inactive', 'Archived'].includes(String(f.Status)) && !f['Is Helper']))
    .map(r => ({ key: r.id, poiId: r.fields['POI ID'] }))
}
export function applyRouteReadiness(routes: RoutePublication[], stops: RegistryRecord[], items: RegistryRecord[], pois: RouteReadyPoi[]): RoutePublication[] {
  return routes.map(route => {
    if (route.contentKind !== 'Tour' || route.status !== 'Published') return route
    const refs = routeReferences(route.slug, stops, items)
    const issues = refs.length ? routePoiIssues(refs, pois).map(i => `${i.key}: ${i.code} (${i.poiId})`) : ['empty_tour']
    return { ...route, ready: issues.length === 0, issues }
  })
}
