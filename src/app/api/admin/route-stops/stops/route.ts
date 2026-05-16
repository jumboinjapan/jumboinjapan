import { NextRequest, NextResponse } from 'next/server'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN!
const BASE_ID = process.env.AIRTABLE_BASE_ID!
const STOPS_TABLE = 'tblpa3Zof1ZGofAtS'
const SELECT_FIELDS = new Set(['SEO Mention Priority', 'Status', 'stop_type'])
const CHECKBOX_FIELDS = new Set(['Is Helper'])
const EMPTY_SELECT_VALUES = new Set(['', 'None', '—'])

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

interface PatchRecord {
  id: string
  fields: Record<string, unknown>
}

function normalizeTextValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function normalizeSelectValue(value: unknown): string {
  const normalized = normalizeTextValue(value).trim()
  return EMPTY_SELECT_VALUES.has(normalized) ? '' : normalized
}

function normalizeCheckboxValue(value: unknown): string {
  return value === true || value === 'true' || value === '1' ? 'true' : ''
}

function normalizeComparableValue(fieldKey: string, value: unknown): string {
  if (SELECT_FIELDS.has(fieldKey)) return normalizeSelectValue(value)
  if (CHECKBOX_FIELDS.has(fieldKey)) return normalizeCheckboxValue(value)
  return normalizeTextValue(value)
}

function normalizeOutgoingFieldValue(fieldKey: string, value: unknown): string | boolean | null {
  if (CHECKBOX_FIELDS.has(fieldKey)) return normalizeCheckboxValue(value) === 'true'
  const normalized = normalizeComparableValue(fieldKey, value)
  return normalized === '' ? null : normalized
}

function buildRecordFormula(recordIds: string[]): string {
  const escapedIds = recordIds.map((id) => `RECORD_ID() = "${id.replace(/"/g, '\\"')}"`)
  return escapedIds.length === 1 ? escapedIds[0] : `OR(${escapedIds.join(', ')})`
}

async function fetchExistingRecords(recordIds: string[]): Promise<Map<string, AirtableRecord>> {
  const formula = encodeURIComponent(buildRecordFormula(recordIds))
  const url = `https://api.airtable.com/v0/${BASE_ID}/${STOPS_TABLE}?filterByFormula=${formula}&pageSize=100`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(await res.text())
  }

  const data = await res.json()
  const records = new Map<string, AirtableRecord>()
  for (const record of (data.records as AirtableRecord[]) ?? []) {
    records.set(record.id, record)
  }
  return records
}

function buildSanitizedPatch(incoming: PatchRecord, original?: AirtableRecord): PatchRecord | null {
  const nextFields: Record<string, unknown> = {}

  for (const [fieldKey, rawValue] of Object.entries(incoming.fields ?? {})) {
    const originalComparable = normalizeComparableValue(fieldKey, original?.fields?.[fieldKey])
    const nextComparable = normalizeComparableValue(fieldKey, rawValue)

    if (nextComparable === originalComparable) {
      continue
    }

    nextFields[fieldKey] = normalizeOutgoingFieldValue(fieldKey, rawValue)
  }

  if (Object.keys(nextFields).length === 0) {
    return null
  }

  return {
    id: incoming.id,
    fields: nextFields,
  }
}

export async function GET(request: NextRequest) {
  try {
    const routeSlug = request.nextUrl.searchParams.get('routeSlug')
    if (!routeSlug) {
      return NextResponse.json({ error: 'routeSlug required' }, { status: 400 })
    }
    const formula = encodeURIComponent(`{Route Slug} = "${routeSlug}"`)
    const url = `https://api.airtable.com/v0/${BASE_ID}/${STOPS_TABLE}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=%E2%84%96&sort%5B0%5D%5Bdirection%5D=asc&pageSize=100`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: text }, { status: res.status })
    }
    const data = await res.json()
    const stops = (data.records as AirtableRecord[]).map((record) => ({
      id: record.id,
      fields: record.fields,
    }))
    return NextResponse.json(stops)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const records = (body as { records: PatchRecord[] }).records
    if (!records || !Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: 'records array required' }, { status: 400 })
    }

    const results: AirtableRecord[] = []
    let skipped = 0

    for (let i = 0; i < records.length; i += 10) {
      const batch = records.slice(i, i + 10)
      const existingRecords = await fetchExistingRecords(batch.map((record) => record.id))
      const sanitizedBatch = batch
        .map((record) => buildSanitizedPatch(record, existingRecords.get(record.id)))
        .filter((record): record is PatchRecord => record !== null)

      skipped += batch.length - sanitizedBatch.length

      if (sanitizedBatch.length === 0) {
        continue
      }

      const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${STOPS_TABLE}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: sanitizedBatch }),
      })
      if (!res.ok) {
        const text = await res.text()
        return NextResponse.json({ error: text }, { status: res.status })
      }
      const data = await res.json()
      results.push(...(data.records as AirtableRecord[]))
    }

    return NextResponse.json({
      records: results,
      saved: results.length,
      skipped,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
