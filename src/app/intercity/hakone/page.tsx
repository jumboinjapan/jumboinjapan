import { TourAlbumCover } from '@/components/sections/TourAlbum'
import { buildTourOffer, serializeTourSchema, describeTourDuration } from '@/lib/tour-schema'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { IntercityRouteTimeline, type IntercityRouteStop } from '@/components/IntercityRouteTimeline'
import Image from 'next/image'
import { Cormorant_Garamond } from 'next/font/google'
import styles from '@/components/sections/TourAlbum.module.css'
import { tours } from '@/data/tours'
import { getMultiDayRouteSeoFieldsCached } from '@/lib/multi-day-builder-storage'
import { getRouteContent } from '@/lib/route-content'
import { buildIntercityRouteStopsFromAirtable, buildHelperPoisFromAirtable } from '@/lib/intercity-pois'
import { TourAdditions, type TourAddition } from '@/components/sections/TourAdditions'
import { hakoneLunch, hakoneMuseumPoiIds, hakoneOnsen } from '@/data/hakone-additions'
import { buildTicketDisplay } from '@/lib/ticket-display'
import { formatWorkingHoursForRouteCard } from '@/lib/working-hours'
import { guideRef } from '@/lib/schema'
import { RouteFaq } from '@/components/sections/RouteFaq'
import { JournalMentions } from '@/components/sections/JournalMentions'
import { typoDeep } from '@/lib/typography'

export const revalidate = 3600 // ISR: Airtable-backed (tags 'airtable:routes'/'airtable:pois', invalidated via /api/revalidate on admin write)

const albumFont = Cormorant_Garamond({ subsets: ['latin', 'cyrillic'], weight: ['400', '500'], style: ['normal', 'italic'], display: 'swap', variable: '--font-album' })

const tour = tours.find((t) => t.slug === 'intercity/hakone')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/${tour.slug}`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getMultiDayRouteSeoFieldsCached(tour.slug)
  const title = seo?.seoTitle || tour.title
  const description = seo?.seoDescription || tour.description

  return {
  title: title,
  description: description,
  alternates: {
    canonical: 'https://jumboinjapan.com/intercity/hakone',
  },
  openGraph: {
    title: `${title} | JumboInJapan`,
    description: description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Тур в Хаконе — озеро Аси, Овакудани, канатная дорога' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${title} | JumboInJapan`,
    description: description,
    images: [PAGE_IMAGE],
  },
}
}

const tourSchema = typoDeep({
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
  itinerary: {
    '@type': 'ItemList',
    itemListElement: typoDeep([
      'Застава Хаконе Сэкисё',
      'Хаконе Дзиндзя',
      'Канатная дорога Хаконе',
      'Овакудани',
      'Музей под открытым небом Хаконе',
    ]).map((stop, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: { '@type': 'TouristAttraction', name: stop },
    })),
  },
})

const breadcrumbSchema = typoDeep({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Главная',
      item: BASE_URL,
    },
    {
      '@type': 'ListItem',
      position: 2,
      name: 'Маршруты из Токио',
      item: `${BASE_URL}/intercity`,
    },
    {
      '@type': 'ListItem',
      position: 3,
      name: tour.title,
      item: PAGE_URL,
    },
  ],
})


export default async function HakonePage() {
  const { routeStopRecords, pois } = await getRouteContent('intercity/hakone', hakoneMuseumPoiIds)

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

  // Local, verified photographs; constructor selections take precedence.
  const albumPhotos: Record<string, Pick<IntercityRouteStop, 'photoPath' | 'photoAlt' | 'photoCredit'>> = {
    'POI-000054': {
      photoPath: '/tours/hakone/hakone-checkpoint-commons.jpg',
      photoAlt: 'Здания заставы Хаконе на берегу озера Аси, вид со смотровой площадки',
      photoCredit: {
        author: 'Celuici',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:View_above_Hakone_Checkpoint_Museum,_May_2017.jpg',
        license: 'CC BY-SA 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
      },
    },
    'POI-000041': { photoPath: '/tours/hakone/hakone-shrine.webp', photoAlt: 'Каменная лестница к святилищу Хаконе среди высоких деревьев и красных фонарей' },
    'POI-000047': { photoPath: '/tours/hakone/hakone-ropeway.png', photoAlt: 'Кабины канатной дороги Хаконе над лесом на фоне горы Фудзи' },
    'POI-000039': {
      photoPath: '/tours/hakone/hakone-owakudani-commons.jpg',
      photoAlt: 'Кабина канатной дороги над парящей вулканической долиной Овакудани',
      photoCredit: {
        author: 'TLV and more',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Owakudani%27s_cable_car,_Japan;_October_2017.jpg',
        license: 'CC BY 2.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
        note: 'Кадрировано',
      },
    },
    'POI-000038': { photoPath: '/tours/hakone/hakone-2.jpg', photoAlt: 'Витражная башня музея под открытым небом Хаконе' },
  }
  const timelineStops = buildIntercityRouteStopsFromAirtable(routeStopRecords, pois).map((stop) => ({
    ...stop,
    ...(!stop.photoPath && stop.poiId ? albumPhotos[stop.poiId] : {}),
  }))
  const helperItems = buildHelperPoisFromAirtable(routeStopRecords, pois)
  const selectedMuseums = hakoneMuseumPoiIds.flatMap((id) => {
    const poi = pois.find((item) => item.poiId === id)
    return poi ? [poi] : []
  })
  // Preserve configured helper POIs, without repeating selected museums or core stops.
  const mainPoiIds = new Set(timelineStops.map((stop) => stop.poiId))
  const additionPois = Array.from(new Map([
    ...selectedMuseums,
    ...helperItems.map((item) => item.poi),
  ].map((poi) => [poi.poiId, poi])).values()).filter((poi) => !mainPoiIds.has(poi.poiId))
  const additions: TourAddition[] = [
    hakoneOnsen,
    ...additionPois.map((poi) => ({
      id: poi.poiId,
      title: poi.nameRu,
      displayTitle: poi.poiId === 'POI-000042' ? 'Музей Пола' : poi.poiId === 'POI-000367' ? 'Ателье Лалик' : undefined,
      caption: poi.poiId === 'POI-000042' ? 'Художественный музей' : poi.poiId === 'POI-000367' ? 'Музей' : undefined,
      description: poi.approvedRu || poi.descriptionRu,
      website: poi.website,
      note: helperItems.find((item) => item.poi.poiId === poi.poiId)?.criteriaLabel,
      workingHours: formatWorkingHoursForRouteCard(poi.workingHours) || undefined,
      tickets: buildTicketDisplay(poi.tickets).lines,
    })),
  ]

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeTourSchema(tourSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />

      <div className={`${albumFont.variable} ${styles.album}`}>
        <div className={styles.container}>
          <TourAlbumCover stops={timelineStops.map((stop, index) => ({ title: stop.title, href: `#route-stop-${index + 1}` }))} travelTime="1,5–2 часа" section="intercity" title={seo?.routeTitle || tour.shortTitle}
            subtitle={seo?.previewSubtitle || "Горы. Вода. Искусство."} duration="Около 10 часов"
            summary="День в Хаконе зависит от погоды, расписания местного транспорта и видимости горы Фудзи. Гид помогает сохранить цельность маршрута и предлагает альтернативы по ситуации."
            intro={seo?.routeIntro} image={seo?.heroImagePath || "/tours/hakone/hakone-hero.jpg"}
            alt="Озеро Аси, красные тории и гора Фудзи" caption="Озеро Аси · Хаконе, Япония" />

          <section id="itinerary" className={styles.program} aria-labelledby="program-title">
            <div className={styles.sectionHead}>
              <h2 id="program-title">День в Хаконе</h2>
            </div>
            <IntercityRouteTimeline stops={timelineStops} variant="album" />
          </section>

          <TourAdditions additions={additions} lunch={hakoneLunch} />

          <section className={styles.transport} aria-labelledby="transport-title">
            <div className={styles.sectionHead}>
              <h2 id="transport-title">Как лучше ехать</h2>
              <p>Три формата поездки</p>
            </div>
            <div className={styles.transportGrid}>
              {transportOptions.map(({ title, summary, href, image }) => (
                <Link key={title} href={href} className={styles.transportCard}>
                  <div className={styles.transportImage}><Image src={image} alt="" fill quality={90} sizes="(max-width: 767px) 100vw, 33vw" /></div>
                  <h3>{title}<ArrowRight size={18} aria-hidden="true" /></h3>
                  <p>{summary}</p>
                </Link>
              ))}
            </div>
          </section>

          <div id="cta" className="scroll-mt-24 border-t border-[var(--border)] pt-5">
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center gap-2 text-body-sm font-medium text-[var(--text)] underline decoration-[var(--border)] underline-offset-4 transition-colors hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
            >
              Обсудить поездку в Хаконе
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <section className={styles.related} aria-labelledby="related-tours-title">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">
                  Похожие туры
                </p>
                <h2
                  id="related-tours-title"
                  className="text-title-sm text-[var(--text)] md:text-title"
                >
                  Другие маршруты из Токио
                </h2>
              </div>
              <a
                href="/intercity"
                className="inline-flex min-h-[44px] items-center gap-2 text-body-sm font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"
              >
                Все загородные туры
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
            <nav aria-label="Похожие загородные туры">
              <div className="grid gap-3 md:grid-cols-3">
                {typoDeep([
                  {
                    title: 'Камакура',
                    tourTitle: 'Тур в Камакуру',
                    href: '/intercity/kamakura',
                    diff: 'море и храмы',
                    description: 'Спокойный день у океана с храмами, бамбуком и старой столичной атмосферой.',
                  },
                  {
                    title: 'Никко',
                    tourTitle: 'Экскурсия в Никко',
                    href: '/intercity/nikko',
                    diff: 'история и горный лес',
                    description: 'Более торжественный маршрут: святилища, кедры, горный воздух и длинная историческая линия.',
                  },
                  {
                    title: 'Гора Фудзи',
                    tourTitle: 'Однодневный тур на Фудзи',
                    href: '/intercity/fuji',
                    diff: 'вулкан и большая панорама',
                    description: 'День ради масштаба: озёра, виды на Фудзи и ощущение большого японского пейзажа.',
                  },
                ]).map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className={styles.relatedLink}
                  >
                    <div className="space-y-3">
                      <p className="text-label font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        {link.title}
                      </p>
                      <div className="space-y-1.5">
                        <h3 className="text-lead text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">
                          {link.tourTitle}
                        </h3>
                        <p className="text-meta font-medium text-[var(--accent)]">{link.diff}</p>
                      </div>
                      <p className="font-sans text-body-sm font-light leading-[1.75] text-[var(--text-muted)]">
                        {link.description}
                      </p>
                    </div>
                    <span className="mt-5 inline-flex items-center gap-2 text-meta font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                      Посмотреть маршрут
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </a>
                ))}
              </div>
            </nav>
          </section>
        </div>
    <div className={styles.faq}><RouteFaq slug="intercity/hakone" /></div>
    <JournalMentions
      routeSlug="intercity/hakone"
      poiIds={timelineStops.map((s) => s.poiId).filter((id): id is string => Boolean(id))}
      locationNames={[...timelineStops.map((s) => s.title), 'Хаконе']}
      themes={timelineStops.flatMap((s) => [...(s.category ?? []), ...(s.tags ?? [])])}
    />
      </div>
      </>
  )
}
