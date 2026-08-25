/** Поля кодовой остановки, которые нужны мосту Route Stops → city-tour. */
export interface CityTourStopLike {
  id: string
  number: string
  title: string
  text: string
  duration: string
  photo?: string
  alt?: string
}

/** Минимальная проекция Route Stops, которую потребляет city-tour. */
export interface CityTourStopOverride {
  poiNameSnapshot?: string
  titleOverride?: string
  descriptionOverride?: string
  photoPath?: string
  photoAlt?: string
  order?: number
  isHelper?: boolean
  status?: string
}

export type PhotoFallback = Record<string, { photo?: string; alt?: string }>

/** Форма сгенерированного файла-подстраховки route-stop-photos.generated.json. */
export interface PhotoFallbackFile {
  bySlug: Record<string, PhotoFallback>
}

/**
 * Выбирает раздел файла-подстраховки для маршрута.
 *
 * Вынесено из `applyCityTourStopOverrides` отдельной чистой функцией, потому
 * что выбор по слагу — это решение, а не деталь склейки: маршрут, которому
 * подставили чужой раздел, показал бы чужие фотографии, и заметить это можно
 * было бы только глазами. Здесь оно проверяется на настоящем файле.
 *
 * `Object.hasOwn` вместо простого обращения по ключу: слаг приходит из вызова,
 * а `bySlug['constructor']` без этой проверки вернул бы функцию из прототипа —
 * не раздел, но и не `undefined`, и дальше это поехало бы в склейку молча.
 */
export function selectPhotoFallback(
  file: PhotoFallbackFile | undefined,
  routeSlug?: string,
): PhotoFallback | undefined {
  if (!routeSlug || !file || typeof file !== 'object') return undefined
  const { bySlug } = file
  if (!bySlug || typeof bySlug !== 'object') return undefined
  if (!Object.hasOwn(bySlug, routeSlug)) return undefined
  const section = bySlug[routeSlug]
  return section && typeof section === 'object' ? section : undefined
}

/**
 * Накладывает Airtable-overrides на кодовую модель маршрута.
 *
 * Функция намеренно не добавляет строки, которых нет в baseStops: у новой
 * остановки нет обязательных кодовых полей text и duration. Поэтому изменение
 * состава маршрута начинается с baseStops, а Airtable только редактирует его.
 */
export function mergeCityTourStops<T extends CityTourStopLike>(
  baseStops: T[],
  airtableStops: CityTourStopOverride[],
  fallbackForSlug?: PhotoFallback,
): T[] {
  const active = airtableStops.filter((stop) => !stop.isHelper && stop.status !== 'Inactive')

  const norm = (value: string) => value.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()

  const byKey = new Map<string, CityTourStopOverride>()
  for (const record of active) {
    if (record.poiNameSnapshot) byKey.set(norm(record.poiNameSnapshot), record)
    if (record.titleOverride) byKey.set(norm(record.titleOverride), record)
  }

  const fallbackByNorm = new Map<string, { photo?: string; alt?: string }>()
  for (const [key, value] of Object.entries(fallbackForSlug ?? {})) {
    fallbackByNorm.set(norm(key), value)
  }

  const merged = baseStops.map((stop, index) => {
    const record = byKey.get(norm(stop.title))
    const fallback = fallbackForSlug?.[stop.title] ?? fallbackByNorm.get(norm(stop.title))
    if (!record) {
      return {
        stop: {
          ...stop,
          photo: stop.photo ?? fallback?.photo,
          alt: stop.alt ?? fallback?.alt,
        },
        order: 999 + index,
      }
    }
    return {
      stop: {
        ...stop,
        title: record.titleOverride || stop.title,
        text: record.descriptionOverride || stop.text,
        photo: record.photoPath || stop.photo || fallback?.photo,
        alt: record.photoAlt || stop.alt || fallback?.alt,
      },
      order: record.order || 999 + index,
    }
  })

  merged.sort((a, b) => a.order - b.order)
  return merged.map((row) => row.stop as T)
}
