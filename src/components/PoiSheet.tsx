'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AirtablePoi } from '@/lib/airtable'

const SUBTITLE_BLACKLIST = [
  'обязател',
  'идеаль',
  'роскош',
  'люкс',
  'преми',
  'элит',
  'изыскан',
  'пафосн',
  'абсолютн',
  'лучший',
  'самый',
  'must-see',
]

function normalizeCardSubtitle(text: string) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[•·]+/g, ' ')
    .replace(/[«»"']/g, '')
    .replace(/\s+,/g, ',')
    .replace(/,+/g, ',')
    .replace(/[.,;:!?]+$/g, '')
    .trim()
}

function trimSubtitle(text: string, limit = 82) {
  if (text.length <= limit) return text

  const trimmed = text
    .slice(0, limit)
    .replace(/[,:;\-–—]\s*[^,:;\-–—]*$/u, '')
    .trim()

  return trimmed || text.slice(0, limit).trim()
}

function isEditorialSubtitle(text: string) {
  const normalized = text.toLowerCase()
  return !SUBTITLE_BLACKLIST.some((token) => normalized.includes(token))
}

function getDescriptionSubtitle(descriptionRu: string) {
  const description = normalizeCardSubtitle(descriptionRu)
  if (!description) return null

  const sentences = description
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => normalizeCardSubtitle(sentence.replace(/[.!?]+$/g, '')))
    .filter(Boolean)

  for (const sentence of sentences) {
    if (sentence.length < 24) continue
    if (!isEditorialSubtitle(sentence)) continue
    return trimSubtitle(sentence)
  }

  return null
}

function getCardSubtitle(poi: AirtablePoi) {
  const descriptionSubtitle = getDescriptionSubtitle(poi.descriptionRu)
  if (descriptionSubtitle) return descriptionSubtitle

  if (poi.category?.length) {
    const categoryLine = normalizeCardSubtitle(poi.category.join(' · '))
    if (categoryLine && categoryLine !== 'Другое' && categoryLine !== 'Разное') {
      return categoryLine
    }
  }

  return null
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

  // Escape key to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [close])

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {pois.map((p) => {
          const subtitle = getCardSubtitle(p)

          return (
            <button
              key={p.poiId}
              type="button"
              onClick={() => setSelected(p)}
              className="flex min-h-[88px] flex-col items-start rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4 text-left cursor-pointer transition-colors transition-transform hover:border-[var(--accent)] active:scale-[0.98]"
            >
              <p className="font-sans text-[15px] font-medium leading-[1.4] text-[var(--text)]">
                {p.nameRu}
              </p>
              {subtitle && (
                <p className="mt-1 max-w-full truncate font-sans text-[13px] font-light text-[var(--text-muted)]" title={subtitle}>
                  {subtitle}
                </p>
              )}
            </button>
          )
        })}
      </div>

      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${selected ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={close}
        aria-hidden="true"
      />

      {/* Bottom sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="poi-sheet-title"
        className={`fixed bottom-0 inset-x-0 z-50 rounded-t-lg bg-[var(--bg)] flex flex-col max-h-[80vh] transition-transform duration-300 ease-out ${selected ? 'translate-y-0' : 'translate-y-full'}`}
      >
        {/* Sticky header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 pt-3 pb-2">
          <div className="w-8" />
          <div className="h-1 w-10 rounded-full bg-[var(--border)]" />
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface)] cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Scrollable content */}
        {selected && (
          <div className="overflow-y-auto px-5 pb-[max(2rem,env(safe-area-inset-bottom))] space-y-4">
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
