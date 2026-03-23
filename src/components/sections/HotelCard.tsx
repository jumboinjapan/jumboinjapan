import { Hotel } from "@/lib/hotels-data";

interface HotelCardProps {
  hotel: Hotel;
  tierLabel: string;
  regionLabel: string;
}

function RyokanIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 208"
      width="22"
      height="22"
      fill="currentColor"
      aria-label="Рёкан"
    >
      <g fill="currentColor">
        <rect x="66" y="28" width="92" height="8" rx="4"/>
        <path d="M70 40h84c6 0 11 4 13 10l4 15c1 5-3 9-8 9-4 0-7-2-9-5-2 3-5 5-9 5-4 0-7-2-9-5-2 3-5 5-9 5-4 0-7-2-9-5-2 3-5 5-9 5-4 0-7-2-9-5-2 3-5 5-9 5-5 0-9-4-8-9l4-15c2-6 7-10 13-10z"/>
        <rect x="76" y="74" width="12" height="62"/>
        <rect x="148" y="74" width="12" height="62"/>
        <rect x="88" y="74" width="60" height="10"/>
        <rect x="92" y="88" width="52" height="6"/>
        <rect x="92" y="94" width="4" height="22"/>
        <rect x="140" y="94" width="4" height="22"/>
        <rect x="96" y="94" width="44" height="4"/>
        <path d="M97 99h42v20H97z"/>
        <rect x="110" y="99" width="2.5" height="20" fill="var(--bg)"/>
        <rect x="123" y="99" width="2.5" height="20" fill="var(--bg)"/>
        <rect x="98" y="119" width="40" height="11"/>
        <rect x="178" y="85" width="5" height="12"/>
        <path d="M183 89h11c3 0 6 3 6 6v16c0 3-3 6-6 6h-11c-3 0-6-3-6-6V95c0-3 3-6 6-6z"/>
      </g>
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
          <span className="ml-auto text-[var(--text-muted)]" title="Рёкан — традиционная японская гостиница">
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
