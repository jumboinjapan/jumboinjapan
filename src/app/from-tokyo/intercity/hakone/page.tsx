import type { Metadata } from 'next'
import {
  CarFront,
  TrainFront,
  UserRound,
} from 'lucide-react'
import { RouteAccordion } from '@/components/RouteAccordion'
import { ImageCarousel } from '@/components/sections/ImageCarousel'
import { tours } from '@/data/tours'
import { getCityData, getHakonePois } from '@/lib/airtable'

const tour = tours.find((t) => t.slug === 'from-tokyo/intercity/hakone')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/${tour.slug}`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  alternates: {
    canonical: 'https://jumboinjapan.com/from-tokyo/intercity/hakone',
  },
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Тур в Хаконэ — озеро Аси, Овакудани, канатная дорога' }],
  },
}

const schematicRoute = [
  'Застава Хаконэ Сэкисё',
  'Хаконэ Дзиндзя',
  'Круиз по озеру Аси',
  'Канатная дорога Хаконэ',
  'Овакудани',
  'Музей под открытым небом Хаконэ',
]

const tourSchema = {
  '@context': 'https://schema.org',
  '@type': 'TouristTrip',
  name: tour.title,
  alternateName: tour.titleEn,
  description: tour.description,
  inLanguage: 'ru',
  image: PAGE_IMAGE,
  url: PAGE_URL,
  duration: 'P1D',
  touristType: 'Russian-speaking tourists',
  provider: {
    '@type': 'Person',
    name: 'Eduard Revidovich',
    url: BASE_URL,
  },
  offers: {
    '@type': 'Offer',
    availability: 'https://schema.org/InStock',
    url: PAGE_URL,
  },
  location: {
    '@type': 'Place',
    name: 'Хаконэ',
    address: { '@type': 'PostalAddress', addressRegion: 'Канагава', addressCountry: 'JP' },
  },
  itinerary: {
    '@type': 'ItemList',
    itemListElement: schematicRoute.map((stop, i) => ({ '@type': 'ListItem', position: i + 1, name: stop })),
  },
}

const breadcrumbSchema = {
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
      name: 'Из Токио',
      item: `${BASE_URL}/from-tokyo`,
    },
    {
      '@type': 'ListItem',
      position: 3,
      name: 'Загородные туры',
      item: `${BASE_URL}/from-tokyo/intercity`,
    },
    {
      '@type': 'ListItem',
      position: 4,
      name: tour.title,
      item: PAGE_URL,
    },
  ],
}

const fullRouteStops = [
  {
    eyebrow: 'Экскурс в историю',
    title: 'Застава Хаконэ Сэкисё',
    description:
      'Восстановленная застава на тракте Токайдо. В эпоху Эдо (1603–1868) здесь проверяли документы у каждого, кто шёл через горы. Сейчас внутри музей, а вокруг — тот же лес и тот же вид на озеро.',
  },
  {
    eyebrow: 'Святилище у воды',
    title: 'Хаконэ Дзиндзя',
    description:
      'Синтоистское святилище на берегу озера Аси. Красный торий стоит прямо в воде. Сюда приходят пешком через кедровую аллею — пять минут от причала.',
  },
  {
    eyebrow: 'Круиз по озеру',
    title: 'Круиз по озеру Аси',
    description:
      'Получасовой круиз на пароме от одного берега к другому. Если повезёт с погодой — Фудзи встанет прямо по курсу, отражаясь в озере. Причал на той стороне — начало подъёма к Овакудани.',
  },
  {
    eyebrow: 'Подъём',
    title: 'Канатная дорога Хаконэ',
    description:
      'Подъём от озера к Овакудани. Из кабинки открывается кальдера целиком: горные хребты по кругу, долина внизу, озеро позади. Едешь минут двадцать.',
  },
  {
    eyebrow: 'Вулканическая долина',
    title: 'Овакудани',
    description:
      'Активная вулканическая зона: из земли идёт серный пар, в горячих источниках варят чёрные яйца. Пахнет серой, под ногами жёлтая порода.',
  },
  {
    eyebrow: 'Искусство под открытым небом',
    title: 'Музей под открытым небом Хаконэ',
    description:
      'Музей скульптуры на открытом воздухе. После вулканической долины — неожиданно тихо: газоны, работы Генри Мура и Пикассо, горы на горизонте. Хороший способ закончить день без спешки.',
  },
]

const whoItSuits =
  'Для тех, кто уже видел Токио и хочет один день провести иначе — в горах, без городского ритма. Маршрут держит темп, но не торопит: подходит для пары, семьи с детьми постарше, небольшой компании. Гид на русском ведёт день — логистика и контекст на нём.'

const excludedPoiIds = [
  'POI-000054', // Застава Хаконэ Сэкисё
  'POI-000041', // Хаконэ Дзиндзя
  'POI-000047', // Канатная дорога Хаконэ
  'POI-000039', // Овакудани
  'POI-000038', // Музей под открытым небом Хаконэ
]

const fullRoutePoiMap: Record<string, string> = {
  'Застава Хаконэ Сэкисё': 'POI-000054',
  'Хаконэ Дзиндзя': 'POI-000041',
  'Канатная дорога Хаконэ': 'POI-000047',
  'Овакудани': 'POI-000039',
  'Музей под открытым небом Хаконэ': 'POI-000038',
}

export default async function HakonePage() {
  const [pois, cityData] = await Promise.all([
    getHakonePois(),
    getCityData('CTY-0006'),
  ])

  const guideFlexibility = cityData.hasNonCarSegments ? 3 : 4

  const transportOptions = [
    {
      title: 'Общественный транспорт',
      Icon: TrainFront,
      scores: { стоимость: 2, гибкость: 1, комфорт: 2 },
    },
    {
      title: 'Гид-водитель',
      Icon: UserRound,
      scores: { стоимость: 4, гибкость: guideFlexibility, комфорт: 4 },
    },
    {
      title: 'Лимузин-сервис',
      Icon: CarFront,
      scores: { стоимость: 5, гибкость: 5, комфорт: 5 },
    },
  ]
  const poiByPoiId = new Map(pois.map((p) => [p.poiId, p]))
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <div className="mx-auto w-full max-w-6xl space-y-12 md:space-y-14">
        {/* 1. ImageCarousel */}
        <ImageCarousel
          images={['/tours/hakone/hakone-1.jpg', '/tours/hakone/hakone-2.jpg', '/tours/hakone/hakone-3.jpg']}
          alt="Тур в Хаконэ - озеро Аси, Овакудани и канатная дорога"
        />

        {/* 2. Header */}
        <header className="space-y-4 md:space-y-5">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">День и более</p>
          <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">Тур в Хаконэ из Токио</h1>
          <p className="text-sm font-medium tracking-[0.01em] text-[var(--accent)]">
            Тур в Хаконэ из Токио с гидом на русском
          </p>
          <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
            Хаконэ стоит на старом тракте Токайдо, которым ходили между столицами ещё в эпоху Эдо. Горы здесь живые — из земли идёт пар, вулканическая кальдера открывается с канатной дороги, а в ясный день над озером стоит Фудзи. Можно приехать на день из Токио, можно сделать остановку по дороге в Киото — Хаконэ хорошо работает в обоих форматах.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {["Природа и пейзажи", "Термальные источники", "Ночёвка", "Для пар", "Традиции и история"].map((tag) => (
              <span key={tag} className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
                <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                {tag}
              </span>
            ))}
          </div>
        </header>

        {/* 3. Кому подходит */}
        <section className="space-y-4">
          <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
            Кому подходит тур
          </h2>
          <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
            {whoItSuits}
          </p>
        </section>

        {/* 4. Маршрут (аккордеон) */}
        <section className="space-y-6">
          <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
            Маршрут
          </h2>
          <RouteAccordion
            stops={fullRouteStops.map((stop) => {
              const poiId = fullRoutePoiMap[stop.title]
              const airtablePoi = poiId ? poiByPoiId.get(poiId) : undefined
              const description = airtablePoi?.descriptionRu || stop.description
              const minPrice = airtablePoi?.tickets.length ? Math.min(...airtablePoi.tickets.map((t) => t.price)) : null
              return {
                eyebrow: stop.eyebrow,
                title: stop.title,
                description,
                workingHours: airtablePoi?.workingHours,
                minPrice,
              }
            })}
          />
        </section>

        {/* 6. Что включить */}
        <section className="space-y-6">
          <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
            Что можно включить в маршрут
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {pois
              .filter((p) => !excludedPoiIds.includes(p.poiId))
              .map((p) => (
                <div
                  key={p.poiId}
                  className="group flex min-h-[72px] items-center rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--accent)]"
                >
                  <p className="font-sans text-[15px] font-light leading-[1.65] text-[var(--text)]">
                    {p.nameRu}
                  </p>
                </div>
              ))}
          </div>
        </section>

        {/* 7. Логистика */}
        <section className="space-y-6">
          <div className="space-y-2">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
              Логистика
            </h2>
            <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Три способа путешествовать по Японии. Отличаются по стоимости, гибкости и комфорту.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {transportOptions.map(({ title, scores, Icon }) => (
              <article
                key={title}
                className="group rounded-sm border border-[var(--border)] bg-[var(--bg)] p-5 transition-colors hover:border-[var(--accent)] md:p-6"
              >
                <div className="flex items-center gap-3 mb-5">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <h3 className="font-sans text-[16px] font-medium leading-[1.3] tracking-[-0.01em]">{title}</h3>
                </div>
                <div className="space-y-3">
                  {Object.entries(scores).map(([label, score]) => (
                    <div key={label} className="flex items-center justify-between gap-4">
                      <span className="w-20 capitalize text-[12px] text-[var(--text-muted)]">{label}</span>
                      <div className="flex gap-1">
                        {[1,2,3,4,5].map(i => (
                          <span key={i} className={`h-1.5 w-6 rounded-full ${i <= score ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 8. Навигация */}
        <nav className="flex flex-wrap gap-3" aria-label="Похожие туры">
          {[
            { title: 'Камакура', href: '/from-tokyo/intercity/kamakura' },
            { title: 'Никко', href: '/from-tokyo/intercity/nikko' },
            { title: 'Гора Фудзи', href: '/from-tokyo/intercity/fuji' },
            { title: 'Все загородные туры', href: '/from-tokyo/intercity' },
          ].map((link) => (
            <a key={link.href} href={link.href} className="rounded-sm border border-[var(--border)] px-4 py-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
              {link.title}
            </a>
          ))}
        </nav>

        {/* 9. CTA */}
        <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-8 space-y-4">
          <h2 className="font-sans text-xl font-medium tracking-[-0.01em]">Обсудить тур</h2>
          <p className="max-w-2xl font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            Напишите — уточним программу, стоимость и доступные даты. Тур можно скорректировать под ваш маршрут по Японии.
          </p>
          <a
            href="/contact"
            className="inline-flex items-center gap-2 rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
          >
            Написать гиду
          </a>
        </section>
      </div>
    </section>
  )
}
