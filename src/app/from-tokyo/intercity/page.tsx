import { ExperienceCard } from "@/components/sections/ExperienceCard";
import { experiences } from "@/data/experiences";
import Link from "next/link";

const experience = experiences.find((item) => item.slug === "intercity");

const programs = [
  {
    title: "Камакура",
    description:
      "Великий Будда, храм Цуругаока Хатиман и узкие улицы Комати — всё это в 1 часе от Токио на электричке.",
    duration: "День",
    slug: "intercity/kamakura",
  },
  {
    title: "Никко",
    description: "Мавзолей Тосёгу, горные водопады и осенние клёны. Заповедник в 2 часах от Токио.",
    duration: "День",
    slug: "intercity/nikko",
  },
  {
    title: "Хаконэ",
    description: "Онсэн, вид на Фудзи, вулканическая долина. Классический маршрут с ночёвкой или за один день.",
    duration: "День или 2 дня",
    slug: "intercity/hakone",
  },
];

const transportOptions = [
  {
    title: "Общественный транспорт",
    description:
      "Синкансэн и региональные поезда — быстро, точно, с видом из окна. Japan Rail Pass делает длинные перегоны доступными по цене.",
    href: "/from-tokyo/intercity/public",
  },
  {
    title: "Заказной транспорт",
    description:
      "Минивэн с водителем — свобода маршрута, остановки где угодно и никакого багажного стресса. Особенно удобно для групп и семей.",
    href: "/from-tokyo/intercity/private",
  },
];

export default function IntercityPage() {
  if (!experience) return null;

  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="space-y-4">
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">{experience.title}</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{experience.intro}</p>
        </div>

        <section className="space-y-8">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Программы</h2>
          <div className="grid gap-10 md:grid-cols-3">
            {programs.map((program) => (
              <ExperienceCard
                key={program.slug}
                title={program.title}
                description={program.description}
                duration={program.duration}
                slug={program.slug}
              />
            ))}
          </div>
        </section>

        <section className="space-y-8">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Варианты логистики</h2>
          <div className="grid gap-10 md:grid-cols-3">
            {transportOptions.map((option) => (
              <article key={option.title} className="group flex h-full flex-col overflow-hidden">
                <div className="overflow-hidden">
                  <div className="aspect-[3/2] w-full bg-stone-200 transition-transform duration-500 group-hover:scale-105" />
                </div>
                <div className="mt-5 flex h-full flex-col gap-3">
                  <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25]">{option.title}</h3>
                  <p className="font-sans text-[14px] font-light leading-[1.82] text-[var(--text-muted)]">{option.description}</p>
                  <Link
                    href={option.href}
                    className="mt-auto inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline"
                  >
                    Подробнее →
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
