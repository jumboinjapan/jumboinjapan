import { unstable_cache } from 'next/cache'
import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MultiDayBuilderRouteView } from '@/components/sections/MultiDayBuilderRouteView'
import { RouteFaq } from '@/components/sections/RouteFaq'
import { getPoisByIds, getRouteStopsByIds } from '@/lib/airtable'
import type { MultiDayBuilderRoute } from '@/lib/multi-day-builder'
import { getMultiDayRouteSeoFieldsCached, loadMultiDayBuilderRouteCached } from '@/lib/multi-day-builder-storage'
import { guideRef } from '@/lib/schema'

// Описания точек НЕ хранятся в конструкторе (гиду там нужны только
// названия) — публичная страница наследует их из первоисточников:
//   • блок с POI ID → таблица POI (Approved → raw), как intercity-страницы;
//   • блок из макета городского маршрута без POI (составная остановка
//     вроде «Асакуса и Сэнсо-дзи») → Route Stops исходного маршрута
//     (Stop Description Override Approved), ключ «STOP:<Route Stop ID>».
// Правка описания в первоисточнике обновляет и эту страницу.
const getInheritedDescriptionsCached = cache(
  unstable_cache(
    async (poiIds: string[], stopIds: string[]) => {
      const stops = await getRouteStopsByIds(stopIds)
      const poiIdSet = new Set(poiIds)
      // Остановка без собственного текста наследует описание своего POI
      for (const stop of stops) {
        if (!stop.descriptionOverride.trim() && stop.poiId) poiIdSet.add(stop.poiId)
      }
      const pois = await getPoisByIds([...poiIdSet])
      const map: Record<string, string> = Object.fromEntries(
        pois.map((poi) => [poi.poiId, poi.approvedRu || poi.descriptionRu || '']),
      )
      for (const stop of stops) {
        if (!stop.routeStopId) continue
        map[`STOP:${stop.routeStopId}`] = stop.descriptionOverride.trim() || (stop.poiId ? (map[stop.poiId] ?? '') : '')
      }
      return map
    },
    ['multi-day-inherited-descriptions'],
    { tags: ['airtable:pois', 'airtable:routes'], revalidate: 3600 },
  ),
)

function collectInheritanceRefs(route: MultiDayBuilderRoute): { poiIds: string[]; stopIds: string[] } {
  const poiIds: string[] = []
  const stopIds: string[] = []
  for (const day of route.days) {
    for (const item of day.items) {
      const poiId = item.internalNotes?.match(/POI-\d{6}/)?.[0]
      if (poiId) {
        poiIds.push(poiId)
        continue
      }
      const stopId = item.internalNotes?.match(/^STOP ID:\s*(.+?)\s*$/m)?.[1]
      if (stopId) stopIds.push(stopId)
    }
  }
  return { poiIds, stopIds }
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

  const refs = collectInheritanceRefs(route)
  const poiDescriptions = await getInheritedDescriptionsCached(refs.poiIds, refs.stopIds)

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />
      <MultiDayBuilderRouteView
        route={route}
        heroImage={route.heroImagePath || undefined}
        intro={seo?.routeIntro}
        poiDescriptions={poiDescriptions}
      />
      <RouteFaq slug={route.slug} />
    </>
  )
}
