import type { Metadata } from 'next'

import { SeoLlmWorkspace } from '@/components/admin/SeoLlmWorkspace'
import { getSeoWorkspaceDrafts } from '@/lib/admin-seo-llm-storage'
import { getAllPois } from '@/lib/airtable'

export const metadata: Metadata = {
  title: 'Admin SEO / LLM workspace',
  description: 'Internal-only POI text workspace for drafting, approval, and Airtable sync.',
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

export default async function AdminSeoLlmPage() {
  const [pois, drafts] = await Promise.all([getAllPois(), getSeoWorkspaceDrafts()])

  const items = pois
    .map((poi) => ({
      ...poi,
      siteCity: poi.siteCity ?? '',
      draft: drafts[poi.id] ?? null,
    }))
    .sort((left, right) => {
      const leftName = left.nameRu || left.nameEn || left.poiId
      const rightName = right.nameRu || right.nameEn || right.poiId
      return leftName.localeCompare(rightName, 'ru')
    })

  return <SeoLlmWorkspace items={items} />
}
