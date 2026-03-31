'use client'

import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { formatWorkingHoursForRouteCard } from '@/lib/working-hours'
import { RoutePointModal } from '@/components/RoutePointModal'

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
  const selectedMeta = useMemo(() => {
    if (!selectedStop) return []

    const workingHours = formatWorkingHoursForRouteCard(selectedStop.workingHours)

    return [
      workingHours
        ? {
            label: 'Часы посещения',
            value: workingHours,
          }
        : null,
      selectedStop.minPrice != null && selectedStop.minPrice > 0
        ? {
            label: 'Билет',
            value: `от ¥${selectedStop.minPrice.toLocaleString('ru-RU')}`,
          }
        : null,
    ].filter(Boolean) as { label: string; value: string }[]
  }, [selectedStop])

  return (
    <>
      <div className="grid gap-3">
        {stops.map((stop, index) => {
          const isSelected = selectedIndex === index

          return (
            <button
              key={getUniqueKey(stop, index)}
              type="button"
              onClick={() => setSelectedIndex((current) => (current === index ? null : index))}
              className={[
                'group relative overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface)] text-left transition-all duration-200',
                'hover:-translate-y-0.5 hover:border-[var(--accent-soft)] hover:bg-[var(--bg)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-warm)]',
                isSelected ? 'border-[var(--accent-soft)] bg-[var(--bg)]' : '',
              ].join(' ')}
              aria-haspopup="dialog"
              aria-expanded={isSelected}
              aria-controls={isSelected ? `route-point-modal-${index}` : undefined}
            >
              <div
                aria-hidden="true"
                className="absolute left-0 top-0 h-full w-px bg-[var(--border)] transition-colors duration-200 group-hover:bg-[var(--accent-soft)]"
              />

              <div className="flex w-full items-start gap-4 px-4 py-3.5 sm:px-5 sm:py-4">
                <div className="flex shrink-0 flex-col items-center gap-2 pt-0.5">
                  <span className={[
                    'inline-flex h-10 w-10 items-center justify-center rounded-full border text-[13px] font-medium transition-colors',
                    isSelected
                      ? 'border-[var(--accent-soft)] bg-[var(--accent)] text-white'
                      : 'border-[var(--border)] text-[var(--text-muted)] group-hover:border-[var(--accent-soft)] group-hover:text-[var(--accent)]',
                  ].join(' ')}>
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

                    <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-[16px] font-medium leading-none text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]" aria-hidden="true">
                      …
                      <ChevronRight aria-hidden="true" className={['h-4 w-4 transition-transform', isSelected ? 'rotate-90' : ''].join(' ')} />
                    </span>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <RoutePointModal
        isOpen={selectedStop != null}
        title={selectedStop?.title ?? ''}
        eyebrow={selectedStop?.eyebrow}
        kicker={selectedIndex != null ? (
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--accent-soft)] bg-[var(--accent)] text-[13px] font-medium text-white">
            {selectedIndex + 1}
          </span>
        ) : null}
        description={selectedStop?.description}
        meta={selectedMeta}
        onClose={() => setSelectedIndex(null)}
        titleId={selectedIndex != null ? `route-point-modal-${selectedIndex}` : 'route-point-modal'}
      />
    </>
  )
}
