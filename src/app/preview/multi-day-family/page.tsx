import type { Metadata } from 'next'
import { PageHero } from '@/components/sections/PageHero'
import { MultiDayRouteCard } from '@/components/sections/MultiDayRouteCard'
import { PreviewVariantFlag } from '@/components/preview/PreviewVariantFlag'
import { multiDayRouteCards } from '@/data/multiDayRouteCards'

export const metadata: Metadata = {
  title: 'Preview — multi-day family | JumboInJapan',
  robots: { index: false, follow: false },
}

const summaryCards = [
  {
    title: 'Классическая Япония',
    text: 'Первый большой маршрут, если нужен понятный баланс между Токио, природной паузой, Киото, Нарой и Осакой без ощущения, что поездка распадается на куски.',
  },
  {
    title: 'Горная Япония',
    text: 'Выбор для тех, кому важнее не обязательная классика, а более редкая и глубинная версия страны — долины, деревянная архитектура, ритм небольших городов и горный воздух.',
  },
  {
    title: 'Свой маршрут',
    text: 'Нормальный сценарий, когда важнее даты, состав группы, логика прилёта и вылета, чем попытка подогнать поездку под готовый шаблон.',
  },
]

const philosophy = [
  'Сначала нужно выбрать не список городов, а тип поездки: первая большая Япония, более редкая горная версия или маршрут, который лучше собирать с нуля.',
  'Потом — понять ритм: сколько переездов внутри реально комфортно вашей группе, как часто менять отели и сколько насыщенных дней подряд хочется выдержать.',
  'Только после этого имеет смысл сравнивать сами маршруты как готовые сценарии, а не как набор привлекательных точек на карте.',
] as const

const helperCards = [
  {
    title: 'Для первой поездки по Японии',
    text: 'Family-страница должна быстрее подводить к классическому маршруту, если хочется увидеть опорную Японию без хаотичного конструирования с нуля.',
  },
  {
    title: 'Для тех, кто уже был в стране',
    text: 'Горная Япония должна читаться как самостоятельная логика выбора, а не как экзотическое дополнение к классике.',
  },
  {
    title: 'Для семей и маленьких групп',
    text: 'Кастомный маршрут должен появляться не как “если ничего не подошло”, а как нормальное решение, когда шаблон не совпадает с реальным темпом, датами и составом группы.',
  },
]

export default function PreviewMultiDayFamilyPage() {
  return (
    <>
      <PreviewVariantFlag />
      <PageHero
        image="/dest-multi-day-journeys-hero-20260421c.jpg"
        eyebrow="Многодневные туры · preview family"
        title="Маршруты по Японии на несколько дней"
        subtitle="Та же текущая multi-day логика, но с более сильным сравнением family-вариантов, ясным helper-слоем и навигацией между готовыми сценариями."
      />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-14 md:space-y-16">
          <section className="grid gap-8 md:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)] md:items-start">
            <div className="space-y-5">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Выбор многодневного маршрута</p>
              <h2 className="font-sans text-3xl font-medium tracking-[-0.02em] text-[var(--text)] md:text-4xl">
                Многодневный маршрут — это выбор не только географии, но и того, сколько смены, плотности и движения вы действительно хотите в поездке.
              </h2>
              <p className="text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                Здесь остаётся текущая структура multi-day family, но она становится яснее в главном: сначала человек различает три типа большой поездки — классический, горный и custom — а уже потом сравнивает карточки как готовые сценарии. Так family работает как навигация по логике путешествия, а не как просто полка маршрутов.
              </p>
            </div>
            <div className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Как читать раздел</p>
              <p className="mt-3 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                Сначала выбрать тип поездки, затем сравнить ритм и нагрузку от переездов, после этого перейти к готовому маршруту или сразу уйти в custom, если шаблон не совпадает с реальными датами и составом группы.
              </p>
            </div>
          </section>

          <section className="space-y-8">
            <div className="space-y-3">
              <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Сначала — логика выбора</h2>
              <div className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
                {philosophy.map((item) => (
                  <p key={item} className="bg-[var(--bg)] px-5 py-4 font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)] md:px-6">
                    {item}
                  </p>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {[
              'Классическая Япония — когда нужен первый большой маршрут с понятным культурным и географическим каркасом.',
              'Горная Япония — когда хочется менее очевидной страны: глубинка, долины, деревянная архитектура и другой темп.',
              'Custom — когда реальные даты, дети, возраст, логистика прилёта или темп группы важнее любого шаблона.',
            ].map((item) => (
              <article key={item} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
                <p className="text-[14px] font-light leading-[1.82] text-[var(--text-muted)]">{item}</p>
              </article>
            ))}
          </section>

          <section className="space-y-6">
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Сравнение family-вариантов</p>
              <h2 className="font-sans text-[26px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[32px]">Чем отличаются готовые многодневные сценарии</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {summaryCards.map((card) => (
                <article key={card.title} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
                  <h3 className="font-sans text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{card.title}</h3>
                  <p className="mt-3 text-[14px] font-light leading-[1.85] text-[var(--text-muted)]">{card.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-8">
            <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Готовые маршруты</h2>
            <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
              {multiDayRouteCards.map((route) => (
                <MultiDayRouteCard key={route.slug} {...route} />
              ))}
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {helperCards.map((card) => (
              <article key={card.title} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
                <h3 className="font-sans text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{card.title}</h3>
                <p className="mt-3 text-[14px] font-light leading-[1.85] text-[var(--text-muted)]">{card.text}</p>
              </article>
            ))}
          </section>

          <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-8 space-y-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Индивидуальный маршрут</p>
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em]">Когда лучше сразу идти в custom</h2>
            <p className="max-w-2xl text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Если готовые family-сценарии не совпадают с реальными датами, составом группы, темпом поездки, количеством переездов или логикой прилёта и вылета, правильнее сразу собирать свой маршрут, а не пытаться втиснуть поездку в неподходящий шаблон.
            </p>
            <a
              href="/multi-day/custom"
              className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
            >
              Перейти к текущему custom маршруту
            </a>
          </section>
        </div>
      </section>
    </>
  )
}
