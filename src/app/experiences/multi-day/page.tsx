import Link from "next/link";
import { RecommendationCard } from "@/components/sections/RecommendationCard";

const recommendedItems = [
  {
    name: "Tawaraya",
    city: "Киото",
    category: "ryokan" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "#",
  },
  {
    name: "Beniya Mukayu",
    city: "Канадзава",
    category: "boutique" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "#",
  },
  {
    name: "World Nomads",
    city: "Онлайн",
    category: "service" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "#",
  },
];

export default function MultiDayPage() {
  return (
    <section className="px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="space-y-6">
          <div className="max-w-2xl space-y-3">
            <h1 className="font-serif text-4xl">Многодневные маршруты</h1>
            <p className="text-sm text-[var(--text-muted)]">Длительность: 2–10 дней</p>
            <p className="text-[var(--text-muted)]">[Текст раздела будет добавлен]</p>
          </div>
          <div className="aspect-[4/3] w-full rounded-sm bg-stone-200" />
          <Link
            href="/contact"
            className="inline-flex min-h-11 items-center rounded-sm bg-[var(--accent)] px-6 text-white"
          >
            Обсудить маршрут
          </Link>
        </div>

        <section className="space-y-4">
          <h2 className="font-serif text-3xl">Эдуард советует</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {recommendedItems.map((item) => (
              <RecommendationCard key={item.name} {...item} />
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
