import { eventCategories, getResources, isEventLikeResource, toEventItem, type EventCategory, type EventItem } from '@/lib/resources'

export { eventCategories }
export type { EventCategory, EventItem }

type EventFilters = {
  category?: string | null
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

  return [event.title, event.titleJa, event.venue, event.venueJa, event.neighborhood, event.description, ...event.tags]
    .join(' ')
    .toLowerCase()
    .includes(normalized)
}

export async function getAllEvents(): Promise<EventItem[]> {
  const resources = (await getResources({ types: ['event', 'exhibition', 'concert'] })).filter(isEventLikeResource)
  return resources.map(toEventItem)
}

export async function getFilteredEvents(filters: EventFilters = {}): Promise<EventItem[]> {
  const { category, month, q } = filters
  const normalizedCategory = category?.trim().toLowerCase()
  const events = await getAllEvents()

  return events.filter((event) => {
    const categoryMatch = normalizedCategory ? event.category === normalizedCategory : true
    const monthMatch = month ? matchesMonth(event, month) : true
    const queryMatch = q ? matchesQuery(event, q) : true
    return categoryMatch && monthMatch && queryMatch
  })
}
