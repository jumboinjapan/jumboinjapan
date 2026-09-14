import { canonicalPrefecture } from './prefectures.ts'

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

export interface PoiGeographyView {
  regionCode: string | null
  regionLabel: string
  prefectureCode: string | null
  prefectureLabel: string
  state: 'known' | 'missing' | 'conflict' | 'unrecognized'
}

/** Read only: a missing or conflicting prefecture is never guessed from Site City. */
export function readPoiGeography(fields: Record<string, unknown>): PoiGeographyView {
  const empty = { regionCode: null, regionLabel: '', prefectureCode: null, prefectureLabel: '' }
  const values = [fields['Prefecture (EN)'], fields['Prefecture (RU)']]
    .filter((value) => value != null && value !== '')
  if (values.some((value) => typeof value !== 'string')) return { ...empty, state: 'unrecognized' }
  const nonempty = (values as string[]).map((value) => value.trim()).filter(Boolean)
  if (!nonempty.length) return { ...empty, state: 'missing' }
  const matches = nonempty.map(canonicalPrefecture)
  if (matches.some((value) => !value)) return { ...empty, state: 'unrecognized' }
  if (new Set(matches.map((value) => value?.en)).size !== 1) return { ...empty, state: 'conflict' }
  const prefecture = matches[0]!
  const region = POI_REGIONS.find((value) => value.prefectures.some((name) => name === prefecture.en))
  if (!region) return { ...empty, state: 'unrecognized' }
  return { regionCode: region.code, regionLabel: region.label, prefectureCode: prefecture.en, prefectureLabel: prefecture.ru, state: 'known' }
}

export interface PoiGeographySelection { region: string; prefecture: string; city: string }
interface LocatedPoi { geography: PoiGeographyView; siteCity: string }
export const ALL_POI_GEOGRAPHY: PoiGeographySelection = { region: 'all', prefecture: 'all', city: 'all' }

function matchesArea(actual: string | null, selected: string) {
  return selected === 'all' || (selected === POI_GEOGRAPHY_UNKNOWN ? actual === null : actual === selected)
}

export function matchesPoiGeography(item: LocatedPoi, selection: PoiGeographySelection): boolean {
  return matchesArea(item.geography.regionCode, selection.region)
    && matchesArea(item.geography.prefectureCode, selection.prefecture)
    && (selection.city === 'all' || item.siteCity === selection.city)
}

/** Region counts cover the full list; child options follow their selected parents. */
export function poiGeographyFilterOptions(items: readonly LocatedPoi[], selection: PoiGeographySelection) {
  const regionCounts = new Map<string, number>()
  const prefectures = new Map<string, { value: string; label: string; count: number }>()
  const cities = new Set<string>()
  for (const item of items) {
    const geo = item.geography
    const region = geo.regionCode ?? POI_GEOGRAPHY_UNKNOWN
    regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1)
    if (!matchesArea(geo.regionCode, selection.region)) continue
    const prefecture = geo.prefectureCode ?? POI_GEOGRAPHY_UNKNOWN
    const option = prefectures.get(prefecture) ?? { value: prefecture, label: geo.prefectureLabel || 'Префектура не определена', count: 0 }
    option.count++
    prefectures.set(prefecture, option)
    if (matchesArea(geo.prefectureCode, selection.prefecture) && item.siteCity) cities.add(item.siteCity)
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
