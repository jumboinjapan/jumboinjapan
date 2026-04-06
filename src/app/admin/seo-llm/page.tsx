import type { Metadata } from 'next'

import { AdminOperationsConsole } from '@/components/admin/AdminOperationsConsole'
import { getAdminWorkspaceItems } from '@/lib/admin-workspace'

export const metadata: Metadata = {
  title: 'Admin POI text workspace',
  description: 'Internal-only POI text workspace for drafting, approval, and Airtable sync.',
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

export default async function AdminSeoLlmPage() {
  const items = await getAdminWorkspaceItems()

  return <AdminOperationsConsole items={items} initialSection="poi-text" currentPath="/admin/seo-llm" />
}
