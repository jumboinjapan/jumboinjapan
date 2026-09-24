import type { AirtablePoi, AirtableRouteStop } from './airtable'
import type { CityTourStop } from '@/components/sections/CityTourDayPage'

/** Airtable owns membership/order; composite stops without a POI remain visible. */
export function buildCityTourLiveStops(records: AirtableRouteStop[], pois: AirtablePoi[]): CityTourStop[] {
  const byId = new Map(pois.map(poi => [poi.poiId, poi]))
  return records.filter(stop => !stop.isHelper && stop.status !== 'Inactive')
    .sort((a, b) => a.order - b.order)
    .map((stop, index) => {
      const poi = byId.get(stop.poiId)
      return {
        id: stop.routeStopId || stop.recordId,
        number: String(index + 1).padStart(2, '0'),
        title: stop.titleOverride || poi?.nameRu || stop.poiNameSnapshot,
        text: stop.descriptionOverride || poi?.approvedRu || poi?.descriptionRu || '',
        duration: '',
        photo: stop.photoPath || undefined,
        alt: stop.photoAlt || undefined,
      }
    })
}
