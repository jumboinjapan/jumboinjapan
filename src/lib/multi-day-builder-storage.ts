import type { MultiDayBuilderDay, MultiDayBuilderDayItem, MultiDayBuilderRoute, MultiDayBuilderTransportSegment } from '@/lib/multi-day-builder'

export interface SavedMultiDayRouteSummary {
  slug: string
  title: string
  titleEn: string
  dayCount: number
  status: MultiDayBuilderRoute['status']
  lastBuilderSync: string
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

    const response = await fetch(url.toString(), {
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
  const response = await fetch(buildUrl(baseId, tableName), {
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
  const response = await fetch(buildUrl(baseId, tableName), {
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

  const response = await fetch(url.toString(), {
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
  return value === 'Review' || value === 'Live' || value === 'Archived' ? value : 'Draft'
}

function normalizeDayType(value: string): MultiDayBuilderDay['dayType'] {
  return value === 'arrival' || value === 'departure' ? value : 'touring'
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

function toRouteFields(route: MultiDayBuilderRoute) {
  return {
    Title: route.title,
    'Title (EN)': route.titleEn,
    Slug: route.slug,
    'Route Type': route.routeType,
    Status: route.status,
    'Day Count': route.dayCount,
    'Start City': route.startCity || null,
    'Start City ID': route.startCityId || null,
    'End City': route.endCity || null,
    'End City ID': route.endCityId || null,
    'Preview Title': route.previewTitle || null,
    'Preview Subtitle': route.previewSubtitle || null,
    'Route Version': String(Date.now()),
    'Last Builder Sync': new Date().toISOString(),
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
      'Day Summary': day.daySummary || null,
      'Overnight City': day.overnightCity || null,
      'Derived Regions': day.derivedRegions.join(', ') || null,
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
    day.items.map((item, index) => ({
      identity: item.id,
      fields: {
        'Day Item ID': item.id,
        'Route Slug': route.slug,
        'Route Title': route.title,
        'Day Number': day.dayNumber,
        Order: index + 1,
        'Item Type': item.itemType,
        'POI ID': item.internalNotes.startsWith('POI ID: ') ? item.internalNotes.replace('POI ID: ', '') : null,
        'POI Name Snapshot': item.poiTitle || null,
        'Transport Segment ID': item.transportSegmentId || null,
        'Display Title': item.displayTitle,
        'Short Description': item.shortDescription || null,
        'Source Mode': item.sourceMode,
        'Lock Status': item.locked ? 'Locked' : 'Unlocked',
        'Preview Badge': null,
        'Internal Notes': item.internalNotes || null,
      },
    })),
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
        'Internal Notes': segment.internalNotes || null,
      },
    })),
  )
}

async function upsertSingleRoute(route: MultiDayBuilderRoute) {
  // Guard: ensure slug exists
  if (!route.slug || typeof route.slug !== 'string' || route.slug.trim() === '') {
    const generatedSlug = `route-${Date.now()}`
    route = { ...route, slug: generatedSlug } as MultiDayBuilderRoute
  }
  const existing = await fetchAllRecords(ROUTES_TABLE, `{Slug}='${route.slug.replace(/'/g, "\\'")}'`)
  const fields = toRouteFields(route)

  if (existing.length === 0) {
    await createBatch(ROUTES_TABLE, [{ fields }])
    return
  }

  const current = existing[0]
  if (!fieldsEqual(current.fields, fields)) {
    await patchBatch(ROUTES_TABLE, [{ id: current.id, fields }])
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
      shortDescription: getText(record.fields, 'Short Description'),
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
      displayLabel: getText(record.fields, 'Display Label') || 'Transport block',
      internalNotes: getText(record.fields, 'Internal Notes'),
    })
    transportsByDay.set(dayNumber, current)
  }

  const days = dayRecords
    .map((record) => ({
      id: getText(record.fields, 'Route Day ID') || `route-day-${getNumber(record.fields, 'Day Number')}`,
      dayNumber: getNumber(record.fields, 'Day Number'),
      dayType: normalizeDayType(getText(record.fields, 'Day Type')),
      dayTitle: getText(record.fields, 'Day Title'),
      daySummary: getText(record.fields, 'Day Summary'),
      overnightCity: getText(record.fields, 'Overnight City'),
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
    startCityId: getText(routeRecord.fields, 'Start City ID'),
    startCity: getText(routeRecord.fields, 'Start City'),
    endCityId: getText(routeRecord.fields, 'End City ID'),
    endCity: getText(routeRecord.fields, 'End City'),
    previewTitle: getText(routeRecord.fields, 'Preview Title') || getText(routeRecord.fields, 'Title'),
    previewSubtitle: getText(routeRecord.fields, 'Preview Subtitle'),
    days,
  }
}

export async function saveMultiDayBuilderRoute(route: MultiDayBuilderRoute) {
  // Ensure slug exists (handles routes without title/name)
  let safeRoute = { ...route }
  if (!safeRoute.slug || typeof safeRoute.slug !== 'string' || safeRoute.slug.trim() === '') {
    const generatedSlug = `route-${Date.now()}`
    safeRoute.slug = generatedSlug
    // Also update title if missing for better UX
    if (!safeRoute.title || safeRoute.title.trim() === '') {
      safeRoute.title = 'Без названия'
    }
  }

  await upsertSingleRoute(safeRoute as MultiDayBuilderRoute)
  await syncIdentityTable(ROUTE_DAYS_TABLE, 'Route Day ID', safeRoute.slug, toRouteDayFields(safeRoute as MultiDayBuilderRoute))
  await syncIdentityTable(DAY_ITEMS_TABLE, 'Day Item ID', safeRoute.slug, toDayItemFields(safeRoute as MultiDayBuilderRoute))
  await syncIdentityTable(TRANSPORT_SEGMENTS_TABLE, 'Transport Segment ID', safeRoute.slug, toTransportSegmentFields(safeRoute as MultiDayBuilderRoute))

  return {
    ok: true,
    slug: safeRoute.slug,
    savedAt: new Date().toISOString(),
  }
}
