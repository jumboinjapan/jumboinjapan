import Link from 'next/link'
import { MultiDayRouteCard } from '@/components/sections/MultiDayRouteCard'
import { TransportCard } from '@/components/sections/TransportCard'
import { PageHero } from '@/components/sections/PageHero'
import { multiDayRouteCards, type MultiDayRouteCardSpec } from '@/data/multiDayRouteCards'
import { tours } from '@/data/tours'
import { cityNameRu } from '@/lib/city-names'
import { listSavedMultiDayRoutesCached } from '@/lib/multi-day-builder-storage'
import { pluralDays } from '@/lib/plural'
import { guideRef } from '@/lib/schema'
import { buildPageMetadata } from '@/lib/page-metadata'

export const revalidate = 3600 // ISR; tag-invalidated on builder saves

const tour = tours.find((t) => t.slug === 'multi-day')!

export const metadata = buildPageMetadata('/multi-day', {
  title: tour.title,
  description: tour.description,
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    images: [{ url: tour.image }],
  },
})

const tourSchema = {
  '@context': 'https://schema.org',
  '@type': 'TouristTrip',
  name: tour.titleEn,
  description: tour.description,
  touristType: 'Russian-speaking tourists',
  provider: guideRef,
  offers: {
    '@type': 'Offer',
    availability: 'https://schema.org/InStock',
    url: `https://jumboinjapan.com/${tour.slug}`,
  },
}

const philosophy = [
  'Важнейший фактор при выборе маршрута — то, сколько времени вы хотели бы провести в стране.',
  'Охват географии тесно связан с ритмом поездки. Смена отелей, расстояния и сам выбор локаций делают этот фактор самым важным и сложным.',
  'Выбор точки входа и выхода может сильно помочь в формировании маршрута. Как правило, это Токио и Осака, но выбор может быть значительно шире.',
] as const

const transportFormats = [
  {
    title: 'Общественный транспорт',
    description:
      'Общественный транспорт требует выстраивать маршрут вокруг движения поездов и автобусов и отдельно организовывать отправку крупногабаритного багажа между городами. Формат подходит высокомобильным группам с приоритетом на бюджет.',
    href: '/intercity/public',
    image: '/city-tour-transport-public-v2.jpg',
    imageDisplay: 'hero' as const,
  },
  {
    title: 'Частный транспорт',
    description:
      'Транспорт по договорённости — ядро многодневного маршрута: багаж всегда с вами, дорога между городами становится частью программы, а план легко подстраивается по ходу поездки.',
    href: '/intercity/private',
    image: '/city-tour-transport-private-v4.jpg',
    imageDisplay: 'hero' as const,
  },
  {
    title: 'Заказной транспорт',
    description:
      'Лимузин-сервис подключается на отдельные дни и переезды — просторный минивэн там, где группе важно ехать всем вместе и с комфортом.',
    href: '/city-tour/charter',
    image: '/city-tour-transport-limousine-v2.jpg',
    imageDisplay: 'hero' as const,
  },
]

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
  const savedRoutes = await listSavedMultiDayRoutesCached().catch(() => [])
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />

      <PageHero
        image="/dest-multi-day-journeys-hero-20260421c.jpg"
        eyebrow="Многодневные туры"
        title="Маршруты по Японии на несколько дней"
        subtitle="Примеры популярных маршрутов, собранных как цельное путешествие, — или индивидуальный тур с нуля."
      />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-14 md:space-y-16">
          <section className="max-w-4xl space-y-4">
            <p className="text-label font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Выбор маршрута</p>
            <h2 className="text-3xl font-medium text-[var(--text)] md:text-4xl">
              Маршрут — больше, чем список точек на карте. Это решение о том, какую Японию вы хотите узнать.
            </h2>
          </section>

          <section className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
            {publishedCards.map((route) => (
              <MultiDayRouteCard key={route.slug} {...route} />
            ))}
            {multiDayRouteCards.map((route) => (
              <MultiDayRouteCard key={route.slug} {...route} />
            ))}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 md:p-8">
            <div className="grid gap-8 md:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] md:gap-10">
              <div className="space-y-5">
                <p className="text-label font-medium uppercase tracking-[0.18em] text-[var(--accent)]">По какому принципу строится маршрут</p>
                <div className="space-y-4">
                  {philosophy.map((item) => (
                    <p key={item} className="text-body-sm font-light leading-[1.85] text-[var(--text-muted)]">
                      {item}
                    </p>
                  ))}
                </div>
              </div>
              <div className="space-y-4 border-t border-[var(--border)] pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
                <p className="text-label font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Как читать раздел</p>
                <p className="text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">
                  Здесь собраны ключевые форматы больших поездок. Новые шаблоны будут появляться, а маршрут и наполнение подстраиваются под вашу группу.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <h2 className="font-medium text-xl text-[var(--text-muted)]">Варианты логистики</h2>
            <div className="grid gap-10 md:grid-cols-3">
              {transportFormats.map((option) => (
                <TransportCard key={option.title} {...option} />
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-8 space-y-4">
            <p className="text-label font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Индивидуальный маршрут</p>
            <h2 className="text-xl font-medium">Ни один из готовых маршрутов не попал точно в вашу поездку?</h2>
            <p className="max-w-2xl text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">
              Это нормальная ситуация. Иногда правильное решение не выбирать из готового, а собрать маршрут вокруг ваших дат, состава группы, интересов и нужного темпа.
            </p>
            <Link
              href="/multi-day/custom"
              className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--accent)] px-5 py-2.5 text-body-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
            >
              Собрать свой маршрут
            </Link>
          </section>
        </div>
      </section>
    </>
  )
}
