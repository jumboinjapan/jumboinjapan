import { Hotel } from "@/lib/hotels-data";

type HotelCardProps = {
  hotel: Hotel;
  tierLabel: string;
};

export function HotelCard({ hotel, tierLabel }: HotelCardProps) {
  return (
    <article className="flex flex-col gap-2 border border-[var(--text-muted)] p-5 transition-colors hover:border-[var(--text)]">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">{tierLabel}</p>
      <h2 className="text-lg font-medium text-[var(--text)]">{hotel.name}</h2>
    </article>
  );
}
