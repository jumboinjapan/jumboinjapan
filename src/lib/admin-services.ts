import type { ExperienceFormat, ExperienceSubcategory, ServiceTag } from '@/data/services'
import {
  RESOURCE_SERVICE_DETAILS_TABLE_NAME,
  RESOURCES_TABLE_NAME,
  getResources,
  isServiceResource,
  type ServiceResourceKind,
} from '@/lib/resources'

export type { ExperienceFormat, ExperienceSubcategory, ServiceTag } from '@/data/services'

export const SERVICES_TABLE_NAME = RESOURCES_TABLE_NAME
export const SERVICE_DETAILS_TABLE_NAME = RESOURCE_SERVICE_DETAILS_TABLE_NAME

export const ADMIN_SERVICE_KIND_VALUES = ['experience', 'practical'] as const
export type AdminServiceKind = (typeof ADMIN_SERVICE_KIND_VALUES)[number]

export const ADMIN_SERVICE_STATUS_VALUES = ['active', 'draft', 'archived'] as const
export type AdminServiceStatus = (typeof ADMIN_SERVICE_STATUS_VALUES)[number]

export const ADMIN_SERVICE_REGION_VALUES = ['Канто', 'Кансай', 'Вся Япония', 'Другое'] as const
export type AdminServiceRegion = (typeof ADMIN_SERVICE_REGION_VALUES)[number]

export const ADMIN_SERVICE_FORMAT_VALUES = ['masterclass', 'ceremony', 'performance', 'activity'] as const
export type AdminServiceFormat = (typeof ADMIN_SERVICE_FORMAT_VALUES)[number]

export const ADMIN_SERVICE_SUBCATEGORY_VALUES = [
  'cooking',
  'crafts',
  'martial_arts',
  'theater',
  'traditional',
  'entertainment',
] as const
export type AdminServiceSubcategory = (typeof ADMIN_SERVICE_SUBCATEGORY_VALUES)[number]

export const ADMIN_SERVICE_TAG_VALUES = [
  'addable_to_tour',
  'booking_required',
  'indoor',
  'outdoor',
  'family_friendly',
  'adult_only',
  'group_min_2',
  'solo_ok',
] as const

export interface AdminBaseServiceItem {
  recordId: string
  resourceId: string
  id: string
  kind: AdminServiceKind
  status: AdminServiceStatus
  name: string
  city: string
  region: AdminServiceRegion | ''
  description: string
  tags: ServiceTag[]
}

export interface AdminExperienceServiceItem extends AdminBaseServiceItem {
  kind: 'experience'
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

export interface AdminPracticalServiceItem extends AdminBaseServiceItem {
  kind: 'practical'
  partner: string
  venue: string
  partnerUrl: string
  bookingUrl: string | null
  externalUrl: string | null
  format: ''
  subcategory: []
  priceFrom: null
  currency: ''
  durationMin: null
  agentNotes: string
}

export type AdminServiceItem = AdminExperienceServiceItem | AdminPracticalServiceItem

export interface AdminServicesSummary {
  total: number
  experience: number
  practical: number
  cities: number
  withMissingDescription: number
  withMissingLink: number
}

function normalizeServiceKind(value: ServiceResourceKind): AdminServiceKind {
  return value === 'practical' ? 'practical' : 'experience'
}

function normalizeRegion(value: string): AdminServiceRegion | '' {
  return ADMIN_SERVICE_REGION_VALUES.includes(value as AdminServiceRegion) ? (value as AdminServiceRegion) : ''
}

function compareServices(left: AdminServiceItem, right: AdminServiceItem) {
  const leftLabel = left.name || left.id
  const rightLabel = right.name || right.id
  return leftLabel.localeCompare(rightLabel, 'ru')
}

export async function getAdminServiceItems(): Promise<AdminServiceItem[]> {
  const resources = (await getResources({ types: ['service'] })).filter(isServiceResource)

  return resources
    .map((resource): AdminServiceItem => {
      const kind = normalizeServiceKind(resource.service.kind)
      const baseItem: AdminBaseServiceItem = {
        recordId: resource.recordId,
        resourceId: resource.resourceId,
        id: resource.resourceId,
        kind,
        status: resource.status,
        name: resource.title,
        city: resource.city,
        region: normalizeRegion(resource.regionLabel),
        description: resource.description,
        tags: resource.tags.filter((tag): tag is ServiceTag => ADMIN_SERVICE_TAG_VALUES.includes(tag as ServiceTag)),
      }

      if (kind === 'practical') {
        return {
          ...baseItem,
          kind,
          partner: resource.service.partner,
          venue: resource.service.venue,
          partnerUrl: resource.service.partnerUrl,
          bookingUrl: null,
          externalUrl: resource.service.externalUrl,
          format: '',
          subcategory: [],
          priceFrom: null,
          currency: '',
          durationMin: null,
          agentNotes: resource.service.agentNotes,
        }
      }

      return {
        ...baseItem,
        kind,
        partner: resource.service.partner,
        venue: resource.service.venue,
        partnerUrl: resource.service.partnerUrl,
        bookingUrl: resource.service.bookingUrl,
        externalUrl: resource.service.externalUrl,
        format: resource.service.format,
        subcategory: resource.service.subcategory,
        priceFrom: resource.service.priceFrom,
        currency: resource.service.currency,
        durationMin: resource.service.durationMin,
        agentNotes: resource.service.agentNotes,
      }
    })
    .sort(compareServices)
}

export function getAdminServicesSummary(items: AdminServiceItem[]): AdminServicesSummary {
  const cities = new Set(items.map((item) => item.city.trim()).filter(Boolean))

  return {
    total: items.length,
    experience: items.filter((item) => item.kind === 'experience').length,
    practical: items.filter((item) => item.kind === 'practical').length,
    cities: cities.size,
    withMissingDescription: items.filter((item) => !item.description.trim()).length,
    withMissingLink: items.filter((item) => (item.kind === 'experience' ? !item.bookingUrl : !item.externalUrl)).length,
  }
}
