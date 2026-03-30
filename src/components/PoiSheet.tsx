'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AirtablePoi } from '@/lib/airtable'

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

  const minPrice = (poi: AirtablePoi) => {
    if (!poi.tickets.length) return null
    return Math.min(...poi.tickets.map((t) => t.price))
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {pois.map((p) => {
          const price = minPrice(p)
          const cat = p.category?.length ? p.category.join(', ') : null
          return (
            <button
              key={p.poiId}
              type="button"
              onClick={() => setSelected(p)}
              className="flex flex-col items-start rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4 text-left cursor-pointer transition-colors hover:border-[var(--accent)]"
            >
              <p className="font-sans text-[15px] font-normal leading-[1.4] text-[var(--text)]">
                {p.nameRu}
              </p>
              {(cat || price !== null) && (
                <p className="mt-1 font-sans text-[13px] font-light text-[var(--text-muted)]">
                  {cat}
                  {cat && price !== null && ' · '}
                  {price !== null && `от ¥${price.toLocaleString()}`}
                </p>
              )}
            </button>
          )
        })}
      </div>

      {/* Bottom sheet */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${selected ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={close}
        aria-hidden="true"
      />
      <div
        className={`fixed bottom-0 inset-x-0 z-50 rounded-t-lg bg-[var(--bg)] max-h-[65vh] overflow-y-auto transition-transform duration-300 ${selected ? 'translate-y-0' : 'translate-y-full'}`}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-[var(--border)]" />
        </div>

        {/* Close button */}
        <div className="flex justify-end px-5">
          <button
            type="button"
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface)] cursor-pointer"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        {selected && (
          <div className="px-5 pb-8 space-y-4">
            <div>
              <h2 className="font-sans text-xl font-medium text-[var(--text)]">
                {selected.nameRu}
              </h2>
              {selected.category?.length > 0 && (
                <p className="mt-1 font-sans text-[13px] font-medium uppercase tracking-wide text-[var(--accent)]">
                  {selected.category.join(', ')}
                </p>
              )}
            </div>

            {selected.workingHours && (
              <p className="font-sans text-[14px] text-[var(--text-muted)]">
                🕐 {selected.workingHours}
              </p>
            )}

            {selected.tickets.length > 0 && (
              <div className="space-y-1">
                {selected.tickets.map((t) => (
                  <p key={t.ticketId} className="font-sans text-[14px] text-[var(--text)]">
                    {t.type ? `${t.type}: ` : ''}¥{t.price.toLocaleString()}
                  </p>
                ))}
              </div>
            )}

            {selected.descriptionRu && (
              <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text)]">
                {selected.descriptionRu}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  )
}
