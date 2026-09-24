import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

import { AIRTABLE_BASE_ID, ROUTES_TABLE_ID } from '@/lib/airtable-schema'
import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import {
  AirtableListError,
  fetchAllRoutesRecords,
  isRouteStopsListEntry,
  isTravelFormatPageSlug,
} from '@/lib/admin-route-packages'

import { requireAdminSession } from '@/lib/admin-guard'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN!
const BASE_ID = AIRTABLE_BASE_ID
const ROUTES_TABLE = ROUTES_TABLE_ID

// Этот редактор ведёт пакеты дневных туров: intercity/* и city-tour/*.
// Многодневные маршруты (multi-day/*) живут в /admin/multi-day.
// Правило по префиксу вместо белого списка — чтобы пакеты, созданные из
// админки, появлялись без правки кода. Страницы форматов поездки и записи
// в архиве (Status = Archived) из списка исключены: см. admin-route-packages.ts.
const LIST_FIELDS = ['Slug', 'Title', 'Route Type', 'Tour Start Time', 'Tour End Time', 'Status'] as const

const text = (fields: Record<string, unknown>, key: string) =>
  typeof fields[key] === 'string' ? (fields[key] as string) : ''

export async function GET(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const records = await fetchAllRoutesRecords({
      token: AIRTABLE_TOKEN,
      baseId: BASE_ID,
      tableId: ROUTES_TABLE,
      fields: LIST_FIELDS,
    })
    const routes = records
      .filter((r) => isRouteStopsListEntry(text(r.fields, 'Slug'), r.fields['Status']))
      .map((r) => ({
        id: r.id,
        slug: text(r.fields, 'Slug'),
        title: (r.fields['Title'] as string) ?? '',
        routeType: (r.fields['Route Type'] as string) ?? '',
        tourStartTime: (r.fields['Tour Start Time'] as string) ?? '',
        tourEndTime: (r.fields['Tour End Time'] as string) ?? '',
      }))
    return NextResponse.json(routes)
  } catch (err) {
    if (err instanceof AirtableListError) {
      return NextResponse.json({ error: err.body }, { status: err.status })
    }
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

    // Адрес страницы формата поездки занят статичной страницей: пакет с таким
    // slug на сайте никогда не откроется, а в редакторе снова станет «маршрутом
    // без остановок».
    if (isTravelFormatPageSlug(slug)) {
      return NextResponse.json(
        { error: `Адрес «${slug}» занят страницей о формате поездки — выберите другой slug` },
        { status: 409 },
      )
    }

    // Проверка дубликата по всем записям Routes, включая архивные: slug уникален.
    // Если проверить нельзя — не создаём (раньше при сбое чтения запись
    // создавалась без проверки).
    let existing
    try {
      existing = await fetchAllRoutesRecords({
        token: AIRTABLE_TOKEN,
        baseId: BASE_ID,
        tableId: ROUTES_TABLE,
        fields: ['Slug'],
      })
    } catch {
      return NextResponse.json(
        { error: 'Не удалось проверить, свободен ли slug, — маршрут не создан. Повторите попытку.' },
        { status: 502 },
      )
    }
    if (existing.some((r) => text(r.fields, 'Slug') === slug)) {
      return NextResponse.json({ error: `Маршрут со slug «${slug}» уже существует` }, { status: 409 })
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
