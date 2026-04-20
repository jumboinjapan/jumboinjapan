import { PageHero } from '@/components/sections/PageHero'
import { MultiDayJourneyTree } from '@/components/sections/MultiDayJourneyTree'
import type { MultiDayJourney } from '@/data/multiDayJourneys'

function getOvernightRows(journey: MultiDayJourney) {
  const counts = new Map<string, number>()

  for (const day of journey.days) {
    if (day.overnightCity === '—') continue
    counts.set(day.overnightCity, (counts.get(day.overnightCity) ?? 0) + 1)
  }

  return Array.from(counts.entries()).map(([city, nights]) => ({ city, nights }))
}

export function MultiDayRouteLanding({
  eyebrow,
  title,
  subtitle,
  image,
  intro,
  highlights,
  journey,
}: {
  eyebrow: string
  title: string
  subtitle: string
  image: string
  intro: string
  highlights: string[]
  journey: MultiDayJourney
}) {
  const overnights = getOvernightRows(journey)

  return (
    <>
      <PageHero image={image} eyebrow={eyebrow} title={title} subtitle={subtitle} />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-14 md:space-y-16">
          <section className="grid gap-8 md:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.9fr)] md:items-start">
            <div className="space-y-5">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">О маршруте</p>
              <h2 className="font-sans text-3xl font-medium tracking-[-0.02em] text-[var(--text)] md:text-4xl">
                Маршрут с уже собранной логикой, а не просто набором городов.
              </h2>
              <p className="text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{intro}</p>
            </div>
            <div className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Что здесь важно</p>
              <ul className="mt-4 space-y-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                {highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-4">
            <div className="bg-[var(--bg)] px-5 py-4 md:px-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Длительность</p>
              <p className="mt-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{journey.duration}</p>
            </div>
            <div className="bg-[var(--bg)] px-5 py-4 md:px-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">География</p>
              <p className="mt-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{journey.geography}</p>
            </div>
            <div className="bg-[var(--bg)] px-5 py-4 md:px-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Прилёт</p>
              <p className="mt-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{journey.arrival}</p>
            </div>
            <div className="bg-[var(--bg)] px-5 py-4 md:px-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Вылет</p>
              <p className="mt-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{journey.departure}</p>
            </div>
          </section>

          <section className="space-y-8">
            <div className="max-w-3xl space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Структура тура</p>
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Как маршрут развивается день за днём</h2>
              <p className="text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                Здесь сразу видно, где группа находится в каждый день, когда происходят переезды и в каком городе заканчивается вечер.
              </p>
            </div>

            <MultiDayJourneyTree journey={journey} />
          </section>

          <section className="space-y-6">
            <div className="max-w-3xl space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Ночёвки</p>
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Где группа ночует по ходу маршрута</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {overnights.map((row) => (
                <div key={`${journey.slug}-${row.city}`} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Ночёвка</p>
                  <p className="mt-2 text-[16px] font-medium tracking-[-0.01em] text-[var(--text)]">{row.city}</p>
                  <p className="mt-1 text-[14px] font-light leading-[1.7] text-[var(--text-muted)]">{row.nights} ночи</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-8 space-y-4">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em]">Обсудить этот маршрут</h2>
            <p className="max-w-2xl text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Если сама логика маршрута вам близка, дальше её можно адаптировать под даты, состав группы, темп поездки, багаж и ваши реальные интересы.
            </p>
            <a
              href="/contact"
              className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
            >
              Обсудить поездку
            </a>
          </section>
        </div>
      </section>
    </>
  )
}
