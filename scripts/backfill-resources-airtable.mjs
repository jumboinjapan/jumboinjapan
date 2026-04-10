import fs from 'node:fs'
import vm from 'node:vm'
import eventsData from '../src/data/events.json' with { type: 'json' }
import restaurantsData from '../src/data/restaurants.json' with { type: 'json' }
import { experienceServices, practicalServices } from '../src/data/services.ts'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\n+/).filter(Boolean).map((line) => {
    const idx = line.indexOf('=')
    return [line.slice(0, idx), line.slice(idx + 1)]
  }),
)
const token = env.AIRTABLE_TOKEN?.trim()
const baseId = env.AIRTABLE_BASE_ID?.trim()
if (!token || !baseId) throw new Error('Missing Airtable env')

const RESOURCES_TABLE_NAME = 'Resources'
const RESOURCE_SERVICE_DETAILS_TABLE_NAME = 'Resource Service Details'
const RESOURCE_HOTEL_DETAILS_TABLE_NAME = 'Resource Hotel Details'
const RESOURCE_RESTAURANT_DETAILS_TABLE_NAME = 'Resource Restaurant Details'
const RESOURCE_EVENT_DETAILS_TABLE_NAME = 'Resource Event Details'
const ALLOWED_TAGS = new Set(['addable_to_tour', 'booking_required', 'indoor', 'outdoor', 'family_friendly', 'adult_only', 'group_min_2', 'solo_ok'])

function createSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
function normalizeEventLifecycle(startsAt, endsAt) {
  const now = Date.now()
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  if (now < start) return 'upcoming'
  if (now > end) return 'ended'
  return 'live'
}

function loadHotels() {
  const src = fs.readFileSync(new URL('../src/lib/hotels-data.ts', import.meta.url), 'utf8')
  const trip = JSON.parse(fs.readFileSync(new URL('../src/data/hotels-trip.json', import.meta.url), 'utf8'))
  let code = src
    .replace(/import hotelsTripData from .*?;\n/, '')
    .replace(/export type Hotel = \{[\s\S]*?\};\n\n/, '')
    .replace(/const hotelsBase: Hotel\[] = /, 'const hotelsBase = ')
    .replace(/export const hotels: Hotel\[] = /, 'const hotels = ')
    .concat('\nmodule.exports = { hotels };\n')
  const sandbox = { hotelsTripData: trip, module: { exports: {} }, exports: {} }
  vm.runInNewContext(code, sandbox, { filename: 'hotels-data.ts' })
  return sandbox.module.exports.hotels
}

async function api(path, init = {}) {
  const response = await fetch(`https://api.airtable.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${response.status} ${JSON.stringify(data)}`)
  return data
}

async function fetchAllExistingRecords(tableName) {
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`)
  url.searchParams.set('pageSize', '100')
  const records = []
  let offset
  do {
    if (offset) url.searchParams.set('offset', offset)
    else url.searchParams.delete('offset')
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const text = await response.text()
    const data = JSON.parse(text)
    if (!response.ok) throw new Error(`GET ${tableName} -> ${response.status} ${text}`)
    records.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)
  return records
}

async function patchBatch(tableName, records) {
  return api(`/v0/${baseId}/${encodeURIComponent(tableName)}`, { method: 'PATCH', body: JSON.stringify({ records }) })
}
async function createBatch(tableName, records) {
  return api(`/v0/${baseId}/${encodeURIComponent(tableName)}`, { method: 'POST', body: JSON.stringify({ records }) })
}
async function syncTable(tableName, payload, keyField) {
  const existing = await fetchAllExistingRecords(tableName)
  const existingByKey = new Map(existing.map((r) => [r.fields[keyField], r.id]))
  const toUpdate = []
  const toCreate = []
  for (const record of payload) {
    const key = record.fields[keyField]
    const id = existingByKey.get(key)
    if (id) toUpdate.push({ id, fields: record.fields })
    else toCreate.push(record)
  }
  for (let i=0;i<toUpdate.length;i+=10) await patchBatch(tableName, toUpdate.slice(i, i+10))
  for (let i=0;i<toCreate.length;i+=10) await createBatch(tableName, toCreate.slice(i, i+10))
  return { updated: toUpdate.length, created: toCreate.length }
}

function buildPayload() {
  const seededAt = new Date().toISOString()
  const hotels = loadHotels()
  const core = []
  const serviceDetails = []
  const hotelDetails = []
  const restaurantDetails = []
  const eventDetails = []

  for (const service of [...experienceServices, ...practicalServices]) {
    const isExperience = 'partner' in service
    core.push({ fields: {
      'Resource ID': service.id,
      'Resource Slug': service.id,
      'Resource Type': 'service',
      'Status': 'active',
      'Title': service.name,
      'City': service.city,
      'Region Label': isExperience ? service.region : null,
      'Summary': service.description.trim(),
      'Description': service.description.trim(),
      'Tags': (service.tags || []).filter((tag) => ALLOWED_TAGS.has(tag)),
      'Primary URL': isExperience ? service.booking_url : service.url,
      'Editor Module': 'service',
      'Source Key': service.id,
      'Seed Source': 'src/data/services.ts',
      'Last Seeded At': seededAt,
    }})
    serviceDetails.push({ fields: {
      'Resource ID': service.id,
      'Service Kind': isExperience ? 'experience' : 'practical',
      'Partner': isExperience ? service.partner : null,
      'Venue': isExperience ? (service.venue || null) : null,
      'Partner URL': isExperience ? service.partner_url : null,
      'Booking URL': isExperience ? service.booking_url : null,
      'External URL': isExperience ? null : service.url,
      'Experience Format': isExperience ? service.format : null,
      'Experience Subcategory': isExperience ? service.subcategory : [],
      'Price From': isExperience ? service.price_from : null,
      'Currency': isExperience ? service.currency : null,
      'Duration Minutes': isExperience ? service.duration_min : null,
      'Agent Notes': isExperience ? service.agent_notes : null,
    }})
  }

  for (const hotel of hotels) {
    const resourceId = `hotel-${createSlug(hotel.name)}`
    core.push({ fields: {
      'Resource ID': resourceId,
      'Resource Slug': resourceId,
      'Resource Type': 'hotel',
      'Status': 'active',
      'Title': hotel.name,
      'City': hotel.region,
      'Region Label': hotel.region,
      'Summary': null,
      'Description': null,
      'Tags': [],
      'Primary URL': hotel.trip_url ?? null,
      'Editor Module': 'hotel',
      'Source Key': hotel.name,
      'Seed Source': 'src/lib/hotels-data.ts',
      'Last Seeded At': seededAt,
    }})
    hotelDetails.push({ fields: {
      'Resource ID': resourceId,
      'Tier': hotel.tier,
      'Region Key': hotel.region,
      'Trip URL': hotel.trip_url ?? null,
      'Booking URL': null,
      'Is Ryokan': Boolean(hotel.ryokan),
    }})
  }

  for (const [index, restaurant] of restaurantsData.entries()) {
    const title = restaurant.name.trim()
    const slug = restaurant.slug?.trim() || createSlug(title) || `restaurant-${index + 1}`
    const resourceId = restaurant.resourceId?.trim() || `restaurant-${slug}`
    const description = typeof restaurant.description === 'string' ? restaurant.description.trim() : ''
    const summary = typeof restaurant.summary === 'string' ? restaurant.summary.trim() : ''
    const pocket = restaurant.pocket_concierge_url?.trim() || restaurant.primaryUrl?.trim() || ''
    core.push({ fields: {
      'Resource ID': resourceId,
      'Resource Slug': slug,
      'Resource Type': 'restaurant',
      'Status': restaurant.status || 'active',
      'Title': title,
      'City': restaurant.city.trim(),
      'Region Label': restaurant.area?.trim() || null,
      'Summary': summary || description || null,
      'Description': description || null,
      'Tags': [],
      'Primary URL': restaurant.primaryUrl?.trim() || pocket || null,
      'Editor Module': 'restaurant',
      'Source Key': restaurant.resourceId?.trim() || String(index),
      'Seed Source': 'src/data/restaurants.json',
      'Last Seeded At': seededAt,
    }})
    restaurantDetails.push({ fields: {
      'Resource ID': resourceId,
      'Cuisine': restaurant.cuisine?.trim() || null,
      'Area': restaurant.area?.trim() || null,
      'Lunch Price': restaurant.lunch_price?.trim() || null,
      'Dinner Price': restaurant.dinner_price?.trim() || null,
      'Pocket Concierge URL': pocket || null,
      'Google Maps URL': restaurant.google_maps_url?.trim() || null,
      'Michelin Stars': Number.isFinite(restaurant.michelin_stars) ? Math.max(0, Number(restaurant.michelin_stars)) : 0,
    }})
  }

  for (const event of eventsData) {
    const type = event.category === 'music' ? 'concert' : event.category === 'art' ? 'exhibition' : 'event'
    const startsAt = `${event.dateStart}T00:00:00+09:00`
    const endsAt = `${event.dateEnd}T23:59:59+09:00`
    core.push({ fields: {
      'Resource ID': event.id,
      'Resource Slug': event.id,
      'Resource Type': type,
      'Status': 'active',
      'Title': event.title,
      'City': 'Tokyo',
      'Region Label': 'Japan',
      'Summary': event.description || null,
      'Description': event.description || null,
      'Tags': [],
      'Primary URL': event.url,
      'Editor Module': 'event',
      'Source Key': event.id,
      'Seed Source': 'src/data/events.json',
      'Last Seeded At': seededAt,
    }})
    eventDetails.push({ fields: {
      'Resource ID': event.id,
      'Event Category': event.category,
      'Title JA': event.titleJa,
      'Venue': event.venue,
      'Venue JA': event.venueJa || null,
      'Neighborhood': event.neighborhood || null,
      'Starts At': startsAt,
      'Ends At': endsAt,
      'Price Label': event.price || null,
      'Source URL': event.sourceUrl,
      'Featured': Boolean(event.featured),
      'Lifecycle': normalizeEventLifecycle(startsAt, endsAt),
    }})
  }

  return { core, serviceDetails, hotelDetails, restaurantDetails, eventDetails }
}

const payload = buildPayload()
console.log(JSON.stringify({ counts: Object.fromEntries(Object.entries(payload).map(([k,v]) => [k, v.length])) }, null, 2))
console.log(JSON.stringify({
  core: await syncTable(RESOURCES_TABLE_NAME, payload.core, 'Resource ID'),
  serviceDetails: await syncTable(RESOURCE_SERVICE_DETAILS_TABLE_NAME, payload.serviceDetails, 'Resource ID'),
  hotelDetails: await syncTable(RESOURCE_HOTEL_DETAILS_TABLE_NAME, payload.hotelDetails, 'Resource ID'),
  restaurantDetails: await syncTable(RESOURCE_RESTAURANT_DETAILS_TABLE_NAME, payload.restaurantDetails, 'Resource ID'),
  eventDetails: await syncTable(RESOURCE_EVENT_DETAILS_TABLE_NAME, payload.eventDetails, 'Resource ID'),
}, null, 2))
