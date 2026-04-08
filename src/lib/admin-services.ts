import {
  experienceServices,
  practicalServices,
  type ExperienceFormat,
  type ExperienceService,
  type ExperienceSubcategory,
  type PracticalService,
  type ServiceTag,
} from '@/data/services'

export type { ExperienceFormat, ExperienceSubcategory, ServiceTag } from '@/data/services'

export const SERVICES_TABLE_NAME = 'Services'

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
  currency: ExperienceService['currency'] | ''
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

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

interface AirtableResponse {
  records: AirtableRecord[]
  offset?: string
}

export interface AirtableServiceRecordFields {
  'Service ID': string
  'Service Name': string
  'Service Kind': 'Experience' | 'Practical'
  Status: 'Active' | 'Draft' | 'Archived'
  City: string
  Region?: AdminServiceRegion | null
  Description: string
  Tags: ServiceTag[]
  Partner?: string | null
  Venue?: string | null
  'Partner URL'?: string | null
  'Booking URL'?: string | null
  'External URL'?: string | null
  'Experience Format'?: ExperienceFormat | null
  'Experience Subcategory'?: ExperienceSubcategory[]
  'Price From'?: number | null
  Currency?: ExperienceService['currency'] | null
  'Duration Minutes'?: number | null
  'Agent Notes'?: string | null
  'Seed Source'?: string | null
  'Last Seeded At'?: string | null
}

function getAirtableCredentials() {
  const token = process.env.AIRTABLE_TOKEN?.trim()
  const baseId = process.env.AIRTABLE_BASE_ID?.trim()

  return { token, baseId }
}

function getAirtableTextField(value: unknown): string {
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

function getAirtableNumberField(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function normalizeServiceKind(value: unknown): AdminServiceKind {
  return getAirtableTextField(value).toLowerCase() === 'practical' ? 'practical' : 'experience'
}

function normalizeServiceStatus(value: unknown): AdminServiceStatus {
  switch (getAirtableTextField(value).toLowerCase()) {
    case 'draft':
      return 'draft'
    case 'archived':
      return 'archived'
    default:
      return 'active'
  }
}

function normalizeServiceRegion(value: unknown): AdminServiceRegion | '' {
  const normalized = getAirtableTextField(value)
  return ADMIN_SERVICE_REGION_VALUES.includes(normalized as AdminServiceRegion) ? (normalized as AdminServiceRegion) : ''
}

function normalizeServiceFormat(value: unknown): ExperienceFormat | '' {
  const normalized = getAirtableTextField(value)
  return ADMIN_SERVICE_FORMAT_VALUES.includes(normalized as ExperienceFormat) ? (normalized as ExperienceFormat) : ''
}

function normalizeServiceTagList(value: unknown): ServiceTag[] {
  if (!Array.isArray(value)) return []

  return value.filter((item): item is ServiceTag => ADMIN_SERVICE_TAG_VALUES.includes(item as ServiceTag))
}

function normalizeServiceSubcategoryList(value: unknown): ExperienceSubcategory[] {
  if (!Array.isArray(value)) return []

  return value.filter((item): item is ExperienceSubcategory => ADMIN_SERVICE_SUBCATEGORY_VALUES.includes(item as ExperienceSubcategory))
}

function toAirtableServiceKind(value: AdminServiceKind): AirtableServiceRecordFields['Service Kind'] {
  return value === 'practical' ? 'Practical' : 'Experience'
}

function toAirtableServiceStatus(value: AdminServiceStatus): AirtableServiceRecordFields['Status'] {
  switch (value) {
    case 'draft':
      return 'Draft'
    case 'archived':
      return 'Archived'
    default:
      return 'Active'
  }
}

async function fetchAllServiceRecords() {
  const { token, baseId } = getAirtableCredentials()

  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID must be configured for the services workspace')
  }

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(SERVICES_TABLE_NAME)}`)
  url.searchParams.set('sort[0][field]', 'Service Name')
  url.searchParams.set('sort[0][direction]', 'asc')

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
      const message = await response.text()
      throw new Error(`Airtable Services read failed: ${response.status} ${message}`)
    }

    const data = (await response.json()) as AirtableResponse
    allRecords.push(...data.records)
    offset = data.offset
  } while (offset)

  return allRecords
}

function mapAirtableServiceRecord(record: AirtableRecord): AdminServiceItem {
  const kind = normalizeServiceKind(record.fields['Service Kind'])
  const baseItem: AdminBaseServiceItem = {
    recordId: record.id,
    id: getAirtableTextField(record.fields['Service ID']),
    kind,
    status: normalizeServiceStatus(record.fields.Status),
    name: getAirtableTextField(record.fields['Service Name']),
    city: getAirtableTextField(record.fields.City),
    region: normalizeServiceRegion(record.fields.Region),
    description: getAirtableTextField(record.fields.Description),
    tags: normalizeServiceTagList(record.fields.Tags),
  }

  if (kind === 'practical') {
    return {
      ...baseItem,
      kind: 'practical',
      partner: getAirtableTextField(record.fields.Partner),
      venue: getAirtableTextField(record.fields.Venue),
      partnerUrl: getAirtableTextField(record.fields['Partner URL']),
      bookingUrl: null,
      externalUrl: getAirtableTextField(record.fields['External URL']) || null,
      format: '',
      subcategory: [],
      priceFrom: null,
      currency: '',
      durationMin: null,
      agentNotes: getAirtableTextField(record.fields['Agent Notes']),
    }
  }

  return {
    ...baseItem,
    kind: 'experience',
    partner: getAirtableTextField(record.fields.Partner),
    venue: getAirtableTextField(record.fields.Venue),
    partnerUrl: getAirtableTextField(record.fields['Partner URL']),
    bookingUrl: getAirtableTextField(record.fields['Booking URL']) || null,
    externalUrl: getAirtableTextField(record.fields['External URL']) || null,
    format: normalizeServiceFormat(record.fields['Experience Format']),
    subcategory: normalizeServiceSubcategoryList(record.fields['Experience Subcategory']),
    priceFrom: getAirtableNumberField(record.fields['Price From']),
    currency: getAirtableTextField(record.fields.Currency) === 'JPY' ? 'JPY' : '',
    durationMin: getAirtableNumberField(record.fields['Duration Minutes']),
    agentNotes: getAirtableTextField(record.fields['Agent Notes']),
  }
}

function compareServices(left: AdminServiceItem, right: AdminServiceItem) {
  const leftLabel = left.name || left.id
  const rightLabel = right.name || right.id
  return leftLabel.localeCompare(rightLabel, 'ru')
}

function normalizeExperienceSeed(service: ExperienceService): AirtableServiceRecordFields {
  return {
    'Service ID': service.id,
    'Service Name': service.name,
    'Service Kind': 'Experience',
    Status: 'Active',
    City: service.city,
    Region: service.region,
    Description: service.description.trim(),
    Tags: service.tags,
    Partner: service.partner,
    Venue: service.venue?.trim() || null,
    'Partner URL': service.partner_url || null,
    'Booking URL': service.booking_url || null,
    'External URL': null,
    'Experience Format': service.format,
    'Experience Subcategory': service.subcategory,
    'Price From': service.price_from,
    Currency: service.currency,
    'Duration Minutes': service.duration_min,
    'Agent Notes': service.agent_notes.trim() || null,
    'Seed Source': 'src/data/services.ts',
  }
}

function normalizePracticalSeed(service: PracticalService): AirtableServiceRecordFields {
  return {
    'Service ID': service.id,
    'Service Name': service.name,
    'Service Kind': 'Practical',
    Status: 'Active',
    City: service.city,
    Region: null,
    Description: service.description.trim(),
    Tags: service.tags,
    Partner: null,
    Venue: null,
    'Partner URL': null,
    'Booking URL': null,
    'External URL': service.url,
    'Experience Format': null,
    'Experience Subcategory': [],
    'Price From': null,
    Currency: null,
    'Duration Minutes': null,
    'Agent Notes': null,
    'Seed Source': 'src/data/services.ts',
  }
}

export function getAdminServiceSeedPayload() {
  const seededAt = new Date().toISOString()

  return [
    ...experienceServices.map((service) => ({ fields: { ...normalizeExperienceSeed(service), 'Last Seeded At': seededAt } })),
    ...practicalServices.map((service) => ({ fields: { ...normalizePracticalSeed(service), 'Last Seeded At': seededAt } })),
  ]
}

export async function getAdminServiceItems(): Promise<AdminServiceItem[]> {
  const records = await fetchAllServiceRecords()
  return records.map(mapAirtableServiceRecord).sort(compareServices)
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

export function toAirtableServiceFields(item: AdminServiceItem): AirtableServiceRecordFields {
  if (item.kind === 'practical') {
    return {
      'Service ID': item.id,
      'Service Name': item.name,
      'Service Kind': toAirtableServiceKind(item.kind),
      Status: toAirtableServiceStatus(item.status),
      City: item.city,
      Region: item.region || null,
      Description: item.description,
      Tags: item.tags,
      Partner: item.partner || null,
      Venue: item.venue || null,
      'Partner URL': item.partnerUrl || null,
      'Booking URL': null,
      'External URL': item.externalUrl,
      'Experience Format': null,
      'Experience Subcategory': [],
      'Price From': null,
      Currency: null,
      'Duration Minutes': null,
      'Agent Notes': item.agentNotes || null,
    }
  }

  return {
    'Service ID': item.id,
    'Service Name': item.name,
    'Service Kind': toAirtableServiceKind(item.kind),
    Status: toAirtableServiceStatus(item.status),
    City: item.city,
    Region: item.region || null,
    Description: item.description,
    Tags: item.tags,
    Partner: item.partner || null,
    Venue: item.venue || null,
    'Partner URL': item.partnerUrl || null,
    'Booking URL': item.bookingUrl,
    'External URL': item.externalUrl,
    'Experience Format': item.format || null,
    'Experience Subcategory': item.subcategory,
    'Price From': item.priceFrom,
    Currency: item.currency || null,
    'Duration Minutes': item.durationMin,
    'Agent Notes': item.agentNotes || null,
  }
}
