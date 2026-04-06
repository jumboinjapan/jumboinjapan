import Link from "next/link";
import Image from "next/image";
import { PageHero } from "@/components/sections/PageHero";

type CityTourStop = {
  id: string;
  number: string;
  title: string;
  text: string;
  duration: string;
  photo: string;
  alt?: string;
};

type LogisticsOption = {
  title: string;
  text: string;
};

type CityTourDayPageProps = {
  hero: {
    image: string;
    alt?: string;
    eyebrow: string;
    title: string;
    subtitle: string;
    objectPosition?: string;
  };
  program: {
    title: string;
    description: string;
    duration: string;
  };
  stops: CityTourStop[];
  logistics?: {
    intro?: string;
    options: LogisticsOption[];
  };
};

type ItineraryStopProps = {
  stop: CityTourStop;
  reverse?: boolean;
};

function ItineraryStop({ stop, reverse = false }: ItineraryStopProps) {
  return (
    <article className="border-t border-[var(--border)] pt-12 first:pt-0 md:pt-20">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-center md:gap-12 lg:gap-16">
        <div className={reverse ? "md:order-2" : undefined}>
          <div className="relative aspect-[5/4] overflow-hidden bg-white">
            <Image
              src={stop.photo}
              alt={stop.alt ?? stop.title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          </div>
        </div>

        <div className={reverse ? "md:order-1" : undefined}>
          <p className="mb-3 text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)]">
            {stop.number}
          </p>
          <h3 className="max-w-md text-[24px] font-medium leading-tight tracking-[-0.02em] md:text-[28px]">
            {stop.title}
          </h3>
          <div className="mt-5 space-y-4 md:max-w-xl">
            {stop.text.split("\n\n").map((paragraph) => (
              <p
                key={`${stop.id}-${paragraph.slice(0, 24)}`}
                className="text-[15px] font-light leading-[1.85] text-[var(--text-muted)] md:text-base"
              >
                {paragraph}
              </p>
            ))}
          </div>
          <span className="mt-6 inline-flex text-[11px] tracking-[0.12em] uppercase text-[var(--accent)]">
            {stop.duration}
          </span>
        </div>
      </div>
    </article>
  );
}

export function CityTourDayPage({ hero, program, stops, logistics }: CityTourDayPageProps) {
  return (
    <>
      <PageHero
        image={hero.image}
        alt={hero.alt}
        eyebrow={hero.eyebrow}
        title={hero.title}
        subtitle={hero.subtitle}
        objectPosition={hero.objectPosition}
      />
      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20">
          <header className="space-y-3">
            <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">
              {program.duration}
            </p>
            <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">
              {program.title}
            </h1>
            <p className="text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">
              {program.description}
            </p>
          </header>

          <section className="space-y-10 md:space-y-14">
            <div className="flex items-center gap-5 py-4 md:py-6">
              <div className="h-px flex-1 bg-[var(--border)]" />
              <span className="text-[10px] tracking-[0.2em] uppercase whitespace-nowrap text-[var(--text-muted)]">
                Маршрут дня
              </span>
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>

            <div className="space-y-12 md:space-y-0">
              {stops.map((stop, index) => (
                <ItineraryStop key={stop.id} stop={stop} reverse={index % 2 === 1} />
              ))}
            </div>
          </section>

          {logistics && (
            <section className="border-t border-[var(--border)] pt-14 md:pt-20">
              <div className="space-y-4">
                <h2 className="font-sans text-2xl font-semibold tracking-tight md:text-3xl">
                  Логистика
                </h2>
                {logistics.intro && (
                  <p className="max-w-3xl text-sm leading-[1.8] text-[var(--text-muted)] md:text-[15px]">
                    {logistics.intro}
                  </p>
                )}
                <div className="grid gap-4 md:grid-cols-3">
                  {logistics.options.map((option) => (
                    <article
                      key={option.title}
                      className="rounded-sm border border-[var(--border)] bg-white p-5"
                    >
                      <h3 className="font-sans text-lg font-semibold tracking-tight">
                        {option.title}
                      </h3>
                      <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">
                        {option.text}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          )}

          <Link
            href="/contact"
            className="inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] uppercase transition-colors hover:text-[var(--accent)]"
          >
            Связаться с нами →
          </Link>
        </div>
      </section>
    </>
  );
}

export type { CityTourStop, LogisticsOption, CityTourDayPageProps };
