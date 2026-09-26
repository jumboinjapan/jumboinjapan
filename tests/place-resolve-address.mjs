/**
 * HKP-01: адрес найденного места сверяется с адресом источника.
 *
 * Сеть подставлена: каждый случай исполняет НАСТОЯЩИЙ `resolvePlace` на
 * синтетическом ответе Google, а итог доводится до той же границы записи
 * (`runIdentification` → `buildIdentificationReport` → `prepareIntakeRequest`),
 * что и живой прогон. Реальных статей и ответов провайдера здесь нет.
 */
import assert from 'node:assert/strict'
import { resolvePlace, ADMINISTRATIVE_CONFIRMATION_KM } from '../src/lib/place-resolve.ts'
import { compareAddressParts, parseJapaneseAddressDetail } from '../src/lib/jp-address.ts'
import { runIdentification, buildIdentificationReport } from '../scripts/poi-portals/lib/place-identification.mjs'
import { prepareIntakeRequest } from '../scripts/poi-portals/lib/japan-guide-record.mjs'
import { classifyModelResponse } from '../scripts/poi-portals/lib/classification-contract.mjs'

let checks = 0
let network = 0
const originalFetch = globalThis.fetch
globalThis.fetch = () => { network++; throw new Error('Unexpected network') }
const test = async (name, f) => {
  try { await f(); checks++; console.log('✓ ' + name) } catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }) }
}

const KUSHIRO = '北海道釧路市大町2丁目1-12'
const query = { nameJa: '港文館', searchArea: '釧路市', address: KUSHIRO, prefectureEn: 'Hokkaido', locationBias: { lat: 42.982, lon: 144.369 } }
const component = (text, ...types) => ({ longText: text, shortText: text, types: [...types, 'political'] })
const candidate = (id, name, parts, point = { latitude: 42.9825, longitude: 144.3695 }) => ({
  id, displayName: { text: name }, location: point, businessStatus: 'OPERATIONAL', addressComponents: parts,
})
const kushiro = [component('北海道', 'administrative_area_level_1'), component('釧路市', 'locality'), component('大町', 'sublocality_level_1'), component('2丁目', 'sublocality_level_2')]
const asahikawa = [component('北海道', 'administrative_area_level_1'), component('旭川市', 'locality')]
const resolve = async (places, input = query) => {
  let calls = 0
  const result = await resolvePlace(input, { apiKey: 'synthetic-no-secret', fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => ({ places }) } } })
  assert.equal(calls, 1, 'ровно один платный вызов')
  return result
}

await test('EXACT_NAME_IN_ANOTHER_MUNICIPALITY_IS_REJECTED', async () => {
  const r = await resolve([candidate('other-city', '港文館', asahikawa, { latitude: 43.76, longitude: 142.35 })])
  assert.equal(r.outcome, 'notFound')
  assert.equal(r.place, null)
  assert.deepEqual(r.diagnostics.rejected, { addressConflict: 1 })
  assert.deepEqual(r.diagnostics.addressConflicts, [{ level: 'municipality', source: '釧路市' }])
})

await test('SOURCE_ADDRESS_SELECTS_ONE_OF_TWO_SAME_NAMES', async () => {
  const r = await resolve([candidate('right-city', '港文館', kushiro), candidate('other-city', '港文館', asahikawa, { latitude: 43.76, longitude: 142.35 })])
  assert.equal(r.outcome, 'resolved', r.reason)
  assert.equal(r.place.placeId, 'right-city')
  assert.deepEqual(r.diagnostics.addressEvidence, { match: 1, insufficient: 0 })
})

await test('SAME_MUNICIPALITY_DOES_NOT_PROVE_IDENTITY', async () => {
  const r = await resolve([candidate('a', '港文館', kushiro), candidate('b', '港文館', kushiro)])
  assert.equal(r.outcome, 'ambiguous')
  assert.equal(r.alternatives.length, 2)
})

await test('DIFFERENT_SUBJECTS_AT_ONE_ADDRESS_STAY_DIFFERENT', async () => {
  // Museum and park, castle and its park: the address agrees, the name policy does not.
  for (const [ours, theirs] of [['港文館', '港文館公園'], ['大阪城', '大阪城公園']]) {
    const r = await resolve([candidate('neighbour', theirs, kushiro)], { ...query, nameJa: ours })
    assert.equal(r.outcome, 'notFound', `${ours} ≠ ${theirs}`)
    assert.deepEqual(r.diagnostics.rejected, { nameMismatch: 1 })
  }
})

await test('OPERATOR_PREFIX_NEEDS_A_SOURCED_ALIAS', async () => {
  const prefixed = candidate('prefixed', '一般財団法人 港文館', kushiro)
  const blind = await resolve([prefixed])
  assert.equal(blind.outcome, 'notFound', 'the comparison itself is not loosened')
  const proven = await resolve([prefixed], { ...query, nameAlternative: '一般財団法人 港文館' })
  assert.equal(proven.outcome, 'resolved', proven.reason)
  const provenElsewhere = await resolve([candidate('prefixed-elsewhere', '一般財団法人 港文館', asahikawa)], { ...query, nameAlternative: '一般財団法人 港文館' })
  assert.equal(provenElsewhere.outcome, 'notFound', 'an alias does not bypass the address')
})

await test('PLOT_CONFLICT_IS_NOT_CONFIRMED_AUTOMATICALLY', async () => {
  const input = { nameJa: '手宮線跡地', address: '北海道小樽市色内1-15-14', prefectureEn: 'Hokkaido' }
  const otaru = (banchi) => [component('北海道', 'administrative_area_level_1'), component('小樽市', 'locality'), component('色内', 'sublocality_level_1'), component('1丁目', 'sublocality_level_2'), { longText: banchi, types: ['sublocality_level_4', 'sublocality', 'political'] }, { longText: '14', types: ['premise'] }]
  const neighbour = await resolve([candidate('plot-7', '手宮線跡地', otaru('7'), { latitude: 43.2, longitude: 141 })], input)
  assert.equal(neighbour.outcome, 'notFound')
  assert.deepEqual(neighbour.diagnostics.addressConflicts, [{ level: 'banchi', source: '15-14' }])
  const same = await resolve([candidate('plot-15', '手宮線跡地', otaru('15'), { latitude: 43.2, longitude: 141 })], input)
  assert.equal(same.outcome, 'resolved')
})

await test('NATURAL_FEATURE_WITHOUT_ADDRESS_IS_INSUFFICIENT_NOT_CONFLICT', async () => {
  const r = await resolve([candidate('lake', '港文館', [component('北海道', 'administrative_area_level_1')])])
  assert.equal(r.outcome, 'resolved')
  assert.deepEqual(r.diagnostics.addressEvidence, { match: 0, insufficient: 1 })
})

await test('EVERY_SHARED_PLOT_NUMBER_MUST_AGREE', async () => {
  const house = (last) => [...kushiro, component('1', 'sublocality_level_3'), component(last, 'premise')]
  const wrong = candidate('wrong-house', '港文館', house('99'))
  const correct = candidate('right-house', '港文館', house('12'))
  const rejected = await resolve([wrong])
  assert.equal(rejected.outcome, 'notFound')
  assert.deepEqual(rejected.diagnostics.addressConflicts, [{ level: 'banchi', source: '1-12' }])
  const selected = await resolve([wrong, correct])
  assert.equal(selected.outcome, 'resolved')
  assert.equal(selected.place.placeId, 'right-house')
  const partial = candidate('partial', '港文館', [...kushiro, component('1', 'sublocality_level_3')])
  assert.equal((await resolve([partial])).outcome, 'resolved', 'missing final detail is not a conflict')
})

await test('ENGLISH_PROVIDER_ADDRESS_IS_NOT_TRANSLITERATED', async () => {
  const input = { nameEn: 'Kobunkan', address: KUSHIRO, prefectureEn: 'Hokkaido' }
  const en = [component('Hokkaido', 'administrative_area_level_1'), component('Asahikawa', 'locality')]
  const r = await resolve([candidate('en', 'Kobunkan', en)], input)
  assert.equal(r.outcome, 'resolved', 'romanized municipality is not compared with Japanese')
  assert.deepEqual(r.diagnostics.addressEvidence, { match: 0, insufficient: 1 })
})

await test('ADDRESS_VARIANT_SPELLINGS_AGREE', () => {
  const agree = (source, provider) => compareAddressParts(source, { prefecture: '', municipality: '', ward: '', town: '', chome: '', numbers: [], ...provider })
  assert.equal(agree('北海道目梨郡羅臼町湯の沢町', { municipality: '羅臼町', town: '湯ノ沢町' }).verdict, 'match')
  assert.equal(agree('北海道札幌市中央区北一条西二丁目', { municipality: '札幌市', ward: '中央区', town: '北1条西', chome: '２' }).verdict, 'match')
  assert.equal(agree('北海道札幌市中央区北一条西二丁目', { municipality: '札幌市', ward: '北区' }).conflict.level, 'ward')
  assert.equal(agree('北海道網走郡大空町女満別朝日44-2', { municipality: '大空町', town: '女満別' }).verdict, 'match')
  assert.equal(agree('北海道網走郡大空町女満別朝日44-2', { municipality: '大空町', town: '東藻琴' }).conflict.level, 'town')
  assert.deepEqual(parseJapaneseAddressDetail('北海道小樽市色内1-15-14').numbers, ['15', '14'])
  assert.equal(agree('東京都渋谷区神南2-1-1', { municipality: '渋谷区' }).verdict, 'match')
  assert.equal(agree('中央区銀座1-1', { municipality: '中央区' }).verdict, 'insufficient', 'a bare ward is not Tokyo')
})

// ── Мыс Камуи: провайдер без префектуры ──────────────────────────────────
const KAMUI = '北海道積丹郡積丹町神岬町シマツナイ'
const kamuiQuery = { nameJa: '神威岬', searchArea: '積丹町', address: KAMUI, prefectureEn: 'Hokkaido', siteCity: 'unassigned-hokkaido', locationBias: { lat: 43.3299, lon: 140.3542 } }
const noPrefecture = [component('積丹町', 'locality')]
const kamui = (parts = noPrefecture, point = { latitude: 43.3343, longitude: 140.3464 }) => candidate('synthetic-kamui', '神威岬', parts, point)

await test('MISSING_PROVIDER_PREFECTURE_GETS_SEPARATE_CONFIRMATION', async () => {
  const r = await resolve([kamui()], kamuiQuery)
  assert.equal(r.outcome, 'resolved')
  assert.equal(r.place.prefecture, null, 'the expected prefecture is not written into the provider answer')
  assert.deepEqual(r.place.administrative, { basis: 'sourceAddressMunicipality', prefecture: { en: 'Hokkaido', ru: 'Хоккайдо', ja: '北海道' }, municipality: '積丹町', maxDistanceKm: ADMINISTRATIVE_CONFIRMATION_KM })
})

await test('CONFIRMATION_REQUIRES_EVERY_CONDITION', async () => {
  const { locationBias, ...noBias } = kamuiQuery
  assert.equal(locationBias.lat > 0, true)
  for (const [label, places, input] of [
    ['no source point', [kamui()], noBias],
    ['point too far', [kamui(noPrefecture, { latitude: 42.5, longitude: 140.3 })], kamuiQuery],
    ['municipality absent', [kamui([])], kamuiQuery],
    ['source address without prefecture', [kamui()], { ...kamuiQuery, address: '積丹郡積丹町神岬町' }],
    ['declared prefecture disagrees', [kamui()], { ...kamuiQuery, prefectureEn: 'Aomori' }],
  ]) {
    const r = await resolve(places, input)
    assert.equal(r.place?.administrative, undefined, label)
  }
  const elsewhere = await resolve([kamui([component('古平町', 'locality')])], kamuiQuery)
  assert.equal(elsewhere.outcome, 'notFound', 'a real municipality conflict is not suppressed')
})

const proposal = { entityKind: 'tourist_poi', poiPrimaryType: 'museum', facets: [], confidence: 0.99, reasons: ['Синтетический предмет.'], nameRu: 'Мыс Камуи' }
const classification = classifyModelResponse(proposal, { sourceKey: 'visit-hokkaido:spot-99342' }).classification
const identify = async (places, row = {}) => {
  const queue = [Object.fromEntries(Object.entries({ sourceKey: 'visit-hokkaido:spot-99342', sourceUrl: 'https://www.visit-hokkaido.jp/spot/detail_99342.html', ...kamuiQuery, nameEn: null, ...row }).filter(([, v]) => v !== undefined))]
  const result = await runIdentification({ queue, limit: 1, now: () => new Date('2026-09-25T00:00:00Z'),
    resolve: (q) => resolvePlace(q, { apiKey: 'synthetic-no-secret', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ places }) }) }) })
  return buildIdentificationReport({ queue, result, limit: 1, priceMicros: 0, createdAt: '2026-09-25T00:00:00Z', inputs: { synthetic: true }, portal: 'visit-hokkaido' })
}
const prepare = (report, address = KAMUI) => {
  const hit = report.rows[0]
  const candidateRow = { sourceKey: hit.sourceKey, sourceUrl: hit.sourceUrl, nameJa: '神威岬', nameEn: 'Cape Kamui', nameRu: 'Мыс Камуи',
    siteCity: 'unassigned-hokkaido', address, prefectureJa: '北海道', cityJa: parseJapaneseAddressDetail(address).municipality, lat: hit.place?.coordinates.lat ?? null, lon: hit.place?.coordinates.lon ?? null }
  return prepareIntakeRequest({ candidate: candidateRow, row: candidateRow, portal: { id: 'visit-hokkaido' }, identified: hit, classification, today: '2026-09-25' })
}

await test('CONFIRMATION_REACHES_THE_WRITE_BOUNDARY', async () => {
  const report = await identify([kamui()])
  assert.equal(report.rows[0].place.prefecture, null)
  assert.equal(report.rows[0].place.administrative.municipality, '積丹町')
  const prepared = prepare(report)
  assert.equal(prepared.ok, true, prepared.message)
  assert.equal(prepared.request.poi.resolved.prefectureEn, 'Hokkaido')
  const bare = await identify([kamui()], { locationBias: undefined })
  assert.equal(prepare(bare).refusal, 'siteCityUnverifiable', 'without confirmation the refusal stays where it was')
})

await test('CONFIRMATION_IS_BOUND_TO_THE_CANDIDATE_ADDRESS', async () => {
  const report = await identify([kamui()])
  const moved = prepare(report, '北海道古宇郡神恵内村')
  assert.equal(moved.ok, false)
  assert.equal(moved.refusal, 'siteCityUnverifiable')
})

await test('REPORT_RETAINS_NO_PROVIDER_ADDRESS_TEXT', async () => {
  const report = await identify([kamui([component('古平町', 'locality')])])
  const stored = JSON.stringify(report)
  assert(!stored.includes('古平町'), 'provider municipality is compared, not stored')
  assert.equal(report.rows[0].outcome, 'notFound')
  assert.match(report.rows[0].detail, /муниципалитет не совпал со значением источника «積丹町»/)
  assert.match(report.rows[0].detail, /какой участок считать точкой записи/)
})

await test('NO_NETWORK', () => assert.equal(network, 0))
globalThis.fetch = originalFetch
console.log(`${checks} checks passed`)
