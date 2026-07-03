import { BedDouble, MapPin, Plane, StickyNote, TrainFront, Utensils } from 'lucide-react'
import { PageHero } from '@/components/sections/PageHero'
import { SectionHeading } from '@/components/sections/SectionHeading'
import type { MultiDayBuilderDayItem, MultiDayBuilderRoute } from '@/lib/multi-day-builder'

const DEFAULT_HERO_IMAGE = '/dest-multi-day-journeys-hero-20260421c.jpg'

const itemTypeIcon: Record<MultiDayBuilderDayItem['itemType'], typeof MapPin> = {
  poi: MapPin,
  transport: TrainFront,
  hotel: BedDouble,
  meal: Utensils,
  note: StickyNote,
  arrival: Plane,
  departure: Plane,
  day_block: StickyNote,
}

const dayTypeLabel: Record<MultiDayBuilderRoute['days'][number]['dayType'], string> = {
  arrival: 'Прилёт',
  touring: 'Экскурсионный день',
  departure: 'Отъезд',
  independent: 'Свободный день',
}

function getOvernightRows(route: MultiDayBuilderRoute) {
  const counts = new Map<string, number>()

  for (const day of route.days) {
    if (!day.overnightCity || day.overnightCity === '—') continue
    counts.set(day.overnightCity, (counts.get(day.overnightCity) ?? 0) + 1)
  }

  return Array.from(counts.entries()).map(([city, nights]) => ({ city, nights }))
}

export function MultiDayBuilderRouteView({
  route,
  heroImage,
  intro,
}: {
  route: MultiDayBuilderRoute
  heroImage?: string | null
  intro?: string | null
}) {
  const overnights = getOvernightRows(route)
  const title = route.previewTitle || route.title
  const subtitle = route.previewSubtitle || `${route.dayCount} дней · ${route.startCity} → ${route.endCity}`.trim()

  return (
    <>
      <PageHero image={heroImage || DEFAULT_HERO_IMAGE} eyebrow="Готовый маршрут" title={title} subtitle={subtitle} />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto w-full max-w-6xl space-y-10 md:space-y-14">
          {intro ? (
            <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text)] md:text-[16px]">
              {intro}
            </p>
          ) : null}

          {overnights.length > 0 && (
            <section className="space-y-6 md:space-y-8">
              <SectionHeading eyebrow="Ночёвки" title="Где группа ночует по ходу маршрута" />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {overnights.map((row) => (
                  <div key={`${route.slug}-${row.city}`} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
                    <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Ночёвка</p>
                    <p className="mt-2 text-[16px] font-medium tracking-[-0.01em] text-[var(--text)]">{row.city}</p>
                    <p className="mt-1 text-[14px] font-light leading-[1.7] text-[var(--text-muted)]">{row.nights} ночи</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-6 md:space-y-8">
            <SectionHeading eyebrow="Маршрут по дням" title="Как маршрут развивается день за днём" />
            <div className="space-y-4">
              {route.days.map((day) => (
                <article key={day.id} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">
                      День {day.dayNumber}
                    </span>
                    <span className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[11px] text-[var(--text-muted)]">
                      {dayTypeLabel[day.dayType]}
                    </span>
                    {day.overnightCity && day.overnightCity !== '—' ? (
                      <span className="text-[12px] text-[var(--text-muted)]">Ночёвка: {day.overnightCity}</span>
                    ) : null}
                  </div>
                  <h3 className="mt-2 font-sans text-[19px] font-medium tracking-[-0.02em] text-[var(--text)]">{day.dayTitle}</h3>
                  {day.daySummary ? (
                    <p className="mt-2 font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{day.daySummary}</p>
                  ) : null}

                  {day.items.length > 0 && (
                    <ul className="mt-4 space-y-2.5">
                      {day.items.map((item) => {
                        const Icon = itemTypeIcon[item.itemType]
                        return (
                          <li key={item.id} className="flex items-start gap-2.5">
                            <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                            </span>
                            <span className="text-[14px] font-light leading-[1.6] text-[var(--text)]">
                              {item.displayTitle}
                              {item.shortDescription ? (
                                <span className="text-[var(--text-muted)]"> — {item.shortDescription}</span>
                              ) : null}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {day.transportSegments.length > 0 && (
                    <div className="mt-4 space-y-1.5 border-t border-[var(--border)] pt-3">
                      {day.transportSegments.map((segment) => (
                        <p key={segment.id} className="text-[13px] text-[var(--text-muted)]">
                          {segment.fromLocation} → {segment.toLocation}
                          {segment.durationMinutes ? ` · ~${Math.round(segment.durationMinutes / 60)} ч` : ''}
                        </p>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-8 space-y-4">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em]">Обсудить этот маршрут</h2>
            <p className="max-w-2xl text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Логику маршрута можно адаптировать под ваши даты, состав группы, темп поездки и интересы.
            </p>
            <a
              href="/contact"
              className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
            >
              Обсудить поездку
            </a>
          </section>
        </div>
      </section>
    </>
  )
}
