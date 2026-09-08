#!/usr/bin/env node
/**
 * JG‑1 «Очереди без сети»: снимок Japan Guide → пакет границы адаптера (JA‑1) →
 * общая оценка → очереди с причинами (JA‑2).
 *
 *   node tests/poi-japan-guide-queues.mjs
 *
 * Доказывается:
 *   • проекция: английское имя и адрес — в наблюдаемых полях; японское имя,
 *     город, координаты — явные пропуски; размещения, категория, факт-лиды и
 *     отпечаток страницы — только подсказки `unverified`; ожидаемый состав
 *     выводится вызывающим из проверенного снимка; строка без имени — отказ
 *     `missingName`, пакет её не теряет;
 *   • очереди на синтетическом снимке: каждая причина из закрытого списка
 *     получает свою строку; связь по Source Key закрепляется; совпадение
 *     только по имени — `review`, не связь; неоднозначность — `review`;
 *     категория события — `routedElsewhere`; исключаемый вид — `rejected`;
 *     общий matcher без портальных порогов, его ключевая связь совпадает со
 *     сверкой; закон сохранения проверяется, подмена снимка — отказ;
 *   • выгрузка Airtable разбирается ОДИН раз внутри очередей: второго входа
 *     для неё нет, лишний аргумент ни на что не влияет, испорченные байты —
 *     отказ (10h-D-01);
 *   • состав приёма выводится заново из проверенного пакета: подменённый
 *     список кандидатов игнорируется, изменённый после оценки кандидат и
 *     укороченная оценка — отказ (10h-D-02);
 *   • ПРОИЗВОДНЫЕ фикстуры (10h-D-03/04): снимок только с полями JG‑1 и
 *     выгрузка с синтетическими `recordId`; манифест сходится с файлами в
 *     репозитории побайтно, а отпечатки полных исходников в нём совпадают с
 *     наблюдением 06.09;
 *   • сквозной сценарий на ПРОИЗВОДНОМ снимке 06.09.2026 (1 140 объектов,
 *     `docs/poi-intake/baselines/japan-guide-jg1-…snapshot.json.gz`) и
 *     производной выгрузке (474 строки): сумма очередей = 1 140, ни одного
 *     неизвестного исхода, 23 связи по ключу; CLI пишет полные очереди в
 *     файл, сети/эффектов 0.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildDiscoveryRecord, buildDiscoverySnapshot, buildFactLead, buildOrderRecord, buildPageEvidence, orderItem,
} from '../scripts/poi-portals/lib/discovery-contract.mjs'
import { readCanonicalGzip } from '../scripts/poi-portals/lib/discovery-baseline.mjs'
import { airtableExportDigest, AIRTABLE_EXPORT_SPEC, parseVerifiedAirtableExport } from '../scripts/poi-portals/lib/discovery-airtable-match.mjs'
import { buildJapanGuideIntakeBatch, expectedInputFromSnapshot, HINTED_LEAD_KINDS, JAPAN_GUIDE_INTAKE_VERSION, projectDiscoveryRecord } from '../scripts/poi-portals/lib/japan-guide-intake.mjs'
import {
  buildJapanGuideQueues, classifyJapanGuideRecord, JAPAN_GUIDE_CATEGORY_RULES, QUEUE_REASONS, QUEUES, summarizeJapanGuideQueues,
} from '../scripts/poi-portals/lib/japan-guide-queues.mjs'
import { evaluatePortalIntakeBatch } from '../scripts/poi-portals/collect-pois.mjs'
import { readPortalIntakeBatch } from '../scripts/poi-portals/lib/portal-intake-contract.mjs'
import { getPortal } from '../scripts/poi-portals/registry.mjs'
import { parseJgQueuesArgs, runJgQueuesCli, snapshotFromDocument } from '../scripts/poi-portals/japan-guide-queues.mjs'
import {
  assertJg1FixtureManifest, deriveJg1AirtableExport, deriveJg1Snapshot, DROPPED_EXPORT_FIELDS,
  DROPPED_RECORD_FIELDS, JG1_FIXTURE_MANIFEST_SPEC, syntheticRecordId,
} from '../scripts/poi-portals/derive-japan-guide-fixtures.mjs'
import { AIRTABLE_BASE_ID, POI_TABLE_ID } from '../src/lib/airtable-schema.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${String(text).slice(0, 260)}» нет «${needle}»`)
}
const boom = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e instanceof Error ? e.message : String(e) } }
process.on('uncaughtException', (e) => {
  bad.push(`сюита оборвана необработанной ошибкой: ${e instanceof Error ? e.message : String(e)}`)
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exit(1)
})

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORTAL = getPortal('japan-guide')
const HOST = 'https://www.japan-guide.com'
const ENTRY = `${HOST}/e/e623a.html`
const DEST = `${HOST}/e/e2157.html`
const AT = '2026-09-06T00:00:00.000Z'
const NOW = new Date('2026-09-08T16:00:00.000Z')
const hex = (n) => '0123456789abcdef'[n % 16]
const DIGEST = (n) => `sha256:${hex(n).repeat(64)}`
const evidence = (url, pageRole, rawPageDigest) => buildPageEvidence({ url, pageRole, pageBytes: 1024, rawPageDigest, observedAt: AT, httpCharset: 'shift-jis', metaCharset: 'utf-8', decodePolicy: 'mixed-page-utf8-locators-v1', decodeErrorCount: 0, decodeReplacements: 0, nonWhitelistedCodepoints: 0 })
const lead = (kind, value, url) => buildFactLead({ kind, value, source: url, sourceLocator: kind === 'name_en' ? 'h1' : kind === 'official_url_hint' ? 'links_and_resources_official' : 'hours_fees_block', observedAt: AT })

/** Синтетический снимок: строки с категориями и факт-лидами. */
const snapshotOf = (specs) => {
  const rows = [...specs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return buildDiscoverySnapshot({
    scope: { kind: 'full', limit: null },
    entryUrl: ENTRY,
    incompleteReasons: [],
    networkPolicy: { maxNetworkRequests: 6000, maxRedirects: 2 },
    robotsEvidence: { url: `${HOST}/robots.txt`, bytes: 64, digest: DIGEST(12), observedAt: AT, appliedGroups: ['*'] },
    catalogueEvidence: evidence(ENTRY, 'catalogue', DIGEST(10)),
    catalogueTargetEvidence: [{ sourceKey: 'japan-guide:e2157', evidence: evidence(DEST, 'collection', DIGEST(11)) }, { sourceKey: 'japan-guide:e2158', evidence: evidence(`${HOST}/e/e2158.html`, 'collection', DIGEST(13)) }],
    nestedCollectionEvidence: [],
    orderRecords: [
      buildOrderRecord({ destinationSourceKey: 'japan-guide:e2157', sourcePageDigest: DIGEST(11), collectionKind: 'ranked', items: rows.map((row) => orderItem('poi', `japan-guide:${row.id}`)) }),
      buildOrderRecord({ destinationSourceKey: 'japan-guide:e2158', sourcePageDigest: DIGEST(13), collectionKind: 'ranked', items: rows.filter((row) => (row.categories ?? []).length > 1).map((row) => orderItem('poi', `japan-guide:${row.id}`)) }),
    ],
    records: rows.map((row, index) => buildDiscoveryRecord({
      sourceKey: `japan-guide:${row.id}`,
      url: `${HOST}/e/${row.id}.html`,
      nameEn: row.nameEn,
      placements: (row.categories ?? [null]).map((categoryHint, k) => ({ kind: 'destinationRanking', collectionSourceKey: k === 0 ? 'japan-guide:e2157' : 'japan-guide:e2158', listPosition: index + 1, editorialLevel: 0, categoryHint })),
      factLeads: (row.leads ?? []).map(([kind, value]) => lead(kind, value, `${HOST}/e/${row.id}.html`)),
      omissions: [],
      pageEvidence: evidence(`${HOST}/e/${row.id}.html`, 'poi', DIGEST(index)),
    })),
    rejected: { targets: [], cards: [], nodes: [], pois: [] },
    counters: { networkRequests: rows.length + 10, catalogueTargetsFound: 2, catalogueCollectionsFound: 2, nestedCollectionsFound: 0, directPoisFound: 0, poisFound: rows.length, recordsAttempted: rows.length, recordsBuilt: rows.length, nonCanonicalLinks: 0, unknownAdmissionLabels: 0, emptyAdmissionValues: 0 },
  })
}
const R = (n) => `rec${String(n).padStart(14, '0')}`
const P = (n) => `POI-${String(n).padStart(6, '0')}`
const exportOf = (records) => ({
  contractVersion: AIRTABLE_EXPORT_SPEC, note: 'фикстура', baseId: AIRTABLE_BASE_ID, tableId: POI_TABLE_ID, fetchedAt: '2026-09-06',
  fields: ['isSystem', 'nameEn', 'nameRu', 'poiId', 'sourceKey', 'website'], totalRecordCount: records.length, records,
})
const row = (n, over = {}) => ({ recordId: R(n), poiId: P(n), createdTime: AT, nameEn: `Base ${n}`, nameRu: `База ${n}`, ...over })
const pipeline = (snapshot, exportDoc) => {
  const batch = buildJapanGuideIntakeBatch(snapshot, PORTAL)
  const intake = evaluatePortalIntakeBatch(PORTAL, batch, expectedInputFromSnapshot(snapshot))
  const bytes = Buffer.from(JSON.stringify(exportDoc), 'utf8')
  return { batch, intake, bytes, report: buildJapanGuideQueues({ snapshot, portal: PORTAL, intake, exportBytes: bytes, createdAt: NOW.toISOString() }) }
}

/* ── 1. Проекция JA‑1 ───────────────────────────────────────────────── */
{
  const snap = snapshotOf([{ id: 'e1001', nameEn: 'Alpha Museum', categories: ['Museum'], leads: [['official_url_hint', 'https://alpha.example/'], ['hours_hint', '9:00 to 17:00'], ['name_en', 'Alpha Museum']] }])
  const batch = buildJapanGuideIntakeBatch(snap, PORTAL)
  t('версия адаптера', batch.adapterVersion, JAPAN_GUIDE_INTAKE_VERSION)
  const rec = batch.records[0]
  t('наблюдаемые: английское имя', rec.observed.nameEn, 'Alpha Museum')
  t('наблюдаемые: японское имя, город, координаты — явные пропуски', JSON.stringify([rec.observed.nameJa, rec.observed.cityJa, rec.observed.lat, rec.observed.lon, rec.observed.address]), '[null,null,null,null,null]')
  t('подсказки: размещение, категория, official_url, hours, отпечаток страницы; name_en не дублируется', [...rec.hints.map((h) => h.field)].sort().join(','), 'category,hours,official_url,page_digest,placement')
  t('подсказки все unverified', rec.hints.every((h) => h.confidence === 'unverified' && h.verifiedAt === null), true)
  t('роды лидов, переносимые подсказками, закрыты', Object.keys(HINTED_LEAD_KINDS).join(','), 'official_url_hint,hours_hint,closed_hint,admission_hint')
  const expected = expectedInputFromSnapshot(snap)
  t('ожидаемый состав — из снимка, с его отпечатком', expected.digest, snap.snapshotDigest)
  t('пакет читается общей границей с ожидаемым составом', readPortalIntakeBatch(batch, { portalId: 'japan-guide', input: expected }).batchDigest, batch.batchDigest)
  t('чужой ожидаемый состав — отказ границы', await (async () => { try { readPortalIntakeBatch(batch, { portalId: 'japan-guide', input: { ...expected, digest: DIGEST(3) } }); return '(без отказа)' } catch (e) { return e.reason } })(), 'portalIntakeInputMismatch')
  const refused = projectDiscoveryRecord({ sourceKey: 'japan-guide:e1', url: `${HOST}/e/e1.html`, nameEn: '  ', placements: [], factLeads: [], pageEvidence: {} })
  t('запись без имени — именованный отказ, не потеря', `${refused.kind}/${refused.reason}`, 'refused/missingName')
  has('проекция только для japan-guide', await boom(() => buildJapanGuideIntakeBatch(snap, getPortal('bodik-osaka-tourism'))), 'только для портала japan-guide')
  has('снимок проверяется контрактом до проекции', await boom(() => buildJapanGuideIntakeBatch({ ...snap, snapshotDigest: DIGEST(1) }, PORTAL)), 'snapshotDigest')
}

/* ── 2. Классификация через реестр ──────────────────────────────────── */
{
  const rec = (categories) => ({ sourceKey: 'japan-guide:x', placements: categories.map((categoryHint) => ({ categoryHint })) })
  t('Museum → tourist_poi/museum, маршрут в POI', (() => { const c = classifyJapanGuideRecord(rec(['Museum'])); return `${c.classification.entityKind}/${c.classification.poiPrimaryType}/${c.classification.intakeDisposition}/${c.classification.catalogTarget}` })(), 'tourist_poi/museum/route/poi')
  t('Festival → event, другой каталог', (() => { const c = classifyJapanGuideRecord(rec(['Festival'])); return `${c.classification.entityKind}/${c.classification.intakeDisposition}/${c.classification.catalogTarget}` })(), 'event/route/event')
  t('Onsen → tourist_poi без типа, реестр ведёт к человеку', (() => { const c = classifyJapanGuideRecord(rec(['Onsen'])); return `${c.reason}/${c.classification.intakeDisposition}` })(), 'categoryAmbiguous/needs_review')
  t('нет категории — categoryUnresolved', classifyJapanGuideRecord(rec([])).reason, 'categoryUnresolved')
  t('неизвестная категория — categoryUnresolved', classifyJapanGuideRecord(rec(['Space Elevator'])).reason, 'categoryUnresolved')
  t('размещения расходятся — categoryConflict', classifyJapanGuideRecord(rec(['Museum', 'Temple'])).reason, 'categoryConflict')
  t('одинаковые категории в двух размещениях — не конфликт', classifyJapanGuideRecord(rec(['Museum', 'Museum'])).reason, null)
  t('каждая строка таблицы — коды реестра (classifyByRule не бросает)', Object.entries(JAPAN_GUIDE_CATEGORY_RULES).every(([c]) => classifyJapanGuideRecord(rec([c])).classification !== null), true)
  t('классификация подписана источником rule', classifyJapanGuideRecord(rec(['Museum'])).classification.classificationSource, 'rule')
}

/* ── 3. Очереди на синтетическом снимке: каждая причина ─────────────── */
{
  const specs = [
    { id: 'e2001', nameEn: 'Linked Temple', categories: ['Temple'] },              // existing по ключу
    { id: 'e2002', nameEn: 'Yasukuni Shrine', categories: ['Shrine'] },            // имя совпало без ключа → review
    { id: 'e2003', nameEn: 'Rinnoji Temple', categories: ['Temple'] },             // одно имя — две записи → ambiguousName
    { id: 'e2004', nameEn: 'Gion Festival', categories: ['Festival'] },            // event → routedElsewhere
    { id: 'e2005', nameEn: 'Fresh Castle', categories: ['Castle'] },               // candidate
    { id: 'e2006', nameEn: 'Hot Spring Town', categories: ['Onsen'] },             // categoryAmbiguous → review
    { id: 'e2007', nameEn: 'Nameless Place', categories: [null] },                 // categoryUnresolved → review
    { id: 'e2008', nameEn: 'Mixed Place', categories: ['Museum', 'Temple'] },      // categoryConflict → review
    { id: 'e2009', nameEn: 'Old Market Street', categories: ['Food and Drink'] },  // food_service → routedElsewhere
  ]
  const exportDoc = exportOf([
    row(1, { nameEn: 'Linked Temple (base)', sourceKey: 'japan-guide:e2001' }),
    row(2, { nameEn: 'Yasukuni Shrine' }),
    row(3, { nameEn: 'Rinnoji Temple' }),
    row(4, { nameEn: 'Rinnoji Temple', nameRu: 'Риннодзи (Никко)' }),
    row(5, { nameEn: 'Something Else', isSystem: true }),
  ])
  const { report, intake } = pipeline(snapshotOf(specs), exportDoc)
  const q = Object.fromEntries(report.queues.existing.concat(report.queues.candidate, report.queues.routedElsewhere, report.queues.review, report.queues.rejected).map((r) => [r.sourceKey, r]))
  t('закон сохранения: сумма очередей = строк', report.counts.total, specs.length)
  t('очередей ровно пять', QUEUES.join(','), 'existing,candidate,routedElsewhere,review,rejected')
  t('связь по ключу — existing', `${q['japan-guide:e2001'].queue}/${q['japan-guide:e2001'].reason}/${q['japan-guide:e2001'].linked.poiId}`, `existing/sourceKeyLinked/${P(1)}`)
  t('  и общий matcher подтвердил ключ', q['japan-guide:e2001'].matcher.top.reasons.join(','), 'source_key')
  t('имя совпало без ключа — review, не связь', `${q['japan-guide:e2002'].queue}/${q['japan-guide:e2002'].reason}`, 'review/nameMatchWithoutIndependentSignal')
  t('  совпавшие записи названы', q['japan-guide:e2002'].nameMatches.join(','), P(2))
  t('  и связи нет', q['japan-guide:e2002'].linked, undefined)
  t('одно имя — несколько записей — review/ambiguousName', `${q['japan-guide:e2003'].queue}/${q['japan-guide:e2003'].reason}`, 'review/ambiguousName')
  t('событие — routedElsewhere/catalogElsewhere', `${q['japan-guide:e2004'].queue}/${q['japan-guide:e2004'].reason}/${q['japan-guide:e2004'].classification.catalogTarget}`, 'routedElsewhere/catalogElsewhere/event')
  t('еда — routedElsewhere в restaurant', q['japan-guide:e2009'].classification.catalogTarget, 'restaurant')
  t('чистый замок — candidate/awaitingEnrichment', `${q['japan-guide:e2005'].queue}/${q['japan-guide:e2005'].reason}`, 'candidate/awaitingEnrichment')
  t('  с явными пропусками', q['japan-guide:e2005'].omissions.join(','), 'nameJa,city,coordinates')
  t('  и общая оценка сохранена (ожидаемо qualityRejected без японского имени)', q['japan-guide:e2005'].generalVerdict.terminal, 'qualityRejected')
  t('неоднозначная категория — review/categoryAmbiguous', `${q['japan-guide:e2006'].queue}/${q['japan-guide:e2006'].reason}`, 'review/categoryAmbiguous')
  t('без категории — review/categoryUnresolved', `${q['japan-guide:e2007'].queue}/${q['japan-guide:e2007'].reason}`, 'review/categoryUnresolved')
  t('конфликт размещений — review/categoryConflict', `${q['japan-guide:e2008'].queue}/${q['japan-guide:e2008'].reason}`, 'review/categoryConflict')
  t('счётчики', JSON.stringify(report.counts), JSON.stringify({ total: 9, existing: 1, candidate: 1, routedElsewhere: 2, review: 5, rejected: 0 }))
  t('все причины из закрытого списка', Object.values(q).every((r) => QUEUE_REASONS.includes(r.reason)), true)
  t('эффектов 0', JSON.stringify(report.effects), JSON.stringify({ network: 0, google: 0, model: 0, post: 0, patch: 0, delete: 0 }))
  t('политика matcher’а названа', report.inputs.matcherPolicy.version, 'poi-matcher-policy/v4')
  t('сверка discovery ↔ Airtable — в отчёте', `${report.reconciliation.linkedByKey}/${report.reconciliation.nameCandidates}/${report.reconciliation.ambiguous}`, '1/1/1')
  has('сводка называет нули', summarizeJapanGuideQueues(report), 'эффектов 0')
  t('отпечаток отчёта не зависит от момента', report.reportDigest, buildJapanGuideQueues({ snapshot: snapshotOf(specs), portal: PORTAL, intake, exportBytes: Buffer.from(JSON.stringify(exportDoc)), createdAt: '2027-01-01T00:00:00.000Z' }).reportDigest)
  /* Подмена снимка между пакетом и очередями — отказ. */
  const other = snapshotOf(specs.slice(0, 8))
  has('пакет от другого снимка — отказ', await boom(() => buildJapanGuideQueues({ snapshot: other, portal: PORTAL, intake, exportBytes: Buffer.from(JSON.stringify(exportDoc)), createdAt: NOW.toISOString() })), 'по другому снимку')
  has('очереди только для japan-guide', await boom(() => buildJapanGuideQueues({ snapshot: snapshotOf(specs), portal: getPortal('bodik-osaka-tourism'), intake, exportBytes: Buffer.from(JSON.stringify(exportDoc)), createdAt: NOW.toISOString() })), 'только для портала japan-guide')
  /* Исключаемый вид — rejected (через таблицу с временной подменой невозможно: она заморожена; проверяется реестром напрямую). */
  const excluded = classifyJapanGuideRecord({ sourceKey: 'japan-guide:x', placements: [{ categoryHint: 'Museum' }] })
  t('таблица категорий заморожена', Object.isFrozen(JAPAN_GUIDE_CATEGORY_RULES), true)
  t('  и не содержит исключаемых видов — rejected по таксономии сегодня недостижим, очередь остаётся в закрытом списке', Object.values(JAPAN_GUIDE_CATEGORY_RULES).some((r) => ['transport_infrastructure', 'retail_shop', 'service_business'].includes(r.entityKind)), false)
  t('  (контроль реестра: Museum не исключается)', excluded.classification.intakeDisposition, 'route')
}

/* ── 3a. 10h-D-01: у выгрузки один вход — байты ──────────────────────── */
{
  const specs = [
    { id: 'e3001', nameEn: 'Linked Temple', categories: ['Temple'] },
    { id: 'e3002', nameEn: 'Fresh Castle', categories: ['Castle'] },
  ]
  const snapshot = snapshotOf(specs)
  const linked = exportOf([row(1, { nameEn: 'Linked Temple (base)', sourceKey: 'japan-guide:e3001' })])
  const { intake, report } = pipeline(snapshot, linked)
  t('решение принято по байтам: связь по ключу закреплена', report.queues.existing.map((r) => r.sourceKey).join(','), 'japan-guide:e3001')
  /*
   * Прежняя редакция принимала ВТОРОЙ вход выгрузки (`airtable`) и принимала
   * решения по нему, публикуя отпечаток первого. Теперь второго входа нет:
   * лишнее свойство просто не читается, и подсунуть им другую базу нечем.
   */
  const foreign = exportOf([row(9, { nameEn: 'Nothing Alike', sourceKey: 'japan-guide:e9999' })])
  const withForeign = buildJapanGuideQueues({
    snapshot, portal: PORTAL, intake, exportBytes: Buffer.from(JSON.stringify(linked), 'utf8'),
    airtable: foreign, createdAt: NOW.toISOString(),
  })
  t('лишний аргумент выгрузки не меняет ни одного исхода', withForeign.reportDigest, report.reportDigest)
  t('  и отпечаток остаётся отпечатком тех же байтов', withForeign.inputs.airtable.exportDigest, report.inputs.airtable.exportDigest)
  /* Байты, которые не разбираются либо не проходят контракт выгрузки. */
  has('испорченные байты выгрузки — отказ', await boom(() => buildJapanGuideQueues({ snapshot, portal: PORTAL, intake, exportBytes: Buffer.from('{не json', 'utf8'), createdAt: NOW.toISOString() })), 'не разбираются как JSON')
  const short = { ...linked, totalRecordCount: 99 }
  has('выгрузка вне контракта — отказ до сопоставления', await boom(() => buildJapanGuideQueues({ snapshot, portal: PORTAL, intake, exportBytes: Buffer.from(JSON.stringify(short), 'utf8'), createdAt: NOW.toISOString() })), 'totalRecordCount')
  has('не байты — отказ', await boom(() => buildJapanGuideQueues({ snapshot, portal: PORTAL, intake, exportBytes: linked, createdAt: NOW.toISOString() })), 'ожидаются БАЙТЫ')
  /*
   * Сам разбор — отдельная публичная граница, и проверяется он отдельно: у
   * очередей за ним идёт сверка, которая тоже проверяет выгрузку, и без
   * прямой проверки этот сторож был бы прикрыт чужим.
   */
  const goodBytes = Buffer.from(JSON.stringify(linked), 'utf8')
  t('разбор возвращает документ и отпечаток ТЕХ ЖЕ байтов', parseVerifiedAirtableExport(goodBytes).exportDigest, airtableExportDigest(goodBytes))
  t('  и разобранный документ — это выгрузка', parseVerifiedAirtableExport(goodBytes).airtable.totalRecordCount, linked.totalRecordCount)
  has('разбор отказывает выгрузке вне контракта сам, без сверки', await boom(() => parseVerifiedAirtableExport(Buffer.from(JSON.stringify(short), 'utf8'))), 'totalRecordCount')
  has('разбор отказывает выгрузке из чужой таблицы', await boom(() => parseVerifiedAirtableExport(Buffer.from(JSON.stringify({ ...linked, baseId: 'appZZZZZZZZZZZZZZ' }), 'utf8'))), 'baseId')
  has('разбор отказывает не байтам', await boom(() => parseVerifiedAirtableExport(linked)), 'ожидаются БАЙТЫ')
}

/* ── 3b. 10h-D-02: состав приёма выводится заново из пакета ──────────── */
{
  const specs = [
    { id: 'e4001', nameEn: 'Yasukuni Shrine', categories: ['Shrine'] },
    { id: 'e4002', nameEn: 'Fresh Castle', categories: ['Castle'] },
  ]
  const snapshot = snapshotOf(specs)
  const exportDoc = exportOf([row(2, { nameEn: 'Yasukuni Shrine' })])
  const bytes = Buffer.from(JSON.stringify(exportDoc), 'utf8')
  const batch = buildJapanGuideIntakeBatch(snapshot, PORTAL)
  const baseline = buildJapanGuideQueues({ snapshot, portal: PORTAL, intake: evaluatePortalIntakeBatch(PORTAL, batch, expectedInputFromSnapshot(snapshot)), exportBytes: bytes, createdAt: NOW.toISOString() })
  t('состав приёма опубликован отпечатком', /^sha256:[0-9a-f]{64}$/.test(baseline.inputs.intake.intakeDigest), true)
  t('  и назван числом кандидатов и отказов', `${baseline.inputs.intake.candidates}/${baseline.inputs.intake.refused}`, '2/0')

  /* Подменённый СПИСОК кандидатов не читается вовсе: он выводится заново. */
  const swapped = evaluatePortalIntakeBatch(PORTAL, batch, expectedInputFromSnapshot(snapshot))
  swapped.candidates = []
  swapped.refusedQueue = [{ sourceKey: 'japan-guide:e4002', sourceUrl: `${HOST}/e/e4002.html`, kind: 'refused', reason: 'missingName', detail: 'подделка' }]
  const afterSwap = buildJapanGuideQueues({ snapshot, portal: PORTAL, intake: swapped, exportBytes: bytes, createdAt: NOW.toISOString() })
  t('подменённые списки кандидатов и отказов игнорируются', afterSwap.reportDigest, baseline.reportDigest)
  t('  строка не уводится в rejected подделанным отказом', afterSwap.counts.rejected, 0)

  /* Изменённый ПОСЛЕ оценки кандидат — отказ: оценка не этого пакета. */
  const mutated = evaluatePortalIntakeBatch(PORTAL, batch, expectedInputFromSnapshot(snapshot))
  mutated.evaluated[0].candidate.nameEn = 'Подделанное имя'
  has('изменённый после оценки кандидат — отказ', await boom(() => buildJapanGuideQueues({ snapshot, portal: PORTAL, intake: mutated, exportBytes: bytes, createdAt: NOW.toISOString() })), 'не совпадает с выведенным из проверенного пакета')

  /* Изменённый ключ — тот же отказ: строку нельзя увести на чужой объект. */
  const rekeyed = evaluatePortalIntakeBatch(PORTAL, batch, expectedInputFromSnapshot(snapshot))
  rekeyed.evaluated[1].candidate.sourceKey = 'japan-guide:e4001'
  has('изменённый после оценки ключ — отказ', await boom(() => buildJapanGuideQueues({ snapshot, portal: PORTAL, intake: rekeyed, exportBytes: bytes, createdAt: NOW.toISOString() })), 'не совпадает с выведенным из проверенного пакета')

  /* Укороченная оценка — отказ: покрыта не каждая строка. */
  const short = evaluatePortalIntakeBatch(PORTAL, batch, expectedInputFromSnapshot(snapshot))
  short.evaluated = short.evaluated.slice(0, 1)
  has('укороченная оценка — отказ', await boom(() => buildJapanGuideQueues({ snapshot, portal: PORTAL, intake: short, exportBytes: bytes, createdAt: NOW.toISOString() })), 'при 2 кандидатах пакета')
  const notArray = evaluatePortalIntakeBatch(PORTAL, batch, expectedInputFromSnapshot(snapshot))
  notArray.evaluated = null
  has('оценка не массивом — отказ', await boom(() => buildJapanGuideQueues({ snapshot, portal: PORTAL, intake: notArray, exportBytes: bytes, createdAt: NOW.toISOString() })), 'не массив')

  /* Испорченный пакет не проходит собственную границу — до всякой раскладки. */
  const forged = evaluatePortalIntakeBatch(PORTAL, batch, expectedInputFromSnapshot(snapshot))
  forged.batch = { ...batch, records: batch.records.map((r, i) => (i === 0 ? { ...r, observed: { ...r.observed, nameEn: 'Чужое имя' } } : r)) }
  has('пакет с изменённым содержимым — отказ границы', await boom(() => buildJapanGuideQueues({ snapshot, portal: PORTAL, intake: forged, exportBytes: bytes, createdAt: NOW.toISOString() })), 'batchDigest')
}

/* ── 3в. 10h-D-03/04: производные фикстуры и манифест ───────────────── */
{
  t('синтетический идентификатор — формы Airtable', /^rec[A-Za-z0-9]{14}$/.test(syntheticRecordId('POI-000123')), true)
  t('  детерминирован', syntheticRecordId('POI-000123'), syntheticRecordId('POI-000123'))
  t('  и различает строки', syntheticRecordId('POI-000123') === syntheticRecordId('POI-000124'), false)
  const live = exportOf([row(1, { nameEn: 'Alpha', sourceKey: 'japan-guide:e1' }), row(2, { nameEn: 'Beta', isSystem: true })])
  const fixture = deriveJg1AirtableExport(live, { note: 'фикстура' })
  t('фикстура не теряет строк', fixture.totalRecordCount, live.totalRecordCount)
  t('  порядок строк исходный', fixture.records.map((r) => r.poiId).join(','), live.records.map((r) => r.poiId).join(','))
  t('  живых recordId не осталось', fixture.records.some((r) => live.records.some((l) => l.recordId === r.recordId)), false)
  t('  createdTime не переносится', fixture.records.every((r) => r.createdTime === undefined), true)
  t('  поля matcher’а сохранены', `${fixture.records[0].sourceKey}/${fixture.records[0].nameEn}/${fixture.records[1].isSystem}`, 'japan-guide:e1/Alpha/true')
  t('  список отброшенных полей объявлен', DROPPED_EXPORT_FIELDS.join(','), 'createdTime')

  const full = snapshotOf([{ id: 'e5001', nameEn: 'Alpha Museum', categories: ['Museum'], leads: [['hours_hint', '9:00 to 17:00'], ['admission_hint', 'Free']] }])
  const derived = deriveJg1Snapshot(full)
  t('производный снимок не теряет записей', derived.records.length, full.records.length)
  t('  ключ, адрес, имя и размещения сохранены', JSON.stringify([derived.records[0].sourceKey, derived.records[0].url, derived.records[0].nameEn, derived.records[0].placements]), JSON.stringify([full.records[0].sourceKey, full.records[0].url, full.records[0].nameEn, full.records[0].placements]))
  t('  факт-лидов и пропусков в нём нет', `${derived.records[0].factLeads.length}/${derived.records[0].omissions.length}`, '0/0')
  t('  список отброшенных полей объявлен', DROPPED_RECORD_FIELDS.join(','), 'factLeads,omissions')
  t('  отпечаток снимка пересчитан, а не переписан', derived.snapshotDigest === full.snapshotDigest, false)
  t('  и производный снимок проходит полный контракт (иначе buildDiscoverySnapshot бы бросил)', derived.contractVersion, 'poi-discovery-snapshot/v3')

  const manifest = JSON.parse(readFileSync(path.join(REPO, 'docs/poi-intake/baselines/japan-guide-jg1-fixtures-2026-09-06.manifest.json'), 'utf8'))
  t('манифест проходит свой контракт', assertJg1FixtureManifest(manifest).contractVersion, JG1_FIXTURE_MANIFEST_SPEC)
  const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  const snapGz = readFileSync(path.join(REPO, manifest.discovery.derived.path))
  const fixtureBytes = readFileSync(path.join(REPO, manifest.airtable.derived.path))
  t('манифест сходится со сжатым снимком побайтно', sha(snapGz), manifest.discovery.derived.compressedDigest)
  t('  и с распакованным', sha(readCanonicalGzip(snapGz)), manifest.discovery.derived.decompressedDigest)
  t('манифест сходится с выгрузкой-фикстурой побайтно', sha(fixtureBytes), manifest.airtable.derived.digest)
  t('  и её размер объявлен верно', fixtureBytes.length, manifest.airtable.derived.bytes)
  /* Полные исходники в репозитории НЕ лежат — они доказуемы отпечатком. */
  t('полный снимок обхода 06.09 в репозитории отсутствует', existsSync(path.join(REPO, 'docs/poi-intake/baselines/japan-guide-discovery-2026-09-06.artifact.json.gz')), false)
  t('живая выгрузка Airtable 06.09 в репозитории отсутствует', existsSync(path.join(REPO, 'docs/poi-intake/baselines/airtable-poi-export-2026-09-06.json.gz')), false)
  t('манифест удостоверяет полный снимок наблюдения 06.09', manifest.discovery.source.snapshotDigest, 'sha256:57404ec041c8deef7ccddd1ac6f0c990dac03569468449d1d7a04f0b533687ad')
  t('манифест удостоверяет живую выгрузку наблюдения 06.09', manifest.airtable.source.documentDigest, 'sha256:0468dd0451cfe985049ee50fec0f162085a460a6b490452ba69ce91720e1eeed')
  t('  и число строк в обоих', `${manifest.discovery.source.records}/${manifest.airtable.source.records}`, '1140/474')
  has('манифест без даты — отказ', await boom(() => assertJg1FixtureManifest({ ...manifest, derivedAt: '06.09.2026' })), 'derivedAt')
  has('манифест с потерянными строками — отказ', await boom(() => assertJg1FixtureManifest({ ...manifest, discovery: { ...manifest.discovery, derived: { ...manifest.discovery.derived, records: 3 } } })), 'минимизация не теряет строк')
  has('манифест с лишним ключом — отказ', await boom(() => assertJg1FixtureManifest({ ...manifest, extra: 1 })), 'ключи')
}

/* ── 4. Сквозной сценарий на сохранённом снимке 06.09.2026 (1 140) ─────── */
{
  const snapshotGz = readFileSync(path.join(REPO, 'docs/poi-intake/baselines/japan-guide-jg1-2026-09-06.snapshot.json.gz'))
  const artifactBytes = readCanonicalGzip(snapshotGz)
  const exportBytes = readFileSync(path.join(REPO, 'docs/poi-intake/baselines/airtable-poi-jg1-fixture-2026-09-06.json'))
  const snapshot = snapshotFromDocument(JSON.parse(artifactBytes.toString('utf8')))
  t('производный снимок 06.09: 1 140 записей', snapshot.records.length, 1140)
  t('производный снимок 06.09: отпечаток из манифеста', snapshot.snapshotDigest, 'sha256:622ae422c1a25cc6f7bf421ad22079a5a0c9b1f75732bf96d445952b4ac3bfc6')
  t('  факт-лидов в нём нет — извлечённого текста чужого сайта репозиторий не несёт', snapshot.records.every((r) => r.factLeads.length === 0), true)
  const started = Date.now()
  const batch = buildJapanGuideIntakeBatch(snapshot, PORTAL)
  const intake = evaluatePortalIntakeBatch(PORTAL, batch, expectedInputFromSnapshot(snapshot))
  t('JA‑1: 1 140 кандидатов, 0 отказов', `${intake.counts.candidates}/${intake.counts.refused}`, '1140/0')
  const report = buildJapanGuideQueues({ snapshot, portal: PORTAL, intake, exportBytes, createdAt: NOW.toISOString() })
  t('JA‑2: сумма очередей = 1 140', report.counts.total, 1140)
  t('  сумма по очередям', QUEUES.reduce((n, q) => n + report.counts[q], 0), 1140)
  t('  выгрузка Airtable — та же фикстура, что объявлена манифестом', report.inputs.airtable.exportDigest, 'sha256:54c2e82c68f4794a06db4e8020aa445c420490c12bed649e50c7b42ecdf5eb1d')
  t('  23 связи по Source Key закреплены', report.counts.existing, 23)
  t('  сверка: 23 / 196 / 2 / 0 / 919', `${report.reconciliation.linkedByKey}/${report.reconciliation.nameCandidates}/${report.reconciliation.ambiguous}/${report.reconciliation.conflicts}/${report.reconciliation.unmatched}`, '23/196/2/0/919')
  t('  ни одного исхода вне закрытого списка', QUEUES.every((q) => report.queues[q].every((r) => QUEUE_REASONS.includes(r.reason))), true)
  t('  каждая строка ровно один раз', new Set(QUEUES.flatMap((q) => report.queues[q].map((r) => r.sourceKey))).size, 1140)
  t('  имя без ключа — ни одной связи', report.queues.review.filter((r) => r.reason === 'nameMatchWithoutIndependentSignal').every((r) => !r.linked), true)
  t('  все 196 совпадений по имени — в review или existing/routed, не в candidate', report.queues.candidate.every((r) => !r.nameMatches?.length && r.matcher.verdict === 'new'), true)
  t('  2 неоднозначности — в review', report.queues.review.filter((r) => r.reason === 'ambiguousName').length, 2)
  t('  общая оценка: 1 140 qualityRejected (без японского имени и координат — ожидаемо)', report.generalVerdicts.qualityRejected, 1140)
  t('  candidate несут явные пропуски', report.queues.candidate.every((r) => r.omissions.join(',') === 'nameJa,city,coordinates'), true)
  t('  rejected пуст на этом снимке (у всех строк есть имя, исключаемых видов нет)', report.counts.rejected, 0)
  console.error(`  (сквозной сценарий 1 140: ${Date.now() - started} мс; очереди: ${JSON.stringify(report.counts)})`)
  /* CLI: те же входы из файлов, полные очереди — в файл, сеть 0. */
  const dir = await mkdtemp(path.join(tmpdir(), 'jj-jg-queues-'))
  const snapPath = path.join(dir, 'snapshot.json.gz')
  const exportPath = path.join(dir, 'export.json')
  const outPath = path.join(dir, 'queues.json')
  await writeFile(snapPath, snapshotGz)
  await writeFile(exportPath, exportBytes)
  const logs = []
  const origLog = console.log
  console.log = (line) => logs.push(String(line))
  const savedFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error('сеть запрещена') }
  const target = { exitCode: 0 }
  try {
    await runJgQueuesCli(['node', 'x', '--snapshot', snapPath, '--airtable', exportPath, '--out', outPath], { now: () => NOW }, target)
  } finally { console.log = origLog; globalThis.fetch = savedFetch }
  t('CLI: код 0', target.exitCode, 0)
  t('CLI: сети 0', fetchCalls, 0)
  const written = JSON.parse(await readFile(outPath, 'utf8'))
  t('CLI: полные очереди в файле — 1 140 строк', QUEUES.reduce((n, q) => n + written.queues[q].length, 0), 1140)
  t('CLI: тот же отпечаток отчёта, что у библиотеки', written.reportDigest, report.reportDigest)
  has('CLI: stdout — сводка', logs.join('\n'), 'строк 1140')
  t('CLI: голый снимок тоже принимается', snapshotFromDocument(snapshot).snapshotDigest, snapshot.snapshotDigest)
  t('CLI: сжатый и несжатый снимок дают один снимок', snapshotFromDocument(JSON.parse(artifactBytes.toString('utf8'))).snapshotDigest, snapshot.snapshotDigest)
  has('CLI: без --out — отказ', await boom(() => parseJgQueuesArgs(['n', 'x', '--snapshot', 'a', '--airtable', 'b'])), '--out')
  /* Структурно: ни сети, ни хранилища, ни резолвера, ни границ записи. */
  const src = [
    await readFile(new URL('../scripts/poi-portals/lib/japan-guide-intake.mjs', import.meta.url), 'utf8'),
    await readFile(new URL('../scripts/poi-portals/lib/japan-guide-queues.mjs', import.meta.url), 'utf8'),
    await readFile(new URL('../scripts/poi-portals/japan-guide-queues.mjs', import.meta.url), 'utf8'),
    await readFile(new URL('../scripts/poi-portals/derive-japan-guide-fixtures.mjs', import.meta.url), 'utf8'),
  ].join('\n')
  t('JG‑1 не импортирует хранилище, резолвер, границы записи, обновления и place-resolve', /airtable-store|verified-write|verified-update|write-journal|update-journal|write-approval|update-approval|place-resolve|network-boundary/.test(src), false)
  t('JG‑1 не вызывает fetch', /\bfetch\s*\(/.test(src.replace(/\/\*[^]*?\*\//g, '').replace(/\/\/.*$/gm, '')), false)
  t('JG‑1 не содержит POST/PATCH/DELETE', /method: '(POST|PATCH|DELETE)'/.test(src), false)
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ JG‑1 очереди Japan Guide без сети: ${ok} проверок пройдено`)
}
