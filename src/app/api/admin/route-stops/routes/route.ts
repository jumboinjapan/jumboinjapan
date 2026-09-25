import { readRegistryRecords } from '@/lib/route-registry-store'
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

import { AIRTABLE_BASE_ID, ROUTES_TABLE_ID } from '@/lib/airtable-schema'

import { requireAdminSession } from '@/lib/admin-guard'

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

export async function GET(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const routes = (await readRegistryRecords(ROUTES_TABLE_ID)).filter(r => r.fields['Content Kind'] === 'Tour')
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
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const body = (await request.json()) as {
      title?: string
      section?: string
      slugSuffix?: string
      routeType?: string
    }

    if (!body || typeof body.title !== 'string' || typeof body.slugSuffix !== 'string') return NextResponse.json({ error: 'Укажите название и slug' }, { status: 400 })
    const title = body.title.trim()
    const section = body.section === 'city-tour' ? 'city-tour' : body.section === 'intercity' ? 'intercity' : ''
    const slugSuffix = body.slugSuffix?.trim().toLowerCase() ?? ''
    const routeType = section

    if (!title) return NextResponse.json({ error: 'Укажите название маршрута' }, { status: 400 })
    if (!section) return NextResponse.json({ error: 'Укажите раздел: intercity или city-tour' }, { status: 400 })
    if (!SLUG_SUFFIX_PATTERN.test(slugSuffix)) {
      return NextResponse.json({ error: 'Slug: только латиница, цифры и дефисы (например: yokohama-day)' }, { status: 400 })
    }

    const slug = `${section}/${slugSuffix}`

    const existing = await readRegistryRecords(ROUTES_TABLE_ID, ['Slug'])
    if (existing.some(r => r.fields.Slug === slug)) {
      return NextResponse.json({ error: `Маршрут со slug «${slug}» уже существует` }, { status: 409 })
    }

    const routeId = `RT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

    const fields: Record<string, unknown> = {
      'Route ID': routeId,
      'Slug': slug,
      'Title': title,
      'Status': 'Draft',
      'Content Kind': 'Tour',
    }
    if (routeType) fields['Route Type'] = routeType

    let responseId: string | undefined
    try {
      const createRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ROUTES_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }), signal: AbortSignal.timeout(45000),
      })
      const body = await createRes.json()
      if (createRes.ok && typeof body.id === 'string') responseId = body.id
    } catch { /* Do not retry POST; determine the outcome from the base. */ }
    const matches = (await readRegistryRecords(ROUTES_TABLE_ID)).filter(r => r.fields.Slug === slug)
    if (matches.length !== 1 || (responseId && matches[0].id !== responseId)
      || Object.entries(fields).some(([key, value]) => matches[0].fields[key] !== value)) {
      return NextResponse.json({ error: 'Результат создания не подтверждён. Проверьте запись в базе перед повтором.' }, { status: 503 })
    }
    const created = matches[0]
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
