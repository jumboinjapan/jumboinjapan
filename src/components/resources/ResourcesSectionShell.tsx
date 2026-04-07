import type { ReactNode } from "react";

type GuidanceItem = {
  title: string;
  description: string;
};

type ResourcesSectionShellProps = {
  title: string;
  description: string;
  guidanceTitle?: string;
  guidanceItems?: GuidanceItem[];
  planningNote?: ReactNode;
  children: ReactNode;
};

export function ResourcesSectionShell({
  title,
  description,
  guidanceTitle,
  guidanceItems,
  planningNote,
  children,
}: ResourcesSectionShellProps) {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-12 md:px-6 md:py-16">
      <div className="mx-auto w-full max-w-6xl space-y-8 md:space-y-10">
        <header className="max-w-3xl space-y-3">
          <h1 className="font-sans text-2xl font-medium tracking-tight md:text-3xl">{title}</h1>
          <p className="text-[15px] leading-[1.8] text-[var(--text-muted)]">{description}</p>
        </header>

        {guidanceItems && guidanceItems.length > 0 ? (
          <section className="space-y-4">
            {guidanceTitle ? (
              <h2 className="font-sans text-lg font-medium tracking-[-0.01em] text-[var(--text-muted)]">{guidanceTitle}</h2>
            ) : null}
            <div className="grid gap-4 md:grid-cols-3">
              {guidanceItems.map((item) => (
                <article key={item.title} className="border border-[var(--border)] bg-[var(--bg)] p-5">
                  <h3 className="font-sans text-base font-medium tracking-[-0.01em]">{item.title}</h3>
                  <p className="mt-3 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">{item.description}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {planningNote ? (
          <div className="max-w-4xl border border-[var(--border)] bg-[var(--bg)] px-5 py-4 text-[14px] font-light leading-[1.85] text-[var(--text-muted)] md:px-6">
            {planningNote}
          </div>
        ) : null}

        {children}
      </div>
    </section>
  );
}
