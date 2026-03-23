"use client";

import { useMemo, useState } from "react";
import { Restaurant, RestaurantCard } from "@/components/sections/RestaurantCard";

type RestaurantsFilterProps = {
  restaurants: Restaurant[];
};

const PAGE_SIZE = 24;

export function RestaurantsFilter({ restaurants }: RestaurantsFilterProps) {
  const [query, setQuery] = useState("");
  const [selectedCuisine, setSelectedCuisine] = useState("all");
  const [selectedArea, setSelectedArea] = useState("all");
  const [page, setPage] = useState(1);

  const cuisines = useMemo(
    () =>
      Array.from(new Set(restaurants.map((restaurant) => restaurant.cuisine).filter(Boolean) as string[])).sort((a, b) =>
        a.localeCompare(b),
      ),
    [restaurants],
  );

  const areas = useMemo(
    () =>
      Array.from(new Set(restaurants.map((restaurant) => restaurant.area).filter(Boolean) as string[])).sort((a, b) =>
        a.localeCompare(b),
      ),
    [restaurants],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return restaurants.filter((restaurant) => {
      const matchesQuery =
        normalized.length === 0 ||
        restaurant.name.toLowerCase().includes(normalized) ||
        (restaurant.description || "").toLowerCase().includes(normalized);

      const matchesCuisine = selectedCuisine === "all" || restaurant.cuisine === selectedCuisine;
      const matchesArea = selectedArea === "all" || restaurant.area === selectedArea;

      return matchesQuery && matchesCuisine && matchesArea;
    });
  }, [restaurants, query, selectedCuisine, selectedArea]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const changePage = (nextPage: number) => {
    setPage(Math.max(1, Math.min(totalPages, nextPage)));
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  const onCuisineChange = (value: string) => {
    setSelectedCuisine(value);
    setPage(1);
  };

  const onAreaChange = (value: string) => {
    setSelectedArea(value);
    setPage(1);
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-2">
          <span className="text-xs font-medium tracking-[0.08em] text-[var(--text-muted)] uppercase">Поиск</span>
          <input
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Название или описание"
            className="h-11 w-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--text)]"
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium tracking-[0.08em] text-[var(--text-muted)] uppercase">Кухня</span>
          <select
            value={selectedCuisine}
            onChange={(event) => onCuisineChange(event.target.value)}
            className="h-11 w-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--text)]"
          >
            <option value="all">Все кухни</option>
            {cuisines.map((cuisine) => (
              <option key={cuisine} value={cuisine}>
                {cuisine}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium tracking-[0.08em] text-[var(--text-muted)] uppercase">Район</span>
          <select
            value={selectedArea}
            onChange={(event) => onAreaChange(event.target.value)}
            className="h-11 w-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--text)]"
          >
            <option value="all">Все районы</option>
            {areas.map((area) => (
              <option key={area} value={area}>
                {area}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-sm text-[var(--text-muted)]">Показано {filtered.length} из {restaurants.length} ресторанов</p>

      {paginated.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {paginated.map((restaurant) => (
            <RestaurantCard key={restaurant.pocket_concierge_url} restaurant={restaurant} />
          ))}
        </div>
      ) : (
        <div className="border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center text-[var(--text-muted)]">
          По заданным фильтрам ничего не найдено.
        </div>
      )}

      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => changePage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="inline-flex min-h-11 items-center border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] transition-colors hover:border-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Назад
        </button>

        <span className="px-2 text-sm text-[var(--text-muted)]">
          Страница {currentPage} из {totalPages}
        </span>

        <button
          type="button"
          onClick={() => changePage(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="inline-flex min-h-11 items-center border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] transition-colors hover:border-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Вперёд
        </button>
      </div>
    </div>
  );
}
