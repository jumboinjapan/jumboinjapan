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
  ctaText = "Подробнее",
}: RecommendationCardProps) {
  return (
    <article className="group flex h-full flex-col overflow-hidden">
      <div className="overflow-hidden">
        <div className="aspect-[3/2] w-full bg-stone-200 transition-transform duration-500 group-hover:scale-105" />
      </div>

      <div className="mt-5 flex h-full flex-col gap-3">
        <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">
          {categoryLabels[category]} · {city}
        </p>
        <h3 className="font-sans font-semibold text-xl tracking-tight md:text-2xl">{name}</h3>
        <p className="font-sans text-base leading-[1.7] italic text-[var(--text-muted)] md:text-lg">{quote}</p>

        <Link
          href={href}
          className="mt-auto inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline"
        >
          {ctaText} →
        </Link>
      </div>
    </article>
  );
}
