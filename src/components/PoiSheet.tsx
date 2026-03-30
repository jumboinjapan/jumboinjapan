'use client'

import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import type { AirtablePoi } from '@/lib/airtable'
import { formatWorkingHoursForRouteCard } from '@/lib/working-hours'

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

function isMeaningfulCardDescription(text: string | null | undefined, categories: string[] = []) {
  const description = normalizeCardDescription(text ?? '')
  if (!description || description.length < 36) return false

  const normalizedCategories = categories
    .map((item) => normalizeCardDescription(item).toLocaleLowerCase('ru-RU'))
    .filter(Boolean)

  const descriptionLower = description.toLocaleLowerCase('ru-RU')

  if (normalizedCategories.includes(descriptionLower)) return false
  if (normalizedCategories.some((category) => category && (descriptionLower === `${category},` || descriptionLower === `${category}.`))) return false

  return /[а-яёa-z]/iu.test(description) && description.split(' ').length >= 5
}

function getPreferredCardDescription(poi: AirtablePoi, descriptionOverride?: string) {
  const candidates = [poi.descriptionRu, descriptionOverride, poi.descriptionEn]
  return candidates.find((candidate) => isMeaningfulCardDescription(candidate, poi.category)) ?? null
}

function getCardEyebrow(poi: AirtablePoi) {
  return poi.category?.find((item) => item !== 'Другое' && item !== 'Разное') ?? null
}

export function PoiSheet({ pois, descriptionOverrides = {} }: { pois: AirtablePoi[]; descriptionOverrides?: Record<string, string> }) {
  const [selected, setSelected] = useState<AirtablePoi | null>(null)

  useEffect(() => {
    if (selected) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [selected])

  const close = useCallback(() => setSelected(null), [])

  const handleCloseClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    close()
  }, [close])

  const handleDialogClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [close])

  const selectedWorkingHours = formatWorkingHoursForRouteCard(selected?.workingHours)
  const selectedEyebrow = selected ? getCardEyebrow(selected) : null

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:auto-rows-fr sm:grid-cols-2 sm:gap-4">
        {pois.map((p) => {
          const subtitleSource = getPreferredCardDescription(p, descriptionOverrides[p.poiId])
          const subtitle = subtitleSource ? getDescriptionSubtitle(subtitleSource) : null
          const eyebrow = getCardEyebrow(p)

          return (
            <button
              key={p.poiId}
              type="button"
              onClick={() => setSelected(p)}
              className={[
                'group relative flex h-full min-h-[184px] cursor-pointer flex-col items-start overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-left transition-all duration-200 sm:min-h-[216px] sm:px-5 sm:py-5',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-warm)]',
                'active:scale-[0.99] hover:-translate-y-0.5 hover:bg-[var(--bg)] hover:border-[var(--accent-soft)]',
              ].join(' ')}
            >
              <div
                aria-hidden="true"
                className="absolute left-0 top-0 h-full w-px bg-[var(--border)] transition-colors duration-200 group-hover:bg-[var(--accent-soft)]"
              />

              <div className="relative flex w-full flex-1 flex-col gap-5">
                <div className="w-full space-y-3">
                  {eyebrow && (
                    <div className="flex items-center gap-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">
                        {eyebrow}
                      </p>
                      <span className="h-px flex-1 bg-[var(--border)]" />
                    </div>
                  )}

                  <div className="space-y-2.5">
                    <p className="max-w-full text-pretty font-sans text-[17px] font-medium leading-[1.22] tracking-[-0.015em] text-[var(--text)] sm:text-[19px]">
                      {p.nameRu}
                    </p>

                    {subtitle && (
                      <p className="max-w-full text-pretty font-sans text-[14px] leading-[1.58] text-[var(--text-muted)] line-clamp-3 sm:line-clamp-4">
                        {subtitle}
                      </p>
                    )}
                  </div>
                </div>

                <div className="relative mt-auto flex w-full items-center justify-end pt-2 text-[12px] leading-none text-[var(--text-muted)]">
                  <span className="inline-flex min-h-11 items-center font-medium uppercase tracking-[0.08em] transition-colors group-hover:text-[var(--accent)]">
                    Подробнее
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div
        className={`fixed inset-0 z-40 bg-[rgba(15,23,42,0.32)] backdrop-blur-[1px] transition-opacity duration-300 ${selected ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={close}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="poi-sheet-title"
        className={[
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[86vh] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-[var(--border)] bg-[var(--surface)] shadow-[0_-18px_48px_rgba(15,23,42,0.14)] transition-transform duration-300 ease-out',
          'md:left-1/2 md:right-auto md:bottom-6 md:max-h-[min(78vh,720px)] md:w-[min(680px,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-sm md:border-b',
          selected ? 'pointer-events-auto translate-y-0' : 'pointer-events-none translate-y-full md:translate-y-8 md:-translate-x-1/2',
        ].join(' ')}
        onClick={handleDialogClick}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border)] px-5 pt-3 pb-2.5 sm:px-6 sm:pt-4 sm:pb-3">
          <div className="w-8 md:hidden" />
          <div className="h-1 w-10 rounded-full bg-[var(--border)] md:hidden" />
          <div className="hidden md:block text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Точка маршрута
          </div>
          <button
            type="button"
            onClick={handleCloseClick}
            aria-label="Закрыть"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--bg)] hover:text-[var(--accent)]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        {selected && (
          <div className="overflow-y-auto px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-5">
            <div className="relative space-y-5 rounded-sm border border-[var(--border)] bg-[var(--bg)] px-4 py-4 sm:px-5 sm:py-5">
              <div aria-hidden="true" className="absolute left-0 top-0 h-full w-px bg-[var(--accent-soft)]" />

              <div className="space-y-3">
                {selectedEyebrow && (
                  <div className="flex items-center gap-3 pr-8">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">
                      {selectedEyebrow}
                    </p>
                    <span className="h-px flex-1 bg-[var(--border)]" />
                  </div>
                )}

                <div className="space-y-1.5">
                  <h2 id="poi-sheet-title" className="text-pretty font-sans text-[24px] font-medium leading-[1.18] tracking-[-0.02em] text-[var(--text)] sm:text-[28px]">
                    {selected.nameRu}
                  </h2>
                  {selected.category?.length > 0 && (
                    <p className="text-[13px] leading-[1.6] text-[var(--text-muted)]">
                      {selected.category.join(', ')}
                    </p>
                  )}
                </div>
              </div>

              {selected.descriptionRu && (
                <p className="max-w-3xl text-pretty font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                  {selected.descriptionRu}
                </p>
              )}

              {(selectedWorkingHours || selected.tickets.length > 0) && (
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

                    {selected.tickets.length > 0 && (() => {
                      const uniqueTickets = selected.tickets.filter((t, i, arr) =>
                        arr.findIndex(x => x.type === t.type && x.price === t.price) === i
                      )
                      return (
                        <div className="space-y-1">
                          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                            Билет
                          </p>
                          <div className="space-y-1">
                            {uniqueTickets.map((t, i) => (
                              <p key={`${t.type}-${t.price}-${i}`} className="text-[13px] leading-[1.6] text-[var(--text)] sm:text-[14px]">
                                {t.type ? `${t.type}: ` : ''}¥{t.price.toLocaleString()}
                              </p>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
