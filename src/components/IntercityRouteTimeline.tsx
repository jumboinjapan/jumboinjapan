'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Landmark, Leaf, TrainFront, UtensilsCrossed, GalleryVerticalEnd } from 'lucide-react'
import type { RouteStop } from '@/components/RouteAccordion'
import { RoutePointModal, type RoutePointModalCopy } from '@/components/RoutePointModal'
import type { PracticalInfoItem } from '@/components/PracticalInfoList'
import { TicketDisplayList } from '@/components/TicketDisplayList'
import { InfoCardTitleBlock, InteractiveInfoCard } from '@/components/ui/info-card'
import { formatWorkingHoursForRouteCard } from '@/lib/working-hours'
import type { SellingHighlight } from '@/lib/intercity-pois'

export type IntercityRouteStopType = 'landmark' | 'nature' | 'gastronomy' | 'transport' | 'museum' | 'cruise' | 'ropeway' | 'volcano' | 'shrine'

export interface IntercityRouteStop extends RouteStop {
  type?: IntercityRouteStopType
  photoPath?: string
  photoAlt?: string
  poiId?: string
  category?: string[]
  tags?: string[]
  sellingHighlights?: SellingHighlight[]
}

export interface IntercityRouteTimelineCopy {
  workingHoursLabel?: string
  ticketLabel?: string
  ticketPrefix?: string
  modal?: RoutePointModalCopy
}

const stopTypeMeta: Record<NonNullable<IntercityRouteStop['type']>, { label: string; icon: typeof Landmark }> = {
  landmark: {
    label: 'История',
    icon: Landmark,
  },
  shrine: {
    label: 'Святилище',
    icon: Landmark,
  },
  nature: {
    label: 'Виды',
    icon: Leaf,
  },
  gastronomy: {
    label: 'Вкус',
    icon: UtensilsCrossed,
  },
  transport: {
    label: '', // forbidden/generic
    icon: TrainFront,
  },
  museum: {
    label: 'Искусство',
    icon: GalleryVerticalEnd,
  },
  cruise: {
    label: 'Озеро',
    icon: TrainFront,
  },
  ropeway: {
    label: 'Панорамный подъём',
    icon: TrainFront,
  },
  volcano: {
    label: 'Вулканический рельеф',
    icon: Leaf,
  },
}

const CATEGORY_DISPLAY_MAP: Record<string, string | null> = {
  'Историческое место': 'История',
  'Историческая локация': 'История',
  'Синтоистское святилище': 'Религия',
  'Буддийский храм': 'Религия',
  'Ландшафтный сад / Парк': null,
  'Ландшафтный сад': 'Культура',
  'Парк': 'Природа',
  'Музей': 'Музей',
  'Смотровая площадка': 'Смотровая площадка',
  'Архитектурный объект': 'Архитектурный объект',
  'Городской район': 'Городской район',
  'Парк развлечений': 'Парк развлечений',
  'Городская достопримечательность': null,
  'Достопримечательность': null,
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

function toHashTag(label: string): string {
  return label
    .trim()
    .split(/\s+/)
    .map((word, i) =>
      i === 0
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join('')
}

export function IntercityRouteTimeline({
  stops,
  copy,
  initiallyExpandedIndexes = [0, 1],
  hidePrices = false,
}: {
  stops: IntercityRouteStop[]
  copy?: IntercityRouteTimelineCopy
  initiallyExpandedIndexes?: number[]
  hidePrices?: boolean
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [visibleKeys, setVisibleKeys] = useState<string[]>([])
  const itemRefs = useRef<Array<HTMLElement | null>>([])

  const labels = {
    workingHoursLabel: 'Часы посещения',
    ticketLabel: 'Билет',
    ticketPrefix: 'от',
    ...copy,
  }

  function shouldShowTypePill(label: string, title: string, eyebrow?: string): boolean {
    if (!label) return false

    const normalize = (text: string): string =>
      text
        .toLowerCase()
        .replace(/[^а-яёa-z0-9]/gi, '')
        .trim()

    const nLabel = normalize(label)
    const nTitle = normalize(title)
    const nEyebrow = eyebrow ? normalize(eyebrow) : ''

    // Dedupe guard: hide if pill duplicates title, eyebrow, section or is generic
    if (nTitle.includes(nLabel) || nLabel.includes(nTitle) ||
        (nEyebrow && (nEyebrow.includes(nLabel) || nLabel.includes(nEyebrow)))) {
      return false
    }

    const forbidden = ['достопримечательность', 'городскаядостопримечательность', 'локация', 'место', 'другое', 'разное', 'смотроваяплощадка']
    if (forbidden.some(f => nLabel.includes(f))) return false

    return true
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
      workingHours
        ? {
            label: labels.workingHoursLabel,
            value: workingHours,
          }
        : null,
      selectedStop.ticketDisplayLines?.length && !hidePrices
        ? {
            label: labels.ticketLabel,
            value: <TicketDisplayList lines={selectedStop.ticketDisplayLines} />,
          }
        : selectedStop.ticketSummary && !hidePrices
          ? {
              label: labels.ticketLabel,
              value: selectedStop.ticketSummary,
            }
          : selectedStop.minPrice != null && selectedStop.minPrice > 0 && !hidePrices
          ? {
              label: labels.ticketLabel,
              value: `${labels.ticketPrefix} ¥${selectedStop.minPrice.toLocaleString('ru-RU')}`,
            }
          : null,
    ].filter(Boolean) as PracticalInfoItem[]
  }, [labels.ticketLabel, labels.ticketPrefix, labels.workingHoursLabel, selectedStop, hidePrices])

  return (
    <>
      <div className="space-y-4">
        {stops.map((stop, index) => {
          const key = getUniqueKey(stop, index)
          const isVisible = visibleKeys.includes(key)
          const isSelected = selectedIndex === index
          const isExpanded = initiallyExpandedIndexes.includes(index)
          // Show full description when card is in the initial expanded set.
          // Truncate for compact text-only cards that are not in the initial expanded set.
          const showFullDescription = isExpanded
          const cardDescription = showFullDescription ? stop.description : getExcerpt(stop.description)

          // Compute muted hashtag tags — prefer explicit `tags` from hakone seed (multi-tag support for cruise/ropeway etc.);
          // fallback to mapped CATEGORY_DISPLAY_MAP + type (as before). Pill removed from title row per spec.
          let displayTags: string[] = []
          if (stop.tags?.length) {
            // explicit tags from seed take precedence (e.g. cruise = ['Транспорт', 'Озеро'])
            displayTags = stop.tags.filter((tag) =>
              tag && shouldShowTypePill(tag, stop.title, stop.eyebrow)
            )
          } else {
            const rawCategories = stop.category || []
            if ((stop.type === 'cruise' || stop.type === 'ropeway') && shouldShowTypePill('Транспорт', stop.title, stop.eyebrow)) {
              displayTags.push('Транспорт')
            }
            for (const cat of rawCategories) {
              const mapped = CATEGORY_DISPLAY_MAP[cat]
              let tagLabel: string | null = null
              if (mapped !== undefined) {
                if (mapped !== null) tagLabel = mapped
              } else {
                tagLabel = cat
              }
              if (
                tagLabel &&
                shouldShowTypePill(tagLabel, stop.title, stop.eyebrow) &&
                !displayTags.includes(tagLabel)
              ) {
                displayTags.push(tagLabel)
              }
            }
          }
          const numVisibleTags = isSelected || isExpanded ? 3 : 2
          const finalTags = displayTags.slice(0, numVisibleTags)

          // On the card itself: show "Рядом и внутри" highlights instead of hours/tickets.
          // Hours and tickets remain available in the modal (selectedMeta).
          const cardHighlights = stop.sellingHighlights ?? []

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
                  {String(index + 1).padStart(2, '0')}
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
                  'flex flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5',
                ].join(' ')}
              >
                {/* Main row: text */}
                <div className="grid gap-4">
                  <div className="min-w-0 space-y-3">
                    <p className="text-xs uppercase tracking-[0.12em] text-[var(--accent)]">
                      {stop.eyebrow}
                    </p>

                    <InfoCardTitleBlock
                      title={stop.title}
                      description={cardDescription}
                      descriptionClassName="font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]"
                    />

                    {cardHighlights.length > 0 ? (
                      <div className="border-t border-[var(--border)] pt-3">
                        <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                          Рядом и внутри
                        </p>
                        <ul className="space-y-2">
                          {cardHighlights.map((h) => (
                            <li key={h.title} className="text-[13px] leading-[1.55] text-[var(--text-muted)]">
                              <span className="font-medium text-[var(--text)]">{h.title}</span>
                              {h.body ? <span className="ml-1">— {h.body}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>


                </div>

                {/* Tags always at the bottom, full width */}
                {finalTags.length > 0 && (
                  <footer className="border-t border-[var(--border)] pt-3">
                    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] leading-5 text-[var(--text-muted)]">
                      {finalTags.map((tag) => (
                        <li key={tag}>#{toHashTag(tag)}</li>
                      ))}
                    </ul>
                  </footer>
                )}
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
            {String(selectedIndex + 1).padStart(2, '0')}
          </span>
        ) : null}
        description={selectedStop?.description}
        meta={selectedMeta}
        onClose={() => setSelectedIndex(null)}
        titleId={selectedIndex != null ? `intercity-route-point-modal-${selectedIndex}` : 'intercity-route-point-modal'}
        copy={copy?.modal}
        sellingHighlights={selectedStop?.sellingHighlights}
      />
    </>
  )
}
