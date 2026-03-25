"use client";

import { useMemo, useState } from "react";
import type {
  ExperienceService,
  ExperienceSubcategory,
  PracticalService,
} from "@/data/services";

type ServicesFilterProps = {
  experienceServices: ExperienceService[];
  practicalServices: PracticalService[];
};

type ServiceTypeFilter = "all" | "experience" | "practical";

type CombinedService =
  | { type: "experience"; data: ExperienceService }
  | { type: "practical"; data: PracticalService };

const subcategoryLabels: Record<ExperienceSubcategory, string> = {
  cooking: "Кулинария",
  crafts: "Ремёсла",
  martial_arts: "Боевые искусства",
  theater: "Театр",
  traditional: "Традиции",
  entertainment: "Развлечения",
};

const serviceTypeTabs: { value: ServiceTypeFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "experience", label: "Мастерклассы" },
  { value: "practical", label: "Практические" },
];

function formatPrice(price: number | null): string {
  if (price === null) return "цена уточняется";
  return `от ¥${new Intl.NumberFormat("ru-RU").format(price).replaceAll("\u00A0", " ")}`;
}

function formatDuration(durationMin: number | null): string {
  if (durationMin === null) return "";
  if (durationMin % 60 === 0) return ` · ${durationMin / 60} ч`;
  return ` · ${durationMin} мин`;
}

function ExperienceServiceCard({ service }: { service: ExperienceService }) {
  const subcategoryText = service.subcategory.map((item) => subcategoryLabels[item]).join(" · ");

  return (
    <article className="flex h-full flex-col border border-[var(--border)] bg-[var(--surface)] p-5">
      <p className="text-xs font-medium tracking-[0.08em] text-[var(--accent)] uppercase">
        {subcategoryText} · {service.city}
      </p>
      <h3 className="mt-2 text-xl font-semibold text-[var(--text)]">{service.name}</h3>

      {service.partner !== "TBD" ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]">{service.partner}</p>
      ) : null}

      {service.description.trim().length > 0 ? (
        <p className="mt-3 text-sm italic text-[var(--text-muted)]">{service.description}</p>
      ) : null}

      <div className="mt-auto pt-5">
        <p className="text-sm text-[var(--text-muted)]">
          {formatPrice(service.price_from)}
          {formatDuration(service.duration_min)}
        </p>

        {service.booking_url ? (
          <a
            href={service.booking_url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent)] transition-opacity hover:opacity-80"
          >
            Забронировать →
          </a>
        ) : null}
      </div>
    </article>
  );
}

function PracticalServiceCard({ service }: { service: PracticalService }) {
  return (
    <article className="flex h-full flex-col border border-[var(--border)] bg-[var(--surface)] p-5">
      <p className="text-xs font-medium tracking-[0.08em] text-[var(--accent)] uppercase">{service.city}</p>
      <h3 className="mt-2 text-xl font-semibold text-[var(--text)]">{service.name}</h3>
      {service.description.trim().length > 0 ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">{service.description}</p>
      ) : null}
    </article>
  );
}

export function ServicesFilter({ experienceServices, practicalServices }: ServicesFilterProps) {
  const [selectedType, setSelectedType] = useState<ServiceTypeFilter>("all");
  const [selectedSubcategory, setSelectedSubcategory] = useState<"all" | ExperienceSubcategory>("all");
  const [selectedCity, setSelectedCity] = useState("all");

  const cities = useMemo(
    () =>
      Array.from(new Set([...experienceServices.map((service) => service.city), ...practicalServices.map((service) => service.city)])).sort(
        (a, b) => a.localeCompare(b),
      ),
    [experienceServices, practicalServices],
  );

  const filtered = useMemo(() => {
    const allServices: CombinedService[] = [
      ...experienceServices.map((data) => ({ type: "experience" as const, data })),
      ...practicalServices.map((data) => ({ type: "practical" as const, data })),
    ];

    return allServices.filter((item) => {
      const matchesType =
        selectedType === "all" ||
        (selectedType === "experience" && item.type === "experience") ||
        (selectedType === "practical" && item.type === "practical");

      if (!matchesType) return false;

      const city = item.data.city;
      const matchesCity = selectedCity === "all" || city === selectedCity;
      if (!matchesCity) return false;

      if (item.type !== "experience") return true;
      if (selectedType !== "experience" || selectedSubcategory === "all") return true;

      return item.data.subcategory.some((subcat) => subcat === selectedSubcategory);
    });
  }, [experienceServices, practicalServices, selectedCity, selectedSubcategory, selectedType]);

  const onTypeChange = (type: ServiceTypeFilter) => {
    setSelectedType(type);
    if (type !== "experience") {
      setSelectedSubcategory("all");
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <span className="text-xs font-medium tracking-[0.08em] text-[var(--text-muted)] uppercase">Тип</span>
        <div className="flex flex-wrap gap-2">
          {serviceTypeTabs.map((tab) => {
            const active = selectedType === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onTypeChange(tab.value)}
                className={`inline-flex min-h-11 items-center border px-4 py-2 text-sm transition-colors ${
                  active
                    ? "border-[var(--text)] bg-[var(--text)] text-[var(--surface)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--text)]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`grid gap-3 ${selectedType === "experience" ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
        {selectedType === "experience" ? (
          <label className="space-y-2">
            <span className="text-xs font-medium tracking-[0.08em] text-[var(--text-muted)] uppercase">Подкатегория</span>
            <select
              value={selectedSubcategory}
              onChange={(event) => setSelectedSubcategory(event.target.value as "all" | ExperienceSubcategory)}
              className="h-11 w-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--text)]"
            >
              <option value="all">Все</option>
              <option value="cooking">Кулинария</option>
              <option value="crafts">Ремёсла</option>
              <option value="martial_arts">Боевые искусства</option>
              <option value="theater">Театр</option>
              <option value="traditional">Традиции</option>
              <option value="entertainment">Развлечения</option>
            </select>
          </label>
        ) : null}

        <label className="space-y-2">
          <span className="text-xs font-medium tracking-[0.08em] text-[var(--text-muted)] uppercase">Город</span>
          <select
            value={selectedCity}
            onChange={(event) => setSelectedCity(event.target.value)}
            className="h-11 w-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--text)]"
          >
            <option value="all">Все города</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-sm text-[var(--text-muted)]">Показано {filtered.length} сервисов</p>

      {filtered.length > 0 ? (
        <div className="grid auto-rows-fr gap-5 md:grid-cols-2">
          {filtered.map((item) =>
            item.type === "experience" ? (
              <ExperienceServiceCard key={item.data.id} service={item.data} />
            ) : (
              <PracticalServiceCard key={item.data.id} service={item.data} />
            ),
          )}
        </div>
      ) : (
        <div className="border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center text-[var(--text-muted)]">
          По заданным фильтрам ничего не найдено.
        </div>
      )}
    </div>
  );
}
