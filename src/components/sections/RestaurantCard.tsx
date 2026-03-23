import Link from "next/link";

export type Restaurant = {
  name: string;
  description: string | null;
  cuisine: string | null;
  area: string | null;
  city: string;
  lunch_price: string | null;
  dinner_price: string | null;
  pocket_concierge_url: string;
  google_maps_url: string | null;
};

type RestaurantCardProps = {
  restaurant: Restaurant;
};

export function RestaurantCard({ restaurant }: RestaurantCardProps) {
  return (
    <article className="flex h-full flex-col border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="space-y-2">
        <h3 className="font-sans text-xl font-medium tracking-tight text-[var(--text)]">{restaurant.name}</h3>
        <p className="text-xs font-medium tracking-[0.08em] text-[var(--accent)] uppercase">
          {(restaurant.cuisine || "Cuisine N/A").trim()} · {(restaurant.area || restaurant.city).trim()}
        </p>
      </div>

      {restaurant.description ? (
        <p className="mt-4 line-clamp-5 text-sm leading-[1.8] text-[var(--text-muted)]">{restaurant.description}</p>
      ) : (
        <p className="mt-4 text-sm leading-[1.8] text-[var(--text-muted)]">Описание отсутствует.</p>
      )}

      {(restaurant.lunch_price || restaurant.dinner_price) && (
        <dl className="mt-5 space-y-1 border-t border-[var(--border)] pt-4 text-sm text-[var(--text-muted)]">
          {restaurant.lunch_price && (
            <div className="flex items-center justify-between gap-3">
              <dt className="font-medium text-[var(--text)]">Lunch</dt>
              <dd>{restaurant.lunch_price}</dd>
            </div>
          )}
          {restaurant.dinner_price && (
            <div className="flex items-center justify-between gap-3">
              <dt className="font-medium text-[var(--text)]">Dinner</dt>
              <dd>{restaurant.dinner_price}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="mt-auto flex flex-wrap gap-3 pt-6">
        <Link
          href={restaurant.pocket_concierge_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center border border-[var(--text)] px-4 py-2 text-xs font-medium tracking-wide text-[var(--text)] uppercase transition-colors hover:bg-[var(--text)] hover:text-[var(--bg)]"
        >
          Pocket Concierge
        </Link>

        {restaurant.google_maps_url && (
          <Link
            href={restaurant.google_maps_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center border border-[var(--border)] px-4 py-2 text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
          >
            Google Maps
          </Link>
        )}
      </div>
    </article>
  );
}
