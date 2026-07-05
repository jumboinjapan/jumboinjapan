'use client'

/**
 * Клиенты /admin/clients — список воронки (редизайн по фидбеку владельца,
 * 2026-07-05: «плитки неудобны — нужен список от начала воронки к концу
 * с фильтрами-стадиями сверху»).
 *
 * Устройство: сверху фильтры-чипы (все стадии в порядке воронки + «В работе»
 * с количеством кейсов), ниже — единый список, сгруппированный по стадиям
 * от received к paid. Строка целиком кликабельна → client workshop
 * (/admin/clients/[id]). Смена стадии — компактный select в строке.
 * Drag-n-drop сознательно не строим: смена стадии — осмысленное действие.
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import {
  PROSPECT_STAGES,
  STAGE_LABELS,
  SOURCE_LABELS,
  TOUR_TYPE_LABELS,
  type ProspectStage,
  type ProspectTourType,
} from '@/lib/prospect-labels'
import type { ProspectOverviewItem } from '@/lib/prospects'
import { BASE_URL } from '@/lib/schema'
import { CopyLinkButton } from './CopyLinkButton'
import { EmptyNote, StatusChip, adminPanelClass } from './ui'
import { cn } from '@/lib/utils'

const IN_WORK_STAGES: ProspectStage[] = ['received', 'processed', 'discussing', 'agreed']

type StageFilter = 'inwork' | ProspectStage

const DAY_MS = 86400_000

function daysIn(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / DAY_MS)) : null
}

function formatTripDates(item: ProspectOverviewItem): string | null {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  if (item.arrivalDate && item.departureDate) return `${fmt(item.arrivalDate)} — ${fmt(item.departureDate)}`
  if (item.arrivalDate) return `с ${fmt(item.arrivalDate)}`
  return null
}

function formatParty(item: ProspectOverviewItem): string | null {
  const parts: string[] = []
  if (item.partySize) parts.push(`${item.partySize} чел.`)
  if (item.children) parts.push(item.children)
  return parts.length > 0 ? parts.join(' · ') : null
}

// ─── Строка списка ────────────────────────────────────────────────────────────

function ClientRow({ item }: { item: ProspectOverviewItem }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState(false)

  const days = daysIn(item.stageUpdatedAt ?? item.createdAt)
  const trip = formatTripDates(item)
  const party = formatParty(item)
  const tourType = item.tourType ? TOUR_TYPE_LABELS[item.tourType as ProspectTourType] : null
  const href = `/admin/clients/${item.recordId}`

  async function changeStage(stage: string) {
    setError(false)
    try {
      const response = await fetch(`/api/admin/clients/${item.recordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      })
      if (!response.ok) throw new Error('failed')
      startTransition(() => router.refresh())
    } catch {
      setError(true)
    }
  }

  return (
    <div
      onClick={() => router.push(href)}
      className={cn(
        'group flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--adm-border)] px-4 py-3 transition hover:bg-[var(--adm-hover)]',
        isPending && 'opacity-60',
      )}
    >
      {/* Имя + мета */}
      <div className="min-w-0 flex-1 basis-52">
        <Link
          href={href}
          onClick={(e) => e.stopPropagation()}
          className="block truncate text-sm font-medium text-[var(--adm-text)] transition group-hover:text-[var(--adm-accent-text)]"
        >
          {item.name || item.prospectId || 'Без имени'}
        </Link>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-[var(--adm-text-3)]">
          {tourType && <span>{tourType}</span>}
          {party && <span>{party}</span>}
          {trip && <span className="text-[var(--adm-text-3)]">{trip}</span>}
        </div>
      </div>

      {/* Статусные признаки */}
      <div className="flex shrink-0 items-center gap-1.5">
        {item.source && <StatusChip tone="neutral">{SOURCE_LABELS[item.source] ?? item.source}</StatusChip>}
        {item.factFindCompletedAt ? (
          <StatusChip tone="success">анкета ✓</StatusChip>
        ) : (
          <StatusChip tone="warning">без анкеты</StatusChip>
        )}
        {item.factFindToken && (
          <CopyLinkButton
            compact
            text={`${BASE_URL}/profile/${item.factFindToken}`}
            title="Скопировать персональную ссылку на опросник"
          />
        )}
        {days !== null && (
          <span className="w-14 text-right text-xs tabular-nums text-[var(--adm-text-3)]">{days} дн.</span>
        )}
      </div>

      {/* Смена стадии — не проваливается в клик по строке */}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <select
          value={item.stage || ''}
          onChange={(e) => changeStage(e.target.value)}
          className="rounded-lg border border-[var(--adm-border)] bg-[var(--adm-inset)] px-2 py-1.5 text-xs text-[var(--adm-text-2)] outline-none transition focus:border-[var(--adm-accent-border)]"
          aria-label="Стадия"
        >
          {!item.stage && <option value="">стадия не указана</option>}
          {PROSPECT_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABELS[stage]}
            </option>
          ))}
        </select>
        {error && <span className="ml-2 text-xs text-[var(--adm-danger-text)]">не сохранилось</span>}
      </div>

      <span className="hidden shrink-0 text-[var(--adm-text-3)] transition group-hover:text-[var(--adm-accent-text)] sm:inline">→</span>
    </div>
  )
}

// ─── Основной компонент ──────────────────────────────────────────────────────

export function AdminClientsList({ items }: { items: ProspectOverviewItem[] }) {
  const [filter, setFilter] = useState<StageFilter>('inwork')

  const { byStage, unstaged, counts, inWorkCount } = useMemo(() => {
    const byStage = new Map<ProspectStage, ProspectOverviewItem[]>()
    for (const stage of PROSPECT_STAGES) byStage.set(stage, [])
    const unstaged: ProspectOverviewItem[] = []
    for (const item of items) {
      if (item.stage && byStage.has(item.stage as ProspectStage)) {
        byStage.get(item.stage as ProspectStage)!.push(item)
      } else {
        unstaged.push(item)
      }
    }
    // Внутри стадии дольше всего ждущие — сверху (им нужно внимание).
    const now = Date.now()
    const waited = (item: ProspectOverviewItem) => {
      const t = Date.parse(item.stageUpdatedAt ?? item.createdAt ?? '')
      return Number.isFinite(t) ? now - t : 0
    }
    for (const list of byStage.values()) list.sort((a, b) => waited(b) - waited(a))

    const counts = new Map<ProspectStage, number>()
    for (const stage of PROSPECT_STAGES) counts.set(stage, byStage.get(stage)!.length)
    const inWorkCount = IN_WORK_STAGES.reduce((sum, s) => sum + counts.get(s)!, 0) + unstaged.length

    return { byStage, unstaged, counts, inWorkCount }
  }, [items])

  const visibleStages: ProspectStage[] =
    filter === 'inwork' ? IN_WORK_STAGES : [filter]
  const showUnstaged = filter === 'inwork' && unstaged.length > 0
  const visibleTotal =
    visibleStages.reduce((sum, s) => sum + counts.get(s)!, 0) + (showUnstaged ? unstaged.length : 0)

  const chipBase =
    'inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-sm transition cursor-pointer'

  return (
    <div className="mt-6 flex flex-col gap-4">
      {/* Фильтры-стадии: порядок — от начала воронки к концу */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setFilter('inwork')}
          className={cn(
            chipBase,
            filter === 'inwork'
              ? 'border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] text-[var(--adm-accent-text)]'
              : 'border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-3)] hover:border-[var(--adm-border-strong)] hover:text-[var(--adm-text)]',
          )}
        >
          В работе
          <span className={cn('text-xs', filter === 'inwork' ? 'text-[var(--adm-accent-text)]/80' : 'text-[var(--adm-text-3)]')}>
            {inWorkCount}
          </span>
        </button>
        <div className="mx-1 h-4 w-px bg-[var(--adm-active)]" />
        {PROSPECT_STAGES.map((stage) => {
          const count = counts.get(stage)!
          const active = filter === stage
          return (
            <button
              key={stage}
              type="button"
              onClick={() => setFilter(active ? 'inwork' : stage)}
              className={cn(
                chipBase,
                active
                  ? 'border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] text-[var(--adm-accent-text)]'
                  : count > 0
                    ? 'border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-3)] hover:border-[var(--adm-border-strong)] hover:text-[var(--adm-text)]'
                    : 'border-[var(--adm-border)] bg-transparent text-[var(--adm-text-3)] hover:text-[var(--adm-text-3)]',
              )}
            >
              {STAGE_LABELS[stage]}
              <span className={cn('text-xs', active ? 'text-[var(--adm-accent-text)]/80' : 'text-[var(--adm-text-3)]')}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Список: секции по стадиям в порядке воронки */}
      {visibleTotal === 0 ? (
        <div className={cn(adminPanelClass, 'px-5 py-8')}>
          <EmptyNote>
            {filter === 'inwork' ? 'Сейчас нет заявок в работе.' : 'На этой стадии никого нет.'}
          </EmptyNote>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleStages.map((stage) => {
            const list = byStage.get(stage)!
            if (list.length === 0) return null
            return (
              <div key={stage} className={cn(adminPanelClass, 'overflow-hidden')}>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-[13px] font-semibold text-[var(--adm-text-2)]">{STAGE_LABELS[stage]}</span>
                  <span className="text-xs text-[var(--adm-text-3)]">{list.length}</span>
                </div>
                {list.map((item) => (
                  <ClientRow key={item.recordId} item={item} />
                ))}
              </div>
            )
          })}

          {showUnstaged && (
            <div className={cn(adminPanelClass, 'overflow-hidden')}>
              <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-[13px] font-semibold text-[var(--adm-text-2)]">Без стадии</span>
                <span className="text-xs text-[var(--adm-text-3)]">{unstaged.length}</span>
              </div>
              {unstaged.map((item) => (
                <ClientRow key={item.recordId} item={item} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
