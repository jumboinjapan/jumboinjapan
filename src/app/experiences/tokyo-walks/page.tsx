import Link from "next/link";
import { ExperienceCard } from "@/components/sections/ExperienceCard";
import { RecommendationCard } from "@/components/sections/RecommendationCard";

const recommendedItems = [
  {
    name: "Hoshinoya Tokyo",
    city: "Токио",
    category: "ryokan" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "#",
  },
  {
    name: "Nishiki Market area",
    city: "Киото",
    category: "restaurant" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "#",
  },
];

const tourCards = [
  {
    title: "Токио. Первый день",
    description: "Классический первый день: Гинза, Хамарикю, Цукидзи, Мэйдзи, Харадзюку и Сибуя.",
    duration: "Около 8 часов",
    slug: "tokyo-walks/day-one",
  },
  {
    title: "Токио. Второй день",
    description: "Исторический слой города: Маруноути, сад Эдо, Асакуса и вечерняя Одайба.",
    duration: "Около 8 часов",
    slug: "tokyo-walks/day-two",
  },
  {
    title: "Скрытые уголки Токио",
    description: "Нетуристические районы и атмосферные локации, которые собираем под ваш интерес.",
    duration: "Гибкий формат",
    slug: "tokyo-walks/hidden-spots",
  },
];

export default function TokyoWalksPage() {
  return (
    <section className="px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="space-y-6">
          <div className="max-w-2xl space-y-3">
            <h1 className="font-sans font-bold text-5xl tracking-tight leading-[1.05] md:text-7xl">Токио пешком</h1>
            <p className="text-sm text-[var(--text-muted)]">Длительность: 4–6 часов</p>
            <p className="text-[var(--text-muted)]">[Текст раздела будет добавлен]</p>
          </div>
          <div className="w-full aspect-[4/3] rounded-sm bg-stone-200" />
          <Link
            href="/contact"
            className="inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-wide text-white uppercase transition-colors hover:bg-[var(--accent-hover)]"
          >
            Обсудить маршрут
          </Link>
        </div>

        <section className="space-y-4">
          <h2 className="font-sans font-semibold text-3xl tracking-tight md:text-5xl">Программы</h2>
          <div className="grid gap-8 md:grid-cols-3">
            {tourCards.map((card) => (
              <ExperienceCard key={card.slug} {...card} />
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-sans font-semibold text-3xl tracking-tight md:text-5xl">Эдуард советует</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {recommendedItems.map((item) => (
              <RecommendationCard key={item.name} {...item} />
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
