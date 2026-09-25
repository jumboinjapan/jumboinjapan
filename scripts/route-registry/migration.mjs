import assert from 'node:assert/strict'
import { CONTENT_KINDS, ROUTE_STATUSES, isRouteSlug, isPublicRoute } from '../../src/lib/route-publication.ts'

export const KIND_FIELD = { name: 'Content Kind', type: 'singleSelect', options: { choices: CONTENT_KINDS.map(name => ({ name })) } }
const oldKeys = ['Slug', 'Status', 'Content Kind', 'Route Type']
const createKeys = ['Route ID', 'Slug', 'Title', 'Route Type', 'Status', 'Content Kind']
const sorted = values => [...values].sort()
function exactKeys(value, keys) { assert(value && typeof value === 'object' && !Array.isArray(value)); assert.deepEqual(sorted(Object.keys(value)), sorted(keys)) }
export function validateCard(card) {
  exactKeys(card, ['version', 'baseId', 'tableId', 'authority', 'baselineSha256', 'publicBefore', 'updates', 'creates'])
  assert.equal(card.version, 'route-registry-alignment/v1')
  assert(/^app[a-zA-Z0-9]+$/.test(card.baseId) && /^tbl[a-zA-Z0-9]+$/.test(card.tableId))
  assert(typeof card.authority === 'string' && card.authority.trim())
  assert(/^[a-f0-9]{64}$/.test(card.baselineSha256))
  assert(Array.isArray(card.updates) && card.updates.length > 0 && card.updates.length <= 100)
  assert(Array.isArray(card.creates) && card.creates.length <= 20)
  assert(Array.isArray(card.publicBefore) && card.publicBefore.every(isRouteSlug))
  const ids = new Set(), slugs = new Set(), published = []
  for (const row of card.updates) {
    exactKeys(row, ['id', 'old', 'next'])
    exactKeys(row.old, oldKeys); exactKeys(row.next, ['Status', 'Content Kind', 'Route Type'])
    assert(/^rec[a-zA-Z0-9]+$/.test(row.id) && !ids.has(row.id), 'duplicate_record'); ids.add(row.id)
    assert(isRouteSlug(row.old.Slug) && !slugs.has(row.old.Slug), 'duplicate_slug'); slugs.add(row.old.Slug)
    assert(ROUTE_STATUSES.includes(row.old.Status) && ROUTE_STATUSES.includes(row.next.Status))
    assert(row.old['Content Kind'] === '' || CONTENT_KINDS.includes(row.old['Content Kind']))
    assert(CONTENT_KINDS.includes(row.next['Content Kind']))
    assert(['city-tour', 'intercity', 'multi-day', 'custom'].includes(row.old['Route Type']))
    assert(['city-tour', 'intercity', 'multi-day', 'custom'].includes(row.next['Route Type']))
    assert(row.next.Status === row.old.Status || row.next.Status === 'Published', 'alignment_does_not_demote')
    if (row.next.Status === 'Published') published.push(row.old.Slug)
  }
  for (const fields of card.creates) {
    exactKeys(fields, createKeys)
    assert(isRouteSlug(fields.Slug) && !slugs.has(fields.Slug), 'duplicate_slug'); slugs.add(fields.Slug)
    assert(typeof fields.Title === 'string' && fields.Title.trim() && typeof fields['Route ID'] === 'string' && fields['Route ID'])
    assert.equal(fields['Route Type'], fields.Slug.split('/')[0])
    assert.equal(fields.Status, 'Published')
    assert(CONTENT_KINDS.includes(fields['Content Kind']) && fields['Content Kind'] !== 'Tour', 'no_new_tours')
    published.push(fields.Slug)
  }
  assert.deepEqual(sorted(published), sorted(card.publicBefore), 'public_url_set_must_be_preserved')
}
function verifyKindField(fields) {
  const matches = fields.filter(f => f.name === KIND_FIELD.name)
  assert(matches.length <= 1, 'duplicate_kind_field')
  if (!matches.length) return false
  assert.equal(matches[0].type, KIND_FIELD.type, 'kind_field_type')
  assert.deepEqual(sorted(matches[0].options?.choices?.map(c => c.name) ?? []), sorted(CONTENT_KINDS), 'kind_field_choices')
  return true
}
function assertOld(row, records) {
  const matches = records.filter(r => r.id === row.id)
  assert.equal(matches.length, 1, 'missing_or_duplicate_record')
  for (const key of oldKeys) assert.equal(matches[0].fields[key] ?? '', row.old[key], `drift:${row.id}:${key}`)
  assert.equal(records.filter(r => r.fields.Slug === row.old.Slug).length, 1, 'ambiguous_slug')
}
function assertCreated(fields, records) {
  const matches = records.filter(r => r.fields.Slug === fields.Slug)
  assert.equal(matches.length, 1, 'create_not_unique')
  for (const [key, value] of Object.entries(fields)) assert.deepEqual(matches[0].fields[key], value, `readback:${fields.Slug}:${key}`)
  return matches[0].id
}
/** No rollback/retry. Every effect has a durable intent and independent readback. */
export async function executeMigration(card, store, { apply = false, journal = async () => {} } = {}) {
  validateCard(card)
  assert(typeof apply === 'boolean')
  const records = await store.readRoutes()
  assert.deepEqual(sorted(records.map(r => r.id)), sorted(card.updates.map(r => r.id)), 'baseline_record_set_changed')
  card.updates.forEach(row => assertOld(row, records))
  card.creates.forEach(f => assert(!records.some(r => r.fields.Slug === f.Slug), 'create_slug_taken'))
  const schemaPresent = verifyKindField(await store.readFields())
  const byId = new Map(card.updates.map(row => [row.id, row.next]))
  const proposed = [...records.map(r => ({ ...r, fields: { ...r.fields, ...byId.get(r.id) } })), ...card.creates.map((fields, i) => ({ id: `new${i}`, fields }))]
  const assessed = await store.assess(proposed)
  const bad = assessed.filter(r => r.status === 'Published' && !isPublicRoute(r))
  assert.equal(bad.length, 0, `publication_not_ready:${bad.map(r => `${r.slug}:${r.issues}`).join(';')}`)
  const pendingUpdates = card.updates.filter(row => Object.entries(row.next).some(([key, value]) => row.old[key] !== value))
  if (!apply) return { state: 'ready', schemaCreate: !schemaPresent, updates: pendingUpdates.length, creates: card.creates.length, publicCount: card.publicBefore.length }
  let verified = 0
  async function effect(operation, write, verify) {
    await journal({ phase: 'intent', operation })
    let error = null
    try { await write() } catch (e) { error = String(e) }
    try {
      const result = await verify()
      await journal({ phase: 'verified', operation, result, responseError: error })
      verified++
    } catch (e) {
      await journal({ phase: 'unknown', operation, responseError: error, readbackError: String(e), verified })
      throw new Error(`migration_stopped_after_${verified}_effects; reconcile journal before any retry`, { cause: e })
    }
  }
  if (!schemaPresent) await effect({ kind: 'schema', field: KIND_FIELD }, () => store.createField(KIND_FIELD), async () => {
    assert(verifyKindField(await store.readFields())); return 'present'
  })
  for (const row of pendingUpdates) {
    assertOld(row, await store.readRoutes())
    await effect({ kind: 'update', ...row }, () => store.updateRoute(row.id, row.next), async () => {
      const current = await store.readRoutes()
      assertOld({ ...row, old: { ...row.old, ...row.next } }, current)
      return row.id
    })
  }
  for (const fields of card.creates) {
    assert(!(await store.readRoutes()).some(r => r.fields.Slug === fields.Slug), 'create_slug_taken')
    await effect({ kind: 'create', fields }, () => store.createRoute(fields), async () => assertCreated(fields, await store.readRoutes()))
  }
  const final = await store.readRoutes()
  assert.equal(final.length, card.updates.length + card.creates.length)
  card.updates.forEach(row => assertOld({ ...row, old: { ...row.old, ...row.next } }, final))
  card.creates.forEach(f => assertCreated(f, final))
  const publicAfter = (await store.assess(final)).filter(route => isPublicRoute(route)).map(r => r.slug)
  assert.deepEqual(sorted(publicAfter), sorted(card.publicBefore), 'final_public_url_set')
  await journal({ phase: 'complete', verified, publicCount: publicAfter.length })
  return { state: 'verified', verified, publicCount: publicAfter.length }
}
