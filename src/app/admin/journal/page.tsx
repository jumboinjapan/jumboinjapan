import type { Metadata } from 'next'

import { JournalWorkspace } from '@/components/admin/JournalWorkspace'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin — Журнал',
  robots: { index: false, follow: false },
}

export default function AdminJournalPage() {
  return <JournalWorkspace />
}
