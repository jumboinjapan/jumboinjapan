import type { Metadata } from 'next'

import { AdminClientsList } from '@/components/admin/AdminClientsList'
import { AdminShell } from '@/components/admin/AdminShell'
import { CopyLinkButton } from '@/components/admin/CopyLinkButton'
import { listProspectsForOverview } from '@/lib/prospects'
import { BASE_URL } from '@/lib/schema'

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
    <AdminShell
      currentPath="/admin/clients"
      title="Клиенты"
      subtitle="Воронка: от заявки до оплаченного тура"
      actions={
        // Общая ссылка на опросник (/profile) — пересылается кому угодно,
        // submit сам создаёт карточку клиента. Персональные ссылки — в строках
        // списка и в карточке клиента.
        <CopyLinkButton
          text={`${BASE_URL}/profile`}
          label="Ссылка на опросник"
          title="Скопировать общую ссылку на опросник — ответы создадут карточку клиента"
        />
      }
    >
      <AdminClientsList items={items} />
    </AdminShell>
  )
}
