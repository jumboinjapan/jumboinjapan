/** Administrative address observed in the source, independent of Site City.
 * No romanisation, new tourist destination or municipal POI is manufactured. */
import { resolvePoiDestination } from './jp-address.ts'
import { canonicalPrefecture } from './prefectures.ts'

export const MUNICIPALITY_FIELD = 'Municipality (JA)'
export const MUNICIPALITY_FIELD_DEFINITION = Object.freeze({ name: MUNICIPALITY_FIELD, type: 'singleLineText' })

export function municipalityForIntake(address: unknown, pointPrefecture: unknown) {
  if (typeof address !== 'string' || !address.trim() || address.length > 1000) throw new Error('municipalityAddressRequired')
  if (typeof pointPrefecture !== 'string') throw new Error('municipalityPointPrefectureRequired')
  const prefecture = canonicalPrefecture(pointPrefecture)
  if (!prefecture) throw new Error('municipalityPointPrefectureRequired')
  const parsed = resolvePoiDestination({ address, prefecture: prefecture.ja })
  if (parsed.conflict) throw new Error(`municipalityAddressConflict: ${parsed.reason}`)
  if (!parsed.municipality) throw new Error('municipalityAddressUnresolved')
  return parsed
}

export function verifyMunicipalitySchemaTable(table: { fields?: Array<{ name: string; type: string }> }) {
  if (!table.fields?.some(field => field.name === MUNICIPALITY_FIELD && field.type === MUNICIPALITY_FIELD_DEFINITION.type)) {
    throw new Error(`municipalitySchemaRequired: ${MUNICIPALITY_FIELD} (${MUNICIPALITY_FIELD_DEFINITION.type})`)
  }
}
