import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

import { AIRTABLE_BASE_ID, ROUTES_TABLE_ID } from '@/lib/airtable-schema'
import { fetchAirtableWithRetry } from '@/lib/airtable-retry'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN!
const BASE_ID = AIRTABLE_BASE_ID
const ROUTES_TABLE = ROUTES_TABLE_ID

// This editor manages day-tour packages: intercity/* and city-tour/*.
// Multi-day builder routes (multi-day/*) live in /admin/multi-day.
// Prefix rule instead of a hardcoded slug whitelist so packages created
// from the admin appear without a code change.
const MANAGED_PREFIXES = ['intercity/', 'city-tour/'] as const

function isManagedSlug(slug: string): boolean {
  return MANAGED_PREFIXES.some((prefix) => slug.startsWith(prefix))
}

export async function GET() {
  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${ROUTES_TABLE}?pageSize=100`
    const res = await fetchAirtableWithRetry(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: text }, { status: res.status })
    }
    const data = await res.json()
    const routes = (data.records as Array<{ id: string; fields: Record<string, unknown> }>)
      .map((r) => ({
        id: r.id,
        slug: (r.fields['Slug'] as string) ?? '',
        title: (r.fields['Title'] as string) ?? '',
        routeType: (r.fields['Route Type'] as string) ?? '',
        tourStartTime: (r.fields['Tour Start Time'] as string) ?? '',
        tourEndTime: (r.fields['Tour End Time'] as string) ?? '',
      }))
      .filter((r) => isManagedSlug(r.slug))
    return NextResponse.json(routes)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

const SLUG_SUFFIX_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      title?: string
      section?: string
      slugSuffix?: string
      routeType?: string
    }

    const title = body.title?.trim() ?? ''
    const section = body.section === 'city-tour' ? 'city-tour' : body.section === 'intercity' ? 'intercity' : ''
    const slugSuffix = body.slugSuffix?.trim().toLowerCase() ?? ''
    const routeType = body.routeType?.trim() ?? ''

    if (!title) return NextResponse.json({ error: 'Укажите название маршрута' }, { status: 400 })
    if (!section) return NextResponse.json({ error: 'Укажите раздел: intercity или city-tour' }, { status: 400 })
    if (!SLUG_SUFFIX_PATTERN.test(slugSuffix)) {
      return NextResponse.json({ error: 'Slug: только латиница, цифры и дефисы (например: yokohama-day)' }, { status: 400 })
    }

    const slug = `${section}/${slugSuffix}`

    // Duplicate check against existing managed routes.
    const listUrl = `https://api.airtable.com/v0/${BASE_ID}/${ROUTES_TABLE}?pageSize=100&fields%5B%5D=Slug`
    const listRes = await fetchAirtableWithRetry(listUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      cache: 'no-store',
    })
    if (listRes.ok) {
      const listData = (await listRes.json()) as { records: Array<{ fields: Record<string, unknown> }> }
      if (listData.records.some((r) => (r.fields['Slug'] as string) === slug)) {
        return NextResponse.json({ error: `Маршрут со slug «${slug}» уже существует` }, { status: 409 })
      }
    }

    const routeId = `RT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

    const fields: Record<string, unknown> = {
      'Route ID': routeId,
      'Slug': slug,
      'Title': title,
      'Status': 'Draft',
    }
    // typecast lets Airtable create a new Route Type option if the value is new.
    if (routeType) fields['Route Type'] = routeType

    const createRes = await fetchAirtableWithRetry(`https://api.airtable.com/v0/${BASE_ID}/${ROUTES_TABLE}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields, typecast: true }),
    })

    if (!createRes.ok) {
      const text = await createRes.text()
      return NextResponse.json({ error: text }, { status: createRes.status })
    }

    const created = (await createRes.json()) as { id: string; fields: Record<string, unknown> }
    revalidateTag('airtable:routes', 'max')

    return NextResponse.json({
      id: created.id,
      slug,
      title,
      routeType,
      tourStartTime: '',
      tourEndTime: '',
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
