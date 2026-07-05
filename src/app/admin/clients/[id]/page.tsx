import type { Metadata } from 'next'
import Link from 'next/link'

import { AdminClientCard } from '@/components/admin/AdminClientCard'
import { AdminShell } from '@/components/admin/AdminShell'
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

  return (
    <AdminShell
      currentPath="/admin/clients"
      title={prospect.name || prospect.prospectId || 'Без имени'}
      subtitle={`${stageLabel} · ${prospect.prospectId}`}
      actions={
        <Link
          href="/admin/clients"
          className="text-sm text-[var(--adm-text-3)] hover:text-[var(--adm-text)] transition whitespace-nowrap"
        >
          ← К доске
        </Link>
      }
    >
      <AdminClientCard
        prospect={prospect}
        factFindUrl={prospect.factFindToken ? buildFactFindUrl(prospect.factFindToken) : null}
      />
    </AdminShell>
  )
}
