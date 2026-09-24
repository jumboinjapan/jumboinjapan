/**
 * Какие записи таблицы Routes — пакеты дневных туров, которые правятся в
 * админке («Остановки маршрутов», «Тексты маршрутов»), и как их читать.
 *
 * История (разбор 2026-09-25). 17.05 страницы форматов поездки убрали из
 * белого списка редактора остановок вручную (fc0fc19). 05.07 белый список
 * заменили правилом по префиксу `intercity/` / `city-tour/` (a396ea8), и это
 * исключение потерялось: «Общественный транспорт по Токио» и «Частный тур по
 * Токио» вернулись в список маршрутов с пустыми остановками и полной выдачей
 * POI. Теперь исключение живёт здесь, а tests/admin-route-packages.mjs
 * сверяет его с файлами страниц — новая страница формата без записи в этом
 * списке уронит тест.
 */
import { fetchAirtableWithRetry } from '@/lib/airtable-retry'

/**
 * Страницы о формате поездки (компонент TravelFormatPage). Их текст целиком
 * в коде, Airtable они не читают, остановок у них нет — это не маршруты.
 */
export const TRAVEL_FORMAT_PAGE_SLUGS: readonly string[] = [
  'city-tour/charter',
  'city-tour/private',
  'city-tour/public',
  'intercity/private',
  'intercity/public',
]

/** Разделы, чьи пакеты правятся в «Остановках маршрутов». multi-day/* — в конструкторе. */
const ROUTE_STOPS_PREFIXES = ['intercity/', 'city-tour/'] as const

/** Разделы, чьи тексты правятся в «Текстах маршрутов». */
const ROUTE_TEXT_PREFIXES = ['intercity/', 'city-tour/', 'multi-day/'] as const

/** Значение поля Status, которым запись Routes выводится из рабочих списков. */
export const ARCHIVED_ROUTE_STATUS = 'Archived'

export function isTravelFormatPageSlug(slug: string): boolean {
  return TRAVEL_FORMAT_PAGE_SLUGS.includes(slug)
}

/** Пакет дневного тура, у которого есть остановки. Статус здесь не учитывается. */
export function isRouteStopsSlug(slug: string): boolean {
  return ROUTE_STOPS_PREFIXES.some((prefix) => slug.startsWith(prefix)) && !isTravelFormatPageSlug(slug)
}

/** Маршрут, чьи SEO-поля и вступление реально рендерит сайт. */
export function isRouteTextSlug(slug: string): boolean {
  return ROUTE_TEXT_PREFIXES.some((prefix) => slug.startsWith(prefix)) && !isTravelFormatPageSlug(slug)
}

/** Запись для списка «Остановок маршрутов»: пакет дневного тура и не в архиве. */
export function isRouteStopsListEntry(slug: string, status: unknown): boolean {
  return isRouteStopsSlug(slug) && status !== ARCHIVED_ROUTE_STATUS
}

export class AirtableListError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string) {
    super(`Airtable list failed: ${status}`)
    this.name = 'AirtableListError'
    this.status = status
    this.body = body
  }
}

const MAX_PAGES = 50

export interface RoutesRecord {
  id: string
  fields: Record<string, unknown>
}

/**
 * Все записи Routes с перелистыванием страниц. Раньше оба списка брали
 * `pageSize=100` без `offset`, и сто первая запись молча пропала бы из админки.
 * Бросает исключение при ошибке Airtable: полупустой список хуже явной ошибки.
 */
export async function fetchAllRoutesRecords(options: {
  token: string
  baseId: string
  tableId: string
  fields: readonly string[]
}): Promise<RoutesRecord[]> {
  const url = new URL(`https://api.airtable.com/v0/${options.baseId}/${options.tableId}`)
  url.searchParams.set('pageSize', '100')
  for (const field of options.fields) url.searchParams.append('fields[]', field)

  const records: RoutesRecord[] = []
  let offset: string | undefined
  let pages = 0
  do {
    // Предохранитель от зацикливания на повторяющемся offset: 50 страниц —
    // это 5000 маршрутов, на порядки больше, чем бывает в таблице.
    if (++pages > MAX_PAGES) throw new AirtableListError(508, 'Routes: слишком много страниц, чтение остановлено')
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetchAirtableWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${options.token}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      throw new AirtableListError(res.status, await res.text())
    }
    const data = await res.json()
    // Ответ неправильной формы не доказывает, что slug свободен: этот
    // читатель используется и перед созданием маршрута.
    if (!data || !Array.isArray(data.records)
      || data.records.some((record: RoutesRecord | null) => !record
        || typeof record.id !== 'string' || !record.id
        || !record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields)
        || (record.fields.Slug !== undefined && typeof record.fields.Slug !== 'string'))
      || (data.offset !== undefined && (typeof data.offset !== 'string' || !data.offset))) {
      throw new AirtableListError(502, 'Routes: некорректный ответ Airtable, чтение остановлено')
    }
    records.push(...data.records)
    offset = data.offset
  } while (offset)

  return records
}
