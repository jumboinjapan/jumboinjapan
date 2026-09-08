#!/usr/bin/env node
/**
 * JA-3 «Бесплатное обогащение»: очередь `candidate` JG-1 → структурные факты с
 * официальных сайтов объектов.
 *
 *   npm run poi:jg-enrich -- --snapshot tmp/japan-guide-discovery-2026-09-06.json \
 *     --queues tmp/jg-queues-r2-2026-09-08.json --out tmp/jg-enrich.json
 *
 * БЕЗ `--live` СЕТИ НЕТ ВОВСЕ. Прогон по умолчанию — СУХОЙ: он строит очередь,
 * считает домены и говорит, сколько запросов понадобится. Ноль обращений к
 * чужим сайтам — и это состояние по умолчанию, а не флаг осторожности.
 *
 * С `--live` разрешается ровно то, что разрешил владелец: `--limit` объектов
 * (по умолчанию 25), столько же robots.txt и столько же страниц, не больше
 * `--per-domain` страниц с одного сайта. Бюджет спрашивают ДО запроса;
 * исчерпание останавливает прогон и называет остаток.
 *
 * ЧТО БЕРЁТСЯ. Только структурные данные `schema.org`: адрес, индекс, японское
 * имя и чтение, координаты, официальный адрес. Проза чужих сайтов не берётся
 * (`official-page.mjs`), и полем карточки ни один факт здесь не становится:
 * записи в этом пути нет — ни Airtable, ни Google, ни модели.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDirectEntry } from '../lib/direct-entry.mjs'
import { assertDiscoverySnapshot } from './lib/discovery-contract.mjs'
import { readCanonicalGzip } from './lib/discovery-baseline.mjs'
import { EXCHANGE_DEADLINE_MS, withResponseDeadline } from './lib/network-boundary.mjs'
import { FetchBoundaryError, FETCH_LIMITS, readBoundedBody, USER_AGENT } from './lib/html-fetch.mjs'
import { NetworkBoundaryError } from './lib/network-boundary.mjs'
import { PARSE_LIMITS } from './lib/official-page.mjs'
import { openEnrichmentBudget, policyOrigin } from './lib/source-policy.mjs'
import {
  assertReportDigest, buildEnrichmentReport, enrichmentQueueFrom, runEnrichment, summarizeEnrichment,
} from './lib/enrichment.mjs'
import { describeThrownSafely } from '../../src/lib/thrown-value.ts'

export const JG_ENRICH_CLI_SPEC = 'poi-japan-guide-enrich-cli/v1'
/** Потолок по умолчанию — разрешение владельца от 08.09.2026: первая партия 25. */
export const DEFAULT_OBJECT_LIMIT = 25
/** Кодировки, которые мы умеем читать. Незнакомая — не догадка, а отказ. */
export const DECODABLE_CHARSETS = Object.freeze(['utf-8', 'utf8', 'shift_jis', 'shift-jis', 'sjis', 'windows-31j', 'euc-jp', 'iso-8859-1', 'ascii', 'us-ascii'])

export function parseEnrichArgs(argv) {
  const args = { snapshot: null, queues: null, out: null, limit: DEFAULT_OBJECT_LIMIT, perDomain: 3, live: false }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a}: нужен аргумент`)
      i += 1
      return v
    }
    const positive = (raw, name) => {
      const n = Number(raw)
      if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name}: ожидается целое не меньше нуля, получено ${JSON.stringify(raw)}`)
      return n
    }
    if (a === '--snapshot') args.snapshot = next()
    else if (a === '--queues') args.queues = next()
    else if (a === '--out') args.out = next()
    else if (a === '--limit') args.limit = positive(next(), '--limit')
    else if (a === '--per-domain') args.perDomain = positive(next(), '--per-domain')
    else if (a === '--live') args.live = true
    else throw new Error(`Неизвестный аргумент: ${a}`)
  }
  if (!args.snapshot || !args.queues || !args.out) throw new Error('Нужны --snapshot <снимок>, --queues <отчёт JG-1> и --out <отчёт>')
  return args
}

/** Байты файла снимка → текст: gzip распознаётся по магии, а не по имени. */
export function snapshotTextFrom(bytes) {
  const gzip = bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b
  return (gzip ? readCanonicalGzip(bytes) : bytes).toString('utf8')
}

export function snapshotFromDocument(doc) {
  if (doc && Array.isArray(doc.portals)) {
    const portal = doc.portals.find((p) => p?.portalId === 'japan-guide' && p?.discovery)
    if (!portal) throw new Error('в файле прогона нет discovery портала japan-guide')
    return portal.discovery
  }
  return doc
}

/** Кодировка из заголовка. Незнакомая — отказ, а не «попробуем utf-8». */
export function charsetOf(contentType) {
  if (typeof contentType !== 'string') return { ok: true, charset: 'utf-8' }
  const match = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType)
  if (!match) return { ok: true, charset: 'utf-8' }
  const charset = match[1].toLowerCase()
  if (!DECODABLE_CHARSETS.includes(charset)) return { ok: false, charset }
  return { ok: true, charset }
}

/**
 * ТЕМП ОБРАЩЕНИЙ — СВОЙ, А НЕ ЗАИМСТВОВАННЫЙ У ОБХОДА ПОРТАЛА.
 *
 * `createRequestPacer` из `html-fetch` держит ещё и уникальность адресов и
 * общий бюджет обмена одного обхода: два объекта с одной и той же официальной
 * страницей были бы для него «повторным запросом» и остановили бы прогон. Здесь
 * нужен ровно интервал между обращениями к чужим сайтам — и ничего сверх.
 */
export function createEnrichmentPacer({ intervalMs = FETCH_LIMITS.requestIntervalMs, sleep = null, clock = () => Date.now() } = {}) {
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  let previousAt = null
  return {
    async beforeRequest() {
      const now = clock()
      if (previousAt !== null) {
        const elapsed = now - previousAt
        if (elapsed < intervalMs) await wait(intervalMs - elapsed)
      }
      previousAt = clock()
    },
  }
}

/**
 * СЕТЕВОЙ ЛИ ЭТО ОТКАЗ.
 *
 * Различение существенное, а не косметическое. Первый живой прогон 08.09.2026
 * вызвал у темпо-ограничителя метод, которого у того нет; `TypeError` попал в
 * тот же `catch`, что и обрыв связи, и двенадцать сайтов получили запись «сайт
 * промолчал». То есть СОБСТВЕННЫЙ ДЕФЕКТ был записан как измерение чужого
 * сайта — худший вид тихого отказа. Поэтому наверх уходит всё, что не является
 * названным отказом сети: пусть прогон падает, чем врёт.
 */
export function isNetworkFailure(thrown) {
  if (thrown instanceof NetworkBoundaryError || thrown instanceof FetchBoundaryError) return true
  if (!thrown || typeof thrown !== 'object') return false
  if (thrown.name === 'AbortError' || thrown.name === 'TimeoutError') return true
  const cause = thrown.cause
  return typeof cause?.code === 'string'
}

/**
 * ПОХОЖИ ЛИ БАЙТЫ НА `robots.txt`.
 *
 * Аудит JG-2 (находка 02) предъявил сайт, отвечающий на `/robots.txt` кодом 200
 * и страницей «Access denied» в HTML. Разбор правил не находил в ней ни одной
 * директивы, пустой набор правил означал «ничего не запрещено», домен получал
 * `allowed` — и обход начинался ровно там, где сайт отказал. Пустой набор
 * правил законен только у НАСТОЯЩЕГО robots.txt; страница-заглушка им не
 * является, и отличить одно от другого обязана эта проверка, а не парсер.
 *
 * Признаётся: `text/plain` (или отсутствующий тип), корректный UTF-8, отсутствие
 * разметки и хотя бы формальное соответствие строк формату RFC 9309 — пустая
 * строка, комментарий либо `поле: значение`. Настоящий пустой файл проходит.
 */
export function looksLikeRobots(bytes, contentType) {
  const type = typeof contentType === 'string' ? contentType.split(';')[0].trim().toLowerCase() : ''
  if (type && type !== 'text/plain') return { ok: false, why: `тип ${type} — это не robots.txt` }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, why: 'тело не декодируется как UTF-8' }
  }
  if (/<\s*(!doctype|html|head|body|script|div|title)\b/i.test(text)) {
    return { ok: false, why: 'в теле разметка — это страница, а не robots.txt' }
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (!/^[A-Za-z-]+\s*:/.test(line)) return { ok: false, why: `строка «${line.slice(0, 40)}» не является директивой` }
  }
  return { ok: true, text }
}

/**
 * ЖИВАЯ СЕТЬ — ТОЛЬКО ЗДЕСЬ, И ТОЛЬКО ЧТЕНИЕ.
 *
 * Дедлайн один на обмен, темп свой, тело ограничено, заголовок называет наш
 * product token и контакт. Метод только GET: другого в этом файле нет.
 *
 * ПЕРЕХОДА ПО РЕДИРЕКТУ НЕТ ВОВСЕ — `redirect: 'manual'`.
 *
 * Прежняя редакция шла по редиректу сама и сверяла домен ПОСЛЕ перехода. Аудит
 * JG-2 (находка 01) предъявил, чем это кончается: `robots.txt` запрещает
 * `/private`, разрешённый `/allowed` отвечает 302 на `/private`, и запрещённая
 * страница оказывается прочитанной. Бюджет при этом считает один запрос вместо
 * двух, потому что второй сделал не он.
 *
 * Переход по редиректу — это НОВЫЙ запрос к НОВОМУ пути: у него своя проверка
 * policy и свой расход бюджета. Делать его внутри чужой проверки нельзя, а
 * делать снаружи — значит усложнять границу ради страницы, которую сайт всё
 * равно решил показать не там. Поэтому 3xx — именованный отказ, и обхода не
 * происходит.
 */
export function liveIo({ fetchImpl = globalThis.fetch, pacer }) {
  const get = async (url, maxBytes) => {
    await pacer.beforeRequest()
    return withResponseDeadline(fetchImpl, url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
    }, async (response, signal) => {
      const status = response.status
      if (status >= 300 && status < 400) {
        const to = response.headers?.get?.('location') ?? '(адрес не назван)'
        return { status, redirected: true, detail: `перенаправление ${status} на ${to}: policy для конечного адреса не спрошена, переход не делается`, bytes: null, contentType: null }
      }
      /* Ответ по чужому адресу не читается даже без 3xx: транспорт мог пройти
         редирект сам, и тогда прочитанное относится не к тому, что спрашивали. */
      const finalUrl = typeof response.url === 'string' && response.url ? response.url : url
      if (finalUrl !== url && policyOrigin(finalUrl) !== policyOrigin(url)) {
        return { status: 0, redirected: true, detail: `ответ пришёл с ${policyOrigin(finalUrl)}, спрашивали ${policyOrigin(url)}`, bytes: null, contentType: null }
      }
      if (!response.ok) return { status, redirected: false, detail: `ответ ${status}`, bytes: null, contentType: null }
      const bytes = await readBoundedBody(response, maxBytes, signal)
      return { status, redirected: false, detail: null, bytes, contentType: response.headers?.get?.('content-type') ?? null }
    }, EXCHANGE_DEADLINE_MS)
  }

  return {
    async fetchRobots(domain, robotsUrl) {
      try {
        const res = await get(robotsUrl, 512 * 1024)
        /* Перенаправленный robots.txt — не «правил нет»: правила лежат по
           другому адресу, которого мы не спрашивали. Молчание, а не согласие. */
        if (res.redirected) return { outcome: 'unavailable', bytes: null }
        if (res.status === 404 || res.status === 410) return { outcome: 'absent', bytes: null }
        if (res.status !== 200 || !res.bytes) return { outcome: 'unavailable', bytes: null }
        const shaped = looksLikeRobots(res.bytes, res.contentType)
        if (!shaped.ok) return { outcome: 'undecodable', bytes: null }
        return { outcome: 'fetched', bytes: Buffer.from(res.bytes) }
      } catch (thrown) {
        /* Обрыв, таймаут, отказ DNS — молчание сайта, а не согласие.
           Всё остальное — наш дефект, и он идёт наверх, а не в реестр. */
        if (!isNetworkFailure(thrown)) throw thrown
        return { outcome: 'unavailable', bytes: null }
      }
    },
    async fetchPage(url) {
      try {
        const res = await get(url, PARSE_LIMITS.maxHtmlBytes)
        if (!res.bytes) return { ok: false, detail: res.detail ?? `ответ ${res.status}` }
        const charset = charsetOf(res.contentType)
        if (!charset.ok) return { ok: false, detail: `кодировка ${charset.charset} не читается — догадка запрещена` }
        return { ok: true, text: new TextDecoder(charset.charset === 'utf8' ? 'utf-8' : charset.charset).decode(res.bytes) }
      } catch (thrown) {
        if (!isNetworkFailure(thrown)) throw thrown
        return { ok: false, detail: describeThrownSafely(thrown) }
      }
    },
  }
}

/** Сухой прогон: сети нет, но план предъявлен — сколько и куда пришлось бы идти. */
export function planFrom(queue, { limit, perDomain }) {
  const domains = new Map()
  let withHint = 0
  let unusable = 0
  for (const row of queue) {
    if (!row.hints.length) continue
    withHint += 1
    try {
      const origin = policyOrigin(row.hints[0])
      domains.set(origin, (domains.get(origin) ?? 0) + 1)
    } catch { unusable += 1 }
  }
  const planned = Math.min(withHint - unusable, limit)
  return {
    queue: queue.length,
    withOfficialUrl: withHint,
    unusableHints: unusable,
    origins: domains.size,
    objectLimit: limit,
    perDomainLimit: perDomain,
    plannedObjects: planned,
    plannedRequestsAtMost: planned * 2,
  }
}

export async function runEnrichCli(argv = process.argv, deps = {}, target = process) {
  const now = deps.now ?? (() => new Date())
  try {
    const args = parseEnrichArgs(argv)
    const snapshot = snapshotFromDocument(JSON.parse(snapshotTextFrom(await readFile(path.resolve(args.snapshot)))))
    assertDiscoverySnapshot(snapshot)
    const queues = JSON.parse(await readFile(path.resolve(args.queues), 'utf8'))
    /* ВХОД ПРОВЕРЯЕТСЯ ДО СЕТИ, И ЦЕЛИКОМ. Отпечаток пересчитывается по
       содержимому, а не принимается на слово (аудит JG-2, находка 04). */
    assertReportDigest(queues, 'poi-japan-guide-queues/v1', '--queues')
    if (queues.inputs?.snapshot?.digest !== snapshot.snapshotDigest) {
      throw new Error(`очереди собраны по снимку ${queues.inputs?.snapshot?.digest ?? '(не назван)'}, подан ${snapshot.snapshotDigest}`)
    }
    const queue = enrichmentQueueFrom(queues, snapshot)
    const plan = planFrom(queue, { limit: args.limit, perDomain: args.perDomain })

    if (!args.live) {
      const dry = { spec: JG_ENRICH_CLI_SPEC, createdAt: now().toISOString(), mode: 'dry', plan, effects: { network: 0, google: 0, model: 0, post: 0, patch: 0, delete: 0 } }
      await writeFile(path.resolve(args.out), `${JSON.stringify(dry, null, 2)}\n`, 'utf8')
      console.log(`СУХОЙ ПРОГОН JA-3 — сети 0. Очередь ${plan.queue}, с официальным адресом ${plan.withOfficialUrl}, сайтов ${plan.origins}.`)
      console.log(`С --live будет обработано не больше ${plan.plannedObjects} объектов и сделано не больше ${plan.plannedRequestsAtMost} запросов (robots + страница).`)
      console.log(`план: ${path.resolve(args.out)}`)
      target.exitCode = 0
      return target.exitCode
    }

    const budget = openEnrichmentBudget({
      objects: args.limit, robotsFetches: args.limit, pageFetches: args.limit, perDomainFetches: args.perDomain,
    })
    const pacer = deps.pacer ?? createEnrichmentPacer()
    const io = deps.io ?? liveIo({ pacer })
    const result = await runEnrichment({ queue, budget, io, now })
    const report = buildEnrichmentReport({
      queue, result, budget, createdAt: now().toISOString(),
      inputs: {
        snapshot: { digest: snapshot.snapshotDigest, records: snapshot.records.length },
        queues: { digest: queues.reportDigest ?? null, candidates: queues.counts?.candidate ?? queue.length },
        limits: { objects: args.limit, perDomain: args.perDomain },
        plan,
      },
    })
    await writeFile(path.resolve(args.out), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(summarizeEnrichment(report))
    console.log(`полный отчёт: ${path.resolve(args.out)}`)
    target.exitCode = 0
    return target.exitCode
  } catch (thrown) {
    target.exitCode = 1
    try { console.error(`[poi-jg-enrich] ${describeThrownSafely(thrown)}`) } catch { /* код уже выставлен */ }
    return target.exitCode
  }
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  await runEnrichCli()
}
