#!/usr/bin/env node
/**
 * Засыпка координат в POI из Wikidata.
 *
 *   node scripts/backfill-coords.mjs --in tmp/poi-live.json --out tmp/coords.json
 *
 * ЗАЧЕМ ФИЛЬТРЫ, А НЕ ПРОСТО «НАШЛОСЬ».
 *
 * Пилот 6 августа: Wikidata отвечает на 85% имён, но наивная стратегия
 * «взял первое попадание» даёт 18% неверных точек. Причина не в Wikidata,
 * а в именах: «Botanical Garden», «Motomachi District» — это родовые
 * слова, совпадающие с чем угодно. Рамка Японии одна не спасает: в неё
 * попадает половина Тихого океана, а «Hasedera» есть и в Камакуре,
 * и в Наре.
 *
 * Кандидат принимается автоматически, только если проходит ВСЕ проверки:
 *
 *   1. ровно один QID остаётся после отбора (несколько — на руки);
 *   2. ядро имени кандидата совпадает с ядром нашего (родовые слова
 *      снимаются с обеих сторон, макроны и дефисы не считаются);
 *   3. точка внутри рамки Японии;
 *   4. в цепочке административного подчинения встречается наша префектура;
 *   5. точка не дальше 40 км от медианы своего города.
 *
 * Медиана города считается по самим кандидатам, а не по внешней таблице
 * центров: в городе обычно 5-15 точек, и промах одной не сдвигает медиану.
 * Считается в два прохода — вторая медиана берётся уже без выбросов,
 * иначе одна точка в Корее тянет центр на себя.
 *
 * ПОЧЕМУ ЦЕПОЧКА P131 ЧИТАЕТСЯ ПО ОДНОМУ ШАГУ, А НЕ ПУТЁМ P131*.
 * Замер: `?item wdt:P131* ?adm` на ДВУХ элементах — 27,8 с. Тот же обход
 * тремя отдельными запросами по одному шагу — 0,1 с на шестьдесят. Путь
 * с звёздочкой заставляет движок разворачивать транзитивное замыкание,
 * и на батче он просто не возвращается.
 *
 * Ничего не пишет. Только считает и раскладывает на две стопки.
 */

import { readFileSync, writeFileSync } from 'node:fs'

const SPARQL = 'https://query.wikidata.org/sparql'
const WBAPI = 'https://www.wikidata.org/w/api.php'
const UA = 'jumboinjapan-poi-coords/1.0 (https://jumboinjapan.com)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const JP = { latMin: 20.0, latMax: 45.9, lonMin: 122.8, lonMax: 154.0 }
// 25 км, а не 40. На 40 проходил «Дайканъяма» с координатами Хатиодзи —
// однофамилец в той же префектуре, в 36 км от центра Токио. Плата за
// строгость известна поимённо: пара верных дальних точек (Акан-Айну-Котан,
// Ёсино) уезжает на ручную проверку. Ложное принятие дороже ложного
// отказа: отказ читают глазами, принятие уходит в тур молча.
const CITY_RADIUS_KM = 25

async function ask(query) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(SPARQL, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ query }),
      })
      if ([429, 500, 502, 503, 504].includes(res.status)) {
        await sleep(3000 * (attempt + 1))
        continue
      }
      if (!res.ok) return null
      return await res.json()
    } catch {
      await sleep(2500)
    }
  }
  return null
}

const esc = (s) => String(s).replace(/[\\"]/g, '')
const qidOf = (u) => u.replace('http://www.wikidata.org/entity/', '')

// ── имена ────────────────────────────────────────────────────────────────

const GENERIC = new Set([
  'temple', 'shrine', 'museum', 'park', 'castle', 'garden', 'gardens', 'station',
  'hall', 'gate', 'bridge', 'lake', 'mount', 'mt', 'river', 'falls', 'waterfall',
  'cave', 'caves', 'district', 'street', 'market', 'tower', 'the', 'of', 'and',
  'ruins', 'onsen', 'hot', 'springs', 'observation', 'deck', 'area', 'centre',
  'center', 'memorial', 'national', 'quasi', 'art', 'ropeway', 'plateau', 'valley',
  'gorge', 'village', 'town', 'city', 'hills', 'hill', 'pond', 'bay', 'cape',
  'island', 'aquarium', 'zoo', 'shopping', 'sightseeing', 'boat', 'cruise',
  'forest', 'mountain', 'grove', 'beach', 'coast', 'port', 'harbour', 'canal',
  'pass', 'mausoleum', 'palace', 'residence', 'house', 'workshop', 'workshops',
  'distillery', 'brewery', 'hotel', 'exhibition', 'science', 'history',
  'historical', 'open', 'air', 'cable', 'car', 'terrace', 'plaza', 'square',
])

/** Убираем макроны и диакритику, чтобы «Tōdai-ji» и «Todaiji» были одним. */
function flat(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Ядро имени: без родовых слов, без пунктуации. */
function core(s) {
  const words = flat(s).split(/[^a-z0-9]+/).filter(Boolean)
  const kept = words.filter((w) => !GENERIC.has(w))
  return (kept.length ? kept : words).join('')
}

function variants(nameEn) {
  const raw = String(nameEn || '').trim()
  if (!raw) return []
  const list = [raw]
  const paren = raw.match(/^(.+?)\s*\((.+)\)\s*$/)
  if (paren) {
    list.push(paren[1].trim())
    list.push(paren[2].trim())
  }
  const comma = raw.match(/^(.+?),\s*[^,]+$/)
  if (comma) list.push(comma[1].trim())
  return [...new Set(list.filter(Boolean))]
}

// ── Wikidata ─────────────────────────────────────────────────────────────

/** Точное совпадение метки или альт-метки (en). Дёшево, батчами. */
async function exactLabels(names) {
  const found = new Map()
  for (let i = 0; i < names.length; i += 20) {
    const batch = names.slice(i, i + 20)
    const values = batch.map((n) => `"${esc(n)}"@en`).join(' ')
    const data = await ask(`SELECT ?n ?item ?coord ?en ?ja WHERE {
  VALUES ?n { ${values} }
  { ?item rdfs:label ?n } UNION { ?item skos:altLabel ?n }
  ?item wdt:P625 ?coord .
  OPTIONAL { ?item rdfs:label ?en FILTER(lang(?en)='en') }
  OPTIONAL { ?item rdfs:label ?ja FILTER(lang(?ja)='ja') }
} LIMIT 400`)
    for (const b of data?.results?.bindings ?? []) {
      const m = b.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/)
      if (!m) continue
      const arr = found.get(b.n.value) ?? []
      if (!arr.some((x) => x.qid === qidOf(b.item.value))) {
        arr.push({
          qid: qidOf(b.item.value),
          lon: Number(m[1]),
          lat: Number(m[2]),
          en: b.en?.value ?? null,
          ja: b.ja?.value ?? null,
          how: 'exact',
        })
      }
      found.set(b.n.value, arr)
    }
    process.stderr.write(`\r  точные метки: ${Math.min(i + 20, names.length)}/${names.length}   `)
    await sleep(500)
  }
  process.stderr.write('\n')
  return found
}

/**
 * Нечёткий поиск для тех, кого точная метка не нашла.
 *
 * Полнотекстовый (CirrusSearch), а НЕ wbsearchentities. Второй ищет
 * по началу метки, и родовое слово в хвосте его убивает: «Nanzenji Temple»,
 * «Aokigahara Forest», «Oirase Gorge» не находят ничего, хотя все три
 * есть в Wikidata. Полнотекстовый находит все три.
 */
async function searchEntities(name) {
  const url = `${WBAPI}?action=query&format=json&list=search&srlimit=8&srsearch=${encodeURIComponent(name)}`
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) { await sleep(1500); continue }
      const data = await res.json()
      return (data.query?.search ?? []).map((s) => s.title).filter((t) => /^Q\d+$/.test(t))
    } catch { await sleep(1500) }
  }
  return []
}

/** Координаты и метки для списка QID. */
async function itemsInfo(qids) {
  const info = new Map()
  for (let i = 0; i < qids.length; i += 40) {
    const batch = qids.slice(i, i + 40)
    const data = await ask(`SELECT ?item ?coord ?en ?ja WHERE {
  VALUES ?item { ${batch.map((q) => `wd:${q}`).join(' ')} }
  ?item wdt:P625 ?coord .
  OPTIONAL { ?item rdfs:label ?en FILTER(lang(?en)='en') }
  OPTIONAL { ?item rdfs:label ?ja FILTER(lang(?ja)='ja') }
} LIMIT 300`)
    for (const b of data?.results?.bindings ?? []) {
      const m = b.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/)
      if (!m) continue
      info.set(qidOf(b.item.value), {
        qid: qidOf(b.item.value),
        lon: Number(m[1]),
        lat: Number(m[2]),
        en: b.en?.value ?? null,
        ja: b.ja?.value ?? null,
        how: 'search',
      })
    }
    process.stderr.write(`\r  сведения о QID: ${Math.min(i + 40, qids.length)}/${qids.length}   `)
    await sleep(500)
  }
  process.stderr.write('\n')
  return info
}

/**
 * Цепочка P131 по одному шагу.
 *
 * Сначала строится ОБЩИЙ граф «ребёнок → родитель», и только потом из него
 * поднимается предок для каждого корня. Первая версия несла ярлыки вверх
 * прямо во время обхода — и молча теряла их: Тайто-ку попадал в очередь
 * от Янаки на первом круге, к третьему был уже помечен как виденный,
 * и Сэнсо-дзи, пришедший к нему через Асакусу, «Токио» так и не получал.
 * Порядок обхода менял результат — верный признак того, что состояние
 * держится не там.
 */
async function adminChains(qids) {
  const parents = new Map() // qid -> Set(qid)
  const label = new Map()
  let frontier = [...qids]
  const seen = new Set(qids)

  for (let hop = 0; hop < 6 && frontier.length; hop += 1) {
    const next = []
    for (let i = 0; i < frontier.length; i += 60) {
      const batch = frontier.slice(i, i + 60)
      const data = await ask(`SELECT ?item ?a ?aL WHERE {
  VALUES ?item { ${batch.map((q) => `wd:${q}`).join(' ')} }
  ?item wdt:P131 ?a .
  ?a rdfs:label ?aL FILTER(lang(?aL)='en')
} LIMIT 900`)
      for (const b of data?.results?.bindings ?? []) {
        const from = qidOf(b.item.value)
        const to = qidOf(b.a.value)
        label.set(to, b.aL.value)
        const set = parents.get(from) ?? new Set()
        set.add(to)
        parents.set(from, set)
        if (!seen.has(to)) {
          seen.add(to)
          next.push(to)
        }
      }
      process.stderr.write(`\r  цепочки, круг ${hop + 1}: ${Math.min(i + 60, frontier.length)}/${frontier.length}   `)
      await sleep(400)
    }
    frontier = next
  }
  process.stderr.write('\n')

  const chains = new Map()
  for (const root of qids) {
    const out = new Set()
    const stack = [root]
    const been = new Set([root])
    while (stack.length) {
      for (const p of parents.get(stack.pop()) ?? []) {
        if (been.has(p)) continue
        been.add(p)
        if (label.has(p)) out.add(label.get(p))
        stack.push(p)
      }
    }
    chains.set(root, out)
  }
  return chains
}

// ── геометрия ────────────────────────────────────────────────────────────

function haversineKm(a, b) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const inJapan = (p) =>
  p.lat >= JP.latMin && p.lat <= JP.latMax && p.lon >= JP.lonMin && p.lon <= JP.lonMax

/**
 * Разведение однофамильцев по японской метке.
 *
 * У квартала в Wikidata обычно есть свита: станция, мост, река, улица
 * того же имени, плюс историческое село или посёлок, слитый в город сто
 * лет назад. Все они внутри той же префектуры и в паре километров от
 * центра — ни префектура, ни радиус их не разводят. Разводит суффикс:
 *
 *   駅 / 橋 / 川 / 通  — другой РОД объекта. Снимаем всегда, если в нашем
 *                       имени нет station / bridge / river / street.
 *   町 / 村 / 区        — та же местность в другом статусе. Снимаем только
 *                       когда рядом есть брат без суффикса: «有楽町» — это
 *                       и есть имя квартала, брата «有楽» не существует,
 *                       и снять его значило бы потерять верный ответ.
 *
 * Наконец, более частное имя уступает более общему: «平等院庭園» (сад при
 * храме) начинается с «平等院» и потому проигрывает ему.
 */
function narrowByJa(cands, nameEn) {
  const en = flat(nameEn)
  const HARD = [['駅', 'station'], ['橋', 'bridge'], ['川', 'river'], ['通', 'street']]
  let pool = cands.filter((c) => {
    const ja = c.ja ?? ''
    return !HARD.some(([suf, word]) => ja.endsWith(suf) && !en.includes(word))
  })
  const labels = new Set(pool.map((c) => c.ja).filter(Boolean))
  pool = pool.filter((c) => {
    const ja = c.ja ?? ''
    return !['町', '村', '区'].some((suf) => ja.endsWith(suf) && labels.has(ja.slice(0, -1)))
  })
  const jas = pool.map((c) => c.ja).filter(Boolean)
  pool = pool.filter((c) => !jas.some((o) => c.ja && o !== c.ja && c.ja.startsWith(o)))
  return pool.length ? pool : cands
}

/** Все точки в пределах 2 км друг от друга — это один объект, а не выбор. */
function sameSpot(cands, km = 2) {
  for (const a of cands) for (const b of cands) if (haversineKm(a, b) > km) return false
  return true
}

function prefMatches(chain, pref) {
  if (!chain || !pref) return false
  const want = flat(pref).replace(/\s+prefecture$/, '').trim()
  for (const label of chain) {
    if (flat(label).replace(/\s+prefecture$/, '').trim() === want) return true
  }
  return false
}

// ── прогон ───────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2)
  const arg = (name, dflt) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : dflt
  }
  const inPath = arg('--in', 'tmp/poi-live.json')
  const outPath = arg('--out', 'tmp/coords.json')
  const limit = Number(arg('--limit', Infinity))

  const all = JSON.parse(readFileSync(inPath, 'utf8'))
  const need = all
    .filter((r) => !r.isSystem && (r.lat == null || r.lon == null) && r.nameEn)
    .slice(0, limit)

  console.log('\nЗАСЫПКА КООРДИНАТ\n')
  console.log(`  записей без координат: ${need.length}`)

  const nameSet = new Set()
  for (const r of need) for (const v of variants(r.nameEn)) nameSet.add(v)
  const names = [...nameSet]
  console.log(`  вариантов имён:        ${names.length}\n`)

  const byName = await exactLabels(names)

  // Кто остался без точного совпадения — идёт в нечёткий поиск.
  const unresolved = need.filter((r) => !variants(r.nameEn).some((v) => byName.get(v)?.length))
  console.log(`  точным именем нашлось: ${need.length - unresolved.length}`)
  console.log(`  идут в нечёткий поиск: ${unresolved.length}\n`)

  // Ищем ПО ВАРИАНТАМ, а не только по полному имени. «Kegon Waterfall
  // (Kegon no taki)» как поисковая строка не находит ничего — скобка
  // с чтением сбивает поиск, хотя «Kegon Waterfall» находится сразу.
  const searchHits = new Map() // recId -> [qid]
  for (let i = 0; i < unresolved.length; i += 1) {
    const r = unresolved[i]
    const ids = []
    for (const v of variants(r.nameEn)) {
      for (const id of await searchEntities(v)) if (!ids.includes(id)) ids.push(id)
      await sleep(200)
      if (ids.length >= 12) break
    }
    if (ids.length) searchHits.set(r.recId, ids)
    process.stderr.write(`\r  нечёткий поиск: ${i + 1}/${unresolved.length}   `)
  }
  process.stderr.write('\n')

  const searchQids = [...new Set([...searchHits.values()].flat())]
  const searchInfo = await itemsInfo(searchQids)

  // Собираем кандидатов на каждую запись.
  const picked = new Map()
  for (const r of need) {
    let cands = null
    let source = null
    for (const v of variants(r.nameEn)) {
      const hits = byName.get(v)
      if (hits?.length) {
        cands = hits
        source = `точное имя «${v}»`
        break
      }
    }
    if (!cands) {
      const ids = searchHits.get(r.recId) ?? []
      const found = ids.map((q) => searchInfo.get(q)).filter(Boolean)
      if (found.length) {
        cands = found
        source = 'нечёткий поиск'
      }
    }
    if (cands) picked.set(r.recId, { source, cands: cands.filter(inJapan) })
  }

  const qids = [...new Set([...picked.values()].flatMap((p) => p.cands.map((c) => c.qid)))]
  console.log(`  уникальных QID в Японии: ${qids.length}\n`)
  const chains = await adminChains(qids)

  // Ступень 1: имя + рамка + префектура.
  const stage1 = []
  const rejects = []
  for (const r of need) {
    const p = picked.get(r.recId)
    if (!p) { rejects.push({ ...r, why: 'нет в Wikidata' }); continue }
    if (!p.cands.length) { rejects.push({ ...r, why: 'кандидаты вне Японии' }); continue }

    const wanted = core(r.nameEn)
    // Ядро короче четырёх букв или совпавшее с именем города/префектуры
    // ничего не различает: под него подойдёт сам город. Такие — на руки.
    if (wanted.length < 4 || wanted === core(r.pref) || wanted === flat(r.city)) {
      rejects.push({ ...r, why: 'имя слишком общее для автопроверки', source: p.source })
      continue
    }
    // Ядро сверяется с ПОЛНЫМ нашим именем, даже если искали по варианту.
    // Иначе вариант из скобки утаскивает объект вверх по иерархии:
    // «Tokyo Station Building (Marunouchi)» находил Маруноути — квартал,
    // а «Tondaya Merchant House (Nishijin)» — Нисидзин, тоже квартал.
    // Точка при этом внутри Японии, префектура сходится, до центра города
    // близко — все геометрические проверки такой подмен пропускают.
    const exactFull = p.source === `точное имя «${String(r.nameEn).trim()}»`
    const pool = p.cands.filter((c) => (c.en ? core(c.en) === wanted : exactFull))
    if (!pool.length) {
      rejects.push({
        ...r,
        why: 'имя кандидата не сходится',
        source: p.source,
        cands: p.cands.slice(0, 5).map((c) => ({ qid: c.qid, en: c.en, ja: c.ja, lat: c.lat, lon: c.lon })),
      })
      continue
    }

    const inPref = pool.filter((c) => prefMatches(chains.get(c.qid), r.pref))
    const byPref = inPref.length > 1 ? narrowByJa(inPref, r.nameEn) : inPref
    if (byPref.length === 1) {
      stage1.push({ ...r, source: p.source, pick: byPref[0] })
    } else if (byPref.length > 1 && sameSpot(byPref)) {
      stage1.push({ ...r, source: `${p.source} (${byPref.length} записи в одной точке)`, pick: byPref[0] })
    } else {
      rejects.push({
        ...r,
        why: byPref.length === 0 ? 'префектура не совпала' : 'несколько кандидатов в префектуре',
        source: p.source,
        cands: pool.slice(0, 5).map((c) => ({
          qid: c.qid, en: c.en, ja: c.ja, lat: c.lat, lon: c.lon,
          adm: [...(chains.get(c.qid) ?? [])].slice(0, 5),
        })),
      })
    }
  }

  // Ступень 2: медиана города, два прохода.
  const known = new Map()
  for (const r of all) {
    if (r.lat != null && r.lon != null && r.city) {
      const arr = known.get(r.city) ?? []
      arr.push({ lat: r.lat, lon: r.lon })
      known.set(r.city, arr)
    }
  }
  const centreOf = (city, pts) => {
    const merged = [...pts, ...(known.get(city) ?? [])]
    if (!merged.length) return null
    return { lat: median(merged.map((p) => p.lat)), lon: median(merged.map((p) => p.lon)), n: merged.length }
  }

  const byCity = new Map()
  for (const s of stage1) {
    if (!s.city) continue
    const arr = byCity.get(s.city) ?? []
    arr.push(s)
    byCity.set(s.city, arr)
  }

  const accepted = []
  for (const [city, items] of byCity) {
    let centre = centreOf(city, items.map((s) => ({ lat: s.pick.lat, lon: s.pick.lon })))
    // Второй проход: медиана уже без выбросов первого.
    const near = items.filter((s) => haversineKm(centre, s.pick) <= CITY_RADIUS_KM)
    if (near.length >= 3) centre = centreOf(city, near.map((s) => ({ lat: s.pick.lat, lon: s.pick.lon })))
    for (const s of items) {
      const d = haversineKm(centre, s.pick)
      if (centre.n < 3) {
        rejects.push({ ...s, why: `в городе всего ${centre.n} точек, медиана не проверяет` })
      } else if (d > CITY_RADIUS_KM) {
        rejects.push({ ...s, why: `${Math.round(d)} км от медианы города` })
      } else {
        accepted.push({ ...s, kmFromCity: Math.round(d * 10) / 10 })
      }
    }
  }
  for (const s of stage1.filter((x) => !x.city)) {
    rejects.push({ ...s, why: 'нет города — геометрию не на чем проверить' })
  }

  console.log(`\n  ПРИНЯТО автоматически: ${accepted.length}`)
  console.log(`  НА РУКИ:               ${rejects.length}\n`)
  const byWhy = new Map()
  for (const r of rejects) {
    const k = r.why.replace(/\d+/g, 'N')
    byWhy.set(k, (byWhy.get(k) ?? 0) + 1)
  }
  for (const [why, n] of [...byWhy].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${why}`)
  }

  writeFileSync(outPath, JSON.stringify({ accepted, rejects }, null, 2))
  console.log(`\n  отчёт: ${outPath}\n`)
}

main().catch((e) => {
  console.error(`[backfill-coords] ${e.message}`)
  process.exitCode = 2
})
