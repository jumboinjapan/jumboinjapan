import { eventCategories, getResources, isEventLikeResource, toEventItem, type EventCategory, type EventItem } from '@/lib/resources'

export { eventCategories }
export type { EventCategory, EventItem }

type EventFilters = {
  category?: string | null
  city?: string | null
  month?: string | null
  q?: string | null
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

  return [event.city, event.regionLabel].some((value) => value.trim().toLowerCase() === normalized)
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

export async function getAllEvents(): Promise<EventItem[]> {
  const resources = (await getResources({ types: ['event', 'exhibition', 'concert'] }))
    .filter(isEventLikeResource)
    .filter((resource) => resource.status === 'active' && resource.event.lifecycle !== 'ended')

  return resources.map(toEventItem).sort(compareEventTiming)
}

export async function getEventCities(): Promise<string[]> {
  const events = await getAllEvents()
  return Array.from(new Set(events.map((event) => event.city).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'ru'))
}

export async function getFilteredEvents(filters: EventFilters = {}): Promise<EventItem[]> {
  const { category, city, month, q } = filters
  const normalizedCategory = category?.trim().toLowerCase()
  const events = await getAllEvents()

  return events.filter((event) => {
    const categoryMatch = normalizedCategory ? event.category === normalizedCategory : true
    const cityMatch = city ? matchesCity(event, city) : true
    const monthMatch = month ? matchesMonth(event, month) : true
    const queryMatch = q ? matchesQuery(event, q) : true
    return categoryMatch && cityMatch && monthMatch && queryMatch
  })
}
