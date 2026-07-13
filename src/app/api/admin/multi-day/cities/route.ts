import { NextRequest, NextResponse } from 'next/server'

import { fetchMultiDayBuilderCities } from '@/lib/multi-day-builder-data'

import { requireAdminSession } from '@/lib/admin-guard'

export async function GET(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const cities = await fetchMultiDayBuilderCities()
    return NextResponse.json(cities)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
