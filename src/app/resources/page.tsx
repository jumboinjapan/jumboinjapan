import Link from "next/link";
import { RecommendationCard } from "@/components/sections/RecommendationCard";

const featured = [
  {
    name: "Aman Tokyo",
    city: "Токио",
    category: "luxury" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "/resources/hotels",
    ctaText: "К отелям",
  },
  {
    name: "Jiro (Sukiyabashi)",
    city: "Токио",
    category: "restaurant" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "/resources/restaurants",
    ctaText: "К ресторанам",
  },
  {
    name: "World Nomads",
    city: "Онлайн",
    category: "service" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "/resources/services",
    ctaText: "К услугам",
  },
];

export default function RecommendationsPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="max-w-3xl space-y-4">
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">
            Ресурсы
          </h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            Подборка отелей, ресторанов и полезных сервисов, которые помогают сделать поездку спокойной и
            насыщенной.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            href="/resources/hotels"
            className="inline-flex min-h-11 items-center justify-center border border-[var(--text)] px-8 py-4 text-sm font-medium tracking-wide text-[var(--text)] uppercase transition-colors hover:bg-[var(--text)] hover:text-[var(--bg)]"
          >
            Отели
          </Link>
          <Link
            href="/resources/restaurants"
            className="inline-flex min-h-11 items-center justify-center border border-[var(--text)] px-8 py-4 text-sm font-medium tracking-wide text-[var(--text)] uppercase transition-colors hover:bg-[var(--text)] hover:text-[var(--bg)]"
          >
            Рестораны
          </Link>
          <Link
            href="/resources/services"
            className="inline-flex min-h-11 items-center justify-center border border-[var(--text)] px-8 py-4 text-sm font-medium tracking-wide text-[var(--text)] uppercase transition-colors hover:bg-[var(--text)] hover:text-[var(--bg)]"
          >
            Услуги
          </Link>
        </div>

        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
          {featured.map((item) => (
            <RecommendationCard key={item.name} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
