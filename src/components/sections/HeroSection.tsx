import Image from "next/image";
import Link from "next/link";

export function HeroSection() {
  return (
    <section className="-mt-20 bg-[var(--bg)] md:-mt-24 md:min-h-[600px] md:max-h-[780px]">
      <div className="grid md:min-h-[600px] md:max-h-[780px] md:h-[75vh] md:grid-cols-[55fr_45fr]">
        <div className="relative aspect-[4/3] overflow-hidden md:aspect-auto md:h-full">
          <Image
            src="/hero.jpg"
            alt="Японская чашка для чая с ветвью сакуры"
            fill
            className="object-cover"
            priority
          />
        </div>

        <div className="flex bg-[var(--bg)] px-4 py-10 md:px-10 lg:px-14">
          <div className="m-auto max-w-xl space-y-6 md:space-y-8">
            <h1 className="hero-animate font-sans font-semibold text-4xl tracking-tight leading-[1.1] md:text-5xl lg:text-6xl">
              Япония с любовью. Глазами местного жителя
            </h1>
            <p className="hero-animate-delay font-sans text-lg leading-[1.6] text-[var(--text-muted)] md:text-xl">
              Простое планирование долгожданных поездок.
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
