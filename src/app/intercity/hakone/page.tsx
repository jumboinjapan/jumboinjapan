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
      'Хаконэ хорошо подходит путешественникам, кому хотелось бы провести тихий день любования природой с возможностью закончить маршрут онсэном или ночёвкой.',
  },
  {
    title: 'Семьи с детьми 8+',
    description:
      'Маршрут держится на смене впечатлений, а не на длинных переходах: корабль, канатная дорога, вулканическая долина и музей не создают впечатления бега даже в рамках одного дня',
  },
  {
    title: 'На пути от Фудзи в Киото или Нагано',
    description:
      'Идеальный первый загородный выезд: идеально подходит как часть в начале большой поездки, сильные визуальные впечатления от красивой природы в любую погоду.',
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
      title: 'Частный транспорт',
      Icon: UserRound,
      scores: { стоимость: 4, гибкость: guideFlexibility, комфорт: 4 },
      summary: 'Лучший выбор, если хочется пройти Хаконэ комфортно, без пересадок, толкучки, ожидания маршрутного транспорта.',
    },
  ]
  const routeStops = buildIntercityRouteStops('hakone', getIntercityRouteSeed('hakone'), pois)
  const helperPois = getIntercityHelperPois('hakone', pois)

  // Curated 4 helper POIs with mapping for scenarios (Airtable-driven subset, no hardcode of main route POIs)
  const curatedHelperIds = new Set(['POI-000042', 'POI-000044', 'POI-000367', 'POI-000043']) // Pola, Enoura Observatory, Lalique Museum Hakone, Okada Museum
  const curatedHelperPois = helperPois
    .filter((p) => curatedHelperIds.has(p.poiId))
    .sort((a, b) => Array.from(curatedHelperIds).indexOf(a.poiId) - Array.from(curatedHelperIds).indexOf(b.poiId))
  const helperCriteria: Record<string, string> = {
    'POI-000042': 'Для искусства',
    'POI-000044': 'Для архитектуры',
    'POI-000367': 'Для искусства',
    'POI-000043': 'С ночёвкой',
  }

  const timelineStops = routeStops.map((stop) => {
    if (stop.title === 'Застава Хаконэ Сэкисё') {
      return {
        ...stop,
        type: 'landmark' as const,
        sellingHighlights: [
          { title: 'Лавка Мураяма Буссан', body: 'Традиционная техника ёсэги дзайку — деревянная мозаика, которой около 200 лет.' },
          { title: 'Музей шкатулок с секретом', body: 'Японские хако — шкатулки с потайным механизмом открытия, которые нельзя найти больше нигде.' },
          { title: 'Смотровая площадка', body: 'Вид на озеро Аси и Фудзи — при ясной погоде одна из лучших точек в районе.' },
        ],
      }
    }

    if (stop.title === 'Хаконэ Дзиндзя' || stop.title === 'Святилище Хаконэ Дзиндзя') {
      return {
        ...stop,
        type: 'shrine' as const,
        sellingHighlights: [
          { title: 'Тории в воде', body: 'Красивые ворота цвета киноварь установленные на краю озера,' },
          { title: 'Анзан-но-ки', body: 'Древнее дерево, исполняющее просьбы о зачатии ребёнка и лёгких родах.' },
          { title: 'Пруд Бэндзайтэн', body: 'Атмосферный пруд у входа на территорию святилища' },
        ],
      }
    }

    if (stop.title === 'Круиз по озеру Аси') {
      return {
        ...stop,
        type: 'cruise' as const,
        sellingHighlights: [
          { title: 'Павильон Рюгудэн', body: 'Отель, построенный в архитектурном образе Павильона Феникса из храма Бёдо-ин.' },
          { title: 'Вид на Фудзи', body: 'С набережной перед посадкой на кораблик при ясной погоде открывается красивый вид на гору Фудзи.' },
        ],
      }
    }

    if (stop.title === 'Канатная дорога Хаконэ') {
      return {
        ...stop,
        type: 'ropeway' as const,
        sellingHighlights: [
          { title: 'Вид на Фудзи', body: 'Открывается на участке от Соундзан до Тогэндай при ясной погоде.' },
          { title: 'Чёрные яйца Овакудани', body: 'Не забудьте отведать волшебные черные яйца сваренные в вулкане считается они добавляют тем кто их съел целых 7 лет жизни.' },
        ],
      }
    }

    if (stop.title === 'Овакудани') {
      return {
        ...stop,
        type: 'volcano' as const,
        sellingHighlights: [
          { title: 'Чёрное яйцо кудзётамаго', body: 'Сварено в горячих источниках, продаётся по 5 штук. Легенда: +7 лет жизни.' },
          { title: 'Вулканическая тропа', body: 'При открытии — 400 м по кратеру. Только по предварительной записи.' },
        ],
      }
    }

    if (stop.title === 'Музей под открытым небом Хаконэ' || stop.title === 'Музей под открытым небом') {
      return {
        ...stop,
        title: 'Музей под открытым небом Hakone Open Air',
        description: 'Музей "Роща скульптур" под открытым небом в Хаконэ — горный парк где работы мастеров скульптуры выставлены в открытом пространстве. На лужайках и склонах стоят работы Генри Мура, Родена и Миро. В павильоне Пикассо показывают керамику, картины и другие работы мастера',
        type: 'museum' as const,
        sellingHighlights: [
          { title: 'Зал Пикассо', body: 'В павильоне Пикассо показывают керамику, картины и другие работы мастера' },
          { title: 'Скульптуры Родена под небом', body: 'Работы расставлены по открытым лужайкам без ограждений — можно подходить вплотную.' },
          { title: 'Стеклянная башня с витражами', body: 'Башня Симфония из 1000 витражных панелей. Внутри — цветовое погружение.' },
        ],
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
        subtitle="Хаконэ — день, когда картинка Токио постепенно растворяется за спиной уступая место красотами горного озера Аси, кедровым аллеям и вулканической долине Овакудани где еще живы легенды."
        objectPosition="center 30%"
      />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto w-full max-w-6xl space-y-10 md:space-y-14">
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
                value: 'Полный день и более',
              },
              {
                label: 'СТАРТ',
                value: 'Из Токио, Иокогама, Фудзи, Готемба, Хаконе',
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
              title="Горный курорт с широкой географией мест."
            />
            <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text)] md:text-[16px]">
              День в Хаконе зависит от погоды, расписания местного транспорта, очередей, пересадок и видимости на гору Фудзи. Задача гида — не просто рассказать историю, а сохранить цельность маршрута: если требуется предложить альтернативы или дополнения.
            </p>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Частный транспорт для лучшего комфорта</p>
              </div>
              <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Маршрут с учетом погодных условия</p>
              </div>
              <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-warm)] p-6">
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">Регулируйте темп движения</p>
              </div>
            </div>
          </section>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading
              eyebrow="Маршрут"
              title="Хаконэ: место встречи истории, природы и искусства"
            />
            <IntercityRouteTimeline stops={timelineStops} initiallyExpandedIndexes={[0, 1]} />
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
              description="Если вам хотелось бы сместить акценты в рамках дня или в планах остановка в Хаконе в течении нескольких дней, ниже — здесь точки, которые действительно помогут глубже раскрыть характер региона"
            />
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
              <p><strong>Общественный транспорт:</strong> ~¥3 500–7 500 туда-обратно, 2–2.5ч, 5-6 пересадок</p>
              <p><strong>Частный транспорт:</strong> договорная стоимость, без пересадок, гибкий ритм дня</p>
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
