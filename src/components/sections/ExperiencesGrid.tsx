import { ExperienceCard, type ExperienceCardProps } from "./ExperienceCard";

const experiences: ExperienceCardProps[] = [
  {
    title: "Обзорный городской тур",
    description: "[Placeholder]",
    duration: "4–8 часов",
    slug: "city-tour",
  },
  {
    title: "Между городами",
    description: "[Placeholder]",
    duration: "День и больше",
    slug: "intercity",
  },
  {
    title: "Многодневные туры",
    description: "[Placeholder]",
    duration: "2–14 дней",
    slug: "multi-day",
  },
];

export function ExperiencesGrid() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-10 max-w-2xl space-y-4">
          <h2 className="font-sans font-semibold text-3xl tracking-tight md:text-5xl">Форматы путешествия</h2>
          <p className="font-sans text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">
            [Текст раздела будет добавлен]
          </p>
        </div>
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
          {experiences.map((item) => (
            <ExperienceCard key={item.slug} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
