'use client'

import { useCallback, useMemo, useState } from 'react'
import type { AirtablePoi } from '@/lib/airtable'
import { formatWorkingHoursForRouteCard } from '@/lib/working-hours'
import { RoutePointModal, type RoutePointModalCopy } from '@/components/RoutePointModal'

function normalizeCardDescription(text: string) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[•·]+/g, ' ')
    .replace(/[«»"']/g, '')
    .replace(/\s+,/g, ',')
    .replace(/,+/g, ',')
    .replace(/\s+[;:]/g, ',')
    .trim()
}

function getDescriptionSubtitle(descriptionRu: string) {
  const description = normalizeCardDescription(descriptionRu)
  if (!description) return null

  const sentences = description
    .split(/(?<=[.!?])\s+|\s*[\n\r]+\s*/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 32 && /[а-яё]/iu.test(part))

  if (sentences.length > 0) {
    let excerpt = ''

    for (const sentence of sentences) {
      const candidate = excerpt ? `${excerpt} ${sentence}` : sentence
      if (candidate.length > 220) break
      excerpt = candidate
      if (excerpt.length >= 110) break
    }

    if (excerpt) {
      return excerpt.replace(/[.,;:!?]+$/g, '')
    }
  }

  if (description.length <= 220) {
    return description.replace(/[.,;:!?]+$/g, '')
  }

  const shortened = description.slice(0, 220)
  const lastSpace = shortened.lastIndexOf(' ')
  return (lastSpace > 140 ? shortened.slice(0, lastSpace) : shortened).replace(/[.,;:!?]+$/g, '')
}

function getFirstNonEmptyText(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0) ?? null
}

function getPreferredPoiName(poi: AirtablePoi) {
  return getFirstNonEmptyText(poi.nameRu) ?? ''
}

function getPreferredPoiDescription(poi: AirtablePoi, descriptionOverride?: string) {
  return getFirstNonEmptyText(poi.descriptionRu, descriptionOverride)
}

function getPreferredCardDescription(poi: AirtablePoi, descriptionOverride?: string) {
  return getPreferredPoiDescription(poi, descriptionOverride)
}

function getCardEyebrow(poi: AirtablePoi) {
  return poi.category?.find((item) => item !== 'Другое' && item !== 'Разное') ?? null
}

function isMetaItem<T>(item: T | null): item is T {
  return item != null
}

export interface PoiSheetCopy {
  readMoreLabel?: string
  workingHoursLabel?: string
  ticketLabel?: string
  modal?: RoutePointModalCopy
}

export function PoiSheet({
  pois,
  descriptionOverrides = {},
  copy,
}: {
  pois: AirtablePoi[]
  descriptionOverrides?: Record<string, string>
  copy?: PoiSheetCopy
}) {
  const [selected, setSelected] = useState<AirtablePoi | null>(null)
  const labels = {
    readMoreLabel: 'Подробнее',
    workingHoursLabel: 'Часы посещения',
    ticketLabel: 'Билет',
    ...copy,
  }

  const openSelected = useCallback((poi: AirtablePoi) => {
    setSelected(poi)
  }, [])

  const selectedDescription = selected
    ? getPreferredCardDescription(selected, descriptionOverrides[selected.poiId]) ?? selected.descriptionRu ?? null
    : null
  const selectedWorkingHours = formatWorkingHoursForRouteCard(selected?.workingHours)
  const selectedEyebrow = selected ? getCardEyebrow(selected) : null

  const selectedMeta = useMemo(() => {
    if (!selected) return []

    const ticketLines = selected.tickets.filter((ticket, index, items) => (
      items.findIndex((candidate) => candidate.type === ticket.type && candidate.price === ticket.price) === index
    ))

    return [
      selectedWorkingHours
        ? {
            label: labels.workingHoursLabel,
            value: selectedWorkingHours,
          }
        : null,
      ticketLines.length > 0
        ? {
            label: labels.ticketLabel,
            value: (
              <div className="space-y-2">
                {ticketLines.map((ticket, index) => (
                  <p key={`${ticket.type}-${ticket.price}-${index}`}>
                    {ticket.type ? `${ticket.type}: ` : ''}¥{ticket.price.toLocaleString()}
                  </p>
                ))}
              </div>
            ),
          }
        : null,
    ].filter(isMetaItem)
  }, [labels.ticketLabel, labels.workingHoursLabel, selected, selectedWorkingHours])

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:auto-rows-fr sm:grid-cols-2 sm:gap-4">
        {pois.map((p) => {
          const subtitleSource = getPreferredCardDescription(p, descriptionOverrides[p.poiId])
          const subtitle = subtitleSource ? getDescriptionSubtitle(subtitleSource) : null
          const eyebrow = getCardEyebrow(p)
          const isSelected = selected?.poiId === p.poiId

          return (
            <button
              key={p.poiId}
              type="button"
              onClick={() => openSelected(p)}
              className={[
                'group relative flex h-full min-h-[148px] cursor-pointer flex-col items-start overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left transition-all duration-200 sm:min-h-[172px] sm:px-5 sm:py-4',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-warm)]',
                'active:scale-[0.99] hover:-translate-y-0.5 hover:bg-[var(--bg)] hover:border-[var(--accent-soft)]',
                isSelected ? 'border-[var(--accent-soft)] bg-[var(--bg)]' : '',
              ].join(' ')}
              aria-haspopup="dialog"
              aria-expanded={isSelected}
              aria-controls={isSelected ? `poi-sheet-modal-${p.poiId}` : undefined}
            >
              <div
                aria-hidden="true"
                className="absolute left-0 top-0 h-full w-px bg-[var(--border)] transition-colors duration-200 group-hover:bg-[var(--accent-soft)]"
              />

              <div className="relative flex w-full flex-1 flex-col gap-3">
                <div className="w-full space-y-2">
                  {eyebrow && (
                    <div className="flex items-center gap-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">
                        {eyebrow}
                      </p>
                      <span className="h-px flex-1 bg-[var(--border)]" />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <p className="max-w-full text-pretty font-sans text-[17px] font-medium leading-[1.22] tracking-[-0.015em] text-[var(--text)] sm:text-[19px]">
                      {getPreferredPoiName(p)}
                    </p>

                    {subtitle && (
                      <p className="max-w-full text-pretty font-sans text-[14px] leading-[1.5] text-[var(--text-muted)] line-clamp-3">
                        {subtitle}
                      </p>
                    )}
                  </div>
                </div>

              </div>
            </button>
          )
        })}
      </div>

      <RoutePointModal
        isOpen={selected != null}
        title={selected ? getPreferredPoiName(selected) : ''}
        eyebrow={selectedEyebrow}
        description={selectedDescription}
        meta={selectedMeta}
        onClose={() => setSelected(null)}
        titleId={selected ? `poi-sheet-modal-${selected.poiId}` : 'poi-sheet-modal'}
        copy={copy?.modal}
      />
    </>
  )
}
