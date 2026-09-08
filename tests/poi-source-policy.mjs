#!/usr/bin/env node
/**
 * JA-3: реестр источников, бюджет сети и разбор структурных фактов.
 *
 *   node tests/poi-source-policy.mjs
 *
 * Доказывается:
 *   • статус домена выводится ТОЛЬКО из предъявленного исхода robots.txt:
 *     получен — `allowed`, 404/410 — `allowed` (RFC 9309), 5xx и обрыв —
 *     `unknown`, а не «разрешено» и не «запрещено»; запрет всего домена
 *     подписывает человек, разбор его не выводит;
 *   • путь спрашивается отдельно и по ТЕМ ЖЕ байтам: подменённый текст
 *     robots.txt не проходит, отсутствующий — тоже;
 *   • список извлекаемого закрыт: прозы в нём нет и добавить её нечем;
 *   • бюджет решает ДО запроса; исчерпание — названный исход, не ошибка;
 *   • со страницы берутся только структурные факты `schema.org`: описание,
 *     телефон и абзацы не извлекаются; координаты вне Японии отвергаются;
 *     организация местом не считается; враждебная страница упирается в
 *     потолки, а не в память.
 */
import {
  assertSourcePolicy, BUDGET_KINDS, ENRICHABLE_FACTS, openEnrichmentBudget,
  ownerDeniedPolicy, policyAllowsPath, policyDomain, policyOrigin, POLICY_STATUSES,
  ROBOTS_OUTCOMES, sourcePolicyFromRobots, SOURCE_POLICY_SPEC,
} from '../scripts/poi-portals/lib/source-policy.mjs'
import {
  collectPlaceFacts, extractJsonLdBlocks, isPlaceNode, JAPAN_BBOX,
  OFFICIAL_FACTS_SPEC, OMISSION_CODES, PARSE_LIMITS, PLACE_TYPES,
} from '../scripts/poi-portals/lib/official-page.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${String(text).slice(0, 240)}» нет «${needle}»`)
}
const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e instanceof Error ? e.message : String(e) } }

const AT = '2026-09-08T10:00:00.000Z'
const ROBOTS = 'User-agent: *\nDisallow: /private\nAllow: /private/open\n'
const policyOf = (outcome, bytes = null, domain = 'example.jp', origin = null) => sourcePolicyFromRobots({
  domain,
  origin: origin ?? `https://www.${domain}`,
  robotsUrl: `${origin ?? `https://www.${domain}`}/robots.txt`,
  outcome,
  bytes,
  fetchedAt: AT,
})

/* ── 1. Статус домена выводится из предъявленного исхода ────────────────── */
{
  const fetched = policyOf('fetched', Buffer.from(ROBOTS, 'utf8'))
  t('robots получен — allowed', fetched.status, 'allowed')
  t('  подпись — автоматическая', fetched.decidedBy, 'robots-auto')
  t('  разбор приложен: отпечаток, группы, число правил', `${/^sha256:[0-9a-f]{64}$/.test(fetched.robots.digest)}/${fetched.robots.groupSource}/${fetched.robots.ruleCount}`, 'true/wildcard/2')
  t('  и открыт весь закрытый список фактов', fetched.allowedFacts.join(','), [...ENRICHABLE_FACTS].join(','))
  t('robots отсутствует (404/410) — allowed по RFC 9309', policyOf('absent').status, 'allowed')
  t('robots недоступен (5xx, обрыв) — unknown, а не «можно»', policyOf('unavailable').status, 'unknown')
  t('robots не разбирается — unknown', policyOf('undecodable').status, 'unknown')
  t('  и у unknown нет разрешённых фактов', policyOf('unavailable').allowedFacts.length, 0)
  t('исходов ровно четыре', ROBOTS_OUTCOMES.join(','), 'fetched,absent,unavailable,undecodable')
  t('статусов ровно три', POLICY_STATUSES.join(','), 'allowed,denied,unknown')
  has('исход «fetched» без байтов — отказ', boom(() => policyOf('fetched')), 'статус выводить не из чего')
  has('байты при исходе «absent» — отказ', boom(() => policyOf('absent', Buffer.from(ROBOTS, 'utf8'))), 'противоречат друг другу')
  has('ненормализованный домен — отказ', boom(() => sourcePolicyFromRobots({ domain: 'www.Example.JP', origin: 'https://www.example.jp', robotsUrl: 'https://www.example.jp/robots.txt', outcome: 'absent', fetchedAt: AT })), 'нормализованный домен')
  t('реестр адресуется origin, а не доменом без www', policyOf('absent').origin, 'https://www.example.jp')
  t('  и origin выводится из адреса подсказки', policyOrigin('https://WWW.Kunaicho.GO.JP/x/y?z=1'), 'https://www.kunaicho.go.jp')
  has('origin чужого домена — отказ', boom(() => assertSourcePolicy({ ...policyOf('absent'), origin: 'https://other.jp' })), 'не принадлежит домену')
  has('robots.txt не с того origin — отказ', boom(() => assertSourcePolicy({ ...policyOf('absent'), robotsUrl: 'https://www.example.jp.evil/robots.txt' })), 'взят не с origin')
}

/* ── 2. Запрет всего домена — только рукой человека ─────────────────────── */
{
  const denied = ownerDeniedPolicy({ domain: 'example.jp', origin: 'https://www.example.jp', robotsUrl: 'https://www.example.jp/robots.txt', decidedAt: AT, note: 'владелец сайта попросил не обходить' })
  t('решение владельца — denied', denied.status, 'denied')
  t('  подписано человеком', denied.decidedBy, 'owner')
  t('  и ничего не разрешает', denied.allowedFacts.length, 0)
  has('автоматический denied невозможен', boom(() => assertSourcePolicy({ ...denied, decidedBy: 'robots-auto' })), 'подписывает человек')
  has('решение владельца без причины — отказ', boom(() => assertSourcePolicy({ ...denied, note: null })), 'обязано нести причину')
}

/* ── 3. Путь спрашивается отдельно и по тем же байтам ───────────────────── */
{
  const record = policyOf('fetched', Buffer.from(ROBOTS, 'utf8'))
  t('разрешённый путь', policyAllowsPath(record, 'https://example.jp/about', ROBOTS).reason, 'robotsAllowed')
  t('запрещённый путь', policyAllowsPath(record, 'https://example.jp/private/x', ROBOTS).reason, 'robotsDenied')
  t('  назван запретивший образец', policyAllowsPath(record, 'https://example.jp/private/x', ROBOTS).deniedBy, '/private')
  t('исключение внутри запрета — allow длиннее', policyAllowsPath(record, 'https://example.jp/private/open', ROBOTS).allowed, true)
  t('подменённый текст robots — не спрашиваем', policyAllowsPath(record, 'https://example.jp/about', 'User-agent: *\n').reason, 'robotsTextMismatch')
  t('текста robots нет — не спрашиваем', policyAllowsPath(record, 'https://example.jp/about', null).reason, 'robotsTextMissing')
  t('запись другого домена не применяется', policyAllowsPath(record, 'https://other.jp/about', ROBOTS).reason, 'policyForAnotherDomain')
  t('домен со статусом unknown закрыт', policyAllowsPath(policyOf('unavailable'), 'https://example.jp/a').reason, 'robotsUnavailable')
  t('домен, запрещённый владельцем, закрыт', policyAllowsPath(ownerDeniedPolicy({ domain: 'example.jp', origin: 'https://www.example.jp', robotsUrl: 'https://www.example.jp/robots.txt', decidedAt: AT, note: 'по просьбе сайта' }), 'https://example.jp/a').reason, 'robotsDenied')
  t('запись применима и к www, и к apex того же сайта', policyAllowsPath(policyOf('absent'), 'https://www.example.jp/a').reason, 'robotsAbsent')
  t('«правил нет» — путь открыт без вопросов к тексту', policyAllowsPath(policyOf('absent'), 'https://example.jp/a').reason, 'robotsAbsent')
  t('домен нормализуется', policyDomain('https://WWW.Example.JP/x?y=1'), 'example.jp')
  has('чужая схема — отказ', boom(() => policyDomain('ftp://example.jp/x')), 'только http(s)')
}

/* ── 4. Список извлекаемого закрыт ──────────────────────────────────────── */
{
  t('в списке только структурные поля', [...ENRICHABLE_FACTS].join(','), 'address,lat,lon,nameJa,nameKana,officialUrl,postalCode')
  t('прозы в нём нет', ENRICHABLE_FACTS.some((f) => ['description', 'summary', 'text', 'hours', 'admission'].includes(f)), false)
  t('список заморожен', Object.isFrozen(ENRICHABLE_FACTS), true)
  const record = policyOf('fetched', Buffer.from(ROBOTS, 'utf8'))
  has('поле вне списка — отказ записи', boom(() => assertSourcePolicy({ ...record, allowedFacts: [...record.allowedFacts, 'description'].sort() })), 'вне закрытого списка извлекаемого')
  has('разрешённые поля у запрещённого домена — отказ', boom(() => assertSourcePolicy({ ...record, status: 'unknown' })), 'не разрешает ничего')
  has('лишний ключ записи — отказ', boom(() => assertSourcePolicy({ ...record, extra: 1 })), SOURCE_POLICY_SPEC)
}

/* ── 5. Бюджет решает до запроса ────────────────────────────────────────── */
{
  const budget = openEnrichmentBudget({ objects: 2, robotsFetches: 3, pageFetches: 2, perDomainFetches: 1 })
  t('родов расхода три', BUDGET_KINDS.join(','), 'object,robotsFetch,pageFetch')
  t('первый запрос разрешён', budget.charge('pageFetch', 'a.jp').granted, true)
  t('второй домен — свой счёт', budget.charge('pageFetch', 'b.jp').granted, true)
  t('третий упирается в общий потолок', budget.charge('pageFetch', 'c.jp').granted, false)
  t('  и исход назван', budget.charge('pageFetch', 'c.jp').reason, 'budgetExhausted')
  t('  бюджет считает себя исчерпанным', `${budget.exhausted}/${budget.exhaustedBy}`, 'true/pageFetch')
  const perDomain = openEnrichmentBudget({ objects: 9, robotsFetches: 9, pageFetches: 9, perDomainFetches: 2 })
  perDomain.charge('pageFetch', 'a.jp')
  perDomain.charge('pageFetch', 'a.jp')
  t('потолок на домен отдельный', perDomain.charge('pageFetch', 'a.jp').reason, 'domainBudgetExhausted')
  t('  и он не исчерпывает общий', perDomain.exhausted, false)
  t('  сосед не наказан', perDomain.charge('pageFetch', 'b.jp').granted, true)
  const report = perDomain.report()
  t('отчёт бюджета: потрачено и осталось', `${report.spent.pageFetch}/${report.remaining.pageFetch}`, '3/6')
  t('  доменов затронуто', report.domainsTouched, 2)
  has('неизвестный род расхода — отказ', boom(() => perDomain.charge('rocket')), 'неизвестный род расхода')
  has('pageFetch без домена при потолке на домен — отказ', boom(() => perDomain.charge('pageFetch')), 'потолок на домен не проверить')
  const zero = openEnrichmentBudget({ objects: 0, robotsFetches: 0, pageFetches: 0 })
  t('нулевой бюджет не пускает ни одного запроса', zero.charge('pageFetch').granted, false)
}

/* ── 6. Со страницы берутся только структурные факты ────────────────────── */
const block = (value) => `<script type="application/ld+json">${JSON.stringify(value)}</` + `script>`
{
  const ld = {
    '@context': 'https://schema.org', '@type': 'Museum',
    name: '大原美術館', alternateName: 'オオハラビジュツカン', url: 'https://www.ohara.or.jp/',
    address: { '@type': 'PostalAddress', postalCode: '710-0046', addressRegion: '岡山県', addressLocality: '倉敷市', streetAddress: '中央1-1-15' },
    geo: { '@type': 'GeoCoordinates', latitude: 34.5951, longitude: 133.7723 },
    description: 'Проза, которую мы не берём', telephone: '086-422-0005', openingHours: 'Mo-Su 09:00-17:00',
  }
  const html = `<html><head>${block(ld)}</head><body><p>Абзац страницы</p></body></html>`
  const r = collectPlaceFacts({ html, url: 'https://www.ohara.or.jp/', observedAt: AT })
  const byField = Object.fromEntries(r.facts.map((f) => [f.field, f.value]))
  t('извлечено ровно семь полей закрытого списка', r.facts.map((f) => f.field).join(','), 'address,lat,lon,nameJa,nameKana,officialUrl,postalCode')
  t('  адрес склеен в японском порядке', byField.address, '岡山県倉敷市中央1-1-15')
  t('  индекс нормализован', byField.postalCode, '710-0046')
  t('  японское имя и чтение разделены', `${byField.nameJa}/${byField.nameKana}`, '大原美術館/オオハラビジュツカン')
  t('  координаты парой', `${byField.lat},${byField.lon}`, '34.5951,133.7723')
  t('описание НЕ извлечено', 'description' in byField, false)
  t('телефон НЕ извлечён', JSON.stringify(r.facts).includes('086-422-0005'), false)
  t('часы работы НЕ извлечены', JSON.stringify(r.facts).includes('09:00-17:00'), false)
  t('проза страницы НЕ извлечена', JSON.stringify(r.facts).includes('Абзац'), false)
  t('каждый факт — наблюдение, а не поле', r.facts.every((f) => f.confidence === 'unverified' && f.verifiedAt === null), true)
  t('  и каждый несёт адрес, момент чтения и локатор', r.facts.every((f) => f.sourceUrl === 'https://www.ohara.or.jp/' && f.observedAt === AT && typeof f.locator === 'string' && f.locator), true)
  t('пропусков нет', r.omissions.length, 0)
}

/* ── 7. Отказы разбора названы ──────────────────────────────────────────── */
{
  const far = collectPlaceFacts({ html: block({ '@type': 'Place', name: '寺', geo: { latitude: 48.85, longitude: 2.35 } }), url: 'https://x.jp/', observedAt: AT })
  t('координаты вне Японии отвергнуты', far.omissions[0].code, 'valueOutOfRange')
  t('  и координат среди фактов нет', far.facts.some((f) => f.field === 'lat' || f.field === 'lon'), false)
  t('  а имя всё равно взято', far.facts.map((f) => f.field).join(','), 'nameJa')
  const org = collectPlaceFacts({ html: block({ '@type': 'Organization', name: '株式会社', address: { streetAddress: '東京' } }), url: 'https://y.jp/', observedAt: AT })
  t('организация местом не считается', org.facts.length, 0)
  t('  и это названо', org.omissions[0].code, 'noPlaceNode')
  t('типы места закрыты и Organization в них нет', PLACE_TYPES.includes('Organization'), false)
  t('тип с префиксом schema.org распознаётся', isPlaceNode({ '@type': 'https://schema.org/Museum' }), true)
  t('тип списком распознаётся', isPlaceNode({ '@type': ['Thing', 'Park'] }), true)
  const broken = collectPlaceFacts({ html: '<script type="application/ld+json">{не json}</' + 'script>', url: 'https://z.jp/', observedAt: AT })
  t('нечитаемый блок назван', broken.omissions.map((o) => o.code).join(','), 'blockNotJson,noPlaceNode')
  const latin = collectPlaceFacts({ html: block({ '@type': 'Place', name: 'Ohara Museum', address: { streetAddress: '1-1-15 Chuo' } }), url: 'https://w.jp/', observedAt: AT })
  t('неяпонские имя и адрес не берутся — источник японских полей должен быть японским', latin.facts.length, 0)
  const bad = collectPlaceFacts({ html: block({ '@type': 'Place', address: { postalCode: '7100046789' } }), url: 'https://v.jp/', observedAt: AT })
  t('индекс не той формы отвергнут', bad.omissions.some((o) => o.code === 'valueRejected' && o.locator === 'jsonld:PostalAddress.postalCode'), true)
  const longName = collectPlaceFacts({ html: block({ '@type': 'Place', name: '館'.repeat(400) }), url: 'https://u.jp/', observedAt: AT })
  t('слишком длинное значение отвергнуто, а не обрезано', longName.omissions.some((o) => o.code === 'valueTooLong'), true)
  t('  и среди фактов его нет', longName.facts.length, 0)
  t('все коды пропусков — из закрытого списка', [far, org, broken, bad, longName].every((r) => r.omissions.every((o) => OMISSION_CODES.includes(o.code))), true)
}

/* ── 8. Враждебная страница упирается в потолки ─────────────────────────── */
{
  const many = Array.from({ length: PARSE_LIMITS.maxBlocks + 5 }, () => block({ '@type': 'Place', name: '寺' })).join('')
  const r = collectPlaceFacts({ html: many, url: 'https://h.jp/', observedAt: AT })
  t('блоков разобрано не больше потолка', r.blocks, PARSE_LIMITS.maxBlocks)
  t('  и упор назван', r.omissions.some((o) => o.code === 'blockLimitReached'), true)
  let deep = { '@type': 'Place', name: '寺' }
  for (let i = 0; i < PARSE_LIMITS.maxDepth + 4; i += 1) deep = { nested: deep }
  const deepResult = collectPlaceFacts({ html: block(deep), url: 'https://d.jp/', observedAt: AT })
  t('глубина ограничена и названа', deepResult.omissions.some((o) => o.code === 'depthLimitReached'), true)
  const huge = 'x'.repeat(PARSE_LIMITS.maxHtmlBytes + 1)
  t('слишком большая страница не разбирается', extractJsonLdBlocks(huge).omissions[0].code, 'htmlTooLarge')
  const wide = { '@type': 'Place', name: '寺', list: Array.from({ length: PARSE_LIMITS.maxNodes + 50 }, (_, i) => ({ n: i })) }
  const wideResult = collectPlaceFacts({ html: block(wide), url: 'https://n.jp/', observedAt: AT })
  t('число узлов ограничено и названо', wideResult.omissions.some((o) => o.code === 'nodeLimitReached'), true)
  t('границы Японии объявлены, а не вшиты в условие', `${JAPAN_BBOX.minLat}..${JAPAN_BBOX.maxLat}`, '20.2..45.8')
  t('версия разбора названа', collectPlaceFacts({ html: '', url: 'https://e.jp/', observedAt: AT }).spec, OFFICIAL_FACTS_SPEC)
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ JA-3 реестр источников, бюджет и структурные факты: ${ok} проверок пройдено`)
}
