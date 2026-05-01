'use client'

import { useMemo, useState } from 'react'
import { formatWorkingHoursForRouteCard } from '@/lib/working-hours'
import { RoutePointModal, type RoutePointModalCopy } from '@/components/RoutePointModal'
import type { PracticalInfoItem } from '@/components/PracticalInfoList'
import { InfoCardHeader, InfoCardTitleBlock, InteractiveInfoCard } from '@/components/ui/info-card'

export interface RouteStop {
  eyebrow: string
  title: string
  description: string
  workingHours?: string
  minPrice?: number | null
  ticketSummary?: string | null
  ticketDetails?: string[]
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
      selectedStop.ticketSummary
        ? {
            label: labels.ticketLabel,
            value: selectedStop.ticketSummary,
          }
        : selectedStop.minPrice != null && selectedStop.minPrice > 0
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
          return (
            <InteractiveInfoCard
              key={getUniqueKey(stop, index)}
              onClick={() => setSelectedIndex(index)}
              selected={isSelected}
              expanded={isSelected}
              controls={isSelected ? `route-point-modal-${index}` : undefined}
              contentClassName="flex w-full items-start gap-4 px-4 py-2.5 sm:px-5 sm:py-3"
            >
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
                <InfoCardHeader eyebrow={stop.eyebrow} />
                <InfoCardTitleBlock title={stop.title} description={stop.description} />
              </div>
            </InteractiveInfoCard>
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
