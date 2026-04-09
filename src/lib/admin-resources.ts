import restaurantsData from '@/data/restaurants.json'
import {
  ADMIN_SERVICE_FORMAT_VALUES,
  ADMIN_SERVICE_KIND_VALUES,
  ADMIN_SERVICE_REGION_VALUES,
  ADMIN_SERVICE_SUBCATEGORY_VALUES,
  ADMIN_SERVICE_TAG_VALUES,
  type AdminServiceFormat,
  type AdminServiceSubcategory,
} from '@/lib/admin-services'
import {
  RESOURCE_EVENT_DETAILS_TABLE_NAME,
  RESOURCE_EVENT_LIFECYCLE_VALUES,
  RESOURCE_HOTEL_DETAILS_TABLE_NAME,
  RESOURCE_STATUS_VALUES,
  RESOURCE_TYPE_VALUES,
  RESOURCES_TABLE_NAME,
  eventCategories,
  getResources,
  isEventLikeResource,
  isHotelResource,
  isServiceResource,
  type EventCategory,
  type HotelResource,
  type ResourceEventLifecycle,
  type ResourceStatus,
  type ResourceType,
} from '@/lib/resources'

type RestaurantSeed = {
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

export const ADMIN_RESOURCE_MANAGED_TYPE_VALUES = [...RESOURCE_TYPE_VALUES, 'restaurant'] as const
export type AdminResourceManagedType = (typeof ADMIN_RESOURCE_MANAGED_TYPE_VALUES)[number]

export const ADMIN_RESOURCE_TYPE_FILTER_VALUES = ['all', ...ADMIN_RESOURCE_MANAGED_TYPE_VALUES] as const
export type AdminResourceTypeFilter = (typeof ADMIN_RESOURCE_TYPE_FILTER_VALUES)[number]

export const ADMIN_RESOURCE_STATUS_FILTER_VALUES = ['all', ...RESOURCE_STATUS_VALUES] as const
export type AdminResourceStatusFilter = (typeof ADMIN_RESOURCE_STATUS_FILTER_VALUES)[number]

export const ADMIN_RESOURCE_HOTEL_TIER_VALUES = ['luxury-center', 'luxury-other', 'premium', 'economy-premium'] as const
export type AdminResourceHotelTier = (typeof ADMIN_RESOURCE_HOTEL_TIER_VALUES)[number]

export const ADMIN_RESOURCE_REGION_KEY_VALUES = ['tokyo', 'kyoto', 'hakone', 'fuji'] as const
export type AdminResourceRegionKey = (typeof ADMIN_RESOURCE_REGION_KEY_VALUES)[number]

export type AdminResourceBaseItem = {
  recordId: string
  resourceId: string
  slug: string
  type: AdminResourceManagedType
  status: ResourceStatus
  title: string
  city: string
  regionLabel: string
  summary: string
  description: string
  tags: string[]
  primaryUrl: string | null
  editorModule: 'service' | 'hotel' | 'event' | 'restaurant'
  sourceKey: string
  seedSource: string | null
  lastSeededAt: string | null
}

export type AdminServiceResourceItem = AdminResourceBaseItem & {
  type: 'service'
  service: {
    kind: (typeof ADMIN_SERVICE_KIND_VALUES)[number]
    partner: string
    venue: string
    partnerUrl: string
    bookingUrl: string | null
    externalUrl: string | null
    format: AdminServiceFormat | ''
    subcategory: AdminServiceSubcategory[]
    priceFrom: number | null
    currency: 'JPY' | ''
    durationMin: number | null
    agentNotes: string
    region: (typeof ADMIN_SERVICE_REGION_VALUES)[number] | ''
    tags: (typeof ADMIN_SERVICE_TAG_VALUES)[number][]
  }
}

export type AdminHotelResourceItem = AdminResourceBaseItem & {
  type: 'hotel'
  hotel: {
    tier: string
    regionKey: string
    tripUrl: string | null
    bookingUrl: string | null
    ryokan: boolean
  }
}

export type AdminEventLikeResourceItem = AdminResourceBaseItem & {
  type: 'event' | 'exhibition' | 'concert'
  event: {
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
}

export type AdminRestaurantResourceItem = AdminResourceBaseItem & {
  type: 'restaurant'
  restaurant: {
    cuisine: string
    area: string
    lunchPrice: string
    dinnerPrice: string
    pocketConciergeUrl: string
    googleMapsUrl: string | null
    michelinStars: number
  }
}

export type AdminResourceItem = AdminServiceResourceItem | AdminHotelResourceItem | AdminEventLikeResourceItem | AdminRestaurantResourceItem

export type AdminResourcesSummary = {
  total: number
  services: number
  hotels: number
  restaurants: number
  events: number
  draft: number
  archived: number
  missingDescriptions: number
  missingPrimaryUrl: number
}

function compareResources(left: AdminResourceItem, right: AdminResourceItem) {
  const leftLabel = left.title || left.resourceId
  const rightLabel = right.title || right.resourceId
  return leftLabel.localeCompare(rightLabel, 'ru')
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
}

function mapHotelResource(resource: HotelResource): AdminHotelResourceItem {
  return {
    recordId: resource.recordId,
    resourceId: resource.resourceId,
    slug: resource.slug,
    type: 'hotel',
    status: resource.status,
    title: resource.title,
    city: resource.city,
    regionLabel: resource.regionLabel,
    summary: resource.summary,
    description: resource.description,
    tags: resource.tags,
    primaryUrl: resource.primaryUrl,
    editorModule: resource.editorModule,
    sourceKey: resource.sourceKey,
    seedSource: resource.seedSource,
    lastSeededAt: resource.lastSeededAt,
    hotel: {
      tier: resource.hotel.tier,
      regionKey: resource.hotel.regionKey,
      tripUrl: resource.hotel.tripUrl,
      bookingUrl: resource.hotel.bookingUrl,
      ryokan: resource.hotel.ryokan,
    },
  }
}

function mapRestaurantResource(resource: RestaurantSeed, index: number): AdminRestaurantResourceItem {
  const title = resource.name.trim()
  const slug = (resource.slug && resource.slug.trim()) || slugify(title) || `restaurant-${index + 1}`
  const resourceId = (resource.resourceId && resource.resourceId.trim()) || `restaurant-${slug}`
  const summary = typeof resource.summary === 'string' ? resource.summary.trim() : ''
  const description = typeof resource.description === 'string' ? resource.description.trim() : ''

  return {
    recordId: `restaurant:${index}`,
    resourceId,
    slug,
    type: 'restaurant',
    status: resource.status && RESOURCE_STATUS_VALUES.includes(resource.status) ? resource.status : 'active',
    title,
    city: resource.city.trim(),
    regionLabel: resource.area?.trim() ?? '',
    summary: summary || description,
    description,
    tags: Array.isArray(resource.tags) ? resource.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean) : [],
    primaryUrl: resource.primaryUrl?.trim() || resource.pocket_concierge_url?.trim() || null,
    editorModule: 'restaurant',
    sourceKey: String(index),
    seedSource: 'src/data/restaurants.json',
    lastSeededAt: null,
    restaurant: {
      cuisine: resource.cuisine?.trim() ?? '',
      area: resource.area?.trim() ?? '',
      lunchPrice: resource.lunch_price?.trim() ?? '',
      dinnerPrice: resource.dinner_price?.trim() ?? '',
      pocketConciergeUrl: resource.pocket_concierge_url?.trim() ?? '',
      googleMapsUrl: resource.google_maps_url?.trim() ?? null,
      michelinStars: Number.isFinite(resource.michelin_stars) ? Math.max(0, Number(resource.michelin_stars)) : 0,
    },
  }
}

export async function getAdminResourceItems(): Promise<AdminResourceItem[]> {
  const resources = await getResources()
  const restaurantItems = (restaurantsData as RestaurantSeed[]).map(mapRestaurantResource)

  return [
    ...resources.map((resource): AdminResourceItem => {
      if (isServiceResource(resource)) {
        return {
          recordId: resource.recordId,
          resourceId: resource.resourceId,
          slug: resource.slug,
          type: 'service',
          status: resource.status,
          title: resource.title,
          city: resource.city,
          regionLabel: resource.regionLabel,
          summary: resource.summary,
          description: resource.description,
          tags: resource.tags,
          primaryUrl: resource.primaryUrl,
          editorModule: resource.editorModule,
          sourceKey: resource.sourceKey,
          seedSource: resource.seedSource,
          lastSeededAt: resource.lastSeededAt,
          service: {
            kind: resource.service.kind,
            partner: resource.service.partner,
            venue: resource.service.venue,
            partnerUrl: resource.service.partnerUrl,
            bookingUrl: resource.service.bookingUrl,
            externalUrl: resource.service.externalUrl,
            format: ADMIN_SERVICE_FORMAT_VALUES.includes(resource.service.format as AdminServiceFormat)
              ? (resource.service.format as AdminServiceFormat)
              : '',
            subcategory: resource.service.subcategory.filter((value): value is AdminServiceSubcategory =>
              ADMIN_SERVICE_SUBCATEGORY_VALUES.includes(value as AdminServiceSubcategory),
            ),
            priceFrom: resource.service.priceFrom,
            currency: resource.service.currency,
            durationMin: resource.service.durationMin,
            agentNotes: resource.service.agentNotes,
            region: ADMIN_SERVICE_REGION_VALUES.includes(resource.regionLabel as (typeof ADMIN_SERVICE_REGION_VALUES)[number])
              ? (resource.regionLabel as (typeof ADMIN_SERVICE_REGION_VALUES)[number])
              : '',
            tags: resource.tags.filter((value): value is (typeof ADMIN_SERVICE_TAG_VALUES)[number] =>
              ADMIN_SERVICE_TAG_VALUES.includes(value as (typeof ADMIN_SERVICE_TAG_VALUES)[number]),
            ),
          },
        }
      }

      if (isHotelResource(resource)) {
        return mapHotelResource(resource)
      }

      if (isEventLikeResource(resource)) {
        return {
          recordId: resource.recordId,
          resourceId: resource.resourceId,
          slug: resource.slug,
          type: resource.type,
          status: resource.status,
          title: resource.title,
          city: resource.city,
          regionLabel: resource.regionLabel,
          summary: resource.summary,
          description: resource.description,
          tags: resource.tags,
          primaryUrl: resource.primaryUrl,
          editorModule: resource.editorModule,
          sourceKey: resource.sourceKey,
          seedSource: resource.seedSource,
          lastSeededAt: resource.lastSeededAt,
          event: {
            category: resource.event.category,
            titleJa: resource.event.titleJa,
            venue: resource.event.venue,
            venueJa: resource.event.venueJa,
            neighborhood: resource.event.neighborhood,
            startsAt: resource.event.startsAt,
            endsAt: resource.event.endsAt,
            priceLabel: resource.event.priceLabel,
            sourceUrl: resource.event.sourceUrl,
            featured: resource.event.featured,
            lifecycle: resource.event.lifecycle,
          },
        }
      }

      throw new Error(`Unsupported resource type: ${String((resource as { type?: unknown }).type)}`)
    }),
    ...restaurantItems,
  ].sort(compareResources)
}

export function getAdminResourcesSummary(items: AdminResourceItem[]): AdminResourcesSummary {
  return {
    total: items.length,
    services: items.filter((item) => item.type === 'service').length,
    hotels: items.filter((item) => item.type === 'hotel').length,
    restaurants: items.filter((item) => item.type === 'restaurant').length,
    events: items.filter((item) => item.type === 'event' || item.type === 'exhibition' || item.type === 'concert').length,
    draft: items.filter((item) => item.status === 'draft').length,
    archived: items.filter((item) => item.status === 'archived').length,
    missingDescriptions: items.filter((item) => !item.description.trim()).length,
    missingPrimaryUrl: items.filter((item) => !item.primaryUrl).length,
  }
}

export {
  RESOURCES_TABLE_NAME,
  RESOURCE_HOTEL_DETAILS_TABLE_NAME,
  RESOURCE_EVENT_DETAILS_TABLE_NAME,
  RESOURCE_STATUS_VALUES,
  RESOURCE_TYPE_VALUES,
  eventCategories,
  RESOURCE_EVENT_LIFECYCLE_VALUES,
}
