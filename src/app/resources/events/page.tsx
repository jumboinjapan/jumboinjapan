import type { Metadata } from 'next'
import Link from 'next/link'
import { EventsFiltersForm } from '@/components/resources/EventsFiltersForm'
import { ResourcesSectionShell } from '@/components/resources/ResourcesSectionShell'
import { eventCategories, getEventFilterOptions, getFilteredEvents } from '@/lib/events'

type EventsPageProps = {
  searchParams?: Promise<{
    category?: string
    city?: string
    region?: string
    month?: string
    dateFrom?: string
    dateTo?: string
    q?: string
  }>
}

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_PATH = '/resources/events'

const categoryLabels: Record<(typeof eventCategories)[number], string> = {
  art: 'Искусство',
  festival: 'Фестивали',
  market: 'Маркеты',
  nature: 'Сезонные',
  food: 'Еда',
  music: 'Музыка',
}

const lifecycleLabels = {
  live: 'Сейчас',
  upcoming: 'Скоро',
  ended: 'Завершено',
} as const

function buildFilterHref(filters: {
  category?: string
  city?: string
  region?: string
  month?: string
  dateFrom?: string
  dateTo?: string
  q?: string
}) {
  const searchParams = new URLSearchParams()

  if (filters.city) searchParams.set('city', filters.city)
  if (filters.region) searchParams.set('region', filters.region)
  if (filters.category) searchParams.set('category', filters.category)
  if (filters.month) searchParams.set('month', filters.month)
  if (filters.dateFrom) searchParams.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) searchParams.set('dateTo', filters.dateTo)
  if (filters.q) searchParams.set('q', filters.q)

  const query = searchParams.toString()
  return query ? `${PAGE_PATH}?${query}` : PAGE_PATH
}

function formatEventDate(dateString: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${dateString}T00:00:00`))
}

function formatEventDateRange(dateStart: string, dateEnd: string) {
  if (dateStart === dateEnd) return formatEventDate(dateStart)
  return `${formatEventDate(dateStart)} — ${formatEventDate(dateEnd)}`
}

function formatPrice(price: string) {
  const normalized = price.trim()
  if (!normalized) return 'Цена уточняется'
  if (/бесплатно|free/i.test(normalized)) return 'Бесплатно'
  if (/^¥/.test(normalized) || /JPY/i.test(normalized)) return normalized
  if (/^\d[\d\s,.]*$/.test(normalized)) {
    const amount = Number(normalized.replace(/[\s,]/g, ''))
    if (Number.isFinite(amount)) return `¥${amount.toLocaleString('ru-RU')}`
  }
  return normalized
}

function truncateDescription(description: string, maxLength = 160) {
  const normalized = description.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).replace(/[\s,.;:!?-]+$/g, '')}…`
}

function buildMetaLine(event: { city: string; regionLabel: string; price: string }) {
  return [event.city, event.regionLabel, formatPrice(event.price)].filter(Boolean).join(' · ')
}

function buildCanonicalUrl() {
  return `${BASE_URL}${PAGE_PATH}`
}

export async function generateMetadata({ searchParams }: EventsPageProps): Promise<Metadata> {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const canonicalUrl = buildCanonicalUrl()
  const hasFilters = Boolean(
    resolvedSearchParams.category ||
      resolvedSearchParams.city ||
      resolvedSearchParams.region ||
      resolvedSearchParams.month ||
      resolvedSearchParams.dateFrom ||
      resolvedSearchParams.dateTo ||
      resolvedSearchParams.q,
  )

  return {
    title: 'События — ресурсы для поездки по Японии',
    description:
      'Раздел ресурсов с событиями, выставками и концертами по Японии: сначала даты и место, потом детали. Удобно проверять, что имеет смысл встроить в маршрут.',
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: 'События — ресурсы для поездки по Японии',
      description:
        'Раздел ресурсов с событиями, выставками и концертами по Японии: сначала даты и место, потом детали.',
      url: hasFilters ? canonicalUrl : `${BASE_URL}${PAGE_PATH}`,
      type: 'website',
    },
  }
}

export default async function ResourceEventsPage({ searchParams }: EventsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const activeCategory = resolvedSearchParams.category?.toLowerCase() ?? ''
  const activeCity = resolvedSearchParams.city?.trim() ?? ''
  const activeRegion = resolvedSearchParams.region?.trim() ?? ''
  const activeDateFrom = resolvedSearchParams.dateFrom?.trim() ?? ''
  const activeDateTo = resolvedSearchParams.dateTo?.trim() ?? ''

  const [events, filterOptions] = await Promise.all([
    getFilteredEvents({
      category: resolvedSearchParams.category,
      city: resolvedSearchParams.city,
      region: resolvedSearchParams.region,
      month: resolvedSearchParams.month,
      dateFrom: resolvedSearchParams.dateFrom,
      dateTo: resolvedSearchParams.dateTo,
      q: resolvedSearchParams.q,
    }),
    getEventFilterOptions(resolvedSearchParams.region),
  ])

  const canonicalUrl = buildCanonicalUrl()
  const collectionJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'События — раздел ресурсов',
    description:
      'Раздел ресурсов с событиями, выставками и концертами по Японии для проверки дат и локаций перед включением в маршрут.',
    url: canonicalUrl,
    mainEntity: events.slice(0, 24).map((event) => ({
      '@type': 'Event',
      name: event.title,
      startDate: `${event.dateStart}T00:00:00+09:00`,
      endDate: `${event.dateEnd}T23:59:59+09:00`,
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      eventStatus:
        event.lifecycle === 'live'
          ? 'https://schema.org/EventScheduled'
          : 'https://schema.org/EventScheduled',
      location: {
        '@type': 'Place',
        name: event.venue,
        address: [event.neighborhood, event.city, event.regionLabel].filter(Boolean).join(', '),
      },
      description: truncateDescription(event.description, 220),
      url: event.url || event.sourceUrl,
      organizer: {
        '@type': 'Organization',
        name: 'Jumbo in Japan',
      },
      offers: event.price
        ? {
            '@type': 'Offer',
            priceCurrency: /¥|JPY/i.test(event.price) || /^\d/.test(event.price) ? 'JPY' : undefined,
            price: /^\d[\d\s,.]*$/.test(event.price) ? Number(event.price.replace(/[\s,]/g, '')) : undefined,
            availability: 'https://schema.org/InStock',
            url: event.url || event.sourceUrl,
          }
        : undefined,
    })),
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }} />

      <ResourcesSectionShell
        title="События"
        description="Подборка временных событий по Японии: сначала смотрите даты и город, потом решайте, стоит ли встраивать событие в маршрут."
        planningNote="Сначала смотрите даты и город, потом решайте, стоит ли встраивать событие в маршрут."
      >
        <div className="space-y-3">
          <EventsFiltersForm
            activeCategory={activeCategory}
            activeCity={activeCity}
            activeRegion={activeRegion}
            activeDateFrom={activeDateFrom}
            activeDateTo={activeDateTo}
            activeMonth={resolvedSearchParams.month}
            activeQuery={resolvedSearchParams.q}
            regions={filterOptions.regions}
            cities={filterOptions.cities}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">{events.length} событий</p>
            <Link
              href={PAGE_PATH}
              className="text-sm text-[var(--accent)] underline underline-offset-4 transition-opacity hover:opacity-70"
            >
              Сбросить фильтры
            </Link>
          </div>

          <div className="overflow-x-auto">
            <div className="flex min-w-max flex-nowrap gap-2 pb-1">
              <Link
                href={buildFilterHref({
                  city: activeCity || undefined,
                  region: activeRegion || undefined,
                  month: resolvedSearchParams.month,
                  dateFrom: activeDateFrom || undefined,
                  dateTo: activeDateTo || undefined,
                  q: resolvedSearchParams.q,
                })}
                className={`inline-flex min-h-10 shrink-0 items-center justify-center rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                  activeCategory === ''
                    ? 'bg-[var(--text)] text-[var(--bg)]'
                    : 'border border-[var(--border)] bg-white text-[var(--text)] hover:border-[var(--text)]'
                }`}
              >
                Все категории
              </Link>
              {eventCategories.map((category) => {
                const isActive = activeCategory === category

                return (
                  <Link
                    key={category}
                    href={buildFilterHref({
                      city: activeCity || undefined,
                      region: activeRegion || undefined,
                      category,
                      month: resolvedSearchParams.month,
                      dateFrom: activeDateFrom || undefined,
                      dateTo: activeDateTo || undefined,
                      q: resolvedSearchParams.q,
                    })}
                    className={`inline-flex min-h-10 shrink-0 items-center justify-center rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-[var(--text)] text-[var(--bg)]'
                        : 'border border-[var(--border)] bg-white text-[var(--text)] hover:border-[var(--text)]'
                    }`}
                  >
                    {categoryLabels[category]}
                  </Link>
                )
              })}
            </div>
          </div>
        </div>

        {events.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {events.map((event) => (
              <Link
                key={event.id}
                href={event.url || event.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="group block border border-[var(--border)] bg-white px-4 py-4 transition-colors hover:border-[var(--text)] hover:bg-[var(--bg)]/40"
              >
                <article className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-[var(--text)]">{formatEventDateRange(event.dateStart, event.dateEnd)}</p>
                    <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      <span className="rounded-full border border-[var(--border)] px-2.5 py-1">{lifecycleLabels[event.lifecycle]}</span>
                      <span className="rounded-full border border-[var(--border)] px-2.5 py-1">{categoryLabels[event.category]}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <h2 className="font-sans text-lg font-medium tracking-[-0.01em] text-[var(--text)] transition-colors group-hover:text-[var(--accent)] md:line-clamp-1">
                      {event.title}
                    </h2>
                    <p className="text-sm text-[var(--text-muted)]">{buildMetaLine(event)}</p>
                  </div>

                  {event.summary ? (
                    <p className="max-w-3xl text-sm leading-6 text-[var(--text-muted)] line-clamp-2">{event.summary}</p>
                  ) : null}

                  <div className="flex items-center justify-end text-sm text-[var(--text-muted)]">
                    <span className="underline decoration-transparent underline-offset-4 transition-all group-hover:decoration-current">
                      Офиц. сайт ↗
                    </span>
                  </div>
                </article>
              </Link>
            ))}
          </div>
        ) : (
          <div className="border border-[var(--border)] bg-white p-5 text-sm text-[var(--text-muted)] md:p-6">
            По текущему фильтру ничего не найдено.
          </div>
        )}
      </ResourcesSectionShell>
    </>
  )
}
