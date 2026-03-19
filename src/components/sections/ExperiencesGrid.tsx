import { ExperienceCard, type ExperienceCardProps } from "./ExperienceCard";

const experiences: ExperienceCardProps[] = [
  {
    title: "Токио пешком",
    description: "[Текст раздела будет добавлен]",
    duration: "4–6 часов",
    slug: "tokyo-walks",
  },
  {
    title: "Токио на авто",
    description: "[Текст раздела будет добавлен]",
    duration: "6–8 часов",
    slug: "tokyo-drives",
  },
  {
    title: "Многодневные маршруты",
    description: "[Текст раздела будет добавлен]",
    duration: "2–10 дней",
    slug: "multi-day",
  },
  {
    title: "Полное сопровождение",
    description: "[Текст раздела будет добавлен]",
    duration: "Под поездку",
    slug: "vip",
  },
  {
    title: "Подбор гида",
    description: "[Текст раздела будет добавлен]",
    duration: "1 консультация",
    slug: "find-guide",
  },
];

export function ExperiencesGrid() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-10 max-w-2xl space-y-4">
          <h2 className="font-serif text-3xl font-semibold md:text-5xl">Форматы сопровождения</h2>
          <p className="font-sans text-base leading-[1.85] text-[var(--text-muted)] md:text-lg">
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
