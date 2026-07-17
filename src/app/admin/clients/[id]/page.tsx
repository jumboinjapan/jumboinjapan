import type { Metadata } from 'next'
import Link from 'next/link'

import { AdminClientCard, type LinkedRouteSummary } from '@/components/admin/AdminClientCard'
import { AdminShell } from '@/components/admin/AdminShell'
import { listSavedMultiDayRoutes } from '@/lib/multi-day-builder-storage'
import { getShareState } from '@/lib/program-share'
import { STAGE_LABELS } from '@/lib/prospect-labels'
import { buildFactFindUrl, getProspectById } from '@/lib/prospects'

// Карточка клиента. Принимает Airtable record id (rec…) или Prospect ID
// (PRS-…) — ссылки из Telegram и с доски работают одинаково.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin — Карточка клиента',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-snippet': 0,
      'max-image-preview': 'none',
      'max-video-preview': 0,
    },
  },
}

export default async function AdminClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const prospect = await getProspectById(id)

  if (!prospect) {
    return (
      <AdminShell currentPath="/admin/clients" title="Клиент не найден">
        <div className="mt-8 flex flex-col items-start gap-3">
          <p className="text-sm text-[var(--adm-text-3)]">
            Записи с таким ID нет — возможно, она удалена в Airtable.
          </p>
          <Link href="/admin/clients" className="text-sm text-[var(--adm-accent-text)] hover:text-[var(--adm-accent-text)] transition">
            ← К доске клиентов
          </Link>
        </div>
      </AdminShell>
    )
  }

  const stageLabel = prospect.stage ? STAGE_LABELS[prospect.stage] : 'стадия не указана'

  // Сводки привязанных маршрутов (название, статус, дни) + состояние гостевой
  // ссылки /p/<token> — то, что реально уходит клиенту, должно быть видно из
  // карточки. Недоступность Airtable не роняет карточку: строки просто
  // останутся без обогащения.
  let routeSummaries: Record<string, LinkedRouteSummary> = {}
  if (prospect.linkedRoutes.length > 0) {
    try {
      const saved = await listSavedMultiDayRoutes()
      const linked = saved.filter((route) => prospect.linkedRoutes.includes(route.slug))
      const entries = await Promise.all(
        linked.map(async (route): Promise<[string, LinkedRouteSummary]> => {
          const share = await getShareState(route.slug).catch(() => null)
          return [
            route.slug,
            {
              title: route.title,
              status: route.status,
              dayCount: route.dayCount,
              share: share
                ? { enabled: share.enabled, url: share.url, expired: share.expired, expiresAt: share.expiresAt }
                : null,
            },
          ]
        }),
      )
      routeSummaries = Object.fromEntries(entries)
    } catch (error) {
      console.error('[admin/clients] route summaries failed:', error)
    }
  }

  return (
    <AdminShell
      currentPath="/admin/clients"
      title={prospect.name || prospect.prospectId || 'Без имени'}
      subtitle={`${stageLabel} · ${prospect.prospectId}`}
      actions={
        <div className="flex items-center gap-3">
          <Link
            href={`/admin/multi-day?client=${prospect.recordId}`}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--adm-gold)] px-4 text-sm font-semibold text-[var(--adm-on-gold)] transition hover:bg-[var(--adm-gold-hover)]"
          >
            Создать маршрут →
          </Link>
          <Link
            href="/admin/clients"
            className="text-sm text-[var(--adm-text-3)] hover:text-[var(--adm-text)] transition whitespace-nowrap"
          >
            ← К доске
          </Link>
        </div>
      }
    >
      <AdminClientCard
        prospect={prospect}
        factFindUrl={prospect.factFindToken ? buildFactFindUrl(prospect.factFindToken) : null}
        routeSummaries={routeSummaries}
      />
    </AdminShell>
  )
}
