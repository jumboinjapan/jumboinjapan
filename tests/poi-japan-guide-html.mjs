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
import {
  SELECTORS,
  collectJapanGuideDiscovery,
  diffDiscoverySnapshot,
  parseAttraction,
  parseCatalogue,
  parseDestination,
} from '../scripts/poi-portals/lib/japan-guide-html.mjs'
import {
  CATALOGUE_SOURCE_KEY,
  assertDiscoveryRecord,
  assertDiscoverySnapshot,
  buildPlacement,
  orderDigest,
} from '../scripts/poi-portals/lib/discovery-contract.mjs'
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

throwsWith('две группы без заголовка — отказ страницы', () => parseDestination({
  html: DESTINATION.replace('<div class="spot_list__category__header">Side Trips from Fixture City</div>', ''),
  url: `${HOST}/e/e2157.html`,
}), 'structureMismatch')
throwsWith('нет заголовка списка — не направление', () => parseDestination({
  html: DESTINATION.replace('spot_list__list_title', 'spot_list__other_title'),
  url: `${HOST}/e/e2157.html`,
}), 'structureMismatch')

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
t('нет элемента заголовка — роль не определяется',
  titleFailure(ATTRACTION.replace('<h1 class="page_title__title">First Object (Fixture)</h1>', '')),
  'structureMismatch:pageRoleUnknown')
t('заголовок пуст — другая причина',
  titleFailure(ATTRACTION.replace('First Object (Fixture)', '   ')), 'structureMismatch:titleEmpty')
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
t('и коллекций стало на одну меньше', direct.discovery.counters.collectionsFound, 2)
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

const starved = await crawl({ limits: { ...FETCH_LIMITS, maxNetworkRequests: 5 } })
t('нехватка бюджета останавливает уровень объектов', starved.discovery.records.length, 0)
t('и названа причиной', starved.discovery.incompleteReasons.some((r) => r.code === 'budgetInsufficient'), true)
t('бюджет проверен ДО расхода: обменов ровно пять', starved.discovery.counters.networkRequests, 5)

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
/* Реестр объявляет ТРИ формы ссылок, и каждая обязана быть той же, что в
   грамматике адресов: разойдясь, реестр описывал бы не тот обход. */
t('шаблонов ссылок три', japanGuide.discovery.linkPatterns.length, 3)
t('вход соответствует одному из шаблонов',
  japanGuide.discovery.linkPatterns.some((source) =>
    new RegExp(source).test(new URL(japanGuide.discovery.entry).pathname)), true)
for (const [label, path] of [
  ['legacy', '/e/e4000.html'],
  ['корневая', '/destinations/nozawa-onsen/'],
  ['вложенная', '/destinations/nozawa-onsen/hot-spring-baths.html'],
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
  'structureMismatch:pageRoleAmbiguous')
t('гибрид не разбирается как объект',
  roleFailure(() => parseAttraction({ html: HYBRID, page: PAGE, placements: PLACEMENTS })),
  'structureMismatch:pageRoleAmbiguous')

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
  mixed.discovery.orderRecords.length, mixed.discovery.counters.collectionsFound)

/* 2 и 3. Обе роли сразу и ни одной — отказ цели, а не выбор. */
const ambiguousTarget = new Map([...MIXED_PAGES])
ambiguousTarget.set(`${HOST}/destinations/fixture-root-object/`, HYBRID)
const ambiguousRun = await crawl({ fetchImpl: router(ambiguousTarget) })
t('двусмысленная цель делает снимок неполным', ambiguousRun.discovery.complete, false)
t('и попадает в отказы цели',
  ambiguousRun.discovery.rejected.targets.some((row) => row.code === 'structureMismatch'), true)
t('целью она не записана', ambiguousRun.discovery.catalogueTargetEvidence
  .some((row) => row.sourceKey === 'japan-guide:destinations:fixture-root-object'), false)

const rolelessTarget = new Map([...MIXED_PAGES])
rolelessTarget.set(`${HOST}/destinations/fixture-root-object/`,
  '<!doctype html><html><head><meta charset="UTF-8"></head><body><p>nothing</p></body></html>')
const rolelessRun = await crawl({ fetchImpl: router(rolelessTarget) })
t('цель без роли делает снимок неполным', rolelessRun.discovery.complete, false)
t('и названа причиной уровня цели',
  rolelessRun.discovery.incompleteReasons.some((r) => r.code === 'targetStructureMismatch'), true)

/* 9. Полный снимок без классификации КАЖДОЙ цели невозможен. */
t('коллекции и прямые объекты дают в сумме число целей',
  mixed.discovery.counters.collectionsFound + mixed.discovery.counters.directPoisFound,
  mixed.discovery.counters.catalogueTargetsFound)
throwsWith('цель без свидетельства делает полный снимок невозможным',
  () => assertDiscoverySnapshot(forgeFrom(mixed.discovery, (s) => {
    s.counters.catalogueTargetsFound += 1
  })))
/* Роли переставлены местами: сумма и число свидетельств сохранены, поэтому
   сработать может ТОЛЬКО сверка ролей со счётчиками. */
throwsWith('счётчик ролей обязан сходиться со свидетельствами',
  () => assertDiscoverySnapshot(forgeFrom(mixed.discovery, (s) => {
    const collections = s.counters.collectionsFound
    s.counters.collectionsFound = s.counters.directPoisFound
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
    row.orderDigest = orderDigest(collectionKey, OTHER_BYTES, row.order)
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

finish()
