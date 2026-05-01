import type { TicketDisplayLine } from '@/lib/ticket-display'

function formatPrice(line: TicketDisplayLine) {
  if (line.price === 0) return 'бесплатно'

  const prefix = line.hasMultiplePrices ? 'от ' : ''
  return `${prefix}¥${line.price.toLocaleString('ru-RU')}`
}

export function TicketDisplayList({ lines }: { lines: TicketDisplayLine[] }) {
  if (lines.length === 0) return null

  return (
    <div className="space-y-2">
      {lines.map((line) => (
        <div
          key={`${line.key}-${line.price}`}
          className="grid grid-cols-[minmax(88px,auto)_1fr_auto] items-center gap-x-3 gap-y-1 text-[14px] leading-[1.55] text-[var(--text)]"
        >
          <span className="font-medium tracking-[-0.01em] text-[var(--text)]">
            {line.groupLabel}
          </span>
          {line.ageLabel ? (
            <span className="justify-self-start rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[11px] font-medium leading-none text-[var(--text-muted)]">
              {line.ageLabel}
            </span>
          ) : (
            <span aria-hidden="true" />
          )}
          <span className="justify-self-end whitespace-nowrap font-medium tabular-nums text-[var(--text)]">
            {formatPrice(line)}
          </span>
        </div>
      ))}
    </div>
  )
}
