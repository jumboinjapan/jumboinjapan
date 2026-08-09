import type { Metadata } from 'next'

import { RouteStopsEditor } from '@/components/admin/RouteStopsEditor'

export const metadata: Metadata = {
  title: 'Панель — Остановки маршрутов',
  robots: { index: false, follow: false },
}

export default function RouteStopsPage() {
  return <RouteStopsEditor />
}
