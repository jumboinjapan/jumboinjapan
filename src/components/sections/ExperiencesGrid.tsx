import { experiences } from "@/data/experiences";
import { ExperienceCard } from "./ExperienceCard";

export function ExperiencesGrid() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-10 max-w-2xl space-y-4">
          <h2 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Форматы путешествия</h2>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            Япония открывается по-разному: через скоростные поезда, автотуры, прогулки по городам, горные маршруты и более размеренные поездки с комфортной логистикой. У каждого путешественника свои интересы, свои привычки, свои возможности и свой бюджет. Именно поэтому при планировании тура в Японию так важно найти формат путешествия, который будет удобен и по-настоящему подходить именно вам.
          </p>
        </div>
        <h2 className="mb-8 font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Опции</h2>
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
          {experiences.map((item) => (
            <ExperienceCard key={item.slug} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
