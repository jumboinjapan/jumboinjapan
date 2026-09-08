#!/usr/bin/env node
/**
 * JG‑1 «Очереди без сети»: снимок discovery Japan Guide → пакет границы адаптера
 * (JA‑1) → общая оценка → очереди с причинами (JA‑2). Полностью офлайн.
 *
 *   npm run poi:jg-queues -- --snapshot docs/poi-intake/baselines/japan-guide-jg1-2026-09-06.snapshot.json.gz --airtable docs/poi-intake/baselines/airtable-poi-jg1-fixture-2026-09-06.json --out tmp/jg-queues.json
 *
 * `--snapshot` — файл прогона коллектора (`portals[].discovery`) или сам снимок
 * `poi-discovery-snapshot/v3`, обычным JSON или сжатый gzip; `--airtable` — сохранённая выгрузка
 * `poi-airtable-export/v1`; `--out` обязателен: полные очереди пишутся только в
 * файл, stdout несёт сводку. Сеть 0, Google 0, модель 0, записей 0 — по
 * устройству: модуль не импортирует ни `fetch`, ни хранилище, ни резолвер,
 * ни границы записи.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDirectEntry } from '../lib/direct-entry.mjs'
import { getPortal } from './registry.mjs'
import { evaluatePortalIntakeBatch } from './collect-pois.mjs'
import { buildJapanGuideIntakeBatch, expectedInputFromSnapshot } from './lib/japan-guide-intake.mjs'
import { buildJapanGuideQueues, summarizeJapanGuideQueues } from './lib/japan-guide-queues.mjs'
import { assertDiscoverySnapshot } from './lib/discovery-contract.mjs'
import { readCanonicalGzip } from './lib/discovery-baseline.mjs'
import { describeThrownSafely } from '../../src/lib/thrown-value.ts'

export const JG_QUEUES_CLI_SPEC = 'poi-japan-guide-queues-cli/v1'

export function parseJgQueuesArgs(argv) {
  const args = { snapshot: null, airtable: null, out: null }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) throw new Error(`${a}: нужен аргумент`); i += 1; return v }
    if (a === '--snapshot') args.snapshot = next()
    else if (a === '--airtable') args.airtable = next()
    else if (a === '--out') args.out = next()
    else throw new Error(`Неизвестный аргумент: ${a}`)
  }
  if (!args.snapshot || !args.airtable || !args.out) throw new Error('Нужны --snapshot <файл>, --airtable <выгрузка> и --out <отчёт>')
  return args
}

/**
 * Байты файла снимка → текст. Фикстура JG‑1 лежит в репозитории сжатой, полный
 * прогон коллектора — обычным JSON: род распознаётся по магии gzip (`1f 8b`),
 * а не по имени файла, и распаковка идёт под тем же потолком, что у baseline.
 */
export function snapshotTextFrom(bytes) {
  const gzip = bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b
  return (gzip ? readCanonicalGzip(bytes) : bytes).toString('utf8')
}

/** Снимок из файла прогона (`portals[].discovery` портала japan-guide) или из голого снимка. */
export function snapshotFromDocument(doc) {
  if (doc && Array.isArray(doc.portals)) {
    const portal = doc.portals.find((p) => p?.portalId === 'japan-guide' && p?.discovery)
    if (!portal) throw new Error('в файле прогона нет discovery портала japan-guide')
    return portal.discovery
  }
  return doc
}

export async function runJgQueuesCli(argv = process.argv, deps = {}, target = process) {
  const now = deps.now ?? (() => new Date())
  try {
    const args = parseJgQueuesArgs(argv)
    const portal = getPortal('japan-guide')
    const snapshot = snapshotFromDocument(JSON.parse(snapshotTextFrom(await readFile(path.resolve(args.snapshot)))))
    assertDiscoverySnapshot(snapshot)
    const exportBytes = await readFile(path.resolve(args.airtable))
    const batch = buildJapanGuideIntakeBatch(snapshot, portal)
    const intake = evaluatePortalIntakeBatch(portal, batch, expectedInputFromSnapshot(snapshot))
    const report = buildJapanGuideQueues({ snapshot, portal, intake, exportBytes, createdAt: now().toISOString() })
    await writeFile(path.resolve(args.out), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(summarizeJapanGuideQueues(report))
    console.log(`полный отчёт: ${path.resolve(args.out)}`)
    target.exitCode = 0
    return target.exitCode
  } catch (thrown) {
    target.exitCode = 1
    try { console.error(`[poi-jg-queues] ${describeThrownSafely(thrown)}`) } catch { /* код уже выставлен */ }
    return target.exitCode
  }
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  await runJgQueuesCli()
}
