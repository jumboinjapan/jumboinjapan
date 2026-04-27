import { load } from 'cheerio'
import {
  JAPAN_TRAVEL_IMPORT_DEFAULTS,
  evaluateJapanTravelEventIntake,
  type IntakeDecision,
  type IntakeEvaluation,
  type JapanTravelIntakeWindowOptions,
} from './japantravel-event-intake.ts'
import { normalizeEventSurfaceText } from './event-surface-text.ts'

export const RESOURCES_TABLE_NAME = 'Resources'
export const RESOURCE_EVENT_DETAILS_TABLE_NAME = 'Resource Event Details'

type EventCategory = 'art' | 'festival' | 'market' | 'nature' | 'food' | 'music'
type ResourceEventLifecycle = 'upcoming' | 'live' | 'ended'

const JAPAN_TRAVEL_BASE_URL = 'https://en.japantravel.com'
const DEFAULT_TIMEOUT_MS = 20_000
const BATCH_SIZE = 10

export type JapanTravelImportOptions = JapanTravelIntakeWindowOptions & {
  startPage?: number
  maxPages?: number
  maxItems?: number | null
  dryRun?: boolean
  includeEnded?: boolean
  requestDelayMs?: number
  log?: (message: string) => void
}

type JsonLdImage =
  | string
  | {
      url?: string
    }

type JapanTravelEventJsonLd = {
  '@type'?: string
  name?: string
  startDate?: string
  endDate?: string
  url?: string
  description?: string
  image?: JsonLdImage[] | JsonLdImage
  location?: {
    name?: string
    address?: string | { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string; addressCountry?: string }
  }
  offers?: {
    price?: number | string
    priceCurrency?: string
  }
}

type IndexEventCandidate = {
  sourceUrl: string
  title: string
  startsAt: string
  endsAt: string
  summary: string
  imageUrl: string | null
  venue: string
  address: string
}

type GeoConfidence = 'official' | 'article-body' | 'structured' | 'path-derived'
type YearConfidence = 'current' | 'conflict' | 'stale' | 'unknown'

type ResolvedGeo = {
  city: string
  regionLabel: string
  confidence: GeoConfidence
  pathRegionLabel: string
  conflictWithPath: boolean
  usedPathFallbackRegion: boolean
  geoBroken: boolean
  evidence: string[]
}

type ResolvedGeoCandidate = ResolvedGeo & {
  score: number
}

type YearAssessment = {
  titleYears: number[]
  officialYears: number[]
  articleYears: number[]
  startYear: number | null
  endYear: number | null
  confidence: YearConfidence
  inconsistent: boolean
  hasCurrentYearDateConfidence: boolean
  evidence: string[]
}

export type ImportedJapanTravelEvent = {
  resourceId: string
  slug: string
  type: 'event' | 'exhibition' | 'concert'
  status: 'active'
  title: string
  city: string
  regionLabel: string
  summary: string
  description: string
  tags: string[]
  primaryUrl: string
  editorModule: 'event'
  sourceKey: string
  seedSource: string
  event: {
    resourceId: string
    category: EventCategory
    titleJa: string
    venue: string
    venueJa: string
    neighborhood: string
    startsAt: string
    endsAt: string
    priceLabel: string
    sourceUrl: string
    featured: boolean
    lifecycle: ResourceEventLifecycle
  }
  meta: {
    sourceUrl: string
    officialUrl: string | null
    linkedUrls: string[]
    address: string
    gettingThere: string
    imageUrl: string | null
    sourceId: string
    geo: ResolvedGeo
    years: YearAssessment
    duplicateKey: string
    duplicateOf: string | null
  }
  intake: IntakeEvaluation
}

type AirtableRecord = {
  id: string
  fields: Record<string, unknown>
}

type AirtableTableSummary = {
  created: number
  updated: number
  unchanged: number
}

export type JapanTravelImportResult = {
  pagesVisited: number
  candidatesFound: number
  stoppedReason: 'page-limit' | 'item-limit' | 'source-exhausted'
  imported: ImportedJapanTravelEvent[]
  review: ImportedJapanTravelEvent[]
  rejected: ImportedJapanTravelEvent[]
  duplicates: ImportedJapanTravelEvent[]
  ended: ImportedJapanTravelEvent[]
  decisions: Record<IntakeDecision, number>
  dryRun: boolean
  airtable?: {
    resources: AirtableTableSummary
    eventDetails: AirtableTableSummary
  }
}

function getAirtableCredentials() {
  return {
    token: process.env.AIRTABLE_TOKEN?.trim(),
    baseId: process.env.AIRTABLE_BASE_ID?.trim(),
  }
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function titleCaseFromSlug(value: string) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function createSlug(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const PREFECTURE_LABELS = [
  'Hokkaido',
  'Aomori',
  'Iwate',
  'Miyagi',
  'Akita',
  'Yamagata',
  'Fukushima',
  'Ibaraki',
  'Tochigi',
  'Gunma',
  'Saitama',
  'Chiba',
  'Tokyo',
  'Kanagawa',
  'Niigata',
  'Toyama',
  'Ishikawa',
  'Fukui',
  'Yamanashi',
  'Nagano',
  'Gifu',
  'Shizuoka',
  'Aichi',
  'Mie',
  'Shiga',
  'Kyoto',
  'Osaka',
  'Hyogo',
  'Nara',
  'Wakayama',
  'Tottori',
  'Shimane',
  'Okayama',
  'Hiroshima',
  'Yamaguchi',
  'Tokushima',
  'Kagawa',
  'Ehime',
  'Kochi',
  'Fukuoka',
  'Saga',
  'Nagasaki',
  'Kumamoto',
  'Oita',
  'Miyazaki',
  'Kagoshima',
  'Okinawa',
]
const PREFECTURE_SLUG_TO_LABEL = new Map(PREFECTURE_LABELS.map((label) => [createSlug(label), label]))
const PREFECTURE_TO_AIRTABLE_REGION_RU = new Map<string, string>([
  ['Hokkaido', 'Хоккайдо'],
  ['Aomori', 'Тохоку'], ['Iwate', 'Тохоку'], ['Miyagi', 'Тохоку'], ['Akita', 'Тохоку'], ['Yamagata', 'Тохоку'], ['Fukushima', 'Тохоку'],
  ['Ibaraki', 'Канто'], ['Tochigi', 'Канто'], ['Gunma', 'Канто'], ['Saitama', 'Канто'], ['Chiba', 'Канто'], ['Tokyo', 'Канто'], ['Kanagawa', 'Канто'],
  ['Niigata', 'Тюбу'], ['Toyama', 'Тюбу'], ['Ishikawa', 'Тюбу'], ['Fukui', 'Тюбу'], ['Yamanashi', 'Тюбу'], ['Nagano', 'Тюбу'], ['Gifu', 'Тюбу'], ['Shizuoka', 'Тюбу'], ['Aichi', 'Тюбу'],
  ['Mie', 'Кансай'], ['Shiga', 'Кансай'], ['Kyoto', 'Кансай'], ['Osaka', 'Кансай'], ['Hyogo', 'Кансай'], ['Nara', 'Кансай'], ['Wakayama', 'Кансай'],
  ['Tottori', 'Тюгоку'], ['Shimane', 'Тюгоку'], ['Okayama', 'Тюгоку'], ['Hiroshima', 'Тюгоку'], ['Yamaguchi', 'Тюгоку'],
  ['Tokushima', 'Сикоку'], ['Kagawa', 'Сикоку'], ['Ehime', 'Сикоку'], ['Kochi', 'Сикоку'],
  ['Fukuoka', 'Кюсю'], ['Saga', 'Кюсю'], ['Nagasaki', 'Кюсю'], ['Kumamoto', 'Кюсю'], ['Oita', 'Кюсю'], ['Miyazaki', 'Кюсю'], ['Kagoshima', 'Кюсю'],
  ['Okinawa', 'Окинава'],
])
const YEAR_PATTERN = /\b(20\d{2})\b/g
const CITY_SUFFIX_PATTERN = /\b(city|ward|town|village|ku|shi|cho|machi|son|mura)\b/i

function dedupeStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => normalizeWhitespace(value ?? '')).filter(Boolean)))
}

function extractYears(value: string | null | undefined) {
  const years = new Set<number>()
  for (const match of (value ?? '').matchAll(YEAR_PATTERN)) {
    years.add(Number(match[1]))
  }
  return Array.from(years).sort((left, right) => left - right)
}

function regionFromText(value: string) {
  const normalized = normalizeWhitespace(value)
  for (const label of PREFECTURE_LABELS) {
    if (new RegExp(`\\b${label}\\b`, 'i').test(normalized)) return label
  }

  const slug = createSlug(normalized)
  return PREFECTURE_SLUG_TO_LABEL.get(slug) ?? ''
}

function toAirtableRegionRu(prefectureOrRegionLabel: string) {
  return PREFECTURE_TO_AIRTABLE_REGION_RU.get(prefectureOrRegionLabel) ?? prefectureOrRegionLabel
}

function titleDerivedCity(title: string) {
  const match = normalizeWhitespace(title).match(/^([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2})\s+(?:Spring|Summer|Autumn|Winter|Sakura|Cherry|Tulip|Earth|Festival|Matsuri|Fair|Market|Parade|Fireworks|Hanabi|Event|Expo|Ceramics|Wine|Bubble|Night|Nights|Odori|Performance|Tea)\b/)
  if (!match) return ''
  const candidate = normalizeWhitespace(match[1])
  if (/\b(day|night|spring|summer|autumn|winter)\b/i.test(candidate)) return ''
  return candidate
}

function cityHintFromOfficialUrl(officialUrl: string | null | undefined) {
  if (!officialUrl) return ''

  try {
    const hostname = new URL(officialUrl).hostname.toLowerCase().replace(/^www\./, '')
    const patterns = [
      hostname.match(/(?:^|\.)city\.([a-z0-9-]+)\./),
      hostname.match(/(?:^|\.)([a-z0-9-]+)\.city\./),
      hostname.match(/(?:^|\.)kankou\.city\.([a-z0-9-]+)\./),
    ]

    for (const match of patterns) {
      const slug = match?.[1]
      if (!slug) continue
      return slug
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    }
  } catch {
    return ''
  }

  return ''
}

function isWeakResolvedCity(city: string) {
  const normalized = normalizeWhitespace(city)
  if (!normalized) return true
  if (/^\d/.test(normalized)) return true
  if (/\b(ward|ku|district|county|gun|prefecture|city)$\b/i.test(normalized)) return true
  if (/\b(shrine|temple|park|garden|river|castle|museum|gallery|forum|center|centre|hall|plaza|dome|tower|building|arena|stadium|market|onsen|station)\b/i.test(normalized)) return true
  return false
}

function cityFromText(value: string, regionLabel: string) {
  const parts = value
    .split(/[,/\n|]+/)
    .map((part) => normalizeWhitespace(part.replace(/\b\d{3}-\d{4}\b/g, '').replace(/\bJapan\b/i, '')))
    .filter(Boolean)

  const regionSlug = createSlug(regionLabel)
  const regionIndex = parts.findIndex((part) => createSlug(part) === regionSlug || Boolean(regionFromText(part)) && createSlug(regionFromText(part)) === regionSlug)
  const isMeaningfulCityPart = (part: string) => {
    const slug = createSlug(part)
    if (!slug || slug === regionSlug) return false
    if (PREFECTURE_SLUG_TO_LABEL.has(slug)) return false
    if (!/[a-z]/i.test(part)) return false
    if (/^\d/.test(part)) return false
    if (part.split(/\s+/).length > 3 && !CITY_SUFFIX_PATTERN.test(part)) return false
    if (/\b(festival|event|events|celebration|ceremony|rice paddies|shrine|temple|park|garden|river|castle|museum|gallery|forum|center|centre|hall|plaza|dome|tower|building|arena|stadium|market|onsen|station|district|county|gun)\b/i.test(part)) {
      return false
    }
    return true
  }

  const municipalityCandidates = parts.filter((part) => {
    const slug = createSlug(part)
    if (!isMeaningfulCityPart(part)) return false
    return CITY_SUFFIX_PATTERN.test(part) || slug.includes('takayama') || slug.includes('chiyoda')
  })

  if (municipalityCandidates.length > 0) return municipalityCandidates[0]

  if (regionIndex > 0) {
    for (let index = regionIndex - 1; index >= 0; index -= 1) {
      if (isMeaningfulCityPart(parts[index])) return parts[index]
    }
  }

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (isMeaningfulCityPart(parts[index])) return parts[index]
  }

  return ''
}

function deriveRegionFromUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl)
    const regionSlug = createSlug(url.pathname.split('/').filter(Boolean)[0] || '')
    return PREFECTURE_SLUG_TO_LABEL.get(regionSlug) ?? titleCaseFromSlug(regionSlug)
  } catch {
    return ''
  }
}

function resolveGeoCandidate(texts: string[], confidence: GeoConfidence, pathRegionLabel: string): ResolvedGeoCandidate | null {
  const evidence = dedupeStrings(texts)
  const scored: ResolvedGeoCandidate[] = []

  for (const text of evidence) {
    const regionLabel = regionFromText(text)
    const city = cityFromText(text, regionLabel || pathRegionLabel)
    if (!regionLabel && !city) continue

    const usedPathFallbackRegion = !regionLabel && Boolean(pathRegionLabel)
    const conflictWithPath = Boolean(pathRegionLabel && regionLabel && createSlug(pathRegionLabel) !== createSlug(regionLabel))
    const municipalityLike = CITY_SUFFIX_PATTERN.test(city) || city.split(/\s+/).length <= 3
    const score =
      (regionLabel ? 6 : 0) +
      (city ? 4 : 0) +
      (!usedPathFallbackRegion ? 3 : 0) +
      (municipalityLike ? 1 : 0) +
      (confidence === 'structured' ? 2 : confidence === 'official' ? 1 : 0)

    scored.push({
      city: city || regionLabel || pathRegionLabel || 'Japan',
      regionLabel: regionLabel || pathRegionLabel,
      confidence,
      pathRegionLabel,
      conflictWithPath,
      usedPathFallbackRegion,
      geoBroken: confidence !== 'path-derived' && usedPathFallbackRegion,
      evidence: [text],
      score,
    })
  }

  return scored.sort((left, right) => right.score - left.score)[0] ?? null
}

function resolveEventGeo(input: {
  sourceUrl: string
  officialLocationTexts: string[]
  articleLocationTexts: string[]
  structuredLocationTexts: string[]
}): ResolvedGeo {
  const pathRegionLabel = deriveRegionFromUrl(input.sourceUrl)
  const candidates = [
    resolveGeoCandidate(input.officialLocationTexts, 'official', pathRegionLabel),
    resolveGeoCandidate(input.articleLocationTexts, 'article-body', pathRegionLabel),
    resolveGeoCandidate(input.structuredLocationTexts, 'structured', pathRegionLabel),
    resolveGeoCandidate([pathRegionLabel], 'path-derived', pathRegionLabel),
  ].filter((value): value is ResolvedGeoCandidate => Boolean(value))

  const resolved = candidates.sort((left, right) => right.score - left.score)[0]

  return (
    resolved ?? {
      city: pathRegionLabel || 'Japan',
      regionLabel: pathRegionLabel,
      confidence: pathRegionLabel ? 'path-derived' : 'structured',
      pathRegionLabel,
      conflictWithPath: false,
      usedPathFallbackRegion: Boolean(pathRegionLabel),
      geoBroken: false,
      evidence: [],
    }
  )
}

function assessEventYears(input: {
  title: string
  startsAt: string
  endsAt: string
  officialUrl: string | null
  sourceUrl: string
  description: string
}): YearAssessment {
  const currentYear = new Date().getFullYear()
  const startYear = Number.isFinite(new Date(input.startsAt).getTime()) ? new Date(input.startsAt).getFullYear() : null
  const endYear = Number.isFinite(new Date(input.endsAt).getTime()) ? new Date(input.endsAt).getFullYear() : null
  const titleYears = extractYears(input.title)
  const officialYears = extractYears(input.officialUrl)
  const articleYears = extractYears(`${input.sourceUrl} ${input.description}`)
  const datedYears = [startYear, endYear].filter((value): value is number => value !== null)
  const allYears = Array.from(new Set([...titleYears, ...officialYears, ...articleYears, ...datedYears]))
  const officialConflict = officialYears.some((year) => !datedYears.includes(year))
  const staleOnly = allYears.length > 0 && allYears.every((year) => year < currentYear)
  const hasCurrentYearDateConfidence = datedYears.length > 0 && datedYears.every((year) => year === currentYear)
  const titleConflict = titleYears.some((year) => !datedYears.includes(year))
  const inconsistent = officialConflict || titleConflict || staleOnly || !hasCurrentYearDateConfidence
  const evidence = [
    titleYears.length > 0 ? `title:${titleYears.join(',')}` : '',
    officialYears.length > 0 ? `official:${officialYears.join(',')}` : '',
    articleYears.length > 0 ? `article:${articleYears.join(',')}` : '',
    datedYears.length > 0 ? `dates:${datedYears.join(',')}` : '',
  ].filter(Boolean)

  return {
    titleYears,
    officialYears,
    articleYears,
    startYear,
    endYear,
    confidence: officialConflict || titleConflict ? 'conflict' : staleOnly ? 'stale' : hasCurrentYearDateConfidence ? 'current' : 'unknown',
    inconsistent,
    hasCurrentYearDateConfidence,
    evidence,
  }
}

function normalizeDuplicateFragment(value: string) {
  return createSlug(value)
    .replace(/\b20\d{2}\b/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function canonicalDuplicateKey(event: ImportedJapanTravelEvent) {
  return [normalizeDuplicateFragment(event.title), normalizeDuplicateFragment(event.event.venue), event.event.startsAt.slice(0, 10)].join('::')
}

function fuzzyDuplicateKey(event: ImportedJapanTravelEvent) {
  return [normalizeDuplicateFragment(event.title), event.event.startsAt.slice(0, 10)].join('::')
}

function significantTitleTokens(title: string) {
  return new Set(
    normalizeDuplicateFragment(title)
      .split('-')
      .filter((token) => token.length >= 4 && !['festival', 'spring', 'autumn', 'winter', 'summer', 'event', '2026'].includes(token)),
  )
}

function titleTokenOverlap(left: string, right: string) {
  const leftTokens = significantTitleTokens(left)
  const rightTokens = significantTitleTokens(right)
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length
  return intersection / Math.min(leftTokens.size, rightTokens.size)
}

function areProbablyDuplicate(left: ImportedJapanTravelEvent, right: ImportedJapanTravelEvent) {
  const sameDate = left.event.startsAt.slice(0, 10) === right.event.startsAt.slice(0, 10)
  const sameVenue = normalizeDuplicateFragment(left.event.venue) === normalizeDuplicateFragment(right.event.venue)
  return sameDate && sameVenue && titleTokenOverlap(left.title, right.title) >= 0.5
}

function withDecision(event: ImportedJapanTravelEvent, decision: IntakeDecision, reason: string, signalCode: string, scoreDelta = 0, duplicateOf: string | null = null) {
  const signal: IntakeEvaluation['signals'][number] = {
    kind: 'negative',
    code: signalCode,
    score: scoreDelta,
    note: reason,
  }

  return {
    ...event,
    meta: {
      ...event.meta,
      duplicateOf,
    },
    intake: {
      ...event.intake,
      decision,
      score: event.intake.score + scoreDelta,
      blockingReasons: Array.from(new Set([...event.intake.blockingReasons, reason])),
      signals: [...event.intake.signals, signal],
    },
  }
}

function toComparableRank(event: ImportedJapanTravelEvent) {
  return [
    event.intake.decision === 'import' ? 1 : 0,
    event.intake.hasAuthoritativeSource ? 1 : 0,
    event.meta.geo.confidence === 'official' ? 3 : event.meta.geo.confidence === 'article-body' ? 2 : event.meta.geo.confidence === 'structured' ? 1 : 0,
    event.intake.score,
    event.meta.officialUrl ? 1 : 0,
  ]
}

function compareEvents(left: ImportedJapanTravelEvent, right: ImportedJapanTravelEvent) {
  const leftRank = toComparableRank(left)
  const rightRank = toComparableRank(right)
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) return rightRank[index] - leftRank[index]
  }
  return left.sourceKey.localeCompare(right.sourceKey)
}

function toAbsoluteUrl(value: string | undefined | null) {
  if (!value) return null
  try {
    return new URL(value, JAPAN_TRAVEL_BASE_URL).toString()
  } catch {
    return null
  }
}

function isPreferredPrimaryUrl(url: string | null) {
  if (!url) return false

  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    return !['facebook.com', 'instagram.com', 'x.com', 'twitter.com'].includes(hostname)
  } catch {
    return false
  }
}

function toJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === 'object') return [value as T]
  return []
}

function parseJsonLdBlocks(html: string): unknown[] {
  const $ = load(html)
  const blocks: unknown[] = []

  $('script[type="application/ld+json"]').each((_, element) => {
    const content = $(element).html()?.trim()
    if (!content) return

    try {
      const parsed = JSON.parse(content) as unknown
      if (Array.isArray(parsed)) {
        blocks.push(...parsed)
        return
      }
      blocks.push(parsed)
    } catch {
      // Ignore malformed blocks.
    }
  })

  return blocks
}

function extractEventJsonLd(html: string): JapanTravelEventJsonLd[] {
  return parseJsonLdBlocks(html)
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const record = block as Record<string, unknown>
      if (record['@graph'] && Array.isArray(record['@graph'])) {
        return record['@graph'] as unknown[]
      }
      return [record]
    })
    .filter((block): block is JapanTravelEventJsonLd => {
      if (!block || typeof block !== 'object') return false
      const type = (block as { '@type'?: unknown })['@type']
      return typeof type === 'string' && type.toLowerCase() === 'event'
    })
}

function getImageUrl(image: JapanTravelEventJsonLd['image']): string | null {
  for (const entry of toJsonArray<JsonLdImage>(image)) {
    if (typeof entry === 'string') return toAbsoluteUrl(entry)
    const url = toAbsoluteUrl(entry.url)
    if (url) return url
  }
  return null
}

function parseAddress(value: JapanTravelEventJsonLd['location']) {
  const address = value?.address
  if (typeof address === 'string') return normalizeWhitespace(address)
  if (!address || typeof address !== 'object') return ''
  return normalizeWhitespace(
    [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode, address.addressCountry]
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .join(', '),
  )
}

function parseIsoDate(value: string | undefined, fallbackHour: 'start' | 'end') {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T${fallbackHour === 'start' ? '00:00:00' : '23:59:59'}+09:00`
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    return trimmed.length === 16 ? `${trimmed}:00+09:00` : trimmed
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(trimmed)) {
    return `${trimmed.length === 16 ? `${trimmed}:00` : trimmed}+09:00`
  }

  const date = new Date(trimmed)
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString()
}

function inferLifecycle(startsAt: string, endsAt: string): ResourceEventLifecycle {
  const now = new Date()
  const start = new Date(startsAt)
  const end = new Date(endsAt)

  if (Number.isFinite(end.getTime()) && end < now) return 'ended'
  if (Number.isFinite(start.getTime()) && start > now) return 'upcoming'
  return 'live'
}

function inferCategory(title: string, summary: string, description: string): EventCategory {
  const haystack = `${title} ${summary} ${description}`.toLowerCase()

  const checks: Array<[EventCategory, RegExp]> = [
    ['music', /\b(concert|live music|orchestra|recital|festival stage|dj|jazz|rock|music)\b/],
    ['market', /\b(farmers market|farmer'?s market|market|flea market|craft fair|bazaar|antique fair)\b/],
    ['art', /\b(exhibition|museum|gallery|art|installation|retrospective|biennale)\b/],
    ['nature', /\b(cherry blossom|sakura|autumn leaves|momiji|illumination|flower|garden|park|nature|wisteria)\b/],
    ['food', /\b(food festival|gourmet|ramen|sake|wine|beer|tasting|food event)\b/],
    ['festival', /\b(festival|matsuri|parade|celebration|fireworks|hanabi|lantern festival)\b/],
  ]

  for (const [category, pattern] of checks) {
    if (pattern.test(haystack)) return category
  }

  return 'festival'
}

function inferType(category: EventCategory): ImportedJapanTravelEvent['type'] {
  if (category === 'music') return 'concert'
  if (category === 'art') return 'exhibition'
  return 'event'
}

function extractSourceId(sourceUrl: string) {
  const match = sourceUrl.match(/\/(\d+)(?:\/?|$)/)
  if (match) return match[1]
  return createSlug(sourceUrl) || 'unknown'
}

async function fetchHtml(url: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'jumboinjapan-event-importer/1.0 (+https://jumboinjapan.com)',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`)
      }

      return await response.text()
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts) break
      await delay(500 * attempt)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`)
}

function parseIndexCandidates(html: string): IndexEventCandidate[] {
  const seen = new Set<string>()
  const candidates: IndexEventCandidate[] = []

  for (const event of extractEventJsonLd(html)) {
    const sourceUrl = toAbsoluteUrl(event.url)
    const startsAt = parseIsoDate(event.startDate, 'start')
    const endsAt = parseIsoDate(event.endDate ?? event.startDate, 'end')
    const title = normalizeWhitespace(event.name ?? '')

    if (!sourceUrl || !startsAt || !endsAt || !title || seen.has(sourceUrl)) continue

    seen.add(sourceUrl)
    candidates.push({
      sourceUrl,
      title,
      startsAt,
      endsAt,
      summary: normalizeWhitespace(event.description ?? ''),
      imageUrl: getImageUrl(event.image),
      venue: normalizeWhitespace(event.location?.name ?? ''),
      address: parseAddress(event.location),
    })
  }

  return candidates
}

async function parseDetailPage(html: string, candidate: IndexEventCandidate, intakeWindowOptions: JapanTravelIntakeWindowOptions): Promise<ImportedJapanTravelEvent> {
  const $ = load(html)
  const detailJsonLd = extractEventJsonLd(html)[0]
  const sourceUrl = toAbsoluteUrl($('link[rel="canonical"]').attr('href')) ?? candidate.sourceUrl
  const sourceId = extractSourceId(sourceUrl)
  const title = normalizeWhitespace($('h1.title').first().text()) || normalizeWhitespace(detailJsonLd?.name ?? '') || candidate.title
  const titleJa = normalizeWhitespace($('.event__japanese-name').first().text()).replace(/^\(|\)$/g, '')
  const venue =
    normalizeWhitespace($('.event-venue .venue-name').first().text()) ||
    normalizeWhitespace($('.event .fa-home').parent().find('p').first().text()) ||
    normalizeWhitespace(detailJsonLd?.location?.name ?? '') ||
    candidate.venue ||
    title
  const address =
    normalizeWhitespace(
      $('.address p')
        .first()
        .clone()
        .find('a')
        .remove()
        .end()
        .text()
        .replace(/\(\s*\)/g, ''),
    ) || parseAddress(detailJsonLd?.location) || candidate.address
  const officialUrl = toAbsoluteUrl($('.website a').first().attr('href'))
  const linkedUrls = Array.from(
    new Set(
      [
        ...$('.article__content a[href]')
          .map((_, element) => toAbsoluteUrl($(element).attr('href')))
          .get(),
        ...$('.event-venue a[href], .article-directions a[href], .address a[href], .website a[href]')
          .map((_, element) => toAbsoluteUrl($(element).attr('href')))
          .get(),
      ].filter((value): value is string => Boolean(value)),
    ),
  )
  const articleParagraphs = $('.article__content p')
    .map((_, element) => normalizeWhitespace($(element).text()))
    .get()
    .filter(Boolean)
  const description = articleParagraphs.join('\n\n') || normalizeWhitespace(detailJsonLd?.description ?? '') || candidate.summary
  const summary = normalizeWhitespace($('.subtitle').first().text()) || candidate.summary || description.slice(0, 280)
  const gettingThere = normalizeWhitespace($('.article-directions p').first().text())
  const startsAt = parseIsoDate(detailJsonLd?.startDate, 'start') ?? candidate.startsAt
  const endsAt = parseIsoDate(detailJsonLd?.endDate ?? detailJsonLd?.startDate, 'end') ?? candidate.endsAt
  const geo = resolveEventGeo({
    sourceUrl,
    officialLocationTexts: [detailJsonLd?.location?.name ?? '', parseAddress(detailJsonLd?.location)],
    articleLocationTexts: [gettingThere, title, ...articleParagraphs.slice(0, 6)],
    structuredLocationTexts: [venue, address, candidate.venue, candidate.address],
  })
  const cityHint = cityHintFromOfficialUrl(officialUrl) || titleDerivedCity(title)
  const city = isWeakResolvedCity(geo.city) && cityHint ? cityHint : geo.city
  const regionLabel = toAirtableRegionRu(geo.regionLabel)
  const localized = await normalizeEventSurfaceText({
    title,
    titleJa,
    summary,
    description,
    city,
    venue,
    neighborhood: address,
  })
  const years = assessEventYears({
    title,
    startsAt,
    endsAt,
    officialUrl,
    sourceUrl,
    description,
  })
  const category = inferCategory(title, summary, description)
  const type = inferType(category)
  const priceText = normalizeWhitespace($('.event .fa-ticket').parent().find('p').first().text())
  const offerPrice = detailJsonLd?.offers?.price
  const priceCurrency = detailJsonLd?.offers?.priceCurrency
  const priceLabel = formatPriceLabel(priceText, offerPrice, priceCurrency)
  const imageUrl = getImageUrl(detailJsonLd?.image) ?? candidate.imageUrl
  const tags: string[] = []
  const slugBase = createSlug(`${title}-${sourceId}`) || `japantravel-event-${sourceId}`
  const resourceId = `evt-japantravel-${sourceId}`
  const intake = evaluateJapanTravelEventIntake(
    {
      title,
      summary,
      description,
      venue,
      address,
      city,
      regionLabel,
      startsAt,
      endsAt,
      sourceUrl,
      officialUrl,
      linkedUrls,
    },
    intakeWindowOptions,
  )

  return {
    resourceId,
    slug: slugBase,
    type,
    status: 'active',
    title: localized.title,
    city: localized.city,
    regionLabel,
    summary: localized.summary,
    description: localized.description,
    tags,
    primaryUrl: isPreferredPrimaryUrl(officialUrl) ? officialUrl! : sourceUrl,
    editorModule: 'event',
    sourceKey: sourceUrl,
    seedSource: 'japantravel.com/events importer',
    event: {
      resourceId,
      category,
      titleJa,
      venue: localized.venue,
      venueJa: '',
      neighborhood: localized.neighborhood,
      startsAt,
      endsAt,
      priceLabel,
      sourceUrl,
      featured: false,
      lifecycle: inferLifecycle(startsAt, endsAt),
    },
    meta: {
      sourceUrl,
      officialUrl,
      linkedUrls,
      address,
      gettingThere,
      imageUrl,
      sourceId,
      geo,
      years,
      duplicateKey: '',
      duplicateOf: null,
    },
    intake,
  }
}

function finalizeEventDecision(event: ImportedJapanTravelEvent) {
  const hasDateRangeParsed = Boolean(event.event.startsAt && event.event.endsAt)
  const isCurrentOrUpcoming = event.event.lifecycle !== 'ended'
  const noYearInconsistency = !event.meta.years.inconsistent
  const geoResolvable = event.intake.geoResolvable
  const dependsOnlyOnPathGeo = event.meta.geo.confidence === 'path-derived' || event.meta.geo.geoBroken

  let next = {
    ...event,
    meta: {
      ...event.meta,
      duplicateKey: canonicalDuplicateKey(event),
    },
  }

  if (!hasDateRangeParsed) {
    return withDecision(next, 'reject', 'missing_date_range', 'missing-date-range', -5)
  }
  if (!isCurrentOrUpcoming) {
    return withDecision(next, 'ended', 'ended_event', 'ended-event', -5)
  }
  if (!noYearInconsistency) {
    return withDecision(next, 'reject', 'year_inconsistency', 'year-inconsistency', -5)
  }
  if (!geoResolvable) {
    return withDecision(next, 'reject', 'geo_unresolved', 'geo-unresolved', -4)
  }

  if (next.intake.decision === 'import' && !dependsOnlyOnPathGeo) return next
  if (next.intake.decision === 'import' && dependsOnlyOnPathGeo) {
    return withDecision(next, 'review', 'path_only_or_weak_geo', 'weak-geo-review', -2)
  }
  if (next.intake.decision === 'review') return next
  return withDecision(next, 'reject', 'low_significance', 'low-significance', 0)
}

function applyDuplicateGuard(events: ImportedJapanTravelEvent[]) {
  const byExactKey = new Map<string, ImportedJapanTravelEvent[]>()
  const byFuzzyKey = new Map<string, ImportedJapanTravelEvent[]>()
  const byVenueDateKey = new Map<string, ImportedJapanTravelEvent[]>()

  for (const event of events) {
    const exactKey = canonicalDuplicateKey(event)
    const fuzzyKey = fuzzyDuplicateKey(event)
    const venueDateKey = [normalizeDuplicateFragment(event.event.venue), event.event.startsAt.slice(0, 10)].join('::')
    const exactGroup = byExactKey.get(exactKey) ?? []
    exactGroup.push(event)
    byExactKey.set(exactKey, exactGroup)
    const fuzzyGroup = byFuzzyKey.get(fuzzyKey) ?? []
    fuzzyGroup.push(event)
    byFuzzyKey.set(fuzzyKey, fuzzyGroup)
    const venueDateGroup = byVenueDateKey.get(venueDateKey) ?? []
    venueDateGroup.push(event)
    byVenueDateKey.set(venueDateKey, venueDateGroup)
  }

  const duplicateSourceKeys = new Set<string>()
  const duplicateOf = new Map<string, string>()

  for (const group of [...byExactKey.values(), ...byFuzzyKey.values(), ...byVenueDateKey.values()]) {
    if (group.length < 2) continue
    const sorted = [...group].sort(compareEvents)
    const canonical = sorted[0]
    for (const candidate of sorted.slice(1)) {
      if (!areProbablyDuplicate(canonical, candidate) && canonicalDuplicateKey(canonical) !== canonicalDuplicateKey(candidate)) {
        continue
      }
      duplicateSourceKeys.add(candidate.sourceKey)
      duplicateOf.set(candidate.sourceKey, canonical.sourceKey)
    }
  }

  return events.map((event) => {
    if (!duplicateSourceKeys.has(event.sourceKey)) return event
    return withDecision(event, 'duplicate', 'duplicate_event_collision', 'duplicate-event', -6, duplicateOf.get(event.sourceKey) ?? null)
  })
}

function formatPriceLabel(priceText: string, offerPrice: number | string | undefined, priceCurrency: string | undefined) {
  const trimmed = normalizeWhitespace(priceText)
  if (trimmed) {
    if (/^¥/.test(trimmed) || /jpy/i.test(trimmed) || /yen/i.test(trimmed) || /бесплат/i.test(trimmed) || /free/i.test(trimmed)) {
      return trimmed
    }

    if (/^\d[\d,]*$/.test(trimmed)) {
      return `¥${Number(trimmed.replace(/,/g, '')).toLocaleString('en-US')}`
    }

    return trimmed
  }

  if (offerPrice === 0 || offerPrice === '0') return 'Free entry'

  if (typeof offerPrice === 'number' && Number.isFinite(offerPrice)) {
    return `${priceCurrency === 'JPY' || !priceCurrency ? '¥' : `${priceCurrency} `}${offerPrice.toLocaleString('en-US')}`
  }

  if (typeof offerPrice === 'string' && offerPrice.trim()) {
    const normalized = offerPrice.trim()
    if (/^\d[\d,]*$/.test(normalized)) {
      return `${priceCurrency === 'JPY' || !priceCurrency ? '¥' : `${priceCurrency} `}${Number(normalized.replace(/,/g, '')).toLocaleString('en-US')}`
    }

    return normalized
  }

  return ''
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeResourceId(sourceUrl: string): string {
  const sourceId = extractSourceId(sourceUrl)
  return `evt-japantravel-${sourceId}`
}

async function fetchAllAirtableRecords(tableName: string, formula?: string) {
  const { token, baseId } = getAirtableCredentials()
  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required for Airtable writes')
  }

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`)
  url.searchParams.set('pageSize', '100')
  if (formula) url.searchParams.set('filterByFormula', formula)

  const records: AirtableRecord[] = []
  let offset: string | undefined

  do {
    if (offset) {
      url.searchParams.set('offset', offset)
    } else {
      url.searchParams.delete('offset')
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Airtable read failed for ${tableName}: ${response.status} ${await response.text()}`)
    }

    const data = (await response.json()) as { records?: AirtableRecord[]; offset?: string }
    records.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)

  return records
}

async function patchAirtableBatch(tableName: string, records: Array<{ id: string; fields: Record<string, unknown> }>) {
  const { token, baseId } = getAirtableCredentials()
  if (!token || !baseId) throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required for Airtable writes')

  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records }),
  })

  if (!response.ok) {
    throw new Error(`Airtable patch failed for ${tableName}: ${response.status} ${await response.text()}`)
  }
}

async function createAirtableBatch(tableName: string, records: Array<{ fields: Record<string, unknown> }>) {
  const { token, baseId } = getAirtableCredentials()
  if (!token || !baseId) throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required for Airtable writes')

  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records }),
  })

  if (!response.ok) {
    throw new Error(`Airtable create failed for ${tableName}: ${response.status} ${await response.text()}`)
  }
}

function sameFieldValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    const leftArray = Array.isArray(left) ? [...left] : []
    const rightArray = Array.isArray(right) ? [...right] : []
    return JSON.stringify(leftArray) === JSON.stringify(rightArray)
  }

  if (typeof left === 'string' && typeof right === 'string') {
    const leftDate = new Date(left)
    const rightDate = new Date(right)
    if (Number.isFinite(leftDate.getTime()) && Number.isFinite(rightDate.getTime())) {
      return leftDate.getTime() === rightDate.getTime()
    }
  }

  if ((left === undefined || left === null) && (right === '' || right === null)) return true
  if ((right === undefined || right === null) && (left === '' || left === null)) return true
  if ((left === undefined || left === null) && right === false) return true
  if ((right === undefined || right === null) && left === false) return true

  return (left ?? null) === (right ?? null)
}

function isUnchanged(existingFields: Record<string, unknown>, nextFields: Record<string, unknown>) {
  return Object.entries(nextFields).every(([key, value]) => sameFieldValue(existingFields[key], value))
}

function toCoreFields(event: ImportedJapanTravelEvent, seededAt: string) {
  return {
    'Resource ID': event.resourceId,
    'Resource Slug': event.slug,
    'Resource Type': event.type,
    Status: event.status,
    Title: event.title,
    City: event.city,
    'Region Label': event.regionLabel || null,
    Summary: event.summary || null,
    Description: event.description || null,
    Tags: event.tags,
    'Primary URL': event.primaryUrl,
    'Editor Module': event.editorModule,
    'Source Key': event.sourceKey,
    'Seed Source': event.seedSource,
    'Last Seeded At': seededAt,
  }
}

function toEventDetailFields(event: ImportedJapanTravelEvent) {
  return {
    'Resource ID': event.resourceId,
    'Event Category': event.event.category,
    'Title JA': event.event.titleJa,
    Venue: event.event.venue,
    'Venue JA': event.event.venueJa || null,
    Neighborhood: event.event.neighborhood || null,
    'Starts At': event.event.startsAt,
    'Ends At': event.event.endsAt,
    'Price Label': event.event.priceLabel || null,
    'Source URL': event.event.sourceUrl,
    Featured: event.event.featured,
    Lifecycle: event.event.lifecycle,
  }
}

async function upsertTable(
  tableName: string,
  records: Array<{ identity: string; fields: Record<string, unknown> }>,
  existingByIdentity: Map<string, AirtableRecord>,
): Promise<AirtableTableSummary> {
  const toUpdate: Array<{ id: string; fields: Record<string, unknown> }> = []
  const toCreate: Array<{ fields: Record<string, unknown> }> = []
  let unchanged = 0

  for (const record of records) {
    const existing = existingByIdentity.get(record.identity)
    if (!existing) {
      toCreate.push({ fields: record.fields })
      continue
    }

    if (isUnchanged(existing.fields, record.fields)) {
      unchanged += 1
      continue
    }

    toUpdate.push({ id: existing.id, fields: record.fields })
  }

  for (let index = 0; index < toUpdate.length; index += BATCH_SIZE) {
    await patchAirtableBatch(tableName, toUpdate.slice(index, index + BATCH_SIZE))
  }

  for (let index = 0; index < toCreate.length; index += BATCH_SIZE) {
    await createAirtableBatch(tableName, toCreate.slice(index, index + BATCH_SIZE))
  }

  return {
    created: toCreate.length,
    updated: toUpdate.length,
    unchanged,
  }
}

async function upsertImportedEvents(events: ImportedJapanTravelEvent[]) {
  const seededAt = new Date().toISOString()
  const [existingResources, existingEventDetails] = await Promise.all([
    fetchAllAirtableRecords(RESOURCES_TABLE_NAME),
    fetchAllAirtableRecords(RESOURCE_EVENT_DETAILS_TABLE_NAME),
  ])

  const resourcesByIdentity = new Map<string, AirtableRecord>()
  for (const record of existingResources) {
    const resourceId = typeof record.fields['Resource ID'] === 'string' ? String(record.fields['Resource ID']) : ''
    const sourceKey = typeof record.fields['Source Key'] === 'string' ? String(record.fields['Source Key']) : ''
    if (resourceId) resourcesByIdentity.set(resourceId, record)
    if (sourceKey && !resourcesByIdentity.has(sourceKey)) resourcesByIdentity.set(sourceKey, record)
  }

  const eventDetailsByIdentity = new Map<string, AirtableRecord>()
  for (const record of existingEventDetails) {
    const resourceId = typeof record.fields['Resource ID'] === 'string' ? String(record.fields['Resource ID']) : ''
    const sourceUrl = typeof record.fields['Source URL'] === 'string' ? String(record.fields['Source URL']) : ''
    if (resourceId) eventDetailsByIdentity.set(resourceId, record)
    if (sourceUrl && !eventDetailsByIdentity.has(sourceUrl)) eventDetailsByIdentity.set(sourceUrl, record)
  }

  const coreSummary = await upsertTable(
    RESOURCES_TABLE_NAME,
    events.map((event) => ({
      identity: resourcesByIdentity.has(event.sourceKey) ? event.sourceKey : event.resourceId,
      fields: toCoreFields(event, seededAt),
    })),
    resourcesByIdentity,
  )

  const detailSummary = await upsertTable(
    RESOURCE_EVENT_DETAILS_TABLE_NAME,
    events.map((event) => ({
      identity: eventDetailsByIdentity.has(event.event.sourceUrl) ? event.event.sourceUrl : event.resourceId,
      fields: toEventDetailFields(event),
    })),
    eventDetailsByIdentity,
  )

  return {
    resources: coreSummary,
    eventDetails: detailSummary,
  }
}

export async function importJapanTravelEvents(options: JapanTravelImportOptions = {}): Promise<JapanTravelImportResult> {
  const startPage = options.startPage ?? 1
  const maxPages = options.maxPages ?? JAPAN_TRAVEL_IMPORT_DEFAULTS.pages
  const maxItems = options.maxItems === null ? Number.POSITIVE_INFINITY : (options.maxItems ?? JAPAN_TRAVEL_IMPORT_DEFAULTS.limit)
  const dryRun = options.dryRun ?? true
  const includeEnded = options.includeEnded ?? false
  const requestDelayMs = options.requestDelayMs ?? 250
  const log = options.log ?? (() => {})
  const intakeWindowOptions: JapanTravelIntakeWindowOptions = {
    maxFutureDays: options.maxFutureDays ?? JAPAN_TRAVEL_IMPORT_DEFAULTS.futureDays,
    maxPastGraceDays: options.maxPastGraceDays ?? JAPAN_TRAVEL_IMPORT_DEFAULTS.pastGraceDays,
  }

  // Load known Resource IDs from Airtable once upfront. This allows us to skip
  // detail-page fetches for already-imported events while continuing to scan the
  // full catalog on every run (no more early stopping after consecutive known pages).
  const knownResourceIds = new Set<string>()
  try {
    const existingResources = await fetchAllAirtableRecords(RESOURCES_TABLE_NAME)
    for (const record of existingResources) {
      const resourceId = typeof record.fields['Resource ID'] === 'string' ? record.fields['Resource ID'] : ''
      if (resourceId) knownResourceIds.add(resourceId)
    }
    log(`Loaded ${knownResourceIds.size} known resource IDs from Airtable for incremental scan`)
  } catch (err) {
    log(`Warning: Could not load known resources (dry-run or missing creds?): ${err instanceof Error ? err.message : String(err)}`)
  }

  const candidates: IndexEventCandidate[] = []
  const seenCandidateUrls = new Set<string>()
  let pagesVisited = 0
  let stoppedReason: 'page-limit' | 'item-limit' | 'source-exhausted' = 'page-limit'

  for (let page = startPage; page < startPage + maxPages; page += 1) {
    const url = `${JAPAN_TRAVEL_BASE_URL}/events?type=event&p=${page}`
    log(`Fetching index page ${page}: ${url}`)
    const html = await fetchHtml(url)
    const pageCandidates = parseIndexCandidates(html)
    pagesVisited += 1

    if (pageCandidates.length === 0) {
      stoppedReason = 'source-exhausted'
      break
    }

    let addedFromPage = 0

    for (const candidate of pageCandidates) {
      if (candidates.length >= maxItems) break
      if (!seenCandidateUrls.has(candidate.sourceUrl)) {
        seenCandidateUrls.add(candidate.sourceUrl)
        candidates.push(candidate)
        addedFromPage += 1
      }
    }

    if (addedFromPage === 0) {
      stoppedReason = 'source-exhausted'
      log(`Stopping scan at page ${page}: source yielded no new unique event URLs`)
      break
    }

    if (candidates.length >= maxItems) {
      stoppedReason = 'item-limit'
      break
    }
    await delay(requestDelayMs)
  }

  const evaluated: ImportedJapanTravelEvent[] = []

  for (const candidate of candidates) {
    const resourceId = computeResourceId(candidate.sourceUrl)
    if (knownResourceIds.has(resourceId)) {
      log(`Skipping known event (resourceId already in Airtable): ${candidate.sourceUrl}`)
      continue
    }
    log(`Fetching event detail: ${candidate.sourceUrl}`)

    try {
      const html = await fetchHtml(candidate.sourceUrl)
      const event = finalizeEventDecision(await parseDetailPage(html, candidate, intakeWindowOptions))
      evaluated.push(event)
      if (evaluated.length >= maxItems) break
    } catch (error) {
      log(`Skipping event detail after fetch failure: ${candidate.sourceUrl} (${error instanceof Error ? error.message : String(error)})`)
    }

    await delay(requestDelayMs)
  }

  const deduped = applyDuplicateGuard(evaluated)
  const imported: ImportedJapanTravelEvent[] = []
  const review: ImportedJapanTravelEvent[] = []
  const rejected: ImportedJapanTravelEvent[] = []
  const duplicates: ImportedJapanTravelEvent[] = []
  const ended: ImportedJapanTravelEvent[] = []

  for (const event of deduped) {
    if (event.intake.decision === 'duplicate') {
      duplicates.push(event)
      continue
    }

    if (event.intake.decision === 'ended') {
      if (includeEnded) {
        review.push(event)
      } else {
        ended.push(event)
      }
      continue
    }

    if (event.intake.decision === 'import') {
      imported.push(event)
      continue
    }

    if (event.intake.decision === 'review') {
      review.push(event)
      continue
    }

    rejected.push(event)
  }

  const result: JapanTravelImportResult = {
    pagesVisited,
    candidatesFound: candidates.length,
    stoppedReason,
    imported,
    review,
    rejected,
    duplicates,
    ended,
    decisions: {
      import: imported.length,
      review: review.length,
      reject: rejected.length,
      duplicate: duplicates.length,
      ended: ended.length,
    },
    dryRun,
  }

  if (!dryRun && imported.length > 0) {
    result.airtable = await upsertImportedEvents(imported)
  }

  return result
}
