import { Hotel } from "@/lib/hotels-data";

interface HotelCardProps {
  hotel: Hotel;
  tierLabel: string;
  regionLabel: string;
}

function RyokanIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 64 64"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Рёкан"
    >
      {/* Top flat bar */}
      <rect x="6" y="8" width="46" height="7" rx="3" />
      {/* Awning with scalloped bottom (6 arcs, sweep=1 = curves downward going left) */}
      <path d="M6,15 L52,15 L52,27 A3.83,3.83 0 0,1 44.33,27 A3.83,3.83 0 0,1 36.67,27 A3.83,3.83 0 0,1 29,27 A3.83,3.83 0 0,1 21.33,27 A3.83,3.83 0 0,1 13.67,27 A3.83,3.83 0 0,1 6,27 Z" />
      {/* Left pillar */}
      <rect x="7" y="27" width="5" height="27" rx="1" />
      {/* Right pillar */}
      <rect x="46" y="27" width="5" height="27" rx="1" />
      {/* Base counter */}
      <rect x="7" y="50" width="44" height="5" rx="1" />
      {/* Noren left panel */}
      <rect x="15" y="27" width="12" height="20" rx="1" />
      {/* Noren right panel */}
      <rect x="30" y="27" width="12" height="20" rx="1" />
      {/* Lantern top cap */}
      <rect x="54" y="25" width="9" height="4" rx="2" />
      {/* Lantern body (oval) */}
      <ellipse cx="58.5" cy="37" rx="5" ry="8" />
      {/* Lantern bottom cap */}
      <rect x="54" y="44" width="9" height="4" rx="2" />
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
