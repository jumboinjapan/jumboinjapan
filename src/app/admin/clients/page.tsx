import type { Metadata } from 'next'

import { AdminClientsBoard } from '@/components/admin/AdminClientsBoard'
import { AdminShell } from '@/components/admin/AdminShell'
import { listProspectsForOverview } from '@/lib/prospects'

// Доска-воронка клиентов. Читает Prospects без кэша на каждый визит —
// CRM не должна отставать от Airtable.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin — Клиенты',
  description: 'Воронка клиентов: заявки, обсуждения, согласованные туры.',
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

export default async function AdminClientsPage() {
  const items = await listProspectsForOverview()

  return (
    <AdminShell currentPath="/admin/clients" title="Клиенты" subtitle="Воронка: от заявки до оплаченного тура">
      <AdminClientsBoard items={items} />
    </AdminShell>
  )
}
