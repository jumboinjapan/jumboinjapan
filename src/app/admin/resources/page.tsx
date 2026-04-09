import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

import { AdminResourcesWorkspace } from '@/components/admin/AdminResourcesWorkspace'
import { getAdminResourceItems, getAdminResourcesSummary, type AdminResourceTypeFilter } from '@/lib/admin-resources'

export const metadata: Metadata = {
  title: 'Admin — Resources hub',
  description: 'Canonical resources hub for services, hotels, and event-like records.',
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

function normalizeTypeFilter(value?: string): AdminResourceTypeFilter {
  return value === 'service' || value === 'hotel' || value === 'event' || value === 'exhibition' || value === 'concert' ? value : 'all'
}

export default async function AdminResourcesPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string; recordId?: string }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const items = await getAdminResourceItems()
  const summary = getAdminResourcesSummary(items)

  return (
    <AdminResourcesWorkspace
      items={items}
      summary={summary}
      initialTypeFilter={normalizeTypeFilter(resolvedSearchParams?.type)}
      initialSelectedRecordId={resolvedSearchParams?.recordId ?? ''}
    />
  )
}
