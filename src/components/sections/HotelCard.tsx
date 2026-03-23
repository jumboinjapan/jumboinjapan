import { Hotel } from "@/lib/hotels-data";

interface HotelCardProps {
  hotel: Hotel;
  tierLabel: string;
  regionLabel: string;
}

function RyokanBadge() {
  return (
    <span
      className="text-[10px] font-medium tracking-[0.06em] text-[var(--text-muted)] border border-[var(--text-muted)] px-1 py-0.5 leading-none"
      title="Рёкан — традиционная японская гостиница"
      aria-label="Рёкан"
    >
      旅館
    </span>
  );
}

export function HotelCard({ hotel, tierLabel, regionLabel }: HotelCardProps) {
  return (
    <article className="border border-[var(--text-muted)] p-5 flex flex-col gap-3 hover:border-[var(--text)] transition-colors">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">{tierLabel}</span>
        <span className="text-xs font-medium tracking-[0.12em] text-[var(--text-muted)] uppercase">· {regionLabel}</span>
        {hotel.ryokan && (
          <span className="ml-auto">
            <RyokanBadge />
          </span>
        )}
      </div>

      <h3 className="font-sans font-semibold text-lg tracking-tight">{hotel.name}</h3>

      {hotel.trip_url && (
        <div className="mt-auto">
          <a
            href={hotel.trip_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium border border-[var(--text-muted)] text-[var(--text)] hover:border-[var(--text)] hover:bg-[var(--text)] hover:text-[var(--bg)] transition-colors"
          >
            Trip.com
          </a>
        </div>
      )}
    </article>
  );
}
