/**
 * JA‑2 (JG‑1): ОЧЕРЕДИ БЕЗ СЕТИ — `poi-japan-guide-queues/v1`.
 *
 * Из пакета границы адаптера (JA‑1), реестра таксономии и сохранённой выгрузки
 * Airtable собираются пять очередей: `existing`, `candidate`, `routedElsewhere`,
 * `review`, `rejected`. Каждая строка снимка получает РОВНО ОДИН исход с
 * причиной из закрытого списка; сумма очередей равна числу строк — и это
 * проверяется, а не обещается.
 *
 * Порядок решений (первое применимое):
 *   1. `existing`         — запись связана по `Source Key` (или по адресу
 *                           страницы) с сохранённой выгрузкой: тождество
 *                           независимое, связь закрепляется;
 *   2. `rejected`         — адаптер отказал строке (нет имени) либо реестр
 *                           исключает вид сущности (транспорт, магазин, услуга);
 *   3. `routedElsewhere`  — реестр ведёт сущность в другой каталог
 *                           (событие, ресторан, отель, впечатление);
 *   4. `review`           — категория источника не разобрана, неоднозначна
 *                           или конфликтует между размещениями; ЛИБО имя
 *                           совпало с записью базы БЕЗ независимого признака
 *                           (ключа или координат) — такое не связывается
 *                           автоматически (план JA‑2);
 *   5. `candidate`        — реестр ведёт в POI с типом, связи нет, имя ни с
 *                           чем не совпало: ждёт бесплатного обогащения (JA‑3)
 *                           с явными пропусками (японское имя, город, координаты).
 *
 * Классификация — ТОЛЬКО через `classifyByRule` реестра: таблица ниже
 * переводит категорию источника в коды реестра, а маршрут (`route`,
 * `needs_review`, `exclude`, каталог) назначает политика реестра, не этот
 * файл. Сопоставление — общий пакетный matcher (`matchAgainstExisting`, пороги
 * из `MATCHER_POLICY`) плюс принятая read-only сверка discovery ↔ Airtable
 * (`reconcileDiscoveryWithAirtable`): ключевые связи обеих обязаны совпасть.
 * ОБА получают выгрузку из одного разбора (`parseVerifiedAirtableExport`): вход
 * выгрузки здесь ровно один — байты, и опубликованный отпечаток относится
 * именно к тем данным, по которым принято решение.
 * Общая оценка качества (`evaluatePortalIntakeBatch`) сохраняется в каждой
 * строке как `generalVerdict` — она ожидаемо `qualityRejected` без японского
 * имени и координат, и очередь её не переопределяет, а дополняет. Состав
 * приёма (кандидаты и отказы) выводится здесь ЗАНОВО из проверенного пакета,
 * а не берётся из массивов вызывающего.
 *
 * Сеть 0, Google 0, модель 0, записей 0: модуль не импортирует ни хранилище,
 * ни резолвер, ни границы записи.
 */
import { classifyByRule } from './classification-contract.mjs'
import { matchAgainstExisting, MATCHER_POLICY_VERSION, matcherPolicyDigest } from './dedupe.mjs'
import { parseVerifiedAirtableExport, reconcileDiscoveryWithAirtable } from './discovery-airtable-match.mjs'
import { expectedInputFromSnapshot } from './japan-guide-intake.mjs'
import { portalIntakeCandidates } from './portal-intake-contract.mjs'
import { canonicalJsonBytes } from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'

export const JAPAN_GUIDE_QUEUES_SPEC = 'poi-japan-guide-queues/v1'
export const QUEUES = Object.freeze(['existing', 'candidate', 'routedElsewhere', 'review', 'rejected'])
/** Закрытый список причин; `detail` — свободный текст для человека. */
export const QUEUE_REASONS = Object.freeze([
  'sourceKeyLinked', 'urlLinked',
  'adapterRefused', 'taxonomyExcluded',
  'catalogElsewhere',
  'categoryUnresolved', 'categoryAmbiguous', 'categoryConflict',
  'nameMatchWithoutIndependentSignal', 'ambiguousName', 'linkConflict',
  'awaitingEnrichment',
])
/** Пропуски, которые кандидат несёт явно до обогащения (JA‑3/JA‑4). */
export const CANDIDATE_OMISSIONS = Object.freeze(['nameJa', 'city', 'coordinates'])

/**
 * Категория источника → коды реестра. `poiPrimaryType: null` при
 * `tourist_poi` — «туристический объект, тип не определён»: реестр ведёт
 * такие в `needs_review` (правило `poi_type_unknown`). Никакой категории не
 * назначается ближайший тип по догадке: то, что бывает и местом, и событием,
 * и жильём, остаётся неоднозначным.
 */
export const JAPAN_GUIDE_CATEGORY_RULES = Object.freeze({
  'Museum': { entityKind: 'tourist_poi', poiPrimaryType: 'museum' },
  'Temple': { entityKind: 'tourist_poi', poiPrimaryType: 'buddhist_temple' },
  'Shrine': { entityKind: 'tourist_poi', poiPrimaryType: 'shinto_shrine' },
  'Historic Site': { entityKind: 'tourist_poi', poiPrimaryType: 'historic_site' },
  'Castle': { entityKind: 'tourist_poi', poiPrimaryType: 'castle_fortification' },
  'Garden': { entityKind: 'tourist_poi', poiPrimaryType: 'park_garden' },
  'Park': { entityKind: 'tourist_poi', poiPrimaryType: 'park_garden' },
  'Nature': { entityKind: 'tourist_poi', poiPrimaryType: 'natural_landmark' },
  'Volcano': { entityKind: 'tourist_poi', poiPrimaryType: 'natural_landmark' },
  'Beach': { entityKind: 'tourist_poi', poiPrimaryType: 'natural_landmark' },
  'Viewpoint/Tower': { entityKind: 'tourist_poi', poiPrimaryType: 'viewpoint' },
  'Neighborhood': { entityKind: 'tourist_poi', poiPrimaryType: 'tourist_district' },
  'Amusement Park': { entityKind: 'tourist_poi', poiPrimaryType: 'amusement_park' },
  'Zoo/Wildlife': { entityKind: 'tourist_poi', poiPrimaryType: 'zoo_aquarium' },
  'Contemporary Art': { entityKind: 'tourist_poi', poiPrimaryType: 'art_venue' },
  'Traditional Theater': { entityKind: 'tourist_poi', poiPrimaryType: 'performing_arts_venue' },
  /* Неоднозначные: тип не назначается, реестр ведёт к человеку. */
  'Shopping': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'рынок, торговая улица или магазин — по категории не различить' },
  'Onsen': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'общественная купальня, онсэн-город или рёкан — по категории не различить' },
  'Ski Resort': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'курорт как место или как услуга проката — не различить' },
  'Hiking': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'маршрут или природный объект — не различить' },
  'Scenic Ride': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'дорога/линия как впечатление или как транспорт — не различить' },
  'Industry/Commerce': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'завод, рынок или музей производства — не различить' },
  'Agriculture': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'ферма как место или как впечатление — не различить' },
  'Flowers': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'сезонное место или сезонное событие — не различить' },
  'Cherry Blossoms': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'сезонное место или сезонное событие — не различить' },
  'Winter Illumination': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'сезонное место или сезонное событие — не различить' },
  'Manga and Anime': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'музей, район или магазин — не различить' },
  'Pottery': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'мастерская, музей или район — не различить' },
  'Snow Destination': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'место или сезонное событие — не различить' },
  'Rural Japan': { entityKind: 'tourist_poi', poiPrimaryType: null, ambiguous: 'деревня, район или пейзаж — не различить' },
  /* Другие каталоги — реестр уводит их из POI. */
  'Festival': { entityKind: 'event', poiPrimaryType: null },
  'Event': { entityKind: 'event', poiPrimaryType: null },
  'Food and Drink': { entityKind: 'food_service', poiPrimaryType: null },
})

/**
 * Классификация одной записи по категориям её размещений — через реестр.
 * Возвращает `{ classification, reason, detail }`: `classification` — результат
 * `classifyByRule` или null (категории нет).
 */
export function classifyJapanGuideRecord(record) {
  const categories = [...new Set((record.placements ?? []).map((p) => p.categoryHint).filter((c) => typeof c === 'string' && c))]
  if (!categories.length) return { classification: null, reason: 'categoryUnresolved', detail: 'размещения источника не несут категории' }
  const unknown = categories.filter((c) => !JAPAN_GUIDE_CATEGORY_RULES[c])
  if (unknown.length) return { classification: null, reason: 'categoryUnresolved', detail: `категория источника не описана таблицей: ${unknown.join(', ')}` }
  const rules = categories.map((c) => JAPAN_GUIDE_CATEGORY_RULES[c])
  const codes = new Set(rules.map((r) => `${r.entityKind}/${r.poiPrimaryType ?? '?'}`))
  if (codes.size > 1) {
    return { classification: null, reason: 'categoryConflict', detail: `размещения источника расходятся: ${categories.join(' ≠ ')}` }
  }
  const rule = rules[0]
  const classification = classifyByRule({
    sourceKey: record.sourceKey,
    entityKind: rule.entityKind,
    poiPrimaryType: rule.poiPrimaryType,
    reasons: rule.ambiguous ? [rule.ambiguous] : [],
  })
  return { classification, reason: rule.ambiguous ? 'categoryAmbiguous' : null, detail: rule.ambiguous ?? categories[0], categories }
}

/** Проекция выгрузки Airtable в записи для общего matcher’а (без координат — их в выгрузке нет). */
export function existingFromExport(airtableExport) {
  return airtableExport.records
    .filter((row) => !row.isSystem)
    .map((row) => ({
      poiId: row.poiId,
      recordId: row.recordId,
      sourceKey: typeof row.sourceKey === 'string' && row.sourceKey ? row.sourceKey : null,
      nameJa: '',
      nameEn: typeof row.nameEn === 'string' ? row.nameEn : '',
      nameRu: typeof row.nameRu === 'string' ? row.nameRu : '',
      siteCity: typeof row.siteCity === 'string' ? row.siteCity : '',
    }))
}

/**
 * СОСТАВ ПРИЁМА ВЫВОДИТСЯ ЗАНОВО ИЗ ПРОВЕРЕННОГО ПАКЕТА, А НЕ ПРИНИМАЕТСЯ НА СЛОВО.
 *
 * Аудит 10h-D предъявил: `batchDigest` покрывает пакет, но `candidates`,
 * `refusedQueue` и `evaluated` — обычные изменяемые массивы, собранные
 * вызывающим. Подменив в них одну строку ПОСЛЕ оценки, можно было увести
 * запись из очереди, не тронув ни одного опубликованного отпечатка.
 *
 * Поэтому кандидаты и отказы выводятся здесь тем же общим `portalIntakeCandidates`
 * из `intake.batch`, который заново сверяется с ожидаемым составом снимка
 * (`readPortalIntakeBatch` внутри перепроверяет `batchDigest` и тождество
 * входа). Общая оценка (`evaluated`) остаётся у вызывающего — она зависит от
 * bbox портала и живёт в коллекторе, — но принимается ТОЛЬКО если её кандидаты
 * побайтно совпадают с выведенными здесь; иначе это оценка не этого пакета.
 *
 * Оценка при этом ни на одно решение очереди не влияет: `generalVerdict`
 * попадает в строку сведением и никуда больше. Её канонический отпечаток
 * публикуется (`inputs.intake.intakeDigest`), чтобы у отчёта было чем
 * доказать, какой именно состав приёма он раскладывал.
 */
function derivedIntakeFrom(intake, portal, expected) {
  const derived = portalIntakeCandidates(intake.batch, portal, expected)
  const evaluated = intake.evaluated
  if (!Array.isArray(evaluated) || evaluated.length !== derived.candidates.length) {
    throw new Error(`${JAPAN_GUIDE_QUEUES_SPEC}: общая оценка покрывает ${Array.isArray(evaluated) ? evaluated.length : 'не массив'} строк при ${derived.candidates.length} кандидатах пакета`)
  }
  derived.candidates.forEach((candidate, index) => {
    const seen = evaluated[index]?.candidate
    const want = canonicalJsonBytes(candidate, JAPAN_GUIDE_QUEUES_SPEC).toString('base64')
    const got = seen === undefined ? null : canonicalJsonBytes(seen, JAPAN_GUIDE_QUEUES_SPEC).toString('base64')
    if (want !== got) {
      throw new Error(`${JAPAN_GUIDE_QUEUES_SPEC}: ${candidate.sourceKey}: оценённый кандидат не совпадает с выведенным из проверенного пакета`)
    }
  })
  const intakeDigest = sha256Bytes(canonicalJsonBytes({
    batchDigest: intake.batch.batchDigest,
    candidates: derived.candidates,
    refused: derived.refusedQueue,
    verdicts: evaluated.map((row) => ({ sourceKey: row.candidate.sourceKey, terminal: row.verdict.terminal, terminalReason: row.verdict.terminalReason, score: row.verdict.score })),
  }, JAPAN_GUIDE_QUEUES_SPEC))
  return { ...derived, evaluated, intakeDigest }
}

/**
 * Очереди из снимка, пакета границы, общей оценки и выгрузки.
 *
 * @param input.snapshot     проверенный снимок `poi-discovery-snapshot/v3`
 * @param input.portal       реестровая запись портала (нужна для повторного вывода кандидатов)
 * @param input.intake       результат `evaluatePortalIntakeBatch`; отсюда берутся только `batch` и `evaluated`
 * @param input.exportBytes  байты выгрузки Airtable (`poi-airtable-export/v1`) — единственный вход выгрузки
 */
export function buildJapanGuideQueues({ snapshot, portal, intake, exportBytes, createdAt }) {
  const expected = expectedInputFromSnapshot(snapshot)
  if (!portal || portal.id !== 'japan-guide') throw new TypeError(`${JAPAN_GUIDE_QUEUES_SPEC}: очереди только для портала japan-guide`)
  if (intake.batch.input.digest !== expected.digest) throw new Error(`${JAPAN_GUIDE_QUEUES_SPEC}: пакет собран по другому снимку`)
  const derived = derivedIntakeFrom(intake, portal, expected)
  /* Выгрузка разбирается ОДИН раз и в одном месте: сверка и общий matcher
     получают одно и то же содержимое, а отчёт публикует отпечаток именно
     этих байтов. */
  const { airtable, exportDigest } = parseVerifiedAirtableExport(exportBytes)
  const reconciliation = reconcileDiscoveryWithAirtable(snapshot, exportBytes)
  if (reconciliation.inputs.airtable.exportDigest !== exportDigest) {
    throw new Error(`${JAPAN_GUIDE_QUEUES_SPEC}: сверка удостоверяет выгрузку ${reconciliation.inputs.airtable.exportDigest} при разобранной ${exportDigest}`)
  }
  const existing = existingFromExport(airtable)
  const byKey = new Map(snapshot.records.map((record) => [record.sourceKey, record]))
  const linkedByKey = new Map(reconciliation.linkedByKey.map((l) => [l.sourceKey, l]))
  const linkedByUrl = new Map(reconciliation.linkedByUrl.map((l) => [l.sourceKey, l]))
  const nameCandidates = new Map()
  for (const n of reconciliation.nameCandidates) {
    if (!nameCandidates.has(n.sourceKey)) nameCandidates.set(n.sourceKey, [])
    nameCandidates.get(n.sourceKey).push(n)
  }
  const ambiguous = new Map(reconciliation.ambiguous.map((a) => [a.sourceKey, a]))
  const conflicts = new Map(reconciliation.conflicts.map((c) => [c.sourceKey, c]))
  const verdictByKey = new Map(derived.evaluated.map((e) => [e.candidate.sourceKey, e.verdict]))
  const candidateByKey = new Map(derived.candidates.map((c) => [c.sourceKey, c]))
  const refusedByKey = new Map(derived.refusedQueue.map((r) => [r.sourceKey, r]))

  const rows = []
  for (const record of snapshot.records) {
    const key = record.sourceKey
    const general = verdictByKey.get(key) ?? null
    const candidate = candidateByKey.get(key) ?? null
    const matcher = candidate ? matchAgainstExisting(candidate, existing) : null
    const matcherTop = matcher?.matches[0] ?? null
    const matcherByKey = matcherTop?.reasons.includes('source_key') ? matcherTop : null
    const base = {
      sourceKey: key,
      nameEn: record.nameEn,
      url: record.url,
      categories: [...new Set((record.placements ?? []).map((p) => p.categoryHint).filter(Boolean))],
      generalVerdict: general ? { terminal: general.terminal, reason: general.terminalReason, score: general.score, blocking: general.blockingReasons } : null,
      matcher: matcher ? { verdict: matcher.verdict, top: matcherTop ? { poiId: matcherTop.record.poiId, confidence: matcherTop.confidence, reasons: matcherTop.reasons } : null } : null,
    }
    /* Ключевые связи двух сопоставлений обязаны совпасть. */
    const link = linkedByKey.get(key) ?? null
    if ((link && (!matcherByKey || matcherByKey.record.poiId !== link.poiId)) || (!link && matcherByKey)) {
      throw new Error(`${JAPAN_GUIDE_QUEUES_SPEC}: ${key}: связь по ключу расходится между общим matcher’ом и сверкой discovery ↔ Airtable`)
    }
    if (link) { rows.push({ ...base, queue: 'existing', reason: 'sourceKeyLinked', detail: `Source Key записи ${link.poiId}`, linked: { poiId: link.poiId, recordId: link.recordId } }); continue }
    const urlLink = linkedByUrl.get(key) ?? null
    if (urlLink) { rows.push({ ...base, queue: 'existing', reason: 'urlLinked', detail: `адрес страницы совпал с записью ${urlLink.poiId}`, linked: { poiId: urlLink.poiId, recordId: urlLink.recordId } }); continue }
    const refused = refusedByKey.get(key) ?? null
    if (refused) { rows.push({ ...base, queue: 'rejected', reason: 'adapterRefused', detail: `${refused.reason}: ${refused.detail}`, classification: null }); continue }
    const classified = classifyJapanGuideRecord(record)
    const cls = classified.classification
    const classificationSummary = cls ? { entityKind: cls.entityKind, poiPrimaryType: cls.poiPrimaryType, intakeDisposition: cls.intakeDisposition, catalogTarget: cls.catalogTarget, excludeReason: cls.excludeReason, routeRuleId: cls.routeRuleId, classificationSource: cls.classificationSource } : null
    if (cls && cls.intakeDisposition === 'exclude') {
      rows.push({ ...base, queue: 'rejected', reason: 'taxonomyExcluded', detail: `${cls.excludeReason} (${cls.routeRuleId})`, classification: classificationSummary }); continue
    }
    if (cls && cls.intakeDisposition === 'route' && cls.catalogTarget !== 'poi') {
      rows.push({ ...base, queue: 'routedElsewhere', reason: 'catalogElsewhere', detail: `реестр ведёт в каталог ${cls.catalogTarget} (${cls.routeRuleId})`, classification: classificationSummary }); continue
    }
    if (!cls || cls.intakeDisposition !== 'route') {
      rows.push({ ...base, queue: 'review', reason: classified.reason ?? 'categoryAmbiguous', detail: classified.detail, classification: classificationSummary }); continue
    }
    /* Маршрут в POI с типом: теперь — независимость тождества. */
    const conflict = conflicts.get(key) ?? null
    if (conflict) { rows.push({ ...base, queue: 'review', reason: 'linkConflict', detail: `${conflict.reason}: ${conflict.detail}`, classification: classificationSummary, nameMatches: conflict.poiIds ?? [] }); continue }
    const amb = ambiguous.get(key) ?? null
    if (amb) { rows.push({ ...base, queue: 'review', reason: 'ambiguousName', detail: `${amb.reason}: ${amb.detail}`, classification: classificationSummary, nameMatches: amb.poiIds ?? [] }); continue }
    const byName = nameCandidates.get(key) ?? []
    const matcherName = matcher && matcher.verdict !== 'new' && !matcherByKey ? matcher.matches.map((m) => m.record.poiId) : []
    const nameMatches = [...new Set([...byName.map((n) => n.poiId), ...matcherName])]
    if (nameMatches.length) {
      rows.push({ ...base, queue: 'review', reason: 'nameMatchWithoutIndependentSignal', detail: `имя совпало с ${nameMatches.join(', ')}; ни ключа, ни координат — автоматически не связывается`, classification: classificationSummary, nameMatches }); continue
    }
    rows.push({ ...base, queue: 'candidate', reason: 'awaitingEnrichment', detail: `реестр ведёт в POI (${cls.poiPrimaryType}); ждёт обогащения: ${CANDIDATE_OMISSIONS.join(', ')}`, classification: classificationSummary, omissions: [...CANDIDATE_OMISSIONS] })
  }

  /* ЗАКОН СОХРАНЕНИЯ — проверяется. */
  const queues = Object.fromEntries(QUEUES.map((q) => [q, rows.filter((r) => r.queue === q)]))
  const total = QUEUES.reduce((n, q) => n + queues[q].length, 0)
  if (total !== snapshot.records.length || rows.length !== snapshot.records.length) {
    throw new Error(`${JAPAN_GUIDE_QUEUES_SPEC}: закон сохранения нарушен — строк снимка ${snapshot.records.length}, исходов ${total}`)
  }
  const seen = new Set()
  for (const row of rows) {
    if (!QUEUES.includes(row.queue) || !QUEUE_REASONS.includes(row.reason)) throw new Error(`${JAPAN_GUIDE_QUEUES_SPEC}: ${row.sourceKey}: исход вне закрытого списка`)
    if (seen.has(row.sourceKey)) throw new Error(`${JAPAN_GUIDE_QUEUES_SPEC}: ${row.sourceKey} дважды`)
    seen.add(row.sourceKey)
    if (!byKey.has(row.sourceKey)) throw new Error(`${JAPAN_GUIDE_QUEUES_SPEC}: ${row.sourceKey} не из снимка`)
  }
  if (queues.existing.length !== reconciliation.counts.linkedByKey + reconciliation.counts.linkedByUrl) {
    throw new Error(`${JAPAN_GUIDE_QUEUES_SPEC}: связей ${queues.existing.length}, сверка насчитала ${reconciliation.counts.linkedByKey + reconciliation.counts.linkedByUrl}`)
  }
  const reasons = {}
  for (const row of rows) reasons[`${row.queue}:${row.reason}`] = (reasons[`${row.queue}:${row.reason}`] ?? 0) + 1
  const report = {
    spec: JAPAN_GUIDE_QUEUES_SPEC,
    createdAt,
    portal: 'japan-guide',
    inputs: {
      snapshot: { spec: snapshot.contractVersion, digest: snapshot.snapshotDigest, records: snapshot.records.length },
      batch: { adapterVersion: intake.batch.adapterVersion, batchDigest: intake.batch.batchDigest },
      intake: { candidates: derived.candidates.length, refused: derived.refusedQueue.length, intakeDigest: derived.intakeDigest },
      airtable: reconciliation.inputs.airtable,
      matcherPolicy: { version: MATCHER_POLICY_VERSION, digest: matcherPolicyDigest() },
    },
    counts: { total, ...Object.fromEntries(QUEUES.map((q) => [q, queues[q].length])) },
    reasons,
    reconciliation: reconciliation.counts,
    generalVerdicts: derived.evaluated.reduce((acc, e) => { acc[e.verdict.terminal] = (acc[e.verdict.terminal] ?? 0) + 1; return acc }, {}),
    queues,
    effects: { network: 0, google: 0, model: 0, post: 0, patch: 0, delete: 0 },
  }
  return { ...report, reportDigest: sha256Bytes(canonicalJsonBytes({ ...report, createdAt: null }, JAPAN_GUIDE_QUEUES_SPEC)) }
}

export function summarizeJapanGuideQueues(report) {
  const c = report.counts
  return [
    `ОЧЕРЕДИ JAPAN GUIDE без сети — строк ${c.total}: existing ${c.existing}, candidate ${c.candidate}, routedElsewhere ${c.routedElsewhere}, review ${c.review}, rejected ${c.rejected}`,
    `снимок ${report.inputs.snapshot.digest}; выгрузка Airtable ${report.inputs.airtable.exportDigest} (${report.inputs.airtable.totalRecordCount} записей); пакет ${report.inputs.batch.batchDigest}`,
    `сверка: по ключу ${report.reconciliation.linkedByKey}, по имени ${report.reconciliation.nameCandidates}, неоднозначных ${report.reconciliation.ambiguous}, конфликтов ${report.reconciliation.conflicts}, без соответствия ${report.reconciliation.unmatched}`,
    `эффектов 0: сеть 0, Google 0, модель 0, POST/PATCH/DELETE 0`,
  ].join('\n')
}
