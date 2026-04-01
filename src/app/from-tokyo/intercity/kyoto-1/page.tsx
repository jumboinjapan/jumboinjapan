import type { Metadata } from 'next'
import {
  CarFront,
  TrainFront,
  UserRound,
} from 'lucide-react'
import { RouteAccordion } from '@/components/RouteAccordion'
import { ImageCarousel } from '@/components/sections/ImageCarousel'
import { tours } from '@/data/tours'
import { getCityData, getPoisByCity } from '@/lib/airtable'
import { buildIntercityRouteStops, getIntercityHelperPois } from '@/lib/intercity-pois'
import { PoiSheet } from '@/components/PoiSheet'

const tour = tours.find((t) => t.slug === 'from-tokyo/intercity/kyoto-1')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/${tour.slug}`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  alternates: { canonical: 'https://jumboinjapan.com/from-tokyo/intercity/kyoto-1' },
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Киото — Золотой павильон, сад камней, квартал Гион' }],
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
    name: 'Kyoto',
    address: { '@type': 'PostalAddress', addressCountry: 'JP' },
  },
}

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Главная', item: BASE_URL },
    { '@type': 'ListItem', position: 2, name: 'Из Токио', item: `${BASE_URL}/from-tokyo` },
    { '@type': 'ListItem', position: 3, name: 'Загородные туры', item: `${BASE_URL}/from-tokyo/intercity` },
    { '@type': 'ListItem', position: 4, name: tour.title, item: PAGE_URL },
  ],
}

const fullRouteStops = [
  {
    eyebrow: 'Символ Киото',
    title: 'Золотой павильон Кинкакудзи',
    description:
      'Самая «пафосная» и вместе с тем символичная локация Киото. Первоначально — загородная вилла сёгуна Асикага Ёсимицу XIV века, после его смерти сконвертированная в дзэн-буддийский храм. Золото, покрывающее здание, говорит не о богатстве, но о стремлении к чистоте. Павильон словно парит над зеркальной гладью пруда, создавая ощущение абсолютной гармонии.',
  },
  {
    eyebrow: 'Дзэн и ваби-саби',
    title: 'Сад камней Рёандзи',
    description:
      'На первый взгляд поражает простотой — пятнадцать камней на белом гравии, обнесённые низкой глиняной стеной. Камни расставлены так, что откуда бы вы ни смотрели, всегда видны только четырнадцать. Это воплощение японской идеи «ваби-саби» — красоты несовершенного и недолговечного.',
  },
  {
    eyebrow: 'Гастрономия',
    title: 'Рынок Нисики',
    description:
      '«Кухня Киото» — крытый рынок с несколькими веками истории. Здесь можно попробовать местные соленья, традиционные приправы, свежайшие морепродукты. Звон посуды, запахи соевых соусов и жареного угря, живые разговоры с продавцами — театральный опыт японской гастрономии.',
  },
  {
    eyebrow: 'Хигасияма',
    title: 'Храм Киёмидзудэра',
    description:
      'Ключевая точка прогулки по району Хигасияма: отсюда маршрут естественно проходит через старые переулки восточного Киото, лавки, чайные и виды на город со склона.',
  },
  {
    eyebrow: 'Район гейш',
    title: 'Квартал Гион',
    description:
      'Самый знаменитый район Киото — эталон изысканного отдыха для аристократии и самурайской элиты. Узкие улочки с деревянными фасадами, свет бумажных фонарей, скрытые за невзрачными дверями чайные дома. Это «район гейш», где многие века можно было встретить геико и маико в изысканных кимоно.',
  },
]



const whoItSuits = 'Для тех, кто в Киото впервые и хочет понять, с чего начинается эта репутация. Золотой павильон, Рёандзи, вечерний Гион — не самый оригинальный маршрут, но именно здесь складывается образ, который потом остаётся. Классика работает.'

export default async function KyotoFirstPage() {
  const [pois, cityData] = await Promise.all([
    getPoisByCity('kyoto'),
    getCityData('CTY-0008'),
  ])

  const guideFlexibility = cityData.hasNonCarSegments ? 3 : 4

  const transportOptions = [
    { title: 'Общественный транспорт', Icon: TrainFront, scores: { стоимость: 2, гибкость: 1, комфорт: 2 } },
    { title: 'Гид-водитель', Icon: UserRound, scores: { стоимость: 4, гибкость: guideFlexibility, комфорт: 4 } },
    { title: 'Лимузин-сервис', Icon: CarFront, scores: { стоимость: 5, гибкость: 5, комфорт: 5 } },
  ]

  const routeStops = buildIntercityRouteStops('kyoto-1', fullRouteStops, pois)
  const helperPois = getIntercityHelperPois('kyoto-1', pois)

  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <div className="mx-auto w-full max-w-6xl space-y-12 md:space-y-14">
        <ImageCarousel
          images={['/tours/kyoto-1/kyoto-1.jpg', '/tours/kyoto-2/kyoto-1.jpg', '/tours/kyoto-2/kyoto-2.jpg']}
          alt="Киото — Кийомидзудэра, Хигасияма, квартал Гион"
        />

        <header className="space-y-4 md:space-y-5">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">День</p>
          <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">Тур в Киото из Токио. Первое знакомство</h1>
          <p className="text-sm font-medium tracking-[0.01em] text-[var(--accent)]">
            Тур в регионе Кансай с русскоязычным гидом
          </p>
          <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
            Киото — древняя столица Японии, более тысячи лет служившая политическим и культурным центром страны. Именно здесь оформилась та японская эстетика, которую мы связываем с гармонией, утончённой простотой и глубокой связью с природой. Тур обязателен для тех, кто впервые прибыл в Киото.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {['Традиции и история', 'Дзэн-буддизм', 'Гейши', 'Гастрономия', 'Архитектура', 'Must-see'].map((tag) => (
              <span key={tag} className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
                <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                {tag}
              </span>
            ))}
          </div>
        </header>

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
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]"><Icon aria-hidden="true" className="h-5 w-5" /></span>
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
              { title: 'Киото. Второй день', href: '/from-tokyo/intercity/kyoto-2' },
              { title: 'Нара', href: '/from-tokyo/intercity/nara' },
              { title: 'Осака', href: '/from-tokyo/intercity/osaka' },
              { title: 'Все загородные туры', href: '/from-tokyo/intercity' },
          ].map((link) => (
            <a key={link.href} href={link.href} className="rounded-sm border border-[var(--border)] px-4 py-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
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
            className="inline-flex items-center gap-2 rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
          >
            Написать гиду
          </a>
        </section>
      </div>
    </section>
  )
}
