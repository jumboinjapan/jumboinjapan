#!/usr/bin/env node
/**
 * JA-4: ограниченное опознание места через общий резолвер.
 *
 *   node tests/poi-place-identification.mjs
 *
 * Доказывается:
 *   • опознаются только строки, дошедшие до ответа сайта в JA-3; те, до
 *     которых бесплатный этап не добрался, в платный не попадают;
 *   • потолок объявлен до первого вызова, больше 20 не принимается ВООБЩЕ, а
 *     исчерпание даёт `notAttempted` — не ошибку и не review;
 *   • каждый вызов учтён, включая не вернувшийся: счётчик растёт ДО обращения;
 *   • неоднозначный ответ не выбирается автоматически: `ambiguous` уходит к
 *     человеку и места не несёт;
 *   • ни один исход, кроме `resolved`, не несёт места;
 *   • тариф объявляется снаружи: без него отчёт не собирается, а верхняя
 *     граница стоимости считается по нему, а не по догадке.
 */
import {
  buildIdentificationReport, COORDINATE_TTL_DAYS, identificationQueueFrom, IDENTIFICATION_OUTCOMES,
  MAX_DIAGNOSTIC_CALLS, PLACE_IDENTIFICATION_SPEC, REVIEW_OUTCOMES, runIdentification,
  storablePlace, summarizeIdentification,
} from '../scripts/poi-portals/lib/place-identification.mjs'
import { PLACE_RESOLUTION_OUTCOMES } from '../src/lib/place-resolve.ts'
import { parseIdentifyArgs, runIdentifyCli } from '../scripts/poi-portals/identify-japan-guide.mjs'
import { canonicalJsonBytes } from '../scripts/lib/canonical-contract.mjs'
import { sha256Bytes } from '../scripts/lib/byte-digest.mjs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Отчёт с настоящей подписью — той же формулой, что у производственных сборщиков. */
const signReport = (raw, spec) => {
  const body = { ...raw }
  delete body.reportDigest
  return { ...body, reportDigest: sha256Bytes(canonicalJsonBytes({ ...body, createdAt: null }, spec)) }
}

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${String(text).slice(0, 240)}» нет «${needle}»`)
}
const boom = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e instanceof Error ? e.message : String(e) } }

const NOW = new Date('2026-09-08T13:00:00.000Z')
const PLACE = { placeId: 'ChIJtest0000000000000001', lat: 34.5951, lon: 133.7723, matchedName: '大原美術館' }
const enrichmentRow = (key, outcome, facts = []) => ({
  sourceKey: key, nameEn: `Object ${key}`, sourceUrl: `https://www.japan-guide.com/e/${key}.html`,
  outcome, hint: 'https://site.jp/', facts, omissions: [], review: false,
})
const fact = (field, value, place = 0) => ({ field, value, place, sourceUrl: 'https://site.jp/', observedAt: NOW.toISOString(), locator: 'jsonld:Place', confidence: 'unverified', verifiedAt: null })

/* ── 1. В платный этап идут только дошедшие до ответа сайта ─────────────── */
{
  const report = {
    rows: [
      enrichmentRow('e1', 'enriched', [fact('nameJa', '大原美術館'), fact('lat', '34.5951'), fact('lon', '133.7723')]),
      enrichmentRow('e2', 'noFacts'),
      enrichmentRow('e3', 'budgetNotSpent'),
      enrichmentRow('e4', 'policyUnknown'),
      enrichmentRow('e5', 'noOfficialUrl'),
    ],
  }
  const queue = identificationQueueFrom(report)
  t('недоступный официальный сайт не блокирует независимое опознание', queue.map((r) => r.sourceKey).join(','), 'e1,e2,e4,e5')
  t('  японское имя взято из наблюдения JA-3', queue[0].nameJa, '大原美術館')
  t('  координаты наблюдения стали предпочтением поиска', `${queue[0].locationBias.lat},${queue[0].locationBias.lon}`, '34.5951,133.7723')
  t('  без наблюдений предпочтения нет', queue[1].locationBias, null)
  t('  английское имя из discovery остаётся запасным ключом', queue[1].nameEn, 'Object e2')
}

/* ── 2. Исходы резолвера переносятся как есть ───────────────────────────── */
{
  const byKey = {
    e1: { outcome: 'resolved', place: PLACE, reason: 'имя совпало' },
    e2: { outcome: 'ambiguous', place: null, reason: 'прошли двое' },
    e3: { outcome: 'notFound', place: null, reason: 'ни один не прошёл' },
    e4: { outcome: 'providerError', place: null, reason: 'Google ответил 500' },
    e5: { outcome: 'malformedResponse', place: null, reason: 'тело не той формы' },
  }
  const queue = Object.keys(byKey).map((key) => ({ sourceKey: key, nameEn: `Object ${key}`, nameJa: null, sourceUrl: `https://x/${key}`, address: null, locationBias: null, enrichedFrom: null }))
  const calls = []
  const result = await runIdentification({
    queue, limit: 10, now: () => NOW,
    resolve: async (query) => { calls.push(query); return byKey[queue[calls.length - 1].sourceKey] },
  })
  const rows = Object.fromEntries(result.rows.map((r) => [r.sourceKey, r]))
  t('опознано — место есть', rows.e1.place.placeId, PLACE.placeId)
  t('  и к человеку не уходит', rows.e1.review, false)
  t('неоднозначно — к человеку', `${rows.e2.outcome}/${rows.e2.review}`, 'ambiguous/true')
  t('  и места не несёт', rows.e2.place, null)
  t('не найдено — к человеку', rows.e3.review, true)
  t('отказ провайдера — к человеку', rows.e4.review, true)
  t('после отказа провайдера следующие строки не вызываются', rows.e5.outcome, 'notAttempted')
  t('вызовы остановлены на первом отказе провайдера', result.calls, 4)
  t('исходы резолвера не переименованы', PLACE_RESOLUTION_OUTCOMES.every((o) => IDENTIFICATION_OUTCOMES.includes(o)), true)
  t('review-исходы закрыты', REVIEW_OUTCOMES.join(','), 'ambiguous,notFound,providerError,malformedResponse,noQuery,noQueryKeys')
  has('исход вне закрытого списка — отказ', await boom(() => runIdentification({
    queue: queue.slice(0, 1), limit: 1, now: () => NOW, resolve: async () => ({ outcome: 'guessed', place: null, reason: '' }),
  })), 'вне закрытого списка')
}

/* ── 3. Потолок вызовов ─────────────────────────────────────────────────── */
{
  const queue = ['e1', 'e2', 'e3', 'e4'].map((key) => ({ sourceKey: key, nameEn: `Object ${key}`, nameJa: null, sourceUrl: `https://x/${key}`, address: null, locationBias: null, enrichedFrom: null }))
  const result = await runIdentification({ queue, limit: 2, now: () => NOW, resolve: async () => ({ outcome: 'notFound', place: null, reason: 'нет' }) })
  t('сделано ровно столько вызовов, сколько разрешено', result.calls, 2)
  t('остальные строки — не пробованы', result.rows.filter((r) => r.outcome === 'notAttempted').length, 2)
  t('  и они не уходят к человеку: до них не добрались', result.rows.filter((r) => r.outcome === 'notAttempted').every((r) => !r.review), true)
  t('  и вызова у них не было', result.rows.filter((r) => r.outcome === 'notAttempted').every((r) => !r.called), true)
  const zero = await runIdentification({ queue, limit: 0, now: () => NOW, resolve: async () => { throw new Error('вызова быть не должно') } })
  t('нулевой потолок не делает ни одного вызова', zero.calls, 0)
  has('потолок выше разрешённого не принимается', await boom(() => runIdentification({ queue, limit: MAX_DIAGNOSTIC_CALLS + 1, now: () => NOW, resolve: async () => ({}) })), 'превышает разрешённые 20')
  has('отрицательный потолок — отказ', await boom(() => runIdentification({ queue, limit: -1, now: () => NOW, resolve: async () => ({}) })), 'целым не меньше нуля')
  t('потолок решения владельца назван в коде', MAX_DIAGNOSTIC_CALLS, 20)
}

/* ── 4. Учтён и не вернувшийся вызов ────────────────────────────────────── */
{
  const queue = [{ sourceKey: 'e1', nameEn: 'Object', nameJa: null, sourceUrl: 'https://x', address: null, locationBias: null, enrichedFrom: null }]
  let seen = null
  await runIdentification({
    queue, limit: 3, now: () => NOW,
    resolve: async () => { seen = 'вызов сделан'; throw new Error('провайдер оборвал связь') },
  }).catch(() => {})
  t('обращение состоялось до того, как ответ не пришёл', seen, 'вызов сделан')
  const noKeys = await runIdentification({
    queue: [{ sourceKey: 'e9', nameEn: '', nameJa: null, sourceUrl: 'https://x', address: null, locationBias: null, enrichedFrom: null }],
    limit: 3, now: () => NOW, resolve: async () => { throw new Error('вызова быть не должно') },
  })
  t('строка без имён вызова не тратит', noKeys.calls, 0)
  t('  и уходит к человеку', `${noKeys.rows[0].outcome}/${noKeys.rows[0].review}`, 'noQueryKeys/true')
}

/* ── 5. Отчёт: закон сохранения, тариф, стоимость ───────────────────────── */
{
  const queue = ['e1', 'e2', 'e3'].map((key) => ({ sourceKey: key, nameEn: `Object ${key}`, nameJa: null, sourceUrl: `https://x/${key}`, address: null, locationBias: null, enrichedFrom: null }))
  const result = await runIdentification({
    queue, limit: 2, now: () => NOW,
    resolve: async () => ({ outcome: 'resolved', place: PLACE, reason: 'совпало' }),
  })
  const inputs = { enrichment: { digest: `sha256:${'0'.repeat(64)}`, queue: 3 } }
  const report = buildIdentificationReport({ queue, result, limit: 2, priceMicros: 32000, createdAt: NOW.toISOString(), inputs })
  t('сумма исходов равна очереди', IDENTIFICATION_OUTCOMES.reduce((n, o) => n + report.counts[o], 0), 3)
  t('вызовов учтено', report.spend.calls, 2)
  t('верхняя граница стоимости считается по объявленному тарифу', report.spend.maxCostMicros, 64000)
  t('  и граница потолка тоже', report.spend.ceilingCostMicros, 64000)
  t('потолок решения владельца назван в отчёте', report.limits.ceiling, MAX_DIAGNOSTIC_CALLS)
  t('записей нет', JSON.stringify(report.effects), JSON.stringify({ post: 0, patch: 0, delete: 0 }))
  t('отпечаток отчёта не зависит от момента', report.reportDigest,
    buildIdentificationReport({ queue, result, limit: 2, priceMicros: 32000, createdAt: '2027-01-01T00:00:00.000Z', inputs }).reportDigest)
  has('сводка не выдаёт расчётный потолок за расходы', summarizeIdentification(report), 'фактические расходы проверяются отдельно')
  has('без тарифа отчёт не собирается', await boom(() => buildIdentificationReport({ queue, result, limit: 2, priceMicros: null, createdAt: NOW.toISOString(), inputs })), 'цену этот модуль не выдумывает')
  has('потерянная строка — отказ', await boom(() => buildIdentificationReport({
    queue, result: { ...result, rows: result.rows.slice(0, 2) }, limit: 2, priceMicros: 1, createdAt: NOW.toISOString(), inputs,
  })), 'закон сохранения нарушен')
  has('расхождение учёта вызовов — отказ', await boom(() => buildIdentificationReport({
    queue, result: { ...result, calls: 1 }, limit: 2, priceMicros: 1, createdAt: NOW.toISOString(), inputs,
  })), 'учёт не сходится')
  has('место при неопознанном исходе — отказ', await boom(() => buildIdentificationReport({
    queue, result: { ...result, rows: result.rows.map((r, i) => (i === 2 ? { ...r, place: PLACE } : r)) },
    limit: 2, priceMicros: 1, createdAt: NOW.toISOString(), inputs,
  })), 'опознанием это не является')
  t('версия названа', PLACE_IDENTIFICATION_SPEC, 'poi-place-identification/v1')
}

/* ── 6. JG2-03: ключи поиска берутся у ОДНОГО места ─────────────────────── */
{
  const conflicted = {
    rows: [{
      ...enrichmentRow('e1', 'enriched'),
      conflicts: ['lat', 'lon', 'nameJa'],
      facts: [fact('lat', '34.39', 0), fact('lon', '132.45', 0), fact('lat', '33.83', 1), fact('lon', '132.76', 1)],
    }],
  }
  has('отчёт с расхождением при исходе enriched — отказ', (() => {
    try { identificationQueueFrom(conflicted); return '(без ошибки)' } catch (e) { return e.message }
  })(), 'отчёт себе противоречит')
  const twoPlaces = {
    rows: [{
      ...enrichmentRow('e1', 'enriched'),
      facts: [fact('lat', '34.39', 0), fact('lon', '132.45', 0), fact('nameJa', '博物館A', 0), fact('lat', '33.83', 1), fact('lon', '132.76', 1)],
    }],
  }
  const queue = identificationQueueFrom(twoPlaces)
  t('два места без объявленного расхождения — ключей не даём', `${queue[0].locationBias}/${queue[0].nameJa}`, 'null/null')
  const onePlace = {
    rows: [{ ...enrichmentRow('e1', 'enriched'), facts: [fact('lat', '34.39', 0), fact('lon', '132.45', 0), fact('nameJa', '博物館A', 0)] }],
  }
  const single = identificationQueueFrom(onePlace)
  t('одно место — пара координат из него', `${single[0].locationBias.lat},${single[0].locationBias.lon}`, '34.39,132.45')
  t('  и имя оттуда же', single[0].nameJa, '博物館A')
  t('расхождение вообще не доходит до платного этапа', identificationQueueFrom({
    rows: [{ ...enrichmentRow('e2', 'factsConflict'), conflicts: ['lat'], facts: [] }],
  }).length, 0)
}

/* ── 7. JG2-05: правило хранения ────────────────────────────────────────── */
{
  const stored = storablePlace({ ...PLACE, businessStatus: 'OPERATIONAL', prefecture: 'Okayama' }, '2026-09-09')
  t('срок годности координат объявлен', stored.coordinates.validUntil, '2026-10-09')
  t('  и равен правилу проекта', stored.coordinates.ttlDays, COORDINATE_TTL_DAYS)
  t('  а идентификатор срока не имеет', 'validUntil' in stored, false)
  t('отображаемое имя не сохраняется', 'matchedName' in stored, false)
  t('  и нигде не всплывает', JSON.stringify(stored).includes(PLACE.matchedName), false)
  const queue = [{ sourceKey: 'e1', nameEn: 'Object', nameJa: null, sourceUrl: 'https://x', address: null, locationBias: null, enrichedFrom: null }]
  const result = await runIdentification({
    queue, limit: 1, now: () => NOW,
    resolve: async () => ({ outcome: 'resolved', place: PLACE, reason: `Опознано как «${PLACE.matchedName}»` }),
  })
  const report = buildIdentificationReport({ queue, result, limit: 1, priceMicros: 32000, createdAt: NOW.toISOString(), inputs: {} })
  const serialized = JSON.stringify(report)
  t('в отчёте нет имени Google', serialized.includes(PLACE.matchedName), false)
  t('  и нет сырой причины резолвера', serialized.includes('Опознано как'), false)
  t('  но исход назван', report.rows[0].detail, 'исход резолвера: resolved')
  t('правило хранения объявлено в отчёте', report.retention.coordinatesTtlDays, COORDINATE_TTL_DAYS)
  t('  и имена названы нехранимыми', report.retention.googleDisplayNames, 'не хранятся')
  const withName = { ...result, rows: [{ ...result.rows[0], place: { ...report.rows[0].place, matchedName: 'Утечка' } }] }
  has('имя Google в отчёте — отказ', await boom(() => buildIdentificationReport({ queue, result: withName, limit: 1, priceMicros: 1, createdAt: NOW.toISOString(), inputs: {} })), 'хранить нельзя')
  const noTtl = { ...result, rows: [{ ...result.rows[0], place: { placeId: 'ChIJ2', coordinates: { lat: 1, lon: 2 } } }] }
  has('координаты без срока — отказ', await boom(() => buildIdentificationReport({ queue, result: noTtl, limit: 1, priceMicros: 1, createdAt: NOW.toISOString(), inputs: {} })), 'без срока годности')
}

/* ── 8. JG2-06: неоднозначность приходит с вариантами ───────────────────── */
{
  const queue = [{ sourceKey: 'e1', nameEn: 'Example Museum', nameJa: null, sourceUrl: 'https://x', address: null, locationBias: null, enrichedFrom: null }]
  const alternatives = [
    { placeId: 'ChIJaaaaaaaaaaaaaaaaaaaaa1', lat: 34.1, lon: 135.1, businessStatus: 'OPERATIONAL', prefecture: 'Osaka' },
    { placeId: 'ChIJbbbbbbbbbbbbbbbbbbbbb2', lat: 35.2, lon: 139.2, businessStatus: 'OPERATIONAL', prefecture: 'Tokyo' },
  ]
  const result = await runIdentification({
    queue, limit: 1, now: () => NOW,
    resolve: async () => ({ outcome: 'ambiguous', place: null, reason: 'Проверки прошли 2 кандидата: «Example Museum», «Example Museum»', alternatives }),
  })
  const row = result.rows[0]
  t('варианты сохранены', row.alternatives.length, 2)
  t('  и различимы идентификаторами', row.alternatives.map((a) => a.placeId).join(','), 'ChIJaaaaaaaaaaaaaaaaaaaaa1,ChIJbbbbbbbbbbbbbbbbbbbbb2')
  t('  и географией', row.alternatives.map((a) => `${a.coordinates.lat},${a.coordinates.lon}`).join(' | '), '34.1,135.1 | 35.2,139.2')
  t('  у каждого свой срок годности координат', row.alternatives.every((a) => a.coordinates.validUntil === '2026-10-08'), true)
  t('  имён Google в вариантах нет', JSON.stringify(row.alternatives).includes('Example Museum'), false)
  t('  и места при этом нет', row.place, null)
  t('  строка уходит к человеку', row.review, true)
  const report = buildIdentificationReport({ queue, result, limit: 1, priceMicros: 32000, createdAt: NOW.toISOString(), inputs: {} })
  t('отчёт с вариантами собирается', report.counts.ambiguous, 1)
  const strayAlternatives = { ...result, rows: [{ ...row, outcome: 'notFound', alternatives }] }
  has('варианты при неподходящем исходе — отказ', await boom(() => buildIdentificationReport({ queue, result: strayAlternatives, limit: 1, priceMicros: 1, createdAt: NOW.toISOString(), inputs: {} })), 'выбирать не из чего')
}

/* ── 9. JG2-04: CLI проверяет вход до первого платного обращения ────────── */
{
  const AT_ISO = NOW.toISOString()
  const queuesOf = (keys) => signReport({
    spec: 'poi-japan-guide-queues/v1', createdAt: AT_ISO,
    counts: { candidate: keys.length },
    queues: { candidate: keys.map((key) => ({ sourceKey: key, nameEn: `Object ${key}`, url: `https://www.japan-guide.com/e/${key}.html` })), review: [] },
  }, 'poi-japan-guide-queues/v1')
  const enrichmentOf = (keys, extra = {}) => signReport({
    spec: 'poi-enrichment/v1', createdAt: AT_ISO,
    rows: keys.map((key) => ({
      sourceKey: key, nameEn: `Object ${key}`, sourceUrl: `https://www.japan-guide.com/e/${key}.html`,
      outcome: 'noFacts', detail: 'нет', review: true, facts: [], omissions: [], conflicts: [],
    })),
    ...extra,
  }, 'poi-enrichment/v1')

  const dir = await mkdtemp(path.join(tmpdir(), 'jj-jg-identify-'))
  const write = async (name, doc) => {
    const file = path.join(dir, name)
    await writeFile(file, `${JSON.stringify(doc)}\n`, 'utf8')
    return file
  }
  const run = async (queuesDoc, enrichmentDoc, args = []) => {
    const logs = []
    const errors = []
    const origLog = console.log
    const origError = console.error
    console.log = (line) => logs.push(String(line))
    console.error = (line) => errors.push(String(line))
    let calls = 0
    const target = { exitCode: 0 }
    try {
      await runIdentifyCli([
        'node', 'x',
        '--queues', await write(`q${Math.random()}.json`, queuesDoc),
        '--enrichment', await write(`e${Math.random()}.json`, enrichmentDoc),
        '--out', path.join(dir, `o${Math.random()}.json`),
        '--decisions', path.join(dir, `d${Math.random()}.json`),
        ...args,
      ], { now: () => NOW, resolve: async () => { calls += 1; return { outcome: 'notFound', place: null, reason: 'нет' } } }, target, { GOOGLE_PLACES_API_KEY: 'k' })
    } finally { console.log = origLog; console.error = origError }
    return { target, logs, errors, calls }
  }

  const clean = await run(queuesOf(['japan-guide:e1']), enrichmentOf(['japan-guide:e1']))
  t('согласованный вход принимается', clean.target.exitCode, 0)
  t('  и без --live Google не вызывается', clean.calls, 0)

  const foreign = await run(queuesOf(['japan-guide:e1']), enrichmentOf(['japan-guide:e999999']), ['--live', '--price-micros', '32000'])
  t('строка не из очереди candidate — отказ', foreign.target.exitCode, 1)
  has('  и это названо', foreign.errors.join('\n'), 'не принадлежат очереди candidate')
  t('  ни одного вызова Google', foreign.calls, 0)

  const tampered = JSON.parse(JSON.stringify(enrichmentOf(['japan-guide:e1'])))
  tampered.rows[0].sourceKey = 'japan-guide:e999999'
  tampered.rows[0].nameEn = 'Выдуманный объект'
  const forged = await run(queuesOf(['japan-guide:e1']), tampered, ['--live', '--price-micros', '32000'])
  t('изменённый отчёт со старым отпечатком — отказ', forged.target.exitCode, 1)
  has('  и это названо', forged.errors.join('\n'), 'изменён после подписи')
  t('  ни одного вызова Google', forged.calls, 0)

  const mismatched = await run(queuesOf(['japan-guide:e1']),
    enrichmentOf(['japan-guide:e1'], { inputs: { queues: { digest: `sha256:${'9'.repeat(64)}` } } }),
    ['--live', '--price-micros', '32000'])
  t('обогащение по чужим очередям — отказ', mismatched.target.exitCode, 1)
  has('  и это названо', mismatched.errors.join('\n'), 'собран по очередям')
  t('  ни одного вызова Google', mismatched.calls, 0)

  const empty = await run(signReport({ spec: 'poi-japan-guide-queues/v1', createdAt: AT_ISO, counts: {}, queues: { candidate: [], review: [] } }, 'poi-japan-guide-queues/v1'), enrichmentOf([]))
  t('пустая очередь candidate — отказ', empty.target.exitCode, 1)
  has('  и это названо', empty.errors.join('\n'), 'обогащать и опознавать нечего')

  has('живой прогон без тарифа — отказ', (() => {
    try { parseIdentifyArgs(['n', 'x', '--queues', 'a', '--enrichment', 'b', '--out', 'c', '--decisions', 'd', '--live']); return '(без ошибки)' } catch (e) { return e.message }
  })(), '--price-micros обязателен')
  has('потолок выше разрешённого не принимается и в CLI', (() => {
    try { parseIdentifyArgs(['n', 'x', '--queues', 'a', '--enrichment', 'b', '--out', 'c', '--decisions', 'd', '--limit', '21']); return '(без ошибки)' } catch (e) { return e.message }
  })(), 'превышает разрешённые 20')
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ JA-4 ограниченное опознание места: ${ok} проверок пройдено`)
}
