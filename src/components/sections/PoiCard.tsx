import type { Poi } from '@/types/poi'
import clsx from 'clsx'
import { InfoCardFooter, InfoCardHeader, InfoCardTitleBlock, StaticInfoCard } from '@/components/ui/info-card'

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
      <StaticInfoCard muted className="flex h-full w-full flex-col md:min-h-[250px]" contentClassName="flex h-full flex-col gap-4 p-5 md:p-6">
        <div className="flex flex-1 flex-col space-y-3">
          <InfoCardHeader eyebrow={poi.category || 'Опция'} />
          <InfoCardTitleBlock title={poi.name_ru} description={description} descriptionClassName="line-clamp-5 leading-[1.8]" />
        </div>

        {(poi.official_website || poi.maps_link) && (
          <InfoCardFooter className="border-t border-[var(--border)] pt-4 text-[13px]">
            <div className="flex flex-wrap gap-3">
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
          </InfoCardFooter>
        )}
      </StaticInfoCard>
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
