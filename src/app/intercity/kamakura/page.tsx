import type { Metadata } from 'next'
import { ArrowRight, TrainFront, UserRound } from 'lucide-react'
import { IntercityRouteTimeline } from '@/components/IntercityRouteTimeline'
import { IntercitySummaryStrip } from '@/components/sections/IntercitySummaryStrip'
import { PageHero } from '@/components/sections/PageHero'
import { tours } from '@/data/tours'
import { getCityData, getIntercityRouteStops, getPoisByCity } from '@/lib/airtable'
import { buildIntercityRouteStopsFromAirtable, buildHelperPoisFromAirtable } from '@/lib/intercity-pois'
import { PoiSheet } from '@/components/PoiSheet'
import { getIntercitySummary } from '@/data/intercitySummaries'

export const dynamic = 'force-dynamic'

const tour = tours.find((t) => t.slug === 'intercity/kamakura')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/intercity/kamakura`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  alternates: { canonical: 'https://jumboinjapan.com/intercity/kamakura' },
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Тур в Камакуру — Великий Будда, самурайские святилища' }],
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
    title: 'Семьи с детьми 6+',
    description:
      'Маршрут держится на чередовании: прогулка по улице, большая статуя, храм с садом и набережная — смена форматов помогает детям не терять интерес.',
  },
  {
    title: 'Первый выезд из Токио',
    description:
      'Камакура — один из лучших вариантов для первого загородного дня: поезд прямой, масштаб понятный, история конкретная.',
  },
  {
    title: 'Пары и культурный отдых',
    description:
      'Спокойный маршрут с морем, буддийскими садами и хорошим выбором кафе в историческом центре.',
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

export default async function KamakuraPage() {
  const [routeStopRecords, pois, cityData] = await Promise.all([
    getIntercityRouteStops('intercity/kamakura'),
    getPoisByCity('kamakura'),
    getCityData('CTY-0002'),
  ])

  const guideFlexibility = cityData.hasNonCarSegments ? 3 : 4

  const transportOptions = [
    {
      title: 'Общественный транспорт',
      Icon: TrainFront,
      scores: { стоимость: 2, гибкость: 1, комфорт: 2 },
      summary: 'Подходит тем, кому важнее экономичный формат и кто готов к пересадкам.',
    },
    {
      title: 'Частный транспорт',
      Icon: UserRound,
      scores: { стоимость: 4, гибкость: guideFlexibility, комфорт: 4 },
      summary: 'Лучший выбор для комфортного дня без пересадок и логистического стресса.',
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
        image="/tours/kamakura/kamakura-2.jpg"
        alt="Тур в Камакуру — Великий Будда, самурайские святилища"
        eyebrow="Маршруты из Токио"
        title="{tour.title}"
        subtitle="Камакура — первая военная столица Японии. Великий Будда, самурайские святилища, бамбуковые рощи и берег Тихого океана в одном дне из Токио."
      />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto w-full max-w-6xl space-y-10 md:space-y-14">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <a href="/" className="hover:text-[var(--text)] transition-colors">Главная</a>
            <span aria-hidden="true" className="text-[var(--border)]">/</span>
            <a href="/intercity" className="hover:text-[var(--text)] transition-colors">Маршруты из Токио</a>
            <span aria-hidden="true" className="text-[var(--border)]">/</span>
            <span aria-current="page" className="font-medium text-[var(--text)]">Камакура</span>
          </nav>

          <IntercitySummaryStrip items={getIntercitySummary('kamakura')} />

          <section className="space-y-4 md:space-y-6">
            <SectionHeading eyebrow="Специфика тура" title="Час от Токио — и другой ритм города." />
            <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text)] md:text-[16px]">
              День в Камакуре строится легко: Дайбуцу, храм Хасэ-дэра, улица Комати-дори и набережная — логика маршрута понятна. Задача гида — не пересказать учебник, а добавить слой истории самурайской столицы и правильно выстроить темп.
            </p>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">История первого сёгуната</p>
              </div>
              <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Буддийские святилища</p>
              </div>
              <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Морской берег и воздух</p>
              </div>
            </div>
          </section>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading eyebrow="Маршрут" title="Камакура: самурайская столица у моря" />
            <IntercityRouteTimeline stops={timelineStops} initiallyExpandedIndexes={[0, 1]} />
          </section>

          <section className="space-y-6 md:space-y-8">
            <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">Кому подходит</h2>
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

          <p className="font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
            Хотите выстроить день под себя?{' '}
            <a href="#cta" className="font-medium text-[var(--text)] underline-offset-4 transition-colors hover:text-[var(--accent)] hover:underline">
              ↓ Обсудить детали
            </a>
          </p>

          {curatedHelperPois.length > 0 && (
            <section className="space-y-6 md:space-y-8">
              <SectionHeading
                eyebrow="Дополнения"
                title="Что можно добавить"
                description="Камакура компактна, но у неё есть глубина. Если останется время или хочется нестандартного — эти точки поддерживают характер дня."
              />
              <PoiSheet pois={curatedHelperPois} criteria={helperCriteria} />
            </section>
          )}

          <section className="space-y-6 md:space-y-8">
            <SectionHeading eyebrow="Логистика" title="Как лучше ехать" />
            <div className="grid gap-4 md:grid-cols-2">
              {transportOptions.map(({ title, scores, Icon, summary }) => (
                <article key={title} className="group rounded-sm border border-[var(--border)] bg-[var(--bg)] p-5 transition-colors hover:border-[var(--accent)] md:p-6">
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
            <p className="text-[13px] text-[var(--text-muted)]">Камакура → Токио: поезд Yokosuka Line, ~1 час, прямой. С машиной — больше гибкости у второстепенных точек.</p>
            <p className="text-[13px] text-[var(--text-muted)] italic">Входные билеты на объекты маршрута оплачиваются отдельно.</p>
          </section>

          <section id="cta" className="scroll-mt-24 grid gap-6 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:px-8 md:py-8">
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Следующий шаг</p>
              <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">Обсудить маршрут под ваш ритм</h2>
              <p className="max-w-2xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                Камакура хорошо читается и за полдня, и за целый день. Напишите — выстроим маршрут под ваш темп и количество точек.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <a href="/contact" className="inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white">
                Обсудить день в Камакуре
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
                  Другие однодневные туры из Токио
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
                  key="/intercity/enoshima"
                  href="/intercity/enoshima"
                  className="group flex min-h-[178px] flex-col justify-between rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-warm)]"
                >
                  <div className="space-y-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Эносима</p>
                    <div className="space-y-1.5">
                      <h3 className="font-sans text-[20px] font-medium tracking-[-0.03em] text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">Тур на Эносиму</h3>
                      <p className="text-[13px] font-medium text-[var(--accent)]">остров и море</p>
                    </div>
                    <p className="font-sans text-[14px] font-light leading-[1.75] text-[var(--text-muted)]">Соседний остров с пещерами, садом и маяком — легко добавить к камакурскому дню.</p>
                  </div>
                  <span className="mt-5 inline-flex items-center gap-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                    Посмотреть маршрут
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </a>
                <a
                  key="/intercity/hakone"
                  href="/intercity/hakone"
                  className="group flex min-h-[178px] flex-col justify-between rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-warm)]"
                >
                  <div className="space-y-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Хаконэ</p>
                    <div className="space-y-1.5">
                      <h3 className="font-sans text-[20px] font-medium tracking-[-0.03em] text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">Тур в Хаконэ</h3>
                      <p className="text-[13px] font-medium text-[var(--accent)]">вулкан и озеро</p>
                    </div>
                    <p className="font-sans text-[14px] font-light leading-[1.75] text-[var(--text-muted)]">Горный курорт с Овакудани, канатной дорогой и онсэном — другой формат дня.</p>
                  </div>
                  <span className="mt-5 inline-flex items-center gap-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
                    Посмотреть маршрут
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </a>
                <a
                  key="/intercity/nikko"
                  href="/intercity/nikko"
                  className="group flex min-h-[178px] flex-col justify-between rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-warm)]"
                >
                  <div className="space-y-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Никко</p>
                    <div className="space-y-1.5">
                      <h3 className="font-sans text-[20px] font-medium tracking-[-0.03em] text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">Экскурсия в Никко</h3>
                      <p className="text-[13px] font-medium text-[var(--accent)]">история и горный лес</p>
                    </div>
                    <p className="font-sans text-[14px] font-light leading-[1.75] text-[var(--text-muted)]">Святилище Тосёгу, водопад и озеро — более торжественный и далёкий маршрут.</p>
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
    </>
  )
}
