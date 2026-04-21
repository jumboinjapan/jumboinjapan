import type { Metadata } from 'next'
import { ExperienceCard } from '@/components/sections/ExperienceCard'
import { PageHero } from '@/components/sections/PageHero'
import { MultiDayJourneyTree } from '@/components/sections/MultiDayJourneyTree'
import { multiDayJourneys } from '@/data/multiDayJourneys'
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

const routeCards = [
  {
    title: 'Классическая Япония',
    description: 'Токио, Хаконэ, Киото, Нара и Осака. Маршрут для первого большого знакомства со страной без хаотичных переездов.',
    duration: '7–8 дней',
    slug: 'multi-day/classic',
    image: '/tours/kyoto-1/kyoto-1.jpg',
  },
  {
    title: 'Горная Япония',
    description: 'Такаяма, Сиракава-го и Канадзава. Глубинка, горные деревни, деревянная архитектура и более редкая Япония.',
    duration: '5–6 дней',
    slug: 'multi-day/mountain',
    image: '/dest-multi-day-journeys-hero-20260421c.jpg',
  },
  {
    title: 'Своим маршрутом',
    description: 'Если сначала есть ваши интересы, темп и география, а маршрут собирается уже вокруг них, а не наоборот.',
    duration: 'От 4 дней',
    slug: 'multi-day/custom',
    image: '/hero-city-tour-rainbow-bridge-tokyo-tower.jpg',
  },
] as const

const transferPrinciples = [
  {
    title: 'Поезд там, где железнодорожная ось сильнее машины',
    text: 'Между крупными городами синкансэн часто даёт самый чистый и предсказуемый ритм без лишней логистики.',
  },
  {
    title: 'Частный транспорт там, где он действительно снимает трение',
    text: 'Багаж, родители, дети, горная география или день с нестандартной связкой точек, вот где машина заметно меняет качество маршрута.',
  },
  {
    title: 'Смешанная логистика чаще всего оказывается лучшим сценарием',
    text: 'Поезд между сильными городами, локальная машина там, где важно сохранить силы, темп и не потерять полдня на стыковках.',
  },
] as const

function getOvernightRows(journeySlug: string) {
  const journey = multiDayJourneys.find((item) => item.slug === journeySlug)
  if (!journey) return []

  const counts = new Map<string, number>()

  for (const day of journey.days) {
    if (day.overnightCity === '—') continue
    counts.set(day.overnightCity, (counts.get(day.overnightCity) ?? 0) + 1)
  }

  return Array.from(counts.entries()).map(([city, nights]) => ({
    city,
    nights,
  }))
}

const overnightSummaries = [
  {
    title: 'Классическая Япония',
    note: 'Маршрут собран так, чтобы не менять отель без причины и не превращать поездку в бесконечную упаковку чемоданов.',
    rows: getOvernightRows('classic-japan'),
  },
  {
    title: 'Горная Япония',
    note: 'Ночёвки стоят в тех точках, где группе удобно выдохнуть и не ехать в следующий регион слишком рано или слишком поздно.',
    rows: getOvernightRows('mountain-japan'),
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
        subtitle="Готовые направления и индивидуальные маршруты, собранные как цельное путешествие, а не как набор случайных точек."
      />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-14 md:space-y-16">
          <section className="space-y-8">
            <div className="max-w-3xl space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Маршруты</p>
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Выберите логику поездки</h2>
            </div>
            <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
              {routeCards.map((route) => (
                <ExperienceCard key={route.slug} {...route} />
              ))}
            </div>
          </section>

          <section className="space-y-8">
            <div className="max-w-3xl space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Как выглядит маршрут внутри</p>
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Две готовые логики многодневной поездки</h2>
            </div>

            <div className="space-y-8">
              {multiDayJourneys.map((journey) => (
                <MultiDayJourneyTree key={journey.slug} journey={journey} />
              ))}
            </div>
          </section>

          <section className="space-y-6">
            <div className="max-w-3xl space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Ночёвки</p>
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Где спит группа и почему это удобно</h2>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              {overnightSummaries.map((summary) => (
                <article key={summary.title} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">{summary.title}</p>
                  <div className="mt-4 space-y-2">
                    {summary.rows.map((row) => (
                      <div key={`${summary.title}-${row.city}`} className="flex items-center justify-between gap-4 rounded-sm border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
                        <span className="text-[14px] font-light leading-[1.7] text-[var(--text-muted)]">{row.city}</span>
                        <span className="text-[13px] font-medium tracking-[0.01em] text-[var(--text)]">{row.nights} ночи</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{summary.note}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-6">
            <div className="max-w-3xl space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Переезды</p>
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Как обычно устроена логистика</h2>
            </div>
            <div className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
              {transferPrinciples.map((item) => (
                <div key={item.title} className="bg-[var(--bg)] px-5 py-4 md:px-6">
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">{item.title}</p>
                  <p className="mt-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{item.text}</p>
                </div>
              ))}
            </div>
            <p className="text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
              Подробнее про логику общественного и частного транспорта можно посмотреть на страницах{' '}
              <a href="/intercity/public" className="underline decoration-[var(--border)] underline-offset-4 transition-colors hover:text-[var(--accent)]">общественного транспорта</a>{' '}
              и{' '}
              <a href="/intercity/private" className="underline decoration-[var(--border)] underline-offset-4 transition-colors hover:text-[var(--accent)]">частного транспорта</a>.
            </p>
          </section>

          <section className="grid gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] md:items-start">
            <div className="space-y-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Индивидуальный маршрут</p>
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Если поездка должна быть собрана с нуля</h2>
              <p className="text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                Такой же принцип можно применить к полностью индивидуальному маршруту: день приезда, переезды, ночёвки и ключевые точки складываются в понятную схему ещё до бронирования.
              </p>
            </div>
            <div className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-5 py-5 md:px-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Что нужно от вас</p>
              <ul className="mt-3 space-y-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                <li>Даты приезда и вылета</li>
                <li>Количество человек и состав группы</li>
                <li>Темп поездки и важные интересы</li>
                <li>Желаемая глубина маршрута, а не просто список городов</li>
              </ul>
              <a
                href="/contact"
                className="mt-5 inline-flex min-h-[44px] items-center rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
              >
                Обсудить свой маршрут
              </a>
            </div>
          </section>
        </div>
      </section>
    </>
  )
}
