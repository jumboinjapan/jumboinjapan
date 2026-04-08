import type { Metadata } from 'next'

import { AdminServicesWorkspace } from '@/components/admin/AdminServicesWorkspace'
import { getAdminServiceItems, getAdminServicesSummary } from '@/lib/admin-services'

export const metadata: Metadata = {
  title: 'Admin — Services workspace',
  description: 'Airtable-backed services workspace for Jumbo In Japan admin operations.',
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

export default async function AdminServicesPage() {
  try {
    const items = await getAdminServiceItems()
    const summary = getAdminServicesSummary(items)

    return <AdminServicesWorkspace items={items} summary={summary} />
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load Airtable services workspace'
    return <AdminServicesWorkspace items={[]} summary={getAdminServicesSummary([])} error={message} />
  }
}
