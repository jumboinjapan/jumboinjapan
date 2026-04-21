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
  'Важнейший фактор при выборе маршрута, это то, сколько времени вы хотели бы провести в стране.',
  'Охват географии тесно связан с ритмом поездки. Смена отелей, расстояния и сам выбор локаций делают этот фактор самым важным и сложным.',
  'Выбор точки входа и выхода может сильно помочь в формировании маршрута. Как правило это Токио и Осака, но выбор может быть значительно шире.',
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
          <section className="max-w-4xl space-y-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Выбор маршрута</p>
            <h2 className="font-sans text-3xl font-medium tracking-[-0.02em] text-[var(--text)] md:text-4xl">
              Маршрут — больше, чем список точек на карте. Это решение о том, какую Японию вы хотите узнать.
            </h2>
          </section>

          <section className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
            {multiDayRouteCards.map((route) => (
              <MultiDayRouteCard key={route.slug} {...route} />
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
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Как читать раздел</p>
                <p className="text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                  На этой странице вы можете ознакомиться с ключевыми форматами больших поездок, здесь будут появляться новые шаблоны, с которыми мы можем начинать работать, подстраивая маршрут и наполнение под вашу группу.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-8 space-y-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Индивидуальный маршрут</p>
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em]">Ни один из готовых маршрутов не попал точно в вашу поездку?</h2>
            <p className="max-w-2xl text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Это нормальная ситуация. Иногда правильное решение не выбирать из готового, а собрать маршрут вокруг ваших дат, состава группы, интересов и нужного темпа.
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
