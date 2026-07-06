/**
 * Shared admin UI kit — the visual standard set by the Overview dashboard.
 *
 * Surface scale (dark admin theme):
 *   shell  #07101c   — page background (AdminShell)
 *   panel  #0b1623/90 — top-level cards/panels
 *   inset  #08111d   — fields, list rows, sub-blocks INSIDE a panel
 *
 * Every admin workspace должен собирать экраны из этих примитивов вместо
 * локальных panelClass/пёстрых hex-фонов — это и есть механизм консистентности.
 */

import { cn } from '@/lib/utils'

// ─── Class constants ─────────────────────────────────────────────────────────

export const adminPanelClass = 'rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)]'

export const adminInsetClass = 'rounded-xl border border-[var(--adm-border)] bg-[var(--adm-inset)]'

export const adminInputClass =
  'w-full rounded-lg border border-[var(--adm-border)] bg-[var(--adm-inset)] px-3 py-2 text-sm text-[var(--adm-text)] placeholder:text-[var(--adm-text-3)] outline-none transition focus:border-[var(--adm-accent-border)] focus:ring-2 focus:ring-[var(--adm-accent-border)]'

export const adminPrimaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-full bg-[var(--adm-accent)] px-4 text-sm font-medium text-[var(--adm-on-accent)] transition hover:bg-[var(--adm-accent-hover)] disabled:cursor-not-allowed disabled:bg-[var(--adm-active)] disabled:text-[var(--adm-text-3)]'

export const adminSecondaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] px-4 text-sm text-[var(--adm-text-2)] transition hover:border-[var(--adm-border-strong)] hover:bg-[var(--adm-active)] hover:text-[var(--adm-text)]'

export const adminDangerButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-full border border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] px-4 text-sm text-[var(--adm-danger-text)] transition hover:border-[var(--adm-danger-border)] hover:bg-[var(--adm-danger-bg)]'

// ─── Components ──────────────────────────────────────────────────────────────

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn('mb-4 text-sm font-semibold uppercase tracking-[0.08em] text-[var(--adm-text-3)]', className)}>
      {children}
    </h2>
  )
}

export function Panel({
  children,
  title,
  actions,
  className,
  onMouseEnter,
  onMouseLeave,
}: {
  children: React.ReactNode
  title?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  return (
    <div className={cn(adminPanelClass, 'px-5 py-5', className)} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && (
            <div className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--adm-text-3)]">{title}</div>
          )}
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}

export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-2xl border px-5 py-4',
        accent ? 'border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)]' : 'border-[var(--adm-border)] bg-[var(--adm-panel)]',
      )}
    >
      <div className="text-2xl font-semibold tracking-tight text-[var(--adm-text)]">{value}</div>
      <div className="text-sm font-medium text-[var(--adm-text-2)]">{label}</div>
      {sub && <div className="text-xs text-[var(--adm-text-3)]">{sub}</div>}
    </div>
  )
}

export function CountRow({ label, count, percent }: { label: string; count: number; percent?: number | null }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-[var(--adm-text-2)]">{label}</span>
      <span className="whitespace-nowrap text-sm font-medium text-[var(--adm-text-3)]">
        {count}
        {percent !== undefined && percent !== null && <span className="ml-2 text-xs text-[var(--adm-text-3)]">{percent}%</span>}
      </span>
    </div>
  )
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--adm-text-3)]">{children}</p>
}

export function ProfileField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[var(--adm-text-3)]">{label}</span>
      <span className="text-sm leading-relaxed text-[var(--adm-text)]">{children}</span>
    </div>
  )
}

export function Dash() {
  return <span className="text-[var(--adm-text-3)]">—</span>
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export type ChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const chipTones: Record<ChipTone, string> = {
  neutral: 'border-[var(--adm-border)] bg-[var(--adm-active)] text-[var(--adm-text-2)]',
  info: 'border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] text-[var(--adm-accent-text)]',
  success: 'border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]',
  warning: 'border-[var(--adm-warn-border)] bg-[var(--adm-warn-bg)] text-[var(--adm-warn-text)]',
  danger: 'border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] text-[var(--adm-danger-text)]',
}

export function StatusChip({ tone = 'neutral', children }: { tone?: ChipTone; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs', chipTones[tone])}>
      {children}
    </span>
  )
}

export function HealthDot({ ok }: { ok: boolean }) {
  return <span className={cn('inline-block size-2 rounded-full', ok ? 'bg-emerald-400' : 'bg-red-400')} />
}
