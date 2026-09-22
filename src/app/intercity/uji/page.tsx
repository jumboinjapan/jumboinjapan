import { IntercityTourAlbum } from '@/components/sections/IntercityTourAlbum'
import album from '@/components/sections/TourAlbum.module.css'
import { buildTourOffer, serializeTourSchema, describeTourDuration } from '@/lib/tour-schema'
import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { tours } from '@/data/tours'
import { getMultiDayRouteSeoFieldsCached } from '@/lib/multi-day-builder-storage'
import { getRouteContent } from '@/lib/route-content'
import { buildIntercityRouteStopsFromAirtable, buildHelperPoisFromAirtable } from '@/lib/intercity-pois'
import { guideRef } from '@/lib/schema'
import { RouteFaq } from '@/components/sections/RouteFaq'
import { JournalMentions } from '@/components/sections/JournalMentions'
import { typoDeep } from '@/lib/typography'

export const revalidate = 3600 // ISR: Airtable-backed (tags 'airtable:routes'/'airtable:pois', invalidated via /api/revalidate on admin write)

const tour = tours.find((t) => t.slug === 'intercity/uji')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/intercity/uji`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getMultiDayRouteSeoFieldsCached(tour.slug)
  const title = seo?.seoTitle || tour.title
  const description = seo?.seoDescription || tour.description

  return {
  title: title,
  description: description,
  alternates: { canonical: 'https://jumboinjapan.com/intercity/uji' },
  openGraph: {
    title: `${title} | JumboInJapan`,
    description: description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Павильон Феникса Бёдо-ин в Удзи' }],
  },
}
}

const tourSchema = {
  '@context': 'https://schema.org',
  '@type': 'TouristTrip',
  '@id': PAGE_URL + '#trip',
  name: tour.title,
  alternateName: tour.titleEn,
  description: tour.description,
  image: PAGE_IMAGE,
  url: PAGE_URL,
  disambiguatingDescription: describeTourDuration(tour.duration),
  touristType: 'Russian-speaking tourists',
  provider: guideRef,
  offers: buildTourOffer(PAGE_URL),
}

const breadcrumbSchema = typoDeep({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Главная', item: BASE_URL },
    { '@type': 'ListItem', position: 2, name: 'Маршруты из Токио', item: `${BASE_URL}/intercity` },
    { '@type': 'ListItem', position: 3, name: tour.title, item: PAGE_URL },
  ],
})


export default async function UjiPage() {
  const { routeStopRecords, pois } = await getRouteContent('intercity/uji')

  const seo = await getMultiDayRouteSeoFieldsCached(tour.slug)


  const transportOptions = [
    {
      title: 'Общественный транспорт',
      summary: 'Маршрут выстраивается вокруг расписаний поездов и автобусов, с пересадками внутри дня. Формат подходит высокомобильным путешественникам с приоритетом на бюджет.',
      href: '/intercity/public',
      image: '/city-tour-transport-public-v2.jpg',
    },
    {
      title: 'Частный транспорт',
      summary: 'Транспорт по договорённости позволяет выстроить выездной день целиком: выезд от отеля, остановки по ходу маршрута, перестройка программы по погоде и настроению. Дорога становится частью тура, а не расписанием пересадок.',
      href: '/intercity/private',
      image: '/city-tour-transport-private-v4.jpg',
    },
    {
      title: 'Заказной транспорт',
      summary: 'Лимузин-сервис — просторный минивэн на весь день. Разумный выбор для большой семьи или группы, когда важно ехать вместе и с комфортом.',
      href: '/city-tour/charter',
      image: '/city-tour-transport-limousine-v2.jpg',
    },
  ]

  const timelineStops = buildIntercityRouteStopsFromAirtable(routeStopRecords, pois)
  const helperItems = buildHelperPoisFromAirtable(routeStopRecords, pois)

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeTourSchema(tourSchema) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
    <IntercityTourAlbum
        title={seo?.routeTitle || tour.shortTitle}
        image={seo?.heroImagePath || "/tours/uji/byodoin-phoenix-hall.jpg"}
        alt="Павильон Феникса Бёдо-ин в Удзи"
        subtitle={seo?.previewSubtitle || "Удзи — чайная столица Японии. Павильон Феникса Бёдо-ин, старейший синтоистский храм Удзигами и прогулка по чайным улочкам."}
        summary="Удзи небольшой, но каждая точка — первоклассная: Бёдо-ин занесён в список ЮНЕСКО, Удзигами — старейший синтоистский храм Японии, а чайные улочки к ним идут через живой город. Темп спокойный, впечатления сильные."
        intro={seo?.routeIntro}
        duration={tour.duration}
        stops={timelineStops}
        helpers={helperItems}
        transport={transportOptions}
        afterword={<>
    <RouteFaq slug="intercity/uji" />
    <JournalMentions
      routeSlug="intercity/uji"
      poiIds={timelineStops.map((s) => s.poiId).filter((id): id is string => Boolean(id))}
      locationNames={[...timelineStops.map((s) => s.title), 'Удзи']}
      themes={timelineStops.flatMap((s) => [...(s.category ?? []), ...(s.tags ?? [])])}
    />
        </>}
        related={
          <section className={album.related} aria-labelledby="related-tours-title">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Похожие туры</p>
                <h2 id="related-tours-title" className="text-title-sm text-[var(--text)] md:text-title">
                  Маршруты по Кансаю
                </h2>
              </div>
              <a href="/intercity" className="inline-flex min-h-[44px] items-center gap-2 text-body-sm font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]">
                Все загородные туры
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
            <nav aria-label="Похожие загородные туры">
              <div className="grid gap-3 md:grid-cols-3">
                <a
                  key="/intercity/nara"
                  href="/intercity/nara"
                  className={album.relatedLink}
                >
                  <div className="space-y-3">
                    <p className="text-label font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Нара</p>
                    <div className="space-y-1.5">
                      <h3 className="text-lead text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">Тур в Нару</h3>
                      <p className="text-meta font-medium text-[var(--accent)]">олени и Тодайдзи</p>
                    </div>
                    <p className="font-sans text-body-sm font-light leading-[1.75] text-[var(--text-muted)]">Час от Удзи — первая столица Японии с парком оленей.</p>
                  </div>
                  <span className="mt-5 inline-flex items-center gap-2 text-meta font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                    Посмотреть маршрут
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </a>
                <a
                  key="/intercity/kyoto-1"
                  href="/intercity/kyoto-1"
                  className={album.relatedLink}
                >
                  <div className="space-y-3">
                    <p className="text-label font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Киото</p>
                    <div className="space-y-1.5">
                      <h3 className="text-lead text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">Первый день в Киото</h3>
                      <p className="text-meta font-medium text-[var(--accent)]">Кинкакудзи и Гион</p>
                    </div>
                    <p className="font-sans text-body-sm font-light leading-[1.75] text-[var(--text-muted)]">Основная программа рядом — удобно делать вместе.</p>
                  </div>
                  <span className="mt-5 inline-flex items-center gap-2 text-meta font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                    Посмотреть маршрут
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </a>
                <a
                  key="/intercity/osaka"
                  href="/intercity/osaka"
                  className={album.relatedLink}
                >
                  <div className="space-y-3">
                    <p className="text-label font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Осака</p>
                    <div className="space-y-1.5">
                      <h3 className="text-lead text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">Тур в Осаку</h3>
                      <p className="text-meta font-medium text-[var(--accent)]">городская энергия</p>
                    </div>
                    <p className="font-sans text-body-sm font-light leading-[1.75] text-[var(--text-muted)]">Другой ритм — живая Осака с замком и Дотонбори.</p>
                  </div>
                  <span className="mt-5 inline-flex items-center gap-2 text-meta font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                    Посмотреть маршрут
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </a>
              </div>
            </nav>
          </section>
        }
    />
  </>
}
