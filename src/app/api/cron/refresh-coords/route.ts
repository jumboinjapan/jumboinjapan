import { NextRequest, NextResponse } from 'next/server'

import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import { AIRTABLE_BASE_ID, POI_TABLE_ID } from '@/lib/airtable-schema'
import { resolveCredentials } from '@/lib/integrations/vault'
import { findIntegration } from '@/lib/integrations/registry'
import {
  checkedAtMoment,
  classifyPatchOutcome,
  coordinateRefreshEligibility,
  freshReadFormula,
  planCoordinateRefresh,
  POI_COORDINATE_FIELD_IDS,
  REFRESH_BATCH_SIZE,
  storedCoordinateRecordFromFields,
  type CoordinateRefreshPlan,
  type CoordinateRefreshRefusal,
  type StoredCoordinateRecord,
} from '@/lib/poi-coordinate-refresh'
import { describeThrownSafely } from '@/lib/thrown-value'

/**
 * Ежедневное обновление координат, полученных от Google.
 *
 * ЗАЧЕМ ЭТО СУЩЕСТВУЕТ. Условия Maps Platform разрешают хранить у себя
 * `place_id` бессрочно, а остальное содержимое — включая широту и долготу —
 * не дольше тридцати дней. То есть координата в базе по смыслу кэш, а не
 * запись, и обязана обновляться. Этот роут и есть то, что делает её кэшем:
 * без него мы просто хранили бы чужие данные дольше разрешённого.
 *
 * ПОЧЕМУ ЕЖЕДНЕВНО, А НЕ РАЗ В МЕСЯЦ. Раз в месяц пришлось бы обновить всё
 * разом: на сегодняшних 146 записях это укладывается в минуту, на четырёхстах
 * уже нет, а предел функции на Hobby — шестьдесят секунд. Отвалившийся по
 * таймауту месячный прогон означал бы месяц просрочки и никакого сигнала.
 * Ежедневный берёт до сотни самых старых записей, отрабатывает за секунды и
 * сам себя догоняет: даже пропустив неделю, он войдёт в норму за пару дней.
 *
 * ОБНОВЛЕНИЕ ИДЁТ ПО place_id, А НЕ ПОИСКОМ ПО ИМЕНИ. Поиск каждый раз решает
 * заново, какой объект имелся в виду, и однажды решит иначе — тихо, посреди
 * ночного прогона. `place_id` держит опознание неизменным; меняется только
 * положение, если Google уточнил геометрию.
 *
 * СДВИГ БОЛЬШЕ ТРЁХ КИЛОМЕТРОВ НЕ ПРИМЕНЯЕТСЯ. Это уже не уточнение
 * геометрии, а признак того, что место переехало, закрылось или срослось с
 * другим. Такие записи возвращаются списком и ждут человека.
 *
 * ОБНОВЛЯЕТСЯ ТОЛЬКО ТО, ЧТО ПО ПОЛИТИКЕ ЕСТЬ КЭШ GOOGLE. До 3 сентября 2026
 * года роут не спрашивал `Coordinate Policy` и перезаписывал точкой Google
 * любую запись с `place_id` — в том числе `representativePoint`, где точку
 * назначил владелец, и `notApplicable`, где координат по решению нет
 * (контрпример: `tmp/10f-p-p07-refresh-repro-cron-OLD-2026-09-03.log`).
 * Теперь что можно обновлять и что именно писать решает один контракт —
 * `src/lib/poi-coordinate-refresh.ts`, общий с ручным скриптом: записи, не
 * подлежащие обновлению, не попадают в очередь и не расходуют ни лимит
 * Google, ни место в пачке; в Airtable уходит ровно `plan.fields`.
 *
 * ПЕРЕД КАЖДОЙ ПАЧКОЙ PATCH — СВЕЖЕЕ ЧТЕНИЕ. Между чтением очереди и записью
 * проходят запросы к Google, и владелец может успеть поставить
 * `representativePoint` или `notApplicable`. План строится по свежему чтению
 * ровно тех записей, что идут в пачку (`filterByFormula` по `RECORD_ID()`), и
 * только если политика, пара и `place_id` не изменились со снимка; иначе
 * запись отложена до следующего прогона (`отложено` в сводке). Окно между
 * свежим чтением и PATCH — один запрос; условной записи у Airtable нет.
 *
 * ПОСЛЕ КАЖДОЙ ПАЧКИ PATCH — НЕЗАВИСИМОЕ ЧТЕНИЕ И СВЕРКА. Итог записи
 * устанавливается только чтением: если политика, пара или `place_id` не
 * соответствуют допустимому итоговому состоянию плана (или чтение
 * недоступно), роут не объявляет успех — `ok: false`, `recoveryRequired: true`,
 * HTTP 500 и полный список затронутых записей в `требуетВосстановления`.
 * Повтора PATCH, отката и «исправляющей» записи нет: остаточная гонка
 * становится видимой, а решать её — человеку. Все брошенные значения на
 * границах чтения описываются `describeThrownSafely` и роут не покидают.
 *
 * ПОСЛЕ ПЕРВОГО `recoveryRequired` ХВОСТ НЕ ПИШЕТСЯ. Пачка с расхождением
 * классифицируется целиком (её PATCH уже ушёл), следующие пачки не
 * отправляются вовсе: ни одного PATCH после расхождения. Необработанный хвост
 * перечисляется в `остановлено` и дожидается следующего прогона.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BASE_ID = AIRTABLE_BASE_ID
const POI_TABLE = POI_TABLE_ID
const F = POI_COORDINATE_FIELD_IDS

/** Столько записей за один прогон: с запасом укладывается в maxDuration. */
const BATCH = 100
/** Обновляем раньше срока — чтобы пропущенный день не съедал весь запас. */
const STALE_AFTER_DAYS = 25
/** Сколько идентификаторов пропущенных по политике записей показывать в сводке. */
const SKIPPED_SAMPLE = 10

interface Poi {
  recId: string
  poiId: string
  nameRu: string
  placeId: string
  checkedAt: string | null
  /** Запись глазами контракта обновления: по ней решается, можно ли писать. */
  stored: StoredCoordinateRecord
}

interface SkippedByPolicy {
  refusal: CoordinateRefreshRefusal
  count: number
  sample: string[]
}

async function loadStale(token: string): Promise<{ stale: Poi[]; skipped: SkippedByPolicy[] }> {
  const out: Poi[] = []
  const skippedByRefusal = new Map<CoordinateRefreshRefusal, SkippedByPolicy>()
  let offset: string | undefined
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${POI_TABLE}`)
    for (const id of Object.values(F)) url.searchParams.append('fields[]', id)
    // Без этого флага Airtable считает, что в fields[] пришли ИМЕНА полей,
    // и на идентификаторы отвечает пустыми записями — молча, кодом 200.
    url.searchParams.set('returnFieldsByFieldId', 'true')
    url.searchParams.set('pageSize', '100')
    if (offset) url.searchParams.set('offset', offset)

    const res = await fetchAirtableWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Airtable ${res.status}`)
    const data = (await res.json()) as { records: Array<{ id: string; fields: Record<string, unknown> }>; offset?: string }

    for (const r of data.records) {
      const f = r.fields
      const stored = storedCoordinateRecordFromFields(f)
      const placeId = typeof stored.placeId === 'string' ? stored.placeId.trim() : ''
      // Без place_id обновлять нечем — это не «пропуск по политике», а
      // обычное отсутствие входа; в сводку такие не попадают.
      if (!placeId) continue
      const eligibility = coordinateRefreshEligibility(stored)
      if (!eligibility.eligible) {
        const bucket = skippedByRefusal.get(eligibility.refusal) ?? { refusal: eligibility.refusal, count: 0, sample: [] }
        bucket.count += 1
        if (bucket.sample.length < SKIPPED_SAMPLE) bucket.sample.push(String(f[F.poiId] ?? r.id))
        skippedByRefusal.set(eligibility.refusal, bucket)
        continue
      }
      out.push({
        recId: r.id,
        poiId: String(f[F.poiId] ?? ''),
        nameRu: String(f[F.nameRu] ?? ''),
        placeId,
        checkedAt: typeof f[F.checkedAt] === 'string' ? (f[F.checkedAt] as string) : null,
        stored,
      })
    }
    offset = data.offset
  } while (offset)

  const cutoff = Date.now() - STALE_AFTER_DAYS * 86_400_000
  const stale = out
    .filter((p) => !p.checkedAt || Date.parse(p.checkedAt) < cutoff)
    // Никогда не проверявшиеся идут первыми, дальше — самые давние.
    .sort((a, b) => (a.checkedAt ? Date.parse(a.checkedAt) : 0) - (b.checkedAt ? Date.parse(b.checkedAt) : 0))
    .slice(0, BATCH)
  return { stale, skipped: [...skippedByRefusal.values()] }
}

/**
 * Свежее чтение ровно указанных записей перед PATCH. Недоступное чтение
 * (не 2xx, повреждённый ответ) — пустая карта: план по такой записи не
 * строится, запись откладывается.
 */
async function readFresh(token: string, recordIds: string[]): Promise<Map<string, StoredCoordinateRecord>> {
  const fresh = new Map<string, StoredCoordinateRecord>()
  try {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${POI_TABLE}`)
    for (const id of Object.values(F)) url.searchParams.append('fields[]', id)
    url.searchParams.set('returnFieldsByFieldId', 'true')
    url.searchParams.set('filterByFormula', freshReadFormula(recordIds))
    url.searchParams.set('pageSize', String(recordIds.length))
    const res = await fetchAirtableWithRetry(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return fresh
    const data = (await res.json()) as { records?: Array<{ id?: unknown; fields?: unknown }> }
    for (const r of data.records ?? []) {
      if (typeof r?.id !== 'string' || !r.fields || typeof r.fields !== 'object') continue
      fresh.set(r.id, storedCoordinateRecordFromFields(r.fields as Record<string, unknown>))
    }
  } catch (error) {
    console.error('[cron/refresh-coords] чтение записей перед/после записи:', describeThrownSafely(error))
  }
  return fresh
}

type LocationResult =
  | { gone: true }
  | { error: string }
  | { lat: number; lon: number }

async function fetchLocation(key: string, placeId: string): Promise<LocationResult> {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'location' },
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => null)) as
    | { location?: { latitude?: number; longitude?: number }; error?: { message?: string; status?: string } }
    | null
  if (res.status === 404 || data?.error?.status === 'NOT_FOUND') return { gone: true as const }
  if (!res.ok) return { error: data?.error?.message ?? `HTTP ${res.status}` }
  const loc = data?.location
  if (typeof loc?.latitude !== 'number' || typeof loc?.longitude !== 'number') {
    return { error: 'ответ без координаты' }
  }
  return { lat: loc.latitude, lon: loc.longitude }
}

/** Ключ Google: сначала окружение, потом сейф интеграций. */
async function googleKey(): Promise<string> {
  const fromEnv = process.env.GOOGLE_PLACES_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const definition = findIntegration('google-places')
  if (!definition) return ''
  const credentials = await resolveCredentials(definition)
  return credentials.apiKey?.trim() ?? ''
}

export async function GET(request: NextRequest) {
  // Vercel подписывает вызовы cron заголовком с CRON_SECRET. Без секрета
  // роут не работает вовсе: открытый эндпоинт, тратящий чужой платный лимит,
  // — это не «пока не настроили», а дыра.
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET не задан' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Не авторизовано' }, { status: 401 })
  }

  const token = process.env.AIRTABLE_TOKEN?.trim() ?? ''
  if (!token || !BASE_ID) {
    return NextResponse.json({ ok: false, error: 'AIRTABLE_TOKEN и AIRTABLE_BASE_ID обязательны' }, { status: 503 })
  }
  const key = await googleKey()
  if (!key) {
    return NextResponse.json({ ok: false, error: 'Ключ Google Places не найден ни в окружении, ни в сейфе' }, { status: 503 })
  }

  const started = Date.now()
  let stale: Poi[]
  let skipped: SkippedByPolicy[]
  try {
    ({ stale, skipped } = await loadStale(token))
  } catch (error) {
    const message = describeThrownSafely(error)
    console.error('[cron/refresh-coords] чтение POI:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }

  const suspicious: Array<{ poiId: string; nameRu: string; shiftKm: number }> = []
  const problems: Array<{ poiId: string; nameRu: string; why: string }> = []
  const deferred: Array<{ poiId: string; nameRu: string; why: string }> = []

  // Сначала — наблюдения Google по всей очереди; план по ним НЕ строится.
  const observed: Array<{ p: Poi; got: { lat: number; lon: number } }> = []
  let written = 0
  const recovery: Array<{ recordId: string; poiId: string; nameRu: string; refusal: string; mismatched: string[]; why: string }> = []
  let stopped: { послеПачки: number; необработано: number; записи: string[] } | null = null
  try {
    for (const p of stale) {
      const got = await fetchLocation(key, p.placeId)
      if ('gone' in got) {
        problems.push({ poiId: p.poiId, nameRu: p.nameRu, why: 'place_id больше не существует' })
        continue
      }
      if ('error' in got) {
        problems.push({ poiId: p.poiId, nameRu: p.nameRu, why: got.error })
        continue
      }
      observed.push({ p, got })
    }

    // Затем пачками: свежее чтение ровно этих записей → план по свежему → PATCH ровно
    // plan.fields → независимое чтение → итог каждой записи только по чтению.
    for (let i = 0; i < observed.length; i += REFRESH_BATCH_SIZE) {
      const batch = observed.slice(i, i + REFRESH_BATCH_SIZE)
      const fresh = await readFresh(token, batch.map(({ p }) => p.recId))
      const checkedAt = checkedAtMoment()
      const updates: Array<{ id: string; fields: Record<string, unknown> }> = []
      const planned: Array<{ p: Poi; plan: Extract<CoordinateRefreshPlan, { kind: 'write' | 'hold' }>; fresh: StoredCoordinateRecord }> = []
      for (const { p, got } of batch) {
        const freshRecord = fresh.get(p.recId) ?? null
        const plan = planCoordinateRefresh({ selected: p.stored, fresh: freshRecord, observed: got, checkedAt })
        if (plan.kind === 'skip') {
          const target = plan.refusal === 'changedSinceRead' || plan.refusal === 'freshReadUnavailable' ? deferred : problems
          target.push({ poiId: p.poiId, nameRu: p.nameRu, why: plan.message })
          continue
        }
        if (plan.kind === 'hold') {
          // Отметку времени всё равно ставим: иначе такая запись будет
          // приходить в каждый прогон и вытеснять те, что реально просрочены.
          suspicious.push({ poiId: p.poiId, nameRu: p.nameRu, shiftKm: Math.round(plan.shiftKm * 10) / 10 })
        }
        updates.push({ id: p.recId, fields: plan.fields })
        planned.push({ p, plan, fresh: freshRecord as StoredCoordinateRecord })
      }
      if (updates.length === 0) continue
      let patchAccepted = false
      try {
        const res = await fetchAirtableWithRetry(`https://api.airtable.com/v0/${BASE_ID}/${POI_TABLE}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: updates }),
        })
        patchAccepted = res.ok
        if (!res.ok) console.error(`[cron/refresh-coords] Airtable ${res.status} на пачке с ${i}`)
      } catch (error) {
        // Ответ PATCH не получен: применился он или нет — неизвестно; решает только чтение ниже.
        console.error('[cron/refresh-coords] PATCH без ответа:', describeThrownSafely(error))
      }
      // Ровно один PATCH на пачку: ни повтора, ни отката, ни исправляющей записи.
      const after = await readFresh(token, planned.map(({ p }) => p.recId))
      // Вся уже записанная пачка классифицируется целиком — и только потом решается судьба хвоста.
      for (const { p, plan, fresh: freshRecord } of planned) {
        const outcome = classifyPatchOutcome({ plan, fresh: freshRecord, after: after.get(p.recId) ?? null, patchAccepted })
        if (outcome.kind === 'verified') { written += 1; continue }
        if (outcome.kind === 'notApplied') { problems.push({ poiId: p.poiId, nameRu: p.nameRu, why: outcome.message }); continue }
        recovery.push({ recordId: p.recId, poiId: p.poiId, nameRu: p.nameRu, refusal: outcome.refusal, mismatched: outcome.mismatched, why: outcome.message })
      }
      if (recovery.length > 0) {
        // Первое расхождение останавливает прогон: ни одного PATCH для оставшихся пачек.
        const tail = observed.slice(i + REFRESH_BATCH_SIZE)
        stopped = { послеПачки: Math.floor(i / REFRESH_BATCH_SIZE) + 1, необработано: tail.length, записи: tail.map(({ p }) => p.poiId) }
        break
      }
    }
  } catch (error) {
    // Ничто брошенное не покидает роут: неизвестный исход всего прогона — тоже не успех.
    const message = describeThrownSafely(error)
    console.error('[cron/refresh-coords] прерван:', message)
    const summary = { ok: false, recoveryRequired: true, error: message, обновлено: written, требуетВосстановления: recovery, остановлено: stopped, мс: Date.now() - started }
    console.log('[cron/refresh-coords]', JSON.stringify(summary))
    return NextResponse.json(summary, { status: 500 })
  }

  const recoveryRequired = recovery.length > 0
  const summary = {
    ok: !recoveryRequired,
    recoveryRequired,
    просрочено: stale.length,
    обновлено: written,
    подозрительныйСдвиг: suspicious,
    проблемы: problems,
    пропущеноПоПолитике: skipped,
    отложено: deferred,
    требуетВосстановления: recovery,
    остановлено: stopped,
    мс: Date.now() - started,
  }
  // Сводка уходит в логи Vercel: cron никто не смотрит, и единственный след
  // его работы должен быть читаемым без расшифровки.
  console.log('[cron/refresh-coords]', JSON.stringify(summary))
  return NextResponse.json(summary, { status: recoveryRequired ? 500 : 200 })
}
