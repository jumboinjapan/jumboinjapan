'use client'

import { useMemo, useState } from 'react'
import { formatWorkingHoursForRouteCard } from '@/lib/working-hours'
import { RoutePointModal, type RoutePointModalCopy } from '@/components/RoutePointModal'
import { PracticalInfoList, type PracticalInfoItem } from '@/components/PracticalInfoList'

export interface RouteStop {
  eyebrow: string
  title: string
  description: string
  workingHours?: string
  minPrice?: number | null
}

export interface RouteAccordionCopy {
  workingHoursLabel?: string
  ticketLabel?: string
  ticketPrefix?: string
  modal?: RoutePointModalCopy
}

function getUniqueKey(stop: RouteStop, index: number) {
  return `${stop.title}-${index}`
}

export function RouteAccordion({ stops, copy }: { stops: RouteStop[]; copy?: RouteAccordionCopy }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const labels = {
    workingHoursLabel: 'Часы посещения',
    ticketLabel: 'Билет',
    ticketPrefix: 'от',
    ...copy,
  }

  const selectedStop = selectedIndex != null ? stops[selectedIndex] : null
  const selectedMeta = useMemo(() => {
    if (!selectedStop) return []

    const workingHours = formatWorkingHoursForRouteCard(selectedStop.workingHours)

    return [
      workingHours
        ? {
            label: labels.workingHoursLabel,
            value: workingHours,
          }
        : null,
      selectedStop.minPrice != null && selectedStop.minPrice > 0
        ? {
            label: labels.ticketLabel,
            value: `${labels.ticketPrefix} ¥${selectedStop.minPrice.toLocaleString('ru-RU')}`,
          }
        : null,
    ].filter(Boolean) as PracticalInfoItem[]
  }, [labels.ticketLabel, labels.ticketPrefix, labels.workingHoursLabel, selectedStop])

  return (
    <>
      <div className="grid gap-3">
        {stops.map((stop, index) => {
          const isSelected = selectedIndex === index
          const workingHours = formatWorkingHoursForRouteCard(stop.workingHours)
          const inlineMeta = [
            workingHours
              ? {
                  label: labels.workingHoursLabel,
                  value: workingHours,
                }
              : null,
            stop.minPrice != null && stop.minPrice > 0
              ? {
                  label: labels.ticketLabel,
                  value: `${labels.ticketPrefix} ¥${stop.minPrice.toLocaleString('ru-RU')}`,
                }
              : null,
          ].filter(Boolean) as PracticalInfoItem[]

          return (
            <button
              key={getUniqueKey(stop, index)}
              type="button"
              onClick={() => setSelectedIndex(index)}
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

              <div className="flex w-full items-start gap-4 px-4 py-2.5 sm:px-5 sm:py-3">
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

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">
                      {stop.eyebrow}
                    </span>
                    <span className="h-px flex-1 bg-[var(--border)]" />
                  </div>

                  <div className="min-w-0 space-y-1.5">
                    <h3 className="text-pretty font-sans text-[17px] font-medium leading-[1.24] tracking-[-0.015em] text-[var(--text)] sm:text-[19px]">
                      {stop.title}
                    </h3>

                    <p className="w-full text-pretty font-sans text-[14px] leading-[1.68] text-[var(--text-muted)] sm:text-[15px]">
                      {stop.description}
                    </p>

                    {inlineMeta.length > 0 && <PracticalInfoList items={inlineMeta} />}
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
        copy={copy?.modal}
      />
    </>
  )
}
