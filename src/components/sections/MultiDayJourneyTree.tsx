import { ChevronDown, Hotel, Map, MapPin, MoveRight, Train } from 'lucide-react'
import type { MultiDayJourney } from '@/data/multiDayJourneys'

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">{label}</p>
      <p className="mt-2 text-[14px] font-light leading-[1.7] text-[var(--text-muted)]">{value}</p>
    </div>
  )
}

export function MultiDayJourneyTree({ journey }: { journey: MultiDayJourney }) {
  return (
    <article className="space-y-6 rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-7">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">{journey.duration}</p>
            <h3 className="font-sans text-2xl font-medium tracking-[-0.02em] text-[var(--text)]">{journey.title}</h3>
          </div>
          <div className="rounded-sm border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-right">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">География</p>
            <p className="mt-2 text-[14px] font-light leading-[1.7] text-[var(--text-muted)]">{journey.geography}</p>
          </div>
        </div>
        <p className="max-w-3xl text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{journey.rhythm}</p>
      </header>

      <div className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
        <SummaryPill label="Кому подходит" value={journey.bestFor} />
        <SummaryPill label="День приезда" value={journey.arrival} />
        <SummaryPill label="День отъезда" value={journey.departure} />
      </div>

      <div className="space-y-3">
        {journey.days.map((day, dayIndex) => (
          <details
            key={`${journey.slug}-${day.day}`}
            open={dayIndex === 0}
            className="group overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--bg)]"
          >
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 marker:content-none">
              <div className="space-y-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">День {day.day}</p>
                <h4 className="font-sans text-[18px] font-medium leading-[1.3] tracking-[-0.01em] text-[var(--text)]">{day.title}</h4>
                <p className="max-w-2xl text-[14px] font-light leading-[1.75] text-[var(--text-muted)]">{day.summary}</p>
              </div>
              <div className="flex shrink-0 items-start gap-3 text-right">
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">Ночёвка</p>
                  <p className="text-[13px] font-light leading-[1.6] text-[var(--text-muted)]">{day.overnightCity}</p>
                </div>
                <ChevronDown className="mt-1 h-4 w-4 text-[var(--accent)] transition-transform group-open:rotate-180" />
              </div>
            </summary>

            <div className="space-y-4 border-t border-[var(--border)] px-5 py-4">
              {day.transfers?.map((transfer) => (
                <div
                  key={`${day.day}-${transfer.from}-${transfer.to}`}
                  className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium tracking-[0.01em] text-[var(--text)]">
                    <Train className="h-4 w-4 text-[var(--accent)]" />
                    <span>Переезд</span>
                    <span className="text-[var(--text-muted)]">{transfer.from}</span>
                    <MoveRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    <span className="text-[var(--text-muted)]">{transfer.to}</span>
                    <span className="text-[var(--text-muted)]">· {transfer.mode}</span>
                  </div>
                  {transfer.note && <p className="mt-2 text-[13px] font-light leading-[1.7] text-[var(--text-muted)]">{transfer.note}</p>}
                </div>
              ))}

              <div className="space-y-3">
                {day.regions.map((region, regionIndex) => (
                  <details
                    key={`${day.day}-${region.name}`}
                    open={regionIndex === 0}
                    className="group/region overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface)]"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none">
                      <div className="flex items-center gap-3">
                        <Map className="h-4 w-4 text-[var(--accent)]" />
                        <div>
                          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">Регион</p>
                          <p className="text-[14px] font-medium leading-[1.5] text-[var(--text)]">{region.name}</p>
                        </div>
                      </div>
                      <ChevronDown className="h-4 w-4 text-[var(--accent)] transition-transform group-open/region:rotate-180" />
                    </summary>

                    <div className="space-y-3 border-t border-[var(--border)] px-4 py-4">
                      {region.cities.map((city, cityIndex) => (
                        <details
                          key={`${day.day}-${region.name}-${city.name}`}
                          open={cityIndex === 0}
                          className="group/city overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--bg)]"
                        >
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none">
                            <div className="flex items-center gap-3">
                              <MapPin className="h-4 w-4 text-[var(--accent)]" />
                              <div>
                                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">Город</p>
                                <p className="text-[14px] font-medium leading-[1.5] text-[var(--text)]">{city.name}</p>
                              </div>
                            </div>
                            <ChevronDown className="h-4 w-4 text-[var(--accent)] transition-transform group-open/city:rotate-180" />
                          </summary>

                          <div className="border-t border-[var(--border)] px-4 py-4">
                            <ul className="space-y-2">
                              {city.pois.map((poi) => (
                                <li key={`${city.name}-${poi.name}`} className="flex items-start gap-3">
                                  <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                                  <div>
                                    <p className="text-[14px] font-light leading-[1.75] text-[var(--text-muted)]">{poi.name}</p>
                                    {poi.note && <p className="mt-1 text-[13px] font-light leading-[1.7] text-[var(--text-muted)]">{poi.note}</p>}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
              </div>

              <div className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <div className="flex items-center gap-3">
                  <Hotel className="h-4 w-4 text-[var(--accent)]" />
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">Ночёвка</p>
                    <p className="text-[14px] font-light leading-[1.7] text-[var(--text-muted)]">{day.overnightCity}</p>
                  </div>
                </div>
              </div>
            </div>
          </details>
        ))}
      </div>
    </article>
  )
}
