import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireAdminSession, requireSameOrigin } from '@/lib/admin-guard'
import { fetchMultiDayBuilderCities, listMultiDayBuilderPois } from '@/lib/multi-day-builder-data'

export async function GET(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied
  try {
    const [pois, cities] = await Promise.all([listMultiDayBuilderPois(), fetchMultiDayBuilderCities()])
    return NextResponse.json({ pois, cities }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Не удалось загрузить список POI. Повторите попытку.' }, { status: 503 })
  }
}

/** The explicit refresh must await fresh data, rather than stale-while-revalidate. */
export async function POST(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied
  const crossOrigin = requireSameOrigin(request)
  if (crossOrigin) return crossOrigin
  revalidateTag('airtable:pois', { expire: 0 })
  return GET(request)
}
