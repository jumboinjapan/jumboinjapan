import type { Metadata } from 'next'

import { InvoiceWorkspace } from '@/components/admin/InvoiceWorkspace'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Панель — Инвойсы',
  robots: { index: false, follow: false },
}

export default function InvoicesPage() {
  return <InvoiceWorkspace />
}
