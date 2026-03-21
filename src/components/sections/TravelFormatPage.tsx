import Link from "next/link";
import { ImageCarousel } from "@/components/sections/ImageCarousel";

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
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20">
        <ImageCarousel />

        <header className="space-y-4">
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{subtitle}</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">{title}</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{intro}</p>
        </header>

        <div className="grid gap-10 md:grid-cols-3 md:gap-12">
          <div className="space-y-8 md:col-span-2">

            <section className="space-y-4">
              <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Плюсы</h2>
              <ul className="list-disc space-y-2 pl-5 text-base leading-[1.8] text-[var(--text-muted)] md:text-lg">
                {pros.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="space-y-4">
              <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Сложности</h2>
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
