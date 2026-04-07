import Link from "next/link";
import { PageHero } from "@/components/sections/PageHero";
import { ImageCarousel } from "@/components/sections/ImageCarousel";

type DecisionCard = {
  title: string;
  description: string;
};

interface TravelFormatPageProps {
  eyebrow?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  heroImage?: string;
  heroAlt?: string;
  title: string;
  subtitle: string;
  intro: string;
  decisionSummary?: string[];
  goodFit?: string[];
  notIdeal?: string[];
  rationalWhen?: string[];
  tradeoffs?: string[];
  decisionCards?: DecisionCard[];
  ctaText?: string;
  secondaryCta?: {
    href: string;
    label: string;
  };
  images?: string[];
}

export function TravelFormatPage({
  eyebrow,
  heroTitle,
  heroSubtitle,
  heroImage,
  heroAlt,
  title,
  subtitle,
  intro,
  decisionSummary,
  goodFit,
  notIdeal,
  rationalWhen,
  tradeoffs,
  decisionCards,
  ctaText = "Обсудить маршрут",
  secondaryCta,
  images,
}: TravelFormatPageProps) {
  return (
    <>
      {heroImage ? (
        <PageHero
          image={heroImage}
          alt={heroAlt ?? heroTitle ?? title}
          eyebrow={eyebrow}
          title={heroTitle ?? title}
          subtitle={heroSubtitle ?? subtitle}
        />
      ) : null}

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] lg:items-start">
            <div className="space-y-5">
              <div className="space-y-3">
                <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                  {subtitle}
                </p>
                <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">{title}</h1>
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{intro}</p>
              </div>

              {decisionSummary && decisionSummary.length > 0 ? (
                <div className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
                  {decisionSummary.map((item) => (
                    <p
                      key={item}
                      className="bg-[var(--bg)] px-5 py-4 font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)] md:px-6"
                    >
                      {item}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>

            <aside className="space-y-4 border border-[var(--border)] bg-[var(--bg)] p-6">
              <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                Быстрый вывод
              </p>
              <div className="space-y-3 text-[14px] font-light leading-[1.85] text-[var(--text-muted)]">
                {(rationalWhen ?? tradeoffs)?.slice(0, 3).map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <Link
                  href="/contact"
                  className="inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-6 py-3 text-sm font-medium uppercase tracking-wide text-white transition-colors hover:bg-[var(--accent-hover)]"
                >
                  {ctaText}
                </Link>
                {secondaryCta ? (
                  <Link
                    href={secondaryCta.href}
                    className="inline-flex min-h-11 items-center justify-center border border-[var(--border)] px-6 py-3 text-sm font-medium uppercase tracking-wide text-[var(--text)] transition-colors hover:border-[var(--text)] hover:bg-[var(--text)] hover:text-[var(--bg)]"
                  >
                    {secondaryCta.label}
                  </Link>
                ) : null}
              </div>
            </aside>
          </div>

          {images && images.length > 0 ? <ImageCarousel images={images} /> : null}

          {decisionCards && decisionCards.length > 0 ? (
            <section className="space-y-6">
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
                Что важно понять заранее
              </h2>
              <div className="grid gap-4 md:grid-cols-3">
                {decisionCards.map((card) => (
                  <article key={card.title} className="border border-[var(--border)] bg-[var(--bg)] p-5">
                    <h3 className="font-sans text-lg font-medium tracking-[-0.01em]">{card.title}</h3>
                    <p className="mt-3 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{card.description}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <div className="grid gap-10 lg:grid-cols-2">
            {goodFit && goodFit.length > 0 ? (
              <section className="space-y-4">
                <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Кому подходит</h2>
                <ul className="list-disc space-y-2 pl-5 text-base leading-[1.8] text-[var(--text-muted)] md:text-lg">
                  {goodFit.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {notIdeal && notIdeal.length > 0 ? (
              <section className="space-y-4">
                <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Кому может не подойти</h2>
                <ul className="list-disc space-y-2 pl-5 text-base leading-[1.8] text-[var(--text-muted)] md:text-lg">
                  {notIdeal.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <div className="grid gap-10 lg:grid-cols-2">
            {rationalWhen && rationalWhen.length > 0 ? (
              <section className="space-y-4">
                <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Когда выбор рационален</h2>
                <ul className="list-disc space-y-2 pl-5 text-base leading-[1.8] text-[var(--text-muted)] md:text-lg">
                  {rationalWhen.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {tradeoffs && tradeoffs.length > 0 ? (
              <section className="space-y-4">
                <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Трезво о компромиссах</h2>
                <ul className="list-disc space-y-2 pl-5 text-base leading-[1.8] text-[var(--text-muted)] md:text-lg">
                  {tradeoffs.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
