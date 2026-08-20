/**
 * Сетевая граница discovery-обхода: robots, темп, ограниченный ридер и гейт
 * кодировки `S-ENC`.
 *
 * ЧТО ИЗМЕРЕНО 17.08.2026 на трёх живых страницах:
 *
 *   HTTP `Content-Type; charset`   shift-jis      на всех трёх
 *   `<meta charset>`               UTF-8          ровно одно объявление
 *   строгий shift-jis по телу      исключение
 *   строгий utf-8 по телу          исключение
 *
 * Документ не является ни UTF-8, ни Shift_JIS: преимущественно ASCII с
 * вкраплениями Shift_JIS и одновременно с настоящими
 * UTF-8-последовательностями. Политика `mixed-page-utf8-locators-v1` не
 * утверждает, что страница UTF-8; она утверждает, что разрешённые локаторы
 * безопасно извлекаются после replacement-aware разбора и отдельной проверки
 * КАЖДОГО значения по закрытому алфавиту.
 *
 * ЧЕТЫРЕ ПРАВИЛА, КОТОРЫЕ ДЕРЖАТСЯ КОДОМ, А НЕ ДИСЦИПЛИНОЙ.
 *
 * 1. `robots.txt` читается первым обменом каждого прогона и превращается в
 *    НЕИЗМЕНЯЕМУЮ policy. Разбирается один раз.
 * 2. Policy спрашивается перед КАЖДЫМ обменом — каталог, направление,
 *    объект, цель каждого редиректа. Проверить один каталог и считать, что
 *    разрешён весь сайт, — это не проверка robots, а её имитация.
 * 3. Тело читается ОГРАНИЧЕННЫМ ридером: `arrayBuffer()` сначала скачивает
 *    всё, и лимит после него не защищает ни от большого ответа, ни от
 *    бесконечного потока.
 * 4. КАЖДЫЙ фактический обмен проходит через один счётчик и одну паузу.
 */

import { deepFreeze } from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { isAllowedCodepoint } from './japan-guide-text-guard.mjs'

export const HTML_FETCH_SPEC = 'japan-guide-html-fetch/v1'

export const DECODE_POLICY = 'mixed-page-utf8-locators-v1'

export const EXPECTED_SIGNALS = deepFreeze({
  httpCharset: 'shift-jis',
  metaCharset: 'utf-8',
  contentType: 'text/html',
  decodePolicy: DECODE_POLICY,
})

/**
 * Product token — то, по чему ищется наша группа в `robots.txt`.
 *
 * Отделён от заголовка намеренно: по RFC 9309 группа именуется product
 * token'ом, а не полной строкой User-Agent. Держать их одной константой
 * значило бы, что добавление версии в заголовок молча перестанет находить
 * нашу группу.
 */
export const ROBOTS_PRODUCT_TOKEN = 'jumboinjapan-poi-discovery'

/** Заголовок: product token, версия и публичный контакт проекта. */
export const USER_AGENT = `${ROBOTS_PRODUCT_TOKEN}/1.0 (+https://jumboinjapan.com/contact)`

export const ALLOWED_SCHEME = 'https:'
export const ALLOWED_HOST = 'www.japan-guide.com'
export const ROBOTS_URL = `${ALLOWED_SCHEME}//${ALLOWED_HOST}/robots.txt`

/**
 * ЕДИНСТВЕННЫЙ источник числовых ограничений обхода.
 *
 * `maxNetworkRequests` — ОПЕРАЦИОННЫЙ ПОТОЛОК, а не верхняя граница задачи.
 * Прикидка: 1 robots + 1 каталог + 206 направлений + объекты; 25 карточек
 * измерены на ОДНОМ направлении, и доказательства, что на остальных их не 26,
 * нет. При интервале 2000 мс потолок означает до 3 часов 20 минут работы.
 * Упереться в него — законный исход: снимок станет неполным и об этом скажет.
 */
export const FETCH_LIMITS = deepFreeze({
  maxResponseBytes: 2 * 1024 * 1024,
  maxNetworkRequests: 6000,
  requestIntervalMs: 2000,
  maxRedirects: 2,
  concurrency: 1,
  retries: 0,
})

const CANONICAL_PATH = /^\/e\/e\d+[a-z]?\.html$/

/* ── Ошибки ───────────────────────────────────────────────────────────── */

export class FetchBoundaryError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FetchBoundaryError'
    this.code = code
  }
}

export class EncodingGateError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'EncodingGateError'
    this.code = code
    this.details = details
  }
}

/**
 * Отказ по robots. Отдельный класс, а не код внутри FetchBoundaryError:
 * запрет обхода обязан останавливать прогон целиком, а не превращаться в
 * очередную недоступную страницу рядом с таймаутами.
 */
export class RobotsError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'RobotsError'
    this.code = code
    this.details = details
  }
}

/* ── Канон URL ────────────────────────────────────────────────────────── */

/**
 * ЛЕКСИЧЕСКАЯ проверка ИСХОДНОЙ ссылки — до `new URL()`. Две границы:
 * тип значения и отсутствие percent-encoding.
 *
 * ТОЛЬКО СТРОКА. Проверять «`%` в ссылке» бессмысленно, если на вход можно
 * подать уже разобранный `URL`-объект: он нормализован при создании и следов
 * не хранит, а `new URL(объект, base)` его принимает.
 *
 *   new URL('https://www.japan-guide.com/destinations/a/%2e%2e/b/')
 *     .href      →  …/destinations/b/     ← «%» в строковом виде уже нет
 *     .pathname  →  /destinations/b/      ← шаблон корневого семейства проходит
 *
 * Поэтому `URL`-объект и любой иной тип отвергаются ДО разбора. Контракт всех
 * четырёх экспортов строковый: они канонизируют ТЕКСТ ссылки, а не готовый
 * объект, и принимать объект значило бы доверять чужой нормализации.
 *
 * Порядок здесь и есть вся суть. `new URL()` декодирует `%2e` в точку и
 * нормализует dot-сегменты ДО того, как путь увидит любой шаблон:
 *
 *   /destinations/a/%2e%2e/b/  →  /destinations/b/     проходит как destinationRoot
 *   /destinations/A/%2E%2E/b/  →  /destinations/b/     проходит, хотя был верхний регистр
 *   /e/x/%2e%2e/e1.html        →  /e/e1.html           проходит как legacy
 *
 * То есть неканонический адрес выдавал бы себя за канонический, и ключ
 * источника строился бы по чужому пути. Прежний комментарий здесь утверждал,
 * что обход невозможен, потому что `%2F` остаётся `%2F`; это верно только
 * для разделителя и неверно для точки — измерено 17.08.2026.
 *
 * Проверять после разбора нельзя: к тому моменту следов уже нет.
 *
 * Запрет тотальный: во всех трёх закрытых ASCII-грамматиках (`e\d+[a-z]?`,
 * slug из `[a-z0-9-]`) допустимого percent-encoding НЕТ ни одного символа,
 * поэтому «%» в ссылке всегда означает либо обход, либо чужую форму.
 *
 * В разбор robots этот запрет не переносится: там RFC 9309 предписывает
 * СОПОСТАВЛЯТЬ percent-encoding, а не отвергать его, и семантика другая.
 */
function assertNoPercentEncoding(href) {
  if (typeof href !== 'string') {
    throw new FetchBoundaryError(
      'urlUnparsable',
      `${HTML_FETCH_SPEC}: принимается только строка ссылки, получен `
      + `${href instanceof URL ? 'URL-объект' : Object.prototype.toString.call(href)}: `
      + `${String(href)}`,
    )
  }
  if (href.includes('%')) {
    throw new FetchBoundaryError(
      'urlNotCanonical',
      `${HTML_FETCH_SPEC}: percent-encoding в ссылке запрещён (обход нормализацией): ${href}`,
    )
  }
}

export function sameOriginUrl(href, base = `${ALLOWED_SCHEME}//${ALLOWED_HOST}/`) {
  let url
  try {
    url = new URL(href, base)
  } catch {
    throw new FetchBoundaryError('urlUnparsable', `${HTML_FETCH_SPEC}: адрес не разбирается: ${String(href)}`)
  }
  if (url.protocol !== ALLOWED_SCHEME) {
    throw new FetchBoundaryError('schemeDenied', `${HTML_FETCH_SPEC}: схема ${url.protocol} запрещена`)
  }
  if (url.host !== ALLOWED_HOST) {
    throw new FetchBoundaryError('hostDenied', `${HTML_FETCH_SPEC}: хост ${url.host} вне ${ALLOWED_HOST}`)
  }
  return url
}

export function canonicalPageUrl(href, base = `${ALLOWED_SCHEME}//${ALLOWED_HOST}/`) {
  assertNoPercentEncoding(href)
  const url = sameOriginUrl(href, base)
  if (url.search || url.hash) {
    throw new FetchBoundaryError('urlNotCanonical', `${HTML_FETCH_SPEC}: query и fragment запрещены: ${url.href}`)
  }
  if (!CANONICAL_PATH.test(url.pathname)) {
    throw new FetchBoundaryError('pathDenied', `${HTML_FETCH_SPEC}: путь ${url.pathname} вне /e/eNNNN.html`)
  }
  return url.href
}

export function sourceKeyFromUrl(canonicalUrl) {
  assertNoPercentEncoding(canonicalUrl)
  const match = new URL(canonicalUrl).pathname.match(/^\/e\/(e\d+[a-z]?)\.html$/)
  if (!match) {
    throw new FetchBoundaryError('pathDenied', `${HTML_FETCH_SPEC}: из ${canonicalUrl} ключ не строится`)
  }
  return `japan-guide:${match[1]}`
}

/* ── Семейства адресов ────────────────────────────────────────────────── */

/**
 * ЧЕТЫРЕ ИЗМЕРЕННЫХ СЕМЕЙСТВА. Ни одно из них не называется «формой POI»
 * по догадке: адрес роли не несёт, и это доказано измерением 17.08.2026 —
 * `/destinations/nozawa-onsen/` оказалось направлением, а
 * `/destinations/motonosumi-shrine/` той же формы — объектом.
 *
 *   legacy             `/e/eNNNN[a]?.html`                   роли разные
 *   legacySuffix       `/e/eNNNN_<suffix>.html`              измерено: объекты
 *   destinationRoot    `/destinations/<slug>/`               роль по URL не определена
 *   destinationNested  `/destinations/<parent>/<leaf>.html`  измерено: объекты
 *
 * `legacySuffix` добавлено 19.08.2026 по canary: три буквенных ссылки
 * карточек `e5025` отвергались с `pathDenied` — `/e/e5036_school.html`,
 * `/e/e5038_memorial.html` и `/e/e5036_fish.html`. В тот же день probe
 * подтвердил шесть самостоятельных объектов `/e/e3034_001.html` … `_006`.
 *
 * Суффикс закрыт двумя измеренными ветвями: `[a-z]+` либо РОВНО `\d{3}`.
 * Ни верхнего регистра, ни второго подчёркивания, ни смешанного или более
 * длинного хвоста. Форма, которой измерение не видело, остаётся отказом, а
 * не расширением по аналогии.
 *
 * Роль вычисляется структурой и живёт в `pageEvidence.pageRole`, а не здесь.
 * Ограничение `legacySuffix` до `poi` — тоже измерение; оно записано в
 * матрице ролей и проверяется свидетельством, а не формой адреса.
 */
export const URL_FAMILIES = Object.freeze([
  'legacy', 'legacySuffix', 'destinationRoot', 'destinationNested',
])

/**
 * Точка входа обхода. Единственный адрес, которому позволено быть каталогом.
 *
 * Константа живёт здесь, рядом с остальными адресами источника: без неё роль
 * `catalogue` мог бы получить любой legacy-адрес, и подложное свидетельство
 * объявило бы каталогом произвольную страницу.
 */
export const CATALOGUE_ENTRY_URL = `${ALLOWED_SCHEME}//${ALLOWED_HOST}/e/e623a.html`

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*'
const LEGACY_PATH = new RegExp('^/e/(e\\d+[a-z]?)\\.html$')
/* Ровно одно подчёркивание; после него строчные буквы либо ровно три цифры. */
const LEGACY_SUFFIX_PATH = new RegExp('^/e/(e\\d+_(?:[a-z]+|\\d{3}))\\.html$')
const ROOT_PATH = new RegExp(`^/destinations/(${SLUG})/$`)
const NESTED_PATH = new RegExp(`^/destinations/(${SLUG})/(${SLUG})\\.html$`)

/**
 * Канонический адрес любого из трёх семейств.
 *
 * `canonicalPageUrl` намеренно НЕ расширен: он охраняет идентичность прежних
 * артефактов, и добавить в него новые семейства значило бы задним числом
 * изменить смысл уже сохранённых планов и фикстур.
 *
 * Только нижний регистр, обязательный вид завершения, без query и fragment.
 * Percent-encoding отвергается лексически, ДО разбора: см.
 * `assertNoPercentEncoding` — иначе `%2e%2e` нормализуется в dot-сегмент и
 * неканонический адрес проходит как канонический.
 */
export function canonicalDiscoveryUrl(href, base = `${ALLOWED_SCHEME}//${ALLOWED_HOST}/`) {
  assertNoPercentEncoding(href)
  const url = sameOriginUrl(href, base)
  if (url.search || url.hash) {
    throw new FetchBoundaryError('urlNotCanonical', `${HTML_FETCH_SPEC}: query и fragment запрещены: ${url.href}`)
  }
  const path = url.pathname
  if (LEGACY_PATH.test(path)) return { url: url.href, family: 'legacy' }
  if (LEGACY_SUFFIX_PATH.test(path)) return { url: url.href, family: 'legacySuffix' }
  if (ROOT_PATH.test(path)) return { url: url.href, family: 'destinationRoot' }
  if (NESTED_PATH.test(path)) return { url: url.href, family: 'destinationNested' }
  throw new FetchBoundaryError('pathDenied', `${HTML_FETCH_SPEC}: путь ${path} не принадлежит ни одному измеренному семейству`)
}

/**
 * Ключ описывает ПУТЬ страницы, а не её роль.
 *
 * Роль определяется содержимым и может измениться независимо от адреса;
 * держать её в ключе значило бы показывать смену роли как исчезновение
 * одного объекта и появление другого. Одинаковые вложенные сегменты не
 * схлопываются — они занимают разные позиции в пути.
 */
export function discoverySourceKey(canonicalUrl) {
  assertNoPercentEncoding(canonicalUrl)
  const path = new URL(canonicalUrl).pathname
  const legacy = path.match(LEGACY_PATH)
  if (legacy) return `japan-guide:${legacy[1]}`
  /* Ключ несёт суффикс целиком: `e5036_school` и `e5036_fish` — разные
     страницы, и схлопывать их к `e5036` значило бы объявить один объект
     двумя именами одного. */
  const suffix = path.match(LEGACY_SUFFIX_PATH)
  if (suffix) return `japan-guide:${suffix[1]}`
  const root = path.match(ROOT_PATH)
  if (root) return `japan-guide:destinations:${root[1]}`
  const nested = path.match(NESTED_PATH)
  if (nested) return `japan-guide:destinations:${nested[1]}:${nested[2]}`
  throw new FetchBoundaryError('pathDenied', `${HTML_FETCH_SPEC}: из ${canonicalUrl} ключ не строится`)
}

/**
 * ОБРАТНЫЙ РАЗБОР: ключ источника → семейство адресов.
 *
 * В снимке полно мест, где от страницы остался ОДИН КЛЮЧ и никакого адреса:
 * `orderRecord.order[]`, `rejected.targets[].ref`, `rejected.pois[].ref`,
 * `rejected.cards[].destination`. Проверка семейства стояла только там, где
 * адрес есть, — и ключ нового семейства проходил в снимок старого формата
 * мимо неё.
 *
 * ВТОРОГО НАБОРА ВЫРАЖЕНИЙ ЗДЕСЬ НЕТ. Из ключа собирается КАНДИДАТ-АДРЕС по
 * форме пути, он прогоняется через ту же `canonicalDiscoveryUrl`, и ответ
 * принимается, только если `discoverySourceKey` вернёт исходный ключ
 * ПОБУКВЕННО. Круг и есть проверка: ключ, которого грамматика адресов
 * построить не умеет, круга не замыкает, и ошибка в шаблоне ниже ложного
 * «да» дать не может — она даст расхождение и отказ.
 *
 * Возвращает `{ ok: true, family }` либо `{ ok: false }`. Исключений не
 * бросает: у вызывающих разные ярлыки и разные сообщения.
 */
export function sourceKeyFamily(sourceKey) {
  if (typeof sourceKey !== 'string') return { ok: false }
  const parts = sourceKey.split(':')
  if (parts[0] !== 'japan-guide') return { ok: false }
  let path = null
  if (parts.length === 2) {
    /* Одна форма пути на оба legacy-семейства: какое именно — решает
       грамматика, а не этот код. */
    path = `/e/${parts[1]}.html`
  } else if (parts.length === 3 && parts[1] === 'destinations') {
    path = `/destinations/${parts[2]}/`
  } else if (parts.length === 4 && parts[1] === 'destinations') {
    path = `/destinations/${parts[2]}/${parts[3]}.html`
  }
  if (path === null) return { ok: false }
  try {
    const { url, family } = canonicalDiscoveryUrl(`${ALLOWED_SCHEME}//${ALLOWED_HOST}${path}`)
    if (discoverySourceKey(url) !== sourceKey) return { ok: false }
    return { ok: true, family }
  } catch {
    return { ok: false }
  }
}

/* ── robots.txt: разбор и policy по RFC 9309 ──────────────────────────── */

/**
 * Разбор в группы. Последовательные строки `User-agent` до первого правила
 * образуют ОДНУ группу с несколькими именами — так устроен формат.
 */
export function parseRobots(text) {
  const groups = []
  let current = null
  let expectingAgents = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (field === 'user-agent') {
      if (!expectingAgents || !current) {
        current = { agents: [], allow: [], disallow: [] }
        groups.push(current)
        expectingAgents = true
      }
      current.agents.push(value.toLowerCase())
      continue
    }
    if (!current) continue
    expectingAgents = false
    if (field === 'disallow') current.disallow.push(value)
    else if (field === 'allow') current.allow.push(value)
  }
  return groups
}

/**
 * Нормализация percent-encoding по RFC 3986: незарезервированные символы
 * раскодируются, остальные приводятся к верхнему регистру шестнадцатеричных
 * цифр. Применяется и к правилу, и к пути — иначе `/e/%65` и `/e/e`
 * сравнивались бы как разные.
 */
function normalisePercent(value) {
  return value.replace(/%[0-9a-fA-F]{2}/g, (match) => {
    const character = String.fromCharCode(Number.parseInt(match.slice(1), 16))
    return /[A-Za-z0-9\-._~]/.test(character) ? character : match.toUpperCase()
  })
}

/**
 * Шаблон правила в регулярное выражение по RFC 9309.
 *
 * Специальны ровно два символа: `*` — любая последовательность, и `$` в
 * КОНЦЕ — конец пути. `$` в середине литерален. Всё прочее сравнивается
 * буквально, поэтому экранируется.
 */
export function robotsRuleToRegExp(rule) {
  let body = rule
  let anchorEnd = false
  if (body.endsWith('$')) {
    body = body.slice(0, -1)
    anchorEnd = true
  }
  const source = body
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}${anchorEnd ? '$' : ''}`)
}

/**
 * Неизменяемая policy: правила разобраны один раз, дальше только вопросы.
 *
 * Группы выбираются по RFC 9309: объединяются ВСЕ группы, совпавшие с нашим
 * product token; `*` применяется только если именной группы нет вовсе.
 * Прежняя версия проверяла обе сразу и могла отвергнуть путь, который
 * владелец сайта явно разрешил нашему агенту.
 */
export function buildRobotsPolicy(text, { productToken = ROBOTS_PRODUCT_TOKEN } = {}) {
  const groups = parseRobots(text)
  const token = productToken.toLowerCase()
  const named = groups.filter((group) => group.agents.includes(token))
  const applicable = named.length ? named : groups.filter((group) => group.agents.includes('*'))
  const rules = []
  for (const group of applicable) {
    for (const pattern of group.allow) {
      if (pattern === '') continue
      rules.push({ kind: 'allow', pattern, length: pattern.length, test: robotsRuleToRegExp(normalisePercent(pattern)) })
    }
    for (const pattern of group.disallow) {
      if (pattern === '') continue
      rules.push({ kind: 'disallow', pattern, length: pattern.length, test: robotsRuleToRegExp(normalisePercent(pattern)) })
    }
  }
  const appliedGroups = [...new Set(applicable.flatMap((group) => group.agents))]
    .sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')))
  const source = named.length ? 'product-token' : (applicable.length ? 'wildcard' : 'none')

  const allows = (pathWithQuery) => {
    const path = normalisePercent(pathWithQuery)
    let bestAllow = -1
    let bestDisallow = -1
    let deniedBy = null
    for (const rule of rules) {
      if (!rule.test.test(path)) continue
      if (rule.kind === 'allow') bestAllow = Math.max(bestAllow, rule.length)
      else if (rule.length > bestDisallow) { bestDisallow = rule.length; deniedBy = rule.pattern }
    }
    /* При равной длине выигрывает Allow — как предписывает RFC. */
    const allowed = bestDisallow < 0 || bestAllow >= bestDisallow
    return { allowed, deniedBy: allowed ? null : deniedBy }
  }

  return deepFreeze({
    appliedGroups,
    source,
    ruleCount: rules.length,
    allows,
    /** Спрашивается перед каждым обменом. Отказ останавливает прогон. */
    assertAllowed(url) {
      const parsed = new URL(url)
      const verdict = allows(`${parsed.pathname}${parsed.search}`)
      if (!verdict.allowed) {
        throw new RobotsError(
          'robotsDenied',
          `${HTML_FETCH_SPEC}: robots.txt запрещает ${parsed.pathname} правилом «${verdict.deniedBy}»`,
          { url, deniedBy: verdict.deniedBy, appliedGroups },
        )
      }
    },
  })
}

/* ── Ограниченное чтение тела ─────────────────────────────────────────── */

export async function readBoundedBody(response, maxBytes) {
  const body = response.body
  if (!body || typeof body.getReader !== 'function') {
    throw new FetchBoundaryError('bodyMissing', `${HTML_FETCH_SPEC}: у ответа нет читаемого тела`)
  }
  const reader = body.getReader()
  const chunks = []
  let total = 0
  const abandon = () => {
    try {
      const cancelled = reader.cancel()
      if (cancelled && typeof cancelled.catch === 'function') cancelled.catch(() => {})
    } catch { /* отмена — вежливость, а не условие отказа */ }
  }
  for (;;) {
    let step
    try {
      step = await reader.read()
    } catch (error) {
      abandon()
      throw new FetchBoundaryError('bodyReadFailed', `${HTML_FETCH_SPEC}: чтение тела прервано: ${error.message}`)
    }
    if (step.done) break
    const chunk = step.value instanceof Uint8Array ? step.value : new Uint8Array(step.value)
    total += chunk.byteLength
    if (total > maxBytes) {
      abandon()
      throw new FetchBoundaryError(
        'responseTooLarge',
        `${HTML_FETCH_SPEC}: тело превысило ${maxBytes} байт, чтение остановлено`,
      )
    }
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

/* ── Гейт S-ENC ───────────────────────────────────────────────────────── */

export function parseContentType(headerValue) {
  if (typeof headerValue !== 'string' || !headerValue.length) {
    throw new EncodingGateError('contentTypeMissing', `${HTML_FETCH_SPEC}: Content-Type отсутствует`)
  }
  const [rawType, ...params] = headerValue.split(';')
  const type = rawType.trim().toLowerCase()
  let charset = null
  for (const param of params) {
    const [name, ...rest] = param.split('=')
    if (name.trim().toLowerCase() !== 'charset') continue
    charset = rest.join('=').trim().replace(/^["']|["']$/g, '').toLowerCase()
  }
  return { type, charset }
}

export function scanCharsetDeclarations(bytes) {
  let ascii = ''
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    ascii += byte < 0x80 ? String.fromCharCode(byte) : ' '
  }
  const metaTags = ascii.match(/<meta\b[^>]*>/gi) ?? []
  const charsetMetas = []
  const httpEquivMetas = []
  for (const tag of metaTags) {
    const isHttpEquiv = /http-equiv\s*=\s*["']?content-type/i.test(tag)
    const charset = tag.match(/charset\s*=\s*["']?\s*([A-Za-z0-9_:.-]+)/i)
    if (!charset) continue
    if (isHttpEquiv) httpEquivMetas.push(charset[1].toLowerCase())
    else charsetMetas.push(charset[1].toLowerCase())
  }
  return { charsetMetas, httpEquivMetas }
}

export function countUtf8Errors(bytes) {
  let errors = 0
  let index = 0
  while (index < bytes.length) {
    const lead = bytes[index]
    if (lead < 0x80) { index += 1; continue }
    let needed = 0
    let lower = 0x80
    let upper = 0xbf
    if (lead >= 0xc2 && lead <= 0xdf) needed = 1
    else if (lead === 0xe0) { needed = 2; lower = 0xa0 }
    else if (lead >= 0xe1 && lead <= 0xec) needed = 2
    else if (lead === 0xed) { needed = 2; upper = 0x9f }
    else if (lead >= 0xee && lead <= 0xef) needed = 2
    else if (lead === 0xf0) { needed = 3; lower = 0x90 }
    else if (lead >= 0xf1 && lead <= 0xf3) needed = 3
    else if (lead === 0xf4) { needed = 3; upper = 0x8f }
    else { errors += 1; index += 1; continue }
    let consumed = 1
    let valid = true
    for (let offset = 1; offset <= needed; offset += 1) {
      const byte = bytes[index + offset]
      const low = offset === 1 ? lower : 0x80
      const high = offset === 1 ? upper : 0xbf
      if (byte === undefined || byte < low || byte > high) { valid = false; break }
      consumed += 1
    }
    if (valid) { index += needed + 1; continue }
    errors += 1
    index += consumed
  }
  return errors
}

const REPLACEMENT = '�'
const COMMENT_SPAN = /<!--[\s\S]*?-->/g

/**
 * Кодовые точки страницы, которые были бы отвергнуты внутри значения.
 *
 * Пробельные и замены не считаются: у первых нет пути до алфавита, у вторых
 * свой счётчик. Комментарии исключаются: их язык — свойство автора страницы.
 *
 * ГРАНИЦА: счётчик работает по декодированному тексту и сущности разметки не
 * раскрывает. Он не защита — защита это алфавит на КАЖДОМ значении.
 */
export function countNonWhitelisted(text) {
  let count = 0
  for (const character of text.replace(COMMENT_SPAN, ' ')) {
    const codepoint = character.codePointAt(0)
    if (codepoint === 0xfffd) continue
    if (/\s/u.test(character)) continue
    if (!isAllowedCodepoint(codepoint)) count += 1
  }
  return count
}

export function applyEncodingGate({ contentType, bytes }) {
  const parsed = parseContentType(contentType)
  if (parsed.type !== EXPECTED_SIGNALS.contentType) {
    throw new EncodingGateError('contentTypeDenied', `${HTML_FETCH_SPEC}: тип ${parsed.type} не ${EXPECTED_SIGNALS.contentType}`)
  }
  if (parsed.charset !== EXPECTED_SIGNALS.httpCharset) {
    throw new EncodingGateError(
      'httpCharsetChanged',
      `${HTML_FETCH_SPEC}: HTTP charset «${parsed.charset}» вместо наблюдённого «${EXPECTED_SIGNALS.httpCharset}»`,
    )
  }
  const { charsetMetas, httpEquivMetas } = scanCharsetDeclarations(bytes)
  if (httpEquivMetas.length) {
    throw new EncodingGateError('metaChannelChanged',
      `${HTML_FETCH_SPEC}: появился второй канал объявления кодировки (http-equiv)`)
  }
  if (charsetMetas.length !== 1) {
    throw new EncodingGateError('metaCharsetCountChanged',
      `${HTML_FETCH_SPEC}: объявлений <meta charset> ${charsetMetas.length}, ожидается ровно одно`)
  }
  if (charsetMetas[0] !== EXPECTED_SIGNALS.metaCharset) {
    throw new EncodingGateError('metaCharsetChanged',
      `${HTML_FETCH_SPEC}: <meta charset> «${charsetMetas[0]}» вместо наблюдённого «${EXPECTED_SIGNALS.metaCharset}»`)
  }

  const text = new TextDecoder('utf-8').decode(bytes)
  const decodeErrorCount = countUtf8Errors(bytes)
  let decodeReplacements = 0
  for (const character of text) if (character === REPLACEMENT) decodeReplacements += 1
  if (decodeErrorCount !== decodeReplacements) {
    throw new EncodingGateError(
      'replacementCountMismatch',
      `${HTML_FETCH_SPEC}: ошибок декодирования ${decodeErrorCount}, замен ${decodeReplacements} — `
      + 'замена перестала помечать отказ',
      { decodeErrorCount, decodeReplacements },
    )
  }
  return {
    text,
    diagnostics: {
      httpCharset: parsed.charset,
      metaCharset: charsetMetas[0],
      decodePolicy: DECODE_POLICY,
      decodeErrorCount,
      decodeReplacements,
      nonWhitelistedCodepoints: countNonWhitelisted(text),
    },
  }
}

/* ── Темп и учёт обменов ──────────────────────────────────────────────── */

export function createRequestPacer({ limits = FETCH_LIMITS, sleep = null } = {}) {
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  let networkRequests = 0
  let previousAt = null
  const requested = new Set()
  return {
    get networkRequests() { return networkRequests },
    get remaining() { return limits.maxNetworkRequests - networkRequests },
    fits(count) { return limits.maxNetworkRequests - networkRequests >= count },
    async take(url, clock) {
      if (requested.has(url)) {
        throw new FetchBoundaryError('urlRepeated', `${HTML_FETCH_SPEC}: повторный запрос ${url}`)
      }
      if (networkRequests >= limits.maxNetworkRequests) {
        throw new FetchBoundaryError('networkBudgetExhausted',
          `${HTML_FETCH_SPEC}: исчерпан бюджет обменов ${limits.maxNetworkRequests}`)
      }
      const now = clock()
      if (previousAt !== null) {
        const elapsed = now - previousAt
        if (elapsed < limits.requestIntervalMs) await wait(limits.requestIntervalMs - elapsed)
      }
      previousAt = clock()
      networkRequests += 1
      requested.add(url)
    },
  }
}

/* ── Запросы ──────────────────────────────────────────────────────────── */

const requestInit = () => ({
  method: 'GET',
  redirect: 'manual',
  cache: 'no-store',
  headers: { 'user-agent': USER_AGENT },
})

/**
 * `robots.txt` — первый обмен каждого прогона.
 *
 * Редиректы НЕ допускаются: снимок обязан ссылаться ровно на канонический
 * адрес robots, а не на то, куда нас увели. Недоступный, негодный или
 * запрещающий robots останавливает прогон до первого HTML. Стандарт
 * трактует 4xx как «можно всё»; здесь это отказ — временное исчезновение
 * файла остановит расписание, а не откроет обход.
 */
export async function fetchRobots({ fetchImpl, now, pacer, clock, limits = FETCH_LIMITS }) {
  await pacer.take(ROBOTS_URL, clock)
  const response = await fetchImpl(ROBOTS_URL, requestInit())
  if (response.status !== 200) {
    throw new RobotsError('robotsUnavailable', `${HTML_FETCH_SPEC}: robots.txt отдал ${response.status}`)
  }
  const bytes = await readBoundedBody(response, limits.maxResponseBytes)
  for (const byte of bytes) {
    if (byte >= 0x80) {
      throw new RobotsError('robotsNotAscii', `${HTML_FETCH_SPEC}: robots.txt содержит не-ASCII байты`)
    }
  }
  const policy = buildRobotsPolicy(new TextDecoder('utf-8').decode(bytes))
  return {
    policy,
    evidence: {
      url: ROBOTS_URL,
      bytes: bytes.length,
      digest: sha256Bytes(bytes),
      observedAt: now().toISOString(),
      appliedGroups: policy.appliedGroups,
    },
  }
}

/**
 * Один HTML-документ под всеми ограничениями и гейтом.
 *
 * `robots.assertAllowed` спрашивается перед КАЖДЫМ обменом, включая цель
 * каждого редиректа: сайт вправе увести нас на запрещённый путь, и проверка
 * только исходного адреса этого не поймает.
 */
export async function fetchHtmlPage({ url, fetchImpl, now, pacer, clock, robots, limits = FETCH_LIMITS }) {
  if (!robots || typeof robots.assertAllowed !== 'function') {
    throw new RobotsError('robotsPolicyMissing', `${HTML_FETCH_SPEC}: обход без policy robots невозможен`)
  }
  /*
   * Сетевая граница принимает ВСЕ ТРИ измеренных семейства. Прежде здесь
   * стоял `canonicalPageUrl`, и корневая либо вложенная цель отвергалась с
   * `pathDenied` ещё до обмена — обход до части источника не доходил.
   *
   * `canonicalPageUrl` при этом не расширен: он охраняет идентичность
   * прежних артефактов и остаётся legacy-only.
   */
  let target = canonicalDiscoveryUrl(url).url
  let response = null
  for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
    robots.assertAllowed(target)
    await pacer.take(target, clock)
    response = await fetchImpl(target, requestInit())
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) {
        throw new FetchBoundaryError('redirectWithoutLocation', `${HTML_FETCH_SPEC}: ${response.status} без Location`)
      }
      if (hop === limits.maxRedirects) {
        throw new FetchBoundaryError('redirectLimit', `${HTML_FETCH_SPEC}: превышен лимит редиректов ${limits.maxRedirects}`)
      }
      target = canonicalDiscoveryUrl(location, target).url
      continue
    }
    break
  }
  if (response.status !== 200) {
    throw new FetchBoundaryError('statusDenied', `${HTML_FETCH_SPEC}: статус ${response.status} для ${target}`)
  }
  const bytes = await readBoundedBody(response, limits.maxResponseBytes)
  const { text, diagnostics } = applyEncodingGate({
    contentType: response.headers.get('content-type'),
    bytes,
  })
  return {
    url: target,
    text,
    pageBytes: bytes.length,
    rawPageDigest: sha256Bytes(bytes),
    observedAt: now().toISOString(),
    diagnostics,
  }
}
