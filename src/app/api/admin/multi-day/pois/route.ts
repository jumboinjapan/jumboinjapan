import { NextRequest, NextResponse } from 'next/server'

import { searchMultiDayBuilderPois } from '@/lib/multi-day-builder-data'

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('query')?.trim() ?? ''
    const pois = await searchMultiDayBuilderPois(query)
    return NextResponse.json(pois)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
