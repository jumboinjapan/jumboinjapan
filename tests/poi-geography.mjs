#!/usr/bin/env node
/**
 * Географический охват и связи мест — `poi-geography/v1`.
 *
 *   node tests/poi-geography.mjs
 *
 * Сценарии из поручения владельца 14.09.2026:
 *   • Фудзи — один родитель в двух префектурах; станция на склоне — часть горы
 *     и точка посещения; музей — посвящён; удалённая смотровая — вид на;
 *   • Адзума — несколько префектур, самостоятельные дочерние места;
 *   • храмовый комплекс — существующая вложенность сохраняется;
 *   • несвязанное место поблизости попадает в выборку по префектуре, но
 *     ребёнком горы не становится;
 *   • старый POI без новых данных работает как раньше.
 * Плюс регрессии: фильтры без дублей, циклы, повреждённые связи, схема,
 * пропуск родительской страницы в JG-1, отчёт миграции.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { mkdtemp, rm, writeFile, cp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  mergePoiGeographyDocument, assertPoiGeographyDocument, confirmedScopePrefectures, isCalendarDate, POI_GEOGRAPHY_FIELD, POI_GEOGRAPHY_SPEC,
  readPoiGeographyDocument, RELATION_KINDS, RELATION_LABELS, serializePoiGeographyDocument, verifyGeographySchemaTable,
} from '../src/lib/poi-geography-document.ts'
import {
  ALL_POI_GEOGRAPHY, changePoiGeographySelection, GEOGRAPHY_COUNT_NOTE, matchesPoiGeography, poiGeographyFilterOptions,
  poiGeographyMemberships, readPoiGeography,
} from '../src/lib/poi-geography.ts'
import { buildPoiRelations, EMPTY_RELATIONS } from '../src/lib/poi-relations.ts'
import { ensureGeographySchemaForWrite, ingestPoi, ingestPoiBatch } from '../src/lib/poi-ingest.ts'
import { createMemoryPoiStore } from '../src/lib/poi-memory-store.ts'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'
import { expectedTaxonomyFieldSchema } from '../src/lib/poi-taxonomy-airtable.ts'
import { isStrictCalendarDate } from '../scripts/lib/canonical-contract.mjs'
import { assertReviewGeography, reviewGeographyDocument } from '../scripts/poi-portals/lib/geography-review.mjs'
import { collectionLocations, LOCATION_EVIDENCE } from '../scripts/poi-portals/lib/japan-guide-queues.mjs'
import { existingFromExport } from '../scripts/poi-portals/lib/japan-guide-queues.mjs'
import { dataPlan, DATA_OUTCOMES, parseProposals, schemaPlan, verifyApplied, FIELD_REQUEST, runPrepare } from '../scripts/poi-geography/prepare-geography-migration.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${String(text).slice(0, 200)}» нет «${needle}»`)
}
const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e instanceof Error ? e.message : String(e) } }
const aboom = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e instanceof Error ? e.message : String(e) } }

const TODAY = '2026-09-14'
const SRC = (over = {}) => ({ url: 'https://www.fujisan-climb.jp/', checkedOn: TODAY, factId: null, decisionRef: 'owner/task/2026-09-14', ...over })
const territory = (prefectureEn, over = {}) => ({ prefectureEn, municipalityJa: null, status: 'verified', source: SRC(), ...over })
const relation = (kind, poiId, recordId, over = {}) => ({ kind, target: { poiId, recordId }, direction: 'outbound', status: 'verified', source: SRC(), ...over })
function docOf(territories = [], relations = []) {
  return { spec: POI_GEOGRAPHY_SPEC, updatedAt: TODAY, territories, relations }
}

/* ── 1. Контракт документа ──────────────────────────────────────────────── */
{
  const good = docOf([territory('Yamanashi'), territory('Shizuoka', { municipalityJa: '富士宮市' })], [relation('viewOf', 'POI-000001', 'rec00000000000001')])
  t('годный документ принимается', assertPoiGeographyDocument(good, 'POI-000002').spec, POI_GEOGRAPHY_SPEC)
  t('подтверждённые префектуры охвата — без повторов', confirmedScopePrefectures(good).join(','), 'Yamanashi,Shizuoka')
  has('лишний ключ — отказ', boom(() => assertPoiGeographyDocument({ ...good, extra: 1 })), 'ровно ключи')
  has('чужая версия — отказ', boom(() => assertPoiGeographyDocument({ ...good, spec: 'poi-geography/v2' })), 'spec')
  has('дата не календарная — отказ', boom(() => assertPoiGeographyDocument({ ...good, updatedAt: '2026-02-30' })), 'updatedAt')
  has('префектура не каноническая — отказ', boom(() => assertPoiGeographyDocument(docOf([territory('Yamanashi Prefecture')]))), 'prefectureEn')
  has('  русское написание тоже отказ: ключ — английское имя', boom(() => assertPoiGeographyDocument(docOf([territory('Яманаси')]))), 'prefectureEn')
  has('муниципалитет не разбирается — отказ', boom(() => assertPoiGeographyDocument(docOf([territory('Shizuoka', { municipalityJa: 'Fujinomiya' })]))), 'municipalityJa')
  has('голый район без 東京都 — отказ', boom(() => assertPoiGeographyDocument(docOf([territory('Osaka', { municipalityJa: '中央区' })]))), 'municipalityJa')
  t('спецрайон Токио — принимается только при 東京都', assertPoiGeographyDocument(docOf([territory('Tokyo', { municipalityJa: '中央区' })])).territories[0].municipalityJa, '中央区')
  has('территория повторяется — отказ', boom(() => assertPoiGeographyDocument(docOf([territory('Shizuoka'), territory('Shizuoka')]))), 'повторяется')
  has('статус вне списка — отказ', boom(() => assertPoiGeographyDocument(docOf([territory('Shizuoka', { status: 'guessed' })]))), 'status')
  has('источник без https — отказ', boom(() => assertPoiGeographyDocument(docOf([territory('Shizuoka', { source: SRC({ url: 'http://x.jp/' }) })]))), 'url')
  has('источник без факта и решения — отказ', boom(() => assertPoiGeographyDocument(docOf([territory('Shizuoka', { source: SRC({ decisionRef: null }) })]))), 'назовите факт')
  has('вид связи вне списка — отказ', boom(() => assertPoiGeographyDocument(docOf([], [relation('near', 'POI-000001', 'rec00000000000001')]))), 'kind')
  has('направление только outbound', boom(() => assertPoiGeographyDocument(docOf([], [relation('viewOf', 'POI-000001', 'rec00000000000001', { direction: 'inbound' })]))), 'outbound')
  has('ссылка на себя — отказ', boom(() => assertPoiGeographyDocument(docOf([], [relation('viewOf', 'POI-000002', 'rec00000000000002')]), 'POI-000002')), 'на себя')
  has('дубль связи — отказ', boom(() => assertPoiGeographyDocument(docOf([], [relation('viewOf', 'POI-000001', 'rec00000000000001'), relation('viewOf', 'POI-000001', 'rec00000000000001')]))), 'повторяется')
  t('две разные связи с одной целью — законно', assertPoiGeographyDocument(docOf([], [relation('viewOf', 'POI-000001', 'rec00000000000001'), relation('dedicatedTo', 'POI-000001', 'rec00000000000001')])).relations.length, 2)
  has('форма POI ID цели', boom(() => assertPoiGeographyDocument(docOf([], [relation('viewOf', 'POI-1', 'rec00000000000001')]))), 'poiId')
  t('видов связей ровно три', RELATION_KINDS.join(','), 'viewOf,dedicatedTo,visitPointOf')
  t('  у каждого две подписи', RELATION_KINDS.every((k) => RELATION_LABELS[k].outbound && RELATION_LABELS[k].inbound), true)
  t('пустое поле — документа нет, ошибки нет', JSON.stringify(readPoiGeographyDocument({})), JSON.stringify({ document: null, error: null }))
  t('  пробелы — то же', readPoiGeographyDocument({ [POI_GEOGRAPHY_FIELD]: '  ' }).error, null)
  has('битый JSON — ошибка с текстом, не пустота', readPoiGeographyDocument({ [POI_GEOGRAPHY_FIELD]: '{' }).error ?? '', 'JSON')
  t('не строка — ошибка', typeof readPoiGeographyDocument({ [POI_GEOGRAPHY_FIELD]: 5 }).error, 'string')
  const serialized = serializePoiGeographyDocument(good, 'POI-000002')
  t('сериализация детерминирована', serialized, serializePoiGeographyDocument(good, 'POI-000002'))
  t('  и читается обратно', readPoiGeographyDocument({ [POI_GEOGRAPHY_FIELD]: serialized }, 'POI-000002').document.territories.length, 2)
  /* Дифференциальный тест: календарная дата в двух модулях — одно правило. */
  for (const sample of ['2026-09-14', '2026-02-29', '2024-02-29', '2026-13-01', '2026-9-1', '20260914', 'x', '', '2026-04-31', '2000-02-29', '1900-02-29']) {
    t(`календарная дата совпадает с canonical-contract: ${JSON.stringify(sample)}`, isCalendarDate(sample), isStrictCalendarDate(sample))
  }
}

/* Audit regressions: data identity must survive validation and serialization. */
{
  const hidden = territory('Yamanashi')
  Object.defineProperty(hidden, 'toJSON', { value: () => territory('Tokyo') })
  has('GEO-01: hidden serializer rejected before it can change the territory', boom(() => serializePoiGeographyDocument(docOf([hidden]))), 'скрытое')
  let reads = 0
  const accessor = territory('Yamanashi')
  Object.defineProperty(accessor, 'prefectureEn', { enumerable: true, get() { reads++; return 'Tokyo' } })
  has('GEO-01: accessor rejected', boom(() => assertPoiGeographyDocument(docOf([accessor]))), 'accessor')
  t('GEO-01: getter never executed', reads, 0)
  has('GEO-01: sparse arrays rejected', boom(() => assertPoiGeographyDocument(docOf(new Array(1)))), 'пропусками')
  const mutable = docOf([territory('Yamanashi')])
  const snapshot = assertPoiGeographyDocument(mutable)
  mutable.territories[0].prefectureEn = 'Tokyo'
  t('GEO-01: validated snapshot does not retain caller objects', snapshot.territories[0].prefectureEn, 'Yamanashi')
  const old = docOf([territory('Shizuoka')], [relation('viewOf', 'POI-000001', 'rec00000000000001')])
  const added = docOf([territory('Yamanashi')], [relation('dedicatedTo', 'POI-000002', 'rec00000000000002')])
  const merged = mergePoiGeographyDocument(old, added)
  t('GEO-02: adding geography preserves both old territory and relation', `${merged.territories.length}|${merged.relations.length}`, '2|2')
  t('GEO-02: repeat on another day is byte-identical', serializePoiGeographyDocument(mergePoiGeographyDocument(merged, { ...added, updatedAt: '2026-09-15' })), serializePoiGeographyDocument(merged))
  const geography = readPoiGeography({ 'Prefecture (EN)': 'Tokyo', [POI_GEOGRAPHY_FIELD]: serializePoiGeographyDocument(docOf([territory('Shizuoka')])) })
  t('GEO-03: region and prefecture must belong to the same territory', matchesPoiGeography({ geography, siteCity: 'tokyo' }, { region: 'kanto', prefecture: 'Shizuoka', city: 'all' }), false)
  t('GEO-03: city options obey the same region-prefecture pair', poiGeographyFilterOptions([{ geography, siteCity: 'tokyo' }], { region: 'kanto', prefecture: 'Shizuoka', city: 'all' }).cities.length, 0)
  t('GEO-03: real scope territory remains searchable', matchesPoiGeography({ geography, siteCity: 'tokyo' }, { region: 'chubu', prefecture: 'Shizuoka', city: 'all' }), true)
  const nodes = [{ recordId: 'rec00000000000001', poiId: 'POI-000001', nameRu: 'Гора', parentRecordIds: [], document: null },
    { recordId: 'rec00000000000002', poiId: 'POI-000002', nameRu: 'Станция', parentRecordIds: [], document: docOf([], [relation('visitPointOf', 'POI-000001', 'rec00000000000001', { status: 'reported' })]) }]
  const view = buildPoiRelations(nodes).get(nodes[0].recordId)
  t('GEO-04: reported edge is visible for review', view.inbound[0].status, 'reported')
  t('GEO-04: reported edge is not an actionable visit point', view.visitPoints.length, 0)
  nodes[1].document.relations[0].status = 'verified'
  t('GEO-04: verified visit point is offered', buildPoiRelations(nodes).get(nodes[0].recordId).visitPoints.length, 1)
}

/* ── 2. Сцена: Фудзи, Адзума, комплекс, сосед, старый POI ──────────────── */
const R = (n) => `rec${String(n).padStart(14, '0')}`
const P = (n) => `POI-${String(n).padStart(6, '0')}`
const FUJI = 1, STATION = 2, MUSEUM = 3, PAGODA = 4, SAFARI = 5, AZUMA = 6, KOFUJI = 7, KOSANJI = 8, GARDEN = 9, OLD = 10, BROKEN = 11
const fields = (n, nameRu, prefectureEn, siteCity, over = {}) => ({
  'POI ID': P(n), 'POI Name (RU)': nameRu, 'Prefecture (EN)': prefectureEn, 'Prefecture (RU)': ({ Yamanashi: 'Яманаси', Shizuoka: 'Сидзуока', Fukushima: 'Фукусима', Hiroshima: 'Хиросима' })[prefectureEn] ?? '', 'Site City': siteCity, ...over,
})
const G = (territories, relations) => JSON.stringify(docOf(territories, relations))
const records = [
  { recordId: R(FUJI), fields: fields(FUJI, 'Гора Фудзи', 'Yamanashi', 'fuji', { [POI_GEOGRAPHY_FIELD]: G([territory('Yamanashi'), territory('Shizuoka')], []) }) },
  { recordId: R(STATION), fields: fields(STATION, 'Пятая станция', 'Yamanashi', 'fuji', { 'Parent POI': [R(FUJI)], [POI_GEOGRAPHY_FIELD]: G([], [relation('visitPointOf', P(FUJI), R(FUJI))]) }) },
  { recordId: R(MUSEUM), fields: fields(MUSEUM, 'Музей горы Фудзи', 'Yamanashi', 'fuji', { [POI_GEOGRAPHY_FIELD]: G([], [relation('dedicatedTo', P(FUJI), R(FUJI))]) }) },
  { recordId: R(PAGODA), fields: fields(PAGODA, 'Пагода Тюрэйто', 'Yamanashi', 'fuji', { [POI_GEOGRAPHY_FIELD]: G([], [relation('viewOf', P(FUJI), R(FUJI))]) }) },
  { recordId: R(SAFARI), fields: fields(SAFARI, 'Сафари-парк', 'Shizuoka', 'susono') },
  { recordId: R(AZUMA), fields: fields(AZUMA, 'Горы Адзума', 'Fukushima', 'fukushima', { [POI_GEOGRAPHY_FIELD]: G([territory('Fukushima'), territory('Yamagata', { status: 'reported' })], []) }) },
  { recordId: R(KOFUJI), fields: fields(KOFUJI, 'Гора Адзума-Кофудзи', 'Fukushima', 'fukushima', { 'Parent POI': [R(AZUMA)] }) },
  { recordId: R(KOSANJI), fields: fields(KOSANJI, 'Комплекс Косандзи', 'Hiroshima', 'onomichi') },
  { recordId: R(GARDEN), fields: fields(GARDEN, 'Мраморный сад', 'Hiroshima', 'onomichi', { 'Parent POI': [R(KOSANJI)] }) },
  { recordId: R(OLD), fields: fields(OLD, 'Старая запись', 'Shizuoka', 'shizuoka') },
  { recordId: R(BROKEN), fields: fields(BROKEN, 'Сломанный документ', 'Shizuoka', 'shizuoka', { [POI_GEOGRAPHY_FIELD]: '{"spec":"poi-geography/v1"}' }) },
]
const items = records.map((r) => ({ id: r.recordId, poiId: r.fields['POI ID'], nameRu: r.fields['POI Name (RU)'], geography: readPoiGeography(r.fields, r.fields['POI ID']), siteCity: r.fields['Site City'] }))
const by = (n) => items.find((i) => i.poiId === P(n))

/* ── 3. Фильтры ─────────────────────────────────────────────────────────── */
{
  t('у Фудзи точка в Яманаси', by(FUJI).geography.prefectureCode, 'Yamanashi')
  t('  и охват называет Сидзуоку', by(FUJI).geography.scope.map((s) => s.prefectureCode).join(','), 'Yamanashi,Shizuoka')
  const shizuoka = { region: 'chubu', prefecture: 'Shizuoka', city: 'all' }
  const found = items.filter((i) => matchesPoiGeography(i, shizuoka)).map((i) => i.poiId)
  t('фильтр Сидзуока находит Фудзи по охвату', found.includes(P(FUJI)), true)
  t('  и соседний сафари-парк — по точке', found.includes(P(SAFARI)), true)
  t('  и старую запись без документа — по точке', found.includes(P(OLD)), true)
  t('  а станцию в Яманаси — нет', found.includes(P(STATION)), false)
  t('  Фудзи в результате ровно один раз', found.filter((id) => id === P(FUJI)).length, 1)
  const yamanashi = { region: 'chubu', prefecture: 'Yamanashi', city: 'all' }
  t('фильтр Яманаси тоже находит Фудзи', items.filter((i) => matchesPoiGeography(i, yamanashi)).some((i) => i.poiId === P(FUJI)), true)
  const yamagata = { region: 'tohoku', prefecture: 'Yamagata', city: 'all' }
  t('reported-территория в фильтр не попадает: Адзума по Ямагате не находится', items.some((i) => matchesPoiGeography(i, yamagata)), false)
  t('  но в карточке она видна', by(AZUMA).geography.scope.length, 1)
  t('сломанный документ: префектура точки читается', by(BROKEN).geography.prefectureCode, 'Shizuoka')
  has('  и ошибка названа', by(BROKEN).geography.scopeError ?? '', 'ровно ключи')
  t('  старая запись без документа — без ошибки', by(OLD).geography.scopeError, null)
  const options = poiGeographyFilterOptions(items, ALL_POI_GEOGRAPHY)
  const count = (list, value) => Number(list.find((o) => o.value === value)?.label.split('·').at(-1).trim())
  t('регион Тюбу считает Фудзи один раз', count(options.regions, 'chubu'), items.filter((i) => poiGeographyMemberships(i.geography).regions.includes('chubu')).length)
  t('  Тохоку — Адзума и Кофудзи', count(options.regions, 'tohoku'), 2)
  t('Сидзуока считает Фудзи, сафари, старую и сломанную', count(options.prefectures, 'Shizuoka'), 4)
  t('  Яманаси — четыре по точке', count(options.prefectures, 'Yamanashi'), 4)
  const sum = options.prefectures.reduce((n, o) => n + count(options.prefectures, o.value), 0)
  t('сумма по префектурам больше числа записей — и это объявлено', sum > items.length && GEOGRAPHY_COUNT_NOTE.includes('превышать'), true)
  const chubuOnly = poiGeographyFilterOptions(items, { region: 'chubu', prefecture: 'all', city: 'all' })
  t('под Тюбу нет префектур Тохоку', chubuOnly.prefectures.some((o) => o.value === 'Fukushima'), false)
  const noPoint = readPoiGeography({ [POI_GEOGRAPHY_FIELD]: G([territory('Shizuoka')], []) }, 'POI-000099')
  t('без префектуры точки — состояние missing, охват не подменяет точку', noPoint.state, 'missing')
  t('  но по Сидзуоке запись находится', matchesPoiGeography({ geography: noPoint, siteCity: '' }, shizuoka), true)
  t('  и в «регион не определён» — тоже', matchesPoiGeography({ geography: noPoint, siteCity: '' }, { region: 'unknown', prefecture: 'all', city: 'all' }), true)
  const next = changePoiGeographySelection(items, { region: 'chubu', prefecture: 'Shizuoka', city: 'all' }, 'region', 'tohoku')
  t('смена региона сбрасывает несовместимую префектуру', next.prefecture, 'all')
}

/* ── 4. Граф связей ─────────────────────────────────────────────────────── */
{
  const nodes = records.map((r) => ({ recordId: r.recordId, poiId: r.fields['POI ID'], nameRu: r.fields['POI Name (RU)'], parentRecordIds: r.fields['Parent POI'] ?? [], document: readPoiGeographyDocument(r.fields, r.fields['POI ID']).document }))
  const views = buildPoiRelations(nodes)
  const fuji = views.get(R(FUJI))
  t('состав Фудзи — станция', fuji.children.map((c) => c.poiId).join(','), P(STATION))
  t('точки посещения Фудзи — станция', fuji.visitPoints.map((c) => c.poiId).join(','), P(STATION))
  t('входящие: смотровая, посвящённый, точка посещения', fuji.inbound.map((e) => `${e.kind}:${e.source.poiId}`).join(','), `viewOf:${P(PAGODA)},dedicatedTo:${P(MUSEUM)},visitPointOf:${P(STATION)}`)
  t('  подписи со стороны цели', fuji.inbound.map((e) => e.label).join('|'), 'Смотровые точки|Посвящённые места|Точки посещения')
  t('сафари-парк ребёнком горы не стал', fuji.children.some((c) => c.poiId === P(SAFARI)), false)
  t('  и связью тоже', fuji.inbound.some((e) => e.source.poiId === P(SAFARI)), false)
  const station = views.get(R(STATION))
  t('станция: родитель — гора', station.parent?.poiId, P(FUJI))
  t('  и одновременно точка посещения горы', station.outbound.map((e) => `${e.kind}:${e.target?.poiId}:${e.state}`).join(','), `visitPointOf:${P(FUJI)}:ok`)
  t('музей: посвящён, состояние ok', views.get(R(MUSEUM)).outbound[0].state, 'ok')
  t('пагода: вид на гору', views.get(R(PAGODA)).outbound[0].label, 'Вид на')
  t('комплекс Косандзи: вложенность сохранена', views.get(R(KOSANJI)).children.map((c) => c.poiId).join(','), P(GARDEN))
  t('  сад знает родителя', views.get(R(GARDEN)).parent?.poiId, P(KOSANJI))
  t('Адзума: самостоятельный ребёнок в составе', views.get(R(AZUMA)).children.map((c) => c.poiId).join(','), P(KOFUJI))
  t('старая запись — пустые связи, без ошибок', JSON.stringify(views.get(R(OLD))), JSON.stringify(EMPTY_RELATIONS))
  /* Повреждённые связи называются состоянием, а не исчезают. */
  const damaged = buildPoiRelations([
    { recordId: R(20), poiId: P(20), nameRu: 'A', parentRecordIds: [R(99)], document: docOf([], [relation('viewOf', P(21), R(21)), relation('dedicatedTo', P(77), R(22))]) },
    { recordId: R(22), poiId: P(22), nameRu: 'B', parentRecordIds: [R(20), R(22)], document: null },
  ])
  t('висячий родитель назван', damaged.get(R(20)).parentState, 'dangling')
  t('связь на отсутствующую запись — dangling', damaged.get(R(20)).outbound[0].state, 'dangling')
  t('разошедшиеся идентификаторы — drift', damaged.get(R(20)).outbound[1].state, 'drift')
  t('  цель у повреждённой связи не подставляется', damaged.get(R(20)).outbound[1].target, null)
  t('  и обратная сторона не выводится', damaged.get(R(22)).inbound.length, 0)
  t('несколько родителей — multiple', damaged.get(R(22)).parentState, 'multiple')
}

/* ── 5. Writer: ingestPoi с документом ──────────────────────────────────── */
{
  const seed = [{ poiId: P(FUJI), recordId: R(FUJI), nameRu: 'Гора Фудзи', nameEn: 'Mount Fuji', siteCity: 'fuji', lat: 35.3606, lon: 138.7274, placeId: 'ChIJ-fuji', sourceKey: 'japan-guide:e2172' }]
  const created = []
  const store = createMemoryPoiStore(seed, { observe: (e) => { if (e.kind === 'create') created.push(e.fields) } })
  const request = (over = {}) => ({
    source: { kind: 'external-agent', id: 'japan-guide', externalKey: 'e6922', url: 'https://www.japan-guide.com/e/e6922.html' },
    poi: {
      nameRu: 'Пятая станция линии Фудзи-Субару', nameEn: 'Fuji Subaru Line 5th Station', siteCity: 'fuji', lat: 35.3966, lon: 138.7335,
      parentNameRu: 'Гора Фудзи', parentNameEn: 'Mount Fuji',
      resolved: { placeId: 'ChIJ-station', lat: 35.3966, lon: 138.7335, prefectureEn: 'Yamanashi', prefectureRu: 'Яманаси', coordsCheckedAt: TODAY },
      geography: docOf([territory('Yamanashi')], [relation('visitPointOf', P(FUJI), R(FUJI))]),
      ...over,
    },
  })
  const outcome = await ingestPoi(request(), store)
  t('запись создана', outcome.outcome, 'created')
  t('  документ охвата ушёл полем', typeof created[0]?.[POI_GEOGRAPHY_FIELD], 'string')
  t('  и читается обратно тем же валидатором', readPoiGeographyDocument(created[0], 'POI-000002').document.relations[0].kind, 'visitPointOf')
  t('  родитель проставлен по имени', JSON.stringify(created[0]['Parent POI']), JSON.stringify([R(FUJI)]))
  has('цель связи не в базе — отказ до записи', await aboom(() => ingestPoi(request({ geography: docOf([], [relation('viewOf', P(50), R(50))]) }), createMemoryPoiStore(seed))), 'geographyRelationTargetMissing')
  has('идентификаторы цели разошлись — отказ', await aboom(() => ingestPoi(request({ geography: docOf([], [relation('viewOf', P(77), R(FUJI))]) }), createMemoryPoiStore(seed))), 'geographyRelationTargetDrift')
  has('битый документ — отказ до хранилища', await aboom(() => ingestPoi(request({ geography: { spec: 'x' } }), createMemoryPoiStore(seed))), POI_GEOGRAPHY_SPEC)
  t('без документа — поля нет', POI_GEOGRAPHY_FIELD in (await ingestPoi(request({ geography: undefined }), createMemoryPoiStore(seed), { dryRun: true })).fields, false)
  /* Живая схема: поле обязано существовать. */
  const memory = await ensureGeographySchemaForWrite(createMemoryPoiStore([]), true)
  t('память — ветка без схемы, по тождеству', memory?.memory ?? 'проверки не было', true)
  t('без документа проверка не нужна', await ensureGeographySchemaForWrite({}, false), null)
  has('эффектное хранилище без схемы — отказ', await aboom(() => ensureGeographySchemaForWrite({ listExisting: async () => [] }, true)), POI_GEOGRAPHY_FIELD)
  const tables = (extra) => [{ id: POI_TABLE_ID, name: 'POI', fields: [...expectedTaxonomyFieldSchema(), ...extra] }]
  has('схема без поля — отказ по имени', await aboom(() => ensureGeographySchemaForWrite({ readSchemaTables: async () => tables([]) }, true)), POI_GEOGRAPHY_FIELD)
  has('поле чужого типа — отказ', boom(() => verifyGeographySchemaTable({ fields: [{ name: POI_GEOGRAPHY_FIELD, type: 'singleLineText' }] })), 'singleLineText')
  t('поле на месте — проверено', (await ensureGeographySchemaForWrite({ readSchemaTables: async () => tables([{ name: POI_GEOGRAPHY_FIELD, type: 'multilineText' }]) }, true))?.checked ?? 'проверки не было', true)
  /* Пакет: два создания подряд, второе ссылается на первое через store. */
  const batchStore = createMemoryPoiStore(seed)
  const results = await ingestPoiBatch([request(), request({ nameRu: 'Музей горы Фудзи', nameEn: 'Fujisan Museum', lat: 35.48, lon: 138.79, resolved: { placeId: 'ChIJ-museum', lat: 35.48, lon: 138.79, prefectureEn: 'Yamanashi', prefectureRu: 'Яманаси', coordsCheckedAt: TODAY }, geography: docOf([], [relation('dedicatedTo', P(FUJI), R(FUJI))]) })].map((r, i) => ({ ...r, source: { ...r.source, externalKey: `e${i}` } })), batchStore)
  t('пакет создал обе записи с документами', results.every((r) => r.outcome === 'created' && typeof r.fields[POI_GEOGRAPHY_FIELD] === 'string'), true)
  let batchCreates = 0
  const guarded = createMemoryPoiStore(seed, { observe: (event) => { if (event.kind === 'create') batchCreates++ } })
  await aboom(() => ingestPoiBatch([request(), request({ geography: { ...docOf(), spec: 'bad' } })], guarded))
  t('GEO-08: invalid later document prevents every batch create', batchCreates, 0)

}

/* ── 6. Реестр review: охват и связи с доказательствами ─────────────────── */
{
  const row = (over = {}) => ({
    sourceKey: 'japan-guide:e6922', existingPoiId: 'POI-000239', decisionRef: 'owner/task/2026-09-14',
    facts: [
      { text: 'Гора Фудзи: пятая станция — начало тропы Ёсида на склоне.', sourceUrl: 'https://www.fujisan-climb.jp/trails/yoshida.html', checkedOn: TODAY },
      { text: 'Страница Japan Guide о станции.', sourceUrl: 'https://www.japan-guide.com/e/e6922.html', checkedOn: TODAY },
    ],
    geographicScope: [{ factIndex: 0, sourceRole: 'official', prefectureEn: 'Yamanashi', municipalityJa: '富士吉田市', status: 'verified', sourceUrl: 'https://www.fujisan-climb.jp/trails/yoshida.html' }],
    relations: [{ factIndex: 0, kind: 'visitPointOf', targetKey: 'japan-guide:e2172', status: 'verified', sourceUrl: 'https://www.fujisan-climb.jp/trails/yoshida.html' }],
    ...over,
  })
  t('строка с охватом и связями принимается', assertReviewGeography(row()).relations.length, 1)
  t('строка без них — пусто, не ошибка', JSON.stringify(assertReviewGeography({ sourceKey: 'x', facts: [] })), JSON.stringify({ scope: null, relations: null }))
  has('территория по Japan Guide — отказ: нужен официальный источник', boom(() => assertReviewGeography(row({ geographicScope: [{ factIndex: 1, sourceRole: 'official', prefectureEn: 'Yamanashi', municipalityJa: null, status: 'verified', sourceUrl: 'https://www.japan-guide.com/e/e6922.html' }] }))), 'official')
  has('источник не из фактов строки — отказ', boom(() => assertReviewGeography(row({ relations: [{ factIndex: 0, kind: 'viewOf', targetKey: 'POI-000001', status: 'verified', sourceUrl: 'https://elsewhere.jp/' }] }))), 'source recorded')
  has('связь на себя — отказ', boom(() => assertReviewGeography(row({ relations: [{ factIndex: 0, kind: 'viewOf', targetKey: 'POI-000239', status: 'verified', sourceUrl: 'https://www.fujisan-climb.jp/trails/yoshida.html' }] }))), 'Self')
  has('лишний ключ территории — отказ', boom(() => assertReviewGeography(row({ geographicScope: [{ factIndex: 0, sourceRole: 'official', prefectureEn: 'Yamanashi', municipalityJa: null, status: 'verified', sourceUrl: 'https://www.fujisan-climb.jp/trails/yoshida.html', note: 'x' }] }))), 'лишние поля')
  const later = row()
  later.facts.unshift({ text: 'Другая заметка с той же страницы.', sourceUrl: later.facts[0].sourceUrl, checkedOn: TODAY })
  later.geographicScope[0].factIndex = 1
  later.relations[0].factIndex = 1
  t('GEO-05: later fact on the same page is used', reviewGeographyDocument(later, { resolveTarget: () => ({ poiId: P(FUJI), recordId: R(FUJI), nameRu: 'Гора Фудзи' }), today: TODAY }).document.relations.length, 1)
  const undeclared = row(); delete undeclared.geographicScope[0].sourceRole
  has('GEO-05: arbitrary HTTPS is not an official-source declaration', boom(() => assertReviewGeography(undeclared)), 'нет обязательных полей')
  const apex = row(); apex.facts[0].sourceUrl = 'https://japan-guide.com/e/e6922.html'; apex.geographicScope[0].sourceUrl = apex.facts[0].sourceUrl
  has('GEO-05: apex portal is not an official administrative source', boom(() => assertReviewGeography(apex)), 'official')
  const resolveTarget = (key) => (key === 'japan-guide:e2172' ? { poiId: P(FUJI), recordId: R(FUJI), nameRu: 'Гора Фудзи' } : null)
  const built = reviewGeographyDocument(row(), { resolveTarget, today: TODAY })
  t('документ собран: территория с муниципалитетом', built.document.territories[0].municipalityJa, '富士吉田市')
  t('  связь получила POI ID и record id цели', `${built.document.relations[0].target.poiId}/${built.document.relations[0].target.recordId}`, `${P(FUJI)}/${R(FUJI)}`)
  t('  источник несёт дату факта и решение', `${built.document.relations[0].source.checkedOn}|${built.document.relations[0].source.decisionRef}`, `${TODAY}|owner/task/2026-09-14`)
  t('неразрешённая цель названа, документ без неё', reviewGeographyDocument(row(), { resolveTarget: () => null, today: TODAY }).unresolved.join(','), 'japan-guide:e2172')
  has('факт не называет цель — отказ', boom(() => reviewGeographyDocument(row(), { resolveTarget: () => ({ poiId: P(FUJI), recordId: R(FUJI), nameRu: 'Гора Асо' }), today: TODAY })), 'does not name')
}

/* ── 7. JG-1: страница-коллекция во главе ранжирования не теряется ──────── */
{
  const snapshot = JSON.parse(gunzipSync(readFileSync('docs/poi-intake/baselines/japan-guide-jg1-2026-09-06.snapshot.json.gz')).toString('utf8'))
  const exportDoc = JSON.parse(readFileSync('docs/poi-intake/baselines/airtable-poi-jg1-fixture-2026-09-06.json', 'utf8'))
  const locations = collectionLocations(snapshot, existingFromExport(exportDoc))
  const fuji = locations.rows.find((r) => r.sourceKey === 'japan-guide:e2172')
  t('e2172 «Mount Fuji» найдена как коллекция во главе ранжирования', Boolean(fuji), true)
  t('  семь ранжированных страниц по порядку', fuji?.rankedSourceKeys.length, 7)
  t('  первая — восхождение', fuji?.rankedSourceKeys[0], 'japan-guide:e6901')
  t('  адрес страницы известен', fuji?.url, 'https://www.japan-guide.com/e/e2172.html')
  t('  записи в базе нет — сказано', fuji?.existingPoiId, null)
  t('  доказательство названо: ранжирование, не принадлежность', fuji?.evidence, LOCATION_EVIDENCE)
  has('  и это не решение о родителе', fuji?.note ?? '', 'XVII')
  t('счётчик без записи сходится с строками', locations.withoutRecord, locations.rows.filter((r) => r.existingPoiId === null).length)
  t('ключи коллекций не повторяются', new Set(locations.rows.map((r) => r.sourceKey)).size, locations.rows.length)
  t('раздел не входит в очереди: коллекций нет среди записей снимка', snapshot.records.some((r) => r.sourceKey === 'japan-guide:e2172'), false)
}

/* ── 8. Целостность базы ────────────────────────────────────────────────── */
{
  const run = (fixture) => {
    try { return JSON.parse(execFileSync('node', ['scripts/check-poi-integrity.mjs', '--fixture', fixture, '--json'], { encoding: 'utf8', env: { ...process.env, AIRTABLE_TOKEN: '', AIRTABLE_BASE_ID: '' } })) }
    catch (error) {
      /* Ненулевой выход с отчётом — норма (фикстура содержит поломки); падение
         без JSON — дефект самого сторожа, и он называется, а не роняет тест. */
      try { return JSON.parse(error.stdout) } catch { return { findings: [], crashed: String(error.stderr ?? error.message).slice(0, 200) } }
    }
  }
  const report = run('tests/fixtures/poi-integrity-geography')
  t('сторож целостности отработал на фикстуре охвата', report.crashed, undefined)
  const codes = Object.fromEntries(report.findings.map((f) => [f.code, f]))
  has('повреждённый документ — поломка', (codes.geography_damaged?.items ?? []).join(' '), 'POI-000205')
  has('  ссылка на себя ловится валидатором', (codes.geography_damaged?.items ?? []).join(' '), 'POI-000206')
  has('связь на отсутствующую запись — поломка', (codes.relation_dangling?.items ?? []).join(' '), 'POI-000203')
  has('разошедшиеся идентификаторы — поломка', (codes.relation_drift?.items ?? []).join(' '), 'POI-000204')
  t('станция с годным документом замечаний не даёт', report.findings.some((f) => (f.items ?? []).some((i) => i.startsWith('POI-000202'))), false)
  const old = run('tests/fixtures/poi-integrity')
  t('дамп без поля охвата — проверка пропущена вслух', old.findings.some((f) => f.code === 'geography_field_absent'), true)
}

/* ── 9. Подготовка миграции ─────────────────────────────────────────────── */
{
  const schemaBefore = { tables: [{ id: POI_TABLE_ID, name: 'POI', fields: expectedTaxonomyFieldSchema() }] }
  t('на фикстуре схемы поля нет', schemaPlan(schemaBefore.tables).state, 'missing')
  t('  запрос создания — ровно один, тот, что объявлен', JSON.stringify(schemaPlan(schemaBefore.tables).request), JSON.stringify(FIELD_REQUEST))
  const withField = schemaBefore.tables.map((tb) => (tb.id === POI_TABLE_ID ? { ...tb, fields: [...tb.fields, { id: 'fldGEO', name: POI_GEOGRAPHY_FIELD, type: 'multilineText' }] } : tb))
  t('поле есть — запроса нет, дубля не будет', schemaPlan(withField).request, null)
  t('поле чужого типа — конфликт, не запрос', schemaPlan(withField.map((tb) => (tb.id === POI_TABLE_ID ? { ...tb, fields: tb.fields.map((f) => (f.name === POI_GEOGRAPHY_FIELD ? { ...f, type: 'singleLineText' } : f)) } : tb))).state, 'conflict')
  const proposals = parseProposals(JSON.parse(readFileSync('tests/fixtures/poi-geography-proposals.json', 'utf8')))
  const base = { rows: [
    ...records,
    { recordId: 'recFUJISTATION0000', fields: fields(239, 'Пятая станция линии Фудзи-Субару', 'Yamanashi', 'fuji') },
    { recordId: 'recFUJIMUSEUM00000', fields: fields(241, 'Музей горы Фудзи', 'Yamanashi', 'fuji') },
    { recordId: 'recFUJIPAGODA00000', fields: fields(162, 'Пагода Тюрэйто', 'Yamanashi', 'fuji') },
    { recordId: 'recFUJISENGEN00000', fields: fields(867, 'Святилище Фудзисан Хонгу Сэнгэн Тайся', 'Shizuoka', 'fujinomiya') },
    { recordId: 'recAZUMA0000000000', fields: fields(977, 'Горы Адзума', 'Fukushima', 'fukushima') },
  ] }
  const fetched = { ...proposals, rows: proposals.rows.map((r) => ({ ...r, sourcesFetched: true })) }
  const plan = dataPlan({ proposals: fetched, base, today: TODAY, schemaState: 'missing' })
  t('сумма исходов равна числу предложений', DATA_OUTCOMES.reduce((n, o) => n + plan.counts[o], 0), fetched.rows.length)
  t('GEO-09: missing parent requests agent preparation, not automatic owner approval', plan.rows.find((r) => r.sourceKey === 'japan-guide:e2172').outcome, 'technicalRefusal')
  const station = plan.rows.find((r) => r.existingPoiId === 'POI-000239')
  t('неполная связь не выдаёт нагрузку записи', `${station.outcome}|${station.dependsOn.join(',')}`, 'technicalRefusal|japan-guide:e2172')
  t('GEO-06: unresolved target has no writable payload', station.new, undefined)
  t('GEO-06: incomplete proposal cannot be certified as applied', verifyApplied({ data: { rows: [station] } }, base).length, 0)
  t('  и заблокирована отсутствием поля в схеме', station.blockedBySchema, true)
  const azuma = plan.rows.find((r) => r.existingPoiId === 'POI-000977')
  t('Адзума — create с двумя территориями', azuma.outcome === 'create' && JSON.parse(azuma.new[POI_GEOGRAPHY_FIELD]).territories.length === 2, true)
  /* Повтор без дублей: снимок с уже записанным документом даёт alreadyMatches. */
  const applied = { rows: [{ recordId: 'recAZUMA0000000000', fields: { ...fields(977, 'Горы Адзума', 'Fukushima', 'fukushima'), [POI_GEOGRAPHY_FIELD]: azuma.new[POI_GEOGRAPHY_FIELD] } }] }
  const again = dataPlan({ proposals: { ...fetched, rows: fetched.rows.filter((r) => r.existingPoiId === 'POI-000977') }, base: applied, today: '2026-09-20', schemaState: 'present' })
  t('повтор на записанном документе — alreadyMatches, не второй PATCH', again.rows[0].outcome, 'alreadyMatches')
  const unfetched = dataPlan({ proposals, base, today: TODAY, schemaState: 'missing' })
  t('непрочитанные источники — insufficientEvidence у всех существующих', unfetched.rows.filter((r) => r.existingPoiId).every((r) => r.outcome === 'insufficientEvidence'), true)
  const verification = verifyApplied({ data: plan }, applied)
  t('проверка частичного исполнения: Адзума применена', verification.find((v) => v.recordId === 'recAZUMA0000000000').state, 'applied')
  t('  остальные строки — missing в свежем снимке', verification.filter((v) => v.state === 'missing').length, plan.rows.filter((r) => r.outcome === 'create').length - 1)
  has('неизвестная цель связи — технический отказ', dataPlan({ proposals: { ...fetched, rows: [{ ...fetched.rows[2], relations: [{ ...fetched.rows[2].relations[0], targetKey: 'POI-000555' }] }] }, base, today: TODAY, schemaState: 'present' }).rows[0].reason, 'POI-000555')
  has('  запись не из снимка — технический отказ', dataPlan({ proposals: { ...fetched, rows: [{ ...fetched.rows[2], existingPoiId: 'POI-000998' }] }, base, today: TODAY, schemaState: 'present' }).rows[0].reason, 'нет в снимке')
  has('предложения без sourcesFetched — отказ формы', boom(() => parseProposals({ spec: 'poi-geography-proposals/v1', note: '', rows: [{ sourceKey: 'a:b', existingPoiId: null, decisionRef: 'x', parentKey: null, facts: [] }] })), 'sourcesFetched')
  /* CLI: только чтение, новый каталог, ноль сети. */
  const dir = await mkdtemp(path.join(tmpdir(), 'geo-migration-'))
  await writeFile(path.join(dir, 'schema.json'), JSON.stringify(schemaBefore))
  await writeFile(path.join(dir, 'base.json'), JSON.stringify(base))
  let network = 0
  globalThis.fetch = () => { network++; throw new Error('сеть запрещена') }
  const log = console.log; console.log = () => {}
  const cli = await runPrepare(['node', 'x', '--schema', path.join(dir, 'schema.json'), '--base', path.join(dir, 'base.json'), '--proposals', 'tests/fixtures/poi-geography-proposals.json', '--out', path.join(dir, 'r1'), '--today', TODAY])
  console.log = log
  t('CLI отработал без сети', `${cli.exitCode}|${network}`, '0|0')
  t('  отчёт называет нулевые эффекты', JSON.stringify(cli.report.effects), JSON.stringify({ network: 0, post: 0, patch: 0, delete: 0 }))
  has('  повтор в тот же каталог — отказ', await aboom(() => runPrepare(['node', 'x', '--schema', path.join(dir, 'schema.json'), '--base', path.join(dir, 'base.json'), '--proposals', 'tests/fixtures/poi-geography-proposals.json', '--out', path.join(dir, 'r1'), '--today', TODAY])), 'EEXIST')
  await rm(dir, { recursive: true, force: true })
}

/* Full registry -> parse packet -> public writer proposal on an isolated tree. */
{
  const dir = await mkdtemp(path.join(tmpdir(), 'geo-reviewed-'))
  try {
    for (const name of ['src', 'scripts', 'config']) await cp(name, path.join(dir, name), { recursive: true })
    await cp('package.json', path.join(dir, 'package.json'))
    await symlink(path.resolve('node_modules'), path.join(dir, 'node_modules'))
    const ledger = JSON.parse(readFileSync('config/poi-japan-guide-review.v1.json', 'utf8'))
    const item = ledger.rows.find((r) => r.existingPoiId && r.existingPoiId !== 'POI-900002')
    const targetItem = ledger.rows.find((r) => r !== item && r.existingPoiId && r.existingPoiId !== item.existingPoiId)
    item.parentKey = null
    item.facts = [{ text: `${targetItem.subject.nameRu}: точка посещения на склоне в Яманаси.`, sourceUrl: 'https://www.fujisan-climb.jp/', checkedOn: TODAY }]
    item.geographicScope = [{ prefectureEn: 'Yamanashi', municipalityJa: null, status: 'verified', sourceUrl: item.facts[0].sourceUrl, factIndex: 0, sourceRole: 'official' }]
    item.relations = [{ kind: 'visitPointOf', targetKey: targetItem.sourceKey, status: 'verified', sourceUrl: item.facts[0].sourceUrl, factIndex: 0 }]
    await writeFile(path.join(dir, 'config/poi-japan-guide-review.v1.json'), JSON.stringify(ledger))
    const { parseReviewLinks, reviewLinkProposal, REVIEW_LINK_SPEC } = await import(path.join(dir, 'scripts/poi-portals/lib/japan-guide-review.mjs'))
    const row = { sourceKey: item.sourceKey, recordId: 'rec90000000000001', parentRecordId: null, relationTargets: [{ targetKey: targetItem.sourceKey, recordId: 'rec90000000000002' }] }
    const packet = parseReviewLinks({ spec: REVIEW_LINK_SPEC, rows: [row] })
    t('GEO-07: real registry accepts the linked packet', packet.rows.length, 1)
    const old = docOf([territory('Shizuoka')], [relation('viewOf', 'POI-900003', 'rec90000000000003')])
    const found = { recordId: row.recordId, fields: { 'POI ID': item.existingPoiId, 'POI Name (RU)': item.subject.nameRu, 'POI Name (EN)': item.subject.nameEn, 'Site City': item.subject.siteCity, [POI_GEOGRAPHY_FIELD]: serializePoiGeographyDocument(old) } }
    const target = { poiId: targetItem.existingPoiId, recordId: 'rec90000000000002', nameRu: targetItem.subject.nameRu }
    const targets = new Map([[targetItem.sourceKey, target]])
    const proposed = reviewLinkProposal(row, found, null, { targets, today: TODAY })
    const stored = JSON.parse(proposed.proposed[POI_GEOGRAPHY_FIELD])
    t('GEO-07: real proposal preserves existing territory and edge', `${stored.territories.length}|${stored.relations.length}`, '2|2')
    const repeated = reviewLinkProposal(row, { ...found, fields: { ...found.fields, ...proposed.proposed } }, null, { targets, today: '2026-09-15' })
    t('GEO-07: real proposal rerun does not rewrite the document', Object.keys(repeated.proposed).length, 0)
    target.poiId = 'POI-900009'
    has('GEO-07: same name cannot substitute target identity', boom(() => reviewLinkProposal(row, found, null, { targets, today: TODAY })), 'identity drift')
    target.poiId = targetItem.existingPoiId; target.recordId = 'rec90000000000009'
    has('GEO-07: correct POI ID cannot substitute the packet record', boom(() => reviewLinkProposal(row, found, null, { targets, today: TODAY })), 'record drift')
  } finally { await rm(dir, { recursive: true, force: true }) }
}

/* ── 10. Карточка: четыре раздела рендерятся сервером ───────────────────── */
{
  const ts = (await import('typescript')).default
  const vm = await import('node:vm')
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const source = readFileSync(new URL('../src/components/admin/PoiGeographyPanel.tsx', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  vm.runInNewContext(output, { exports, require: (id) => { if (id === 'react/jsx-runtime') return require('react/jsx-runtime'); throw new Error(`Unexpected import: ${id}`) } }, { filename: 'PoiGeographyPanel.tsx' })
  const { renderToStaticMarkup } = require('react-dom/server')
  const { createElement } = require('react')
  const nodes = records.map((r) => ({ recordId: r.recordId, poiId: r.fields['POI ID'], nameRu: r.fields['POI Name (RU)'], parentRecordIds: r.fields['Parent POI'] ?? [], document: readPoiGeographyDocument(r.fields, r.fields['POI ID']).document }))
  const views = buildPoiRelations(nodes)
  const html = renderToStaticMarkup(createElement(exports.PoiGeographyPanel, {
    pointPrefecture: 'Яманаси', scope: by(FUJI).geography.scope, scopeError: null,
    territories: [{ prefectureLabel: 'Яманаси', municipalityJa: null, status: 'verified' }, { prefectureLabel: 'Сидзуока', municipalityJa: '富士宮市', status: 'reported' }],
    relations: views.get(R(FUJI)), onOpen: () => {},
  }))
  for (const heading of ['Географический охват', 'Родитель и состав', 'Связанные места', 'Точки посещения']) has(`карточка Фудзи: раздел «${heading}»`, html, heading)
  has('  территория с муниципалитетом и состоянием', html, 'Сидзуока · 富士宮市')
  has('  состояние reported подписано', html, 'по источнику, не подтверждено')
  has('  состав — станция', html, 'Пятая станция')
  has('  входящие связи подписаны со стороны цели', html, 'Смотровые точки')
  t('  соседний сафари-парк на карточке горы отсутствует', html.includes('Сафари-парк'), false)
  const stationHtml = renderToStaticMarkup(createElement(exports.PoiGeographyPanel, {
    pointPrefecture: 'Яманаси', scope: [], scopeError: null, territories: [], relations: views.get(R(STATION)), onOpen: () => {},
  }))
  has('карточка станции: входит в состав горы', stationHtml, 'Входит в состав')
  has('  и одновременно точка посещения', stationHtml, 'Точка посещения: ')
  const brokenHtml = renderToStaticMarkup(createElement(exports.PoiGeographyPanel, {
    pointPrefecture: 'Сидзуока', scope: [], scopeError: 'ожидаются ровно ключи', territories: [], relations: EMPTY_RELATIONS, onOpen: () => {},
  }))
  has('повреждённый документ назван на карточке', brokenHtml, 'Документ охвата повреждён')
  has('  старая карточка без охвата — объяснение, не ошибка', renderToStaticMarkup(createElement(exports.PoiGeographyPanel, { pointPrefecture: 'Сидзуока', scope: [], scopeError: null, territories: [], relations: EMPTY_RELATIONS, onOpen: () => {} })), 'находится по префектуре точки')
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ охват и связи POI (poi-geography/v1): ${ok} проверок пройдено`)
}
