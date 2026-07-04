import type { Metadata } from 'next'

import { AdminOverviewDashboard } from '@/components/admin/AdminOverviewDashboard'

// The dashboard reads Airtable (prospects, routes, resources, events) with
// no-store on every visit. Without force-dynamic Next attempts to prerender
// /admin at build time — those reads then compete with the ISR prerender of
// public pages for Airtable's 5 rps budget and can 429 the whole build.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin — Обзор',
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

export default async function AdminPage() {
  return <AdminOverviewDashboard />
}
