import type { ReactNode } from "react";

type ResourcesSectionShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function ResourcesSectionShell({ title, description, children }: ResourcesSectionShellProps) {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-12 md:px-6 md:py-16">
      <div className="mx-auto w-full max-w-6xl space-y-8 md:space-y-10">
        <header className="max-w-3xl space-y-3">
          <h1 className="font-sans text-2xl font-medium tracking-tight md:text-3xl">{title}</h1>
          <p className="text-[15px] leading-[1.8] text-[var(--text-muted)]">{description}</p>
        </header>

        {children}
      </div>
    </section>
  );
}
