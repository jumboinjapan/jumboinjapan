import { NextResponse } from 'next/server'
import { getFilteredEvents } from '@/lib/events'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const category = searchParams.get('category')
  const city = searchParams.get('city')
  const region = searchParams.get('region')
  const month = searchParams.get('month')
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')
  const q = searchParams.get('q')

  const events = await getFilteredEvents({ category, city, region, month, dateFrom, dateTo, q })

  return NextResponse.json(events)
}
