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
  michelin_stars?: number;
};

type RestaurantCardProps = {
  restaurant: Restaurant;
};

function MichelinStarIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 26 29" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M14.873 17.843c2.103 3.08 4.133 4.658 5.934 4.658 1.542 0 2.97-1.577 2.97-3.305 0-2.217-2.668-3.68-7.363-4.056v-.789c4.731-.376 7.363-1.804 7.363-4.057 0-1.728-1.392-3.306-2.97-3.306-1.801 0-3.831 1.578-5.934 4.695l-.713-.412c1.051-2.141 1.577-3.945 1.577-5.41 0-2.14-1.162-3.418-3.115-3.418-1.917 0-3.119 1.278-3.119 3.343 0 1.54.526 3.306 1.578 5.485l-.715.412C8.264 8.566 6.272 6.988 4.432 6.988c-1.54 0-2.968 1.578-2.968 3.306 0 2.253 2.593 3.68 7.363 4.057v.79c-4.696.374-7.363 1.838-7.363 4.055 0 1.728 1.428 3.305 2.968 3.305 1.84 0 3.832-1.577 5.934-4.658l.715.375c-1.052 2.18-1.578 3.982-1.578 5.523 0 2.065 1.202 3.342 3.119 3.342 1.953 0 3.115-1.277 3.115-3.381 0-1.502-.526-3.303-1.577-5.484l.713-.375zm2.256 4.695c.037.526.075.976.075 1.354 0 2.704-1.916 4.658-4.582 4.658-2.78 0-4.584-1.954-4.584-4.924 0-.374 0-.45.038-.599l.036-.489c-1.501 1.051-2.48 1.427-3.68 1.427C2.067 23.965 0 21.748 0 19.196c0-1.765 1.278-3.383 3.193-4.245l.412-.188C1.126 13.636 0 12.246 0 10.294c0-2.554 2.067-4.77 4.47-4.77 1.014 0 2.291.488 3.268 1.164l.374.263c-.036-.526-.074-.939-.074-1.315 0-2.703 1.916-4.657 4.584-4.657 2.777 0 4.582 1.914 4.582 4.92v.6l-.075.452c1.501-1.052 2.44-1.428 3.678-1.428 2.368 0 4.435 2.254 4.435 4.771 0 1.766-1.277 3.418-3.194 4.28l-.414.189c2.48 1.128 3.608 2.517 3.608 4.433 0 2.552-2.067 4.769-4.435 4.769-1.011 0-2.403-.412-3.302-1.125l-.376-.302z"
        fillOpacity="0.85"
        fill="#B90A2E"
        fillRule="nonzero"
      />
    </svg>
  );
}

function MichelinStars({ stars }: { stars?: number }) {
  if (!stars || stars < 1) {
    return null;
  }

  const count = Math.min(3, stars);

  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <MichelinStarIcon key={index} />
      ))}
    </div>
  );
}

export function RestaurantCard({ restaurant }: RestaurantCardProps) {
  return (
    <article className="flex h-full w-full flex-col border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="space-y-2">
        <h3 className="font-sans text-xl font-medium tracking-tight text-[var(--text)]">{restaurant.name}</h3>
        <MichelinStars stars={restaurant.michelin_stars} />
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
        <dl className="mt-auto space-y-1 border-t border-[var(--border)] pt-4 text-sm text-[var(--text-muted)]">
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

      <div className="flex flex-wrap gap-3 pt-6">
        <Link
          href={restaurant.pocket_concierge_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center border border-[var(--text)] px-4 py-2 text-xs font-medium tracking-wide text-[var(--text)] uppercase transition-colors hover:bg-[var(--text)] hover:text-[var(--bg)]"
        >
          Забронировать
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
