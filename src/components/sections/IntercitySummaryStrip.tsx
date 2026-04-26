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
      className="overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="grid gap-px bg-[var(--border)] md:grid-cols-2 xl:grid-cols-4">
        {items.map((item, index) => (
          <div
            key={item.label}
            className="relative bg-[var(--surface)] px-5 py-5 md:px-6 md:py-6"
          >
            <span
              aria-hidden="true"
              className={[
                'absolute bottom-5 left-0 top-5 w-px bg-[linear-gradient(180deg,transparent,rgba(181,52,26,0.45),transparent)]',
                index === 0 ? 'opacity-100' : 'opacity-55',
              ].join(' ')}
            />

            <p className="pl-4 font-sans text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
              {item.label}
            </p>
            <div className="mt-2 pl-4 font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)] md:text-[15px]">
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
