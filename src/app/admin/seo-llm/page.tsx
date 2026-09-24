import type { Metadata } from 'next'

import { AdminOperationsConsole } from '@/components/admin/AdminOperationsConsole'
import { getAdminRouteCount, getAdminWorkspaceItems } from '@/lib/admin-workspace'

export const metadata: Metadata = {
  title: 'Панель — POI',
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

export default async function AdminSeoLlmPage({searchParams}:{searchParams?:Promise<{poi?:string}>}) {
  const params=await searchParams
  const initialPoiId=typeof params?.poi==='string'&&/^POI-\d{6}$/.test(params.poi)?params.poi:''
  const [items, routeCount] = await Promise.all([getAdminWorkspaceItems(), getAdminRouteCount()])

  return <AdminOperationsConsole initialPoiId={initialPoiId} items={items} routeCount={routeCount} initialSection="poi-text" currentPath="/admin/seo-llm" />
}
