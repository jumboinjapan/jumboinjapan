import { IntercityTourAlbum } from '@/components/sections/IntercityTourAlbum'
import type { IntercityRouteStop } from '@/components/IntercityRouteTimeline'
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

const tour = tours.find((t) => t.slug === 'intercity/nikko')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/intercity/nikko`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getMultiDayRouteSeoFieldsCached(tour.slug)
  const title = seo?.seoTitle || tour.title
  const description = seo?.seoDescription || tour.description

  return {
  title: title,
  description: description,
  alternates: { canonical: 'https://jumboinjapan.com/intercity/nikko' },
  openGraph: {
    title: `${title} | JumboInJapan`,
    description: description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Каменные Дзидзо в красных шапочках, ущелье Канмангафути, Никко' }],
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


export default async function NikkoPage() {
  const { routeStopRecords, pois } = await getRouteContent('intercity/nikko')

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

  // Owner-supplied photographs; an explicit constructor selection still wins.
  const albumPhotos: Record<string, Pick<IntercityRouteStop, 'photoPath' | 'photoAlt'>> = {
    'POI-000227': { photoPath: '/tours/nikko/nikko-shinkyo-bridge.webp', photoAlt: 'Красный мост Синкё над рекой в туманном ущелье Никко' },
    'POI-000217': { photoPath: '/tours/nikko/nikko-toshogu.webp', photoAlt: 'Деталь богато украшенных ворот святилища Тосёгу в Никко' },
    'POI-000159': { photoPath: '/tours/nikko/nikko-kanmangafuchi-jizo.webp', photoAlt: 'Каменные статуи Дзидзо в красных шапочках вдоль лесной тропы в Никко' },
    'POI-000220': { photoPath: '/tours/nikko/nikko-lake-chuzenji.webp', photoAlt: 'Озеро Тюдзэндзи среди лесистых гор Никко' },
    'POI-000225': { photoPath: '/tours/nikko/nikko-kegon-falls.webp', photoAlt: 'Водопад Кэгон среди осенних скал и тумана в Никко' },
  }
  const timelineStops = buildIntercityRouteStopsFromAirtable(routeStopRecords, pois).map((stop) => ({
    ...stop,
    ...(!stop.photoPath && stop.poiId ? albumPhotos[stop.poiId] : {}),
  }))
  const helperItems = buildHelperPoisFromAirtable(routeStopRecords, pois)

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeTourSchema(tourSchema) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeTourSchema(breadcrumbSchema) }} />
    <IntercityTourAlbum
        title={seo?.routeTitle || tour.shortTitle}
        image={seo?.heroImagePath || "/tours/nikko/kanmangafuchi-jizo.jpg"}
        alt="Каменные Дзидзо в красных шапочках, ущелье Канмангафути, Никко"
        subtitleDetailIsStopList={!seo?.previewSubtitle}
        subtitle={seo?.previewSubtitle || "Никко — горная Япония в двух часах от Токио. Святилище Тосёгу, водопад Кэгон, озеро Тюдзэндзи и аллея исчезающих Будд."}
        objectPosition="top"
        summary="Никко требует раннего старта: Тосёгу, водопад и озеро укладываются в один длинный день, но без ориентиров — легко потерять час на переездах. Гид держит темп и добавляет исторический контекст, который делает визит к святилищу больше, чем осмотр."
        intro={seo?.routeIntro}
        duration={tour.duration}
        stops={timelineStops}
        helpers={helperItems}
        transport={transportOptions}
        afterword={<>
    <RouteFaq slug="intercity/nikko" />
    <JournalMentions
      routeSlug="intercity/nikko"
      poiIds={timelineStops.map((s) => s.poiId).filter((id): id is string => Boolean(id))}
      locationNames={[...timelineStops.map((s) => s.title), 'Никко']}
      themes={timelineStops.flatMap((s) => [...(s.category ?? []), ...(s.tags ?? [])])}
    />
        </>}
        related={
          <section className={album.related} aria-labelledby="related-tours-title">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Похожие туры</p>
                <h2 id="related-tours-title" className="text-title-sm text-[var(--text)] md:text-title">
                  Другие загородные туры из Токио
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
                  key="/intercity/hakone"
                  href="/intercity/hakone"
                  className={album.relatedLink}
                >
                  <div className="space-y-3">
                    <p className="text-label font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Хаконе</p>
                    <div className="space-y-1.5">
                      <h3 className="text-lead text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">Тур в Хаконе</h3>
                      <p className="text-meta font-medium text-[var(--accent)]">вулкан и озеро</p>
                    </div>
                    <p className="font-sans text-body-sm font-light leading-[1.75] text-[var(--text-muted)]">Другой горный день — с Овакудани, канатной дорогой и онсэном.</p>
                  </div>
                  <span className="mt-5 inline-flex items-center gap-2 text-meta font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                    Посмотреть маршрут
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </a>
                <a
                  key="/intercity/kamakura"
                  href="/intercity/kamakura"
                  className={album.relatedLink}
                >
                  <div className="space-y-3">
                    <p className="text-label font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Камакура</p>
                    <div className="space-y-1.5">
                      <h3 className="text-lead text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">Тур в Камакуру</h3>
                      <p className="text-meta font-medium text-[var(--accent)]">море и храмы</p>
                    </div>
                    <p className="font-sans text-body-sm font-light leading-[1.75] text-[var(--text-muted)]">Более спокойный прибрежный маршрут с самурайской историей.</p>
                  </div>
                  <span className="mt-5 inline-flex items-center gap-2 text-meta font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                    Посмотреть маршрут
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </a>
                <a
                  key="/intercity/fuji"
                  href="/intercity/fuji"
                  className={album.relatedLink}
                >
                  <div className="space-y-3">
                    <p className="text-label font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Гора Фудзи</p>
                    <div className="space-y-1.5">
                      <h3 className="text-lead text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">Однодневный тур на Фудзи</h3>
                      <p className="text-meta font-medium text-[var(--accent)]">вулкан и панорама</p>
                    </div>
                    <p className="font-sans text-body-sm font-light leading-[1.75] text-[var(--text-muted)]">Главный символ Японии — день с видами на Фудзи с разных точек.</p>
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
