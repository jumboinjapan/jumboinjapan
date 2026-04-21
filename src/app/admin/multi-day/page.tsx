import type { Metadata } from 'next'

import { MultiDayBuilderWorkspace } from '@/components/admin/MultiDayBuilderWorkspace'

export const metadata: Metadata = {
  title: 'Admin — Multi-Day Route Builder',
  robots: { index: false, follow: false },
}

export default function MultiDayBuilderPage() {
  return <MultiDayBuilderWorkspace />
}
