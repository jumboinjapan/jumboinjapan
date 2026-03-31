'use client'

import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import { formatWorkingHoursForRouteCard } from '@/lib/working-hours'

interface RouteStop {
  eyebrow: string
  title: string
  description: string
  workingHours?: string
  minPrice?: number | null
}

function getUniqueKey(stop: RouteStop, index: number) {
  return `${stop.title}-${index}`
}

export function RouteAccordion({ stops }: { stops: RouteStop[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const selectedStop = selectedIndex != null ? stops[selectedIndex] : null
  const selectedWorkingHours = formatWorkingHoursForRouteCard(selectedStop?.workingHours)
  const hasSelectedMeta = Boolean(selectedWorkingHours || (selectedStop?.minPrice != null && selectedStop.minPrice > 0))

  const closePanel = useCallback(() => {
    setSelectedIndex(null)
  }, [])

  useEffect(() => {
    if (selectedStop) {
      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'

      return () => {
        document.body.style.overflow = previousOverflow
      }
    }

    return undefined
  }, [selectedStop])

  useEffect(() => {
    if (!selectedStop) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closePanel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedStop, closePanel])

  const handlePanelClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }, [])

  return (
    <>
      <div className="grid gap-3">
        {stops.map((stop, index) => (
          <button
            key={getUniqueKey(stop, index)}
            type="button"
            onClick={() => setSelectedIndex(index)}
            className={[
              'group relative overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface)] text-left transition-all duration-200',
              'hover:-translate-y-0.5 hover:border-[var(--accent-soft)] hover:bg-[var(--bg)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-warm)]',
            ].join(' ')}
            aria-haspopup="dialog"
            aria-expanded={selectedIndex === index}
            aria-controls={selectedIndex === index ? 'route-point-panel' : undefined}
          >
            <div
              aria-hidden="true"
              className="absolute left-0 top-0 h-full w-px bg-[var(--border)] transition-colors duration-200 group-hover:bg-[var(--accent-soft)]"
            />

            <div className="flex w-full items-start gap-4 px-4 py-3.5 sm:px-5 sm:py-4">
              <div className="flex shrink-0 flex-col items-center gap-2 pt-0.5">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] text-[13px] font-medium text-[var(--text-muted)] transition-colors group-hover:border-[var(--accent-soft)] group-hover:text-[var(--accent)]">
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

                    <p className="w-full text-pretty font-sans text-[14px] leading-[1.68] text-[var(--text-muted)] line-clamp-3 sm:text-[15px]">
                      {stop.description}
                    </p>
                  </div>

                  <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                    Открыть
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div
        className={[
          'fixed inset-0 z-40 bg-[rgba(15,23,42,0.32)] backdrop-blur-[1px] transition-opacity duration-300',
          selectedStop ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
        onClick={closePanel}
        aria-hidden="true"
      />

      <div
        className={[
          'fixed inset-x-0 bottom-0 z-50 transition-transform duration-300 ease-out',
          'md:inset-x-6 md:bottom-6',
          selectedStop ? 'translate-y-0' : 'pointer-events-none translate-y-full md:translate-y-8',
        ].join(' ')}
        aria-hidden={!selectedStop}
      >
        <div
          id="route-point-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={selectedStop ? `route-point-title-${selectedIndex}` : undefined}
          onClick={handlePanelClick}
          className={[
            'mx-auto flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl border border-b-0 border-[var(--border)] bg-[var(--surface)] shadow-[0_-18px_48px_rgba(15,23,42,0.14)]',
            'md:rounded-sm md:border-b',
          ].join(' ')}
        >
          <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border)] px-5 pt-3 pb-2.5 sm:px-6 sm:pt-4 sm:pb-3">
            <div className="w-8 md:hidden" />
            <div className="h-1 w-10 rounded-full bg-[var(--border)] md:hidden" />
            <div className="hidden md:block text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Точка маршрута
            </div>
            <button
              type="button"
              onClick={closePanel}
              aria-label="Закрыть"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--bg)] hover:text-[var(--accent)]"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {selectedStop && (
            <div className="overflow-y-auto px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-5">
              <div className="relative space-y-5 rounded-sm border border-[var(--border)] bg-[var(--bg)] px-4 py-4 sm:px-5 sm:py-5">
                <div aria-hidden="true" className="absolute left-0 top-0 h-full w-px bg-[var(--accent-soft)]" />

                <div className="space-y-3">
                  <div className="flex items-center gap-3 pr-8">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--accent-soft)] bg-[var(--accent)] text-[13px] font-medium text-white">
                      {(selectedIndex ?? 0) + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">
                        {selectedStop.eyebrow}
                      </p>
                      <span className="h-px flex-1 bg-[var(--border)]" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <h2
                      id={`route-point-title-${selectedIndex}`}
                      className="text-pretty font-sans text-[24px] font-medium leading-[1.18] tracking-[-0.02em] text-[var(--text)] sm:text-[28px]"
                    >
                      {selectedStop.title}
                    </h2>
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="max-w-3xl text-pretty font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)] whitespace-pre-line">
                    {selectedStop.description}
                  </p>
                </div>

                {hasSelectedMeta && (
                  <div className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 sm:px-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectedWorkingHours && (
                        <div className="space-y-1">
                          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                            Часы посещения
                          </p>
                          <p className="text-[13px] leading-[1.6] text-[var(--text)] sm:text-[14px]">
                            {selectedWorkingHours}
                          </p>
                        </div>
                      )}

                      {selectedStop.minPrice != null && selectedStop.minPrice > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                            Билет
                          </p>
                          <p className="text-[13px] leading-[1.6] text-[var(--text)] sm:text-[14px]">
                            от ¥{selectedStop.minPrice.toLocaleString('ru-RU')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
