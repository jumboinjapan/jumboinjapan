/**
 * HKP-04: большие досье читаются штатным хранилищем небольшими страницами.
 *
 * Транспорт подменён моделью Airtable: он соблюдает `pageSize`, выдаёт offset,
 * привязанный к размеру страницы (смешать размеры в одной последовательности
 * нельзя), и отдаёт настоящий `Response`, так что лимит ответа 4 МиБ
 * проверяется тем же потоковым чтением, что и в живом прогоне. Записей нет.
 */
import assert from 'node:assert/strict'
import { createAirtablePoiStore, HEAVY_PAGE_SIZE, MAX_PAGE_SIZE } from '../scripts/poi-portals/lib/airtable-store.mjs'
import { JSON_RESPONSE_MAX_BYTES } from '../scripts/poi-portals/lib/network-boundary.mjs'

let checks = 0
const test = async (name, f) => {
  try { await f(); checks++; console.log('✓ ' + name) } catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }) }
}

function airtable(records, { duplicateAt = null, failWith = null } = {}) {
  const log = []
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url))
    const method = init.method ?? 'GET'
    const pageSize = Number(u.searchParams.get('pageSize'))
    log.push({ method, pageSize, offset: u.searchParams.get('offset'), fields: u.searchParams.getAll('fields[]') })
    if (log.length > 60) throw new Error('runaway retries: the store did not stop')
    assert.equal(method, 'GET', 'read-only')
    if (failWith) return new Response(failWith, { status: 500 })
    assert(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100, 'Airtable pageSize range')
    let start = 0
    const offset = u.searchParams.get('offset')
    if (offset) {
      const [at, size] = offset.split('/').map(Number)
      assert.equal(size, pageSize, 'an offset belongs to the page size that produced it')
      start = at
    }
    const wanted = new Set(u.searchParams.getAll('fields[]'))
    const page = records.slice(start, start + pageSize).map((r) => ({ id: r.id, fields: Object.fromEntries(Object.entries(r.fields).filter(([k]) => wanted.has(k))) }))
    if (duplicateAt !== null && start === duplicateAt) page.push(page[0])
    const next = start + pageSize < records.length ? `${start + pageSize}/${pageSize}` : undefined
    return new Response(JSON.stringify({ records: page, ...(next ? { offset: next } : {}) }))
  }
  return { fetchImpl, log }
}
const records = (n, field, size) => Array.from({ length: n }, (_, i) => ({ id: `rec${String(i).padStart(14, '0')}`,
  fields: { 'POI ID': `POI-${String(i + 1).padStart(6, '0')}`, 'POI Name (RU)': `Место ${i}`, [field]: 'x'.repeat(size) } }))
const store = (transport) => createAirtablePoiStore({ token: 'fixture', baseId: 'appFixture00000000', fetchImpl: transport.fetchImpl })

await test('HEAVY_SELECTION_READS_SMALL_PAGES', async () => {
  const data = records(200, 'Notes', 60_000)
  assert(100 * 60_000 > JSON_RESPONSE_MAX_BYTES, 'the fixture exceeds the limit at 100 per page')
  const t = airtable(data)
  const rows = await store(t).readAllFields(['POI ID', 'Notes'])
  assert.deepEqual(rows.map((r) => r.recordId), data.map((r) => r.id), 'every ID exactly once, in order')
  assert(t.log.every((c) => c.pageSize === HEAVY_PAGE_SIZE))
  assert.equal(t.log.length, 200 / HEAVY_PAGE_SIZE)
})

await test('NAMED_REFUSAL_RESTARTS_WITH_A_SMALLER_PAGE', async () => {
  const data = records(200, 'Description Draft (RU)', 60_000)
  const t = airtable(data)
  const rows = await store(t).readAllFields(['POI ID', 'Description Draft (RU)'])
  assert.equal(new Set(rows.map((r) => r.recordId)).size, 200)
  assert.equal(rows.length, 200)
  assert.deepEqual(t.log.map((c) => c.pageSize), [100, 50, 50, 50, 50], 'one refused page, then a complete read at half size')
  assert.equal(t.log[1].offset, null, 'the smaller read starts again, not from the old offset')
})

await test('ONE_OVERSIZED_RECORD_STAYS_EXPLICIT', async () => {
  const data = records(3, 'Notes', 10)
  data[1].fields.Notes = 'x'.repeat(JSON_RESPONSE_MAX_BYTES + 1)
  const t = airtable(data)
  await assert.rejects(() => store(t).readAllFields(['POI ID', 'Notes']), /одна запись превышает лимит ответа/)
  const sizes = t.log.map((c) => c.pageSize)
  assert.deepEqual([...new Set(sizes)], [25, 12, 6, 3, 1], 'bounded halving, no endless retries')
  assert(t.log.length <= 10)
})

await test('MINIMAL_SELECTION_KEEPS_FULL_PAGES', async () => {
  const t = airtable(records(200, 'Notes', 60_000))
  const existing = await store(t).listExisting()
  assert.equal(existing.length, 200)
  assert(t.log.every((c) => c.pageSize === MAX_PAGE_SIZE && !c.fields.includes('Notes')))
  assert.equal(t.log.length, 2)
})

await test('DUPLICATE_RECORD_IN_ONE_READ_IS_AN_ERROR', async () => {
  const t = airtable(records(50, 'Notes', 10), { duplicateAt: 25 })
  await assert.rejects(() => store(t).readAllFields(['POI ID', 'Notes']), /пришла в выдаче дважды/)
})

await test('OTHER_FAILURES_ARE_NOT_RETRIED', async () => {
  const t = airtable(records(10, 'Notes', 10), { failWith: 'boom' })
  await assert.rejects(() => store(t).readAllFields(['POI ID', 'Notes']), /Airtable POI read: 500/)
  assert.equal(t.log.length, 1)
})

console.log(`${checks} checks passed`)
