import type { Poi } from '@/types/poi'

interface PoiCardProps {
  poi: Poi
}

export function PoiCard({ poi }: PoiCardProps) {
  if (!poi.name_ru) return null

  return (
    <div className="border-t border-[var(--border)] pt-6 space-y-2">
      <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25]">
        {poi.name_ru}
      </h3>

      {poi.description_ru && (
        <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
          {poi.description_ru}
        </p>
      )}

      {poi.hours_ru && (
        <p className="text-[13px] text-[var(--text-muted)]">
          Часы: {poi.hours_ru}
        </p>
      )}

      {poi.official_website && !poi.official_website.includes('japan-guide.com') && (
        <a
          href={poi.official_website}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] text-[var(--accent)] hover:underline block"
        >
          Официальный сайт →
        </a>
      )}

      {poi.maps_link && (
        <a
          href={poi.maps_link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] text-[var(--accent)] hover:underline block"
        >
          На карте →
        </a>
      )}

      {poi.has_tickets && poi.tickets && poi.tickets.length > 0 && (
        <div className="space-y-1 pt-1">
          <p className="text-[13px] font-medium">Входные билеты</p>
          <ul className="space-y-1">
            {poi.tickets.map((ticket, idx) => (
              <li key={idx} className={ticket.valid_now ? 'text-[13px]' : 'text-[13px] text-[var(--text-muted)]'}>
                {ticket.purchase_link && !ticket.purchase_link.includes('japan-guide.com') ? (
                  <a
                    href={ticket.purchase_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {ticket.name_ru} — ¥{ticket.price}
                    {!ticket.valid_now && ' (недействителен)'}
                  </a>
                ) : (
                  <span>
                    {ticket.name_ru} — ¥{ticket.price}
                    {!ticket.valid_now && ' (недействителен)'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
