#!/usr/bin/env node
/**
 * JA-7 «Пробная партия»: из отчёта сухого прогона — не более пяти строк и
 * черновик разрешения на них.
 *
 *   npm run poi:jg-batch -- --dry-run tmp/jg-dry-run.json --scope <область> --out tmp/jg-batch.json
 *
 * Ничего не пишет и ничего не разрешает: производит ЧЕРНОВИК, который владелец
 * либо превращает в разрешение, либо нет. Airtable не открывается.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDirectEntry } from '../lib/direct-entry.mjs'
import { BATCH_LIMITS, buildBatchReport, selectBatch, summarizeBatch } from './lib/japan-guide-batch.mjs'
import { sha256Bytes } from '../lib/byte-digest.mjs'
import { describeThrownSafely } from '../../src/lib/thrown-value.ts'

export const JG_BATCH_CLI_SPEC = 'poi-japan-guide-batch-cli/v1'

export function parseBatchArgs(argv) {
  const args = { dryRun: null, out: null, scope: null, limit: BATCH_LIMITS.maxCreates, note: null }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a}: нужен аргумент`)
      i += 1
      return v
    }
    if (a === '--dry-run') args.dryRun = next()
    else if (a === '--out') args.out = next()
    else if (a === '--scope') args.scope = next()
    else if (a === '--note') args.note = next()
    else if (a === '--limit') {
      const n = Number(next())
      if (!Number.isSafeInteger(n) || n < 0 || n > BATCH_LIMITS.maxCreates) {
        throw new Error(`--limit: ожидается целое 0…${BATCH_LIMITS.maxCreates}`)
      }
      args.limit = n
    } else throw new Error(`Неизвестный аргумент: ${a}`)
  }
  if (!args.dryRun || !args.out || !args.scope) throw new Error('Нужны --dry-run <отчёт JA-6>, --scope <область> и --out <файл партии>')
  return args
}

export async function runBatchCli(argv = process.argv, deps = {}, target = process) {
  const now = deps.now ?? (() => new Date())
  try {
    const args = parseBatchArgs(argv)
    /* Файл читается БАЙТАМИ: его отпечаток — то самое значение, которое
       писатель сверит с `referenceDigest` разрешения (аудит JG-3, находка 02). */
    const bytes = await readFile(path.resolve(args.dryRun))
    const referenceFileDigest = sha256Bytes(bytes)
    const report = JSON.parse(bytes.toString('utf8'))
    const selection = selectBatch(report, { limit: args.limit })
    const batch = buildBatchReport({
      selection, report, scopeId: args.scope, portal: 'japan-guide', referenceFileDigest,
      note: args.note ?? 'Пробная партия JA-7 для независимого аудита; разрешение владельцем не выдано.',
      createdAt: now().toISOString(),
    })
    await writeFile(path.resolve(args.out), `${JSON.stringify(batch, null, 2)}\n`, 'utf8')
    console.log(summarizeBatch(batch))
    console.log(`партия: ${path.resolve(args.out)}`)
    target.exitCode = 0
    return target.exitCode
  } catch (thrown) {
    target.exitCode = 1
    try { console.error(`[poi-jg-batch] ${describeThrownSafely(thrown)}`) } catch { /* код уже выставлен */ }
    return target.exitCode
  }
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  await runBatchCli()
}
