#!/usr/bin/env node
/**
 * JA-6 «Сквозной сухой прогон»: Japan Guide → Intake, ноль эффектов.
 *
 *   npm run poi:jg-dry-run -- --queues tmp/jg-queues.json --enrichment tmp/jg-enrich.json \
 *     --identification tmp/jg-identify.json --airtable <снимок базы> --out tmp/jg-dry-run.json \
 *     --names docs/poi-intake/japan-guide-names.json [--monitor <прежний отчёт>]
 *
 * Манифест прогона и pre-write gate собираются ТЕМИ ЖЕ функциями, что у живого
 * коллектора (`buildRunManifest`, `preWriteGate`): сухой прогон, у которого свой
 * манифест, доказывал бы исправность своего манифеста.
 *
 * `--monitor` — ось дрейфа: прежний отчёт сухого прогона. Совпали входы, база,
 * политика матчера, реестры и код — `PASS`; разошлось что-нибудь — `BLOCK` с
 * перечислением осей. Без `--monitor` gate объявляет себя невзведённым, и это
 * состояние, а не умолчание.
 *
 * Записи нет ни в каком режиме: режим прогона объявлен `read-only`, Airtable не
 * открывается, Google и модель не вызываются. Разрешение на запись этот файл не
 * умеет исполнять — оно исполняется писателем, и только после решения владельца
 * на конкретную партию.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDirectEntry } from '../lib/direct-entry.mjs'
import { getPortal } from './registry.mjs'
import {
  assertCodeSnapshotStable, collectRegistryIdentities, evaluatePortalCandidates, readCodeSnapshot,
  resolveCodeIdentityFromGit,
} from './collect-pois.mjs'
import { assertRunManifest, buildRunManifest, candidateSetIdentity, compareRunManifests, preWriteGate } from './lib/run-manifest.mjs'
import { RAW_FILE_BYTES_SPEC, sha256Bytes } from '../lib/byte-digest.mjs'
import { JAPAN_GUIDE_INTAKE_VERSION } from './lib/japan-guide-intake.mjs'
import { matcherLexiconDigest, MATCHER_POLICY_VERSION, matcherPolicyDigest } from './lib/dedupe.mjs'
import { buildDryRunReport, runDryRun, summarizeDryRun } from './lib/japan-guide-dry-run.mjs'
import { loadNames } from './lib/names-file.mjs'
import { POI_INTAKE_CONTRACT_VERSION } from '../../src/lib/poi-ingest.ts'
import { describeThrownSafely } from '../../src/lib/thrown-value.ts'

export const JG_DRY_RUN_CLI_SPEC = 'poi-japan-guide-dry-run-cli/v1'

/**
 * ТОЧКА ВХОДА ГРАФА КОДА ДЛЯ JA-6 — ЭТОТ ФАЙЛ, а не коллектор.
 *
 * Граф строится обходом импортов от точки входа. Сухой прогон импортирует
 * коллектор, а не наоборот, поэтому от точки входа коллектора его собственные
 * файлы — этот CLI, `japan-guide-dry-run.mjs`, `japan-guide-record.mjs` — не
 * видны вовсе: правка логики подготовки запроса не меняла ни отпечатка графа,
 * ни исхода контроля стабильности, ни осей монитора (аудит JG3C, находка 02).
 * Отсюда граф JA-6 — надмножество графа коллектора.
 */
export const JG_DRY_RUN_CODE_GRAPH_ENTRY = 'scripts/poi-portals/dry-run-japan-guide.mjs'

export function parseDryRunArgs(argv) {
  const args = { queues: null, enrichment: null, identification: null, airtable: null, out: null, monitor: null, names: null }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a}: нужен аргумент`)
      i += 1
      return v
    }
    if (a === '--queues') args.queues = next()
    else if (a === '--enrichment') args.enrichment = next()
    else if (a === '--identification') args.identification = next()
    else if (a === '--airtable') args.airtable = next()
    else if (a === '--out') args.out = next()
    else if (a === '--monitor') args.monitor = next()
    else if (a === '--names') args.names = next()
    else throw new Error(`Неизвестный аргумент: ${a}`)
  }
  if (!args.queues || !args.enrichment || !args.airtable || !args.out) {
    throw new Error('Нужны --queues <отчёт JG-1>, --enrichment <отчёт JA-3>, --airtable <снимок базы> и --out <отчёт>')
  }
  return args
}

/** Манифест прогона — из тех же тождеств, что собирает живой коллектор. */
export async function buildDryRunManifest({ startedAt, portal, queuesBytes, exportBytes, result, snapshotBefore = null, deps = {} }) {
  /* ДВА СНИМКА КОДА, как у живого коллектора: файлы цепочки, изменившиеся ПОКА
     ШЁЛ ПРОГОН, делают неизвестным, какой код отработал. Проверка та же
     (`assertCodeSnapshotStable`), своей редакции здесь нет. */
  const code = deps.code ?? {
    ...resolveCodeIdentityFromGit(),
    ...assertCodeSnapshotStable(snapshotBefore, await readCodeSnapshot({ entry: JG_DRY_RUN_CODE_GRAPH_ENTRY })),
  }
  return buildRunManifest({
    startedAt,
    /* Режим объявлен честно: прогон только читает файлы. Живой режим тут
       недостижим — писателя в этом файле нет. */
    mode: 'read-only',
    code,
    intakeContract: POI_INTAKE_CONTRACT_VERSION,
    registries: collectRegistryIdentities(),
    matcherPolicy: { version: MATCHER_POLICY_VERSION, digest: matcherPolicyDigest(), lexiconDigest: matcherLexiconDigest() },
    portals: [{
      portalId: portal.id,
      adapter: { id: 'japan-guide-intake', version: JAPAN_GUIDE_INTAKE_VERSION },
      input: {
        /* Сырой вход — байты отчёта очередей; канонический — сам набор
           кандидатов, по которому прогон принимал решения. */
        rawPayload: { digest: sha256Bytes(queuesBytes), bytes: queuesBytes.length, spec: RAW_FILE_BYTES_SPEC },
        canonical: candidateSetIdentity({ candidates: result.candidates, unkeyed: [] }),
      },
    }],
    base: {
      existing: null,
      snapshot: {
        file: 'airtable-export',
        digest: sha256Bytes(exportBytes),
        bytes: exportBytes.length,
        records: result.airtableRecords,
        withSourceKey: result.airtableWithSourceKey,
      },
    },
    names: null,
  })
}

export async function runDryRunCli(argv = process.argv, deps = {}, target = process) {
  const now = deps.now ?? (() => new Date())
  try {
    const args = parseDryRunArgs(argv)
    const portal = getPortal('japan-guide')
    const queuesBytes = await readFile(path.resolve(args.queues))
    const exportBytes = await readFile(path.resolve(args.airtable))
    const queues = JSON.parse(queuesBytes.toString('utf8'))
    const enrichment = JSON.parse(await readFile(path.resolve(args.enrichment), 'utf8'))
    const identification = args.identification
      ? JSON.parse(await readFile(path.resolve(args.identification), 'utf8'))
      : null
    /* Сухой прогон опознания (`mode: dry`) отчётом опознания не является: строк
       в нём нет, и подмешивать его сюда значило бы объявить выполненным то,
       чего не было. */
    const identificationReport = identification && identification.mode === 'dry' ? null : identification

    /* Проверенные имена владельца читаются РОВНО ОДИН РАЗ и здесь же
       подписываются — тем же загрузчиком, что у живого коллектора. Без файла
       имён ни одна строка не станет записью, и прогон это честно покажет
       исходом `intakeIncomplete`, а не пустым русским именем в кандидате. */
    const namesLoaded = args.names ? await loadNames(path.resolve(args.names)) : null

    const snapshotBefore = deps.code ? null : await readCodeSnapshot({ entry: JG_DRY_RUN_CODE_GRAPH_ENTRY })
    const startedAt = now().toISOString()
    const result = runDryRun({
      queues, enrichment, identification: identificationReport, exportBytes, portal,
      evaluate: deps.evaluate ?? evaluatePortalCandidates,
      namesLoaded,
      /* Календарный день прогона — из его же начала: срок годности координат
         опознания судится по нему, а не по часам внутри функции. */
      today: startedAt.slice(0, 10),
    })
    const manifest = await buildDryRunManifest({ startedAt, portal, queuesBytes, exportBytes, result, snapshotBefore, deps })

    let reference = null
    let referenceError = null
    if (args.monitor) {
      try {
        reference = JSON.parse(await readFile(path.resolve(args.monitor), 'utf8'))
      } catch (thrown) {
        referenceError = describeThrownSafely(thrown)
      }
    }
    const gate = preWriteGate({ manifest, mode: 'read-only', reference, referenceError })

    const report = buildDryRunReport({
      result, queues, enrichment, identification: identificationReport,
      manifest, gate, createdAt: startedAt, portal,
    })
    await writeFile(path.resolve(args.out), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(summarizeDryRun(report))
    if (args.monitor) {
      const drift = driftAgainst(reference, manifest, report)
      console.log(drift.length ? `дрейф относительно эталона: ${drift.join(', ')}` : 'дрейфа относительно эталона нет')
    }
    console.log(`полный отчёт: ${path.resolve(args.out)}`)
    target.exitCode = 0
    return target.exitCode
  } catch (thrown) {
    target.exitCode = 1
    try { console.error(`[poi-jg-dry-run] ${describeThrownSafely(thrown)}`) } catch { /* код уже выставлен */ }
    return target.exitCode
  }
}

/**
 * ОСЬ ДРЕЙФА ДЛЯ ЧЕЛОВЕКА — ЧЕРЕЗ ОБЩЕЕ СРАВНЕНИЕ, А НЕ ЧЕРЕЗ СВОЁ.
 *
 * `preWriteGate` в режиме `read-only` НЕ ВЗВОДИТСЯ по устройству — записи нет,
 * и объявлять его взведённым нельзя. Но человеку сравнение нужно именно здесь:
 * план JA-6 требует, чтобы изменение источника, снимка базы, правил или кода
 * было видно отдельной осью.
 *
 * Аудит JG-3 (находка 03) предъявил, чем кончается своя редакция сравнения:
 * она смотрела на `code.codeGraph.value` и `input.digest`, которых в
 * `run-manifest/v2` нет вовсе — там `code.graph.digest` и
 * `input.rawPayload.digest` / `input.canonical.digest`, — и молча возвращала
 * пустой список при любом изменении кода и входа. Поэтому сравнение делает
 * `compareRunManifests`: тот же код, что у живого гейта, и те же оси.
 *
 * Сверх манифеста сравниваются ЗНАЧИМЫЕ ВХОДЫ отчёта — отпечатки JG-1, JA-3 и
 * JA-4: они не входят в манифест, а решения принимаются по ним.
 */
export function driftAgainst(reference, manifest, report = null) {
  if (!reference) return ['эталон не прочитан']
  const previous = reference.manifest ?? null
  if (!previous) return ['эталон снят до появления манифеста']
  let referenceManifest
  try {
    referenceManifest = assertRunManifest(previous)
  } catch (error) {
    return [`манифест эталона не принят: ${error.message}`]
  }
  const { drift } = compareRunManifests(manifest, referenceManifest)
  const axes = drift.map((entry) => entry.kind)
  const compare = (name, before, after) => { if (before !== after) axes.push(name) }
  if (report) {
    compare('входы: очереди JG-1', reference.inputs?.queues?.digest, report.inputs.queues.digest)
    compare('входы: обогащение JA-3', reference.inputs?.enrichment?.digest, report.inputs.enrichment.digest)
    compare('входы: опознание JA-4', reference.inputs?.identification?.digest ?? null, report.inputs.identification?.digest ?? null)
  }
  return axes
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  await runDryRunCli()
}
