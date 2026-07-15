import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { buildPrintProgram } from '@/lib/print-program'
import { PrintProgramDocument } from '@/components/print/PrintProgramDocument'
import { PrintToolbar } from '@/components/admin/PrintToolbar'

// Admin surface: always fresh, never prerendered at build.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Программа тура — печать',
  robots: { index: false, follow: false },
}

export default async function PrintProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string[] }>
  searchParams: Promise<{ client?: string }>
}) {
  const { slug } = await params
  const { client } = await searchParams
  const routeSlug = decodeURIComponent(slug.join('/'))

  const program = await buildPrintProgram(routeSlug)
  if (!program) notFound()

  const clientName = client?.trim() || ''

  return (
    <div className="print-page">
      <PrintToolbar slug={routeSlug} />
      <PrintProgramDocument program={program} clientLabel={clientName} showPreparedDate />
    </div>
  )
}
