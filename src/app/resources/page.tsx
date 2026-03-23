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
        <div className="max-w-3xl">
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            Подборка отелей, ресторанов и полезных сервисов, которые помогают сделать поездку спокойной и
            насыщенной.
          </p>
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
