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
    <section className="px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-6 max-w-2xl space-y-3">
          <h2 className="font-serif text-3xl">Форматы сопровождения</h2>
          <p className="leading-relaxed text-[var(--text-muted)]">
            [Текст раздела будет добавлен]
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {experiences.map((item) => (
            <ExperienceCard key={item.slug} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
