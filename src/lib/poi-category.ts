/** Read projection only: never writes a type or invents classification authority. */
import {
  badges, facets, legacyCategoryMigration, poiPrimaryTypes, poiTypeLabel, taxonomyVersion,
} from './poi-taxonomy.ts'
import { TAXONOMY_FIELDS, taxonomyRecordFields } from './poi-taxonomy-airtable.ts'
import { legacyAirtableCategory } from '../../scripts/poi-portals/lib/legacy-airtable-category-bridge.mjs'

export const POI_TYPE_REVIEW = 'needs_type_review'
export const POI_TYPE_REVIEW_LABEL = 'Тип требует уточнения'

export interface PoiCategoryView {
  typeCode: string | null
  typeLabel: string
  origin: 'canonical' | 'legacy' | 'review'
  badges: string[]
  facets: string[]
  legacyCategories: string[]
  reason: string | null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && Boolean(v)))] : []
}

/** Exact aliases come from the registry and the existing writer's bridge, never hints. */
function legacyType(value: string): string | null {
  const migration = legacyCategoryMigration(value)
  if (migration) return migration.mode === 'auto' ? migration.mapsTo : null
  const matches = poiPrimaryTypes.filter((type) =>
    type.labels.ru === value || legacyAirtableCategory(type.code).value === value,
  )
  return matches.length === 1 ? matches[0].code : null
}

export function readPoiCategory(fields: Record<string, unknown>): PoiCategoryView {
  const rawLegacy = fields['POI Category (RU)']
  const legacy = strings(rawLegacy)
  const badgeLabels = badges.filter((badge) => legacy.includes(badge.labels.ru)).map((badge) => badge.labels.ru)
  const common = { badges: badgeLabels, legacyCategories: legacy }
  const review = (reason: string): PoiCategoryView => ({
    ...common, typeCode: null, typeLabel: POI_TYPE_REVIEW_LABEL, origin: 'review', facets: [], reason,
  })
  const type = fields[TAXONOMY_FIELDS.type]
  if (type !== undefined && type !== null && type !== '') {
    const verdict = taxonomyRecordFields({
      poiPrimaryType: type as string,
      facets: fields[TAXONOMY_FIELDS.facets] as string[] | undefined,
      classificationSource: fields[TAXONOMY_FIELDS.source] as string,
      taxonomyVersion: fields[TAXONOMY_FIELDS.version] as string,
    })
    if (!verdict.ok) return review('Сохранённый тип или его служебные поля требуют проверки: ' + verdict.issues.join('; '))
    return {
      ...common, typeCode: type as string, typeLabel: poiTypeLabel(type as string), origin: 'canonical', reason: null,
      facets: facets.filter((facet) => strings(fields[TAXONOMY_FIELDS.facets]).includes(facet.code)).map((facet) => facet.labels.ru),
    }
  }
  if (rawLegacy != null && (!Array.isArray(rawLegacy) || rawLegacy.some((v) => typeof v !== 'string' || !v))) {
    return review('Старое поле категории имеет неверный формат.')
  }
  const typeLabels = legacy.filter((label) => !badgeLabels.includes(label))
  const mapped = typeLabels.map(legacyType)
  const codes = [...new Set(mapped)]
  if (!typeLabels.length) return review('Тип не указан; отметка вида не определяет тип объекта.')
  if (mapped.includes(null)) return review('Старая категория неоднозначна. Определить тип по фактам об объекте.')
  if (codes.length !== 1) return review('Старые категории указывают на разные типы. Уточнить основной предмет карточки.')
  const code = codes[0]!
  return { ...common, typeCode: code, typeLabel: poiTypeLabel(code), origin: 'legacy', facets: [], reason: null }
}

/** Same code-based predicate for the live filter and regression tests. */
export function matchesPoiType(view: PoiCategoryView, filter: string): boolean {
  return filter === 'all' || (filter === POI_TYPE_REVIEW ? view.typeCode === null : view.typeCode === filter)
}

export function poiCategoryFilterOptions(views: readonly PoiCategoryView[]) {
  const counts = new Map<string, number>()
  for (const view of views) {
    const key = view.typeCode ?? POI_TYPE_REVIEW
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [
    ...poiPrimaryTypes.filter((type) => counts.has(type.code))
      .map((type) => ({ value: type.code, label: `${type.labels.ru} (${counts.get(type.code)})` }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru')),
    ...(counts.has(POI_TYPE_REVIEW) ? [{ value: POI_TYPE_REVIEW, label: `${POI_TYPE_REVIEW_LABEL} (${counts.get(POI_TYPE_REVIEW)})` }] : []),
  ]
}

export function summarizePoiCategories(rows: { recordId: string; fields: Record<string, unknown> }[]) {
  const projected = rows.map(({ recordId, fields }) => ({
    recordId, poiId: fields['POI ID'] ?? null, nameRu: fields['POI Name (RU)'] ?? null,
    ...readPoiCategory(fields),
  }))
  return {
    taxonomyVersion, total: projected.length,
    counts: Object.fromEntries(['canonical', 'legacy', 'review'].map((origin) => [origin, projected.filter((row) => row.origin === origin).length])),
    rows: projected,
  }
}
