#!/usr/bin/env node
/**
 * Eval матчера POI по размеченной фикстуре (ADR-0002 §9.2).
 *
 *   node tests/poi-matching-eval.mjs
 *   JJ_EVAL_REBASELINE=1 node tests/poi-matching-eval.mjs > v1.json
 *
 * Фикстура: tests/fixtures/poi-matching-eval/v1.json. В каждой паре три
 * разные вещи: `relationship` — продуктовая истина (человек),
 * `expectedDecision` — нормативное действие гейта (человек, владелец),
 * `observedBaseline` — что матчер выдал при политике, чей дайджест
 * закреплён в `matcherPolicy`. Ни одна метка не выводится из матчера:
 * expectedDecision берётся из уже доказанных решений владельца (аудит
 * 06.08.2026, замер 11.08.2026, связи Parent POI в живой базе).
 *
 * Что различает тест.
 *   • Изменение ДАННЫХ — новая пара или правка меток при той же политике:
 *     фикстура правится, дайджест не меняется, baseline новой пары
 *     снимается переснятием.
 *   • Изменение РЕШЕНИЯ — другой observedDecision при том же дайджесте
 *     (правка алгоритма) или другой дайджест при той же версии (правка
 *     порога без bump): провал. Требуется новая версия MATCHER_POLICY_SPEC
 *     и переснятие baseline, при котором расхождения видны построчно.
 *
 * Метрики — пять по ADR §9.2, ни одна не заменяет другую; abstention и
 * coverage закреплены в `metricsBaseline`, чтобы рост доли воздержаний
 * не прошёл незамеченным.
 *
 * Два рода пар (`kind`), различимые в фикстуре и в отчёте:
 *   • `empirical` — пара, как она была прочитана из живой базы или её
 *     замороженных артефактов (`liveReadAt`);
 *   • `derived_control` — ПРОИЗВОДНЫЙ КОНСТРУИРОВАННЫЙ КОНТРОЛЬ: та же
 *     доказанная идентичность, что у эмпирической пары `derivedFrom`, но
 *     входящей записи механически подставлена подтверждённая точка
 *     существующей (`construction.coordinates`). Он не утверждает, что
 *     удалённая запись исторически имела эти координаты
 *     (`construction.historicalClaim = false`), и не является результатом
 *     live-read. Он нужен, чтобы действие `duplicate` имело ожидающую его
 *     пару, когда все настоящие дубли базы слиты, а у их вторых записей
 *     координат не было (решение владельца Q6 = F, 04.09.2026).
 *   Метрики считаются и по всем парам (`metricsBaseline`, как требует
 *   ADR §9.2), и раздельно по родам (`metricsByKind`); покрытие классов и
 *   действий — раздельно по родам (`kindCoverage`), чтобы было видно, какие
 *   требования закрыты только конструированным контролем.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  screenNewPoi,
  MATCHER_POLICY_SPEC,
  MATCHER_POLICY_VERSION,
  matcherPolicyDigest,
  matcherLexiconDigest,
} from '../src/lib/poi-matching.ts'

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/poi-matching-eval/v1.json', import.meta.url))
export const EVAL_CONTRACT = 'poi-matching-eval/v1'
export const RELATIONSHIP_CLASSES = Object.freeze([
  'same_product_poi',
  'same_physical_place',
  'related_distinct',
  'part_whole',
  'co_located',
  'different',
])
export const DECISIONS = Object.freeze(['duplicate', 'not_duplicate', 'needs_review'])
export const PAIR_KINDS = Object.freeze(['empirical', 'derived_control'])
/** Единственное место, где вердикт гейта переводится в действие eval. */
export const DECISION_MAPPING = Object.freeze({
  blocked_duplicate: 'duplicate',
  needs_review: 'needs_review',
  clear: 'not_duplicate',
})

const rebaseline = process.env.JJ_EVAL_REBASELINE === '1'
let passed = 0
const failures = []

function check(label, actual, expected) {
  const ok = actual === expected
  if (ok) passed += 1
  else failures.push(`${label}\n    ожидалось: ${expected}\n    получено:  ${actual}`)
}

function round4(value) {
  return value === null ? null : Math.round(value * 10000) / 10000
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : round4(numerator / denominator)
}

function f1(precision, recall) {
  if (precision === null || recall === null) return null
  if (precision + recall === 0) return 0
  return round4((2 * precision * recall) / (precision + recall))
}

/** P/R/F1 дублей: положительный прогноз — duplicate, истина — same_product_poi. */
function duplicateQuality(rows) {
  let tp = 0
  let fp = 0
  let fn = 0
  for (const row of rows) {
    const predicted = row.observed === 'duplicate'
    const truth = row.relationship === 'same_product_poi'
    if (predicted && truth) tp += 1
    else if (predicted && !truth) fp += 1
    else if (!predicted && truth) fn += 1
  }
  const precision = ratio(tp, tp + fp)
  const recall = ratio(tp, tp + fn)
  return { tp, fp, fn, precision, recall, f1: f1(precision, recall) }
}

export function computeMetrics(rows) {
  const total = rows.length
  const abstained = rows.filter((r) => r.observed === 'needs_review').length
  const covered = rows.filter((r) => r.observed !== 'needs_review')
  const confusion = {}
  for (const expected of DECISIONS) {
    for (const observed of DECISIONS) confusion[`${expected}->${observed}`] = 0
  }
  let exact = 0
  for (const row of rows) {
    confusion[`${row.expected}->${row.observed}`] += 1
    if (row.expected === row.observed) exact += 1
  }
  return {
    pairs: total,
    overall: duplicateQuality(rows),
    confusion,
    exactMatchRate: ratio(exact, total),
    abstentionRate: ratio(abstained, total),
    coverage: ratio(covered.length, total),
    selective: { covered: covered.length, ...duplicateQuality(covered) },
  }
}

function observe(pair) {
  const incoming = {
    nameRu: pair.incoming.nameRu,
    nameEn: pair.incoming.nameEn,
    siteCity: pair.incoming.siteCity,
    lat: pair.incoming.lat ?? null,
    lon: pair.incoming.lon ?? null,
  }
  const existing = {
    poiId: pair.existing.poiId,
    nameRu: pair.existing.nameRu,
    nameEn: pair.existing.nameEn,
    siteCity: pair.existing.siteCity,
    lat: pair.existing.lat ?? null,
    lon: pair.existing.lon ?? null,
    placeId: pair.existing.placeId,
  }
  const screen = screenNewPoi(incoming, [existing])
  const decision = DECISION_MAPPING[screen.verdict]
  if (!decision) throw new Error(`eval: вердикт «${screen.verdict}» не отображён в действие`)
  return { screen, decision }
}

// ── 1. Контракт фикстуры ─────────────────────────────────────────────────
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
check('contractVersion фикстуры', fixture.contractVersion, EVAL_CONTRACT)
check('классы relationship — ровно шесть из ADR §9.2, в том же порядке', fixture.relationshipClasses.join(','), RELATIONSHIP_CLASSES.join(','))
check('отображение вердиктов в действия совпадает с DECISION_MAPPING', JSON.stringify(fixture.decisionMapping), JSON.stringify(DECISION_MAPPING))
check('в фикстуре есть пары', Array.isArray(fixture.pairs) && fixture.pairs.length > 0, true)

const ids = new Set()
const classCounts = Object.fromEntries(RELATIONSHIP_CLASSES.map((c) => [c, 0]))
for (const pair of fixture.pairs) {
  check(`пара «${pair.id}»: id уникален`, ids.has(pair.id), false)
  ids.add(pair.id)
  check(`пара «${pair.id}»: relationship из шести классов`, RELATIONSHIP_CLASSES.includes(pair.relationship), true)
  check(`пара «${pair.id}»: expectedDecision из трёх действий`, DECISIONS.includes(pair.expectedDecision), true)
  check(`пара «${pair.id}»: provenance.kind задан`, typeof pair.provenance?.kind === 'string' && pair.provenance.kind.length > 0, true)
  check(`пара «${pair.id}»: provenance.sources непуст`, Array.isArray(pair.provenance?.sources) && pair.provenance.sources.length > 0, true)
  check(`пара «${pair.id}»: provenance.quote задана`, typeof pair.provenance?.quote === 'string' && pair.provenance.quote.length > 0, true)
  check(`пара «${pair.id}»: incoming.nameRu и siteCity`, Boolean(pair.incoming?.nameRu && pair.incoming?.siteCity), true)
  check(`пара «${pair.id}»: existing.poiId и nameRu`, Boolean(pair.existing?.poiId && pair.existing?.nameRu), true)
  check(`пара «${pair.id}»: kind — empirical или derived_control`, PAIR_KINDS.includes(pair.kind), true)
  if (pair.kind === 'derived_control') {
    const origin = fixture.pairs.find((p) => p.id === pair.derivedFrom)
    check(`контроль «${pair.id}»: помечен constructed = true`, pair.constructed, true)
    check(`контроль «${pair.id}»: derivedFrom указывает на существующую пару`, Boolean(origin), true)
    check(`контроль «${pair.id}»: исходная пара — эмпирическая`, origin?.kind, 'empirical')
    check(`контроль «${pair.id}»: тот же класс relationship, что у исходной пары`, pair.relationship, origin?.relationship)
    check(`контроль «${pair.id}»: та же существующая запись, что у исходной пары`, pair.existing?.poiId, origin?.existing?.poiId)
    check(`контроль «${pair.id}»: исходная пара не изменена (её expectedDecision не duplicate)`, origin?.expectedDecision !== 'duplicate', true)
    check(`контроль «${pair.id}»: construction.coordinates.source назван`, typeof pair.construction?.coordinates?.source === 'string' && pair.construction.coordinates.source.length > 0, true)
    check(`контроль «${pair.id}»: подставленная точка = точка существующей записи`, `${pair.incoming?.lat},${pair.incoming?.lon}`, `${pair.existing?.lat},${pair.existing?.lon}`)
    check(`контроль «${pair.id}»: construction.coordinates совпадают с incoming`, `${pair.construction?.coordinates?.lat},${pair.construction?.coordinates?.lon}`, `${pair.incoming?.lat},${pair.incoming?.lon}`)
    check(`контроль «${pair.id}»: не утверждает историчность координат (historicalClaim = false)`, pair.construction?.historicalClaim, false)
    check(`контроль «${pair.id}»: доказательство тождества исходной пары названо`, typeof pair.construction?.identityProof === 'string' && pair.construction.identityProof.length > 0, true)
    check(`контроль «${pair.id}»: expectedVerdict — вердикт гейта из DECISION_MAPPING`, Object.hasOwn(DECISION_MAPPING, pair.expectedVerdict), true)
    check(`контроль «${pair.id}»: expectedVerdict согласован с expectedDecision`, DECISION_MAPPING[pair.expectedVerdict], pair.expectedDecision)
  } else {
    check(`пара «${pair.id}»: эмпирическая пара не помечена constructed`, pair.constructed === true, false)
    check(`пара «${pair.id}»: у эмпирической пары нет derivedFrom`, pair.derivedFrom === undefined, true)
  }
  if (pair.relationship in classCounts) classCounts[pair.relationship] += 1
}
// Покрытие по родам: видно, какие классы и действия закрыты только контролем.
const kindCoverage = Object.fromEntries(PAIR_KINDS.map((k) => {
  const ofKind = fixture.pairs.filter((p) => p.kind === k)
  return [k, {
    pairs: ofKind.length,
    classes: Object.fromEntries(RELATIONSHIP_CLASSES.map((c) => [c, ofKind.filter((p) => p.relationship === c).length])),
    actions: Object.fromEntries(DECISIONS.map((d) => [d, ofKind.filter((p) => p.expectedDecision === d).length])),
  }]
}))
check('kindCoverage совпадает с фактическим покрытием по родам пар', JSON.stringify(fixture.kindCoverage), JSON.stringify(kindCoverage))
check('эмпирические пары есть (контроль не заменяет живое чтение)', kindCoverage.empirical.pairs > 0, true)
check('настоящие дубли есть среди ЭМПИРИЧЕСКИХ пар (контроль не единственный same_product_poi)', kindCoverage.empirical.classes.same_product_poi > 0, true)
check('classCoverage совпадает с фактическим числом пар по классам', JSON.stringify(fixture.classCoverage), JSON.stringify(classCounts))
// same_product_poi обязан присутствовать: без настоящих дублей overall recall не определён,
// и система «всё в needs_review» прошла бы eval незамеченной.
check('в фикстуре есть настоящие дубли (same_product_poi)', classCounts.same_product_poi > 0, true)
check('в фикстуре есть пары, которые сливать нельзя', fixture.pairs.some((p) => p.expectedDecision === 'not_duplicate'), true)

// ── 1а. Полнота покрытия: шесть классов и три действия (10f-P R1, инвариант E) ──
// Полный eval требует хотя бы одну ДОКАЗАННУЮ пару каждого класса и каждого
// действия. Пока доказанных пар нет, фикстура не притворяется полной: статус
// BLOCKED_OWNER, и каждый пробел назван поимённым вопросом владельцу. Пробел
// без вопроса — провал; вопрос, закрывающий уже покрытый пробел, — тоже.
const actionCounts = Object.fromEntries(DECISIONS.map((d) => [d, fixture.pairs.filter((p) => p.expectedDecision === d).length]))
const missingClasses = RELATIONSHIP_CLASSES.filter((c) => !(classCounts[c] > 0))
const missingActions = DECISIONS.filter((d) => !(actionCounts[d] > 0))
check('requiredCoverage.classes — шесть классов ADR', (fixture.requiredCoverage?.classes ?? []).join(','), RELATIONSHIP_CLASSES.join(','))
check('requiredCoverage.actions — три действия', (fixture.requiredCoverage?.actions ?? []).join(','), DECISIONS.join(','))
check('статус фикстуры — complete или BLOCKED_OWNER', ['complete', 'BLOCKED_OWNER'].includes(fixture.status), true)
if (fixture.status === 'complete') {
  check('complete: нет пустых классов', missingClasses.join(','), '')
  check('complete: нет пустых действий', missingActions.join(','), '')
  check('complete: вопросов владельцу не осталось', (fixture.ownerQuestions ?? []).length, 0)
} else {
  const gaps = [...missingClasses, ...missingActions]
  check('BLOCKED_OWNER: пробелы действительно есть (иначе статус устарел)', gaps.length > 0, true)
  const questions = Array.isArray(fixture.ownerQuestions) ? fixture.ownerQuestions : []
  check('BLOCKED_OWNER: вопросы владельцу есть', questions.length > 0, true)
  const covered = new Set(questions.flatMap((q) => q.covers ?? []))
  for (const gap of gaps) check(`BLOCKED_OWNER: пробел «${gap}» назван вопросом владельцу`, covered.has(gap), true)
  for (const q of questions) {
    check(`вопрос ${q.id}: называет пару POI-ID`, /POI-\d{6}.*POI-\d{6}/.test(String(q.pair)), true)
    check(`вопрос ${q.id}: задан вопросом`, typeof q.question === 'string' && q.question.trim().endsWith('?'), true)
    for (const c of q.covers ?? []) check(`вопрос ${q.id}: закрывает реальный пробел (${c})`, gaps.includes(c), true)
  }
}

// ── 2. Привязка к политике матчера ───────────────────────────────────────
const liveDigest = matcherPolicyDigest()
check('MATCHER_POLICY_VERSION совпадает со спецификацией политики', MATCHER_POLICY_VERSION, MATCHER_POLICY_SPEC)
if (!rebaseline) {
  check(
    'версия политики матчера в фикстуре = живая (иначе baseline снят для другой политики)',
    fixture.matcherPolicy?.version,
    MATCHER_POLICY_VERSION,
  )
  check(
    'дайджест политики матчера в фикстуре = живой (порог изменён без новой версии и переснятия baseline)',
    fixture.matcherPolicy?.digest,
    liveDigest,
  )
  // Словари входят в общий отпечаток; отдельная строка нужна, чтобы сдвиг
  // читался как «изменён словарь», а не просто «изменена политика».
  check(
    'отпечаток словарей матчера в фикстуре = живой (словарь изменён без новой версии и переснятия baseline)',
    fixture.matcherPolicy?.lexiconDigest,
    matcherLexiconDigest(),
  )
}

// ── 3. Прогон и построчный baseline ──────────────────────────────────────
const rows = []
for (const pair of fixture.pairs) {
  const { screen, decision } = observe(pair)
  check(`пара «${pair.id}»: гейт подписал вердикт живой версией политики`, screen.policyVersion, MATCHER_POLICY_VERSION)
  if (pair.kind === 'derived_control') {
    // Ожидание владельца о текущей политике — проверяется и при переснятии:
    // контроль, который политика v1 не блокирует, — не контроль.
    check(`контроль «${pair.id}»: вердикт матчера = expectedVerdict владельца`, screen.verdict, pair.expectedVerdict)
  }
  if (!rebaseline) {
    check(
      `пара «${pair.id}» (${pair.relationship}, ожидается ${pair.expectedDecision}): observedDecision = baseline при той же политике`,
      decision,
      pair.observedBaseline,
    )
  }
  rows.push({ id: pair.id, kind: pair.kind, relationship: pair.relationship, expected: pair.expectedDecision, observed: decision })
}

// ── 4. Пять метрик ADR §9.2 ──────────────────────────────────────────────
const metrics = computeMetrics(rows)
const metricsByKind = Object.fromEntries(PAIR_KINDS.map((k) => [k, computeMetrics(rows.filter((r) => r.kind === k))]))
if (!rebaseline) {
  check('metricsBaseline закреплён в фикстуре', fixture.metricsBaseline !== null && typeof fixture.metricsBaseline === 'object', true)
  check('метрики совпадают с metricsBaseline (в т.ч. abstention и coverage)', JSON.stringify(metrics), JSON.stringify(fixture.metricsBaseline))
  check('метрики по родам пар совпадают с metricsByKind', JSON.stringify(metricsByKind), JSON.stringify(fixture.metricsByKind))
  check('coverage = 1 − abstentionRate', round4(1 - metrics.abstentionRate), metrics.coverage)
  check('система не отправляет все пары в needs_review', metrics.coverage > 0, true)
  // Качество НЕ утверждается «идеальным»: baseline закрепляет фактические
  // числа, в том числе пропуски и ложные блокировки, — они видны в
  // confusion и меняются только вместе с версией политики и переснятием.
}

// ── 5. Режим переснятия ──────────────────────────────────────────────────
if (rebaseline) {
  const refreshed = {
    ...fixture,
    matcherPolicy: { version: MATCHER_POLICY_VERSION, digest: liveDigest, lexiconDigest: matcherLexiconDigest() },
    metricsBaseline: metrics,
    metricsByKind,
    pairs: fixture.pairs.map((pair, i) => ({ ...pair, observedBaseline: rows[i].observed })),
  }
  const drift = fixture.pairs
    .map((pair, i) => ({ pair, before: pair.observedBaseline, after: rows[i].observed }))
    .filter((d) => d.before !== d.after)
  for (const d of drift) console.error(`  baseline «${d.pair.id}»: ${d.before} → ${d.after}`)
  console.error(`переснято: политика ${fixture.matcherPolicy?.version}@${String(fixture.matcherPolicy?.digest).slice(0, 19)}… → ${MATCHER_POLICY_VERSION}@${liveDigest.slice(0, 19)}…, словари ${String(fixture.matcherPolicy?.lexiconDigest ?? '—').slice(0, 19)}… → ${matcherLexiconDigest().slice(0, 19)}…, изменений baseline: ${drift.length}`)
  process.stdout.write(`${JSON.stringify(refreshed, null, 2)}\n`)
}

if (failures.length > 0) {
  console.error(`\n✗ провалено ${failures.length} из ${passed + failures.length}\n`)
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exitCode = 1
} else {
  const m = metrics
  const e = metricsByKind.empirical
  const d = metricsByKind.derived_control
  const summary = `✓ eval матчера POI: ${passed} проверок пройдено; статус ${fixture.status}; пар ${m.pairs} = ${e.pairs} эмпирических + ${d.pairs} производных контролей (не live-read); эмпирические: coverage ${e.coverage}, abstention ${e.abstentionRate}, overall P/R/F1 ${e.overall.precision}/${e.overall.recall}/${e.overall.f1}, exact ${e.exactMatchRate}; контроли: exact ${d.exactMatchRate}; все пары: coverage ${m.coverage}, abstention ${m.abstentionRate}, overall P/R/F1 ${m.overall.precision}/${m.overall.recall}/${m.overall.f1}, exact ${m.exactMatchRate}`
  // В режиме переснятия stdout занят фикстурой.
  if (rebaseline) console.error(summary)
  else console.log(summary)
}
