import Link from "next/link";

export function HeroSection() {
  return (
    <section className="px-4 py-10 md:px-6 md:py-14 lg:py-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <div className="space-y-4 max-w-2xl">
          <h1 className="font-serif text-3xl leading-tight md:text-4xl lg:text-5xl">
            Япония с человеком, который здесь живёт
          </h1>
          <p className="text-base leading-relaxed text-[var(--text-muted)] md:text-lg">
            Личный проводник для тех, кто хочет понять, а не просто увидеть
          </p>
          <Link
            href="/contact"
            className="inline-flex min-h-11 items-center justify-center rounded-sm bg-[var(--accent)] px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-light)]"
          >
            Обсудить маршрут
          </Link>
        </div>

        <div className="w-full aspect-[16/9] bg-stone-300 lg:aspect-[21/9]" />
      </div>
    </section>
  );
}
