import Link from "next/link";

import { ExperienceCard } from "@/components/sections/ExperienceCard";

const programs = [
  {
    title: "Токио. Первый день",
    description: "У меня есть личный рецепт идеального знакомства с Токио. Этот город удивляет своей контрастностью и во многом становится окном в самые разные грани Японии. Именно поэтому Токио — лучшее место для первого глубокого знакомства со страной. Здесь можно увидеть всё сразу: древние храмы и японские сады, самобытные районы, где рождаются новые субкультуры, кварталы, бережно хранящие старые традиции, впечатляющие смотровые площадки и культовые заведения, без которых невозможно почувствовать настоящий ритм города. Такое разнообразие делает знакомство с Токио по-настоящему ярким, цельным и запоминающимся.",
    duration: "6–8 часов",
    slug: "city-tour/day-one",
  },
  {
    title: "Токио. Второй день",
    description: "Другой Токио — районы, которые не попадают в стандартные маршруты. Янака, Симокитадзава, Коэнзи: город, в котором живут сами токийцы.",
    duration: "6–8 часов",
    slug: "city-tour/day-two",
  },
  {
    title: "Скрытые уголки Токио",
    description: "Маршрут собирается под вас — по интересам, темпу и настроению. Блошиные рынки, мастерские, храмы без туристов. Токио, который не найти на карте.",
    duration: "Гибкий формат",
    slug: "city-tour/hidden-spots",
  },
];

const transportOptions = [
  {
    title: "Общественный транспорт",
    description: "Метро, автобусы и электрички — так перемещается весь Токио. Быстро, дёшево и это само по себе часть опыта: навигация по токийскому метро стоит отдельного рассказа.",
    href: "/from-tokyo/city-tour/public",
  },
  {
    title: "Заказной транспорт",
    description: "Минивэн с водителем — для тех, кто ценит комфорт или путешествует с детьми. Никаких пересадок: от точки до точки без лишних усилий.",
    href: "/from-tokyo/city-tour/private",
  },
];

export default function CityTourPage() {
  return (
    <section className="bg-[var(--bg-warm)] px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-10 md:space-y-12">
        <header className="space-y-3">
          <h1 className="font-sans font-bold text-5xl leading-[1.05] tracking-tight md:text-7xl">Обзорный тур по Токио</h1>
          <p className="max-w-3xl text-[var(--text-muted)]">{"Пешком, на метро, иногда на трамвае — по тому Токио, который не влезает в путеводитель. Маршрут подстраивается под ваш темп: можно за четыре часа, можно растянуть на весь день. Рассказываю то, что знаю сам — без заученных текстов."}</p>
        </header>

        <section className="space-y-6">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Программы</h2>
          <div className="grid gap-6 md:grid-cols-3">
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

        <section className="space-y-6">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Варианты логистики</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {transportOptions.map((option) => (
              <article key={option.href} className="group flex h-full flex-col overflow-hidden">
                <div className="overflow-hidden">
                  <div className="aspect-[3/2] w-full bg-stone-200 transition-transform duration-500 group-hover:scale-105" />
                </div>
                <div className="mt-5 flex h-full flex-col gap-3">
                  <h3 className="font-sans font-semibold text-xl tracking-tight md:text-2xl">{option.title}</h3>
                  <p className="font-sans text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">{option.description}</p>
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
