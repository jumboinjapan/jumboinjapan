/** One vocabulary for matrix proposals, compact views and future UI consumers.
 * This does not replace the primary-type registry or grant editorial badges. */
import data from '../../config/poi-matrix.v1.json' with { type: 'json' }
import { FACT_CATEGORIES } from './poi-facts.ts'

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

const groups = new Set(data.groups.map(group => group.code))
if (groups.size !== data.groups.length) throw new Error('matrixRegistry: duplicate group')
const codes = new Set<string>()
for (const property of data.properties) {
  if (codes.has(property.code) || !groups.has(property.group)) throw new Error('matrixRegistry: property/group')
  codes.add(property.code)
  if (!property.factCategories.length || property.factCategories.some(code => !Object.hasOwn(FACT_CATEGORIES, code))) {
    throw new Error('matrixRegistry: fact category')
  }
  if (!property.factStatuses.length || property.factStatuses.some(status => !['reported', 'verified'].includes(status))) {
    throw new Error('matrixRegistry: evidence status')
  }
  if (property.requiresAgeRange && (!property.temporal || property.factStatuses.some(status => status !== 'verified'))) {
    throw new Error('matrixRegistry: age requires verified current evidence')
  }
}
for (const item of [...data.groups, ...data.properties]) {
  for (const lang of data.languages) {
    if (!(item.labels as Record<string, string>)[lang]?.trim()) throw new Error('matrixRegistry: translation')
  }
}

export const matrixRegistry = freeze(data)
export const matrixProperty = (code: string) => matrixRegistry.properties.find(property => property.code === code) ?? null
export function matrixLabel(code: string, language: 'ru' | 'en' = 'ru'): string {
  const property = matrixProperty(code)
  if (!property) throw new Error(`matrixRegistry: unknown property ${code}`)
  return property.labels[language]
}
