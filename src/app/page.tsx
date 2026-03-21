import Link from "next/link";
import { ExperiencesGrid } from "@/components/sections/ExperiencesGrid";
import { HeroSection } from "@/components/sections/HeroSection";
import { JournalPreview } from "@/components/sections/JournalPreview";
import { TestimonialsSection } from "@/components/sections/TestimonialsSection";
import { FadeIn } from "@/components/ui/FadeIn";
import { about } from "@/data/about";

export default function HomePage() {
  return (
    <>
      <HeroSection />

      <FadeIn delay={0}>
        <ExperiencesGrid />
      </FadeIn>

      <FadeIn delay={100}>
        <section className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-20 md:px-6 md:py-32">
          <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-start">
            <blockquote className="font-sans text-[26px] font-light italic leading-[1.52] text-[var(--text)] pl-6 border-l-2 border-[var(--border)]">
              {about.quote}
            </blockquote>

            <div className="space-y-5">
              <h2 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">О себе</h2>
              <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)] max-w-[52ch]">
                {about.bio}
              </p>
              <Link
                href="/jumbo"
                className="inline-flex min-h-11 items-center justify-center border border-[var(--text)] px-8 py-4 text-sm font-medium tracking-wide text-[var(--text)] uppercase transition-colors hover:bg-[var(--text)] hover:text-[var(--bg)]"
              >
                Читать подробнее
              </Link>
            </div>
          </div>
        </section>
      </FadeIn>

      <FadeIn delay={200}>
        <TestimonialsSection />
      </FadeIn>

      <FadeIn delay={300}>
        <JournalPreview />
      </FadeIn>

      <FadeIn delay={400}>
        <section className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-20 md:px-6 md:py-32">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <h2 className="font-sans font-medium text-[30px] tracking-[-0.02em] leading-[1.2] md:text-4xl">Помощь с планированием поездки в Японию</h2>
              <p className="font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)] max-w-[52ch]">
                Япония имеет образ загадочной и во многом не познанной страны. Со временем этого становится всё меньше и меньше, особенно в крупных городах. Попасть в места где Япония сохраняет свой быт, культуру и обычаи становится сложнее — для этого требуется подготовка и тщательное планирование. И тогда страна ответит вам взаимностью.
              </p>
            </div>
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-wide text-white uppercase transition-colors hover:bg-[var(--accent-hover)]"
            >
              Обсудить маршрут
            </Link>
          </div>
        </section>
      </FadeIn>
    </>
  );
}
