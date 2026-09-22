import type { Metadata } from 'next'

import { buildRoutePackageMetadata, RoutePackagePage } from '@/components/sections/RoutePackagePage'

// Динамический сегмент обслуживает ТОЛЬКО пакеты, созданные в админке:
// у существующих маршрутов есть статические файлы, Next отдаёт их первыми.
export const revalidate = 3600 // ISR; tag 'airtable:routes' инвалидируется admin-записями

// Do not opt into on-demand static generation with an empty generateStaticParams:
// preview layouts call connection(), so new slugs must render dynamically.

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  return buildRoutePackageMetadata('intercity', slug)
}

export default async function IntercityPackagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <RoutePackagePage section="intercity" slugSuffix={slug} />
}
