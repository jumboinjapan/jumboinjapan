#!/usr/bin/env node
/**
 * JA-4 «Ограниченное опознание» и JA-5 «Решения владельца».
 *
 *   npm run poi:jg-identify -- --queues tmp/jg-queues.json --enrichment tmp/jg-enrich.json \
 *     --out tmp/jg-identify.json --decisions tmp/jg-decisions.json
 *
 * БЕЗ `--live` GOOGLE НЕ ВЫЗЫВАЕТСЯ ВОВСЕ. Сухой прогон говорит, сколько
 * вызовов понадобится и во что они обойдутся по объявленному тарифу, и на этом
 * останавливается. Артефакт решений (JA-5) собирается в обоих режимах: он
 * ничего не стоит и никуда не ходит.
 *
 * С `--live` обязателен `--price-micros`: действующий тариф объявляет человек
 * перед запуском (план JA-4), а не код по памяти. Потолок вызовов — `--limit`,
 * не больше 20 по решению владельца 3.2; ключ берётся из окружения
 * (`GOOGLE_PLACES_API_KEY`) и в отчёт не попадает.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDirectEntry } from '../lib/direct-entry.mjs'
import { resolvePlace } from '../../src/lib/place-resolve.ts'
import {
  buildIdentificationReport, identificationQueueFrom, MAX_DIAGNOSTIC_CALLS,
  runIdentification, summarizeIdentification,
} from './lib/place-identification.mjs'
import { collectOwnerDecisions, summarizeOwnerDecisions } from './lib/owner-decisions.mjs'
import { assertReportDigest } from './lib/enrichment.mjs'
import { describeThrownSafely } from '../../src/lib/thrown-value.ts'

export const JG_IDENTIFY_CLI_SPEC = 'poi-japan-guide-identify-cli/v1'

export function parseIdentifyArgs(argv) {
  const args = { queues: null, enrichment: null, out: null, decisions: null, limit: MAX_DIAGNOSTIC_CALLS, priceMicros: null, live: false }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a}: нужен аргумент`)
      i += 1
      return v
    }
    const whole = (raw, name) => {
      const n = Number(raw)
      if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name}: ожидается целое не меньше нуля, получено ${JSON.stringify(raw)}`)
      return n
    }
    if (a === '--queues') args.queues = next()
    else if (a === '--enrichment') args.enrichment = next()
    else if (a === '--out') args.out = next()
    else if (a === '--decisions') args.decisions = next()
    else if (a === '--limit') args.limit = whole(next(), '--limit')
    else if (a === '--price-micros') args.priceMicros = whole(next(), '--price-micros')
    else if (a === '--live') args.live = true
    else throw new Error(`Неизвестный аргумент: ${a}`)
  }
  if (!args.queues || !args.enrichment || !args.out || !args.decisions) {
    throw new Error('Нужны --queues <отчёт JG-1>, --enrichment <отчёт JA-3>, --out <отчёт JA-4> и --decisions <файл JA-5>')
  }
  if (args.limit > MAX_DIAGNOSTIC_CALLS) throw new Error(`--limit: ${args.limit} превышает разрешённые ${MAX_DIAGNOSTIC_CALLS}`)
  if (args.live && args.priceMicros === null) {
    throw new Error('--price-micros обязателен при --live: действующий тариф объявляет человек перед запуском, код его не помнит')
  }
  return args
}

export async function runIdentifyCli(argv = process.argv, deps = {}, target = process, env = process.env) {
  const now = deps.now ?? (() => new Date())
  try {
    const args = parseIdentifyArgs(argv)
    const queues = JSON.parse(await readFile(path.resolve(args.queues), 'utf8'))
    const enrichment = JSON.parse(await readFile(path.resolve(args.enrichment), 'utf8'))
    /*
     * ВЕСЬ ВХОД ПРОВЕРЯЕТСЯ ДО ПЕРВОГО ПЛАТНОГО ОБРАЩЕНИЯ (аудит JG-2, 04).
     *
     * Проверка версии — не проверка: аудит подменил в копии отчёта ключи, имена
     * и состав строк, оставив прежний отпечаток, и платный путь пошёл искать
     * выдуманный объект. Поэтому оба отпечатка пересчитываются, а состав
     * очереди сверяется с очередью `candidate` отчёта JG-1: строка, которой там
     * нет, до Google не доходит.
     */
    assertReportDigest(queues, 'poi-japan-guide-queues/v1', '--queues')
    assertReportDigest(enrichment, 'poi-enrichment/v1', '--enrichment')
    const candidates = new Set((queues.queues?.candidate ?? []).map((row) => row.sourceKey))
    if (!candidates.size) throw new Error('--queues: в отчёте JG-1 нет очереди candidate — обогащать и опознавать нечего')
    const foreign = enrichment.rows.filter((row) => !candidates.has(row.sourceKey)).map((row) => row.sourceKey)
    if (foreign.length) {
      throw new Error(`--enrichment: ${foreign.length} строк не принадлежат очереди candidate отчёта JG-1 (первая: ${foreign[0]})`)
    }
    if (enrichment.inputs?.queues?.digest && enrichment.inputs.queues.digest !== queues.reportDigest) {
      throw new Error(`--enrichment: собран по очередям ${enrichment.inputs.queues.digest}, подан отчёт ${queues.reportDigest}`)
    }
    const queue = identificationQueueFrom(enrichment)

    let identification = null
    if (!args.live) {
      identification = {
        spec: JG_IDENTIFY_CLI_SPEC, createdAt: now().toISOString(), mode: 'dry',
        plan: {
          queue: queue.length,
          withJapaneseName: queue.filter((row) => row.nameJa).length,
          withLocationBias: queue.filter((row) => row.locationBias).length,
          callsAtMost: Math.min(queue.length, args.limit),
          limit: args.limit,
          ceiling: MAX_DIAGNOSTIC_CALLS,
          ceilingCostMicros: args.priceMicros === null ? null : Math.min(queue.length, args.limit) * args.priceMicros,
        },
        rows: [],
        effects: { google: 0, post: 0, patch: 0, delete: 0 },
      }
    } else {
      const apiKey = (env.GOOGLE_PLACES_API_KEY ?? '').trim()
      if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY не задан — опознавать нечем, и выдумывать координаты запрещено')
      const resolve = deps.resolve ?? ((query) => resolvePlace(query, { apiKey }))
      const result = await runIdentification({ queue, limit: args.limit, resolve, now })
      identification = buildIdentificationReport({
        queue, result, limit: args.limit, priceMicros: args.priceMicros, createdAt: now().toISOString(),
        inputs: {
          enrichment: { digest: enrichment.reportDigest ?? null, rows: enrichment.rows.length },
          queues: { digest: queues.reportDigest ?? null },
        },
      })
    }
    await writeFile(path.resolve(args.out), `${JSON.stringify(identification, null, 2)}\n`, 'utf8')

    const decisions = collectOwnerDecisions({
      queues, enrichment,
      identification: identification.mode === 'dry' ? null : identification,
      createdAt: now().toISOString(),
    })
    await writeFile(path.resolve(args.decisions), `${JSON.stringify(decisions, null, 2)}\n`, 'utf8')

    if (identification.mode === 'dry') {
      console.log(`СУХОЙ ПРОГОН JA-4 — Google 0. Очередь ${identification.plan.queue}, с японским именем ${identification.plan.withJapaneseName}, с предпочтением точки ${identification.plan.withLocationBias}.`)
      console.log(`С --live будет сделано не больше ${identification.plan.callsAtMost} вызовов (потолок решения владельца ${MAX_DIAGNOSTIC_CALLS}).`)
    } else {
      console.log(summarizeIdentification(identification))
    }
    console.log(summarizeOwnerDecisions(decisions))
    console.log(`отчёт JA-4: ${path.resolve(args.out)}`)
    console.log(`решения JA-5: ${path.resolve(args.decisions)}`)
    target.exitCode = 0
    return target.exitCode
  } catch (thrown) {
    target.exitCode = 1
    try { console.error(`[poi-jg-identify] ${describeThrownSafely(thrown)}`) } catch { /* код уже выставлен */ }
    return target.exitCode
  }
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  await runIdentifyCli()
}
