import type { Poi } from '@/types/poi'
import clsx from 'clsx'

interface PoiCardProps {
  poi: Poi
  compact?: boolean
  descriptionOverride?: string
}

export function PoiCard({ poi, compact = false, descriptionOverride }: PoiCardProps) {
  if (!poi.name_ru) return null

  const description = descriptionOverride || poi.description_ru

  if (compact) {
    return (
      <article className="flex h-full w-full flex-col rounded-sm border border-[var(--border)] bg-[var(--bg)] p-5 md:min-h-[250px] md:p-6">
        <div className="flex flex-1 flex-col space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--accent)]">
            {poi.category || 'Опция'}
          </p>
          <h3 className="font-sans text-[18px] font-medium leading-[1.25] tracking-[-0.01em] md:text-[20px]">
            {poi.name_ru}
          </h3>
          {description && (
            <p className="line-clamp-5 font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
              {description}
            </p>
          )}
        </div>

        {(poi.official_website || poi.maps_link) && (
          <div className="mt-5 flex flex-wrap gap-3 border-t border-[var(--border)] pt-4 text-[13px]">
            {poi.official_website && !poi.official_website.includes('japan-guide.com') && (
              <a
                href={poi.official_website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center text-[var(--accent)] transition-colors hover:underline focus-visible:underline"
              >
                Официальный сайт →
              </a>
            )}

            {poi.maps_link && (
              <a
                href={poi.maps_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center text-[var(--accent)] transition-colors hover:underline focus-visible:underline"
              >
                На карте →
              </a>
            )}
          </div>
        )}
      </article>
    )
  }

  return (
    <div className={clsx('space-y-2 border-t border-[var(--border)] pt-6')}>
      <h3 className="font-sans text-[19px] font-medium leading-[1.25] tracking-[-0.01em]">
        {poi.name_ru}
      </h3>

      {description && (
        <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
          {description}
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
          className="block text-[13px] text-[var(--accent)] hover:underline"
        >
          Официальный сайт →
        </a>
      )}

      {poi.maps_link && (
        <a
          href={poi.maps_link}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-[13px] text-[var(--accent)] hover:underline"
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
