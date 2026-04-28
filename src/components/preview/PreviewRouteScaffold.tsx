import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowRight, Compass, Map, TrainFront, UserRound } from 'lucide-react'

type HeroStat = {
  label: string
  value: string
}

type RouteSegment = {
  label: string
  title: string
  body: string
  meta?: string
}

type TransitionNote = {
  title: string
  body: string
}

type AlternativeCard = {
  title: string
  body: string
}

type AttentionPoint = {
  title: string
  body: string
}

type TravelerFit = {
  title: string
  body: string
}

type TransportBadge = {
  label: string
  detail: string
  icon: 'train' | 'guide' | 'map'
}

function transportIcon(icon: TransportBadge['icon']) {
  if (icon === 'train') return <TrainFront className="h-4 w-4" aria-hidden="true" />
  if (icon === 'guide') return <UserRound className="h-4 w-4" aria-hidden="true" />
  return <Map className="h-4 w-4" aria-hidden="true" />
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">{eyebrow}</p>
        <span className="h-px w-12 bg-[var(--border)]" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h2 className="text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">{title}</h2>
        {description ? (
          <p className="max-w-3xl text-[15px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[16px]">{description}</p>
        ) : null}
      </div>
    </div>
  )
}

export function PreviewRouteScaffold({
  eyebrow,
  title,
  intro,
  note,
  heroStats,
  transportBadges,
  routeTitle,
  routeDescription,
  routeSegments,
  transitionTitle,
  transitionNotes,
  alternatives,
  attentionPoints,
  travelerFits,
  ctaLabel = 'Discuss this route language',
  children,
}: {
  eyebrow: string
  title: string
  intro: string
  note: string
  heroStats: HeroStat[]
  transportBadges?: TransportBadge[]
  routeTitle: string
  routeDescription: string
  routeSegments: RouteSegment[]
  transitionTitle: string
  transitionNotes: TransitionNote[]
  alternatives: AlternativeCard[]
  attentionPoints: AttentionPoint[]
  travelerFits: TravelerFit[]
  ctaLabel?: string
  children?: ReactNode
}) {
  return (
    <main className="bg-[var(--bg)] text-[var(--text)]">
      <section className="border-b border-[var(--border)] bg-[var(--bg-warm)] px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[minmax(0,1.15fr)_320px] lg:gap-16">
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Compass className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--accent)]">{eyebrow}</p>
              </div>
              <h1 className="max-w-4xl text-4xl font-medium tracking-[-0.04em] text-[var(--text)] md:text-5xl lg:text-[60px] lg:leading-[1.02]">
                {title}
              </h1>
              <p className="max-w-3xl text-[16px] font-light leading-[1.9] text-[var(--text-muted)] md:text-[18px]">
                {intro}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {heroStats.map((stat) => (
                <div key={stat.label} className="border border-[var(--border)] bg-[var(--bg)] px-5 py-5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">{stat.label}</p>
                  <p className="mt-2 text-[22px] font-medium tracking-[-0.03em] text-[var(--text)]">{stat.value}</p>
                </div>
              ))}
            </div>
          </div>

          <aside className="space-y-5 border border-[var(--border)] bg-[var(--bg)] p-6 md:p-7 lg:self-start">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">Preview note</p>
            <p className="text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{note}</p>
            {transportBadges?.length ? (
              <div className="space-y-3 border-t border-[var(--border)] pt-5">
                {transportBadges.map((badge) => (
                  <div key={badge.label} className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-[var(--border)] bg-[var(--bg-warm)] text-[var(--text)]">
                      {transportIcon(badge.icon)}
                    </div>
                    <div>
                      <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-[var(--text)]">{badge.label}</p>
                      <p className="mt-1 text-[14px] font-light leading-[1.75] text-[var(--text-muted)]">{badge.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center gap-2 bg-[var(--accent)] px-5 py-3 text-sm font-medium uppercase tracking-[0.12em] text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              {ctaLabel}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </aside>
        </div>
      </section>

      <section className="px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-14">
          <SectionHeading eyebrow="Route spine" title={routeTitle} description={routeDescription} />
          <div className="grid gap-4 lg:grid-cols-3">
            {routeSegments.map((segment, index) => (
              <article key={segment.title} className="border border-[var(--border)] bg-[var(--surface)] p-6 md:p-7">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">{segment.label}</p>
                  <span className="text-[12px] font-light text-[var(--text-muted)]">{String(index + 1).padStart(2, '0')}</span>
                </div>
                <h3 className="mt-4 text-[24px] font-medium tracking-[-0.03em] text-[var(--text)]">{segment.title}</h3>
                <p className="mt-3 text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{segment.body}</p>
                {segment.meta ? <p className="mt-4 border-t border-[var(--border)] pt-4 text-[12px] uppercase tracking-[0.14em] text-[var(--text-muted)]">{segment.meta}</p> : null}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--border)] bg-[var(--bg-warm)] px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
          <SectionHeading eyebrow="Movement" title={transitionTitle} description="The route language stays editorial, but the hand-off logic changes by family." />
          <div className="space-y-4">
            {transitionNotes.map((item) => (
              <article key={item.title} className="border-l border-[var(--border)] pl-5 md:pl-6">
                <h3 className="text-[18px] font-medium tracking-[-0.02em] text-[var(--text)]">{item.title}</h3>
                <p className="mt-2 text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {children ? <section className="px-4 py-16 md:px-6 md:py-24"><div className="mx-auto w-full max-w-6xl">{children}</div></section> : null}

      <section className="px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-2">
          <article className="border border-[var(--border)] bg-[var(--surface)] p-6 md:p-8">
            <SectionHeading eyebrow="Alternatives" title="Optional substitutions" description="Each preview keeps a helper layer without collapsing the main route spine." />
            <div className="mt-6 space-y-4">
              {alternatives.map((item) => (
                <div key={item.title} className="border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0">
                  <h3 className="text-[18px] font-medium tracking-[-0.02em] text-[var(--text)]">{item.title}</h3>
                  <p className="mt-2 text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{item.body}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="border border-[var(--border)] bg-[var(--surface)] p-6 md:p-8">
            <SectionHeading eyebrow="Worth attention" title="Extra points to surface" description="Not every note becomes a stop. Some details work better as editorial prompts." />
            <div className="mt-6 space-y-4">
              {attentionPoints.map((item) => (
                <div key={item.title} className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  <div>
                    <h3 className="text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{item.title}</h3>
                    <p className="mt-1 text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto w-full max-w-6xl space-y-8">
          <SectionHeading eyebrow="Traveler fit" title="Who this facade reads best for" description="The language changes by trip family, but the brand voice stays one house." />
          <div className="grid gap-4 md:grid-cols-3">
            {travelerFits.map((item) => (
              <article key={item.title} className="border border-[var(--border)] bg-[var(--bg)] p-6">
                <h3 className="text-[20px] font-medium tracking-[-0.02em] text-[var(--text)]">{item.title}</h3>
                <p className="mt-3 text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
