import { ExperienceCard } from "@/components/sections/ExperienceCard";
import { experiences } from "@/data/experiences";
import Link from "next/link";

const experience = experiences.find((item) => item.slug === "city-tour");

const programs = [
  {
    title: "Токио. Первый день",
    description:
      "Классический маршрут по главным точкам города — от Гинзы до Сибуи. То, что стоит увидеть в Токио первым делом, но без туристического конвейера.",
    duration: "6–8 часов",
    slug: "city-tour/day-one",
  },
  {
    title: "Токио. Второй день",
    description:
      "Другой Токио — районы, которые не попадают в стандартные маршруты. Янака, Симокитадзава, Коэнзи: город, в котором живут сами токийцы.",
    duration: "6–8 часов",
    slug: "city-tour/day-two",
  },
  {
    title: "Скрытые уголки Токио",
    description:
      "Маршрут собирается под вас — по интересам, темпу и настроению. Блошиные рынки, мастерские, храмы без туристов. Токио, который не найти на карте.",
    duration: "Гибкий формат",
    slug: "city-tour/hidden-spots",
  },
];

const transportOptions = [
  {
    title: "Общественный транспорт",
    description:
      "В маршруте, не считая дороги от отеля до места старта и обратного возвращения в конце дня, предусмотрен всего один переезд на общественном транспорте. Это удобная возможность заодно увидеть, как работает токийское метро.",
    href: "/from-tokyo/city-tour/public",
  },
  {
    title: "Такси",
    description:
      "В Токио хорошо развита служба такси, и пользоваться ей можно не только через приложение. Это удобный вариант для коротких переездов по городу. Если хочется большего комфорта, рекомендую Uber Black Van.",
    href: "/from-tokyo/city-tour/public",
  },
  {
    title: "Лимузин сервис",
    description:
      "Для групп, которым важен максимальный комфорт — индивидуальный транспорт с водителем на целый день. Минивэн заберёт вас в условленных точках маршрута и при необходимости доставит покупки в отель.",
    href: "/from-tokyo/city-tour/private",
  },
];

export default function CityTourPage() {
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
                  <div className="w-full bg-stone-200 transition-transform duration-500 group-hover:scale-105" style={{ aspectRatio: "1 / 1" }} />
                </div>
                <div className="mt-5 flex flex-1 flex-col gap-3">
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
