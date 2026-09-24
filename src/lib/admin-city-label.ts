import { unassignedDestinationPrefecture } from './jp-address.ts'

const CITY_LABEL_OVERRIDES: Record<string, string> = {
  'mt fuji': 'Mt Fuji',
  'mt-fuji': 'Mt Fuji',
  'mount fuji': 'Mt Fuji',
}

export function formatAdminCityLabel(city: string | null | undefined): string {
  const normalized = city?.trim().toLowerCase()

  if (!normalized) return ''

  const unassigned = unassignedDestinationPrefecture(normalized)
  if (unassigned) return `${unassigned.ru} — направление не назначено`

  const overridden = CITY_LABEL_OVERRIDES[normalized]
  if (overridden) return overridden

  return normalized
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
}
