import { IntercityTourAlbum } from '@/components/sections/IntercityTourAlbum'
import album from '@/components/sections/TourAlbum.module.css'
import { buildTourOffer, serializeTourSchema, describeTourDuration } from '@/lib/tour-schema'
import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { tours } from '@/data/tours'
import { getMultiDayRouteSeoFieldsCached } from '@/lib/multi-day-builder-storage'
import { getIntercityRouteStopsCached, getPoisByCityCached } from '@/lib/airtable'
import { buildIntercityRouteStopsFromAirtable, buildHelperPoisFromAirtable } from '@/lib/intercity-pois'
import { guideRef } from '@/lib/schema'
import { RouteFaq } from '@/components/sections/RouteFaq'
import { JournalMentions } from '@/components/sections/JournalMentions'
import { typoDeep } from '@/lib/typography'

export const revalidate = 3600 // ISR: Airtable-backed (tags 'airtable:routes'/'airtable:pois', invalidated via /api/revalidate on admin write)

const tour = tours.find((t) => t.slug === 'intercity/himeji')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/intercity/himeji`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getMultiDayRouteSeoFieldsCached(tour.slug)
  const title = seo?.seoTitle || tour.title
  const description = seo?.seoDescription || tour.description

  return {
  title: title,
  description: description,
  alternates: { canonical: 'https://jumboinjapan.com/intercity/himeji' },
  openGraph: {
    title: `${title} | JumboInJapan`,
    description: description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Замок Белой Цапли Химэдзи среди цветущей сакуры' }],
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


export default async function HimejiPage() {
  const [routeStopRecords, pois] = await Promise.all([
    getIntercityRouteStopsCached('intercity/himeji'),
    getPoisByCityCached('himeji'),
  ])

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
        title={tour.shortTitle}
        image="/tours/himeji/himeji-castle-sakura.jpg"
        alt="Замок Белой Цапли Химэдзи среди цветущей сакуры"
        subtitle="Химэдзи — лучший сохранившийся замок Японии. Объект ЮНЕСКО с семью уровнями башни и садом Кокоэн у стен."
        summary="Химэдзи строится вокруг замка, и это не слабость маршрута — замок Белой Цапли настолько детален и масштабен, что хватает на полдня. Гид добавляет исторический контекст Сэнгоку и помогает читать архитектурный замысел."
        intro={seo?.routeIntro}
        duration={tour.duration}
        stops={timelineStops}
        helpers={helperItems}
        transport={transportOptions}
        afterword={<>
    <RouteFaq slug="intercity/himeji" />
    <JournalMentions
      routeSlug="intercity/himeji"
      poiIds={timelineStops.map((s) => s.poiId).filter((id): id is string => Boolean(id))}
      locationNames={[...timelineStops.map((s) => s.title), 'Химэдзи']}
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
                  key="/intercity/osaka"
                  href="/intercity/osaka"
                  className={album.relatedLink}
                >
                  <div className="space-y-3">
                    <p className="text-label font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Осака</p>
                    <div className="space-y-1.5">
                      <h3 className="text-lead text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">Тур в Осаку</h3>
                      <p className="text-meta font-medium text-[var(--accent)]">городская жизнь</p>
                    </div>
                    <p className="font-sans text-body-sm font-light leading-[1.75] text-[var(--text-muted)]">Контрастный день — живая Осака с замком, рынком и Дотонбори.</p>
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
                      <p className="text-meta font-medium text-[var(--accent)]">классическая Япония</p>
                    </div>
                    <p className="font-sans text-body-sm font-light leading-[1.75] text-[var(--text-muted)]">Кинкакудзи, Рёандзи, Гион — первое знакомство со старой столицей.</p>
                  </div>
                  <span className="mt-5 inline-flex items-center gap-2 text-meta font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                    Посмотреть маршрут
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </a>
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
                    <p className="font-sans text-body-sm font-light leading-[1.75] text-[var(--text-muted)]">Первая столица Японии с парком оленей и Большим Буддой.</p>
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
