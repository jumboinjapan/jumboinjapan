/**
 * Контракты discovery: алфавит значений, грамматика маркера, формы записей,
 * пять отпечатков и снимок обхода.
 *
 * Сети здесь нет ни одной строки: проверяются чистые функции.
 *
 * Отдельный блок — ПОДДЕЛКИ. Проверка, которая доверяет построению, проверяет
 * только то, что построение было; между `build*` и `assert*` лежит файл на
 * диске, который мог править кто угодно. Поэтому подделки собираются ровно
 * так, как их собрал бы посторонний: поле меняется, отпечаток пересчитывается
 * тем же алгоритмом и с тем же доменом.
 */
import { canonicalJsonBytes } from '../scripts/lib/canonical-contract.mjs'
import { sha256Bytes } from '../scripts/lib/byte-digest.mjs'
import {
  BYTE_LIMITS,
  CARD_REJECTION_CODES,
  DISCOVERY_RECORD_SPEC,
  FACT_LEAD_SPEC,
  INCOMPLETE_REASONS,
  LEAD_CONFIDENCE,
  LEAD_KINDS,
  LEAD_SOURCE_LOCATORS,
  OMISSION_CODES,
  OMISSION_LOCATORS,
  CATALOGUE_SOURCE_KEY,
  PAGE_REJECTION_CODES,
  RESERVED_LEAD_KINDS,
  SNAPSHOT_SPEC,
  assertDiscoveryRecord,
  assertDiscoverySnapshot,
  assertFactLead,
  assertOrderRecord,
  assertPageEvidence,
  buildAppliesTo,
  buildDiscoveryRecord,
  buildDiscoverySnapshot,
  buildFactLead,
  buildOmission,
  buildOrderRecord,
  buildPageEvidence,
  buildPlacement,
  compareUtf8,
  discoveredFrom,
  movedCount,
  orderDigest,
  matrixFamily,
  sortFactLeads,
} from '../scripts/poi-portals/lib/discovery-contract.mjs'
import {
  CATALOGUE_ENTRY_URL,
  ROBOTS_URL,
  canonicalDiscoveryUrl,
  discoverySourceKey,
} from '../scripts/poi-portals/lib/html-fetch.mjs'
import {
  MAX_RECOMMENDATION_LEVEL,
  assertAllowedCodepoints,
  guardValue,
  isAllowedCodepoint,
  normaliseValue,
  recommendationLevel,
  utf8Bytes,
} from '../scripts/poi-portals/lib/japan-guide-text-guard.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (Object.is(actual, expected)) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const eq = (label, a, b) => t(label, JSON.stringify(a), JSON.stringify(b))
/**
 * `expect` — код отказа ЛИБО фрагмент сообщения валидатора. Второе нужно
 * там, где код один на весь контракт (`TypeError`), а проверок под ним
 * десятки: без фрагмента тест принял бы отказ любой соседней проверки.
 */
const throwsWith = (label, fn, expect) => {
  try {
    fn()
    bad.push(`${label}: ждали отказ ${expect ?? ''}, вызов прошёл`)
  } catch (error) {
    if (error.forgeFailed) {
      bad.push(`${label}: ${error.message}`)
    } else if (expect === undefined || error.code === expect) {
      ok++
    } else if (typeof expect === 'string' && String(error.message).includes(expect)) {
      ok++
    } else {
      bad.push(`${label}: ждали ${expect}, получили ${error.code ?? error.name}: ${error.message}`)
    }
  }
}
const finish = () => {
  if (bad.length) {
    console.error(`Контракты discovery: ${bad.length} провалов из ${ok + bad.length}`)
    for (const line of bad) console.error(`  ✗ ${line}`)
    process.exit(1)
  }
  console.log(`Контракты discovery: ${ok} проверок пройдено`)
}

const AT = '2026-08-17T00:00:00.000Z'
const AT2 = '2026-08-18T00:00:00.000Z'
const HOST = 'https://www.japan-guide.com'
const SOURCE = `${HOST}/e/e4000.html`
const ENTRY = `${HOST}/e/e623a.html`
const DEST = `${HOST}/e/e2157.html`
const LIMIT = { locator: 'h1', limitBytes: BYTE_LIMITS.nameEn }

/* ── Алфавит Р6 ───────────────────────────────────────────────────────── */

t('печатный ASCII разрешён', guardValue('1200 yen (main keep)', LIMIT), '1200 yen (main keep)')
t('знак иены разрешён', guardValue('1200 ¥', LIMIT), '1200 ¥')
t('en dash разрешён', guardValue('9:00–17:00', LIMIT), '9:00–17:00')
t('кавычки разрешены', guardValue('the ‘keep’ and “moat”', LIMIT), 'the ‘keep’ and “moat”')
t('многоточие разрешено', guardValue('and more…', LIMIT), 'and more…')
t('макроны разрешены', guardValue('Ōsakajō Ūji Īto Ēdo Āsa', LIMIT), 'Ōsakajō Ūji Īto Ēdo Āsa')

throwsWith('звезда рейтинга отвергнута', () => guardValue('Hotel ★★★★★', LIMIT), 'nonWhitelistedCodepoint')
throwsWith('тихая порча U+0242 отвергнута', () => guardValue('abcɂdef', LIMIT), 'nonWhitelistedCodepoint')
throwsWith('C1-control U+0082 отвергнут', () => guardValue('abc\u0082def', LIMIT), 'nonWhitelistedCodepoint')
throwsWith('замена U+FFFD отвергнута', () => guardValue('Osaka � castle', LIMIT), 'nonWhitelistedCodepoint')
throwsWith('кандзи отвергнуты', () => guardValue('大阪城', LIMIT), 'nonWhitelistedCodepoint')
throwsWith('кана отвергнута', () => guardValue('おおさか', LIMIT), 'nonWhitelistedCodepoint')
throwsWith('кириллица отвергнута', () => guardValue('Осака', LIMIT), 'nonWhitelistedCodepoint')
throwsWith('C0-control отвергнут', () => guardValue('a\u0001b', LIMIT), 'nonWhitelistedCodepoint')
throwsWith('private use отвергнут', () => guardValue('a\uE000b', LIMIT), 'nonWhitelistedCodepoint')

t('U+0242 является буквой по Unicode', /\p{L}/u.test('ɂ'), true)
t('но в алфавит не входит', isAllowedCodepoint(0x0242), false)
t('U+2022 в алфавит значений не входит', isAllowedCodepoint(0x2022), false)

const DECOMPOSED = 'A\u0304sakajo'
t('разложенный макрон проходит через полный конвейер', guardValue(DECOMPOSED, LIMIT), 'Āsakajo')
throwsWith('без NFC комбинирующий знак был бы отвергнут',
  () => assertAllowedCodepoints(DECOMPOSED, { locator: 'h1' }), 'nonWhitelistedCodepoint')
t('нормализация превращает U+00A0 в пробел', normaliseValue('a\u00a0b'), 'a b')
throwsWith('без нормализации U+00A0 был бы отвергнут',
  () => assertAllowedCodepoints('a\u00a0b', { locator: 'h1' }), 'nonWhitelistedCodepoint')
t('U+3000 тоже становится обычным пробелом', normaliseValue('a\u3000b'), 'a b')
t('пробелы схлопываются и обрезаются', normaliseValue('  a   b  '), 'a b')

eq('пределы контракта', BYTE_LIMITS, { componentName: 120, categoryHint: 120, nameEn: 512, leadValue: 512 })
const EXACT = 'x'.repeat(BYTE_LIMITS.leadValue)
t('ровно предел проходит', utf8Bytes(guardValue(EXACT, { locator: 'h1', limitBytes: BYTE_LIMITS.leadValue })), 512)
throwsWith('предел плюс байт отвергнут',
  () => guardValue(`${EXACT}x`, { locator: 'h1', limitBytes: BYTE_LIMITS.leadValue }), 'tooLong')
let overflow = null
try { guardValue(`${EXACT}x`, { locator: 'h1', limitBytes: BYTE_LIMITS.leadValue }) } catch (error) { overflow = error }
t('отказ несёт длину исходной строки', overflow.originalLengthBytes, 513)
t('отказ не несёт отвергнутый текст', Object.values(overflow).includes(EXACT), false)
throwsWith('пустое значение подсказкой не является', () => guardValue('   ', LIMIT), 'empty')

/* ── Грамматика маркера ───────────────────────────────────────────────── */

t('span отсутствует — уровень 0', recommendationLevel({ spanCount: 0, markerText: null }), 0)
t('одна точка', recommendationLevel({ spanCount: 1, markerText: '•' }), 1)
t('две точки', recommendationLevel({ spanCount: 1, markerText: '••' }), 2)
t('три точки', recommendationLevel({ spanCount: 1, markerText: '•••' }), 3)
t('закрытый диапазон', MAX_RECOMMENDATION_LEVEL, 3)
throwsWith('четыре точки — отказ карточки', () => recommendationLevel({ spanCount: 1, markerText: '••••' }), 'invalidMarker')
throwsWith('два marker-span — отказ карточки', () => recommendationLevel({ spanCount: 2, markerText: '•' }), 'multipleMarkerSpans')
throwsWith('посторонний символ в маркере', () => recommendationLevel({ spanCount: 1, markerText: '•x' }), 'invalidMarker')
throwsWith('пробел между точками', () => recommendationLevel({ spanCount: 1, markerText: '• •' }), 'invalidMarker')
throwsWith('маркер без span', () => recommendationLevel({ spanCount: 0, markerText: '•' }), 'markerWithoutSpan')
t('пробелы по краям маркера допустимы', recommendationLevel({ spanCount: 1, markerText: ' •• ' }), 2)

/* ── Перечисления v1 ──────────────────────────────────────────────────── */

eq('допустимые состояния v1 — пять', LEAD_KINDS,
  ['name_en', 'hours_hint', 'closed_hint', 'admission_hint', 'official_url_hint'])
eq('зарезервировано на будущее', RESERVED_LEAD_KINDS, ['name_ja', 'name_kana', 'category_hint'])
t('зарезервированные не пересекаются с допустимыми',
  RESERVED_LEAD_KINDS.some((kind) => LEAD_KINDS.includes(kind)), false)
eq('локаторы подсказок', LEAD_SOURCE_LOCATORS, ['h1', 'hours_fees_block', 'links_and_resources_official'])
t('локатор карточки подсказку не порождает', LEAD_SOURCE_LOCATORS.includes('top_attractions_card'), false)
t('но потерю в ней записать можно', OMISSION_LOCATORS.includes('top_attractions_card'), true)
t('коды отказа страницы — закрытый список', PAGE_REJECTION_CODES.includes('structureMismatch'), true)
t('коды отказа карточки — свой закрытый список', CARD_REJECTION_CODES.includes('rankRepeated'), true)
t('причина непригодной формы ссылки объявлена',
  INCOMPLETE_REASONS.includes('unsupportedCatalogueLinkShape'), true)
eq('причины уровня цели больше не называют цель направлением',
  INCOMPLETE_REASONS.filter((code) => code.startsWith('destination')), [])
eq('коды отказа цели тоже', PAGE_REJECTION_CODES.filter((code) => code.startsWith('destination')), [])

/* ── poi-fact-lead/v1 ─────────────────────────────────────────────────── */

const lead = (over = {}) => buildFactLead({
  kind: 'hours_hint',
  appliesTo: buildAppliesTo('Main Tower'),
  value: '9:00 to 17:00',
  source: SOURCE,
  sourceLocator: 'hours_fees_block',
  observedAt: AT,
  ...over,
})

const baseLead = lead()
t('версия контракта подсказки', baseLead.contractVersion, FACT_LEAD_SPEC)
t('уверенность — единственное значение', baseLead.confidence, LEAD_CONFIDENCE)
t('verified_at всегда null', baseLead.verifiedAt, null)
assertFactLead(baseLead); ok++

t('leadDigest не зависит от момента наблюдения', lead({ observedAt: AT2 }).leadDigest, baseLead.leadDigest)
t('leadDigest зависит от значения', lead({ value: '9:00 to 18:00' }).leadDigest === baseLead.leadDigest, false)
t('leadDigest зависит от компонента', lead({ appliesTo: buildAppliesTo('Second Garden') }).leadDigest === baseLead.leadDigest, false)

for (const kind of RESERVED_LEAD_KINDS) throwsWith(`${kind} не строится`, () => lead({ kind }))
throwsWith('чужой локатор невозможен', () => lead({ sourceLocator: 'intro' }))
throwsWith('локатор карточки невозможен', () => lead({ sourceLocator: 'top_attractions_card' }))
throwsWith('имя компонента длиннее предела', () => buildAppliesTo('L'.repeat(BYTE_LIMITS.componentName + 1)), 'tooLong')
throwsWith('источник подсказки обязан быть каноничным', () => lead({ source: 'https://example.org/x' }))

/* ── ПОДДЕЛКИ подсказки ───────────────────────────────────────────────── */

const forgeLeadDigest = (draft) => sha256Bytes(canonicalJsonBytes({
  contractVersion: FACT_LEAD_SPEC,
  kind: draft.kind,
  appliesTo: draft.appliesTo,
  value: draft.value,
  source: draft.source,
  sourceLocator: draft.sourceLocator,
  confidence: draft.confidence,
  verifiedAt: draft.verifiedAt,
}, FACT_LEAD_SPEC))

const forgeLead = (over) => {
  const draft = { ...JSON.parse(JSON.stringify(baseLead)), ...over }
  return { ...draft, leadDigest: forgeLeadDigest(draft) }
}

t('подделка собрана верно — исходная форма проходит', (() => { assertFactLead(forgeLead({})); return true })(), true)
throwsWith('кириллица в значении не проходит', () => assertFactLead(forgeLead({ value: 'Москва' })))
throwsWith('кандзи в значении не проходят', () => assertFactLead(forgeLead({ value: '大阪城' })))
throwsWith('звезда в значении не проходит', () => assertFactLead(forgeLead({ value: 'Hotel ★★★★★' })))
for (const kind of RESERVED_LEAD_KINDS) {
  /* Свой код, а не общий отказ перечисления: иначе две проверки прикрывали бы
     друг друга и ни одна не проверялась бы. */
  throwsWith(`собранная вручную ${kind} отвергается как зарезервированная`,
    () => assertFactLead(forgeLead({ kind })), 'reservedLeadKind')
}
throwsWith('выдуманный вид отвергается перечислением', () => assertFactLead(forgeLead({ kind: 'invented_kind' })))
throwsWith('confidence verified не проходит', () => assertFactLead(forgeLead({ confidence: 'verified' })))
throwsWith('проставленный verified_at не проходит', () => assertFactLead(forgeLead({ verifiedAt: AT })))
throwsWith('локатор вне списка не проходит', () => assertFactLead(forgeLead({ sourceLocator: 'top_attractions_card' })))
throwsWith('неканоничный источник не проходит', () => assertFactLead(forgeLead({ source: `${HOST}/e/e1.html?x=1` })))
throwsWith('значение сверх предела не проходит',
  () => assertFactLead(forgeLead({ value: 'x'.repeat(BYTE_LIMITS.leadValue + 1) })))
throwsWith('подсказка чужой страницы в записи не лежит',
  () => assertFactLead(forgeLead({ source: `${HOST}/e/e9999.html` }), { expectedSource: SOURCE }))

/* ── Порядок подсказок ────────────────────────────────────────────────── */

const unsorted = [
  lead({ kind: 'hours_hint', appliesTo: buildAppliesTo('Second Garden'), value: 'b' }),
  lead({ kind: 'closed_hint', appliesTo: null, value: 'z' }),
  lead({ kind: 'hours_hint', appliesTo: null, value: 'a' }),
  lead({ kind: 'hours_hint', appliesTo: buildAppliesTo('Main Tower'), value: 'c' }),
]
eq('порядок kind → applies_to.name → value, null первым',
  sortFactLeads(unsorted).map((l) => [l.kind, l.appliesTo?.name ?? null, l.value]),
  [['closed_hint', null, 'z'], ['hours_hint', null, 'a'], ['hours_hint', 'Main Tower', 'c'], ['hours_hint', 'Second Garden', 'b']])
t('сравнение побайтовое, не по локали', compareUtf8('Z', 'a') < 0, true)
t('локаль дала бы обратный порядок', 'Z'.localeCompare('a', 'en') < 0, false)

/* ── pageEvidence ─────────────────────────────────────────────────────── */

const evidence = (over = {}) => buildPageEvidence({
  url: SOURCE,
  pageRole: 'poi',
  pageBytes: 228994,
  rawPageDigest: `sha256:${'a'.repeat(64)}`,
  observedAt: AT,
  httpCharset: 'shift-jis',
  metaCharset: 'utf-8',
  decodePolicy: 'mixed-page-utf8-locators-v1',
  decodeErrorCount: 15,
  decodeReplacements: 15,
  nonWhitelistedCodepoints: 2,
  ...over,
})

assertPageEvidence(evidence()); ok++
throwsWith('адрес не-адрес отвергнут', () => evidence({ url: 'not a url' }))
throwsWith('адрес чужого хоста отвергнут', () => evidence({ url: 'https://example.org/e/e1.html' }))
throwsWith('отпечаток «x» отвергнут', () => evidence({ rawPageDigest: 'x' }))
throwsWith('отпечаток без префикса отвергнут', () => evidence({ rawPageDigest: 'a'.repeat(64) }))
throwsWith('utf-16 как HTTP charset отвергнут', () => evidence({ httpCharset: 'utf-16' }))
throwsWith('koi8-r как meta charset отвергнут', () => evidence({ metaCharset: 'koi8-r' }))
throwsWith('произвольная политика отвергнута', () => evidence({ decodePolicy: 'что угодно' }))
throwsWith('замены без ошибок отвергнуты', () => evidence({ decodeReplacements: 3 }))
throwsWith('нулевой размер страницы отвергнут', () => evidence({ pageBytes: 0 }))
throwsWith('неканонический момент отвергнут', () => evidence({ observedAt: '2026-08-17' }))

/* ── poi-discovery-record/v1 ──────────────────────────────────────────── */

const placement = (over = {}) => buildPlacement({
  kind: 'destinationRanking',
  collectionSourceKey: 'japan-guide:e2157',
  listPosition: 5,
  editorialLevel: 2,
  categoryHint: 'Castle',
  ...over,
})

const record = (over = {}) => buildDiscoveryRecord({
  sourceKey: 'japan-guide:e4000',
  url: SOURCE,
  nameEn: 'First Object',
  placements: [placement()],
  factLeads: [baseLead],
  omissions: [],
  pageEvidence: evidence(),
  ...over,
})

const baseRecord = record()
t('версия контракта записи', baseRecord.contractVersion, DISCOVERY_RECORD_SPEC)
assertDiscoveryRecord(baseRecord); ok++
t('discoveredFrom выводится', discoveredFrom(baseRecord.placements).join(','), 'japan-guide:e2157')
eq('discoveredFrom уникален и отсортирован',
  discoveredFrom([placement({ collectionSourceKey: 'japan-guide:e2300' }), placement(), placement()]),
  ['japan-guide:e2157', 'japan-guide:e2300'])

const moved = record({ placements: [placement({ listPosition: 17 })] })
t('перестановка НЕ меняет semanticDigest', moved.semanticDigest, baseRecord.semanticDigest)
t('перестановка меняет recordDigest', moved.recordDigest === baseRecord.recordDigest, false)
t('категория меняет semanticDigest',
  record({ placements: [placement({ categoryHint: 'Garden' })] }).semanticDigest === baseRecord.semanticDigest, false)
t('рекомендация меняет semanticDigest',
  record({ placements: [placement({ editorialLevel: 1 })] }).semanticDigest === baseRecord.semanticDigest, false)

const regrown = record({ pageEvidence: evidence({ pageBytes: 229111, rawPageDigest: `sha256:${'b'.repeat(64)}` }) })
t('рост страницы не меняет semanticDigest', regrown.semanticDigest, baseRecord.semanticDigest)
t('рост страницы не меняет recordDigest', regrown.recordDigest, baseRecord.recordDigest)
t('рост страницы меняет observationDigest', regrown.observationDigest === baseRecord.observationDigest, false)

const later = record({ pageEvidence: evidence({ observedAt: AT2 }) })
t('момент наблюдения не меняет recordDigest', later.recordDigest, baseRecord.recordDigest)
t('момент наблюдения не меняет semanticDigest', later.semanticDigest, baseRecord.semanticDigest)

const OMISSION = buildOmission({ code: 'leadValueTooLong', locator: 'hours_fees_block', originalLengthBytes: 640 })
const withOmission = record({ omissions: [OMISSION] })
t('omissions входит в recordDigest', withOmission.recordDigest === baseRecord.recordDigest, false)
t('omissions входит в semanticDigest', withOmission.semanticDigest === baseRecord.semanticDigest, false)
eq('omission не несёт исходный текст', Object.keys(OMISSION).sort(), ['code', 'locator', 'originalLengthBytes'])
t('кодов omissions', OMISSION_CODES.length, 5)

throwsWith('ключ, не выводимый из адреса, отвергнут', () => record({ sourceKey: 'japan-guide:e0001' }))
throwsWith('свидетельство чужой страницы отвергнуто',
  () => record({ pageEvidence: evidence({ url: `${HOST}/e/e9999.html` }) }))
throwsWith('подсказка чужой страницы отвергнута',
  () => record({ factLeads: [lead({ source: `${HOST}/e/e9999.html` })] }))
throwsWith('одно направление дважды', () => record({ placements: [placement(), placement()] }))
throwsWith('запись без placements невозможна', () => record({ placements: [] }))
throwsWith('имя длиннее предела отвергает запись', () => record({ nameEn: 'N'.repeat(BYTE_LIMITS.nameEn + 1) }))
throwsWith('уровень вне диапазона', () => placement({ editorialLevel: MAX_RECOMMENDATION_LEVEL + 1 }))
throwsWith('позиция с нуля', () => placement({ listPosition: 0 }))

const tampered = JSON.parse(JSON.stringify(baseRecord))
tampered.nameEn = 'Another Object'
throwsWith('правленая запись не проходит проверку', () => assertDiscoveryRecord(tampered))
const FAKE = `sha256:${'0'.repeat(64)}`
for (const field of ['recordDigest', 'semanticDigest', 'observationDigest']) {
  const copy = JSON.parse(JSON.stringify(baseRecord))
  copy[field] = FAKE
  throwsWith(`подменённый ${field} не проходит проверку`, () => assertDiscoveryRecord(copy))
}

/* ── Порядок объектов в направлении ───────────────────────────────────── */

const ORDER = ['japan-guide:e1', 'japan-guide:e2', 'japan-guide:e3']
/* Тот же отпечаток, что у свидетельства страницы: порядок и свидетельство
   обязаны описывать одни байты. */
const PAGE_DIGEST = `sha256:${'a'.repeat(64)}`
const OTHER_PAGE_DIGEST = `sha256:${'b'.repeat(64)}`
const orderRecord = buildOrderRecord('japan-guide:e2157', PAGE_DIGEST, ORDER)
assertOrderRecord(orderRecord); ok++
t('перестановка меняет отпечаток порядка',
  orderDigest('japan-guide:e2157', PAGE_DIGEST, [...ORDER].reverse()) === orderRecord.orderDigest, false)
t('направление входит в отпечаток порядка',
  orderDigest('japan-guide:e2158', PAGE_DIGEST, ORDER) === orderRecord.orderDigest, false)
t('байты страницы входят в отпечаток порядка',
  orderDigest('japan-guide:e2157', OTHER_PAGE_DIGEST, ORDER) === orderRecord.orderDigest, false)
throwsWith('порядок без отпечатка страницы невозможен',
  () => orderDigest('japan-guide:e2157', 'не отпечаток', ORDER))
throwsWith('правленый отпечаток страницы не сходится с отпечатком порядка',
  () => assertOrderRecord({
    ...JSON.parse(JSON.stringify(orderRecord)), sourcePageDigest: OTHER_PAGE_DIGEST,
  }))
throwsWith('повтор в порядке невозможен',
  () => orderDigest('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e1', 'japan-guide:e1']))
t('сдвиг считается по позициям', movedCount(ORDER, ['japan-guide:e0', ...ORDER]), 3)
t('без перестановки сдвигов нет', movedCount(ORDER, ORDER), 0)
throwsWith('правленый порядок не сходится с отпечатком',
  () => assertOrderRecord({ ...JSON.parse(JSON.stringify(orderRecord)), order: [...ORDER].reverse() }))

/* ── poi-discovery-snapshot/v1 ────────────────────────────────────────── */

const ROBOTS_EVIDENCE = {
  url: ROBOTS_URL,
  bytes: 64,
  digest: `sha256:${'c'.repeat(64)}`,
  observedAt: AT,
  appliedGroups: ['*'],
}
const COUNTERS = {
  networkRequests: 3,
  catalogueTargetsFound: 1,
  collectionsFound: 1,
  directPoisFound: 0,
  poisFound: 1,
  poisVisited: 1,
  recordsBuilt: 1,
  nonCanonicalLinks: 0,
  unknownAdmissionLabels: 0,
  emptyAdmissionValues: 0,
}
const snapshot = (over = {}) => buildDiscoverySnapshot({
  scope: { kind: 'full', limit: null },
  entryUrl: ENTRY,
  incompleteReasons: [],
  robotsEvidence: ROBOTS_EVIDENCE,
  catalogueEvidence: evidence({ url: ENTRY, pageRole: 'catalogue' }),
  catalogueTargetEvidence: [{ sourceKey: 'japan-guide:e2157', evidence: evidence({ url: DEST, pageRole: 'collection' }) }],
  orderRecords: [buildOrderRecord('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000'])],
  records: [baseRecord],
  rejected: { targets: [], cards: [], pois: [] },
  counters: COUNTERS,
  ...over,
})

const fullSnapshot = snapshot()
t('версия контракта снимка', fullSnapshot.contractVersion, SNAPSHOT_SPEC)
t('полный обход без потерь полон', fullSnapshot.complete, true)
assertDiscoverySnapshot(fullSnapshot); ok++
t('каталог привязан к точке входа', fullSnapshot.catalogueEvidence.url, fullSnapshot.entryUrl)

/* Неполнота: каждая причина обязана сходиться со своим источником. */
const lost = snapshot({
  incompleteReasons: [{ code: 'targetFetchFailed', count: 1 }],
  rejected: { targets: [{ ref: 'japan-guide:e9', code: 'statusDenied' }], cards: [], pois: [] },
  counters: { ...COUNTERS, catalogueTargetsFound: 2 },
})
t('потеря цели делает снимок неполным', lost.complete, false)
const limited = snapshot({
  scope: { kind: 'limited', limit: 1 },
  incompleteReasons: [{ code: 'limitApplied', count: 1 }],
})
t('ограниченный обход снимком не является', limited.complete, false)

/* ── Противоречивая полнота ───────────────────────────────────────────── */

const forgeSnapshotDigest = (snap) => sha256Bytes(canonicalJsonBytes({
  contractVersion: SNAPSHOT_SPEC,
  scope: snap.scope,
  entryUrl: snap.entryUrl,
  complete: snap.complete,
  incompleteReasons: snap.incompleteReasons,
  robotsEvidence: snap.robotsEvidence,
  catalogueEvidence: snap.catalogueEvidence,
  catalogueTargetEvidence: snap.catalogueTargetEvidence,
  orderRecords: snap.orderRecords.map((row) => row.orderDigest),
  records: snap.records.map((r) => r.observationDigest),
  rejected: snap.rejected,
  counters: snap.counters,
}, `${SNAPSHOT_SPEC}#snapshot`))

/** Подделка: правим поле и честно пересчитываем отпечаток. */
/**
 * Подделка снимка.
 *
 * Если САМА подделка бросит — например, тронет поле, которого больше нет, —
 * её ошибка неотличима от отказа валидатора, и `throwsWith` засчитает тест
 * пройденным. Так четыре теста жили на удалённом имени массива отказов:
 * `.push()` бросал раньше валидатора. Поэтому ошибка подделки помечается и
 * `throwsWith` её НЕ принимает.
 */
class ForgeFailed extends Error {
  constructor(cause) {
    super(`подделка не выполнилась: ${cause.message}`)
    this.name = 'ForgeFailed'
    this.forgeFailed = true
  }
}
const forgeFrom = (base, mutate) => {
  const copy = JSON.parse(JSON.stringify(base))
  try {
    mutate(copy)
  } catch (error) {
    throw new ForgeFailed(error)
  }
  copy.snapshotDigest = forgeSnapshotDigest(copy)
  return copy
}
const forgeSnapshot = (mutate) => forgeFrom(fullSnapshot, mutate)

/**
 * Неполный снимок полного охвата с причиной, которая НЕ выводится из массивов
 * отказов. Нужен, чтобы проверять сверки по одной: на полном снимке многие из
 * них прикрывают друг друга.
 */
const incompleteFull = snapshot({
  incompleteReasons: [{ code: 'budgetInsufficient', count: 1 }],
  records: [],
  orderRecords: [buildOrderRecord('japan-guide:e2157', PAGE_DIGEST, [])],
  counters: { ...COUNTERS, poisFound: 0, poisVisited: 0, recordsBuilt: 0 },
})
t('неполный снимок полного охвата строится', incompleteFull.complete, false)

t('подделка собрана верно — исходный снимок проходит',
  (() => { assertDiscoverySnapshot(forgeSnapshot(() => {})); return true })(), true)

/* Пустота массивов отказов у полного снимка отдельной проверкой НЕ держится:
   она следует из того, что каждый отказ порождает причину, а любая причина
   делает снимок неполным. Проверяется сама эта цепочка. */
throwsWith('отказ цели обязан породить причину', () => assertDiscoverySnapshot(forgeSnapshot((s) => {
  s.rejected.targets.push({ ref: 'japan-guide:e9', code: 'statusDenied' })
})), 'targetFetchFailed')
throwsWith('отказ карточки обязан породить причину', () => assertDiscoverySnapshot(forgeSnapshot((s) => {
  s.rejected.cards.push({ destination: 'japan-guide:e2157', position: 3, code: 'rankEmpty' })
})))
throwsWith('непригодный адрес обязан породить причину', () => assertDiscoverySnapshot(forgeSnapshot((s) => {
  s.counters.nonCanonicalLinks = 2
})))

/* А это уже сама сверка полноты, и поймать её может только она: причина
   объявлена, массивы отказов пусты и непротиворечивы, охват полный —
   единственное, что не сходится, это слово `complete`. */
throwsWith('объявить неполный снимок полным нельзя', () => assertDiscoverySnapshot(forgeSnapshot((s) => {
  s.incompleteReasons = [{ code: 'budgetInsufficient', count: 1 }]
})))
throwsWith('выдуманный код отказа невозможен', () => assertDiscoverySnapshot(forgeSnapshot((s) => {
  s.complete = false
  s.incompleteReasons = [{ code: 'targetFetchFailed', count: 1 }]
  s.rejected.targets.push({ ref: 'japan-guide:e9', code: 'что-то пошло не так' })
})), 'rejected.targets')
throwsWith('отказ без ссылки невозможен', () => assertDiscoverySnapshot(forgeSnapshot((s) => {
  s.complete = false
  s.incompleteReasons = [{ code: 'targetFetchFailed', count: 1 }]
  s.rejected.targets.push({ code: 'statusDenied' })
})), 'rejected.targets')
throwsWith('число причин обязано сходиться с отказами', () => assertDiscoverySnapshot(forgeSnapshot((s) => {
  s.complete = false
  s.incompleteReasons = [{ code: 'targetFetchFailed', count: 5 }]
  s.rejected.targets.push({ ref: 'japan-guide:e9', code: 'statusDenied' })
})), 'targetFetchFailed')
throwsWith('отказ без объявленной причины невозможен', () => assertDiscoverySnapshot(forgeSnapshot((s) => {
  s.complete = false
  s.incompleteReasons = []
  s.rejected.pois.push({ ref: 'japan-guide:e5', code: 'statusDenied' })
})))
/* На НЕПОЛНОМ снимке: там сверка «найдено = посещено = построено» не
   применяется и потому не прикрывает сверку счётчика записей. */
throwsWith('recordsBuilt обязан сходиться с числом записей',
  () => assertDiscoverySnapshot(forgeFrom(incompleteFull, (s) => { s.counters.recordsBuilt = 7 })))
throwsWith('у полного снимка найдено и посещено обязаны совпадать',
  () => assertDiscoverySnapshot(forgeSnapshot((s) => { s.counters.poisVisited = 0 })))

/* Длина остаётся прежней — иначе отказ пришёл бы от сверки со счётчиком
   найденных направлений, а не от сверки множеств. */
throwsWith('свидетельства коллекций и порядок описывают одно множество',
  () => assertDiscoverySnapshot(forgeSnapshot((s) => {
    s.catalogueTargetEvidence = [{
      sourceKey: 'japan-guide:e2222',
      evidence: JSON.parse(JSON.stringify(evidence({ url: `${HOST}/e/e2222.html`, pageRole: 'collection' }))),
    }]
    /* Порядок ведём и для новой цели тоже: иначе отказ придёт от сверки
       «порядок без свидетельства цели», а не от равенства множеств. */
    s.orderRecords.push({
      destinationSourceKey: 'japan-guide:e2222',
      sourcePageDigest: PAGE_DIGEST,
      order: [],
      orderDigest: orderDigest('japan-guide:e2222', PAGE_DIGEST, []),
    })
  })), 'множества обязаны совпадать')
throwsWith('объект вне порядка направления невозможен',
  () => assertDiscoverySnapshot(forgeSnapshot((s) => {
    s.orderRecords[0].order = ['japan-guide:e7777']
    s.orderRecords[0].orderDigest = orderDigest('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e7777'])
  })))

/* Объект ЕСТЬ в порядке одного направления и НЕТ в порядке второго, к
   которому у него привязка. Поймать это может только посадочная сверка. */
throwsWith('привязка к направлению, в порядке которого объекта нет', () => snapshot({
  records: [record({ placements: [placement(), placement({ collectionSourceKey: 'japan-guide:e2222' })] })],
  catalogueTargetEvidence: [
    { sourceKey: 'japan-guide:e2157', evidence: evidence({ url: DEST, pageRole: 'collection' }) },
    { sourceKey: 'japan-guide:e2222', evidence: evidence({ url: `${HOST}/e/e2222.html`, pageRole: 'collection' }) },
  ],
  orderRecords: [
    buildOrderRecord('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000']),
    buildOrderRecord('japan-guide:e2222', PAGE_DIGEST, []),
  ],
  counters: { ...COUNTERS, catalogueTargetsFound: 2, collectionsFound: 2 },
}))
throwsWith('чужой адрес robots невозможен',
  () => assertDiscoverySnapshot(forgeSnapshot((s) => { s.robotsEvidence.url = 'bogus' })))
throwsWith('нестроковая группа robots невозможна',
  () => assertDiscoverySnapshot(forgeSnapshot((s) => { s.robotsEvidence.appliedGroups = [123] })))
throwsWith('повтор группы robots невозможен',
  () => assertDiscoverySnapshot(forgeSnapshot((s) => { s.robotsEvidence.appliedGroups = ['*', '*'] })))
throwsWith('неканонический порядок групп robots невозможен',
  () => assertDiscoverySnapshot(forgeSnapshot((s) => { s.robotsEvidence.appliedGroups = ['z', 'a'] })))
throwsWith('каталог обязан относиться к точке входа',
  () => assertDiscoverySnapshot(forgeSnapshot((s) => { s.entryUrl = `${HOST}/e/e9000.html` })))
throwsWith('ограниченный охват без причины невозможен',
  () => assertDiscoverySnapshot(forgeSnapshot((s) => { s.scope = { kind: 'limited', limit: 1 }; s.complete = false })))
throwsWith('причина limitApplied при полном охвате невозможна',
  () => assertDiscoverySnapshot(forgeSnapshot((s) => {
    s.complete = false
    s.incompleteReasons = [{ code: 'limitApplied', count: 1 }]
  })))
throwsWith('подменённый snapshotDigest не проходит', () => {
  const copy = JSON.parse(JSON.stringify(fullSnapshot))
  copy.snapshotDigest = FAKE
  assertDiscoverySnapshot(copy)
})
throwsWith('у полного обхода предела нет', () => snapshot({ scope: { kind: 'full', limit: 5 } }))

/* ── Семейства адресов, ключи и матрица ролей ─────────────────────────── */

const family = (p) => canonicalDiscoveryUrl(p).family
const key = (p) => discoverySourceKey(canonicalDiscoveryUrl(p).url)

t('legacy опознаётся', family('/e/e4000.html'), 'legacy')
t('корневое семейство опознаётся', family('/destinations/nozawa-onsen/'), 'destinationRoot')
t('вложенное семейство опознаётся', family('/destinations/nozawa-onsen/hot-spring-baths.html'), 'destinationNested')
t('legacy-ключ не изменился', key('/e/e4000.html'), 'japan-guide:e4000')
t('ключ корневого', key('/destinations/motonosumi-shrine/'), 'japan-guide:destinations:motonosumi-shrine')
t('ключ вложенного', key('/destinations/nozawa-onsen/nozawa-ski-resort.html'),
  'japan-guide:destinations:nozawa-onsen:nozawa-ski-resort')
/* Одинаковые сегменты занимают разные позиции пути и не схлопываются. */
t('одинаковые сегменты не схлопываются', key('/destinations/nozawa-onsen/nozawa-onsen.html'),
  'japan-guide:destinations:nozawa-onsen:nozawa-onsen')
t('ключи семейств не сталкиваются',
  new Set(['/e/e4000.html', '/destinations/nozawa-onsen/', '/destinations/nozawa-onsen/nozawa-onsen.html']
    .map(key)).size, 3)

for (const [label, path] of [
  ['верхний регистр', '/destinations/Nozawa-Onsen/'],
  ['пустой slug', '/destinations//'],
  ['двойной дефис', '/destinations/a--b/'],
  ['нет завершающего слэша', '/destinations/nozawa-onsen'],
  ['лишний сегмент', '/destinations/a/b/c/'],
  ['query', '/destinations/a/?x=1'],
  ['fragment', '/destinations/a/#t'],
  ['percent-encoded обход', '/destinations/%2E%2E/'],
  ['верхний регистр расширения', '/destinations/a/b.HTML'],
]) throwsWith(`адрес отвергнут: ${label}`, () => canonicalDiscoveryUrl(path))

t('вход относится к своему семейству матрицы', matrixFamily(CATALOGUE_ENTRY_URL), 'catalogueEntry')
t('прочий legacy — обычное семейство', matrixFamily(`${HOST}/e/e4000.html`), 'legacy')

const withRole = (url, pageRole) => () => evidence({ url, pageRole })
withRole(CATALOGUE_ENTRY_URL, 'catalogue')(); ok++
throwsWith('вход не может быть коллекцией', withRole(CATALOGUE_ENTRY_URL, 'collection'))
throwsWith('вход не может быть объектом', withRole(CATALOGUE_ENTRY_URL, 'poi'))
throwsWith('произвольный legacy не может быть каталогом', withRole(`${HOST}/e/e4000.html`, 'catalogue'))
withRole(`${HOST}/e/e2157.html`, 'collection')(); ok++
withRole(`${HOST}/e/e4000.html`, 'poi')(); ok++
withRole(`${HOST}/destinations/nozawa-onsen/`, 'collection')(); ok++
withRole(`${HOST}/destinations/motonosumi-shrine/`, 'poi')(); ok++
throwsWith('корневой адрес не может быть каталогом',
  withRole(`${HOST}/destinations/nozawa-onsen/`, 'catalogue'))
withRole(`${HOST}/destinations/nozawa-onsen/hot-spring-baths.html`, 'poi')(); ok++
throwsWith('вложенный адрес не может быть коллекцией',
  withRole(`${HOST}/destinations/nozawa-onsen/hot-spring-baths.html`, 'collection'))
throwsWith('вложенный адрес не может быть каталогом',
  withRole(`${HOST}/destinations/nozawa-onsen/hot-spring-baths.html`, 'catalogue'))

/* Подмена роли в сериализованном свидетельстве. */
throwsWith('запись POI из свидетельства коллекции невозможна',
  () => record({ pageEvidence: evidence({ url: `${HOST}/e/e2157.html`, pageRole: 'collection' }) }))
throwsWith('выдуманная роль невозможна', () => evidence({ pageRole: 'что-то' }))


/* ── P1-B: percent-encoding не обходит грамматику адресов ─────────────── */

/*
 * new URL() декодирует %2e и нормализует dot-сегменты ДО того, как путь
 * увидит шаблон:
 *   /destinations/a/%2e%2e/b/ → /destinations/b/
 *   /e/x/%2e%2e/e1.html       → /e/e1.html
 * Проверка после разбора следов уже не находит, поэтому запрет лексический
 * и стоит до вызова URL. Ниже — ровно те строки, которые проходили.
 */
for (const [label, href] of [
  ['dot-сегмент, новый путь', '/destinations/a/%2e%2e/b/'],
  ['dot-сегмент, верхний регистр', '/destinations/a/%2E%2E/b/'],
  ['dot-сегмент, смешанный регистр', '/destinations/a/%2e%2E/b/'],
  ['dot-сегмент стирает верхний регистр сегмента', '/destinations/A/%2E%2E/b/'],
  ['dot-сегмент, legacy', '/e/x/%2e%2e/e1.html'],
  ['кодированный разделитель', '/destinations/a%2Fb/'],
  ['кодированная буква', '/destinations/%6eozawa-onsen/'],
  ['кодированный процент', '/destinations/a%25b/'],
]) throwsWith(`percent-encoding отвергнут: ${label}`, () => canonicalDiscoveryUrl(href))

/* Нормализация действительно происходила бы — иначе запрет нечего охранять. */
t('без запрета путь нормализовался бы в допустимый',
  new URL('/destinations/a/%2e%2e/b/', HOST).pathname, '/destinations/b/')
t('и в legacy тоже',
  new URL('/e/x/%2e%2e/e1.html', HOST).pathname, '/e/e1.html')

/* Ключ источника тоже не строится из адреса с percent-encoding. */
throwsWith('ключ не строится из адреса с percent-encoding',
  () => discoverySourceKey(`${HOST}/destinations/a/%2e%2e/b/`))

/* Законные адреса не задеты. */
t('корневой адрес проходит', canonicalDiscoveryUrl(`${HOST}/destinations/nozawa-onsen/`).family, 'destinationRoot')
t('вложенный адрес проходит',
  canonicalDiscoveryUrl(`${HOST}/destinations/nozawa-onsen/hot-spring-baths.html`).family, 'destinationNested')


/* Только строка: URL-объект отвергается до разбора. */

/*
 * URL-объект нормализован при СОЗДАНИИ и исходного %2e%2e уже не хранит,
 * а new URL(объект, base) его принимает. Значит лексическая проверка «%» на
 * нём бессильна: она видит уже канонизированную строку.
 */
const SNEAKY = new URL(`${HOST}/destinations/a/%2e%2e/b/`)
t('URL-объект следов percent-encoding не хранит', String(SNEAKY).includes('%'), false)
t('и путь у него уже допустимый', SNEAKY.pathname, '/destinations/b/')

throwsWith('canonicalDiscoveryUrl не принимает URL-объект', () => canonicalDiscoveryUrl(SNEAKY))
throwsWith('discoverySourceKey не принимает URL-объект', () => discoverySourceKey(SNEAKY))

for (const [label, value] of [
  ['undefined', undefined],
  ['null', null],
  ['число', 42],
  ['массив', [`${HOST}/destinations/b/`]],
  ['объект с toString', { toString: () => `${HOST}/destinations/b/` }],
]) {
  throwsWith(`canonicalDiscoveryUrl не принимает ${label}`, () => canonicalDiscoveryUrl(value))
  throwsWith(`discoverySourceKey не принимает ${label}`, () => discoverySourceKey(value))
}

/* Строка того же адреса по-прежнему проходит — граница по типу, не по адресу. */
t('строковый корневой адрес проходит',
  canonicalDiscoveryUrl(`${HOST}/destinations/b/`).family, 'destinationRoot')


/* ── Дискриминированное размещение: границы, не прикрытые строителем ──── */

/*
 * `buildPlacement` отвергает выдуманный ранг сам, поэтому проверка внутри
 * `assertPlacement` им ЗАСЛОНЕНА. Ниже размещение подаётся объектом прямо в
 * `buildDiscoveryRecord` — этот путь строителя размещения не проходит, и
 * проверка контракта становится единственной.
 */
const rawPlacement = (over = {}) => ({
  kind: 'catalogueDirect',
  collectionSourceKey: CATALOGUE_SOURCE_KEY,
  listPosition: null,
  editorialLevel: null,
  categoryHint: null,
  ...over,
})
t('прямое размещение объектом проходит', Boolean(record({ placements: [rawPlacement()] })), true)
throwsWith('прямое размещение с рангом отвергается контрактом',
  () => record({ placements: [rawPlacement({ listPosition: 3 })] }))
throwsWith('прямое размещение с уровнем отвергается контрактом',
  () => record({ placements: [rawPlacement({ editorialLevel: 0 })] }))
throwsWith('прямое размещение с категорией отвергается контрактом',
  () => record({ placements: [rawPlacement({ categoryHint: 'Castle' })] }))
throwsWith('прямое размещение с ключом направления отвергается контрактом',
  () => record({ placements: [rawPlacement({ collectionSourceKey: 'japan-guide:e2157' })] }))
throwsWith('ранжирование с ключом каталога отвергается контрактом',
  () => record({ placements: [rawPlacement({ kind: 'destinationRanking', listPosition: 1, editorialLevel: 0 })] }))
throwsWith('два прямых размещения невозможны', () => record({
  placements: [rawPlacement(), rawPlacement({ collectionSourceKey: 'japan-guide:e2157' })],
}))

/* Вид размещения входит в семантику: переход «прямой ↔ карточка» —
   изменение по существу, а все три поля ранжирования у прямого равны null,
   поэтому без `kind` такой переход был бы невидим. */
const asDirect = record({ placements: [rawPlacement()] })
const asRanked = record({
  placements: [rawPlacement({
    kind: 'destinationRanking',
    collectionSourceKey: 'japan-guide:e2157',
    listPosition: 1,
    editorialLevel: 0,
  })],
})
t('вид размещения меняет semanticDigest', asDirect.semanticDigest === asRanked.semanticDigest, false)

/* Прямой объект обязан быть целью каталога с ролью «poi». Ни счётчики, ни
   охват здесь не расходятся — расходится только эта связка. */
throwsWith('прямой объект вне целей каталога невозможен', () => snapshot({
  records: [record({ placements: [rawPlacement()] })],
  catalogueTargetEvidence: [
    { sourceKey: 'japan-guide:e2157', evidence: evidence({ url: DEST, pageRole: 'collection' }) },
  ],
  orderRecords: [buildOrderRecord('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000'])],
  counters: { ...COUNTERS, catalogueTargetsFound: 1, collectionsFound: 1, directPoisFound: 0 },
}), 'среди целей каталога с ролью')

/*
 * Цель каталога не может назваться каталогом — даже если это адрес входа, для
 * которого матрица роль×семейство роль «catalogue» разрешает.
 *
 * Снимок здесь ПУСТОЙ намеренно: со счётчиками, сходящимися с ролями, и без
 * записей единственной расходящейся вещью остаётся сама роль цели. С
 * непустым снимком отказ пришёл бы от сверки счётчиков, и проверка ролей
 * осталась бы неиспытанной — поймано мутацией.
 */
throwsWith('цель с ролью каталога невозможна', () => snapshot({
  catalogueTargetEvidence: [
    { sourceKey: 'japan-guide:e623a', evidence: evidence({ url: ENTRY, pageRole: 'catalogue' }) },
  ],
  orderRecords: [],
  records: [],
  counters: {
    ...COUNTERS, catalogueTargetsFound: 1, collectionsFound: 0, directPoisFound: 0,
    poisFound: 0, poisVisited: 0, recordsBuilt: 0,
  },
}))


/* ── Счётчики неполного снимка — не черновик ──────────────────────────── */

/*
 * Прежде почти все связи счётчиков стояли внутри `if (complete)`, и неполный
 * снимок принимал произвольные числа. Ниже — тот самый контрпример: одна
 * collection-цель, ни одного объекта, и счётчики из ниоткуда.
 */
const wildCounters = {
  ...COUNTERS,
  catalogueTargetsFound: 999,
  collectionsFound: 777,
  directPoisFound: 666,
  poisFound: 555,
  poisVisited: 444,
  recordsBuilt: 0,
}
throwsWith('неполный снимок не принимает произвольные счётчики', () => snapshot({
  incompleteReasons: [{ code: 'budgetInsufficient', count: 1 }],
  records: [],
  orderRecords: [buildOrderRecord('japan-guide:e2157', PAGE_DIGEST, [])],
  counters: wildCounters,
}))

/** Неполный снимок с внутренне согласованными счётчиками — основа для сверок. */
const incompleteBase = {
  incompleteReasons: [{ code: 'budgetInsufficient', count: 1 }],
  records: [],
  orderRecords: [buildOrderRecord('japan-guide:e2157', PAGE_DIGEST, [])],
  counters: { ...COUNTERS, poisFound: 0, poisVisited: 0, recordsBuilt: 0 },
}
t('согласованный неполный снимок принимается',
  snapshot(incompleteBase).complete, false)

/* Каждая связь — по отдельности, на НЕПОЛНОМ снимке. */
throwsWith('цель обязана попасть либо в свидетельства, либо в отказы', () => snapshot({
  ...incompleteBase,
  counters: { ...incompleteBase.counters, catalogueTargetsFound: 3 },
}), 'catalogueTargetsFound')
throwsWith('роли обязаны сходиться со счётчиками', () => snapshot({
  ...incompleteBase,
  counters: { ...incompleteBase.counters, collectionsFound: 0 },
}), 'не сходятся с ролями')
throwsWith('poisFound обязан сходиться с достижимыми', () => snapshot({
  ...incompleteBase,
  counters: { ...incompleteBase.counters, poisFound: 4 },
}), 'poisFound')
throwsWith('recordsBuilt обязан сходиться с записями', () => snapshot({
  ...incompleteBase,
  counters: { ...incompleteBase.counters, recordsBuilt: 2 },
}), 'recordsBuilt')
throwsWith('poisVisited обязан сходиться с исходом', () => snapshot({
  ...incompleteBase,
  counters: { ...incompleteBase.counters, poisVisited: 2 },
}), 'poisVisited')
throwsWith('посетить больше, чем найдено, нельзя', () => snapshot({
  ...incompleteBase,
  incompleteReasons: [{ code: 'poiFetchFailed', count: 2 }],
  rejected: {
    targets: [],
    cards: [],
    pois: [
      { ref: 'japan-guide:e5001', code: 'statusDenied' },
      { ref: 'japan-guide:e5002', code: 'statusDenied' },
    ],
  },
  counters: { ...incompleteBase.counters, poisVisited: 2 },
}), 'посетить больше, чем нашли')

/* Одна цель не может быть и наблюдена, и отвергнута. */
throwsWith('цель одновременно наблюдена и отвергнута невозможна', () => snapshot({
  ...incompleteBase,
  incompleteReasons: [{ code: 'targetFetchFailed', count: 1 }],
  rejected: {
    targets: [{ ref: 'japan-guide:e2157', code: 'statusDenied' }],
    cards: [],
    pois: [],
  },
  counters: { ...incompleteBase.counters, catalogueTargetsFound: 2 },
}), 'одновременно наблюдена и отвергнута')
throwsWith('одна цель отвергнута дважды невозможна', () => snapshot({
  ...incompleteBase,
  incompleteReasons: [{ code: 'targetFetchFailed', count: 2 }],
  rejected: {
    targets: [
      { ref: 'japan-guide:e9', code: 'statusDenied' },
      { ref: 'japan-guide:e9', code: 'redirectLimit' },
    ],
    cards: [],
    pois: [],
  },
  counters: { ...incompleteBase.counters, catalogueTargetsFound: 3 },
}), 'отвергнута дважды')

finish()
