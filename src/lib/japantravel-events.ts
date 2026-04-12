import { load } from 'cheerio'
import {
  evaluateJapanTravelEventIntake,
  type IntakeDecision,
  type IntakeEvaluation,
  type JapanTravelIntakeWindowOptions,
} from './japantravel-event-intake.ts'

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
  maxItems?: number
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
  imported: ImportedJapanTravelEvent[]
  review: ImportedJapanTravelEvent[]
  skipped: ImportedJapanTravelEvent[]
  skippedEnded: number
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

function deriveRegionFromUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl)
    const regionSlug = url.pathname.split('/').filter(Boolean)[0] || ''
    return titleCaseFromSlug(regionSlug)
  } catch {
    return ''
  }
}

function deriveCityFromAddress(address: string, fallbackRegion: string) {
  const regionSlug = createSlug(fallbackRegion)
  const cleanedParts = address
    .split(',')
    .map((part) => normalizeWhitespace(part))
    .map((part) => part.replace(/\b\d{3}-\d{4}\b/g, '').trim())
    .filter((part) => part && !/^japan$/i.test(part))

  for (let index = cleanedParts.length - 1; index >= 0; index -= 1) {
    const part = cleanedParts[index]
    const slug = createSlug(part)
    if (!slug || slug === regionSlug || slug.startsWith(regionSlug)) continue
    if (/\d/.test(part)) continue
    return part
  }

  return cleanedParts[0] || fallbackRegion || 'Japan'
}

async function fetchHtml(url: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
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
  } finally {
    clearTimeout(timeout)
  }
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

function parseDetailPage(html: string, candidate: IndexEventCandidate, intakeWindowOptions: JapanTravelIntakeWindowOptions): ImportedJapanTravelEvent {
  const $ = load(html)
  const detailJsonLd = extractEventJsonLd(html)[0]
  const sourceUrl = toAbsoluteUrl($('link[rel="canonical"]').attr('href')) ?? candidate.sourceUrl
  const sourceId = extractSourceId(sourceUrl)
  const title = normalizeWhitespace($('h1.title').first().text()) || normalizeWhitespace(detailJsonLd?.name ?? '') || candidate.title
  const titleJa = normalizeWhitespace($('.event__japanese-name').first().text()).replace(/^\(|\)$/g, '') || title
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
  const regionLabel = deriveRegionFromUrl(sourceUrl)
  const city = deriveCityFromAddress(address, regionLabel)
  const category = inferCategory(title, summary, description)
  const type = inferType(category)
  const startsAt = parseIsoDate(detailJsonLd?.startDate, 'start') ?? candidate.startsAt
  const endsAt = parseIsoDate(detailJsonLd?.endDate ?? detailJsonLd?.startDate, 'end') ?? candidate.endsAt
  const priceText = normalizeWhitespace($('.event .fa-ticket').parent().find('p').first().text())
  const offerPrice = detailJsonLd?.offers?.price
  const priceCurrency = detailJsonLd?.offers?.priceCurrency
  const priceLabel = formatPriceLabel(priceText, offerPrice, priceCurrency)
  const imageUrl = getImageUrl(detailJsonLd?.image) ?? candidate.imageUrl
  const tags: string[] = []
  const slugBase = createSlug(`${title}-${sourceId}`) || `japantravel-event-${sourceId}`
  const resourceId = `event-japantravel-${sourceId}`
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
    title,
    city,
    regionLabel,
    summary,
    description,
    tags,
    primaryUrl: isPreferredPrimaryUrl(officialUrl) ? officialUrl! : sourceUrl,
    editorModule: 'event',
    sourceKey: sourceUrl,
    seedSource: 'japantravel.com/events importer',
    event: {
      resourceId,
      category,
      titleJa,
      venue,
      venueJa: '',
      neighborhood: address,
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
    },
    intake,
  }
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
  const maxPages = options.maxPages ?? 1
  const maxItems = options.maxItems ?? Number.POSITIVE_INFINITY
  const dryRun = options.dryRun ?? true
  const includeEnded = options.includeEnded ?? false
  const requestDelayMs = options.requestDelayMs ?? 250
  const log = options.log ?? (() => {})
  const intakeWindowOptions: JapanTravelIntakeWindowOptions = {
    maxFutureDays: options.maxFutureDays,
    maxPastGraceDays: options.maxPastGraceDays,
  }

  const candidates: IndexEventCandidate[] = []
  let pagesVisited = 0

  for (let page = startPage; page < startPage + maxPages; page += 1) {
    const url = `${JAPAN_TRAVEL_BASE_URL}/events?type=event&p=${page}`
    log(`Fetching index page ${page}: ${url}`)
    const html = await fetchHtml(url)
    const pageCandidates = parseIndexCandidates(html)
    pagesVisited += 1

    if (pageCandidates.length === 0) break

    for (const candidate of pageCandidates) {
      if (candidates.length >= maxItems) break
      if (!candidates.some((item) => item.sourceUrl === candidate.sourceUrl)) {
        candidates.push(candidate)
      }
    }

    if (candidates.length >= maxItems) break
    await delay(requestDelayMs)
  }

  const imported: ImportedJapanTravelEvent[] = []
  const review: ImportedJapanTravelEvent[] = []
  const skipped: ImportedJapanTravelEvent[] = []
  let skippedEnded = 0

  for (const candidate of candidates) {
    log(`Fetching event detail: ${candidate.sourceUrl}`)
    const html = await fetchHtml(candidate.sourceUrl)
    const event = parseDetailPage(html, candidate, intakeWindowOptions)

    if (!includeEnded && event.event.lifecycle === 'ended') {
      skippedEnded += 1
      skipped.push({
        ...event,
        intake: {
          ...event.intake,
          decision: 'skip',
          score: event.intake.score - 5,
          blockingReasons: Array.from(new Set([...event.intake.blockingReasons, 'ended_event'])),
          signals: [
            ...event.intake.signals,
            {
              kind: 'negative',
              code: 'ended-event',
              score: -5,
              note: 'Event already ended and includeEnded=false.',
            },
          ],
        },
      })
      await delay(requestDelayMs)
      continue
    }

    if (event.intake.decision === 'import') {
      imported.push(event)
    } else if (event.intake.decision === 'review') {
      review.push(event)
    } else {
      skipped.push(event)
    }

    if (imported.length >= maxItems) break
    await delay(requestDelayMs)
  }

  const result: JapanTravelImportResult = {
    pagesVisited,
    candidatesFound: candidates.length,
    imported,
    review,
    skipped,
    skippedEnded,
    decisions: {
      import: imported.length,
      review: review.length,
      skip: skipped.length,
    },
    dryRun,
  }

  if (!dryRun && imported.length > 0) {
    result.airtable = await upsertImportedEvents(imported)
  }

  return result
}
