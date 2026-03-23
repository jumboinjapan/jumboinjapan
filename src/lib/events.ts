import eventsData from "@/data/events.json";

export const eventCategories = ["art", "festival", "market", "nature", "food", "music"] as const;

export type EventCategory = (typeof eventCategories)[number];

export type EventItem = {
  id: string;
  title: string;
  titleJa: string;
  venue: string;
  venueJa: string;
  neighborhood: string;
  category: EventCategory;
  dateStart: string;
  dateEnd: string;
  price: string;
  url: string;
  description: string;
  tags: string[];
  sourceUrl: string;
  featured: boolean;
};

const events = eventsData as EventItem[];

type EventFilters = {
  category?: string | null;
  month?: string | null;
  q?: string | null;
};

function matchesMonth(event: EventItem, month: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return true;
  }

  const [year, monthNumber] = month.split("-");
  const monthStart = new Date(`${year}-${monthNumber}-01T00:00:00`);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const eventStart = new Date(`${event.dateStart}T00:00:00`);
  const eventEnd = new Date(`${event.dateEnd}T23:59:59`);

  return eventStart < monthEnd && eventEnd >= monthStart;
}

function matchesQuery(event: EventItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  return [
    event.title,
    event.titleJa,
    event.venue,
    event.venueJa,
    event.neighborhood,
    event.description,
    ...event.tags,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

export function getFilteredEvents(filters: EventFilters = {}): EventItem[] {
  const { category, month, q } = filters;
  const normalizedCategory = category?.trim().toLowerCase();

  return events.filter((event) => {
    const categoryMatch = normalizedCategory
      ? event.category === normalizedCategory
      : true;
    const monthMatch = month ? matchesMonth(event, month) : true;
    const queryMatch = q ? matchesQuery(event, q) : true;

    return categoryMatch && monthMatch && queryMatch;
  });
}

export function getAllEvents(): EventItem[] {
  return events;
}
