'use client'

import { useCallback, useMemo, useState } from 'react'
import type { AirtablePoi } from '@/lib/airtable'
import { formatWorkingHoursForRouteCard } from '@/lib/working-hours'
import { RoutePointModal, type RoutePointModalCopy } from '@/components/RoutePointModal'
import { InfoCardHeader, InfoCardTitleBlock, InteractiveInfoCard } from '@/components/ui/info-card'

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
            <InteractiveInfoCard
              key={p.poiId}
              onClick={() => openSelected(p)}
              selected={isSelected}
              expanded={isSelected}
              controls={isSelected ? `poi-sheet-modal-${p.poiId}` : undefined}
              className="flex h-full min-h-[148px] cursor-pointer flex-col items-start sm:min-h-[172px]"
              contentClassName="relative flex w-full flex-1 flex-col gap-3 px-4 py-3 sm:px-5 sm:py-4"
            >
              <div className="w-full space-y-2">
                <InfoCardHeader eyebrow={eyebrow} />
                <InfoCardTitleBlock
                  title={getPreferredPoiName(p)}
                  description={subtitle}
                  descriptionClassName="line-clamp-3"
                />
              </div>
            </InteractiveInfoCard>
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
