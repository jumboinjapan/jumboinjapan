import type { Poi } from '@/types/poi'
import clsx from 'clsx'
import { InfoCardHeader, InfoCardTitleBlock, StaticInfoCard } from '@/components/ui/info-card'

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

    </div>
  )
}
