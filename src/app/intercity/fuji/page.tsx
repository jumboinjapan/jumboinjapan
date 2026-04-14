import type { Metadata } from 'next'
import {
  CarFront,
  TrainFront,
  UserRound,
} from 'lucide-react'
import { RouteAccordion } from '@/components/RouteAccordion'
import { ImageCarousel } from '@/components/sections/ImageCarousel'
import { IntercitySummaryStrip } from '@/components/sections/IntercitySummaryStrip'
import { tours } from '@/data/tours'
import { getCityData, getPoisByCity } from '@/lib/airtable'
import { buildIntercityRouteStops, getIntercityHelperPois } from '@/lib/intercity-pois'
import { PoiSheet } from '@/components/PoiSheet'
import { getIntercitySummary } from '@/data/intercitySummaries'

const tour = tours.find((t) => t.slug === 'intercity/fuji')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/${tour.slug}`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  alternates: { canonical: 'https://jumboinjapan.com/intercity/fuji' },
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Тур к горе Фудзи — озёра, деревни, канатная дорога' }],
  },
}

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
  provider: { '@type': 'Person', name: 'Eduard Revidovich', url: BASE_URL },
  offers: { '@type': 'Offer', availability: 'https://schema.org/InStock', url: PAGE_URL },
  location: {
    '@type': 'Place',
    name: 'Mount Fuji',
    address: { '@type': 'PostalAddress', addressCountry: 'JP' },
  },
}

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Главная', item: BASE_URL },
    { '@type': 'ListItem', position: 2, name: 'Загородные туры', item: `${BASE_URL}/intercity` },
    { '@type': 'ListItem', position: 3, name: tour.title, item: PAGE_URL },
  ],
}

const fullRouteStops = [
  {
    eyebrow: 'У вершины',
    title: 'Пятая станция горы Фудзи',
    description:
      'Последняя точка на склоне горы, до которой можно добраться на автомобиле. Здесь начинается пеший подъём на вершину, если позволяют погодные условия. Можно отправить открытку с одной из самых высокорасположенных почтовых станций в мире, прокатиться на лошади и посетить синтоистское святилище. На высоте значительно холоднее — тёплая одежда обязательна.',
  },
  {
    eyebrow: 'Панорама',
    title: 'Обсерватория на горе Тэндзё',
    description:
      'С берега озера Кавагутико мы поднимемся на канатной дороге к обзорной площадке выше 1000 метров над уровнем моря. Отсюда один из лучших видов на гору Фудзи и озеро у её подножия. Это место также связано с японской народной сказкой о Зайце и Тануки. При возможных очередях можно полюбоваться горой с озера — индивидуальный фрахт моторной лодки или круиз по озеру Кавагути.',
  },
  {
    eyebrow: 'Традиционная деревня',
    title: 'Парк Ияси-но Сато',
    description:
      'На западном берегу озера Сайко расположилась восстановленная деревня Ияси-но Сато — музей под открытым небом. Изначально это было фермерское поселение, разрушенное оползнем в 1966 году. Здесь можно посетить традиционные японские избы с соломенными крышами, поучаствовать в ремесленных мастер-классах и приобрести уникальные сувениры.',
  },
  {
    eyebrow: 'Искусство шёлка',
    title: 'Музей кимоно Итику Кубота',
    description:
      'Художник Кубота Итику посвятил жизнь возрождению утраченного искусства окрашивания шёлка в технике цудзигахана. На северном берегу озера Кавагутико расположен музей с кимоно, изображающими природу, времена года и вселенную — включая части монументального проекта «Симфония света», серии из 80 кимоно о горе Фудзи.',
  },
]



const whoItSuits = 'Для тех, кто хочет не просто сфотографировать — а подойти близко, почувствовать масштаб, летом — подняться. Физически это другой уровень по сравнению с обычным туром: есть подъём, есть усилие. Подходит людям в хорошей форме, семьям с подростками, всем, кто приехал в Японию не только за едой.'

export default async function FujiPage() {
  const [pois, cityData] = await Promise.all([
    getPoisByCity('fuji'),
    getCityData('CTY-0033'),
  ])

  const guideFlexibility = cityData.hasNonCarSegments ? 3 : 4

  const transportOptions = [
    { title: 'Общественный транспорт', Icon: TrainFront, scores: { стоимость: 2, гибкость: 1, комфорт: 2 } },
    { title: 'Гид-водитель', Icon: UserRound, scores: { стоимость: 4, гибкость: guideFlexibility, комфорт: 4 } },
    { title: 'Лимузин-сервис', Icon: CarFront, scores: { стоимость: 5, гибкость: 5, комфорт: 5 } },
  ]

  const routeStops = buildIntercityRouteStops('fuji', fullRouteStops, pois)
  const helperPois = getIntercityHelperPois('fuji', pois)

  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <div className="mx-auto w-full max-w-6xl space-y-12 md:space-y-14">
        <ImageCarousel
          images={['/tours/fuji/fuji-a.jpg', '/tours/fuji/fuji-b.jpg', '/tours/fuji/fuji-c.jpg']}
          alt="Тур к горе Фудзи — озёра, деревни, канатная дорога"
        />

        <header className="space-y-4 md:space-y-5">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">День</p>
          <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">Тур на гору Фудзи из Токио</h1>
          <p className="text-sm font-medium tracking-[0.01em] text-[var(--accent)]">
            Тур к горе Фудзи из Токио с гидом на русском
          </p>
          <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
            Фудзи — самая высокая точка Японии высотой 3776 метров. Её почти идеальная коническая форма веками вдохновляла художников, паломников и поэтов. Сегодня регион Фудзи — это не только символ страны, но и популярное направление для активного отдыха и культурного туризма.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {['Природа и пейзажи', 'Гора Фудзи', 'Озёра', 'Музеи', 'Для всей семьи', 'Активный отдых'].map((tag) => (
              <span key={tag} className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
                <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                {tag}
              </span>
            ))}
          </div>
        </header>

        <IntercitySummaryStrip items={getIntercitySummary('fuji')} />

        <section className="space-y-4">
          <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
            Кому подходит тур
          </h2>
          <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
            {whoItSuits}
          </p>
        </section>

        {/* Маршрут (аккордеон) */}
        <section className="space-y-6">
          <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
            Маршрут
          </h2>
          <RouteAccordion
            stops={routeStops}
          />
        </section>

        {helperPois.length > 0 && (
          <section className="space-y-6">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Что можно включить в маршрут</h2>
            <PoiSheet pois={helperPois} />
          </section>
        )}

        <section className="space-y-6">
          <div className="space-y-2">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Логистика</h2>
            <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">Три способа путешествовать по Японии. Отличаются по стоимости, гибкости и комфорту.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {transportOptions.map(({ title, scores, Icon }) => (
              <article key={title} className="group rounded-sm border border-[var(--border)] bg-[var(--bg)] p-5 transition-colors hover:border-[var(--accent)] md:p-6">
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

        {/* Навигация */}
        <nav className="flex flex-wrap gap-3" aria-label="Похожие туры">
          {[
              { title: 'Хаконэ', href: '/intercity/hakone' },
              { title: 'Никко', href: '/intercity/nikko' },
              { title: 'Камакура', href: '/intercity/kamakura' },
              { title: 'Все загородные туры', href: '/intercity' },
          ].map((link) => (
            <a key={link.href} href={link.href} className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--border)] px-4 py-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
              {link.title}
            </a>
          ))}
        </nav>

        {/* CTA */}
        <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-8 space-y-4">
          <h2 className="font-sans text-xl font-medium tracking-[-0.01em]">Обсудить тур</h2>
          <p className="max-w-2xl font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            Напишите — уточним программу, стоимость и доступные даты. Тур можно скорректировать под ваш маршрут по Японии.
          </p>
          <a
            href="/contact"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
          >
            Написать гиду
          </a>
        </section>
      </div>
    </section>
  )
}
