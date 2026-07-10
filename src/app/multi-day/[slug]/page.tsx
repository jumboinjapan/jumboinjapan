import { unstable_cache } from 'next/cache'
import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MultiDayBuilderRouteView } from '@/components/sections/MultiDayBuilderRouteView'
import { RouteFaq } from '@/components/sections/RouteFaq'
import { getPoisByIds } from '@/lib/airtable'
import type { MultiDayBuilderRoute } from '@/lib/multi-day-builder'
import { getMultiDayRouteSeoFieldsCached, loadMultiDayBuilderRouteCached } from '@/lib/multi-day-builder-storage'
import { guideRef } from '@/lib/schema'

// Описания точек НЕ хранятся в конструкторе (гиду там нужны только
// названия) — публичная страница наследует их из POI-первоисточников
// по POI ID, как intercity-страницы: правка описания в POI обновляет
// и эту страницу.
const getPoiDescriptionsCached = cache(
  unstable_cache(
    async (poiIds: string[]) => {
      const pois = await getPoisByIds(poiIds)
      return Object.fromEntries(
        pois.map((poi) => [poi.poiId, poi.approvedRu || poi.descriptionRu || '']),
      ) as Record<string, string>
    },
    ['multi-day-poi-descriptions'],
    { tags: ['airtable:pois'], revalidate: 3600 },
  ),
)

function collectPoiIds(route: MultiDayBuilderRoute): string[] {
  return route.days.flatMap((day) =>
    day.items
      .map((item) => item.internalNotes?.match(/POI-\d{6}/)?.[0] ?? '')
      .filter(Boolean),
  )
}

export const revalidate = 3600 // ISR; publish is instant via revalidateTag('airtable:routes') from the builder API

const BASE_URL = 'https://jumboinjapan.com'

async function loadPublishedRoute(slug: string) {
  const route = await loadMultiDayBuilderRouteCached(`multi-day/${slug}`)
  if (!route || route.status !== 'Published') return null
  return route
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const route = await loadPublishedRoute(slug)
  if (!route) return {}

  const seo = await getMultiDayRouteSeoFieldsCached(route.slug)
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

  const seo = await getMultiDayRouteSeoFieldsCached(route.slug)
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

  const poiDescriptions = await getPoiDescriptionsCached(collectPoiIds(route))

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />
      <MultiDayBuilderRouteView route={route} intro={seo?.routeIntro} poiDescriptions={poiDescriptions} />
      <RouteFaq slug={route.slug} />
    </>
  )
}
