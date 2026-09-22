import type { MultiDayBuilderCityOption, MultiDayBuilderPoiOption } from './multi-day-builder-data.ts'

export function normalizePoiSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[ёэ]/g, 'е')
    .replace(/океанариум/g, 'аквариум').replace(/[\s\p{P}]+/gu, ' ').trim()
}

export const destinationKey = (value: string) => normalizePoiSearch(value)

export function poiDestinations(pois: MultiDayBuilderPoiOption[], cities: MultiDayBuilderCityOption[]) {
  const names = new Map(cities.map(city => [destinationKey(city.nameEn), city.nameRu || city.nameEn]))
  const destinations = new Map<string, { value: string; label: string; count: number }>()
  for (const poi of pois) {
    const value = destinationKey(poi.siteCity)
    if (!value || poi.isSystem) continue
    const current = destinations.get(value)
    if (current) current.count++
    else destinations.set(value, { value, label: names.get(value) || poi.siteCity, count: 1 })
  }
  return [...destinations.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'))
}

/** An exact route destination wins; otherwise use a single shared stop destination. */
export function defaultPoiDestination(routeSlug: string, stopIds: string[], pois: MultiDayBuilderPoiOption[]) {
  const suffix = destinationKey(routeSlug.split('/').at(-1) || '')
  if (suffix && pois.some(poi => !poi.isSystem && destinationKey(poi.siteCity) === suffix)) return suffix
  const selected = new Set(stopIds)
  const destinations = new Set(pois.filter(poi => selected.has(poi.poiId) && !poi.isSystem)
    .map(poi => destinationKey(poi.siteCity)).filter(Boolean))
  return destinations.size === 1 ? [...destinations][0] : ''
}

/** Filter before pagination, so every matching POI remains reachable. */
export function filterRoutePois(
  pois: MultiDayBuilderPoiOption[], query: string, destination = '', cities: MultiDayBuilderCityOption[] = [],
) {
  const words = normalizePoiSearch(query).split(' ').filter(Boolean)
  const labels = new Map(poiDestinations(pois, cities).map(item => [item.value, item.label]))
  return pois.filter(poi => {
    if (!poi.poiId || (destination && destinationKey(poi.siteCity) !== destination)) return false
    const text = normalizePoiSearch([poi.nameRu, poi.nameEn, poi.poiId, poi.siteCity,
      labels.get(destinationKey(poi.siteCity)), poi.categoryRu].filter(Boolean).join(' '))
    return words.every(word => text.includes(word))
  }).sort((a, b) => (a.nameRu || a.nameEn || a.poiId).localeCompare(b.nameRu || b.nameEn || b.poiId, 'ru'))
}
