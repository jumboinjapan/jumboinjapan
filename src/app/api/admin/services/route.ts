import { NextRequest, NextResponse } from 'next/server'

import {
  ADMIN_SERVICE_FORMAT_VALUES,
  ADMIN_SERVICE_KIND_VALUES,
  ADMIN_SERVICE_REGION_VALUES,
  ADMIN_SERVICE_STATUS_VALUES,
  ADMIN_SERVICE_SUBCATEGORY_VALUES,
  ADMIN_SERVICE_TAG_VALUES,
  SERVICES_TABLE_NAME,
  getAdminServiceItems,
  type AdminServiceFormat,
  type AdminServiceItem,
  type AdminServiceKind,
  type AdminServiceRegion,
  type AdminServiceStatus,
  type AdminServiceSubcategory,
} from '@/lib/admin-services'

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
}

const EDITABLE_FIELDS = new Set([
  'Service ID',
  'Service Name',
  'Service Kind',
  'Status',
  'City',
  'Region',
  'Description',
  'Tags',
  'Partner',
  'Venue',
  'Partner URL',
  'Booking URL',
  'External URL',
  'Experience Format',
  'Experience Subcategory',
  'Price From',
  'Currency',
  'Duration Minutes',
  'Agent Notes',
])

function requireAirtableConfig() {
  if (!AIRTABLE_TOKEN || !BASE_ID) {
    throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID must be configured for /api/admin/services')
  }

  return {
    token: AIRTABLE_TOKEN,
    baseId: BASE_ID,
  }
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
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`)
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)

  const invalid = normalized.filter((item) => !allowed.includes(item as T[number]))
  if (invalid.length > 0) {
    throw new Error(`${label} contains unsupported values: ${invalid.join(', ')}`)
  }

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

function normalizeComparableValue(fieldKey: string, value: unknown) {
  if (fieldKey === 'Tags' || fieldKey === 'Experience Subcategory') {
    if (!Array.isArray(value)) return []
    return [...value].map((item) => String(item)).sort()
  }

  return value == null ? null : value
}

function buildRecordFormula(recordIds: string[]) {
  const escapedIds = recordIds.map((id) => `RECORD_ID() = "${id.replace(/"/g, '\\"')}"`)
  return escapedIds.length === 1 ? escapedIds[0] : `OR(${escapedIds.join(', ')})`
}

async function fetchExistingRecords(recordIds: string[]) {
  const { token, baseId } = requireAirtableConfig()
  const formula = encodeURIComponent(buildRecordFormula(recordIds))
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(SERVICES_TABLE_NAME)}?filterByFormula=${formula}&pageSize=100`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  const data = (await response.json()) as AirtableResponse
  return new Map(data.records.map((record) => [record.id, record]))
}

function validateServiceFields(fields: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(fields)) {
    if (!EDITABLE_FIELDS.has(key)) {
      throw new Error(`Unsupported field: ${key}`)
    }
  }

  const kind = validateSingleSelect(fields['Service Kind'], ADMIN_SERVICE_KIND_VALUES, 'Service Kind')
  const kindLabel = kind === 'practical' ? 'Practical' : kind === 'experience' ? 'Experience' : null

  const status = validateSingleSelect(fields.Status, ADMIN_SERVICE_STATUS_VALUES, 'Status')
  const region = validateSingleSelect(fields.Region, ADMIN_SERVICE_REGION_VALUES, 'Region')
  const format = validateSingleSelect(fields['Experience Format'], ADMIN_SERVICE_FORMAT_VALUES, 'Experience Format')
  const tags = validateMultiSelect(fields.Tags, ADMIN_SERVICE_TAG_VALUES, 'Tags')
  const subcategory = validateMultiSelect(fields['Experience Subcategory'], ADMIN_SERVICE_SUBCATEGORY_VALUES, 'Experience Subcategory')
  const serviceId = text(fields['Service ID'])
  const serviceName = text(fields['Service Name'])
  const city = text(fields.City)
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

  if (!serviceId) throw new Error('Service ID is required')
  if (!serviceName) throw new Error('Service Name is required')
  if (!kindLabel) throw new Error('Service Kind is required')
  if (!city) throw new Error('City is required')

  if (serviceId.length > 120) throw new Error('Service ID is too long')
  if (serviceName.length > 200) throw new Error('Service Name is too long')
  if (city.length > 120) throw new Error('City is too long')
  if (description.length > 8000) throw new Error('Description is too long')
  if ((partner ?? '').length > 200) throw new Error('Partner is too long')
  if ((venue ?? '').length > 200) throw new Error('Venue is too long')
  if ((agentNotes ?? '').length > 8000) throw new Error('Agent Notes is too long')

  if (kind === 'experience') {
    if (!format) throw new Error('Experience Format is required for experience services')
    if (subcategory.length === 0) throw new Error('Experience Subcategory is required for experience services')
    if (!bookingUrl) throw new Error('Booking URL is required for experience services')
    if (currency && currency !== 'JPY') throw new Error('Experience currency must be JPY')
  }

  if (kind === 'practical') {
    if (!externalUrl) throw new Error('External URL is required for practical services')
  }

  return {
    'Service ID': serviceId,
    'Service Name': serviceName,
    'Service Kind': kindLabel,
    Status: status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Active',
    City: city,
    Region: region,
    Description: description,
    Tags: tags,
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
  }
}

function buildSanitizedPatch(incoming: PatchRecord, original?: AirtableRecord) {
  const validatedFields = validateServiceFields(incoming.fields)
  const nextFields: Record<string, unknown> = {}

  for (const [fieldKey, nextValue] of Object.entries(validatedFields)) {
    const currentValue = original?.fields?.[fieldKey]
    const normalizedCurrent = normalizeComparableValue(fieldKey, currentValue)
    const normalizedNext = normalizeComparableValue(fieldKey, nextValue)

    if (JSON.stringify(normalizedCurrent) === JSON.stringify(normalizedNext)) {
      continue
    }

    nextFields[fieldKey] = nextValue
  }

  if (Object.keys(nextFields).length === 0) return null

  return {
    id: incoming.id,
    fields: nextFields,
  }
}

function mapItemToPatchRecord(item: AdminServiceItem): PatchRecord {
  return {
    id: item.recordId,
    fields: {
      'Service ID': item.id,
      'Service Name': item.name,
      'Service Kind': item.kind,
      Status: item.status,
      City: item.city,
      Region: item.region,
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

export async function GET() {
  try {
    const items = await getAdminServiceItems()
    return NextResponse.json({ ok: true, items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load services'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { token, baseId } = requireAirtableConfig()
    const body = (await request.json()) as { records?: PatchRecord[] }
    const records = body.records

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ ok: false, error: 'records array required' }, { status: 400 })
    }

    const results: AirtableRecord[] = []
    let skipped = 0

    for (let index = 0; index < records.length; index += 10) {
      const batch = records.slice(index, index + 10)
      const existingRecords = await fetchExistingRecords(batch.map((record) => record.id))
      const sanitizedBatch = batch
        .map((record) => buildSanitizedPatch(record, existingRecords.get(record.id)))
        .filter((record): record is PatchRecord => record !== null)

      skipped += batch.length - sanitizedBatch.length

      if (sanitizedBatch.length === 0) {
        continue
      }

      const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(SERVICES_TABLE_NAME)}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: sanitizedBatch }),
      })

      if (!response.ok) {
        return NextResponse.json({ ok: false, error: await response.text() }, { status: response.status })
      }

      const data = (await response.json()) as AirtableResponse
      results.push(...data.records)
    }

    const updatedItems = await getAdminServiceItems()
    const updatedByRecordId = new Map(updatedItems.map((item) => [item.recordId, item]))
    const responseItems = results
      .map((record) => updatedByRecordId.get(record.id))
      .filter((item): item is AdminServiceItem => Boolean(item))

    return NextResponse.json({
      ok: true,
      items: responseItems,
      saved: responseItems.length,
      skipped,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save services'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
