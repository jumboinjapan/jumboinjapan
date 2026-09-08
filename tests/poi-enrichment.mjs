#!/usr/bin/env node
/**
 * JA-3: граница бесплатного обогащения — очередь `candidate` → наблюдения.
 *
 *   node tests/poi-enrichment.mjs
 *
 * Доказывается:
 *   • обогащается ТОЛЬКО очередь `candidate` отчёта JG-1;
 *   • каждый исход из закрытого списка, каждая строка получает ровно один,
 *     сумма исходов равна длине очереди;
 *   • недоступный источник — `review`, а не догадка: запрет robots, молчание
 *     robots, неответившая страница и страница без структурных данных названы
 *     по-своему и уходят к человеку;
 *   • полученное остаётся НАБЛЮДЕНИЕМ: `unverified`, `verifiedAt: null`, с
 *     адресом и моментом чтения; поля карточки отсюда не пишутся;
 *   • бюджет спрашивают ДО запроса, robots.txt берут один раз на домен,
 *     исчерпание — названный исход `budgetNotSpent`, а не ошибка и не review;
 *   • сеть в модулях JA-3 не создаётся: ни `fetch`, ни хранилища, ни границ
 *     записи они не импортируют;
 *   • CLI без `--live` не делает НИ ОДНОГО обращения к сети и предъявляет
 *     план; с `--live` идёт только через инъектированную границу; очереди от
 *     другого снимка не принимаются; незнакомая кодировка — отказ, а не
 *     догадка.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  buildDiscoveryRecord, buildDiscoverySnapshot, buildFactLead, buildOrderRecord, buildPageEvidence, orderItem,
} from '../scripts/poi-portals/lib/discovery-contract.mjs'
import {
  charsetOf, createEnrichmentPacer, DEFAULT_OBJECT_LIMIT, isNetworkFailure, liveIo,
  looksLikeRobots, parseEnrichArgs, planFrom, runEnrichCli, snapshotTextFrom,
} from '../scripts/poi-portals/enrich-japan-guide.mjs'
import {
  assertReportDigest, buildEnrichmentReport, ENRICHMENT_OUTCOMES, ENRICHMENT_SPEC, enrichmentQueueFrom,
  officialUrlHints, REVIEW_OUTCOMES, runEnrichment, summarizeEnrichment,
} from '../scripts/poi-portals/lib/enrichment.mjs'
import { openEnrichmentBudget } from '../scripts/poi-portals/lib/source-policy.mjs'
import { canonicalJsonBytes } from '../scripts/lib/canonical-contract.mjs'
import { sha256Bytes } from '../scripts/lib/byte-digest.mjs'

/** Отчёт с настоящей подписью: та же формула, что у производственных сборщиков. */
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

const NOW = new Date('2026-09-08T12:00:00.000Z')
const ROBOTS_OPEN = 'User-agent: *\nDisallow: /admin\n'
const ROBOTS_CLOSED = 'User-agent: *\nDisallow: /\n'
const ldBlock = (value) => `<script type="application/ld+json">${JSON.stringify(value)}</` + `script>`
const PLACE = {
  '@context': 'https://schema.org', '@type': 'Museum', name: '大原美術館',
  url: 'https://ohara.jp/', description: 'Проза, которую мы не берём',
  address: { '@type': 'PostalAddress', postalCode: '710-0046', addressRegion: '岡山県', addressLocality: '倉敷市' },
  geo: { '@type': 'GeoCoordinates', latitude: 34.5951, longitude: 133.7723 },
}

const record = (key, hints) => ({
  sourceKey: key,
  url: `https://www.japan-guide.com/e/${key.split(':')[1]}.html`,
  nameEn: `Object ${key}`,
  factLeads: hints.map((value) => ({ kind: 'official_url_hint', value })),
})
const scene = (specs) => {
  const snapshot = { records: specs.map(([key, hints]) => record(key, hints)) }
  const report = {
    queues: {
      candidate: snapshot.records.map((r) => ({ sourceKey: r.sourceKey, nameEn: r.nameEn, url: r.url })),
      review: [{ sourceKey: 'japan-guide:eREVIEW', nameEn: 'Not for enrichment', url: 'https://www.japan-guide.com/e/eREVIEW.html' }],
    },
  }
  return { snapshot, report }
}
/** Фикстурная сеть: карта домен → robots, карта адрес → страница. */
const fixtureIo = (robots, pages, log = []) => ({
  calls: log,
  async fetchRobots(origin) {
    log.push(`robots ${origin}`)
    const entry = robots[origin]
    if (!entry) return { outcome: 'unavailable', bytes: null }
    if (typeof entry !== 'string') return { outcome: entry.outcome, bytes: null }
    return { outcome: 'fetched', bytes: Buffer.from(entry, 'utf8') }
  },
  async fetchPage(url) {
    log.push(`page ${url}`)
    const page = pages[url]
    if (page === undefined) return { ok: false, detail: 'ответ не получен' }
    return { ok: true, text: page }
  },
})
const run = async ({ specs, robots, pages, limits = { objects: 10, robotsFetches: 10, pageFetches: 10 } }) => {
  const { snapshot, report } = scene(specs)
  const queue = enrichmentQueueFrom(report, snapshot)
  const budget = openEnrichmentBudget(limits)
  const log = []
  const result = await runEnrichment({ queue, budget, io: fixtureIo(robots, pages, log), now: () => NOW })
  const built = buildEnrichmentReport({
    queue, result, budget, createdAt: NOW.toISOString(),
    inputs: { snapshotDigest: 'sha256:' + '0'.repeat(64), queuesDigest: 'sha256:' + '1'.repeat(64) },
  })
  return { queue, result, report: built, log }
}

/* ── 1. Полный проход ───────────────────────────────────────────────────── */
{
  const { report, log } = await run({
    specs: [['japan-guide:e1', ['https://ohara.jp/museum']]],
    robots: { 'https://ohara.jp': ROBOTS_OPEN },
    pages: { 'https://ohara.jp/museum': `<html>${ldBlock(PLACE)}<p>Абзац</p></html>` },
  })
  const row = report.rows[0]
  t('исход — обогащено', row.outcome, 'enriched')
  t('  и к человеку не уходит', row.review, false)
  t('  фактов из закрытого списка', row.facts.map((f) => f.field).join(','), 'address,lat,lon,nameJa,officialUrl,postalCode')
  t('  описание НЕ извлечено', JSON.stringify(row.facts).includes('Проза'), false)
  t('  все факты — наблюдения', row.facts.every((f) => f.confidence === 'unverified' && f.verifiedAt === null), true)
  t('  и несут адрес и момент чтения', row.facts.every((f) => f.sourceUrl === 'https://ohara.jp/museum' && f.observedAt === NOW.toISOString()), true)
  t('порядок обращений: сначала robots, потом страница', log.join(' | '), 'robots https://ohara.jp | page https://ohara.jp/museum')
  t('реестр сайта заведён до обращения к странице', report.policies[0].origin, 'https://ohara.jp')
  t('  и robots.txt взят с того же origin', report.policies[0].robotsUrl, 'https://ohara.jp/robots.txt')
  t('  со статусом и отпечатком robots', `${report.policies[0].status}/${/^sha256:/.test(report.policies[0].robots.digest)}`, 'allowed/true')
  t('эффектов записи нет', JSON.stringify(report.effects), JSON.stringify({ google: 0, model: 0, post: 0, patch: 0, delete: 0 }))
  has('сводка называет нули', summarizeEnrichment(report), 'Google 0, модель 0, POST/PATCH/DELETE 0')
}

/* ── 2. Недоступный источник даёт review, а не догадку ──────────────────── */
{
  const { report } = await run({
    specs: [
      ['japan-guide:e1', ['https://closed.jp/x']],
      ['japan-guide:e2', ['https://silent.jp/x']],
      ['japan-guide:e3', ['https://open.jp/gone']],
      ['japan-guide:e4', ['https://open.jp/bare']],
      ['japan-guide:e5', []],
      ['japan-guide:e6', ['не адрес вовсе']],
    ],
    robots: { 'https://closed.jp': ROBOTS_CLOSED, 'https://silent.jp': { outcome: 'unavailable' }, 'https://open.jp': ROBOTS_OPEN },
    pages: { 'https://open.jp/bare': '<html><body><p>Только проза, структурных данных нет</p></body></html>' },
  })
  const by = Object.fromEntries(report.rows.map((r) => [r.sourceKey, r]))
  t('robots запретил путь', by['japan-guide:e1'].outcome, 'policyDenied')
  t('robots промолчал — не «разрешено»', by['japan-guide:e2'].outcome, 'policyUnknown')
  t('страница не ответила', by['japan-guide:e3'].outcome, 'pageUnavailable')
  t('страница без структурных данных', by['japan-guide:e4'].outcome, 'noFacts')
  t('источник не дал адреса', by['japan-guide:e5'].outcome, 'noOfficialUrl')
  t('подсказка не адрес', by['japan-guide:e6'].outcome, 'hintUnusable')
  t('все шестеро уходят к человеку', report.rows.every((r) => r.review), true)
  t('  и ни у кого нет фактов', report.rows.every((r) => r.facts.length === 0), true)
  t('счётчик review сходится', report.counts.review, 6)
  t('к молчащему домену за страницей не ходили', report.rows.filter((r) => r.outcome === 'policyUnknown').every((r) => r.facts.length === 0), true)
  t('исходы review закрыты', REVIEW_OUTCOMES.join(','), 'factsConflict,noFacts,noOfficialUrl,hintUnusable,policyDenied,policyUnknown,pageUnavailable')
}

/* ── 3. Бюджет и один robots.txt на домен ───────────────────────────────── */
{
  const { report, log } = await run({
    specs: [
      ['japan-guide:e1', ['https://ohara.jp/a']],
      ['japan-guide:e2', ['https://ohara.jp/b']],
      ['japan-guide:e3', ['https://ohara.jp/c']],
    ],
    robots: { 'https://ohara.jp': ROBOTS_OPEN },
    pages: { 'https://ohara.jp/a': ldBlock(PLACE), 'https://ohara.jp/b': ldBlock(PLACE), 'https://ohara.jp/c': ldBlock(PLACE) },
    limits: { objects: 3, robotsFetches: 3, pageFetches: 2 },
  })
  t('robots.txt запрошен один раз на сайт', log.filter((line) => line.startsWith('robots ')).length, 1)
  t('страниц запрошено ровно по бюджету', log.filter((line) => line.startsWith('page ')).length, 2)
  t('третья строка не дошла', report.rows[2].outcome, 'budgetNotSpent')
  t('  и к человеку не уходит: до неё просто не добрались', report.rows[2].review, false)
  t('бюджет объявляет себя исчерпанным', `${report.budget.exhausted}/${report.budget.exhaustedBy}`, 'true/pageFetch')
  t('потрачено и осталось названо', `${report.budget.spent.pageFetch}/${report.budget.remaining.pageFetch}`, '2/0')
  has('сводка называет исчерпание', summarizeEnrichment(report), 'исчерпан на pageFetch')
  const zero = await run({
    specs: [['japan-guide:e1', ['https://ohara.jp/a']]],
    robots: { 'https://ohara.jp': ROBOTS_OPEN }, pages: {},
    limits: { objects: 0, robotsFetches: 0, pageFetches: 0 },
  })
  t('нулевой бюджет не делает ни одного запроса', zero.log.length, 0)
  t('  и это назван исход, а не ошибка', zero.report.rows[0].outcome, 'budgetNotSpent')
}

/* ── 4. Закон сохранения и форма отчёта ─────────────────────────────────── */
{
  const { queue, result, report } = await run({
    specs: [['japan-guide:e1', ['https://ohara.jp/a']], ['japan-guide:e2', []]],
    robots: { 'https://ohara.jp': ROBOTS_OPEN }, pages: { 'https://ohara.jp/a': ldBlock(PLACE) },
  })
  t('очередь — только candidate, review не обогащается', queue.length, 2)
  t('сумма исходов равна очереди', ENRICHMENT_OUTCOMES.reduce((n, o) => n + report.counts[o], 0), report.counts.queue)
  t('каждая строка ровно один раз', new Set(report.rows.map((r) => r.sourceKey)).size, 2)
  t('факты сосчитаны по полям', report.facts.address, 1)
  t('отпечаток отчёта не зависит от момента', report.reportDigest, buildEnrichmentReport({
    queue, result, budget: { report: () => report.budget }, createdAt: '2027-01-01T00:00:00.000Z', inputs: report.inputs,
  }).reportDigest)
  has('исход вне списка — отказ', await boom(() => buildEnrichmentReport({
    queue, result: { ...result, rows: [{ ...report.rows[0], outcome: 'guessed' }, report.rows[1]] },
    budget: { report: () => report.budget }, createdAt: NOW.toISOString(), inputs: report.inputs,
  })), 'вне закрытого списка')
  has('потерянная строка — отказ', await boom(() => buildEnrichmentReport({
    queue, result: { ...result, rows: [report.rows[0]] }, budget: { report: () => report.budget },
    createdAt: NOW.toISOString(), inputs: report.inputs,
  })), 'закон сохранения нарушен')
  const { snapshot, report: queues } = scene([['japan-guide:e1', []]])
  has('строка очереди не из снимка — отказ', await boom(() => enrichmentQueueFrom(
    { queues: { candidate: [{ sourceKey: 'japan-guide:eX', nameEn: 'X', url: 'https://x' }] } }, snapshot,
  )), 'отчёт и снимок разные')
  t('подсказки берутся все, используется первая', officialUrlHints({ factLeads: [
    { kind: 'official_url_hint', value: 'https://a.jp' }, { kind: 'hours_hint', value: '9-17' }, { kind: 'official_url_hint', value: 'https://b.jp' },
  ] }).join(','), 'https://a.jp,https://b.jp')
  t('очередь несёт подсказки, а не решения', queues.queues.candidate.length, 1)
}

/* ── 4а. JG2-03: страница с несколькими местами не даёт третьего ────────── */
{
  const TWO = [
    { '@context': 'https://schema.org', '@type': 'Museum', name: '博物館A', geo: { '@type': 'GeoCoordinates', latitude: 34.39, longitude: 132.45 } },
    { '@context': 'https://schema.org', '@type': 'Museum', name: '博物館B', geo: { '@type': 'GeoCoordinates', latitude: 33.83, longitude: 132.76 } },
  ]
  const { report } = await run({
    specs: [['japan-guide:e1', ['https://two.jp/page']]],
    robots: { 'https://two.jp': ROBOTS_OPEN },
    pages: { 'https://two.jp/page': ldBlock(TWO) },
  })
  const row = report.rows[0]
  t('расхождение мест названо исходом', row.outcome, 'factsConflict')
  t('  и уходит к человеку', row.review, true)
  t('  расходящиеся поля перечислены', row.conflicts.join(','), 'lat,lon,nameJa')
  t('  оба места сохранены целиком', row.facts.length, 6)
  t('  и каждый факт помнит своё место', new Set(row.facts.map((f) => f.place)).size, 2)
  const pairs = [0, 1].map((place) => row.facts.filter((f) => f.place === place).filter((f) => f.field === 'lat' || f.field === 'lon').map((f) => f.value).join(','))
  t('  координаты остались парами источника', pairs.join(' | '), '34.39,132.45 | 33.83,132.76')
  t('  третьей точки не появилось', JSON.stringify(row.facts).includes('"33.83"') && JSON.stringify(row.facts).includes('"132.45"') && pairs.includes('33.83,132.45'), false)
  const one = await run({
    specs: [['japan-guide:e2', ['https://one.jp/page']]],
    robots: { 'https://one.jp': ROBOTS_OPEN },
    pages: { 'https://one.jp/page': ldBlock(TWO[0]) },
  })
  t('одно место — обычный enriched без расхождений', `${one.report.rows[0].outcome}/${one.report.rows[0].conflicts.length}`, 'enriched/0')
}

/* ── 4б. JG2-04: отчёт проверяется отпечатком, а не версией ─────────────── */
{
  const { report } = await run({
    specs: [['japan-guide:e1', ['https://ohara.jp/a']]],
    robots: { 'https://ohara.jp': ROBOTS_OPEN }, pages: { 'https://ohara.jp/a': ldBlock(PLACE) },
  })
  t('свой отчёт проходит проверку отпечатка', assertReportDigest(report, ENRICHMENT_SPEC, 'x').spec, ENRICHMENT_SPEC)
  const tampered = { ...report, rows: report.rows.map((r) => ({ ...r, sourceKey: 'japan-guide:e999999' })) }
  has('изменённый отчёт со старым отпечатком — отказ', await boom(() => assertReportDigest(tampered, ENRICHMENT_SPEC, 'x')), 'изменён после подписи')
  has('чужая версия — отказ', await boom(() => assertReportDigest(report, 'poi-something/v1', 'x')), 'ожидается «poi-something/v1»')
  has('отчёт без отпечатка — отказ', await boom(() => assertReportDigest({ ...report, reportDigest: undefined }, ENRICHMENT_SPEC, 'x')), 'принимать нечего')
  has('отпечаток не той формы — отказ', await boom(() => assertReportDigest({ ...report, reportDigest: 'not-a-digest' }, ENRICHMENT_SPEC, 'x')), 'принимать нечего')
  t('момент создания в отпечаток не входит', assertReportDigest({ ...report, createdAt: '2027-01-01T00:00:00.000Z' }, ENRICHMENT_SPEC, 'x').spec, ENRICHMENT_SPEC)
}

/* ── 5. Сеть здесь не создаётся ─────────────────────────────────────────── */
{
  const src = [
    await readFile(new URL('../scripts/poi-portals/lib/enrichment.mjs', import.meta.url), 'utf8'),
    await readFile(new URL('../scripts/poi-portals/lib/source-policy.mjs', import.meta.url), 'utf8'),
    await readFile(new URL('../scripts/poi-portals/lib/official-page.mjs', import.meta.url), 'utf8'),
  ].join('\n')
  const code = src.replace(/\/\*[^]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  t('JA-3 не вызывает fetch', /\bfetch\s*\(/.test(code), false)
  t('JA-3 не импортирует хранилище, резолвер и границы записи', /airtable-store|verified-write|verified-update|write-journal|update-journal|place-resolve/.test(code), false)
  t('JA-3 не содержит POST/PATCH/DELETE', /method: '(POST|PATCH|DELETE)'/.test(code), false)
  has('граница требует инъекции сети', await boom(() => runEnrichment({ queue: [], budget: openEnrichmentBudget({ objects: 1, robotsFetches: 1, pageFetches: 1 }), io: {}, now: () => NOW })), 'сеть этот модуль не создаёт')
  t('версия границы названа', ENRICHMENT_SPEC, 'poi-enrichment/v1')
}

/* ── 6. CLI: сухой прогон по умолчанию ──────────────────────────────────── */
{
  const HOST = 'https://www.japan-guide.com'
  const AT = '2026-09-06T00:00:00.000Z'
  const DIGEST = (n) => `sha256:${'0123456789abcdef'[n % 16].repeat(64)}`
  const evidence = (url, pageRole, rawPageDigest) => buildPageEvidence({
    url, pageRole, pageBytes: 1024, rawPageDigest, observedAt: AT, httpCharset: 'shift-jis', metaCharset: 'utf-8',
    decodePolicy: 'mixed-page-utf8-locators-v1', decodeErrorCount: 0, decodeReplacements: 0, nonWhitelistedCodepoints: 0,
  })
  const rows = [
    { id: 'e9001', nameEn: 'Alpha Castle', hint: 'https://alpha.jp/place' },
    { id: 'e9002', nameEn: 'Beta Garden', hint: null },
  ]
  const snapshot = buildDiscoverySnapshot({
    scope: { kind: 'full', limit: null },
    entryUrl: `${HOST}/e/e623a.html`,
    incompleteReasons: [],
    networkPolicy: { maxNetworkRequests: 6000, maxRedirects: 2 },
    robotsEvidence: { url: `${HOST}/robots.txt`, bytes: 64, digest: DIGEST(12), observedAt: AT, appliedGroups: ['*'] },
    catalogueEvidence: evidence(`${HOST}/e/e623a.html`, 'catalogue', DIGEST(10)),
    catalogueTargetEvidence: [{ sourceKey: 'japan-guide:e2157', evidence: evidence(`${HOST}/e/e2157.html`, 'collection', DIGEST(11)) }],
    nestedCollectionEvidence: [],
    orderRecords: [buildOrderRecord({
      destinationSourceKey: 'japan-guide:e2157', sourcePageDigest: DIGEST(11), collectionKind: 'ranked',
      items: rows.map((row) => orderItem('poi', `japan-guide:${row.id}`)),
    })],
    records: rows.map((row, index) => buildDiscoveryRecord({
      sourceKey: `japan-guide:${row.id}`,
      url: `${HOST}/e/${row.id}.html`,
      nameEn: row.nameEn,
      placements: [{ kind: 'destinationRanking', collectionSourceKey: 'japan-guide:e2157', listPosition: index + 1, editorialLevel: 0, categoryHint: 'Castle' }],
      factLeads: row.hint ? [buildFactLead({ kind: 'official_url_hint', value: row.hint, source: `${HOST}/e/${row.id}.html`, sourceLocator: 'links_and_resources_official', observedAt: AT })] : [],
      omissions: [],
      pageEvidence: evidence(`${HOST}/e/${row.id}.html`, 'poi', DIGEST(index)),
    })),
    rejected: { targets: [], cards: [], nodes: [], pois: [] },
    counters: {
      networkRequests: 12, catalogueTargetsFound: 1, catalogueCollectionsFound: 1, nestedCollectionsFound: 0,
      directPoisFound: 0, poisFound: rows.length, recordsAttempted: rows.length, recordsBuilt: rows.length,
      nonCanonicalLinks: 0, unknownAdmissionLabels: 0, emptyAdmissionValues: 0,
    },
  })
  const queues = signReport({
    spec: 'poi-japan-guide-queues/v1',
    createdAt: NOW.toISOString(),
    inputs: { snapshot: { digest: snapshot.snapshotDigest, records: snapshot.records.length } },
    counts: { candidate: 2 },
    queues: { candidate: snapshot.records.map((r) => ({ sourceKey: r.sourceKey, nameEn: r.nameEn, url: r.url })) },
  }, 'poi-japan-guide-queues/v1')
  const dir = await mkdtemp(path.join(tmpdir(), 'jj-jg-enrich-'))
  const snapPath = path.join(dir, 'snapshot.json')
  const queuesPath = path.join(dir, 'queues.json')
  const outPath = path.join(dir, 'out.json')
  await writeFile(snapPath, `${JSON.stringify(snapshot)}\n`, 'utf8')
  await writeFile(queuesPath, `${JSON.stringify(queues)}\n`, 'utf8')

  const logs = []
  const origLog = console.log
  const savedFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error('сеть запрещена') }
  console.log = (line) => logs.push(String(line))
  const target = { exitCode: 0 }
  try {
    await runEnrichCli(['node', 'x', '--snapshot', snapPath, '--queues', queuesPath, '--out', outPath], { now: () => NOW }, target)
  } finally { console.log = origLog }
  t('CLI без --live: код 0', target.exitCode, 0)
  t('CLI без --live: сети 0', fetchCalls, 0)
  const dry = JSON.parse(await readFile(outPath, 'utf8'))
  t('  режим назван сухим', dry.mode, 'dry')
  t('  план: очередь, адреса, сайты', `${dry.plan.queue}/${dry.plan.withOfficialUrl}/${dry.plan.origins}`, '2/1/1')
  t('  потолок по умолчанию — разрешение владельца', dry.plan.objectLimit, DEFAULT_OBJECT_LIMIT)
  t('  запросов не больше двух на объект', dry.plan.plannedRequestsAtMost, dry.plan.plannedObjects * 2)
  t('  эффектов нет', dry.effects.network, 0)
  has('  stdout называет ноль сети', logs.join('\n'), 'сети 0')

  /* Живой режим — только через инъектированную границу; настоящий fetch по-прежнему запрещён. */
  const liveOut = path.join(dir, 'live.json')
  const io = {
    async fetchRobots() { return { outcome: 'fetched', bytes: Buffer.from(ROBOTS_OPEN, 'utf8') } },
    async fetchPage() { return { ok: true, text: ldBlock(PLACE) } },
  }
  const liveTarget = { exitCode: 0 }
  const liveLogs = []
  console.log = (line) => liveLogs.push(String(line))
  try {
    await runEnrichCli(['node', 'x', '--snapshot', snapPath, '--queues', queuesPath, '--out', liveOut, '--live', '--limit', '5'],
      { now: () => NOW, io, pacer: { async beforeRequest() {} } }, liveTarget)
  } finally { console.log = origLog; globalThis.fetch = savedFetch }
  t('CLI --live: код 0', liveTarget.exitCode, 0)
  t('CLI --live: настоящей сети всё равно 0', fetchCalls, 0)
  const live = JSON.parse(await readFile(liveOut, 'utf8'))
  t('  обогащён один, второй без адреса', `${live.counts.enriched}/${live.counts.noOfficialUrl}`, '1/1')
  t('  входы названы отпечатками', `${live.inputs.snapshot.digest === snapshot.snapshotDigest}/${live.inputs.queues.digest === queues.reportDigest}`, 'true/true')
  t('  потолок из аргумента', live.inputs.limits.objects, 5)
  has('  stdout называет очередь', liveLogs.join('\n'), 'ОБОГАЩЕНИЕ JA-3')

  /* Очереди от другого снимка не принимаются. */
  const foreign = path.join(dir, 'foreign.json')
  await writeFile(foreign, `${JSON.stringify(signReport({ ...queues, inputs: { snapshot: { digest: DIGEST(7), records: 2 } } }, 'poi-japan-guide-queues/v1'))}\n`, 'utf8')
  const errors = []
  const origError = console.error
  console.error = (line) => errors.push(String(line))
  const badTarget = { exitCode: 0 }
  try {
    await runEnrichCli(['node', 'x', '--snapshot', snapPath, '--queues', foreign, '--out', path.join(dir, 'x.json')], { now: () => NOW }, badTarget)
  } finally { console.error = origError }
  t('очереди от другого снимка — отказ', badTarget.exitCode, 1)
  has('  и это названо', errors.join('\n'), 'очереди собраны по снимку')
  /* JG2-04: изменённый отчёт очередей не доходит до сети. */
  const forged = path.join(dir, 'forged.json')
  const forgedBody = JSON.parse(JSON.stringify(queues))
  forgedBody.queues.candidate[0].sourceKey = 'japan-guide:e999999'
  await writeFile(forged, `${JSON.stringify(forgedBody)}\n`, 'utf8')
  const forgedErrors = []
  console.error = (line) => forgedErrors.push(String(line))
  const forgedTarget = { exitCode: 0 }
  try {
    await runEnrichCli(['node', 'x', '--snapshot', snapPath, '--queues', forged, '--out', path.join(dir, 'y.json')], { now: () => NOW }, forgedTarget)
  } finally { console.error = origError }
  t('изменённые очереди со старым отпечатком — отказ до сети', forgedTarget.exitCode, 1)
  has('  и это названо', forgedErrors.join('\n'), 'изменён после подписи')

  t('план при нулевом потолке', planFrom([{ hints: ['https://a.jp/x'] }], { limit: 0, perDomain: 3 }).plannedObjects, 0)
  t('план считает негодные подсказки', planFrom([{ hints: ['не адрес'] }], { limit: 5, perDomain: 3 }).unusableHints, 1)
  t('кодировка по умолчанию', charsetOf(null).charset, 'utf-8')
  t('shift_jis читается', charsetOf('text/html; charset=Shift_JIS').ok, true)
  t('незнакомая кодировка — отказ, а не догадка', charsetOf('text/html; charset=koi8-r').ok, false)
  has('без --out — отказ', await boom(() => parseEnrichArgs(['n', 'x', '--snapshot', 'a', '--queues', 'b'])), '--out')
  has('отрицательный потолок — отказ', await boom(() => parseEnrichArgs(['n', 'x', '--snapshot', 'a', '--queues', 'b', '--out', 'c', '--limit', '-1'])), '--limit')
  t('несжатый снимок читается как есть', JSON.parse(snapshotTextFrom(Buffer.from('{"a":1}', 'utf8'))).a, 1)
}

/** Тело-поток: `readBoundedBody` читает только через `getReader`. */
const streamOf = (buffer) => ({
  getReader() {
    let done = false
    return {
      async read() {
        if (done) return { done: true, value: undefined }
        done = true
        return { done: false, value: new Uint8Array(buffer) }
      },
      cancel() {},
      releaseLock() {},
    }
  },
})

/* ── 7. JG2-01: переход по редиректу не делается вовсе ──────────────────── */
{
  const seen = []
  /* Транспорт-фикстура: 302 на запрещённый путь, как в контрпримере аудита. */
  const fetchImpl = async (url) => {
    seen.push(url)
    if (url.endsWith('/robots.txt')) {
      return { ok: true, status: 200, url, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/plain' : null) }, body: streamOf(Buffer.from('User-agent: *\nDisallow: /private\n', 'utf8')) }
    }
    if (url.endsWith('/allowed')) {
      return { ok: false, status: 302, url, headers: { get: (k) => (k.toLowerCase() === 'location' ? 'https://redir.jp/private' : null) }, body: null }
    }
    return { ok: true, status: 200, url, headers: { get: () => 'text/html' }, body: streamOf(Buffer.from('<html>секрет</html>', 'utf8')) }
  }
  const io = liveIo({ fetchImpl, pacer: createEnrichmentPacer({ intervalMs: 0 }) })
  const page = await io.fetchPage('https://redir.jp/allowed')
  t('редирект — не страница', page.ok, false)
  has('  и переход назван отказом', page.detail, 'переход не делается')
  t('  запрещённый путь не запрашивался', seen.some((u) => u.includes('/private')), false)
  t('  сделан ровно один запрос', seen.length, 1)
  const redirectedRobots = await io.fetchRobots('https://redir.jp', 'https://redir.jp/allowed')
  t('перенаправленный robots.txt — молчание, а не «правил нет»', redirectedRobots.outcome, 'unavailable')
}

/* ── 8. JG2-02: HTML вместо robots.txt разрешением не становится ────────── */
{
  const bytes = (text) => Buffer.from(text, 'utf8')
  t('настоящий robots проходит', looksLikeRobots(bytes('User-agent: *\nDisallow: /a\n'), 'text/plain').ok, true)
  t('пустой robots законен', looksLikeRobots(bytes(''), 'text/plain').ok, true)
  t('только комментарии — законно', looksLikeRobots(bytes('# ничего не запрещаем\n'), 'text/plain').ok, true)
  t('тип text/html — не robots', looksLikeRobots(bytes('User-agent: *\n'), 'text/html').ok, false)
  t('разметка в теле — не robots', looksLikeRobots(bytes('<!DOCTYPE html><html>Access denied</html>'), 'text/plain').ok, false)
  t('текст без директив — не robots', looksLikeRobots(bytes('Access denied for your IP'), 'text/plain').ok, false)
  t('не UTF-8 — не robots', looksLikeRobots(Buffer.from([0xff, 0xfe, 0x00]), 'text/plain').ok, false)
  t('тип с параметрами читается', looksLikeRobots(bytes('User-agent: *\n'), 'text/plain; charset=utf-8').ok, true)
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(url)
    return {
      ok: true, status: 200, url,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html' : null) },
      body: streamOf(Buffer.from('<html><body>Access denied</body></html>', 'utf8')),
    }
  }
  const io = liveIo({ fetchImpl, pacer: createEnrichmentPacer({ intervalMs: 0 }) })
  const robots = await io.fetchRobots('https://deny.jp', 'https://deny.jp/robots.txt')
  t('страница-заглушка вместо robots — undecodable', robots.outcome, 'undecodable')
  const budget = openEnrichmentBudget({ objects: 2, robotsFetches: 2, pageFetches: 2 })
  const result = await runEnrichment({
    queue: [{ sourceKey: 'japan-guide:e1', nameEn: 'X', url: 'https://x', hints: ['https://deny.jp/page'] }],
    budget, io, now: () => NOW,
  })
  t('  и обхода не начинается', result.rows[0].outcome, 'policyUnknown')
  t('  страница не запрашивалась', seen.filter((u) => u.endsWith('/page')).length, 0)
  t('  домен в реестре со статусом unknown', [...result.policies.values()][0].status, 'unknown')
  t('свой дефект сетевым отказом не считается', isNetworkFailure(new TypeError('pacer.beforeRequest is not a function')), false)
  t('  а обрыв связи — считается', isNetworkFailure(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })), true)
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ JA-3 граница обогащения: ${ok} проверок пройдено`)
}
