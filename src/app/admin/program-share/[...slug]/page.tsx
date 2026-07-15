import type { Metadata } from 'next'

import { AdminShell } from '@/components/admin/AdminShell'
import { ProgramShareControl } from '@/components/admin/ProgramShareControl'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin — Ссылка на программу',
  robots: { index: false, follow: false },
}

export default async function ProgramSharePage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  const routeSlug = decodeURIComponent(slug.join('/'))

  return (
    <AdminShell currentPath="/admin/multi-day" title="Ссылка на программу" subtitle="Живая ссылка для гостя вместо PDF">
      <div className="mt-6">
        <ProgramShareControl slug={routeSlug} />
      </div>
    </AdminShell>
  )
}
