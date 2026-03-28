import type { Poi } from '@/types/poi'
import { PoiCard } from './PoiCard'
import { PoiCarousel } from './PoiCarousel'

interface PoiSectionProps {
  pois: Poi[]
  title?: string
  excludeNames?: string[]
  compact?: boolean
  descriptionOverrides?: Record<string, string>
}

export function PoiSection({
  pois,
  title = 'Дополнительные опции',
  excludeNames = [],
  compact = false,
  descriptionOverrides = {},
}: PoiSectionProps) {
  const excluded = new Set(excludeNames.map((name) => name.trim().toLowerCase()))
  const filtered = pois.filter((poi) => {
    if (!poi.name_ru) return false
    return !excluded.has(poi.name_ru.trim().toLowerCase())
  })

  if (filtered.length === 0) return null

  return (
    <section className="space-y-6">
      <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
        {title}
      </h2>

      {compact ? (
        <PoiCarousel pois={filtered} descriptionOverrides={descriptionOverrides} />
      ) : (
        <div className="space-y-6">
          {filtered.map((poi) => (
            <PoiCard
              key={poi.id}
              poi={poi}
              descriptionOverride={descriptionOverrides[poi.name_ru]}
            />
          ))}
        </div>
      )}
    </section>
  )
}
