import { NextRequest, NextResponse } from 'next/server'

import { listMultiDayBuilderServicePois } from '@/lib/multi-day-builder-data'

/**
 * Полный список служебных POI для кнопки «Добавить блок» в Конструкторе
 * тура — без поиска, весь набор сразу (Свободное время, Заселение,
 * трансферы и т.п.). См. searchMultiDayBuilderPois для поиска по запросу.
 */
export async function GET(request: NextRequest) {
  try {
    const pois = await listMultiDayBuilderServicePois()
    return NextResponse.json(pois)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
