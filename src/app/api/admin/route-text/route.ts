import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

import { AIRTABLE_BASE_ID, ROUTES_TABLE_ID } from '@/lib/airtable-schema'
import { fetchAirtableWithRetry } from '@/lib/airtable-retry'

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

const MANAGED_PREFIXES = ['intercity/', 'city-tour/', 'multi-day/']

function isManagedSlug(slug: string): boolean {
  return MANAGED_PREFIXES.some((prefix) => slug.startsWith(prefix))
}

export async function GET() {
  try {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${ROUTES_TABLE_ID}`)
    url.searchParams.set('pageSize', '100')
    for (const f of LIST_FIELDS) url.searchParams.append('fields[]', f)
    const res = await fetchAirtableWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      return NextResponse.json({ error: await res.text() }, { status: res.status })
    }
    const data = (await res.json()) as { records: Array<{ id: string; fields: Record<string, unknown> }> }
    const text = (fields: Record<string, unknown>, key: string) =>
      typeof fields[key] === 'string' ? (fields[key] as string) : ''
    const routes = data.records
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
      .filter((r) => isManagedSlug(r.slug))
      .sort((a, b) => a.slug.localeCompare(b.slug))
    return NextResponse.json(routes)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
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
