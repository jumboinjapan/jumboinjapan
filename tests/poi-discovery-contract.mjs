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
import { readFileSync } from 'node:fs'
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
  PAGE_ROLE_CODES,
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
  orderItem,
  orderedPoiKeys,
  orderedCollectionKeys,
  isStructureRejection,
  NON_CATALOGUE_ROLES,
  INCOMPLETE_REASONS_V12,
  INCOMPLETE_REASONS_V3,
  ROLE_FAMILY_MISMATCH_CODE,
  PAGE_REJECTION_CODES_V3,
  ORDER_SPEC_V1,
  ORDER_SPEC_V2,
  SNAPSHOT_SPEC_V2,
  indexPoliciesBy,
  ORDER_SPEC_V3,
  SNAPSHOT_SPEC_V1,
  SNAPSHOT_SPEC_V3,
  DISCOVERY_RECORD_SPEC_V2,
  DISCOVERY_RECORD_SPEC_V1,
  ORDER_SPEC,
  VERSION_POLICY,
  PLACEMENT_KINDS,
  PLACEMENT_KINDS_V1,
  READABLE_ORDER_SPECS,
  READABLE_RECORD_SPECS,
  READABLE_SNAPSHOT_SPECS,
  ROLES_BY_FAMILY,
  matrixFamily,
  sortFactLeads,
} from '../scripts/poi-portals/lib/discovery-contract.mjs'
import {
  CATALOGUE_ENTRY_URL,
  ROBOTS_URL,
  canonicalPageUrl,
  canonicalDiscoveryUrl,
  discoverySourceKey,
  sourceKeyFamily,
  sourceKeyFromUrl,
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

/* ── Грамматика маркера ───────────────────────────────────────────────────
 * `span` несёт АННОТАЦИЮ; маркер — её завершающий ряд U+2022. Прежняя
 * версия требовала, чтобы весь `span` состоял из точек, и на измеренных
 * страницах отвергала каждую карточку. Аргумент назван `annotationText`
 * именно потому, что это не маркер: прежнее имя `markerText` и было той
 * ошибкой, записанной в подпись функции. */

const level = (spanCount, annotationText) => recommendationLevel({ spanCount, annotationText })

t('span отсутствует — уровень 0', level(0, null), 0)
t('закрытый диапазон', MAX_RECOMMENDATION_LEVEL, 3)

/* Чистые точки — форма Осаки. Она обязана продолжать работать. */
t('одна точка', level(1, '•'), 1)
t('две точки', level(1, '••'), 2)
t('три точки', level(1, '•••'), 3)
t('пробелы по краям допустимы', level(1, ' •• '), 2)

/* Измеренная форма: аннотация плюс необязательный хвост. */
t('аннотация без точек — уровень 0, а не отказ', level(1, 'Local'), 0)
t('аннотация и одна точка', level(1, 'Local•'), 1)
t('аннотация и две точки', level(1, 'Local••'), 2)
t('аннотация и три точки', level(1, 'Local•••'), 3)
t('скобочный префикс не мешает', level(1, '(Local)•'), 1)
t('префикс не разбирается как имя: цифры и знаки', level(1, '#12 / A-B•'), 1)
/* Пробел между префиксом и хвостом хвоста не рвёт. */
t('пробел перед хвостом', level(1, 'Local ••'), 2)
/* Один и два — разные уровни. Перепутать их нельзя. */
t('один и два хвоста различаются', level(1, 'Local•') !== level(1, 'Local••'), true)

throwsWith('четыре завершающие точки — отказ', () => level(1, '••••'), 'invalidMarker')
throwsWith('четыре точки после аннотации — отказ', () => level(1, 'Local••••'), 'invalidMarker')
throwsWith('точка внутри префикса — отказ', () => level(1, '•Local'), 'invalidMarker')
throwsWith('точка в середине — отказ', () => level(1, 'Lo•cal•'), 'invalidMarker')
throwsWith('точка в префиксе при хвосте — отказ', () => level(1, '•Local••'), 'invalidMarker')
throwsWith('разорванный ряд — отказ', () => level(1, '• •'), 'invalidMarker')
throwsWith('пустой span — отказ', () => level(1, ''), 'invalidMarker')
throwsWith('span из одних пробелов — отказ', () => level(1, '   '), 'invalidMarker')
throwsWith('два span — отказ карточки', () => level(2, '•'), 'multipleMarkerSpans')
throwsWith('три span — тот же отказ', () => level(3, 'Local•'), 'multipleMarkerSpans')
throwsWith('аннотация без span', () => level(0, '•'), 'markerWithoutSpan')
throwsWith('аннотация без span, даже пустая', () => level(0, ''), 'markerWithoutSpan')

/* ── Граница аннотации ────────────────────────────────────────────────────
 * После правки маркера `span` без U+2022 значит уровень 0 — и подмена
 * символа стала бы ТИХОЙ: «Local··» дало бы ноль на каждой карточке.
 * Граница делает её громкой покарточно, кодом `invalidMarker`.
 *
 * Проверяется ТОЛЬКО последний знак, не алфавит и не содержание. */
t('заканчивается буквой', level(1, 'Local'), 0)
t('заканчивается цифрой', level(1, 'Local 2'), 0)
t('заканчивается закрывающей скобкой Pe', level(1, '(Local)'), 0)
t('заканчивается завершающей кавычкой Pf', level(1, '«Local»'), 0)
/* Unicode-категории, а не список ASCII: аннотация бывает японской. */
t('японская аннотация кончается буквой', level(1, '周辺'), 0)
t('японская скобка — тоже Pe', level(1, '（周辺）'), 0)
t('японская кавычка — тоже Pe', level(1, '「周辺」'), 0)
t('граница проверяется и при маркере', level(1, '(Local)•'), 1)

/* Внутри аннотации допустимо что угодно — важен только край. */
t('внутренняя точка не мешает', level(1, 'Local·Name'), 0)
t('внутренний дефис не мешает', level(1, 'Local-Name'), 0)

throwsWith('U+00B7 вместо маркера', () => level(1, 'Local··'), 'invalidMarker')
throwsWith('смешанная форма U+00B7 и U+2022', () => level(1, 'Local·•'), 'invalidMarker')
throwsWith('звезда вместо маркера', () => level(1, 'Local★'), 'invalidMarker')
throwsWith('звёздочка вместо маркера', () => level(1, 'Local*'), 'invalidMarker')
throwsWith('дефис на краю', () => level(1, 'Local-'), 'invalidMarker')
throwsWith('открывающая скобка на краю', () => level(1, 'Local('), 'invalidMarker')

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
/* Список ЦЕЛИКОМ, а не его длина: число сходится и после подмены одного
   кода другим, а имя — нет. */
eq('коды omissions', [...OMISSION_CODES].sort(), [
  'ambiguousValueBoundary',
  'categoryHintTooLong',
  'componentNameTooLong',
  'leadValueTooLong',
  'nonWhitelistedCodepoint',
  'unknownAdmissionLabel',
])

/* Неизвестная метка поля: источник назван записью, текст не сохраняется. */
const UNKNOWN_LABEL = buildOmission({
  code: 'unknownAdmissionLabel', locator: 'hours_fees_block', originalLengthBytes: 22,
})
eq('omission неизвестной метки той же формы', Object.keys(UNKNOWN_LABEL).sort(),
  ['code', 'locator', 'originalLengthBytes'])
t('и текста метки в нём нет',
  JSON.stringify(UNKNOWN_LABEL).includes('unknownAdmissionLabel')
  && Object.values(UNKNOWN_LABEL).every((v) => typeof v !== 'string' || OMISSION_CODES.includes(v)
    || OMISSION_LOCATORS.includes(v)), true)
t('длина метки входит в recordDigest',
  record({ omissions: [UNKNOWN_LABEL] }).recordDigest
  === record({
    omissions: [buildOmission({
      code: 'unknownAdmissionLabel', locator: 'hours_fees_block', originalLengthBytes: 23,
    })],
  }).recordDigest, false)

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

/**
 * ПОРЯДОК ИЗ ОДНИХ ОБЪЕКТОВ — самая частая форма в этих проверках.
 *
 * Помощник роль не прячет, а называет: v3 требует роль у каждого элемента,
 * и «список ключей» без роли в нём непредставим. Проверки, которым нужна
 * коллекция внутри порядка, зовут buildOrderRecord напрямую и перечисляют
 * роли поимённо.
 */
const poiItems = (keys) => keys.map((sourceKey) => orderItem('poi', sourceKey))
const poiOrderRecord = (destinationSourceKey, sourcePageDigest, keys, collectionKind) =>
  buildOrderRecord({ destinationSourceKey, sourcePageDigest, collectionKind, items: poiItems(keys) })
/** Отпечаток порядка из одних объектов: без вида коллекции — v1, с ним — v3. */
const poiOrderDigest = (destinationSourceKey, sourcePageDigest, keys, collectionKind = null) =>
  (collectionKind === null
    ? orderDigest({ destinationSourceKey, sourcePageDigest, order: [...keys] }, ORDER_SPEC_V1)
    : orderDigest(
      { destinationSourceKey, sourcePageDigest, collectionKind, items: poiItems(keys) },
      ORDER_SPEC_V3,
    ))
const orderRecord = poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, ORDER, 'ranked')
assertOrderRecord(orderRecord); ok++
t('перестановка меняет отпечаток порядка',
  poiOrderDigest('japan-guide:e2157', PAGE_DIGEST, [...ORDER].reverse()) === orderRecord.orderDigest, false)
t('направление входит в отпечаток порядка',
  poiOrderDigest('japan-guide:e2158', PAGE_DIGEST, ORDER) === orderRecord.orderDigest, false)
t('байты страницы входят в отпечаток порядка',
  poiOrderDigest('japan-guide:e2157', OTHER_PAGE_DIGEST, ORDER) === orderRecord.orderDigest, false)
throwsWith('порядок без отпечатка страницы невозможен',
  () => poiOrderDigest('japan-guide:e2157', 'не отпечаток', ORDER))
throwsWith('правленый отпечаток страницы не сходится с отпечатком порядка',
  () => assertOrderRecord({
    ...JSON.parse(JSON.stringify(orderRecord)), sourcePageDigest: OTHER_PAGE_DIGEST,
  }))
throwsWith('повтор в порядке невозможен',
  () => poiOrderDigest('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e1', 'japan-guide:e1']))
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
  /*
   * Заведомо ВЫШЕ нижней границы обменов любой фикстуры этого набора.
   *
   * Граница — неравенство, а не равенство: каждый шаг редиректа проходит
   * через тот же счётчик. Точное её значение пришпилено отдельными
   * проверками ниже, а здесь важно только не упереться в неё случайно —
   * иначе набор проверял бы арифметику фикстуры, а не то, ради чего написан.
   */
  networkRequests: 12,
  catalogueTargetsFound: 1,
  catalogueCollectionsFound: 1,
  nestedCollectionsFound: 0,
  directPoisFound: 0,
  poisFound: 1,
  recordsAttempted: 1,
  recordsBuilt: 1,
  nonCanonicalLinks: 0,
  unknownAdmissionLabels: 0,
  emptyAdmissionValues: 0,
}
/*
 * Потолки фикстуры заведомо ВЫШЕ её счётчика обменов — по той же причине, по
 * которой `COUNTERS.networkRequests` заведомо выше нижней границы: набор
 * проверяет то, ради чего написан, а не арифметику собственной фикстуры.
 * Точные значения обоих потолков пришпилены отдельными проверками ниже.
 */
const NETWORK_POLICY = { maxNetworkRequests: 6000, maxRedirects: 2 }
const snapshot = (over = {}) => buildDiscoverySnapshot({
  scope: { kind: 'full', limit: null },
  entryUrl: ENTRY,
  incompleteReasons: [],
  networkPolicy: NETWORK_POLICY,
  robotsEvidence: ROBOTS_EVIDENCE,
  catalogueEvidence: evidence({ url: ENTRY, pageRole: 'catalogue' }),
  catalogueTargetEvidence: [{ sourceKey: 'japan-guide:e2157', evidence: evidence({ url: DEST, pageRole: 'collection' }) }],
  orderRecords: [poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000'], 'ranked')],
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
  /* Потолки входят в отпечаток: иначе объявленный бюджет можно было бы
     подогнать под счётчик после прогона, не тронув digest. */
  networkPolicy: snap.networkPolicy,
  robotsEvidence: snap.robotsEvidence,
  catalogueEvidence: snap.catalogueEvidence,
  catalogueTargetEvidence: snap.catalogueTargetEvidence,
  /* Свидетельства коллекций ниже каталога входят в отпечаток наравне с
     целями: без них подменить весь граф можно было бы, не тронув digest. */
  nestedCollectionEvidence: snap.nestedCollectionEvidence,
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
 * ПРИВЕДЕНИЕ СНИМКА К ФОРМЕ `v1` — целиком, а не «почти».
 *
 * Нужно там, где проверяется ОДНА связка версии: отказ обязан прийти именно
 * от неё, а не от лишнего поля более позднего формата. Приведение делает
 * ровно то, что сделал бы посторонний, выдающий сегодняшний снимок за
 * вчерашний: убирает поля, которых `v1` не знал, возвращает старые имена
 * счётчиков и пересчитывает отпечатки порядка доменом `v1`.
 *
 * `snapshotDigest` СЮДА НЕ ВХОДИТ намеренно: сверка отпечатка снимка стоит
 * последней, и до неё эти проверки не доходят — они падают раньше, на том,
 * что проверяют. Пересчитать его здесь значило бы утверждать, что подделка
 * прошла бы и его.
 */
const asV1Shape = (snap) => {
  const copy = JSON.parse(JSON.stringify(snap))
  copy.contractVersion = SNAPSHOT_SPEC_V1
  delete copy.nestedCollectionEvidence
  delete copy.networkPolicy
  delete copy.rejected.nodes
  copy.counters.collectionsFound = copy.counters.catalogueCollectionsFound
  copy.counters.poisVisited = copy.counters.recordsAttempted
  delete copy.counters.recordsAttempted
  delete copy.counters.catalogueCollectionsFound
  delete copy.counters.nestedCollectionsFound
  for (const row of copy.orderRecords) {
    row.order = row.items.map((item) => item.sourceKey)
    delete row.items
    delete row.collectionKind
    row.orderDigest = orderDigest({
      destinationSourceKey: row.destinationSourceKey,
      sourcePageDigest: row.sourcePageDigest,
      order: row.order,
    }, ORDER_SPEC_V1)
  }
  return copy
}

/**
 * Неполный снимок с причиной, которая НЕ выводится из массивов отказов.
 * Нужен, чтобы проверять сверки по одной: на полном снимке многие из них
 * прикрывают друг друга.
 *
 * У `v1` и `v2` такой причиной был `budgetInsufficient` при ПОЛНОМ охвате.
 * `v3` его не знает вовсе: нехватка бюджета там приписана узлу графа кодом
 * `networkBudgetExhausted`, а не объявляется прогоном. Единственная
 * объявляемая причина `v3` — `limitApplied`, и она обязана идти вместе с
 * ограниченным охватом. Поэтому фикстура ограниченная, а не полная; на
 * безусловные сверки счётчиков это не влияет — они безусловны.
 */
const incompleteFull = snapshot({
  scope: { kind: 'limited', limit: 1 },
  incompleteReasons: [{ code: 'limitApplied', count: 1 }],
  records: [],
  orderRecords: [poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, [], 'ranked')],
  counters: { ...COUNTERS, poisFound: 0, recordsAttempted: 0, recordsBuilt: 0 },
})
t('неполный снимок с объявленной причиной строится', incompleteFull.complete, false)
t('объявляемой нехватки бюджета у v3 нет',
  INCOMPLETE_REASONS_V3.includes('budgetInsufficient'), false)
t('а у замороженных версий она есть',
  INCOMPLETE_REASONS_V12.includes('budgetInsufficient'), true)

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
   объявлена, сходится с массивом отказов и со счётчиком целей, охват полный —
   единственное, что не сходится, это слово `complete`.

   Прежде здесь объявлялась `budgetInsufficient` — причина, не выводимая ни из
   чего. `v3` её не знает, поэтому берётся выводимая: отказ цели добавлен,
   причина названа, счётчик целей поправлен. */
throwsWith('объявить неполный снимок полным нельзя', () => assertDiscoverySnapshot(forgeSnapshot((s) => {
  s.rejected.targets.push({ ref: 'japan-guide:e9', code: 'statusDenied' })
  s.incompleteReasons = [{ code: 'targetFetchFailed', count: 1 }]
  s.counters.catalogueTargetsFound += 1
})), 'complete')
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

/* ── Раздельные коды ролей сходятся с прежней причиной ────────────────── */

/*
 * Разделение кодов классификатора обязано остаться разделением КОДОВ.
 * Вывод причин неполноты фильтрует отказы по множеству структурных кодов;
 * забудь новый код в этом множестве — и структурный отказ молча стал бы
 * сетевым. Снимок сообщил бы «страницу не удалось получить» о странице,
 * которая была получена и разобрана. Проверяется каждый код по отдельности.
 */
for (const code of PAGE_ROLE_CODES) {
  const roleRejected = snapshot({
    incompleteReasons: [{ code: 'targetStructureMismatch', count: 1 }],
    rejected: { targets: [{ ref: 'japan-guide:e9', code }], cards: [], pois: [] },
    counters: { ...COUNTERS, catalogueTargetsFound: 2 },
  })
  t(`«${code}» — структурный отказ цели`, roleRejected.complete, false)
  assertDiscoverySnapshot(roleRejected); ok++
  /* Отказ обязан сказать РОВНО ТО, что нужно: по массивам отказов сетевых
     потерь НОЛЬ. Так проверяется, что код роли не утёк в сетевую причину. */
  throwsWith(`«${code}» не сходится с сетевой причиной`,
    () => assertDiscoverySnapshot(forgeFrom(roleRejected, (s) => {
      s.incompleteReasons = [{ code: 'targetFetchFailed', count: 1 }]
    })), '«targetFetchFailed» объявлено 1, а по массивам отказов 0')

  /* Отвергнутый объект обязан быть ДОСТИЖИМЫМ — иначе снимок откажет
     раньше, по сверке достижимости, и проверка причины ничего не скажет. */
  const roleRejectedPoi = snapshot({
    incompleteReasons: [{ code: 'poiStructureMismatch', count: 1 }],
    orderRecords: [poiOrderRecord('japan-guide:e2157', PAGE_DIGEST,
      ['japan-guide:e4000', 'japan-guide:e4001'], 'ranked')],
    rejected: { targets: [], cards: [], pois: [{ ref: 'japan-guide:e4001', code }] },
    counters: { ...COUNTERS, poisFound: 2, recordsAttempted: 2 },
  })
  t(`«${code}» — структурный отказ объекта`, roleRejectedPoi.complete, false)
  assertDiscoverySnapshot(roleRejectedPoi); ok++
}
t('все исходы классификатора — коды отказа страницы',
  PAGE_ROLE_CODES.every((code) => PAGE_REJECTION_CODES.includes(code)), true)
eq('и список исходов закрыт', [...PAGE_ROLE_CODES].sort(),
  ['containerTopologyAmbiguous', 'pageRoleAmbiguous', 'pageRoleUnknown'])
/* Противоречивая топология — структурный отказ, а не сетевой: иначе снимок
   утверждал бы, что страницу не удалось получить. */
t('противоречивая топология считается структурным отказом',
  PAGE_ROLE_CODES.includes('containerTopologyAmbiguous'), true)
/* На НЕПОЛНОМ снимке: там сверка «найдено = посещено = построено» не
   применяется и потому не прикрывает сверку счётчика записей. */
throwsWith('recordsBuilt обязан сходиться с числом записей',
  () => assertDiscoverySnapshot(forgeFrom(incompleteFull, (s) => { s.counters.recordsBuilt = 7 })))
throwsWith('у полного снимка найдено и посещено обязаны совпадать',
  () => assertDiscoverySnapshot(forgeSnapshot((s) => { s.counters.recordsAttempted = 0 })))

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
      collectionKind: 'ranked',
      items: [],
      orderDigest: poiOrderDigest('japan-guide:e2222', PAGE_DIGEST, [], 'ranked'),
    })
  })), 'множества обязаны совпадать')
throwsWith('объект вне порядка направления невозможен',
  () => assertDiscoverySnapshot(forgeSnapshot((s) => {
    s.orderRecords[0].order = ['japan-guide:e7777']
    s.orderRecords[0].orderDigest = poiOrderDigest('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e7777'])
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
    poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000'], 'ranked'),
    poiOrderRecord('japan-guide:e2222', PAGE_DIGEST, [], 'ranked'),
  ],
  counters: { ...COUNTERS, catalogueTargetsFound: 2, catalogueCollectionsFound: 2 },
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
/*
 * ОХВАТ ОПИСЫВАЕТ ФАКТ, а не просьбу оператора.
 *
 * Прогон 18.08 израсходовал 210 обменов и упал: `--limit 50` при 50 и менее
 * объектах давал `scope.kind = 'limited'` без причины `limitApplied`.
 * Правильное решение — не ослаблять контракт, а перестать называть
 * ограниченным обход, который ничего не потерял: такой снимок годится
 * основанием мониторинга, и запрещать ему это нельзя.
 *
 * Связь остаётся ДВУСТОРОННЕЙ, и обе стороны проверяются.
 */
throwsWith('ограниченный охват без причины невозможен',
  () => assertDiscoverySnapshot(forgeSnapshot((s) => {
    s.scope = { kind: 'limited', limit: 1 }
    s.complete = false
  })), 'без причины «limitApplied»')
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

for (const path of ['/e/e3034_001.html', '/e/e3034_006.html', '/e/e3034_999.html']) {
  t(`цифровой суффикс опознаётся: ${path}`, family(path), 'legacySuffix')
}
eq('цифровой суффикс целиком входит в ключ',
  ['/e/e3034_001.html', '/e/e3034_002.html', '/e/e3034_999.html'].map(key),
  ['japan-guide:e3034_001', 'japan-guide:e3034_002', 'japan-guide:e3034_999'])
t('цифровые суффиксы не слипаются',
  new Set(['/e/e3034_001.html', '/e/e3034_002.html'].map(key)).size, 2)

for (const path of [
  '/e/e3034_1.html',
  '/e/e3034_01.html',
  '/e/e3034_0001.html',
  '/e/e3034_a12.html',
  '/e/e3034_12a.html',
  '/e/e3034__001.html',
  '/e/e3034_ABC.html',
  '/e/e3034_001_more.html',
  '/e/e3034_001.HTML',
]) throwsWith(`цифровой суффикс отвергает ${path}`, () => canonicalDiscoveryUrl(path), 'pathDenied')

/* Расширение discovery-грамматики не меняет идентичность старых артефактов. */
throwsWith('canonicalPageUrl цифровой суффикс не принимает',
  () => canonicalPageUrl('/e/e3034_001.html'), 'pathDenied')
throwsWith('sourceKeyFromUrl цифровой суффикс не принимает',
  () => sourceKeyFromUrl(`${HOST}/e/e3034_001.html`), 'pathDenied')

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
/* Суффиксное семейство измерено 19.08: только объект. */
t('суффиксный адрес — своё семейство',
  matrixFamily(`${HOST}/e/e5036_fish.html`), 'legacySuffix')
eq('и допускает только poi', [...ROLES_BY_FAMILY.legacySuffix], ['poi'])

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
withRole(`${HOST}/e/e5036_fish.html`, 'poi')(); ok++
withRole(`${HOST}/e/e3034_001.html`, 'poi')(); ok++
throwsWith('суффиксный адрес не может быть коллекцией',
  withRole(`${HOST}/e/e5036_fish.html`, 'collection'))
throwsWith('цифровой суффикс не может быть коллекцией',
  withRole(`${HOST}/e/e3034_001.html`, 'collection'))
throwsWith('суффиксный адрес не может быть каталогом',
  withRole(`${HOST}/e/e5036_fish.html`, 'catalogue'))
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
  orderRecords: [poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000'], 'ranked')],
  counters: { ...COUNTERS, catalogueTargetsFound: 1, catalogueCollectionsFound: 1, directPoisFound: 0 },
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
    ...COUNTERS, catalogueTargetsFound: 1, catalogueCollectionsFound: 0, directPoisFound: 0,
    poisFound: 0, recordsAttempted: 0, recordsBuilt: 0,
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
  catalogueCollectionsFound: 777,
  directPoisFound: 666,
  poisFound: 555,
  recordsAttempted: 444,
  recordsBuilt: 0,
}
throwsWith('неполный снимок не принимает произвольные счётчики', () => snapshot({
  scope: { kind: 'limited', limit: 1 },
  incompleteReasons: [{ code: 'limitApplied', count: 1 }],
  records: [],
  orderRecords: [poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, [], 'ranked')],
  counters: wildCounters,
}))

/** Неполный снимок с внутренне согласованными счётчиками — основа для сверок. */
const incompleteBase = {
  scope: { kind: 'limited', limit: 1 },
  incompleteReasons: [{ code: 'limitApplied', count: 1 }],
  records: [],
  orderRecords: [poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, [], 'ranked')],
  counters: { ...COUNTERS, poisFound: 0, recordsAttempted: 0, recordsBuilt: 0 },
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
  counters: { ...incompleteBase.counters, catalogueCollectionsFound: 0 },
}), 'не сходится с ролями')
throwsWith('и счётчик вложенных коллекций тоже', () => snapshot({
  ...incompleteBase,
  counters: { ...incompleteBase.counters, nestedCollectionsFound: 2 },
}), 'nestedCollectionsFound')
throwsWith('poisFound обязан сходиться с достижимыми', () => snapshot({
  ...incompleteBase,
  counters: { ...incompleteBase.counters, poisFound: 4 },
}), 'poisFound')
throwsWith('recordsBuilt обязан сходиться с записями', () => snapshot({
  ...incompleteBase,
  counters: { ...incompleteBase.counters, recordsBuilt: 2 },
}), 'recordsBuilt')
throwsWith('recordsAttempted обязан сходиться с исходом', () => snapshot({
  ...incompleteBase,
  counters: { ...incompleteBase.counters, recordsAttempted: 2 },
}), 'recordsAttempted')
/*
 * Отвергнутые объекты обязаны быть НАЙДЕНЫ, поэтому оба ключа лежат в
 * порядке. А «посетить больше, чем нашли» после этого недостижимо:
 * посещение пришпилено к сумме «записи + отказы», обе части обязаны быть
 * достижимы и не пересекаться, значит посещение НИКОГДА не превысит
 * найденное. Проверка-сравнение снята из контракта как мёртвая; здесь
 * испытывается то, что теперь ловит этот случай.
 */
throwsWith('число попыток обязано сходиться с исходом', () => snapshot({
  ...incompleteBase,
  incompleteReasons: [
    { code: 'limitApplied', count: 1 },
    { code: 'poiStructureMismatch', count: 2 },
  ],
  orderRecords: [poiOrderRecord(
    'japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e5001', 'japan-guide:e5002'], 'ranked')],
  rejected: {
    targets: [],
    cards: [],
    pois: [
      /* Код СТРУКТУРНЫЙ: у `v3` отказ объекта иным быть не может — страница
         объекта к этому месту уже получена. */
      { ref: 'japan-guide:e5001', code: 'structureMismatch' },
      { ref: 'japan-guide:e5002', code: 'structureMismatch' },
    ],
  },
  counters: { ...incompleteBase.counters, poisFound: 2, recordsAttempted: 3 },
}), 'попытки обязаны сходиться с исходом')

/*
 * А сетевой отказ ОБЪЕКТА в `v3` непредставим: страница объекта получена
 * раньше, на классификации, и страница без байтов роли не получает вовсе.
 *
 * Дыра, которую закрывает эта проверка, ровно такая: сетевой код у отказа
 * объекта не выводит В `v3` НИ ОДНОЙ причины неполноты — `poiFetchFailed`
 * из его словаря убран. Значит снимок с потерянной страницей объявил бы
 * себя без единой причины, и сверка причин его пропустила бы. Поэтому
 * фикстура причин и не объявляет: они и не должны выводиться.
 */
throwsWith('сетевой отказ объекта в v3 невозможен', () => snapshot({
  ...incompleteBase,
  incompleteReasons: [{ code: 'limitApplied', count: 1 }],
  orderRecords: [poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e5001'], 'ranked')],
  rejected: { targets: [], cards: [], pois: [{ ref: 'japan-guide:e5001', code: 'statusDenied' }] },
  counters: { ...incompleteBase.counters, poisFound: 1, recordsAttempted: 1 },
}), 'знает у объекта только структурные отказы')

/* Одна цель не может быть и наблюдена, и отвергнута. */
throwsWith('цель одновременно наблюдена и отвергнута невозможна', () => snapshot({
  ...incompleteBase,
  incompleteReasons: [
    { code: 'limitApplied', count: 1 },
    { code: 'targetFetchFailed', count: 1 },
  ],
  rejected: {
    targets: [{ ref: 'japan-guide:e2157', code: 'statusDenied' }],
    cards: [],
    pois: [],
  },
  counters: { ...incompleteBase.counters, catalogueTargetsFound: 2 },
}), 'одновременно наблюдена и отвергнута')
throwsWith('одна цель отвергнута дважды невозможна', () => snapshot({
  ...incompleteBase,
  incompleteReasons: [
    { code: 'limitApplied', count: 1 },
    { code: 'targetFetchFailed', count: 2 },
  ],
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

/* ── Аудит 10c-T: две версии формата, и они не смешиваются ──────────────
 * P1 аудита: новые состояния были добавлены в закрытые перечисления, а
 * версия осталась `v1` — два несовместимых формата назывались одним именем. */

/* Запись НЕ поднята до v3: её формат не менялся, а поднятая версия объявила
   бы несовместимыми байты, которые совпадают. */
t('текущая версия записи — v2', DISCOVERY_RECORD_SPEC, 'poi-discovery-record/v2')
t('текущая версия порядка — v3', ORDER_SPEC, 'poi-discovery-order/v3')
t('текущая версия снимка — v3', SNAPSHOT_SPEC, 'poi-discovery-snapshot/v3')
t('подсказка осталась v1', FACT_LEAD_SPEC, 'poi-fact-lead/v1')
eq('перечисление v1 заморожено', [...PLACEMENT_KINDS_V1], ['catalogueDirect', 'destinationRanking'])
t('и не знает containerChild', PLACEMENT_KINDS_V1.includes('containerChild'), false)
t('а v2 знает', PLACEMENT_KINDS.includes('containerChild'), true)
/* Отдельных исходов классификатора у v1 не было: то, что он знал о кодах
   отказа, целиком лежит в политике и проверяется ниже. */
t('обе версии записи читаются', READABLE_RECORD_SPECS.length, 2)

/* Запись v1 проверяется ПРАВИЛАМИ v1: вид из v2 в ней невозможен. */
const containerRecord = buildDiscoveryRecord({
  sourceKey: 'japan-guide:e4000',
  url: `${HOST}/e/e4000.html`,
  nameEn: 'Container Child',
  placements: [buildPlacement({
    kind: 'containerChild',
    collectionSourceKey: 'japan-guide:e2157',
    listPosition: null,
    editorialLevel: null,
    categoryHint: null,
  })],
  factLeads: [],
  omissions: [],
  pageEvidence: evidence({ url: `${HOST}/e/e4000.html`, pageRole: 'poi' }),
})
assertDiscoveryRecord(containerRecord); ok++
t('построенная запись объявляет v2', containerRecord.contractVersion, DISCOVERY_RECORD_SPEC)
throwsWith('та же запись под именем v1 отвергается',
  () => assertDiscoveryRecord(JSON.parse(JSON.stringify({
    ...containerRecord, contractVersion: DISCOVERY_RECORD_SPEC_V1,
  }))), 'kind')

/* Домены отпечатков выведены из версии: байты v1 и v2 не совпадают. */
t('отпечаток порядка зависит от версии',
  poiOrderDigest('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000'])
  !== poiOrderDigest('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000'], 'ranked'), true)
t('и от вида коллекции тоже',
  poiOrderDigest('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000'], 'ranked')
  !== poiOrderDigest('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000'], 'container'), true)

/* ── Происхождение containerChild проверяемо из снимка ──────────────────
 * P1 аудита: подделка проходила. Здесь она обязана быть отвергнута. */
const containerSnapshot = snapshot({
  orderRecords: [poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000'], 'container')],
  records: [containerRecord],
})
assertDiscoverySnapshot(containerSnapshot); ok++
t('вид коллекции записан в порядке',
  containerSnapshot.orderRecords[0].collectionKind, 'container')
throwsWith('containerChild при ранжированной коллекции отвергнут',
  () => assertDiscoverySnapshot(forgeFrom(containerSnapshot, (s) => {
    const row = s.orderRecords[0]
    row.collectionKind = 'ranked'
    row.orderDigest = poiOrderDigest(
      row.destinationSourceKey, row.sourcePageDigest, orderedPoiKeys(row), 'ranked')
  })), 'вид размещения')
throwsWith('и подмена вида коллекции без пересчёта тоже',
  () => assertDiscoverySnapshot(forgeFrom(containerSnapshot, (s) => {
    s.orderRecords[0].collectionKind = 'ranked'
  })), 'orderDigest')
throwsWith('destinationRanking при контейнерной коллекции отвергнут',
  () => assertDiscoverySnapshot(forgeFrom(snapshot(), (s) => {
    const row = s.orderRecords[0]
    row.collectionKind = 'container'
    row.orderDigest = poiOrderDigest(
      row.destinationSourceKey, row.sourcePageDigest, orderedPoiKeys(row), 'container')
  })), 'вид размещения')
throwsWith('выдуманный вид коллекции отвергнут',
  () => poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, [], 'умеренный'), 'collectionKind')

/* ── Аудит 10c-T-3: v1 заморожен ПО-НАСТОЯЩЕМУ ──────────────────────────
 * P1: снимок `v1` принимал записи `v2` и коды отказа `v2`. «Заморожен» —
 * это и значит, что внутрь не попадает ничего из более поздней версии. */

/* Списки v1 сняты с опубликованного bd8ebe6, а не выведены. */
const V1 = VERSION_POLICY['poi-discovery-snapshot/v1']
const V2 = VERSION_POLICY['poi-discovery-snapshot/v2']
const V3 = VERSION_POLICY['poi-discovery-snapshot/v3']
eq('v1 знал ровно два вида размещения', [...V1.placementKinds],
  ['catalogueDirect', 'destinationRanking'])
eq('v1 знал ровно пять кодов omission', [...V1.omissionCodes],
  ['leadValueTooLong', 'componentNameTooLong', 'categoryHintTooLong',
    'nonWhitelistedCodepoint', 'ambiguousValueBoundary'])
eq('v1 знал ровно три семейства адресов', [...V1.urlFamilies],
  ['legacy', 'destinationRoot', 'destinationNested'])
t('v1 не знал исходов классификатора отдельными кодами',
  V1.pageRejectionCodes.some((code) => code.startsWith('pageRole')), false)
t('и не знал исхода контейнера',
  V1.pageRejectionCodes.includes('containerTopologyAmbiguous'), false)
t('v1 знал общий structureMismatch',
  V1.pageRejectionCodes.includes('structureMismatch'), true)
t('кодов отказа страницы в v1 было 22', V1.pageRejectionCodes.length, 22)
t('вид коллекции в v1 не существовал', V1.collectionKind, false)
t('а в v2 существует', V2.collectionKind, true)

/*
 * ПОЛИТИКА ОДНА — И КАЖДОЕ ЕЁ ПОЛЕ ЧТО-ТО РЕШАЕТ.
 *
 * Рядом стояли параллельные реестры версий: две таблицы «по версии» и три
 * ручных списка читаемых версий. Такой реестр расходится с политикой молча.
 * Текстовый запрет `_BY_SPEC`, стоявший здесь, ничего не доказывал: он не
 * ловил ни ручные списки, ни поле политики, которое НИКТО НЕ ЧИТАЕТ.
 * Единственность источника доказывается мутацией самой политики — каждое её
 * поле испорчено по очереди в `tmp/jj10c-mutations.json`, и каждая порча
 * обязана уронить набор. Здесь проверяется состав и происхождение.
 */
const POLICY_FIELDS = [
  'cardRejectionCodes', 'collectionKind', 'counterKeys', 'everyClassifiedPageFetched',
  'incompleteReasons',
  'omissionCodes', 'order', 'orderKeys', 'pageRejectionCodes', 'placementKinds',
  'preNetworkRejectionCodes',
  'record', 'rejectionChannels', 'snapshot', 'snapshotKeys', 'urlFamilies',
]
eq('политика версии перечисляет все закрытые наборы', Object.keys(V1).sort(), POLICY_FIELDS)
eq('и для v2 состав тот же', Object.keys(V2).sort(), POLICY_FIELDS)
eq('и для v3 тоже', Object.keys(V3).sort(), POLICY_FIELDS)

/*
 * КЛАССИФИКАЦИЯ ОТКАЗОВ ПО СТАДИИ — ПОЛЕ ПОЛИТИКИ, А НЕ ГЛОБАЛЬНАЯ ФУНКЦИЯ.
 *
 * У замороженных версий границы обменов нет, поэтому нет и классификации, и
 * это `null`, а не пустая таблица: пустая означала бы «все отказы после
 * обмена», то есть действующее правило, применённое задним числом.
 */
t('у v1 классификации отказов по стадии нет', V1.preNetworkRejectionCodes, null)
t('у v2 тоже нет', V2.preNetworkRejectionCodes, null)
t('а у v3 она есть и она поканальная',
  Object.keys(V3.preNetworkRejectionCodes ?? {}).sort().join(','), 'nodes,targets')
t('и объявлена ровно для тех каналов, у которых бывает своя страница',
  V3.rejectionChannels.filter((channel) => channel in V3.preNetworkRejectionCodes).length, 2)

/* ── v3: граф коллекций ────────────────────────────────────────────────── */

t('формат записи v3 совпадает с v2 — запись не менялась', V3.record, DISCOVERY_RECORD_SPEC_V2)
t('а формат порядка у v3 свой', V3.order, ORDER_SPEC_V3)
eq('порядок v3 хранит одну дискриминированную последовательность',
  [...V3.orderKeys],
  ['destinationSourceKey', 'sourcePageDigest', 'collectionKind', 'items', 'orderDigest'])
t('и параллельного поля order у него нет', V3.orderKeys.includes('order'), false)
t('канал отказа узла есть только у v3', V3.rejectionChannels.includes('nodes'), true)
t('у v2 его нет', V2.rejectionChannels.includes('nodes'), false)
t('у v1 тоже нет', V1.rejectionChannels.includes('nodes'), false)
t('свидетельство вложенных коллекций есть только у v3',
  V3.snapshotKeys.includes('nestedCollectionEvidence'), true)
t('у v2 его нет', V2.snapshotKeys.includes('nestedCollectionEvidence'), false)
eq('счётчики v3 различают коллекции по происхождению',
  V3.counterKeys.filter((key) => key.toLowerCase().includes('collections')),
  ['catalogueCollectionsFound', 'nestedCollectionsFound'])
t('двусмысленное общее имя в v3 не перенесено',
  V3.counterKeys.includes('collectionsFound'), false)
t('а у замороженных версий оно осталось', V2.counterKeys.includes('collectionsFound'), true)
t('код противоречия роли и семейства есть только у v3',
  V3.pageRejectionCodes.includes(ROLE_FAMILY_MISMATCH_CODE), true)
t('у v2 его нет', V2.pageRejectionCodes.includes(ROLE_FAMILY_MISMATCH_CODE), false)
eq('и он же — весь прирост списка кодов',
  V3.pageRejectionCodes.filter((code) => !V2.pageRejectionCodes.includes(code)),
  [ROLE_FAMILY_MISMATCH_CODE])
eq('перечисление кодов v3 выведено, а не набрано',
  [...PAGE_REJECTION_CODES_V3], [...V3.pageRejectionCodes])
t('противоречие роли считается структурным отказом',
  isStructureRejection(ROLE_FAMILY_MISMATCH_CODE), true)
t('а сетевой код — нет', isStructureRejection('statusDenied'), false)

/* Роли элемента порядка ВЫВЕДЕНЫ из ролей страницы, а не набраны рядом. */
eq('роль ниже каталога — это роль страницы без каталога',
  [...NON_CATALOGUE_ROLES], ['collection', 'poi'])

/* Читаемые версии ВЫВЕДЕНЫ из политики, а не набраны рядом с ней. */
eq('читаемые версии снимка выведены из политики', [...READABLE_SNAPSHOT_SPECS],
  Object.values(VERSION_POLICY).map((policy) => policy.snapshot))
/* Форматов ЗАПИСИ меньше, чем форматов снимка: `v3` ссылается на запись `v2`,
   потому что она не менялась. Список читаемых версий записи поэтому — набор,
   а не отображение; и то, что два формата снимка не разошлись в правилах для
   общей записи, обеспечено сборкой указателя, а не совпадением. */
eq('читаемые версии записи выведены из политики', [...READABLE_RECORD_SPECS],
  [...new Set(Object.values(VERSION_POLICY).map((policy) => policy.record))])
t('и один формат записи разделён двумя форматами снимка',
  READABLE_RECORD_SPECS.length < READABLE_SNAPSHOT_SPECS.length, true)
eq('читаемые версии порядка выведены из политики', [...READABLE_ORDER_SPECS],
  Object.values(VERSION_POLICY).map((policy) => policy.order))

/* Снимок, объявленный v1, но с записью v2 — отказ. */
const v1WithV2Record = asV1Shape(snapshot())
throwsWith('снимок v1 не принимает запись v2',
  () => assertDiscoverySnapshot(v1WithV2Record), 'версия записи')

/* Снимок, объявленный v1, но с кодом отказа v2 — отказ. */
const v1WithV2CodeBase = snapshot({
  incompleteReasons: [{ code: 'targetStructureMismatch', count: 1 }],
  rejected: { targets: [{ ref: 'japan-guide:e9999', code: 'containerTopologyAmbiguous' }], cards: [], pois: [] },
  counters: { ...COUNTERS, catalogueTargetsFound: 2 },
})
const v1WithV2Code = asV1Shape(v1WithV2CodeBase)
for (const row of v1WithV2Code.records) row.contractVersion = 'poi-discovery-record/v1'
throwsWith('снимок v1 не принимает код отказа v2',
  () => assertDiscoverySnapshot(v1WithV2Code), 'ожидается одно из')

/* ── Настоящая v1-фикстура из опубликованного bd8ebe6 ────────────────────
 * Построена ОПУБЛИКОВАННЫМ строителем: `git archive bd8ebe6` распакован вне
 * рабочего дерева, снимок собран его собственным `buildDiscoverySnapshot`.
 * Прошлый раз я заявил, что строителя v1 нет, — это было неверно. */

const V1_FIXTURE = JSON.parse(readFileSync(
  new URL('./fixtures/discovery/v1-snapshot.json', import.meta.url), 'utf8'))
t('фикстура объявляет снимок v1', V1_FIXTURE.contractVersion, 'poi-discovery-snapshot/v1')
t('и запись v1', V1_FIXTURE.records[0].contractVersion, 'poi-discovery-record/v1')
t('порядок в ней без вида коллекции',
  Object.prototype.hasOwnProperty.call(V1_FIXTURE.orderRecords[0], 'collectionKind'), false)
assertDiscoverySnapshot(V1_FIXTURE); ok++

/* ── v1 ОТВЕРГАЕТ каждое состояние, которого не знал ──────────────────────
 *
 * ПОДДЕЛКИ НЕ ПРАВЯТСЯ РУКАМИ.
 *
 * Правка готового снимка ломает отпечаток, и такой снимок отвергается
 * ОТПЕЧАТКОМ, а не версией: снять версионную проверку — тест всё равно
 * красный, только на другой строке. Проверялось бы не то, что заявлено.
 *
 * Поэтому каждая подделка ПОСТРОЕНА строителями `bd8ebe6`: копия коммита с
 * ОДНОЙ точечной заплатой в перечислении `v1` — ровно на то состояние,
 * которого у `v1` не было. Отпечатки посчитаны доменами `v1` и сходятся,
 * причины неполноты сведены к текущему выводу. Единственное, что стоит
 * между такой подделкой и приёмом, — проверка версии формата. Генератор:
 * `README-v1-snapshot.mjs.txt` рядом с фикстурой.
 */

const FORGERIES = JSON.parse(readFileSync(
  new URL('./fixtures/discovery/v1-forgeries.json', import.meta.url), 'utf8'))
t('подделки построены опубликованным коммитом', FORGERIES.builtFrom, 'bd8ebe6')
const forgery = (name) => {
  const row = FORGERIES.variants.find((variant) => variant.name === name)
  if (!row) throw new Error(`в фикстуре подделок нет варианта ${name}`)
  return row.snapshot
}
t('и все объявляют себя снимком v1',
  FORGERIES.variants.every((row) => row.snapshot.contractVersion === 'poi-discovery-snapshot/v1'), true)

/*
 * ЗАКОННЫЙ v1 С ОТВЕРГНУТОЙ КАРТОЧКОЙ — ПРИНИМАЕТСЯ.
 *
 * Коды отказа карточек у обеих версий совпадают, подделывать нечего. Без
 * этого снимка поле `cardRejectionCodes` в политике `v1` не читала бы ни
 * одна проверка: его можно было опустошить, и ни один тест бы не покраснел
 * — ровно этот контрпример и был предъявлен. Снимок собран строителями
 * `bd8ebe6` БЕЗ заплат, поэтому обязан приниматься как есть.
 */
const legitimateV1 = forgery('cardRejected')
const variantOf = (name) => FORGERIES.variants.find((row) => row.name === name)
t('законный снимок v1 обязан приниматься', variantOf('cardRejected').verdict, 'accept')
t('и собран НЕТРОНУТЫМ строителем bd8ebe6', variantOf('cardRejected').patched, false)
t('и несёт отвергнутую карточку', legitimateV1.rejected.cards.length, 1)
assertDiscoverySnapshot(legitimateV1); ok++

/* Ожидается ТОЧНОЕ место отказа, а не слово «ожидается»: общий обрывок
   совпал бы и с отказом по совсем другой причине. */
const V1_REFUSALS = [
  ['pageRoleAmbiguous', 'poi-discovery-snapshot/v1.rejected.targets[0].code'],
  ['pageRoleUnknown', 'poi-discovery-snapshot/v1.rejected.targets[0].code'],
  ['containerTopologyAmbiguous', 'poi-discovery-snapshot/v1.rejected.targets[0].code'],
  ['unknownAdmissionLabel', 'poi-discovery-record/v1.omissions[0].code'],
  ['containerChild', 'poi-discovery-record/v1.placements[0].kind'],
  /* Ключ записи лежит в порядке коллекции, поэтому семейство ловится РАНЬШЕ —
     обратным разбором ключа. Проверка у самой записи испытывается ниже,
     прямым вызовом `assertDiscoveryRecord`. */
  ['legacySuffix',
    'poi-discovery-snapshot/v1.orderRecords[].order[0]: семейство «legacySuffix» '
    + 'формату poi-discovery-order/v1'],
  /* Адрес нового семейства у ЦЕЛИ, а не у записи. Охват ограниченный:
     цель найдена, записи у неё нет — и проверка семейства у записи такую
     подделку не видит вовсе. */
  ['targetEvidenceLegacySuffix',
    'poi-discovery-snapshot/v1.catalogueTargetEvidence[japan-guide:e5036_fish].evidence.url: '
    + 'семейство «legacySuffix»'],
  ['collectionKind', 'poi-discovery-snapshot/v1.orderRecords[]: лишние поля collectionKind'],
  /*
   * ЧЕТЫРЕ СНИМКА, КОТОРЫЕ ОПУБЛИКОВАННЫЙ v1 ПРИНИМАЛ САМ (`patched: false`).
   *
   * Здесь от страницы остался ОДИН КЛЮЧ и никакого адреса, а такие поля не
   * проверялись ничем, кроме формы строки. Это не подделки версии, а дыры в
   * связности — и закрывать их нужно для ОБОИХ форматов, поэтому ниже
   * отдельно проверено, что `v2` их тоже не принимает.
   */
  ['orderLegacySuffix',
    'poi-discovery-snapshot/v1.orderRecords[].order[1]: семейство «legacySuffix» '
    + 'формату poi-discovery-order/v1'],
  ['failedTargetLegacySuffix',
    'poi-discovery-snapshot/v1.rejected.targets[0].ref: семейство «legacySuffix»'],
  ['orphanCardRejection',
    'rejected.cards: карточка отвергнута у japan-guide:e9999, но коллекции с таким ключом снимок не наблюдал'],
  ['orphanPoiRejection',
    'rejected.pois: объект japan-guide:e9999 отвергнут, но снимок его не находил'],
]
for (const [name, place] of V1_REFUSALS) {
  throwsWith(`v1 отвергает ${name}`, () => assertDiscoverySnapshot(forgery(name)), place)
}

/* ── Обратный разбор ключа: круг обязан ЗАМЫКАТЬСЯ ───────────────────────
 *
 * Семейство ключа выводится сборкой кандидат-адреса и прогоном его через ту
 * же грамматику. Без сверки результата с ИСХОДНЫМ ключом разбор принимал бы
 * всё, что грамматика хоть как-то разобрала: `…e5036_fish/../e4000`
 * нормализуется браузерным `URL` в `/e/e4000.html`, то есть ключ чужого вида
 * выдавал бы себя за законное семейство `legacy`. */

eq('ключи известных форм разбираются', [
  sourceKeyFamily('japan-guide:e4000'),
  sourceKeyFamily('japan-guide:e5036_fish'),
  sourceKeyFamily('japan-guide:destinations:kyoto'),
  sourceKeyFamily('japan-guide:destinations:kyoto:kinkakuji'),
].map((row) => row.family), ['legacy', 'legacySuffix', 'destinationRoot', 'destinationNested'])
for (const bogus of [
  'japan-guide:e5036_fish/../e4000',
  'japan-guide:destinations:kyoto/..',
  'japan-guide:E4000',
  'japan-guide:e4000.html',
  'japan-guide:',
  'other:e4000',
  'https://www.japan-guide.com/e/e4000.html',
]) {
  t(`ключ ${bogus} не разбирается`, sourceKeyFamily(bogus).ok, false)
}

/* ── Публичная граница порядка не слабее снимка ───────────────────────────
 *
 * Проверка семейства жила только внутри `assertDiscoverySnapshot`, и сам
 * `assertOrderRecord` принимал любой непустой ключ: `buildOrderRecord`
 * возвращал порядок, который проверка снимка тут же отвергала. Строитель,
 * отдающий заведомо негодное, — это не «проверим позже», а ложное «годно».
 * Оба случая испытываются БЕЗ снимка: там ни свидетельств целей, ни записей,
 * и ловить семейство больше нечем.
 */
throwsWith('самостоятельный порядок v1 отвергает legacySuffix',
  () => assertOrderRecord(
    forgery('orderLegacySuffix').orderRecords[0],
    'poi-discovery-order/v1',
    'poi-discovery-order/v1',
  ),
  'poi-discovery-order/v1.order[1]: семейство «legacySuffix» формату poi-discovery-order/v1')

throwsWith('строитель v2 отвергает неканонический ключ порядка',
  () => poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, ['not-a-source-key'], 'ranked'),
  '"not-a-source-key" не выводится ни из одного канонического адреса')

throwsWith('строитель v2 отвергает неканоническое направление',
  () => poiOrderRecord('not-a-source-key', PAGE_DIGEST, ['japan-guide:e4000'], 'ranked'),
  'destinationSourceKey: "not-a-source-key" не выводится ни из одного канонического адреса')

/* ── КАНОНИЧНОСТЬ КЛЮЧА — ЕЩЁ НЕ ЕГО РОЛЬ ────────────────────────────────
 *
 * У ключа есть позиция, и позиция требует роли. Синтаксически безупречный
 * ключ вставал направлением, будучи измеренным только как объект, а точка
 * входа — и направлением, и элементом порядка, будучи каталогом. Снимок
 * такой порядок отвергал по свидетельствам ролей, то есть строитель отдавал
 * заведомо негодное. Матрица одна — `ROLES_BY_FAMILY`, та же, что у
 * свидетельств; вход отделён от прочего `legacy` тем же правилом, что в
 * `matrixFamily`. */

throwsWith('legacySuffix не может быть направлением',
  () => poiOrderRecord('japan-guide:e5036_fish', PAGE_DIGEST, ['japan-guide:e4000'], 'ranked'),
  'japan-guide:e5036_fish не может быть «collection» — семейство «legacySuffix» допускает [poi]')

throwsWith('destinationNested не может быть направлением',
  () => poiOrderRecord('japan-guide:destinations:kyoto:kinkakuji', PAGE_DIGEST, ['japan-guide:e4000'], 'ranked'),
  'не может быть «collection» — семейство «destinationNested» допускает [poi]')

throwsWith('точка входа не может быть направлением',
  () => poiOrderRecord(CATALOGUE_SOURCE_KEY, PAGE_DIGEST, ['japan-guide:e4000'], 'ranked'),
  `${CATALOGUE_SOURCE_KEY} не может быть «collection» — семейство «catalogueEntry» допускает [catalogue]`)

throwsWith('точка входа не может лежать в порядке',
  () => poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, [CATALOGUE_SOURCE_KEY], 'ranked'),
  `items[0].sourceKey: ${CATALOGUE_SOURCE_KEY} не может быть «poi» — `
  + 'семейство «catalogueEntry» допускает [catalogue]')

/* Та же матрица работает и на РОЛЬ ЭЛЕМЕНТА: коллекцией внутри порядка не
   может стать адрес, измеренный только как объект. Без этого граф принимал
   бы ребро в страницу, которой коллекцией быть неоткуда. */
throwsWith('элемент-коллекция не может быть суффиксным адресом',
  () => buildOrderRecord({
    destinationSourceKey: 'japan-guide:e2157',
    sourcePageDigest: PAGE_DIGEST,
    collectionKind: 'ranked',
    items: [orderItem('collection', 'japan-guide:e3034_001')],
  }),
  'japan-guide:e3034_001 не может быть «collection» — семейство «legacySuffix» допускает [poi]')
throwsWith('и вложенным адресом направления тоже',
  () => buildOrderRecord({
    destinationSourceKey: 'japan-guide:e2157',
    sourcePageDigest: PAGE_DIGEST,
    collectionKind: 'ranked',
    items: [orderItem('collection', 'japan-guide:destinations:kyoto:kinkakuji')],
  }),
  'не может быть «collection» — семейство «destinationNested» допускает [poi]')
throwsWith('роль элемента вне закрытого перечисления невозможна',
  () => orderItem('каталог', 'japan-guide:e4000'), 'role')
throwsWith('элемент без роли невозможен',
  () => buildOrderRecord({
    destinationSourceKey: 'japan-guide:e2157',
    sourcePageDigest: PAGE_DIGEST,
    collectionKind: 'ranked',
    items: [{ sourceKey: 'japan-guide:e4000' }],
  }), 'role')

/* Положительная сторона: КАЖДОЕ семейство, которому роль разрешена,
   принимается. Без этого проверка роли могла бы запрещать вообще всё. */
for (const [family, key] of [
  ['legacy', 'japan-guide:e2157'],
  ['destinationRoot', 'japan-guide:destinations:kyoto'],
]) {
  t(`направление вида ${family} принимается`,
    poiOrderRecord(key, PAGE_DIGEST, [], 'ranked').destinationSourceKey, key)
}
for (const [family, key] of [
  ['legacy', 'japan-guide:e4000'],
  ['legacySuffix', 'japan-guide:e3034_001'],
  ['destinationRoot', 'japan-guide:destinations:kyoto'],
  ['destinationNested', 'japan-guide:destinations:kyoto:kinkakuji'],
]) {
  eq(`объект вида ${family} принимается в порядке`,
    orderedPoiKeys(poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, [key], 'ranked')), [key])
}
/* И каждое семейство, которому разрешена роль коллекции, принимается ею. */
for (const [family, key] of [
  ['legacy', 'japan-guide:e2157'],
  ['destinationRoot', 'japan-guide:destinations:kyoto'],
]) {
  const row = buildOrderRecord({
    destinationSourceKey: 'japan-guide:e2222',
    sourcePageDigest: PAGE_DIGEST,
    collectionKind: 'ranked',
    items: [orderItem('collection', key)],
  })
  eq(`коллекция вида ${family} принимается элементом порядка`,
    orderedCollectionKeys(row), [key])
  eq('и объектом при этом не считается', orderedPoiKeys(row), [])
}

/* ── Те же связи, но в ТЕКУЩЕМ формате ────────────────────────────────────
 *
 * Дыры в связности — не свойство `v1`: `v2` их наследовал слово в слово.
 * Поэтому каждая проверена и на текущем формате, своим отдельным случаем. */

throwsWith('v2: ключ порядка обязан выводиться из канонического адреса', () => snapshot({
  orderRecords: [poiOrderRecord(
    'japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000', 'japan-guide:НЕ-КЛЮЧ'], 'ranked')],
}), 'не выводится ни из одного канонического адреса')

throwsWith('v2: карточка отвергнута у ненаблюдённой коллекции', () => snapshot({
  incompleteReasons: [{ code: 'cardRejected', count: 1 }],
  rejected: {
    targets: [],
    cards: [{ destination: 'japan-guide:e9999', position: 1, code: 'rankRepeated' }],
    pois: [],
  },
}), 'коллекции с таким ключом снимок не наблюдал')

throwsWith('v2: одна позиция коллекции отвергнута дважды', () => snapshot({
  incompleteReasons: [{ code: 'cardRejected', count: 2 }],
  rejected: {
    targets: [],
    cards: [
      { destination: 'japan-guide:e2157', position: 1, code: 'rankEmpty' },
      { destination: 'japan-guide:e2157', position: 1, code: 'rankRepeated' },
    ],
    pois: [],
  },
}), 'отвергнута дважды')

throwsWith('v2: отвергнут объект, которого снимок не находил', () => snapshot({
  incompleteReasons: [{ code: 'poiStructureMismatch', count: 1 }],
  rejected: { targets: [], cards: [], pois: [{ ref: 'japan-guide:e9999', code: 'structureMismatch' }] },
  counters: { ...COUNTERS, recordsAttempted: 2 },
}), 'снимок его не находил')

throwsWith('v2: один объект отвергнут дважды', () => snapshot({
  incompleteReasons: [{ code: 'poiStructureMismatch', count: 2 }],
  rejected: {
    targets: [],
    cards: [],
    pois: [
      { ref: 'japan-guide:e4000', code: 'structureMismatch' },
      { ref: 'japan-guide:e4000', code: 'structureMismatch' },
    ],
  },
  counters: { ...COUNTERS, recordsAttempted: 3 },
}), 'один объект отвергнут дважды')

throwsWith('v2: объект одновременно записан и отвергнут', () => snapshot({
  incompleteReasons: [{ code: 'poiStructureMismatch', count: 1 }],
  rejected: { targets: [], cards: [], pois: [{ ref: 'japan-guide:e4000', code: 'structureMismatch' }] },
  counters: { ...COUNTERS, recordsAttempted: 2 },
}), 'одновременно записан и отвергнут')

/* Проверка семейства У САМОЙ ЗАПИСИ — отдельной поверхностью.
   `assertDiscoveryRecord` публична и вызывается без снимка; там ни порядка,
   ни свидетельств целей нет, и ловить семейство больше нечем. */
throwsWith('v1-запись сама по себе отвергает семейство legacySuffix',
  () => assertDiscoveryRecord(forgery('legacySuffix').records[0]),
  'poi-discovery-record/v1.url: семейство «legacySuffix»')

/* Подделка цели ограничена по охвату — и это законная часть снимка, а не
   лазейка: без ограниченного охвата цель без записи в снимок не попадает. */
const suffixTargetSnapshot = forgery('targetEvidenceLegacySuffix')
t('подделка цели объявляет ограниченный охват', suffixTargetSnapshot.scope.kind, 'limited')
t('и запись в ней остаётся законной legacy',
  suffixTargetSnapshot.records[0].url, `${HOST}/e/e4000.html`)
t('счётчик целей сходится с числом свидетельств',
  suffixTargetSnapshot.counters.catalogueTargetsFound,
  suffixTargetSnapshot.catalogueTargetEvidence.length)

/* ── ВЕРСИЯ ЧИТАЕТСЯ КАК ДАННЫЕ, А НЕ ВЫЗОВОМ accessor ───────────────────
 *
 * `value.contractVersion` запускает геттер: подсунутый объект исполняет свой
 * код внутри валидатора — раньше любой проверки, и волен отдавать `v1`
 * проверяющему и `v2` потребителю. Ниже геттер СЧИТАЕТ свои вызовы: их
 * обязано быть ноль, а отказ обязан прийти от валидатора. */

const withVersionGetter = (sample) => {
  const calls = { count: 0 }
  const copy = { ...sample }
  delete copy.contractVersion
  Object.defineProperty(copy, 'contractVersion', {
    get() {
      calls.count += 1
      return sample.contractVersion
    },
    enumerable: true,
    configurable: true,
  })
  return { copy, calls }
}

const recordGetter = withVersionGetter(JSON.parse(JSON.stringify(legitimateV1.records[0])))
throwsWith('запись с accessor-версией отвергнута',
  () => assertDiscoveryRecord(recordGetter.copy), 'описано accessor')
t('и геттер записи не исполнялся', recordGetter.calls.count, 0)

const snapshotGetter = withVersionGetter(JSON.parse(JSON.stringify(legitimateV1)))
throwsWith('снимок с accessor-версией отвергнут',
  () => assertDiscoverySnapshot(snapshotGetter.copy), 'описано accessor')
t('и геттер снимка не исполнялся', snapshotGetter.calls.count, 0)

/* Тот же omission в v2 — законен: заморожен именно v1, а не развитие. */
const v2WithOmission = snapshot({
  records: [buildDiscoveryRecord({
    sourceKey: 'japan-guide:e4000',
    url: `${HOST}/e/e4000.html`,
    nameEn: 'Object',
    placements: [buildPlacement({
      kind: 'destinationRanking', collectionSourceKey: 'japan-guide:e2157',
      listPosition: 1, editorialLevel: 0, categoryHint: null,
    })],
    factLeads: [],
    omissions: [buildOmission({
      code: 'unknownAdmissionLabel', locator: 'hours_fees_block', originalLengthBytes: 7,
    })],
    pageEvidence: evidence({ url: `${HOST}/e/e4000.html`, pageRole: 'poi' }),
  })],
})
assertDiscoverySnapshot(v2WithOmission); ok++


/* ══ v3: ГРАФ КОЛЛЕКЦИЙ В СНИМКЕ ════════════════════════════════════════
 *
 * Базовый граф: цель каталога `e2157` — коллекция, её порядок содержит
 * объект `e4000` и ВЛОЖЕННУЮ коллекцию `e5041`; вложенная содержит тот же
 * объект. Один объект, две родительские связи, два свидетельства коллекций
 * из разных списков — минимальная форма, на которой все связи графа
 * достижимы по отдельности.
 */
const NESTED_KEY = 'japan-guide:e5041'
const NESTED_URL = `${HOST}/e/e5041.html`
const NESTED_DIGEST = `sha256:${'c'.repeat(64)}`
const nestedEvidence = () => evidence({
  url: NESTED_URL, pageRole: 'collection', rawPageDigest: NESTED_DIGEST,
})
const sharedRecord = record({
  placements: [placement(), placement({ collectionSourceKey: NESTED_KEY })],
})
const GRAPH_COUNTERS = {
  ...COUNTERS, nestedCollectionsFound: 1, poisFound: 1, recordsAttempted: 1, recordsBuilt: 1,
}
const graphSnapshot = (over = {}) => snapshot({
  nestedCollectionEvidence: [{ sourceKey: NESTED_KEY, evidence: nestedEvidence() }],
  orderRecords: [
    buildOrderRecord({
      destinationSourceKey: 'japan-guide:e2157',
      sourcePageDigest: PAGE_DIGEST,
      collectionKind: 'ranked',
      items: [orderItem('poi', 'japan-guide:e4000'), orderItem('collection', NESTED_KEY)],
    }),
    poiOrderRecord(NESTED_KEY, NESTED_DIGEST, ['japan-guide:e4000'], 'ranked'),
  ],
  records: [sharedRecord],
  counters: GRAPH_COUNTERS,
  ...over,
})

const graph = graphSnapshot()
assertDiscoverySnapshot(graph); ok++
t('граф коллекций принимается', graph.complete, true)
t('вложенная коллекция объектом не считается', graph.counters.poisFound, 1)
t('общий объект записан один раз', graph.records.length, 1)
eq('и сохранил обе родительские связи',
  graph.records[0].placements.map((p) => p.collectionSourceKey).sort(),
  ['japan-guide:e2157', NESTED_KEY].sort())

/* Свидетельство вложенной коллекции ВХОДИТ в отпечаток снимка. */
throwsWith('подмена вложенного свидетельства без пересчёта ловится',
  () => assertDiscoverySnapshot((() => {
    const copy = JSON.parse(JSON.stringify(graph))
    copy.nestedCollectionEvidence[0].evidence.pageBytes += 1
    return copy
  })()), 'snapshotDigest')

/* Каждый элемент-коллекция обязан разрешаться в свидетельство. */
throwsWith('элемент-коллекция без свидетельства невозможен', () => snapshot({
  orderRecords: [buildOrderRecord({
    destinationSourceKey: 'japan-guide:e2157',
    sourcePageDigest: PAGE_DIGEST,
    collectionKind: 'ranked',
    items: [orderItem('poi', 'japan-guide:e4000'), orderItem('collection', NESTED_KEY)],
  })],
}), 'свидетельства такой коллекции в снимке нет')

/* И каждое вложенное свидетельство обязано быть достижимо из графа. */
throwsWith('осиротевшая вложенная коллекция невозможна', () => graphSnapshot({
  orderRecords: [
    poiOrderRecord('japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000'], 'ranked'),
    poiOrderRecord(NESTED_KEY, NESTED_DIGEST, ['japan-guide:e4000'], 'ranked'),
  ],
  records: [sharedRecord],
}), 'ни из одного порядка не достижима')

/* Одна страница — одно свидетельство: в обоих списках сразу нельзя. */
throwsWith('коллекция не может быть и целью каталога, и вложенной', () => graphSnapshot({
  catalogueTargetEvidence: [
    { sourceKey: 'japan-guide:e2157', evidence: evidence({ url: DEST, pageRole: 'collection' }) },
    { sourceKey: NESTED_KEY, evidence: nestedEvidence() },
  ],
  counters: { ...GRAPH_COUNTERS, catalogueTargetsFound: 2, catalogueCollectionsFound: 2 },
}), 'и вложенной коллекцией')

/* Роль вложенного свидетельства — РОВНО коллекция. */
throwsWith('вложенный объект вместо коллекции невозможен', () => graphSnapshot({
  nestedCollectionEvidence: [{
    sourceKey: NESTED_KEY,
    evidence: evidence({ url: NESTED_URL, pageRole: 'poi', rawPageDigest: NESTED_DIGEST }),
  }],
}), 'pageRole')

/* Порядок вложенной коллекции привязан к байтам ЕЁ страницы. */
throwsWith('порядок вложенной коллекции от чужих байтов невозможен', () => graphSnapshot({
  orderRecords: [
    buildOrderRecord({
      destinationSourceKey: 'japan-guide:e2157',
      sourcePageDigest: PAGE_DIGEST,
      collectionKind: 'ranked',
      items: [orderItem('poi', 'japan-guide:e4000'), orderItem('collection', NESTED_KEY)],
    }),
    poiOrderRecord(NESTED_KEY, PAGE_DIGEST, ['japan-guide:e4000'], 'ranked'),
  ],
}), 'а свидетельство коллекции — из')

/* Коллекция не может быть одновременно объектом. */
throwsWith('коллекция в роли объекта невозможна', () => graphSnapshot({
  orderRecords: [
    buildOrderRecord({
      destinationSourceKey: 'japan-guide:e2157',
      sourcePageDigest: PAGE_DIGEST,
      collectionKind: 'ranked',
      items: [orderItem('poi', 'japan-guide:e4000'), orderItem('collection', NESTED_KEY)],
    }),
    /* Тот же ключ снимок называет коллекцией свидетельством и объектом —
       элементом ДРУГОГО порядка. Внутри одного порядка повтор ключа
       невозможен вовсе, поэтому противоречие ставится между порядками. */
    poiOrderRecord(NESTED_KEY, NESTED_DIGEST, ['japan-guide:e4000', NESTED_KEY], 'ranked'),
  ],
  counters: { ...GRAPH_COUNTERS, poisFound: 2, recordsAttempted: 1 },
}), 'посчитана объектом')

/* Цикл — законное ребро графа, а не ошибка. */
const cyclic = graphSnapshot({
  orderRecords: [
    buildOrderRecord({
      destinationSourceKey: 'japan-guide:e2157',
      sourcePageDigest: PAGE_DIGEST,
      collectionKind: 'ranked',
      items: [orderItem('poi', 'japan-guide:e4000'), orderItem('collection', NESTED_KEY)],
    }),
    buildOrderRecord({
      destinationSourceKey: NESTED_KEY,
      sourcePageDigest: NESTED_DIGEST,
      collectionKind: 'ranked',
      items: [orderItem('poi', 'japan-guide:e4000'), orderItem('collection', 'japan-guide:e2157')],
    }),
  ],
})
assertDiscoverySnapshot(cyclic); ok++
t('обратное ребро A → B → A принимается', cyclic.complete, true)

/* ── Отказ узла графа ─────────────────────────────────────────────────── */

const nodeRejected = graphSnapshot({
  incompleteReasons: [{ code: 'nodeFetchFailed', count: 1 }],
  rejected: {
    targets: [],
    cards: [],
    nodes: [{ ref: 'japan-guide:e7777', origin: 'japan-guide:e2157', code: 'statusDenied' }],
    pois: [],
  },
})
assertDiscoverySnapshot(nodeRejected); ok++
t('отказ узла делает снимок неполным', nodeRejected.complete, false)
t('и выводит собственную причину',
  nodeRejected.incompleteReasons.some((r) => r.code === 'nodeFetchFailed'), true)

throwsWith('узел без наблюдённого происхождения невозможен', () => graphSnapshot({
  incompleteReasons: [{ code: 'nodeFetchFailed', count: 1 }],
  rejected: {
    targets: [],
    cards: [],
    nodes: [{ ref: 'japan-guide:e7777', origin: 'japan-guide:e9999', code: 'statusDenied' }],
    pois: [],
  },
}), 'коллекции с таким ключом снимок не наблюдал')

throwsWith('узел с уже известной ролью невозможен', () => graphSnapshot({
  incompleteReasons: [{ code: 'nodeFetchFailed', count: 1 }],
  rejected: {
    targets: [],
    cards: [],
    nodes: [{ ref: 'japan-guide:e4000', origin: 'japan-guide:e2157', code: 'statusDenied' }],
    pois: [],
  },
}), 'хотя снимок называет эту страницу объектом или коллекцией')

throwsWith('один узел отвергнут дважды невозможно', () => graphSnapshot({
  incompleteReasons: [{ code: 'nodeFetchFailed', count: 2 }],
  rejected: {
    targets: [],
    cards: [],
    nodes: [
      { ref: 'japan-guide:e7777', origin: 'japan-guide:e2157', code: 'statusDenied' },
      { ref: 'japan-guide:e7777', origin: NESTED_KEY, code: 'redirectLimit' },
    ],
    pois: [],
  },
}), 'один узел отвергнут дважды')

throwsWith('код непригодной ссылки каталога у узла невозможен', () => graphSnapshot({
  incompleteReasons: [{ code: 'unsupportedCatalogueLinkShape', count: 1 }],
  rejected: {
    targets: [],
    cards: [],
    nodes: [{
      ref: 'japan-guide:e7777', origin: 'japan-guide:e2157', code: 'unsupportedCatalogueLinkShape',
    }],
    pois: [],
  },
  counters: { ...GRAPH_COUNTERS, nonCanonicalLinks: 1 },
}), 'описывает ссылку каталога, а не узел графа')

/* Роль элемента входит в отпечаток порядка: подмена без пересчёта ловится,
   а с пересчётом — меняет отпечаток. */
const roleFlip = JSON.parse(JSON.stringify(graph.orderRecords[0]))
roleFlip.items[1].role = 'poi'
throwsWith('подмена роли элемента без пересчёта ловится',
  () => assertOrderRecord(roleFlip), 'orderDigest')
t('роль элемента входит в отпечаток порядка',
  orderDigest({
    destinationSourceKey: 'japan-guide:e2157',
    sourcePageDigest: PAGE_DIGEST,
    collectionKind: 'ranked',
    items: [orderItem('poi', 'japan-guide:e2158')],
  }, ORDER_SPEC_V3)
  === orderDigest({
    destinationSourceKey: 'japan-guide:e2157',
    sourcePageDigest: PAGE_DIGEST,
    collectionKind: 'ranked',
    items: [orderItem('collection', 'japan-guide:e2158')],
  }, ORDER_SPEC_V3), false)
/* Домены трёх версий не совпадают ни при каких данных. */
const sameOrderArgs = ['japan-guide:e2157', PAGE_DIGEST, ['japan-guide:e4000']]
const dV1 = orderDigest({
  destinationSourceKey: sameOrderArgs[0],
  sourcePageDigest: sameOrderArgs[1],
  order: sameOrderArgs[2],
}, ORDER_SPEC_V1)
const dV2 = orderDigest({
  destinationSourceKey: sameOrderArgs[0],
  sourcePageDigest: sameOrderArgs[1],
  collectionKind: 'ranked',
  order: sameOrderArgs[2],
}, ORDER_SPEC_V2)
const dV3 = orderDigest({
  destinationSourceKey: sameOrderArgs[0],
  sourcePageDigest: sameOrderArgs[1],
  collectionKind: 'ranked',
  items: poiItems(sameOrderArgs[2]),
}, ORDER_SPEC_V3)
t('отпечатки v1, v2 и v3 попарно различны',
  new Set([dV1, dV2, dV3]).size, 3)

/* Аccessor-версия снимка отвергается до чтения правил. */
throwsWith('accessor вместо версии снимка отвергается', () => assertDiscoverySnapshot(
  Object.defineProperty(JSON.parse(JSON.stringify(graph)), 'contractVersion', {
    get() { return SNAPSHOT_SPEC_V3 }, enumerable: true, configurable: true,
  })), 'accessor')

/* Единственность подформата проверяется исполнением: два формата снимка,
   ссылающиеся на один формат записи, обязаны совпадать в её правилах. */
t('v3 и v2 делят один формат записи', V3.record === V2.record, true)
eq('и объявляют для неё одни и те же виды размещения',
  [...V3.placementKinds], [...V2.placementKinds])
eq('одни и те же коды omission', [...V3.omissionCodes], [...V2.omissionCodes])
eq('и одни и те же семейства адресов', [...V3.urlFamilies], [...V2.urlFamilies])


/* ══ ЗАМОРОЖЕННЫЙ v2 ПРОВЕРЯЕТСЯ СВОИМИ ПРАВИЛАМИ ═══════════════════════
 *
 * Пока текущей версией был `v2`, его наборы задевал каждый тест. С приходом
 * `v3` они перестали задеваться вовсе, и это поймала мутация: опустошение
 * `cardRejectionCodes` у `v2` пережило оба набора. «Заморожен» означает, что
 * правила читаются, а не что о них забыли — поэтому ниже снимок приводится к
 * форме `v2` и проверяется ею.
 */
const forgeSnapshotDigestV2 = (snap) => sha256Bytes(canonicalJsonBytes({
  contractVersion: SNAPSHOT_SPEC_V2,
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
}, `${SNAPSHOT_SPEC_V2}#snapshot`))

/**
 * Приведение к форме `v2`: поля `v3` убраны, порядок свёрнут в список ключей,
 * счётчику возвращено прежнее имя, оба отпечатка пересчитаны доменами `v2`.
 * Ровно то, что сделал бы посторонний, выдающий сегодняшний снимок за
 * вчерашний.
 */
const asV2Shape = (snap) => {
  const copy = JSON.parse(JSON.stringify(snap))
  copy.contractVersion = SNAPSHOT_SPEC_V2
  delete copy.nestedCollectionEvidence
  delete copy.networkPolicy
  delete copy.rejected.nodes
  copy.counters.collectionsFound = copy.counters.catalogueCollectionsFound
  copy.counters.poisVisited = copy.counters.recordsAttempted
  delete copy.counters.recordsAttempted
  delete copy.counters.catalogueCollectionsFound
  delete copy.counters.nestedCollectionsFound
  for (const row of copy.orderRecords) {
    row.order = row.items.map((item) => item.sourceKey)
    delete row.items
    row.orderDigest = orderDigest({
      destinationSourceKey: row.destinationSourceKey,
      sourcePageDigest: row.sourcePageDigest,
      collectionKind: row.collectionKind,
      order: row.order,
    }, ORDER_SPEC_V2)
  }
  copy.snapshotDigest = forgeSnapshotDigestV2(copy)
  return copy
}

const v2Base = asV2Shape(snapshot())
assertDiscoverySnapshot(v2Base); ok++
t('снимок v2 читается правилами v2', v2Base.contractVersion, SNAPSHOT_SPEC_V2)
t('и порядок у него — список ключей без ролей', Array.isArray(v2Base.orderRecords[0].order), true)
t('поля v3 в нём отсутствуют',
  Object.prototype.hasOwnProperty.call(v2Base, 'nestedCollectionEvidence'), false)

/* Отказ карточки в снимке `v2` проверяется набором кодов ИМЕННО `v2`. */
const v2WithCard = asV2Shape(snapshot({
  incompleteReasons: [{ code: 'cardRejected', count: 1 }],
  rejected: {
    targets: [],
    cards: [{ destination: 'japan-guide:e2157', position: 3, code: 'rankEmpty' }],
    pois: [],
  },
}))
assertDiscoverySnapshot(v2WithCard); ok++
t('отказ карточки делает снимок v2 неполным', v2WithCard.complete, false)
throwsWith('чужой код карточки снимок v2 не принимает', () => assertDiscoverySnapshot((() => {
  const copy = JSON.parse(JSON.stringify(v2WithCard))
  copy.rejected.cards[0].code = 'что-то пошло не так'
  copy.snapshotDigest = forgeSnapshotDigestV2(copy)
  return copy
})()), 'rejected.cards')

/* Позиционная роль ключа держится и на порядке `v2`: там она проверяется
   ветвью `order`, а не `items`, и своей мутацией. */
const v2OrderWith = (keys) => ({
  destinationSourceKey: 'japan-guide:e2157',
  sourcePageDigest: PAGE_DIGEST,
  collectionKind: 'ranked',
  order: [...keys],
  orderDigest: orderDigest({
    destinationSourceKey: 'japan-guide:e2157',
    sourcePageDigest: PAGE_DIGEST,
    collectionKind: 'ranked',
    order: [...keys],
  }, ORDER_SPEC_V2),
})
assertOrderRecord(v2OrderWith(['japan-guide:e4000']), ORDER_SPEC_V2, ORDER_SPEC_V2); ok++
throwsWith('v2: точка входа не может лежать в порядке',
  () => assertOrderRecord(v2OrderWith([CATALOGUE_SOURCE_KEY]), ORDER_SPEC_V2, ORDER_SPEC_V2),
  'не может быть «poi»')
throwsWith('v2: направление вида legacySuffix невозможно',
  () => assertOrderRecord({
    ...v2OrderWith(['japan-guide:e4000']),
    destinationSourceKey: 'japan-guide:e5036_fish',
  }, ORDER_SPEC_V2, ORDER_SPEC_V2), 'не может быть «collection»')

/*
 * ЕДИНСТВЕННОСТЬ ПОДФОРМАТА ПРОВЕРЯЕТСЯ ИСПОЛНЕНИЕМ.
 *
 * На замороженном литерале `VERSION_POLICY` отказ недостижим: расхождения там
 * нет и взяться ему неоткуда. Поэтому набор политик — параметр, и здесь
 * подаётся синтетическая пара, объявляющая один формат записи с разными
 * правилами.
 */
const twinPolicies = (kinds) => ({
  a: { snapshot: 'снимок/a', record: 'запись/общая', placementKinds: ['catalogueDirect'] },
  b: { snapshot: 'снимок/b', record: 'запись/общая', placementKinds: kinds },
})
throwsWith('расхождение правил общего подформата ловится исполнением',
  () => indexPoliciesBy('record', ['placementKinds'], 'формат записи',
    twinPolicies(['containerChild'])),
  'расходятся в «placementKinds»')
t('а совпадающие правила общий подформат разрешают',
  Object.keys(indexPoliciesBy('record', ['placementKinds'], 'формат записи',
    twinPolicies(['catalogueDirect']))).length, 1)


/* ══ R1: НИЖНЯЯ ГРАНИЦА ОБМЕНОВ И ЧЕСТНЫЙ СЧЁТЧИК ═══════════════════════ */

/*
 * Аудит 24.08: контракт принимал снимок `v3`, объявлявший 259 обменов при 208
 * целях и 1170 объектах. Физически необходимо было 1322 — разрыв в 1063
 * обмена, и ни одна проверка его не видела.
 */
t('v3 объявляет, что получает каждую классифицированную страницу',
  V3.everyClassifiedPageFetched, true)
t('v2 — нет: у него предел экономил сеть', V2.everyClassifiedPageFetched, false)
t('и v1 тоже нет', V1.everyClassifiedPageFetched, false)

/* Точное значение границы: 2 + цели + вложенные + объекты вне прямых. */
const graphBound = 2 + 1 + 1 + 1
t('граница графового снимка', graphBound, 5)
const atBound = graphSnapshot({ counters: { ...GRAPH_COUNTERS, networkRequests: graphBound } })
assertDiscoverySnapshot(atBound); ok++
t('ровно на границе снимок принимается', atBound.counters.networkRequests, 5)
throwsWith('на один обмен ниже границы — отказ',
  () => graphSnapshot({ counters: { ...GRAPH_COUNTERS, networkRequests: graphBound - 1 } }),
  'состав снимка требует не меньше 5')
/* Вложенная коллекция поднимает границу ровно на единицу: без неё тот же
   состав обошёлся бы четырьмя обменами. */
throwsWith('вложенная коллекция входит в границу отдельным обменом',
  () => graphSnapshot({ counters: { ...GRAPH_COUNTERS, networkRequests: 4 } }),
  '+ 1 вложенных')

/* Свободы сверху нет только снизу: редиректы законно увеличивают счётчик. */
const aboveBound = graphSnapshot({
  counters: { ...GRAPH_COUNTERS, networkRequests: graphBound * 3 },
})
assertDiscoverySnapshot(aboveBound); ok++
t('выше границы снимок принимается', aboveBound.counters.networkRequests, 15)

/*
 * У ЗАМОРОЖЕННЫХ ВЕРСИЙ ГРАНИЦЫ НЕТ, И ЭТО НЕ ПОСЛАБЛЕНИЕ.
 *
 * `--limit` у них резал список объектов ДО получения страниц: снимок canary
 * честно объявлял 259 обменов при 1170 найденных объектах. Применить границу
 * `v3` задним числом значило бы объявить исторический снимок подделкой.
 */
const v2Cheap = (() => {
  const copy = JSON.parse(JSON.stringify(asV2Shape(snapshot())))
  copy.counters.networkRequests = 3
  copy.snapshotDigest = forgeSnapshotDigestV2(copy)
  return copy
})()
assertDiscoverySnapshot(v2Cheap); ok++
t('снимок v2 с тремя обменами при двух страницах принимается',
  v2Cheap.counters.networkRequests, 3)
t('а тот же состав в v3 столькими обменами невозможен',
  2 + v2Cheap.catalogueTargetEvidence.length + 1 > 3, true)

/* ── recordsAttempted вместо poisVisited ──────────────────────────────── */

t('v3 считает попытки построить запись', V3.counterKeys.includes('recordsAttempted'), true)
t('и прежнего имени не знает', V3.counterKeys.includes('poisVisited'), false)
t('v2 остаётся с прежним именем', V2.counterKeys.includes('poisVisited'), true)
t('и нового не знает', V2.counterKeys.includes('recordsAttempted'), false)
t('v1 тоже', V1.counterKeys.includes('poisVisited'), true)
throwsWith('счётчик v3 под старым именем отвергается', () => graphSnapshot({
  counters: (() => {
    const copy = { ...GRAPH_COUNTERS, poisVisited: GRAPH_COUNTERS.recordsAttempted }
    delete copy.recordsAttempted
    return copy
  })(),
}), 'recordsAttempted')
throwsWith('и оба имени сразу — тоже', () => graphSnapshot({
  counters: { ...GRAPH_COUNTERS, poisVisited: GRAPH_COUNTERS.recordsAttempted },
}), 'poisVisited')
/* Величина осталась прежней: попытки = записи + отказы объектов. */
t('попытки сходятся с исходом',
  graph.counters.recordsAttempted, graph.records.length + graph.rejected.pois.length)
t('и у полного снимка равны найденному',
  graph.counters.recordsAttempted, graph.counters.poisFound)


/* ══ R2/R3: ОТВЕРГНУТАЯ СТРАНИЦА И СТАДИЯ, НА КОТОРОЙ ЕЁ ОТВЕРГЛИ ═══════
 *
 * R2. Первая редакция границы считала только УСПЕШНЫЕ свидетельства. Аудит
 * предъявил два снимка, которые она пропускала:
 *   · отвергнутая цель `statusDenied` — объявлено 4 обмена при минимуме 5;
 *   · отвергнутый узел `statusDenied`  — объявлено 3 обмена при минимуме 4.
 *
 * R3. Вторая редакция классифицировала отказы ОДНИМ глобальным списком кодов
 * и была обходима редиректом: `urlNotCanonical` считался досетевым, потому
 * что `canonicalDiscoveryUrl` бросает его до запроса, — но `fetchHtmlPage`
 * зовёт ту же функцию второй раз, для `Location` уже полученного 3xx.
 * Настоящий обход дал 7 обменов, и снимок, объявивший 6, принимался.
 *
 * Поэтому классификация КОНТЕКСТНА: свой список у целей, свой у узлов, и
 * проверяется она НЕ отдельной экспортированной функцией, а тем самым
 * расчётом, которым пользуется снимок. Регрессия на реальный редирект —
 * в наборе Japan Guide, здесь — арифметика границы.
 */

/* ── Досетевой исход у ЦЕЛИ: только два, и оба доказуемы ──────────────── */

/*
 * У цели досетевых исходов ровно два, и «ровно» проверяется перебором ВСЕХ
 * кодов версии: каждый третий код обязан поднимать границу. Перечислить
 * вручную «те, что поднимают» значило бы переписать сюда двадцать шесть имён
 * и разойтись с политикой при первом же добавлении.
 */
const STRUCTURE_LIKE = ['structureMismatch', ...PAGE_ROLE_CODES, ROLE_FAMILY_MISMATCH_CODE]
const targetBase = { ...COUNTERS, catalogueTargetsFound: 2 }
/* Причина неполноты ВЫВОДИТСЯ из кода тем же правилом, что и в контракте:
   иначе половина перебора отвалилась бы на несходящихся причинах, а не на
   границе, и «не поднимает» означало бы «фикстура не собралась». */
const targetReasonFor = (code) => (
  code === 'unsupportedCatalogueLinkShape' ? code
    : STRUCTURE_LIKE.includes(code) ? 'targetStructureMismatch'
      : 'targetFetchFailed')
/* Ссылка негодной формы целью НЕ становилась: она не даёт ключа, не входит
   в `catalogueTargetsFound` и считается отдельным `nonCanonicalLinks`.
   Собрать её как обычную цель значило бы упереться в эти сверки раньше
   границы — и принять «фикстура не собралась» за «границу не подняло». */
/*
 * Снимок, объявивший исчерпание, обязан стоять НА потолке — это отдельный
 * инвариант R4, и здесь он соблюдается фикстурой, а не обходится: иначе
 * перебор падал бы на нём, и «поднимает границу» перестало бы отличаться от
 * «не сошлись потолки».
 */
const policyFor = (code, networkRequests) => (code === 'networkBudgetExhausted'
  ? { ...NETWORK_POLICY, maxNetworkRequests: networkRequests }
  : NETWORK_POLICY)
const targetAt = (code, networkRequests) => {
  const shape = code === 'unsupportedCatalogueLinkShape'
  return snapshot({
    incompleteReasons: [{ code: targetReasonFor(code), count: 1 }],
    networkPolicy: policyFor(code, networkRequests),
    rejected: {
      targets: [{ ref: shape ? '/e/e9.html?utm=1' : 'japan-guide:e9', code }],
      cards: [],
      pois: [],
    },
    counters: {
      ...targetBase,
      catalogueTargetsFound: shape ? 1 : 2,
      nonCanonicalLinks: shape ? 1 : 0,
      networkRequests,
    },
  })
}
const targetRaisesBound = (code) => {
  /* Опора без отказов — четыре обмена; поднимает ли этот код границу до
     пяти, спрашивается у САМОГО валидатора, а не у копии его правила. */
  try { assertDiscoverySnapshot(targetAt(code, 4)); return false } catch { return true }
}
const targetPreNetwork = V3.pageRejectionCodes.filter((code) => !targetRaisesBound(code))
eq('у цели досетевых исходов ровно два', [...targetPreNetwork].sort(compareUtf8),
  ['networkBudgetExhausted', 'unsupportedCatalogueLinkShape'])
/* Именно те два, что требует аудит, и именно на границе. */
t('исчерпанный бюджет до первого обмена границу не поднимает',
  targetRaisesBound('networkBudgetExhausted'), false)
t('ссылка каталога негодной формы — тоже',
  targetRaisesBound('unsupportedCatalogueLinkShape'), false)
t('а отказ канонизации поднимает: он пришёл из Location после 3xx',
  targetRaisesBound('urlNotCanonical'), true)
t('и повтор адреса — тоже: кэш узлов не даёт повторить исходный запрос',
  targetRaisesBound('urlRepeated'), true)
t('и отказ по статусу', targetRaisesBound('statusDenied'), true)
t('и структурный отказ', targetRaisesBound('structureMismatch'), true)

/* ── Досетевой исход у УЗЛА: только один ──────────────────────────────── */

const nodeBase = {
  ...COUNTERS, poisFound: 0, recordsAttempted: 0, recordsBuilt: 0,
}
const emptyCollectionOrder = buildOrderRecord({
  destinationSourceKey: 'japan-guide:e2157',
  sourcePageDigest: PAGE_DIGEST,
  collectionKind: 'ranked',
  items: [],
})
const nodeAt = (code, networkRequests) => snapshot({
  incompleteReasons: [{
    code: STRUCTURE_LIKE.includes(code) ? 'nodeStructureMismatch' : 'nodeFetchFailed',
    count: 1,
  }],
  networkPolicy: policyFor(code, networkRequests),
  orderRecords: [emptyCollectionOrder],
  records: [],
  rejected: {
    targets: [],
    cards: [],
    nodes: [{ ref: 'japan-guide:e7777', origin: 'japan-guide:e2157', code }],
    pois: [],
  },
  counters: { ...nodeBase, networkRequests },
})
const nodeRaisesBound = (code) => {
  try { assertDiscoverySnapshot(nodeAt(code, 3)); return false } catch { return true }
}
/* `unsupportedCatalogueLinkShape` у узла НЕПРЕДСТАВИМ и потому из перебора
   исключён: он отвергается отдельной проверкой, а не арифметикой границы. */
throwsWith('код непригодной ссылки каталога у узла отвергается как невозможный',
  () => nodeAt('unsupportedCatalogueLinkShape', 4),
  'описывает ссылку каталога, а не узел графа')
const nodeCodes = V3.pageRejectionCodes.filter((code) => code !== 'unsupportedCatalogueLinkShape')
const nodePreNetwork = nodeCodes.filter((code) => !nodeRaisesBound(code))
eq('у узла досетевой исход ровно один', [...nodePreNetwork].sort(compareUtf8),
  ['networkBudgetExhausted'])
t('исчерпанный бюджет границу не поднимает', nodeRaisesBound('networkBudgetExhausted'), false)
t('а отказ канонизации у узла поднимает', nodeRaisesBound('urlNotCanonical'), true)
t('и повтор адреса', nodeRaisesBound('urlRepeated'), true)

/* Списки РАЗНЫЕ, и это не случайность одинаковых значений: у цели есть
   исход, которого у узла быть не может. */
t('списки каналов не совпадают',
  JSON.stringify([...targetPreNetwork].sort(compareUtf8))
  === JSON.stringify([...nodePreNetwork].sort(compareUtf8)), false)

/* ── Контрпример аудита №1: отвергнутая цель ──────────────────────────── */

/* Тот же состав без отказа обходится четырьмя обменами — это опора, от
   которой считается прибавка. */
const r2Base = snapshot({ counters: { ...COUNTERS, networkRequests: 4 } })
assertDiscoverySnapshot(r2Base); ok++
t('опора без отказов — четыре обмена', r2Base.counters.networkRequests, 4)

throwsWith('отвергнутая цель поднимает границу на один обмен',
  () => targetAt('statusDenied', 4), 'требует не меньше 5')
throwsWith('и слагаемое названо в сообщении',
  () => targetAt('statusDenied', 4), '1 отвергнутых целей')
const targetAtBound = targetAt('statusDenied', 5)
assertDiscoverySnapshot(targetAtBound); ok++
t('на пяти обменах снимок принимается', targetAtBound.counters.networkRequests, 5)

/* Тот же счёт для отказа ПОСЛЕ редиректа — того самого, которым обходили
   вторую редакцию границы. */
throwsWith('отказ канонизации Location поднимает границу так же',
  () => targetAt('urlNotCanonical', 4), 'требует не меньше 5')
const canonAtBound = targetAt('urlNotCanonical', 5)
assertDiscoverySnapshot(canonAtBound); ok++
t('и принимается ровно на пяти', canonAtBound.counters.networkRequests, 5)

/* Досетевые исходы границу НЕ поднимают: обмена не было. */
const budgetTarget = targetAt('networkBudgetExhausted', 4)
assertDiscoverySnapshot(budgetTarget); ok++
t('исчерпанный бюджет цели границу не поднимает', budgetTarget.counters.networkRequests, 4)
const shapeTarget = targetAt('unsupportedCatalogueLinkShape', 4)
assertDiscoverySnapshot(shapeTarget); ok++
t('ссылка негодной формы — тоже', shapeTarget.counters.networkRequests, 4)

/* ── Контрпример аудита №2: отвергнутый узел графа ────────────────────── */

throwsWith('отвергнутый узел поднимает границу на один обмен',
  () => nodeAt('statusDenied', 3), 'требует не меньше 4')
throwsWith('и это слагаемое тоже названо',
  () => nodeAt('statusDenied', 3), '1 отвергнутых узлов')
const nodeAtBound = nodeAt('statusDenied', 4)
assertDiscoverySnapshot(nodeAtBound); ok++
t('на четырёх обменах снимок принимается', nodeAtBound.counters.networkRequests, 4)

throwsWith('и отказ канонизации Location у узла — так же',
  () => nodeAt('urlNotCanonical', 3), 'требует не меньше 4')

/* Единственный досетевой исход узла границу не поднимает. */
const budgetNode = nodeAt('networkBudgetExhausted', 3)
assertDiscoverySnapshot(budgetNode); ok++
t('исчерпанный бюджет узла границу не поднимает', budgetNode.counters.networkRequests, 3)

/*
 * ОТКАЗЫ ОБЪЕКТОВ В ГРАНИЦУ НЕ ВХОДЯТ, и это проверяется, а не
 * подразумевается: отвергнутый объект обязан лежать в достижимом множестве,
 * поэтому его страница уже посчитана слагаемым «объектов вне прямых».
 * Прибавить его значило бы посчитать один обмен дважды и отвергнуть законный
 * снимок.
 */
const withRejectedPoi = snapshot({
  incompleteReasons: [{ code: 'poiStructureMismatch', count: 1 }],
  records: [],
  rejected: {
    targets: [],
    cards: [],
    pois: [{ ref: 'japan-guide:e4000', code: 'structureMismatch' }],
  },
  counters: { ...COUNTERS, recordsBuilt: 0, networkRequests: 4 },
})
assertDiscoverySnapshot(withRejectedPoi); ok++
t('отказ объекта границу не поднимает — его страница уже посчитана',
  withRejectedPoi.counters.networkRequests, 4)

/* Граница остаётся ВЕРСИОННОЙ: у замороженных форматов новых слагаемых нет,
   как не было и старых. */
const v2WithRejectedTarget = (() => {
  const copy = JSON.parse(JSON.stringify(asV2Shape(targetAt('statusDenied', 5))))
  copy.counters.networkRequests = 1
  copy.snapshotDigest = forgeSnapshotDigestV2(copy)
  return copy
})()
assertDiscoverySnapshot(v2WithRejectedTarget); ok++
t('v2 с отвергнутой целью и одним обменом принимается',
  v2WithRejectedTarget.counters.networkRequests, 1)


/* ══ R4: ПОТОЛКИ ОБХОДА ЛЕЖАТ В САМОМ СНИМКЕ ═══════════════════════════
 *
 * Нижняя граница не видит обменов, потраченных ВНУТРИ отказа, который сам по
 * себе обмена не стоил. Аудит 25.08 предъявил это настоящим обходом: при
 * `maxRedirects` = 2 первая цель получает два 302 и упирается в потолок на
 * третьем `take`; её отказ — `networkBudgetExhausted`, слагаемого он не даёт.
 * Следующие цели падают на нулевом шаге, тоже без обмена. Обходу это стоило
 * 4 обмена, снимок объявлял 2, и состав снимка такое позволял.
 *
 * Прежняя оценка остатка — «не больше одного обмена» — была НЕВЕРНА: скрыть
 * можно до `maxRedirects` обменов. Закрывается это не арифметикой состава, а
 * потолком, который снимок обязан назвать сам.
 */

t('v3 объявляет потолки обхода', V3.snapshotKeys.includes('networkPolicy'), true)
t('у v2 такого поля нет', V2.snapshotKeys.includes('networkPolicy'), false)
t('у v1 тоже нет', V1.snapshotKeys.includes('networkPolicy'), false)
eq('потолков ровно два и они названы',
  Object.keys(fullSnapshot.networkPolicy).sort(), ['maxNetworkRequests', 'maxRedirects'])

/* Потолки ВХОДЯТ в отпечаток: подогнать бюджет под счётчик после прогона
   нельзя, не тронув `snapshotDigest`. */
throwsWith('подмена потолка без пересчёта отпечатка ловится',
  () => assertDiscoverySnapshot((() => {
    const copy = JSON.parse(JSON.stringify(fullSnapshot))
    copy.networkPolicy.maxNetworkRequests = 12
    return copy
  })()), 'snapshotDigest')
throwsWith('снимок без потолков невозможен', () => snapshot({ networkPolicy: undefined }))
throwsWith('потолок обменов меньше единицы невозможен',
  () => snapshot({ networkPolicy: { ...NETWORK_POLICY, maxNetworkRequests: 0 } }),
  'maxNetworkRequests')
/*
 * НОЛЬ РЕДИРЕКТОВ — РЕЖИМ, А НЕ ОШИБКА.
 *
 * Здесь стояла проверка, требовавшая от `maxRedirects` единицы; она отвергала
 * снимок обычного обхода, которому велели за редиректами не ходить — аудит
 * 25.08 воспроизвёл это настоящим `collectJapanGuideDiscovery`. Проверка снята
 * вместе с ложным обоснованием: бюджетные инварианты при нуле работают без
 * единого изменения, а досетевой отказ отличается от исчерпания кодом и
 * каналом, а не числом разрешённых редиректов.
 */
const noRedirects = snapshot({ networkPolicy: { ...NETWORK_POLICY, maxRedirects: 0 } })
assertDiscoverySnapshot(noRedirects); ok++
t('ноль редиректов — законный режим', noRedirects.networkPolicy.maxRedirects, 0)
/* И бюджетные инварианты при нуле те же: исчерпание всё так же обязано
   стоять на потолке. Иначе «разрешили ноль» стало бы лазейкой. */
throwsWith('исчерпание ниже потолка невозможно и при нуле редиректов',
  () => snapshot({
    incompleteReasons: [{ code: 'targetFetchFailed', count: 1 }],
    networkPolicy: { maxNetworkRequests: 9, maxRedirects: 0 },
    rejected: {
      targets: [{ ref: 'japan-guide:e9', code: 'networkBudgetExhausted' }],
      cards: [],
      pois: [],
    },
    counters: { ...COUNTERS, catalogueTargetsFound: 2, networkRequests: 4 },
  }), 'исчерпанным бюджет бывает ровно на потолке')
throwsWith('отрицательный потолок редиректов режимом не является',
  () => snapshot({ networkPolicy: { ...NETWORK_POLICY, maxRedirects: -1 } }), 'maxRedirects')
throwsWith('лишнее поле в потолках невозможно',
  () => snapshot({ networkPolicy: { ...NETWORK_POLICY, maxBodyBytes: 1 } }), 'networkPolicy')

/* ── Больше собственного бюджета обход потратить не мог ───────────────── */

throwsWith('объявить обменов больше потолка нельзя',
  () => snapshot({
    networkPolicy: { ...NETWORK_POLICY, maxNetworkRequests: 4 },
    counters: { ...COUNTERS, networkRequests: 5 },
  }), 'обход не мог потратить больше собственного бюджета')
const atCeiling = snapshot({
  networkPolicy: { ...NETWORK_POLICY, maxNetworkRequests: 4 },
  counters: { ...COUNTERS, networkRequests: 4 },
})
assertDiscoverySnapshot(atCeiling); ok++
t('ровно на потолке — можно', atCeiling.counters.networkRequests, 4)

/* ── Исчерпание бывает ровно на потолке ───────────────────────────────── */

/*
 * Контрпример аудита в его арифметике: состав снимка требует всего 2 обмена
 * (robots и каталог), потому что все три цели отвергнуты досетевым исходом.
 * Настоящих обменов было 4 — два из них ушли на редиректы первой цели.
 */
const exhaustedAt = (networkRequests, maxNetworkRequests) => snapshot({
  incompleteReasons: [{ code: 'targetFetchFailed', count: 3 }],
  networkPolicy: { ...NETWORK_POLICY, maxNetworkRequests },
  orderRecords: [],
  records: [],
  rejected: {
    targets: [
      { ref: 'japan-guide:e1001', code: 'networkBudgetExhausted' },
      { ref: 'japan-guide:e1002', code: 'networkBudgetExhausted' },
      { ref: 'japan-guide:e1003a', code: 'networkBudgetExhausted' },
    ],
    cards: [],
    pois: [],
  },
  catalogueTargetEvidence: [],
  counters: {
    ...COUNTERS,
    catalogueTargetsFound: 3,
    catalogueCollectionsFound: 0,
    poisFound: 0,
    recordsAttempted: 0,
    recordsBuilt: 0,
    networkRequests,
  },
})
/* Нижняя граница такой снимок пропускает — ей нечего прибавить. */
t('состав снимка требует всего два обмена',
  (() => { try { exhaustedAt(2, 2); return true } catch { return false } })(), true)
/* А потолок — нет: исчерпание при двух обменах и бюджете четыре невозможно. */
throwsWith('подделка аудита: исчерпание объявлено ниже потолка',
  () => exhaustedAt(2, 4), 'исчерпанным бюджет бывает ровно на потолке')
const honestExhausted = exhaustedAt(4, 4)
assertDiscoverySnapshot(honestExhausted); ok++
t('честные четыре обмена при потолке четыре принимаются',
  honestExhausted.counters.networkRequests, 4)

/* Исчерпание ДО первого запроса цели — законный снимок: бюджета хватило
   ровно на robots и каталог, и счётчик стоит на потолке. */
const exhaustedBeforeTargets = exhaustedAt(2, 2)
assertDiscoverySnapshot(exhaustedBeforeTargets); ok++
t('исчерпание до первого запроса цели — законный снимок',
  exhaustedBeforeTargets.counters.networkRequests,
  exhaustedBeforeTargets.networkPolicy.maxNetworkRequests)

/* Равенство требуется и от УЗЛА, а не только от цели. */
throwsWith('исчерпание у узла ниже потолка тоже невозможно',
  () => snapshot({
    incompleteReasons: [{ code: 'nodeFetchFailed', count: 1 }],
    networkPolicy: { ...NETWORK_POLICY, maxNetworkRequests: 9 },
    orderRecords: [emptyCollectionOrder],
    records: [],
    rejected: {
      targets: [],
      cards: [],
      nodes: [{ ref: 'japan-guide:e7777', origin: 'japan-guide:e2157', code: 'networkBudgetExhausted' }],
      pois: [],
    },
    counters: { ...nodeBase, networkRequests: 3 },
  }), 'исчерпанным бюджет бывает ровно на потолке')

/* Без исчерпания равенство не требуется: обычный снимок живёт под потолком. */
t('снимок без исчерпания стоит ниже потолка и это законно',
  fullSnapshot.counters.networkRequests < fullSnapshot.networkPolicy.maxNetworkRequests, true)

finish()
