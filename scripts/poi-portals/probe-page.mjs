#!/usr/bin/env node
/**
 * Разведчик страницы: что из неё вообще можно извлечь.
 *
 *   node scripts/poi-portals/probe-page.mjs https://naoshima.net/ja/art/
 *   node scripts/poi-portals/probe-page.mjs --portal naoshima-tourism
 *   node scripts/poi-portals/probe-page.mjs <url> --json > tmp/probe.json
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ШАГ ПЕРЕД АДАПТЕРОМ.
 *
 * Парсер, написанный по догадке о вёрстке, ломается на первом прогоне —
 * и ломается молча: селектор не находит ничего, запись выходит пустой,
 * отчёт показывает ноль объектов, и непонятно, сайт изменился или селектор
 * был неверен с самого начала. Разведчик отвечает на вопрос «за что тут
 * можно зацепиться» ДО того, как за это цепляются.
 *
 * Порядок предпочтения источников разметки, от надёжного к хрупкому:
 *
 *   1. JSON-LD (schema.org)  — данные, а не оформление; переживает редизайн
 *   2. Микроразметка itemprop — то же, но вплетено в вёрстку
 *   3. OpenGraph             — только имя, картинка, тип
 *   4. Вёрстка по классам    — ломается при любой правке шаблона
 *
 * Если разведка показала первое — адаптер выйдет короткий и общий для всех
 * порталов. Если только четвёртое — честнее сузить адаптер до конкретного
 * сайта и написать это в комментарии, а не притворяться, что он общий.
 */
import { load } from 'cheerio'

const UA = 'jumboinjapan-poi-collector/1.0 (+https://jumboinjapan.com; contact: info@jumboinjapan.com)'
const args = process.argv.slice(2)
const asJson = args.includes('--json')

async function get(url) {
  const started = Date.now()
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en' } })
  const buf = Buffer.from(await res.arrayBuffer())
  return {
    url,
    status: res.status,
    type: res.headers.get('content-type') ?? '',
    bytes: buf.length,
    ms: Date.now() - started,
    body: buf.toString('utf8'),
    buf,
  }
}

/** robots.txt: спрашиваем ДО того, как берём страницы. */
async function robots(origin) {
  try {
    const res = await get(new URL('/robots.txt', origin).href)
    if (res.status !== 200) return { present: false, note: `robots.txt → ${res.status}` }
    const lines = res.body.split('\n').map((l) => l.trim())
    const disallow = []
    let mine = false
    for (const line of lines) {
      const [rawKey, ...rest] = line.split(':')
      const key = rawKey.toLowerCase().trim()
      const value = rest.join(':').trim()
      if (key === 'user-agent') mine = value === '*'
      else if (mine && key === 'disallow' && value) disallow.push(value)
    }
    return { present: true, disallow, crawlDelay: /crawl-delay:\s*(\d+)/i.exec(res.body)?.[1] ?? null }
  } catch (error) {
    return { present: false, note: String(error.message) }
  }
}

function jsonLd($) {
  const blocks = []
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text()
    try {
      const parsed = JSON.parse(raw)
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        const graph = node['@graph'] ? node['@graph'] : [node]
        for (const item of graph) {
          blocks.push({
            type: item['@type'] ?? '(без @type)',
            keys: Object.keys(item).filter((k) => !k.startsWith('@')).slice(0, 16),
            hasGeo: Boolean(item.geo || item.latitude),
            hasAddress: Boolean(item.address),
            hasHours: Boolean(item.openingHours || item.openingHoursSpecification),
            name: typeof item.name === 'string' ? item.name.slice(0, 60) : undefined,
          })
        }
      }
    } catch {
      blocks.push({ type: '(не разобрался JSON)', raw: raw.slice(0, 120) })
    }
  })
  return blocks
}

function microdata($) {
  const types = new Set()
  $('[itemtype]').each((_, el) => types.add($(el).attr('itemtype')))
  const props = new Set()
  $('[itemprop]').each((_, el) => props.add($(el).attr('itemprop')))
  return { types: [...types], props: [...props].slice(0, 24), count: $('[itemscope]').length }
}

/** Группировка ссылок по первому-второму сегменту пути — так виден шаблон карточек. */
function linkShapes($, base) {
  const groups = new Map()
  $('a[href]').each((_, el) => {
    let href = $(el).attr('href')
    try {
      const u = new URL(href, base)
      if (u.origin !== new URL(base).origin) return
      const parts = u.pathname.split('/').filter(Boolean)
      const shape = '/' + parts.slice(0, 2).join('/') + (parts.length > 2 ? '/…' : '/')
      const g = groups.get(shape) ?? { count: 0, sample: u.href }
      g.count += 1
      groups.set(shape, g)
    } catch {
      /* мусорная ссылка — не наша забота */
    }
  })
  return [...groups.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 14)
}

function coordinateHints(html) {
  const hits = []
  const push = (label, m) => m && hits.push(`${label}: ${m[0].slice(0, 80)}`)
  push('пара широта/долгота', /(?:lat|latitude)\D{0,12}(3[0-9]\.\d{3,})\D{1,24}(1[2-4][0-9]\.\d{3,})/i.exec(html))
  push('google maps iframe', /https:\/\/www\.google\.com\/maps\/embed[^"']{0,90}/i.exec(html))
  push('ссылка на карту', /https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[\w-]+/i.exec(html))
  push('координаты в @', /@3[0-9]\.\d{4,},1[2-4][0-9]\.\d{4,}/.exec(html))
  return hits
}

async function probe(url) {
  const page = await get(url)
  const $ = load(page.body)
  const og = {}
  $('meta[property^="og:"],meta[name^="twitter:"]').each((_, el) => {
    const k = $(el).attr('property') ?? $(el).attr('name')
    og[k] = ($(el).attr('content') ?? '').slice(0, 70)
  })
  return {
    url,
    status: page.status,
    contentType: page.type,
    bytes: page.bytes,
    ms: page.ms,
    lang: $('html').attr('lang') ?? null,
    title: $('title').first().text().trim().slice(0, 90),
    jsonLd: jsonLd($),
    microdata: microdata($),
    openGraph: og,
    headings: {
      h1: $('h1').map((_, el) => $(el).text().trim().slice(0, 60)).get().slice(0, 4),
      h2: $('h2').map((_, el) => $(el).text().trim().slice(0, 60)).get().slice(0, 10),
      h3: $('h3').map((_, el) => $(el).text().trim().slice(0, 60)).get().slice(0, 10),
    },
    links: linkShapes($, url),
    coords: coordinateHints(page.body),
  }
}

async function sitemapProbe(origin) {
  const out = []
  for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) {
    try {
      const res = await get(new URL(path, origin).href)
      const gzip = res.buf[0] === 0x1f && res.buf[1] === 0x8b
      out.push({
        path,
        status: res.status,
        type: res.type,
        bytes: res.bytes,
        gzip,
        looksXml: res.body.trimStart().startsWith('<'),
        urls: (res.body.match(/<loc>/g) ?? []).length,
        lastmod: (res.body.match(/<lastmod>/g) ?? []).length,
      })
    } catch (error) {
      out.push({ path, error: String(error.message).slice(0, 60) })
    }
  }
  return out
}

function print(r) {
  console.log(`\n${'='.repeat(72)}\n${r.url}\n${'='.repeat(72)}`)
  console.log(`  ответ: ${r.status} · ${r.contentType} · ${(r.bytes / 1024).toFixed(0)} КБ · ${r.ms} мс · lang=${r.lang}`)
  console.log(`  title: ${r.title}`)

  console.log(`\n  JSON-LD: ${r.jsonLd.length ? `${r.jsonLd.length} блоков` : 'НЕТ'}`)
  for (const b of r.jsonLd.slice(0, 8)) {
    const flags = [b.hasGeo && 'geo', b.hasAddress && 'адрес', b.hasHours && 'часы'].filter(Boolean)
    console.log(`     ${JSON.stringify(b.type)}${b.name ? ` «${b.name}»` : ''}${flags.length ? `  [${flags.join(', ')}]` : ''}`)
    if (b.keys?.length) console.log(`        поля: ${b.keys.join(', ')}`)
  }

  console.log(`\n  Микроразметка: ${r.microdata.count ? `${r.microdata.count} itemscope` : 'НЕТ'}`)
  if (r.microdata.types.length) console.log(`     типы: ${r.microdata.types.join(', ')}`)
  if (r.microdata.props.length) console.log(`     свойства: ${r.microdata.props.join(', ')}`)

  const ogKeys = Object.keys(r.openGraph)
  console.log(`\n  OpenGraph: ${ogKeys.length ? ogKeys.join(', ') : 'НЕТ'}`)

  console.log(`\n  Заголовки:`)
  console.log(`     h1: ${r.headings.h1.join(' | ') || '—'}`)
  console.log(`     h2: ${r.headings.h2.join(' | ') || '—'}`)

  console.log(`\n  Формы ссылок (кандидаты в карточки):`)
  for (const [shape, g] of r.links) console.log(`     ${String(g.count).padStart(4)}  ${shape}`)

  console.log(`\n  Координаты: ${r.coords.length ? '' : 'следов не видно'}`)
  for (const c of r.coords) console.log(`     ${c}`)
}

async function main() {
  const urls = []
  if (args[0] === '--portal') {
    const { getPortal } = await import('./registry.mjs')
    const portal = getPortal(args[1])
    urls.push(...(portal.discovery?.listings ?? [portal.url]))
    console.log(`\nРАЗВЕДКА ПОРТАЛА: ${portal.label}`)
    const rb = await robots(portal.url)
    console.log(`  robots.txt: ${rb.present ? `есть, запретов ${rb.disallow.length}${rb.crawlDelay ? `, crawl-delay ${rb.crawlDelay}` : ''}` : rb.note}`)
    if (rb.disallow?.length) console.log(`     ${rb.disallow.slice(0, 10).join(', ')}`)
    console.log(`\n  sitemap:`)
    for (const s of await sitemapProbe(portal.url)) {
      console.log(`     ${s.path}: ${s.error ?? `${s.status} · ${s.type} · ${(s.bytes / 1024).toFixed(0)} КБ · ${s.gzip ? 'GZIP' : s.looksXml ? 'xml' : 'НЕ XML'} · <loc> ${s.urls}, <lastmod> ${s.lastmod}`}`)
    }
  } else {
    urls.push(...args.filter((a) => a.startsWith('http')))
  }
  if (!urls.length) {
    console.error('Укажите URL или --portal <id>')
    process.exitCode = 2
    return
  }
  const results = []
  for (const url of urls) {
    const r = await probe(url)
    results.push(r)
    if (!asJson) print(r)
    await new Promise((res) => setTimeout(res, 800))
  }
  if (asJson) console.log(JSON.stringify(results, null, 1))
  else console.log('\nВЫВОД: чем выше в списке нашлась разметка, тем надёжнее выйдет адаптер.\n')
}

main().catch((error) => {
  console.error(`[probe-page] ${error.message}`)
  process.exitCode = 2
})
