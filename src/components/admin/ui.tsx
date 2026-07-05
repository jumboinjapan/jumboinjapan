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

export const adminPanelClass = 'rounded-2xl border border-white/10 bg-[#0b1623]/90'

export const adminInsetClass = 'rounded-xl border border-white/10 bg-[#08111d]'

export const adminInputClass =
  'w-full rounded-lg border border-white/10 bg-[#08111d] px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20'

export const adminPrimaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-full bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-slate-500'

export const adminSecondaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 text-sm text-slate-300 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white'

export const adminDangerButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-4 text-sm text-red-300 transition hover:border-red-500/50 hover:bg-red-500/15'

// ─── Components ──────────────────────────────────────────────────────────────

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn('mb-4 text-sm font-semibold uppercase tracking-[0.08em] text-slate-400', className)}>
      {children}
    </h2>
  )
}

export function Panel({
  children,
  title,
  actions,
  className,
}: {
  children: React.ReactNode
  title?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn(adminPanelClass, 'px-5 py-5', className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && (
            <div className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">{title}</div>
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
        accent ? 'border-sky-400/30 bg-sky-500/[0.08]' : 'border-white/10 bg-[#0b1623]/90',
      )}
    >
      <div className="text-2xl font-semibold tracking-tight text-white">{value}</div>
      <div className="text-sm font-medium text-slate-300">{label}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

export function CountRow({ label, count, percent }: { label: string; count: number; percent?: number | null }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-slate-300">{label}</span>
      <span className="whitespace-nowrap text-sm font-medium text-slate-400">
        {count}
        {percent !== undefined && percent !== null && <span className="ml-2 text-xs text-slate-500">{percent}%</span>}
      </span>
    </div>
  )
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>
}

export type ChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const chipTones: Record<ChipTone, string> = {
  neutral: 'border-white/12 bg-white/[0.06] text-slate-300',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  danger: 'border-red-500/30 bg-red-500/10 text-red-400',
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
