import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import type { MultiDayBuilderDay, MultiDayBuilderDayItem, MultiDayBuilderRoute, MultiDayBuilderTransportSegment } from '@/lib/multi-day-builder'

export interface SavedMultiDayRouteSummary {
  slug: string
  title: string
  titleEn: string
  dayCount: number
  status: MultiDayBuilderRoute['status']
  lastBuilderSync: string
  /** Для карточки на хабе /multi-day */
  startCity: string
  endCity: string
  previewSubtitle: string
  heroImagePath: string
}

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

interface AirtableResponse {
  records?: AirtableRecord[]
  offset?: string
}

const ROUTES_TABLE = 'Routes'
const ROUTE_DAYS_TABLE = 'Route Days'
const DAY_ITEMS_TABLE = 'Day Items'
const TRANSPORT_SEGMENTS_TABLE = 'Transport Segments'

function getAirtableCredentials() {
  return {
    token: process.env.AIRTABLE_TOKEN?.trim(),
    baseId: process.env.AIRTABLE_BASE_ID?.trim(),
  }
}

function ensureCredentials() {
  const { token, baseId } = getAirtableCredentials()
  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required for multi-day builder writes')
  }
  return { token, baseId }
}

function buildUrl(baseId: string, tableName: string) {
  return `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`
}

async function fetchAllRecords(tableName: string, formula?: string) {
  const { token, baseId } = ensureCredentials()
  const url = new URL(buildUrl(baseId, tableName))
  url.searchParams.set('pageSize', '100')
  if (formula) url.searchParams.set('filterByFormula', formula)

  const records: AirtableRecord[] = []
  let offset: string | undefined

  do {
    if (offset) url.searchParams.set('offset', offset)
    else url.searchParams.delete('offset')

    const response = await fetchAirtableWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Airtable read failed for ${tableName}: ${response.status} ${await response.text()}`)
    }

    const data = (await response.json()) as AirtableResponse
    records.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)

  return records
}

async function patchBatch(tableName: string, records: Array<{ id: string; fields: Record<string, unknown> }>) {
  if (records.length === 0) return
  const { token, baseId } = ensureCredentials()
  const response = await fetchAirtableWithRetry(buildUrl(baseId, tableName), {
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

async function createBatch(tableName: string, records: Array<{ fields: Record<string, unknown> }>) {
  if (records.length === 0) return
  const { token, baseId } = ensureCredentials()
  const response = await fetchAirtableWithRetry(buildUrl(baseId, tableName), {
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

async function deleteBatch(tableName: string, recordIds: string[]) {
  if (recordIds.length === 0) return
  const { token, baseId } = ensureCredentials()
  const url = new URL(buildUrl(baseId, tableName))
  for (const recordId of recordIds) {
    url.searchParams.append('records[]', recordId)
  }

  const response = await fetchAirtableWithRetry(url.toString(), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error(`Airtable delete failed for ${tableName}: ${response.status} ${await response.text()}`)
  }
}

function sameFieldValue(left: unknown, right: unknown): boolean {
  if ((left === undefined || left === null) && (right === undefined || right === null || right === '')) return true
  if ((right === undefined || right === null) && (left === undefined || left === null || left === '')) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    const leftArray = Array.isArray(left) ? left : []
    const rightArray = Array.isArray(right) ? right : []
    return JSON.stringify(leftArray) === JSON.stringify(rightArray)
  }
  return (left ?? null) === (right ?? null)
}

function fieldsEqual(existing: Record<string, unknown>, next: Record<string, unknown>) {
  return Object.entries(next).every(([key, value]) => sameFieldValue(existing[key], value))
}

function getText(fields: Record<string, unknown>, fieldName: string) {
  const value = fields[fieldName]
  return typeof value === 'string' ? value : ''
}

function getPoiIdFromItem(item: MultiDayBuilderDayItem) {
  return item.internalNotes.startsWith('POI ID: ') ? item.internalNotes.replace('POI ID: ', '').trim() : ''
}

function getNumber(fields: Record<string, unknown>, fieldName: string) {
  const value = fields[fieldName]
  return typeof value === 'number' ? value : Number(value) || 0
}

function splitRegions(value: string) {
  return value
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function normalizeStatus(value: string): MultiDayBuilderRoute['status'] {
  return value === 'Review' || value === 'Published' || value === 'Archived' ? value : 'Draft'
}

function normalizeDayType(value: string): MultiDayBuilderDay['dayType'] {
  return value === 'arrival' || value === 'departure' || value === 'independent' ? value : 'touring'
}

function normalizeDisplayStatus(value: string): MultiDayBuilderDay['displayStatus'] {
  return value === 'Edited' || value === 'Locked' ? value : 'Generated'
}

function normalizeItemType(value: string): MultiDayBuilderDayItem['itemType'] {
  return value === 'poi' || value === 'transport' || value === 'hotel' || value === 'meal' || value === 'note' || value === 'arrival' || value === 'departure' || value === 'day_block'
    ? value as MultiDayBuilderDayItem['itemType']
    : 'note'
}

function normalizeSourceMode(value: string): MultiDayBuilderDayItem['sourceMode'] {
  return value === 'manual' ? 'manual' : 'generated'
}

function normalizeTransportMode(value: string): MultiDayBuilderTransportSegment['mode'] {
  return value === 'walk' || value === 'train' || value === 'shinkansen' || value === 'bus' || value === 'car' || value === 'flight' || value === 'mixed'
    ? value
    : 'train'
}

function normalizeCostBasis(value: string): MultiDayBuilderTransportSegment['costBasis'] {
  return value === 'manual' || value === 'api' ? value : 'heuristic'
}

function normalizePricingConfidence(value: string): MultiDayBuilderTransportSegment['pricingConfidence'] {
  return value === 'medium' || value === 'high' ? value : 'low'
}

function normalizeDepartureMode(value: string): MultiDayBuilderTransportSegment['departureMode'] {
  // self/with_guide устарели (2026-07-11): гид — отдельная переменная.
  return value === 'public_transport' || value === 'chartered' || value === 'private' ? value : ''
}

function toRouteFields(route: MultiDayBuilderRoute, syncStamp: string) {
  return {
    Title: route.title,
    'Title (EN)': route.titleEn,
    Slug: route.slug,
    'Route Type': route.routeType,
    Status: route.status,
    'Day Count': route.dayCount,
    'Tour Start Date': route.startDate || null,
    'Hero Image Path': route.heroImagePath || null,
    'Start City': route.startCity || null,
    'Start City ID': route.startCityId || null,
    'End City': route.endCity || null,
    'End City ID': route.endCityId || null,
    'Preview Title': route.previewTitle || null,
    'Preview Subtitle': route.previewSubtitle || null,
    'Route Version': String(Date.now()),
    'Last Builder Sync': syncStamp,
  }
}

function toRouteDayId(routeSlug: string | undefined, dayNumber: number) {
  const safeSlug = routeSlug || `route-${Date.now()}`
  return `${safeSlug}--day-${dayNumber}`
}

function toRouteDayFields(route: MultiDayBuilderRoute) {
  return route.days.map((day) => ({
    identity: toRouteDayId(route.slug, day.dayNumber),
    fields: {
      'Route Day ID': toRouteDayId(route.slug, day.dayNumber),
      'Route Slug': route.slug,
      'Route Title': route.title,
      'Day Number': day.dayNumber,
      'Day Type': day.dayType,
      'Day Title': day.dayTitle,
      'Day Title (EN)': day.dayTitleEn || null,
      'Day Summary': day.daySummary || null,
      'Day Summary (EN)': day.daySummaryEn || null,
      'Overnight City': day.overnightCity || null,
      'Arrival Flight Number': day.arrivalFlightNumber || null,
      'Departure Flight Number': day.departureFlightNumber || null,
      'Derived Regions': (day.derivedRegions ?? []).join(', ') || null,
      'Primary Region Override': day.primaryRegionOverride || null,
      'Start Location': day.startLocation || null,
      'End Location': day.endLocation || null,
      'Display Status': day.displayStatus,
      'Print Lead': day.printLead || null,
      'Print Footer Note': day.printFooterNote || null,
      'Internal Notes': null,
    },
  }))
}

function toDayItemFields(route: MultiDayBuilderRoute) {
  return route.days.flatMap((day) =>
    day.items.map((item, index) => {
      const poiId = getPoiIdFromItem(item)

      if (item.itemType === 'poi' && item.sourceMode !== 'manual' && !poiId) {
        throw new Error(`Generated POI day item requires POI ID before sync: ${route.slug} day ${day.dayNumber} item ${item.id}`)
      }

      return {
        identity: item.id,
        fields: {
          'Day Item ID': item.id,
          'Route Slug': route.slug,
          'Route Title': route.title,
          'Day Number': day.dayNumber,
          Order: index + 1,
          'Item Type': item.itemType === 'day_block' ? 'note' : item.itemType,
          'POI ID': poiId || null,
          'POI Name Snapshot': item.poiTitle || null,
          'Transport Segment ID': item.transportSegmentId || null,
          'Display Title': item.displayTitle,
          'Display Title (EN)': item.displayTitleEn || null,
          'Short Description': item.shortDescription || null,
          'Short Description (EN)': item.shortDescriptionEn || null,
          'Source Mode': item.sourceMode,
          'Lock Status': item.locked ? 'Locked' : 'Unlocked',
          'Preview Badge': null,
          'Internal Notes': item.internalNotes || null,
        },
      }
    }),
  )
}

function toTransportSegmentFields(route: MultiDayBuilderRoute) {
  return route.days.flatMap((day) =>
    day.transportSegments.map((segment, index) => ({
      identity: segment.id,
      fields: {
        'Transport Segment ID': segment.id,
        'Route Slug': route.slug,
        'Route Title': route.title,
        'Day Number': day.dayNumber,
        Order: index + 1,
        'From Location': segment.fromLocation || null,
        'To Location': segment.toLocation || null,
        Mode: segment.mode,
        'Duration Minutes': segment.durationMinutes,
        'Estimated Cost Min': segment.estimatedCostMin,
        'Estimated Cost Max': segment.estimatedCostMax,
        'Cost Basis': segment.costBasis,
        'Pricing Provider': segment.pricingProvider || null,
        'Pricing Confidence': segment.pricingConfidence,
        'Reservation Note': segment.reservationNote || null,
        'Baggage Note': segment.baggageNote || null,
        'Display Label': segment.displayLabel,
        'Display Label (EN)': segment.displayLabelEn || null,
        'Internal Notes': segment.internalNotes || null,
        // Вариант переезда дня (ЖД/Авиа/Авто): номер рейса, способ выезда
        // к станции/аэропорту, время выезда, публичный комментарий гостям.
        'Service Number': segment.serviceNumber || null,
        'Departure Mode': segment.departureMode || null,
        'Departure With Guide': segment.departureWithGuide || null,
        'Recommended Departure Time': segment.recommendedDepartureTime || null,
        'Guest Comments': segment.guestComments || null,
      },
    })),
  )
}

async function upsertSingleRoute(route: MultiDayBuilderRoute, syncStamp: string, preloaded: AirtableRecord | null) {
  const fields = toRouteFields(route, syncStamp)

  if (!preloaded) {
    await createBatch(ROUTES_TABLE, [{ fields }])
    return
  }

  if (!fieldsEqual(preloaded.fields, fields)) {
    await patchBatch(ROUTES_TABLE, [{ id: preloaded.id, fields }])
  }
}

async function syncIdentityTable(
  tableName: string,
  identityField: string,
  routeSlug: string,
  nextRecords: Array<{ identity: string; fields: Record<string, unknown> }>,
) {
  const existing = await fetchAllRecords(tableName, `{Route Slug}='${routeSlug.replace(/'/g, "\\'")}'`)
  const existingByIdentity = new Map(
    existing
      .map((record) => [typeof record.fields[identityField] === 'string' ? String(record.fields[identityField]) : '', record] as const)
      .filter(([identity]) => Boolean(identity)),
  )

  const nextIds = new Set(nextRecords.map((record) => record.identity))
  const toCreate: Array<{ fields: Record<string, unknown> }> = []
  const toPatch: Array<{ id: string; fields: Record<string, unknown> }> = []

  for (const record of nextRecords) {
    const current = existingByIdentity.get(record.identity)
    if (!current) {
      toCreate.push({ fields: record.fields })
      continue
    }

    if (!fieldsEqual(current.fields, record.fields)) {
      toPatch.push({ id: current.id, fields: record.fields })
    }
  }

  const toDelete = existing.filter((record) => {
    const identity = typeof record.fields[identityField] === 'string' ? String(record.fields[identityField]) : ''
    return identity && !nextIds.has(identity)
  })

  for (let index = 0; index < toPatch.length; index += 10) {
    await patchBatch(tableName, toPatch.slice(index, index + 10))
  }
  for (let index = 0; index < toCreate.length; index += 10) {
    await createBatch(tableName, toCreate.slice(index, index + 10))
  }
  for (let index = 0; index < toDelete.length; index += 10) {
    await deleteBatch(tableName, toDelete.slice(index, index + 10).map((record) => record.id))
  }
}

export async function listSavedMultiDayRoutes(): Promise<SavedMultiDayRouteSummary[]> {
  const records = await fetchAllRecords(ROUTES_TABLE, `{Route Type}='multi-day'`)

  return records
    .map((record) => ({
      slug: getText(record.fields, 'Slug'),
      title: getText(record.fields, 'Title'),
      titleEn: getText(record.fields, 'Title (EN)'),
      dayCount: getNumber(record.fields, 'Day Count'),
      status: normalizeStatus(getText(record.fields, 'Status')),
      lastBuilderSync: getText(record.fields, 'Last Builder Sync'),
      startCity: getText(record.fields, 'Start City'),
      endCity: getText(record.fields, 'End City'),
      previewSubtitle: getText(record.fields, 'Preview Subtitle'),
      heroImagePath: getText(record.fields, 'Hero Image Path'),
    }))
    .filter((route) => Boolean(route.slug))
    .sort((left, right) => (right.lastBuilderSync || '').localeCompare(left.lastBuilderSync || '') || left.title.localeCompare(right.title, 'ru'))
}

export async function loadMultiDayBuilderRoute(slug: string): Promise<MultiDayBuilderRoute | null> {
  const safeSlug = slug.trim()
  if (!safeSlug) return null

  const [routeRecords, dayRecords, itemRecords, transportRecords] = await Promise.all([
    fetchAllRecords(ROUTES_TABLE, `{Slug}='${safeSlug.replace(/'/g, "\\'")}'`),
    fetchAllRecords(ROUTE_DAYS_TABLE, `{Route Slug}='${safeSlug.replace(/'/g, "\\'")}'`),
    fetchAllRecords(DAY_ITEMS_TABLE, `{Route Slug}='${safeSlug.replace(/'/g, "\\'")}'`),
    fetchAllRecords(TRANSPORT_SEGMENTS_TABLE, `{Route Slug}='${safeSlug.replace(/'/g, "\\'")}'`),
  ])

  const routeRecord = routeRecords[0]
  if (!routeRecord) return null

  const itemsByDay = new Map<number, MultiDayBuilderDayItem[]>()
  for (const record of itemRecords) {
    const dayNumber = getNumber(record.fields, 'Day Number')
    const current = itemsByDay.get(dayNumber) ?? []
    current.push({
      id: getText(record.fields, 'Day Item ID') || `day-${dayNumber}-item-${current.length + 1}`,
      order: getNumber(record.fields, 'Order') || current.length + 1,
      itemType: normalizeItemType(getText(record.fields, 'Item Type')),
      displayTitle: getText(record.fields, 'Display Title'),
      displayTitleEn: getText(record.fields, 'Display Title (EN)'),
      shortDescription: getText(record.fields, 'Short Description'),
      shortDescriptionEn: getText(record.fields, 'Short Description (EN)'),
      sourceMode: normalizeSourceMode(getText(record.fields, 'Source Mode')),
      locked: getText(record.fields, 'Lock Status') === 'Locked',
      poiTitle: getText(record.fields, 'POI Name Snapshot'),
      transportSegmentId: getText(record.fields, 'Transport Segment ID') || null,
      internalNotes: getText(record.fields, 'Internal Notes') || (getText(record.fields, 'POI ID') ? `POI ID: ${getText(record.fields, 'POI ID')}` : ''),
    })
    itemsByDay.set(dayNumber, current)
  }

  const transportsByDay = new Map<number, MultiDayBuilderTransportSegment[]>()
  for (const record of transportRecords) {
    const dayNumber = getNumber(record.fields, 'Day Number')
    const current = transportsByDay.get(dayNumber) ?? []
    current.push({
      id: getText(record.fields, 'Transport Segment ID') || `transport-${dayNumber}-${current.length + 1}`,
      order: getNumber(record.fields, 'Order') || current.length + 1,
      fromLocation: getText(record.fields, 'From Location'),
      toLocation: getText(record.fields, 'To Location'),
      mode: normalizeTransportMode(getText(record.fields, 'Mode')),
      durationMinutes: getNumber(record.fields, 'Duration Minutes') || null,
      estimatedCostMin: getNumber(record.fields, 'Estimated Cost Min') || null,
      estimatedCostMax: getNumber(record.fields, 'Estimated Cost Max') || null,
      costBasis: normalizeCostBasis(getText(record.fields, 'Cost Basis')),
      pricingProvider: getText(record.fields, 'Pricing Provider'),
      pricingConfidence: normalizePricingConfidence(getText(record.fields, 'Pricing Confidence')),
      reservationNote: getText(record.fields, 'Reservation Note'),
      baggageNote: getText(record.fields, 'Baggage Note'),
      displayLabel: getText(record.fields, 'Display Label') || 'Блок транспорта',
      displayLabelEn: getText(record.fields, 'Display Label (EN)'),
      internalNotes: getText(record.fields, 'Internal Notes'),
      serviceNumber: getText(record.fields, 'Service Number'),
      departureMode: normalizeDepartureMode(getText(record.fields, 'Departure Mode')),
      departureWithGuide: record.fields['Departure With Guide'] === true,
      recommendedDepartureTime: getText(record.fields, 'Recommended Departure Time'),
      guestComments: getText(record.fields, 'Guest Comments'),
    })
    transportsByDay.set(dayNumber, current)
  }

  const days = dayRecords
    .map((record) => ({
      id: getText(record.fields, 'Route Day ID') || `route-day-${getNumber(record.fields, 'Day Number')}`,
      dayNumber: getNumber(record.fields, 'Day Number'),
      dayType: normalizeDayType(getText(record.fields, 'Day Type')),
      dayTitle: getText(record.fields, 'Day Title'),
      dayTitleEn: getText(record.fields, 'Day Title (EN)'),
      daySummary: getText(record.fields, 'Day Summary'),
      daySummaryEn: getText(record.fields, 'Day Summary (EN)'),
      overnightCity: getText(record.fields, 'Overnight City'),
      arrivalFlightNumber: getText(record.fields, 'Arrival Flight Number'),
      departureFlightNumber: getText(record.fields, 'Departure Flight Number'),
      derivedRegions: splitRegions(getText(record.fields, 'Derived Regions')),
      primaryRegionOverride: getText(record.fields, 'Primary Region Override'),
      startLocation: getText(record.fields, 'Start Location'),
      endLocation: getText(record.fields, 'End Location'),
      displayStatus: normalizeDisplayStatus(getText(record.fields, 'Display Status')),
      printLead: getText(record.fields, 'Print Lead'),
      printFooterNote: getText(record.fields, 'Print Footer Note'),
      items: (itemsByDay.get(getNumber(record.fields, 'Day Number')) ?? []).sort((left, right) => left.order - right.order),
      transportSegments: (transportsByDay.get(getNumber(record.fields, 'Day Number')) ?? []).sort((left, right) => left.order - right.order),
    }))
    .sort((left, right) => left.dayNumber - right.dayNumber)

  return {
    id: getText(routeRecord.fields, 'Route ID') || safeSlug,
    title: getText(routeRecord.fields, 'Title'),
    titleEn: getText(routeRecord.fields, 'Title (EN)'),
    slug: getText(routeRecord.fields, 'Slug') || safeSlug,
    routeType: 'multi-day',
    status: normalizeStatus(getText(routeRecord.fields, 'Status')),
    dayCount: getNumber(routeRecord.fields, 'Day Count') || days.length,
    startDate: getText(routeRecord.fields, 'Tour Start Date'),
    lastBuilderSync: getText(routeRecord.fields, 'Last Builder Sync'),
    heroImagePath: getText(routeRecord.fields, 'Hero Image Path'),
    startCityId: getText(routeRecord.fields, 'Start City ID'),
    startCity: getText(routeRecord.fields, 'Start City'),
    endCityId: getText(routeRecord.fields, 'End City ID'),
    endCity: getText(routeRecord.fields, 'End City'),
    previewTitle: getText(routeRecord.fields, 'Preview Title') || getText(routeRecord.fields, 'Title'),
    previewSubtitle: getText(routeRecord.fields, 'Preview Subtitle'),
    days,
  }
}

export interface RouteFaqEntry {
  q: string
  a: string
}

export interface MultiDayRouteSeoFields {
  seoTitle: string
  seoDescription: string
  routeIntro: string
  /** FAQ маршрута (GEO): из Airtable-поля FAQ, JSON [{q,a}]. */
  faq: RouteFaqEntry[]
}

function parseFaq(raw: string): RouteFaqEntry[] {
  if (!raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is { q: unknown; a: unknown } => typeof item === 'object' && item !== null)
      .map((item) => ({ q: String(item.q ?? '').trim(), a: String(item.a ?? '').trim() }))
      .filter((item) => item.q !== '' && item.a !== '')
  } catch {
    return []
  }
}

/**
 * SEO/editorial copy for a Route Builder route's public page. Kept separate from
 * loadMultiDayBuilderRoute() (used by the admin editor) since these fields are
 * public-page-only and not part of the day/item/transport editing model.
 */
export async function getMultiDayRouteSeoFields(slug: string): Promise<MultiDayRouteSeoFields | null> {
  const safeSlug = slug.trim()
  if (!safeSlug) return null

  const routeRecords = await fetchAllRecords(ROUTES_TABLE, `{Slug}='${safeSlug.replace(/'/g, "\\'")}'`)
  const routeRecord = routeRecords[0]
  if (!routeRecord) return null

  return {
    seoTitle: getText(routeRecord.fields, 'SEO Title Approved'),
    seoDescription: getText(routeRecord.fields, 'SEO Description Approved'),
    routeIntro: getText(routeRecord.fields, 'Route Intro Approved'),
    faq: parseFaq(getText(routeRecord.fields, 'FAQ')),
  }
}

/**
 * Cached entry point for public static/ISR pages (the 12 intercity pages).
 * Not used by /multi-day/[slug]/page.tsx (still force-dynamic, out of scope
 * for this pass) or any admin surface -- nothing currently writes these
 * fields through this codebase (they're edited directly in Airtable), so
 * there's no admin write path that needs a fresh, uncached read here. Tagged
 * 'airtable:routes' -- the same tag as getIntercityRouteStopsCached /
 * getCityDataCached -- so a single revalidateTag('airtable:routes', 'max')
 * call covers route stops, city data, and this SEO/intro copy together.
 */
export const getMultiDayRouteSeoFieldsCached = cache(
  unstable_cache(
    (slug: string) => getMultiDayRouteSeoFields(slug),
    ['multi-day-route-seo-fields'],
    { tags: ['airtable:routes'], revalidate: 3600 },
  ),
)

/**
 * Cached reads for the public /multi-day pages (ISR). Same 'airtable:routes'
 * tag: the builder save API calls revalidateTag('airtable:routes', 'max'),
 * so publishing a route from the admin still shows up on the site
 * immediately — ISR here trades nothing away versus the old force-dynamic
 * rendering except the per-request Airtable round-trips.
 */
export const loadMultiDayBuilderRouteCached = cache(
  unstable_cache(
    (slug: string) => loadMultiDayBuilderRoute(slug),
    ['multi-day-builder-route'],
    { tags: ['airtable:routes'], revalidate: 3600 },
  ),
)

export const listSavedMultiDayRoutesCached = cache(
  unstable_cache(
    () => listSavedMultiDayRoutes(),
    ['multi-day-saved-routes'],
    { tags: ['airtable:routes'], revalidate: 3600 },
  ),
)

/**
 * Сохранение отклонено серверным предохранителем. Код попадает в API-ответ
 * (HTTP 409) — клиент показывает сообщение и решает, повторять ли запись
 * с явным override.
 */
export class BuilderSaveBlockedError extends Error {
  code: 'SYNC_CONFLICT' | 'SHRINK_BLOCKED' | 'DEMOTE_BLOCKED' | 'SLUG_TAKEN'

  constructor(code: BuilderSaveBlockedError['code'], message: string) {
    super(message)
    this.name = 'BuilderSaveBlockedError'
    this.code = code
  }
}

export interface BuilderSaveOptions {
  /** Явное разрешение сохранить программу, которая заметно меньше существующей (осознанное сокращение). */
  allowShrink?: boolean
  /** Явное разрешение снять маршрут с публикации (Published → Draft/Review/Archived). */
  allowDemote?: boolean
  /**
   * Slug, под которым клиент загрузил маршрут. Если route.slug отличается,
   * это ПЕРЕИМЕНОВАНИЕ существующей записи (patch той же строки Routes +
   * перенос программы), а не создание новой — иначе каждая правка slug
   * плодила бы программы-дубли.
   */
  previousSlug?: string
}

/**
 * Серверные предохранители перед разрушающей записью. Живут именно здесь —
 * на сервере — потому что клиентские проверки не защищают базу от старых
 * задеплоенных клиентов, чужих вкладок и битого состояния (инцидент
 * 2026-07-10: пустой скелет затёр опубликованную программу из 29 блоков).
 */
async function assertSaveIsSafe(
  route: MultiDayBuilderRoute,
  existingRecord: AirtableRecord,
  options: BuilderSaveOptions,
  /** Slug, под которым существующая программа лежит в базе (при переименовании — старый). */
  existingSlug: string,
) {
  // 1. Optimistic concurrency: клиент присылает Last Builder Sync, который
  // он загрузил. Расхождение = базу успел изменить кто-то ещё (другая
  // вкладка, другой агент) — молча перезаписывать нельзя. Старые клиенты
  // без lastBuilderSync проверку не проходят «вслепую» — их ловят guard'ы 2 и 3.
  const serverSync = getText(existingRecord.fields, 'Last Builder Sync').trim()
  const clientSync = (route.lastBuilderSync ?? '').trim()
  if (serverSync && clientSync && serverSync !== clientSync) {
    throw new BuilderSaveBlockedError(
      'SYNC_CONFLICT',
      `Маршрут в базе изменён (${serverSync}) позже, чем версия, загруженная в этой вкладке (${clientSync}). Откройте маршрут заново из списка — иначе сохранение затёрло бы чужие правки.`,
    )
  }

  // 2. Guard «пустое поверх полного»: скелет или сильно усохшая программа
  // не имеет права молча заменить наполненную.
  const incomingCount = route.days.reduce((total, day) => total + day.items.length, 0)
  const existingItems = await fetchAllRecords(DAY_ITEMS_TABLE, `{Route Slug}='${existingSlug.replace(/'/g, "\\'")}'`)
  const existingCount = existingItems.length
  const looksDestructive = existingCount >= 5 && (incomingCount <= 2 || incomingCount < existingCount / 2)
  if (looksDestructive && !options.allowShrink) {
    throw new BuilderSaveBlockedError(
      'SHRINK_BLOCKED',
      `В базе ${existingCount} блоков программы, а сохраняется только ${incomingCount}. Похоже на случайную перезапись пустым состоянием — сохранение остановлено. Если сокращение осознанное, нажмите «Сохранить» ещё раз, чтобы подтвердить.`,
    )
  }

  // 3. Guard снятия с публикации: Published → Draft не бывает случайным
  // побочным эффектом (именно так инцидент увёл тур с сайта).
  const existingStatus = normalizeStatus(getText(existingRecord.fields, 'Status'))
  if (existingStatus === 'Published' && route.status !== 'Published' && !options.allowDemote) {
    throw new BuilderSaveBlockedError(
      'DEMOTE_BLOCKED',
      `Маршрут опубликован на сайте, а сохраняемое состояние имеет статус «${route.status}» — публикация была бы снята. Если это осознанно, нажмите «Сохранить» ещё раз, чтобы подтвердить.`,
    )
  }
}

/**
 * Страховочный снапшот: перед КАЖДОЙ перезаписью существующего маршрута
 * текущее состояние базы целиком уходит в Routes.'Program Backup'.
 * Даже если все предохранители обойдены (или появится новый способ
 * прострелить ногу) — восстановление одношаговое, из соседнего поля.
 * Ошибка бэкапа не блокирует сохранение, но логируется.
 */
async function backupExistingProgram(slug: string, recordId: string) {
  try {
    const snapshot = await loadMultiDayBuilderRoute(slug)
    if (!snapshot) return
    await patchBatch(ROUTES_TABLE, [
      {
        id: recordId,
        fields: {
          'Program Backup': JSON.stringify({ backedUpAt: new Date().toISOString(), route: snapshot }),
        },
      },
    ])
  } catch (error) {
    console.error(`multi-day builder: backup before overwrite failed for ${slug}:`, error)
  }
}

export async function saveMultiDayBuilderRoute(route: MultiDayBuilderRoute, options: BuilderSaveOptions = {}) {
  // Ensure slug exists (handles routes without title/name)
  const safeRoute = { ...route }
  if (!safeRoute.slug || typeof safeRoute.slug !== 'string' || safeRoute.slug.trim() === '') {
    const generatedSlug = `route-${Date.now()}`
    safeRoute.slug = generatedSlug
    // Also update title if missing for better UX
    if (!safeRoute.title || safeRoute.title.trim() === '') {
      safeRoute.title = 'Без названия'
    }
  }

  // Переименование: клиент загрузил маршрут под previousSlug, а сохраняет
  // под другим slug. Это правка ТОЙ ЖЕ записи (rename), не новая программа.
  const previousSlug = (options.previousSlug ?? '').trim()
  const isRename = Boolean(previousSlug && previousSlug !== safeRoute.slug)

  const existingRecords = await fetchAllRecords(ROUTES_TABLE, `{Slug}='${safeRoute.slug.replace(/'/g, "\\'")}'`)
  let existingRecord = existingRecords[0] ?? null
  let renameFromSlug = ''

  if (isRename) {
    if (existingRecord) {
      throw new BuilderSaveBlockedError(
        'SLUG_TAKEN',
        `Slug «${safeRoute.slug}» уже занят другой программой — сохранение перезаписало бы её. Выберите другой slug.`,
      )
    }
    const sourceRecords = await fetchAllRecords(ROUTES_TABLE, `{Slug}='${previousSlug.replace(/'/g, "\\'")}'`)
    const sourceRecord = sourceRecords[0] ?? null
    if (sourceRecord) {
      // Все предохранители и бэкап работают против записи-источника.
      await assertSaveIsSafe(safeRoute as MultiDayBuilderRoute, sourceRecord, options, previousSlug)
      await backupExistingProgram(previousSlug, sourceRecord.id)
      existingRecord = sourceRecord
      renameFromSlug = previousSlug
    }
    // Источник не найден (уже переименован/удалён) — падаем в обычное создание.
  } else if (existingRecord) {
    await assertSaveIsSafe(safeRoute as MultiDayBuilderRoute, existingRecord, options, safeRoute.slug)
    await backupExistingProgram(safeRoute.slug, existingRecord.id)
  }

  // Единый штамп синхронизации: он же уходит в Airtable и возвращается
  // клиенту, чтобы следующее сохранение из той же вкладки прошло
  // concurrency-проверку без перезагрузки маршрута.
  const syncStamp = new Date().toISOString()

  // При rename existingRecord — это запись под СТАРЫМ slug: patch той же
  // строки задаёт ей новый Slug, никакая новая запись не создаётся.
  await upsertSingleRoute(safeRoute as MultiDayBuilderRoute, syncStamp, existingRecord)
  await syncIdentityTable(ROUTE_DAYS_TABLE, 'Route Day ID', safeRoute.slug, toRouteDayFields(safeRoute as MultiDayBuilderRoute))
  await syncIdentityTable(DAY_ITEMS_TABLE, 'Day Item ID', safeRoute.slug, toDayItemFields(safeRoute as MultiDayBuilderRoute))
  await syncIdentityTable(TRANSPORT_SEGMENTS_TABLE, 'Transport Segment ID', safeRoute.slug, toTransportSegmentFields(safeRoute as MultiDayBuilderRoute))

  // Хвост переименования: программа уже пересоздана под новым slug, дети
  // под старым slug осиротели — подчищаем ПОСЛЕ успешной записи новых
  // (обратный порядок при сбое оставил бы дубли, а не потерю данных).
  if (renameFromSlug) {
    for (const tableName of [ROUTE_DAYS_TABLE, DAY_ITEMS_TABLE, TRANSPORT_SEGMENTS_TABLE]) {
      const orphans = await fetchAllRecords(tableName, `{Route Slug}='${renameFromSlug.replace(/'/g, "\\'")}'`)
      for (let index = 0; index < orphans.length; index += 10) {
        await deleteBatch(tableName, orphans.slice(index, index + 10).map((record) => record.id))
      }
    }
  }

  return {
    ok: true,
    slug: safeRoute.slug,
    savedAt: syncStamp,
    builderSync: syncStamp,
  }
}
