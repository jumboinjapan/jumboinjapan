import type { Metadata } from 'next'
import { PageHero } from '@/components/sections/PageHero'
import { MultiDayJourneyTree } from '@/components/sections/MultiDayJourneyTree'
import { experiences } from '@/data/experiences'
import { multiDayJourneys } from '@/data/multiDayJourneys'
import { tours } from '@/data/tours'

const tour = tours.find((t) => t.slug === 'multi-day')!
const experience = experiences.find((item) => item.slug === 'multi-day')

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

const readingGuide = [
  {
    title: 'От дня приезда до дня отъезда',
    text: 'Маршрут читается сверху вниз по дням, чтобы сразу было видно, как устроена вся поездка целиком.',
  },
  {
    title: 'Матрёшка маршрута',
    text: 'Каждый день раскрывается до уровня региона, города и ключевых точек, без перегруза длинными описаниями.',
  },
  {
    title: 'Переезды и ночёвки не спрятаны',
    text: 'Отдельно показано, где группа переезжает между регионами и в каком городе ночует каждый вечер.',
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
  if (!experience) return null

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />

      <PageHero
        image="/dest-multi-day-hero-20260421b.jpg"
        eyebrow="Многодневный маршрут"
        title="От прилёта до вылета, без хаоса"
        subtitle="Города, переезды, ключевые точки и ночёвки уже собраны в понятную структуру, которую можно читать как цельное путешествие."
      />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-14 md:space-y-16">
          <section className="grid gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)] md:items-start">
            <div className="space-y-5">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Как устроена страница</p>
              <h2 className="font-sans text-3xl font-medium tracking-[-0.02em] text-[var(--text)] md:text-4xl">
                Многодневный маршрут должен быть понятен ещё до первого сообщения.
              </h2>
            </div>
            <p className="text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
              {experience.intro}
            </p>
          </section>

          <section className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-4">
            <div className="bg-[var(--bg)] px-5 py-4 md:px-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Диапазон</p>
              <p className="mt-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">5–8 дней в зависимости от маршрута и ритма группы</p>
            </div>
            <div className="bg-[var(--bg)] px-5 py-4 md:px-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">География</p>
              <p className="mt-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">Токио, Хаконэ, Киото, Нара, Осака, Такаяма, Сиракава-го, Канадзава</p>
            </div>
            <div className="bg-[var(--bg)] px-5 py-4 md:px-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Что видно сразу</p>
              <p className="mt-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">Дни, переезды между регионами, ключевые точки и город ночёвки на каждый вечер</p>
            </div>
            <div className="bg-[var(--bg)] px-5 py-4 md:px-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Гибкость</p>
              <p className="mt-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">Маршрут можно адаптировать под темп группы, багаж, возраст и интересы</p>
            </div>
          </section>

          <section className="space-y-6">
            <div className="max-w-3xl space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Принцип чтения</p>
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Как читать предложенный маршрут</h2>
            </div>
            <div className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
              {readingGuide.map((item) => (
                <div key={item.title} className="bg-[var(--bg)] px-5 py-4 md:px-6">
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">{item.title}</p>
                  <p className="mt-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{item.text}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-8">
            <div className="max-w-3xl space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Готовые сценарии</p>
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Две логики многодневной поездки</h2>
              <p className="text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                Здесь уже не просто названия маршрутов, а их реальная форма. Каждый день можно раскрыть до региона, города и ключевых точек.
              </p>
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
