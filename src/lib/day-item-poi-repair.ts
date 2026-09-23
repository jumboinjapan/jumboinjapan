import { isDeepStrictEqual } from 'node:util'

export interface DayItemRepair {
  id: string
  before: Record<string, unknown>
  fields: Record<string, unknown>
}
interface Row { id: string; fields: Record<string, unknown> }
interface Store {
  read(id: string): Promise<Row>
  patch(id: string, fields: Record<string, unknown>): Promise<void>
  preflight(refs: Array<{ key: string; poiId: unknown }>): Promise<void>
}
const allowed = new Set(['POI ID', 'POI Name Snapshot', 'Item Type', 'Short Description'])

export class DayItemRepairError extends Error {
  applied: string[]
  failedId: string
  phase: string
  uncertainId: string | null
  constructor(message: string, applied: string[], failedId: string, phase: string, uncertainId: string | null) {
    super(message)
    this.name = 'DayItemRepairError'
    this.applied = applied
    this.failedId = failedId
    this.phase = phase
    this.uncertainId = uncertainId
  }
  get recoveryRequired() { return this.applied.length > 0 || this.uncertainId !== null }
}

/** Bounded repair of existing items, without reserializing or replacing a route. */
export async function repairDayItemPois(rows: DayItemRepair[], store: Store) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 50) throw Error('Invalid repair batch')
  const seen = new Set<string>()
  const refs: Array<{ key: string; poiId: unknown }> = []
  for (const row of rows) {
    if (!row || !/^rec[A-Za-z0-9]{14}$/.test(row.id) || seen.has(row.id)) throw Error('Invalid or duplicate repair identity')
    seen.add(row.id)
    if (!row.before || !row.fields || !Object.keys(row.fields).length || Object.keys(row.fields).some(k => !allowed.has(k))) throw Error('Invalid repair fields')
    if (Object.values(row.fields).some(v => typeof v !== 'string')) throw Error('Repair fields must be strings')
    const current = await store.read(row.id)
    if (current.id !== row.id || !isDeepStrictEqual(current.fields, row.before)) throw Error(`Repair drift: ${row.id}`)
    const next = { ...current.fields, ...row.fields }
    if (!next['Day Item ID'] || !next['Route Slug']) throw Error('Missing item identity')
    // Classification corrections never remove an existing POI relationship.
    if (row.fields['Item Type'] !== undefined && (row.fields['Item Type'] !== 'note' || current.fields['Item Type'] !== 'poi' || current.fields['POI ID'])) throw Error('Invalid service classification repair')
    if ('POI ID' in row.fields && !/^POI-\d{6}$/.test(String(row.fields['POI ID']))) throw Error('Invalid POI ID')
    if (next['Item Type'] === 'poi' || next['POI ID']) refs.push({ key: row.id, poiId: next['POI ID'] })
  }
  await store.preflight(refs)
  const applied: string[] = []
  for (const row of rows) {
    let phase = 'before-read'
    let attempted = false
    try {
      const current = await store.read(row.id)
      if (current.id !== row.id || !isDeepStrictEqual(current.fields, row.before)) throw Error(`Repair drift: ${row.id}`)
      phase = 'patch'
      attempted = true
      await store.patch(row.id, row.fields)
      phase = 'verify'
      const after = await store.read(row.id)
      if (after.id !== row.id || !isDeepStrictEqual(after.fields, { ...row.before, ...row.fields })) throw Error(`Repair verification failed: ${row.id}`)
      applied.push(row.id)
    } catch (error) {
      throw new DayItemRepairError(error instanceof Error ? error.message : 'Repair failed', [...applied], row.id, phase, attempted ? row.id : null)
    }
  }
  return { applied }
}
