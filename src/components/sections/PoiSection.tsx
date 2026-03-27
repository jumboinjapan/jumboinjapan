import type { Poi } from '@/types/poi'
import { PoiCard } from './PoiCard'

interface PoiSectionProps {
  pois: Poi[]
}

export function PoiSection({ pois }: PoiSectionProps) {
  const filtered = pois.filter(p => p.name_ru)

  if (filtered.length === 0) return null

  return (
    <section className="space-y-6">
      <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">
        Дополнительные опции
      </h2>
      <div className="space-y-6">
        {filtered.map(poi => (
          <PoiCard key={poi.id} poi={poi} />
        ))}
      </div>
    </section>
  )
}
