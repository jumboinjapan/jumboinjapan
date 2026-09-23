import { activeTemplateStops } from '@/lib/route-day-template'
import { preflightRoutePois, RoutePoiReadinessError } from '@/lib/route-poi-preflight'
import { revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

import { getPoisByIds } from '@/lib/airtable'
import { ROUTE_STOPS_TABLE_ID } from '@/lib/airtable-schema'

import { requireAdminSession } from '@/lib/admin-guard'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN!
const BASE_ID = process.env.AIRTABLE_BASE_ID!
const STOPS_TABLE = ROUTE_STOPS_TABLE_ID
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
  if (fieldKey === 'POI ID') return normalizeTextValue(value).trim()
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
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const routeSlug = request.nextUrl.searchParams.get('routeSlug')
    if (!routeSlug) {
      return NextResponse.json({ error: 'routeSlug required' }, { status: 400 })
    }
    const formula = encodeURIComponent(`{Route Slug} = "${routeSlug.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    const url = `https://api.airtable.com/v0/${BASE_ID}/${STOPS_TABLE}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=%E2%84%96&sort%5B0%5D%5Bdirection%5D=asc&pageSize=100`
    const records: AirtableRecord[] = []
    let offset: string | undefined
    const offsets = new Set<string>()
    do {
      const res = await fetch(offset ? `${url}&offset=${encodeURIComponent(offset)}` : url, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }, cache: 'no-store',
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status })
      const data = await res.json()
      if (!Array.isArray(data.records)) throw new Error('Invalid route stops response')
      records.push(...data.records)
      offset = data.offset
      if (offset && (typeof offset !== 'string' || offsets.has(offset))) throw new Error('Invalid pagination')
      if (offset) offsets.add(offset)
    } while (offset)
    if (request.nextUrl.searchParams.get('forTemplate') === '1') {
      const active = activeTemplateStops(records)
      await preflightRoutePois(active.map(s => ({ key: s.id, poiId: s.fields['POI ID'] })))
      return NextResponse.json(active)
    }
    // Описание точки на сайте наследуется из POI-первоисточника
    // (override → POI Approved (RU) → POI Description (RU), см.
    // intercity-pois.ts). Отдаём редактору текст первоисточника, чтобы
    // наследование было видимым, а override — осознанным решением.
    const poiIds = records
      .map((r) => normalizeTextValue(r.fields['POI ID']).trim())
      .filter(Boolean)
    const pois = await getPoisByIds(poiIds).catch(() => [])
    const poiById = new Map(
      pois.map((p) => [
        p.poiId,
        {
          nameRu: p.nameRu ?? '',
          approvedRu: p.approvedRu ?? '',
          descriptionRu: p.descriptionRu ?? '',
          shortRu: p.shortDescriptionRu ?? '',
        },
      ]),
    )
    const stops = records.map((record) => ({
      id: record.id,
      fields: record.fields,
      poi: poiById.get(normalizeTextValue(record.fields['POI ID']).trim()) ?? null,
    }))
    return NextResponse.json(stops)
  } catch (err) {
    if (err instanceof RoutePoiReadinessError) return NextResponse.json({ error: err.message, code: err.code, issues: err.issues }, { status: 422 })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const body = await request.json()
    const records = (body as { records: PatchRecord[] }).records
    if (!records || !Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: 'records array required' }, { status: 400 })
    }

    // Validate the entire submitted batch before the first PATCH (including batch 2+).
    const prepared: PatchRecord[] = []
    const refs: Array<{ key: string; poiId: unknown }> = []
    const seen = new Set<string>()
    for (let i = 0; i < records.length; i += 10) {
      const batch = records.slice(i, i + 10)
      if (batch.some(r => !r || !/^rec[A-Za-z0-9]+$/.test(r.id) || !r.fields || typeof r.fields !== 'object' || Array.isArray(r.fields))) {
        return NextResponse.json({ error: 'Invalid stop records' }, { status: 400 })
      }
      const existing = await fetchExistingRecords(batch.map(r => r.id))
      for (const incoming of batch) {
        if (seen.has(incoming.id)) return NextResponse.json({ error: 'Duplicate stop record' }, { status: 400 })
        seen.add(incoming.id)
        const original = existing.get(incoming.id)
        if (!original) return NextResponse.json({ error: `Stop not found: ${incoming.id}` }, { status: 404 })
        const patch = buildSanitizedPatch(incoming, original)
        const merged = { ...original.fields, ...patch?.fields }
        if (!['Inactive', 'Archived'].includes(String(merged.Status))) {
          refs.push({ key: String(merged['Route Stop ID'] || incoming.id), poiId: merged['POI ID'] })
        }
        if (patch) prepared.push(patch)
      }
    }
    await preflightRoutePois(refs)
    const results: AirtableRecord[] = []
    const skipped = records.length - prepared.length
    for (let i = 0; i < prepared.length; i += 10) {
      const sanitizedBatch = prepared.slice(i, i + 10)

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

    revalidateTag('airtable:routes', 'max')

    return NextResponse.json({
      records: results,
      saved: results.length,
      skipped,
    })
  } catch (err) {
    if (err instanceof RoutePoiReadinessError) return NextResponse.json({ error: err.message, code: err.code, issues: err.issues }, { status: 422 })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const body = await request.json()
    const { routeSlug, poiId, poiNameSnapshot, order } = body as {
      routeSlug: string
      poiId?: string
      poiNameSnapshot: string
      order: number
    }
    if (!routeSlug || !poiNameSnapshot) {
      return NextResponse.json({ error: 'routeSlug and poiNameSnapshot required' }, { status: 400 })
    }
    await preflightRoutePois([{ key: `${routeSlug}: ${poiNameSnapshot}`, poiId }])
    // Generate a unique Route Stop ID
    const stopId = `RST-${routeSlug.replace(/\//g, '-').toUpperCase()}-${Date.now()}`
    const fields: Record<string, unknown> = {
      'Route Stop ID': stopId,
      'Route Slug': routeSlug,
      'POI Name Snapshot': poiNameSnapshot,
      '№': order ?? 99,
      'Status': 'Active',
    }
    // Точка выбрана из поиска POI (обычная или сервисная, Is System = true —
    // работают одинаково) — сохраняем связь, чтобы описание наследовалось
    // из POI-первоисточника (см. GET-обработчик и StopDetail).
    if (poiId && poiId.trim()) {
      fields['POI ID'] = poiId.trim()
    }
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${STOPS_TABLE}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    })
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: text }, { status: res.status })
    }
    const data = await res.json()

    revalidateTag('airtable:routes', 'max')

    return NextResponse.json({ id: data.id, fields: data.fields })
  } catch (err) {
    if (err instanceof RoutePoiReadinessError) return NextResponse.json({ error: err.message, code: err.code, issues: err.issues }, { status: 422 })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

