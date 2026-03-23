import { RestaurantsFilter } from "@/components/sections/RestaurantsFilter";
import restaurantsData from "@/data/restaurants.json";
import type { Restaurant } from "@/components/sections/RestaurantCard";

const restaurants = restaurantsData as Restaurant[];

export default function RecommendationsRestaurantsPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="max-w-3xl">
          <p className="text-[var(--text-muted)]">
            Подборка из Pocket Concierge: sushi, kaiseki, yakitori, french и другие кухни Токио.
          </p>
        </div>

        <RestaurantsFilter restaurants={restaurants} />
      </div>
    </section>
  );
}
