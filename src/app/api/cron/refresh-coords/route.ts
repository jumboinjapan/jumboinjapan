import { NextRequest, NextResponse } from 'next/server'

import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import { AIRTABLE_BASE_ID, POI_TABLE_ID } from '@/lib/airtable-schema'
import { resolveCredentials } from '@/lib/integrations/vault'
import { findIntegration } from '@/lib/integrations/registry'

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
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BASE_ID = AIRTABLE_BASE_ID
const POI_TABLE = POI_TABLE_ID
const F = {
  poiId: 'fldy45Q8BDoVBEqN3',
  nameRu: 'fldem9kh1JxrC5jO1',
  lat: 'fldZRgmrRxVNjjWw1',
  lon: 'fldd0EzyStsrS8H0U',
  placeId: 'fldtOfrS1NCSLH69d',
  checkedAt: 'fldTJvNJTvpzaTci2',
}

/** Столько записей за один прогон: с запасом укладывается в maxDuration. */
const BATCH = 100
/** Обновляем раньше срока — чтобы пропущенный день не съедал весь запас. */
const STALE_AFTER_DAYS = 25
const SUSPICIOUS_SHIFT_KM = 3

interface Poi {
  recId: string
  poiId: string
  nameRu: string
  placeId: string
  lat: number | null
  lon: number | null
  checkedAt: string | null
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

async function loadStale(token: string): Promise<Poi[]> {
  const out: Poi[] = []
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
      const placeId = typeof f[F.placeId] === 'string' ? (f[F.placeId] as string) : ''
      if (!placeId) continue
      out.push({
        recId: r.id,
        poiId: String(f[F.poiId] ?? ''),
        nameRu: String(f[F.nameRu] ?? ''),
        placeId,
        lat: typeof f[F.lat] === 'number' ? (f[F.lat] as number) : null,
        lon: typeof f[F.lon] === 'number' ? (f[F.lon] as number) : null,
        checkedAt: typeof f[F.checkedAt] === 'string' ? (f[F.checkedAt] as string) : null,
      })
    }
    offset = data.offset
  } while (offset)

  const cutoff = Date.now() - STALE_AFTER_DAYS * 86_400_000
  return out
    .filter((p) => !p.checkedAt || Date.parse(p.checkedAt) < cutoff)
    // Никогда не проверявшиеся идут первыми, дальше — самые давние.
    .sort((a, b) => (a.checkedAt ? Date.parse(a.checkedAt) : 0) - (b.checkedAt ? Date.parse(b.checkedAt) : 0))
    .slice(0, BATCH)
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
  try {
    stale = await loadStale(token)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[cron/refresh-coords] чтение POI:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }

  const updates: Array<{ id: string; fields: Record<string, unknown> }> = []
  const suspicious: Array<{ poiId: string; nameRu: string; shiftKm: number }> = []
  const problems: Array<{ poiId: string; nameRu: string; why: string }> = []

  for (const p of stale) {
    const got = await fetchLocation(key, p.placeId)
    const checkedAt = new Date().toISOString()

    if ('gone' in got) {
      problems.push({ poiId: p.poiId, nameRu: p.nameRu, why: 'place_id больше не существует' })
      continue
    }
    if ('error' in got) {
      problems.push({ poiId: p.poiId, nameRu: p.nameRu, why: got.error })
      continue
    }

    const shift = p.lat == null || p.lon == null ? 0 : haversineKm({ lat: p.lat, lon: p.lon }, got)
    if (shift > SUSPICIOUS_SHIFT_KM) {
      // Отметку времени всё равно ставим: иначе такая запись будет
      // приходить в каждый прогон и вытеснять те, что реально просрочены.
      suspicious.push({ poiId: p.poiId, nameRu: p.nameRu, shiftKm: Math.round(shift * 10) / 10 })
      updates.push({ id: p.recId, fields: { [F.checkedAt]: checkedAt } })
      continue
    }

    updates.push({
      id: p.recId,
      fields: {
        [F.lat]: Math.round(got.lat * 1e6) / 1e6,
        [F.lon]: Math.round(got.lon * 1e6) / 1e6,
        [F.checkedAt]: checkedAt,
      },
    })
  }

  let written = 0
  for (let i = 0; i < updates.length; i += 10) {
    const res = await fetchAirtableWithRetry(`https://api.airtable.com/v0/${BASE_ID}/${POI_TABLE}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: updates.slice(i, i + 10) }),
    })
    if (res.ok) written += Math.min(10, updates.length - i)
    else console.error(`[cron/refresh-coords] Airtable ${res.status} на пачке с ${i}`)
  }

  const summary = {
    ok: true,
    просрочено: stale.length,
    обновлено: written,
    подозрительныйСдвиг: suspicious,
    проблемы: problems,
    мс: Date.now() - started,
  }
  // Сводка уходит в логи Vercel: cron никто не смотрит, и единственный след
  // его работы должен быть читаемым без расшифровки.
  console.log('[cron/refresh-coords]', JSON.stringify(summary))
  return NextResponse.json(summary)
}
