/**
 * Опознание места во внешних источниках при заведении POI.
 *
 * ЗАЧЕМ. До 10.08.2026 запись из Telegram-бота приезжала без place_id,
 * координат и префектуры. Следствие было не косметическим: без place_id
 * ежемесячный прогон обновления координат такую запись пропускает, а
 * статус «Работает» проставить нечем — исследователю его писать запрещено
 * (он выводит статус из отсутствия новостей и ошибается молча), а сверять
 * с Google не по чему. Петля, заведённая ради контроля закрытий, для новых
 * точек не замыкалась вовсе.
 *
 * ЧТО ОТКУДА И ПОЧЕМУ ИМЕННО ТАК.
 *
 *   place_id            Google, хранится бессрочно — так разрешают условия
 *   координаты          Google, срок годности 30 дней, обновляет крон
 *   businessStatus      Google, туда же
 *   префектура          Google, но НЕ «как есть»: ответ приводится к нашей
 *                       таблице из 47 значений или отвергается
 *   Name (JA)           Wikidata, лицензия CC0 — хранить можно вечно
 *
 * Японское имя не берётся у Google намеренно, хотя оно там есть. Условия
 * Maps Platform разрешают бессрочно хранить только идентификатор; имя —
 * содержимое, и на него распространяются те же тридцать дней. А Name (JA)
 * у нас ключ сверки дублей: он обязан быть постоянным, иначе через месяц
 * матчер начнёт заводить дубли. Поэтому имя — из корпуса, который хранить
 * разрешено, даже ценой меньшего покрытия.
 */
import { canonicalPrefecture, type Prefecture } from './prefectures.ts'

const JP = { latMin: 24, latMax: 46, lonMin: 122, lonMax: 154 }

export interface ResolvedPlace {
  placeId: string
  lat: number
  lon: number
  businessStatus: string
  prefecture: Prefecture | null
  /** Что именно вернул источник — для отчёта владельцу, не для записи. */
  matchedName: string
}

export interface ResolveOutcome {
  place: ResolvedPlace | null
  /** Почему не опознано или чем подтверждено. Идёт в отчёт. */
  reason: string
}

/** Ядро имени: без служебных слов и пунктуации, чтобы сравнивать по сути. */
function core(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\b(the|a|an|of|at|in|and)\b/g, ' ')
    .replace(/\b(temple|shrine|museum|park|garden|station|castle|falls|gorge|mount|mt|lake|street|district)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Совпадают ли имена по сути. Проверка ОБЯЗАТЕЛЬНА и в геометрической ветке.
 *
 * Без неё «Numa-no-Daira Plateau» принимал «Daisetsuzan National Park»:
 * та же префектура, двадцать два километра от центра — обе геометрические
 * проверки проходят, и только имя показывает, что это разные места.
 */
export function namesAgree(ours: string, theirs: string): boolean {
  const a = core(ours)
  const b = core(theirs)
  if (!a || !b || a.length < 4 || b.length < 4) return false
  return a === b || a.includes(b) || b.includes(a)
}

function prefectureOf(place: Record<string, unknown>): Prefecture | null {
  const components = (place.addressComponents ?? []) as Array<Record<string, unknown>>
  const hit = components.find((c) => (c.types as string[] | undefined)?.includes('administrative_area_level_1'))
  return canonicalPrefecture((hit?.longText as string) ?? (hit?.shortText as string) ?? '')
}

/**
 * Ищет место в Google Places и отдаёт его ТОЛЬКО если оно прошло проверки.
 * Ничего не бросает: не опознали — вернём причину, запись всё равно заведётся.
 */
export async function resolvePlace(
  input: { nameEn?: string; nameRu?: string; siteCity?: string; prefectureEn?: string },
  options: { apiKey: string; fetchImpl?: typeof fetch },
): Promise<ResolveOutcome> {
  const doFetch = options.fetchImpl ?? fetch
  const name = (input.nameEn ?? '').trim()
  if (!name) return { place: null, reason: 'Нет английского имени — искать нечем' }

  // Город словами, а не слагом: «koyasan» Google понимает хуже, чем «Koyasan».
  const city = (input.siteCity ?? '').replace(/-/g, ' ').trim()
  const query = [name, city, 'Japan'].filter(Boolean).join(', ')

  let data: Record<string, unknown>
  try {
    const res = await doFetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': options.apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.businessStatus,places.addressComponents',
      },
      body: JSON.stringify({ textQuery: query, languageCode: 'en', maxResultCount: 5 }),
    })
    if (!res.ok) return { place: null, reason: `Google ответил ${res.status}` }
    data = (await res.json()) as Record<string, unknown>
  } catch (error) {
    return { place: null, reason: `Google недоступен: ${(error as Error).message}` }
  }

  const candidates = (data.places ?? []) as Array<Record<string, unknown>>
  if (!candidates.length) return { place: null, reason: `Google ничего не нашёл по «${query}»` }

  const wantPrefecture = canonicalPrefecture(input.prefectureEn)
  const rejected: string[] = []

  for (const c of candidates) {
    const shown = ((c.displayName as Record<string, unknown> | undefined)?.text as string) ?? ''
    const loc = c.location as { latitude?: number; longitude?: number } | undefined
    const lat = loc?.latitude
    const lon = loc?.longitude
    if (typeof lat !== 'number' || typeof lon !== 'number') continue

    if (lat < JP.latMin || lat > JP.latMax || lon < JP.lonMin || lon > JP.lonMax) {
      rejected.push(`«${shown}» вне рамки Японии`)
      continue
    }
    if (!namesAgree(name, shown)) {
      rejected.push(`«${shown}» — имя не сходится с «${name}»`)
      continue
    }
    const prefecture = prefectureOf(c)
    if (wantPrefecture && prefecture && prefecture.en !== wantPrefecture.en) {
      rejected.push(`«${shown}» в префектуре ${prefecture.en}, ожидали ${wantPrefecture.en}`)
      continue
    }
    return {
      place: {
        placeId: String(c.id ?? ''),
        lat,
        lon,
        businessStatus: String(c.businessStatus ?? ''),
        prefecture: prefecture ?? wantPrefecture,
        matchedName: shown,
      },
      reason: `Опознано как «${shown}»`,
    }
  }
  return { place: null, reason: `Ни один кандидат не прошёл проверку: ${rejected.join('; ')}` }
}

/**
 * Японское имя и QID из Wikidata. Лицензия CC0 — хранить можно бессрочно,
 * в отличие от всего, что отдаёт Google.
 */
export async function resolveJapaneseName(
  input: { nameEn?: string },
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{ nameJa: string; qid: string } | null> {
  const doFetch = options.fetchImpl ?? fetch
  const name = (input.nameEn ?? '').trim()
  if (!name) return null
  try {
    const url =
      'https://www.wikidata.org/w/api.php?' +
      new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: `${name} haswbstatement:P17=Q17`,
        srlimit: '1',
        format: 'json',
      })
    const res = await doFetch(url, { headers: { 'User-Agent': 'jumboinjapan-poi-intake/1.0' } })
    if (!res.ok) return null
    const found = (await res.json()) as { query?: { search?: Array<{ title?: string }> } }
    const qid = found.query?.search?.[0]?.title
    if (!qid) return null

    const entity = await doFetch(
      'https://www.wikidata.org/w/api.php?' +
        new URLSearchParams({ action: 'wbgetentities', ids: qid, props: 'labels', languages: 'ja', format: 'json' }),
      { headers: { 'User-Agent': 'jumboinjapan-poi-intake/1.0' } },
    )
    if (!entity.ok) return null
    const body = (await entity.json()) as {
      entities?: Record<string, { labels?: { ja?: { value?: string } } }>
    }
    const nameJa = body.entities?.[qid]?.labels?.ja?.value
    return nameJa ? { nameJa, qid } : null
  } catch {
    return null
  }
}
