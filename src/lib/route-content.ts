import { requirePublicRoute } from './route-registry'
import { cache } from 'react'
import { getIntercityRouteStopsCached, getPoisByIds } from './airtable'
import { publicDataCache } from './public-data-cache'

const getRoutePois = cache(publicDataCache(
  (ids: string[]) => getPoisByIds(ids),
  ['route-content-pois'],
  { tags: ['airtable:pois'], revalidate: 3600 },
))

/** Route membership comes from Route Stops, never from a POI's Site City. */
export const getRouteContent = cache(async (slug: string, additionalPoiIds: readonly string[] = []) => {
  await requirePublicRoute(slug, 'Tour')
  const routeStopRecords = await getIntercityRouteStopsCached(slug)
  const ids = [...new Set([...routeStopRecords.filter(stop => !['Inactive', 'Archived'].includes(stop.status))
    .map(stop => stop.poiId), ...additionalPoiIds].filter(Boolean))].sort()
  const pois = await getRoutePois(ids)
  return { routeStopRecords, pois }
})
