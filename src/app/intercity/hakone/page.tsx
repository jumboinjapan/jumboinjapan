import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { IntercityRouteTimeline } from '@/components/IntercityRouteTimeline'
import { IntercitySummaryStrip } from '@/components/sections/IntercitySummaryStrip'
import { PageHero } from '@/components/sections/PageHero'
import { tours } from '@/data/tours'
import { getMultiDayRouteSeoFieldsCached } from '@/lib/multi-day-builder-storage'
import { getIntercityRouteStopsCached, getPoisByCityCached } from '@/lib/airtable'
import { buildIntercityRouteStopsFromAirtable, buildHelperPoisFromAirtable } from '@/lib/intercity-pois'
import { PoiSheet } from '@/components/PoiSheet'
import { SectionHeading } from '@/components/sections/SectionHeading'
import { guideRef } from '@/lib/schema'
import { RouteFaq } from '@/components/sections/RouteFaq'

export const revalidate = 3600 // ISR: Airtable-backed (tags 'airtable:routes'/'airtable:pois', invalidated via /api/revalidate on admin write)

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

const tourSchema = {
  '@context': 'https://schema.org',
  '@type': 'TouristTrip',
  name: tour.title,
  alternateName: tour.titleEn,
  description: tour.description,
  inLanguage: 'ru',
  image: PAGE_IMAGE,
  url: PAGE_URL,
  duration: 'P1D/P2D',
  touristType: 'Russian-speaking tourists',
  provider: guideRef,
  offers: {
    '@type': 'Offer',
    availability: 'https://schema.org/InStock',
    url: PAGE_URL,
  },
  location: {
    '@type': 'Place',
    name: 'Хаконе',
    address: { '@type': 'PostalAddress', addressRegion: 'Канагава', addressCountry: 'JP' },
  },
  itinerary: {
    '@type': 'ItemList',
    itemListElement: [
      'Застава Хаконе Сэкисё',
      'Хаконе Дзиндзя',
      'Канатная дорога Хаконе',
      'Овакудани',
      'Музей под открытым небом Хаконе',
    ].map((stop, i) => ({ '@type': 'ListItem', position: i + 1, name: stop })),
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
}

const whoItSuitsCards = [
  {
    title: 'Пары',
    description:
      'Хаконе хорошо подходит путешественникам, кому хотелось бы провести тихий день любования природой с возможностью закончить маршрут онсэном или ночёвкой.',
  },
  {
    title: 'Семьи с детьми 8+',
    description:
      'Маршрут держится на смене впечатлений, а не на длинных переходах: корабль, канатная дорога, вулканическая долина и музей не создают впечатления бега даже в рамках одного дня.',
  },
  {
    title: 'На пути от Фудзи в Киото или Нагано',
    description:
      'Удачный первый загородный выезд: органично встаёт в начало большой поездки, а природа здесь выразительна в любую погоду.',
  },
] as const

export default async function HakonePage() {
  const [routeStopRecords, pois] = await Promise.all([
    getIntercityRouteStopsCached('intercity/hakone'),
    getPoisByCityCached('hakone'),
  ])

  const seo = await getMultiDayRouteSeoFieldsCached(tour.slug)


  const transportOptions = [
    {
      title: 'Общественный транспорт',
      summary: 'Маршрут выстраивается вокруг расписаний поездов и автобусов, с пересадками внутри дня. Формат подходит высокомобильным путешественникам с приоритетом на бюджет.',
    },
    {
      title: 'Частный транспорт',
      summary: 'Транспорт по договорённости позволяет выстроить выездной день целиком: выезд от отеля, остановки по ходу маршрута, перестройка программы по погоде и настроению. Дорога становится частью тура, а не расписанием пересадок.',
    },
    {
      title: 'Заказной транспорт',
      summary: 'Лимузин-сервис — просторный минивэн на весь день. Разумный выбор для большой семьи или группы, когда важно ехать вместе и с комфортом.',
    },
  ]

  const timelineStops = buildIntercityRouteStopsFromAirtable(routeStopRecords, pois)
  const helperItems = buildHelperPoisFromAirtable(routeStopRecords, pois)
  const curatedHelperPois = helperItems.map(h => h.poi)
  const helperCriteria = Object.fromEntries(helperItems.map(h => [h.poi.poiId, h.criteriaLabel]))

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />

      <PageHero
        image="/tours/hakone/hakone-hero.jpg"
        alt="Тур в Хаконе, озеро Аси и горы"
        eyebrow="Маршруты из Токио"
        title={tour.shortTitle}
        subtitle="Хаконе — день, когда картинка Токио постепенно растворяется за спиной, уступая место красотам горного озера Аси, кедровым аллеям и вулканической долине Овакудани, где ещё живы легенды."
        objectPosition="center 30%"
      />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto w-full max-w-6xl space-y-10 md:space-y-14">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Link href="/" className="hover:text-[var(--text)] transition-colors">Главная</Link>
            <span aria-hidden="true" className="text-[var(--border)]">/</span>
            <a href="/intercity" className="hover:text-[var(--text)] transition-colors">Маршруты из Токио</a>
            <span aria-hidden="true" className="text-[var(--border)]">/</span>
            <span aria-current="page" className="font-medium text-[var(--text)]">Хаконе</span>
          </nav>
          {seo?.routeIntro ? (
            <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text)] md:text-[16px]">
              {seo.routeIntro}
            </p>
          ) : null}

          <IntercitySummaryStrip
            items={[
              {
                label: 'ФОРМАТ',
                value: 'Частный тур с русскоязычным гидом',
              },
              {
                label: 'ДЛИТЕЛЬНОСТЬ',
                value: '1-2 полных дня',
              },
              {
                label: 'СТАРТ',
                value: 'Из Токио, Иокогамы, Фудзи, Готембы, Хаконе',
              },
              {
                label: 'ГИД ПОМОГАЕТ',
                value: 'Частный транспорт, тайминг, замены по месту и погоде.',
              },
            ]}
          />

          {/* Почему с гидом — structural placeholder */}
          <section className="space-y-4 md:space-y-6">
            <SectionHeading
              eyebrow="Специфика тура"
              title="Горный курорт с широкой географией."
            />
            <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text)] md:text-[16px]">
              День в Хаконе зависит от погоды, расписания местного транспорта, очередей, пересадок и видимости на гору Фудзи. Задача гида — не просто рассказать историю, а сохранить цельность маршрута, предлагая альтернативы и дополнения по ситуации.
            </p>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Частный транспорт — комфорт без пересадок</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Маршрут с учётом погодных условий</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Темп движения — под вашу группу</p>
              </div>
            </div>
          </section>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading
              eyebrow="Маршрут"
              title="Хаконе: место встречи истории, природы и искусства"
            />
            <IntercityRouteTimeline stops={timelineStops} initiallyExpandedIndexes={[0, 1]} />
          </section>

          <section className="space-y-6 md:space-y-8">
            <div className="space-y-2">
              <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">Кому подходит</h2>
            </div>
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
            Хотите адаптировать Хаконе под свой ритм?{' '}
            <a
              href="#cta"
              className="font-medium text-[var(--text)] underline-offset-4 transition-colors hover:text-[var(--accent)] hover:underline"
            >
              ↓ Обсудить детали
            </a>
          </p>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading
              eyebrow="Дополнения"
              title="Что можно добавить"
              description="Если хочется сместить акценты в рамках дня или в планах остановка в Хаконе на несколько дней — ниже точки, которые помогут глубже раскрыть характер региона."
            />
            <p className="max-w-2xl text-[var(--text-muted)] text-[15px] font-light italic">Хаконе легко испортить перегрузом. Эти добавления работают только если они поддерживают ритм дня.</p>

            {/* Онсэн — отдельная редакционная карточка */}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)] mb-3">Онсэн</p>
              <h3 className="font-sans text-[17px] font-medium tracking-[-0.02em] text-[var(--text)] mb-3">
                Термальные источники: ночёвка в рёкане или день на воде
              </h3>
              <p className="font-sans text-[14px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[15px]">
                Хаконе — один из самых доступных онсэн-регионов рядом с Токио. Можно остаться на ночь в рёкане с частной купальней (наиболее спокойный вариант для пар), а можно ограничиться дневным посещением (日帰り温泉) — несколько крупных термальных комплексов в районе Горы и Сэнгокухара работают без ночёвки. Гид помогает подобрать формат под темп дня.
              </p>
            </div>

            <PoiSheet pois={curatedHelperPois} criteria={helperCriteria} />
          </section>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading
              eyebrow="Логистика"
              title="Как лучше ехать"
            />

            <div className="grid gap-4 md:grid-cols-3">
              {transportOptions.map(({ title, summary }) => (
                <article key={title} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-5 md:p-6">
                  <h3 className="font-sans text-[16px] font-medium leading-[1.3] tracking-[-0.01em]">{title}</h3>
                  <p className="mt-3 font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{summary}</p>
                </article>
              ))}
            </div>

            <div className="mt-8 border-t border-[var(--border)] pt-6 text-[13px] leading-relaxed text-[var(--text-muted)]">
              <p><strong>Общественный транспорт:</strong> ~¥3 500–7 500 туда-обратно, 2–2.5ч, 5-6 пересадок</p>
              <p><strong>Частный транспорт:</strong> договорная стоимость, без пересадок, гибкий ритм дня</p>
              <p className="mt-4 text-[13px] text-[var(--text-muted)] italic">Входные билеты на объекты маршрута оплачиваются отдельно.</p>
            </div>
          </section>

          <section
            id="cta"
            className="scroll-mt-24 grid gap-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:px-8 md:py-8"
          >
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Следующий шаг</p>
              <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">Обсудить маршрут под ваш ритм</h2>
              <p className="max-w-2xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                Хаконе собирается под ваш темп: можно выехать раньше, добавить ночёвку с онсэном или связать маршрут с дорогой в Киото, чтобы день выглядел цельно, а не как компромисс.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <a
                href="/profile"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
              >
                Обсудить частный день в Хаконе
              </a>
              <a
                href="/contact"
                className="text-sm text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline"
              >
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
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">
                  Похожие туры
                </p>
                <h2
                  id="related-tours-title"
                  className="font-sans text-[24px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[28px]"
                >
                  Если хотите сравнить Хаконе с другими днями вне Токио
                </h2>
              </div>
              <a
                href="/intercity"
                className="inline-flex min-h-[44px] items-center gap-2 text-[14px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"
              >
                Все загородные туры
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
            <nav aria-label="Похожие загородные туры">
              <div className="grid gap-3 md:grid-cols-3">
                {[
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
                ].map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="group flex min-h-[178px] flex-col justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-warm)]"
                  >
                    <div className="space-y-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        {link.title}
                      </p>
                      <div className="space-y-1.5">
                        <h3 className="font-sans text-[20px] font-medium tracking-[-0.03em] text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">
                          {link.tourTitle}
                        </h3>
                        <p className="text-[13px] font-medium text-[var(--accent)]">{link.diff}</p>
                      </div>
                      <p className="font-sans text-[14px] font-light leading-[1.75] text-[var(--text-muted)]">
                        {link.description}
                      </p>
                    </div>
                    <span className="mt-5 inline-flex items-center gap-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                      Посмотреть маршрут
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </a>
                ))}
              </div>
            </nav>
          </section>
        </div>
      </section>
    <RouteFaq slug="intercity/hakone" />
      </>
  )
}
