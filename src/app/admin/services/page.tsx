import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin — Resources / Services module',
  description: 'Compatibility redirect for the Services module inside the canonical Resources admin workspace.',
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

export default async function AdminServicesPage({
  searchParams,
}: {
  searchParams?: Promise<{ recordId?: string }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const params = new URLSearchParams({ type: 'service' })

  if (resolvedSearchParams?.recordId) {
    params.set('recordId', resolvedSearchParams.recordId)
  }

  redirect(`/admin/resources?${params.toString()}`)
}
