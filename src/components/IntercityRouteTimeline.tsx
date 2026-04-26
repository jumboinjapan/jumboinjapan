'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Landmark, Leaf, TrainFront, UtensilsCrossed, GalleryVerticalEnd } from 'lucide-react'
import type { RouteStop } from '@/components/RouteAccordion'
import { RoutePointModal, type RoutePointModalCopy } from '@/components/RoutePointModal'
import type { PracticalInfoItem } from '@/components/PracticalInfoList'
import { InfoCardTitleBlock, InteractiveInfoCard } from '@/components/ui/info-card'
import { formatWorkingHoursForRouteCard } from '@/lib/working-hours'

export type IntercityRouteStopType = 'landmark' | 'nature' | 'gastronomy' | 'transport' | 'museum'

export interface IntercityRouteStop extends RouteStop {
  type?: IntercityRouteStopType
  arrivalTime?: string
  photoPath?: string
  photoAlt?: string
}

export interface IntercityRouteTimelineCopy {
  workingHoursLabel?: string
  ticketLabel?: string
  ticketPrefix?: string
  arrivalLabel?: string
  modal?: RoutePointModalCopy
}

const stopTypeMeta: Record<NonNullable<IntercityRouteStop['type']>, { label: string; icon: typeof Landmark }> = {
  landmark: {
    label: 'История',
    icon: Landmark,
  },
  nature: {
    label: 'Природа',
    icon: Leaf,
  },
  gastronomy: {
    label: 'Вкус',
    icon: UtensilsCrossed,
  },
  transport: {
    label: 'Переезд',
    icon: TrainFront,
  },
  museum: {
    label: 'Музей',
    icon: GalleryVerticalEnd,
  },
}

function getUniqueKey(stop: IntercityRouteStop, index: number) {
  return `${stop.title}-${index}`
}

function getExcerpt(description: string) {
  const trimmed = description.trim()
  if (trimmed.length <= 190) return trimmed

  const sliced = trimmed.slice(0, 187)
  const safeBreak = sliced.lastIndexOf(' ')
  return `${sliced.slice(0, safeBreak > 80 ? safeBreak : sliced.length)}…`
}

export function IntercityRouteTimeline({
  stops,
  copy,
}: {
  stops: IntercityRouteStop[]
  copy?: IntercityRouteTimelineCopy
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [visibleKeys, setVisibleKeys] = useState<string[]>([])
  const itemRefs = useRef<Array<HTMLElement | null>>([])

  const labels = {
    workingHoursLabel: 'Часы посещения',
    ticketLabel: 'Билет',
    ticketPrefix: 'от',
    arrivalLabel: 'Ориентир по времени',
    ...copy,
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (mediaQuery.matches) {
      setVisibleKeys(stops.map((stop, index) => getUniqueKey(stop, index)))
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleKeys((current) => {
          const next = new Set(current)
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const key = entry.target.getAttribute('data-route-key')
              if (key) next.add(key)
            }
          }
          return [...next]
        })
      },
      { threshold: 0.24, rootMargin: '0px 0px -12% 0px' },
    )

    for (const element of itemRefs.current) {
      if (element) observer.observe(element)
    }

    return () => observer.disconnect()
  }, [stops])

  const selectedStop = selectedIndex != null ? stops[selectedIndex] : null
  const selectedMeta = useMemo(() => {
    if (!selectedStop) return []

    const workingHours = formatWorkingHoursForRouteCard(selectedStop.workingHours)

    return [
      selectedStop.arrivalTime
        ? {
            label: labels.arrivalLabel,
            value: selectedStop.arrivalTime,
          }
        : null,
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
  }, [labels.arrivalLabel, labels.ticketLabel, labels.ticketPrefix, labels.workingHoursLabel, selectedStop])

  return (
    <>
      <div className="space-y-4">
        {stops.map((stop, index) => {
          const key = getUniqueKey(stop, index)
          const isVisible = visibleKeys.includes(key)
          const isSelected = selectedIndex === index
          const typeMeta = stop.type ? stopTypeMeta[stop.type] : null
          const TypeIcon = typeMeta?.icon
          const metaItems = [
            stop.arrivalTime
              ? { label: labels.arrivalLabel, value: stop.arrivalTime }
              : null,
            stop.workingHours
              ? {
                  label: labels.workingHoursLabel,
                  value: formatWorkingHoursForRouteCard(stop.workingHours),
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
            <article
              key={key}
              data-route-key={key}
              ref={(element) => {
                itemRefs.current[index] = element
              }}
              className={[
                'grid gap-3 transition-all duration-700 ease-out md:grid-cols-[40px_minmax(0,1fr)] md:gap-4',
                isVisible ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0',
              ].join(' ')}
            >
              <div className="relative flex flex-col items-center pt-1">
                <span
                  className={[
                    'relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border bg-[var(--bg)] text-[13px] font-medium transition-colors',
                    isSelected
                      ? 'border-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--text-muted)]',
                  ].join(' ')}
                >
                  {index + 1}
                </span>
                {index < stops.length - 1 ? (
                  <span aria-hidden="true" className="mt-2 min-h-10 w-px flex-1 bg-[var(--border)]" />
                ) : null}
              </div>

              <InteractiveInfoCard
                onClick={() => setSelectedIndex(index)}
                selected={isSelected}
                expanded={isSelected}
                controls={isSelected ? `intercity-route-point-modal-${index}` : undefined}
                muted={index % 2 === 0}
                rail="default"
                className={[
                  'transition-all duration-700 ease-out',
                  isVisible ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0',
                ].join(' ')}
                contentClassName={[
                  'grid gap-4 px-4 py-4 sm:px-5 sm:py-5',
                  stop.photoPath ? 'lg:grid-cols-[minmax(0,1fr)_220px]' : '',
                ].join(' ')}
              >
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs uppercase tracking-[0.12em] text-[var(--accent)]">
                      {stop.eyebrow}
                    </p>
                    {typeMeta && TypeIcon ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        <TypeIcon className="h-3 w-3 text-[var(--accent)]" aria-hidden="true" />
                        {typeMeta.label}
                      </span>
                    ) : null}
                  </div>

                  <InfoCardTitleBlock
                    title={stop.title}
                    description={getExcerpt(stop.description)}
                    descriptionClassName="font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]"
                  />

                  {metaItems.length > 0 ? (
                    <dl className="flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3">
                      {metaItems.map((item) => (
                        <div key={item.label} className="space-y-1">
                          <dt className="text-xs uppercase tracking-[0.12em] text-[var(--accent)]">
                            {item.label}
                          </dt>
                          <dd className="font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
                            {item.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>

                {stop.photoPath ? (
                  <div className="relative min-h-[220px] overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--bg)]">
                    <Image
                      src={stop.photoPath}
                      alt={stop.photoAlt ?? stop.title}
                      fill
                      sizes="(min-width: 1024px) 220px, 100vw"
                      className="object-cover"
                    />
                  </div>
                ) : null}
              </InteractiveInfoCard>
            </article>
          )
        })}
      </div>

      <RoutePointModal
        isOpen={selectedStop != null}
        title={selectedStop?.title ?? ''}
        eyebrow={selectedStop?.eyebrow}
        kicker={selectedIndex != null ? (
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--accent-soft)] bg-[var(--bg)] text-[13px] font-medium text-[var(--accent)]">
            {selectedIndex + 1}
          </span>
        ) : null}
        description={selectedStop?.description}
        meta={selectedMeta}
        onClose={() => setSelectedIndex(null)}
        titleId={selectedIndex != null ? `intercity-route-point-modal-${selectedIndex}` : 'intercity-route-point-modal'}
        copy={copy?.modal}
      />
    </>
  )
}
