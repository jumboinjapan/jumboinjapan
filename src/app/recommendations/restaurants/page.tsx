import { RecommendationCard } from "@/components/sections/RecommendationCard";

const restaurants = [
  {
    name: "Jiro (Sukiyabashi)",
    city: "Токио",
    category: "restaurant" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "#",
  },
  {
    name: "Kozue (Park Hyatt)",
    city: "Токио",
    category: "restaurant" as const,
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
  {
    name: "Tokyo Kosher Restaurant",
    city: "Токио",
    category: "kosher" as const,
    quote: "[Цитата Эдуарда будет добавлена]",
    href: "#",
  },
];

export default function RecommendationsRestaurantsPage() {
  return (
    <section className="px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div className="max-w-2xl space-y-3">
          <h1 className="font-serif text-4xl">Рекомендации: рестораны</h1>
          <p className="text-[var(--text-muted)]">От sushi и kaiseki до локальных точек и кошерных опций.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {restaurants.map((restaurant) => (
            <RecommendationCard key={restaurant.name} {...restaurant} />
          ))}
        </div>
      </div>
    </section>
  );
}
