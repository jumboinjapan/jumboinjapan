import { NextRequest, NextResponse } from 'next/server'

import {
  ADMIN_SERVICE_FORMAT_VALUES,
  ADMIN_SERVICE_KIND_VALUES,
  ADMIN_SERVICE_REGION_VALUES,
  ADMIN_SERVICE_STATUS_VALUES,
  ADMIN_SERVICE_SUBCATEGORY_VALUES,
  ADMIN_SERVICE_TAG_VALUES,
  SERVICE_DETAILS_TABLE_NAME,
  SERVICES_TABLE_NAME,
  getAdminServiceItems,
  type AdminServiceFormat,
  type AdminServiceItem,
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
  offset?: string
}

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

function validateServiceFields(fields: Record<string, unknown>) {
  const kind = validateSingleSelect(fields['Service Kind'], ADMIN_SERVICE_KIND_VALUES, 'Service Kind')
  const status = validateSingleSelect(fields.Status, ADMIN_SERVICE_STATUS_VALUES, 'Status') ?? 'active'
  const region = validateSingleSelect(fields.Region, ADMIN_SERVICE_REGION_VALUES, 'Region')
  const format = validateSingleSelect(fields['Experience Format'], ADMIN_SERVICE_FORMAT_VALUES, 'Experience Format')
  const tags = validateMultiSelect(fields.Tags, ADMIN_SERVICE_TAG_VALUES, 'Tags')
  const subcategory = validateMultiSelect(fields['Experience Subcategory'], ADMIN_SERVICE_SUBCATEGORY_VALUES, 'Experience Subcategory')
  const resourceId = text(fields['Service ID'])
  const title = text(fields['Service Name'])
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

  if (!resourceId) throw new Error('Service ID is required')
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
    kind,
    coreFields: {
      'Resource ID': resourceId,
      'Resource Slug': resourceId,
      'Resource Type': 'service',
      Status: toAirtableStatus(status),
      Title: title,
      City: city,
      'Region Label': region,
      Summary: description || null,
      Description: description,
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
    requireAirtableConfig()
    const body = (await request.json()) as { records?: PatchRecord[] }
    const incomingRecords = body.records

    if (!Array.isArray(incomingRecords) || incomingRecords.length === 0) {
      return NextResponse.json({ ok: false, error: 'records array required' }, { status: 400 })
    }

    const currentItems = await getAdminServiceItems()
    const currentByRecordId = new Map(currentItems.map((item) => [item.recordId, item]))
    const validated = incomingRecords.map((record) => {
      const currentItem = currentByRecordId.get(record.id)
      if (!currentItem) throw new Error(`Unknown service record: ${record.id}`)
      return {
        currentItem,
        next: validateServiceFields(record.fields),
      }
    })

    const resourceIds = validated.map((entry) => entry.currentItem.resourceId)
    const detailRecords = await fetchAllRecords(SERVICE_DETAILS_TABLE_NAME, buildFormulaForField('Resource ID', resourceIds))
    const detailByResourceId = new Map(detailRecords.map((record) => [String(record.fields['Resource ID'] ?? ''), record]))

    for (const entry of validated) {
      await patchRecord(SERVICES_TABLE_NAME, entry.currentItem.recordId, entry.next.coreFields)

      const existingDetail = detailByResourceId.get(entry.currentItem.resourceId)
      if (existingDetail) {
        await patchRecord(SERVICE_DETAILS_TABLE_NAME, existingDetail.id, entry.next.detailFields)
      } else {
        await createRecord(SERVICE_DETAILS_TABLE_NAME, entry.next.detailFields)
      }
    }

    const updatedItems = await getAdminServiceItems()
    const updatedByRecordId = new Map(updatedItems.map((item) => [item.recordId, item]))
    const responseItems = incomingRecords
      .map((record) => updatedByRecordId.get(record.id))
      .filter((item): item is AdminServiceItem => Boolean(item))

    return NextResponse.json({
      ok: true,
      items: responseItems,
      saved: responseItems.length,
      skipped: 0,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save services'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export { mapItemToPatchRecord }
