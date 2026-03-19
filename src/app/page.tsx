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
      <TestimonialsSection />
      <JournalPreview />

      <section className="px-4 py-10 md:px-6 md:py-14">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 rounded-sm border border-border bg-[var(--surface)] p-6 md:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl space-y-2">
            <h2 className="font-serif text-3xl">Соберём ваш маршрут по Японии</h2>
            <p className="text-[var(--text-muted)]">[Текст раздела будет добавлен]</p>
          </div>
          <Link
            href="/contact"
            className="inline-flex min-h-11 items-center justify-center rounded-sm bg-[var(--accent)] px-6 py-2 font-medium text-white"
          >
            Обсудить маршрут
          </Link>
        </div>
      </section>
    </>
  );
}
