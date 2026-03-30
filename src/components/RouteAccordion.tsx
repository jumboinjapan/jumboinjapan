'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface RouteStop {
  eyebrow: string
  title: string
  description: string
  workingHours?: string
  minPrice?: number | null
}

export function RouteAccordion({ stops }: { stops: RouteStop[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <div className="grid gap-3">
      {stops.map((stop, index) => {
        const isOpen = openIndex === index
        return (
          <div
            key={stop.title}
            className="rounded-sm border border-[var(--border)] bg-[var(--bg)] transition-colors hover:border-[var(--accent)]"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : index)}
              className="flex w-full items-center gap-3 px-5 py-4 text-left"
              aria-expanded={isOpen}
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[12px] font-medium text-[var(--text-muted)]">
                {index + 1}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--accent)]">
                  {stop.eyebrow}
                </span>
                <h3 className="font-sans text-[16px] font-medium leading-[1.3] tracking-[-0.01em] mt-0.5">
                  {stop.title}
                </h3>
              </div>
              <ChevronDown
                aria-hidden="true"
                className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>
            <div
              className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-96' : 'max-h-0'}`}
            >
              <div className="px-5 pb-5 pl-16">
                <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                  {stop.description}
                </p>
                {stop.workingHours && (
                  <p className="mt-2 font-sans text-[12px] font-light text-[var(--text-muted)]">
                    {stop.workingHours}
                  </p>
                )}
                {stop.minPrice != null && stop.minPrice > 0 && (
                  <p className="mt-1 font-sans text-[12px] font-light text-[var(--text-muted)]">
                    от ¥{stop.minPrice.toLocaleString('ru-RU')}
                  </p>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
