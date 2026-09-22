import { buildTourCollectionMetadata } from '@/lib/tour-collection-metadata'
import { buildTourOffer, serializeTourSchema, describeTourDuration } from '@/lib/tour-schema'
import { MultiDayRouteCard } from '@/components/sections/MultiDayRouteCard'
import { TourCollection, TourCollectionSection, TourCollectionGrid, TourCollectionTransport, TourCollectionContact } from '@/components/sections/TourCollection'
import { multiDayRouteCards, type MultiDayRouteCardSpec } from '@/data/multiDayRouteCards'
import { tours } from '@/data/tours'
import { cityNameRu } from '@/lib/city-names'
import { listSavedMultiDayRoutesCached } from '@/lib/multi-day-builder-storage'
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

/**
 * Запасная обложка для программ конструктора без своего фото.
 *
 * Раньше здесь стоял `/dest-multi-day-journeys-hero-20260421c.jpg` — тот же
 * файл, что у героя этой страницы и у карточки «Горная Япония». Из-за этого
 * две программы без обложки выходили на витрину неотличимыми и от героя,
 * и от кураторского тура (аудит 2026-07-27). Здесь должен стоять снимок,
 * которого на /multi-day больше нигде нет.
 *
 * Настоящее решение — проставить обложки в Airtable (Routes.Hero Image);
 * запасной вариант нужен, чтобы витрина не разъезжалась, пока их нет.
 */
const DEFAULT_ROUTE_CARD_IMAGE = '/tours/kyoto-2/kyoto-autumn-pagoda.jpg'

/**
 * Витрина многодневных программ — самый дорогой продукт сайта, и её
 * смотрят, сравнивая с агентством. Аудит 2026-07-27 нашёл на ней три
 * карточки с одной и той же фотографией, две из них с идентичным
 * описанием (при этом одна подписана «10 дней», другая «7 дней»).
 *
 * Инвариант простой: одна обложка — одна карточка. Две неотличимые
 * карточки в сетке означают незаполненные данные, а не выбор, который
 * стоит показывать клиенту.
 *
 * Оставляем первую, остальные отбрасываем и пишем в лог, чтобы дубль
 * было видно в Vercel, а не только глазами на проде.
 */
function dedupeRouteCards(cards: MultiDayRouteCardSpec[]): MultiDayRouteCardSpec[] {
  // Preview must show every published program, even before its cover is selected.
  if (process.env.VERCEL_ENV === 'preview') return cards
  const seen = new Map<string, string>()
  const kept: MultiDayRouteCardSpec[] = []
  const dropped: string[] = []

  // Кураторские маршруты занимают свои обложки первыми: программа из
  // конструктора не должна вытеснить «Классическую» или «Горную Японию»
  // только потому, что рендерится выше по сетке.
  for (const curated of multiDayRouteCards) {
    seen.set(curated.image, curated.slug)
  }

  for (const card of cards) {
    const owner = seen.get(card.image)
    if (owner) {
      dropped.push(`${card.slug} (та же обложка, что у ${owner})`)
      continue
    }
    seen.set(card.image, card.slug)
    kept.push(card)
  }

  if (dropped.length > 0) {
    console.warn(
      `[multi-day] Скрыты карточки-дубли по обложке: ${dropped.join(', ')}. ` +
        'Проставить отдельные обложки в Airtable (Routes → Hero Image).',
    )
  }

  return kept
}

export default async function MultiDayPage() {
  const savedRoutes = await listSavedMultiDayRoutesCached().catch((error: unknown) => {
    if (process.env.VERCEL_ENV === 'preview') throw error
    return []
  })
  // Каждая опубликованная в конструкторе программа выводится в том же
  // формате карточек, что и статические маршруты (решение владельца).
  const publishedCards = dedupeRouteCards(
    savedRoutes
      .filter((route) => route.status === 'Published' && route.slug.startsWith('multi-day/'))
      .map((route) => {
        const startCity = cityNameRu(route.startCity)
        const endCity = cityNameRu(route.endCity)
        return {
          title: route.title,
          description: route.previewSubtitle || 'Маршрут, собранный как цельное путешествие.',
          durationLabel: pluralDays(route.dayCount),
          slug: route.slug,
          image: route.heroImagePath || DEFAULT_ROUTE_CARD_IMAGE,
          startCity: startCity || '—',
          regionCountLabel: startCity && endCity ? `${startCity} → ${endCity}` : '—',
          regionLabelText: 'Маршрут',
          // Канон видов транспорта (2026-07-11): большие переезды — ЖД,
          // на месте — частный транспорт («автомобиль с гидом» запрещён, юридика).
          transportModes: ['train', 'car'] as ('train' | 'car')[],
          transportLabel: 'ЖД + частный транспорт',
        }
      }),
  )

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
            {multiDayRouteCards.map((route) => <MultiDayRouteCard key={route.slug} {...route} />)}
          </TourCollectionGrid>
        </TourCollectionSection>
        <TourCollectionTransport options={transportFormats} />
        <TourCollectionContact custom />
      </TourCollection>
    </>
  )
}
