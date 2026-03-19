import Link from "next/link";

export type RecommendationCategory =
  | "boutique"
  | "ryokan"
  | "luxury"
  | "restaurant"
  | "kosher"
  | "service";

export interface RecommendationCardProps {
  name: string;
  city: string;
  category: RecommendationCategory;
  quote: string;
  href: string;
  ctaText?: string;
}

const categoryLabels: Record<RecommendationCategory, string> = {
  boutique: "Boutique",
  ryokan: "Ryokan",
  luxury: "Luxury",
  restaurant: "Restaurant",
  kosher: "Kosher",
  service: "Service",
};

export function RecommendationCard({
  name,
  city,
  category,
  quote,
  href,
  ctaText = "Посмотреть",
}: RecommendationCardProps) {
  return (
    <article className="flex h-full flex-col rounded-sm border border-border bg-[var(--surface)] p-5">
      <div className="aspect-[4/3] w-full rounded-sm bg-stone-200" />

      <div className="mt-4 flex h-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-serif text-2xl">{name}</h3>
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs text-[var(--text-muted)]">{city}</span>
          <span className="rounded-full border border-border px-3 py-1 text-xs text-[var(--text-muted)]">
            {categoryLabels[category]}
          </span>
        </div>

        <p className="text-sm italic leading-relaxed text-[var(--text-muted)]">{quote}</p>

        <Link
          href={href}
          className="mt-auto inline-flex min-h-11 items-center justify-center rounded-sm bg-[var(--accent)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-light)]"
        >
          {ctaText}
        </Link>
      </div>
    </article>
  );
}
