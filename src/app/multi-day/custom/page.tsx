import type { Metadata } from 'next'
import { PageHero } from '@/components/sections/PageHero'

export const metadata: Metadata = {
  title: 'Индивидуальный маршрут по Японии | JumboInJapan',
  description: 'Многодневный маршрут по Японии с нуля: под ваш ритм, города, интересы, состав группы и реальную географию поездки.',
  alternates: { canonical: 'https://jumboinjapan.com/multi-day/custom' },
  openGraph: {
    title: 'Индивидуальный маршрут по Японии | JumboInJapan',
    description: 'Маршрут по Японии, собранный не по шаблону, а под ваши даты, интересы и логику поездки.',
    images: [{ url: 'https://jumboinjapan.com/hero-city-tour-rainbow-bridge-tokyo-tower.jpg' }],
  },
}

const principles = [
  {
    title: 'Сначала ритм, потом точки',
    text: 'Маршрут строится не из списка городов, а из того, как вам хочется прожить поездку: спокойно, плотно, с паузами или с сильными сменами декораций.',
  },
  {
    title: 'Переезды как часть логики, а не штраф',
    text: 'Сразу учитываются багаж, пересадки, родители, дети, длительные переезды и то, где группе действительно лучше ночевать.',
  },
  {
    title: 'Из интересов собирается структура',
    text: 'Арт, гастрономия, глубинка, архитектура, онсэны, шоппинг, малые города или сезонные события — маршрут складывается вокруг этого, а не вокруг шаблона.',
  },
] as const

export default function MultiDayCustomPage() {
  return (
    <>
      <PageHero
        image="/hero-city-tour-rainbow-bridge-tokyo-tower.jpg"
        eyebrow="Индивидуальный маршрут"
        title="Маршрут по Японии, собранный под вас"
        subtitle="Не шаблонная программа, а поездка, в которой города, переезды и ночёвки выстроены под ваш темп и интересы."
      />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-14 md:space-y-16">
          <section className="grid gap-8 md:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.9fr)] md:items-start">
            <div className="space-y-5">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Как это работает</p>
              <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] text-[var(--text)] md:text-4xl">
                Если сначала есть ваши интересы, а маршрут строится уже вокруг них.
              </h1>
              <p className="text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                Такой формат нужен, когда готовый маршрут почти подходит, но не попадает в ваш темп, состав группы или географию поездки. Вместо того чтобы подгонять себя под шаблон, логичнее собрать поездку с нуля: от дня прилёта до дня вылета, с понятной логикой переездов и ночёвок.
              </p>
            </div>
            <div className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Что можно задать заранее</p>
              <ul className="mt-4 space-y-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                <li>Даты прилёта и вылета</li>
                <li>Количество человек и возраст группы</li>
                <li>Города, которые уже точно нужны</li>
                <li>Интересы, без которых поездка не имеет смысла</li>
                <li>Комфортный темп и готовность к переездам</li>
              </ul>
            </div>
          </section>

          <section className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
            {principles.map((item) => (
              <div key={item.title} className="bg-[var(--bg)] px-5 py-4 md:px-6">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">{item.title}</p>
                <p className="mt-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{item.text}</p>
              </div>
            ))}
          </section>

          <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-8 space-y-4">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em]">Обсудить индивидуальный маршрут</h2>
            <p className="max-w-2xl text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Напишите даты, состав группы и пару слов о том, как вы хотите прожить поездку. Дальше можно собрать маршрут, в котором логика дней, городов, переездов и ночёвок будет работать именно под вас.
            </p>
            <a
              href="/contact"
              className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
            >
              Написать и обсудить маршрут
            </a>
          </section>
        </div>
      </section>
    </>
  )
}
