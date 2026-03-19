import { RecommendationCard } from "@/components/sections/RecommendationCard";

const hotels = [
  {
    name: "Aman Tokyo",
    city: "Токио",
    category: "luxury" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "#",
  },
  {
    name: "Hoshinoya Tokyo",
    city: "Токио",
    category: "ryokan" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "#",
  },
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
];

export default function RecommendationsHotelsPage() {
  return (
    <section className="px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div className="max-w-2xl space-y-3">
          <h1 className="font-serif text-4xl">Рекомендации: отели</h1>
          <p className="text-[var(--text-muted)]">Проверенные варианты проживания для разных форматов поездки.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {hotels.map((hotel) => (
            <RecommendationCard key={hotel.name} {...hotel} />
          ))}
        </div>
      </div>
    </section>
  );
}
