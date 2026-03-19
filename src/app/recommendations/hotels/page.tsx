'use client';

import { useMemo, useState } from "react";

import { HotelCard } from "@/components/sections/HotelCard";
import { hotels } from "@/lib/hotels-data";

const filterOptions = [
  { value: "all", label: "Все" },
  { value: "luxury-center", label: "5 звёзд — Центр" },
  { value: "luxury-other", label: "5 звёзд — Другие районы" },
  { value: "premium", label: "Премиум" },
  { value: "economy-premium", label: "Эконом Премиум" },
] as const;

const tierLabels: Record<string, string> = {
  "luxury-center": "5 звёзд — центр",
  "luxury-other": "5 звёзд — другие районы",
  premium: "премиум",
  "economy-premium": "эконом премиум",
};

export default function RecommendationsHotelsPage() {
  const [activeFilter, setActiveFilter] = useState<(typeof filterOptions)[number]["value"]>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredHotels = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return hotels.filter((hotel) => {
      const matchesFilter = activeFilter === "all" || hotel.tier === activeFilter;
      const matchesSearch = hotel.name.toLowerCase().includes(normalizedQuery);

      return matchesFilter && matchesSearch;
    });
  }, [activeFilter, searchQuery]);

  return (
    <section className="px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div className="max-w-2xl space-y-3">
          <h1 className="font-sans text-5xl leading-[1.05] font-bold tracking-tight md:text-7xl">Рекомендации: отели</h1>
          <p className="text-[var(--text-muted)]">Полный список отелей с фильтрацией по категории и быстрым поиском.</p>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Поиск по названию отеля"
            className="w-full border border-[var(--text-muted)] bg-transparent px-4 py-3 text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--text)] focus:outline-none"
          />

          <div className="overflow-x-auto">
            <div className="flex min-w-max gap-2 pb-1">
              {filterOptions.map((option) => {
                const isActive = option.value === activeFilter;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setActiveFilter(option.value)}
                    className={`shrink-0 px-4 py-2 text-sm transition-colors ${
                      isActive
                        ? "bg-[var(--text)] text-[var(--bg)]"
                        : "border border-[var(--text)] text-[var(--text)] hover:bg-[var(--text)] hover:text-[var(--bg)]"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-sm text-[var(--text-muted)]">Показано: {filteredHotels.length} из {hotels.length} отелей</p>
        </div>

        {filteredHotels.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {filteredHotels.map((hotel) => (
              <HotelCard key={hotel.name} hotel={hotel} tierLabel={tierLabels[hotel.tier] ?? hotel.tier} />
            ))}
          </div>
        ) : (
          <div className="border border-[var(--text-muted)] p-6 text-[var(--text-muted)]">
            По вашему запросу отели не найдены. Попробуйте изменить фильтр или текст поиска.
          </div>
        )}
      </div>
    </section>
  );
}
