#!/usr/bin/env node
/**
 * Первый прогон: профилирование источников и расстановка весов.
 *
 *   node scripts/poi-portals/profile-sources.mjs --out tmp/sources-t1.json
 *   node scripts/poi-portals/profile-sources.mjs --previous tmp/sources-t1.json --out tmp/sources-t2.json
 *
 * Что делает:
 *   1. Проверяет robots.txt каждого источника ЖИВЬЁМ и отказывается ходить
 *      туда, где нас не ждут (в том числе где поимённо закрыт ClaudeBot).
 *   2. Берёт выборку страниц и вытаскивает заявленную свежесть.
 *   3. Снимает отпечаток содержания каждой страницы.
 *   4. При наличии предыдущего снимка — измеряет реальный дрейф содержания
 *      и по нему считает фактический возраст фактов.
 *   5. Считает вес источника ОТДЕЛЬНО для стабильных и волатильных полей.
 *   6. Печатает ранжирование.
 *
 * Читает только публичные страницы, строго последовательно, с паузой
 * между запросами. Это не вежливость, а снижение риска: см. комментарий
 * про дело Librahack в lib/freshness.mjs.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { ALL_SOURCES, activePortals } from './registry.mjs'
import {
  POLITE_DELAY_MS, USER_AGENT, sleep, parseRobots, isDisallowed,
  extractDeclaredFreshness, contentFingerprint, measureDrift, effectiveAgeDays,
} from './lib/freshness.mjs'
import { sourceWeight, freshnessMultiplier } from './lib/weights.mjs'

function parseArgs(argv) {
  const args = { out: null, previous: null, samples: 5, only: null, timeoutMs: 30000 }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => argv[(i += 1)]
    if (a === '--out') args.out = next()
    else if (a === '--previous') args.previous = next()
    else if (a === '--samples') args.samples = Number(next())
    else if (a === '--only') args.only = next()
    else if (a === '--timeout') args.timeoutMs = Number(next())
    else throw new Error(`Неизвестный аргумент: ${a}`)
  }
  return args
}

async function get(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*' },
      redirect: 'follow',
      signal: controller.signal,
    })
    const buffer = await res.arrayBuffer()
    const ct = res.headers.get('content-type') ?? ''
    const enc = /shift.?jis|windows-31j/i.test(ct) ? 'shift_jis' : 'utf-8'
    const headers = {}
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
    return {
      ok: res.ok,
      status: res.status,
      headers,
      body: new TextDecoder(enc, { fatal: false }).decode(new Uint8Array(buffer)),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Отсев непригодных для замера свежести URL.
 *
 * Обе проблемы найдены на первом реальном прогоне, а не придуманы:
 *   JTB     linkPattern '/leisure/' поймал /leisure/wroot/css/base.css, и
 *           возраст источника посчитался по дате CSS-файла — 573 дня.
 *           Это возраст вёрстки, а не контента.
 *   Kyushu  в выборку попали /terms-and-conditions/ (пустая страница, 59
 *           символов) и /privacy-policy/. У них свежий lastmod, потому что
 *           CMS трогает их при любой перекатке — свежесть завышалась.
 *
 * Свежесть замеряется по СОДЕРЖАТЕЛЬНЫМ страницам. Всё остальное — шум.
 */
const ASSET_EXT = /\.(css|js|mjs|json|xml|txt|ico|png|jpe?g|gif|svg|webp|avif|pdf|zip|woff2?|ttf|eot|mp4|webm)(\?|$)/i
const BOILERPLATE = /\/(privacy|terms|terms-and-conditions|legal|legal-stuff|cookie|sitemap|contact|login|signin|signup|search|tag|category|author|feed|rss|policies)\b/i
/** Ниже этого объёма текста страница не считается содержательной. */
const MIN_CONTENT_CHARS = 1500

function isSampleable(url) {
  try {
    const { pathname } = new URL(url)
    if (ASSET_EXT.test(pathname)) return { ok: false, reason: 'ассет, не страница' }
    if (BOILERPLATE.test(pathname)) return { ok: false, reason: 'служебная страница' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'неразбираемый URL' }
  }
}

/** Находит страницы для выборки: sitemap, иначе ссылки со входной страницы. */
async function discoverSampleUrls(portal, args) {
  const origin = `https://${portal.host}`
  const urls = []

  if (portal.discovery?.sitemap) {
    try {
      const res = await get(portal.discovery.sitemap, args.timeoutMs)
      const locs = [...res.body.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim())
      const lastmods = [...res.body.matchAll(/<lastmod>(.*?)<\/lastmod>/g)].map((m) => m[1].trim())
      let pool = locs.map((u, i) => ({ url: u, sitemapLastmod: lastmods[i] ?? null }))
      if (res.body.includes('<sitemapindex') && locs.length) {
        // В индексе первая подкарта часто служебная (sitemap-misc) — берём
        // ту, что похожа на контентную.
        const contentMap = locs.find((u) => /post|page|spot|article|content/i.test(u)) ?? locs[0]
        await sleep(POLITE_DELAY_MS)
        const sub = await get(contentMap, args.timeoutMs)
        const subLocs = [...sub.body.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim())
        const subMods = [...sub.body.matchAll(/<lastmod>(.*?)<\/lastmod>/g)].map((m) => m[1].trim())
        pool = subLocs.map((u, i) => ({ url: u, sitemapLastmod: subMods[i] ?? null }))
      }
      for (const item of pool) {
        if (urls.length >= args.samples) break
        if (!isSampleable(item.url).ok) continue
        urls.push(item)
      }
      if (urls.length) return urls
    } catch {
      /* нет sitemap — идём по ссылкам */
    }
  }

  const entry = portal.discovery?.entry ?? portal.url
  const res = await get(entry, args.timeoutMs)
  const pattern = portal.discovery?.linkPattern ? new RegExp(portal.discovery.linkPattern) : null
  const seen = new Set()
  for (const m of res.body.matchAll(/href="([^"#?]+)"/g)) {
    let href = m[1]
    if (href.startsWith('http')) {
      if (!href.includes(portal.host)) continue
      href = new URL(href).pathname
    } else if (!href.startsWith('/')) continue
    if (pattern && !pattern.test(href)) continue
    if (seen.has(href)) continue
    if (!isSampleable(origin + href).ok) continue
    seen.add(href)
    urls.push({ url: origin + href, sitemapLastmod: null })
    if (urls.length >= args.samples) break
  }
  return urls
}

async function profileSource(portal, previousSnapshot, args) {
  const base = { id: portal.id, label: portal.label, role: portal.role, kind: portal.kind, authority: portal.authority }

  if (portal.adapter === 'opendata-csv') {
    // Открытые данные сообщают дату в метаданных — обходить нечего.
    const declaredIso = portal.freshness?.declaredDate ? `${portal.freshness.declaredDate}T00:00:00Z` : null
    const ageDays = declaredIso
      ? Math.round((Date.now() - new Date(declaredIso).getTime()) / 86400000)
      : null
    return { ...base, method: 'metadata', declared: { available: Boolean(declaredIso), iso: declaredIso, ageDays }, samples: [] }
  }

  if (portal.enabled === false) {
    return { ...base, skipped: `исключён: ${portal.blockedReason}` }
  }

  // Живая проверка robots — реестр может устареть, источник главнее.
  let robots
  try {
    const res = await get(`https://${portal.host}/robots.txt`, args.timeoutMs)
    robots = parseRobots(res.body)
  } catch {
    robots = { present: false, disallow: [], aiBlocked: [], sitemaps: [] }
  }
  await sleep(POLITE_DELAY_MS)

  if (robots.aiBlocked.length) {
    return {
      ...base,
      skipped: `robots.txt поимённо блокирует: ${robots.aiBlocked.join(', ')}`,
      robotsLive: robots,
    }
  }

  let candidates = []
  try {
    candidates = await discoverSampleUrls(portal, args)
  } catch (error) {
    return { ...base, error: `обнаружение страниц: ${error.message}`, robotsLive: robots }
  }

  const samples = []
  for (const candidate of candidates) {
    const pathname = new URL(candidate.url).pathname
    if (isDisallowed(pathname, robots.disallow)) {
      samples.push({ url: candidate.url, skipped: 'закрыт robots.txt' })
      continue
    }
    await sleep(POLITE_DELAY_MS)
    try {
      const res = await get(candidate.url, args.timeoutMs)
      if (!res.ok) { samples.push({ url: candidate.url, status: res.status }); continue }
      const declared = extractDeclaredFreshness(res.body, res.headers)
      const fp = contentFingerprint(res.body)
      // Пустая или почти пустая страница не может свидетельствовать о
      // свежести источника, даже если её lastmod сегодняшний.
      const thin = fp.textLength < MIN_CONTENT_CHARS
      samples.push({
        url: candidate.url,
        status: res.status,
        hash: fp.hash,
        textLength: fp.textLength,
        thin,
        sitemapLastmod: candidate.sitemapLastmod,
        declaredSignal: declared.signal,
        declaredIso: declared.iso,
        declaredAgeDays: declared.ageDays,
      })
    } catch (error) {
      samples.push({ url: candidate.url, error: error.message })
    }
  }

  // Заявленная свежесть источника — медиана по выборке, чтобы одна свежая
  // страница не выдавала весь портал за актуальный.
  const substantive = samples.filter((s) => s.hash && !s.thin)
  const ages = substantive
    .map((s) => s.declaredAgeDays ?? (s.sitemapLastmod
      ? Math.round((Date.now() - new Date(s.sitemapLastmod).getTime()) / 86400000)
      : null))
    .filter((a) => Number.isFinite(a))
    .sort((a, b) => a - b)
  const declared = ages.length
    ? {
        available: true,
        ageDays: ages[Math.floor(ages.length / 2)],
        basedOn: ages.length,
        substantivePages: substantive.length,
        signal: substantive.find((s) => s.declaredSignal)?.declaredSignal ?? 'sitemap:lastmod',
      }
    : { available: false, ageDays: null, signal: null, substantivePages: substantive.length }

  const prevForSource = previousSnapshot?.sources?.find((s) => s.id === portal.id)
  const measured = measureDrift(
    prevForSource ? { samples: prevForSource.samples, capturedAt: previousSnapshot.capturedAt } : null,
    substantive,
  )

  return { ...base, method: 'crawl', robotsLive: robots, declared, measured, samples }
}

function rank(sources) {
  return sources
    .filter((s) => !s.skipped && !s.error)
    .map((s) => {
      const eff = effectiveAgeDays({ declared: s.declared, measured: s.measured })
      const stable = sourceWeight({ authority: s.authority, ageDays: eff.ageDays, fieldClass: 'stable' })
      const volatile = sourceWeight({ authority: s.authority, ageDays: eff.ageDays, fieldClass: 'volatile' })
      return {
        id: s.id, label: s.label, role: s.role, kind: s.kind,
        authority: s.authority,
        ageDays: eff.ageDays, freshnessBasis: eff.basis,
        freshnessMultiplier: freshnessMultiplier(eff.ageDays),
        weightStable: stable, weightVolatile: volatile,
      }
    })
    .sort((a, b) => b.weightVolatile - a.weightVolatile)
}

async function main() {
  const args = parseArgs(process.argv)
  const previous = args.previous ? JSON.parse(await readFile(args.previous, 'utf8')) : null

  const pool = args.only
    ? ALL_SOURCES.filter((p) => p.id === args.only)
    : [...activePortals(), ...ALL_SOURCES.filter((p) => p.enabled === false)]

  const snapshot = { capturedAt: new Date().toISOString(), userAgent: USER_AGENT, sources: [] }

  for (const portal of pool) {
    process.stderr.write(`[profile] ${portal.id}…\n`)
    try {
      snapshot.sources.push(await profileSource(portal, previous, args))
    } catch (error) {
      snapshot.sources.push({ id: portal.id, label: portal.label, error: error.message })
    }
  }

  snapshot.ranking = rank(snapshot.sources)

  if (args.out) {
    await mkdir(path.dirname(args.out), { recursive: true })
    await writeFile(args.out, JSON.stringify(snapshot, null, 2), 'utf8')
  }

  // ── Печать ──────────────────────────────────────────────────────────
  const line = '─'.repeat(112)
  console.log(`\nПРОФИЛЬ ИСТОЧНИКОВ  ${snapshot.capturedAt.slice(0, 19)}Z`)
  console.log(previous ? `Сравнение со снимком ${previous.capturedAt.slice(0, 19)}Z\n` : 'Первый прогон: измеренной свежести пока нет, работает заявленная\n')
  console.log(line)
  console.log(
    'ИСТОЧНИК'.padEnd(26) + 'РОЛЬ'.padEnd(11) + 'АВТОР'.padEnd(7) +
    'ВОЗРАСТ'.padEnd(10) + 'ОСНОВА'.padEnd(22) + 'ВЕС:СТАБ'.padEnd(10) + 'ВЕС:ВОЛАТ',
  )
  console.log(line)
  for (const r of snapshot.ranking) {
    console.log(
      r.id.padEnd(26) +
      r.role.padEnd(11) +
      String(r.authority).padEnd(7) +
      (r.ageDays === null ? '—' : `${r.ageDays}д`).padEnd(10) +
      r.freshnessBasis.slice(0, 21).padEnd(22) +
      String(r.weightStable).padEnd(10) +
      String(r.weightVolatile),
    )
  }
  console.log(line)

  const skipped = snapshot.sources.filter((s) => s.skipped || s.error)
  if (skipped.length) {
    console.log('\nНЕ ПРОГНАНЫ:')
    for (const s of skipped) console.log(`  ${s.id.padEnd(26)} ${s.skipped ?? s.error}`)
  }

  console.log('\nЧТЕНИЕ ТАБЛИЦЫ:')
  console.log('  ВЕС:СТАБ   имя, координаты, категория, история — доминирует авторитет')
  console.log('  ВЕС:ВОЛАТ  часы, цена, статус, доступ — доминирует свежесть')
  console.log('  Возраст «—» = свежесть неизвестна, множитель 0,15 (штраф за молчание)')
}

main().catch((error) => {
  console.error(`[profile] ${error.message}`)
  process.exitCode = 1
})
