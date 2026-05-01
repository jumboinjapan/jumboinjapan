import type { Metadata } from 'next'
import { ArrowRight, CarFront, TrainFront, UserRound } from 'lucide-react'
import { IntercityRouteTimeline } from '@/components/IntercityRouteTimeline'
import { IntercitySummaryStrip } from '@/components/sections/IntercitySummaryStrip'
import { PageHero } from '@/components/sections/PageHero'
import { tours } from '@/data/tours'
import { getCityData, getHakonePois } from '@/lib/airtable'
import { buildIntercityRouteStops, getIntercityHelperPois, getIntercityRouteSeed } from '@/lib/intercity-pois'
import { PoiSheet } from '@/components/PoiSheet'
import { getIntercitySummary } from '@/data/intercitySummaries'

export const dynamic = 'force-dynamic'

const tour = tours.find((t) => t.slug === 'intercity/hakone')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/${tour.slug}`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  alternates: {
    canonical: 'https://jumboinjapan.com/intercity/hakone',
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
    itemListElement: [
      'Застава Хаконэ Сэкисё',
      'Хаконэ Дзиндзя',
      'Канатная дорога Хаконэ',
      'Овакудани',
      'Музей под открытым небом Хаконэ',
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
      'Хаконэ хорошо работает, когда хочется тихого цельного дня с панорамами, озером, водой и возможностью закончить маршрут онсэном или ночёвкой.',
  },
  {
    title: 'Семьи с детьми 8+',
    description:
      'Маршрут держится на смене впечатлений, а не на длинных переходах: корабль, канатная дорога, вулканическая долина и музей читаются легко даже в одном дне.',
  },
  {
    title: 'Первый раз за пределами Токио',
    description:
      'Идеальный первый загородный выезд: собранный маршрут, минимум логистики с гидом, сильные визуальные впечатления. В отличие от Камакуры (море и храмы), Никко (история и горный лес) или Фудзи (вулкан и большая панорама) — здесь вулканическая кальдера, озеро Аси и возможность онсэна в одном дне.',
  },
] as const

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">{eyebrow}</p>
        <span aria-hidden="true" className="h-px w-14 bg-[var(--border)]" />
      </div>
      <div className="space-y-2">
        <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">
          {title}
        </h2>
        {description ? (
          <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[16px]">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  )
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
      summary: 'Подходит тем, кому важнее более экономичный формат и кому комфортны пересадки внутри дня.',
    },
    {
      title: 'Гид-водитель',
      Icon: UserRound,
      scores: { стоимость: 4, гибкость: guideFlexibility, комфорт: 4 },
      summary: 'Лучший выбор, если хочется пройти Хаконэ мягко, без стыковок, потери темпа и лишней логистики.',
    },
  ]
  const routeStops = buildIntercityRouteStops('hakone', getIntercityRouteSeed('hakone'), pois)
  const helperPois = getIntercityHelperPois('hakone', pois)

  // Curated 4 helper POIs with mapping for scenarios (Airtable-driven subset, no hardcode of main route POIs)
  const curatedHelperIds = new Set(['POI-000042', 'POI-000053', 'POI-000058', 'POI-000043']) // Pola, Sengokuhara, Gora Park, Okada Museum
  const curatedHelperPois = helperPois
    .filter((p) => curatedHelperIds.has(p.poiId))
    .sort((a, b) => Array.from(curatedHelperIds).indexOf(a.poiId) - Array.from(curatedHelperIds).indexOf(b.poiId))
  const helperCriteria: Record<string, string> = {
    'POI-000042': 'Для искусства',
    'POI-000053': 'Осенью',
    'POI-000058': 'С детьми',
    'POI-000043': 'С ночёвкой',
  }

  const timelineStops = routeStops.map((stop) => {
    if (stop.title === 'Застава Хаконэ Сэкисё') {
      return {
        ...stop,
        type: 'landmark' as const,
        arrivalTime: '09:30',
      }
    }

    if (stop.title === 'Хаконэ Дзиндзя') {
      return {
        ...stop,
        type: 'shrine' as const,
        arrivalTime: '10:20',
      }
    }

    if (stop.title === 'Круиз по озеру Аси') {
      return {
        ...stop,
        type: 'cruise' as const,
        arrivalTime: '11:15',
      }
    }

    if (stop.title === 'Канатная дорога Хаконэ') {
      return {
        ...stop,
        type: 'ropeway' as const,
        arrivalTime: '12:00',
      }
    }

    if (stop.title === 'Овакудани') {
      return {
        ...stop,
        type: 'volcano' as const,
        arrivalTime: '12:35',
      }
    }

    if (stop.title === 'Музей под открытым небом Хаконэ') {
      return {
        ...stop,
        type: 'museum' as const,
        arrivalTime: '14:30',
      }
    }

    return stop
  })

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
        alt="Тур в Хаконэ, озеро Аси и горы"
        eyebrow="Маршруты из Токио"
        title="Тур в Хаконэ из Токио"
        subtitle="Хаконэ — это день, где Токио остаётся за спиной: озеро Аси, кедровые аллеи, вулканическая долина Овакудани и маршрут, который держится даже когда меняется погода и расписания."
        objectPosition="center 30%"
      />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20 lg:space-y-24">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <a href="/" className="hover:text-[var(--text)] transition-colors">Главная</a>
            <span aria-hidden="true" className="text-[var(--border)]">/</span>
            <a href="/intercity" className="hover:text-[var(--text)] transition-colors">Маршруты из Токио</a>
            <span aria-hidden="true" className="text-[var(--border)]">/</span>
            <span aria-current="page" className="font-medium text-[var(--text)]">Хаконэ</span>
          </nav>

          <IntercitySummaryStrip
            items={[
              {
                label: 'ФОРМАТ',
                value: 'Частный тур с русскоязычным гидом',
              },
              {
                label: 'ДЛИТЕЛЬНОСТЬ',
                value: 'Полный день (можно с ночёвкой)',
              },
              {
                label: 'СТАРТ',
                value: 'Из Токио',
              },
              {
                label: 'ГИД ПОМОГАЕТ',
                value: 'Логистика, тайминг, погода, замены по месту',
              },
            ]}
          />

          {/* Почему с гидом — structural placeholder */}
          <section className="space-y-8 md:space-y-10">
            <SectionHeading
              eyebrow="День не ломается"
              title="День не ломается"
            />
            <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text)] md:text-[16px]">
              Хаконэ кажется простым на карте, но в реальности день зависит от погоды, расписания канатной дороги, очередей, пересадок и того, видно ли Фудзи. Задача гида — не просто рассказать историю, а сохранить цельность дня: вовремя поменять порядок, убрать лишнее и не превратить маршрут в гонку.
            </p>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Логистика без стыковочного стресса</p>
              </div>
              <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Замены по погоде и видимости Фудзи</p>
              </div>
              <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Темп под группу, а не под расписание</p>
              </div>
            </div>
          </section>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading
              eyebrow="Маршрут"
              title="Маршрут по Хаконэ"
            />
            <IntercityRouteTimeline stops={timelineStops} initiallyExpandedIndexes={[0, 1]} hidePrices={true} />
          </section>

          <section className="space-y-6 md:space-y-8">
            <div className="space-y-2">
              <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">Кому подходит</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {whoItSuitsCards.map((item) => (
                <article key={item.title} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
                  <h3 className="font-sans text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{item.title}</h3>
                  <p className="mt-3 font-sans text-[14px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[15px]">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </section>

          {/* Mid-page CTA */}
          <div className="rounded-sm border border-[var(--accent-soft)] bg-[var(--surface)] p-8 text-center">
            <p className="text-sm font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Это ваш вариант?</p>
            <p className="mt-3 text-2xl font-medium tracking-tight">Обсудим детали →</p>
            <p className="mt-4 max-w-md mx-auto text-[var(--text-muted)]">Можно добавить ночёвку с онсэном. Напишите — подберём под ваш ритм.</p>
            <a
              href="/contact"
              className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
            >
              Обсудить частный день в Хаконэ
            </a>
            <a
              href="/contact"
              className="mt-4 block text-sm text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline"
            >
              Задать вопрос о логистике
            </a>
          </div>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading
              eyebrow="Дополнения"
              title="Что можно добавить"
              description="Если день хочется сделать мягче, насыщеннее или растянуть на ночь, ниже — точки, которые действительно поддерживают характер Хаконэ, а не перегружают его."
            />
            <p className="max-w-2xl text-[var(--text-muted)] text-[15px] font-light italic">Хаконэ легко испортить перегрузом. Эти добавления работают только если они поддерживают ритм дня.</p>
            <PoiSheet pois={curatedHelperPois} criteria={helperCriteria} />
          </section>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading
              eyebrow="Логистика"
              title="Как лучше ехать"
            />

            <div className="grid gap-4 md:grid-cols-2">
              {transportOptions.map(({ title, scores, Icon, summary }) => (
                <article
                  key={title}
                  className="group rounded-sm border border-[var(--border)] bg-[var(--bg)] p-5 transition-colors hover:border-[var(--accent)] md:p-6"
                >
                  <div className="mb-5 flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <h3 className="font-sans text-[16px] font-medium leading-[1.3] tracking-[-0.01em]">{title}</h3>
                  </div>
                  <p className="mb-4 font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{summary}</p>
                  <div className="space-y-3">
                    {Object.entries(scores).map(([label, score]) => (
                      <div key={label} className="flex items-center justify-between gap-4">
                        <span className="w-20 capitalize text-[12px] text-[var(--text-muted)]">{label}</span>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <span key={i} className={`h-1.5 w-6 rounded-full ${i <= score ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-8 border-t border-[var(--border)] pt-6 text-[13px] leading-relaxed text-[var(--text-muted)]">
              <p><strong>Общественный транспорт:</strong> ~¥2 500–3 500 туда-обратно, 2–2.5ч, 1–2 пересадки</p>
              <p><strong>Гид-водитель:</strong> договорная стоимость, без пересадок, гибкий ритм дня</p>
              <p className="mt-4 text-[13px] text-[var(--text-muted)] italic">Входные билеты на объекты маршрута оплачиваются отдельно.</p>
            </div>
          </section>

          <section className="grid gap-6 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:px-8 md:py-8">
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Следующий шаг</p>
              <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">Обсудить маршрут под ваш ритм</h2>
              <p className="max-w-2xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                Напишите, и соберём Хаконэ под ваш темп. Можно выехать раньше, добавить ночёвку с онсэном или связать маршрут с дорогой в Киото, чтобы день выглядел цельно, а не как компромисс.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <a
                href="/contact"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
              >
                Обсудить частный день в Хаконэ
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

          <nav className="flex flex-wrap gap-3" aria-label="Похожие туры">
            {[
              { title: 'Камакура', href: '/intercity/kamakura', diff: 'море и храмы' },
              { title: 'Никко', href: '/intercity/nikko', diff: 'история и горный лес' },
              { title: 'Гора Фудзи', href: '/intercity/fuji', diff: 'вулкан и большая панорама' },
              { title: 'Все загородные туры', href: '/intercity' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="group inline-flex min-h-[44px] flex-col justify-center rounded-sm border border-[var(--border)] px-4 py-1.5 text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {link.title}
                {link.diff && <span className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--accent)]"> — {link.diff}</span>}
              </a>
            ))}
          </nav>
        </div>
      </section>
    </>
  )
}
