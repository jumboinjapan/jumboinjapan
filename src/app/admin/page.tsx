import type { Metadata } from 'next'

import { AdminOperationsConsole, type AdminSection } from '@/components/admin/AdminOperationsConsole'
import { getAdminRouteCount, getAdminWorkspaceItems } from '@/lib/admin-workspace'

export const metadata: Metadata = {
  title: 'Admin workspace',
  description: 'Internal editorial and operations workspace.',
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

function normalizeSection(value?: string): AdminSection {
  switch (value) {
    case 'poi-text':
    case 'route-text':
    case 'route-stops':
    case 'integrations':
      return value
    default:
      return 'overview'
  }
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ section?: string }>
}) {
  const params = searchParams ? await searchParams : undefined
  const [items, routeCount] = await Promise.all([getAdminWorkspaceItems(), getAdminRouteCount()])

  return (
    <AdminOperationsConsole
      items={items}
      routeCount={routeCount}
      initialSection={normalizeSection(params?.section)}
      currentPath="/admin"
    />
  )
}
