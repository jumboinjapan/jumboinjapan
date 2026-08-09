#!/usr/bin/env node
/**
 * Анализ пробелов: чего в базе POI не хватает.
 *
 *   node scripts/poi-portals/gap-analysis.mjs --base tmp/poi-base.json --city kamakura
 *   node scripts/poi-portals/gap-analysis.mjs --base tmp/poi-base.json --all --out tmp/gaps.json
 *
 * Как работает. Берёт список объектов вокруг центра города из Wikidata
 * (CC0 — единственная крупная база, где лицензия не создаёт вообще никаких
 * обязательств), сводит его с текущей базой по названию и выдаёт то, чего
 * у нас нет.
 *
 * Почему именно Wikidata как эталон полноты:
 *   — CC0, можно хранить и использовать коммерчески без атрибуции
 *   — есть координаты и японские названия у ~100% записей
 *   — есть привязка к 国宝 / 重要文化財, то есть видно значимость объекта
 *   — стабильный QID как якорь: к нему потом цепляются все прочие источники
 * Чего в ней нет: русских названий (0,6%), часов работы (393 записи на всю
 * Японию), описаний. Поэтому она годится ровно на одно — ответить на вопрос
 * «что существует и чего у нас нет». Наполнение содержанием — следующий шаг.
 *
 * Ничего никуда не пишет. На выходе список кандидатов для ручного решения.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { nameSimilarity, containmentRelation, haversineMeters } from './lib/dedupe.mjs'

const SPARQL = 'https://query.wikidata.org/sparql'
const UA = 'JumboInJapanPOI/1.0 (+https://jumboinjapan.com; hello@jumboinjapan.com)'

/**
 * Классы Wikidata, которые для нас — точки маршрута.
 * Сознательно НЕ включены: отели, рестораны, магазины, станции, больницы.
 * Их в базе POI быть не должно (см. lib/scoring.mjs).
 */
const TOURIST_CLASSES = [
  'wd:Q5393308',  // буддийский храм
  'wd:Q845945',   // синтоистское святилище
  'wd:Q23413',    // замок
  'wd:Q33506',    // музей
  'wd:Q207694',   // художественный музей
  'wd:Q22698',    // парк
  'wd:Q15835',    // японский сад
  'wd:Q152081',   // онсэн
  'wd:Q570116',   // туристическая достопримечательность
  'wd:Q2087181',  // историческое место
  'wd:Q1107656',  // сад
  'wd:Q839954',   // археологический памятник
  'wd:Q4989906',  // монумент
  'wd:Q1440300',  // смотровая
]

/**
 * Центры городов и радиус охвата. Радиус подобран по смыслу города, а не
 * единым числом: Хаконэ — растянутая курортная зона, Камакура — компактна.
 */
export const CITY_CENTERS = {
  tokyo: { lat: 35.6812, lon: 139.7671, radiusKm: 12, label: 'Токио' },
  kamakura: { lat: 35.3192, lon: 139.5467, radiusKm: 6, label: 'Камакура' },
  enoshima: { lat: 35.2996, lon: 139.4805, radiusKm: 3, label: 'Эносима' },
  hakone: { lat: 35.2324, lon: 139.1069, radiusKm: 10, label: 'Хаконэ' },
  fuji: { lat: 35.4877, lon: 138.7593, radiusKm: 18, label: 'Фудзи и Кавагутико' },
  kyoto: { lat: 35.0116, lon: 135.7681, radiusKm: 10, label: 'Киото' },
  uji: { lat: 34.8844, lon: 135.7997, radiusKm: 5, label: 'Удзи' },
  nara: { lat: 34.6851, lon: 135.8048, radiusKm: 7, label: 'Нара' },
  osaka: { lat: 34.6937, lon: 135.5023, radiusKm: 10, label: 'Осака' },
  nikko: { lat: 36.758, lon: 139.5986, radiusKm: 14, label: 'Никко' },
  kanazawa: { lat: 36.5613, lon: 136.6562, radiusKm: 7, label: 'Канадзава' },
  himeji: { lat: 34.8394, lon: 134.6939, radiusKm: 6, label: 'Химэдзи' },
  koyasan: { lat: 34.2131, lon: 135.5847, radiusKm: 5, label: 'Коясан' },
}

/**
 * Слаги базы, которые на самом деле один город. Найдено на живой базе:
 * Фудзи разъехался на три слага, и getPoisByCity('fuji') молча
 * не видит пять записей.
 */
export const CITY_SLUG_ALIASES = {
  fuji: ['fuji', 'mt-fuji', 'fujikawaguchiko', 'kawaguchiko'],
  kyoto: ['kyoto'],
  nikko: ['nikko', 'okunikko'],
}

function resolveSlugs(city) {
  return CITY_SLUG_ALIASES[city] ?? [city]
}

async function fetchWikidataAround({ lat, lon, radiusKm }) {
  const query = `SELECT ?item ?nameJa ?nameEn ?lat ?lon ?heritage WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
  }
  ?item wdt:P31 ?type .
  VALUES ?type { ${TOURIST_CLASSES.join(' ')} }
  OPTIONAL { ?item rdfs:label ?nameJa FILTER(lang(?nameJa)="ja") }
  OPTIONAL { ?item rdfs:label ?nameEn FILTER(lang(?nameEn)="en") }
  OPTIONAL { ?item wdt:P1435 ?heritage }
  BIND(geof:latitude(?coord) AS ?lat)
  BIND(geof:longitude(?coord) AS ?lon)
}`

  const res = await fetch(`${SPARQL}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA },
  })
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`)
  const body = await res.json()

  const byQid = new Map()
  for (const row of body.results.bindings) {
    const qid = row.item.value.split('/').pop()
    const existing = byQid.get(qid) ?? {
      qid,
      nameJa: row.nameJa?.value ?? null,
      nameEn: row.nameEn?.value ?? null,
      lat: Number(row.lat?.value),
      lon: Number(row.lon?.value),
      heritage: new Set(),
    }
    if (row.heritage) existing.heritage.add(row.heritage.value.split('/').pop())
    byQid.set(qid, existing)
  }
  return [...byQid.values()].map((c) => ({ ...c, heritage: [...c.heritage] }))
}

/** Q1139795 = 国宝 (национальное сокровище), Q1188622 = 重要文化財. */
const HERITAGE_RANK = { Q1139795: 3, Q1188622: 2 }

function significance(candidate) {
  let score = 0
  for (const h of candidate.heritage) score = Math.max(score, HERITAGE_RANK[h] ?? 0)
  // Наличие английской метки — косвенный признак известности за пределами
  // Японии, то есть релевантности для иностранного гостя.
  if (candidate.nameEn) score += 1
  return score
}

function matchAgainstBase(candidate, baseRows) {
  let best = null
  for (const row of baseRows) {
    const score = Math.max(
      nameSimilarity(candidate.nameEn, row.nameEn),
      nameSimilarity(candidate.nameEn, row.nameRu),
      nameSimilarity(candidate.nameJa, row.nameEn),
    )
    const relation = containmentRelation(candidate.nameEn, row.nameEn)
    if (!best || score > best.score) best = { score, row, relation }
  }
  return best
}

async function analyseCity(city, baseRows, { minSignificance = 0 } = {}) {
  const center = CITY_CENTERS[city]
  if (!center) throw new Error(`Нет координат центра для «${city}». Добавь в CITY_CENTERS.`)

  const slugs = resolveSlugs(city)
  const inCity = baseRows.filter((r) => slugs.includes(r.siteCity))
  const candidates = await fetchWikidataAround(center)

  const gaps = []
  const matched = []
  for (const candidate of candidates) {
    if (!candidate.nameEn && !candidate.nameJa) continue
    const sig = significance(candidate)
    if (sig < minSignificance) continue
    // Сверяем со ВСЕЙ базой, а не только с этим городом: объект может
    // быть заведён с другим слагом — ровно так Фудзи и раздвоился.
    const hit = matchAgainstBase(candidate, baseRows)
    if (hit && hit.score >= 0.72) {
      matched.push({ ...candidate, matchedPoiId: hit.row.poiId, matchedCity: hit.row.siteCity, score: hit.score })
    } else {
      gaps.push({ ...candidate, significance: sig, nearestInBase: hit?.row?.nameRu ?? null, nearestScore: hit?.score ?? 0 })
    }
  }

  gaps.sort((a, b) => b.significance - a.significance)

  return {
    city,
    label: center.label,
    slugsUsed: slugs,
    inBase: inCity.length,
    wikidataCandidates: candidates.length,
    alreadyCovered: matched.length,
    gaps: gaps.length,
    // Объекты в базе, которых Wikidata не знает — это НЕ ошибка. Часто это
    // как раз то, что отличает вашу базу от справочника: локальные точки,
    // видовые остановки, конкретные рёканы.
    uniqueToBase: inCity.length - matched.filter((m) => slugs.includes(m.matchedCity)).length,
    gapList: gaps,
    matchedList: matched,
  }
}

function parseArgs(argv) {
  const args = { base: 'tmp/poi-base.json', city: null, all: false, out: null, minSig: 1, show: 25 }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => argv[(i += 1)]
    if (a === '--base') args.base = next()
    else if (a === '--city') args.city = next()
    else if (a === '--all') args.all = true
    else if (a === '--out') args.out = next()
    else if (a === '--min-significance') args.minSig = Number(next())
    else if (a === '--show') args.show = Number(next())
    else throw new Error(`Неизвестный аргумент: ${a}`)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv)
  const baseRows = JSON.parse(await readFile(args.base, 'utf8'))
    // Служебные записи (трансферы, заселение, свободное время) — не места.
    .filter((r) => !r.isSystem && r.siteCity)

  const cities = args.all ? Object.keys(CITY_CENTERS) : [args.city ?? 'kamakura']
  const report = { generatedAt: new Date().toISOString(), baseSize: baseRows.length, cities: [] }

  for (const city of cities) {
    process.stderr.write(`[gap] ${city}…\n`)
    try {
      report.cities.push(await analyseCity(city, baseRows, { minSignificance: args.minSig }))
      await new Promise((r) => setTimeout(r, 1500))
    } catch (error) {
      report.cities.push({ city, error: error.message })
    }
  }

  if (args.out) {
    await mkdir(path.dirname(args.out), { recursive: true })
    await writeFile(args.out, JSON.stringify(report, null, 2), 'utf8')
  }

  const line = '─'.repeat(88)
  console.log(`\nАНАЛИЗ ПРОБЕЛОВ   база: ${report.baseSize} POI (без служебных)\n`)
  console.log(line)
  console.log('ГОРОД'.padEnd(22) + 'В БАЗЕ'.padEnd(9) + 'WIKIDATA'.padEnd(11) + 'ЕСТЬ'.padEnd(8) + 'НЕТ У НАС')
  console.log(line)
  let totalGaps = 0
  for (const c of report.cities) {
    if (c.error) { console.log(`${c.city.padEnd(22)}ОШИБКА: ${c.error}`); continue }
    totalGaps += c.gaps
    console.log(
      c.label.padEnd(22) + String(c.inBase).padEnd(9) + String(c.wikidataCandidates).padEnd(11) +
      String(c.alreadyCovered).padEnd(8) + String(c.gaps),
    )
  }
  console.log(line)
  console.log(`ИТОГО НЕ ХВАТАЕТ: ${totalGaps}\n`)

  for (const c of report.cities) {
    if (c.error || !c.gapList?.length) continue
    console.log(`\n── ${c.label}: ${c.gaps} объектов, которых нет в базе`)
    for (const g of c.gapList.slice(0, args.show)) {
      const mark = g.significance >= 3 ? '★★' : g.significance >= 2 ? '★ ' : '  '
      console.log(`  ${mark} ${(g.nameEn ?? g.nameJa ?? '').slice(0, 44).padEnd(46)}${(g.nameJa ?? '').slice(0, 22)}`)
    }
    if (c.gapList.length > args.show) console.log(`     … ещё ${c.gapList.length - args.show}`)
  }
  console.log('\n★★ — национальное сокровище (国宝) · ★ — важная культурная ценность (重要文化財)')
}

main().catch((error) => {
  console.error(`[gap] ${error.message}`)
  process.exitCode = 1
})
