'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Landmark,
  Leaf,
  TrainFront,
  UtensilsCrossed,
  GalleryVerticalEnd,
  MapPin,
  Clock3,
  Ticket,
} from 'lucide-react'
import type { RouteStop } from '@/components/RouteAccordion'
import { RoutePointModal, type RoutePointModalCopy } from '@/components/RoutePointModal'
import type { PracticalInfoItem } from '@/components/PracticalInfoList'
import { formatWorkingHoursForRouteCard } from '@/lib/working-hours'

export type IntercityRouteStopType = 'landmark' | 'nature' | 'gastronomy' | 'transport' | 'museum'

export interface IntercityRouteStop extends RouteStop {
  type?: IntercityRouteStopType
  arrivalTime?: string
  photo?: string
  photoAlt?: string
}

export interface IntercityRouteTimelineCopy {
  workingHoursLabel?: string
  ticketLabel?: string
  ticketPrefix?: string
  arrivalLabel?: string
  modal?: RoutePointModalCopy
}

const stopTypeStyles: Record<NonNullable<IntercityRouteStop['type']>, {
  label: string
  icon: typeof MapPin
  chipClassName: string
  nodeClassName: string
}> = {
  landmark: {
    label: 'История',
    icon: Landmark,
    chipClassName: 'border-[color:rgba(166,124,82,0.24)] bg-[color:rgba(166,124,82,0.1)] text-[color:#7d5a35]',
    nodeClassName: 'border-[color:rgba(166,124,82,0.34)] bg-[color:rgba(166,124,82,0.15)] text-[color:#7d5a35]',
  },
  nature: {
    label: 'Природа',
    icon: Leaf,
    chipClassName: 'border-[color:rgba(92,122,82,0.24)] bg-[color:rgba(92,122,82,0.11)] text-[color:#516c45]',
    nodeClassName: 'border-[color:rgba(92,122,82,0.34)] bg-[color:rgba(92,122,82,0.15)] text-[color:#516c45]',
  },
  gastronomy: {
    label: 'Вкус',
    icon: UtensilsCrossed,
    chipClassName: 'border-[color:rgba(181,52,26,0.2)] bg-[color:rgba(181,52,26,0.08)] text-[var(--accent)]',
    nodeClassName: 'border-[color:rgba(181,52,26,0.3)] bg-[color:rgba(181,52,26,0.12)] text-[var(--accent)]',
  },
  transport: {
    label: 'Переезд',
    icon: TrainFront,
    chipClassName: 'border-[color:rgba(107,91,78,0.2)] bg-[color:rgba(107,91,78,0.08)] text-[var(--text-muted)]',
    nodeClassName: 'border-[color:rgba(107,91,78,0.28)] bg-[color:rgba(107,91,78,0.12)] text-[var(--text-muted)]',
  },
  museum: {
    label: 'Музей',
    icon: GalleryVerticalEnd,
    chipClassName: 'border-[color:rgba(107,74,130,0.2)] bg-[color:rgba(107,74,130,0.08)] text-[color:#6b4a82]',
    nodeClassName: 'border-[color:rgba(107,74,130,0.3)] bg-[color:rgba(107,74,130,0.12)] text-[color:#6b4a82]',
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
      <div className="relative overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-6 sm:px-5 md:px-8 md:py-8 lg:px-10 lg:py-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-[1.45rem] hidden w-px bg-[linear-gradient(180deg,rgba(166,124,82,0),rgba(166,124,82,0.55)_10%,rgba(166,124,82,0.24)_52%,rgba(166,124,82,0))] md:block"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-[calc(1.45rem-1px)] top-0 hidden w-[3px] bg-[repeating-linear-gradient(180deg,rgba(181,52,26,0.15)_0,rgba(181,52,26,0.15)_1px,transparent_1px,transparent_12px)] opacity-50 md:block"
        />

        <div className="space-y-5 md:space-y-6">
          {stops.map((stop, index) => {
            const key = getUniqueKey(stop, index)
            const isVisible = visibleKeys.includes(key)
            const typeStyle = stop.type ? stopTypeStyles[stop.type] : stopTypeStyles.landmark
            const TypeIcon = typeStyle.icon
            const hasMeta = Boolean(stop.arrivalTime || stop.minPrice || stop.workingHours)

            return (
              <article
                key={key}
                data-route-key={key}
                ref={(element) => {
                  itemRefs.current[index] = element
                }}
                className={[
                  'group relative grid gap-4 transition duration-700 ease-out md:grid-cols-[72px_minmax(0,1fr)] md:gap-6',
                  isVisible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
                ].join(' ')}
              >
                <div className="relative flex items-start gap-3 md:block md:pt-1">
                  <div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--accent-soft)] bg-[var(--bg)] text-[13px] font-medium text-[var(--text)] shadow-[inset_0_0_0_4px_rgba(181,52,26,0.04)] md:mx-auto md:h-14 md:w-14">
                    {String(index + 1).padStart(2, '0')}
                  </div>
                  <span className={["mt-3 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[var(--text-muted)] md:absolute md:left-1/2 md:top-16 md:-translate-x-1/2", typeStyle.nodeClassName].join(' ')}>
                    <TypeIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  className="grid gap-4 text-left md:grid-cols-[minmax(0,1.25fr)_minmax(220px,0.82fr)] md:items-stretch md:gap-5"
                >
                  <div className="relative overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--bg)] px-5 py-5 transition-colors duration-300 group-hover:border-[var(--accent-soft)] group-hover:bg-[var(--surface)] sm:px-6 md:px-7 md:py-6">
                    <div aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-[linear-gradient(180deg,transparent,rgba(181,52,26,0.5),transparent)]" />

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                        {stop.eyebrow}
                      </span>
                      <span className={["inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em]", typeStyle.chipClassName].join(' ')}>
                        <TypeIcon className="h-3 w-3" aria-hidden="true" />
                        {typeStyle.label}
                      </span>
                    </div>

                    <div className="mt-3 space-y-3">
                      <div className="space-y-2">
                        <h3 className="text-pretty font-sans text-[24px] font-medium leading-[1.12] tracking-[-0.03em] text-[var(--text)] md:text-[28px]">
                          {stop.title}
                        </h3>
                        <p className="max-w-2xl text-pretty font-sans text-[15px] font-light leading-[1.9] text-[var(--text-muted)] md:text-[16px]">
                          {getExcerpt(stop.description)}
                        </p>
                      </div>

                      {hasMeta && (
                        <dl className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--border)] pt-3 text-[12px] text-[var(--text-muted)]">
                          {stop.arrivalTime && (
                            <div className="flex items-center gap-2">
                              <Clock3 className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden="true" />
                              <dt className="sr-only">{labels.arrivalLabel}</dt>
                              <dd>{stop.arrivalTime}</dd>
                            </div>
                          )}
                          {stop.minPrice != null && stop.minPrice > 0 && (
                            <div className="flex items-center gap-2">
                              <Ticket className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden="true" />
                              <dt className="sr-only">{labels.ticketLabel}</dt>
                              <dd>{labels.ticketPrefix} ¥{stop.minPrice.toLocaleString('ru-RU')}</dd>
                            </div>
                          )}
                          {stop.workingHours && (
                            <div className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                              {formatWorkingHoursForRouteCard(stop.workingHours)}
                            </div>
                          )}
                        </dl>
                      )}
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--bg-warm)] min-h-[240px]">
                    {stop.photo ? (
                      <>
                        <Image
                          src={stop.photo}
                          alt={stop.photoAlt ?? stop.title}
                          fill
                          sizes="(min-width: 768px) 28vw, 100vw"
                          className="object-cover transition duration-700 group-hover:scale-[1.03]"
                        />
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(28,18,9,0.02),rgba(28,18,9,0.28))]" />
                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 p-4 text-white md:p-5">
                          <p className="max-w-[15rem] text-[11px] font-medium uppercase tracking-[0.14em] text-white/88">
                            Следующая сцена маршрута
                          </p>
                          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/35 bg-white/10 backdrop-blur-sm">
                            <MapPin className="h-4 w-4" aria-hidden="true" />
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex h-full min-h-[240px] flex-col justify-between bg-[linear-gradient(180deg,rgba(181,52,26,0.03),rgba(166,124,82,0.12))] p-5 md:p-6">
                        <span className="h-px w-16 bg-[var(--accent-soft)]" />
                        <div className="space-y-2">
                          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Маршрутный акцент</p>
                          <p className="max-w-[16rem] text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                            Открывается в модальном окне с полным описанием и практическими деталями.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </button>
              </article>
            )
          })}
        </div>
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
        titleId={selectedIndex != null ? `intercity-route-point-modal-${selectedIndex}` : 'intercity-route-point-modal'}
        copy={copy?.modal}
      />
    </>
  )
}
