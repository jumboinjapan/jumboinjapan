import type { Metadata } from 'next'

import { RouteTextWorkspace } from '@/components/admin/RouteTextWorkspace'

export const metadata: Metadata = {
  title: 'Admin — Тексты маршрутов',
  robots: { index: false, follow: false },
}

export default function RouteTextPage() {
  return <RouteTextWorkspace />
}
