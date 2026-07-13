import { NextRequest, NextResponse } from 'next/server'

import type { MultiDayBuilderHotelOption } from '@/lib/multi-day-builder-data'
import { getCachedResources, type HotelResource } from '@/lib/resources'

import { requireAdminSession } from '@/lib/admin-guard'

/**
 * Поиск отелей для Конструктора тура — только существующие записи в базе
 * (Resources, Resource Type = hotel). Новый отель сюда не добавляется:
 * см. POST /api/admin/resources (создание) — /admin/resources открывается
 * из этого же поиска, когда результатов нет (решение владельца: "в таблице
 * только вызываются существующие, новое — через меню отелей плюсиком").
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdminSession()
  if (denied) return denied

  try {
    const query = request.nextUrl.searchParams.get('query')?.trim().toLowerCase() ?? ''
    if (query.length < 1) return NextResponse.json([])

    const resources = await getCachedResources({ types: ['hotel'] })
    const hotels = resources.filter((r): r is HotelResource => r.type === 'hotel' && r.status !== 'archived')

    const results: MultiDayBuilderHotelOption[] = hotels
      .filter((hotel) => hotel.title.toLowerCase().includes(query) || hotel.city.toLowerCase().includes(query))
      .map((hotel) => ({
        resourceId: hotel.resourceId,
        title: hotel.title,
        city: hotel.city,
        tier: hotel.hotel.tier,
        ryokan: hotel.hotel.ryokan,
        tripUrl: hotel.hotel.tripUrl,
      }))
      .sort((left, right) => left.title.localeCompare(right.title, 'ru'))
      .slice(0, 12)

    return NextResponse.json(results)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
