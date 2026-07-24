import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { IntercityRouteTimeline } from '@/components/IntercityRouteTimeline'
import { IntercitySummaryStrip } from '@/components/sections/IntercitySummaryStrip'
import { PageHero } from '@/components/sections/PageHero'
import { TransportCard } from '@/components/sections/TransportCard'
import { tours } from '@/data/tours'
import { getMultiDayRouteSeoFieldsCached } from '@/lib/multi-day-builder-storage'
import { getIntercityRouteStopsCached, getPoisByCityCached } from '@/lib/airtable'
import { buildIntercityRouteStopsFromAirtable, buildHelperPoisFromAirtable } from '@/lib/intercity-pois'
import { PoiSheet } from '@/components/PoiSheet'
import { getIntercitySummary } from '@/data/intercitySummaries'
import { SectionHeading } from '@/components/sections/SectionHeading'
import { guideRef } from '@/lib/schema'
import { RouteFaq } from '@/components/sections/RouteFaq'
import { JournalMentions } from '@/components/sections/JournalMentions'

export const revalidate = 3600 // ISR: Airtable-backed (tags 'airtable:routes'/'airtable:pois', invalidated via /api/revalidate on admin write)

const tour = tours.find((t) => t.slug === 'intercity/kyoto-1')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/intercity/kyoto-1`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getMultiDayRouteSeoFieldsCached(tour.slug)
  const title = seo?.seoTitle || tour.title
  const description = seo?.seoDescription || tour.description

  return {
  title: title,
  description: description,
  alternates: { canonical: 'https://jumboinjapan.com/intercity/kyoto-1' },
  openGraph: {
    title: `${title} | JumboInJapan`,
    description: description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Кинкакудзи — Золотой павильон в Киото' }],
  },
}
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
  provider: guideRef,
  offers: { '@type': 'Offer', availability: 'https://schema.org/InStock', url: PAGE_URL },
}

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Главная', item: BASE_URL },
    { '@type': 'ListItem', position: 2, name: 'Маршруты из Токио', item: `${BASE_URL}/intercity` },
    { '@type': 'ListItem', position: 3, name: tour.title, item: PAGE_URL },
  ],
}

const whoItSuitsCards = [
  {
    title: 'Первый визит в Киото',
    description:
      'Маршрут собирает главные символы: Кинкакудзи, Рёандзи, Нисики, Киёмидзудэра и Гион — всё в логике одного дня.',
  },
  {
    title: 'Туристы после Токио',
    description:
      'После динамичного Токио Киото даёт другой ритм: больше пешего, больше тишины, больше истории.',
  },
  {
    title: 'Пары и семьи',
    description:
      'Маршрут разнообразен — золотой павильон, сад камней, рынок и вечерний квартал гейш читаются легко.',
  },
] as const

export default async function Kyoto1Page() {
  const [routeStopRecords, pois] = await Promise.all([
    getIntercityRouteStopsCached('intercity/kyoto-1'),
    getPoisByCityCached('kyoto'),
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
  const curatedHelperPois = helperItems.map(h => h.poi)
  const helperCriteria = Object.fromEntries(helperItems.map(h => [h.poi.poiId, h.criteriaLabel]))

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      <PageHero
        image="/tours/kyoto-1/kinkakuji.jpg"
        alt="Кинкакудзи — Золотой павильон в Киото"
        eyebrow="Маршруты из Токио"
        title={tour.shortTitle}
        subtitle="Первый день в Киото: Кинкакудзи, Рёандзи, рынок Нисики, Киёмидзудэра и вечерняя прогулка по Гиону."
      />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto w-full max-w-6xl space-y-10 md:space-y-14">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Link href="/" className="hover:text-[var(--text)] transition-colors">Главная</Link>
            <span aria-hidden="true" className="text-[var(--border)]">/</span>
            <a href="/intercity" className="hover:text-[var(--text)] transition-colors">Маршруты из Токио</a>
            <span aria-hidden="true" className="text-[var(--border)]">/</span>
            <span aria-current="page" className="font-medium text-[var(--text)]">Киото</span>
          </nav>
          {seo?.routeIntro ? (
            <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text)] md:text-[16px]">
              {seo.routeIntro}
            </p>
          ) : null}

          <IntercitySummaryStrip items={getIntercitySummary('kyoto1')} />

          <section className="space-y-4 md:space-y-6">
            <SectionHeading eyebrow="Специфика тура" title="Киото за один день — реально, если правильно выбрать." />
            <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text)] md:text-[16px]">
              Киото огромен, и попытка увидеть всё за день заканчивается усталостью без впечатлений. Этот маршрут — пять точек с сильными видами и понятной логикой движения: север → центр → восток.
            </p>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Золотой павильон Кинкакудзи</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Сад камней Рёандзи</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Квартал гейш Гион</p>
              </div>
            </div>
          </section>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading eyebrow="Маршрут" title="Киото: первое знакомство" />
            <IntercityRouteTimeline stops={timelineStops} initiallyExpandedIndexes={[0, 1]} />
          </section>

          <section className="space-y-6 md:space-y-8">
            <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">Кому подходит</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {whoItSuitsCards.map((item) => (
                <article key={item.title} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
                  <h3 className="font-sans text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{item.title}</h3>
                  <p className="mt-3 font-sans text-[14px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[15px]">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <p className="font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
            Хотите добавить второй день или Нару?{' '}
            <a href="#cta" className="font-medium text-[var(--text)] underline-offset-4 transition-colors hover:text-[var(--accent)] hover:underline">
              ↓ Обсудить детали
            </a>
          </p>

          {curatedHelperPois.length > 0 && (
            <section className="space-y-6 md:space-y-8">
              <SectionHeading
                eyebrow="Дополнения"
                title="Что можно добавить"
                description="Киото требует времени. Если планируется второй день или продолжение программы — ниже точки, которые идут следом."
              />
              <PoiSheet pois={curatedHelperPois} criteria={helperCriteria} />
            </section>
          )}

          <section className="space-y-6 md:space-y-8">
            <SectionHeading eyebrow="Логистика" title="Как лучше ехать" />
            <div className="grid gap-10 md:grid-cols-3">
              {transportOptions.map(({ title, summary, href, image }) => (
                <TransportCard
                  key={title}
                  title={title}
                  description={summary}
                  href={href}
                  image={image}
                  imageDisplay="hero"
                />
              ))}
            </div>
            <p className="text-[13px] text-[var(--text-muted)]">Токио → Киото: синкансэн Nozomi, ~2.5 часа. Внутри города — такси или автобус. Раннее прибытие важно.</p>
            <p className="text-[13px] text-[var(--text-muted)] italic">Входные билеты на объекты маршрута оплачиваются отдельно.</p>
          </section>

          <section id="cta" className="scroll-mt-24 grid gap-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:px-8 md:py-8">
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Следующий шаг</p>
              <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">Обсудить маршрут под ваш ритм</h2>
              <p className="max-w-2xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                Киото можно увидеть за один день — или за три; маршрут выстраивается под ваше время и ритм.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <a href="/profile" className="inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white">
                Обсудить тур в Киото
              </a>
              <a href="/contact" className="text-sm text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline">
                Задать вопрос о логистике
              </a>
              <span className="inline-flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                Ответ обычно в тот же день
                <ArrowRight className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden="true" />
              </span>
            </div>
          </section>

          <section className="space-y-5" aria-labelledby="related-tours-title">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Похожие туры</p>
                <h2 id="related-tours-title" className="font-sans text-[24px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[28px]">
                  Продолжение маршрута
                </h2>
              </div>
              <a href="/intercity" className="inline-flex min-h-[44px] items-center gap-2 text-[14px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]">
                Все загородные туры
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
            <nav aria-label="Похожие загородные туры">
              <div className="grid gap-3 md:grid-cols-3">
                <a
                  key="/intercity/kyoto-2"
                  href="/intercity/kyoto-2"
                  className="group flex min-h-[178px] flex-col justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-warm)]"
                >
                  <div className="space-y-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Киото 2-й день</p>
                    <div className="space-y-1.5">
                      <h3 className="font-sans text-[20px] font-medium tracking-[-0.03em] text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">Второй день в Киото</h3>
                      <p className="text-[13px] font-medium text-[var(--accent)]">Арасияма и философская тропа</p>
                    </div>
                    <p className="font-sans text-[14px] font-light leading-[1.75] text-[var(--text-muted)]">Продолжение — Гинкакудзи, Нандзэн-дзи, Арасияма и бамбуковый лес.</p>
                  </div>
                  <span className="mt-5 inline-flex items-center gap-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                    Посмотреть маршрут
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </a>
                <a
                  key="/intercity/nara"
                  href="/intercity/nara"
                  className="group flex min-h-[178px] flex-col justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-warm)]"
                >
                  <div className="space-y-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Нара</p>
                    <div className="space-y-1.5">
                      <h3 className="font-sans text-[20px] font-medium tracking-[-0.03em] text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">Тур в Нару</h3>
                      <p className="text-[13px] font-medium text-[var(--accent)]">олени и Тодайдзи</p>
                    </div>
                    <p className="font-sans text-[14px] font-light leading-[1.75] text-[var(--text-muted)]">Легко добавить к программе Киото — час на поезде.</p>
                  </div>
                  <span className="mt-5 inline-flex items-center gap-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                    Посмотреть маршрут
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </a>
                <a
                  key="/intercity/osaka"
                  href="/intercity/osaka"
                  className="group flex min-h-[178px] flex-col justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-warm)]"
                >
                  <div className="space-y-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Осака</p>
                    <div className="space-y-1.5">
                      <h3 className="font-sans text-[20px] font-medium tracking-[-0.03em] text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">Тур в Осаку</h3>
                      <p className="text-[13px] font-medium text-[var(--accent)]">городская энергия</p>
                    </div>
                    <p className="font-sans text-[14px] font-light leading-[1.75] text-[var(--text-muted)]">Другой характер — контрастный, живой, с едой и огнями Дотонбори.</p>
                  </div>
                  <span className="mt-5 inline-flex items-center gap-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                    Посмотреть маршрут
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </a>
              </div>
            </nav>
          </section>
        </div>
      </section>
    <RouteFaq slug="intercity/kyoto-1" />
    <JournalMentions
      routeSlug="intercity/kyoto-1"
      poiIds={timelineStops.map((s) => s.poiId).filter((id): id is string => Boolean(id))}
      locationNames={[...timelineStops.map((s) => s.title), 'Киото']}
      themes={timelineStops.flatMap((s) => [...(s.category ?? []), ...(s.tags ?? [])])}
    />
      </>
  )
}
