import { NextRequest, NextResponse } from 'next/server'

import {
  ADMIN_RESOURCE_HOTEL_TIER_VALUES,
  ADMIN_RESOURCE_REGION_KEY_VALUES,
  RESOURCE_EVENT_DETAILS_TABLE_NAME,
  RESOURCE_EVENT_LIFECYCLE_VALUES,
  RESOURCE_HOTEL_DETAILS_TABLE_NAME,
  RESOURCE_STATUS_VALUES,
  RESOURCE_TYPE_VALUES,
  RESOURCES_TABLE_NAME,
  eventCategories,
  getAdminResourceItems,
  type AdminEventLikeResourceItem,
  type AdminHotelResourceItem,
  type AdminResourceItem,
  type AdminRestaurantResourceItem,
  type AdminServiceResourceItem,
} from '@/lib/admin-resources'
import { validateServiceFields } from '@/lib/admin-service-records'
import { SERVICE_DETAILS_TABLE_NAME } from '@/lib/admin-services'
import { RESOURCE_RESTAURANT_DETAILS_TABLE_NAME } from '@/lib/resources'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN?.trim()
const BASE_ID = process.env.AIRTABLE_BASE_ID?.trim()

interface PatchRecord {
  id: string
  fields: Record<string, unknown>
}

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

interface AirtableResponse {
  records: AirtableRecord[]
  offset?: string
}

function requireAirtableConfig() {
  if (!AIRTABLE_TOKEN || !BASE_ID) {
    throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID must be configured for /api/admin/resources')
  }

  return {
    token: AIRTABLE_TOKEN,
    baseId: BASE_ID,
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toNullableText(value: unknown) {
  const normalized = text(value)
  return normalized ? normalized : null
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}

function validateUrlField(value: unknown, label: string) {
  const normalized = text(value)
  if (!normalized) return null

  try {
    const url = new URL(normalized)
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Only http/https URLs are allowed')
    }
    return url.toString()
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }
}

function validateSingleSelect<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] | null {
  const normalized = text(value)
  if (!normalized) return null
  if (!allowed.includes(normalized as T[number])) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}`)
  }
  return normalized as T[number]
}

function validateBoolean(value: unknown) {
  return Boolean(value)
}

function validateIsoDateTime(value: unknown, label: string) {
  const normalized = text(value)
  if (!normalized) throw new Error(`${label} is required`)
  const parsed = new Date(normalized)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a valid ISO datetime`)
  return parsed.toISOString()
}

function validateNonNegativeInteger(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return parsed
}

function buildFormulaForField(field: string, values: string[]) {
  const escaped = values.map((value) => `{${field}} = "${value.replace(/"/g, '\\"')}"`)
  return escaped.length === 1 ? escaped[0] : `OR(${escaped.join(', ')})`
}

async function fetchAllRecords(tableName: string, formula?: string) {
  const { token, baseId } = requireAirtableConfig()
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`)
  url.searchParams.set('pageSize', '100')
  if (formula) url.searchParams.set('filterByFormula', formula)

  const allRecords: AirtableRecord[] = []
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
      throw new Error(await response.text())
    }

    const data = (await response.json()) as AirtableResponse
    allRecords.push(...data.records)
    offset = data.offset
  } while (offset)

  return allRecords
}

async function patchRecord(tableName: string, recordId: string, fields: Record<string, unknown>) {
  const { token, baseId } = requireAirtableConfig()
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}/${recordId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  return response.json()
}

async function createRecord(tableName: string, fields: Record<string, unknown>) {
  const { token, baseId } = requireAirtableConfig()
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records: [{ fields }] }),
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  return response.json()
}

function validateCoreFields(fields: Record<string, unknown>) {
  const resourceId = text(fields['Resource ID'])
  const slug = text(fields['Resource Slug'])
  const type = validateSingleSelect(fields['Resource Type'], RESOURCE_TYPE_VALUES, 'Resource Type')
  const status = validateSingleSelect(fields.Status, RESOURCE_STATUS_VALUES, 'Status') ?? 'active'
  const title = text(fields.Title)
  const city = text(fields.City)
  const regionLabel = text(fields['Region Label'])
  const summary = text(fields.Summary)
  const description = text(fields.Description)
  const tags = toStringArray(fields.Tags)
  const primaryUrl = validateUrlField(fields['Primary URL'], 'Primary URL')

  if (!resourceId) throw new Error('Resource ID is required')
  if (!slug) throw new Error('Resource Slug is required')
  if (!type) throw new Error('Resource Type is required')
  if (!title) throw new Error('Title is required')
  if (!city) throw new Error('City is required')

  return {
    resourceId,
    coreFields: {
      'Resource ID': resourceId,
      'Resource Slug': slug,
      'Resource Type': type,
      Status: status,
      Title: title,
      City: city,
      'Region Label': regionLabel || null,
      Summary: summary || null,
      Description: description || null,
      Tags: tags,
      'Primary URL': primaryUrl,
      'Editor Module': type === 'hotel' ? 'hotel' : type === 'service' ? 'service' : type === 'restaurant' ? 'restaurant' : 'event',
      'Source Key': resourceId,
    },
    type,
  }
}

function validateHotelFields(fields: Record<string, unknown>) {
  const core = validateCoreFields(fields)
  if (core.type !== 'hotel') throw new Error('Hotel editor can only save hotel resources')

  const tier = validateSingleSelect(fields.Tier, ADMIN_RESOURCE_HOTEL_TIER_VALUES, 'Tier')
  const regionKey = validateSingleSelect(fields['Region Key'], ADMIN_RESOURCE_REGION_KEY_VALUES, 'Region Key')
  const tripUrl = validateUrlField(fields['Trip URL'], 'Trip URL')
  const bookingUrl = validateUrlField(fields['Booking URL'], 'Booking URL')
  const ryokan = validateBoolean(fields['Is Ryokan'])

  if (!tier) throw new Error('Tier is required')
  if (!regionKey) throw new Error('Region Key is required')

  return {
    resourceId: core.resourceId,
    coreFields: {
      ...core.coreFields,
      'Primary URL': tripUrl ?? bookingUrl ?? core.coreFields['Primary URL'],
    },
    detailFields: {
      'Resource ID': core.resourceId,
      Tier: tier,
      'Region Key': regionKey,
      'Trip URL': tripUrl,
      'Booking URL': bookingUrl,
      'Is Ryokan': ryokan,
    },
  }
}

function validateRestaurantFields(fields: Record<string, unknown>) {
  const core = validateCoreFields(fields)
  if (core.type !== 'restaurant') throw new Error('Restaurant editor can only save restaurant resources')

  const cuisine = text(fields.Cuisine)
  const area = text(fields.Area)
  const lunchPrice = text(fields['Lunch Price'])
  const dinnerPrice = text(fields['Dinner Price'])
  const pocketConciergeUrl = validateUrlField(fields['Pocket Concierge URL'], 'Pocket Concierge URL')
  const googleMapsUrl = validateUrlField(fields['Google Maps URL'], 'Google Maps URL')
  const michelinStars = validateNonNegativeInteger(fields['Michelin Stars'], 'Michelin Stars')

  if (!pocketConciergeUrl && !core.coreFields['Primary URL']) {
    throw new Error('Pocket Concierge URL or Primary URL is required')
  }

  return {
    resourceId: core.resourceId,
    coreFields: {
      ...core.coreFields,
      'Primary URL': pocketConciergeUrl ?? core.coreFields['Primary URL'],
      'Region Label': area || core.coreFields['Region Label'],
    },
    detailFields: {
      'Resource ID': core.resourceId,
      Cuisine: cuisine || null,
      Area: area || null,
      'Lunch Price': lunchPrice || null,
      'Dinner Price': dinnerPrice || null,
      'Pocket Concierge URL': pocketConciergeUrl ?? core.coreFields['Primary URL'],
      'Google Maps URL': googleMapsUrl,
      'Michelin Stars': michelinStars,
    },
  }
}

function validateEventFields(fields: Record<string, unknown>) {
  const core = validateCoreFields(fields)
  if (!['event', 'exhibition', 'concert'].includes(core.type)) {
    throw new Error('Event editor can only save event-like resources')
  }

  const category = validateSingleSelect(fields['Event Category'], eventCategories, 'Event Category')
  const titleJa = text(fields['Title JA'])
  const venue = text(fields.Venue)
  const venueJa = text(fields['Venue JA'])
  const neighborhood = text(fields.Neighborhood)
  const startsAt = validateIsoDateTime(fields['Starts At'], 'Starts At')
  const endsAt = validateIsoDateTime(fields['Ends At'], 'Ends At')
  const priceLabel = text(fields['Price Label'])
  const sourceUrl = validateUrlField(fields['Source URL'], 'Source URL')
  const featured = validateBoolean(fields.Featured)
  const lifecycle = validateSingleSelect(fields.Lifecycle, RESOURCE_EVENT_LIFECYCLE_VALUES, 'Lifecycle')

  if (!category) throw new Error('Event Category is required')
  if (!titleJa) throw new Error('Title JA is required')
  if (!venue) throw new Error('Venue is required')
  if (!sourceUrl) throw new Error('Source URL is required')
  if (new Date(startsAt) > new Date(endsAt)) throw new Error('Starts At must be before Ends At')

  return {
    resourceId: core.resourceId,
    coreFields: core.coreFields,
    detailFields: {
      'Resource ID': core.resourceId,
      'Event Category': category,
      'Title JA': titleJa,
      Venue: venue,
      'Venue JA': venueJa || null,
      Neighborhood: neighborhood || null,
      'Starts At': startsAt,
      'Ends At': endsAt,
      'Price Label': priceLabel || null,
      'Source URL': sourceUrl,
      Featured: featured,
      Lifecycle: lifecycle,
    },
  }
}

export async function GET() {
  try {
    const items = await getAdminResourceItems()
    return NextResponse.json({ ok: true, items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load resources'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { records?: PatchRecord[] }
    const incomingRecords = body.records

    if (!Array.isArray(incomingRecords) || incomingRecords.length === 0) {
      return NextResponse.json({ ok: false, error: 'records array required' }, { status: 400 })
    }

    const currentItems = await getAdminResourceItems()
    const currentByRecordId = new Map(currentItems.map((item) => [item.recordId, item]))

    const airtableEntries: Array<
      | { currentItem: AdminServiceResourceItem; next: ReturnType<typeof validateServiceFields> }
      | { currentItem: AdminHotelResourceItem; next: ReturnType<typeof validateHotelFields> }
      | { currentItem: AdminRestaurantResourceItem; next: ReturnType<typeof validateRestaurantFields> }
      | { currentItem: AdminEventLikeResourceItem; next: ReturnType<typeof validateEventFields> }
    > = []

    for (const record of incomingRecords) {
      const currentItem = currentByRecordId.get(record.id)
      if (!currentItem) throw new Error(`Unknown resource record: ${record.id}`)

      if (currentItem.type === 'service') {
        airtableEntries.push({ currentItem, next: validateServiceFields(record.fields) })
        continue
      }

      if (currentItem.type === 'hotel') {
        airtableEntries.push({ currentItem, next: validateHotelFields(record.fields) })
        continue
      }

      if (currentItem.type === 'restaurant') {
        airtableEntries.push({ currentItem, next: validateRestaurantFields(record.fields) })
        continue
      }

      airtableEntries.push({ currentItem, next: validateEventFields(record.fields) })
    }

    requireAirtableConfig()

    const serviceIds = airtableEntries
      .filter((entry): entry is { currentItem: AdminServiceResourceItem; next: ReturnType<typeof validateServiceFields> } => entry.currentItem.type === 'service')
      .map((entry) => entry.currentItem.resourceId)
    const hotelIds = airtableEntries
      .filter((entry): entry is { currentItem: AdminHotelResourceItem; next: ReturnType<typeof validateHotelFields> } => entry.currentItem.type === 'hotel')
      .map((entry) => entry.currentItem.resourceId)
    const restaurantIds = airtableEntries
      .filter((entry): entry is { currentItem: AdminRestaurantResourceItem; next: ReturnType<typeof validateRestaurantFields> } => entry.currentItem.type === 'restaurant')
      .map((entry) => entry.currentItem.resourceId)
    const eventIds = airtableEntries
      .filter((entry): entry is { currentItem: AdminEventLikeResourceItem; next: ReturnType<typeof validateEventFields> } =>
        entry.currentItem.type === 'event' || entry.currentItem.type === 'exhibition' || entry.currentItem.type === 'concert',
      )
      .map((entry) => entry.currentItem.resourceId)

    const [serviceDetails, hotelDetails, restaurantDetails, eventDetails] = await Promise.all([
      serviceIds.length > 0 ? fetchAllRecords(SERVICE_DETAILS_TABLE_NAME, buildFormulaForField('Resource ID', serviceIds)) : Promise.resolve([]),
      hotelIds.length > 0 ? fetchAllRecords(RESOURCE_HOTEL_DETAILS_TABLE_NAME, buildFormulaForField('Resource ID', hotelIds)) : Promise.resolve([]),
      restaurantIds.length > 0 ? fetchAllRecords(RESOURCE_RESTAURANT_DETAILS_TABLE_NAME, buildFormulaForField('Resource ID', restaurantIds)) : Promise.resolve([]),
      eventIds.length > 0 ? fetchAllRecords(RESOURCE_EVENT_DETAILS_TABLE_NAME, buildFormulaForField('Resource ID', eventIds)) : Promise.resolve([]),
    ])

    const serviceDetailsByResourceId = new Map(serviceDetails.map((record) => [String(record.fields['Resource ID'] ?? ''), record]))
    const hotelDetailsByResourceId = new Map(hotelDetails.map((record) => [String(record.fields['Resource ID'] ?? ''), record]))
    const restaurantDetailsByResourceId = new Map(restaurantDetails.map((record) => [String(record.fields['Resource ID'] ?? ''), record]))
    const eventDetailsByResourceId = new Map(eventDetails.map((record) => [String(record.fields['Resource ID'] ?? ''), record]))

    for (const entry of airtableEntries) {
      await patchRecord(RESOURCES_TABLE_NAME, entry.currentItem.recordId, entry.next.coreFields)

      if (entry.currentItem.type === 'service') {
        const existingDetail = serviceDetailsByResourceId.get(entry.currentItem.resourceId)
        if (existingDetail) {
          await patchRecord(SERVICE_DETAILS_TABLE_NAME, existingDetail.id, entry.next.detailFields)
        } else {
          await createRecord(SERVICE_DETAILS_TABLE_NAME, entry.next.detailFields)
        }
        continue
      }

      if (entry.currentItem.type === 'hotel') {
        const existingDetail = hotelDetailsByResourceId.get(entry.currentItem.resourceId)
        if (existingDetail) {
          await patchRecord(RESOURCE_HOTEL_DETAILS_TABLE_NAME, existingDetail.id, entry.next.detailFields)
        } else {
          await createRecord(RESOURCE_HOTEL_DETAILS_TABLE_NAME, entry.next.detailFields)
        }
        continue
      }

      if (entry.currentItem.type === 'restaurant') {
        const existingDetail = restaurantDetailsByResourceId.get(entry.currentItem.resourceId)
        if (existingDetail) {
          await patchRecord(RESOURCE_RESTAURANT_DETAILS_TABLE_NAME, existingDetail.id, entry.next.detailFields)
        } else {
          await createRecord(RESOURCE_RESTAURANT_DETAILS_TABLE_NAME, entry.next.detailFields)
        }
        continue
      }

      const existingDetail = eventDetailsByResourceId.get(entry.currentItem.resourceId)
      if (existingDetail) {
        await patchRecord(RESOURCE_EVENT_DETAILS_TABLE_NAME, existingDetail.id, entry.next.detailFields)
      } else {
        await createRecord(RESOURCE_EVENT_DETAILS_TABLE_NAME, entry.next.detailFields)
      }
    }

    const updatedItems = await getAdminResourceItems()
    const updatedByRecordId = new Map(updatedItems.map((item) => [item.recordId, item]))
    const responseItems = incomingRecords
      .map((record) => updatedByRecordId.get(record.id))
      .filter((item): item is AdminResourceItem => Boolean(item))

    return NextResponse.json({ ok: true, items: responseItems, saved: responseItems.length, skipped: 0 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save resources'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
