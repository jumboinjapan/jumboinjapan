import Link from 'next/link'
import { ArrowRight, Check, Clock3, MapPin, Shuffle, TrainFront, UserRound } from 'lucide-react'
import { PageHero } from '@/components/sections/PageHero'

type SummaryStat = {
  label: string
  value: string
  note?: string
}

type ComparisonItem = {
  title: string
  summary: string
}

type RouteStep = {
  eyebrow?: string
  title: string
  description: string
}

type HelperCard = {
  title: string
  description: string
}

type LogisticsCard = {
  title: string
  summary: string
  tone?: 'default' | 'accent'
}

type RelatedLink = {
  href: string
  label: string
}

export function PreviewRouteScaffold({ hero, intro, familyLabel, familySummary, stats, comparisonTitle, comparisonItems, routeTitle, routeSteps, helperTitle, helperCards, logisticsTitle, logisticsCards, cta, related }: {
  hero: {
    image: string
    alt?: string
    eyebrow: string
    title: string
    subtitle: string
    objectPosition?: string
  }
  intro: string
  familyLabel: string
  familySummary: string
  stats: SummaryStat[]
  comparisonTitle: string
  comparisonItems: ComparisonItem[]
  routeTitle: string
  routeSteps: RouteStep[]
  helperTitle: string
  helperCards: HelperCard[]
  logisticsTitle: string
  logisticsCards: LogisticsCard[]
  cta: {
    title: string
    description: string
    href: string
    label: string
  }
  related: RelatedLink[]
}) {
  return (
    <>
      <PageHero {...hero} />
      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-14 md:space-y-18">
          <section className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:items-start">
            <div className="space-y-5">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">{familyLabel}</p>
              <p className="max-w-3xl text-[15px] font-light leading-[1.9] text-[var(--text-muted)] md:text-[16px]">{intro}</p>
            </div>
            <aside className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Ориентир по странице</p>
              <p className="mt-3 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{familySummary}</p>
            </aside>
          </section>

          <section className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-4">
            {stats.map((stat) => (
              <article key={stat.label} className="bg-[var(--bg)] px-5 py-4 md:px-6">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">{stat.label}</p>
                <p className="mt-2 text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{stat.value}</p>
                {stat.note ? <p className="mt-1 text-[13px] font-light leading-[1.7] text-[var(--text-muted)]">{stat.note}</p> : null}
              </article>
            ))}
          </section>

          <section className="space-y-6">
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Сравнение и выбор</p>
              <h2 className="font-sans text-[26px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[32px]">{comparisonTitle}</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {comparisonItems.map((item) => (
                <article key={item.title} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
                  <h3 className="font-sans text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{item.title}</h3>
                  <p className="mt-3 text-[14px] font-light leading-[1.85] text-[var(--text-muted)]">{item.summary}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-6">
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Структура маршрута</p>
              <h2 className="font-sans text-[26px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[32px]">{routeTitle}</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {routeSteps.map((step, index) => (
                <article key={`${step.title}-${index}`} className="rounded-sm border border-[var(--border)] bg-[var(--bg)] p-5 md:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">{step.eyebrow ?? `Блок ${index + 1}`}</p>
                      <h3 className="mt-2 font-sans text-[18px] font-medium tracking-[-0.02em] text-[var(--text)]">{step.title}</h3>
                    </div>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                      {index === 0 ? <MapPin className="h-4 w-4" /> : index === 1 ? <Shuffle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                    </span>
                  </div>
                  <p className="mt-3 text-[14px] font-light leading-[1.85] text-[var(--text-muted)]">{step.description}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Кому и когда подходит</p>
              <h2 className="font-sans text-[26px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[32px]">{helperTitle}</h2>
              <div className="space-y-4">
                {helperCards.map((card) => (
                  <article key={card.title} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
                    <h3 className="font-sans text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{card.title}</h3>
                    <p className="mt-3 text-[14px] font-light leading-[1.85] text-[var(--text-muted)]">{card.description}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Логистика</p>
              <h2 className="font-sans text-[26px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[32px]">{logisticsTitle}</h2>
              <div className="space-y-4">
                {logisticsCards.map((card, index) => (
                  <article key={card.title} className={`rounded-sm border p-5 md:p-6 ${card.tone === 'accent' ? 'border-[var(--accent)] bg-[var(--bg)]' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                        {index === 0 ? <TrainFront className="h-4 w-4" /> : index === 1 ? <UserRound className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                      </span>
                      <h3 className="font-sans text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{card.title}</h3>
                    </div>
                    <p className="mt-3 text-[14px] font-light leading-[1.85] text-[var(--text-muted)]">{card.summary}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-6 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:px-8 md:py-8">
            <div className="space-y-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Следующий шаг</p>
              <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">{cta.title}</h2>
              <p className="max-w-2xl text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{cta.description}</p>
            </div>
            <Link href={cta.href} className="inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white">
              {cta.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </section>

          <nav className="space-y-4" aria-label="Связанные preview маршруты">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Родитель и соседние маршруты</p>
            <div className="flex flex-wrap gap-3">
              {related.map((link) => (
                <Link key={link.href} href={link.href} className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--border)] px-4 py-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
                  {link.label}
                </Link>
              ))}
            </div>
          </nav>
        </div>
      </section>
    </>
  )
}
