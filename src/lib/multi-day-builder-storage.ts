import type { MultiDayBuilderRoute } from '@/lib/multi-day-builder'

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

function toRouteDayId(routeSlug: string, dayNumber: number) {
  return `${routeSlug}--day-${dayNumber}`
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

export async function saveMultiDayBuilderRoute(route: MultiDayBuilderRoute) {
  await upsertSingleRoute(route)
  await syncIdentityTable(ROUTE_DAYS_TABLE, 'Route Day ID', route.slug, toRouteDayFields(route))
  await syncIdentityTable(DAY_ITEMS_TABLE, 'Day Item ID', route.slug, toDayItemFields(route))
  await syncIdentityTable(TRANSPORT_SEGMENTS_TABLE, 'Transport Segment ID', route.slug, toTransportSegmentFields(route))

  return {
    ok: true,
    slug: route.slug,
    savedAt: new Date().toISOString(),
  }
}
