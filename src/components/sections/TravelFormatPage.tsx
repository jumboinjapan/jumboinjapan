import Link from "next/link";

interface TravelFormatPageProps {
  title: string;
  subtitle: string;
  intro: string;
  pros: string[];
  cons: string[];
  ctaText?: string;
}

export function TravelFormatPage({
  title,
  subtitle,
  intro,
  pros,
  cons,
  ctaText = "Обсудить маршрут",
}: TravelFormatPageProps) {
  return (
    <section className="px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-8 md:space-y-10">
        <div className="aspect-[21/9] w-full rounded-sm bg-stone-200" />

        <header className="space-y-4">
          <span className="inline-flex rounded-full bg-[var(--bg-warm)] px-4 py-1 text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">
            {subtitle}
          </span>
          <h1 className="font-sans font-bold text-5xl leading-[1.05] tracking-tight md:text-7xl">{title}</h1>
        </header>

        <div className="grid gap-10 md:grid-cols-3 md:gap-12">
          <div className="space-y-8 md:col-span-2">
            <p className="text-base leading-[1.8] text-[var(--text-muted)] md:text-lg">{intro}</p>

            <section className="space-y-4">
              <h2 className="font-sans font-semibold text-3xl tracking-tight md:text-4xl">Плюсы</h2>
              <ul className="list-disc space-y-2 pl-5 text-base leading-[1.8] text-[var(--text-muted)] md:text-lg">
                {pros.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="space-y-4">
              <h2 className="font-sans font-semibold text-3xl tracking-tight md:text-4xl">Сложности</h2>
              <ul className="list-disc space-y-2 pl-5 text-base leading-[1.8] text-[var(--text-muted)] md:text-lg">
                {cons.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-wide text-white uppercase transition-colors hover:bg-[var(--accent-hover)]"
            >
              {ctaText}
            </Link>
          </div>

          <aside className="space-y-4 md:sticky md:top-8 md:self-start">
            <div className="rounded-sm border border-[var(--border)] p-5 space-y-2">
              <p className="text-xs font-medium tracking-[0.12em] uppercase text-[var(--accent)]">Полезные статьи</p>
              <p className="text-sm text-[var(--text-muted)]">[Будет добавлено]</p>
            </div>
            <div className="rounded-sm border border-[var(--border)] p-5 space-y-2">
              <p className="text-xs font-medium tracking-[0.12em] uppercase text-[var(--accent)]">Билеты и бронирование</p>
              <p className="text-sm text-[var(--text-muted)]">[Будет добавлено]</p>
            </div>
            <div className="rounded-sm border border-[var(--border)] p-5 space-y-2">
              <p className="text-xs font-medium tracking-[0.12em] uppercase text-[var(--accent)]">События и фестивали</p>
              <p className="text-sm text-[var(--text-muted)]">[Будет добавлено]</p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
