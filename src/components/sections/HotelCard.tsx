import { Hotel } from "@/lib/hotels-data";

interface HotelCardProps {
  hotel: Hotel;
  tierLabel: string;
  regionLabel: string;
}

export function HotelCard({ hotel, tierLabel, regionLabel }: HotelCardProps) {
  const q = encodeURIComponent(`${hotel.name} Tokyo`);
  const bookingLinks = [
    { label: "TripAdvisor", url: `https://www.tripadvisor.com/Search?q=${q}` },
    { label: "Agoda", url: `https://www.agoda.com/search?q=${q}` },
    { label: "Hotels.com", url: `https://www.hotels.com/search.do?q=${q}` },
  ];

  return (
    <article className="border border-[var(--text-muted)] p-5 flex flex-col gap-3 hover:border-[var(--text)] transition-colors">
      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">{tierLabel}</span>
        <span className="text-xs font-medium tracking-[0.12em] text-[var(--text-muted)] uppercase">· {regionLabel}</span>
      </div>

      <h3 className="font-sans font-semibold text-lg tracking-tight">{hotel.name}</h3>

      <div className="flex flex-wrap gap-2 mt-auto">
        {bookingLinks.map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium border border-[var(--text-muted)] text-[var(--text)] hover:border-[var(--text)] hover:bg-[var(--text)] hover:text-[var(--bg)] transition-colors"
          >
            {link.label}
          </a>
        ))}
      </div>
    </article>
  );
}
