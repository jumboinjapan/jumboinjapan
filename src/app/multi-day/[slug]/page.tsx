import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MultiDayBuilderRouteView } from '@/components/sections/MultiDayBuilderRouteView'
import { getMultiDayRouteSeoFields, loadMultiDayBuilderRoute } from '@/lib/multi-day-builder-storage'
import { guideRef } from '@/lib/schema'

export const dynamic = 'force-dynamic'

const BASE_URL = 'https://jumboinjapan.com'

async function loadPublishedRoute(slug: string) {
  const route = await loadMultiDayBuilderRoute(`multi-day/${slug}`)
  if (!route || route.status !== 'Published') return null
  return route
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const route = await loadPublishedRoute(slug)
  if (!route) return {}

  const seo = await getMultiDayRouteSeoFields(route.slug)
  const title = seo?.seoTitle || route.previewTitle || route.title
  const description = seo?.seoDescription || route.previewSubtitle || `${route.dayCount}-дневный маршрут по Японии: ${route.startCity} → ${route.endCity}`
  const pageUrl = `${BASE_URL}/multi-day/${slug}`

  return {
    title,
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      title: `${title} | JumboInJapan`,
      description,
      type: 'website',
      url: pageUrl,
      locale: 'ru_RU',
      siteName: 'JumboInJapan',
    },
  }
}

export default async function MultiDayBuilderRoutePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const route = await loadPublishedRoute(slug)
  if (!route) notFound()

  const seo = await getMultiDayRouteSeoFields(route.slug)
  const pageUrl = `${BASE_URL}/multi-day/${slug}`

  const tourSchema = {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: route.previewTitle || route.title,
    description: seo?.seoDescription || route.previewSubtitle,
    inLanguage: 'ru',
    url: pageUrl,
    duration: `P${route.dayCount}D`,
    touristType: 'Russian-speaking tourists',
    provider: guideRef,
    offers: { '@type': 'Offer', availability: 'https://schema.org/InStock', url: pageUrl },
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />
      <MultiDayBuilderRouteView route={route} intro={seo?.routeIntro} />
    </>
  )
}
