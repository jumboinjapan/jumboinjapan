import assert from 'node:assert/strict'
import { withResponseDeadline, readResponseBytes, fetchJsonResponse, JSON_RESPONSE_MAX_BYTES } from '../scripts/poi-portals/lib/network-boundary.mjs'
import { collectFromOpenDataCsv, resolveCkanCsvUrl, CSV_MAX_RESPONSE_BYTES, assertCkanResourceUrl } from '../scripts/poi-portals/lib/opendata-csv.mjs'
import { fetchRobots, fetchHtmlPage, createRequestPacer } from '../scripts/poi-portals/lib/html-fetch.mjs'
import { createAirtablePoiStore } from '../scripts/poi-portals/lib/airtable-store.mjs'
import { getPortal } from '../scripts/poi-portals/registry.mjs'

globalThis.fetch = async () => { throw new Error('test forbids real network') }
const deadlineMs = 30
const never = () => new Promise(() => {})
const csvUrl = 'https://data.bodik.jp/dataset/test/resource/test/download/data.csv'
const metadata = (over = {}) => ({ success: true, result: { license_id: 'cc-by-40-intl', resources: [{ format: 'CSV', url: csvUrl }], ...over } })
const json = (value) => new Response(JSON.stringify(value))
const portal = getPortal('bodik-osaka-tourism')
const isDeadline = (e) => e.code === 'requestDeadline'
/* Зависание — это провал с именем, а не «unsettled top-level await» (exit 13):
   если deadline не сработал, обещание не завершится никогда, и ослабление
   защиты нужно ловить именованным утверждением, а не таймаутом процесса. */
const settles = (label, promise, ms = 2_000) => {
  let timer
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new assert.AssertionError({ message: `${label}: не завершилось за ${ms} мс — deadline не сработал` })), ms)
  })
  // Таймер держит цикл событий живым намеренно: без него зависший
  // промис завершал бы процесс кодом 13 раньше именованного провала.
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

let headersSignal
await assert.rejects(settles('deadline #1', withResponseDeadline(async (_url, init) => { headersSignal = init.signal; return never() }, 'https://fixture.invalid', {}, never, deadlineMs)), isDeadline)
assert.equal(headersSignal?.aborted, true, 'deadline aborts the actual transport signal')

let cancelled = false
const stuckBody = () => new Response(new ReadableStream({ pull: never, cancel() { cancelled = true } }))
await assert.rejects(settles('deadline #2', fetchJsonResponse(async () => stuckBody(), 'https://fixture.invalid', {}, deadlineMs)), isDeadline)
assert.equal(cancelled, true, 'deadline cancels stalled response body')
assert.deepEqual(await (await fetchJsonResponse(async () => json({ ok: 1 }), 'https://fixture.invalid', {}, deadlineMs)).json(), { ok: 1 })
await assert.rejects(fetchJsonResponse(async () => new Response('{}' + ' '.repeat(JSON_RESPONSE_MAX_BYTES)),
  'https://fixture.invalid', {}), (e) => e.code === 'responseTooLarge', 'JSON consumer enforces body limit')

let fetched = 0
await assert.rejects(settles('deadline #3', collectFromOpenDataCsv(portal, { deadlineMs, fetchImpl: async () => { fetched++; return never() } })), isDeadline)
assert.equal(fetched, 1)
await assert.rejects(settles('deadline #4', collectFromOpenDataCsv(portal, { deadlineMs, fetchImpl: async (url) => url.includes('package_show') ? json(metadata()) : stuckBody() })), isDeadline)

for (const badUrl of ['http://127.0.0.1:9/x.csv', 'https://data.bodik.jp.evil.test/x.csv', 'https://data.bodik.jp@evil.test/x.csv', csvUrl+'?x=1', csvUrl+'#x', csvUrl.replace('/test/', '/%2e%2e/'), csvUrl.replace('https:', 'file:')]) {
  let calls = 0
  await assert.rejects(collectFromOpenDataCsv(portal, { fetchImpl: async () => { calls++; return json(metadata({ resources: [{ format: 'CSV', url: badUrl }] })) } }), /ckanResourceDenied/, 'CSV URL guard rejects before resource fetch')
  assert.equal(calls, 1)
  assert.throws(() => assertCkanResourceUrl(badUrl), /ckanResourceDenied/)
}
for (const licence of [undefined, '', 'restricted', 'cc-by']) {
  let calls = 0
  await assert.rejects(collectFromOpenDataCsv(portal, { fetchImpl: async () => { calls++; return json(metadata({ license_id: licence })) } }), /ckanLicenceChanged/, 'CSV licence guard rejects before resource fetch')
  assert.equal(calls, 1)
}
let oversizedCancelled = false
await assert.rejects(collectFromOpenDataCsv(portal, { fetchImpl: async (url, init) => {
  assert.equal(init.redirect, 'error', 'CSV redirects are forbidden at transport')
  if (url.includes('package_show')) return json(metadata())
  return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(CSV_MAX_RESPONSE_BYTES + 1)) }, cancel() { oversizedCancelled = true } }))
} }), (e) => e.code === 'responseTooLarge', 'CSV streaming limit rejects oversized body')
assert.equal(oversizedCancelled, true)
assert.deepEqual(await readResponseBytes(new Response('abc'), 3), new TextEncoder().encode('abc'))
await assert.rejects(readResponseBytes(new Response(new ReadableStream({ start(c) {
  c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3, 4])); c.close()
} })), 3), (e) => e.code === 'responseTooLarge', 'stream byte limit sums chunks')

for (const bad of [0, -1, NaN, Infinity, '30', null]) {
  let calls = 0
  await assert.rejects(withResponseDeadline(async () => { calls++; return json({}) }, 'https://fixture.invalid', {}, never, bad), /deadlineMs/)
  assert.equal(calls, 0)
}
for (const over of [{ api: 'http://127.0.0.1/package_show' }, { datasetId: '' }, { datasetId: '../other' }]) {
  let calls = 0
  await assert.rejects(resolveCkanCsvUrl({ ...portal.ckan, ...over }, { fetchImpl: async () => { calls++; return json(metadata()) } }), /ckanEndpointDenied/)
  assert.equal(calls, 0)
}

const htmlOptions = () => ({ now: () => new Date('2026-09-06T00:00:00Z'), clock: Date.now, pacer: createRequestPacer({ sleep: async () => {} }), deadlineMs })
await assert.rejects(settles('deadline #5', fetchRobots({ ...htmlOptions(), fetchImpl: never })), isDeadline)
await assert.rejects(settles('deadline #6', fetchRobots({ ...htmlOptions(), fetchImpl: async () => stuckBody() })), isDeadline)
await assert.rejects(settles('deadline #7', fetchHtmlPage({ ...htmlOptions(), url: 'https://www.japan-guide.com/e/e623a.html', robots: { assertAllowed() {} }, fetchImpl: async () => stuckBody() })), isDeadline)

await assert.rejects(settles('deadline #8', createAirtablePoiStore({ token: 'fixture', baseId: 'fixture', deadlineMs, fetchImpl: never }).listExisting()), isDeadline)
let posts = 0
let intent = false
const store = createAirtablePoiStore({ token: 'fixture', baseId: 'fixture', deadlineMs, fetchImpl: async (_url, init) => {
  if (init.method === 'POST') { posts++; assert.equal(intent, true); return stuckBody() }
  return json({ records: [] })
} })
await assert.rejects(settles('deadline #9', store.create({ 'Source Key': 'fixture:1' }, { onEffect() { intent = true } })), isDeadline)
assert.equal(posts, 1)
console.log('Network boundary: deadlines, cancellation, URL/licence, byte limits and no POST retry passed')
