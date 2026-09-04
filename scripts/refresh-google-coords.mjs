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
 *
 * Обновляется только то, что по политике координат есть кэш Google. До
 * 3 сентября 2026 года скрипт не спрашивал `Coordinate Policy` и перезаписывал
 * точкой Google любую запись с `place_id` — в том числе `representativePoint`,
 * где точку назначил владелец, и `notApplicable`, где координат по решению нет
 * (контрпример: `tmp/10f-p-p07-refresh-repro-manual-OLD-2026-09-03.*`). Что
 * можно обновлять и что именно писать, решает общий с кроном контракт
 * `src/lib/poi-coordinate-refresh.ts`; в Airtable уходит ровно `plan.fields`.
 *
 * Семантика одна с кроном: каждый план с полями исполняется — `write` (пара
 * Google + отметка проверки, даже если пара не изменилась) и `hold` (сдвиг
 * больше 3 км: только отметка). Показ без записи — предпросмотр по снимку;
 * при `--apply` перед КАЖДОЙ пачкой PATCH записи перечитываются, и план
 * строится по свежему чтению: если владелец успел изменить политику, пару
 * или `place_id`, запись откладывается, а не затирается.
 *
 * После каждой пачки — независимое чтение и сверка итога: если политика,
 * пара или `place_id` не соответствуют допустимому итоговому состоянию (или
 * чтение недоступно), скрипт не объявляет успех — печатает «ТРЕБУЕТСЯ
 * ВОССТАНОВЛЕНИЕ» с record ID и завершается кодом 1. Повтора, отката и
 * исправляющей записи нет. После первого расхождения оставшиеся пачки не
 * отправляются вовсе (хвост перечисляется). Брошенные значения на границах
 * описываются `describeThrownSafely` и скрипт не покидают.
 */

import { readFileSync } from 'node:fs'

import { AIRTABLE_BASE_ID, POI_TABLE_ID } from '../src/lib/airtable-schema.ts'
import {
  checkedAtMoment,
  classifyPatchOutcome,
  coordinateRefreshEligibility,
  freshReadFormula,
  planCoordinateRefresh,
  POI_COORDINATE_FIELD_IDS,
  previewCoordinateRefresh,
  REFRESH_BATCH_SIZE,
  storedCoordinateRecordFromFields,
  SUSPICIOUS_SHIFT_KM,
} from '../src/lib/poi-coordinate-refresh.ts'
import { describeThrownSafely } from '../src/lib/thrown-value.ts'

const BASE = AIRTABLE_BASE_ID
const TABLE = POI_TABLE_ID
const F = POI_COORDINATE_FIELD_IDS
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

async function loadPois(token) {
  const out = []
  const skipped = []
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
      const stored = storedCoordinateRecordFromFields(f)
      if (!f[F.placeId]) continue
      const poi = { recId: r.id, poiId: f[F.poiId], nameRu: f[F.nameRu], placeId: f[F.placeId], stored }
      // Что нельзя обновлять по политике, в Google не спрашивается вовсе.
      const eligibility = coordinateRefreshEligibility(stored)
      if (!eligibility.eligible) { skipped.push({ ...poi, refusal: eligibility.refusal, why: eligibility.message }); continue }
      out.push(poi)
    }
    offset = data.offset
  } while (offset)
  return { pois: out, skipped }
}

/** Свежее чтение ровно указанных записей перед PATCH; недоступное — пустая карта. */
async function readFresh(token, recordIds) {
  const fresh = new Map()
  try {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${TABLE}`)
    for (const id of Object.values(F)) url.searchParams.append('fields[]', id)
    url.searchParams.set('returnFieldsByFieldId', 'true')
    url.searchParams.set('filterByFormula', freshReadFormula(recordIds))
    url.searchParams.set('pageSize', String(recordIds.length))
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return fresh
    const data = await res.json()
    for (const r of data?.records ?? []) {
      if (typeof r?.id !== 'string' || !r.fields || typeof r.fields !== 'object') continue
      fresh.set(r.id, storedCoordinateRecordFromFields(r.fields))
    }
  } catch (error) {
    console.error(`  чтение записей перед/после записи: ${describeThrownSafely(error)}`)
  }
  return fresh
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

  const { pois, skipped } = await loadPois(token)
  console.log(`\nОБНОВЛЕНИЕ КООРДИНАТ ИЗ GOOGLE\n`)
  console.log(`  записей с place_id к обновлению: ${pois.length}`)
  console.log(`  пропущено по политике координат: ${skipped.length}`)
  console.log(`  режим: ${apply ? 'ЗАПИСЬ' : 'показ без записи'}\n`)

  // Наблюдения Google по всей очереди; предпросмотр — по снимку, без полномочий на запись.
  const observed = []
  const problems = []
  const preview = { moved: [], unchanged: [], held: [] }

  for (let i = 0; i < pois.length; i += 1) {
    const p = pois[i]
    const got = await fetchLocation(key, p.placeId)
    process.stderr.write(`\r  проверено: ${i + 1}/${pois.length}   `)
    await sleep(100)

    if (got.gone) { problems.push({ ...p, why: 'place_id больше не существует' }); continue }
    if (got.error) { problems.push({ ...p, why: got.error }); continue }

    const plan = previewCoordinateRefresh(p.stored, got, checkedAtMoment())
    if (plan.kind === 'skip') { problems.push({ ...p, why: plan.message }); continue }
    observed.push({ p, got })
    if (plan.kind === 'hold') preview.held.push({ ...p, shiftKm: Math.round(plan.shiftKm * 10) / 10 })
    else if (plan.coordinatesChanged) preview.moved.push({ ...p, shiftKm: Math.round(plan.shiftKm * 1000) / 1000 })
    else preview.unchanged.push(p)
  }
  process.stderr.write('\n')

  console.log(`  сдвинулись (пара Google + отметка):      ${preview.moved.length}`)
  console.log(`  без изменений (та же пара + отметка):    ${preview.unchanged.length}`)
  console.log(`  сдвиг больше ${SUSPICIOUS_SHIFT_KM} км (только отметка):    ${preview.held.length}`)
  console.log(`  проблемы:                                ${problems.length}`)
  console.log(`  пропущено по политике:                   ${skipped.length}\n`)

  for (const s of preview.held) {
    console.log(`  ! ${s.poiId} ${s.nameRu ?? ''} — ${s.shiftKm} км, пара не применяется, ставится только отметка`)
  }
  for (const p of problems) console.log(`  × ${p.poiId} ${p.nameRu ?? ''} — ${p.why}`)
  for (const p of skipped) console.log(`  – ${p.poiId} ${p.nameRu ?? ''} — ${p.refusal}: ${p.why}`)

  if (!apply) {
    console.log('\n  Ничего не записано. Для записи добавьте --apply\n')
    return
  }

  // Запись: перед каждой пачкой — свежее чтение, план по свежему, PATCH ровно plan.fields,
  // после пачки — независимое чтение; итог каждой записи только по чтению.
  let verified = 0
  let planned = 0
  const deferred = []
  const notApplied = []
  const recovery = []
  let stopped = null
  for (let i = 0; i < observed.length; i += REFRESH_BATCH_SIZE) {
    const batch = observed.slice(i, i + REFRESH_BATCH_SIZE)
    const fresh = await readFresh(token, batch.map(({ p }) => p.recId))
    const checkedAt = checkedAtMoment()
    const records = []
    const plannedBatch = []
    for (const { p, got } of batch) {
      const freshRecord = fresh.get(p.recId) ?? null
      const plan = planCoordinateRefresh({ selected: p.stored, fresh: freshRecord, observed: got, checkedAt })
      if (plan.kind === 'skip') { deferred.push({ ...p, why: plan.message }); continue }
      records.push({ id: p.recId, fields: plan.fields })
      plannedBatch.push({ p, plan, fresh: freshRecord })
    }
    if (records.length === 0) continue
    planned += records.length
    let patchAccepted = false
    try {
      const res = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      })
      patchAccepted = res.ok
      if (!res.ok) console.error(`  Airtable ${res.status} на пачке с ${i}`)
    } catch (error) {
      console.error(`  PATCH без ответа: ${describeThrownSafely(error)}`)
    }
    // Ровно один PATCH на пачку: ни повтора, ни отката, ни исправляющей записи.
    const after = await readFresh(token, plannedBatch.map(({ p }) => p.recId))
    // Вся уже записанная пачка классифицируется целиком — и только потом решается судьба хвоста.
    for (const { p, plan, fresh: freshRecord } of plannedBatch) {
      const outcome = classifyPatchOutcome({ plan, fresh: freshRecord, after: after.get(p.recId) ?? null, patchAccepted })
      if (outcome.kind === 'verified') { verified += 1; continue }
      if (outcome.kind === 'notApplied') { notApplied.push({ ...p, why: outcome.message }); continue }
      recovery.push({ ...p, refusal: outcome.refusal, mismatched: outcome.mismatched, why: outcome.message })
    }
    if (recovery.length) {
      // Первое расхождение останавливает прогон: ни одного PATCH для оставшихся пачек.
      stopped = { afterBatch: Math.floor(i / REFRESH_BATCH_SIZE) + 1, tail: observed.slice(i + REFRESH_BATCH_SIZE).map(({ p }) => p.poiId) }
      break
    }
    await sleep(250)
  }
  for (const p of deferred) console.log(`  ↺ ${p.poiId} ${p.nameRu ?? ''} — отложено: ${p.why}`)
  for (const p of notApplied) console.log(`  × ${p.poiId} ${p.nameRu ?? ''} — ${p.why}`)
  console.log(`\n  подтверждено чтением: ${verified} из ${planned}; отложено после свежего чтения: ${deferred.length}; не принято: ${notApplied.length}\n`)
  if (recovery.length) {
    console.log(`  !! ТРЕБУЕТСЯ ВОССТАНОВЛЕНИЕ (recoveryRequired): ${recovery.length} записей — успех не объявляется, повтора и отката не было`)
    for (const p of recovery) console.log(`     ${p.recId} ${p.poiId} ${p.nameRu ?? ''} — ${p.refusal}${p.mismatched.length ? ` (${p.mismatched.join(', ')})` : ''}: ${p.why}`)
    if (stopped) console.log(`  !! ОСТАНОВЛЕНО после пачки ${stopped.afterBatch}: ${stopped.tail.length} записей хвоста не записаны (${stopped.tail.join(', ') || '—'}) — дожидаются следующего прогона`)
    console.log('')
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`[refresh-google-coords] ${describeThrownSafely(error)}`)
  process.exitCode = 2
})
