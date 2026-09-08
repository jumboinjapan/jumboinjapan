/**
 * JA‑3: РЕЕСТР ИСТОЧНИКОВ И БЮДЖЕТ СЕТИ — `poi-source-policy/v1`.
 *
 * Решение владельца 3.4 (06.09.2026): чтение официальных сайтов разрешено
 * «read-only, отдельный бюджет, policy на каждый сайт», и запись в реестре
 * появляется ДО первого обращения к домену. Решение 08.09.2026: запись
 * выводится автоматически из `robots.txt` по ЗАКРЫТОМУ правилу, а список
 * извлекаемого — закрытый и структурный.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ. Здесь — правило, по которому домен получает
 * статус, и счётчик, который останавливает прогон. Здесь НЕТ сети: модуль не
 * импортирует `fetch` и ничего не загружает. Он принимает уже полученные
 * байты `robots.txt` (или названный отказ их получить) и отвечает, можно ли
 * обращаться к странице. Кто и чем загрузил — дело вызывающего; проверить
 * правило без сети должно быть возможно, иначе его нечем доказать.
 *
 * ПОЧЕМУ СТАТУСОВ ТРИ, А НЕ ДВА.
 *
 *   `allowed` — robots получен и путь им разрешён; либо сайт ответил 404/410,
 *               то есть сказал «правил нет». Так предписывает RFC 9309, и
 *               выдумывать вместо этого запрет значило бы не выполнить прямо
 *               выраженную волю владельца сайта;
 *   `denied`   — robots получен и путь запрещён. Объект уходит в `review`;
 *   `unknown`  — robots получить НЕ УДАЛОСЬ: 5xx, обрыв, таймаут, тело не
 *               разбирается. Молчание — не согласие: обращаться нельзя, объект
 *               уходит в `review`. Именно поэтому статуса три: «нам запретили»
 *               и «мы не спросили» — разные утверждения, и второе не должно
 *               выглядеть как первое.
 *
 * ЧТО МОЖНО БРАТЬ — ЗАКРЫТЫЙ СПИСОК СТРУКТУРНЫХ ФАКТОВ. Адрес, почтовый
 * индекс, японское имя и чтение, координаты, официальный адрес страницы. Проза
 * — описания, тексты «о нас», отзывы, расписания словами — НЕ БЕРЁТСЯ НИКОГДА
 * и ни при каком статусе: списка, в который её можно было бы добавить, в этом
 * модуле нет. `robots.txt` разрешает обход, а не присвоение текста.
 */
import { createHash } from 'node:crypto'
import {
  assertExactKeys,
  assertInteger,
  assertNonEmptyString,
  assertStringList,
  deepFreeze,
  isPlainObject,
} from '../../lib/canonical-contract.mjs'
import { buildRobotsPolicy, ROBOTS_PRODUCT_TOKEN } from './html-fetch.mjs'

export const SOURCE_POLICY_SPEC = 'poi-source-policy/v1'
export const ENRICHMENT_BUDGET_SPEC = 'poi-enrichment-budget/v1'

/**
 * ЧТО ВООБЩЕ МОЖНО ИЗВЛЕЧЬ. Список закрыт и структурен: каждое значение —
 * поле карточки, а не отрывок страницы. Расширять его нельзя молча: новое имя
 * здесь означает новое утверждение о том, что мы берём с чужих сайтов.
 */
export const ENRICHABLE_FACTS = Object.freeze(
  ['address', 'postalCode', 'nameJa', 'nameKana', 'lat', 'lon', 'officialUrl'].sort())
/** Статусы домена; порядок значения не имеет, список закрыт. */
export const POLICY_STATUSES = Object.freeze(['allowed', 'denied', 'unknown'])
/** Кем вынесено решение. `owner` оставлен для ручных исключений владельца. */
export const POLICY_DECIDERS = Object.freeze(['robots-auto', 'owner'])
/**
 * Названные исходы попытки получить `robots.txt`. Список закрыт: «что-то
 * пошло не так» не является исходом, по которому можно принять решение.
 */
export const ROBOTS_OUTCOMES = Object.freeze([
  'fetched',        // 2xx, тело разобрано
  'absent',         // 404/410 — правил нет, RFC 9309 читает это как «всё разрешено»
  'unavailable',    // 5xx, обрыв, таймаут — молчание, а не согласие
  'undecodable',    // тело получено, но это не текст robots
])
/** Исходы, при которых обращаться к домену нельзя. */
const REFUSING_OUTCOMES = Object.freeze(['unavailable', 'undecodable'])

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

/**
 * ORIGIN СТРАНИЦЫ — ИМЕННО ИМ АДРЕСУЕТСЯ РЕЕСТР.
 *
 * `robots.txt` действует на origin (схема, хост, порт), а не на «домен без
 * www»: у множества японских сайтов apex-имя не существует вовсе — первый же
 * живой прогон 08.09.2026 получил `ENOTFOUND` на `kunaicho.go.jp`, тогда как
 * `www.kunaicho.go.jp` отвечает. Спрашивать правила у несуществующего хоста и
 * записывать «сайт промолчал» — измерение собственной ошибки, а не сайта.
 */
export function policyOrigin(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new TypeError(`${SOURCE_POLICY_SPEC}: ${JSON.stringify(url)} не является адресом`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError(`${SOURCE_POLICY_SPEC}: схема ${parsed.protocol} не читается — только http(s)`)
  }
  return parsed.origin.toLowerCase()
}

/**
 * Домен без ведущего `www.` — им сравнивают «тот же ли это сайт» при
 * перенаправлении. Ключом реестра он НЕ является: см. `policyOrigin`.
 */
export function policyDomain(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new TypeError(`${SOURCE_POLICY_SPEC}: ${JSON.stringify(url)} не является адресом`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError(`${SOURCE_POLICY_SPEC}: схема ${parsed.protocol} не читается — только http(s)`)
  }
  return parsed.hostname.toLowerCase().replace(/^www\./, '')
}

/**
 * ЗАПИСЬ РЕЕСТРА ИЗ ИСХОДА ПОПЫТКИ ПОЛУЧИТЬ `robots.txt`.
 *
 * Правило закрыто и целиком выражено здесь; ветки, в которой домен получает
 * `allowed` без предъявленного исхода, нет. `bytes` требуется ровно при
 * `fetched`: статус, выведенный из отсутствующих байтов, ничего не доказывал
 * бы.
 */
export function sourcePolicyFromRobots({
  domain,
  origin,
  robotsUrl,
  outcome,
  bytes = null,
  fetchedAt,
  productToken = ROBOTS_PRODUCT_TOKEN,
  note = null,
}) {
  assertNonEmptyString(domain, `${SOURCE_POLICY_SPEC}.domain`)
  assertNonEmptyString(origin, `${SOURCE_POLICY_SPEC}.origin`)
  assertNonEmptyString(robotsUrl, `${SOURCE_POLICY_SPEC}.robotsUrl`)
  assertNonEmptyString(fetchedAt, `${SOURCE_POLICY_SPEC}.fetchedAt`)
  if (!ROBOTS_OUTCOMES.includes(outcome)) {
    throw new TypeError(`${SOURCE_POLICY_SPEC}.outcome: ${JSON.stringify(outcome)} вне закрытого списка ${ROBOTS_OUTCOMES.join(', ')}`)
  }
  if (domain !== domain.toLowerCase() || domain.startsWith('www.')) {
    throw new TypeError(`${SOURCE_POLICY_SPEC}.domain: ожидается нормализованный домен, получен ${JSON.stringify(domain)}`)
  }
  if (outcome === 'fetched') {
    if (!ArrayBuffer.isView(bytes)) {
      throw new TypeError(`${SOURCE_POLICY_SPEC}: исход «fetched» без байтов robots.txt — статус выводить не из чего`)
    }
  } else if (bytes !== null) {
    throw new TypeError(`${SOURCE_POLICY_SPEC}: байты robots.txt при исходе «${outcome}» — исход и содержимое противоречат друг другу`)
  }

  let robots = null
  let status
  if (outcome === 'fetched') {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let policy
    try {
      policy = buildRobotsPolicy(buffer.toString('utf8'), { productToken })
    } catch (error) {
      throw new TypeError(`${SOURCE_POLICY_SPEC}: robots.txt домена ${domain} не разбирается: ${error.message}`)
    }
    robots = deepFreeze({
      digest: sha256(buffer),
      bytes: buffer.byteLength,
      appliedGroups: [...policy.appliedGroups],
      groupSource: policy.source,
      ruleCount: policy.ruleCount,
    })
    /* Правило пути спрашивается отдельно (`policyAllowsPath`): домен может
       разрешать одну страницу и запрещать соседнюю, и одним статусом это не
       выражается. Статус домена говорит лишь, что спросить БЫЛО У ЧЕГО. */
    status = 'allowed'
  } else if (outcome === 'absent') {
    status = 'allowed'
  } else {
    /* `unavailable` и `undecodable` — молчание, а не согласие и не запрет. */
    status = 'unknown'
  }
  if (REFUSING_OUTCOMES.includes(outcome) && status !== 'unknown') {
    throw new Error(`${SOURCE_POLICY_SPEC}: исход «${outcome}» обязан давать «unknown», выведено «${status}»`)
  }

  const record = {
    spec: SOURCE_POLICY_SPEC,
    domain,
    origin,
    robotsUrl,
    outcome,
    status,
    decidedBy: 'robots-auto',
    decidedAt: fetchedAt,
    productToken,
    robots,
    allowedFacts: status === 'allowed' ? [...ENRICHABLE_FACTS] : [],
    note,
  }
  return assertSourcePolicy(record)
}

/**
 * ЗАПРЕТ ДОМЕНА РУКОЙ ВЛАДЕЛЬЦА.
 *
 * Автоматическое правило статуса `denied` не выдаёт НИКОГДА: `robots.txt`
 * запрещает пути, а не домены, и «весь сайт закрыт» — это утверждение, за
 * которым стоит человек, а не разбор. Лицензия, письмо владельца сайта,
 * решение не трогать источник — всё это приходит сюда, называется в `note` и
 * подписывается `owner`. Ветки, в которой запрет домена возникает сам, в
 * модуле нет.
 */
export function ownerDeniedPolicy({ domain, origin, robotsUrl, decidedAt, note, productToken = ROBOTS_PRODUCT_TOKEN }) {
  assertNonEmptyString(note, `${SOURCE_POLICY_SPEC}.note`)
  return assertSourcePolicy({
    spec: SOURCE_POLICY_SPEC,
    domain,
    origin,
    robotsUrl,
    outcome: 'absent',
    status: 'denied',
    decidedBy: 'owner',
    decidedAt,
    productToken,
    robots: null,
    allowedFacts: [],
    note,
  })
}

/** Точная форма записи реестра — проверяется и при создании, и при чтении. */
export function assertSourcePolicy(record, where = SOURCE_POLICY_SPEC) {
  if (!isPlainObject(record)) throw new TypeError(`${where}: ожидается объект записи реестра`)
  assertExactKeys(record, [
    'spec', 'domain', 'origin', 'robotsUrl', 'outcome', 'status', 'decidedBy', 'decidedAt',
    'productToken', 'robots', 'allowedFacts', 'note',
  ], where)
  if (record.spec !== SOURCE_POLICY_SPEC) {
    throw new TypeError(`${where}.spec: ожидается «${SOURCE_POLICY_SPEC}», получено ${JSON.stringify(record.spec)}`)
  }
  assertNonEmptyString(record.domain, `${where}.domain`)
  assertNonEmptyString(record.origin, `${where}.origin`)
  assertNonEmptyString(record.robotsUrl, `${where}.robotsUrl`)
  /* Origin и домен обязаны говорить об одном сайте: запись, где они расходятся,
     удостоверяла бы правила одного хоста для другого. */
  if (policyDomain(record.origin) !== record.domain) {
    throw new TypeError(`${where}.origin: ${record.origin} не принадлежит домену ${record.domain}`)
  }
  if (!record.robotsUrl.startsWith(`${record.origin}/`)) {
    throw new TypeError(`${where}.robotsUrl: ${record.robotsUrl} взят не с origin ${record.origin}`)
  }
  assertNonEmptyString(record.decidedAt, `${where}.decidedAt`)
  assertNonEmptyString(record.productToken, `${where}.productToken`)
  if (!ROBOTS_OUTCOMES.includes(record.outcome)) throw new TypeError(`${where}.outcome: вне закрытого списка`)
  if (!POLICY_STATUSES.includes(record.status)) throw new TypeError(`${where}.status: вне закрытого списка`)
  if (!POLICY_DECIDERS.includes(record.decidedBy)) throw new TypeError(`${where}.decidedBy: вне закрытого списка`)
  if (record.note !== null) assertNonEmptyString(record.note, `${where}.note`)
  assertStringList(record.allowedFacts, `${where}.allowedFacts`)
  for (const fact of record.allowedFacts) {
    if (!ENRICHABLE_FACTS.includes(fact)) {
      throw new TypeError(`${where}.allowedFacts: «${fact}» вне закрытого списка извлекаемого — проза и описания не берутся ни при каком статусе`)
    }
  }
  if (record.status !== 'allowed' && record.allowedFacts.length) {
    throw new TypeError(`${where}.allowedFacts: домен со статусом «${record.status}» не разрешает ничего, а список непуст`)
  }
  if (record.decidedBy === 'robots-auto' && record.status === 'denied') {
    throw new TypeError(`${where}.status: «denied» на весь домен подписывает человек — разбор robots.txt такого не выводит`)
  }
  if (record.decidedBy === 'owner' && record.note === null) {
    throw new TypeError(`${where}.note: решение владельца обязано нести причину`)
  }
  if (record.outcome === 'fetched') {
    if (!isPlainObject(record.robots)) throw new TypeError(`${where}.robots: исход «fetched» обязан нести разбор robots.txt`)
    assertExactKeys(record.robots, ['digest', 'bytes', 'appliedGroups', 'groupSource', 'ruleCount'], `${where}.robots`)
    assertNonEmptyString(record.robots.digest, `${where}.robots.digest`)
    if (!/^sha256:[0-9a-f]{64}$/.test(record.robots.digest)) throw new TypeError(`${where}.robots.digest: ожидается sha256:<64 hex>`)
    assertInteger(record.robots.bytes, `${where}.robots.bytes`, 0)
    assertStringList(record.robots.appliedGroups, `${where}.robots.appliedGroups`)
    assertNonEmptyString(record.robots.groupSource, `${where}.robots.groupSource`)
    assertInteger(record.robots.ruleCount, `${where}.robots.ruleCount`, 0)
  } else if (record.robots !== null) {
    throw new TypeError(`${where}.robots: разбор robots.txt при исходе «${record.outcome}» — исход и содержимое противоречат друг другу`)
  }
  return record
}

/**
 * РАЗРЕШЕНО ЛИ ОБРАЩАТЬСЯ ИМЕННО К ЭТОЙ СТРАНИЦЕ.
 *
 * Статус домена — необходимое условие, а не достаточное: `robots.txt` даёт
 * правила ПУТЕЙ, и домен со статусом `allowed` может запрещать конкретную
 * страницу. Поэтому здесь спрашивается путь, и для этого правила разбираются
 * из тех же байтов заново — хранить в записи замыкание значило бы хранить
 * код там, где положено хранить данные.
 *
 * Возвращает `{ allowed, reason, deniedBy }`; `reason` — из закрытого списка.
 */
export function policyAllowsPath(record, url, robotsText = null) {
  assertSourcePolicy(record)
  const domain = policyDomain(url)
  if (domain !== record.domain) {
    return { allowed: false, reason: 'policyForAnotherDomain', deniedBy: null }
  }
  if (record.status === 'unknown') return { allowed: false, reason: 'robotsUnavailable', deniedBy: null }
  if (record.status === 'denied') return { allowed: false, reason: 'robotsDenied', deniedBy: null }
  if (record.outcome === 'absent') return { allowed: true, reason: 'robotsAbsent', deniedBy: null }
  if (typeof robotsText !== 'string') {
    /* Запись говорит «robots получен», а текста нет — спрашивать нечего.
       Молча разрешить значило бы выдать несделанную проверку за пройденную. */
    return { allowed: false, reason: 'robotsTextMissing', deniedBy: null }
  }
  const bytes = Buffer.from(robotsText, 'utf8')
  if (sha256(bytes) !== record.robots.digest) {
    return { allowed: false, reason: 'robotsTextMismatch', deniedBy: null }
  }
  const policy = buildRobotsPolicy(robotsText, { productToken: record.productToken })
  const parsed = new URL(url)
  const verdict = policy.allows(`${parsed.pathname}${parsed.search}`)
  return verdict.allowed
    ? { allowed: true, reason: 'robotsAllowed', deniedBy: null }
    : { allowed: false, reason: 'robotsDenied', deniedBy: verdict.deniedBy }
}

/* ── Бюджет ───────────────────────────────────────────────────────────── */

/** Роды расхода. Закрыты: расход без имени сосчитать нечем. */
export const BUDGET_KINDS = Object.freeze(['object', 'robotsFetch', 'pageFetch'])

/**
 * БЮДЖЕТ, КОТОРЫЙ СПРАШИВАЮТ ДО ЗАПРОСА, А НЕ ПОСЛЕ.
 *
 * `charge(kind)` не «списывает и сообщает», а РЕШАЕТ: при исчерпании он
 * возвращает `{ granted: false }`, и запроса не происходит вовсе. Обратный
 * порядок — сходить, потом заметить потолок — превратил бы потолок в отчёт о
 * превышении.
 *
 * Исчерпание — ЗАКОННЫЙ ИСХОД прогона, а не ошибка: прогон останавливается,
 * называет, на чём остановился, и остаток остаётся остатком. Бросает только
 * обращение с несуществующим родом расхода.
 */
export function openEnrichmentBudget({ objects, robotsFetches, pageFetches, perDomainFetches = null }) {
  const where = ENRICHMENT_BUDGET_SPEC
  assertInteger(objects, `${where}.objects`, 0)
  assertInteger(robotsFetches, `${where}.robotsFetches`, 0)
  assertInteger(pageFetches, `${where}.pageFetches`, 0)
  if (perDomainFetches !== null) assertInteger(perDomainFetches, `${where}.perDomainFetches`, 1)
  const limits = Object.freeze({ object: objects, robotsFetch: robotsFetches, pageFetch: pageFetches })
  const spent = { object: 0, robotsFetch: 0, pageFetch: 0 }
  const byDomain = new Map()
  let exhaustedBy = null

  const charge = (kind, domain = null) => {
    if (!BUDGET_KINDS.includes(kind)) throw new TypeError(`${where}: неизвестный род расхода ${JSON.stringify(kind)}`)
    if (spent[kind] >= limits[kind]) {
      exhaustedBy = exhaustedBy ?? kind
      return { granted: false, reason: 'budgetExhausted', kind, limit: limits[kind], spent: spent[kind] }
    }
    if (perDomainFetches !== null && kind === 'pageFetch') {
      if (domain === null) throw new TypeError(`${where}: расход pageFetch без домена — потолок на домен не проверить`)
      const used = byDomain.get(domain) ?? 0
      if (used >= perDomainFetches) {
        return { granted: false, reason: 'domainBudgetExhausted', kind, limit: perDomainFetches, spent: used, domain }
      }
      byDomain.set(domain, used + 1)
    }
    spent[kind] += 1
    return { granted: true, reason: null, kind, limit: limits[kind], spent: spent[kind] }
  }

  return {
    spec: where,
    limits,
    charge,
    get exhausted() { return exhaustedBy !== null },
    get exhaustedBy() { return exhaustedBy },
    report() {
      return {
        spec: where,
        limits: { ...limits },
        spent: { ...spent },
        remaining: Object.fromEntries(BUDGET_KINDS.map((k) => [k, limits[k] - spent[k]])),
        perDomainFetches,
        domainsTouched: byDomain.size,
        exhausted: exhaustedBy !== null,
        exhaustedBy,
      }
    },
  }
}
