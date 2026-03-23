import { ResourcesSectionShell } from "@/components/resources/ResourcesSectionShell";
import { RestaurantsFilter } from "@/components/sections/RestaurantsFilter";
import type { Restaurant } from "@/components/sections/RestaurantCard";
import restaurantsData from "@/data/restaurants.json";

const restaurants = restaurantsData as Restaurant[];

export default function RecommendationsRestaurantsPage() {
  return (
    <ResourcesSectionShell
      title="Рестораны"
      description="Подборка из Pocket Concierge: sushi, kaiseki, yakitori, french и другие кухни Токио."
    >
      <RestaurantsFilter restaurants={restaurants} />
    </ResourcesSectionShell>
  );
}
