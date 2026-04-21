import { NextRequest, NextResponse } from 'next/server'

import type { MultiDayBuilderRoute } from '@/lib/multi-day-builder'
import { saveMultiDayBuilderRoute } from '@/lib/multi-day-builder-storage'

export async function POST(request: NextRequest) {
  try {
    const route = (await request.json()) as MultiDayBuilderRoute
    const result = await saveMultiDayBuilderRoute(route)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
