'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { formatWorkingHoursForRouteCard } from '@/lib/working-hours'

interface RouteStop {
  eyebrow: string
  title: string
  description: string
  workingHours?: string
  minPrice?: number | null
}

export function RouteAccordion({ stops }: { stops: RouteStop[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <div className="grid gap-3">
      {stops.map((stop, index) => {
        const isOpen = openIndex === index
        const formattedWorkingHours = formatWorkingHoursForRouteCard(stop.workingHours)
        const hasMeta = formattedWorkingHours || (stop.minPrice != null && stop.minPrice > 0)

        return (
          <div
            key={stop.title}
            className={[
              'group relative overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface)] transition-all duration-200',
              'hover:-translate-y-0.5 hover:border-[var(--accent-soft)] hover:bg-[var(--bg)]',
              isOpen ? 'border-[var(--accent-soft)] bg-[var(--bg)] shadow-[0_14px_32px_rgba(15,23,42,0.055)]' : '',
            ].join(' ')}
          >
            <div
              aria-hidden="true"
              className="absolute left-0 top-0 h-full w-px bg-[var(--border)] transition-colors duration-200 group-hover:bg-[var(--accent-soft)]"
            />

            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : index)}
              className="flex w-full items-start gap-4 px-4 py-3.5 text-left sm:px-5 sm:py-4"
              aria-expanded={isOpen}
            >
              <div className="flex shrink-0 flex-col items-center gap-2 pt-0.5">
                <span
                  className={[
                    'inline-flex h-10 w-10 items-center justify-center rounded-full border text-[13px] font-medium transition-colors',
                    isOpen
                      ? 'border-[var(--accent-soft)] bg-[var(--accent)] text-white'
                      : 'border-[var(--border)] text-[var(--text-muted)] group-hover:border-[var(--accent-soft)] group-hover:text-[var(--accent)]',
                  ].join(' ')}
                >
                  {index + 1}
                </span>
                {index < stops.length - 1 && (
                  <span aria-hidden="true" className="hidden min-h-8 w-px flex-1 bg-[var(--border)] sm:block" />
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">
                    {stop.eyebrow}
                  </span>
                  <span className="h-px flex-1 bg-[var(--border)]" />
                </div>

                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <h3 className="text-pretty font-sans text-[17px] font-medium leading-[1.24] tracking-[-0.015em] text-[var(--text)] sm:text-[19px]">
                      {stop.title}
                    </h3>

                    <p className="w-full text-pretty font-sans text-[14px] leading-[1.68] text-[var(--text-muted)] sm:text-[15px]">
                      {stop.description}
                    </p>
                  </div>

                  <ChevronDown
                    aria-hidden="true"
                    className={[
                      'mt-1 h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200',
                      isOpen ? 'rotate-180 text-[var(--accent)]' : '',
                    ].join(' ')}
                  />
                </div>
              </div>
            </button>

            <div className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-[36rem]' : 'max-h-0'}`}>
              <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                <div className="ml-14 space-y-4 border-t border-[var(--border)] pt-4 sm:ml-[3.5rem] sm:pt-[18px]">
                  {hasMeta && (
                    <div className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 sm:px-4">
                      <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-3">
                        {formattedWorkingHours && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                              Часы посещения
                            </p>
                            <p className="text-[13px] leading-[1.55] text-[var(--text)] sm:text-[14px]">
                              {formattedWorkingHours}
                            </p>
                          </div>
                        )}
                        {stop.minPrice != null && stop.minPrice > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                              Билет
                            </p>
                            <p className="text-[13px] leading-[1.55] text-[var(--text)] sm:text-[14px]">
                              от ¥{stop.minPrice.toLocaleString('ru-RU')}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
