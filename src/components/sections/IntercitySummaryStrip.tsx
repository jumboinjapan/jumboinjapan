import type { ReactNode } from 'react'

export interface IntercitySummaryItem {
  label: string
  value: ReactNode
}

interface IntercitySummaryStripProps {
  items: IntercitySummaryItem[]
}

export function IntercitySummaryStrip({ items }: IntercitySummaryStripProps) {
  return (
    <section
      aria-label="Краткая сводка по туру"
      className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-2 xl:grid-cols-4"
    >
      {items.map((item) => (
        <div key={item.label} className="bg-[var(--bg)] px-5 py-4 md:px-6">
          <p className="font-sans text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
            {item.label}
          </p>
          <div className="mt-2 font-sans text-[15px] font-light leading-[1.75] text-[var(--text)]">
            {item.value}
          </div>
        </div>
      ))}
    </section>
  )
}
