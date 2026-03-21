import Link from "next/link";

export interface TourSection {
  heading: string;
  body: string;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface TourPageProps {
  title: string;
  metaDescription: string;
  h1: string;
  lead: string;
  sections: TourSection[];
  faq: FAQItem[];
  ctaText?: string;
}

export function TourPage({
  title,
  metaDescription,
  h1,
  lead,
  sections,
  faq,
  ctaText = "Обсудить маршрут",
}: TourPageProps) {
  return (
    <section className="px-4 py-10 md:px-6 md:py-14" data-page-title={title} data-meta-description={metaDescription}>
      <div className="mx-auto w-full max-w-4xl space-y-10">
        <header className="space-y-5">
          <h1 className="font-medium text-4xl tracking-[-0.025em] leading-[1.1] md:text-5xl">{h1}</h1>
          <p className="text-[17px] font-light italic leading-[1.78] text-[var(--text-muted)] md:text-lg pl-5 border-l border-[var(--border)] max-w-[56ch]">{lead}</p>
        </header>

        <div className="space-y-8">
          {sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="font-sans font-medium text-[11px] tracking-[0.2em] uppercase text-[#9a8070]">{section.heading}</h2>
              <div className="space-y-4 text-[16px] font-light leading-[1.9] text-[#3a2a1e] max-w-[60ch]">
                {section.body.split("\n\n").map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="space-y-4" aria-label="Частые вопросы">
          <h2 className="font-sans font-semibold text-3xl tracking-tight md:text-4xl">Частые вопросы</h2>
          <div className="space-y-4">
            {faq.map((item) => (
              <article key={item.question} className="rounded-sm border border-stone-200 p-5">
                <h3 className="font-sans font-semibold text-xl tracking-tight">{item.question}</h3>
                <p className="mt-2 text-base leading-[1.8] text-[var(--text-muted)] md:text-lg">{item.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <Link
          href="/contact"
          className="inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-wide text-white uppercase transition-colors hover:bg-[var(--accent-hover)]"
        >
          {ctaText}
        </Link>
      </div>
    </section>
  );
}
