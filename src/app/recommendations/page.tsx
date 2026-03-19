import Link from "next/link";
import { RecommendationCard } from "@/components/sections/RecommendationCard";

const featured = [
  {
    name: "Aman Tokyo",
    city: "Токио",
    category: "luxury" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "/recommendations/hotels",
    ctaText: "К отелям",
  },
  {
    name: "Jiro (Sukiyabashi)",
    city: "Токио",
    category: "restaurant" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "/recommendations/restaurants",
    ctaText: "К ресторанам",
  },
  {
    name: "World Nomads",
    city: "Онлайн",
    category: "service" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "/recommendations/services",
    ctaText: "К услугам",
  },
];

export default function RecommendationsPage() {
  return (
    <section className="px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div className="max-w-3xl space-y-3">
          <h1 className="font-serif text-4xl">Рекомендации Эдуарда</h1>
          <p className="text-[var(--text-muted)]">
            Подборка отелей, ресторанов и полезных сервисов, которые помогают сделать поездку спокойной и насыщенной.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            href="/recommendations/hotels"
            className="inline-flex min-h-11 items-center justify-center rounded-sm border border-border px-4 text-sm font-medium text-[var(--text)] hover:bg-stone-100"
          >
            Отели
          </Link>
          <Link
            href="/recommendations/restaurants"
            className="inline-flex min-h-11 items-center justify-center rounded-sm border border-border px-4 text-sm font-medium text-[var(--text)] hover:bg-stone-100"
          >
            Рестораны
          </Link>
          <Link
            href="/recommendations/services"
            className="inline-flex min-h-11 items-center justify-center rounded-sm border border-border px-4 text-sm font-medium text-[var(--text)] hover:bg-stone-100"
          >
            Услуги
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {featured.map((item) => (
            <RecommendationCard key={item.name} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
