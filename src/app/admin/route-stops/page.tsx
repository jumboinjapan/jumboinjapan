import type { Metadata } from 'next'

import { RouteStopsEditor } from '@/components/admin/RouteStopsEditor'

export const metadata: Metadata = {
  title: 'Admin — Route Stops Editor',
  robots: { index: false, follow: false },
}

export default function RouteStopsPage() {
  return <RouteStopsEditor />
}
