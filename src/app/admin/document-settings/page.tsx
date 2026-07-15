import type { Metadata } from 'next'

import { DocumentSettingsWorkspace } from '@/components/admin/DocumentSettingsWorkspace'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin — Реквизиты документа',
  robots: { index: false, follow: false },
}

export default function DocumentSettingsPage() {
  return <DocumentSettingsWorkspace />
}
