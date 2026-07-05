'use client'

/**
 * Доска-воронка /admin/clients.
 *
 * Канон: docs/prospects-crm-spec.md — активные стадии (received → agreed)
 * развёрнуты колонками, conducted/paid/lost свёрнуты (кол-во + разворот).
 * Смена стадии — select на плашке или из карточки; drag-n-drop сознательно
 * не строим (смена стадии — осмысленное действие, не сортировка).
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import {
  PROSPECT_STAGES,
  STAGE_LABELS,
  SOURCE_LABELS,
  TOUR_TYPE_LABELS,
  type ProspectStage,
  type ProspectTourType,
} from '@/lib/prospect-labels'
import type { ProspectOverviewItem } from '@/lib/prospects'
import { EmptyNote, StatusChip, adminInsetClass, adminPanelClass } from './ui'
import { cn } from '@/lib/utils'

const ACTIVE_STAGES: ProspectStage[] = ['received', 'processed', 'discussing', 'agreed']
const ARCHIVE_STAGES: ProspectStage[] = ['conducted', 'paid', 'lost']

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
  else if (item.partyComposition) parts.push(item.partyComposition)
  return parts.length > 0 ? parts.join(' · ') : null
}

const stageSelectClass =
  'w-full rounded-lg border border-white/10 bg-[#08111d] px-2 py-1.5 text-xs text-slate-300 outline-none transition focus:border-sky-400/50'

function ProspectCard({ item }: { item: ProspectOverviewItem }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState(false)

  const days = daysIn(item.stageUpdatedAt ?? item.createdAt)
  const trip = formatTripDates(item)
  const party = formatParty(item)
  const tourType = item.tourType ? TOUR_TYPE_LABELS[item.tourType as ProspectTourType] : null

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
    <div className={cn(adminInsetClass, 'flex flex-col gap-2 p-3', isPending && 'opacity-60')}>
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/admin/clients/${item.recordId}`}
          className="min-w-0 text-sm font-medium text-white hover:text-sky-300 transition"
        >
          <span className="block truncate">{item.name || item.prospectId || 'Без имени'}</span>
        </Link>
        {days !== null && (
          <span className="shrink-0 text-xs text-slate-500 whitespace-nowrap">{days} дн.</span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 text-xs text-slate-400">
        {tourType && <span>{tourType}</span>}
        {party && <span>{party}</span>}
        {trip && <span>{trip}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {item.source && <StatusChip tone="neutral">{SOURCE_LABELS[item.source] ?? item.source}</StatusChip>}
        {item.factFindCompletedAt ? (
          <StatusChip tone="success">анкета ✓</StatusChip>
        ) : (
          <StatusChip tone="warning">без анкеты</StatusChip>
        )}
      </div>

      <select
        value={item.stage || ''}
        onChange={(e) => changeStage(e.target.value)}
        className={stageSelectClass}
        aria-label="Стадия"
      >
        {!item.stage && <option value="">стадия не указана</option>}
        {PROSPECT_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {STAGE_LABELS[stage]}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-400">Не сохранилось — попробуйте ещё раз</span>}
    </div>
  )
}

function ArchiveColumn({ stage, items }: { stage: ProspectStage; items: ProspectOverviewItem[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={cn(adminPanelClass, 'px-4 py-3')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-[13px] font-semibold text-slate-400">{STAGE_LABELS[stage]}</span>
        <span className="flex items-center gap-2 text-sm text-slate-400">
          {items.length}
          <span className="text-xs text-slate-600">{open ? '▲' : '▼'}</span>
        </span>
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          {items.length === 0 ? (
            <EmptyNote>Пусто</EmptyNote>
          ) : (
            items.map((item) => <ProspectCard key={item.recordId} item={item} />)
          )}
        </div>
      )}
    </div>
  )
}

export function AdminClientsBoard({ items }: { items: ProspectOverviewItem[] }) {
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
  // Свежие сверху
  for (const list of byStage.values()) {
    list.sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''))
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {ACTIVE_STAGES.map((stage) => {
          const list = byStage.get(stage)!
          return (
            <div key={stage} className={cn(adminPanelClass, 'flex flex-col gap-3 px-4 py-4')}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold text-slate-400">{STAGE_LABELS[stage]}</span>
                <span className="text-sm text-slate-400">{list.length}</span>
              </div>
              {list.length === 0 ? (
                <EmptyNote>Пусто</EmptyNote>
              ) : (
                list.map((item) => <ProspectCard key={item.recordId} item={item} />)
              )}
            </div>
          )
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {ARCHIVE_STAGES.map((stage) => (
          <ArchiveColumn key={stage} stage={stage} items={byStage.get(stage)!} />
        ))}
      </div>

      {unstaged.length > 0 && (
        <div className={cn(adminPanelClass, 'px-4 py-4')}>
          <div className="mb-3 text-[13px] font-semibold text-slate-400">Без стадии</div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {unstaged.map((item) => (
              <ProspectCard key={item.recordId} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
