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
        description="Раздел ресурсов для временных событий: сначала смотрите даты и место, потом решайте, стоит ли встраивать событие в поездку."
        guidanceTitle="Перед поездкой"
        guidanceItems={[
          {
            title: 'Проверьте окно дат',
            description: 'Это live-список: сверяйте период проведения и актуальность перед покупкой билетов.',
          },
          {
            title: 'Смотрите на город и площадку',
            description: 'Полезнее всего, когда событие уже попадает в ваш маршрут или реально меняет его.',
          },
        ]}
      >
        <div className="space-y-4">
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

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Категория</p>
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
                  className={`inline-flex min-h-11 shrink-0 items-center justify-center px-4 py-2 text-sm font-medium transition-colors ${
                    activeCategory === ''
                      ? 'bg-[var(--text)] text-[var(--bg)]'
                      : 'border border-[var(--border)] text-[var(--text)] hover:border-[var(--text)]'
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
                      className={`inline-flex min-h-11 shrink-0 items-center justify-center px-4 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-[var(--text)] text-[var(--bg)]'
                          : 'border border-[var(--border)] text-[var(--text)] hover:border-[var(--text)]'
                      }`}
                    >
                      {categoryLabels[category]}
                    </Link>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {events.length > 0 ? (
          <div className="grid gap-4">
            {events.map((event) => (
              <article key={event.id} className="border border-[var(--border)] bg-white p-5 md:p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--text)]">
                      <span className="font-medium">{formatEventDateRange(event.dateStart, event.dateEnd)}</span>
                      <span className="text-[var(--text-muted)]">{event.city}</span>
                      <span className="text-[var(--text-muted)]">{event.venue}</span>
                    </div>
                    <div className="space-y-1">
                      <h2 className="font-sans text-xl font-medium tracking-[-0.01em] md:text-[1.35rem]">{event.title}</h2>
                      {event.titleJa && event.titleJa !== event.title ? <p className="text-sm text-[var(--text-muted)]">{event.titleJa}</p> : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    <span className="border border-[var(--border)] px-2.5 py-1">{lifecycleLabels[event.lifecycle]}</span>
                    <span className="border border-[var(--border)] px-2.5 py-1">{categoryLabels[event.category]}</span>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 text-sm text-[var(--text)] md:grid-cols-3">
                  <p>
                    <span className="text-[var(--text-muted)]">Район:</span> {event.neighborhood || 'Уточняется'}
                  </p>
                  <p>
                    <span className="text-[var(--text-muted)]">Регион:</span> {event.regionLabel || event.city}
                  </p>
                  <p>
                    <span className="text-[var(--text-muted)]">Цена:</span> {formatPrice(event.price)}
                  </p>
                </div>

                <p className="mt-4 max-w-4xl text-sm leading-relaxed text-[var(--text-muted)]">{truncateDescription(event.description)}</p>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Link
                    href={event.url || event.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center border border-[var(--text)] px-5 py-2 text-sm font-medium uppercase tracking-wide transition-colors hover:bg-[var(--text)] hover:text-[var(--bg)]"
                  >
                    Открыть сайт
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="border border-[var(--border)] bg-white p-6 text-sm text-[var(--text-muted)] md:p-7">
            По текущему фильтру ничего не найдено.
          </div>
        )}
      </ResourcesSectionShell>
    </>
  )
}
