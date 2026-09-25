import { buildTourCollectionMetadata } from '@/lib/tour-collection-metadata'
import { buildTourOffer, serializeTourSchema, describeTourDuration } from '@/lib/tour-schema'
import { MultiDayRouteCard } from '@/components/sections/MultiDayRouteCard'
import { TourCollection, TourCollectionSection, TourCollectionGrid, TourCollectionTransport, TourCollectionContact } from '@/components/sections/TourCollection'
import { multiDayRouteCards } from '@/data/multiDayRouteCards'
import { tours } from '@/data/tours'
import { cityNameRu } from '@/lib/city-names'
import { listRouteRegistry, requirePublicRoute } from '@/lib/route-registry'
import { isPublicRoute } from '@/lib/route-publication'
import { pluralDays } from '@/lib/plural'
import { guideRef } from '@/lib/schema'
import { typoDeep } from '@/lib/typography'

export const revalidate = 3600 // ISR; tag-invalidated on builder saves

const tour = tours.find((t) => t.slug === 'multi-day')!

export const metadata = buildTourCollectionMetadata(
  '/multi-day',
  'Многодневные туры по Японии с гидом на русском',
  'Индивидуальные многодневные туры по Японии с русскоязычным гидом. Классические и горные маршруты, города и переезды в удобном вам темпе.',
  '/hero-multi-day-miyajima.jpg',
  'Ворота святилища Ицукусима у острова Миядзима',
)

const tourSchema = {
  '@context': 'https://schema.org',
  '@type': 'TouristTrip',
  '@id': `https://jumboinjapan.com/${tour.slug}` + '#trip',
  url: `https://jumboinjapan.com/${tour.slug}`,
  name: tour.titleEn,
  description: tour.description,
  disambiguatingDescription: describeTourDuration(tour.duration),
  touristType: 'Russian-speaking tourists',
  provider: guideRef,
  offers: buildTourOffer(`https://jumboinjapan.com/${tour.slug}`),
}

const transportFormats = typoDeep([
  {
    title: 'Общественный транспорт',
    description:
      'Поезда и автобусы между городами. Маршрут учитывает расписания; отправку крупного багажа планируем отдельно.',
    href: '/intercity/public',
    image: '/city-tour-transport-public-v2.jpg',
    imageDisplay: 'hero' as const,
  },
  {
    title: 'Частный транспорт',
    description:
      'Транспорт по договорённости: багаж с вами, остановки по пути и возможность менять план в ходе поездки.',
    href: '/intercity/private',
    image: '/city-tour-transport-private-v4.jpg',
    imageDisplay: 'hero' as const,
  },
  {
    title: 'Заказной транспорт',
    description:
      'Лимузин-сервис на отдельные дни и переезды. Просторный минивэн там, где группе важно ехать вместе.',
    href: '/city-tour/charter',
    image: '/city-tour-transport-limousine-v2.jpg',
    imageDisplay: 'hero' as const,
  },
])

// Shared covers are allowed; identity and publication are determined by the registry.
const DEFAULT_ROUTE_CARD_IMAGE = '/tours/kyoto-2/kyoto-autumn-pagoda.jpg'

export default async function MultiDayPage() {
  await requirePublicRoute('multi-day', 'Collection')
  const records = await listRouteRegistry()
  const publishedCards = records
    .filter(route => isPublicRoute(route, 'Tour') && route.routeType === 'multi-day')
    .map(route => {
      const startCity = cityNameRu(route.startCity)
      const endCity = cityNameRu(route.endCity)
      return {
        title: route.title, description: route.description || 'Маршрут, собранный как цельное путешествие.',
        durationLabel: pluralDays(route.dayCount), slug: route.slug,
        image: route.image || DEFAULT_ROUTE_CARD_IMAGE, startCity: startCity || '—',
        regionCountLabel: startCity && endCity ? `${startCity} → ${endCity}` : '—', regionLabelText: 'Маршрут',
        transportModes: ['train', 'car'] as ('train' | 'car')[], transportLabel: 'ЖД + частный транспорт',
      }
    })
  const ideas = multiDayRouteCards.filter(card => isPublicRoute(records.find(r => r.slug === card.slug), 'Format'))
  const services = multiDayRouteCards.filter(card => isPublicRoute(records.find(r => r.slug === card.slug), 'Service'))

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeTourSchema(tourSchema) }} />

      <TourCollection
        image="/hero-multi-day-miyajima.jpg"
        alt="Ворота святилища Ицукусима в воде у острова Миядзима"
        eyebrow="Индивидуальные многодневные туры"
        title="По Японии, в своём ритме"
        subtitle="Несколько городов в одном путешествии с русскоязычным гидом. Готовый маршрут как отправная точка — или поездка с нуля."
      >
        <TourCollectionSection id="routes" title="Какая Япония вам ближе"
          description="Начинаем с дат и городов прилёта и вылета. Затем выбираем места и переезды: сколько времени провести в пути и как часто менять отели.">
          <TourCollectionGrid>
            {publishedCards.map((route) => <MultiDayRouteCard key={route.slug} {...route} />)}
          </TourCollectionGrid>
        </TourCollectionSection>
        {ideas.length > 0 && <TourCollectionSection id="ideas" title="Идеи путешествий"
          description="Возможные направления поездки. Подробную программу и остановки составим под ваши даты и интересы.">
          <TourCollectionGrid>{ideas.map(route => <MultiDayRouteCard key={route.slug} {...route} />)}</TourCollectionGrid>
        </TourCollectionSection>}
        {services.length > 0 && <TourCollectionSection id="custom" title="Индивидуальная программа" description="Составим путешествие под вашу группу.">
          <TourCollectionGrid>{services.map(route => <MultiDayRouteCard key={route.slug} {...route} />)}</TourCollectionGrid>
        </TourCollectionSection>}
        <TourCollectionTransport options={transportFormats.filter(option => isPublicRoute(records.find(r => `/${r.slug}` === option.href), 'Service'))} />
        <TourCollectionContact custom />
      </TourCollection>
    </>
  )
}
