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

export const ADMIN_RESOURCE_TYPE_FILTER_VALUES = ['all', ...RESOURCE_TYPE_VALUES] as const
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
  type: ResourceType
  status: ResourceStatus
  title: string
  city: string
  regionLabel: string
  summary: string
  description: string
  tags: string[]
  primaryUrl: string | null
  editorModule: 'service' | 'hotel' | 'event'
  sourceKey: string
  seedSource: string | null
  lastSeededAt: string | null
}

export type AdminServiceResourceItem = AdminResourceBaseItem & {
  type: 'service'
  service: {
    kind: 'experience' | 'practical'
    partner: string
    venue: string
    primaryUrl: string | null
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

export type AdminResourceItem = AdminServiceResourceItem | AdminHotelResourceItem | AdminEventLikeResourceItem

export type AdminResourcesSummary = {
  total: number
  services: number
  hotels: number
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

export async function getAdminResourceItems(): Promise<AdminResourceItem[]> {
  const resources = await getResources()

  return resources
    .map((resource): AdminResourceItem => {
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
            primaryUrl: resource.service.kind === 'experience' ? resource.service.bookingUrl : resource.service.externalUrl,
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
    })
    .sort(compareResources)
}

export function getAdminResourcesSummary(items: AdminResourceItem[]): AdminResourcesSummary {
  return {
    total: items.length,
    services: items.filter((item) => item.type === 'service').length,
    hotels: items.filter((item) => item.type === 'hotel').length,
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
