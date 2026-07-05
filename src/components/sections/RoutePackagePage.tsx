/**
 * Б-1 (безопасная версия): data-driven страница маршрутного пакета,
 * созданного в админке (Route Stops editor). Обслуживает ТОЛЬКО новые
 * slug'и: у 13 существующих intercity/city-tour страниц есть статические
 * файлы, и Next всегда предпочитает их динамическому сегменту — этот
 * шаблон их не касается. Миграция старых страниц на шаблон — отдельное
 * решение владельца.
 *
 * Публикуется только Routes.Status === 'Published' (та же модель, что у
 * multi-day); черновики отдают 404.
 */

import { unstable_cache } from 'next/cache'
import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { IntercityRouteTimeline } from '@/components/IntercityRouteTimeline'
import { PageHero } from '@/components/sections/PageHero'
import { SectionHeading } from '@/components/sections/SectionHeading'
import { getIntercityRouteStopsCached, getPoisByIds, type AirtableRouteStop } from '@/lib/airtable'
import { buildIntercityRouteStopsFromAirtable } from '@/lib/intercity-pois'
import { getMultiDayRouteSeoFieldsCached } from '@/lib/multi-day-builder-storage'
import { getRouteMeta } from '@/lib/print-program'
import { guideRef } from '@/lib/schema'
import { RouteFaq } from '@/components/sections/RouteFaq'

const BASE_URL = 'https://jumboinjapan.com'

export type RoutePackageSection = 'intercity' | 'city-tour'

const SECTION_COPY: Record<RoutePackageSection, { eyebrow: string; heroImage: string; heroAlt: string; breadcrumb: { name: string; path: string } }> = {
  intercity: {
    eyebrow: 'Маршруты из Токио',
    heroImage: '/dest-intercity-fuji.jpg',
    heroAlt: 'Гора Фудзи — выездные маршруты из Токио',
    breadcrumb: { name: 'Маршруты из Токио', path: '/intercity' },
  },
  'city-tour': {
    eyebrow: 'Туры по Токио',
    heroImage: '/hero-city-tour-rainbow-bridge-tokyo-tower.jpg',
    heroAlt: 'Вечерний Токио — Радужный мост и Токийская башня',
    breadcrumb: { name: 'По Токио', path: '/city-tour' },
  },
}

const getRouteMetaCached = cache(
  unstable_cache((slug: string) => getRouteMeta(slug), ['route-package-meta'], {
    tags: ['airtable:routes'],
    revalidate: 3600,
  }),
)

const getPoisForStopsCached = cache(
  unstable_cache(
    (poiIds: string[]) => getPoisByIds(poiIds),
    ['route-package-pois'],
    { tags: ['airtable:pois'], revalidate: 3600 },
  ),
)

async function loadPublishedPackage(section: RoutePackageSection, slugSuffix: string) {
  const fullSlug = `${section}/${slugSuffix}`
  const meta = await getRouteMetaCached(fullSlug)
  if (!meta || meta.status !== 'Published') return null
  const stops = await getIntercityRouteStopsCached(fullSlug)
  return { fullSlug, meta, stops }
}

export async function buildRoutePackageMetadata(
  section: RoutePackageSection,
  slugSuffix: string,
): Promise<Metadata> {
  const pkg = await loadPublishedPackage(section, slugSuffix)
  if (!pkg) return {}
  const seo = await getMultiDayRouteSeoFieldsCached(pkg.fullSlug)
  const title = seo?.seoTitle || pkg.meta.title
  const description = seo?.seoDescription || `Авторский маршрут «${pkg.meta.title}» с частным гидом.`
  const pageUrl = `${BASE_URL}/${pkg.fullSlug}`
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

function buildTourSchema(fullSlug: string, title: string, description: string, stops: AirtableRouteStop[]) {
  const pageUrl = `${BASE_URL}/${fullSlug}`
  return {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: title,
    description,
    inLanguage: 'ru',
    url: pageUrl,
    duration: 'P1D',
    touristType: 'Russian-speaking tourists',
    provider: guideRef,
    offers: { '@type': 'Offer', availability: 'https://schema.org/InStock', url: pageUrl },
    itinerary: stops
      .filter((s) => !s.isHelper && s.status !== 'Inactive')
      .map((stop) => ({
        '@type': 'TouristAttraction',
        name: stop.titleOverride || stop.poiNameSnapshot,
        ...(stop.activityTag ? { touristType: stop.activityTag } : {}),
      })),
  }
}

export async function RoutePackagePage({
  section,
  slugSuffix,
}: {
  section: RoutePackageSection
  slugSuffix: string
}) {
  const pkg = await loadPublishedPackage(section, slugSuffix)
  if (!pkg) notFound()

  const seo = await getMultiDayRouteSeoFieldsCached(pkg.fullSlug)
  const pois = await getPoisForStopsCached(pkg.stops.map((s) => s.poiId))
  const timelineStops = buildIntercityRouteStopsFromAirtable(pkg.stops, pois)

  const copy = SECTION_COPY[section]
  const intro = seo?.routeIntro || ''
  const tourSchema = buildTourSchema(pkg.fullSlug, seo?.seoTitle || pkg.meta.title, seo?.seoDescription || '', pkg.stops)
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Главная', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: copy.breadcrumb.name, item: `${BASE_URL}${copy.breadcrumb.path}` },
      { '@type': 'ListItem', position: 3, name: pkg.meta.title, item: `${BASE_URL}/${pkg.fullSlug}` },
    ],
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      <PageHero
        image={copy.heroImage}
        alt={copy.heroAlt}
        eyebrow={copy.eyebrow}
        title={pkg.meta.title}
        subtitle={intro || undefined}
      />

      <section className="mx-auto max-w-5xl px-6 py-16 md:py-20">
        <SectionHeading eyebrow="Программа дня" title="Маршрут по точкам" />
        {(pkg.meta.tourStartTime || pkg.meta.tourEndTime) && (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Время тура: {pkg.meta.tourStartTime}
            {pkg.meta.tourEndTime ? ` — ${pkg.meta.tourEndTime}` : ''}
          </p>
        )}
        <div className="mt-10">
          <IntercityRouteTimeline stops={timelineStops} />
        </div>
      </section>

      <RouteFaq slug={pkg.fullSlug} />
    </>
  )
}
