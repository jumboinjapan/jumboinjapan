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
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20">
        <div className="space-y-4">
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Ресурсы: рестораны</h1>
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
