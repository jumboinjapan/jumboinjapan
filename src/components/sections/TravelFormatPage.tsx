import Link from "next/link";
import { PageHero } from "@/components/sections/PageHero";
import { ImageCarousel } from "@/components/sections/ImageCarousel";

type DecisionCard = {
  title: string;
  description: string;
};

type AlternativeGuidance = {
  title: string;
  description: string;
  bullets?: string[];
};

interface TravelFormatPageProps {
  eyebrow?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  heroImage?: string;
  heroAlt?: string;
  heroObjectPosition?: string;
  layoutMode?: "default" | "compact";
  practicalNotes?: string[];
  title: string;
  subtitle: string;
  intro: string;
  quickVerdict?: string;
  decisionSummary?: string[];
  goodFit?: string[];
  notIdeal?: string[];
  rationalWhen?: string[];
  tradeoffs?: string[];
  decisionCards?: DecisionCard[];
  alternativeGuidance?: AlternativeGuidance;
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
  heroObjectPosition,
  layoutMode = "default",
  practicalNotes,
  title,
  subtitle,
  intro,
  quickVerdict,
  decisionSummary,
  goodFit,
  notIdeal,
  rationalWhen,
  tradeoffs,
  decisionCards,
  alternativeGuidance,
  ctaText = "Обсудить маршрут",
  secondaryCta,
  images,
}: TravelFormatPageProps) {
  const isCompact = layoutMode === "compact";
  const topNotes = (practicalNotes ?? rationalWhen ?? tradeoffs ?? []).slice(0, 3);

  return (
    <>
      {heroImage ? (
        <PageHero
          image={heroImage}
          alt={heroAlt ?? heroTitle ?? title}
          eyebrow={eyebrow}
          title={heroTitle ?? title}
          subtitle={heroSubtitle ?? subtitle}
          objectPosition={heroObjectPosition}
        />
      ) : null}

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20">
          {isCompact ? (
            <div className="max-w-3xl space-y-6">
              <div className="space-y-3">
                <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                  {subtitle}
                </p>
                <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">{title}</h1>
                <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{intro}</p>
              </div>

              {quickVerdict ? (
                <section className="border border-[var(--border)] bg-[var(--bg)] p-6 md:p-7">
                  <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                    Короткий ответ
                  </p>
                  <p className="mt-3 text-[16px] font-normal leading-[1.8] text-[var(--text)] md:text-[17px]">{quickVerdict}</p>
                </section>
              ) : null}

              {topNotes[0] ? <p className="text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{topNotes[0]}</p> : null}

              <div className="flex flex-wrap gap-3">
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

              {alternativeGuidance && secondaryCta ? (
                <p className="text-[13px] font-light leading-[1.8] text-[var(--text-muted)]">
                  Если нужен более мягкий день без лестниц и пересадок, <Link href={secondaryCta.href} className="underline underline-offset-2">private-формат</Link> подойдёт точнее.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)] lg:items-start">
              <div className="space-y-6">
                <div className="space-y-3">
                  <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                    {subtitle}
                  </p>
                  <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">{title}</h1>
                  <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{intro}</p>
                </div>

                {quickVerdict ? (
                  <section className="border border-[var(--border)] bg-[var(--bg)] p-6">
                    <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                      Короткий ответ
                    </p>
                    <p className="mt-3 text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{quickVerdict}</p>
                  </section>
                ) : null}

                {decisionSummary && decisionSummary.length > 0 ? (
                  <section className="space-y-4">
                    <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
                      На что опираться при выборе
                    </h2>
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
                  </section>
                ) : null}
              </div>

              <aside className="space-y-4 border border-[var(--border)] bg-[var(--bg)] p-6">
                {topNotes.length > 0 ? (
                  <div>
                    <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                      Если выбирать трезво
                    </p>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                      {topNotes.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {alternativeGuidance ? (
                  <div className={topNotes.length > 0 ? "border-t border-[var(--border)] pt-4" : ""}>
                    <h2 className="font-sans text-base font-medium tracking-[-0.01em]">{alternativeGuidance.title}</h2>
                    <p className="mt-2 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                      {alternativeGuidance.description}
                    </p>
                    {alternativeGuidance.bullets && alternativeGuidance.bullets.length > 0 ? (
                      <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                        {alternativeGuidance.bullets.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

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
          )}

          {isCompact ? (
            <section className="space-y-6">
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Когда public — лучший выбор</h2>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                {goodFit && goodFit.length > 0 ? (
                  <section className="border border-[var(--border)] bg-[var(--bg)] p-6 md:p-7">
                    <h3 className="font-sans text-lg font-medium tracking-[-0.01em]">Это ваш формат, если</h3>
                    <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                      {goodFit.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {notIdeal && notIdeal.length > 0 ? (
                  <section className="border-l-2 border-[var(--border)] py-2 pl-5">
                    <h3 className="font-sans text-base font-medium tracking-[-0.01em] text-[var(--text)]">Private лучше, если</h3>
                    <ul className="mt-4 list-disc space-y-2 pl-5 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                      {notIdeal.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            </section>
          ) : (
            <>
              {decisionCards && decisionCards.length > 0 ? (
                <section className="space-y-6">
                  <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
                    Как понять, что формат действительно ваш
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
                    <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Когда лучше выбрать альтернативу</h2>
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
                    <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Что вы принимаете как компромисс</h2>
                    <ul className="list-disc space-y-2 pl-5 text-base leading-[1.8] text-[var(--text-muted)] md:text-lg">
                      {tradeoffs.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            </>
          )}

          {images && images.length > 0 ? <ImageCarousel images={images} /> : null}
        </div>
      </section>
    </>
  );
}
