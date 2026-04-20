import eventsData from '@/data/events.json'
import restaurantsData from '@/data/restaurants.json'
import {
  experienceServices,
  practicalServices,
  type ExperienceFormat,
  type ExperienceService,
  type ExperienceSubcategory,
  type PracticalService,
  type ServiceTag,
} from '@/data/services'
import { hotels as legacyHotels, type Hotel as LegacyHotel } from '@/lib/hotels-data'
import { isLikelyEnglishSurfaceText, preferNonEnglishSurfaceText } from '@/lib/event-surface-text'

export const RESOURCES_TABLE_NAME = 'Resources'
export const RESOURCE_SERVICE_DETAILS_TABLE_NAME = 'Resource Service Details'
export const RESOURCE_HOTEL_DETAILS_TABLE_NAME = 'Resource Hotel Details'
export const RESOURCE_EVENT_DETAILS_TABLE_NAME = 'Resource Event Details'
export const RESOURCE_RESTAURANT_DETAILS_TABLE_NAME = 'Resource Restaurant Details'

export const RESOURCE_TYPE_VALUES = ['service', 'hotel', 'restaurant', 'event', 'exhibition', 'concert'] as const
export type ResourceType = (typeof RESOURCE_TYPE_VALUES)[number]

export const RESOURCE_STATUS_VALUES = ['active', 'draft', 'archived'] as const
export type ResourceStatus = (typeof RESOURCE_STATUS_VALUES)[number]

export const RESOURCE_EDITOR_MODULE_VALUES = ['service', 'hotel', 'restaurant', 'event'] as const
export type ResourceEditorModule = (typeof RESOURCE_EDITOR_MODULE_VALUES)[number]

export type ResourceRecord = {
  recordId: string
  resourceId: string
  slug: string
  type: ResourceType
  status: ResourceStatus
  title: string
  city: string
  regionLabel: string
  summary: string
  description: string
  tags: string[]
  primaryUrl: string | null
  editorModule: ResourceEditorModule
  sourceKey: string
  seedSource: string | null
  lastSeededAt: string | null
}

export type ServiceResourceKind = 'experience' | 'practical'

export type ServiceResourceDetail = {
  resourceId: string
  kind: ServiceResourceKind
  partner: string
  venue: string
  partnerUrl: string
  bookingUrl: string | null
  externalUrl: string | null
  format: ExperienceFormat | ''
  subcategory: ExperienceSubcategory[]
  priceFrom: number | null
  currency: 'JPY' | ''
  durationMin: number | null
  agentNotes: string
}

export type HotelResourceDetail = {
  resourceId: string
  tier: string
  regionKey: string
  tripUrl: string | null
  bookingUrl: string | null
  ryokan: boolean
}

export type RestaurantResourceDetail = {
  resourceId: string
  cuisine: string
  area: string
  lunchPrice: string
  dinnerPrice: string
  pocketConciergeUrl: string
  googleMapsUrl: string | null
  michelinStars: number
}

export const eventCategories = ['art', 'festival', 'market', 'nature', 'food', 'music'] as const
export type EventCategory = (typeof eventCategories)[number]
export const RESOURCE_EVENT_LIFECYCLE_VALUES = ['upcoming', 'live', 'ended'] as const
export type ResourceEventLifecycle = (typeof RESOURCE_EVENT_LIFECYCLE_VALUES)[number]

export type EventResourceDetail = {
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

export type ServiceResource = ResourceRecord & { type: 'service'; service: ServiceResourceDetail }
export type HotelResource = ResourceRecord & { type: 'hotel'; hotel: HotelResourceDetail }
export type RestaurantResource = ResourceRecord & { type: 'restaurant'; restaurant: RestaurantResourceDetail }
export type EventLikeResource = ResourceRecord & { type: 'event' | 'exhibition' | 'concert'; event: EventResourceDetail }

export type ResourceHydrated = ServiceResource | HotelResource | RestaurantResource | EventLikeResource

export type LegacyRestaurant = {
  name: string
  description: string | null
  cuisine: string | null
  area: string | null
  city: string
  lunch_price: string | null
  dinner_price: string | null
  pocket_concierge_url: string
  google_maps_url: string | null
  michelin_stars?: number
  resourceId?: string
  slug?: string
  status?: ResourceStatus
  summary?: string | null
  tags?: string[]
  primaryUrl?: string | null
}

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

interface AirtableResponse {
  records: AirtableRecord[]
  offset?: string
}

function getAirtableCredentials() {
  return {
    token: process.env.AIRTABLE_TOKEN?.trim(),
    baseId: process.env.AIRTABLE_BASE_ID?.trim(),
  }
}

function getText(value: unknown): string {
  if (typeof value === 'string') return value.trim()

  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .join('\n')
  }

  return ''
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function getInteger(value: unknown) {
  const parsed = getNumber(value)
  if (parsed === null) return 0
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}

function normalizeResourceType(value: unknown): ResourceType {
  const normalized = getText(value).toLowerCase()
  if (RESOURCE_TYPE_VALUES.includes(normalized as ResourceType)) return normalized as ResourceType
  return 'service'
}

function normalizeResourceStatus(value: unknown): ResourceStatus {
  const normalized = getText(value).toLowerCase()
  if (RESOURCE_STATUS_VALUES.includes(normalized as ResourceStatus)) return normalized as ResourceStatus
  return 'active'
}

function normalizeEditorModule(value: unknown, type: ResourceType): ResourceEditorModule {
  const normalized = getText(value).toLowerCase()
  if (RESOURCE_EDITOR_MODULE_VALUES.includes(normalized as ResourceEditorModule)) return normalized as ResourceEditorModule
  if (type === 'hotel') return 'hotel'
  if (type === 'restaurant') return 'restaurant'
  if (type === 'service') return 'service'
  return 'event'
}

function normalizeServiceKind(value: unknown): ServiceResourceKind {
  return getText(value).toLowerCase() === 'practical' ? 'practical' : 'experience'
}

function normalizeExperienceFormat(value: unknown): ExperienceFormat | '' {
  const normalized = getText(value)
  return ['masterclass', 'ceremony', 'performance', 'activity'].includes(normalized) ? (normalized as ExperienceFormat) : ''
}

function normalizeExperienceSubcategoryList(value: unknown): ExperienceSubcategory[] {
  const allowed: ExperienceSubcategory[] = ['cooking', 'crafts', 'martial_arts', 'theater', 'traditional', 'entertainment']
  return getStringArray(value).filter((item): item is ExperienceSubcategory => allowed.includes(item as ExperienceSubcategory))
}

function normalizeEventCategory(value: unknown): EventCategory {
  const normalized = getText(value).toLowerCase()
  return eventCategories.includes(normalized as EventCategory) ? (normalized as EventCategory) : 'art'
}

function parseEventDateBoundary(value: string, boundary: 'start' | 'end'): Date {
  const normalized = value.trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const suffix = boundary === 'start' ? 'T00:00:00+09:00' : 'T23:59:59+09:00'
    return new Date(`${normalized}${suffix}`)
  }

  return new Date(normalized)
}

const tokyoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function toTokyoDateString(value: string): string {
  const normalized = value.trim()
  if (!normalized) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized

  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime())) return ''

  const parts = tokyoDateFormatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return year && month && day ? `${year}-${month}-${day}` : ''
}

function normalizeEventLifecycle(startsAt: string, endsAt: string, value?: unknown): ResourceEventLifecycle {
  const now = new Date()
  const start = parseEventDateBoundary(startsAt, 'start')
  const end = parseEventDateBoundary(endsAt, 'end')

  if (Number.isFinite(end.getTime()) && end < now) return 'ended'
  if (Number.isFinite(start.getTime()) && start > now) return 'upcoming'
  if (Number.isFinite(start.getTime()) || Number.isFinite(end.getTime())) return 'live'

  const normalized = getText(value).toLowerCase()
  return RESOURCE_EVENT_LIFECYCLE_VALUES.includes(normalized as ResourceEventLifecycle) ? (normalized as ResourceEventLifecycle) : 'live'
}

async function fetchAllRecords(tableName: string) {
  const { token, baseId } = getAirtableCredentials()
  if (!token || !baseId) return null

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`)
  url.searchParams.set('pageSize', '100')

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
      throw new Error(`Airtable read failed for ${tableName}: ${response.status} ${await response.text()}`)
    }

    const data = (await response.json()) as AirtableResponse
    allRecords.push(...data.records)
    offset = data.offset
  } while (offset)

  return allRecords
}

function mapResourceRecord(record: AirtableRecord): ResourceRecord {
  const type = normalizeResourceType(record.fields['Resource Type'])

  return {
    recordId: record.id,
    resourceId: getText(record.fields['Resource ID']),
    slug: getText(record.fields['Resource Slug']),
    type,
    status: normalizeResourceStatus(record.fields.Status),
    title: getText(record.fields.Title),
    city: getText(record.fields.City),
    regionLabel: getText(record.fields['Region Label']),
    summary: getText(record.fields.Summary),
    description: getText(record.fields.Description),
    tags: getStringArray(record.fields.Tags),
    primaryUrl: getText(record.fields['Primary URL']) || null,
    editorModule: normalizeEditorModule(record.fields['Editor Module'], type),
    sourceKey: getText(record.fields['Source Key']),
    seedSource: getText(record.fields['Seed Source']) || null,
    lastSeededAt: getText(record.fields['Last Seeded At']) || null,
  }
}

function mapServiceDetailRecord(record: AirtableRecord): ServiceResourceDetail {
  return {
    resourceId: getText(record.fields['Resource ID']),
    kind: normalizeServiceKind(record.fields['Service Kind']),
    partner: getText(record.fields.Partner),
    venue: getText(record.fields.Venue),
    partnerUrl: getText(record.fields['Partner URL']),
    bookingUrl: getText(record.fields['Booking URL']) || null,
    externalUrl: getText(record.fields['External URL']) || null,
    format: normalizeExperienceFormat(record.fields['Experience Format']),
    subcategory: normalizeExperienceSubcategoryList(record.fields['Experience Subcategory']),
    priceFrom: getNumber(record.fields['Price From']),
    currency: getText(record.fields.Currency) === 'JPY' ? 'JPY' : '',
    durationMin: getNumber(record.fields['Duration Minutes']),
    agentNotes: getText(record.fields['Agent Notes']),
  }
}

function mapHotelDetailRecord(record: AirtableRecord): HotelResourceDetail {
  return {
    resourceId: getText(record.fields['Resource ID']),
    tier: getText(record.fields.Tier),
    regionKey: getText(record.fields['Region Key']),
    tripUrl: getText(record.fields['Trip URL']) || null,
    bookingUrl: getText(record.fields['Booking URL']) || null,
    ryokan: Boolean(record.fields['Is Ryokan']),
  }
}

function mapRestaurantDetailRecord(record: AirtableRecord): RestaurantResourceDetail {
  return {
    resourceId: getText(record.fields['Resource ID']),
    cuisine: getText(record.fields.Cuisine),
    area: getText(record.fields.Area),
    lunchPrice: getText(record.fields['Lunch Price']),
    dinnerPrice: getText(record.fields['Dinner Price']),
    pocketConciergeUrl: getText(record.fields['Pocket Concierge URL']),
    googleMapsUrl: getText(record.fields['Google Maps URL']) || null,
    michelinStars: getInteger(record.fields['Michelin Stars']),
  }
}

function mapEventDetailRecord(record: AirtableRecord): EventResourceDetail {
  const startsAt = getText(record.fields['Starts At'])
  const endsAt = getText(record.fields['Ends At'])

  return {
    resourceId: getText(record.fields['Resource ID']),
    category: normalizeEventCategory(record.fields['Event Category']),
    titleJa: getText(record.fields['Title JA']),
    venue: getText(record.fields.Venue),
    venueJa: getText(record.fields['Venue JA']),
    neighborhood: getText(record.fields.Neighborhood),
    startsAt,
    endsAt,
    priceLabel: getText(record.fields['Price Label']),
    sourceUrl: getText(record.fields['Source URL']),
    featured: Boolean(record.fields.Featured),
    lifecycle: normalizeEventLifecycle(startsAt, endsAt, record.fields.Lifecycle),
  }
}

function createSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildServiceSeed(service: ExperienceService | PracticalService): ResourceHydrated {
  const isExperience = 'partner' in service
  const type: ResourceHydrated['type'] = 'service'
  const resourceId = service.id
  const common: ResourceRecord = {
    recordId: `seed-${resourceId}`,
    resourceId,
    slug: resourceId,
    type,
    status: 'active',
    title: service.name,
    city: service.city,
    regionLabel: isExperience ? service.region : '',
    summary: service.description.trim(),
    description: service.description.trim(),
    tags: service.tags,
    primaryUrl: isExperience ? service.booking_url : service.url,
    editorModule: 'service',
    sourceKey: resourceId,
    seedSource: 'src/data/services.ts',
    lastSeededAt: null,
  }

  if (isExperience) {
    return {
      ...common,
      type,
      service: {
        resourceId,
        kind: 'experience',
        partner: service.partner,
        venue: service.venue?.trim() || '',
        partnerUrl: service.partner_url,
        bookingUrl: service.booking_url,
        externalUrl: null,
        format: service.format,
        subcategory: service.subcategory,
        priceFrom: service.price_from,
        currency: service.currency,
        durationMin: service.duration_min,
        agentNotes: service.agent_notes.trim(),
      },
    }
  }

  return {
    ...common,
    type,
    service: {
      resourceId,
      kind: 'practical',
      partner: '',
      venue: '',
      partnerUrl: '',
      bookingUrl: null,
      externalUrl: service.url,
      format: '',
      subcategory: [],
      priceFrom: null,
      currency: '',
      durationMin: null,
      agentNotes: service.details?.join('\n') ?? '',
    },
  }
}

function buildHotelSeed(hotel: LegacyHotel): ResourceHydrated {
  const resourceId = `hotel-${createSlug(hotel.name)}`
  return {
    recordId: `seed-${resourceId}`,
    resourceId,
    slug: resourceId,
    type: 'hotel',
    status: 'active',
    title: hotel.name,
    city: hotel.region,
    regionLabel: hotel.region,
    summary: '',
    description: '',
    tags: hotel.ryokan ? ['ryokan'] : [],
    primaryUrl: hotel.trip_url ?? null,
    editorModule: 'hotel',
    sourceKey: hotel.name,
    seedSource: 'src/lib/hotels-data.ts',
    lastSeededAt: null,
    hotel: {
      resourceId,
      tier: hotel.tier,
      regionKey: hotel.region,
      tripUrl: hotel.trip_url ?? null,
      bookingUrl: null,
      ryokan: Boolean(hotel.ryokan),
    },
  }
}

type LegacyEventSeed = {
  id: string
  title: string
  titleJa: string
  venue: string
  venueJa: string
  neighborhood: string
  category: EventCategory
  dateStart: string
  dateEnd: string
  price: string
  url: string
  description: string
  tags: string[]
  sourceUrl: string
  featured: boolean
}

function buildEventSeed(event: LegacyEventSeed): ResourceHydrated {
  const type: ResourceHydrated['type'] = event.category === 'music' ? 'concert' : event.category === 'art' ? 'exhibition' : 'event'
  const startsAt = `${event.dateStart}T00:00:00+09:00`
  const endsAt = `${event.dateEnd}T23:59:59+09:00`

  return {
    recordId: `seed-${event.id}`,
    resourceId: event.id,
    slug: event.id,
    type,
    status: 'active',
    title: event.title,
    city: 'Tokyo',
    regionLabel: 'Japan',
    summary: event.description,
    description: event.description,
    tags: event.tags,
    primaryUrl: event.url,
    editorModule: 'event',
    sourceKey: event.id,
    seedSource: 'src/data/events.json',
    lastSeededAt: null,
    event: {
      resourceId: event.id,
      category: event.category,
      titleJa: event.titleJa,
      venue: event.venue,
      venueJa: event.venueJa,
      neighborhood: event.neighborhood,
      startsAt,
      endsAt,
      priceLabel: event.price,
      sourceUrl: event.sourceUrl,
      featured: event.featured,
      lifecycle: normalizeEventLifecycle(startsAt, endsAt),
    },
  }
}

function buildRestaurantSeed(restaurant: LegacyRestaurant, index: number): RestaurantResource {
  const title = restaurant.name.trim()
  const slug = restaurant.slug?.trim() || createSlug(title) || `restaurant-${index + 1}`
  const resourceId = restaurant.resourceId?.trim() || `restaurant-${slug}`
  const description = typeof restaurant.description === 'string' ? restaurant.description.trim() : ''
  const summary = typeof restaurant.summary === 'string' ? restaurant.summary.trim() : ''
  const pocketConciergeUrl = restaurant.pocket_concierge_url?.trim() || restaurant.primaryUrl?.trim() || ''

  return {
    recordId: `seed-${resourceId}`,
    resourceId,
    slug,
    type: 'restaurant',
    status: restaurant.status && RESOURCE_STATUS_VALUES.includes(restaurant.status) ? restaurant.status : 'active',
    title,
    city: restaurant.city.trim(),
    regionLabel: restaurant.area?.trim() ?? '',
    summary: summary || description,
    description,
    tags: Array.isArray(restaurant.tags) ? restaurant.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean) : [],
    primaryUrl: restaurant.primaryUrl?.trim() || pocketConciergeUrl || null,
    editorModule: 'restaurant',
    sourceKey: restaurant.resourceId?.trim() || String(index),
    seedSource: 'src/data/restaurants.json',
    lastSeededAt: null,
    restaurant: {
      resourceId,
      cuisine: restaurant.cuisine?.trim() ?? '',
      area: restaurant.area?.trim() ?? '',
      lunchPrice: restaurant.lunch_price?.trim() ?? '',
      dinnerPrice: restaurant.dinner_price?.trim() ?? '',
      pocketConciergeUrl,
      googleMapsUrl: restaurant.google_maps_url?.trim() ?? null,
      michelinStars: Number.isFinite(restaurant.michelin_stars) ? Math.max(0, Number(restaurant.michelin_stars)) : 0,
    },
  }
}

function buildStaticSeedResources(): ResourceHydrated[] {
  return [
    ...experienceServices.map(buildServiceSeed),
    ...practicalServices.map(buildServiceSeed),
    ...legacyHotels.map(buildHotelSeed),
    ...(eventsData as LegacyEventSeed[]).map(buildEventSeed),
  ]
}

function buildRestaurantSeedResources(): RestaurantResource[] {
  return (restaurantsData as LegacyRestaurant[]).map(buildRestaurantSeed)
}

export function getSeedResources(): ResourceHydrated[] {
  return buildStaticSeedResources().sort((left, right) => left.title.localeCompare(right.title, 'ru'))
}

export function isServiceResource(resource: ResourceHydrated): resource is ServiceResource {
  return resource.type === 'service'
}

export function isHotelResource(resource: ResourceHydrated): resource is HotelResource {
  return resource.type === 'hotel'
}

export function isRestaurantResource(resource: ResourceHydrated): resource is RestaurantResource {
  return resource.type === 'restaurant'
}

export function isEventLikeResource(resource: ResourceHydrated): resource is EventLikeResource {
  return resource.type === 'event' || resource.type === 'exhibition' || resource.type === 'concert'
}

export async function getResources(options?: { types?: ResourceType[] }): Promise<ResourceHydrated[]> {
  const requestedTypes = options?.types

  try {
    const coreRecords = await fetchAllRecords(RESOURCES_TABLE_NAME)
    if (!coreRecords) {
      return getSeedResources().filter((resource) => !requestedTypes || requestedTypes.includes(resource.type))
    }

    const [serviceDetailRecords, hotelDetailRecords, restaurantDetailRecords, eventDetailRecords] = await Promise.all([
      fetchAllRecords(RESOURCE_SERVICE_DETAILS_TABLE_NAME),
      fetchAllRecords(RESOURCE_HOTEL_DETAILS_TABLE_NAME),
      fetchAllRecords(RESOURCE_RESTAURANT_DETAILS_TABLE_NAME),
      fetchAllRecords(RESOURCE_EVENT_DETAILS_TABLE_NAME),
    ])

    const serviceDetailsByResourceId = new Map((serviceDetailRecords ?? []).map((record) => {
      const detail = mapServiceDetailRecord(record)
      return [detail.resourceId, detail]
    }))
    const hotelDetailsByResourceId = new Map((hotelDetailRecords ?? []).map((record) => {
      const detail = mapHotelDetailRecord(record)
      return [detail.resourceId, detail]
    }))
    const restaurantDetailsByResourceId = new Map((restaurantDetailRecords ?? []).map((record) => {
      const detail = mapRestaurantDetailRecord(record)
      return [detail.resourceId, detail]
    }))
    const eventDetailsByResourceId = new Map((eventDetailRecords ?? []).map((record) => {
      const detail = mapEventDetailRecord(record)
      return [detail.resourceId, detail]
    }))

    const hydrated = coreRecords
      .map(mapResourceRecord)
      .flatMap((resource): ResourceHydrated[] => {
        if (requestedTypes && !requestedTypes.includes(resource.type)) return []

        if (resource.type === 'service') {
          const service = serviceDetailsByResourceId.get(resource.resourceId)
          return service ? [{ ...resource, type: 'service', service }] : []
        }

        if (resource.type === 'hotel') {
          const hotel = hotelDetailsByResourceId.get(resource.resourceId)
          return hotel ? [{ ...resource, type: 'hotel', hotel }] : []
        }

        if (resource.type === 'restaurant') {
          const restaurant = restaurantDetailsByResourceId.get(resource.resourceId)
          return restaurant ? [{ ...resource, type: 'restaurant', restaurant }] : []
        }

        const event = eventDetailsByResourceId.get(resource.resourceId)
        return event ? [{ ...resource, type: resource.type, event }] : []
      })
      .sort((left, right) => left.title.localeCompare(right.title, 'ru'))

    return hydrated.length > 0 ? hydrated : getSeedResources().filter((resource) => !requestedTypes || requestedTypes.includes(resource.type))
  } catch (error) {
    console.error('Resources repository fallback activated:', error)
    return getSeedResources().filter((resource) => !requestedTypes || requestedTypes.includes(resource.type))
  }
}

export function toExperienceService(resource: Extract<ResourceHydrated, { type: 'service' }>): ExperienceService | null {
  if (resource.service.kind !== 'experience') return null

  return {
    id: resource.resourceId,
    name: resource.title,
    partner: resource.service.partner,
    venue: resource.service.venue || undefined,
    partner_url: resource.service.partnerUrl,
    city: resource.city,
    region: (resource.regionLabel || 'Другое') as ExperienceService['region'],
    subcategory: resource.service.subcategory,
    format: resource.service.format || 'activity',
    price_from: resource.service.priceFrom,
    currency: resource.service.currency || 'JPY',
    duration_min: resource.service.durationMin,
    description: resource.description,
    agent_notes: resource.service.agentNotes,
    tags: resource.tags.filter((tag): tag is ServiceTag => true) as ServiceTag[],
    booking_url: resource.service.bookingUrl,
  }
}

export function toPracticalService(resource: Extract<ResourceHydrated, { type: 'service' }>): PracticalService | null {
  if (resource.service.kind !== 'practical') return null

  return {
    id: resource.resourceId,
    name: resource.title,
    city: resource.city,
    description: resource.description,
    details: resource.service.agentNotes
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
    url: resource.service.externalUrl,
    tags: resource.tags.filter((tag): tag is ServiceTag => true) as ServiceTag[],
  }
}

export function toLegacyHotel(resource: Extract<ResourceHydrated, { type: 'hotel' }>): LegacyHotel {
  return {
    name: resource.title,
    tier: resource.hotel.tier,
    region: resource.hotel.regionKey,
    trip_url: resource.hotel.tripUrl,
    ryokan: resource.hotel.ryokan,
  }
}

export function toLegacyRestaurant(resource: Extract<ResourceHydrated, { type: 'restaurant' }>): LegacyRestaurant {
  return {
    name: resource.title,
    description: resource.description || null,
    cuisine: resource.restaurant.cuisine || null,
    area: resource.restaurant.area || null,
    city: resource.city,
    lunch_price: resource.restaurant.lunchPrice || null,
    dinner_price: resource.restaurant.dinnerPrice || null,
    pocket_concierge_url: resource.restaurant.pocketConciergeUrl,
    google_maps_url: resource.restaurant.googleMapsUrl,
    michelin_stars: resource.restaurant.michelinStars,
    resourceId: resource.resourceId,
    slug: resource.slug,
    status: resource.status,
    summary: resource.summary || null,
    tags: resource.tags,
    primaryUrl: resource.primaryUrl,
  }
}

export type EventItem = {
  id: string
  title: string
  titleJa: string
  venue: string
  venueJa: string
  neighborhood: string
  city: string
  regionLabel: string
  category: EventCategory
  dateStart: string
  dateEnd: string
  price: string
  url: string
  summary: string
  description: string
  tags: string[]
  sourceUrl: string
  featured: boolean
  resourceType: 'event' | 'exhibition' | 'concert'
  lifecycle: ResourceEventLifecycle
}

export function toEventItem(resource: Extract<ResourceHydrated, { type: 'event' | 'exhibition' | 'concert' }>): EventItem {
  const safeTitle = !isLikelyEnglishSurfaceText(resource.title)
    ? resource.title
    : preferNonEnglishSurfaceText(resource.event.titleJa)
  const safeVenue = !isLikelyEnglishSurfaceText(resource.event.venue)
    ? resource.event.venue
    : preferNonEnglishSurfaceText(resource.event.venueJa)
  const safeNeighborhood = !isLikelyEnglishSurfaceText(resource.event.neighborhood) ? resource.event.neighborhood : ''
  const safeCity = !isLikelyEnglishSurfaceText(resource.city) ? resource.city : ''
  const safeSummary = !isLikelyEnglishSurfaceText(resource.summary)
    ? resource.summary
    : !isLikelyEnglishSurfaceText(resource.description)
      ? resource.description
      : ''
  const safeDescription = !isLikelyEnglishSurfaceText(resource.description)
    ? resource.description
    : !isLikelyEnglishSurfaceText(resource.summary)
      ? resource.summary
      : ''

  return {
    id: resource.resourceId,
    title: safeTitle,
    titleJa: resource.event.titleJa,
    venue: safeVenue,
    venueJa: resource.event.venueJa,
    neighborhood: safeNeighborhood,
    city: safeCity,
    regionLabel: resource.regionLabel,
    category: resource.event.category,
    dateStart: toTokyoDateString(resource.event.startsAt),
    dateEnd: toTokyoDateString(resource.event.endsAt),
    price: resource.event.priceLabel,
    url: resource.primaryUrl ?? '',
    summary: safeSummary,
    description: safeDescription,
    tags: resource.tags,
    sourceUrl: resource.event.sourceUrl,
    featured: resource.event.featured,
    resourceType: resource.type,
    lifecycle: resource.event.lifecycle,
  }
}

export function buildResourcesSeedPayload() {
  const seededAt = new Date().toISOString()
  const seeds = [...getSeedResources(), ...buildRestaurantSeedResources()]

  return {
    core: seeds.map((resource) => ({
      fields: {
        'Resource ID': resource.resourceId,
        'Resource Slug': resource.slug,
        'Resource Type': resource.type,
        Status: resource.status,
        Title: resource.title,
        City: resource.city,
        'Region Label': resource.regionLabel || null,
        Summary: resource.summary || null,
        Description: resource.description || null,
        Tags: resource.tags,
        'Primary URL': resource.primaryUrl,
        'Editor Module': resource.editorModule,
        'Source Key': resource.sourceKey,
        'Seed Source': resource.seedSource,
        'Last Seeded At': seededAt,
      },
    })),
    serviceDetails: seeds.filter((resource): resource is Extract<ResourceHydrated, { type: 'service' }> => resource.type === 'service').map((resource) => ({
      fields: {
        'Resource ID': resource.resourceId,
        'Service Kind': resource.service.kind,
        Partner: resource.service.partner || null,
        Venue: resource.service.venue || null,
        'Partner URL': resource.service.partnerUrl || null,
        'Booking URL': resource.service.bookingUrl,
        'External URL': resource.service.externalUrl,
        'Experience Format': resource.service.format || null,
        'Experience Subcategory': resource.service.subcategory,
        'Price From': resource.service.priceFrom,
        Currency: resource.service.currency || null,
        'Duration Minutes': resource.service.durationMin,
        'Agent Notes': resource.service.agentNotes || null,
      },
    })),
    hotelDetails: seeds.filter((resource): resource is Extract<ResourceHydrated, { type: 'hotel' }> => resource.type === 'hotel').map((resource) => ({
      fields: {
        'Resource ID': resource.resourceId,
        Tier: resource.hotel.tier,
        'Region Key': resource.hotel.regionKey,
        'Trip URL': resource.hotel.tripUrl,
        'Booking URL': resource.hotel.bookingUrl,
        'Is Ryokan': resource.hotel.ryokan,
      },
    })),
    restaurantDetails: seeds.filter((resource): resource is Extract<ResourceHydrated, { type: 'restaurant' }> => resource.type === 'restaurant').map((resource) => ({
      fields: {
        'Resource ID': resource.resourceId,
        Cuisine: resource.restaurant.cuisine || null,
        Area: resource.restaurant.area || null,
        'Lunch Price': resource.restaurant.lunchPrice || null,
        'Dinner Price': resource.restaurant.dinnerPrice || null,
        'Pocket Concierge URL': resource.restaurant.pocketConciergeUrl || null,
        'Google Maps URL': resource.restaurant.googleMapsUrl,
        'Michelin Stars': resource.restaurant.michelinStars,
      },
    })),
    eventDetails: seeds.filter((resource): resource is Extract<ResourceHydrated, { type: 'event' | 'exhibition' | 'concert' }> => resource.type === 'event' || resource.type === 'exhibition' || resource.type === 'concert').map((resource) => ({
      fields: {
        'Resource ID': resource.resourceId,
        'Event Category': resource.event.category,
        'Title JA': resource.event.titleJa,
        Venue: resource.event.venue,
        'Venue JA': resource.event.venueJa,
        Neighborhood: resource.event.neighborhood,
        'Starts At': resource.event.startsAt,
        'Ends At': resource.event.endsAt,
        'Price Label': resource.event.priceLabel,
        'Source URL': resource.event.sourceUrl,
        Featured: resource.event.featured,
        Lifecycle: resource.event.lifecycle,
      },
    })),
  }
}
