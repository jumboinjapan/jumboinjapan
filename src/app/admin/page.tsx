import type { Metadata } from 'next'

import { AdminOverviewDashboard } from '@/components/admin/AdminOverviewDashboard'

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
