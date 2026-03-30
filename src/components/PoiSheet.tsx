'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AirtablePoi } from '@/lib/airtable'

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

function getCardSubtitle(poi: AirtablePoi) {
  return getDescriptionSubtitle(poi.descriptionRu)
}

function getCardEyebrow(poi: AirtablePoi) {
  return poi.category?.find((item) => item !== 'Другое' && item !== 'Разное') ?? null
}

export function PoiSheet({ pois }: { pois: AirtablePoi[] }) {
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [close])

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        {pois.map((p, index) => {
          const subtitle = getCardSubtitle(p)
          const eyebrow = getCardEyebrow(p)
          const isLeadCard = index === 0

          return (
            <button
              key={p.poiId}
              type="button"
              onClick={() => setSelected(p)}
              className={[
                'group relative flex cursor-pointer flex-col items-start overflow-hidden rounded-sm bg-[var(--surface)] text-left transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-warm)]',
                'active:scale-[0.99] hover:-translate-y-0.5 hover:bg-[var(--bg)]',
                isLeadCard
                  ? 'border border-[var(--border)] px-5 py-4 sm:col-span-2 sm:px-6 sm:py-5'
                  : 'border-y border-[var(--border)] px-4 py-3.5 sm:px-5 sm:py-4',
              ].join(' ')}
            >
              <div
                aria-hidden="true"
                className={[
                  'absolute left-0 top-0 h-full transition-colors duration-200',
                  isLeadCard ? 'w-1 bg-[var(--accent-soft)] group-hover:bg-[var(--accent)]' : 'w-px bg-[var(--border)] group-hover:bg-[var(--accent-soft)]',
                ].join(' ')}
              />

              <div
                className={[
                  'relative flex w-full flex-col gap-4',
                  isLeadCard ? 'sm:flex-row sm:items-end sm:justify-between sm:gap-7' : '',
                ].join(' ')}
              >
                <div className={isLeadCard ? 'max-w-2xl space-y-3' : 'space-y-2.5'}>
                  {eyebrow && (
                    <div className="flex items-center gap-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">
                        {eyebrow}
                      </p>
                      <span className="h-px flex-1 bg-[var(--border)]" />
                    </div>
                  )}

                  <div className={isLeadCard ? 'space-y-3' : 'space-y-2'}>
                    <p
                      className={[
                        'max-w-full text-pretty font-sans font-medium tracking-[-0.015em] text-[var(--text)]',
                        isLeadCard ? 'text-[20px] leading-[1.15] sm:text-[24px]' : 'text-[17px] leading-[1.22] sm:text-[18px]',
                      ].join(' ')}
                    >
                      {p.nameRu}
                    </p>

                    {subtitle && (
                      <p
                        className={[
                          'max-w-full text-pretty font-sans text-[14px] leading-[1.55] text-[var(--text-muted)]',
                          isLeadCard ? 'line-clamp-3 sm:max-w-xl' : 'line-clamp-2 sm:line-clamp-3',
                        ].join(' ')}
                      >
                        {subtitle}
                      </p>
                    )}
                  </div>
                </div>

                <div
                  className={[
                    'relative flex w-full items-center justify-end pt-1 text-[12px] leading-none text-[var(--text-muted)]',
                    isLeadCard ? 'sm:w-auto sm:min-w-[160px] sm:self-end sm:justify-end' : '',
                  ].join(' ')}
                >
                  <span className="inline-flex min-h-11 items-center font-medium tracking-[0.08em] uppercase transition-colors group-hover:text-[var(--accent)]">
                    Подробнее
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${selected ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={close}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="poi-sheet-title"
        className={`fixed bottom-0 inset-x-0 z-50 flex max-h-[80vh] flex-col rounded-t-lg bg-[var(--bg)] transition-transform duration-300 ease-out ${selected ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex flex-shrink-0 items-center justify-between px-5 pt-3 pb-2">
          <div className="w-8" />
          <div className="h-1 w-10 rounded-full bg-[var(--border)]" />
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            className="cursor-pointer flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface)]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        {selected && (
          <div className="space-y-4 overflow-y-auto px-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
            <div>
              <h2 id="poi-sheet-title" className="font-sans text-2xl font-medium text-[var(--text)]">
                {selected.nameRu}
              </h2>
            </div>

            {selected.descriptionRu && (
              <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text)]">
                {selected.descriptionRu}
              </p>
            )}

            {selected.category?.length > 0 && (
              <p className="font-sans text-[13px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                {selected.category.join(', ')}
              </p>
            )}

            {selected.workingHours && (
              <p className="font-sans text-[14px] text-[var(--text-muted)]">
                <span className="font-medium">Часы:</span> {selected.workingHours}
              </p>
            )}

            {selected.tickets.length > 0 && (() => {
              const uniqueTickets = selected.tickets.filter((t, i, arr) =>
                arr.findIndex(x => x.type === t.type && x.price === t.price) === i
              )
              return (
                <div className="space-y-1">
                  {uniqueTickets.map((t, i) => (
                    <p key={`${t.type}-${t.price}-${i}`} className="font-sans text-[14px] text-[var(--text)]">
                      {t.type ? `${t.type}: ` : ''}¥{t.price.toLocaleString()}
                    </p>
                  ))}
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </>
  )
}
