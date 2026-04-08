import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

import { AdminResourcesWorkspace } from '@/components/admin/AdminResourcesWorkspace'
import { getResources } from '@/lib/resources'

export const metadata: Metadata = {
  title: 'Admin — Resources workspace',
  description: 'Canonical resources workspace for services, hotels, and event-like records.',
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

export default async function AdminResourcesPage() {
  const resources = await getResources()
  return <AdminResourcesWorkspace resources={resources} />
}
