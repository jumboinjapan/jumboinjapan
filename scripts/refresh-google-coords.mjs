#!/usr/bin/env node
/**
 * Обновление координат, полученных от Google. Запускать раз в месяц.
 *
 *   node scripts/refresh-google-coords.mjs            # показать, что изменится
 *   node scripts/refresh-google-coords.mjs --apply    # записать
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО.
 *
 * Условия Maps Platform разрешают хранить `place_id` бессрочно, а остальное
 * содержимое — включая широту и долготу — не дольше тридцати дней. То есть
 * координата в нашей базе по смыслу не запись, а кэш, и обязана обновляться.
 * Этот прогон и есть то, что делает её кэшем: без него мы просто хранили бы
 * чужие данные дольше разрешённого и называли это иначе.
 *
 * Обновление идёт по `place_id`, а не поиском по имени. Разница
 * принципиальная: поиск каждый раз решает заново, какой объект имелся в
 * виду, и однажды решит иначе — тихо, без следа, посреди ночного прогона.
 * `place_id` держит опознание неизменным; меняется только его положение,
 * если Google уточнил геометрию.
 *
 * Сдвиг больше трёх километров не применяется молча: это не уточнение
 * геометрии, а признак того, что место переехало, закрылось или срослось с
 * другим. Такие выводятся списком.
 */

import { readFileSync } from 'node:fs'

const BASE = 'apppwhjFN82N9zNqm'
const TABLE = 'tblVCmFcHRpXUT24y'
const F = {
  poiId: 'fldy45Q8BDoVBEqN3',
  nameRu: 'fldem9kh1JxrC5jO1',
  lat: 'fldZRgmrRxVNjjWw1',
  lon: 'fldd0EzyStsrS8H0U',
  placeId: 'fldtOfrS1NCSLH69d',
}
const SUSPICIOUS_SHIFT_KM = 3
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function env(name) {
  if (process.env[name]?.trim()) return process.env[name].trim()
  for (const path of ['.env.local', '.env']) {
    try {
      const line = readFileSync(path, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`))
      if (line) return line.slice(name.length + 1).trim()
    } catch {
      /* нет файла — идём дальше */
    }
  }
  throw new Error(`${name} не задан`)
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

async function loadPois(token) {
  const out = []
  let offset
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${TABLE}`)
    for (const id of Object.values(F)) url.searchParams.append('fields[]', id)
    // Без этого флага Airtable считает, что в `fields[]` пришли ИМЕНА полей,
    // и на идентификаторы отвечает пустыми записями — молча, кодом 200.
    // Первый прогон из-за этого отрапортовал «записей с place_id: 0» сразу
    // после того, как их записали сто сорок шесть.
    url.searchParams.set('returnFieldsByFieldId', 'true')
    url.searchParams.set('pageSize', '100')
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Airtable ${res.status}`)
    const data = await res.json()
    for (const r of data.records) {
      const f = r.fields
      if (f[F.placeId]) {
        out.push({
          recId: r.id,
          poiId: f[F.poiId],
          nameRu: f[F.nameRu],
          placeId: f[F.placeId],
          lat: f[F.lat] ?? null,
          lon: f[F.lon] ?? null,
        })
      }
    }
    offset = data.offset
  } while (offset)
  return out
}

/** Только координата. Маска полей определяет цену; лишнего не просим. */
async function fetchLocation(key, placeId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'location' },
    })
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * (attempt + 1))
      continue
    }
    const data = await res.json().catch(() => null)
    if (res.status === 404 || data?.error?.status === 'NOT_FOUND') return { gone: true }
    if (!res.ok) return { error: data?.error?.message ?? `HTTP ${res.status}` }
    const loc = data?.location
    if (typeof loc?.latitude !== 'number') return { error: 'ответ без координаты' }
    return { lat: loc.latitude, lon: loc.longitude }
  }
  return { error: 'не ответил после трёх попыток' }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const token = env('AIRTABLE_TOKEN')
  const key = env('GOOGLE_PLACES_API_KEY')

  const pois = await loadPois(token)
  console.log(`\nОБНОВЛЕНИЕ КООРДИНАТ ИЗ GOOGLE\n`)
  console.log(`  записей с place_id: ${pois.length}`)
  console.log(`  режим: ${apply ? 'ЗАПИСЬ' : 'показ без записи'}\n`)

  const updates = []
  const suspicious = []
  const problems = []

  for (let i = 0; i < pois.length; i += 1) {
    const p = pois[i]
    const got = await fetchLocation(key, p.placeId)
    process.stderr.write(`\r  проверено: ${i + 1}/${pois.length}   `)
    await sleep(100)

    if (got.gone) { problems.push({ ...p, why: 'place_id больше не существует' }); continue }
    if (got.error) { problems.push({ ...p, why: got.error }); continue }

    const shift = p.lat == null ? 0 : haversineKm({ lat: p.lat, lon: p.lon }, got)
    if (p.lat != null && shift > SUSPICIOUS_SHIFT_KM) {
      suspicious.push({ ...p, to: got, shiftKm: Math.round(shift * 10) / 10 })
      continue
    }
    if (p.lat == null || shift > 0.0005) {
      updates.push({ recId: p.recId, poiId: p.poiId, lat: got.lat, lon: got.lon, shiftKm: Math.round(shift * 1000) / 1000 })
    }
  }
  process.stderr.write('\n')

  console.log(`  без изменений:        ${pois.length - updates.length - suspicious.length - problems.length}`)
  console.log(`  сдвинулись:           ${updates.length}`)
  console.log(`  сдвиг больше ${SUSPICIOUS_SHIFT_KM} км:   ${suspicious.length}`)
  console.log(`  проблемы:             ${problems.length}\n`)

  for (const s of suspicious) {
    console.log(`  ! ${s.poiId} ${s.nameRu ?? ''} — ${s.shiftKm} км, не применено`)
  }
  for (const p of problems) console.log(`  × ${p.poiId} ${p.nameRu ?? ''} — ${p.why}`)

  if (!apply) {
    console.log('\n  Ничего не записано. Для записи добавьте --apply\n')
    return
  }

  let ok = 0
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10).map((u) => ({
      id: u.recId,
      fields: { [F.lat]: Math.round(u.lat * 1e6) / 1e6, [F.lon]: Math.round(u.lon * 1e6) / 1e6 },
    }))
    const res = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch }),
    })
    if (res.ok) ok += batch.length
    else console.error(`  Airtable ${res.status} на пачке с ${i}`)
    await sleep(250)
  }
  console.log(`\n  записано: ${ok} из ${updates.length}\n`)
}

main().catch((error) => {
  console.error(`[refresh-google-coords] ${error.message}`)
  process.exitCode = 2
})
