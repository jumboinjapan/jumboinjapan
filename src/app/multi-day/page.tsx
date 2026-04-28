import type { Metadata } from 'next'
import { MultiDayRouteCard } from '@/components/sections/MultiDayRouteCard'
import { PageHero } from '@/components/sections/PageHero'
import { multiDayRouteCards } from '@/data/multiDayRouteCards'
import { tours } from '@/data/tours'

const tour = tours.find((t) => t.slug === 'multi-day')!

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    images: [{ url: tour.image }],
  },
}

const tourSchema = {
  '@context': 'https://schema.org',
  '@type': 'TouristTrip',
  name: tour.titleEn,
  description: tour.description,
  touristType: 'Russian-speaking tourists',
  provider: {
    '@type': 'Person',
    name: 'Eduard Revidovich',
    url: 'https://jumboinjapan.com',
  },
  offers: {
    '@type': 'Offer',
    availability: 'https://schema.org/InStock',
    url: `https://jumboinjapan.com/${tour.slug}`,
  },
}

const philosophy = [
  'Сначала важно понять не просто сколько дней у вас есть, а какой ритм поездки вам подходит: плотный, спокойный или собранный вокруг конкретной географии.',
  'Охват маршрута связан со сменой отелей, переездами и общей нагрузкой. Именно это делает выбор multi-day сценария самым важным и самым сложным.',
  'Точка входа и выхода может радикально упростить маршрут: чаще всего это Токио и Осака, но правильная логика поездки не обязана держаться только за эти города.',
] as const

const familySummary = [
  {
    label: 'Семейство',
    value: '3 сценария',
    note: 'Классическая Япония · Горная Япония · Свой маршрут',
  },
  {
    label: 'Диапазон',
    value: 'От 4 до 8+ дней',
    note: 'Под разный темп, глубину и географию поездки',
  },
  {
    label: 'Ключевой выбор',
    value: 'Ритм, а не список точек',
    note: 'Сначала понять нагрузку и характер путешествия, потом выбирать маршрут',
  },
] as const

export default function MultiDayPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />

      <PageHero
        image="/dest-multi-day-journeys-hero-20260421c.jpg"
        eyebrow="Многодневные туры"
        title="Маршруты по Японии на несколько дней"
        subtitle="Используйте примеры популярных маршрутов, собранных как цельное путешествие, или соберите свой уникальный тур."
      />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-14 md:space-y-16">
          <section className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] lg:items-start">
            <div className="max-w-4xl space-y-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Выбор маршрута</p>
              <h2 className="font-sans text-3xl font-medium tracking-[-0.02em] text-[var(--text)] md:text-4xl">
                Многодневный маршрут — это решение не только о географии, но и о темпе, плотности и характере всей поездки.
              </h2>
            </div>
            <aside className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Как устроен раздел</p>
              <p className="mt-3 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                Сначала понять тип большой поездки, затем сравнить готовые сценарии и только после этого идти в конкретный маршрут или сразу в custom, если шаблон не совпадает с реальной группой и датами.
              </p>
            </aside>
          </section>

          <section className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
            {familySummary.map((item) => (
              <article key={item.label} className="bg-[var(--bg)] px-5 py-4 md:px-6">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">{item.label}</p>
                <p className="mt-2 text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{item.value}</p>
                <p className="mt-1 text-[13px] font-light leading-[1.7] text-[var(--text-muted)]">{item.note}</p>
              </article>
            ))}
          </section>

          <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-8">
            <div className="grid gap-8 md:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] md:gap-10">
              <div className="space-y-5">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">По какому принципу строится маршрут</p>
                <div className="space-y-4">
                  {philosophy.map((item) => (
                    <p key={item} className="text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                      {item}
                    </p>
                  ))}
                </div>
              </div>
              <div className="space-y-4 border-t border-[var(--border)] pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Типы сценариев</p>
                <div className="space-y-3 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                  <p>Классическая Япония — для первой большой поездки с понятным культурным и географическим каркасом.</p>
                  <p>Горная Япония — для тех, кому важнее глубинка, долины, деревянная архитектура и менее очевидный ритм страны.</p>
                  <p>Свой маршрут — когда реальные даты, состав группы и темп важнее любого готового шаблона.</p>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-8">
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Готовые маршруты</p>
              <h2 className="font-sans text-[26px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[32px]">С чего начать выбор внутри multi-day family</h2>
            </div>
            <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
              {multiDayRouteCards.map((route) => (
                <MultiDayRouteCard key={route.slug} {...route} />
              ))}
            </div>
          </section>

          <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-8 space-y-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Индивидуальный маршрут</p>
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em]">Ни один из готовых маршрутов не попал точно в вашу поездку?</h2>
            <p className="max-w-2xl text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Это нормальная ситуация. Иногда правильное решение не выбирать из готового, а собрать маршрут вокруг ваших дат, состава группы, интересов, темпа и логики всей поездки.
            </p>
            <a
              href="/multi-day/custom"
              className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
            >
              Собрать свой маршрут
            </a>
          </section>
        </div>
      </section>
    </>
  )
}
