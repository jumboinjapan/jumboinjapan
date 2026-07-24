import type { AirtableRouteStop } from '@/lib/airtable'
import photoFallback from '@/data/route-stop-photos.generated.json'

/**
 * Мост между админкой (Route Stops) и городскими днями.
 *
 * Тексты остановок city-tour живут в коде страниц; ФОТО остановок — только
 * в Airtable (Route Stops.«Photo Path»/«Photo Alt») — это единственный
 * источник правды пути к фото (канон 2026-07-24, docs/photo-storage.md).
 * Кодовых photo:/alt: в stops[] больше нет — раньше они дублировали Airtable
 * и молча дрейфовали (инциденты «Мэйдзи/Сибаматы», «Сибуя 2026-07-24»).
 *
 * Fallback при недоступности Airtable — сгенерированный снапшот
 * src/data/route-stop-photos.generated.json (npm run sync:photo-fallback);
 * он не редактируется руками и источником правды не является.
 *
 * Override текстов из админки — по той же приоритетной схеме, что
 * buildIntercityRouteStopsFromAirtable (админка выигрывает, код — fallback);
 * заодно сортировка по полю «№».
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
  photo?: string
  alt?: string
}

type PhotoFallbackFile = {
  bySlug: Record<string, Record<string, { photo: string; alt: string }>>
}

export function applyCityTourStopOverrides<T extends CityTourStopLike>(
  baseStops: T[],
  airtableStops: AirtableRouteStop[],
  routeSlug?: string,
): T[] {
  const active = airtableStops.filter((s) => !s.isHelper && s.status !== 'Inactive')

  const byKey = new Map<string, AirtableRouteStop>()
  for (const record of active) {
    if (record.poiNameSnapshot) byKey.set(record.poiNameSnapshot, record)
    if (record.titleOverride) byKey.set(record.titleOverride, record)
  }

  const fallbackForSlug = routeSlug
    ? (photoFallback as PhotoFallbackFile).bySlug[routeSlug]
    : undefined

  const merged = baseStops.map((stop, index) => {
    const record = byKey.get(stop.title)
    const fb = fallbackForSlug?.[stop.title]
    if (!record) {
      return {
        stop: {
          ...stop,
          photo: stop.photo ?? fb?.photo,
          alt: stop.alt ?? fb?.alt,
        },
        order: 999 + index,
      }
    }
    return {
      stop: {
        ...stop,
        title: record.titleOverride || stop.title,
        text: record.descriptionOverride || stop.text,
        photo: record.photoPath || stop.photo || fb?.photo,
        alt: record.photoAlt || stop.alt || fb?.alt,
      },
      order: record.order || 999 + index,
    }
  })

  // Array.prototype.sort стабильный: несматченные остановки сохраняют
  // исходный относительный порядок в конце списка.
  merged.sort((a, b) => a.order - b.order)
  return merged.map((m) => m.stop)
}
