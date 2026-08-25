/**
 * Гейт кодировки, robots, сетевая граница, разбор и обход japan-guide.
 *
 * НИ ОДНОГО СЕТЕВОГО ЗАПРОСА. `fetchImpl` подставляется тестом, байты
 * страниц собираются из синтетических фикстур, в которых нет ни строки с
 * сайта — воспроизведена только измеренная структура.
 */
import { readFileSync } from 'node:fs'
import { canonicalJsonBytes } from '../scripts/lib/canonical-contract.mjs'
import { sha256Bytes } from '../scripts/lib/byte-digest.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DECODE_POLICY,
  EXPECTED_SIGNALS,
  FETCH_LIMITS,
  ROBOTS_PRODUCT_TOKEN,
  ROBOTS_URL,
  URL_FAMILIES,
  USER_AGENT,
  applyEncodingGate,
  buildRobotsPolicy,
  canonicalDiscoveryUrl,
  canonicalPageUrl,
  countUtf8Errors,
  createRequestPacer,
  discoverySourceKey,
  fetchHtmlPage,
  parseRobots,
  readBoundedBody,
  robotsRuleToRegExp,
  sourceKeyFromUrl,
} from '../scripts/poi-portals/lib/html-fetch.mjs'
import { load } from 'cheerio'
import { createHash } from 'node:crypto'
import {
  PageRoleError,
  SELECTORS,
  CONTAINER_MIN_CHILDREN,
  analysePage,
  classifyPageRole,
  collectJapanGuideDiscovery,
  detectContainerChildren,
  diffDiscoverySnapshot,
  hasPositiveRank,
  parseAttraction,
  parseCatalogue,
  parseDestination,
  selectCollectionStructure,
} from '../scripts/poi-portals/lib/japan-guide-html.mjs'
import {
  CATALOGUE_SOURCE_KEY,
  PAGE_REJECTION_CODES,
  PAGE_ROLE_CODES,
  assertDiscoveryRecord,
  assertDiscoverySnapshot,
  buildDiscoveryRecord,
  buildDiscoverySnapshot,
  buildOrderRecord,
  buildPageEvidence,
  buildPlacement,
  orderDigest,
  orderItem,
  compareUtf8,
  orderedPoiKeys,
  ORDER_SPEC_V2,
  ORDER_SPEC_V3,
  SNAPSHOT_SPEC,
  SNAPSHOT_SPEC_V2,
} from '../scripts/poi-portals/lib/discovery-contract.mjs'

/**
 * ПОРЯДОК ИЗ ОДНИХ ОБЪЕКТОВ — форма, в которой этот набор строит фикстуры.
 *
 * v3 требует роль у каждого элемента порядка; помощник её называет, а не
 * подразумевает. Смешанные порядки — с элементами-коллекциями — строятся
 * через buildOrderRecord напрямую и перечисляют роли поимённо.
 */
const poiItems = (keys) => keys.map((sourceKey) => orderItem('poi', sourceKey))
const poiOrderDigest = (destinationSourceKey, sourcePageDigest, keys, collectionKind) =>
  orderDigest(
    { destinationSourceKey, sourcePageDigest, collectionKind, items: poiItems(keys) },
    ORDER_SPEC_V3,
  )
import {
  CANARY_ACCEPTANCE_CODES,
  EXPECTED_NUMERIC_SUFFIX_KEYS,
  evaluateJapanGuideCanaryAcceptance,
} from '../scripts/poi-portals/lib/japan-guide-canary-acceptance.mjs'
import { assertDiscoveryBoundary, main } from '../scripts/poi-portals/collect-pois.mjs'
import { getPortal } from '../scripts/poi-portals/registry.mjs'
import { compileLinkPatterns, selectSampleLinks } from '../scripts/poi-portals/profile-sources.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures/japan-guide', name), 'utf8')

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (Object.is(actual, expected)) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const eq = (label, a, b) => t(label, JSON.stringify(a), JSON.stringify(b))
const throwsWith = (label, fn, expect) => {
  try {
    fn()
    bad.push(`${label}: ждали отказ ${expect ?? ''}, вызов прошёл`)
  } catch (error) {
    if (error.forgeFailed) {
      /* Ошибка САМОЙ подделки неотличима от отказа проверки, если её не
         пометить: тест зеленел бы, ничего не проверив. */
      bad.push(`${label}: ${error.message}`)
    } else if (expect === undefined || error.code === expect) {
      ok++
    } else if (typeof expect === 'string' && String(error.message).includes(expect)) {
      ok++
    } else {
      bad.push(`${label}: ждали ${expect}, получили ${error.code ?? error.name}: ${error.message}`)
    }
  }
}
const rejectsWith = async (label, fn, code) => {
  try {
    await fn()
    bad.push(`${label}: ждали отказ ${code ?? ''}, вызов прошёл`)
  } catch (error) {
    if (code === undefined || error.code === code) ok++
    else bad.push(`${label}: ждали код ${code}, получили ${error.code ?? error.name}: ${error.message}`)
  }
}
const finish = () => {
  if (bad.length) {
    console.error(`Japan Guide discovery: ${bad.length} провалов из ${ok + bad.length}`)
    for (const line of bad) console.error(`  ✗ ${line}`)
    process.exit(1)
  }
  console.log(`Japan Guide discovery: ${ok} проверок пройдено`)
}

const CATALOGUE = fixture('catalogue.html')
const DESTINATION = fixture('destination.html')
const ATTRACTION = fixture('attraction.html')

/** Каталог без адресов непригодной формы — для проверки ПОЛНОГО снимка. */
const CATALOGUE_CLEAN = CATALOGUE
  .replace('<a href="/local/e9999.html">Path outside /e/, must be refused</a>', '')
  .replace('<a href="https://example.org/e/e1004.html">Foreign host, must be refused</a>', '')
  .replace('<a href="/e/e1005.html?utm=1">Query string, must be refused</a>', '')

const HOST = 'https://www.japan-guide.com'
const ENTRY = `${HOST}/e/e623a.html`
const NOW = () => new Date('2026-08-17T00:00:00.000Z')

const ROBOTS_OK = 'User-agent: Googlebot\nDisallow:\n\nUser-agent: *\nDisallow: /local/\n'
const ROBOTS_DENY_ALL = 'User-agent: *\nDisallow: /\n'
const PERMISSIVE = buildRobotsPolicy(ROBOTS_OK)

/* ── Байты и ответы ───────────────────────────────────────────────────── */

const SHIFT_JIS_ISLAND = Buffer.from([0x91, 0xe5, 0x8d, 0xe3, 0x8f, 0xe9])

function bytesOf(html, { island = false, extra = null } = {}) {
  const marker = 'the local name in brackets'
  const parts = island && html.includes(marker)
    ? [
      Buffer.from(html.slice(0, html.indexOf(marker)), 'utf8'),
      SHIFT_JIS_ISLAND,
      Buffer.from(html.slice(html.indexOf(marker)), 'utf8'),
    ]
    : [Buffer.from(html, 'utf8')]
  if (extra) parts.push(extra)
  return new Uint8Array(Buffer.concat(parts))
}

const streamOf = (bytes) => new ReadableStream({
  start(controller) { controller.enqueue(bytes); controller.close() },
})

const response = (bytes, { status = 200, contentType = 'text/html; charset=shift-jis', location = null, body } = {}) => ({
  status,
  headers: { get: (name) => ({ 'content-type': contentType, location }[String(name).toLowerCase()] ?? null) },
  body: body === undefined ? streamOf(bytes) : body,
})

const router = (pages, { robots = ROBOTS_OK, log = null, robotsStatus = 200 } = {}) => async (url, init) => {
  if (log) log.push({ url, userAgent: init?.headers?.['user-agent'] ?? null })
  if (url === ROBOTS_URL) {
    return response(new Uint8Array(Buffer.from(robots, 'utf8')), { contentType: 'text/plain', status: robotsStatus })
  }
  const html = pages.get(url)
  if (!html) return response(new Uint8Array(0), { status: 404 })
  return response(bytesOf(html))
}

const PAGES = new Map([
  [ENTRY, CATALOGUE_CLEAN],
  [`${HOST}/e/e1001.html`, DESTINATION],
  [`${HOST}/e/e1002.html`, DESTINATION],
  [`${HOST}/e/e1003a.html`, DESTINATION],
  [`${HOST}/e/e2001.html`, ATTRACTION],
  [`${HOST}/e/e2002.html`, ATTRACTION],
])
const PORTAL = { id: 'fixture-japan-guide', discovery: { entry: ENTRY } }
const crawl = (over = {}) => collectJapanGuideDiscovery(PORTAL, {
  fetchImpl: router(PAGES),
  now: NOW,
  sleep: async () => {},
  ...over,
})

/* ── Гейт S-ENC ───────────────────────────────────────────────────────── */

t('политика названа', DECODE_POLICY, 'mixed-page-utf8-locators-v1')
eq('ожидаемые сигналы', { ...EXPECTED_SIGNALS }, {
  httpCharset: 'shift-jis', metaCharset: 'utf-8', contentType: 'text/html', decodePolicy: DECODE_POLICY,
})

const islandBytes = bytesOf(ATTRACTION, { island: true })
const gated = applyEncodingGate({ contentType: 'text/html; charset=shift-jis', bytes: islandBytes })
t('островок Shift_JIS даёт четыре ошибки', gated.diagnostics.decodeErrorCount, 4)
t('и ровно столько же замен', gated.diagnostics.decodeReplacements, 4)
t('два независимых прохода сошлись', countUtf8Errors(islandBytes), gated.diagnostics.decodeReplacements)
t('кандзи в тексте не появились', /[一-鿿]/u.test(gated.text), false)

const clean = applyEncodingGate({ contentType: 'text/html; charset=shift-jis', bytes: bytesOf(ATTRACTION) })
t('без островка ошибок нет', clean.diagnostics.decodeErrorCount, 0)
t('и посторонних кодовых точек тоже', clean.diagnostics.nonWhitelistedCodepoints, 0)
t('сущность разметки счётчиком страницы не видна', applyEncodingGate({
  contentType: 'text/html; charset=shift-jis', bytes: bytesOf(DESTINATION),
}).diagnostics.nonWhitelistedCodepoints, 0)
t('та же звезда буквальными байтами — видна', applyEncodingGate({
  contentType: 'text/html; charset=shift-jis',
  bytes: bytesOf(DESTINATION.replace('&#9733;&#9733;&#9733;&#9733;&#9733;', '★★★★★')),
}).diagnostics.nonWhitelistedCodepoints, 5)

throwsWith('чужой HTTP charset — отказ', () => applyEncodingGate({
  contentType: 'text/html; charset=utf-8', bytes: bytesOf(ATTRACTION) }), 'httpCharsetChanged')
throwsWith('чужой тип — отказ', () => applyEncodingGate({
  contentType: 'application/xhtml+xml; charset=shift-jis', bytes: bytesOf(ATTRACTION) }), 'contentTypeDenied')
throwsWith('нет Content-Type — отказ', () => applyEncodingGate({
  contentType: null, bytes: bytesOf(ATTRACTION) }), 'contentTypeMissing')
throwsWith('два объявления meta — отказ', () => applyEncodingGate({
  contentType: 'text/html; charset=shift-jis',
  bytes: bytesOf(ATTRACTION.replace('<title>', '<meta charset="utf-8"><title>')) }), 'metaCharsetCountChanged')
throwsWith('второй канал объявления — отказ', () => applyEncodingGate({
  contentType: 'text/html; charset=shift-jis',
  bytes: bytesOf(ATTRACTION.replace('<title>', '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>')) }),
'metaChannelChanged')
throwsWith('чужой meta charset — отказ', () => applyEncodingGate({
  contentType: 'text/html; charset=shift-jis',
  bytes: bytesOf(ATTRACTION.replace('<meta charset="UTF-8">', '<meta charset="shift-jis">')) }), 'metaCharsetChanged')
t('нижний регистр meta принимается', applyEncodingGate({
  contentType: 'text/html; charset=shift-jis',
  bytes: bytesOf(ATTRACTION.replace('<meta charset="UTF-8">', '<meta charset="utf-8">')),
}).diagnostics.metaCharset, 'utf-8')
throwsWith('замена из самих байтов — отказ', () => applyEncodingGate({
  contentType: 'text/html; charset=shift-jis',
  bytes: bytesOf(ATTRACTION, { extra: Buffer.from([0xef, 0xbf, 0xbd]) }) }), 'replacementCountMismatch')

/* ── robots: разбор, шаблоны RFC 9309, выбор групп ────────────────────── */

t('токен и заголовок разделены', USER_AGENT.startsWith(`${ROBOTS_PRODUCT_TOKEN}/`), true)
t('в заголовке есть контакт проекта', USER_AGENT.includes('https://jumboinjapan.com/contact'), true)
eq('группы robots разбираются', parseRobots(ROBOTS_OK).map((g) => g.agents), [['googlebot'], ['*']])
t('несколько User-agent подряд — одна группа', parseRobots('User-agent: a\nUser-agent: b\nDisallow: /x\n').length, 1)
t('комментарии отбрасываются', parseRobots('# note\nUser-agent: *\nDisallow: /x # tail\n')[0].disallow[0], '/x')

t('звёздочка в шаблоне', robotsRuleToRegExp('/e/*.html').test('/e/e1.html'), true)
t('точка в шаблоне литеральна', robotsRuleToRegExp('/e/a.html').test('/e/aXhtml'), false)
t('знак доллара в конце — якорь', robotsRuleToRegExp('/e/e1.html$').test('/e/e1.htmlx'), false)
t('и он же не мешает точному совпадению', robotsRuleToRegExp('/e/e1.html$').test('/e/e1.html'), true)

/** Контрпример владельца: каталог разрешён, направления запрещены. */
const OWNER_CASE = `User-agent: *\nDisallow:\n\nUser-agent: ${ROBOTS_PRODUCT_TOKEN}\nAllow: /e/e623a.html\nDisallow: /e/e2\n`
const ownerPolicy = buildRobotsPolicy(OWNER_CASE)
eq('контрпример владельца воспроизведён', {
  catalogue: ownerPolicy.allows('/e/e623a.html').allowed,
  destination: ownerPolicy.allows('/e/e2157.html').allowed,
  wildcard: buildRobotsPolicy('User-agent: *\nDisallow:\n').allows('/e/e2157.html').allowed,
  empty: buildRobotsPolicy('').allows('/e/e2157.html').allowed,
}, { catalogue: true, destination: false, wildcard: true, empty: true })

t('шаблон /e/*.html$ запрещает страницу',
  buildRobotsPolicy('User-agent: *\nDisallow: /e/*.html$\n').allows('/e/e2001.html').allowed, false)
t('и не трогает другое расширение',
  buildRobotsPolicy('User-agent: *\nDisallow: /e/*.html$\n').allows('/e/x.htm').allowed, true)
t('percent-encoding нормализуется',
  buildRobotsPolicy('User-agent: *\nDisallow: /%65/\n').allows('/e/x.html').allowed, false)
t('Allow длиннее Disallow выигрывает',
  buildRobotsPolicy('User-agent: *\nDisallow: /e/\nAllow: /e/e623a.html\n').allows('/e/e623a.html').allowed, true)
t('при равной длине выигрывает Allow',
  buildRobotsPolicy('User-agent: *\nDisallow: /e/\nAllow: /e/\n').allows('/e/e1.html').allowed, true)
t('пустой Disallow ничего не запрещает',
  buildRobotsPolicy('User-agent: *\nDisallow:\n').allows('/e/e1.html').allowed, true)

/* По RFC 9309 объединяются группы, совпавшие с product token; `*` берётся
   только при отсутствии именной группы. Прежняя логика проверяла обе и могла
   отвергнуть путь, который владелец сайта явно нам разрешил. */
const named = buildRobotsPolicy(`User-agent: *\nDisallow: /\n\nUser-agent: ${ROBOTS_PRODUCT_TOKEN}\nDisallow:\n`)
t('именная группа перекрывает звёздочку', named.allows('/e/e1.html').allowed, true)
t('и источник назван', named.source, 'product-token')
t('без именной группы берётся звёздочка', buildRobotsPolicy(ROBOTS_OK).source, 'wildcard')
eq('применённые группы отсортированы',
  buildRobotsPolicy('User-agent: z\nUser-agent: a\nDisallow: /x\n', { productToken: 'a' }).appliedGroups, ['a', 'z'])

/* ── robots в обходе: перед каждым обменом ────────────────────────────── */

await (async () => {
  const log = []
  await crawl({ fetchImpl: router(PAGES, { log }) })
  t('robots — первый обмен прогона', log[0].url, ROBOTS_URL)
  t('User-Agent объявлен в заголовке', log[0].userAgent, USER_AGENT)
})()

await (async () => {
  const log = []
  await rejectsWith('запрет robots останавливает прогон',
    () => crawl({ fetchImpl: router(PAGES, { log, robots: ROBOTS_DENY_ALL }) }), 'robotsDenied')
  t('и ни одного HTML-запроса не сделано', log.length, 1)
})()

await (async () => {
  /* Контрпример владельца целиком: каталог разрешён, `/e/e2` запрещён.
     Прежняя версия спрашивала robots один раз про каталог и всё равно шла
     за объектами. */
  const log = []
  await rejectsWith('запрет уровня объектов останавливает прогон',
    () => crawl({ fetchImpl: router(PAGES, { log, robots: OWNER_CASE }) }), 'robotsDenied')
  t('каталог и направления запрошены', log.length, 5)
  t('а запрещённый объект — нет', log.some((row) => row.url.includes('/e/e2001.html')), false)
})()

await (async () => {
  const log = []
  await rejectsWith('недоступный robots останавливает прогон',
    () => crawl({ fetchImpl: router(PAGES, { log, robotsStatus: 404 }) }), 'robotsUnavailable')
  t('HTML не запрашивался', log.length, 1)
})()

await rejectsWith('не-ASCII в robots — отказ',
  () => crawl({ fetchImpl: router(PAGES, { robots: 'User-agent: *\nDisallow: /кириллица\n' }) }), 'robotsNotAscii')

await (async () => {
  const pacer = createRequestPacer({ sleep: async () => {} })
  const denyRedirectTarget = buildRobotsPolicy('User-agent: *\nDisallow: /e/e9001\n')
  await rejectsWith('цель редиректа тоже проверяется по robots', () => fetchHtmlPage({
    url: ENTRY, now: NOW, pacer, clock: () => 0, robots: denyRedirectTarget,
    fetchImpl: async () => response(new Uint8Array(0), { status: 302, location: `${HOST}/e/e9001.html` }),
  }), 'robotsDenied')
  t('и запрещённый обмен не израсходован', pacer.networkRequests, 1)
})()

await rejectsWith('обход без policy невозможен', () => fetchHtmlPage({
  url: ENTRY, now: NOW, pacer: createRequestPacer({ sleep: async () => {} }), clock: () => 0,
  fetchImpl: async () => response(bytesOf(ATTRACTION)),
}), 'robotsPolicyMissing')

/* ── Ограниченное чтение тела ─────────────────────────────────────────── */

const bytesN = (n) => new Uint8Array(n)
t('ровно предел читается', (await readBoundedBody(response(bytesN(100)), 100)).length, 100)
await rejectsWith('предел плюс байт — отказ', () => readBoundedBody(response(bytesN(101)), 100), 'responseTooLarge')
await rejectsWith('тела нет — отказ', () => readBoundedBody(response(null, { body: null }), 100), 'bodyMissing')

await (async () => {
  let pulls = 0
  const infinite = new ReadableStream({ pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(1024)) } })
  await rejectsWith('бесконечный поток останавливается',
    () => readBoundedBody(response(null, { body: infinite }), 4096), 'responseTooLarge')
  t('прочитано ограниченное число кусков', pulls <= 8, true)
})()

await (async () => {
  const stuck = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024)) },
    cancel() { return new Promise(() => {}) },
  })
  const verdict = await Promise.race([
    readBoundedBody(response(null, { body: stuck }), 2048).then(() => 'прошло').catch((e) => e.code),
    new Promise((resolve) => { setTimeout(() => resolve('зависли на чужом cancel'), 1000) }),
  ])
  t('отказ не ждёт чужой cancel()', verdict, 'responseTooLarge')
})()

/* ── Учёт обменов и редиректы ─────────────────────────────────────────── */

const pacerClock = () => 0
await (async () => {
  const waits = []
  const pacer = createRequestPacer({ sleep: async (ms) => { waits.push(ms) } })
  await pacer.take(`${HOST}/e/e1.html`, pacerClock)
  await pacer.take(`${HOST}/e/e2.html`, pacerClock)
  t('интервал выдержан нашей политикой', waits[0], FETCH_LIMITS.requestIntervalMs)
  t('счётчик называется обменами', pacer.networkRequests, 2)
  await rejectsWith('повторный запрос отвергнут', () => pacer.take(`${HOST}/e/e1.html`, pacerClock), 'urlRepeated')
  const tight = createRequestPacer({ limits: { ...FETCH_LIMITS, maxNetworkRequests: 1 }, sleep: async () => {} })
  await tight.take(`${HOST}/e/e1.html`, pacerClock)
  t('остаток бюджета виден', tight.remaining, 0)
  t('и проверяется без расхода', tight.fits(1), false)
  await rejectsWith('бюджет обменов общий на прогон',
    () => tight.take(`${HOST}/e/e2.html`, pacerClock), 'networkBudgetExhausted')
})()

const redirecting = (hops) => {
  let seen = 0
  return async () => {
    if (seen < hops) { seen += 1; return response(new Uint8Array(0), { status: 302, location: `${HOST}/e/e900${seen}.html` }) }
    return response(bytesOf(ATTRACTION))
  }
}
for (const [hops, expected, label] of [[1, 2, 'один редирект — два обмена'], [2, 3, 'два редиректа — три обмена']]) {
  const pacer = createRequestPacer({ sleep: async () => {} })
  await fetchHtmlPage({ url: ENTRY, fetchImpl: redirecting(hops), now: NOW, pacer, clock: pacerClock, robots: PERMISSIVE })
  t(label, pacer.networkRequests, expected)
}
await (async () => {
  const pacer = createRequestPacer({ sleep: async () => {} })
  await rejectsWith('три редиректа превышают лимит', () => fetchHtmlPage({
    url: ENTRY, fetchImpl: redirecting(3), now: NOW, pacer, clock: pacerClock, robots: PERMISSIVE }), 'redirectLimit')
  t('и все три обмена посчитаны', pacer.networkRequests, 3)
})()
await rejectsWith('редирект на чужой хост отвергнут', () => fetchHtmlPage({
  url: ENTRY, now: NOW, pacer: createRequestPacer({ sleep: async () => {} }), clock: pacerClock, robots: PERMISSIVE,
  fetchImpl: async () => response(new Uint8Array(0), { status: 302, location: 'https://example.org/e/e1.html' }),
}), 'hostDenied')

/* ── Канон URL ────────────────────────────────────────────────────────── */

t('вход с буквой после номера', canonicalPageUrl('/e/e623a.html'), ENTRY)
t('ключ строится из номера', sourceKeyFromUrl(`${HOST}/e/e4000.html`), 'japan-guide:e4000')
throwsWith('query запрещён', () => canonicalPageUrl('/e/e1.html?utm=1'), 'urlNotCanonical')
throwsWith('fragment запрещён', () => canonicalPageUrl('/e/e1.html#top'), 'urlNotCanonical')
throwsWith('чужой хост запрещён', () => canonicalPageUrl('https://example.org/e/e1.html'), 'hostDenied')
throwsWith('http запрещён', () => canonicalPageUrl('http://www.japan-guide.com/e/e1.html'), 'schemeDenied')
throwsWith('путь /local/ запрещён', () => canonicalPageUrl('/local/e1.html'), 'pathDenied')

/* ── Каталог и направление ────────────────────────────────────────────── */

const catalogue = parseCatalogue({ html: CATALOGUE, url: ENTRY })
eq('цели только из региональных списков', catalogue.targets.map((d) => d.sourceKey),
  ['japan-guide:e1001', 'japan-guide:e1002', 'japan-guide:e1003a'])
/* Именно сами адреса, а не их число: на живом сайте это оказались настоящие
   направления новой формы, и по числу «2» их не опознать. */
eq('адреса непригодной формы названы поимённо', [...catalogue.unsupported].sort(),
  ['/e/e1005.html?utm=1', '/local/e9999.html', 'https://example.org/e/e1004.html'].sort())
t('ссылка только из подвала не попала', catalogue.targets.some((d) => d.sourceKey === 'japan-guide:e1006'), false)
t('чистый каталог непригодных не содержит', parseCatalogue({ html: CATALOGUE_CLEAN, url: ENTRY }).unsupported.length, 0)
throwsWith('страница без региональных списков не каталог',
  () => parseCatalogue({ html: DESTINATION, url: ENTRY }), 'structureMismatch')

const destination = parseDestination({ html: DESTINATION, url: `${HOST}/e/e2157.html` })
eq('взята только группа без собственного заголовка', destination.cards.map((c) => c.sourceKey),
  ['japan-guide:e2001', 'japan-guide:e2002'])
t('Side Trips не обходятся', destination.cards.some((c) => c.sourceKey === 'japan-guide:e2900'), false)
t('спонсорский отель не обходится', destination.cards.some((c) => c.sourceKey === 'japan-guide:e2800'), false)
eq('уровни рекомендации', destination.cards.map((c) => c.editorialLevel), [2, 0])
eq('позиции из собственного элемента ранга', destination.cards.map((c) => c.listPosition), [1, 2])
eq('категории', destination.cards.map((c) => c.categoryHintRaw.trim()), ['Castle', 'Garden'])

/*
 * Оба отказа — исходы КЛАССИФИКАТОРА, и у них теперь собственный код.
 * Прежде оба ждали `structureMismatch`: код сообщал «структура не та» и не
 * сообщал, какая именно грамматика не сошлась. Снимок canary из 166 таких
 * отказов не позволил отличить страницу, прошедшую обе грамматики, от
 * страницы, не прошедшей ни одной, — и стоил отдельного обхода, чтобы это
 * выяснить.
 */
throwsWith('две группы без заголовка — отказ страницы', () => parseDestination({
  html: DESTINATION.replace('<div class="spot_list__category__header">Side Trips from Fixture City</div>', ''),
  url: `${HOST}/e/e2157.html`,
}), 'pageRoleUnknown')
throwsWith('нет заголовка списка — не направление', () => parseDestination({
  html: DESTINATION.replace('spot_list__list_title', 'spot_list__other_title'),
  url: `${HOST}/e/e2157.html`,
}), 'pageRoleUnknown')

/* ── Позиция не выдумывается ──────────────────────────────────────────── */

const RANK_ONE = '<div class="spot_list__spot__rank_no">1</div>'
const rankCase = (html) => parseDestination({ html, url: `${HOST}/e/e2157.html` }).rejectedCards.map((r) => r.code)
eq('элемента ранга нет', rankCase(DESTINATION.replace(RANK_ONE, '')), ['rankElementMissing'])
eq('ранг пуст', rankCase(DESTINATION.replace(RANK_ONE, '<div class="spot_list__spot__rank_no">   </div>')), ['rankEmpty'])
eq('ранг дробный', rankCase(DESTINATION.replace(RANK_ONE, '<div class="spot_list__spot__rank_no">1.5</div>')), ['rankNotPositiveInteger'])
eq('ранг нулевой', rankCase(DESTINATION.replace(RANK_ONE, '<div class="spot_list__spot__rank_no">0</div>')), ['rankNotPositiveInteger'])
eq('ранг повторяется', rankCase(DESTINATION.replace('<div class="spot_list__spot__rank_no">2</div>', RANK_ONE)), ['rankRepeated'])
eq('элементов ранга два', rankCase(DESTINATION.replace(RANK_ONE, `${RANK_ONE}${RANK_ONE}`)), ['rankElementDuplicated'])
t('уцелевшая карточка сохраняет свой ранг',
  parseDestination({ html: DESTINATION.replace(RANK_ONE, ''), url: `${HOST}/e/e2157.html` }).cards[0].listPosition, 2)

/* ── Объект ───────────────────────────────────────────────────────────── */

const PAGE = {
  url: `${HOST}/e/e2001.html`,
  pageBytes: 12345,
  rawPageDigest: `sha256:${'c'.repeat(64)}`,
  observedAt: '2026-08-17T00:00:00.000Z',
  pageRole: 'poi',
  diagnostics: {
    httpCharset: 'shift-jis',
    metaCharset: 'utf-8',
    decodePolicy: DECODE_POLICY,
    decodeErrorCount: 0,
    decodeReplacements: 0,
    nonWhitelistedCodepoints: 0,
  },
}
const PLACEMENTS = [{
  kind: 'destinationRanking',
  collectionSourceKey: 'japan-guide:e2157',
  listPosition: 1,
  editorialLevel: 2,
  categoryHint: 'Castle',
}]

const attraction = parseAttraction({ html: ATTRACTION, page: PAGE, placements: PLACEMENTS })
assertDiscoveryRecord(attraction.record); ok++
t('имя объекта с H1', attraction.record.nameEn, 'First Object (Fixture)')

const byKind = (kind, component = null) => attraction.record.factLeads
  .filter((lead) => lead.kind === kind && (lead.appliesTo?.name ?? null) === component)
  .map((lead) => lead.value)

eq('часы башни — один текстовый узел', byKind('hours_hint', 'Main Tower'), ['9:00 to 17:00 (entry until 16:30)'])
eq('выходные башни', byKind('closed_hint', 'Main Tower'), ['December 28 to January 1'])
eq('цена режется по <br>', byKind('admission_hint', 'Main Tower'), ['1200 yen (main keep)'])
eq('часы сада собраны через строчную ссылку целиком', byKind('hours_hint', 'Second Garden'),
  ['9:00 to 17:00 (until 16:30 in winter); open until 21:00 during the blossom season (March 20 to April 12)'])
eq('выходные сада не обрываются на ссылке', byKind('closed_hint', 'Second Garden'),
  ['Mondays (or the following day if Monday is a national holiday), Dec 28 to Jan 4'])
eq('официальный сайт — по видимому тексту ссылки', byKind('official_url_hint'), ['https://fixture-object.example.net/'])
eq('имя как подсказка', byKind('name_en'), ['First Object (Fixture)'])
t('чужая метка посчитана, но не сохранена', attraction.unknownLabels, 1)

/*
 * ИСТОЧНИК чужой метки назван записью.
 *
 * До 18.08 существовал только счётчик прогона. Снимок canary сообщил
 * «неизвестных меток 1» на 42 записи и не сообщил, у какой именно; вычислить
 * её из снимка нельзя — все 47 блоков отдали ровно по три подсказки, то есть
 * асимметрии, по которой запись можно было бы найти, в артефакте нет.
 * Счётчик суммирует, omission прикрепляет.
 */
const UNKNOWN_OMISSIONS = attraction.record.omissions.filter((o) => o.code === 'unknownAdmissionLabel')
t('чужая метка прикреплена к записи', UNKNOWN_OMISSIONS.length, 1)
t('и названа локатором', UNKNOWN_OMISSIONS[0].locator, 'hours_fees_block')
/* Метка в фикстуре — «Telephone», девять байт. Длина сверяется с
   МЕТКОЙ, а не с числом: подмена метки на другую той же длины проверку
   не пройдёт ниже, где сверяется отсутствие текста. */
t('длина метки записана', UNKNOWN_OMISSIONS[0].originalLengthBytes, 'Telephone'.length)
t('текста метки в записи нет',
  JSON.stringify(attraction.record).includes('Telephone'), false)
/* Метка длиннее — длина в записи обязана измениться. Иначе поле было бы
   постоянной и опровергнуть по нему ничего было бы нельзя. */
const LONGER_LABEL = parseAttraction({
  html: ATTRACTION.replace('>Telephone<', '>Typical Visit Duration<'),
  page: PAGE,
  placements: PLACEMENTS,
})
t('другая метка — другая длина',
  LONGER_LABEL.record.omissions.find((o) => o.code === 'unknownAdmissionLabel').originalLengthBytes,
  'Typical Visit Duration'.length)
t('и текста этой метки в записи тоже нет',
  JSON.stringify(LONGER_LABEL.record).includes('Typical Visit Duration'), false)
t('подсказки от чужой метки не порождаются',
  LONGER_LABEL.record.factLeads.length, attraction.record.factLeads.length)

const allValues = attraction.record.factLeads.map((lead) => lead.value).join(' ')
t('рекламный URL не попал ни в одно значение', allValues.includes('ads.example.com'), false)
t('текст кнопки CTA не попал в значение', allValues.includes('Show more'), false)
t('проза Intro не попала ни в одно значение', allValues.includes('Intro prose'), false)
t('подсказок ровно семь', attraction.record.factLeads.length, 7)
t('категория подсказкой не стала',
  attraction.record.factLeads.some((lead) => lead.kind === 'category_hint'), false)

const titleFailure = (html) => {
  try {
    parseAttraction({ html, page: PAGE, placements: PLACEMENTS })
    return 'вызов прошёл'
  } catch (error) {
    return `${error.code}:${error.details?.reason ?? '—'}`
  }
}
/*
 * Роль решается ДО разбора записи, поэтому исход у первого случая — код
 * классификатора, а у второго — отказ уже опознанного объекта. Раздельные
 * коды и делают эти два случая различимыми в снимке.
 */
t('нет элемента заголовка — роль не определяется',
  titleFailure(ATTRACTION.replace('<h1 class="page_title__title">First Object (Fixture)</h1>', '')),
  'pageRoleUnknown:—')
t('заголовок пуст — другая причина',
  titleFailure(ATTRACTION.replace('First Object (Fixture)', '   ')), 'structureMismatch:titleEmpty')
/* Роль определилась — «collection». Это НЕ исход классификатора-отказа, а
   отказ разбора: объектную грамматику к направлению применять нельзя. */
throwsWith('страница со списком объектов не объект',
  () => parseAttraction({ html: DESTINATION, page: PAGE, placements: PLACEMENTS }), 'structureMismatch')

const ambiguous = parseAttraction({
  html: ATTRACTION.replace(
    '<div class="page_admission__item_content">December 28 to January 1</div>',
    '<div class="page_admission__item_content"><p>December 28 to January 1</p><p>And also all of February</p></div>',
  ),
  page: PAGE,
  placements: PLACEMENTS,
})
t('неоднозначное значение ушло в omissions',
  ambiguous.record.omissions.some((o) => o.code === 'ambiguousValueBoundary'), true)
t('склейки не произошло',
  ambiguous.record.factLeads.some((lead) => lead.value.includes('And also all of February')), false)
t('остальные подсказки уцелели', ambiguous.record.factLeads.length, 6)

/* ── Полный обход и контракт снимка ───────────────────────────────────── */

const run = await crawl()
assertDiscoverySnapshot(run.discovery); ok++
t('полный обход без потерь полон', run.discovery.complete, true)
eq('охват объявлен', run.discovery.scope, { kind: 'full', limit: null })
t('точка входа записана', run.discovery.entryUrl, ENTRY)
t('обменов: robots + каталог + 3 направления + 2 объекта', run.discovery.counters.networkRequests, 7)
t('записей построено', run.discovery.records.length, 2)
t('свидетельства целей сохранены', run.discovery.catalogueTargetEvidence.length, 3)
t('порядок посчитан на каждое направление', run.discovery.orderRecords.length, 3)
const first = run.discovery.records.find((r) => r.sourceKey === 'japan-guide:e2001')
t('объект найден из трёх коллекций', first.placements.length, 3)
t('чужие метки посчитаны', run.discovery.counters.unknownAdmissionLabels, 2)

const dirty = await crawl({ fetchImpl: router(new Map([...PAGES, [ENTRY, CATALOGUE]])) })
t('непригодный адрес делает снимок неполным', dirty.discovery.complete, false)
eq('и назван причиной', dirty.discovery.incompleteReasons, [{ code: 'unsupportedCatalogueLinkShape', count: 3 }])
t('каждый такой адрес попал в отказы', dirty.discovery.rejected.targets.length, 3)
eq('и назван самим адресом, а не заглушкой',
  dirty.discovery.rejected.targets.map((row) => row.ref).sort(),
  ['/e/e1005.html?utm=1', '/local/e9999.html', 'https://example.org/e/e1004.html'].sort())

const limited = await crawl({ limit: 1 })
t('--limit режет итоговые объекты', limited.discovery.records.length, 1)
t('ограниченный обход снимком не является', limited.discovery.complete, false)

/*
 * Цель legacy-формы, которая оказалась ОБЪЕКТОМ. Прежде она объявлялась
 * сломанным направлением: обход шёл в parseDestination по форме адреса.
 * Теперь роль решает структура, и такая цель становится прямым объектом
 * каталога — снимок остаётся полным, а объект не теряется.
 */
const directTarget = new Map([...PAGES])
directTarget.set(`${HOST}/e/e1002.html`, ATTRACTION)
const direct = await crawl({ fetchImpl: router(directTarget) })
t('legacy-цель с грамматикой объекта снимок не ломает', direct.discovery.complete, true)
t('она посчитана прямым объектом', direct.discovery.counters.directPoisFound, 1)
t('и коллекций стало на одну меньше', direct.discovery.counters.catalogueCollectionsFound, 2)
const directRow = direct.discovery.catalogueTargetEvidence.find((r) => r.sourceKey === 'japan-guide:e1002')
t('роль записана в свидетельстве цели', directRow.evidence.pageRole, 'poi')
const directRecord = direct.discovery.records.find((r) => r.sourceKey === 'japan-guide:e1002')
const directPlacement = directRecord.placements.find((p) => p.kind === 'catalogueDirect')
t('размещение прямое', Boolean(directPlacement), true)
t('и ссылается на каталог', directPlacement.collectionSourceKey, 'japan-guide:e623a')
eq('ранга у прямого объекта нет',
  [directPlacement.listPosition, directPlacement.editorialLevel, directPlacement.categoryHint],
  [null, null, null])
t('порядок для прямого объекта не ведётся',
  direct.discovery.orderRecords.some((row) => row.destinationSourceKey === 'japan-guide:e1002'), false)

/* Цель, не проходящая НИ ОДНУ грамматику, по-прежнему делает снимок неполным. */
const roleless = new Map([...PAGES])
roleless.set(`${HOST}/e/e1002.html`,
  '<!doctype html><html><head><meta charset="UTF-8"></head><body><p>nothing</p></body></html>')
const partial = await crawl({ fetchImpl: router(roleless) })
t('цель без роли делает снимок неполным', partial.discovery.complete, false)
t('и попадает в отказы', partial.discovery.rejected.targets.length, 1)
t('причина названа своим именем',
  partial.discovery.incompleteReasons.some((r) => r.code === 'targetStructureMismatch'), true)

/*
 * ── НЕХВАТКА БЮДЖЕТА ТЕПЕРЬ ИМЕНУЕТ УЗЕЛ, А НЕ ПРОГОН ──
 *
 * До графа обход считал нижнюю границу оставшихся обменов и не начинал
 * уровень объектов целиком: причина `budgetInsufficient` объявлялась один раз
 * на прогон, и `poisVisited` был нулём. У графа такой границы не существует —
 * чтобы узнать, объект ли карточка, её страницу надо получить. Поэтому
 * нехватка стала отказом КОНКРЕТНОЙ страницы кодом `networkBudgetExhausted`,
 * и снимок называет, до каких именно страниц обход не дошёл.
 *
 * Потолок при этом соблюдается ровно так же: обменов не больше пяти.
 */
const starved = await crawl({ limits: { ...FETCH_LIMITS, maxNetworkRequests: 5 } })
t('потолок обменов соблюдён', starved.discovery.counters.networkRequests, 5)
t('снимок неполон', starved.discovery.complete, false)
t('объявляемой причины нехватки бюджета больше нет',
  starved.discovery.incompleteReasons.some((r) => r.code === 'budgetInsufficient'), false)
t('нехватка приписана страницам поимённо',
  [...starved.discovery.rejected.targets, ...starved.discovery.rejected.nodes]
    .some((row) => row.code === 'networkBudgetExhausted'), true)
t('и каждый такой отказ назван ссылкой, а не числом',
  [...starved.discovery.rejected.targets, ...starved.discovery.rejected.nodes]
    .every((row) => row.ref.startsWith('japan-guide:')), true)

/* ── Мониторинг ───────────────────────────────────────────────────────── */

const parsed = (value) => JSON.parse(JSON.stringify(value))
const same = diffDiscoverySnapshot(parsed(run.discovery), parsed(run.discovery))
t('два полных снимка сравнимы', same.comparable, true)
t('и различий нет', same.semanticChanges + same.appeared + same.vanished, 0)

const partialVsFull = diffDiscoverySnapshot(parsed(partial.discovery), parsed(run.discovery))
t('неполный снимок того же охвата сравнивать нельзя', partialVsFull.comparable, false)
t('и исчезнувшие не объявляются', Object.prototype.hasOwnProperty.call(partialVsFull, 'details'), false)
t('ограниченный снимок тоже не сравнивается',
  diffDiscoverySnapshot(parsed(limited.discovery), parsed(run.discovery)).comparable, false)
t('негодный снимок отвергается до сравнения', (() => {
  const broken = parsed(run.discovery)
  broken.records[0].nameEn = 'Подделка'
  return diffDiscoverySnapshot(broken, parsed(run.discovery)).comparable
})(), false)

const grownRun = await crawl({
  fetchImpl: router(new Map([...PAGES, [ENTRY, `${CATALOGUE_CLEAN}\n<!-- ещё сто байт разметки для роста страницы -->`]])),
})
const parentDiff = diffDiscoverySnapshot(parsed(grownRun.discovery), parsed(run.discovery))
t('рост каталога сравним', parentDiff.comparable, true)
t('и сообщается отдельным разделом', parentDiff.parentPageChanges, 1)
t('объекты семантически не изменились', parentDiff.semanticChanges, 0)
t('и исчезнувших нет', parentDiff.vanished, 0)

/* ── Границы режимов CLI ──────────────────────────────────────────────── */

const japanGuide = getPortal('japan-guide')
t('в реестре стоит discovery-адаптер', japanGuide.adapter, 'japan-guide-html')
eq('модельная обработка по-прежнему запрещена',
  [japanGuide.modelProcessing.allowedProviders, japanGuide.modelProcessing.fields, japanGuide.modelProcessing.decisionRef],
  [[], [], null])
eq('кодировка описана комбинацией', Object.keys(japanGuide.encoding).sort(),
  ['decodePolicy', 'httpCharset', 'metaCharset', 'observedAt'])
/* Реестр объявляет ЧЕТЫРЕ формы ссылок, и каждая обязана быть той же, что в
   грамматике адресов: разойдясь, реестр описывал бы не тот обход.
   Число сверяется с производственным перечислением, а не с литералом:
   литерал разошёлся бы с грамматикой молча. */
t('шаблонов ссылок столько же, сколько семейств',
  japanGuide.discovery.linkPatterns.length, URL_FAMILIES.length)
t('семейств четыре', URL_FAMILIES.length, 4)
t('вход соответствует одному из шаблонов',
  japanGuide.discovery.linkPatterns.some((source) =>
    new RegExp(source).test(new URL(japanGuide.discovery.entry).pathname)), true)
for (const [label, path] of [
  ['legacy', '/e/e4000.html'],
  ['корневая', '/destinations/nozawa-onsen/'],
  ['вложенная', '/destinations/nozawa-onsen/hot-spring-baths.html'],
  ['суффиксная буквенная', '/e/e5036_school.html'],
  ['суффиксная цифровая', '/e/e3034_001.html'],
]) {
  t(`шаблоны реестра принимают ${label} форму`,
    japanGuide.discovery.linkPatterns.some((source) => new RegExp(source).test(path)), true)
  t(`и грамматика адресов её тоже принимает`,
    canonicalDiscoveryUrl(`${HOST}${path}`).family.length > 0, true)
}
for (const [label, path] of [
  ['верхний регистр', '/destinations/Nozawa-Onsen/'],
  ['без завершающего слэша', '/destinations/nozawa-onsen'],
  ['лишний сегмент', '/destinations/a/b/c.html'],
  ['короткий цифровой суффикс', '/e/e3034_01.html'],
  ['хвост после цифрового суффикса', '/e/e3034_001_more.html'],
  ['верхний регистр расширения суффикса', '/e/e3034_001.HTML'],
]) {
  t(`шаблоны реестра отвергают: ${label}`,
    japanGuide.discovery.linkPatterns.some((source) => new RegExp(source).test(path)), false)
}

const baseArgs = {
  write: false, dryWrite: false, baseSnapshot: null, modelPlan: false,
  providerProfileRef: null, names: null, existing: null, monitor: null, limit: null,
}
const boundary = (over) => () => assertDiscoveryBoundary({ args: { ...baseArgs, ...over }, portals: [japanGuide] })
throwsWith('--write отказывает', boundary({ write: true }))
throwsWith('--dry-write отказывает', boundary({ write: true, dryWrite: true }))
throwsWith('--base-snapshot отказывает', boundary({ write: true, dryWrite: true, baseSnapshot: '/tmp/x.json' }))
throwsWith('--model-plan отказывает', boundary({ modelPlan: true }))
throwsWith('--model-provider-profile отказывает', boundary({ providerProfileRef: 'openai-responses-luna@1.0.0' }))
throwsWith('--names отказывает', boundary({ names: '/tmp/n.json' }))
throwsWith('--existing отказывает', boundary({ existing: '/tmp/e.json' }))
throwsWith('--monitor вместе с --limit отказывает', boundary({ monitor: '/tmp/prev.json', limit: 5 }))
boundary({ monitor: '/tmp/prev.json' })(); ok++
boundary({ limit: 5 })(); ok++
assertDiscoveryBoundary({ args: { ...baseArgs, write: true }, portals: [] }); ok++

await (async () => {
  const printed = []
  const realLog = console.log
  console.log = (line) => printed.push(String(line))
  try {
    await main(['node', 'collect-pois.mjs', '--all'], {
      adapters: {},
      discoveryAdapters: { 'japan-guide-html': async () => ({ discovery: run.discovery, meta: { adapter: 'japan-guide-html' } }) },
      now: new Date('2026-08-17T00:00:00.000Z'),
    })
  } finally {
    console.log = realLog
  }
  const report = JSON.parse(printed.join('\n'))
  const row = report.portals.find((portal) => portal.portalId === 'japan-guide')
  t('discovery-портал попал в read-only --all', row?.mode, 'discovery')
  t('кандидатов не построено', Object.prototype.hasOwnProperty.call(row, 'writable'), false)
})()

/* ── Никаких числовых литералов лимитов в адаптере ────────────────────── */

const adapterSource = readFileSync(path.join(ROOT, 'scripts/poi-portals/lib/japan-guide-html.mjs'), 'utf8')
for (const literal of ['2097152', '2 * 1024 * 1024', '6000', '2000']) {
  t(`лимит ${literal} не зашит в адаптер`, adapterSource.includes(literal), false)
}
t('селекторы карточек ограничены секцией', SELECTORS.destination.group.startsWith('section#section_spot_list'), true)
t('раздел часов ищется по идентификатору', SELECTORS.attraction.admissionSection, 'section#section_admission')


/* ── P1-A: двусмысленность роли достижима ─────────────────────────────── */

/*
 * Гибридная фикстура несёт ОБЕ положительные сигнатуры: список объектов с
 * заголовком и раздел фактов с блоком компонента. Отрицательные ограничения
 * обеих грамматик она тоже проходит — ровно один заголовок списка, ровно
 * одна группа без своего заголовка, есть h1.page_title__title.
 *
 * Поэтому если снять проверку пересечения, страница молча уйдёт в
 * «collection», и обе проверки ниже провалятся. Ветка pageRoleAmbiguous
 * перестала быть текстом.
 */
const HYBRID = fixture('hybrid.html')

const roleFailure = (parse) => {
  try {
    parse()
    return 'вызов прошёл'
  } catch (error) {
    return `${error.code}:${error.details?.reason ?? '—'}`
  }
}

t('гибрид не разбирается как направление',
  roleFailure(() => parseDestination({ html: HYBRID, url: `${HOST}/e/e2157.html` })),
  'pageRoleAmbiguous:—')
t('гибрид не разбирается как объект',
  roleFailure(() => parseAttraction({ html: HYBRID, page: PAGE, placements: PLACEMENTS })),
  'pageRoleAmbiguous:—')

/*
 * ГЛАВНОЕ в разделении кодов — что они РАЗНЫЕ. Проверка «оба не равны
 * structureMismatch» прошла бы и на двух одинаковых кодах, то есть на
 * прежнем свёрнутом поведении под новым именем.
 */
const AMBIGUOUS_CODE = roleFailure(() => parseDestination({ html: HYBRID, url: `${HOST}/e/e2157.html` }))
const UNKNOWN_CODE = roleFailure(() => parseAttraction({
  html: '<!doctype html><html><head><meta charset="UTF-8"></head><body><p>nothing</p></body></html>',
  page: PAGE,
  placements: PLACEMENTS,
}))
t('исход «обе грамматики» и исход «ни одной» — разные коды',
  AMBIGUOUS_CODE !== UNKNOWN_CODE, true)
t('и оба входят в закрытый список исходов классификатора',
  PAGE_ROLE_CODES.includes(AMBIGUOUS_CODE.split(':')[0])
  && PAGE_ROLE_CODES.includes(UNKNOWN_CODE.split(':')[0]), true)
t('а список исходов целиком входит в коды отказа страницы',
  PAGE_ROLE_CODES.every((code) => PAGE_REJECTION_CODES.includes(code)), true)
throwsWith('код вне списка исходов классификатором не порождается',
  () => new PageRoleError('structureMismatch', 'не исход классификатора'),
  'не исход классификатора ролей')

/* Каждая сигнатура ПО ОТДЕЛЬНОСТИ роль даёт — значит двусмысленность
 * возникает именно от их совмещения, а не от поломанной фикстуры. */
const WITHOUT_FACTS = HYBRID.replace(/<section id="section_admission"[\s\S]*?<\/section>/, '')
const WITHOUT_LIST = HYBRID.replace(/<section id="section_spot_list"[\s\S]*?<\/section>/, '')
t('раздел фактов действительно вырезан', WITHOUT_FACTS.includes('<section id="section_admission"'), false)
t('список объектов действительно вырезан', WITHOUT_LIST.includes('<section id="section_spot_list"'), false)
t('гибрид без раздела фактов — направление',
  parseDestination({ html: WITHOUT_FACTS, url: `${HOST}/e/e2157.html` }).cards.length, 1)
t('гибрид без списка объектов — объект',
  parseAttraction({ html: WITHOUT_LIST, page: PAGE, placements: PLACEMENTS })
    .record.pageEvidence.pageRole, 'poi')

/* Раздел ссылок роль НЕ различает: он измерен и на направлении
 * /destinations/nozawa-onsen/, и на объектах. Фикстура направления его
 * содержит — и направление обязано остаться направлением. */
t('раздел ссылок не делает направление двусмысленным',
  DESTINATION.includes('id="section_links"') && destination.cards.length > 0, true)

/* ── Роль по структуре: три измеренных случая ─────────────────────────── */

/*
 * ИЗМЕРЕНО в canary 18.08: из 42 принятых объектов 12 не имели раздела
 * фактов вовсе — ни одного `div.page_admission`. Раздел фактов не может
 * быть ЕДИНСТВЕННЫМ признаком объекта, иначе эти 12 стали бы отказами.
 */
const POI_NO_ADMISSION = ATTRACTION.replace(/<section id="section_admission"[\s\S]*?<\/section>/, '')
t('раздел фактов действительно вырезан у объекта',
  POI_NO_ADMISSION.includes('<section id="section_admission"'), false)
t('прямой объект С разделом фактов — poi',
  attraction.record.pageEvidence.pageRole, 'poi')
t('объект БЕЗ раздела фактов — тоже poi',
  parseAttraction({ html: POI_NO_ADMISSION, page: PAGE, placements: PLACEMENTS })
    .record.pageEvidence.pageRole, 'poi')
t('и подсказок часов у него нет — но роль от этого не зависит',
  parseAttraction({ html: POI_NO_ADMISSION, page: PAGE, placements: PLACEMENTS })
    .record.factLeads.some((lead) => lead.sourceLocator === 'hours_fees_block'), false)

/*
 * Ни грамматики направления, ни грамматики объекта: список объектов есть,
 * но заголовка списка нет, и h1 объекта нет. Ни одна положительная
 * сигнатура не полна — исход обязан быть «ни одной», а не «обе».
 */
const NEITHER_GRAMMAR = '<!doctype html><html><head><meta charset="UTF-8"></head><body>'
  + '<section id="section_spot_list"><ul><li class="spot_list__spot">'
  + '<a class="spot_list__spot__name" href="/e/e2001.html">Object</a></li></ul></section>'
  + '</body></html>'
t('страница без полной грамматики обеих ролей — pageRoleUnknown',
  roleFailure(() => parseDestination({ html: NEITHER_GRAMMAR, url: `${HOST}/e/e2157.html` })),
  'pageRoleUnknown:—')
t('и тот же исход через объектный разбор',
  roleFailure(() => parseAttraction({ html: NEITHER_GRAMMAR, page: PAGE, placements: PLACEMENTS })),
  'pageRoleUnknown:—')

/* ── P1-B: percent-encoding в наборе адаптера ─────────────────────────── */

for (const [label, href] of [
  ['dot-сегмент в legacy', '/e/x/%2e%2e/e1.html'],
  ['dot-сегмент в верхнем регистре', '/e/x/%2E%2E/e1.html'],
  ['смешанный регистр', '/e/x/%2e%2E/e1.html'],
  ['кодированный разделитель', '/e/e1%2F.html'],
  ['кодированная буква', '/e/%651.html'],
  ['кодированный процент', '/e/e1%25.html'],
]) throwsWith(`canonicalPageUrl отвергает: ${label}`, () => canonicalPageUrl(href), 'urlNotCanonical')

t('обычный legacy по-прежнему проходит', canonicalPageUrl('/e/e4000.html'), `${HOST}/e/e4000.html`)
throwsWith('ключ не строится из адреса с percent-encoding',
  () => sourceKeyFromUrl(`${HOST}/e/x/%2e%2e/e1.html`), 'urlNotCanonical')


/* Только строка: URL-объект отвергается до разбора. */

const SNEAKY_LEGACY = new URL(`${HOST}/e/x/%2e%2e/e1.html`)
t('URL-объект legacy следов не хранит', String(SNEAKY_LEGACY).includes('%'), false)
t('и путь у него уже допустимый', SNEAKY_LEGACY.pathname, '/e/e1.html')

throwsWith('canonicalPageUrl не принимает URL-объект',
  () => canonicalPageUrl(SNEAKY_LEGACY), 'urlUnparsable')
throwsWith('sourceKeyFromUrl не принимает URL-объект',
  () => sourceKeyFromUrl(SNEAKY_LEGACY), 'urlUnparsable')

for (const [label, value] of [
  ['undefined', undefined],
  ['null', null],
  ['число', 42],
  ['объект с toString', { toString: () => `${HOST}/e/e1.html` }],
]) {
  throwsWith(`canonicalPageUrl не принимает ${label}`, () => canonicalPageUrl(value), 'urlUnparsable')
  throwsWith(`sourceKeyFromUrl не принимает ${label}`, () => sourceKeyFromUrl(value), 'urlUnparsable')
}

t('строковый legacy проходит', sourceKeyFromUrl(`${HOST}/e/e1.html`), 'japan-guide:e1')


/* ── Девять регрессий: роль, ключ и вид размещения ────────────────────── */

/**
 * Подделка снимка: правка на копии — и ОБЯЗАТЕЛЬНЫЙ пересчёт отпечатка.
 *
 * Без пересчёта любая правка счётчиков валится на `snapshotDigest`, и
 * проверка, которую тест якобы испытывает, остаётся незатронутой: тест
 * зеленеет по чужой причине. Поймано мутацией.
 */
class ForgeFailed extends Error {
  constructor(cause) {
    super(`подделка не выполнилась: ${cause.message}`)
    this.name = 'ForgeFailed'
    this.forgeFailed = true
  }
}
const forgeFrom = (base, mutate) => {
  const copy = JSON.parse(JSON.stringify(base))
  try {
    mutate(copy)
  } catch (error) {
    throw new ForgeFailed(error)
  }
  copy.snapshotDigest = sha256Bytes(canonicalJsonBytes({
    contractVersion: copy.contractVersion,
    scope: copy.scope,
    entryUrl: copy.entryUrl,
    complete: copy.complete,
    incompleteReasons: copy.incompleteReasons,
    robotsEvidence: copy.robotsEvidence,
    catalogueEvidence: copy.catalogueEvidence,
    catalogueTargetEvidence: copy.catalogueTargetEvidence,
    orderRecords: copy.orderRecords.map((row) => row.orderDigest),
    records: copy.records.map((r) => r.observationDigest),
    rejected: copy.rejected,
    counters: copy.counters,
  }, `${copy.contractVersion}#snapshot`))
  return copy
}

/*
 * Каталог трёх семейств. Одна и та же корневая форма стоит в нём ДВАЖДЫ:
 * «/destinations/fixture-root-region/» — коллекция,
 * «/destinations/fixture-root-object/» — объект.
 * Если бы роль выводилась из адреса, различить их было бы нечем.
 */
const ROOT_COLLECTION = fixture('root-collection.html')
const ROOT_POI = fixture('root-poi.html')
const NESTED_POI = fixture('nested-poi.html')

const MIXED_ENTRY = CATALOGUE_CLEAN
  .replace(
    '<a href="/e/e1003a.html">Gamma with a letter suffix</a>',
    '<a href="/destinations/fixture-root-region/">Root collection</a>'
    + '<a href="/destinations/fixture-root-object/">Root object</a>',
  )
  .replaceAll('<a href="/e/e1002.html">Beta</a>', '')

const MIXED_PAGES = new Map([
  [ENTRY, MIXED_ENTRY],
  [`${HOST}/e/e1001.html`, DESTINATION],
  [`${HOST}/e/e2001.html`, ATTRACTION],
  [`${HOST}/e/e2002.html`, ATTRACTION],
  [`${HOST}/e/e4000.html`, ATTRACTION],
  [`${HOST}/destinations/fixture-root-region/`, ROOT_COLLECTION],
  [`${HOST}/destinations/fixture-root-object/`, ROOT_POI],
  [`${HOST}/destinations/fixture-root-region/nested-object.html`, NESTED_POI],
])
const mixed = await crawl({ fetchImpl: router(MIXED_PAGES) })

t('обход трёх семейств полон', mixed.discovery.complete, true)
const roleOf = (key) => mixed.discovery.catalogueTargetEvidence
  .find((row) => row.sourceKey === key)?.evidence.pageRole

/* 1. Роль НЕ выводится из адреса. */
t('корневая форма бывает коллекцией', roleOf('japan-guide:destinations:fixture-root-region'), 'collection')
t('и та же форма бывает объектом', roleOf('japan-guide:destinations:fixture-root-object'), 'poi')
t('legacy-цель тоже классифицируется', roleOf('japan-guide:e1001'), 'collection')

/* 6. Ключ описывает ПУТЬ, а не роль. */
t('ключ коллекции по пути',
  discoverySourceKey(`${HOST}/destinations/fixture-root-region/`),
  'japan-guide:destinations:fixture-root-region')
t('ключ объекта той же формы построен так же',
  discoverySourceKey(`${HOST}/destinations/fixture-root-object/`),
  'japan-guide:destinations:fixture-root-object')
t('в ключе нет ни слова о роли',
  ['collection', 'poi', 'catalogue'].some((role) =>
    discoverySourceKey(`${HOST}/destinations/fixture-root-object/`).includes(role)), false)

/* 7. Вложенный адрес не выдаёт себя за корневой и наоборот. */
t('вложенная цель разобрана как вложенная',
  canonicalDiscoveryUrl(`${HOST}/destinations/fixture-root-region/nested-object.html`).family,
  'destinationNested')
throwsWith('вложенный путь без .html корневым не становится',
  () => canonicalDiscoveryUrl(`${HOST}/destinations/fixture-root-region/nested-object`))
throwsWith('корневой путь с .html вложенным не становится',
  () => canonicalDiscoveryUrl(`${HOST}/destinations/fixture-root-region.html`))

/* 5. Прямому объекту НЕ приписан ранг и НЕ приписано направление. */
const rootPoi = mixed.discovery.records.find((r) => r.sourceKey === 'japan-guide:destinations:fixture-root-object')
t('прямой объект записан', Boolean(rootPoi), true)
t('у него ровно одно размещение', rootPoi.placements.length, 1)
t('и оно прямое', rootPoi.placements[0].kind, 'catalogueDirect')
eq('три поля ранжирования пусты',
  [rootPoi.placements[0].listPosition, rootPoi.placements[0].editorialLevel, rootPoi.placements[0].categoryHint],
  [null, null, null])
t('порядка для него не заведено',
  mixed.discovery.orderRecords.some((row) => row.destinationSourceKey === rootPoi.sourceKey), false)

/* 8. «catalogueDirect» связан именно с каталогом. */
t('прямое размещение ссылается на ключ каталога',
  rootPoi.placements[0].collectionSourceKey, discoverySourceKey(mixed.discovery.catalogueEvidence.url))
throwsWith('прямое размещение с ключом направления невозможно', () => buildPlacement({
  kind: 'catalogueDirect', collectionSourceKey: 'japan-guide:e2157',
  listPosition: null, editorialLevel: null, categoryHint: null,
}))
throwsWith('ранжирование с ключом каталога невозможно', () => buildPlacement({
  kind: 'destinationRanking', collectionSourceKey: CATALOGUE_SOURCE_KEY,
  listPosition: 1, editorialLevel: 0, categoryHint: null,
}))
throwsWith('прямое размещение с выдуманным рангом невозможно', () => buildPlacement({
  kind: 'catalogueDirect', collectionSourceKey: CATALOGUE_SOURCE_KEY,
  listPosition: 1, editorialLevel: null, categoryHint: null,
}))
throwsWith('прямое размещение с выдуманной категорией невозможно', () => buildPlacement({
  kind: 'catalogueDirect', collectionSourceKey: CATALOGUE_SOURCE_KEY,
  listPosition: null, editorialLevel: null, categoryHint: 'Castle',
}))
throwsWith('прямое размещение без цели каталога с ролью poi невозможно',
  () => assertDiscoverySnapshot(forgeFrom(mixed.discovery, (s) => {
    const row = s.catalogueTargetEvidence.find((r) => r.sourceKey === rootPoi.sourceKey)
    row.evidence.pageRole = 'collection'
  })))

/* 4. Рекурсии нет: вложенный объект взят КАРТОЧКОЙ коллекции. */
const nested = mixed.discovery.records.find(
  (r) => r.sourceKey === 'japan-guide:destinations:fixture-root-region:nested-object')
t('вложенный объект записан', Boolean(nested), true)
t('его размещение — ранжирование', nested.placements[0].kind, 'destinationRanking')
t('и коллекция та, что его перечислила',
  nested.placements[0].collectionSourceKey, 'japan-guide:destinations:fixture-root-region')
t('целью каталога вложенный объект не стал', roleOf(nested.sourceKey), undefined)
t('порядок ведётся только для коллекций',
  mixed.discovery.orderRecords.length, mixed.discovery.counters.catalogueCollectionsFound)

/* 2 и 3. Обе роли сразу и ни одной — отказ цели, а не выбор. */
const ambiguousTarget = new Map([...MIXED_PAGES])
ambiguousTarget.set(`${HOST}/destinations/fixture-root-object/`, HYBRID)
const ambiguousRun = await crawl({ fetchImpl: router(ambiguousTarget) })
t('двусмысленная цель делает снимок неполным', ambiguousRun.discovery.complete, false)
t('и попадает в отказы цели своим кодом',
  ambiguousRun.discovery.rejected.targets.some((row) => row.code === 'pageRoleAmbiguous'), true)
t('целью она не записана', ambiguousRun.discovery.catalogueTargetEvidence
  .some((row) => row.sourceKey === 'japan-guide:destinations:fixture-root-object'), false)
/* Причина неполноты по-прежнему ОДНА на оба исхода: разделены коды отказа,
   а не причины. Если бы разделение утекло в причины, снимок объявил бы
   причину вне закрытого списка `INCOMPLETE_REASONS`. */
t('причина неполноты у двусмысленной цели прежняя',
  ambiguousRun.discovery.incompleteReasons.some((r) => r.code === 'targetStructureMismatch'), true)

const rolelessTarget = new Map([...MIXED_PAGES])
rolelessTarget.set(`${HOST}/destinations/fixture-root-object/`,
  '<!doctype html><html><head><meta charset="UTF-8"></head><body><p>nothing</p></body></html>')
const rolelessRun = await crawl({ fetchImpl: router(rolelessTarget) })
t('цель без роли делает снимок неполным', rolelessRun.discovery.complete, false)
t('и названа причиной уровня цели',
  rolelessRun.discovery.incompleteReasons.some((r) => r.code === 'targetStructureMismatch'), true)
t('в отказах у неё код «ни одной грамматики»',
  rolelessRun.discovery.rejected.targets.some((row) => row.code === 'pageRoleUnknown'), true)
/* Два прогона, две страницы, ДВА РАЗНЫХ кода. До 18.08 обе строки снимка
   были байт в байт одинаковы, и 166 отказов canary не различались. */
t('и это не тот же код, что у двусмысленной цели',
  rolelessRun.discovery.rejected.targets.find((row) => row.code === 'pageRoleUnknown')?.code
  !== ambiguousRun.discovery.rejected.targets.find((row) => row.code === 'pageRoleAmbiguous')?.code,
  true)

/* 9. Полный снимок без классификации КАЖДОЙ цели невозможен. */
t('коллекции и прямые объекты дают в сумме число целей',
  mixed.discovery.counters.catalogueCollectionsFound + mixed.discovery.counters.directPoisFound,
  mixed.discovery.counters.catalogueTargetsFound)
throwsWith('цель без свидетельства делает полный снимок невозможным',
  () => assertDiscoverySnapshot(forgeFrom(mixed.discovery, (s) => {
    s.counters.catalogueTargetsFound += 1
  })))
/* Роли переставлены местами: сумма и число свидетельств сохранены, поэтому
   сработать может ТОЛЬКО сверка ролей со счётчиками. */
throwsWith('счётчик ролей обязан сходиться со свидетельствами',
  () => assertDiscoverySnapshot(forgeFrom(mixed.discovery, (s) => {
    const collections = s.counters.catalogueCollectionsFound
    s.counters.catalogueCollectionsFound = s.counters.directPoisFound
    s.counters.directPoisFound = collections
  })))


/* ── Разбор привязан к байтам страницы ────────────────────────────────── */

/*
 * Оба контрпримера были приняты исполнением: свидетельства относились к
 * одному URL, но описывали РАЗНЫЕ байты. Такой снимок утверждал, что имя и
 * подсказки прочитаны из страницы, которую он же предъявляет как наблюдение,
 * — а прочитаны они были из другой её версии.
 */
const OTHER_BYTES = `sha256:${'e'.repeat(64)}`

throwsWith('прямой объект: свидетельства цели и записи описывают одни байты',
  () => assertDiscoverySnapshot(forgeFrom(mixed.discovery, (s) => {
    const row = s.catalogueTargetEvidence.find((r) => r.sourceKey === rootPoi.sourceKey)
    row.evidence.rawPageDigest = OTHER_BYTES
  })), 'разные наблюдения')
throwsWith('и наоборот, со стороны записи',
  () => assertDiscoverySnapshot(forgeFrom(mixed.discovery, (s) => {
    const rec = s.records.find((r) => r.sourceKey === rootPoi.sourceKey)
    rec.pageEvidence.rawPageDigest = OTHER_BYTES
  })), 'не сходится')
/* Одного отпечатка мало: размер и диагностика тоже входят в сравнение. */
throwsWith('прямой объект: расхождение по размеру страницы тоже ловится',
  () => assertDiscoverySnapshot(forgeFrom(mixed.discovery, (s) => {
    const row = s.catalogueTargetEvidence.find((r) => r.sourceKey === rootPoi.sourceKey)
    row.evidence.pageBytes += 1
  })), 'разные наблюдения')

/* Коллекция: порядок и свидетельство обязаны быть из одних байтов. */
const collectionKey = 'japan-guide:destinations:fixture-root-region'
t('порядок несёт отпечаток своей страницы',
  mixed.discovery.orderRecords.find((r) => r.destinationSourceKey === collectionKey).sourcePageDigest,
  mixed.discovery.catalogueTargetEvidence
    .find((r) => r.sourceKey === collectionKey).evidence.rawPageDigest)
throwsWith('порядок от другой версии страницы невозможен',
  () => assertDiscoverySnapshot(forgeFrom(mixed.discovery, (s) => {
    const row = s.orderRecords.find((r) => r.destinationSourceKey === collectionKey)
    row.sourcePageDigest = OTHER_BYTES
    row.orderDigest = poiOrderDigest(
      collectionKey, OTHER_BYTES, orderedPoiKeys(row), row.collectionKind)
  })), 'а свидетельство коллекции')
throwsWith('подмена только свидетельства коллекции тоже ловится',
  () => assertDiscoverySnapshot(forgeFrom(mixed.discovery, (s) => {
    const row = s.catalogueTargetEvidence.find((r) => r.sourceKey === collectionKey)
    row.evidence.rawPageDigest = OTHER_BYTES
  })), 'порядок прочитан из')


/* ── Потребитель шаблонов ссылок ──────────────────────────────────────── */

/*
 * Реестр объявляет шаблоны, но фильтрует ссылки НЕ он. Прежний набор
 * проверял только объявление, и поддержка `linkPatterns` в профилировщике
 * оставалась неисполняемой: портал мог молча остаться без фильтра.
 */
/* Сравниваем СКОМПИЛИРОВАННЫЕ выражения: `RegExp.source` экранирует «/»,
   и сверка с исходной строкой ловила бы экранирование, а не смысл. */
const sources = (list) => list.map((r) => String(r))
eq('прежняя одиночная форма читается',
  sources(compileLinkPatterns({ linkPattern: '^/en/' })), sources([new RegExp('^/en/')]))
eq('новая множественная форма читается',
  sources(compileLinkPatterns(japanGuide.discovery)),
  sources(japanGuide.discovery.linkPatterns.map((x) => new RegExp(x))))
eq('портал без объявления фильтра не получает', compileLinkPatterns({}), [])
eq('и discovery может отсутствовать вовсе', compileLinkPatterns(undefined), [])

throwsWith('обе формы сразу невозможны',
  () => compileLinkPatterns({ linkPattern: '^/a/', linkPatterns: ['^/b/'] }), 'одновременно')
throwsWith('пустой список невозможен', () => compileLinkPatterns({ linkPatterns: [] }), 'пустой список')
throwsWith('нестроковый элемент невозможен', () => compileLinkPatterns({ linkPatterns: [42] }), 'непустая строка')
throwsWith('пустая строка невозможна', () => compileLinkPatterns({ linkPatterns: [''] }), 'непустая строка')
throwsWith('не массив невозможен', () => compileLinkPatterns({ linkPatterns: '^/a/' }), 'массив строк')
throwsWith('негодное регулярное выражение невозможно',
  () => compileLinkPatterns({ linkPatterns: ['^/a(/'] }), 'негодное регулярное выражение')

/*
 * Фактический отбор — НАСТОЯЩИМ потребителем, а не копией его логики.
 *
 * Здесь стояла локальная функция `keeps()`, повторявшая условия
 * профилировщика. Она зеленела, даже когда настоящий отбор был сломан:
 * замена `compileLinkPatterns(...)` на `[]` в профилировщике набор не
 * роняла. Копия проверяет копию.
 */
const ENTRY_LINKS = fixture('entry-links.html')
const picked = selectSampleLinks({
  html: ENTRY_LINKS,
  portal: japanGuide,
  origin: HOST,
  limit: 100,
}).map((row) => row.url)

eq('отобраны ровно ссылки трёх разрешённых семейств, по одному разу', picked, [
  `${HOST}/e/e4000.html`,
  `${HOST}/e/e623a.html`,
  `${HOST}/destinations/nozawa-onsen/`,
  `${HOST}/destinations/nozawa-onsen/hot-spring-baths.html`,
  `${HOST}/destinations/motonosumi-shrine/`,
])
t('дубль взят один раз', picked.filter((u) => u.endsWith('/e/e4000.html')).length, 1)
for (const [label, path] of [
  ['чужой хост', '/e/e1004.html'],
  ['путь вне семейств', '/local/e9999.html'],
  ['верхний регистр', '/destinations/Nozawa-Onsen/'],
  ['без завершающего слэша', '/destinations/nozawa-onsen'],
  ['чужое расширение', '/e/e4000.htm'],
  ['ассет', '/wroot/css/base.css'],
  ['вне грамматики', '/e/privacy.html'],
  ['относительная ссылка', '/relative/page.html'],
]) t(`отброшено: ${label}`, picked.some((u) => u.endsWith(path)), false)

/*
 * ПОДДЕЛКА ORIGIN. Каждая ссылка ниже содержит строку «www.japan-guide.com»,
 * и сравнение подстрокой их пропускало: путь брался законный, приклеивался к
 * НАШЕМУ origin — и чужая ссылка выходила из отбора как своя.
 *
 * Проверяем по пути, а не по полному адресу: именно путь и приклеивался,
 * поэтому уцелевшая подделка видна как наш адрес с чужим путём.
 */
for (const [label, path] of [
  ['суффиксный домен', '/e/e9999.html'],
  ['userinfo перед настоящим хостом', '/e/e8888.html'],
  ['другая схема', '/e/e7777.html'],
  ['другой порт', '/e/e6666.html'],
  ['более глубокий поддомен', '/e/e5555.html'],
]) t(`подделка origin отброшена: ${label}`, picked.some((u) => u.endsWith(path)), false)

/* Положительный контроль: настоящий абсолютный адрес своего origin взят. */
t('абсолютный адрес своего origin взят',
  picked.includes(`${HOST}/destinations/motonosumi-shrine/`), true)

t('предел отбора соблюдается',
  selectSampleLinks({ html: ENTRY_LINKS, portal: japanGuide, origin: HOST, limit: 2 }).length, 2)

/* Портал без шаблонов фильтра не получает — и это видно на той же фикстуре. */
t('без шаблонов берутся и посторонние пути',
  selectSampleLinks({
    html: ENTRY_LINKS,
    portal: { ...japanGuide, discovery: { entry: japanGuide.discovery.entry } },
    origin: HOST,
    limit: 100,
  }).some((row) => row.url.endsWith('/local/e9999.html')), true)

/* Импорт профилировщика не поднимает прогон: ни сети, ни кода возврата. */
t('импорт профилировщика код возврата не трогает', process.exitCode, undefined)


/* ── Предел, который ничего не отрезал ────────────────────────────────── */

/*
 * Живой canary 18.08 израсходовал 210 обменов и упал на построении снимка:
 * `--limit 50` при 50 и менее объектах давал охват `limited` без причины
 * `limitApplied`. Ни один офлайн-тест этого не ловил, потому что все проверки
 * предела брали предел МЕНЬШЕ числа объектов.
 *
 * Решение: охват описывает ФАКТ. Предел, который ничего не отрезал, оставляет
 * обход полным — и снимок годится основанием мониторинга.
 */
const poiCount = run.discovery.counters.poisFound

const generous = await crawl({ limit: poiCount + 949 })
assertDiscoverySnapshot(generous.discovery); ok++
eq('предел больше числа объектов причин не порождает', generous.discovery.incompleteReasons, [])
eq('и охват остаётся ПОЛНЫМ', generous.discovery.scope, { kind: 'full', limit: null })
t('такой снимок — основание мониторинга', generous.discovery.complete, true)
t('и все объекты записаны', generous.discovery.records.length, poiCount)

/* Предел РОВНО по числу объектов — граница, на которой ошибка и жила. */
const exact = await crawl({ limit: poiCount })
assertDiscoverySnapshot(exact.discovery); ok++
eq('предел ровно по числу объектов ничего не отрезает', exact.discovery.incompleteReasons, [])
eq('охват при этом полный', exact.discovery.scope, { kind: 'full', limit: null })
t('и снимок полон', exact.discovery.complete, true)

/* На единицу меньше — предел отрезает: причина, охват и обрезание разом. */
const cut = await crawl({ limit: poiCount - 1 })
assertDiscoverySnapshot(cut.discovery); ok++
eq('предел на единицу меньше называет причину',
  cut.discovery.incompleteReasons, [{ code: 'limitApplied', count: 1 }])
eq('и охват становится ограниченным', cut.discovery.scope, { kind: 'limited', limit: poiCount - 1 })
t('снимком такой прогон не является', cut.discovery.complete, false)
t('и записей на одну меньше', cut.discovery.records.length, poiCount - 1)

/* ── Черновик отвергнутого снимка ─────────────────────────────────────── */

/*
 * Здесь стояла проверка, проходившая и при `attached === null`, — то есть не
 * проверявшая ничего: снятие прикрепления её не роняло. Теперь снимок
 * заведомо негоден, исключение обязано быть, а поля черновика сверяются с
 * переданными.
 */
const DRAFT_ENTRY = `${HOST}/e/e623a.html`
const badInput = {
  scope: { kind: 'limited', limit: 7 },
  entryUrl: DRAFT_ENTRY,
  /* Ограниченный охват без причины — заведомый отказ контракта. */
  incompleteReasons: [],
  /* Потолки настоящие: черновик обязан отвергаться ПО ПРИЧИНЕ, ради которой
     собран, а не спотыкаться раньше на отсутствующем поле. */
  networkPolicy: run.discovery.networkPolicy,
  robotsEvidence: run.discovery.robotsEvidence,
  catalogueEvidence: run.discovery.catalogueEvidence,
  catalogueTargetEvidence: run.discovery.catalogueTargetEvidence,
  orderRecords: run.discovery.orderRecords,
  records: run.discovery.records,
  rejected: run.discovery.rejected,
  counters: run.discovery.counters,
}
let thrown = null
try {
  buildDiscoverySnapshot(badInput)
} catch (error) {
  thrown = error
}
t('заведомо негодный снимок отвергнут', thrown !== null, true)
t('сообщение отказа сохранено',
  String(thrown?.message ?? '').includes('без причины «limitApplied»'), true)
t('черновик прикреплён к ошибке', thrown?.rejectedSnapshot != null, true)
eq('охват черновика — тот, что передали', thrown?.rejectedSnapshot?.scope, badInput.scope)
t('точка входа черновика — та, что передали', thrown?.rejectedSnapshot?.entryUrl, DRAFT_ENTRY)
t('счётчики черновика — те, что передали',
  thrown?.rejectedSnapshot?.counters.poisFound, badInput.counters.poisFound)
t('записей в черновике столько же', thrown?.rejectedSnapshot?.records.length, badInput.records.length)
t('черновик несёт свой отпечаток', typeof thrown?.rejectedSnapshot?.snapshotDigest, 'string')

/* ── Отбракованный список ≠ сломанная страница ────────────────────────────
 * ИЗМЕРЕНО 18.08 probe: обе цели — `collection`, DOM-карточки на месте (25 и
 * 2), но `parseDestination` бросал общий `structureMismatch`, и снимок
 * объявлял исправную коллекцию целью с неизвестной структурой. Все 166
 * отказов и `catalogueCollectionsFound: 0` — отсюда. */

/* Карточки есть, но ни одна не проходит ворота: элементы ранга вырезаны. */
const ALL_CARDS_BAD = DESTINATION.replace(/<div class="spot_list__spot__rank_no">[^<]*<\/div>/g, '')
/* Группа без единой DOM-карточки: вырезаны сами <li>. */
const NO_DOM_CARDS = DESTINATION.replace(/<li class="spot_list__spot [\s\S]*?<\/li>/g, '')

throwsWith('ноль DOM-карточек — отказ страницы',
  () => parseDestination({ html: NO_DOM_CARDS, url: `${HOST}/e/e2157.html` }),
  'нет ни одной DOM-карточки')

const allBad = parseDestination({ html: ALL_CARDS_BAD, url: `${HOST}/e/e2157.html` })
t('карточки есть, все негодны — разбор ПРОШЁЛ', Array.isArray(allBad.cards), true)
t('принятых карточек ноль', allBad.cards.length, 0)
t('отказы карточек сохранены полностью', allBad.rejectedCards.length, 2)
eq('и каждый со своей позицией и кодом', allBad.rejectedCards,
  [{ index: 1, code: 'rankElementMissing' }, { index: 2, code: 'rankElementMissing' }])

/* Тот же случай на обходе: цель обязана остаться коллекцией. */
const BAD_CARDS_PAGES = new Map([...PAGES])
BAD_CARDS_PAGES.set(`${HOST}/e/e1001.html`, ALL_CARDS_BAD)
const badCards = await crawl({ fetchImpl: router(BAD_CARDS_PAGES) })
const badKey = 'japan-guide:e1001'
const badEvidence = badCards.discovery.catalogueTargetEvidence.find((row) => row.sourceKey === badKey)
t('свидетельство цели сохранено', Boolean(badEvidence), true)
t('и роль в нём — collection', badEvidence?.evidence.pageRole, 'collection')
t('цель НЕ попала в отказы',
  badCards.discovery.rejected.targets.some((row) => row.ref === badKey), false)
const badOrder = badCards.discovery.orderRecords.find((row) => row.destinationSourceKey === badKey)
t('пустой порядок записан', Boolean(badOrder), true)
eq('и он действительно пуст', badOrder && orderedPoiKeys(badOrder), [])
t('порядок привязан к байтам той же страницы',
  badOrder?.sourcePageDigest, badEvidence?.evidence.rawPageDigest)

const badRejections = badCards.discovery.rejected.cards.filter((row) => row.destination === badKey)
t('отказы карточек в снимке', badRejections.length, 2)
eq('позиция и код у каждого', badRejections.map((row) => `${row.position}:${row.code}`),
  ['1:rankElementMissing', '2:rankElementMissing'])
/* Причина неполноты — про карточки, а не про структуру страницы. */
t('причина неполноты — cardRejected',
  badCards.discovery.incompleteReasons.some((r) => r.code === 'cardRejected'), true)
t('и НЕ про структуру цели',
  badCards.discovery.incompleteReasons.some((r) => r.code === 'targetStructureMismatch'), false)
t('число cardRejected равно числу отвергнутых карточек',
  badCards.discovery.incompleteReasons.find((r) => r.code === 'cardRejected')?.count,
  badCards.discovery.rejected.cards.length)
t('снимок остаётся неполным', badCards.discovery.complete, false)
/* Коллекция посчитана: до правки счётчик терял её вместе с исключением. */
t('коллекция посчитана', badCards.discovery.counters.catalogueCollectionsFound, 3)
t('порядков столько же, сколько коллекций',
  badCards.discovery.orderRecords.length, badCards.discovery.counters.catalogueCollectionsFound)

/* ── Аннотация в span, маркер — её завершающий хвост ──────────────────────
 * ИЗМЕРЕНО probe 10c: `span` несёт аннотацию, U+2022 стоит в конце и
 * необязателен. На `e2157` формы дали 13 / 10 / 2. Прежняя грамматика
 * требовала, чтобы весь `span` был точками, и отвергала все 25 карточек.
 *
 * Фикстура синтетическая: из измерения взята ФОРМА, не текст. */
const MARKER_FORMS = fixture('marker-forms.html')
const marker = parseDestination({ html: MARKER_FORMS, url: `${HOST}/e/e3000.html` })

t('пять измеренных форм — ни одного отказа', marker.rejectedCards.length, 0)
t('приняты все пять', marker.cards.length, 5)
eq('уровни по формам', marker.cards.map((c) => c.editorialLevel), [0, 0, 1, 2, 1])
eq('позиции читаются как прежде', marker.cards.map((c) => c.listPosition), [1, 2, 3, 4, 5])
/* Аннотация не имя и никуда не сохраняется: в подсказки идёт `nameEn`
   со страницы объекта, а из карточки — только категория. */
eq('из карточки взята категория, не аннотация',
  marker.cards.map((c) => c.categoryHintRaw.trim()),
  ['Castle', 'Garden', 'Shrine', 'Temple', 'Museum'])

/* Формы, которых измерение не видело, — по-прежнему отказ карточки. */
const formCase = (span) => parseDestination({
  html: MARKER_FORMS.replace('<span>Local</span>', span),
  url: `${HOST}/e/e3000.html`,
}).rejectedCards.map((r) => r.code)
eq('точка внутри префикса', formCase('<span>&#8226;Local</span>'), ['invalidMarker'])
eq('четыре завершающие точки', formCase('<span>Local&#8226;&#8226;&#8226;&#8226;</span>'), ['invalidMarker'])
eq('пустой span', formCase('<span></span>'), ['invalidMarker'])
eq('два span', formCase('<span>Local</span><span>&#8226;</span>'), ['multipleMarkerSpans'])
/* Аннотация без точки НЕ отказ — ровно та карточка, которую прежняя
   грамматика теряла чаще всего: 13 из 25 на измеренной странице. */
eq('аннотация без точки отказом не является', formCase('<span>Local</span>'), [])

/* Граница аннотации на настоящем разборе карточки: подмена символа маркера
   отвергает КОНКРЕТНУЮ карточку, а не проходит тихим нулём. */
eq('U+00B7 вместо маркера', formCase('<span>Local&#183;&#183;</span>'), ['invalidMarker'])
eq('смешанная форма', formCase('<span>Local&#183;&#8226;</span>'), ['invalidMarker'])
eq('звезда вместо маркера', formCase('<span>Local&#9733;</span>'), ['invalidMarker'])
eq('скобочная аннотация принимается', formCase('<span>(Local)</span>'), [])
eq('японская аннотация принимается', formCase('<span>&#21608;&#36794;</span>'), [])
eq('внутренняя точка допустима', formCase('<span>Local&#183;Name</span>'), [])
/* Отказ атрибутирован: позиция карточки и код — на месте, снимок неполон
   по существующей причине `cardRejected`, новых сущностей не заведено. */
const boundaryRejected = parseDestination({
  html: MARKER_FORMS.replace('<span>Local</span>', '<span>Local&#183;&#183;</span>'),
  url: `${HOST}/e/e3000.html`,
}).rejectedCards
eq('позиция и код отказа', boundaryRejected, [{ index: 2, code: 'invalidMarker' }])

/* ── Суффиксное семейство `/e/eNNNN_<suffix>.html` ────────────────────────
 * ИЗМЕРЕНО 19.08 canary: три ссылки карточек `e5025` отвергались с
 * `pathDenied`. Все три — объекты. */

const SUFFIX_PATHS = ['/e/e5036_school.html', '/e/e5038_memorial.html', '/e/e5036_fish.html']
const NUMERIC_SUFFIX_PATHS = Array.from({ length: 6 }, (_, index) =>
  `/e/e3034_${String(index + 1).padStart(3, '0')}.html`)
eq('три суффиксных адреса — одно семейство',
  SUFFIX_PATHS.map((path) => canonicalDiscoveryUrl(`${HOST}${path}`).family),
  ['legacySuffix', 'legacySuffix', 'legacySuffix'])
const suffixKeys = SUFFIX_PATHS.map((path) => discoverySourceKey(`${HOST}${path}`))
eq('ключи несут суффикс целиком', suffixKeys,
  ['japan-guide:e5036_school', 'japan-guide:e5038_memorial', 'japan-guide:e5036_fish'])
/* Два адреса делят номер `e5036`: схлопнись ключи — два объекта стали бы одним. */
t('ключи различны', new Set(suffixKeys).size, 3)

eq('шесть измеренных цифровых адресов — legacySuffix',
  NUMERIC_SUFFIX_PATHS.map((path) => canonicalDiscoveryUrl(`${HOST}${path}`).family),
  Array(6).fill('legacySuffix'))
eq('цифровые ключи сохраняют три цифры',
  NUMERIC_SUFFIX_PATHS.map((path) => discoverySourceKey(`${HOST}${path}`)),
  Array.from({ length: 6 }, (_, index) => `japan-guide:e3034_${String(index + 1).padStart(3, '0')}`))
t('верхняя граница трёх цифр принимается',
  discoverySourceKey(`${HOST}/e/e3034_999.html`), 'japan-guide:e3034_999')

for (const [label, path, code] of [
  ['верхний регистр', '/e/e5036_School.html', 'pathDenied'],
  ['двойное подчёркивание', '/e/e5036__fish.html', 'pathDenied'],
  ['цифра в суффиксе', '/e/e5036_fish2.html', 'pathDenied'],
  ['пустой суффикс', '/e/e5036_.html', 'pathDenied'],
  ['одна цифра', '/e/e3034_1.html', 'pathDenied'],
  ['две цифры', '/e/e3034_01.html', 'pathDenied'],
  ['четыре цифры', '/e/e3034_0001.html', 'pathDenied'],
  ['смешанный буквенно-цифровой', '/e/e3034_a12.html', 'pathDenied'],
  ['хвост после трёх цифр', '/e/e3034_001_more.html', 'pathDenied'],
  ['верхний регистр расширения', '/e/e3034_001.HTML', 'pathDenied'],
  ['лишний сегмент', '/e/e5036_fish/more.html', 'pathDenied'],
  ['query', '/e/e5036_fish.html?utm=1', 'urlNotCanonical'],
  ['fragment', '/e/e5036_fish.html#top', 'urlNotCanonical'],
  ['percent-encoding', '/e/e5036%5Ffish.html', 'urlNotCanonical'],
]) {
  throwsWith(`суффикс отвергает ${label}`, () => canonicalDiscoveryUrl(`${HOST}${path}`), code)
}

/* Прежняя идентичность НЕ расширена: старые артефакты обязаны читаться
   ровно так же, как читались. */
throwsWith('canonicalPageUrl суффикс не принимает',
  () => canonicalPageUrl('/e/e5036_fish.html'), 'pathDenied')
throwsWith('старый sourceKeyFromUrl суффикс не принимает',
  () => sourceKeyFromUrl(`${HOST}/e/e5036_fish.html`), 'pathDenied')
throwsWith('canonicalPageUrl цифровой суффикс не принимает',
  () => canonicalPageUrl('/e/e3034_001.html'), 'pathDenied')
throwsWith('старый sourceKeyFromUrl цифровой суффикс не принимает',
  () => sourceKeyFromUrl(`${HOST}/e/e3034_001.html`), 'pathDenied')

/* End-to-end: обход доходит до обеих ветвей суффиксов и строит записи. */
const SUFFIX_CARDS = fixture('suffix-cards.html')
const SUFFIX_PAGES = new Map([
  [ENTRY, CATALOGUE_CLEAN],
  [`${HOST}/e/e1001.html`, SUFFIX_CARDS],
  [`${HOST}/e/e1002.html`, SUFFIX_CARDS],
  [`${HOST}/e/e1003a.html`, SUFFIX_CARDS],
  ...SUFFIX_PATHS.map((path) => [`${HOST}${path}`, ATTRACTION]),
  ...NUMERIC_SUFFIX_PATHS.map((path) => [`${HOST}${path}`, ATTRACTION]),
])
const suffixRun = await crawl({ fetchImpl: router(SUFFIX_PAGES) })
t('суффиксных ссылок каталог не отверг', suffixRun.discovery.rejected.cards.length, 0)
const numericSuffixKeys = NUMERIC_SUFFIX_PATHS.map((path) => discoverySourceKey(`${HOST}${path}`))
eq('записи построены по буквенным и цифровым суффиксным ключам',
  suffixRun.discovery.records.map((r) => r.sourceKey).sort(),
  [...suffixKeys, ...numericSuffixKeys].sort())
t('шесть цифровых ключей лежат в порядке коллекции',
  numericSuffixKeys.every((key) =>
    suffixRun.discovery.orderRecords.some((row) => orderedPoiKeys(row).includes(key))), true)
t('и роль каждой страницы — poi',
  suffixRun.discovery.records.every((r) => r.pageEvidence.pageRole === 'poi'), true)

/* ── Отбор структуры коллекции — один на двух потребителей ────────────── */

const TITLED = fixture('titled-groups.html')

/* Тест зовёт ПРОИЗВОДСТВЕННЫЙ отбор, своей копии условий не заводит. */
const titledStructure = selectCollectionStructure(load(TITLED))
t('отбор нашёл структуру', titledStructure.kind, 'selected')
t('групп взято две', titledStructure.groups.length, 2)

t('роль страницы — коллекция', classifyPageRole(load(TITLED), `${HOST}/e/e2158.html`), 'collection')
const titled = parseDestination({ html: TITLED, url: `${HOST}/e/e2158.html` })
eq('разобраны все четыре карточки обеих групп', titled.cards.map((c) => c.sourceKey),
  ['japan-guide:e4101', 'japan-guide:e4102', 'japan-guide:e4103', 'japan-guide:e4104'])
/* Вспомогательная секция без сигнатуры в разбор не попала. */
t('карточка вспомогательного списка не взята',
  titled.cards.some((c) => c.sourceKey === 'japan-guide:e4900'), false)
t('отказов карточек нет', titled.rejectedCards.length, 0)
/* Повтор ранга МЕЖДУ группами допустим: сайт нумерует внутри группы. */
eq('ранги повторяются между группами', titled.cards.map((c) => c.listPosition), [1, 2, 1, 2])

/* Внутри ОДНОЙ группы повтор — по-прежнему отказ. */
const repeatedInGroup = parseDestination({
  html: TITLED.replace('<div class="spot_list__spot__rank_no">2</div>\n          <div class="spot_list__spot__meta">Garden</div>',
    '<div class="spot_list__spot__rank_no">1</div>\n          <div class="spot_list__spot__meta">Garden</div>'),
  url: `${HOST}/e/e2158.html`,
})
eq('повтор внутри группы отвергнут', repeatedInGroup.rejectedCards, [{ index: 2, code: 'rankRepeated' }])

/* Одна безымянная группа — берётся только она, Side Trips отсекаются. */
const oneHeadless = parseDestination({ html: DESTINATION, url: `${HOST}/e/e2157.html` })
eq('соседняя озаглавленная группа не взята', oneHeadless.cards.map((c) => c.sourceKey),
  ['japan-guide:e2001', 'japan-guide:e2002'])
t('Side Trips по-прежнему не обходятся',
  oneHeadless.cards.some((c) => c.sourceKey === 'japan-guide:e2900'), false)

/* Вспомогательный список ВНЕ сигнатурной секции не делает страницу коллекцией
   и не даёт групп: сигнатурной секции здесь нет вовсе. */
const AUX_ONLY = TITLED.slice(TITLED.indexOf('<section id="section_spot_list">\n  <div class="spot_list__list_wrap">'))
t('без сигнатурной секции исход — absent',
  selectCollectionStructure(load(`<html><body>${AUX_ONLY}</body></html>`)).kind, 'absent')

/* ── Терминальная страница discovery ──────────────────────────────────────
 * CENSUS 20.08 доказал: 16 целей каталога и 8 кандидатов в объекты
 * размечены ОДИНАКОВО, различие одно — происхождение ссылки. Значит роль по
 * происхождению не определяется, и обе стороны каждой пары обязаны получить
 * одну и ту же роль. `poi` здесь — «терминальная страница discovery», а не
 * суждение о предметном виде объекта. */

const TERMINAL_AUX = fixture('terminal-aux.html')
const AUX_SECTION = TERMINAL_AUX.slice(
  TERMINAL_AUX.indexOf('<section id="section_spot_list">'),
  TERMINAL_AUX.indexOf('<section id="section_links">'))
/* Одна, две и три вспомогательные секции — ровно три формы census. */
const auxForm = (count) => TERMINAL_AUX.replace(AUX_SECTION, AUX_SECTION.repeat(count))

for (const count of [1, 2, 3]) {
  t(`терминальная страница с ${count} вспомогательными списками — poi`,
    classifyPageRole(load(auxForm(count)), `${HOST}/e/e4575.html`), 'poi')
  t(`и структура при этом absent (${count})`,
    selectCollectionStructure(load(auxForm(count))).kind, 'absent')
}

/* Классификатор физически не может зависеть от происхождения ссылки:
   у него ровно один параметр — разобранный документ. */
/*
 * Арность выросла до двух: добавился СОБСТВЕННЫЙ адрес страницы. Это её
 * идентичность, а не контекст вызова, и подменить его меткой нельзя —
 * второй аргумент проходит грамматику адресов.
 */
t('классификатор принимает документ и собственный адрес', classifyPageRole.length, 2)
throwsWith('вместо адреса роль не принимается',
  () => classifyPageRole(load(TERMINAL_AUX), 'catalogue'), 'pathDenied')
throwsWith('и чужой origin тоже', () => classifyPageRole(load(TERMINAL_AUX), 'https://example.org/e/e1.html'),
  'hostDenied')

/* Обе стороны пары — один и тот же байт-в-байт документ, пришедший РАЗНЫМИ
   путями: целью каталога и карточкой направления. Роль обязана совпасть. */
const PAIR_PAGES = new Map([
  [ENTRY, CATALOGUE_CLEAN],
  /* цель каталога */
  [`${HOST}/e/e1001.html`, auxForm(2)],
  /* направление, чьи карточки ведут на ту же форму */
  [`${HOST}/e/e1002.html`, DESTINATION],
  [`${HOST}/e/e1003a.html`, DESTINATION],
  [`${HOST}/e/e2001.html`, auxForm(2)],
  [`${HOST}/e/e2002.html`, ATTRACTION],
])
const pairRun = await crawl({ fetchImpl: router(PAIR_PAGES) })
const asTarget = pairRun.discovery.catalogueTargetEvidence
  .find((row) => row.sourceKey === 'japan-guide:e1001')
const asCard = pairRun.discovery.records.find((r) => r.sourceKey === 'japan-guide:e2001')
t('как цель каталога — роль poi', asTarget?.evidence.pageRole, 'poi')
t('как карточка направления — та же роль', asCard?.pageEvidence.pageRole, 'poi')
t('и отпечаток страницы один и тот же',
  asTarget?.evidence.rawPageDigest, asCard?.pageEvidence.rawPageDigest)
t('ни одна из них не отвергнута',
  pairRun.discovery.rejected.targets.length + pairRun.discovery.rejected.pois.length, 0)

/* Карточки Nozawa: H1, ни сигнатуры, ни списков вовсе — по-прежнему poi. */
t('H1 без списков остаётся poi', classifyPageRole(load(fixture('nested-poi.html')), `${HOST}/destinations/nozawa-onsen/hot-spring-baths.html`), 'poi')
t('корневой объект тоже', classifyPageRole(load(fixture('root-poi.html')), `${HOST}/destinations/motonosumi-shrine/`), 'poi')

/* Положительный ранг без сигнатуры — НЕ объект: список мог остаться от
   коллекции, у которой сигнатуру потеряла вёрстка. */
const RANKED_NO_SIGNATURE = DESTINATION
  .replace('spot_list__list_title s-typography--h3', 's-typography--h3')
throwsWith('удаление сигнатуры у ранжированной коллекции даёт pageRoleUnknown',
  () => classifyPageRole(load(RANKED_NO_SIGNATURE), `${HOST}/e/e2157.html`), 'pageRoleUnknown')
t('положительный ранг там действительно есть', hasPositiveRank(load(RANKED_NO_SIGNATURE)), true)
t('а у терминальной формы его нет', hasPositiveRank(load(auxForm(3))), false)

/* `invalid` не проваливается в остаточную ветку POI, даже при живом H1. */
const TWO_HEADLESS = TITLED
  .replace('<div class="spot_list__category__header">Group A</div>', '')
  .replace('<div class="spot_list__category__header">Group B</div>', '')
t('две безымянные группы — исход invalid',
  selectCollectionStructure(load(TWO_HEADLESS)).kind, 'invalid')
t('H1 у неё есть', load(TWO_HEADLESS)(SELECTORS.attraction.title).first().length > 0, true)
throwsWith('и роль — pageRoleUnknown, не poi',
  () => classifyPageRole(load(TWO_HEADLESS), `${HOST}/e/e2158.html`), 'pageRoleUnknown')
/*
 * Та же повреждённая коллекция, но БЕЗ положительных рангов. Без этого
 * случая ветка `invalid` не проверялась: ранжированный список ронял
 * страницу и по второй причине, и снятие проверки `invalid` проходило
 * незамеченным. Здесь остаётся ровно одна причина — повреждённая сигнатура.
 */
const TWO_HEADLESS_UNRANKED = TWO_HEADLESS.replace(/>[1-9][0-9]*<\/div>/g, '></div>')
t('положительных рангов у неё нет', hasPositiveRank(load(TWO_HEADLESS_UNRANKED)), false)
t('исход отбора — invalid', selectCollectionStructure(load(TWO_HEADLESS_UNRANKED)).kind, 'invalid')
throwsWith('повреждённая коллекция без рангов — тоже не poi',
  () => classifyPageRole(load(TWO_HEADLESS_UNRANKED), `${HOST}/e/e2158.html`), 'pageRoleUnknown')

/* Двусмысленность осталась достижимой. */
throwsWith('admission и валидная коллекция — pageRoleAmbiguous',
  () => classifyPageRole(load(HYBRID), `${HOST}/e/e2157.html`), 'pageRoleAmbiguous')

/* `parseAttraction` принимает терминальную страницу, но карточек её
   вспомогательных списков не извлекает: добавление ещё двух секций не
   меняет ни одной подсказки и не меняет семантический отпечаток. */
const TERMINAL_PAGE = { ...PAGE, url: `${HOST}/e/e4575.html` }
const terminalPlacements = [buildPlacement({
  kind: 'catalogueDirect',
  collectionSourceKey: CATALOGUE_SOURCE_KEY,
  listPosition: null,
  editorialLevel: null,
  categoryHint: null,
})]
const oneAux = parseAttraction({ html: auxForm(1), page: TERMINAL_PAGE, placements: terminalPlacements }).record
const threeAux = parseAttraction({ html: auxForm(3), page: TERMINAL_PAGE, placements: terminalPlacements }).record
t('терминальная страница разобрана', oneAux.nameEn.length > 0, true)
eq('подсказки только свои, не карточек списка',
  [...new Set(oneAux.factLeads.map((l) => l.sourceLocator))].sort(),
  ['h1', 'links_and_resources_official'])
t('число подсказок от вспомогательных секций не зависит',
  oneAux.factLeads.length, threeAux.factLeads.length)
t('и семантический отпечаток тоже', oneAux.semanticDigest, threeAux.semanticDigest)
t('ни одна подсказка не пришла из карточки',
  oneAux.factLeads.some((l) => l.value.includes('Aux Card')), false)

/* ── Офлайн-приёмка canary ──────────────────────────────────────────────
 *
 * Контрактная валидность и операционная приёмка — ДВА РАЗНЫХ исхода.
 * Сначала каждая синтетическая фикстура проходит `assertDiscoverySnapshot`,
 * затем тот же потребитель, который вызывает runner, возвращает точный
 * именованный список провалов. Общий `reject` не годится: соседний сторож
 * прикрывал бы снятую проверку.
 */

const CANARY_LIMIT = 50
const CANARY_MAX_REQUESTS = 300
const CANARY_MAX_REDIRECTS = 2
const CANARY_AT = '2026-08-19T00:00:00.000Z'
const canaryDigest = (label) => sha256Bytes(Buffer.from(`canary:${label}`, 'utf8'))
const canaryEvidence = (url, pageRole) => buildPageEvidence({
  url,
  pageRole,
  pageBytes: 100,
  rawPageDigest: canaryDigest(url),
  observedAt: CANARY_AT,
  httpCharset: 'shift-jis',
  metaCharset: 'utf-8',
  decodePolicy: DECODE_POLICY,
  decodeErrorCount: 0,
  decodeReplacements: 0,
  nonWhitelistedCodepoints: 0,
})

const CANARY_COLLECTION_URLS = Array.from({ length: 150 }, (_, index) =>
  `${HOST}/e/e${12000 + index}.html`)
const CANARY_DIRECT_URLS = Array.from({ length: 58 }, (_, index) =>
  `${HOST}/e/e${14000 + index}.html`)
const CANARY_OTHER_CHILD_URLS = Array.from({ length: 1106 }, (_, index) =>
  `${HOST}/e/e${20000 + index}.html`)
const CANARY_NUMERIC_URLS = EXPECTED_NUMERIC_SUFFIX_KEYS.map((key) =>
  `${HOST}/e/${key.slice('japan-guide:'.length)}.html`)
const CANARY_CHILD_URLS = [...CANARY_NUMERIC_URLS, ...CANARY_OTHER_CHILD_URLS]

const canaryOrderDigestV2 = (destinationSourceKey, sourcePageDigest, order) =>
  orderDigest({ destinationSourceKey, sourcePageDigest, collectionKind: 'ranked', order: [...order] },
    ORDER_SPEC_V2)
const canaryOrderRecordV2 = (destinationSourceKey, sourcePageDigest, order) => ({
  destinationSourceKey,
  sourcePageDigest,
  collectionKind: 'ranked',
  order: [...order],
  orderDigest: canaryOrderDigestV2(destinationSourceKey, sourcePageDigest, order),
})

const CANARY_TARGET_EVIDENCE = [
  ...CANARY_COLLECTION_URLS.map((url) => ({
    sourceKey: discoverySourceKey(url),
    evidence: canaryEvidence(url, 'collection'),
  })),
  ...CANARY_DIRECT_URLS.map((url) => ({
    sourceKey: discoverySourceKey(url),
    evidence: canaryEvidence(url, 'poi'),
  })),
]
const CANARY_COLLECTION_KEYS = CANARY_COLLECTION_URLS.map(discoverySourceKey)
const CANARY_CHILD_KEYS = CANARY_CHILD_URLS.map(discoverySourceKey)
const CANARY_ORDER_RECORDS = CANARY_TARGET_EVIDENCE
  .filter((row) => row.evidence.pageRole === 'collection')
  .map((row, index) => canaryOrderRecordV2(
    row.sourceKey,
    row.evidence.rawPageDigest,
    index === 0 ? CANARY_CHILD_KEYS : [],
  ))
/* Не посещаем цифровые шесть в синтетическом canary: это воспроизводит
   реальную границу `limit 50`. Их наличие доказывает orderRecord + матрица;
   построение записи цифрового семейства проверено отдельным e2e выше. */
const CANARY_VISITED_URLS = CANARY_OTHER_CHILD_URLS.slice(0, CANARY_LIMIT)
const CANARY_RECORDS = CANARY_VISITED_URLS.map((url, index) => buildDiscoveryRecord({
  sourceKey: discoverySourceKey(url),
  url,
  nameEn: `Synthetic POI ${index + 1}`,
  placements: [buildPlacement({
    kind: 'destinationRanking',
    collectionSourceKey: CANARY_COLLECTION_KEYS[0],
    listPosition: EXPECTED_NUMERIC_SUFFIX_KEYS.length + index + 1,
    editorialLevel: 0,
    categoryHint: null,
  })],
  factLeads: [],
  omissions: [],
  pageEvidence: canaryEvidence(url, 'poi'),
}))

const CANARY_ROBOTS = {
  url: ROBOTS_URL,
  bytes: 64,
  digest: canaryDigest('robots'),
  observedAt: CANARY_AT,
  appliedGroups: ['*'],
}
const CANARY_CATALOGUE_EVIDENCE = canaryEvidence(ENTRY, 'catalogue')
const CANARY_COUNTERS = {
  networkRequests: 259,
  catalogueTargetsFound: 208,
  collectionsFound: 150,
  directPoisFound: 58,
  poisFound: 1170,
  poisVisited: 50,
  recordsBuilt: 50,
  nonCanonicalLinks: 0,
  unknownAdmissionLabels: 0,
  emptyAdmissionValues: 0,
}

/**
 * СИНТЕТИЧЕСКИЙ CANARY ЧЕСТНО ОБЪЯВЛЯЕТ СЕБЯ `v2`.
 *
 * Его числа — экономика двухуровневого обхода: 259 обменов это ровно
 * `2 + 208 целей + 49 объектов`, потому что `--limit 50` резал список ДО
 * получения страниц. В `v3` такой снимок физически невозможен: там роль
 * карточки выясняется только её страницей, минимум для того же состава —
 * 1322 обмена. Собранный текущим строителем, он объявлял себя `v3` и
 * проходил и контракт, и приёмку — измерено аудитом 24.08.
 *
 * Поэтому фикстура строится как `v2`: набор ключей, имена счётчиков, форма
 * порядка и домены отпечатков — прежние. Отпечатки считаются здесь, вручную,
 * а не заимствуются у производственного покрытия: подделка, использующая
 * логику проверяемого, ничего не доказывает.
 */
const canarySnapshotDigestV2 = (snap) => sha256Bytes(canonicalJsonBytes({
  contractVersion: SNAPSHOT_SPEC_V2,
  scope: snap.scope,
  entryUrl: snap.entryUrl,
  complete: snap.complete,
  incompleteReasons: snap.incompleteReasons,
  robotsEvidence: snap.robotsEvidence,
  catalogueEvidence: snap.catalogueEvidence,
  catalogueTargetEvidence: snap.catalogueTargetEvidence,
  orderRecords: snap.orderRecords.map((row) => row.orderDigest),
  records: snap.records.map((r) => r.observationDigest),
  rejected: snap.rejected,
  counters: snap.counters,
}, `${SNAPSHOT_SPEC_V2}#snapshot`))

const canarySnapshot = ({
  targetEvidence = CANARY_TARGET_EVIDENCE,
  orderRecords = CANARY_ORDER_RECORDS,
  records = CANARY_RECORDS,
  rejected = { targets: [], cards: [], pois: [] },
  counters = CANARY_COUNTERS,
  incompleteReasons = [{ code: 'limitApplied', count: counters.poisFound - CANARY_LIMIT }],
} = {}) => {
  const sortByKey = (rows, pick) => [...rows].sort((a, b) => compareUtf8(pick(a), pick(b)))
  const draft = {
    contractVersion: SNAPSHOT_SPEC_V2,
    scope: { kind: 'limited', limit: CANARY_LIMIT },
    entryUrl: ENTRY,
    complete: false,
    incompleteReasons: [...incompleteReasons]
      .filter((reason) => reason.count > 0)
      .sort((a, b) => compareUtf8(a.code, b.code)),
    robotsEvidence: CANARY_ROBOTS,
    catalogueEvidence: CANARY_CATALOGUE_EVIDENCE,
    catalogueTargetEvidence: sortByKey(targetEvidence, (row) => row.sourceKey),
    orderRecords: sortByKey(orderRecords, (row) => row.destinationSourceKey),
    records: sortByKey(records, (record) => record.sourceKey),
    rejected: {
      targets: [...rejected.targets].sort((a, b) => compareUtf8(a.ref, b.ref)),
      cards: [...rejected.cards].sort((a, b) =>
        compareUtf8(a.destination, b.destination) || a.position - b.position),
      pois: [...rejected.pois].sort((a, b) => compareUtf8(a.ref, b.ref)),
    },
    counters,
  }
  return { ...draft, snapshotDigest: canarySnapshotDigestV2(draft) }
}

const ACCEPTED_BUDGET = Object.freeze({
  base: 1322,
  strictMax: 3966,
  conditionalUpper: 3446,
  maxRedirects: CANARY_MAX_REDIRECTS,
})
const evaluateCanary = (snapshot, {
  budgetStatus = 'usable',
  budget = ACCEPTED_BUDGET,
} = {}) => evaluateJapanGuideCanaryAcceptance({
  snapshot,
  limit: CANARY_LIMIT,
  maxNetworkRequests: CANARY_MAX_REQUESTS,
  maxRedirects: CANARY_MAX_REDIRECTS,
  redirectCount: 0,
  reportedBudgetStatus: budgetStatus,
  reportedBudget: budget,
})
const expectAcceptance = (label, snapshot, expectedFailures, budget = {}) => {
  try {
    assertDiscoverySnapshot(snapshot)
    ok++
  } catch (error) {
    bad.push(`${label}: контрактная фикстура негодна: ${error.message}`)
    return
  }
  const result = evaluateCanary(snapshot, budget)
  eq(`${label}: точный список провалов`, result.failureCodes, expectedFailures)
  t(`${label}: вердикт`, result.accepted, expectedFailures.length === 0)
}

const acceptedCanary = canarySnapshot()
expectAcceptance('синтетический постфикс', acceptedCanary, [])
eq('закрытый список кодов совпадает с исполняемыми проверками',
  evaluateCanary(acceptedCanary).checks.map((check) => check.code), CANARY_ACCEPTANCE_CODES)
t('постфиксный бюджет пересчитан независимо: base',
  evaluateCanary(acceptedCanary).computedBudget.base, ACCEPTED_BUDGET.base)
t('постфиксный бюджет пересчитан независимо: strictMax',
  evaluateCanary(acceptedCanary).computedBudget.strictMax, ACCEPTED_BUDGET.strictMax)
t('постфиксный бюджет пересчитан независимо: conditionalUpper',
  evaluateCanary(acceptedCanary).computedBudget.conditionalUpper, ACCEPTED_BUDGET.conditionalUpper)

/* Байты живого pre-fix отчёта были утрачены при повторном canary 19.08.
   Это не выдаётся за сохранённый артефакт: ниже контрактно-валидная
   реконструкция его измеренных агрегатов и шести поимённых отказов. Она
   нужна как единый отрицательный полюс: все четыре причины обязаны
   присутствовать одновременно и никакая пятая не должна их прикрывать. */
const PRE_FIX_POSITIONS = Object.freeze([3, 25, 36, 38, 65, 69])
const preFixOrderRecords = CANARY_ORDER_RECORDS.map((row, index) => index === 0
  ? canaryOrderRecordV2(row.destinationSourceKey, row.sourcePageDigest,
    row.order.filter((key) => !EXPECTED_NUMERIC_SUFFIX_KEYS.includes(key)))
  : row)
const preFixCanary = canarySnapshot({
  orderRecords: preFixOrderRecords,
  rejected: {
    targets: [],
    cards: PRE_FIX_POSITIONS.map((position) => ({
      destination: CANARY_COLLECTION_KEYS[0],
      position,
      code: 'pathDenied',
    })),
    pois: [],
  },
  counters: { ...CANARY_COUNTERS, poisFound: 1164 },
  incompleteReasons: [
    { code: 'cardRejected', count: 6 },
    { code: 'limitApplied', count: 1 },
  ],
})
expectAcceptance('реконструированный pre-fix canary', preFixCanary, [
  'unexpectedIncompleteReasons',
  'rejectedCardsPresent',
  'expectedNumericSuffixKeysMissing',
  'budgetStatusNotUsable',
], { budgetStatus: 'indeterminate', budget: null })

/* Не хватает одного ожидаемого ключа, но число достижимых объектов и все
   отпечатки остаются законными: заменяем его другим каноническим ключом. */
const replacementKey = discoverySourceKey(`${HOST}/e/e29999.html`)
const missingOrderRecords = CANARY_ORDER_RECORDS.map((row, index) => index === 0
  ? canaryOrderRecordV2(row.destinationSourceKey, row.sourcePageDigest,
    row.order.map((key) => (key === EXPECTED_NUMERIC_SUFFIX_KEYS.at(-1) ? replacementKey : key)))
  : row)
expectAcceptance('не хватает цифрового ключа', canarySnapshot({ orderRecords: missingOrderRecords }),
  ['expectedNumericSuffixKeysMissing'])

/* Отказ карточки: удаляем НЕпосещённый нецифровой ключ из порядка, чтобы
   контрактная арифметика оставалась точной и ожидаемые шесть не пострадали. */
const cardRemovedKey = CANARY_CHILD_KEYS.at(-1)
const cardRejectedOrders = CANARY_ORDER_RECORDS.map((row, index) => index === 0
  ? canaryOrderRecordV2(row.destinationSourceKey, row.sourcePageDigest,
    row.order.filter((key) => key !== cardRemovedKey))
  : row)
const cardRejectedCounters = { ...CANARY_COUNTERS, poisFound: 1169 }
expectAcceptance('непустой rejected.cards', canarySnapshot({
  orderRecords: cardRejectedOrders,
  rejected: {
    targets: [],
    cards: [{ destination: CANARY_COLLECTION_KEYS[0], position: 1112, code: 'pathDenied' }],
    pois: [],
  },
  counters: cardRejectedCounters,
  incompleteReasons: [
    { code: 'cardRejected', count: 1 },
    { code: 'limitApplied', count: 1119 },
  ],
}), ['unexpectedIncompleteReasons', 'rejectedCardsPresent', 'budgetStatusNotUsable'], {
  budgetStatus: 'indeterminate', budget: null,
})

/* Отказ цели остаётся контрактно валидным: свидетельство одной прямой цели
   заменено терминальным отказом, общий счёт каталога не меняется. */
const rejectedTarget = CANARY_TARGET_EVIDENCE.at(-1)
const targetRejectedCounters = {
  ...CANARY_COUNTERS,
  directPoisFound: 57,
  poisFound: 1169,
}
expectAcceptance('непустой rejected.targets', canarySnapshot({
  targetEvidence: CANARY_TARGET_EVIDENCE.slice(0, -1),
  rejected: { targets: [{ ref: rejectedTarget.sourceKey, code: 'statusDenied' }], cards: [], pois: [] },
  counters: targetRejectedCounters,
  incompleteReasons: [
    { code: 'limitApplied', count: 1119 },
    { code: 'targetFetchFailed', count: 1 },
  ],
}), [
  'unexpectedIncompleteReasons',
  'rejectedTargetsPresent',
  'catalogueTargetsUnclassified',
  'budgetStatusNotUsable',
], { budgetStatus: 'indeterminate', budget: null })

/* Отказ уже посещённого объекта: посещений по-прежнему 50, но один исход —
   rejected.pois, поэтому записей 49.

   Код СТРУКТУРНЫЙ, а не сетевой: у `v3` отказ объекта иным быть не может —
   страница объекта к этому месту уже получена, второго запроса нет. */
const rejectedRecord = CANARY_RECORDS.at(-1)
expectAcceptance('непустой rejected.pois', canarySnapshot({
  records: CANARY_RECORDS.slice(0, -1),
  rejected: {
    targets: [], cards: [], pois: [{ ref: rejectedRecord.sourceKey, code: 'structureMismatch' }],
  },
  counters: { ...CANARY_COUNTERS, recordsBuilt: 49 },
  incompleteReasons: [
    { code: 'limitApplied', count: 1120 },
    { code: 'poiStructureMismatch', count: 1 },
  ],
}), [
  'unexpectedIncompleteReasons',
  'recordsBuiltMismatch',
  'rejectedPoisPresent',
  'budgetStatusNotUsable',
], { budgetStatus: 'indeterminate', budget: null })

expectAcceptance('записанный статус бюджета подменён', acceptedCanary, [
  'reportedBudgetStatusMismatch',
  'budgetStatusNotUsable',
  'reportedBudgetMissing',
  'budgetBaseMismatch',
  'budgetStrictMaxMismatch',
  'budgetConditionalUpperMismatch',
  'budgetMaxRedirectsMismatch',
], { budgetStatus: 'indeterminate', budget: null })
for (const [field, code] of [
  ['base', 'budgetBaseMismatch'],
  ['strictMax', 'budgetStrictMaxMismatch'],
  ['conditionalUpper', 'budgetConditionalUpperMismatch'],
  ['maxRedirects', 'budgetMaxRedirectsMismatch'],
]) {
  expectAcceptance(`подменён бюджет.${field}`, acceptedCanary, [code], {
    budget: { ...ACCEPTED_BUDGET, [field]: ACCEPTED_BUDGET[field] + 1 },
  })
}

/* ── 10c-T: зонтичная страница распознаётся ТОПОЛОГИЕЙ ───────────────────
 * ДЕФЕКТ ДО ПРАВКИ: `/e/e3034.html` со ссылками на `_001…_006` не имеет ни
 * сигнатуры коллекции, ни ранжированного списка — по контенту она
 * неотличима от объекта, и классификатор возвращал `poi`. Шесть
 * самостоятельных дочерних объектов терялись молча.
 *
 * Контент в решении не участвует: ни `admission`, ни число `spot_list`, ни
 * H1. Решает только граф исходящих ссылок. */

const UMBRELLA = fixture('umbrella.html')
const UMBRELLA_URL = `${HOST}/e/e3034.html`
const CHILD_KEYS = ['001', '002', '003', '004', '005', '006']
  .map((n) => `japan-guide:e3034_${n}`)

const umbrellaTopology = detectContainerChildren(load(UMBRELLA), UMBRELLA_URL)
t('зонтичная страница опознана контейнером', umbrellaTopology.kind, 'container')
eq('шесть детей в порядке первого появления',
  umbrellaTopology.children.map((c) => c.sourceKey), CHILD_KEYS)
/* Повтор ссылки на `_001` даёт ОДНО ребро. */
t('дубликат не удвоил ребёнка',
  new Set(umbrellaTopology.children.map((c) => c.sourceKey)).size, 6)
t('и роль страницы — коллекция', classifyPageRole(load(UMBRELLA), UMBRELLA_URL), 'collection')
/* Структурного отбора у неё нет вовсе — роль дала именно топология. */
t('сигнатурной секции у неё нет', selectCollectionStructure(load(UMBRELLA)).kind, 'absent')

/* Ребёнок со ссылками на соседей остаётся объектом: его собственный адрес
   составной, и базовый номер с `e3034_001` не совпадает ни у кого. */
const CHILD_URL = `${HOST}/e/e3034_001.html`
t('ребёнок контейнером не становится',
  detectContainerChildren(load(UMBRELLA), CHILD_URL).kind, 'notContainer')
t('и роль ребёнка — poi', classifyPageRole(load(UMBRELLA), CHILD_URL), 'poi')

/* Обычный объект без таких ссылок ведёт себя как прежде. */
t('обычный объект не контейнер',
  detectContainerChildren(load(ATTRACTION), `${HOST}/e/e4000.html`).kind, 'notContainer')
t('и остаётся poi', classifyPageRole(load(ATTRACTION), `${HOST}/e/e4000.html`), 'poi')

/* Порог: один ребёнок контейнера не делает. */
const oneChild = `<html><body><h1 class="page_title__title">x</h1><div class="page_title">`
  + `<h1 class="page_title__title">One</h1></div>`
  + `<a href="/e/e3034_001.html">a</a></body></html>`
t('один ребёнок — недостаточно',
  detectContainerChildren(load(oneChild), UMBRELLA_URL).kind, 'notContainer')
t('порог назван в коде, а не в тесте', CONTAINER_MIN_CHILDREN, 2)

/* Чужой базовый номер не считается, и смешанные номера не объединяются. */
const otherBase = `<html><body><a href="/e/e5100_001.html">a</a>`
  + `<a href="/e/e5100_002.html">b</a></body></html>`
t('несколько ссылок с другим номером — не контейнер',
  detectContainerChildren(load(otherBase), UMBRELLA_URL).kind, 'notContainer')
const mixedBase = `<html><body><a href="/e/e3034_001.html">a</a>`
  + `<a href="/e/e5100_002.html">b</a></body></html>`
t('смешанные номера не объединяются',
  detectContainerChildren(load(mixedBase), UMBRELLA_URL).kind, 'notContainer')

/* Формы, которые детьми не являются. */
for (const [label, href] of [
  ['одна цифра', '/e/e3034_1.html'],
  ['две цифры', '/e/e3034_01.html'],
  ['четыре цифры', '/e/e3034_0001.html'],
]) {
  const html = `<html><body><a href="${href}">a</a><a href="/e/e3034_002.html">b</a>`
    + `<a href="/e/e3034_003.html">c</a></body></html>`
  const verdict = detectContainerChildren(load(html), UMBRELLA_URL)
  t(`неизмеренная разрядность (${label}) — противоречие, а не тишина`, verdict.kind, 'ambiguous')
  throwsWith(`и роль отказывает кодом (${label})`,
    () => classifyPageRole(load(html), UMBRELLA_URL), 'containerTopologyAmbiguous')
}
for (const [label, href] of [
  ['лишний сегмент суффикса', '/e/e3034_001_more.html'],
  ['верхний регистр расширения', '/e/e3034_001.HTML'],
  ['query', '/e/e3034_001.html?utm=1'],
  ['fragment', '/e/e3034_001.html#top'],
  ['percent-encoding', '/e/e3034%5F001.html'],
  ['другой origin', 'https://example.org/e/e3034_001.html'],
]) {
  const html = `<html><body><a href="${href}">a</a><a href="/e/e3034_002.html">b</a></body></html>`
  const verdict = detectContainerChildren(load(html), UMBRELLA_URL)
  t(`${label} ребёнком не считается`, verdict.kind, 'notContainer')
}
/* Та же форма, но валидных детей уже двое: чужие формы просто не считаются. */
const withNoise = `<html><body><a href="/e/e3034_001.html">a</a>`
  + `<a href="/e/e3034_002.html">b</a><a href="/e/e3034_001_more.html">c</a>`
  + `<a href="https://example.org/e/e3034_003.html">d</a></body></html>`
eq('посторонние формы порядок не засоряют',
  detectContainerChildren(load(withNoise), UMBRELLA_URL).children.map((c) => c.sourceKey),
  ['japan-guide:e3034_001', 'japan-guide:e3034_002'])

/* Контент решения не меняет: admission на той же топологии ничего не сдвигает. */
const umbrellaWithAdmission = UMBRELLA.replace('<section id="section_links">',
  '<section id="section_admission"><div class="page_admission">'
  + '<div class="page_admission__item"><h4 class="page_admission__item_label">Hours</h4>'
  + '<div class="page_admission__item_content">9:00 to 17:00</div></div></div></section>'
  + '<section id="section_links">')
t('admission решение о контейнере не меняет',
  classifyPageRole(load(umbrellaWithAdmission), UMBRELLA_URL), 'collection')

/* ── Настоящий обход, а не только вспомогательная функция ─────────────── */

const UMBRELLA_PAGES = new Map([
  [ENTRY, CATALOGUE_CLEAN],
  [`${HOST}/e/e1001.html`, UMBRELLA],
  [`${HOST}/e/e1002.html`, ATTRACTION],
  [`${HOST}/e/e1003a.html`, ATTRACTION],
  ...CHILD_KEYS.map((key) => [`${HOST}/e/${key.replace('japan-guide:', '')}.html`, ATTRACTION]),
])
/* Каталог ведёт на e1001; зонтичной делает её собственный адрес, поэтому
   роль контейнера проверяется на адресе e1001, а дети — `e1001_ddd`. */
const UMBRELLA_AT_E1001 = UMBRELLA.replace(/e3034_/g, 'e1001_')
UMBRELLA_PAGES.set(`${HOST}/e/e1001.html`, UMBRELLA_AT_E1001)
for (const n of CHILD_KEYS) {
  UMBRELLA_PAGES.set(`${HOST}/e/${n.replace('japan-guide:e3034_', 'e1001_')}.html`, ATTRACTION)
}
const umbrellaRun = await crawl({ fetchImpl: router(UMBRELLA_PAGES) })
const parentKey = 'japan-guide:e1001'
const childKeys = ['001', '002', '003', '004', '005', '006'].map((n) => `japan-guide:e1001_${n}`)
const parentEvidence = umbrellaRun.discovery.catalogueTargetEvidence
  .find((row) => row.sourceKey === parentKey)
t('родитель классифицирован коллекцией', parentEvidence?.evidence.pageRole, 'collection')
t('коллекций посчитано', umbrellaRun.discovery.counters.catalogueCollectionsFound, 1)
const parentOrder = umbrellaRun.discovery.orderRecords
  .find((row) => row.destinationSourceKey === parentKey)
eq('порядок — шесть ключей в порядке DOM', orderedPoiKeys(parentOrder), childKeys)
t('порядок привязан к байтам страницы родителя',
  parentOrder?.sourcePageDigest, parentEvidence?.evidence.rawPageDigest)
t('дубликат в порядок дважды не попал', new Set(orderedPoiKeys(parentOrder)).size, 6)
t('шесть детей встали в очередь объектов',
  childKeys.every((key) => umbrellaRun.discovery.records.some((r) => r.sourceKey === key)), true)
t('записи самого родителя нет',
  umbrellaRun.discovery.records.some((r) => r.sourceKey === parentKey), false)
const childRecord = umbrellaRun.discovery.records.find((r) => r.sourceKey === childKeys[0])
t('роль ребёнка — poi (матрица legacySuffix)', childRecord?.pageEvidence.pageRole, 'poi')
eq('вид размещения ребёнка отделён от ранжированной карточки',
  childRecord?.placements.map((pl) => pl.kind), ['containerChild'])
t('коллекция ребёнка — родитель', childRecord?.placements[0].collectionSourceKey, parentKey)
eq('ранжирования у ребёнка нет',
  [childRecord?.placements[0].listPosition, childRecord?.placements[0].editorialLevel,
    childRecord?.placements[0].categoryHint], [null, null, null])
/* Рекурсии нет: страницы соседей ребёнка целями не становились. */
t('обход не пошёл рекурсией с ребёнка',
  umbrellaRun.discovery.orderRecords.length, umbrellaRun.discovery.counters.catalogueCollectionsFound)
t('отвергнутых целей и объектов нет',
  umbrellaRun.discovery.rejected.targets.length + umbrellaRun.discovery.rejected.pois.length, 0)

/* Fail-closed на настоящем обходе: противоречивая топология отвергает цель
   закрытым кодом, а не превращает её в объект. */
const AMBIGUOUS_PAGES = new Map([...UMBRELLA_PAGES])
AMBIGUOUS_PAGES.set(`${HOST}/e/e1001.html`,
  UMBRELLA_AT_E1001.replace('/e/e1001_006.html', '/e/e1001_06.html'))
const ambiguousRun2 = await crawl({ fetchImpl: router(AMBIGUOUS_PAGES) })
t('противоречивая цель отвергнута закрытым кодом',
  ambiguousRun2.discovery.rejected.targets.some((row) => row.code === 'containerTopologyAmbiguous'), true)
t('и объектом она не стала',
  ambiguousRun2.discovery.records.some((r) => r.sourceKey === parentKey), false)
t('снимок при этом неполон',
  ambiguousRun2.discovery.incompleteReasons.some((r) => r.code === 'targetStructureMismatch'), true)

/* ── Аудит 10c-T: топология выигрывает у контента ────────────────────────
 * P1 аудита: топология `container` + структура `selected` + `admission`
 * давали `pageRoleAmbiguous`, то есть контент отменял топологию. */

const TRIPLE_LINKS = ['001', '002', '003', '004', '005', '006']
  .map((n) => `<p><a href="/e/e3034_${n}.html">child</a></p>`).join('')
const TRIPLE_ADMISSION = '<section id="section_admission"><div class="page_admission">'
  + '<div class="page_admission__item"><h4 class="page_admission__item_label">Hours</h4>'
  + '<div class="page_admission__item_content">9:00 to 17:00</div></div></div></section>'
const TRIPLE = TITLED.replace('</body>', `${TRIPLE_LINKS}${TRIPLE_ADMISSION}</body>`)
const TRIPLE_URL = `${HOST}/e/e3034.html`
/* Все три сигнала действительно присутствуют — иначе тест ничего не значил бы. */
t('структура коллекции валидна', selectCollectionStructure(load(TRIPLE)).kind, 'selected')
t('топология контейнера валидна',
  detectContainerChildren(load(TRIPLE), TRIPLE_URL).kind, 'container')
t('admission на странице есть',
  load(TRIPLE)(SELECTORS.attraction.admissionSection).find(SELECTORS.attraction.admissionBlock).length, 1)
t('и роль решает топология', classifyPageRole(load(TRIPLE), TRIPLE_URL), 'collection')
t('разбор даёт контейнер, а не карточки',
  analysePage({ document: load(TRIPLE), pageUrl: TRIPLE_URL }).kind, 'containerCollection')
/* Двусмысленность осталась достижимой там, где детей нет. */
throwsWith('список и admission без детей — по-прежнему ambiguous',
  () => classifyPageRole(load(TITLED.replace('</body>', `${TRIPLE_ADMISSION}</body>`)), `${HOST}/e/e2158.html`),
  'pageRoleAmbiguous')

/* ── Публичные потребители не расходятся ──────────────────────────────── */
const umbrellaAnalysis = analysePage({ document: load(UMBRELLA), pageUrl: UMBRELLA_URL })
t('единый разбор называет зонтичную страницу контейнером',
  umbrellaAnalysis.kind, 'containerCollection')
t('классификатор с ним согласен', classifyPageRole(load(UMBRELLA), UMBRELLA_URL), 'collection')
const umbrellaParsed = parseDestination({ html: UMBRELLA, url: UMBRELLA_URL })
t('и разбор коллекции тоже — без отказа', umbrellaParsed.collectionKind, 'container')
eq('дети те же, что у детектора', umbrellaParsed.children.map((c) => c.sourceKey), CHILD_KEYS)
eq('карточек у контейнера нет', [umbrellaParsed.cards.length, umbrellaParsed.rejectedCards.length], [0, 0])
/* Ранжированная коллекция по-прежнему разбирается как ranked. */
t('ранжированная коллекция помечена ranked',
  parseDestination({ html: DESTINATION, url: `${HOST}/e/e2157.html` }).collectionKind, 'ranked')
/* Единый разбор — один аргумент-объект. */
t('analysePage принимает один объектный аргумент', analysePage.length, 1)

/* Вид коллекции в снимке обхода соответствует виду размещения. */
const umbrellaOrderRow = umbrellaRun.discovery.orderRecords
  .find((row) => row.destinationSourceKey === parentKey)
t('порядок контейнера помечен видом', umbrellaOrderRow?.collectionKind, 'container')
const rankedOrderRow = mixed.discovery.orderRecords
  .find((row) => row.destinationSourceKey === 'japan-guide:destinations:fixture-root-region')
t('порядок ранжированной коллекции помечен видом', rankedOrderRow?.collectionKind, 'ranked')

/* ── Аудит 10c-T-3 ───────────────────────────────────────────────────────
 * P1: монитор сравнивал снимки разных версий. Домены отпечатков выведены
 * из версии, поэтому семантически ОДИНАКОВЫЕ снимки дали бы ложные
 * изменения на каждой записи и каждой коллекции. */

const legacyShaped = JSON.parse(JSON.stringify(mixed.discovery))
legacyShaped.contractVersion = 'poi-discovery-snapshot/v1'
const crossVersion = diffDiscoverySnapshot(mixed.discovery, legacyShaped)
t('сравнение разных версий отказано', crossVersion.comparable, false)
t('и отказ называет причину версией',
  String(crossVersion.refusal).includes('версии снимков разные'), true)
t('одинаковые версии по-прежнему сравниваются',
  diffDiscoverySnapshot(mixed.discovery, mixed.discovery).comparable, true)

/* P1: публичная граница не принимает подставной разбор. Через него объект
   можно было выдать за контейнерную коллекцию, минуя и топологию, и
   структуру. */
t('parseDestination принимает один объектный аргумент', parseDestination.length, 1)
const poiParsed = (() => {
  try {
    /* Лишние поля игнорируются деструктуризацией: подсунуть разбор нечем. */
    return parseDestination({
      html: ATTRACTION,
      url: `${HOST}/e/e4000.html`,
      analysis: { kind: 'containerCollection', children: [{ sourceKey: 'japan-guide:e1', url: `${HOST}/e/e1.html` }] },
      document: load(UMBRELLA),
    })
  } catch (error) {
    return `отказ ${error.code}`
  }
})()
t('объект не выдать за контейнер подставным разбором', poiParsed, 'отказ structureMismatch')


/* ══ 10d-B: ГРАФ КОЛЛЕКЦИЙ ══════════════════════════════════════════════
 *
 * Четыре контрпримера, снятые на коде HEAD 24.08 ДО правки. Тогда каждый
 * показывал дефект; здесь каждый показывает его отсутствие. Проверяется
 * production-функция `collectJapanGuideDiscovery`, а не копия её логики.
 *
 * Исходные показания HEAD (сохранены в `tmp/jj10d-b-p0-head.txt`):
 *   1. известная коллекция в карточках      rejected.pois e1002 → urlRepeated
 *   2. новая вложенная коллекция            rejected.pois e5041 → structureMismatch
 *   3. цикл A → B → A                       обратное ребро невидимо, e2002 потерян
 *   4. общий объект                         третья связь потеряна вместе с e5041
 */

/** Ранжированная коллекция с заданными карточками. Ни строки с сайта. */
const rankedPage = (title, hrefs) => `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>${title}</title></head><body>
<div class="page_title"><h1 class="page_title__title">${title}</h1></div>
<section id="section_spot_list" class="spot_list spot_list--grid">
  <header class="spot_list__header page_section__header">
    <h2 class="spot_list__list_title s-typography--h3">Top attractions in ${title}</h2>
  </header>
  <div class="spot_list__list_wrap"><div class="spot_list__category">
    <ul class="spot_list__spots o-gallery">
${hrefs.map((href, index) => `      <li class="spot_list__spot o-card">
        <div class="spot_list__spot__rank_no">${index + 1}</div>
        <div class="spot_list__spot__meta">Category</div>
        <a class="spot_list__spot__name" href="${href}">Card ${index + 1}</a>
      </li>`).join('\n')}
    </ul>
  </div></div>
</section>
</body></html>`

const pageUrl = (id) => `${HOST}/e/${id}.html`
const pageKey = (id) => `japan-guide:${id}`
const graphCrawl = async (pages) => {
  const log = []
  const result = await collectJapanGuideDiscovery(PORTAL, {
    fetchImpl: router(pages, { log }), now: NOW, sleep: async () => {},
  })
  return { ...result, log: log.map((row) => row.url) }
}
const fetchedOnce = (log) => log.length === new Set(log).size

/* ── P0-1: известная коллекция карточкой внутри другой коллекции ───────── */

const knownInside = await graphCrawl(new Map([
  [ENTRY, CATALOGUE_CLEAN],
  [pageUrl('e1001'), rankedPage('Alpha', ['/e/e2001.html', '/e/e1002.html'])],
  [pageUrl('e1002'), rankedPage('Beta', ['/e/e2002.html'])],
  [pageUrl('e1003a'), ATTRACTION],
  [pageUrl('e2001'), ATTRACTION],
  [pageUrl('e2002'), ATTRACTION],
]))
assertDiscoverySnapshot(knownInside.discovery); ok++
t('известная коллекция в карточках больше не отвергается',
  knownInside.discovery.rejected.pois.length, 0)
t('и снимок полон', knownInside.discovery.complete, true)
t('объектов ровно три — коллекция в их число не входит',
  knownInside.discovery.counters.poisFound, 3)
t('и записей столько же', knownInside.discovery.counters.recordsBuilt, 3)
t('коллекция записью не стала',
  knownInside.discovery.records.some((r) => r.sourceKey === pageKey('e1002')), false)
const parentItems = knownInside.discovery.orderRecords
  .find((row) => row.destinationSourceKey === pageKey('e1001')).items
eq('порядок родителя различает роли элементов',
  parentItems.map((item) => `${item.role}:${item.sourceKey}`),
  [`poi:${pageKey('e2001')}`, `collection:${pageKey('e1002')}`])
t('каждый канонический адрес получен один раз', fetchedOnce(knownInside.log), true)
t('вложенных коллекций тут нет — e1002 была целью каталога',
  knownInside.discovery.counters.nestedCollectionsFound, 0)
eq('и свидетельство у неё осталось каталожным',
  knownInside.discovery.catalogueTargetEvidence
    .find((row) => row.sourceKey === pageKey('e1002')).evidence.pageRole, 'collection')

/* ── P0-2: новая вложенная коллекция ──────────────────────────────────── */

const nestedRun = await graphCrawl(new Map([
  [ENTRY, CATALOGUE_CLEAN],
  [pageUrl('e1001'), rankedPage('Alpha', ['/e/e2001.html', '/e/e5041.html'])],
  [pageUrl('e1002'), rankedPage('Beta', ['/e/e2002.html'])],
  [pageUrl('e1003a'), ATTRACTION],
  [pageUrl('e2001'), ATTRACTION],
  [pageUrl('e2002'), ATTRACTION],
  [pageUrl('e5041'), rankedPage('Nested', ['/e/e2003.html'])],
  [pageUrl('e2003'), ATTRACTION],
]))
assertDiscoverySnapshot(nestedRun.discovery); ok++
t('вложенная коллекция больше не разбирается как объект',
  nestedRun.discovery.rejected.pois.length, 0)
t('снимок полон', nestedRun.discovery.complete, true)
t('вложенная коллекция посчитана отдельно',
  nestedRun.discovery.counters.nestedCollectionsFound, 1)
eq('и получила собственное свидетельство',
  nestedRun.discovery.nestedCollectionEvidence.map((row) => row.sourceKey), [pageKey('e5041')])
t('роль в свидетельстве — коллекция',
  nestedRun.discovery.nestedCollectionEvidence[0].evidence.pageRole, 'collection')
t('целью каталога она при этом не объявлена',
  nestedRun.discovery.catalogueTargetEvidence.some((row) => row.sourceKey === pageKey('e5041')), false)
t('число целей каталога не выросло',
  nestedRun.discovery.counters.catalogueTargetsFound, 3)
t('её ребёнок найден и построен',
  nestedRun.discovery.records.some((r) => r.sourceKey === pageKey('e2003')), true)
t('объектов четыре', nestedRun.discovery.counters.poisFound, 4)
t('порядок ведётся и для вложенной коллекции',
  nestedRun.discovery.orderRecords.some((row) => row.destinationSourceKey === pageKey('e5041')), true)
t('каждый канонический адрес получен один раз', fetchedOnce(nestedRun.log), true)
/*
 * ПОРЯДОК ОБХОДА ДЕТЕРМИНИРОВАН, и это проверяется точной последовательностью
 * обменов, а не словом «BFS». Сначала robots и каталог, затем все цели
 * каталога в порядке ключей, затем очередь коллекций с головы: карточки
 * e1001, карточки e1002 и лишь потом карточки вложенной e5041.
 *
 * Без этой проверки перестановка очереди была бы ненаблюдаема: снимок
 * сортирует и порядки, и записи, и отказы, поэтому в нём следов не
 * остаётся вовсе.
 */
eq('обмены идут детерминированным BFS', nestedRun.log, [
  ROBOTS_URL,
  ENTRY,
  pageUrl('e1001'), pageUrl('e1002'), pageUrl('e1003a'),
  pageUrl('e2001'), pageUrl('e5041'),
  pageUrl('e2002'),
  pageUrl('e2003'),
])

/* ── P0-3: цикл A → B → A ─────────────────────────────────────────────── */

const cycleRun = await graphCrawl(new Map([
  [ENTRY, CATALOGUE_CLEAN],
  [pageUrl('e1001'), rankedPage('Alpha', ['/e/e2001.html', '/e/e5041.html'])],
  [pageUrl('e1002'), ATTRACTION],
  [pageUrl('e1003a'), ATTRACTION],
  [pageUrl('e2001'), ATTRACTION],
  [pageUrl('e2002'), ATTRACTION],
  [pageUrl('e5041'), rankedPage('Nested', ['/e/e2002.html', '/e/e1001.html'])],
]))
assertDiscoverySnapshot(cycleRun.discovery); ok++
t('обход цикла завершается и снимок полон', cycleRun.discovery.complete, true)
t('отказов нет',
  cycleRun.discovery.rejected.pois.length + cycleRun.discovery.rejected.nodes.length, 0)
t('обратное ребро записано как ребро графа',
  cycleRun.discovery.orderRecords
    .find((row) => row.destinationSourceKey === pageKey('e5041')).items
    .some((item) => item.role === 'collection' && item.sourceKey === pageKey('e1001')), true)
t('и второго запроса страницы A не было', fetchedOnce(cycleRun.log), true)
t('объект второй коллекции найден',
  cycleRun.discovery.records.some((r) => r.sourceKey === pageKey('e2002')), true)
/* Граница повтора НЕ ослаблена: она по-прежнему отвергла бы второй GET —
   автомат просто её не зовёт. */
t('код повтора остаётся в закрытом списке отказов страницы',
  PAGE_REJECTION_CODES.includes('urlRepeated'), true)

/* ── P0-4: общий объект у двух коллекций и у вложенной ────────────────── */

const sharedRun = await graphCrawl(new Map([
  [ENTRY, CATALOGUE_CLEAN],
  [pageUrl('e1001'), rankedPage('Alpha', ['/e/e2001.html', '/e/e5041.html'])],
  [pageUrl('e1002'), rankedPage('Beta', ['/e/e2001.html'])],
  [pageUrl('e1003a'), ATTRACTION],
  [pageUrl('e2001'), ATTRACTION],
  [pageUrl('e5041'), rankedPage('Nested', ['/e/e2001.html'])],
]))
assertDiscoverySnapshot(sharedRun.discovery); ok++
t('снимок полон', sharedRun.discovery.complete, true)
const sharedRecord = sharedRun.discovery.records.find((r) => r.sourceKey === pageKey('e2001'))
t('общий объект построен ровно один раз',
  sharedRun.discovery.records.filter((r) => r.sourceKey === pageKey('e2001')).length, 1)
eq('и сохранил все три родительские связи',
  sharedRecord.placements.map((p) => p.collectionSourceKey).sort(),
  [pageKey('e1001'), pageKey('e1002'), pageKey('e5041')].sort())
t('страница общего объекта получена один раз',
  sharedRun.log.filter((url) => url === pageUrl('e2001')).length, 1)
t('и вообще каждый адрес получен один раз', fetchedOnce(sharedRun.log), true)

/* ── Узел графа, роль которого установить не удалось ──────────────────── */

const brokenNode = await graphCrawl(new Map([
  [ENTRY, CATALOGUE_CLEAN],
  [pageUrl('e1001'), rankedPage('Alpha', ['/e/e2001.html', '/e/e7777.html'])],
  [pageUrl('e1002'), rankedPage('Beta', ['/e/e2002.html'])],
  [pageUrl('e1003a'), ATTRACTION],
  [pageUrl('e2001'), ATTRACTION],
  [pageUrl('e2002'), ATTRACTION],
]))
assertDiscoverySnapshot(brokenNode.discovery); ok++
t('недостижимая страница карточки — отказ УЗЛА, а не объекта',
  brokenNode.discovery.rejected.pois.length, 0)
eq('и она названа ссылкой, происхождением и кодом',
  brokenNode.discovery.rejected.nodes.map((row) => `${row.origin}→${row.ref}:${row.code}`),
  [`${pageKey('e1001')}→${pageKey('e7777')}:statusDenied`])
t('снимок неполон', brokenNode.discovery.complete, false)
t('причина названа своим именем',
  brokenNode.discovery.incompleteReasons.some((r) => r.code === 'nodeFetchFailed'), true)
t('в порядок родителя такой элемент не попал',
  brokenNode.discovery.orderRecords
    .find((row) => row.destinationSourceKey === pageKey('e1001')).items.length, 1)

/* Роль, невозможная для семейства адреса, — закрытый код, а не поломка. */
const roleClash = await graphCrawl(new Map([
  [ENTRY, CATALOGUE_CLEAN],
  [pageUrl('e1001'), rankedPage('Alpha', ['/e/e2001.html', '/e/e2001_001.html'])],
  [pageUrl('e1002'), rankedPage('Beta', ['/e/e2002.html'])],
  [pageUrl('e1003a'), ATTRACTION],
  [pageUrl('e2001'), ATTRACTION],
  [pageUrl('e2002'), ATTRACTION],
  /* Суффиксный адрес, отдающий ранжированный список: матрица ролей знает
     `legacySuffix` только объектом. */
  [pageUrl('e2001_001'), rankedPage('Suffix pretending to be a collection', ['/e/e2003.html'])],
  [pageUrl('e2003'), ATTRACTION],
]))
assertDiscoverySnapshot(roleClash.discovery); ok++
eq('противоречие роли и семейства — закрытый код отказа узла',
  roleClash.discovery.rejected.nodes.map((row) => `${row.ref}:${row.code}`),
  [`${pageKey('e2001_001')}:roleFamilyMismatch`])
t('и оно считается структурной причиной',
  roleClash.discovery.incompleteReasons.some((r) => r.code === 'nodeStructureMismatch'), true)
t('прогон при этом не упал', roleClash.discovery.counters.recordsBuilt > 0, true)

/* ── Межверсионное сравнение отвергается ДО отпечатков ────────────────── */

const v3Snapshot = parsed(knownInside.discovery)
const v2Shaped = parsed(knownInside.discovery)
v2Shaped.contractVersion = 'poi-discovery-snapshot/v2'
const v3AgainstV2 = diffDiscoverySnapshot(v3Snapshot, v2Shaped)
t('снимки разных версий несравнимы', v3AgainstV2.comparable, false)
t('и отказ назван версиями, а не отпечатками',
  v3AgainstV2.refusal.includes('версии снимков разные'), true)
t('до проверки контракта дело не дошло',
  v3AgainstV2.refusal.includes('не проходит проверку контракта'), false)
t('два одинаковых v3 сравнимы',
  diffDiscoverySnapshot(parsed(knownInside.discovery), parsed(knownInside.discovery)).comparable, true)


/* ══ Синтетическая ТОПОЛОГИЯ ИЗМЕРЕННОГО КОРПУСА ════════════════════════
 *
 * Ни строки с сайта: из живого измерения взяты только ЧИСЛА и форма графа.
 * Полный обход 21.08 дал 208 целей каталога = 150 коллекций + 58 прямых
 * объектов, 1 294 сетевых обмена и 1 141 построенную запись при заявленных
 * 1 170 «объектах». Разница — 29 коллекций: 28 уже классифицированных целей
 * каталога и одна вложенная, `e5041`.
 *
 * Здесь тот же граф собран синтетически и обходится `v3`. Числа обязаны
 * сойтись все сразу: расхождение хотя бы в одном означало бы, что модель
 * описывает не тот корпус.
 *
 * Обменов ровно 1 294 и в модели: robots + каталог + 208 целей + 1 083
 * страницы объектов + одна вложенная коллекция. Совпадение с измерением не
 * подгонка: у `v2` те же 1 294 складывались иначе — 1 083 объекта плюс
 * `e5041`, разобранная как объект, а 28 повторов сеть не тратили, потому что
 * второй GET отвергала граница.
 */

const TOPO_COLLECTIONS = Array.from({ length: 150 }, (_, i) => `e1${String(i).padStart(3, '0')}`)
const TOPO_DIRECT = Array.from({ length: 58 }, (_, i) => `e9${String(i).padStart(3, '0')}`)
const TOPO_POIS = Array.from({ length: 1083 }, (_, i) => `e2${String(i).padStart(4, '0')}`)
const TOPO_NESTED = 'e5041'
/* Дети вложенной коллекции — объекты, уже разложенные по другим коллекциям:
   ровно так измерено, `e5043`, `e5101` и `e5042` были построены другим путём. */
const TOPO_NESTED_CHILDREN = [TOPO_POIS[7], TOPO_POIS[123], TOPO_POIS[900]]

const topoCatalogue = (ids) => `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>Topology catalogue</title></head><body>
<header class="dest_top__section_header">
  <h1 class="dest_top__section_title s-typography--h3">Synthetic Destinations</h1>
</header>
<div class="dest_top_destinations__regions">
  <div class="dest_top_destinations__region">
    <div class="dest_top_destinations__region_text">
      <div class="dest_top_destinations__region_header">Region</div>
      <div class="dest_top_destinations__region_dests">
${ids.map((id) => `        <a href="/e/${id}.html">${id}</a>`).join('\n')}
      </div>
    </div>
  </div>
</div>
</body></html>`

const TOPO_PAGES = new Map([[ENTRY, topoCatalogue([...TOPO_COLLECTIONS, ...TOPO_DIRECT])]])
for (const id of TOPO_DIRECT) TOPO_PAGES.set(pageUrl(id), ATTRACTION)
for (const id of TOPO_POIS) TOPO_PAGES.set(pageUrl(id), ATTRACTION)
/* Раздача объектов по коллекциям — по кругу: 7 или 8 карточек на коллекцию. */
const TOPO_CARDS = TOPO_COLLECTIONS.map(() => [])
TOPO_POIS.forEach((id, index) => TOPO_CARDS[index % TOPO_COLLECTIONS.length].push(`/e/${id}.html`))
/* Вложенная коллекция — последней карточкой первой коллекции. */
TOPO_CARDS[0].push(`/e/${TOPO_NESTED}.html`)
TOPO_COLLECTIONS.forEach((id, index) => TOPO_PAGES.set(pageUrl(id), rankedPage(id, TOPO_CARDS[index])))
TOPO_PAGES.set(pageUrl(TOPO_NESTED),
  rankedPage(TOPO_NESTED, TOPO_NESTED_CHILDREN.map((id) => `/e/${id}.html`)))

const topo = await graphCrawl(TOPO_PAGES)
assertDiscoverySnapshot(topo.discovery); ok++
const topoCounters = topo.discovery.counters
t('снимок полон', topo.discovery.complete, true)
eq('охват полный', topo.discovery.scope, { kind: 'full', limit: null })
t('целей каталога', topoCounters.catalogueTargetsFound, 208)
t('коллекций каталога', topoCounters.catalogueCollectionsFound, 150)
t('вложенных коллекций', topoCounters.nestedCollectionsFound, 1)
t('прямых объектов каталога', topoCounters.directPoisFound, 58)
t('уникальных объектов', topoCounters.poisFound, 1141)
t('записей построено', topoCounters.recordsBuilt, 1141)
t('попыток построить запись столько же', topoCounters.recordsAttempted, 1141)
t('отказов целей нет', topo.discovery.rejected.targets.length, 0)
t('отказов карточек нет', topo.discovery.rejected.cards.length, 0)
t('отказов узлов нет', topo.discovery.rejected.nodes.length, 0)
t('отказов объектов нет', topo.discovery.rejected.pois.length, 0)
eq('причин неполноты нет', topo.discovery.incompleteReasons, [])
t('сетевых обменов ровно как в измерении', topoCounters.networkRequests, 1294)
t('и это robots + каталог + 208 + 1083 + 1', 2 + 208 + 1083 + 1, 1294)
t('каждый канонический адрес получен один раз', fetchedOnce(topo.log), true)
t('обменов меньше потолка', topoCounters.networkRequests < FETCH_LIMITS.maxNetworkRequests, true)

/* Коллекция НИКОГДА не объект: ни записью, ни достижимой, ни отвергнутой. */
const topoRecordKeys = new Set(topo.discovery.records.map((r) => r.sourceKey))
const topoCollectionKeys = [
  ...TOPO_COLLECTIONS.map(pageKey), pageKey(TOPO_NESTED),
]
t('ни одна из 151 коллекции не стала записью',
  topoCollectionKeys.some((key) => topoRecordKeys.has(key)), false)
const topoReachable = new Set([
  ...topo.discovery.orderRecords.flatMap((row) => orderedPoiKeys(row)),
  ...topo.discovery.catalogueTargetEvidence
    .filter((row) => row.evidence.pageRole === 'poi').map((row) => row.sourceKey),
])
t('и ни одна не попала в достижимые объекты',
  topoCollectionKeys.some((key) => topoReachable.has(key)), false)
t('достижимых ровно столько, сколько записей', topoReachable.size, 1141)
t('и ни одна не попала в отказы объектов',
  topo.discovery.rejected.pois.length, 0)

/* Порядок первой коллекции различает роли: последний элемент — коллекция. */
const topoFirst = topo.discovery.orderRecords
  .find((row) => row.destinationSourceKey === pageKey(TOPO_COLLECTIONS[0]))
t('последний элемент первой коллекции — вложенная коллекция',
  topoFirst.items.at(-1).role, 'collection')
t('и это именно она', topoFirst.items.at(-1).sourceKey, pageKey(TOPO_NESTED))
t('остальные элементы — объекты',
  topoFirst.items.slice(0, -1).every((item) => item.role === 'poi'), true)
/* Карточка-коллекция занимает позицию в DOM, но привязки объекта не даёт. */
t('привязок у первой коллекции столько же, сколько её объектов',
  topo.discovery.records
    .filter((r) => r.placements.some((p) => p.collectionSourceKey === pageKey(TOPO_COLLECTIONS[0])))
    .length,
  topoFirst.items.filter((item) => item.role === 'poi').length)

/* Дети вложенной коллекции не продублированы и сохранили ОБЕ связи. */
for (const child of TOPO_NESTED_CHILDREN) {
  const rows = topo.discovery.records.filter((r) => r.sourceKey === pageKey(child))
  t(`ребёнок ${child} построен один раз`, rows.length, 1)
  t(`и страница ${child} получена один раз`,
    topo.log.filter((url) => url === pageUrl(child)).length, 1)
  const parents = rows[0].placements.map((p) => p.collectionSourceKey)
  t(`у ${child} обе родительские связи`, parents.length, 2)
  t(`и одна из них — вложенная коллекция`, parents.includes(pageKey(TOPO_NESTED)), true)
}

/* Свидетельство вложенной коллекции — отдельным списком, цели каталога свой
   смысл не меняют. */
eq('вложенная коллекция в своём списке',
  topo.discovery.nestedCollectionEvidence.map((row) => row.sourceKey), [pageKey(TOPO_NESTED)])
t('и её нет среди целей каталога',
  topo.discovery.catalogueTargetEvidence.some((row) => row.sourceKey === pageKey(TOPO_NESTED)), false)
t('порядок ведётся для всех 151 коллекции', topo.discovery.orderRecords.length, 151)


/* ══ R1: ПРИЁМКА CANARY ОБЪЯВЛЕНА v1/v2-ONLY ════════════════════════════ */

/*
 * Аудит 24.08: оценщик считал бюджет по двухуровневой формуле и принимал
 * снимок `v3` на 259 обменов, хотя сам же вычислял базу 1322. В `v3` предел
 * сеть не экономит, и под потолок 300 нынешний корпус не помещается ни при
 * каких данных. Операционная цель для `v3` владельцем не задана, поэтому
 * приёмка ОТКАЗЫВАЕТ именованным кодом, а не подгоняет формулу.
 */
eq('приёмка объявляет свою область', [...evaluateCanary(acceptedCanary).supportedSnapshotSpecs],
  ['poi-discovery-snapshot/v1', 'poi-discovery-snapshot/v2'])
t('синтетический canary честно объявляет себя v2',
  acceptedCanary.contractVersion, 'poi-discovery-snapshot/v2')
t('и его порядок — список ключей без ролей',
  Array.isArray(acceptedCanary.orderRecords[0].order), true)
t('поля v3 в нём отсутствуют',
  Object.prototype.hasOwnProperty.call(acceptedCanary, 'nestedCollectionEvidence'), false)
t('и счётчик у него прежний', acceptedCanary.counters.poisVisited, 50)

const v3ForCanary = knownInside.discovery
const v3Verdict = evaluateCanary(v3ForCanary)
t('снимок v3 приёмка не принимает', v3Verdict.accepted, false)
eq('и отказ у неё ровно один и именованный',
  [...v3Verdict.failureCodes], ['unsupportedSnapshotVersion'])
t('бюджет для чужого формата не считается', v3Verdict.computedBudget, null)
t('и его статус неопределён', v3Verdict.computedBudgetStatus, 'indeterminate')
t('код входит в закрытый список приёмки',
  CANARY_ACCEPTANCE_CODES.includes('unsupportedSnapshotVersion'), true)
/* На поддерживаемом формате та же строка проходит — иначе проверка
   отвергала бы всё подряд и ничего не значила. */
t('на v2 проверка версии пройдена',
  evaluateCanary(acceptedCanary).checks.find((c) => c.code === 'unsupportedSnapshotVersion').passed,
  true)

/* ══ R1: МОНИТОР НАБЛЮДАЕТ ВЕСЬ ГРАФ ════════════════════════════════════ */

const MON_AT = '2026-08-24T00:00:00.000Z'
const monDigest = (seed) => `sha256:${createHash('sha256').update(String(seed), 'utf8').digest('hex')}`
const monEvidence = (url, pageRole, over = {}) => buildPageEvidence({
  url,
  pageRole,
  pageBytes: 1000,
  rawPageDigest: monDigest(url),
  observedAt: MON_AT,
  httpCharset: 'shift-jis',
  metaCharset: 'utf-8',
  decodePolicy: 'mixed-page-utf8-locators-v1',
  decodeErrorCount: 0,
  decodeReplacements: 0,
  nonWhitelistedCodepoints: 0,
  ...over,
})
const MON_ROBOTS = {
  url: ROBOTS_URL, bytes: 64, digest: monDigest('robots'), observedAt: MON_AT, appliedGroups: ['*'],
}
const MON_COLL = `${HOST}/e/e12000.html`
const MON_NESTED = `${HOST}/e/e5041.html`
const MON_POI = `${HOST}/e/e30001.html`
const MON_DIRECT = `${HOST}/e/e14000.html`
const MON_EXTRA = `${HOST}/e/e12001.html`

/**
 * Минимальный ГРАФ для монитора: цель-коллекция, вложенная коллекция и общий
 * объект. Строится напрямую, а не обходом: здесь проверяется сравнение двух
 * снимков, и оба обязаны отличаться ровно одним заданным свойством.
 */
const monGraph = ({ nestedOver = {}, nestedDigest = null, withExtra = false } = {}) => {
  const collEvidence = monEvidence(MON_COLL, 'collection')
  const directEvidence = monEvidence(MON_DIRECT, 'poi')
  const nestedEvidence = monEvidence(MON_NESTED, 'collection', nestedOver)
  const collKey = discoverySourceKey(MON_COLL)
  const nestedKey = discoverySourceKey(MON_NESTED)
  const poiKey = discoverySourceKey(MON_POI)
  const directKey = discoverySourceKey(MON_DIRECT)
  const targets = [
    { sourceKey: collKey, evidence: collEvidence },
    { sourceKey: directKey, evidence: directEvidence },
  ]
  const orders = [
    buildOrderRecord({
      destinationSourceKey: collKey,
      sourcePageDigest: collEvidence.rawPageDigest,
      collectionKind: 'ranked',
      items: [orderItem('poi', poiKey), orderItem('collection', nestedKey)],
    }),
    buildOrderRecord({
      destinationSourceKey: nestedKey,
      sourcePageDigest: nestedDigest ?? nestedEvidence.rawPageDigest,
      collectionKind: 'ranked',
      items: [orderItem('poi', poiKey)],
    }),
  ]
  if (withExtra) {
    const extraEvidence = monEvidence(MON_EXTRA, 'collection')
    targets.push({ sourceKey: discoverySourceKey(MON_EXTRA), evidence: extraEvidence })
    orders.push(buildOrderRecord({
      destinationSourceKey: discoverySourceKey(MON_EXTRA),
      sourcePageDigest: extraEvidence.rawPageDigest,
      collectionKind: 'ranked',
      items: [],
    }))
  }
  const records = [
    buildDiscoveryRecord({
      sourceKey: poiKey,
      url: MON_POI,
      nameEn: 'Shared object',
      placements: [
        buildPlacement({
          kind: 'destinationRanking',
          collectionSourceKey: collKey,
          listPosition: 1,
          editorialLevel: 0,
          categoryHint: null,
        }),
        buildPlacement({
          kind: 'destinationRanking',
          collectionSourceKey: nestedKey,
          listPosition: 1,
          editorialLevel: 0,
          categoryHint: null,
        }),
      ],
      factLeads: [],
      omissions: [],
      pageEvidence: monEvidence(MON_POI, 'poi'),
    }),
    buildDiscoveryRecord({
      sourceKey: directKey,
      url: MON_DIRECT,
      nameEn: 'Direct object',
      placements: [buildPlacement({
        kind: 'catalogueDirect',
        collectionSourceKey: CATALOGUE_SOURCE_KEY,
        listPosition: null,
        editorialLevel: null,
        categoryHint: null,
      })],
      factLeads: [],
      omissions: [],
      pageEvidence: directEvidence,
    }),
  ]
  return buildDiscoverySnapshot({
    scope: { kind: 'full', limit: null },
    entryUrl: ENTRY,
    incompleteReasons: [],
    networkPolicy: { maxNetworkRequests: 6000, maxRedirects: 2 },
    robotsEvidence: MON_ROBOTS,
    catalogueEvidence: monEvidence(ENTRY, 'catalogue'),
    catalogueTargetEvidence: targets,
    nestedCollectionEvidence: [{ sourceKey: nestedKey, evidence: nestedEvidence }],
    orderRecords: orders,
    records,
    rejected: { targets: [], cards: [], nodes: [], pois: [] },
    counters: {
      networkRequests: 2 + targets.length + 1 + 1,
      catalogueTargetsFound: targets.length,
      catalogueCollectionsFound: targets.filter((r) => r.evidence.pageRole === 'collection').length,
      nestedCollectionsFound: 1,
      directPoisFound: 1,
      poisFound: 2,
      recordsAttempted: 2,
      recordsBuilt: 2,
      nonCanonicalLinks: 0,
      unknownAdmissionLabels: 0,
      emptyAdmissionValues: 0,
    },
  })
}

const monBase = monGraph()
assertDiscoverySnapshot(monBase); ok++
t('графовый снимок для монитора полон', monBase.complete, true)
t('и его обмены не ниже границы', monBase.counters.networkRequests >= 2 + 2 + 1 + 1, true)

/* Одинаковые снимки — ноль различий во всех разделах, включая новые. */
const monSame = diffDiscoverySnapshot(parsed(monBase), parsed(monBase))
t('одинаковые снимки сравнимы', monSame.comparable, true)
t('и различий нет ни в одном разделе',
  monSame.appeared + monSame.vanished + monSame.semanticChanges + monSame.reorderedDestinations
  + monSame.evidenceChanges + monSame.parentPageChanges + monSame.graphChanges
  + monSame.encodingChanges, 0)

/* 1. Изменились байты вложенной коллекции. */
const MON_NESTED_NEW = monDigest(`${MON_NESTED}#переверстали`)
const monNestedBytes = monGraph({
  nestedOver: { pageBytes: 2000, rawPageDigest: MON_NESTED_NEW },
  nestedDigest: MON_NESTED_NEW,
})
const diffNestedBytes = diffDiscoverySnapshot(parsed(monNestedBytes), parsed(monBase))
t('изменение байтов вложенной коллекции сообщено', diffNestedBytes.parentPageChanges, 1)
eq('и названо ключом и происхождением',
  [diffNestedBytes.details.parentPageChanges[0].sourceKey,
    diffNestedBytes.details.parentPageChanges[0].origin,
    diffNestedBytes.details.parentPageChanges[0].page],
  [discoverySourceKey(MON_NESTED), 'nestedCollection', 'collection'])
eq('с прежним и новым размером',
  [diffNestedBytes.details.parentPageChanges[0].bytesFrom,
    diffNestedBytes.details.parentPageChanges[0].bytesTo], [1000, 2000])
/* И перестановкой это больше не называется: последовательность та же. */
t('перестановкой это не объявлено', diffNestedBytes.reorderedDestinations, 0)
t('записи не изменились',
  diffNestedBytes.semanticChanges + diffNestedBytes.appeared + diffNestedBytes.vanished, 0)

/* 2. Изменились сигналы кодировки вложенной коллекции. */
const monNestedEncoding = monGraph({
  nestedOver: { decodeErrorCount: 7, decodeReplacements: 7 },
})
const diffNestedEncoding = diffDiscoverySnapshot(parsed(monNestedEncoding), parsed(monBase))
t('изменение диагностики кодировки сообщено', diffNestedEncoding.encodingChanges, 1)
eq('и названо ключом и происхождением',
  [diffNestedEncoding.details.encodingChanges[0].sourceKey,
    diffNestedEncoding.details.encodingChanges[0].origin],
  [discoverySourceKey(MON_NESTED), 'nestedCollection'])
t('байты при этом те же, и родительских изменений нет',
  diffNestedEncoding.parentPageChanges, 0)

/* 3. Узел графа появился. */
const monWithExtra = monGraph({ withExtra: true })
const diffAppeared = diffDiscoverySnapshot(parsed(monWithExtra), parsed(monBase))
t('появление коллекции сообщено', diffAppeared.graphChanges, 1)
eq('и названо ключом и видом изменения',
  [diffAppeared.details.graphChanges[0].change,
    diffAppeared.details.graphChanges[0].sourceKey,
    diffAppeared.details.graphChanges[0].origin],
  ['collectionAppeared', discoverySourceKey(MON_EXTRA), 'catalogueTarget'])
t('записи объектов при этом не изменились',
  diffAppeared.appeared + diffAppeared.vanished + diffAppeared.semanticChanges, 0)

/* 4. Узел графа исчез. */
const diffVanished = diffDiscoverySnapshot(parsed(monBase), parsed(monWithExtra))
t('исчезновение коллекции сообщено', diffVanished.graphChanges, 1)
eq('и названо так, что вывод о закрытии из него не следует',
  [diffVanished.details.graphChanges[0].change,
    diffVanished.details.graphChanges[0].sourceKey],
  ['collectionVanishedForHumanReview', discoverySourceKey(MON_EXTRA)])

/* 5. Сравнение разных версий по-прежнему отвергается ДО отпечатков. */
const monAsV2 = parsed(monBase)
monAsV2.contractVersion = 'poi-discovery-snapshot/v2'
const monCross = diffDiscoverySnapshot(parsed(monBase), monAsV2)
t('снимки разных версий несравнимы', monCross.comparable, false)
t('и отказ назван версиями', monCross.refusal.includes('версии снимков разные'), true)
t('до проверки контракта дело не дошло',
  monCross.refusal.includes('не проходит проверку контракта'), false)

/* ══ R1: живой обход считает попытки и обмены честно ════════════════════ */

t('обход считает попытки построить запись',
  nestedRun.discovery.counters.recordsAttempted, nestedRun.discovery.counters.poisFound)
t('и прежнего имени в снимке нет',
  Object.prototype.hasOwnProperty.call(nestedRun.discovery.counters, 'poisVisited'), false)
const liveBound = 2
  + nestedRun.discovery.catalogueTargetEvidence.length
  + nestedRun.discovery.nestedCollectionEvidence.length
  + nestedRun.discovery.counters.poisFound - nestedRun.discovery.counters.directPoisFound
t('обмены живого обхода сходятся с границей ровно',
  nestedRun.discovery.counters.networkRequests, liveBound)


/* ══ R3: КОД ОТКАЗА НЕ ОПРЕДЕЛЯЕТ СТАДИЮ ОБМЕНА ════════════════════════
 *
 * Вторая редакция границы классифицировала отказы одним глобальным списком
 * кодов и считала `urlNotCanonical` досетевым: `canonicalDiscoveryUrl`
 * действительно бросает его до запроса. Но `fetchHtmlPage` зовёт ту же
 * функцию ВТОРОЙ раз — для `Location` уже полученного 3xx-ответа.
 *
 * Показания HEAD до правки, снятые этим же обходом:
 *   обменов 7, объявлено 7, `rejected.targets` → `japan-guide:e1001`
 *   с кодом `urlNotCanonical`; подделка с объявленными 6 ПРИНИМАЛАСЬ.
 *
 * Проверяется production-функция `collectJapanGuideDiscovery` и настоящий
 * расчёт снимка: подделка собирается ровно так, как собрал бы посторонний —
 * счётчик уменьшен, отпечаток честно пересчитан тем же доменом.
 */

const REDIRECT_TO_QUERY = `${HOST}/e/e1001.html?utm=1`

/** Роутер, отдающий 302 на заданный адрес. Ни строки с сайта. */
const withRedirect = (pages, from, to, log) => {
  const base = router(pages)
  return async (url, init) => {
    log.push(url)
    if (url === from) return response(new Uint8Array(0), { status: 302, location: to })
    return base(url, init)
  }
}
const crawlWithRedirect = async (pages, from, to) => {
  const log = []
  const result = await collectJapanGuideDiscovery(PORTAL, {
    fetchImpl: withRedirect(pages, from, to, log), now: NOW, sleep: async () => {},
  })
  return { ...result, log }
}

/** Отпечаток снимка `v3` тем же доменом, что у контракта. */
const forgeSnapshotDigestV3 = (snap) => sha256Bytes(canonicalJsonBytes({
  contractVersion: SNAPSHOT_SPEC,
  scope: snap.scope,
  entryUrl: snap.entryUrl,
  complete: snap.complete,
  incompleteReasons: snap.incompleteReasons,
  networkPolicy: snap.networkPolicy,
  robotsEvidence: snap.robotsEvidence,
  catalogueEvidence: snap.catalogueEvidence,
  catalogueTargetEvidence: snap.catalogueTargetEvidence,
  nestedCollectionEvidence: snap.nestedCollectionEvidence,
  orderRecords: snap.orderRecords.map((row) => row.orderDigest),
  records: snap.records.map((row) => row.observationDigest),
  rejected: snap.rejected,
  counters: snap.counters,
}, `${SNAPSHOT_SPEC}#snapshot`))

/** Снимок с уменьшенным счётчиком обменов и честно пересчитанным отпечатком. */
const cheaperBy = (snap, less) => {
  const copy = JSON.parse(JSON.stringify(snap))
  copy.counters.networkRequests -= less
  copy.snapshotDigest = forgeSnapshotDigestV3(copy)
  return copy
}

/* ── Цель, отвергнутая ПОСЛЕ редиректа ────────────────────────────────── */

const redirectedTarget = await crawlWithRedirect(PAGES, `${HOST}/e/e1001.html`, REDIRECT_TO_QUERY)
const rtSnap = redirectedTarget.discovery
assertDiscoverySnapshot(rtSnap); ok++
eq('цель отвергнута кодом канонизации — тем самым, что считался досетевым',
  rtSnap.rejected.targets.map((row) => [row.ref, row.code]),
  [[`japan-guide:e1001`, 'urlNotCanonical']])
t('обмен при этом состоялся: 302 пришёл ответом',
  redirectedTarget.log.includes(`${HOST}/e/e1001.html`), true)
t('снимок объявляет ровно столько обменов, сколько их было',
  rtSnap.counters.networkRequests, redirectedTarget.log.length)
t('и честный снимок принимается', rtSnap.complete, false)
throwsWith('а снимок, вычевший этот обмен, отвергается',
  () => assertDiscoverySnapshot(cheaperBy(rtSnap, 1)),
  'состав снимка требует не меньше')
throwsWith('и слагаемое названо отвергнутой целью',
  () => assertDiscoverySnapshot(cheaperBy(rtSnap, 1)), 'отвергнутых целей')

/* ── Вложенный узел, отвергнутый ПОСЛЕ редиректа ──────────────────────── */

const NESTED_REDIRECT_PAGES = new Map([
  [ENTRY, CATALOGUE_CLEAN],
  [pageUrl('e1001'), rankedPage('Alpha', ['/e/e2001.html', '/e/e5041.html'])],
  [pageUrl('e1002'), rankedPage('Beta', ['/e/e2002.html'])],
  [pageUrl('e1003a'), ATTRACTION],
  [pageUrl('e2001'), ATTRACTION],
  [pageUrl('e2002'), ATTRACTION],
])
const redirectedNode = await crawlWithRedirect(
  NESTED_REDIRECT_PAGES, pageUrl('e5041'), `${HOST}/e/e5041.html?utm=1`)
const rnSnap = redirectedNode.discovery
assertDiscoverySnapshot(rnSnap); ok++
eq('узел графа отвергнут тем же кодом канонизации',
  rnSnap.rejected.nodes.map((row) => [row.ref, row.origin, row.code]),
  [[pageKey('e5041'), pageKey('e1001'), 'urlNotCanonical']])
t('и его 302 тоже был обменом', redirectedNode.log.includes(pageUrl('e5041')), true)
t('снимок объявляет все обмены',
  rnSnap.counters.networkRequests, redirectedNode.log.length)
throwsWith('снимок, вычевший обмен узла, отвергается',
  () => assertDiscoverySnapshot(cheaperBy(rnSnap, 1)),
  'состав снимка требует не меньше')
throwsWith('и названо именно слагаемое узлов',
  () => assertDiscoverySnapshot(cheaperBy(rnSnap, 1)), 'отвергнутых узлов')

/* Оба снимка ровно на границе: вычесть нельзя ни одного обмена, а объявить
   больше — можно, потому что редирект законно тратит их несколько. */
t('цель: снимок стоит ровно на границе',
  (() => { try { assertDiscoverySnapshot(cheaperBy(rtSnap, 0)); return true } catch { return false } })(), true)
t('узел: тоже ровно на границе',
  (() => { try { assertDiscoverySnapshot(cheaperBy(rnSnap, 0)); return true } catch { return false } })(), true)


/* ══ R4: ДВА РЕДИРЕКТА ПЕРЕД ИСЧЕРПАНИЕМ БЮДЖЕТА ═══════════════════════
 *
 * Нижняя граница не видит обменов, потраченных ВНУТРИ отказа, который сам по
 * себе обмена не стоил. Показания HEAD до правки, снятые этим же обходом при
 * `maxNetworkRequests` = 4:
 *
 *   обменов 4 (robots, каталог и два 302 первой цели), объявлено 4,
 *   три цели отвергнуты кодом `networkBudgetExhausted`;
 *   подделка с объявленными 2 ПРИНИМАЛАСЬ — состав снимка требовал ровно 2.
 *
 * Прежняя оценка «утаить можно не больше одного обмена» была неверна: скрыть
 * можно до `maxRedirects` обменов. Закрывает это не классификация, а
 * `networkPolicy` в снимке.
 */

/** Обход с урезанным бюджетом: любая цель водит по редиректам. */
const budgetRun = async (maxNetworkRequests) => {
  const log = []
  let hop = 0
  const base = router(PAGES)
  const fetchImpl = async (url, init) => {
    log.push(url)
    if (url === ROBOTS_URL || url === ENTRY) return base(url, init)
    hop += 1
    return response(new Uint8Array(0), { status: 302, location: `${HOST}/e/e900${hop}.html` })
  }
  const result = await collectJapanGuideDiscovery(PORTAL, {
    fetchImpl, now: NOW, sleep: async () => {}, limits: { ...FETCH_LIMITS, maxNetworkRequests },
  })
  return { ...result, log }
}

const exhausted = await budgetRun(4)
const exSnap = exhausted.discovery
assertDiscoverySnapshot(exSnap); ok++
t('обменов было четыре: robots, каталог и два шага редиректа',
  exhausted.log.length, 4)
t('и снимок объявляет ровно столько', exSnap.counters.networkRequests, 4)
eq('все три цели отвергнуты исчерпанием бюджета',
  [...new Set(exSnap.rejected.targets.map((row) => row.code))], ['networkBudgetExhausted'])
t('свидетельств целей при этом нет ни одного',
  exSnap.catalogueTargetEvidence.length, 0)

/* Состав снимка требует всего двух обменов — именно поэтому нижней границы
   тут мало, и это проверяется, а не утверждается. */
const composedBound = 2
  + exSnap.catalogueTargetEvidence.length
  + exSnap.nestedCollectionEvidence.length
  + exSnap.counters.poisFound - exSnap.counters.directPoisFound
t('нижняя граница состава — два обмена', composedBound, 2)

/* Потолок обхода записан в снимок и совпадает с тем, под которым он шёл. */
eq('потолки записаны в снимок', exSnap.networkPolicy,
  { maxNetworkRequests: 4, maxRedirects: FETCH_LIMITS.maxRedirects })

throwsWith('подделка аудита: два обмена вместо четырёх — отказ',
  () => assertDiscoverySnapshot(cheaperBy(exSnap, 2)),
  'исчерпанным бюджет бывает ровно на потолке')
throwsWith('и даже один вычтенный обмен — тоже',
  () => assertDiscoverySnapshot(cheaperBy(exSnap, 1)),
  'исчерпанным бюджет бывает ровно на потолке')

/* Исчерпание ДО первого запроса цели: бюджета хватило ровно на robots и
   каталог. Снимок законен, и вычесть из него всё равно нельзя. */
const exhaustedEarly = await budgetRun(2)
const eeSnap = exhaustedEarly.discovery
assertDiscoverySnapshot(eeSnap); ok++
t('обменов ровно два', exhaustedEarly.log.length, 2)
t('и ни один из них не был запросом цели',
  exhaustedEarly.log.filter((url) => url !== ROBOTS_URL && url !== ENTRY).length, 0)
t('снимок стоит на потолке',
  eeSnap.counters.networkRequests, eeSnap.networkPolicy.maxNetworkRequests)
/* Здесь вычитание ловит НИЖНЯЯ граница, а не потолок: robots и каталог —
   ровно те два обмена, которые состав снимка требует безусловно. Названо
   честно, потому что «отвергнут» без указания, чем именно, скрыло бы, что
   вторая проверка на этом снимке не работает. */
throwsWith('вычесть обмен нельзя и здесь — но ловит уже нижняя граница',
  () => assertDiscoverySnapshot(cheaperBy(eeSnap, 1)),
  'состав снимка требует не меньше 2')


/* ══ R5: ОБХОД БЕЗ РЕДИРЕКТОВ — ЗАКОННЫЙ РЕЖИМ ═════════════════════════
 *
 * `maxRedirects: 0` означает «за редиректами не ходить»: `fetchHtmlPage`
 * делает ровно один шаг, и первый же 3xx даёт `redirectLimit`. Контракт
 * требовал от поля единицы и снимок такого обхода отвергал:
 *
 *   networkPolicy.maxRedirects: ожидается безопасное целое не меньше 1,
 *   получено 0
 *
 * Проверяется production-функцией, а не собранным вручную снимком: отказ был
 * именно у настоящего обхода, и регрессия обязана идти тем же путём.
 */

const noRedirectRun = await collectJapanGuideDiscovery(PORTAL, {
  fetchImpl: router(PAGES),
  now: NOW,
  sleep: async () => {},
  limits: { ...FETCH_LIMITS, maxRedirects: 0 },
})
assertDiscoverySnapshot(noRedirectRun.discovery); ok++
t('обход без редиректов строит законный снимок', noRedirectRun.discovery.complete, true)
t('и записывает нулевой потолок как есть',
  noRedirectRun.discovery.networkPolicy.maxRedirects, 0)
t('потолок обменов при этом остаётся своим',
  noRedirectRun.discovery.networkPolicy.maxNetworkRequests, FETCH_LIMITS.maxNetworkRequests)
t('состав снимка тот же, что у обхода с редиректами по умолчанию',
  noRedirectRun.discovery.counters.poisFound, run.discovery.counters.poisFound)

/* Ноль — это именно РЕЖИМ, а не «редиректов не встретилось»: первый же 3xx
   отвергает цель кодом предела, а не уводит обход дальше. */
const zeroHop = await collectJapanGuideDiscovery(PORTAL, {
  fetchImpl: withRedirect(PAGES, `${HOST}/e/e1001.html`, `${HOST}/e/e2001.html`, []),
  now: NOW,
  sleep: async () => {},
  limits: { ...FETCH_LIMITS, maxRedirects: 0 },
})
assertDiscoverySnapshot(zeroHop.discovery); ok++
eq('в режиме без редиректов 3xx отвергает цель кодом redirectLimit',
  zeroHop.discovery.rejected.targets.map((row) => row.code), ['redirectLimit'])
t('и этот отказ границу поднимает: обмен состоялся',
  zeroHop.discovery.counters.networkRequests
  >= 2 + zeroHop.discovery.catalogueTargetEvidence.length + 1, true)

finish()
