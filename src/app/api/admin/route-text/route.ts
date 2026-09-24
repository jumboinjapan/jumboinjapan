import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

import { AIRTABLE_BASE_ID, ROUTES_TABLE_ID } from '@/lib/airtable-schema'
import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import { AirtableListError, fetchAllRoutesRecords, isRouteTextSlug } from '@/lib/admin-route-packages'

import { requireAdminSession } from '@/lib/admin-guard'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN!

// Ф-2: редактор текстов маршрутов. Ровно те поля, которые публичные
// страницы уже рендерят (Approved) плюс их черновики. Ничего больше
// этот эндпоинт писать не может.
const EDITABLE_FIELDS = [
  'SEO Title Draft',
  'SEO Title Approved',
  'SEO Description Draft',
  'SEO Description Approved',
  'Route Intro Draft',
  'Route Intro Approved',
  'FAQ',
] as const

const LIST_FIELDS = ['Slug', 'Title', 'Route Type', ...EDITABLE_FIELDS]

export async function GET(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    // Страницы форматов поездки (TravelFormatPage) исключены: их текст в коде,
    // правка здесь на сайт не попала бы. См. admin-route-packages.ts.
    const records = await fetchAllRoutesRecords({
      token: AIRTABLE_TOKEN,
      baseId: AIRTABLE_BASE_ID,
      tableId: ROUTES_TABLE_ID,
      fields: LIST_FIELDS,
    })
    const text = (fields: Record<string, unknown>, key: string) =>
      typeof fields[key] === 'string' ? (fields[key] as string) : ''
    const routes = records
      .map((r) => ({
        id: r.id,
        slug: text(r.fields, 'Slug'),
        title: text(r.fields, 'Title'),
        routeType: text(r.fields, 'Route Type'),
        seoTitleDraft: text(r.fields, 'SEO Title Draft'),
        seoTitleApproved: text(r.fields, 'SEO Title Approved'),
        seoDescriptionDraft: text(r.fields, 'SEO Description Draft'),
        seoDescriptionApproved: text(r.fields, 'SEO Description Approved'),
        routeIntroDraft: text(r.fields, 'Route Intro Draft'),
        routeIntroApproved: text(r.fields, 'Route Intro Approved'),
        faq: text(r.fields, 'FAQ'),
      }))
      .filter((r) => isRouteTextSlug(r.slug))
      .sort((a, b) => a.slug.localeCompare(b.slug))
    return NextResponse.json(routes)
  } catch (err) {
    if (err instanceof AirtableListError) {
      return NextResponse.json({ error: err.body }, { status: err.status })
    }
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const body = (await request.json()) as { id?: string; fields?: Record<string, unknown> }
    if (!body.id || !body.fields) {
      return NextResponse.json({ error: 'id and fields required' }, { status: 400 })
    }
    const sanitized: Record<string, string | null> = {}
    for (const key of EDITABLE_FIELDS) {
      if (key in body.fields) {
        const value = body.fields[key]
        const normalized = typeof value === 'string' ? value : ''
        sanitized[key] = normalized.trim() === '' ? null : normalized
      }
    }
    if (Object.keys(sanitized).length === 0) {
      return NextResponse.json({ error: 'no editable fields in payload' }, { status: 400 })
    }
    const res = await fetchAirtableWithRetry(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${ROUTES_TABLE_ID}/${body.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: sanitized }),
      },
    )
    if (!res.ok) {
      return NextResponse.json({ error: await res.text() }, { status: res.status })
    }
    // Approved-поля рендерятся 12 intercity-страницами и /multi-day через
    // кэш с этим тегом — публикация правок мгновенная.
    revalidateTag('airtable:routes', 'max')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
