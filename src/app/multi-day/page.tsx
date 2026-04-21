import type { Metadata } from 'next'
import { ExperienceCard } from '@/components/sections/ExperienceCard'
import { PageHero } from '@/components/sections/PageHero'
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
    description: 'Семь-восемь дней, после которых Япония становится не просто красивой, а понятной: Токио, Хаконэ, Киото, Нара и Осака в правильной последовательности.',
    duration: '7–8 дней',
    slug: 'multi-day/classic',
    image: '/tours/kyoto-1/kyoto-1.jpg',
  },
  {
    title: 'Горная Япония',
    description: 'Маршрут для тех, кому важнее не обязательная классика, а деревни, горные дороги, деревянная архитектура и более редкое ощущение страны.',
    duration: '5–6 дней',
    slug: 'multi-day/mountain',
    image: '/dest-multi-day-journeys-hero-20260421c.jpg',
  },
  {
    title: 'Своим маршрутом',
    description: 'Если сначала есть вы, ваш ритм, ваши интересы и ваша Япония, тогда маршрут строится вокруг них, а не наоборот.',
    duration: 'От 4 дней',
    slug: 'multi-day/custom',
    image: '/hero-city-tour-rainbow-bridge-tokyo-tower.jpg',
  },
] as const

const philosophy = [
  'Многодневный маршрут не должен напоминать список точек, который нужно просто успеть отметить.',
  'Хорошая поездка строится на ритме: где углубиться, где сделать паузу, где сменить декорацию, а где не тратить силы зря.',
  'Именно поэтому я собираю маршруты не как шаблоны, а как последовательные путешествия, в которых города, переезды и ночёвки работают как единая драматургия.',
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
          <section className="max-w-4xl space-y-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Выбор маршрута</p>
            <h2 className="font-sans text-3xl font-medium tracking-[-0.02em] text-[var(--text)] md:text-4xl">
              Маршрут — не список точек. Это решение о том, какую Японию вы хотите узнать.
            </h2>
          </section>

          <section className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
            {routeCards.map((route) => (
              <ExperienceCard key={route.slug} {...route} />
            ))}
          </section>

          <section className="grid gap-8 md:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] md:items-start">
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
            <div className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Как читать раздел</p>
              <p className="mt-3 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                На этой странице вы выбираете направление. Внутри каждой карточки уже открывается отдельный маршрут со своей логикой, фотографиями, структурой дней и подробным разбором поездки.
              </p>
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
