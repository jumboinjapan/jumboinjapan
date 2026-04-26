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

export const dynamic = 'force-dynamic'

const tour = tours.find((t) => t.slug === 'intercity/uji')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/${tour.slug}`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  alternates: { canonical: 'https://jumboinjapan.com/intercity/uji' },
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Тур в Удзи — Павильон Феникса, чайная культура, музей Гэндзи' }],
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
    name: 'Uji',
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
    eyebrow: 'Чайная культура',
    title: 'Прогулка по чайной улочке к Павильону Феникса',
    description:
      'Маршрут к главной достопримечательности Удзи проходит через уютную торговую улочку, окружённую традиционными лавками. Здесь всё дышит чайной культурой: магазины с вековой историей предлагают сорта матья и гёкуро, а также знаменитые сладости — матья-моти, чайное мороженое и заварные эклеры с зелёным кремом.',
  },
  {
    eyebrow: 'Рай на земле',
    title: 'Павильон Феникса Бёдо-ин',
    description:
      'Храм Бёдоин и его Павильон Феникса — жемчужины Удзи. Построен в середине XI века как воплощение буддийского «рая на земле». Его отражение в пруду и дало зданию имя — Хоодо, «Павильон Феникса». Редкий пример архитектуры эпохи Хэйан, дошедший до наших дней почти в неизменном виде. Внутри — сидящий Амида-будда работы мастера Дзётё. Посещение самого павильона требует отдельного бронирования.',
  },
  {
    eyebrow: 'Литературное наследие',
    title: 'Музей повести о Гэндзи',
    description:
      'Специализированный музей, посвящённый шедевру «Повесть о Гэндзи» придворной дамы Мурасаки Сикибу. Удзи — ключевая локация последних глав романа. Реконструкции костюмов, дворцов и анимированные эпизоды.',
  },
]



const whoItSuits = 'Для тех, кому важно, что они едят и откуда это берётся. Удзи — родина лучшей японской матча, и здесь это не маркетинг, а география. Павильон Феникса, тихие улицы, несколько часов без суеты — хорошо для пары или тех, кто путешествует медленно и намеренно.'

export default async function UjiPage() {
  const [pois, cityData] = await Promise.all([
    getPoisByCity('uji'),
    getCityData('CTY-0011'),
  ])

  const guideFlexibility = cityData.hasNonCarSegments ? 3 : 4

  const transportOptions = [
    { title: 'Общественный транспорт', Icon: TrainFront, scores: { стоимость: 2, гибкость: 1, комфорт: 2 } },
    { title: 'Гид-водитель', Icon: UserRound, scores: { стоимость: 4, гибкость: guideFlexibility, комфорт: 4 } },
    { title: 'Лимузин-сервис', Icon: CarFront, scores: { стоимость: 5, гибкость: 5, комфорт: 5 } },
  ]

  const routeStops = buildIntercityRouteStops('uji', fullRouteStops, pois)
  const helperPois = getIntercityHelperPois('uji', pois)

  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <div className="mx-auto w-full max-w-6xl space-y-12 md:space-y-14">
        <ImageCarousel
          images={['/tours/uji/uji-1.jpg', '/tours/uji/uji-2.jpg', '/tours/uji/uji-3.jpg']}
          alt="Тур в Удзи — Павильон Феникса, чайная культура, музей Гэндзи"
        />

        <header className="space-y-4 md:space-y-5">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">День</p>
          <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">Тур в Удзи из Токио</h1>
          <p className="text-sm font-medium tracking-[0.01em] text-[var(--accent)]">
            Тур в Удзи с русскоязычным гидом
          </p>
          <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
            Небольшой, почти сонный городок Удзи раскинулся вдоль живописной одноимённой реки между Киото и Нарой. Утренние туманы, стелющиеся над водой, вдохновляли поэтов и придворных. Особый микроклимат и чистейшая вода реки стали идеальными условиями для выращивания самого изысканного чая в стране — именно отсюда родом самые премиальные сорта японского чая.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {['Чайная культура', 'Буддизм', 'Литература', 'Для пар', 'Спокойный ритм', 'Гастрономия'].map((tag) => (
              <span key={tag} className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
                <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                {tag}
              </span>
            ))}
          </div>
        </header>

        <IntercitySummaryStrip items={getIntercitySummary('uji')} />

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
            Маршрут по Удзи
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
              { title: 'Киото', href: '/intercity/kyoto-1' },
              { title: 'Нара', href: '/intercity/nara' },
              { title: 'Осака', href: '/intercity/osaka' },
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
