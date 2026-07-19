import type { AirtableRouteStop } from '@/lib/airtable'

/**
 * Мост между админкой (Route Stops) и городскими днями.
 *
 * Страницы city-tour/day-one, day-two и hidden-spots исторически держат
 * тексты остановок в коде. Записи Route Stops для них существовали, но
 * страницы читали из Airtable только порядок — правки описаний из
 * админ-редактора (Stop Description Override Approved (RU)) на лайв не
 * попадали. Этот помощник накладывает override из админки поверх кодовых
 * значений — по той же приоритетной схеме, что buildIntercityRouteStopsFromAirtable
 * на intercity-страницах (override из админки выигрывает, код — fallback), —
 * и заодно сортирует остановки по полю «№».
 *
 * Сопоставление записи с кодовой остановкой — по POI Name Snapshot или
 * Stop Title Override (записи Route Stops сеялись с живых страниц, поэтому
 * snapshot совпадает с кодовым title).
 */
export interface CityTourStopLike {
  id: string
  number: string
  title: string
  text: string
  duration: string
  photo: string
  alt?: string
}

export function applyCityTourStopOverrides<T extends CityTourStopLike>(
  baseStops: T[],
  airtableStops: AirtableRouteStop[],
): T[] {
  const active = airtableStops.filter((s) => !s.isHelper && s.status !== 'Inactive')

  const byKey = new Map<string, AirtableRouteStop>()
  for (const record of active) {
    if (record.poiNameSnapshot) byKey.set(record.poiNameSnapshot, record)
    if (record.titleOverride) byKey.set(record.titleOverride, record)
  }

  const merged = baseStops.map((stop, index) => {
    const record = byKey.get(stop.title)
    if (!record) return { stop, order: 999 + index }
    return {
      stop: {
        ...stop,
        title: record.titleOverride || stop.title,
        text: record.descriptionOverride || stop.text,
        photo: record.photoPath || stop.photo,
        alt: record.photoAlt || stop.alt,
      },
      order: record.order || 999 + index,
    }
  })

  // Array.prototype.sort стабильный: несматченные остановки сохраняют
  // исходный относительный порядок в конце списка.
  merged.sort((a, b) => a.order - b.order)
  return merged.map((m) => m.stop)
}
