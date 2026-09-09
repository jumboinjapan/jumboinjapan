#!/usr/bin/env node
/**
 * JA-6 сквозной сухой прогон и JA-7 пробная партия.
 *
 *   node tests/poi-japan-guide-dry-run.mjs
 *
 * Доказывается:
 *   • входы сведены по отпечаткам и связям: подменённый отчёт, чужие строки и
 *     отчёт, собранный по другим очередям, до прогона не доходят;
 *   • ни одно поле кандидата не появляется без названного источника;
 *     координаты берутся парой и из одного источника, опознание старше сайта;
 *   • каждая строка очереди получает ровно один исход из закрытого списка,
 *     сумма равна длине очереди;
 *   • повтор на тех же байтах даёт тот же отпечаток отчёта; эффектов ноль;
 *   • партия JA-7 не превышает пяти, набирается из РАЗНЫХ классов сложности,
 *     а её черновик разрешением не является: срока в нём нет;
 *   • ВСЁ проверяется НАСТОЯЩЕЙ оценкой коллектора: подмены нет нигде.
 *     Кандидат Japan Guide проходит её планом `draftLater` — описание пишется
 *     отдельно (решение владельца § V), порог сдвинут ровно на вес описания,
 *     а вето по имени, координатам и региону остаются;
 *   • фиктивного описания в фикстурах нет: `descriptionJa` пуст везде, и это
 *     проверяется отдельно.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJsonBytes } from '../scripts/lib/canonical-contract.mjs'
import { sha256Bytes } from '../scripts/lib/byte-digest.mjs'
import {
  buildDryRunReport, candidateFromObservations, DRY_RUN_OUTCOMES, DRY_RUN_SPEC,
  runDryRun, summarizeDryRun,
} from '../scripts/poi-portals/lib/japan-guide-dry-run.mjs'
import {
  BATCH_LIMITS, buildBatchReport, difficultyClassOf, selectBatch, summarizeBatch,
} from '../scripts/poi-portals/lib/japan-guide-batch.mjs'
import { evaluatePortalCandidates } from '../scripts/poi-portals/collect-pois.mjs'
import { getPortal } from '../scripts/poi-portals/registry.mjs'
import { assertDryRunReport } from '../scripts/poi-portals/lib/japan-guide-dry-run.mjs'
import { driftAgainst, JG_DRY_RUN_CODE_GRAPH_ENTRY } from '../scripts/poi-portals/dry-run-japan-guide.mjs'
import {
  assertCodeSnapshotStable, CODE_GRAPH_ENTRY, readCodeSnapshot,
} from '../scripts/poi-portals/collect-pois.mjs'
import { readCodeGraph } from '../scripts/poi-portals/lib/code-graph.mjs'
import {
  buildRunManifest, candidateSetIdentity, codeGraphIdentity, compareRunManifests, registryValueIdentity,
} from '../scripts/poi-portals/lib/run-manifest.mjs'
import { RAW_FILE_BYTES_SPEC } from '../scripts/lib/byte-digest.mjs'
import { assertWriteApprovalApplies, parseWriteApproval, WRITE_APPROVAL_SPEC } from '../scripts/poi-portals/lib/write-approval.mjs'
import { COPY_PLANS, evaluatePoiCandidate, IMPORT_MIN_SCORE, DESCRIPTION_MAX_WEIGHT } from '../scripts/poi-portals/lib/scoring.mjs'
import { prepareIntakeRequest, RECORD_REFUSALS } from '../scripts/poi-portals/lib/japan-guide-record.mjs'
import { legacyAirtableCategory } from '../scripts/poi-portals/lib/legacy-airtable-category-bridge.mjs'
import { taxonomyVersion } from '../src/lib/poi-taxonomy.ts'
import {
  enrichedRow, enrichmentOf, exportBytesOf, fact, fileDigestOf, GOOD_NAMED, identificationOf,
  identifiedRow, NAMES, NAMES_RU, NOW, ownerNames, queueRow, queuesOf, TODAY,
} from './fixtures/japan-guide-pipeline.mjs'

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
const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e instanceof Error ? e.message : String(e) } }

const PORTAL = getPortal('japan-guide')

/**
 * ПРОВЕРЕННЫЕ ИМЕНА ВЛАДЕЛЬЦА — настоящим загрузчиком и настоящим файлом.
 * Без них ни одна строка не станет записью: русское имя и направление —
 * обязательные данные приёма, и машинной транслитерации на этом пути нет.
 * Близнецы e5/e6 названы ОДНИМ именем намеренно: это две страницы об одном
 * объекте, и дедуп обязан их свести.
 */
const KEYS = [
  'e1', 'e2', 'e3', 'e4', 'e5', 'e6',
  'e11', 'e12', 'e13', 'e14', 'e15', 'e16', 'e17',
  'e21', 'e31', 'e41',
  'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8',
]
const NAMED = await ownerNames(Object.fromEntries(KEYS.map((key, i) => [
  `japan-guide:${key}`,
  { nameRu: key === 'e6' ? `${NAMES_RU[4]} (e5)` : `${NAMES_RU[i % NAMES_RU.length]} (${key})`, siteCity: 'kyoto' },
])))

/** Опознание JA-4 для перечисленных ключей: своя точка у каждого. */
const identFor = (keys, extra = {}) => identificationOf(
  keys.map((key, i) => identifiedRow(`japan-guide:${key}`, {
    placeId: `ChIJ-${key}`, lat: 34.99 + i / 1000, lon: 135.78 + i / 1000,
  })),
  extra,
)

/** Прогон с проверенными именами и календарным днём — как его зовёт CLI. */
const dry = (over) => runDryRun({
  portal: PORTAL, evaluate: evaluatePortalCandidates, namesLoaded: NAMED, today: TODAY, ...over,
})

/* ── 1. Провенанс: поле без источника не собирается ─────────────────────── */
{
  const assembled = candidateFromObservations({
    row: queueRow('japan-guide:e1', 'Ohara Museum'),
    enriched: enrichedRow('japan-guide:e1', 'Ohara Museum', GOOD_NAMED(1)),
    identified: null, portal: PORTAL, namesLoaded: NAMED,
  })
  t('японское имя пришло с официального сайта', assembled.candidate.nameJa, NAMES[1])
  t('английское — из обхода', assembled.candidate.nameEn, 'Ohara Museum')
  t('русское имя — из проверенного файла владельца', assembled.candidate.nameRu, `${NAMES_RU[0]} (e1)`)
  t('  и источник назван файлом имён', assembled.provenance.find((mark) => mark.field === 'nameRu').source, 'ownerNames')
  t('направление — оттуда же', assembled.candidate.siteCity, 'kyoto')
  t('координаты парой', `${assembled.candidate.lat},${assembled.candidate.lon}`, '34.901,135.701')
  t('  и источник назван', assembled.provenance.find((mark) => mark.field === 'coordinates').source, 'officialSite')
  t('каждое непустое поле имеет источник', assembled.provenance.map((mark) => mark.field).sort().join(','), 'address,coordinates,nameEn,nameJa,nameRu,siteCity')
  /* Опознание старше сайта: у него есть place_id, которым точку можно проверить. */
  const withPlace = candidateFromObservations({
    row: queueRow('japan-guide:e1', 'Ohara Museum'),
    enriched: enrichedRow('japan-guide:e1', 'Ohara Museum', GOOD_NAMED(1)),
    identified: { outcome: 'resolved', place: { placeId: 'ChIJ1', coordinates: { lat: 35.1, lon: 139.1, validUntil: '2026-10-09' } } },
    portal: PORTAL, namesLoaded: NAMED,
  })
  t('координаты опознания вытесняют координаты сайта', `${withPlace.candidate.lat},${withPlace.candidate.lon}`, '35.1,139.1')
  t('  и источник назван опознанием', withPlace.provenance.find((mark) => mark.field === 'coordinates').source, 'placeLookup')
  t('  place_id перенесён', withPlace.candidate.placeId, 'ChIJ1')
  /* Две карточки на странице — ключей не даём (наследие JG2-03). */
  const twoPlaces = candidateFromObservations({
    row: queueRow('japan-guide:e2', 'Two'),
    enriched: enrichedRow('japan-guide:e2', 'Two', [fact('nameJa', '寺A', 0), fact('lat', '34.1', 0), fact('lon', '135.1', 0), fact('nameJa', '寺B', 1)]),
    identified: null, portal: PORTAL,
  })
  t('несколько мест — ни имени, ни координат', `${twoPlaces.candidate.nameJa || 'пусто'}/${twoPlaces.candidate.lat}`, 'пусто/null')
  t('фиктивного описания в фикстурах нет', assembled.candidate.descriptionJa, '')
  const half = candidateFromObservations({
    row: queueRow('japan-guide:e3', 'Half'),
    enriched: enrichedRow('japan-guide:e3', 'Half', [fact('nameJa', '寺C'), fact('lat', '34.1')]),
    identified: null, portal: PORTAL,
  })
  t('одна координата парой не является', half.candidate.lat, null)
  /* Строки, которой владелец не называл, в файле имён нет — и русское имя не
     появляется ниоткуда. */
  const unnamed = candidateFromObservations({
    row: queueRow('japan-guide:e900', 'Unnamed'),
    enriched: enrichedRow('japan-guide:e900', 'Unnamed', GOOD_NAMED(1)),
    identified: null, portal: PORTAL, namesLoaded: NAMED,
  })
  t('без записи в файле имён русского имени нет', unnamed.candidate.nameRu, '')
  t('  и направления тоже', unnamed.candidate.siteCity, null)
  t('источники закрыты', boom(() => candidateFromObservations({
    row: queueRow('japan-guide:e4', 'X'), enriched: null, identified: null, portal: PORTAL,
  })).includes('вне закрытого списка'), false)
}

/* ── 2. Сведение входов ─────────────────────────────────────────────────── */
{
  const rows = [queueRow('japan-guide:e1', 'Alpha'), queueRow('japan-guide:e2', 'Beta')]
  const queues = queuesOf(rows)
  const enrichment = enrichmentOf([
    enrichedRow('japan-guide:e1', 'Alpha', GOOD_NAMED(1)),
    enrichedRow('japan-guide:e2', 'Beta', GOOD_NAMED(2)),
  ], { inputs: { queues: { digest: queues.reportDigest } } })
  const exportBytes = exportBytesOf([])
  const run = (over = {}) => dry({ queues, enrichment, identification: null, exportBytes, ...over })
  t('согласованные входы принимаются', run().rows.length, 2)
  const tampered = { ...enrichment, rows: enrichment.rows.map((row) => ({ ...row, nameEn: 'Подделка' })) }
  has('изменённый отчёт со старым отпечатком — отказ', boom(() => run({ enrichment: tampered })), 'изменён после подписи')
  const foreign = enrichmentOf([enrichedRow('japan-guide:e999', 'Чужой', GOOD_NAMED(9))], { inputs: { queues: { digest: queues.reportDigest } } })
  has('чужие строки обогащения — отказ', boom(() => run({ enrichment: foreign })), 'не принадлежат очереди candidate')
  const otherQueues = enrichmentOf(enrichment.rows, { inputs: { queues: { digest: `sha256:${'9'.repeat(64)}` } } })
  has('обогащение по другим очередям — отказ', boom(() => run({ enrichment: otherQueues })), 'собрано по очередям')
  const strayId = identificationOf([{ sourceKey: 'japan-guide:e777', nameEn: 'X', sourceUrl: 'https://x', outcome: 'notFound', detail: 'нет', place: null, alternatives: [], review: true }],
    { inputs: { enrichment: { digest: enrichment.reportDigest } } })
  has('опознание чужих строк — отказ', boom(() => run({ identification: strayId })), 'не принадлежат обогащению')
  const otherEnrich = identificationOf([], { inputs: { enrichment: { digest: `sha256:${'8'.repeat(64)}` } } })
  has('опознание по другому обогащению — отказ', boom(() => run({ identification: otherEnrich })), 'собрано по обогащению')
  /* Пустая очередь проверяется на СОГЛАСОВАННОЙ паре: иначе первым сработает
     сторож связи отчётов, и проверка доказывала бы не то, что названа. */
  const emptyQueues = queuesOf([])
  const emptyEnrichment = enrichmentOf([], { inputs: { queues: { digest: emptyQueues.reportDigest } } })
  has('пустая очередь candidate — отказ', boom(() => run({ queues: emptyQueues, enrichment: emptyEnrichment })), 'вести к приёму нечего')
  /* Сборщик инъектируем — и граница не верит ему на слово: поле без
     названного источника дальше не идёт, кто бы его ни собрал. */
  const silent = ({ row }) => ({
    candidate: { sourceKey: row.sourceKey, sourceUrl: row.url, seedSource: 'japan-guide', licence: null, nameJa: '無名', nameEn: '', lat: null, lon: null },
    provenance: [],
    placeNodes: 0,
  })
  has('поле без названного источника — отказ', boom(() => run({ assemble: silent })), 'без названного источника')
}

/* ── 3. Исходы, закон сохранения, воспроизводимость ─────────────────────── */
{
  const rows = [
    queueRow('japan-guide:e1', 'Kiyomizudera'),
    queueRow('japan-guide:e2', 'Ginkakuji'),
    queueRow('japan-guide:e3', 'Not Enriched'),
    queueRow('japan-guide:e4', 'Linked One'),
  ]
  const queues = queuesOf(rows)
  const enrichment = enrichmentOf([
    enrichedRow('japan-guide:e1', 'Kiyomizudera', GOOD_NAMED(1)),
    enrichedRow('japan-guide:e2', 'Ginkakuji', GOOD_NAMED(2)),
    enrichedRow('japan-guide:e3', 'Not Enriched', [], 'noFacts'),
    enrichedRow('japan-guide:e4', 'Linked One', GOOD_NAMED(4)),
  ], { inputs: { queues: { digest: queues.reportDigest } } })
  const exportBytes = exportBytesOf([
    { recordId: 'rec00000000000001', poiId: 'POI-000001', nameEn: 'Linked One', nameRu: 'Связанный', sourceKey: 'japan-guide:e4' },
  ])
  const identification = identFor(['e1', 'e2', 'e4'], { inputs: { enrichment: { digest: enrichment.reportDigest } } })
  const result = dry({ queues, enrichment, identification, exportBytes })
  const byKey = Object.fromEntries(result.rows.map((row) => [row.sourceKey, row]))
  t('исходов ровно семь родов', DRY_RUN_OUTCOMES.join(','), 'writable,qualityRejected,intakeIncomplete,duplicateInBatch,matchesExisting,needsOwner,notEnriched')
  t('обогащённый и чистый — годен к созданию', byKey['japan-guide:e1'].outcome, 'writable')
  t('второй тоже', byKey['japan-guide:e2'].outcome, 'writable')
  t('необогащённый назван своим исходом', byKey['japan-guide:e3'].outcome, 'notEnriched')
  t('  и это не «отвергнут качеством»', byKey['japan-guide:e3'].outcome === 'qualityRejected', false)
  t('связанный с базой по ключу — matchesExisting', byKey['japan-guide:e4'].outcome, 'matchesExisting')
  t('  и совпадение названо', byKey['japan-guide:e4'].match?.top?.poiId ?? 'совпадения нет', 'POI-000001')
  t('подготовленных запросов ровно столько, сколько годных', result.requests.length, 2)
  t('  и файл имён назван в результате', typeof result.names?.digest, 'string')
  const report = buildDryRunReport({
    result, queues, enrichment, identification, manifest: null, gate: null, createdAt: NOW, portal: PORTAL,
  })
  t('отчёт называет отпечаток файла имён', report.inputs.names.digest, result.names.digest)
  t('сумма исходов равна очереди', DRY_RUN_OUTCOMES.reduce((n, outcome) => n + report.counts[outcome], 0), 4)
  t('каждая строка ровно один раз', new Set(report.rows.map((row) => row.sourceKey)).size, 4)
  t('эффектов нет', JSON.stringify(report.effects), JSON.stringify({ network: 0, google: 0, model: 0, post: 0, patch: 0, delete: 0 }))
  const repeat = buildDryRunReport({
    result: dry({ queues, enrichment, identification, exportBytes }),
    queues, enrichment, identification, manifest: null, gate: null, createdAt: '2027-01-01T00:00:00.000Z', portal: PORTAL,
  })
  t('повтор на тех же байтах даёт тот же отпечаток', report.reportDigest, repeat.reportDigest)
  has('сводка называет нули', summarizeDryRun(report), 'эффектов 0')
  /* Дубль внутри партии: две строки об одном объекте. */
  const twinQueues = queuesOf([queueRow('japan-guide:e5', 'Twin'), queueRow('japan-guide:e6', 'Twin')])
  const twinEnrichment = enrichmentOf([
    enrichedRow('japan-guide:e5', 'Twin', GOOD_NAMED(5)),
    enrichedRow('japan-guide:e6', 'Twin', GOOD_NAMED(5)),
  ], { inputs: { queues: { digest: twinQueues.reportDigest } } })
  const twinIdentification = identificationOf(
    ['e5', 'e6'].map((key) => identifiedRow(`japan-guide:${key}`, { placeId: `ChIJ-${key}`, lat: 34.95, lon: 135.75 })),
    { inputs: { enrichment: { digest: twinEnrichment.reportDigest } } },
  )
  const twins = dry({ queues: twinQueues, enrichment: twinEnrichment, identification: twinIdentification, exportBytes: exportBytesOf([]) })
  t('дубль внутри партии назван', twins.rows.filter((row) => row.outcome === 'duplicateInBatch').length, 1)
  t('  и первый остаётся годным', twins.rows.filter((row) => row.outcome === 'writable').length, 1)
}

/* ── 4. Партия JA-7 ─────────────────────────────────────────────────────── */
{
  const keys = ['e11', 'e12', 'e13', 'e14', 'e15', 'e16', 'e17']
  const queues = queuesOf(keys.map((key, i) => queueRow(`japan-guide:${key}`, `Object ${i}`)))
  const enrichment = enrichmentOf(keys.map((key, i) => enrichedRow(`japan-guide:${key}`, `Object ${i}`, GOOD_NAMED(i + 1))),
    { inputs: { queues: { digest: queues.reportDigest } } })
  const identification = identFor(keys, { inputs: { enrichment: { digest: enrichment.reportDigest } } })
  const result = dry({ queues, enrichment, identification, exportBytes: exportBytesOf([]) })
  const report = buildDryRunReport({ result, queues, enrichment, identification, manifest: null, gate: null, createdAt: NOW, portal: PORTAL })
  t('годных больше пяти', report.counts.writable > BATCH_LIMITS.maxCreates, true)
  const selection = selectBatch(report)
  t('партия не превышает пяти', selection.selected.length, BATCH_LIMITS.maxCreates)
  t('  и все ключи различны', new Set(selection.selected.map((row) => row.sourceKey)).size, BATCH_LIMITS.maxCreates)
  /* Источник координат у годной строки может быть только опознанием: без
     `place_id` и точки резолвера политика координат не выводится, и запись не
     создаётся вовсе. Класс это и показывает. */
  t('класс сложности складывается из источника координат, имени и совпадения',
    selection.selected.length ? difficultyClassOf(selection.selected[0]) : 'партия пуста', 'placeLookup/facts2/clean')
  has('потолок партии закрыт', boom(() => selectBatch(report, { limit: 6 })), 'вне разрешённого 0…5')
  const batch = buildBatchReport({ selection, report, scopeId: 'canary-2026-09', portal: 'japan-guide', note: 'проба', createdAt: NOW, referenceFileDigest: fileDigestOf(report) })
  t('черновик помечен черновиком', batch.approvalDraft.draft, true)
  t('  срока в нём нет', `${'issuedAt' in batch.approvalDraft}/${'expiresAt' in batch.approvalDraft}`, 'false/false')
  t('  и сказано, чего не хватает', batch.approvalDraft.missingBeforeUse.join(','), 'issuedAt,expiresAt')
  t('  переименований ноль', batch.approvalDraft.maxRenames, 0)
  t('  создать ровно столько, сколько отобрано', batch.approvalDraft.maxCreates, selection.selected.length)
  /* JG3-02: в разрешение идёт отпечаток БАЙТОВ файла — то, что сверит
     писатель; предметный отпечаток остаётся отдельным полем отчёта. */
  t('  эталон разрешения — отпечаток байтов файла', batch.approvalDraft.referenceDigest, fileDigestOf(report))
  t('  предметный отпечаток сохранён отдельно', batch.dryRun.digest, report.reportDigest)
  t('  и они различны', batch.approvalDraft.referenceDigest === batch.dryRun.digest, false)
  has('  без байтового отпечатка черновик не собирается', boom(() => buildBatchReport({
    selection, report, scopeId: 'canary-2026-09', portal: 'japan-guide', note: 'проба', createdAt: NOW,
  })), 'с внутренним отпечатком разрешение не сойдётся')
  /*
   * СОВМЕСТИМОСТЬ С НАСТОЯЩИМ ПИСАТЕЛЕМ. Черновик + срок, проставленный ЗДЕСЬ
   * (в тесте, а не в production), обязан пройти настоящую
   * `assertWriteApprovalApplies` — иначе разрешение владельца отказало бы со
   * словами «владелец видел другой результат».
   */
  /* Пустая партия сюда не дойдёт: разрешение без ключей контракт не примет, и
     это законно — проверять совместимость не на чем. Если партия пуста, значит
     сломалось раньше, и об этом скажет проверка ниже. */
  t('партия для проверки разрешения непуста', batch.approvalDraft.sourceKeys.length > 0, true)
  const asApproval = batch.approvalDraft.sourceKeys.length ? parseWriteApproval({
    spec: WRITE_APPROVAL_SPEC,
    scopeId: batch.approvalDraft.scopeId,
    portal: batch.approvalDraft.portal,
    issuedAt: '2026-09-09T00:00:00.000Z',
    expiresAt: '2026-09-16T00:00:00.000Z',
    referenceDigest: batch.approvalDraft.referenceDigest,
    sourceKeys: batch.approvalDraft.sourceKeys,
    maxCreates: batch.approvalDraft.maxCreates,
    maxRenames: batch.approvalDraft.maxRenames,
    note: batch.approvalDraft.note,
  }) : null
  t('черновик со сроком проходит настоящую проверку разрешения', asApproval ? assertWriteApprovalApplies({
    approval: asApproval, now: new Date('2026-09-10T00:00:00.000Z'),
    scopeId: 'canary-2026-09', portal: 'japan-guide', referenceDigest: fileDigestOf(report),
  }).scopeId : 'партия пуста', 'canary-2026-09')
  has('  а с предметным отпечатком — отказывает', (() => {
    if (!asApproval) return 'партия пуста'
    try {
      assertWriteApprovalApplies({
        approval: parseWriteApproval({ ...asApproval, referenceDigest: report.reportDigest }),
        now: new Date('2026-09-10T00:00:00.000Z'),
        scopeId: 'canary-2026-09', portal: 'japan-guide', referenceDigest: fileDigestOf(report),
      })
      return '(без отказа)'
    } catch (e) { return `${e.reason}: ${e.message}` }
  })(), 'writeApprovalReferenceDrift')
  t('  ключи поимённо и отсортированы', batch.approvalDraft.sourceKeys.join(',') === [...batch.approvalDraft.sourceKeys].sort().join(','), true)
  t('удалений в потолках нет вовсе', BATCH_LIMITS.maxDeletes, 0)
  t('эффектов нет', JSON.stringify(batch.effects), JSON.stringify({ post: 0, patch: 0, delete: 0 }))
  has('партия говорит, что полномочий не даёт', batch.note, 'полномочий не даёт')
  has('сводка тоже', summarizeBatch(batch), 'записей нет')
  t('отпечаток партии не зависит от момента', batch.reportDigest,
    buildBatchReport({ selection, report, scopeId: 'canary-2026-09', portal: 'japan-guide', note: 'проба', createdAt: '2027-01-01T00:00:00.000Z', referenceFileDigest: fileDigestOf(report) }).reportDigest)
  has('чужой отчёт вместо сухого прогона — отказ', boom(() => selectBatch({ spec: 'poi-enrichment/v1', rows: [] })), `ожидается «${DRY_RUN_SPEC}»`)
  /*
   * JG3-01: изменённый исход со СТАРЫМ отпечатком до отбора не доходит.
   * Контрпример аудита: одна строка переписана с `notEnriched` на `writable`,
   * counts и reportDigest оставлены прежними.
   */
  const forged = JSON.parse(JSON.stringify(report))
  forged.rows[0] = { ...forged.rows[0], outcome: forged.rows[0].outcome === 'writable' ? 'notEnriched' : 'writable' }
  has('изменённый исход со старым отпечатком — отказ', boom(() => selectBatch(forged)), 'изменён после подписи')
  /* Счётчик, разошедшийся со строками, — отказ ДАЖЕ при верном отпечатке:
     подписать можно и неверно собранный отчёт, а партия отбирается по
     счётчикам. */
  const miscounted = JSON.parse(JSON.stringify(report))
  miscounted.counts.writable += 1
  has('изменённый счётчик со старым отпечатком — отказ', boom(() => selectBatch(miscounted)), 'изменён после подписи')
  const resigned = { ...miscounted }
  delete resigned.reportDigest
  const properlySigned = {
    ...resigned,
    reportDigest: sha256Bytes(canonicalJsonBytes({ ...resigned, createdAt: null, manifest: null, gate: null }, DRY_RUN_SPEC)),
  }
  has('верно подписанный отчёт с неверными счётчиками — тоже отказ', boom(() => selectBatch(properlySigned)), 'counts.writable: объявлено')
  const miscountedQueue = JSON.parse(JSON.stringify(report))
  miscountedQueue.counts.queue += 1
  delete miscountedQueue.reportDigest
  const signedQueue = {
    ...miscountedQueue,
    reportDigest: sha256Bytes(canonicalJsonBytes({ ...miscountedQueue, createdAt: null, manifest: null, gate: null }, DRY_RUN_SPEC)),
  }
  has('  и длина очереди тоже сверяется', boom(() => selectBatch(signedQueue)), 'counts.queue: объявлено')
  const dupKeys = JSON.parse(JSON.stringify(report))
  dupKeys.rows[1] = { ...dupKeys.rows[1], sourceKey: dupKeys.rows[0].sourceKey }
  has('повтор ключа — отказ', boom(() => selectBatch(dupKeys)), 'изменён после подписи')
  has('отчёт без отпечатка — отказ', boom(() => selectBatch({ ...report, reportDigest: undefined })), 'принимать нечего')
  t('свой отчёт проходит проверку контракта', assertDryRunReport(report).spec, DRY_RUN_SPEC)

  /*
   * РАЗНЫЕ КЛАССЫ, А НЕ ПЯТЬ ОДИНАКОВЫХ. Партия проверяет путь, а путь
   * проверяется разнообразием: три класса обязаны попасть в пятёрку все, и
   * первый класс не имеет права занять её целиком.
   */
  const mixedKeys = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']
  const mixedQueues = queuesOf(mixedKeys.map((key, i) => queueRow(`japan-guide:${key}`, `Mixed ${i}`)))
  /* Сайт рассказал о строках РАЗНОЕ: кому-то только имя, кому-то имя и адрес,
     кому-то ещё и чтение каной. Это и есть разные классы сложности. */
  const mixedFacts = (i) => {
    const facts = [fact('nameJa', NAMES[i % NAMES.length])]
    if (i % 3 !== 0) facts.push(fact('address', `京都府京都市${i}`))
    if (i % 3 === 2) facts.push(fact('nameKana', 'きよみずでら'))
    return facts
  }
  const mixedEnrichment = enrichmentOf(mixedKeys.map((key, i) => enrichedRow(`japan-guide:${key}`, `Mixed ${i}`, mixedFacts(i))),
    { inputs: { queues: { digest: mixedQueues.reportDigest } } })
  /* Двум строкам координаты даёт опознание, одна совпадает именем с базой. */
  const mixedIdentification = identFor(mixedKeys, { inputs: { enrichment: { digest: mixedEnrichment.reportDigest } } })
  /* Одна строка похожа именем на существующую запись, но записью не является:
     сайт другой, и сверка оставляет её новой — меняется КЛАСС, а не исход. */
  const mixedExport = exportBytesOf([
    { recordId: 'rec00000000000009', poiId: 'POI-000009', nameEn: 'Mixed 7', nameRu: 'Смешанный', website: 'https://other.example/' },
  ])
  const mixedResult = dry({
    queues: mixedQueues, enrichment: mixedEnrichment, identification: mixedIdentification, exportBytes: mixedExport,
  })
  const mixedReport = buildDryRunReport({
    result: mixedResult, queues: mixedQueues, enrichment: mixedEnrichment, identification: mixedIdentification,
    manifest: null, gate: null, createdAt: NOW, portal: PORTAL,
  })
  const mixed = selectBatch(mixedReport)
  t('классов сложности больше одного', mixed.classes.length > 1, true)
  t('  в партию попали разные классы', new Set(mixed.selected.map((row) => row.difficultyClass)).size, Math.min(mixed.classes.length, BATCH_LIMITS.maxCreates))
  t('  и опознанные строки среди них', mixed.selected.some((row) => row.difficultyClass.startsWith('placeLookup/')), true)
  t('  партия по-прежнему не больше пяти', mixed.selected.length <= BATCH_LIMITS.maxCreates, true)
}

/* ── 5. Пустая партия названа, а не молчит ──────────────────────────────── */
{
  const queues = queuesOf([queueRow('japan-guide:e21', 'Bare')])
  const enrichment = enrichmentOf([enrichedRow('japan-guide:e21', 'Bare', [], 'noFacts')],
    { inputs: { queues: { digest: queues.reportDigest } } })
  const result = dry({ queues, enrichment, identification: null, exportBytes: exportBytesOf([]) })
  const report = buildDryRunReport({ result, queues, enrichment, identification: null, manifest: null, gate: null, createdAt: NOW, portal: PORTAL })
  const selection = selectBatch(report)
  t('годных нет', report.counts.writable, 0)
  t('партия пуста', selection.selected.length, 0)
  has('  и причина названа', selection.emptyReason, 'ни одна строка не годна к созданию')
  const batch = buildBatchReport({ selection, report, scopeId: 'canary-2026-09', portal: 'japan-guide', note: 'проба', createdAt: NOW, referenceFileDigest: fileDigestOf(report) })
  t('черновик на пустую партию не разрешает ничего', batch.approvalDraft.maxCreates, 0)
  has('сводка называет пустоту', summarizeBatch(batch), 'партия пуста')
}

/* ── 6. Положительный сценарий на НАСТОЯЩЕЙ оценке ──────────────────────── */
{
  const queues = queuesOf([queueRow('japan-guide:e31', 'Kiyomizudera')])
  const enrichment = enrichmentOf([enrichedRow('japan-guide:e31', 'Kiyomizudera', GOOD_NAMED(0))],
    { inputs: { queues: { digest: queues.reportDigest } } })
  const identification = identFor(['e31'], { inputs: { enrichment: { digest: enrichment.reportDigest } } })
  const result = dry({ queues, enrichment, identification, exportBytes: exportBytesOf([]) })
  const row = result.rows[0]
  t('кандидат с именем, адресом и координатами годен к созданию', row.outcome, 'writable')
  t('  и запрос приёма для него подготовлен', result.requests.length, 1)
  t('  политика координат выведена машинно', row.intake?.policy ?? 'запроса нет', 'exactObjectPoint')
  t('  описания в запросе нет как поля', result.requests[0] ? 'descriptionRu' in result.requests[0].poi : 'запроса нет', false)
  t('  описание при этом не написано', row.verdict.copyPending, true)
  t('  и не выдумано', enrichment.rows[0].facts.some((f) => f.field.startsWith('description')), false)
  t('  порог сдвинут ровно на вес описания', row.verdict.importThreshold, IMPORT_MIN_SCORE - DESCRIPTION_MAX_WEIGHT)
  t('  вето по описанию не сработало', (row.verdict.blocking ?? []).includes('description_missing'), false)
  t('  план объявлен в отчёте', result.copyPlan, 'draftLater')

  /*
   * ПРОВЕРКИ, КОТОРЫЕ ОСТАЛИСЬ НА МЕСТЕ. Сдвинута шкала описания, и только она:
   * тождество, координаты и публикация не ослаблены ничем.
   */
  const bare = evaluatePoiCandidate({ sourceKey: 'k', nameJa: '', nameEn: 'X', lat: 34.9, lon: 135.7, descriptionJa: '' }, { copyPlan: 'draftLater' })
  t('без японского имени — по-прежнему вето', bare.blockingReasons.includes('missing_name'), true)
  const noGeo = evaluatePoiCandidate({ sourceKey: 'k', nameJa: '清水寺', nameEn: 'X', lat: null, lon: null, address: null, descriptionJa: '' }, { copyPlan: 'draftLater' })
  t('без координат и адреса — по-прежнему вето', noGeo.blockingReasons.includes('geo_unresolvable'), true)
  const outside = evaluatePoiCandidate({ sourceKey: 'k', nameJa: '清水寺', nameEn: 'X', lat: 10, lon: 10, descriptionJa: '' }, { bbox: { minLat: 34, maxLat: 36, minLon: 135, maxLon: 137 }, copyPlan: 'draftLater' })
  t('вне заявленного региона — по-прежнему вето', outside.blockingReasons.includes('geo_out_of_bounds'), true)
  const strict = evaluatePoiCandidate({ sourceKey: 'k', nameJa: '清水寺', nameEn: 'X', address: '京都府', lat: 34.99, lon: 135.78, descriptionJa: '' })
  t('по умолчанию план прежний: описания нет — вето', strict.blockingReasons.includes('description_missing'), true)
  t('  и это не глобальное отключение', strict.terminal, 'qualityRejected')
  t('планов ровно два', COPY_PLANS.join(','), 'required,draftLater')
  has('неизвестный план — отказ', boom(() => evaluatePoiCandidate({ nameJa: '清水寺' }, { copyPlan: 'whatever' })), 'вне закрытого списка')

  /* Партия из такого прогона несёт признак незавершённой редактуры. */
  const report = buildDryRunReport({ result, queues, enrichment, identification, manifest: null, gate: null, createdAt: NOW, portal: PORTAL })
  const batch = buildBatchReport({
    selection: selectBatch(report), report, scopeId: 'canary-2026-09', portal: 'japan-guide',
    note: 'проба', createdAt: NOW, referenceFileDigest: fileDigestOf(report),
  })
  t('партия непуста', batch.selection.count, 1)
  t('  и строка помечена незавершённой редактурой', batch.selection.rows[0]?.copyPending ?? 'строки нет', true)
  has('  сводка говорит об этом человеку', summarizeBatch(batch), 'записи остаются черновиками')
  t('  план записи назван в отчёте партии', batch.dryRun.copyPlan, 'draftLater')
}

/* ── 7. JG3-04: происхождение координат проверяется по типу, а не по строке ── */
{
  const queues = queuesOf([queueRow('japan-guide:e41', 'Numeric')])
  const enrichment = enrichmentOf([enrichedRow('japan-guide:e41', 'Numeric', GOOD_NAMED(1))],
    { inputs: { queues: { digest: queues.reportDigest } } })
  let evaluated = 0
  const counting = (portal, candidates, options) => { evaluated += 1; return evaluatePortalCandidates(portal, candidates, options) }
  const silentCoords = (value) => ({ row }) => ({
    candidate: {
      sourceKey: row.sourceKey, sourceUrl: row.url, seedSource: 'japan-guide', licence: null,
      nameJa: '清水寺', nameEn: 'X', lat: value, lon: value === null ? null : 139,
      descriptionJa: '', address: null,
    },
    provenance: [
      { field: 'nameJa', source: 'officialSite', detail: 'https://site.jp/' },
      { field: 'nameEn', source: 'discovery', detail: 'https://www.japan-guide.com/e/e41.html' },
    ],
    placeNodes: 1,
  })
  const run = (assemble) => dry({
    queues, enrichment, identification: null, exportBytes: exportBytesOf([]), evaluate: counting, assemble,
  })
  for (const [label, value] of [['положительная', 35], ['отрицательная', -35], ['нулевая', 0]]) {
    evaluated = 0
    has(`${label} координата без отметки — отказ`, boom(() => run(silentCoords(value))), 'координаты без названного источника')
    t(`  и оценка при этом не вызывалась (${label})`, evaluated, 0)
  }
  const halfPair = () => ({ row }) => ({
    candidate: { sourceKey: row.sourceKey, sourceUrl: row.url, seedSource: 'japan-guide', licence: null, nameJa: '清水寺', nameEn: 'X', lat: 35, lon: null, descriptionJa: '', address: null },
    provenance: [
      { field: 'nameJa', source: 'officialSite', detail: 'x' },
      { field: 'nameEn', source: 'discovery', detail: 'x' },
      { field: 'coordinates', source: 'officialSite', detail: 'x' },
    ],
    placeNodes: 1,
  })
  has('половина пары — отказ', boom(() => run(halfPair())), 'половина координатной пары')
  const proper = () => ({ row }) => ({
    candidate: {
      sourceKey: row.sourceKey, sourceUrl: row.url, seedSource: 'japan-guide', licence: null,
      nameJa: '清水寺', nameEn: 'X', nameRu: 'Киёмидзу-дэра', siteCity: 'kyoto',
      lat: 34.99, lon: 135.78, descriptionJa: '', address: null,
    },
    provenance: [
      { field: 'nameJa', source: 'officialSite', detail: 'x' },
      { field: 'nameEn', source: 'discovery', detail: 'x' },
      { field: 'nameRu', source: 'ownerNames', detail: 'x' },
      { field: 'siteCity', source: 'ownerNames', detail: 'x' },
      { field: 'coordinates', source: 'officialSite', detail: 'x' },
    ],
    placeNodes: 1,
  })
  evaluated = 0
  const properRow = run(proper()).rows[0]
  t('корректная пара с источником проходит границу провенанса', properRow.outcome === 'qualityRejected', false)
  t('  и оценка вызвана', evaluated, 1)
  /* Дальше её останавливает уже НЕ провенанс, а происхождение точки: координаты
     с официального сайта не подтверждены опознанным местом, и политику из них
     не вывести. Это разные границы, и путать их нельзя. */
  t('  а останавливает её отсутствие опознанного места', properRow.intake.refusal, 'missingPlaceId')
}

/* ── 8. JG3-03: ось дрейфа видит настоящие поля манифеста ───────────────── */
{
  const bytesOf = (text) => new TextEncoder().encode(text)
  const manifestWith = ({ code = 'исходный код', raw = 'сырой вход', canonical = 'japan-guide:a' } = {}) => buildRunManifest({
    startedAt: NOW,
    mode: 'read-only',
    code: {
      commit: 'a'.repeat(40),
      dirty: false,
      graph: codeGraphIdentity([{ path: 'scripts/x.mjs', bytes: bytesOf(code) }]),
      deps: { file: 'package-lock.json', digest: sha256Bytes(bytesOf('lock')), bytes: 4 },
    },
    intakeContract: 'poi-intake/v1',
    registries: [registryValueIdentity({ id: 'poi-taxonomy', version: 'v1', value: { a: 1 }, entries: 1 })],
    matcherPolicy: { version: 'poi-matcher-policy/v4', digest: `sha256:${'1'.repeat(64)}`, lexiconDigest: `sha256:${'2'.repeat(64)}` },
    portals: [{
      portalId: 'japan-guide',
      adapter: { id: 'japan-guide-intake', version: 'japan-guide-intake/v1' },
      input: {
        rawPayload: { digest: sha256Bytes(bytesOf(raw)), bytes: raw.length, spec: RAW_FILE_BYTES_SPEC },
        canonical: candidateSetIdentity({ candidates: [{ sourceKey: canonical }], unkeyed: [] }),
      },
    }],
    base: { existing: null, snapshot: { file: 'airtable-export', digest: sha256Bytes(bytesOf('база')), bytes: 4, records: 1, withSourceKey: 1 } },
    names: null,
  })
  const baseManifest = manifestWith()
  const referenceReport = {
    manifest: baseManifest,
    inputs: { queues: { digest: `sha256:${'3'.repeat(64)}` }, enrichment: { digest: `sha256:${'4'.repeat(64)}` }, identification: null },
  }
  const currentReport = { inputs: referenceReport.inputs }
  t('неизменный эталон — дрейфа нет', driftAgainst(referenceReport, baseManifest, currentReport).length, 0)
  /* Названия осей — из общего сравнения, а не из своего словаря. */
  t('изменился код — ось названа', driftAgainst(referenceReport, manifestWith({ code: 'другой код' }), currentReport).join(','), 'codeGraphDrift')
  t('изменился сырой вход — ось названа', driftAgainst(referenceReport, manifestWith({ raw: 'другой вход' }), currentReport).join(','), 'inputDrift')
  t('изменился канонический вход — ось названа', driftAgainst(referenceReport, manifestWith({ canonical: 'japan-guide:b' }), currentReport).join(','), 'canonicalDrift')
  t('изменились очереди JG-1 — ось названа', driftAgainst(referenceReport, baseManifest, {
    inputs: { ...currentReport.inputs, queues: { digest: `sha256:${'9'.repeat(64)}` } },
  }, currentReport).join(','), 'входы: очереди JG-1')
  t('изменилось обогащение JA-3 — ось названа', driftAgainst(referenceReport, baseManifest, {
    inputs: { ...currentReport.inputs, enrichment: { digest: `sha256:${'9'.repeat(64)}` } },
  }).join(','), 'входы: обогащение JA-3')
  t('появилось опознание JA-4 — ось названа', driftAgainst(referenceReport, baseManifest, {
    inputs: { ...currentReport.inputs, identification: { digest: `sha256:${'9'.repeat(64)}` } },
  }).join(','), 'входы: опознание JA-4')
  t('эталон без манифеста назван', driftAgainst({ inputs: {} }, baseManifest, currentReport).join(','), 'эталон снят до появления манифеста')
  t('эталон не прочитан — сказано прямо', driftAgainst(null, baseManifest, currentReport).join(','), 'эталон не прочитан')
  has('негодный манифест эталона назван', driftAgainst({ manifest: { contractVersion: 'run-manifest/v1' } }, baseManifest, currentReport).join(','), 'манифест эталона не принят')
}

/* ── 9. Без обязательных данных — ИМЕНОВАННЫЙ ОТКАЗ, а не writable ──────── */
{
  const keyOf = (n) => `japan-guide:x${n}`
  const queues = queuesOf([1, 2, 3, 4, 5].map((n) => queueRow(keyOf(n), `Case ${n}`)))
  const enrichment = enrichmentOf([1, 2, 3, 4, 5].map((n) => enrichedRow(keyOf(n), `Case ${n}`, GOOD_NAMED(n))),
    { inputs: { queues: { digest: queues.reportDigest } } })

  /* Имена владельца есть у всех, кроме первой строки; у второй — направление,
     которого нет в справочнике направлений. */
  const names = await ownerNames({
    [keyOf(2)]: { nameRu: 'Место без направления', siteCity: 'atlantis' },
    [keyOf(3)]: { nameRu: 'Место в чужой префектуре', siteCity: 'kyoto' },
    [keyOf(4)]: { nameRu: 'Место без опознания', siteCity: 'kyoto' },
    [keyOf(5)]: { nameRu: 'Место с просроченной точкой', siteCity: 'kyoto' },
  })
  const identification = identificationOf([
    /* Опознано в Осаке, а владелец назвал направление kyoto. */
    identifiedRow(keyOf(3), { placeId: 'ChIJ-x3', lat: 34.68, lon: 135.52, prefecture: 'Osaka' }),
    /* Точка снята год назад: срок годности координат вышел. */
    identifiedRow(keyOf(5), { placeId: 'ChIJ-x5', lat: 34.99, lon: 135.78, observedOn: '2025-09-09' }),
  ], { inputs: { enrichment: { digest: enrichment.reportDigest } } })

  const rows = Object.fromEntries(dry({
    queues, enrichment, identification, exportBytes: exportBytesOf([]), namesLoaded: names,
  }).rows.map((row) => [row.sourceKey, row]))
  const refusalOf = (n) => `${rows[keyOf(n)].outcome}/${rows[keyOf(n)].intake?.refusal ?? 'без отказа'}`

  t('нет имени и направления — канон приёма называет оба поля', refusalOf(1), 'intakeIncomplete/canonBlocking')
  t('  и названы именно они', rows[keyOf(1)].intake.missing.join(','), 'nameRu,siteCity')
  has('  и сказано, что владелец строку не называл', rows[keyOf(1)].intake.message, 'Файл проверенных имён эту строку не называет')
  t('направление вне справочника — siteCityUnverifiable', refusalOf(2), 'intakeIncomplete/siteCityUnverifiable')
  t('место в чужой префектуре — cityConflict', refusalOf(3), 'intakeIncomplete/cityConflict')
  has('  и названы обе префектуры', rows[keyOf(3)].intake.message, 'Osaka')
  t('без опознания — missingPlaceId', refusalOf(4), 'intakeIncomplete/missingPlaceId')
  t('просроченная точка — coordinatesExpired', refusalOf(5), 'intakeIncomplete/coordinatesExpired')
  t('ни одна из пяти не объявлена годной', Object.values(rows).some((row) => row.outcome === 'writable'), false)
  t('и подготовленных запросов нет ни одного', dry({
    queues, enrichment, identification, exportBytes: exportBytesOf([]), namesLoaded: names,
  }).requests.length, 0)

  /*
   * ПОДМЕНЁННАЯ ТОЧКА ПРИ НАСТОЯЩЕМ `place_id`. Сборщик кандидата инъектируем,
   * и граница не верит ему на слово: политика координат сверяет записываемую
   * пару с парой резолвера — той же функцией, что и приём.
   */
  const shifted = ({ row, identified }) => ({
    candidate: {
      sourceKey: row.sourceKey, sourceUrl: row.url, seedSource: 'japan-guide', licence: null,
      nameJa: '清水寺', nameEn: 'X', nameRu: 'Киёмидзу-дэра', siteCity: 'kyoto',
      lat: 35.5, lon: 139.5, descriptionJa: '', address: null,
      placeId: identified?.place?.placeId ?? null,
    },
    provenance: [
      { field: 'nameJa', source: 'officialSite', detail: 'x' },
      { field: 'nameEn', source: 'discovery', detail: 'x' },
      { field: 'nameRu', source: 'ownerNames', detail: 'x' },
      { field: 'siteCity', source: 'ownerNames', detail: 'x' },
      { field: 'coordinates', source: 'officialSite', detail: 'x' },
      ...(identified?.place?.placeId ? [{ field: 'placeId', source: 'placeLookup', detail: 'x' }] : []),
    ],
    placeNodes: 1,
  })
  const oneQueue = queuesOf([queueRow(keyOf(9), 'Shifted')])
  const oneEnrichment = enrichmentOf([enrichedRow(keyOf(9), 'Shifted', GOOD_NAMED(1))],
    { inputs: { queues: { digest: oneQueue.reportDigest } } })
  const oneIdent = identificationOf([identifiedRow(keyOf(9), { placeId: 'ChIJ-x9', lat: 34.99, lon: 135.78 })],
    { inputs: { enrichment: { digest: oneEnrichment.reportDigest } } })
  const shiftedRow = dry({
    queues: oneQueue, enrichment: oneEnrichment, identification: oneIdent,
    exportBytes: exportBytesOf([]), namesLoaded: names, assemble: shifted,
  }).rows[0]
  t('чужая точка при настоящем place_id — coordinateProvenance', shiftedRow.intake?.refusal, 'coordinateProvenance')
  has('  и сказано, чем именно она чужая', shiftedRow.intake.message, 'не совпадает с точкой резолвера')

  /*
   * ДЕДУП ВИДИТ ТОЛЬКО ТЕХ, КТО МОЖЕТ СТАТЬ ЗАПИСЬЮ.
   *
   * Две строки об одном объекте в одной точке: первую владелец не называл,
   * вторую назвал. Пока дедуп смотрел на все строки подряд, первая «занимала
   * место» и вторая объявлялась дублем — записью не становился НИ ОДИН, и
   * партия оставалась пустой без единого слова о том, почему.
   */
  const pairQueue = queuesOf([queueRow(keyOf(6), 'Pair'), queueRow(keyOf(7), 'Pair')])
  const pairEnrichment = enrichmentOf(
    [enrichedRow(keyOf(6), 'Pair', GOOD_NAMED(1)), enrichedRow(keyOf(7), 'Pair', GOOD_NAMED(1))],
    { inputs: { queues: { digest: pairQueue.reportDigest } } },
  )
  const pairIdent = identificationOf([
    identifiedRow(keyOf(6), { placeId: 'ChIJ-x6', lat: 34.99, lon: 135.78 }),
    identifiedRow(keyOf(7), { placeId: 'ChIJ-x7', lat: 34.99, lon: 135.78 }),
  ], { inputs: { enrichment: { digest: pairEnrichment.reportDigest } } })
  const pairNames = await ownerNames({ [keyOf(7)]: { nameRu: 'Названная из пары', siteCity: 'kyoto' } })
  const pair = Object.fromEntries(dry({
    queues: pairQueue, enrichment: pairEnrichment, identification: pairIdent,
    exportBytes: exportBytesOf([]), namesLoaded: pairNames,
  }).rows.map((row) => [row.sourceKey, row.outcome]))
  t('неназванная строка не становится дублем-хозяином', pair[keyOf(6)], 'intakeIncomplete')
  t('  и названная остаётся годной, а не «дублем»', pair[keyOf(7)], 'writable')

  /* Закрытый список отказов — не украшение: каждый из них воспроизведён выше
     либо назван структурным сторожем, и новый нельзя завести молча. */
  /*
   * КЛАССИФИКАЦИЯ, РАЗРЕШИВШАЯ СОЗДАНИЕ, ОБЯЗАНА ДОЕХАТЬ ДО ЗАПИСИ.
   *
   * Через конвейер сюда попадает только свежий вердикт, и он всегда
   * представим: терминального исхода `poi_eligible` без типа и маршрута в POI
   * не бывает. Поэтому предмет проверяется прямым вызовом границы — так же,
   * как это делает preflight коллектора для ОТЧЁТА, собранного под прошлой
   * версией реестра: коды в нём прошлые, а прогон идёт под нынешним.
   */
  const bareCandidate = {
    sourceKey: keyOf(20), sourceUrl: 'https://www.japan-guide.com/e/x20.html', seedSource: 'japan-guide',
    licence: null, nameJa: '清水寺', nameEn: 'X', nameRu: 'Киёмидзу-дэра', siteCity: 'kyoto',
    lat: 34.99, lon: 135.78, descriptionJa: '', address: null, placeId: 'ChIJ-x20',
  }
  const prepare = (classification) => prepareIntakeRequest({
    candidate: bareCandidate, row: queueRow(keyOf(20), 'X'), portal: PORTAL, today: TODAY, classification,
    identified: identifiedRow(keyOf(20), { placeId: 'ChIJ-x20', lat: 34.99, lon: 135.78 }),
  })
  const goodClass = { poiPrimaryType: 'buddhist_temple', facets: [], classificationSource: 'rule', taxonomyVersion }
  t('классификации нет вовсе — запись не собирается', prepare(null).refusal, 'taxonomyUnrepresentable')
  const stale = prepare({ ...goodClass, taxonomyVersion: 'poi-taxonomy/v1' })
  t('коды прошлой версии реестра — отказ', stale.refusal, 'taxonomyUnrepresentable')
  has('  и названа версия', stale.message, 'poi-taxonomy/v1')
  t('чужой код типа — отказ', prepare({ ...goodClass, poiPrimaryType: 'фиктивный_тип' }).refusal, 'taxonomyUnrepresentable')
  t('чужой фасет — отказ', prepare({ ...goodClass, facets: ['фиктивный_фасет'] }).refusal, 'taxonomyUnrepresentable')
  const goodPrepared = prepare(goodClass)
  t('годная классификация проходит', goodPrepared.ok, true)
  t('  и едет в запрос по существующему контракту',
    JSON.stringify(goodPrepared.request.poi.taxonomy),
    JSON.stringify({ poiPrimaryType: 'buddhist_temple', facets: [], classificationSource: 'rule', taxonomyVersion }))
  t('  старое поле категории переведено существующим мостом',
    goodPrepared.request.poi.categoriesRu.join(','), legacyAirtableCategory('buddhist_temple').value)

  /* И то же самое — на НАСТОЯЩЕМ пути: тип, который назвала оценка, доезжает
     до подготовленного запроса, а не теряется после допуска. */
  const realQueue = queuesOf([queueRow(keyOf(21), 'Kiyomizudera')])
  const realEnrichment = enrichmentOf([enrichedRow(keyOf(21), 'Kiyomizudera', GOOD_NAMED(0))],
    { inputs: { queues: { digest: realQueue.reportDigest } } })
  const realIdent = identificationOf([identifiedRow(keyOf(21), { placeId: 'ChIJ-x21', lat: 34.99, lon: 135.78 })],
    { inputs: { enrichment: { digest: realEnrichment.reportDigest } } })
  const realNames = await ownerNames({ [keyOf(21)]: { nameRu: 'Киёмидзу-дэра', siteCity: 'kyoto' } })
  const realRun = dry({
    queues: realQueue, enrichment: realEnrichment, identification: realIdent,
    exportBytes: exportBytesOf([]), namesLoaded: realNames,
  })
  t('на настоящем пути строка годна', realRun.rows[0].outcome, 'writable')
  const realTaxonomy = realRun.requests[0]?.poi?.taxonomy ?? null
  t('  и запрос несёт таксономию', realTaxonomy === null, false)
  t('  тип, названный оценкой, в запросе', realTaxonomy?.poiPrimaryType ?? 'таксономии нет', 'buddhist_temple')
  t('  с источником классификации', realTaxonomy?.classificationSource ?? 'таксономии нет', 'rule')
  t('  и версией нынешнего реестра', realTaxonomy?.taxonomyVersion ?? 'таксономии нет', taxonomyVersion)

  t('отказов ровно семь родов', RECORD_REFUSALS.join(','),
    'taxonomyUnrepresentable,canonBlocking,siteCityUnverifiable,cityConflict,missingPlaceId,coordinatesExpired,coordinateProvenance')
}

/* ── 10. JG3C-02: граф кода считается от ТОЧКИ ВХОДА JA-6 ──────────────────
   Граф строится обходом импортов от точки входа. Сухой прогон импортирует
   коллектор, а не наоборот, поэтому от точки входа коллектора его собственные
   файлы не видны вовсе — и правка логики подготовки запроса не меняла ни
   отпечатка, ни исхода контроля стабильности. */
{
  const repoRoot = fileURLToPath(new URL('..', import.meta.url))
  const PREPARE_FILE = 'scripts/poi-portals/lib/japan-guide-record.mjs'
  const jg = await readCodeGraph(JG_DRY_RUN_CODE_GRAPH_ENTRY, repoRoot)
  const collector = await readCodeGraph(CODE_GRAPH_ENTRY, repoRoot)
  const paths = (graph) => new Set(graph.files.map((file) => file.path))
  t('файл подготовки запроса входит в граф JA-6', paths(jg).has(PREPARE_FILE), true)
  t('  и сборка отчёта тоже', paths(jg).has('scripts/poi-portals/lib/japan-guide-dry-run.mjs'), true)
  t('  и сам CLI', paths(jg).has(JG_DRY_RUN_CODE_GRAPH_ENTRY), true)
  t('граф JA-6 — надмножество графа коллектора',
    [...paths(collector)].every((file) => paths(jg).has(file)), true)
  t('  и он строго больше', jg.files.length > collector.files.length, true)

  /*
   * ИЗОЛИРОВАННОЕ ДЕРЕВО. Файлы графа копируются во временный каталог ВНЕ
   * репозитория, и меняется там НАСТОЯЩИЙ файл подготовки — не фикстура рядом
   * с ним. Рабочее дерево при этом не трогается.
   */
  const isolated = await mkdtemp(path.join(tmpdir(), 'jg-graph-'))
  for (const file of jg.files) {
    const dest = path.join(isolated, file.path)
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, file.bytes)
  }
  await writeFile(path.join(isolated, 'package-lock.json'), await readFile(path.join(repoRoot, 'package-lock.json')))

  const before = await readCodeSnapshot({ repoRoot: isolated, entry: JG_DRY_RUN_CODE_GRAPH_ENTRY })
  /* Положительный контроль: неизменное дерево даёт тот же отпечаток и
     контроль стабильности не возражает. */
  const unchanged = await readCodeSnapshot({ repoRoot: isolated, entry: JG_DRY_RUN_CODE_GRAPH_ENTRY })
  t('неизменное дерево — тот же отпечаток графа', unchanged.graph.digest, before.graph.digest)
  t('  и контроль стабильности молчит', assertCodeSnapshotStable(before, unchanged).graph.digest, before.graph.digest)

  /* Правка настоящего файла подготовки — та же, что предъявил аудит: смысловое
     значение, а не пробел. */
  const prepareCopy = path.join(isolated, PREPARE_FILE)
  /* Файла в изолированном дереве нет ровно тогда, когда его нет в графе, —
     то есть когда точка входа снова чужая. Это именованный отказ, а не падение
     на чтении. */
  const original = paths(jg).has(PREPARE_FILE) ? await readFile(prepareCopy, 'utf8') : ''
  t('якорь правки в файле подготовки на месте', original.includes('machineNamed: false'), true)
  if (original) await writeFile(prepareCopy, original.replace('machineNamed: false', 'machineNamed: true'), 'utf8')
  const after = await readCodeSnapshot({ repoRoot: isolated, entry: JG_DRY_RUN_CODE_GRAPH_ENTRY })
  t('правка настоящего файла меняет отпечаток графа', after.graph.digest === before.graph.digest, false)
  t('  число файлов при этом прежнее', after.graph.files, before.graph.files)
  has('  и контроль стабильности отказывает', boom(() => assertCodeSnapshotStable(before, after)),
    'Файлы исполняемой цепочки изменились')
  has('  называя именно граф исполняемого кода', boom(() => assertCodeSnapshotStable(before, after)),
    'граф исполняемого кода')

  /* И монитор называет ту же ось: манифесты, различающиеся ТОЛЬКО снимком
     кода JA-6, дают `codeGraphDrift` общим сравнением. */
  const manifestOf = (snapshot) => buildRunManifest({
    startedAt: NOW,
    mode: 'read-only',
    code: { commit: 'a'.repeat(40), dirty: false, graph: snapshot.graph, deps: snapshot.deps },
    intakeContract: 'poi-intake/v1',
    registries: [registryValueIdentity({ id: 'poi-taxonomy', version: 'v1', value: { a: 1 }, entries: 1 })],
    matcherPolicy: { version: 'poi-matcher-policy/v4', digest: `sha256:${'1'.repeat(64)}`, lexiconDigest: `sha256:${'2'.repeat(64)}` },
    portals: [{
      portalId: 'japan-guide',
      adapter: { id: 'japan-guide-intake', version: 'japan-guide-intake/v1' },
      input: {
        rawPayload: { digest: `sha256:${'5'.repeat(64)}`, bytes: 1, spec: RAW_FILE_BYTES_SPEC },
        canonical: candidateSetIdentity({ candidates: [{ sourceKey: 'japan-guide:a' }], unkeyed: [] }),
      },
    }],
    base: { existing: null, snapshot: { file: 'airtable-export', digest: `sha256:${'6'.repeat(64)}`, bytes: 4, records: 1, withSourceKey: 1 } },
    names: null,
  })
  t('монитор называет ось изменения кода JA-6',
    compareRunManifests(manifestOf(after), manifestOf(before)).drift.map((entry) => entry.kind).join(','), 'codeGraphDrift')
  t('  и на неизменном снимке осей нет',
    compareRunManifests(manifestOf(before), manifestOf(before)).drift.length, 0)

  /* А от точки входа коллектора та же правка не видна — это и есть находка,
     которую закрывает параметр точки входа. */
  const collectorBefore = await readCodeSnapshot({ repoRoot: isolated, entry: CODE_GRAPH_ENTRY })
  if (original) await writeFile(prepareCopy, original.replace('machineNamed: false', 'machineNamed: null'), 'utf8')
  const collectorAfter = await readCodeSnapshot({ repoRoot: isolated, entry: CODE_GRAPH_ENTRY })
  t('от точки входа коллектора та же правка не видна вовсе',
    collectorAfter.graph.digest, collectorBefore.graph.digest)
  t('  потому что файла подготовки в его графе нет', paths(collector).has(PREPARE_FILE), false)
  await rm(isolated, { recursive: true, force: true })
}

/* Реальный JA-3 может не найти schema.org: проверенное японское имя
   приходит из редакторского файла, а не приписывается официальному парсеру. */
{
  const key = 'japan-guide:editorial-park'
  const q = queuesOf([queueRow(key, 'Koishikawa Botanical Garden')])
  const e = enrichmentOf([enrichedRow(key, 'Koishikawa Botanical Garden', [], 'noFacts')],
    { inputs: { queues: { digest: q.reportDigest } } })
  const id = identificationOf([identifiedRow(key, {
    placeId: 'test-editorial-park', lat: 35.71968, lon: 139.74428, prefecture: 'Tokyo',
  })], { inputs: { enrichment: { digest: e.reportDigest } } })
  const names = await ownerNames({ [key]: {
    nameRu: 'Ботанический сад Коисикава', nameJa: '小石川植物園', siteCity: 'tokyo',
  } })
  const result = runDryRun({ queues: q, enrichment: e, identification: id,
    exportBytes: exportBytesOf([]), portal: PORTAL, evaluate: evaluatePortalCandidates,
    namesLoaded: names, today: TODAY })
  t('проверенное японское имя закрывает noFacts без выдуманного обогащения', result.rows[0].outcome, 'writable')
  t('происхождение японского имени — файл имён', result.rows[0].provenance.find(m => m.field === 'nameJa')?.source, 'ownerNames')
  t('исход официального парсера не переписан', result.rows[0].enrichment, 'noFacts')
  t('японское имя классифицировано общим правилом', result.requests[0]?.poi.taxonomy.poiPrimaryType, 'park_garden')
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ JA-6 сухой прогон и JA-7 пробная партия: ${ok} проверок пройдено`)
}
