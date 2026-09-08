/**
 * JA-3: ГРАНИЦА БЕСПЛАТНОГО ОБОГАЩЕНИЯ — `poi-enrichment/v1`.
 *
 * Вход: проверенный снимок discovery (за подсказкой официального адреса) и
 * отчёт очередей JG-1 (за тем, КОГО вообще разрешено обогащать — только
 * очередь `candidate`, прошедшую JA-2). Выход: по одному названному исходу на
 * каждый обрабатываемый объект и наблюдения там, где они получены.
 *
 * ТРИ ПРАВИЛА, РАДИ КОТОРЫХ ЭТОТ МОДУЛЬ СУЩЕСТВУЕТ.
 *
 *   1. НЕПРОВЕРЕННАЯ ПОДСКАЗКА НЕ СТАНОВИТСЯ ПОЛЕМ. `official_url_hint` из
 *      Japan Guide — повод сходить на сайт, и только. Всё, что вернулось,
 *      остаётся наблюдением с адресом, моментом чтения и `unverified`; поля
 *      карточки отсюда не пишутся вовсе — записи в этом модуле нет.
 *   2. НЕДОСТУПНЫЙ ИСТОЧНИК ДАЁТ `review`, А НЕ ДОГАДКУ. Сайт не ответил,
 *      robots промолчал, структурных данных нет — все три случая названы
 *      по-своему и уходят к человеку. Ни один из них не превращается в
 *      «ну примерно так».
 *   3. БЮДЖЕТ СПРАШИВАЮТ ДО ЗАПРОСА. Исчерпание — законный конец прогона:
 *      остаток остаётся остатком и назван, а не «потерян».
 *
 * СЕТЬ ЗДЕСЬ НЕ СОЗДАЁТСЯ. Модуль принимает `io` — две функции, которые
 * приносят байты robots.txt и страницы. Кто их приносит (живой `fetch` с
 * дедлайном и темпом из CLI или фикстура из теста), модулю знать не нужно, и
 * это не удобство тестов, а условие проверяемости: правило, которое нельзя
 * проверить без сети, нечем доказать.
 */
import { canonicalJsonBytes } from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { collectPlaceFacts } from './official-page.mjs'
import {
  ENRICHABLE_FACTS, policyAllowsPath, policyDomain, policyOrigin, sourcePolicyFromRobots,
} from './source-policy.mjs'

export const ENRICHMENT_SPEC = 'poi-enrichment/v1'

/**
 * Исходы объекта. Список закрыт, и каждый исход — утверждение, которое можно
 * предъявить: чем именно кончилась попытка обогатить эту строку.
 */
export const ENRICHMENT_OUTCOMES = Object.freeze([
  'enriched',         // страница прочитана, структурные факты получены
  'factsConflict',    // на странице несколько мест, и они говорят разное
  'noFacts',          // страница прочитана, структурных данных о месте нет
  'noOfficialUrl',    // источник не дал подсказки официального адреса
  'hintUnusable',     // подсказка есть, но адресом не является
  'policyDenied',     // robots.txt запретил этот путь
  'policyUnknown',    // robots.txt получить не удалось — молчание, а не согласие
  'pageUnavailable',  // сайт не ответил или ответил не страницей
  'budgetNotSpent',   // до строки не дошли: бюджет кончился раньше
])
/** Исходы, при которых строка уходит к человеку. */
export const REVIEW_OUTCOMES = Object.freeze([
  'factsConflict', 'noFacts', 'noOfficialUrl', 'hintUnusable', 'policyDenied', 'policyUnknown', 'pageUnavailable',
])

/**
 * Подсказка официального адреса из записи снимка.
 *
 * Берётся факт-лид рода `official_url_hint` — тот же, что JA-1 переносит
 * подсказкой в пакет. Их может быть несколько; берётся первый по порядку
 * снимка, а остальные названы: выбирать «лучший» значило бы решать за
 * человека, какой сайт официальнее.
 */
export function officialUrlHints(record) {
  return (record.factLeads ?? [])
    .filter((lead) => lead.kind === 'official_url_hint' && typeof lead.value === 'string' && lead.value.trim())
    .map((lead) => lead.value.trim())
}

/**
 * ОТЧЁТ, ПРИШЕДШИЙ ФАЙЛОМ, ПРОВЕРЯЕТСЯ ЦЕЛИКОМ — И ДО ПЕРВОГО ОБРАЩЕНИЯ В СЕТЬ.
 *
 * Аудит JG-2 (находка 04) предъявил очевидное, как только оно было названо:
 * `reportDigest` в файле — это утверждение файла о себе, и пока его никто не
 * пересчитывает, изменить содержимое можно, не тронув отпечаток. В подменённом
 * отчёте оказались другие ключи и другие имена, и платный путь пошёл искать
 * выдуманный объект, опубликовав старый отпечаток как доказательство.
 *
 * Отпечаток здесь ПЕРЕСЧИТЫВАЕТСЯ по тому же правилу, по которому был выдан:
 * канонические байты тела без `createdAt` и без самого отпечатка. Разошлись —
 * отказ до сети.
 */
export function assertReportDigest(doc, spec, where) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new TypeError(`${where}: ожидается отчёт-объект`)
  if (doc.spec !== spec) throw new TypeError(`${where}.spec: ожидается «${spec}», получено ${JSON.stringify(doc.spec ?? null)}`)
  if (typeof doc.reportDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(doc.reportDigest)) {
    throw new TypeError(`${where}.reportDigest: отпечатка нужной формы нет — принимать нечего`)
  }
  const { reportDigest, ...body } = doc
  const recomputed = sha256Bytes(canonicalJsonBytes({ ...body, createdAt: null }, spec))
  if (recomputed !== reportDigest) {
    throw new Error(`${where}: отчёт изменён после подписи — объявлен ${reportDigest}, содержимое даёт ${recomputed}`)
  }
  return doc
}

/**
 * ЧТО ОБОГАЩАЕМ. Только очередь `candidate` отчёта JG-1 — это и есть «прошедшие
 * JA-2» из плана. `review` не берём: там строка ждёт решения человека, и
 * сходить за фактами раньше него значило бы обогащать то, что, возможно,
 * вообще не заводится.
 *
 * Отчёт очередей проверяется отпечатком, а состав очереди — принадлежностью
 * снимку: строка, которой в снимке нет, до сети не доходит.
 */
export function enrichmentQueueFrom(report, snapshot) {
  const byKey = new Map(snapshot.records.map((record) => [record.sourceKey, record]))
  return report.queues.candidate.map((row) => {
    const record = byKey.get(row.sourceKey)
    if (!record) throw new Error(`${ENRICHMENT_SPEC}: ${row.sourceKey} из очереди нет в снимке — отчёт и снимок разные`)
    return { sourceKey: row.sourceKey, nameEn: row.nameEn, url: row.url, hints: officialUrlHints(record) }
  })
}

const outcomeOf = (row, outcome, detail, extra = {}) => ({
  sourceKey: row.sourceKey,
  nameEn: row.nameEn,
  sourceUrl: row.url,
  outcome,
  detail,
  review: REVIEW_OUTCOMES.includes(outcome),
  facts: [],
  omissions: [],
  conflicts: [],
  ...extra,
})

/**
 * ПРОГОН ОБОГАЩЕНИЯ.
 *
 * `io.fetchRobots(domain, robotsUrl)` обязан вернуть `{ outcome, bytes }` из
 * закрытого списка исходов `source-policy`; `io.fetchPage(url)` — `{ ok, text }`.
 * Ни та, ни другая не бросает в норме: отказ сети — это исход, а не авария, и
 * назвать его обязан тот, кто в сеть ходил.
 *
 * ПОРЯДОК ЖЁСТКИЙ И ОБЪЯСНИМЫЙ. Сначала подсказка (без неё идти некуда),
 * затем бюджет объекта, затем policy домена (её берут из реестра или заводят
 * ОДИН раз на домен — второй robots.txt того же сайта был бы вежливостью
 * наоборот), затем правило пути, и только потом страница. Каждый шаг может
 * закончить обработку строки названным исходом, и ни один не пропускается
 * «потому что и так понятно».
 *
 * РЕЕСТР ДОМЕНОВ НАКАПЛИВАЕТСЯ В ПРОГОНЕ и возвращается целиком: он и есть
 * та самая «запись до первого обращения», которую требует решение 3.4, —
 * предъявимая, с отпечатком robots.txt и моментом решения.
 */
export async function runEnrichment({ queue, budget, io, now, policies = new Map() }) {
  if (!budget || typeof budget.charge !== 'function') throw new TypeError(`${ENRICHMENT_SPEC}: нужен бюджет`)
  if (!io || typeof io.fetchRobots !== 'function' || typeof io.fetchPage !== 'function') {
    throw new TypeError(`${ENRICHMENT_SPEC}: нужны io.fetchRobots и io.fetchPage — сеть этот модуль не создаёт`)
  }
  const at = () => now().toISOString()
  const rows = []
  const robotsText = new Map()

  for (const row of queue) {
    if (!row.hints.length) { rows.push(outcomeOf(row, 'noOfficialUrl', 'источник не дал официального адреса')); continue }
    const [hint] = row.hints
    let domain
    let origin
    try {
      domain = policyDomain(hint)
      /* Реестр адресуется ORIGIN подсказки, а не «доменом без www»: robots.txt
         действует на origin, и у множества японских сайтов apex-имя вовсе не
         существует. */
      origin = policyOrigin(hint)
    } catch (error) {
      rows.push(outcomeOf(row, 'hintUnusable', error.message, { hint }))
      continue
    }
    const object = budget.charge('object')
    if (!object.granted) {
      rows.push(outcomeOf(row, 'budgetNotSpent', `бюджет объектов исчерпан на ${object.spent} из ${object.limit}`, { hint, domain }))
      continue
    }

    if (!policies.has(origin)) {
      const robotsUrl = `${origin}/robots.txt`
      const allowance = budget.charge('robotsFetch')
      if (!allowance.granted) {
        rows.push(outcomeOf(row, 'budgetNotSpent', `бюджет robots.txt исчерпан на ${allowance.spent} из ${allowance.limit}`, { hint, domain, origin }))
        continue
      }
      const fetched = await io.fetchRobots(origin, robotsUrl)
      policies.set(origin, sourcePolicyFromRobots({
        domain, origin, robotsUrl, outcome: fetched.outcome, bytes: fetched.bytes ?? null, fetchedAt: at(),
      }))
      if (fetched.outcome === 'fetched' && fetched.bytes) {
        robotsText.set(origin, Buffer.from(fetched.bytes.buffer, fetched.bytes.byteOffset, fetched.bytes.byteLength).toString('utf8'))
      }
    }
    const policy = policies.get(origin)
    const verdict = policyAllowsPath(policy, hint, robotsText.get(origin) ?? null)
    if (!verdict.allowed) {
      const outcome = verdict.reason === 'robotsUnavailable' ? 'policyUnknown' : 'policyDenied'
      rows.push(outcomeOf(row, outcome, `${verdict.reason}${verdict.deniedBy ? `: ${verdict.deniedBy}` : ''}`, { hint, domain, origin }))
      continue
    }

    const page = budget.charge('pageFetch', origin)
    if (!page.granted) {
      rows.push(outcomeOf(row, 'budgetNotSpent', `${page.reason}: ${page.spent} из ${page.limit}`, { hint, domain, origin }))
      continue
    }
    const fetchedPage = await io.fetchPage(hint)
    if (!fetchedPage.ok) {
      rows.push(outcomeOf(row, 'pageUnavailable', fetchedPage.detail ?? 'страница не получена', { hint, domain, origin }))
      continue
    }
    const observedAt = at()
    const collected = collectPlaceFacts({ html: fetchedPage.text, url: hint, observedAt })
    /* Поле вне закрытого списка сюда попасть не может — разбор бросил бы
       раньше, — но утверждение проверяется и здесь: граница не полагается на
       дисциплину соседа. */
    for (const fact of collected.facts) {
      if (!ENRICHABLE_FACTS.includes(fact.field)) {
        throw new Error(`${ENRICHMENT_SPEC}: ${row.sourceKey}: поле «${fact.field}» вне закрытого списка извлекаемого`)
      }
    }
    /*
     * НЕСКОЛЬКО МЕСТ, ГОВОРЯЩИХ РАЗНОЕ, — ЭТО ВОПРОС, А НЕ НАБОР ФАКТОВ.
     *
     * Страница с двумя музеями даёт две пары координат и два имени. Отдать их
     * дальше одним списком значило бы предложить следующему этапу собрать из
     * них одно место — а он соберёт, и получится точка, которой в источнике
     * нет (аудит JG-2, находка 03). Поэтому расхождение названо здесь и уходит
     * к человеку вместе со всеми фактами, разложенными по местам.
     */
    const conflicted = collected.conflicts.length > 0
    rows.push(outcomeOf(
      row,
      conflicted ? 'factsConflict' : (collected.facts.length ? 'enriched' : 'noFacts'),
      conflicted
        ? `на странице ${collected.placeNodes} мест, расходятся поля: ${collected.conflicts.join(', ')}`
        : (collected.facts.length ? `фактов ${collected.facts.length}` : 'структурных данных о месте на странице нет'),
      {
        hint, domain, origin, observedAt,
        facts: collected.facts,
        omissions: collected.omissions,
        conflicts: collected.conflicts,
        placeNodes: collected.placeNodes,
      },
    ))
  }

  return { rows, policies, robotsFetched: robotsText.size }
}

/**
 * ОТЧЁТ ПРОГОНА. Закон сохранения проверяется: каждая строка очереди получает
 * ровно один исход, сумма исходов равна длине очереди.
 */
export function buildEnrichmentReport({ queue, result, budget, createdAt, inputs }) {
  const { rows } = result
  if (rows.length !== queue.length) {
    throw new Error(`${ENRICHMENT_SPEC}: закон сохранения нарушен — в очереди ${queue.length}, исходов ${rows.length}`)
  }
  const seen = new Set()
  for (const row of rows) {
    if (!ENRICHMENT_OUTCOMES.includes(row.outcome)) throw new Error(`${ENRICHMENT_SPEC}: ${row.sourceKey}: исход вне закрытого списка`)
    if (seen.has(row.sourceKey)) throw new Error(`${ENRICHMENT_SPEC}: ${row.sourceKey} дважды`)
    seen.add(row.sourceKey)
  }
  const counts = Object.fromEntries(ENRICHMENT_OUTCOMES.map((outcome) => [outcome, rows.filter((r) => r.outcome === outcome).length]))
  const factCounts = {}
  for (const row of rows) for (const fact of row.facts) factCounts[fact.field] = (factCounts[fact.field] ?? 0) + 1
  const report = {
    spec: ENRICHMENT_SPEC,
    createdAt,
    portal: 'japan-guide',
    inputs,
    budget: budget.report(),
    counts: { queue: queue.length, ...counts, review: rows.filter((r) => r.review).length },
    facts: factCounts,
    policies: [...result.policies.values()].sort((a, b) => (a.origin < b.origin ? -1 : 1)),
    rows,
    effects: { google: 0, model: 0, post: 0, patch: 0, delete: 0 },
  }
  return { ...report, reportDigest: sha256Bytes(canonicalJsonBytes({ ...report, createdAt: null }, ENRICHMENT_SPEC)) }
}

export function summarizeEnrichment(report) {
  const c = report.counts
  const b = report.budget
  return [
    `ОБОГАЩЕНИЕ JA-3 — очередь ${c.queue}: обогащено ${c.enriched}, без фактов ${c.noFacts}, без адреса ${c.noOfficialUrl}, `
    + `robots запретил ${c.policyDenied}, robots промолчал ${c.policyUnknown}, страница недоступна ${c.pageUnavailable}, не дошли ${c.budgetNotSpent}`,
    `к человеку уходит ${c.review}`,
    `бюджет: объектов ${b.spent.object}/${b.limits.object}, robots ${b.spent.robotsFetch}/${b.limits.robotsFetch}, страниц ${b.spent.pageFetch}/${b.limits.pageFetch}`
    + `${b.exhausted ? ` — исчерпан на ${b.exhaustedBy}` : ''}`,
    `фактов по полям: ${Object.entries(report.facts).map(([k, v]) => `${k} ${v}`).join(', ') || 'нет'}`,
    `доменов в реестре ${report.policies.length}; Google 0, модель 0, POST/PATCH/DELETE 0`,
  ].join('\n')
}
