import { eventCategories, getResources, isEventLikeResource, toEventItem, type EventCategory, type EventItem } from '@/lib/resources'

export { eventCategories }
export type { EventCategory, EventItem }

type EventFilters = {
  category?: string | null
  city?: string | null
  region?: string | null
  month?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  q?: string | null
}

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function matchesMonth(event: EventItem, month: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(month)) return true

  const [year, monthNumber] = month.split('-')
  const monthStart = new Date(`${year}-${monthNumber}-01T00:00:00`)
  const monthEnd = new Date(monthStart)
  monthEnd.setMonth(monthEnd.getMonth() + 1)

  const eventStart = new Date(`${event.dateStart}T00:00:00`)
  const eventEnd = new Date(`${event.dateEnd}T23:59:59`)

  return eventStart < monthEnd && eventEnd >= monthStart
}

function matchesDateRange(event: EventItem, dateFrom?: string | null, dateTo?: string | null): boolean {
  const hasDateFrom = Boolean(dateFrom && isValidDateInput(dateFrom))
  const hasDateTo = Boolean(dateTo && isValidDateInput(dateTo))
  if (!hasDateFrom && !hasDateTo) return true

  const eventStart = new Date(`${event.dateStart}T00:00:00`)
  const eventEnd = new Date(`${event.dateEnd}T23:59:59`)

  if (hasDateFrom) {
    const fromDate = new Date(`${dateFrom}T00:00:00`)
    if (eventEnd < fromDate) return false
  }

  if (hasDateTo) {
    const toDate = new Date(`${dateTo}T23:59:59`)
    if (eventStart > toDate) return false
  }

  return true
}

function matchesQuery(event: EventItem, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  return [event.title, event.titleJa, event.venue, event.venueJa, event.neighborhood, event.city, event.regionLabel, event.description, ...event.tags]
    .join(' ')
    .toLowerCase()
    .includes(normalized)
}

function matchesCity(event: EventItem, city: string): boolean {
  const normalized = city.trim().toLowerCase()
  if (!normalized) return true

  return event.city.trim().toLowerCase() === normalized
}

function matchesRegion(event: EventItem, region: string): boolean {
  const normalized = region.trim().toLowerCase()
  if (!normalized) return true

  return event.regionLabel.trim().toLowerCase() === normalized
}

function compareEventTiming(left: EventItem, right: EventItem) {
  const lifecycleRank: Record<EventItem['lifecycle'], number> = {
    live: 0,
    upcoming: 1,
    ended: 2,
  }

  const leftRank = lifecycleRank[left.lifecycle] ?? 9
  const rightRank = lifecycleRank[right.lifecycle] ?? 9

  if (leftRank !== rightRank) return leftRank - rightRank

  const now = Date.now()
  const leftRelevant = left.lifecycle === 'live' ? new Date(`${left.dateEnd}T23:59:59`).getTime() : new Date(`${left.dateStart}T00:00:00`).getTime()
  const rightRelevant = right.lifecycle === 'live' ? new Date(`${right.dateEnd}T23:59:59`).getTime() : new Date(`${right.dateStart}T00:00:00`).getTime()

  const leftDistance = Math.abs(leftRelevant - now)
  const rightDistance = Math.abs(rightRelevant - now)

  if (leftDistance !== rightDistance) return leftDistance - rightDistance
  if (leftRelevant !== rightRelevant) return leftRelevant - rightRelevant

  return left.title.localeCompare(right.title, 'ru')
}

function getUniqueSortedValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'ru'))
}

export async function getAllEvents(): Promise<EventItem[]> {
  const resources = (await getResources({ types: ['event', 'exhibition', 'concert'] }))
    .filter(isEventLikeResource)
    .filter((resource) => resource.status === 'active' && resource.event.lifecycle !== 'ended')

  return resources.map(toEventItem).sort(compareEventTiming)
}

export async function getEventFilterOptions(region?: string | null): Promise<{ regions: string[]; cities: string[] }> {
  const events = await getAllEvents()
  const normalizedRegion = region?.trim().toLowerCase() ?? ''

  const regions = getUniqueSortedValues(events.map((event) => event.regionLabel))
  const cities = getUniqueSortedValues(
    events
      .filter((event) => (normalizedRegion ? event.regionLabel.trim().toLowerCase() === normalizedRegion : true))
      .map((event) => event.city),
  )

  return { regions, cities }
}

export async function getEventCities(region?: string | null): Promise<string[]> {
  const { cities } = await getEventFilterOptions(region)
  return cities
}

export async function getFilteredEvents(filters: EventFilters = {}): Promise<EventItem[]> {
  const { category, city, region, month, dateFrom, dateTo, q } = filters
  const normalizedCategory = category?.trim().toLowerCase()
  const events = await getAllEvents()

  return events.filter((event) => {
    const categoryMatch = normalizedCategory ? event.category === normalizedCategory : true
    const cityMatch = city ? matchesCity(event, city) : true
    const regionMatch = region ? matchesRegion(event, region) : true
    const monthMatch = month ? matchesMonth(event, month) : true
    const dateRangeMatch = matchesDateRange(event, dateFrom, dateTo)
    const queryMatch = q ? matchesQuery(event, q) : true
    return categoryMatch && cityMatch && regionMatch && monthMatch && dateRangeMatch && queryMatch
  })
}
