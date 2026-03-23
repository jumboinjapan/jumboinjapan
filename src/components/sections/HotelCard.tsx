import { Hotel } from "@/lib/hotels-data";

interface HotelCardProps {
  hotel: Hotel;
  tierLabel: string;
  regionLabel: string;
}

function RyokanIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 64 64"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Рёкан"
    >
      {/* Curved roof */}
      <path d="M32 4 C18 4 8 12 4 18 L60 18 C56 12 46 4 32 4Z" />
      {/* Roof underside / valance strip */}
      <rect x="4" y="18" width="56" height="5" rx="1" />
      {/* Hanging noren (curtain strips) */}
      <rect x="14" y="23" width="7" height="10" rx="1" />
      <rect x="24" y="23" width="7" height="10" rx="1" />
      <rect x="34" y="23" width="7" height="10" rx="1" />
      <rect x="44" y="23" width="7" height="10" rx="1" />
      {/* Building body */}
      <rect x="8" y="33" width="48" height="22" rx="1" />
      {/* Window / shoji panels */}
      <rect x="14" y="38" width="10" height="12" rx="1" fill="var(--bg, #fff)" opacity="0.25" />
      <rect x="28" y="38" width="10" height="12" rx="1" fill="var(--bg, #fff)" opacity="0.25" />
      {/* Lantern on right */}
      <ellipse cx="54" cy="42" rx="4" ry="6" />
      <rect x="52" y="36" width="4" height="2" rx="1" />
      <rect x="52" y="48" width="4" height="2" rx="1" />
    </svg>
  );
}

export function HotelCard({ hotel, tierLabel, regionLabel }: HotelCardProps) {
  return (
    <article className="border border-[var(--text-muted)] p-5 flex flex-col gap-3 hover:border-[var(--text)] transition-colors">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">{tierLabel}</span>
        <span className="text-xs font-medium tracking-[0.12em] text-[var(--text-muted)] uppercase">· {regionLabel}</span>
        {hotel.ryokan && (
          <span className="ml-auto text-[var(--text-muted)]" title="Рёкан">
            <RyokanIcon />
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
