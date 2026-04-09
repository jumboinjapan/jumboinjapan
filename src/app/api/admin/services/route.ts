import { NextRequest, NextResponse } from 'next/server'

import {
  SERVICE_DETAILS_TABLE_NAME,
  SERVICES_TABLE_NAME,
  getAdminServiceItems,
  type AdminServiceItem,
} from '@/lib/admin-services'
import { mapItemToServicePatchRecord, validateServiceFields } from '@/lib/admin-service-records'

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

export { mapItemToServicePatchRecord as mapItemToPatchRecord }
