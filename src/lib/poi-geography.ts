import { canonicalPrefecture } from './prefectures.ts'
import { confirmedScopePrefectures, readPoiGeographyDocument, type PoiGeographyDocument } from './poi-geography-document.ts'

// JTA geographical grouping; Okinawa has a separate filter for trip planning.
// https://www.mlit.go.jp/tagengo-db/en/ (checked 2026-09-14)
export const POI_REGIONS = [
  { code: 'hokkaido', label: 'Хоккайдо', prefectures: ['Hokkaido'] },
  { code: 'tohoku', label: 'Тохоку', prefectures: ['Aomori', 'Iwate', 'Miyagi', 'Akita', 'Yamagata', 'Fukushima'] },
  { code: 'kanto', label: 'Канто', prefectures: ['Ibaraki', 'Tochigi', 'Gunma', 'Saitama', 'Chiba', 'Tokyo', 'Kanagawa'] },
  { code: 'chubu', label: 'Тюбу', prefectures: ['Niigata', 'Toyama', 'Ishikawa', 'Fukui', 'Yamanashi', 'Nagano', 'Gifu', 'Shizuoka', 'Aichi'] },
  { code: 'kansai', label: 'Кансай', prefectures: ['Mie', 'Shiga', 'Kyoto', 'Osaka', 'Hyogo', 'Nara', 'Wakayama'] },
  { code: 'chugoku', label: 'Тюгоку', prefectures: ['Tottori', 'Shimane', 'Okayama', 'Hiroshima', 'Yamaguchi'] },
  { code: 'shikoku', label: 'Сикоку', prefectures: ['Tokushima', 'Kagawa', 'Ehime', 'Kochi'] },
  { code: 'kyushu', label: 'Кюсю', prefectures: ['Fukuoka', 'Saga', 'Nagasaki', 'Kumamoto', 'Oita', 'Miyazaki', 'Kagoshima'] },
  { code: 'okinawa', label: 'Окинава', prefectures: ['Okinawa'] },
] as const

export const POI_GEOGRAPHY_UNKNOWN = 'unknown'

/**
 * Подтверждённая территория охвата — то, по чему фильтр находит крупный POI
 * сверх префектуры точки. Только `verified`; `reported` видно в карточке, но
 * в выборку не попадает.
 */
export interface PoiScopeArea {
  prefectureCode: string
  prefectureLabel: string
  regionCode: string | null
  regionLabel: string
}

export interface PoiGeographyView {
  regionCode: string | null
  regionLabel: string
  prefectureCode: string | null
  prefectureLabel: string
  /** Состояние ПРЕФЕКТУРЫ ТОЧКИ; охват его не меняет. */
  state: 'known' | 'missing' | 'conflict' | 'unrecognized'
  /** Подтверждённые территории охвата (`poi-geography/v1`), без повторов. Пусто — охват не описан. */
  scope: PoiScopeArea[]
  /** Ошибка разбора документа охвата; префектура точки при этом остаётся прочитанной. */
  scopeError: string | null
}

const regionOf = (prefectureEn: string) => POI_REGIONS.find((value) => value.prefectures.some((name) => name === prefectureEn)) ?? null

function scopeAreas(document: PoiGeographyDocument | null): PoiScopeArea[] {
  return confirmedScopePrefectures(document).flatMap((code) => {
    const prefecture = canonicalPrefecture(code)
    if (!prefecture) return []
    const region = regionOf(prefecture.en)
    return [{ prefectureCode: prefecture.en, prefectureLabel: prefecture.ru, regionCode: region?.code ?? null, regionLabel: region?.label ?? '' }]
  })
}

/** Read only: a missing or conflicting prefecture is never guessed from Site City or from the scope. */
export function readPoiGeography(fields: Record<string, unknown>, ownPoiId: string | null = null): PoiGeographyView {
  const read = readPoiGeographyDocument(fields, ownPoiId)
  const scope = scopeAreas(read.document)
  const empty = { regionCode: null, regionLabel: '', prefectureCode: null, prefectureLabel: '', scope, scopeError: read.error }
  const values = [fields['Prefecture (EN)'], fields['Prefecture (RU)']]
    .filter((value) => value != null && value !== '')
  if (values.some((value) => typeof value !== 'string')) return { ...empty, state: 'unrecognized' }
  const nonempty = (values as string[]).map((value) => value.trim()).filter(Boolean)
  if (!nonempty.length) return { ...empty, state: 'missing' }
  const matches = nonempty.map(canonicalPrefecture)
  if (matches.some((value) => !value)) return { ...empty, state: 'unrecognized' }
  if (new Set(matches.map((value) => value?.en)).size !== 1) return { ...empty, state: 'conflict' }
  const prefecture = matches[0]!
  const region = regionOf(prefecture.en)
  if (!region) return { ...empty, state: 'unrecognized' }
  return { ...empty, regionCode: region.code, regionLabel: region.label, prefectureCode: prefecture.en, prefectureLabel: prefecture.ru, state: 'known' }
}

/**
 * Все регионы и префектуры, к которым запись относится: точка плюс охват, без
 * повторов. Точка без префектуры даёт `null` — «регион не определён», и охват
 * этого не скрывает: у такой записи и неопределённость, и территории видны.
 */
export function poiGeographyMemberships(geography: PoiGeographyView) {
  const regions = new Set<string | null>([geography.regionCode])
  const prefectures = new Map<string | null, string>([[geography.prefectureCode, geography.prefectureLabel]])
  for (const area of geography.scope) {
    regions.add(area.regionCode)
    prefectures.set(area.prefectureCode, area.prefectureLabel)
  }
  return { regions: [...regions], prefectures: [...prefectures.entries()].map(([code, label]) => ({ code, label })) }
}

export interface PoiGeographySelection { region: string; prefecture: string; city: string }
interface LocatedPoi { geography: PoiGeographyView; siteCity: string }
export const ALL_POI_GEOGRAPHY: PoiGeographySelection = { region: 'all', prefecture: 'all', city: 'all' }

function matchesArea(actual: string | null, selected: string) {
  return selected === 'all' || (selected === POI_GEOGRAPHY_UNKNOWN ? actual === null : actual === selected)
}
const matchesAny = (actual: readonly (string | null)[], selected: string) => actual.some((value) => matchesArea(value, selected))

/**
 * Крупный POI находится по ЛЮБОЙ подтверждённой территории охвата, а старая
 * карточка без охвата — по префектуре точки, как раньше. Предикат булев на
 * запись, поэтому один POI попадает в результат один раз, в скольких бы
 * префектурах он ни лежал.
 */
export function matchesPoiGeography(item: LocatedPoi, selection: PoiGeographySelection): boolean {
  const memberships = poiGeographyMemberships(item.geography)
  return memberships.prefectures.some((entry) =>
    matchesArea(entry.code ? regionOf(entry.code)?.code ?? null : null, selection.region)
    && matchesArea(entry.code, selection.prefecture))
    && (selection.city === 'all' || item.siteCity === selection.city)
}

/**
 * Region counts cover the full list; child options follow their selected parents.
 *
 * Запись считается в КАЖДОМ регионе и в КАЖДОЙ префектуре, к которым относится,
 * но в каждом — один раз. Поэтому сумма счётчиков по префектурам может
 * превышать число записей: гора в двух префектурах — одна запись и две единицы
 * счёта. Интерфейс это говорит вслух (`GEOGRAPHY_COUNT_NOTE`).
 */
export const GEOGRAPHY_COUNT_NOTE = 'Место в нескольких префектурах считается в каждой из них, поэтому сумма по префектурам может превышать число найденных записей.'

export function poiGeographyFilterOptions(items: readonly LocatedPoi[], selection: PoiGeographySelection) {
  const regionCounts = new Map<string, number>()
  const prefectures = new Map<string, { value: string; label: string; count: number }>()
  const cities = new Set<string>()
  for (const item of items) {
    const geo = item.geography
    const memberships = poiGeographyMemberships(geo)
    for (const region of memberships.regions) {
      const code = region ?? POI_GEOGRAPHY_UNKNOWN
      regionCounts.set(code, (regionCounts.get(code) ?? 0) + 1)
    }
    if (!matchesAny(memberships.regions, selection.region)) continue
    for (const entry of memberships.prefectures) {
      /* Префектура попадает в список выбранного региона только если сама лежит
         в нём: у горы на границе Тюбу и Канто префектуры разводятся по своим
         регионам, а не показываются обе под каждым. */
      const entryRegion = entry.code ? regionOf(entry.code)?.code ?? null : null
      if (!matchesArea(entryRegion, selection.region)) continue
      const code = entry.code ?? POI_GEOGRAPHY_UNKNOWN
      const option = prefectures.get(code) ?? { value: code, label: entry.label || 'Префектура не определена', count: 0 }
      option.count++
      prefectures.set(code, option)
    }
    if (matchesPoiGeography(item, { ...selection, city: 'all' }) && item.siteCity) cities.add(item.siteCity)
  }
  const regions = [...POI_REGIONS.map((region) => ({ value: region.code, label: region.label })),
    { value: POI_GEOGRAPHY_UNKNOWN, label: 'Регион не определён' }]
    .filter((region) => regionCounts.has(region.value))
    .map((region) => ({ value: region.value, label: `${region.label} · ${regionCounts.get(region.value)}` }))
  return {
    regions,
    prefectures: [...prefectures.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'))
      .map(({ value, label, count }) => ({ value, label: `${label} · ${count}` })),
    cities: [...cities].sort((a, b) => a.localeCompare(b)),
  }
}

/** Preserve compatible child choices; clear those outside the newly selected area. */
export function changePoiGeographySelection(items: readonly LocatedPoi[], current: PoiGeographySelection, key: keyof PoiGeographySelection, value: string): PoiGeographySelection {
  const next = { ...current, [key]: value }
  if (key === 'region' && !poiGeographyFilterOptions(items, next).prefectures.some((option) => option.value === next.prefecture)) next.prefecture = 'all'
  if (key !== 'city' && !poiGeographyFilterOptions(items, next).cities.includes(next.city)) next.city = 'all'
  return next
}
