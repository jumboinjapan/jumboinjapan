import type { Metadata } from 'next'

import { FaqWorkspace } from '@/components/admin/FaqWorkspace'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin — Общий FAQ',
  robots: { index: false, follow: false },
}

export default function AdminFaqPage() {
  return <FaqWorkspace />
}
