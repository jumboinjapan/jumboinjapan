import {
  ADMIN_SERVICE_FORMAT_VALUES,
  ADMIN_SERVICE_KIND_VALUES,
  ADMIN_SERVICE_REGION_VALUES,
  ADMIN_SERVICE_STATUS_VALUES,
  ADMIN_SERVICE_SUBCATEGORY_VALUES,
  ADMIN_SERVICE_TAG_VALUES,
  type AdminServiceFormat,
  type AdminServiceItem,
  type AdminServiceStatus,
  type AdminServiceSubcategory,
} from '@/lib/admin-services'

interface PatchRecord {
  id: string
  fields: Record<string, unknown>
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableText(value: unknown) {
  const normalized = text(value)
  return normalized ? normalized : null
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

function validateMultiSelect<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number][] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)

  const invalid = normalized.filter((item) => !allowed.includes(item as T[number]))
  if (invalid.length > 0) throw new Error(`${label} contains unsupported values: ${invalid.join(', ')}`)

  return normalized as T[number][]
}

function validateIntegerField(value: unknown, label: string) {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return parsed
}

function toAirtableStatus(status: AdminServiceStatus) {
  switch (status) {
    case 'draft':
      return 'draft'
    case 'archived':
      return 'archived'
    default:
      return 'active'
  }
}

export function validateServiceFields(fields: Record<string, unknown>) {
  const kind = validateSingleSelect(fields['Service Kind'], ADMIN_SERVICE_KIND_VALUES, 'Service Kind')
  const status = validateSingleSelect(fields.Status, ADMIN_SERVICE_STATUS_VALUES, 'Status') ?? 'active'
  const region = validateSingleSelect(fields.Region, ADMIN_SERVICE_REGION_VALUES, 'Region')
  const format = validateSingleSelect(fields['Experience Format'], ADMIN_SERVICE_FORMAT_VALUES, 'Experience Format')
  const tags = validateMultiSelect(fields.Tags, ADMIN_SERVICE_TAG_VALUES, 'Tags')
  const subcategory = validateMultiSelect(fields['Experience Subcategory'], ADMIN_SERVICE_SUBCATEGORY_VALUES, 'Experience Subcategory')
  const resourceId = text(fields['Service ID'])
  const slug = text(fields['Service Slug']) || resourceId
  const title = text(fields['Service Name'])
  const city = text(fields.City)
  const regionLabel = text(fields.Region)
  const summary = text(fields.Summary)
  const description = text(fields.Description)
  const partner = nullableText(fields.Partner)
  const venue = nullableText(fields.Venue)
  const partnerUrl = validateUrlField(fields['Partner URL'], 'Partner URL')
  const bookingUrl = validateUrlField(fields['Booking URL'], 'Booking URL')
  const externalUrl = validateUrlField(fields['External URL'], 'External URL')
  const priceFrom = validateIntegerField(fields['Price From'], 'Price From')
  const durationMinutes = validateIntegerField(fields['Duration Minutes'], 'Duration Minutes')
  const agentNotes = nullableText(fields['Agent Notes'])
  const currency = validateSingleSelect(fields.Currency, ['JPY'] as const, 'Currency')

  if (!resourceId) throw new Error('Service ID is required')
  if (!slug) throw new Error('Service Slug is required')
  if (!title) throw new Error('Service Name is required')
  if (!kind) throw new Error('Service Kind is required')
  if (!city) throw new Error('City is required')

  if (kind === 'experience') {
    if (!format) throw new Error('Experience Format is required for experience services')
    if (subcategory.length === 0) throw new Error('Experience Subcategory is required for experience services')
    if (!bookingUrl) throw new Error('Booking URL is required for experience services')
  }

  if (kind === 'practical' && !externalUrl) {
    throw new Error('External URL is required for practical services')
  }

  return {
    resourceId,
    coreFields: {
      'Resource ID': resourceId,
      'Resource Slug': slug,
      'Resource Type': 'service',
      Status: toAirtableStatus(status),
      Title: title,
      City: city,
      'Region Label': regionLabel || null,
      Summary: summary || null,
      Description: description || null,
      Tags: tags,
      'Primary URL': kind === 'experience' ? bookingUrl : externalUrl,
      'Editor Module': 'service',
      'Source Key': resourceId,
    },
    detailFields: {
      'Resource ID': resourceId,
      'Service Kind': kind,
      Partner: partner,
      Venue: venue,
      'Partner URL': partnerUrl,
      'Booking URL': kind === 'experience' ? bookingUrl : null,
      'External URL': kind === 'practical' ? externalUrl : externalUrl,
      'Experience Format': kind === 'experience' ? (format as AdminServiceFormat) : null,
      'Experience Subcategory': kind === 'experience' ? (subcategory as AdminServiceSubcategory[]) : [],
      'Price From': kind === 'experience' ? priceFrom : null,
      Currency: kind === 'experience' ? currency : null,
      'Duration Minutes': kind === 'experience' ? durationMinutes : null,
      'Agent Notes': agentNotes,
    },
  }
}

export function mapItemToServicePatchRecord(item: AdminServiceItem): PatchRecord {
  return {
    id: item.recordId,
    fields: {
      'Service ID': item.id,
      'Service Slug': item.id,
      'Service Name': item.name,
      'Service Kind': item.kind,
      Status: item.status,
      City: item.city,
      Region: item.region,
      Summary: item.description,
      Description: item.description,
      Tags: item.tags,
      Partner: item.partner,
      Venue: item.venue,
      'Partner URL': item.partnerUrl,
      'Booking URL': item.bookingUrl,
      'External URL': item.externalUrl,
      'Experience Format': item.kind === 'experience' ? item.format : '',
      'Experience Subcategory': item.kind === 'experience' ? item.subcategory : [],
      'Price From': item.kind === 'experience' ? item.priceFrom : null,
      Currency: item.kind === 'experience' ? item.currency : '',
      'Duration Minutes': item.kind === 'experience' ? item.durationMin : null,
      'Agent Notes': item.agentNotes,
    },
  }
}
