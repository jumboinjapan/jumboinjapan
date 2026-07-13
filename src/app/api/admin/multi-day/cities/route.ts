import { NextRequest, NextResponse } from 'next/server'

import { fetchMultiDayBuilderCities } from '@/lib/multi-day-builder-data'

export async function GET(request: NextRequest) {
  try {
    const cities = await fetchMultiDayBuilderCities()
    return NextResponse.json(cities)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
