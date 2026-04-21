import { NextRequest, NextResponse } from 'next/server'

import type { MultiDayBuilderRoute } from '@/lib/multi-day-builder'
import { listSavedMultiDayRoutes, loadMultiDayBuilderRoute, saveMultiDayBuilderRoute } from '@/lib/multi-day-builder-storage'

export async function GET(request: NextRequest) {
  try {
    const slug = request.nextUrl.searchParams.get('slug')?.trim()
    if (slug) {
      const route = await loadMultiDayBuilderRoute(slug)
      if (!route) {
        return NextResponse.json({ error: 'Route not found' }, { status: 404 })
      }
      return NextResponse.json(route)
    }

    const routes = await listSavedMultiDayRoutes()
    return NextResponse.json(routes)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const route = (await request.json()) as MultiDayBuilderRoute
    const result = await saveMultiDayBuilderRoute(route)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
