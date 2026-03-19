import Link from "next/link";
import { ExperiencesGrid } from "@/components/sections/ExperiencesGrid";
import { HeroSection } from "@/components/sections/HeroSection";
import { JournalPreview } from "@/components/sections/JournalPreview";
import { TestimonialsSection } from "@/components/sections/TestimonialsSection";

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <ExperiencesGrid />

      <section className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          <blockquote className="font-serif text-2xl italic leading-relaxed text-[var(--text)]">
            «Я показываю Японию не как туристическую открытку, а как живую страну — с её ритмом,
            деталями и людьми».
          </blockquote>

          <div className="space-y-5">
            <h2 className="font-serif text-3xl font-semibold md:text-5xl">Кто я</h2>
            <p className="font-sans text-base leading-[1.85] text-[var(--text-muted)] md:text-lg">
              [Текст раздела будет добавлен]
            </p>
            <Link
              href="/about"
              className="inline-flex min-h-11 items-center justify-center border border-[var(--text)] px-8 py-4 text-sm font-medium tracking-widest text-[var(--text)] uppercase transition-colors hover:bg-[var(--text)] hover:text-[var(--bg)]"
            >
              Читать подробнее
            </Link>
          </div>
        </div>
      </section>

      <TestimonialsSection />
      <JournalPreview />

      <section className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl space-y-3">
            <h2 className="font-serif text-3xl font-semibold md:text-5xl">Соберём ваш маршрут по Японии</h2>
            <p className="font-sans text-base leading-[1.85] text-[var(--text-muted)] md:text-lg">
              [Текст раздела будет добавлен]
            </p>
          </div>
          <Link
            href="/contact"
            className="inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-widest text-white uppercase transition-colors hover:bg-[var(--accent-hover)]"
          >
            Обсудить маршрут
          </Link>
        </div>
      </section>
    </>
  );
}
