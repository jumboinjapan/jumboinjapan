import { NextResponse } from 'next/server'

import { fetchMultiDayBuilderCities } from '@/lib/multi-day-builder-data'

import { requireAdminSession } from '@/lib/admin-guard'

export async function GET() {
  const denied = await requireAdminSession()
  if (denied) return denied

  try {
    const cities = await fetchMultiDayBuilderCities()
    return NextResponse.json(cities)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
