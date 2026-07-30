import Link from 'next/link'
import { buildPageMetadata } from '@/lib/page-metadata'
import { typoDeep } from '@/lib/typography'

const sections = typoDeep([
  {
    href: '/resources/hotels',
    title: 'Отели',
    description:
      'Подборка по регионам и уровню — чтобы быстрее понять, где имеет смысл жить, а не просто открыть длинный список.',
  },
  {
    href: '/resources/restaurants',
    title: 'Рестораны',
    description:
      'Собранные варианты для тех дней, когда хочется заранее выбрать хороший ужин или понимать, в каком районе бронировать стол.',
  },
  {
    href: '/resources/services',
    title: 'Услуги',
    description:
      'Практичные сервисы и занятия, которые полезно добавить в поездку только там, где они действительно усиливают маршрут.',
  },
  {
    href: '/resources/events',
    title: 'События',
    description:
      'Раздел ресурсов с выставками, концертами и другими событиями с актуальными датами — чтобы временные записи оставались в общей структуре поездки.',
  },
] as const)

export const metadata = buildPageMetadata('/resources', {
  title: 'Ресурсы для поездки по Японии',
  description:
    'Подборки отелей, ресторанов, сервисов и актуальных событий по Японии с коротким редакторским ориентиром: с чего начать и как использовать списки при планировании.',
})

export default function ResourcesPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-12 md:px-6 md:py-16">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <header className="max-w-4xl space-y-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--accent)]">Ресурсы</p>
          <h1 className="text-page">Рабочая база для поездки</h1>
          <p className="text-body-sm leading-[1.85] text-[var(--text-muted)]">
            Только по реально доступным разделам: здесь собраны те, которые уже реально работают на сайте: отели, рестораны, полезные сервисы и раздел «События» внутри ресурсов.
            Это не попытка покрыть всё подряд. Скорее — выверенная база, от которой удобно оттолкнуться, а дальше уже уточнить район,
            темп поездки и общий стиль маршрута.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <article className="border border-[var(--border)] bg-[var(--bg)] p-5">
            <h3 className="text-lg">С чего начать</h3>
            <p className="mt-3 text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">
              Сначала — города и ритм поездки. Только после этого имеет смысл выбирать конкретный отель, сервис или вечерний ужин.
            </p>
          </article>
          <article className="border border-[var(--border)] bg-[var(--bg)] p-5">
            <h3 className="text-lg">Как использовать списки</h3>
            <p className="mt-3 text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">
              Лучше воспринимать их как короткий шорт-лист. Достаточно нескольких сильных вариантов — просматривать всё не обязательно.
            </p>
          </article>
          <article className="border border-[var(--border)] bg-[var(--bg)] p-5">
            <h3 className="text-lg">Где искать события</h3>
            <p className="mt-3 text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">
              Выставки, концерты и сезонные события живут в разделе «События» — в статичные подборки они не попадают.
            </p>
          </article>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {sections.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="group flex h-full flex-col border border-[var(--border)] bg-[var(--bg)] p-6 transition-colors hover:border-[var(--text)]"
            >
              <h3 className="text-xl">{section.title}</h3>
              <p className="mt-3 flex-1 text-body-sm font-light leading-[1.85] text-[var(--text-muted)]">{section.description}</p>
              <span className="mt-5 inline-flex min-h-11 items-center text-sm font-medium uppercase tracking-wide text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">
                Открыть раздел →
              </span>
            </Link>
          ))}
        </div>

        <div className="max-w-4xl border border-[var(--border)] bg-[var(--bg)] px-5 py-4 text-body-sm font-light leading-[1.85] text-[var(--text-muted)] md:px-6">
          Если вы уже понимаете, что хотите связать ресурсы с конкретными экскурсиями, удобнее всего начать с{'\u00A0'}
          <Link href="/intercity" className="text-[var(--accent)] underline underline-offset-4">
            загородных маршрутов
          </Link>{' '}
          или{' '}
          <Link href="/city-tour" className="text-[var(--accent)] underline underline-offset-4">
            туров по Токио
          </Link>
          , а потом вернуться сюда за деталями.
        </div>
      </div>
    </section>
  )
}
