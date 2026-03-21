import Link from "next/link";

export function HeroSection() {
  return (
    <section className="-mt-20 bg-[var(--bg)] md:-mt-24 md:min-h-[600px] md:max-h-[780px]">
      <div className="grid md:min-h-[600px] md:max-h-[780px] md:h-[75vh] md:grid-cols-[55fr_45fr]">
        <div className="aspect-[4/3] bg-stone-300 md:aspect-auto md:h-full" />

        <div className="flex bg-[var(--bg)] px-4 py-10 md:px-10 lg:px-14">
          <div className="m-auto max-w-xl space-y-6 md:space-y-8">
            <h1 className="hero-animate font-sans font-bold text-5xl tracking-tight leading-[1.05] md:text-7xl">
              Япония с человеком, который здесь живёт
            </h1>
            <p className="hero-animate-delay font-sans text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">
              Личный проводник для тех, кто хочет понять, а не просто увидеть.
            </p>
            <Link
              href="/contact"
              className="hero-animate-delay-2 inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-wide text-white uppercase transition-colors hover:bg-[var(--accent-hover)]"
            >
              Обсудить маршрут
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
