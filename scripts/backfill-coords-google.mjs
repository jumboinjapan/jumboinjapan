#!/usr/bin/env node
/**
 * Засыпка координат из Google Places — там, где Wikidata молчит.
 *
 *   node scripts/backfill-coords-google.mjs --in tmp/poi-live.json --out tmp/gp.json
 *
 * ПОЧЕМУ ВМЕСТЕ С КООРДИНАТАМИ ПИШЕТСЯ place_id.
 *
 * Условия Maps Platform разрешают хранить у себя `place_id` бессрочно, а
 * остальное содержимое, включая широту и долготу, — не дольше тридцати
 * дней. Поэтому координата здесь по смыслу кэш, а не запись: её обновляет
 * `refresh-google-coords.mjs`, и обновляет по `place_id`, без нового поиска
 * по имени. Без сохранённого `place_id` каждое обновление стоило бы полного
 * поиска и могло бы найти другой объект — то есть кэш молча разъезжался бы
 * с тем, что однажды опознали.
 *
 * ОТБОР ТОТ ЖЕ, ЧТО У WIKIDATA, И ПО ТОЙ ЖЕ ПРИЧИНЕ.
 *
 * Google почти всегда что-нибудь возвращает — в этом и опасность. На запрос
 * «Samurai Museum Tokyo» он уверенно отдаёт музей в Асакусе, тогда как наш
 * объект в Кабуки-тё. Ответ выглядит безупречно: Япония, Токио, музей
 * самураев. Разводит их только то, что мы знаем сами.
 *
 * Кандидат принимается, только если:
 *   1. точка внутри рамки Японии;
 *   2. префектура из адреса совпадает с нашей;
 *   3. точка не дальше 25 км от медианы своего города;
 *   4. после этих трёх остался ровно один кандидат — либо все оставшиеся
 *      лежат в пределах километра друг от друга, то есть это один объект,
 *      а не выбор между разными.
 *
 * Ничего не пишет. Только считает и раскладывает на две стопки.
 */

import { readFileSync, writeFileSync } from 'node:fs'

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
const JP = { latMin: 20.0, latMax: 45.9, lonMin: 122.8, lonMax: 154.0 }
const CITY_RADIUS_KM = 25
const SAME_SPOT_KM = 1
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function apiKey() {
  const fromEnv = process.env.GOOGLE_PLACES_API_KEY?.trim()
  if (fromEnv) return fromEnv
  // Локальный прогон: ключ лежит в .env.local рядом с остальными.
  for (const path of ['.env.local', '.env']) {
    try {
      const line = readFileSync(path, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('GOOGLE_PLACES_API_KEY='))
      if (line) return line.slice('GOOGLE_PLACES_API_KEY='.length).trim()
    } catch {
      /* файла нет — идём дальше */
    }
  }
  throw new Error('GOOGLE_PLACES_API_KEY не задан')
}

/**
 * Маска полей определяет и цену запроса, и то, что вообще придёт.
 * Здесь минимум, которого хватает для отбора: идентификатор, имя, точка
 * и адресные компоненты ради префектуры.
 */
const FIELD_MASK = 'places.id,places.displayName,places.location,places.addressComponents'

async function searchText(key, textQuery) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery,
          languageCode: 'en',
          regionCode: 'JP',
          maxResultCount: 5,
          // Рамка Японии на стороне Google: дешевле отсечь чужую страну
          // здесь, чем получить её и отбрасывать у себя.
          locationRestriction: {
            rectangle: {
              low: { latitude: JP.latMin, longitude: JP.lonMin },
              high: { latitude: JP.latMax, longitude: JP.lonMax },
            },
          },
        }),
      })
      if (res.status === 429 || res.status >= 500) {
        await sleep(2000 * (attempt + 1))
        continue
      }
      const data = await res.json()
      if (!res.ok) return { error: data?.error?.message ?? `HTTP ${res.status}` }
      return { places: data.places ?? [] }
    } catch (error) {
      await sleep(1500)
      if (attempt === 2) return { error: error.message }
    }
  }
  return { error: 'не ответил после трёх попыток' }
}

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

const flat = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

const GENERIC = new Set([
  'temple', 'shrine', 'museum', 'park', 'castle', 'garden', 'gardens', 'station',
  'hall', 'gate', 'bridge', 'lake', 'mount', 'mt', 'river', 'falls', 'waterfall',
  'waterfalls', 'cave', 'caves', 'district', 'street', 'market', 'tower', 'the',
  'of', 'and', 'ruins', 'onsen', 'hot', 'springs', 'observation', 'deck', 'area',
  'centre', 'center', 'memorial', 'national', 'quasi', 'art', 'ropeway', 'plateau',
  'valley', 'gorge', 'village', 'town', 'city', 'hills', 'hill', 'pond', 'bay',
  'cape', 'island', 'aquarium', 'zoo', 'historic', 'historical', 'forest', 'house',
])

/** Ядро имени без родовых слов — им сверяем наш объект с найденным. */
function core(s) {
  const words = flat(s).split(/[^a-z0-9]+/).filter(Boolean)
  const kept = words.filter((w) => !GENERIC.has(w))
  return (kept.length ? kept : words).join('')
}

/**
 * Совпадение имён без требования равенства: Google возвращает официальные
 * названия, у нас — рабочие. «Kegon Waterfall» против «Kegon Waterfalls»,
 * «Naramachi District» против «Naramachi Historic District». Достаточно,
 * чтобы одно ядро содержалось в другом.
 */
function namesAgree(ours, theirs) {
  const a = core(ours)
  const b = core(theirs)
  if (!a || !b || a.length < 4 || b.length < 4) return false
  return a === b || a.includes(b) || b.includes(a)
}

function prefOf(place) {
  const c = (place.addressComponents ?? []).find((x) => x.types?.includes('administrative_area_level_1'))
  return c?.longText ?? c?.shortText ?? ''
}

function prefMatches(place, want) {
  if (!want) return false
  const a = flat(prefOf(place)).replace(/\s+prefecture$/, '')
  const b = flat(want).replace(/\s+prefecture$/, '')
  return Boolean(a) && a === b
}

const inJapan = (p) =>
  p.lat >= JP.latMin && p.lat <= JP.latMax && p.lon >= JP.lonMin && p.lon <= JP.lonMax

/** Города словами, а не слагом: «koyasan» Google понимает хуже, чем «Koyasan». */
function queryFor(record) {
  const parts = [record.nameEn]
  if (record.city) parts.push(record.city.replace(/-/g, ' '))
  if (record.pref && flat(record.pref) !== flat(record.city)) parts.push(record.pref)
  parts.push('Japan')
  return parts.join(', ')
}

async function main() {
  const argv = process.argv.slice(2)
  const arg = (name, dflt) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : dflt
  }
  const inPath = arg('--in', 'tmp/poi-live.json')
  const outPath = arg('--out', 'tmp/gp.json')
  const limit = Number(arg('--limit', Infinity))

  const key = apiKey()
  const all = JSON.parse(readFileSync(inPath, 'utf8'))
  const need = all
    .filter((r) => !r.isSystem && (r.lat == null || r.lon == null) && r.nameEn)
    .slice(0, limit)

  console.log('\nЗАСЫПКА КООРДИНАТ ЧЕРЕЗ GOOGLE PLACES\n')
  console.log(`  записей без координат: ${need.length}\n`)

  // ── Сбор ───────────────────────────────────────────────────────────────
  // Сначала спрашиваем Google по всем записям, и только потом решаем. Так
  // отбор можно прогнать несколько раз, не платя за повторные запросы.
  const found = new Map()
  for (let i = 0; i < need.length; i += 1) {
    const r = need[i]
    const { places, error } = await searchText(key, queryFor(r))
    if (error) found.set(r.recId, { error })
    else {
      found.set(r.recId, {
        cands: places
          .map((p) => ({
            placeId: p.id,
            name: p.displayName?.text ?? '',
            lat: p.location?.latitude,
            lon: p.location?.longitude,
            pref: prefOf(p),
          }))
          .filter((c) => typeof c.lat === 'number' && typeof c.lon === 'number' && inJapan(c)),
      })
    }
    process.stderr.write(`\r  запросов: ${i + 1}/${need.length}   `)
    await sleep(120)
  }
  process.stderr.write('\n')

  // ── Отбор в несколько кругов ───────────────────────────────────────────
  //
  // Медиана города считается по записям, у которых координаты уже есть. В
  // половине городов таких записей нет вовсе — там сидят ровно те точки,
  // которые мы сейчас и ищем, и проверять геометрию не обо что.
  //
  // Первая опора города берётся по другому правилу: префектура совпала,
  // кандидат в ней ровно один, и его имя сходится с нашим. Дальше эта точка
  // становится опорой, и остальные записи города проверяются уже обычным
  // порядком. Поэтому кругов несколько: город открывается постепенно.
  const known = all
    .filter((r) => r.lat != null && r.lon != null && r.city)
    .map((r) => ({ city: r.city, lat: r.lat, lon: r.lon }))

  const accepted = []
  const decided = new Set()
  // Отказы копятся между кругами, а не переписываются: запись, отклонённая
  // на первом круге, во второй уже не заходит, и её причина иначе исчезала
  // бы из отчёта вместе со списком.
  const rejects = []
  const pending = new Map()

  for (let round = 1; round <= 3; round += 1) {
    const anchors = [...known, ...accepted.map((a) => ({ city: a.city, lat: a.pick.lat, lon: a.pick.lon }))]
    const byCity = new Map()
    for (const a of anchors) {
      const arr = byCity.get(a.city) ?? []
      arr.push(a)
      byCity.set(a.city, arr)
    }
    const centres = new Map()
    for (const [city, pts] of byCity) {
      centres.set(city, {
        lat: median(pts.map((p) => p.lat)),
        lon: median(pts.map((p) => p.lon)),
        n: pts.length,
      })
    }

    pending.clear()
    let gained = 0

    for (const r of need) {
      if (decided.has(r.recId)) continue
      const hit = found.get(r.recId)

      if (hit?.error) { rejects.push({ ...r, why: `Google: ${hit.error}` }); decided.add(r.recId); continue }
      const cands = hit?.cands ?? []
      if (!cands.length) { rejects.push({ ...r, why: 'Google ничего не нашёл' }); decided.add(r.recId); continue }

      const byPref = cands.filter((c) => prefMatches({ addressComponents: [{ types: ['administrative_area_level_1'], longText: c.pref }] }, r.pref))
      if (!byPref.length) {
        rejects.push({ ...r, why: 'префектура не совпала', cands: cands.slice(0, 3) })
        decided.add(r.recId)
        continue
      }

      const centre = r.city ? centres.get(r.city) : null

      // Город без опоры: принимаем только единственного кандидата с
      // сошедшимся именем — он и станет опорой для остальных.
      if (!centre || centre.n < 2) {
        if (byPref.length === 1 && namesAgree(r.nameEn, byPref[0].name)) {
          accepted.push({ ...r, pick: byPref[0], kmFromCity: null, seedForCity: true, round })
          decided.add(r.recId)
          gained += 1
        } else {
          pending.set(r.recId, {
            ...r,
            why: 'в городе нет опорных точек, а кандидат не единственный или имя не сходится',
            cands: byPref.slice(0, 3),
          })
        }
        continue
      }

      // Имя сверяется и здесь, а не только при поиске первой опоры.
      // Без этого «Numa-no-Daira Plateau» принимал «Daisetsuzan National
      // Park»: тот же Хоккайдо, 22 км от центра — обе геометрические
      // проверки проходят. Google просто отдал объемлющий парк вместо
      // плато, и опровергнуть это может только имя.
      const named = byPref.filter((c) => namesAgree(r.nameEn, c.name))
      if (!named.length) {
        rejects.push({ ...r, why: 'имя найденного не сходится с нашим', cands: byPref.slice(0, 3) })
        decided.add(r.recId)
        continue
      }

      const near = named.filter((c) => haversineKm(centre, c) <= CITY_RADIUS_KM)
      if (!near.length) {
        const d = Math.round(Math.min(...named.map((c) => haversineKm(centre, c))))
        rejects.push({ ...r, why: `${d} км от медианы города`, cands: named.slice(0, 3) })
        decided.add(r.recId)
        continue
      }

      const spread = Math.max(...near.map((a) => Math.max(...near.map((b) => haversineKm(a, b)))))
      if (near.length > 1 && spread > SAME_SPOT_KM) {
        rejects.push({ ...r, why: `${near.length} разных места подходят одинаково`, cands: near.slice(0, 3) })
        decided.add(r.recId)
        continue
      }

      accepted.push({
        ...r,
        pick: near[0],
        kmFromCity: Math.round(haversineKm(centre, near[0]) * 10) / 10,
        alternatives: near.length - 1,
        round,
      })
      decided.add(r.recId)
      gained += 1
    }

    console.log(`  круг ${round}: принято ${gained}, всего ${accepted.length}`)
    if (!gained) break
  }
  // Что не открылось за три круга — уже не откроется: опор в этих городах
  // не появится.
  for (const item of pending.values()) rejects.push(item)

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

main().catch((error) => {
  console.error(`[backfill-coords-google] ${error.message}`)
  process.exitCode = 2
})
