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

type InsightCard = {
  title?: string;
  description: string;
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

const genericInsightTitle = (index: number) => `Ориентир ${String(index + 1).padStart(2, "0")}`;

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
  const supportNotesSource = isCompact
    ? (practicalNotes ?? [])
    : (rationalWhen ?? practicalNotes ?? decisionSummary ?? tradeoffs ?? []);
  const supportNote = supportNotesSource[0];
  const supportNotes = supportNotesSource.slice(1, 3);
  const comparisonBullets = (alternativeGuidance?.bullets?.length ? alternativeGuidance.bullets : notIdeal ?? []).slice(0, 3);
  const insightCards: InsightCard[] = decisionCards?.length
    ? decisionCards.slice(0, 3)
    : (decisionSummary ?? tradeoffs ?? []).slice(0, 3).map((item, index) => ({
        title: genericInsightTitle(index),
        description: item,
      }));

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
        <div className="mx-auto w-full max-w-6xl space-y-14 md:space-y-20">
          {isCompact ? (
            <div className="max-w-3xl space-y-6 md:space-y-7">
              <div className="space-y-3 md:space-y-4">
                <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                  {subtitle}
                </p>
                <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] text-[var(--text)] md:text-4xl lg:text-[42px] lg:leading-[1.1]">
                  {title}
                </h1>
                <p className="max-w-[44rem] text-[15px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[16px]">
                  {intro}
                </p>
              </div>

              {quickVerdict ? (
                <section className="border border-[var(--border)] bg-[var(--bg)] px-6 py-6 md:px-8 md:py-7">
                  <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                    Короткий ответ
                  </p>
                  <p className="mt-3 text-[16px] font-normal leading-[1.8] text-[var(--text)] md:text-[18px]">
                    {quickVerdict}
                  </p>
                </section>
              ) : null}

              {supportNote ? (
                <div className="border-t border-[var(--border)] pt-5">
                  <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                    Практический ориентир
                  </p>
                  <p className="mt-3 text-[14px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[15px]">
                    {supportNote}
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-1">
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
            </div>
          ) : (
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1.18fr)_minmax(300px,0.82fr)] lg:gap-16 lg:items-start">
              <div className="max-w-3xl space-y-6 md:space-y-7">
                <div className="space-y-3 md:space-y-4">
                  <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                    {subtitle}
                  </p>
                  <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] text-[var(--text)] md:text-4xl lg:text-[42px] lg:leading-[1.1]">
                    {title}
                  </h1>
                  <p className="max-w-[44rem] text-[15px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[16px]">
                    {intro}
                  </p>
                </div>

                {quickVerdict ? (
                  <section className="border border-[var(--border)] bg-[var(--bg)] px-6 py-6 md:px-8 md:py-7">
                    <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                      Короткий ответ
                    </p>
                    <p className="mt-3 text-[16px] font-normal leading-[1.8] text-[var(--text)] md:text-[18px]">
                      {quickVerdict}
                    </p>
                  </section>
                ) : null}
              </div>

              <aside className="space-y-6 lg:pt-1">
                {supportNote ? (
                  <div className="border-l-2 border-[var(--border)] pl-5 md:pl-6">
                    <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                      Если выбирать трезво
                    </p>
                    <p className="mt-3 text-[14px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[15px]">
                      {supportNote}
                    </p>
                  </div>
                ) : null}

                {supportNotes.length > 0 ? (
                  <div className="space-y-3 border-t border-[var(--border)] pt-5">
                    {supportNotes.map((item) => (
                      <div key={item} className="flex items-start gap-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                        <p className="text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{item}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-3 pt-1">
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

          {(goodFit?.length || alternativeGuidance || comparisonBullets.length) ? (
            <section className="grid gap-6 lg:grid-cols-2 lg:gap-6">
              {goodFit?.length ? (
                <article className="border border-[var(--border)] bg-[var(--bg)] p-6 md:p-8">
                  <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text)] md:text-2xl">
                    Этот формат подходит, если
                  </h2>
                  <div className="mt-5 space-y-4">
                    {goodFit.map((item) => (
                      <div key={item} className="flex items-start gap-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                        <p className="text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{item}</p>
                      </div>
                    ))}
                  </div>
                </article>
              ) : null}

              {(alternativeGuidance || comparisonBullets.length) ? (
                <article className="border border-[var(--border)] bg-[var(--bg)] p-6 md:p-8">
                  <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text)] md:text-2xl">
                    {alternativeGuidance?.title ?? "Когда лучше выбрать альтернативу"}
                  </h2>
                  {alternativeGuidance?.description && comparisonBullets.length === 0 ? (
                    <p className="mt-3 text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                      {alternativeGuidance.description}
                    </p>
                  ) : null}
                  {comparisonBullets.length > 0 ? (
                    <div className="mt-4 space-y-4">
                      {comparisonBullets.map((item) => (
                        <div key={item} className="flex items-start gap-3">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                          <p className="text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{item}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ) : null}
            </section>
          ) : null}

          {insightCards.length > 0 ? (
            <section className="space-y-5 md:space-y-6">
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text)] md:text-2xl">
                Что важно понимать заранее
              </h2>
              <div className="grid gap-4 md:grid-cols-3">
                {insightCards.map((item, index) => (
                  <article key={`${item.title ?? genericInsightTitle(index)}-${item.description}`} className="border border-[var(--border)] bg-[var(--bg)] p-5 md:p-6">
                    <p className="font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                      {item.title ?? genericInsightTitle(index)}
                    </p>
                    <p className="mt-3 text-[14px] font-light leading-[1.8] text-[var(--text-muted)] md:text-[15px]">
                      {item.description}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {images && images.length > 0 ? <ImageCarousel images={images} /> : null}
        </div>
      </section>
    </>
  );
}
