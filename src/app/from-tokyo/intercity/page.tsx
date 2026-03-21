import Link from "next/link";

const transportOptions = [
  {
    title: "Общественный транспорт",
    description: "[Placeholder]",
    href: "/from-tokyo/intercity/public",
  },
  {
    title: "Заказной транспорт",
    description: "[Placeholder]",
    href: "/from-tokyo/intercity/private",
  },
];

export default function IntercityPage() {
  return (
    <section className="bg-[var(--bg-warm)] px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-8 md:space-y-10">
        <header className="space-y-3">
          <h1 className="font-sans font-bold text-5xl leading-[1.05] tracking-tight md:text-7xl">Тур между городами</h1>
          <p className="text-[var(--text-muted)]">Выберите формат транспорта для путешествия.</p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          {transportOptions.map((option) => (
            <article key={option.href} className="flex h-full flex-col rounded-sm border border-[var(--border)] bg-white p-6">
              <h2 className="font-sans font-semibold text-2xl tracking-tight">{option.title}</h2>
              <p className="mt-3 text-base leading-[1.7] text-[var(--text-muted)]">{option.description}</p>
              <Link
                href={option.href}
                className="mt-6 inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] uppercase transition-colors hover:text-[var(--accent)]"
              >
                Перейти →
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
