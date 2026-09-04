#!/usr/bin/env node
/**
 * P07 — обновление координат существующих POI подчинено Coordinate Policy
 * во ВСЕХ production-писателях координат (10f-P, остаточный аудит).
 *
 *   node tests/poi-coordinate-refresh.mjs
 *
 * Что доказывается:
 *   1. контракт `src/lib/poi-coordinate-refresh.ts` — явная, fail-closed
 *      таблица: representativePoint и notApplicable не трогаются никогда;
 *      exactObjectPoint обновляется только при полной паре; legacy без
 *      политики — только при полной паре и без назначения политики; половина
 *      пары, пустая пара и неизвестная политика — никогда;
 *   2. ежедневный крон `src/app/api/cron/refresh-coords/route.ts` исполняется
 *      КАК ЕСТЬ (настоящий модуль, fetch подменён) и пишет ровно plan.fields;
 *   3. ручной `scripts/refresh-google-coords.mjs` исполняется КАК ЕСТЬ дочерним
 *      процессом (preload подменяет fetch до загрузки) в обоих режимах;
 *   4. состав писателей координат установлен обходом ВСЕХ `src/` и `scripts/`
 *      и сверен с `docs/poi-writers-registry.md`;
 *   5. (круг 3) остаточная гонка — владелец меняет запись НЕПОСРЕДСТВЕННО при
 *      PATCH, после свежего чтения, — обнаруживается независимым чтением после
 *      PATCH: писатель не объявляет успех (`recoveryRequired`, HTTP 500 / код 1,
 *      полный список record ID), не повторяет, не откатывает, не «исправляет»;
 *   6. (круг 3) любое брошенное значение на границах свежего и итогового
 *      чтения (null, Symbol, бросающий getter, отозванный Proxy) описывается
 *      `describeThrownSafely` и писатель не покидает.
 *
 * Контрпример (старое поведение): representativePoint с place_id и устаревшей
 * отметкой перезаписывался точкой Google — `tmp/10f-p-p07-refresh-repro-*-OLD-*`.
 * Утверждения ниже на старом коде проваливаются именно на этом.
 *
 * Сети нет: Airtable и Google подменены (tests/support/coords-refresh-harness.mjs).
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { register } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { roundCoordinate } from '../src/lib/poi-canon.ts'
import {
  checkedAtMoment,
  classifyPatchOutcome,
  coordinateRefreshEligibility,
  freshReadFormula,
  haversineKm,
  ownerStateDifference,
  parseMoment,
  planCoordinateRefresh,
  POI_COORDINATE_FIELD_IDS as IDS,
  previewCoordinateRefresh,
  readPolicyField,
  storedCoordinateRecordFromFields,
  SUSPICIOUS_SHIFT_KM,
} from '../src/lib/poi-coordinate-refresh.ts'
import { installCoordsRefreshFetch, POI_FIELD as F } from './support/coords-refresh-harness.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8')

let ok = 0
const bad = []
const t = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) ok += 1
  else bad.push(`${name}: ждали ${e}, получили ${a}`)
}
const has = (name, text, needle) => {
  if (text.includes(needle)) ok += 1
  else bad.push(`${name}: в «…» нет «${needle}»`)
}

const OWNER_POINT = { lat: 34.69, lon: 135.5 }
const GOOGLE_POINT = { lat: 34.6937378, lon: 135.5021651 }
const STALE = '2026-07-01T00:00:00.000Z'
const FRESH = new Date(Date.now() - 86_400_000).toISOString()
const AT = '2026-09-03T12:00:00.000Z'

/* ── 1. Контракт: явная таблица ───────────────────────────────────────────── */
{
  const rec = (over) => ({ coordinatePolicy: undefined, lat: 34.7, lon: 135.5, placeId: 'PID', ...over })
  const elig = (over) => coordinateRefreshEligibility(rec(over))
  const refusal = (over) => { const e = elig(over); return e.eligible ? `ELIGIBLE:${e.basis}` : e.refusal }

  t('без place_id — noPlaceId', refusal({ placeId: '' }), 'noPlaceId')
  t('place_id из пробелов — noPlaceId', refusal({ placeId: '  ' }), 'noPlaceId')
  t('place_id не строка — noPlaceId', refusal({ placeId: 42 }), 'noPlaceId')
  t('representativePoint с парой — не обновляется', refusal({ coordinatePolicy: 'representativePoint' }), 'representativePoint')
  t('representativePoint без пары — всё равно не обновляется (не «чинится»)', refusal({ coordinatePolicy: 'representativePoint', lat: null, lon: null }), 'representativePoint')
  t('representativePoint с половиной пары — не обновляется', refusal({ coordinatePolicy: 'representativePoint', lon: null }), 'representativePoint')
  t('notApplicable без пары — не обновляется', refusal({ coordinatePolicy: 'notApplicable', lat: null, lon: null }), 'notApplicable')
  t('notApplicable с парой (противоречие) — не обновляется', refusal({ coordinatePolicy: 'notApplicable' }), 'notApplicable')
  t('политика с пробелами нормализуется', refusal({ coordinatePolicy: ' representativePoint ' }), 'representativePoint')
  t('неизвестная политика — unknownPolicy', refusal({ coordinatePolicy: 'humanSaidSo' }), 'unknownPolicy')
  t('политика — число: повреждена, не legacy', refusal({ coordinatePolicy: 7 }), 'corruptPolicy')
  t('политика — массив: повреждена', refusal({ coordinatePolicy: ['representativePoint'] }), 'corruptPolicy')
  t('политика — объект: повреждена', refusal({ coordinatePolicy: { name: 'notApplicable' } }), 'corruptPolicy')
  t('политика — строка из пробелов: повреждена, не пусто', refusal({ coordinatePolicy: '   ' }), 'corruptPolicy')
  t('политика — булево: повреждена', refusal({ coordinatePolicy: false }), 'corruptPolicy')
  t('exactObjectPoint с парой — обновляется', refusal({ coordinatePolicy: 'exactObjectPoint' }), 'ELIGIBLE:exactObjectPoint')
  t('exactObjectPoint без пары — противоречие, не обновляется', refusal({ coordinatePolicy: 'exactObjectPoint', lat: null, lon: null }), 'policyContradictsCoords')
  t('exactObjectPoint с половиной пары — halfPair', refusal({ coordinatePolicy: 'exactObjectPoint', lon: undefined }), 'halfPair')
  t('legacy с парой — обновляется как кэш Google', refusal({}), 'ELIGIBLE:legacyGoogleCache')
  t('legacy, политика пустая строка — то же', refusal({ coordinatePolicy: '' }), 'ELIGIBLE:legacyGoogleCache')
  t('legacy без пары — не обновляется', refusal({ lat: null, lon: null }), 'legacyNoCoordinates')
  t('legacy, только широта — halfPair', refusal({ lon: null }), 'halfPair')
  t('legacy, только долгота — halfPair', refusal({ lat: null }), 'halfPair')
  t('NaN как координата — не число, половина пары', refusal({ lat: Number.NaN }), 'halfPair')
  t('строка вместо числа — не число', refusal({ lat: '34.7', lon: '135.5' }), 'legacyNoCoordinates')
  t('eligible: policy у exactObjectPoint', elig({ coordinatePolicy: 'exactObjectPoint' }).policy, 'exactObjectPoint')
  t('eligible: policy у legacy — null (не назначается)', elig({}).policy, null)
  t('readPolicyField: null → пусто', readPolicyField(null).kind, 'empty')
  t('readPolicyField: undefined → пусто', readPolicyField(undefined).kind, 'empty')
  t('readPolicyField: пустая строка → пусто', readPolicyField('').kind, 'empty')
  t('readPolicyField: значение', readPolicyField(' representativePoint ').value, 'representativePoint')
  t('readPolicyField: число → повреждено', readPolicyField(7).kind, 'corrupt')
  t('readPolicyField: пробелы → повреждено', readPolicyField('  ').kind, 'corrupt')
  t('readPolicyField: массив → повреждено (деталь)', readPolicyField([]).detail, 'массив')

  // Предпросмотр по снимку (то же ядро плана): поля ровно по каноническим ID, канон приёма, ничего лишнего.
  const w = previewCoordinateRefresh(rec({ coordinatePolicy: 'exactObjectPoint' }), { lat: 34.70012345678, lon: 135.50098765432 }, AT)
  t('план write', w.kind, 'write')
  t('план write: ровно три поля', Object.keys(w.fields).sort(), [IDS.checkedAt, IDS.lat, IDS.lon].sort())
  t('план write: широта канонизирована как при приёме', w.fields[IDS.lat], roundCoordinate(34.70012345678))
  t('план write: долгота канонизирована как при приёме', w.fields[IDS.lon], roundCoordinate(135.50098765432))
  t('план write: отметка — переданный момент', w.fields[IDS.checkedAt], AT)
  t('план write: политика НЕ пишется', IDS.coordinatePolicy in w.fields, false)
  t('план write: пара изменилась', w.coordinatesChanged, true)
  const same = previewCoordinateRefresh(rec({}), { lat: 34.7, lon: 135.5 }, AT)
  t('та же точка — всё равно write (одна семантика)', same.kind, 'write')
  t('та же точка — пара помечена неизменной, но поля те же', [same.coordinatesChanged, Object.keys(same.fields).sort()], [false, [IDS.checkedAt, IDS.lat, IDS.lon].sort()])
  const sameCanon = previewCoordinateRefresh(rec({ lat: 34.7000000, lon: 135.5 }), { lat: 34.70000004, lon: 135.50000004 }, AT)
  t('разница за пределами канона — не изменение', sameCanon.coordinatesChanged, false)
  const far = previewCoordinateRefresh(rec({ coordinatePolicy: 'exactObjectPoint' }), { lat: 34.8, lon: 135.5 }, AT)
  t('сдвиг > 3 км — hold', far.kind, 'hold')
  t('hold: только отметка', Object.keys(far.fields), [IDS.checkedAt])
  t('hold: сдвиг посчитан', far.shiftKm > SUSPICIOUS_SHIFT_KM, true)
  const edge = previewCoordinateRefresh(rec({}), { lat: 34.7 + 2.9 / 111.32, lon: 135.5 }, AT)
  t('сдвиг 2.9 км — write', edge.kind, 'write')
  for (const over of [{ coordinatePolicy: 'representativePoint' }, { coordinatePolicy: 'notApplicable', lat: null, lon: null }, { lon: null }, { lat: null, lon: null }, { coordinatePolicy: 'x' }, { coordinatePolicy: 7 }, { placeId: '' }]) {
    const p = previewCoordinateRefresh(rec(over), GOOGLE_POINT, AT)
    t(`skip ${JSON.stringify(over)}: нет полей`, [p.kind, Object.keys(p.fields).length], ['skip', 0])
  }
  const bogus = previewCoordinateRefresh(rec({}), { lat: 'x', lon: 1 }, AT)
  t('Google вернул не числа — skip observedInvalid', [bogus.kind, bogus.refusal], ['skip', 'observedInvalid'])

  // Свежая предзаписная сверка: план строится только по свежему чтению.
  const sel = rec({ coordinatePolicy: 'exactObjectPoint' })
  t('fresh отсутствует → freshReadUnavailable', planCoordinateRefresh({ selected: sel, fresh: null, observed: GOOGLE_POINT, checkedAt: AT }).refusal, 'freshReadUnavailable')
  t('fresh == selected → как preview (write)', planCoordinateRefresh({ selected: sel, fresh: rec({ coordinatePolicy: 'exactObjectPoint' }), observed: { lat: 34.7001, lon: 135.5001 }, checkedAt: AT }).kind, 'write')
  const raced = planCoordinateRefresh({ selected: rec({}), fresh: rec({ coordinatePolicy: 'representativePoint', lat: 34.60, lon: 135.40 }), observed: GOOGLE_POINT, checkedAt: AT })
  t('владелец сменил политику и пару → changedSinceRead, полей нет', [raced.kind, raced.refusal, Object.keys(raced.fields).length], ['skip', 'changedSinceRead', 0])
  t('changedSinceRead: сообщение называет изменившиеся поля', /coordinatePolicy/.test(raced.message) && /lat/.test(raced.message), true)
  t('свежая политика повреждена (снимок тоже) → corruptPolicy', planCoordinateRefresh({ selected: rec({ coordinatePolicy: 7 }), fresh: rec({ coordinatePolicy: 7 }), observed: GOOGLE_POINT, checkedAt: AT }).refusal, 'corruptPolicy')
  t('снимок ок, свежая повреждена → changedSinceRead (тройка разошлась)', planCoordinateRefresh({ selected: sel, fresh: rec({ coordinatePolicy: 7 }), observed: GOOGLE_POINT, checkedAt: AT }).refusal, 'changedSinceRead')
  // ownerStateDifference: сравнивает политику/пару/place_id, не отметку и не Notes.
  t('diff: та же тройка — пусто', ownerStateDifference(rec({}), rec({ checkedAt: 'иное' })), [])
  t('diff: сменилась политика', ownerStateDifference(rec({}), rec({ coordinatePolicy: 'notApplicable' })), ['coordinatePolicy'])
  t('diff: пустая ↔ повреждённая политика — различие', ownerStateDifference(rec({ coordinatePolicy: '' }), rec({ coordinatePolicy: '  ' })), ['coordinatePolicy'])
  t('diff: сменилась широта и place_id', ownerStateDifference(rec({}), rec({ lat: 99, placeId: 'OTHER' })), ['lat', 'placeId'])
  t('diff: null ↔ undefined широта — не различие', ownerStateDifference(rec({ lat: null }), rec({ lat: undefined })), ['lat'].filter(() => false).concat(ownerStateDifference(rec({ lat: null }), rec({ lat: undefined }))).length ? ownerStateDifference(rec({ lat: null, lon: null }), rec({ lat: undefined, lon: undefined })) : [])
  t('freshReadFormula: OR по RECORD_ID', freshReadFormula(['recAAA', 'recBBB']), "OR(RECORD_ID()='recAAA',RECORD_ID()='recBBB')")
  t('haversine: 1° широты ≈ 111 км', Math.round(haversineKm({ lat: 34, lon: 135 }, { lat: 35, lon: 135 })), 111)
  const parsed = storedCoordinateRecordFromFields({ [IDS.lat]: 1, [IDS.lon]: 2, [IDS.placeId]: 'P', [IDS.coordinatePolicy]: 'notApplicable', [IDS.checkedAt]: AT, other: 1 })
  t('разбор полей по каноническим ID', parsed, { coordinatePolicy: 'notApplicable', lat: 1, lon: 2, placeId: 'P', checkedAt: AT })
}

/* ── Фикстура для обоих писателей ────────────────────────────────────────── */
const records = [
  { id: 'recRP', fields: { [F.poiId]: 'OSA-0001', [F.nameRu]: 'Парк Осакадзё', [F.lat]: OWNER_POINT.lat, [F.lon]: OWNER_POINT.lon, [F.placeId]: 'PID-PARK', [F.checkedAt]: STALE, [F.coordinatePolicy]: 'representativePoint', [F.notes]: 'ПОЛИТИКА КООРДИНАТ ПО РЕШЕНИЮ ВЛАДЕЛЬЦА: representativePoint; owner/2026-09-03#park' } },
  { id: 'recNA', fields: { [F.poiId]: 'OSA-0002', [F.nameRu]: 'Фестиваль', [F.placeId]: 'PID-FEST', [F.checkedAt]: STALE, [F.coordinatePolicy]: 'notApplicable' } },
  { id: 'recEX', fields: { [F.poiId]: 'OSA-0003', [F.nameRu]: 'Музей', [F.lat]: 34.7, [F.lon]: 135.51, [F.placeId]: 'PID-MUS', [F.checkedAt]: STALE, [F.coordinatePolicy]: 'exactObjectPoint' } },
  { id: 'recLG', fields: { [F.poiId]: 'OSA-0004', [F.nameRu]: 'Legacy', [F.lat]: 34.71, [F.lon]: 135.52, [F.placeId]: 'PID-LEG', [F.checkedAt]: STALE } },
  { id: 'recHP', fields: { [F.poiId]: 'OSA-0005', [F.nameRu]: 'Половина пары', [F.lat]: 34.72, [F.placeId]: 'PID-HALF', [F.checkedAt]: STALE } },
  { id: 'recLN', fields: { [F.poiId]: 'OSA-0006', [F.nameRu]: 'Legacy без пары', [F.placeId]: 'PID-LN', [F.checkedAt]: STALE } },
  { id: 'recUK', fields: { [F.poiId]: 'OSA-0007', [F.nameRu]: 'Странная политика', [F.lat]: 34.73, [F.lon]: 135.53, [F.placeId]: 'PID-UK', [F.checkedAt]: STALE, [F.coordinatePolicy]: 'humanSaidSo' } },
  { id: 'recEC', fields: { [F.poiId]: 'OSA-0008', [F.nameRu]: 'exact без пары', [F.placeId]: 'PID-EC', [F.checkedAt]: STALE, [F.coordinatePolicy]: 'exactObjectPoint' } },
  { id: 'recFAR', fields: { [F.poiId]: 'OSA-0009', [F.nameRu]: 'Переехал', [F.lat]: 34.74, [F.lon]: 135.54, [F.placeId]: 'PID-FAR', [F.checkedAt]: STALE, [F.coordinatePolicy]: 'exactObjectPoint' } },
  { id: 'recFRESH', fields: { [F.poiId]: 'OSA-0010', [F.nameRu]: 'Свежий', [F.lat]: 34.75, [F.lon]: 135.55, [F.placeId]: 'PID-FRESH', [F.checkedAt]: FRESH, [F.coordinatePolicy]: 'exactObjectPoint' } },
  { id: 'recNOPID', fields: { [F.poiId]: 'OSA-0011', [F.nameRu]: 'Без place_id', [F.lat]: 34.76, [F.lon]: 135.56, [F.checkedAt]: STALE } },
]
const google = {
  'PID-PARK': GOOGLE_POINT,
  'PID-FEST': { lat: 34.68, lon: 135.49 },
  'PID-MUS': { lat: 34.7001, lon: 135.5101 },
  'PID-LEG': { lat: 34.7101, lon: 135.5201 },
  'PID-HALF': { lat: 34.72, lon: 135.53 },
  'PID-LN': { lat: 34.77, lon: 135.57 },
  'PID-UK': { lat: 34.73, lon: 135.53 },
  'PID-EC': { lat: 34.78, lon: 135.58 },
  'PID-FAR': { lat: 34.9, lon: 135.54 },
  'PID-FRESH': { lat: 34.75, lon: 135.55 },
}
const ELIGIBLE_STALE = ['recEX', 'recLG', 'recFAR']

/* ── 2. Крон: настоящий route.ts, fetch подменён ─────────────────────────── */
{
  register(new URL('./support/ts-alias-hooks.mjs', import.meta.url))
  process.env.CRON_SECRET = 'test-secret'
  process.env.AIRTABLE_TOKEN = 'test-token'
  process.env.GOOGLE_PLACES_API_KEY = 'test-key'
  const fx = installCoordsRefreshFetch({ records, google })
  let summary = null
  let status = null
  const log = console.log
  console.log = () => {}
  try {
    const { GET } = await import('../src/app/api/cron/refresh-coords/route.ts')
    const { NextRequest } = await import('next/server')
    const denied = await GET(new NextRequest('http://localhost/api/cron/refresh-coords'))
    t('крон: без секрета — 401', denied.status, 401)
    const res = await GET(new NextRequest('http://localhost/api/cron/refresh-coords', { headers: { authorization: 'Bearer test-secret' } }))
    status = res.status
    summary = await res.json()
  } catch (error) {
    // Падение production-кода — именованный провал, а не крах набора.
    t('крон: завершился без исключения', String(error?.message ?? error).slice(0, 160), 'ok')
    summary = {}
  } finally {
    fx.restore()
    console.log = log
  }
  t('крон: 200', status, 200)
  t('крон: ok', summary?.ok, true)
  const listing = fx.requests.find((r) => r.method === 'GET' && r.url.includes('api.airtable.com'))
  const asked = listing ? new URL(listing.url).searchParams.getAll('fields[]') : []
  t('крон: запрашивает Coordinate Policy', asked.includes(F.coordinatePolicy), true)
  t('крон: запрашивает все поля контракта', Object.values(IDS).every((id) => asked.includes(id)), true)
  const googleAsked = fx.requests.filter((r) => r.url.includes('places.googleapis.com')).map((r) => decodeURIComponent(new URL(r.url).pathname.split('/').pop()))
  t('крон: Google спрашивается ТОЛЬКО о подлежащих обновлению и просроченных', googleAsked.sort(), ['PID-FAR', 'PID-LEG', 'PID-MUS'])
  const written = Object.fromEntries(fx.written().map((r) => [r.id, r.fields]))
  t('крон: записаны ровно подлежащие обновлению', Object.keys(written).sort(), ELIGIBLE_STALE.sort())
  // КОНТРПРИМЕР: representativePoint не тронут — ни пара, ни отметка, ни политика.
  t('representativePoint: точка владельца сохранена', [fx.record('recRP')[F.lat], fx.record('recRP')[F.lon]], [OWNER_POINT.lat, OWNER_POINT.lon])
  t('representativePoint: отметка проверки не тронута', fx.record('recRP')[F.checkedAt], STALE)
  t('representativePoint: политика на месте', fx.record('recRP')[F.coordinatePolicy], 'representativePoint')
  t('representativePoint: PATCH по нему нет', 'recRP' in written, false)
  t('notApplicable: координаты не появились', [fx.record('recNA')[F.lat] ?? null, fx.record('recNA')[F.lon] ?? null], [null, null])
  t('половина пары: не дописана', fx.record('recHP')[F.lon] ?? null, null)
  t('legacy без пары: не заполнена', fx.record('recLN')[F.lat] ?? null, null)
  t('неизвестная политика: не тронута', fx.record('recUK')[F.lat], 34.73)
  t('exactObjectPoint без пары: не «починен»', fx.record('recEC')[F.lat] ?? null, null)
  t('без place_id: не тронут', fx.record('recNOPID')[F.lat], 34.76)
  t('свежий exactObjectPoint: не в очереди', 'recFRESH' in written, false)
  // Что записано — ровно plan.fields.
  t('exactObjectPoint: пара Google + отметка', Object.keys(written.recEX ?? {}).sort(), [IDS.checkedAt, IDS.lat, IDS.lon].sort())
  t('exactObjectPoint: широта Google', written.recEX?.[IDS.lat], 34.7001)
  t('legacy: пара Google + отметка, политика НЕ назначена', [Object.keys(written.recLG ?? {}).sort(), fx.record('recLG')[F.coordinatePolicy] ?? null], [[IDS.checkedAt, IDS.lat, IDS.lon].sort(), null])
  t('сдвиг > 3 км: только отметка', Object.keys(written.recFAR ?? {}), [IDS.checkedAt])
  t('сдвиг > 3 км: пара сохранена', fx.record('recFAR')[F.lat], 34.74)
  t('сдвиг > 3 км: в сводке', (summary.подозрительныйСдвиг ?? []).map((s) => s.poiId), ['OSA-0009'])
  t('сводка: просрочено = подлежащие и просроченные', summary.просрочено, 3)
  t('сводка: обновлено', summary.обновлено, 3)
  const skipped = Object.fromEntries((summary.пропущеноПоПолитике ?? []).map((s) => [s.refusal, s]))
  t('сводка: пропущено по политике — причины', Object.keys(skipped).sort(), ['halfPair', 'legacyNoCoordinates', 'notApplicable', 'policyContradictsCoords', 'representativePoint', 'unknownPolicy'])
  t('сводка: representativePoint назван', skipped.representativePoint?.sample, ['OSA-0001'])
  t('сводка: пропуск по политике — не «проблема»', summary.проблемы, [])
  // Идемпотентность: второй прогон сразу после первого ничего не пишет (всё свежее).
  const fx2 = installCoordsRefreshFetch({ records: records.map((r) => ({ ...r, fields: { ...r.fields, ...(written[r.id] ?? {}) } })), google })
  console.log = () => {}
  try {
    const { GET } = await import('../src/app/api/cron/refresh-coords/route.ts')
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://localhost/api/cron/refresh-coords', { headers: { authorization: 'Bearer test-secret' } }))
    const s2 = await res.json()
    t('повторный прогон: просрочено 0', s2.просрочено, 0)
    t('повторный прогон: PATCH нет', fx2.patches.length, 0)
    t('повторный прогон: пропущенные по политике по-прежнему видны', (s2.пропущеноПоПолитике ?? []).length, 6)
  } catch (error) {
    t('повторный прогон: завершился без исключения', String(error?.message ?? error).slice(0, 160), 'ok')
  } finally { fx2.restore(); console.log = log }
}

/* ── 3. Ручной скрипт: настоящий процесс, preload подменяет fetch ────────── */
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'jj-coords-refresh-'))
  const run = (args) => {
    const out = path.join(tmp, `out-${args.join('') || 'dry'}.json`)
    let stdout = ''
    let code = 0
    try {
      stdout = execFileSync(process.execPath, ['--import', './tests/support/coords-refresh-preload.mjs', 'scripts/refresh-google-coords.mjs', ...args], {
        cwd: REPO,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AIRTABLE_TOKEN: 'test-token', GOOGLE_PLACES_API_KEY: 'test-key', COORDS_REFRESH_FIXTURE: JSON.stringify({ records, google }), COORDS_REFRESH_OUT: out },
      })
    } catch (error) { code = error.status ?? 1; stdout = String(error.stdout ?? '') }
    return { code, stdout, result: JSON.parse(readFileSync(out, 'utf8')) }
  }
  try {
    const dry = run([])
    t('скрипт (показ): код 0', dry.code, 0)
    t('скрипт (показ): PATCH нет', dry.result.patches.length, 0)
    t('скрипт (показ): пропуск по политике виден (6)', /пропущено по политике:\s+6\b/.test(dry.stdout), true)
    has('скрипт (показ): representativePoint назван', dry.stdout, 'OSA-0001 Парк Осакадзё — representativePoint')
    has('скрипт (показ): сдвиг > 3 км назван (только отметка)', dry.stdout, 'OSA-0009 Переехал — ')
    has('скрипт (показ): показ различает пару/отметку/hold', dry.stdout, 'сдвиг больше 3 км (только отметка)')
    const dryGoogle = dry.result.requests.filter((r) => r.url.includes('places.googleapis.com')).map((r) => decodeURIComponent(new URL(r.url).pathname.split('/').pop()))
    t('скрипт: Google не спрашивается о пропущенных по политике', dryGoogle.sort(), ['PID-FAR', 'PID-FRESH', 'PID-LEG', 'PID-MUS'])
    const apply = run(['--apply'])
    t('скрипт (--apply): код 0', apply.code, 0)
    const written = Object.fromEntries(apply.result.written.map((r) => [r.id, r.fields]))
    // Одна семантика: все подлежащие обновлению пишутся — write (пара+отметка) и hold (только отметка).
    t('скрипт (--apply): записаны все подлежащие (write и hold)', Object.keys(written).sort(), ['recEX', 'recFAR', 'recFRESH', 'recLG'])
    t('скрипт (--apply): representativePoint — точка владельца сохранена', [apply.result.after.recRP[F.lat], apply.result.after.recRP[F.lon]], [OWNER_POINT.lat, OWNER_POINT.lon])
    t('скрипт (--apply): representativePoint не записан', 'recRP' in written, false)
    t('скрипт (--apply): notApplicable без координат', apply.result.after.recNA[F.lat] ?? null, null)
    t('скрипт (--apply): половина пары не дописана', apply.result.after.recHP[F.lon] ?? null, null)
    t('скрипт (--apply): write — поля ровно plan.fields', Object.keys(written.recEX ?? {}).sort(), [IDS.checkedAt, IDS.lat, IDS.lon].sort())
    t('скрипт (--apply): legacy — политика не назначена', apply.result.after.recLG[F.coordinatePolicy] ?? null, null)
    t('скрипт (--apply): hold (сдвиг > 3 км) — только отметка, пара сохранена', [Object.keys(written.recFAR ?? {}), apply.result.after.recFAR[F.lat]], [[IDS.checkedAt], 34.74])
    t('скрипт (--apply): неизменившийся свежий — пара + отметка (одна семантика)', Object.keys(written.recFRESH ?? {}).sort(), [IDS.checkedAt, IDS.lat, IDS.lon].sort())
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

/* ── 3б. Три случая на обеих writer-границах: гонка, повреждённая политика, hold/unchanged ── */
{
  const OWNER = { lat: 34.60, lon: 135.40 }
  const STALE2 = '2026-07-01T00:00:00.000Z'
  const mkRecords = () => [
    // Гонка: на момент чтения — legacy с парой (обновляемая); владелец успевает до PATCH.
    { id: 'recRACErp', fields: { [F.poiId]: 'RC-01', [F.nameRu]: 'гонка→RP', [F.lat]: 34.70, [F.lon]: 135.50, [F.placeId]: 'PID-RC1', [F.checkedAt]: STALE2 } },
    { id: 'recRACEna', fields: { [F.poiId]: 'RC-02', [F.nameRu]: 'гонка→NA', [F.lat]: 34.71, [F.lon]: 135.51, [F.placeId]: 'PID-RC2', [F.checkedAt]: STALE2 } },
    { id: 'recCTL', fields: { [F.poiId]: 'RC-03', [F.nameRu]: 'контроль', [F.lat]: 34.72, [F.lon]: 135.52, [F.placeId]: 'PID-CTL', [F.checkedAt]: STALE2, [F.coordinatePolicy]: 'exactObjectPoint' } },
    // Повреждённая политика.
    { id: 'recCnum', fields: { [F.poiId]: 'RC-04', [F.nameRu]: 'policy=7', [F.lat]: 34.73, [F.lon]: 135.53, [F.placeId]: 'PID-CN', [F.checkedAt]: STALE2, [F.coordinatePolicy]: 7 } },
    { id: 'recCarr', fields: { [F.poiId]: 'RC-05', [F.nameRu]: 'policy=[]', [F.lat]: 34.74, [F.lon]: 135.54, [F.placeId]: 'PID-CA', [F.checkedAt]: STALE2, [F.coordinatePolicy]: ['representativePoint'] } },
    { id: 'recCws', fields: { [F.poiId]: 'RC-06', [F.nameRu]: 'policy=«  »', [F.lat]: 34.75, [F.lon]: 135.55, [F.placeId]: 'PID-CW', [F.checkedAt]: STALE2, [F.coordinatePolicy]: '  ' } },
    // hold и неизменившаяся пара.
    { id: 'recHold2', fields: { [F.poiId]: 'RC-07', [F.nameRu]: 'сдвиг 17 км', [F.lat]: 34.76, [F.lon]: 135.56, [F.placeId]: 'PID-HD', [F.checkedAt]: STALE2, [F.coordinatePolicy]: 'exactObjectPoint' } },
    { id: 'recSame2', fields: { [F.poiId]: 'RC-08', [F.nameRu]: 'та же точка', [F.lat]: 34.77, [F.lon]: 135.57, [F.placeId]: 'PID-SM', [F.checkedAt]: STALE2, [F.coordinatePolicy]: 'exactObjectPoint' } },
  ]
  const google2 = {
    'PID-RC1': { lat: 34.7005, lon: 135.5005 }, 'PID-RC2': { lat: 34.7105, lon: 135.5105 }, 'PID-CTL': { lat: 34.7205, lon: 135.5205 },
    'PID-CN': { lat: 34.7305, lon: 135.5305 }, 'PID-CA': { lat: 34.7405, lon: 135.5405 }, 'PID-CW': { lat: 34.7505, lon: 135.5505 },
    'PID-HD': { lat: 34.92, lon: 135.56 }, 'PID-SM': { lat: 34.77, lon: 135.57 },
  }
  // Владелец вмешивается после первого запроса к Google — то есть после чтения писателя, до PATCH.
  const intervene = () => { let done = false; return (req, api) => {
    if (done || req.host !== 'places.googleapis.com') return
    done = true
    api.set('recRACErp', { [F.coordinatePolicy]: 'representativePoint', [F.lat]: OWNER.lat, [F.lon]: OWNER.lon })
    api.set('recRACEna', { [F.coordinatePolicy]: 'notApplicable', [F.lat]: null, [F.lon]: null })
  } }

  // ── Крон: настоящий route.ts ──
  {
    process.env.CRON_SECRET = 'test-secret'; process.env.AIRTABLE_TOKEN = 'test-token'; process.env.GOOGLE_PLACES_API_KEY = 'test-key'
    const records2 = mkRecords()
    const fx = installCoordsRefreshFetch({ records: records2, google: google2, onRequest: intervene() })
    let summary = {}
    const log = console.log; console.log = () => {}
    try {
      const { GET } = await import('../src/app/api/cron/refresh-coords/route.ts')
      const { NextRequest } = await import('next/server')
      const res = await GET(new NextRequest('http://localhost/api/cron/refresh-coords', { headers: { authorization: 'Bearer test-secret' } }))
      summary = await res.json()
    } catch (error) { t('крон-3б: без исключения', String(error?.message ?? error).slice(0, 160), 'ok') } finally { fx.restore(); console.log = log }
    const written = Object.fromEntries(fx.written().map((r) => [r.id, r.fields]))
    // Свежее чтение перед PATCH существует и ограничено RECORD_ID() (не полный скан).
    const airtableGets = fx.requests.filter((r) => r.method === 'GET' && r.url.includes('api.airtable.com'))
    const freshReads = airtableGets.filter((r) => new URL(r.url).searchParams.has('filterByFormula'))
    t('крон: перед записью есть свежее чтение с filterByFormula', freshReads.length >= 1, true)
    t('крон: свежее чтение ограничено RECORD_ID()', freshReads.every((r) => /RECORD_ID\(\)=/.test(decodeURIComponent(new URL(r.url).searchParams.get('filterByFormula')))), true)
    t('крон: первичный листинг НЕ ограничен formula (полный обход очереди)', new URL(airtableGets[0].url).searchParams.has('filterByFormula'), false)
    // 1. Гонка: решение владельца, принятое после чтения, НЕ затёрто.
    t('крон/гонка: representativePoint не записан', 'recRACErp' in written, false)
    t('крон/гонка: точка владельца сохранена', [fx.record('recRACErp')[F.lat], fx.record('recRACErp')[F.lon]], [OWNER.lat, OWNER.lon])
    t('крон/гонка: политика владельца сохранена', fx.record('recRACErp')[F.coordinatePolicy], 'representativePoint')
    t('крон/гонка: notApplicable не записан', 'recRACEna' in written, false)
    t('крон/гонка: notApplicable без координат', fx.record('recRACEna')[F.lat] ?? null, null)
    t('крон/гонка: отложено, а не проблема', (summary.отложено ?? []).map((x) => x.poiId).sort(), ['RC-01', 'RC-02'])
    t('крон/гонка: сообщение называет changedSinceRead-поля', /изменилась после чтения/.test((summary.отложено ?? [])[0]?.why ?? ''), true)
    t('крон/контроль (без гонки) записан', 'recCTL' in written, true)
    // 2. Повреждённая политика: именованный отказ, не запись.
    for (const id of ['recCnum', 'recCarr', 'recCws']) t(`крон/повреждённая ${id}: не записана`, id in written, false)
    for (const id of ['recCnum', 'recCarr', 'recCws']) t(`крон/повреждённая ${id}: пара не тронута`, fx.record(id)[F.lat], mkRecords().find((r) => r.id === id).fields[F.lat])
    const corrupt = (summary.пропущеноПоПолитике ?? []).find((x) => x.refusal === 'corruptPolicy')
    t('крон/повреждённая: причина corruptPolicy, счёт 3', corrupt?.count, 3)
    t('крон/повреждённая: не legacyGoogleCache', (summary.пропущеноПоПолитике ?? []).some((x) => x.refusal === 'unknownPolicy'), false)
    // 3. hold и неизменившаяся пара: каждый writer исполняет plan.fields.
    t('крон/hold: только отметка', Object.keys(written.recHold2 ?? {}), [IDS.checkedAt])
    t('крон/hold: пара сохранена', fx.record('recHold2')[F.lat], 34.76)
    t('крон/hold: в подозрительных', (summary.подозрительныйСдвиг ?? []).map((x) => x.poiId), ['RC-07'])
    t('крон/unchanged: пара + отметка (одна семантика)', Object.keys(written.recSame2 ?? {}).sort(), [IDS.checkedAt, IDS.lat, IDS.lon].sort())
  }

  // ── Скрипт: настоящий процесс, preload вмешивается после Google ──
  {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'jj-refresh-3b-'))
    const out = path.join(tmp, 'out.json')
    let stdout = ''
    let code = 0
    try {
      stdout = execFileSync(process.execPath, ['--import', './tests/support/coords-refresh-preload.mjs', 'scripts/refresh-google-coords.mjs', '--apply'], {
        cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AIRTABLE_TOKEN: 'test-token', GOOGLE_PLACES_API_KEY: 'test-key',
          COORDS_REFRESH_FIXTURE: JSON.stringify({ records: mkRecords(), google: google2, ownerIntervenes: { after: 'google', set: { recRACErp: { [F.coordinatePolicy]: 'representativePoint', [F.lat]: OWNER.lat, [F.lon]: OWNER.lon }, recRACEna: { [F.coordinatePolicy]: 'notApplicable', [F.lat]: null, [F.lon]: null } } } }),
          COORDS_REFRESH_OUT: out },
      })
    } catch (error) { code = error.status ?? 1; stdout = String(error.stdout ?? '') + String(error.stderr ?? '') }
    const r = JSON.parse(readFileSync(out, 'utf8'))
    rmSync(tmp, { recursive: true, force: true })
    t('скрипт-3б: код 0', code, 0)
    const written = Object.fromEntries(r.written.map((x) => [x.id, x.fields]))
    t('скрипт/гонка: representativePoint не записан', 'recRACErp' in written, false)
    t('скрипт/гонка: точка владельца сохранена', r.after.recRACErp[F.lat], OWNER.lat)
    t('скрипт/гонка: notApplicable не записан', 'recRACEna' in written, false)
    has('скрипт/гонка: отложено после свежего чтения', stdout, 'отложено')
    for (const id of ['recCnum', 'recCarr', 'recCws']) t(`скрипт/повреждённая ${id}: не записана`, id in written, false)
    has('скрипт/повреждённая: corruptPolicy назван', stdout, 'corruptPolicy')
    t('скрипт/hold: только отметка', Object.keys(written.recHold2 ?? {}), [IDS.checkedAt])
    t('скрипт/hold: пара сохранена', r.after.recHold2[F.lat], 34.76)
    t('скрипт/unchanged: пара + отметка (одна семантика)', Object.keys(written.recSame2 ?? {}).sort(), [IDS.checkedAt, IDS.lat, IDS.lon].sort())
    t('скрипт/контроль записан', 'recCTL' in written, true)
    const sFreshReads = r.requests.filter((q) => q.method === 'GET' && q.url.includes('api.airtable.com') && new URL(q.url).searchParams.has('filterByFormula'))
    t('скрипт: перед записью есть свежее чтение с filterByFormula', sFreshReads.length >= 1, true)
    t('скрипт: свежее чтение ограничено RECORD_ID()', sFreshReads.every((q) => /RECORD_ID\(\)=/.test(decodeURIComponent(new URL(q.url).searchParams.get('filterByFormula')))), true)
  }
}

/* ── 3в. Круг 3: итог только по чтению после PATCH; брошенные значения на границах ── */
{
  // Контракт: classifyPatchOutcome — сверяется КАЖДОЕ поле plan.fields, включая отметку.
  const rec = (over) => ({ coordinatePolicy: 'exactObjectPoint', lat: 34.7, lon: 135.5, placeId: 'PID', checkedAt: '2026-07-01T00:00:00.000Z', ...over })
  const wplan = previewCoordinateRefresh(rec({}), { lat: 34.7001, lon: 135.5001 }, AT)
  const stamped = (over) => rec({ checkedAt: AT, ...over })
  t('outcome: write применён как в плане (пара + отметка) — verified', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: stamped({ lat: 34.7001, lon: 135.5001 }), patchAccepted: true }).kind, 'verified')
  {
    const o = classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: stamped({ coordinatePolicy: 'representativePoint', lat: 34.7001, lon: 135.5001 }), patchAccepted: true })
    t('outcome: write, но политика сменилась при PATCH — recoveryRequired/outcomeMismatch', [o.kind, o.refusal, o.mismatched], ['recoveryRequired', 'outcomeMismatch', ['coordinatePolicy']])
  }
  t('outcome: write, пара в итоге чужая — mismatch lat/lon', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: stamped({ lat: 34.60, lon: 135.40 }), patchAccepted: true }).mismatched, ['lat', 'lon'])
  t('outcome: write, place_id сменился — mismatch placeId', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: stamped({ lat: 34.7001, lon: 135.5001, placeId: 'OTHER' }), patchAccepted: true }).mismatched, ['placeId'])
  t('outcome: PATCH принят, но ничего не применилось — recoveryRequired (не notApplied)', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: rec({}), patchAccepted: true }).kind, 'recoveryRequired')
  t('outcome: PATCH не принят и запись не изменилась (включая отметку) — notApplied', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: rec({}), patchAccepted: false }).kind, 'notApplied')
  t('outcome: PATCH не принят, пара прежняя, но отметка чужая — recoveryRequired, не notApplied', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: rec({ checkedAt: '2026-08-01T00:00:00.000Z' }), patchAccepted: false }).kind, 'recoveryRequired')
  t('outcome: PATCH не принят, но запись изменилась чужой правкой — recoveryRequired', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: rec({ coordinatePolicy: 'notApplicable', lat: null, lon: null }), patchAccepted: false }).kind, 'recoveryRequired')
  t('outcome: итоговое чтение недоступно — outcomeUnverified', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: null, patchAccepted: true }).refusal, 'outcomeUnverified')
  const hplan = previewCoordinateRefresh(rec({}), { lat: 34.9, lon: 135.5 }, AT)
  t('outcome: hold — пара как ДО записи, отметка из плана → verified', [hplan.kind, classifyPatchOutcome({ plan: hplan, fresh: rec({}), after: stamped({}), patchAccepted: true }).kind], ['hold', 'verified'])
  t('outcome: hold — пара изменилась → mismatch lat', classifyPatchOutcome({ plan: hplan, fresh: rec({}), after: stamped({ lat: 34.9 }), patchAccepted: true }).mismatched, ['lat'])
  // Отметка — единственное записываемое поле hold: старая отметка после PATCH — расхождение, не успех.
  t('outcome: hold — вернулась СТАРАЯ отметка → outcomeMismatch [checkedAt]', classifyPatchOutcome({ plan: hplan, fresh: rec({}), after: rec({}), patchAccepted: true }), { kind: 'recoveryRequired', refusal: 'outcomeMismatch', mismatched: ['checkedAt'], message: classifyPatchOutcome({ plan: hplan, fresh: rec({}), after: rec({}), patchAccepted: true }).message })
  t('outcome: write — вернулась СТАРАЯ отметка при верной паре → mismatch [checkedAt]', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: rec({ lat: 34.7001, lon: 135.5001 }), patchAccepted: true }).mismatched, ['checkedAt'])
  t('outcome: отметка отсутствует после PATCH → mismatch [checkedAt]', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: rec({ lat: 34.7001, lon: 135.5001, checkedAt: undefined }), patchAccepted: true }).mismatched, ['checkedAt'])
  t('outcome: отметка — иная запись ТОГО ЖЕ момента (без миллисекунд) → verified', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: stamped({ lat: 34.7001, lon: 135.5001, checkedAt: AT.replace('.000Z', 'Z') }), patchAccepted: true }).kind, 'verified')
  t('outcome: отметка — тот же момент в другой зоне → verified', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: stamped({ lat: 34.7001, lon: 135.5001, checkedAt: '2026-09-03T21:00:00+09:00' }), patchAccepted: true }).kind, 'verified')
  t('outcome: отметка — момент на секунду позже → mismatch', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: stamped({ lat: 34.7001, lon: 135.5001, checkedAt: '2026-09-03T12:00:01.000Z' }), patchAccepted: true }).mismatched, ['checkedAt'])
  t('outcome: отметка — нестрогая строка даты → mismatch', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: stamped({ lat: 34.7001, lon: 135.5001, checkedAt: '2026-09-03' }), patchAccepted: true }).mismatched, ['checkedAt'])
  t('outcome: сравнение после канонизации (7 знаков)', classifyPatchOutcome({ plan: wplan, fresh: rec({}), after: stamped({ lat: 34.70010000004, lon: 135.50010000004 }), patchAccepted: true }).kind, 'verified')
  // Строгий разбор момента и отметка целыми секундами.
  t('parseMoment: строгий ISO с Z', parseMoment('2026-09-03T12:00:00.000Z'), Date.parse('2026-09-03T12:00:00.000Z'))
  t('parseMoment: без долей секунды', parseMoment('2026-09-03T12:00:00Z'), Date.parse('2026-09-03T12:00:00.000Z'))
  t('parseMoment: смещение зоны', parseMoment('2026-09-03T21:00:00+09:00'), Date.parse('2026-09-03T12:00:00.000Z'))
  t('parseMoment: только дата → null', parseMoment('2026-09-03'), null)
  t('parseMoment: не строка → null', parseMoment(1756900000000), null)
  t('parseMoment: невалидная дата → null', parseMoment('2026-13-40T99:00:00Z'), null)
  t('parseMoment: произвольный текст → null', parseMoment('вчера'), null)
  // Календарная строгость (круг 5): невозможная дата не нормализуется в соседнюю, а отвергается — до сравнения по значению.
  t('parseMoment: 31 февраля → null (Date.parse дал бы 3 марта)', parseMoment('2026-02-31T12:00:00Z'), null)
  t('parseMoment: 31 апреля → null', parseMoment('2026-04-31T12:00:00Z'), null)
  t('parseMoment: 29 февраля невисокосного 2025 → null', parseMoment('2025-02-29T12:00:00Z'), null)
  t('parseMoment: 29 февраля 2100 (делится на 100, не на 400) → null', parseMoment('2100-02-29T12:00:00Z'), null)
  t('parseMoment: 29 февраля 2024 (високосный) проходит', parseMoment('2024-02-29T12:00:00Z'), Date.UTC(2024, 1, 29, 12, 0, 0))
  t('parseMoment: 29 февраля 2000 (делится на 400) проходит', parseMoment('2000-02-29T12:00:00Z'), Date.UTC(2000, 1, 29, 12, 0, 0))
  t('parseMoment: месяц 13 → null', parseMoment('2026-13-01T12:00:00Z'), null)
  t('parseMoment: день 00 → null', parseMoment('2026-09-00T12:00:00Z'), null)
  t('parseMoment: час 24 → null', parseMoment('2026-09-03T24:00:00Z'), null)
  t('parseMoment: минута 60 → null', parseMoment('2026-09-03T12:60:00Z'), null)
  t('parseMoment: секунда 60 → null', parseMoment('2026-09-03T12:00:60Z'), null)
  t('parseMoment: смещение +24:00 → null', parseMoment('2026-09-03T12:00:00+24:00'), null)
  t('parseMoment: смещение +00:60 → null', parseMoment('2026-09-03T12:00:00+00:60'), null)
  t('parseMoment: отрицательное смещение считается арифметикой', parseMoment('2026-09-03T07:00:00-05:00'), Date.UTC(2026, 8, 3, 12, 0, 0))
  t('parseMoment: доли секунды дополняются до миллисекунд', parseMoment('2026-09-03T12:00:00.5Z'), Date.UTC(2026, 8, 3, 12, 0, 0, 500))
  t('parseMoment: не опирается на Date.parse — совпадение с Date.UTC на валидной дате', parseMoment('2026-03-03T12:00:00Z'), Date.UTC(2026, 2, 3, 12, 0, 0))
  {
    // Невозможная дата, которую Date.parse нормализует ровно в ожидаемый момент, — расхождение, не успех.
    const real = '2026-03-03T12:00:00.000Z'
    const impossible = '2026-02-31T12:00:00.000Z'
    t('контроль: Date.parse считает 31 февраля 3 марта', Date.parse(impossible), Date.parse(real))
    const planReal = previewCoordinateRefresh(rec({}), { lat: 34.7001, lon: 135.5001 }, real)
    t('outcome: после PATCH вернулась невозможная дата, совпадающая по Date.parse → outcomeMismatch [checkedAt]', classifyPatchOutcome({ plan: planReal, fresh: rec({}), after: rec({ lat: 34.7001, lon: 135.5001, checkedAt: impossible }), patchAccepted: true }).mismatched, ['checkedAt'])
    t('план с невозможной датой не строится — checkedAtInvalid', previewCoordinateRefresh(rec({}), { lat: 34.7001, lon: 135.5001 }, impossible).refusal, 'checkedAtInvalid')
    t('план с 29 февраля невисокосного года — checkedAtInvalid', previewCoordinateRefresh(rec({}), { lat: 34.7001, lon: 135.5001 }, '2025-02-29T12:00:00Z').refusal, 'checkedAtInvalid')
  }
  t('checkedAtMoment: целые секунды', checkedAtMoment(new Date('2026-09-03T12:00:00.789Z')), '2026-09-03T12:00:00.000Z')
  t('план с нестрогим моментом не строится — checkedAtInvalid', previewCoordinateRefresh(rec({}), { lat: 34.7001, lon: 135.5001 }, '2026-09-03').refusal, 'checkedAtInvalid')

  const OWNER = { lat: 34.60, lon: 135.40 }
  const STALE3 = '2026-07-01T00:00:00.000Z'
  const mk = () => [
    { id: 'recLATE', fields: { [F.poiId]: 'RC3-01', [F.nameRu]: 'владелец при PATCH', [F.lat]: 34.70, [F.lon]: 135.51, [F.placeId]: 'PID-L1', [F.checkedAt]: STALE3, [F.coordinatePolicy]: 'exactObjectPoint' } },
    { id: 'recCTL3', fields: { [F.poiId]: 'RC3-02', [F.nameRu]: 'контроль', [F.lat]: 34.72, [F.lon]: 135.52, [F.placeId]: 'PID-CTL3', [F.checkedAt]: STALE3, [F.coordinatePolicy]: 'exactObjectPoint' } },
  ]
  const google3 = { 'PID-L1': { lat: 34.7001, lon: 135.5101 }, 'PID-CTL3': { lat: 34.7205, lon: 135.5205 } }
  const ownerAtPatch = (req, api) => { if (req.method === 'PATCH') api.set('recLATE', { [F.coordinatePolicy]: 'representativePoint', [F.lat]: OWNER.lat, [F.lon]: OWNER.lon }) }
  const isFreshRead = (req) => req.method === 'GET' && req.host === 'api.airtable.com' && req.url.searchParams.has('filterByFormula')
  // Для записанных запросов (url — строка):
  const isFreshReadStored = (q) => q.method === 'GET' && q.url.includes('api.airtable.com') && q.url.includes('filterByFormula')
  const hostile = {
    'отозванный Proxy': () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy },
    null: () => null,
    Symbol: () => Symbol('x'),
    'бросающий getter': () => ({ get message() { throw new Error('getter') }, get name() { throw new Error('getter') }, get stack() { throw new Error('getter') } }),
  }
  process.env.CRON_SECRET = 'test-secret'; process.env.AIRTABLE_TOKEN = 'test-token'; process.env.GOOGLE_PLACES_API_KEY = 'test-key'
  const callCron = async () => {
    const { GET } = await import('../src/app/api/cron/refresh-coords/route.ts')
    const { NextRequest } = await import('next/server')
    const log = console.log; const err = console.error; console.log = () => {}; console.error = () => {}
    try {
      const res = await GET(new NextRequest('http://localhost/api/cron/refresh-coords', { headers: { authorization: 'Bearer test-secret' } }))
      return { status: res.status, body: await res.json() }
    } catch (error) { return { threw: `${typeof error}` } } finally { console.log = log; console.error = err }
  }

  // ── Крон: владелец при PATCH ──
  {
    const fx = installCoordsRefreshFetch({ records: mk(), google: google3, onRequest: ownerAtPatch })
    let r
    try { r = await callCron() } finally { fx.restore() }
    t('крон/при PATCH: без исключения', r.threw ?? null, null)
    t('крон/при PATCH: HTTP 500 — успех не объявлен', r.status, 500)
    t('крон/при PATCH: ok=false, recoveryRequired=true', [r.body?.ok, r.body?.recoveryRequired], [false, true])
    t('крон/при PATCH: затронутая запись перечислена с record ID', (r.body?.требуетВосстановления ?? []).map((x) => [x.recordId, x.poiId, x.refusal, x.mismatched]), [['recLATE', 'RC3-01', 'outcomeMismatch', ['coordinatePolicy']]])
    t('крон/при PATCH: ровно один PATCH (ни повтора, ни отката, ни исправления)', fx.patches.length, 1)
    t('крон/при PATCH: контроль подтверждён чтением', r.body?.обновлено, 1)
    const reads = fx.requests.filter(isFreshReadStored)
    t('крон/при PATCH: после PATCH есть независимое чтение тех же записей', reads.length >= 2 && fx.requests.findIndex((q) => q.method === 'PATCH') < fx.requests.length - 1 && isFreshReadStored(fx.requests[fx.requests.length - 1]), true)
    t('крон/при PATCH: смешанное состояние оставлено человеку (не «исправлено»)', [fx.record('recLATE')[F.coordinatePolicy], fx.record('recLATE')[F.lat]], ['representativePoint', 34.7001])
  }
  // ── Крон: контроль без вмешательства — успех, recoveryRequired=false ──
  {
    const fx = installCoordsRefreshFetch({ records: mk(), google: google3 })
    let r
    try { r = await callCron() } finally { fx.restore() }
    t('крон/без гонки: 200, ok, recoveryRequired=false', [r.status, r.body?.ok, r.body?.recoveryRequired, r.body?.обновлено], [200, true, false, 2])
    t('крон/без гонки: обновлено = подтверждено чтением (два чтения вокруг PATCH)', fx.requests.filter(isFreshReadStored).length, 2)
  }
  // ── Крон: брошенные значения на границе СВЕЖЕГО чтения ──
  for (const [name, make] of Object.entries(hostile)) {
    const fx = installCoordsRefreshFetch({ records: mk(), google: google3, onRequest: (req) => { if (isFreshRead(req)) throw make() } })
    let r
    try { r = await callCron() } finally { fx.restore() }
    t(`крон/свежее чтение бросает ${name}: не покидает роут`, r.threw ?? null, null)
    t(`крон/свежее чтение бросает ${name}: freshReadUnavailable, PATCH нет`, [r.status, r.body?.ok, (r.body?.отложено ?? []).length, fx.patches.length], [200, true, 2, 0])
  }
  // ── Крон: брошенные значения на границе ИТОГОВОГО чтения (после PATCH) ──
  for (const [name, make] of Object.entries(hostile)) {
    let freshReads = 0
    const fx = installCoordsRefreshFetch({ records: mk(), google: google3, onRequest: (req) => { if (isFreshRead(req)) { freshReads += 1; if (freshReads === 2) throw make() } } })
    let r
    try { r = await callCron() } finally { fx.restore() }
    t(`крон/итоговое чтение бросает ${name}: не покидает роут`, r.threw ?? null, null)
    t(`крон/итоговое чтение бросает ${name}: outcomeUnverified для всей пачки, успех не объявлен`, [r.status, r.body?.recoveryRequired, (r.body?.требуетВосстановления ?? []).map((x) => x.refusal)], [500, true, ['outcomeUnverified', 'outcomeUnverified']])
    t(`крон/итоговое чтение бросает ${name}: PATCH ровно один`, fx.patches.length, 1)
  }
  // ── Крон: PATCH сам бросает (ответа нет) — итог только чтением ──
  {
    const fx = installCoordsRefreshFetch({ records: mk(), google: google3, onRequest: (req) => { if (req.method === 'PATCH') throw hostile['отозванный Proxy']() } })
    let r
    try { r = await callCron() } finally { fx.restore() }
    t('крон/PATCH бросает: не покидает роут; запись не изменилась → notApplied, не recovery', [r.threw ?? null, r.status, r.body?.recoveryRequired, (r.body?.проблемы ?? []).length], [null, 200, false, 2])
  }

  // ── Скрипт: владелец при PATCH; итоговое чтение бросает ──
  const runScript = (fixture) => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'jj-refresh-3v-'))
    const out = path.join(tmp, 'out.json')
    let stdout = ''
    let code = 0
    try {
      stdout = execFileSync(process.execPath, ['--import', './tests/support/coords-refresh-preload.mjs', 'scripts/refresh-google-coords.mjs', '--apply'], {
        cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AIRTABLE_TOKEN: 'test-token', GOOGLE_PLACES_API_KEY: 'test-key', COORDS_REFRESH_FIXTURE: JSON.stringify(fixture), COORDS_REFRESH_OUT: out },
      })
    } catch (error) { code = error.status ?? 1; stdout = String(error.stdout ?? '') + String(error.stderr ?? '') }
    const result = JSON.parse(readFileSync(out, 'utf8'))
    rmSync(tmp, { recursive: true, force: true })
    return { code, stdout, result }
  }
  {
    const r = runScript({ records: mk(), google: google3, ownerIntervenes: { after: 'patch', set: { recLATE: { [F.coordinatePolicy]: 'representativePoint', [F.lat]: OWNER.lat, [F.lon]: OWNER.lon } } } })
    t('скрипт/при PATCH: код 1 — успех не объявлен', r.code, 1)
    has('скрипт/при PATCH: ТРЕБУЕТСЯ ВОССТАНОВЛЕНИЕ с record ID', r.stdout, 'recLATE RC3-01')
    has('скрипт/при PATCH: причина названа', r.stdout, 'outcomeMismatch (coordinatePolicy)')
    t('скрипт/при PATCH: ровно один PATCH', r.result.patches.length, 1)
    t('скрипт/при PATCH: смешанное состояние оставлено человеку', [r.result.after.recLATE[F.coordinatePolicy], r.result.after.recLATE[F.lat]], ['representativePoint', 34.7001])
    t('скрипт/при PATCH: после PATCH есть независимое чтение', r.result.requests.filter((q) => q.method === 'GET' && q.url.includes('filterByFormula')).length, 2)
  }
  {
    const r = runScript({ records: mk(), google: google3, throwOn: { which: 'freshRead', nth: 2, kind: 'revokedProxy' } })
    t('скрипт/итоговое чтение бросает отозванный Proxy: код 1, outcomeUnverified, скрипт не упал', [r.code, /outcomeUnverified/.test(r.stdout), /TypeError|Cannot perform/.test(r.stdout)], [1, true, false])
  }
  {
    const r = runScript({ records: mk(), google: google3, throwOn: { which: 'freshRead', nth: 1, kind: 'revokedProxy' } })
    t('скрипт/свежее чтение бросает отозванный Proxy: код 0, отложено, PATCH нет', [r.code, /отложено/.test(r.stdout), r.result.patches.length], [0, true, 0])
  }
  {
    const r = runScript({ records: mk(), google: google3 })
    t('скрипт/без гонки: код 0, подтверждено чтением 2 из 2', [r.code, /подтверждено чтением: 2 из 2/.test(r.stdout)], [0, true])
  }
  {
    // Граница первичного чтения: брошенный отозванный Proxy описывается безопасно, скрипт завершается именованно (код 2), не падает сырым TypeError.
    const r = runScript({ records: mk(), google: google3, throwOn: { which: 'listing', nth: 1, kind: 'revokedProxy' } })
    t('скрипт/первичное чтение бросает отозванный Proxy: код 2, описано безопасно, без сырого TypeError', [r.code, /брошено значение типа object/.test(r.stdout), /Cannot perform|TypeError/.test(r.stdout)], [2, true, false])
  }
  {
    const r = runScript({ records: mk(), google: google3, throwOn: { which: 'patch', nth: 1, kind: 'revokedProxy' } })
    t('скрипт/PATCH бросает отозванный Proxy: не упал; запись не изменилась → не принято, код 0', [r.code, /не принято: 2/.test(r.stdout), /Cannot perform/.test(r.stdout)], [0, true, false])
  }
}

/* ── 3г. Круг 4: хвост после recoveryRequired не пишется; отметка сверяется ── */
{
  const STALE4 = '2026-07-01T00:00:00.000Z'
  const N = 11 // REFRESH_BATCH_SIZE + 1: расхождение в первой пачке — одиннадцатая запись не должна попасть во второй PATCH
  const many = () => Array.from({ length: N }, (_, i) => ({ id: `recSTOP${i}`, fields: { [F.poiId]: `ST-${i}`, [F.nameRu]: `запись ${i}`, [F.lat]: 34.7 + i / 1000, [F.lon]: 135.5 + i / 1000, [F.placeId]: `PID-ST${i}`, [F.checkedAt]: STALE4, [F.coordinatePolicy]: 'exactObjectPoint' } }))
  const googleMany = Object.fromEntries(Array.from({ length: N }, (_, i) => [`PID-ST${i}`, { lat: 34.7 + i / 1000 + 0.0001, lon: 135.5 + i / 1000 + 0.0001 }]))
  const one = (policy) => [{ id: 'recTS', fields: { [F.poiId]: 'TS-01', [F.nameRu]: 'отметка', [F.lat]: 34.7, [F.lon]: 135.5, [F.placeId]: 'PID-TS', [F.checkedAt]: STALE4, [F.coordinatePolicy]: policy } }]
  const isFresh = (req) => req.method === 'GET' && req.host === 'api.airtable.com' && req.url.searchParams.has('filterByFormula')
  const ownerAtFirstPatch = () => { let done = false; return (req, api) => { if (req.method === 'PATCH' && !done) { done = true; api.set('recSTOP0', { [F.coordinatePolicy]: 'representativePoint', [F.lat]: 34.6, [F.lon]: 135.4 }) } } }
  const restoreOldStamp = () => { let n = 0; return (req, api) => { if (isFresh(req)) { n += 1; if (n === 2) api.set('recTS', { [F.checkedAt]: STALE4 }) } } }
  process.env.CRON_SECRET = 'test-secret'; process.env.AIRTABLE_TOKEN = 'test-token'; process.env.GOOGLE_PLACES_API_KEY = 'test-key'
  const callCron = async () => {
    const { GET } = await import('../src/app/api/cron/refresh-coords/route.ts')
    const { NextRequest } = await import('next/server')
    const log = console.log; const err = console.error; console.log = () => {}; console.error = () => {}
    try { const res = await GET(new NextRequest('http://localhost/api/cron/refresh-coords', { headers: { authorization: 'Bearer test-secret' } })); return { status: res.status, body: await res.json() } } catch (error) { return { threw: `${typeof error}` } } finally { console.log = log; console.error = err }
  }

  // ── Крон: P0 — хвост не пишется ──
  {
    const fx = installCoordsRefreshFetch({ records: many(), google: googleMany, onRequest: ownerAtFirstPatch() })
    let r; try { r = await callCron() } finally { fx.restore() }
    t('крон/хвост: 500, recoveryRequired', [r.status, r.body?.recoveryRequired], [500, true])
    t('крон/хвост: ровно один PATCH — второй пачки нет', fx.patches.length, 1)
    t('крон/хвост: одиннадцатая запись не записана', fx.patches.flatMap((b) => b.records.map((x) => x.id)).includes('recSTOP10'), false)
    t('крон/хвост: вся первая пачка классифицирована (9 verified + 1 recovery)', [r.body?.обновлено, (r.body?.требуетВосстановления ?? []).map((x) => x.recordId)], [9, ['recSTOP0']])
    t('крон/хвост: остановка описана', [r.body?.остановлено?.послеПачки, r.body?.остановлено?.необработано, r.body?.остановлено?.записи], [1, 1, ['ST-10']])
    t('крон/хвост: одиннадцатая запись осталась нетронутой', fx.record('recSTOP10')[F.checkedAt], STALE4)
    t('крон/хвост: после PATCH ровно одно итоговое чтение, второго свежего чтения нет', fx.requests.filter((q) => q.method === 'GET' && q.url.includes('filterByFormula')).length, 2)
  }
  // ── Крон: контроль — без расхождения обе пачки пишутся ──
  {
    const fx = installCoordsRefreshFetch({ records: many(), google: googleMany })
    let r; try { r = await callCron() } finally { fx.restore() }
    t('крон/хвост-контроль: две пачки, 11 подтверждено, остановки нет', [fx.patches.length, r.body?.обновлено, r.body?.остановлено], [2, 11, null])
  }
  // ── Крон: P1 — старая отметка после PATCH: write и hold ──
  for (const [name, google] of [['write', { 'PID-TS': { lat: 34.7001, lon: 135.5001 } }], ['hold', { 'PID-TS': { lat: 34.9, lon: 135.5 } }]]) {
    const fx = installCoordsRefreshFetch({ records: one('exactObjectPoint'), google, onRequest: restoreOldStamp() })
    let r; try { r = await callCron() } finally { fx.restore() }
    t(`крон/старая отметка (${name}): 500, recoveryRequired, обновлено 0`, [r.status, r.body?.recoveryRequired, r.body?.обновлено], [500, true, 0])
    t(`крон/старая отметка (${name}): outcomeMismatch [checkedAt]`, (r.body?.требуетВосстановления ?? []).map((x) => [x.recordId, x.refusal, x.mismatched]), [['recTS', 'outcomeMismatch', ['checkedAt']]])
    t(`крон/старая отметка (${name}): ровно один PATCH, без исправления`, [fx.patches.length, fx.record('recTS')[F.checkedAt]], [1, STALE4])
  }
  // ── Крон: контроль — честное хранилище: отметка целыми секундами совпадает по значению ──
  {
    const fx = installCoordsRefreshFetch({ records: one('exactObjectPoint'), google: { 'PID-TS': { lat: 34.9, lon: 135.5 } } })
    let r; try { r = await callCron() } finally { fx.restore() }
    const stamp = fx.written()[0]?.fields?.[IDS.checkedAt]
    t('крон/hold-контроль: подтверждено чтением, отметка из плана', [r.status, r.body?.обновлено, fx.record('recTS')[F.checkedAt] === stamp], [200, 1, true])
    t('крон/отметка ставится целыми секундами', typeof stamp === 'string' && /\.000Z$/.test(stamp), true)
  }

  // ── Скрипт ──
  const runScript = (fixture) => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'jj-refresh-3g-'))
    const out = path.join(tmp, 'out.json')
    let stdout = ''
    let code = 0
    try {
      stdout = execFileSync(process.execPath, ['--import', './tests/support/coords-refresh-preload.mjs', 'scripts/refresh-google-coords.mjs', '--apply'], {
        cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AIRTABLE_TOKEN: 'test-token', GOOGLE_PLACES_API_KEY: 'test-key', COORDS_REFRESH_FIXTURE: JSON.stringify(fixture), COORDS_REFRESH_OUT: out },
      })
    } catch (error) { code = error.status ?? 1; stdout = String(error.stdout ?? '') + String(error.stderr ?? '') }
    const result = JSON.parse(readFileSync(out, 'utf8'))
    rmSync(tmp, { recursive: true, force: true })
    return { code, stdout, result }
  }
  {
    const r = runScript({ records: many(), google: googleMany, ownerIntervenes: { after: 'patch', nth: 1, set: { recSTOP0: { [F.coordinatePolicy]: 'representativePoint', [F.lat]: 34.6, [F.lon]: 135.4 } } } })
    t('скрипт/хвост: код 1', r.code, 1)
    t('скрипт/хвост: ровно один PATCH — второй пачки нет', r.result.patches.length, 1)
    t('скрипт/хвост: одиннадцатая запись не записана', r.result.patches.flatMap((b) => b.records.map((x) => x.id)).includes('recSTOP10'), false)
    has('скрипт/хвост: остановка названа с хвостом', r.stdout, 'ОСТАНОВЛЕНО после пачки 1: 1 записей хвоста не записаны (ST-10)')
    has('скрипт/хвост: первая пачка классифицирована', r.stdout, 'подтверждено чтением: 9 из 10')
  }
  {
    const r = runScript({ records: many(), google: googleMany })
    t('скрипт/хвост-контроль: две пачки, код 0', [r.result.patches.length, r.code, /подтверждено чтением: 11 из 11/.test(r.stdout)], [2, 0, true])
    const stamps = r.result.written.map((x) => x.fields[IDS.checkedAt])
    t('скрипт/отметка ставится целыми секундами (иначе честное хранилище вернёт другой момент)', stamps.length === 11 && stamps.every((v) => /\.000Z$/.test(v)), true)
  }
  for (const [name, google] of [['write', { 'PID-TS': { lat: 34.7001, lon: 135.5001 } }], ['hold', { 'PID-TS': { lat: 34.9, lon: 135.5 } }]]) {
    const r = runScript({ records: one('exactObjectPoint'), google, ownerIntervenes: { after: 'freshRead', nth: 2, set: { recTS: { [F.checkedAt]: STALE4 } } } })
    t(`скрипт/старая отметка (${name}): код 1, outcomeMismatch (checkedAt)`, [r.code, /outcomeMismatch \(checkedAt\)/.test(r.stdout), /подтверждено чтением: 0 из 1/.test(r.stdout)], [1, true, true])
    t(`скрипт/старая отметка (${name}): ровно один PATCH`, r.result.patches.length, 1)
  }
}

/* ── 4. Состав писателей координат: весь src/ и scripts/, сверка с реестром ── */
{
  const walk = (dir, out = []) => {
    for (const name of readdirSync(path.join(REPO, dir))) {
      const rel = path.join(dir, name)
      if (statSync(path.join(REPO, rel)).isDirectory()) { if (!/^(node_modules|\.next|tests?|__tests__)$/.test(name)) walk(rel, out) } else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(rel)
    }
    return out
  }
  const files = [...walk('src'), ...walk('scripts')]
  const sources = Object.fromEntries(files.map((rel) => [rel, read(rel)]))
  t('обход покрывает больше трёх каталогов', new Set(files.map((f) => f.split('/').slice(0, 2).join('/'))).size > 3, true)
  // (а) кто СТРОИТ поля координат для записи: ключ Latitude/Longitude/ID поля/F.lat в литерале объекта.
  const buildsCoords = (src) => /(?:['"]Latitude['"]|\bLatitude|fldZRgmrRxVNjjWw1['"]?|\[(?:F|ids|IDS|POI_COORDINATE_FIELD_IDS)\.lat\])\s*:/.test(src)
  const builders = files.filter((rel) => buildsCoords(sources[rel]))
  t('поля координат для записи строят ровно два модуля: ingestPoi (create) и контракт обновления', builders.sort(), ['src/lib/poi-coordinate-refresh.ts', 'src/lib/poi-ingest.ts'])
  // (б) кто держит ID полей координат: только контракт (ни у одного писателя нет своей копии).
  const idHolders = files.filter((rel) => /fldZRgmrRxVNjjWw1|fldd0EzyStsrS8H0U|fldMbERbAHZe67gNq/.test(sources[rel]))
  t('ID полей координат — только в контракте', idHolders, ['src/lib/poi-coordinate-refresh.ts'])
  // (в) писатели-обновители по реестру: оба импортируют контракт и шлют ровно plan.fields.
  const UPDATERS = ['src/app/api/cron/refresh-coords/route.ts', 'scripts/refresh-google-coords.mjs']
  for (const rel of UPDATERS) {
    const src = sources[rel]
    has(`${rel}: импортирует контракт`, src, 'poi-coordinate-refresh')
    has(`${rel}: решает допуск контрактом`, src, 'coordinateRefreshEligibility(')
    has(`${rel}: строит план контрактом`, src, 'planCoordinateRefresh(')
    t(`${rel}: PATCH только из plan.fields`, /fields:\s*(plan|u)\.fields/.test(src), true)
    t(`${rel}: своей математики сдвига нет`, /function haversineKm/.test(src), false)
    t(`${rel}: своего округления координат нет`, /Math\.round\([^)]*\* ?1e6\)/.test(src), false)
    t(`${rel}: Coordinate Policy не пишет`, /coordinatePolicy\]\s*:/.test(src), false)
  }
  // (г) остальные писатели POI по реестру (админка, миграции текста) координат не трогают.
  const registry = read('docs/poi-writers-registry.md')
  const rows = registry.split('\n').filter((l) => /^\| \d+а? \|/.test(l))
  t('реестр писателей: строки таблицы найдены', rows.length >= 12, true)
  const coordRows = rows.filter((l) => /Latitude|координат/.test(l.split('|')[4] ?? ''))
  t('реестр: обновители координат — крон и ручной скрипт, больше никого', coordRows.map((l) => l.split('|')[1].trim()).sort(), ['4', '9'])
  for (const l of coordRows) has(`реестр строка ${l.split('|')[1].trim()}: гейт — контракт обновления`, l, 'poi-coordinate-refresh')
  has('реестр строка 1 (create): политика координат в гейтах', rows.find((l) => /^\| 1 \|/.test(l)) ?? '', 'политика координат')
  const registryPaths = ['src/lib/airtable.ts', 'scripts/fix-poi-typos.mjs', 'scripts/fix-airtable-typography.mjs']
  for (const rel of registryPaths) {
    t(`${rel}: полей координат не строит`, buildsCoords(sources[rel] ?? ''), false)
  }
  has('реестр: схемная операция помечена исполненной', registry, 'исполнена один раз 03.09.2026')
  t('реестр: устаревшего «не исполнялось» нет', /\*\*не исполнялось\*\*/.test(registry), false)
  has('реестр: контракт обновления описан', registry, 'poi-coordinate-refresh.ts')
}

if (bad.length) {
  console.error(`✗ обновление координат подчинено политике (P07): провалено ${bad.length} из ${ok + bad.length}`)
  for (const line of bad) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`✓ обновление координат подчинено политике (P07): ${ok} проверок пройдено`)
