/**
 * Обновление координат существующей POI из Google: единственный контракт для
 * всех писателей-обновителей (ежедневный крон `api/cron/refresh-coords` и
 * ручной `scripts/refresh-google-coords.mjs`).
 *
 * ЗАЧЕМ. До 3 сентября 2026 года оба refresh-пути знали о записи четыре поля —
 * `Latitude`, `Longitude`, `Google Place ID`, `Coords Checked At` — и не
 * спрашивали `Coordinate Policy` вовсе. Любая запись с `place_id` считалась
 * кэшем Google и перезаписывалась его точкой. Для `exactObjectPoint` это и
 * есть смысл поля: точка — кэш, срок — тридцать дней. Для `representativePoint`
 * это молчаливая отмена решения владельца: он назвал ДРУГУЮ точку (вход в
 * парк, а не центроид), а ночной прогон вернул центроид, оставив политику и
 * след решения в Notes говорить о точке, которой в записи больше нет. Для
 * `notApplicable` это координаты у объекта, у которого их по решению быть не
 * должно. Половину пары один писатель «дописывал» до пары, другой объявлял
 * сдвигом в одиннадцать тысяч километров. Контрпример воспроизведён на
 * production-коде обоих путей: `tmp/10f-p-p07-refresh-repro-*-OLD-2026-09-03.*`.
 *
 * ПРИНЦИП. Google-точку можно записать только туда, где она по политике и
 * есть значение поля:
 *
 *   - `exactObjectPoint` с полной парой — да: точка равна точке места, её и
 *     обновляем; сдвиг больше трёх километров — не уточнение, а другое место,
 *     держим и отдаём человеку (`hold`), ставя только отметку проверки;
 *   - пустая политика (legacy) с полной парой и `place_id` — да, как и раньше:
 *     эти пары исторически поддерживает тот же refresh, решения владельца о них
 *     нет, и остановить их обновление значило бы держать содержимое Google
 *     дольше разрешённого. Политика при этом НЕ проставляется: refresh не
 *     миграция, и назначить `exactObjectPoint` записи, о которой владелец ещё
 *     не высказался, значило бы молча решить за него;
 *   - `representativePoint` — никогда: точка принадлежит решению владельца, не
 *     Google; ни координаты, ни отметка не трогаются;
 *   - `notApplicable` — никогда: координат по решению нет, и refresh их не
 *     заводит (а если они есть — это противоречие для `check:poi`, не работа
 *     для refresh);
 *   - неизвестное непустое значение политики — никогда (непонятое не считается
 *     безобидным);
 *   - `exactObjectPoint` без полной пары — противоречие: политика утверждает
 *     подтверждённую точку, которой нет; refresh не «чинит» такое дописыванием
 *     — человек обязан увидеть, как это получилось;
 *   - половина пары — никогда: это сломанная запись, не кэш; дописать вторую
 *     координату значило бы скрыть поломку;
 *   - legacy без координат — никогда: пустая пара у записи без политики —
 *     незакрытая работа либо намеренно снятая точка, и refresh не вправе
 *     решать, что именно.
 *
 * Писатель обязан отправлять в Airtable РОВНО `plan.fields` и ничего другого:
 * контракт возвращает готовые поля по каноническим ID, а не разрешение
 * «собери сам». Нет плана — нет записи. Каждый план с полями исполняется
 * каждым писателем одинаково: и `write`, и `hold` — это PATCH ровно
 * `plan.fields`; разница между писателями — только режим (показ или запись),
 * а не собственная трактовка плана.
 *
 * РЕШЕНИЕ, ПРИНЯТОЕ ПОСЛЕ ЧТЕНИЯ, НЕ ЗАТИРАЕТСЯ. Между чтением писателя и его
 * PATCH проходит время (запросы к Google, пачки), и владелец может успеть
 * поставить `representativePoint` или `notApplicable`. План, построенный по
 * старому снимку, такое решение затирал (круг 2 остаточного аудита,
 * `tmp/10f-p-p07-refresh2-repro-OLD-2026-09-03.log`). Поэтому план строится
 * ТОЛЬКО по свежему чтению записи непосредственно перед PATCH (`fresh`), а
 * снимок, по которому запись отобрали и спросили Google (`selected`), обязан
 * совпасть со свежим по политике, паре и `place_id` — иначе именованный
 * отказ `changedSinceRead` и никакой записи; недоступное свежее чтение —
 * `freshReadUnavailable`.
 *
 * ОСТАТОЧНАЯ ГОНКА ОБНАРУЖИВАЕТСЯ, А НЕ МОЛЧИТ. Airtable не даёт условной
 * записи, и окно между свежим чтением и PATCH остаётся — один запрос. Владелец,
 * успевший в это окно, получал смешанное состояние: его политика
 * `representativePoint` рядом с парой Google, а писатель рапортовал успех
 * (круг 3, `tmp/10f-p-p07-refresh3-repro-OLD-2026-09-03.log`). Поэтому после
 * КАЖДОГО PATCH делается независимое чтение тех же записей, и итог каждой
 * записи классифицируется (`classifyPatchOutcome`): `verified` — итоговое
 * состояние есть допустимое для плана (политика и `place_id` как до записи,
 * пара — как в плане у `write` и как до записи у `hold`); `notApplied` —
 * PATCH не принят и запись не изменилась; иначе `recoveryRequired` с
 * именованной причиной (`outcomeMismatch` — что именно разошлось;
 * `outcomeUnverified` — итоговое чтение недоступно). Писатель при
 * `recoveryRequired` не объявляет успех и перечисляет затронутые записи; он
 * не повторяет PATCH, не откатывает и не «исправляет» — это решение человека.
 * Сверяется КАЖДОЕ поле `plan.fields`, включая `Coords Checked At`: у `hold`
 * это единственный записываемый эффект, и старая отметка, вернувшаяся после
 * PATCH, — расхождение, а не успех (круг 4). Моменты времени сравниваются по
 * значению после строгого разбора в epoch milliseconds; писатель ставит
 * отметку целыми секундами (`checkedAtMoment`), так что честное хранилище
 * возвращает тот же момент, а нормализация формата Airtable сверке не мешает.
 *
 * ПОСЛЕ ПЕРВОГО `recoveryRequired` ОСТАВШИЙСЯ ХВОСТ НЕ ПИШЕТСЯ. Пачка, в
 * которой обнаружено расхождение, классифицируется целиком (её PATCH уже
 * ушёл), а следующие пачки не отправляются: ни одного PATCH после
 * расхождения (круг 4). Необработанный хвост перечисляется в отчёте и
 * дожидается следующего прогона.
 *
 * ПОВРЕЖДЁННАЯ ПОЛИТИКА — НЕ LEGACY. Пустая политика — это отсутствие
 * значения (`null`/`undefined`/`''`). Нестроковое значение, строка из
 * пробелов — повреждение, именованный отказ `corruptPolicy`; непустая
 * неизвестная строка — `unknownPolicy`. Ни то, ни другое не обновляется.
 *
 * Чистый модуль: ни сети, ни часов (момент передаётся), ни чтения базы.
 */

import { roundCoordinate } from './poi-canon.ts'
import { isCoordinatePolicy, MACHINE_DERIVED_POLICY, type CoordinatePolicy, type MachineDerivedPolicy } from './poi-coordinate-policy.ts'

/**
 * Канонические ID полей таблицы POI, которые читает и пишет refresh. Один раз
 * здесь: прежде два писателя держали по своей копии, и `Coordinate Policy`
 * не было ни в одной.
 */
export const POI_COORDINATE_FIELD_IDS = {
  poiId: 'fldy45Q8BDoVBEqN3',
  nameRu: 'fldem9kh1JxrC5jO1',
  lat: 'fldZRgmrRxVNjjWw1',
  lon: 'fldd0EzyStsrS8H0U',
  placeId: 'fldtOfrS1NCSLH69d',
  checkedAt: 'fldTJvNJTvpzaTci2',
  coordinatePolicy: 'fldMbERbAHZe67gNq',
} as const

/** Сдвиг больше этого — не уточнение геометрии, а другое место. */
export const SUSPICIOUS_SHIFT_KM = 3

/** Запись Airtable глазами refresh: значения полей как есть, без доверия к типам. */
export interface StoredCoordinateRecord {
  coordinatePolicy: unknown
  lat: unknown
  lon: unknown
  placeId: unknown
  checkedAt?: unknown
}

export type CoordinateRefreshBasis =
  /** Явная машинно выводимая политика (exactObjectPoint): точка есть кэш точки места. */
  | MachineDerivedPolicy
  /** Legacy без политики, но с полной парой и `place_id`: поддерживается как прежде, политика не назначается. */
  | 'legacyGoogleCache'

export type CoordinateRefreshRefusal =
  | 'noPlaceId'
  | 'representativePoint'
  | 'notApplicable'
  | 'unknownPolicy'
  /** Значение поля политики повреждено: не строка либо строка из пробелов. */
  | 'corruptPolicy'
  | 'policyContradictsCoords'
  | 'halfPair'
  | 'legacyNoCoordinates'

export type CoordinateRefreshEligibility =
  | { eligible: true; basis: CoordinateRefreshBasis; policy: CoordinatePolicy | null }
  | { eligible: false; refusal: CoordinateRefreshRefusal; message: string }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export type PolicyReading =
  | { kind: 'empty' }
  | { kind: 'value'; value: string }
  | { kind: 'corrupt'; detail: string }

/**
 * Чтение поля политики без домыслов: пусто — только отсутствие значения;
 * не строка или строка из пробелов — повреждение, а не «пусто».
 */
export function readPolicyField(raw: unknown): PolicyReading {
  if (raw === null || raw === undefined || raw === '') return { kind: 'empty' }
  if (typeof raw !== 'string') {
    return { kind: 'corrupt', detail: Array.isArray(raw) ? 'массив' : `тип ${typeof raw}` }
  }
  const value = raw.trim()
  if (!value) return { kind: 'corrupt', detail: 'строка из пробелов' }
  return { kind: 'value', value }
}

/** Разрешено ли вообще обновлять координаты этой записи из Google — и на каком основании. */
export function coordinateRefreshEligibility(record: StoredCoordinateRecord): CoordinateRefreshEligibility {
  const placeId = text(record.placeId)
  if (!placeId) {
    return { eligible: false, refusal: 'noPlaceId', message: 'Нет Google Place ID: обновлять нечем.' }
  }
  const reading = readPolicyField(record.coordinatePolicy)
  if (reading.kind === 'corrupt') {
    return {
      eligible: false,
      refusal: 'corruptPolicy',
      message: `Значение Coordinate Policy повреждено (${reading.detail}): это не пустая политика, обновлять нельзя.`,
    }
  }
  const policy = reading.kind === 'value' ? reading.value : ''
  const hasLat = finite(record.lat)
  const hasLon = finite(record.lon)

  if (policy === 'representativePoint') {
    return {
      eligible: false,
      refusal: 'representativePoint',
      message: 'Точка назначена решением владельца и не является кэшем Google: не обновляется.',
    }
  }
  if (policy === 'notApplicable') {
    return {
      eligible: false,
      refusal: 'notApplicable',
      message: 'По решению владельца координат у объекта нет: refresh их не заводит.',
    }
  }
  if (policy && !isCoordinatePolicy(policy)) {
    return {
      eligible: false,
      refusal: 'unknownPolicy',
      message: `Неизвестное значение Coordinate Policy «${policy}»: непонятое не обновляется.`,
    }
  }
  if (hasLat !== hasLon) {
    return {
      eligible: false,
      refusal: 'halfPair',
      message: 'Записана одна координата из двух: это сломанная запись, а не кэш; дописывать вторую нельзя.',
    }
  }
  if (policy === MACHINE_DERIVED_POLICY) {
    if (!hasLat) {
      return {
        eligible: false,
        refusal: 'policyContradictsCoords',
        message: 'Политика exactObjectPoint утверждает подтверждённую точку, а координат нет: противоречие, не работа для refresh.',
      }
    }
    return { eligible: true, basis: MACHINE_DERIVED_POLICY, policy: MACHINE_DERIVED_POLICY }
  }
  // Политика пуста — legacy.
  if (!hasLat) {
    return {
      eligible: false,
      refusal: 'legacyNoCoordinates',
      message: 'Политики нет и координат нет: refresh не решает, незакрытая это работа или снятая точка.',
    }
  }
  return { eligible: true, basis: 'legacyGoogleCache', policy: null }
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Причины, по которым план не строится вовсе — помимо отказов допуска. */
export type CoordinateRefreshPlanRefusal =
  | CoordinateRefreshRefusal
  /** Google вернул не пару чисел. */
  | 'observedInvalid'
  /** Момент проверки, переданный писателем, — не строгий ISO 8601. */
  | 'checkedAtInvalid'
  /** Свежее чтение перед записью недоступно: записи нет либо чтение не удалось. */
  | 'freshReadUnavailable'
  /** Политика, пара или `place_id` изменились после снимка, по которому запись отобрали. */
  | 'changedSinceRead'

export type CoordinateRefreshPlan =
  /** Записать пару Google и отметку проверки — ровно `fields`. */
  | {
      kind: 'write'
      basis: CoordinateRefreshBasis
      shiftKm: number
      /** Изменилась ли пара после канонизации — для отчёта; на состав `fields` не влияет. */
      coordinatesChanged: boolean
      fields: Record<string, number | string>
    }
  /** Сдвиг подозрителен: пару не трогать, поставить только отметку проверки — ровно `fields`. */
  | { kind: 'hold'; basis: CoordinateRefreshBasis; shiftKm: number; fields: Record<string, string> }
  /** Обновлять нельзя: полей для записи нет. */
  | { kind: 'skip'; refusal: CoordinateRefreshPlanRefusal; message: string; fields: Record<string, never> }

const skip = (refusal: CoordinateRefreshPlanRefusal, message: string): CoordinateRefreshPlan => ({ kind: 'skip', refusal, message, fields: {} })

const numberOrNull = (v: unknown): number | null => (finite(v) ? v : null)
const policyKey = (v: unknown): string => {
  const r = readPolicyField(v)
  return r.kind === 'value' ? `value:${r.value}` : r.kind
}

/**
 * Чем отличается состояние записи, принадлежащее владельцу, между двумя
 * чтениями: политика, пара, `place_id`. Notes, отметка проверки и прочее не
 * сравниваются — их refresh не защищает и не трогает.
 */
export function ownerStateDifference(a: StoredCoordinateRecord, b: StoredCoordinateRecord): string[] {
  const diff: string[] = []
  if (policyKey(a.coordinatePolicy) !== policyKey(b.coordinatePolicy)) diff.push('coordinatePolicy')
  if (numberOrNull(a.lat) !== numberOrNull(b.lat)) diff.push('lat')
  if (numberOrNull(a.lon) !== numberOrNull(b.lon)) diff.push('lon')
  if (text(a.placeId) !== text(b.placeId)) diff.push('placeId')
  return diff
}

export interface CoordinateRefreshPlanInput {
  /** Снимок, по которому запись отобрали и спросили Google. */
  selected: StoredCoordinateRecord
  /** Свежее чтение той же записи непосредственно перед PATCH; `null` — недоступно. */
  fresh: StoredCoordinateRecord | null
  observed: { lat: unknown; lon: unknown }
  /** Момент проверки в ISO 8601, передаётся снаружи. */
  checkedAt: string
}

/**
 * План записи одной записи. Строится ТОЛЬКО по свежему чтению: если оно
 * недоступно или расходится со снимком по политике, паре или `place_id` —
 * именованный отказ и никаких полей. Писатель отправляет `fields` как есть
 * либо не отправляет ничего.
 */
export function planCoordinateRefresh(input: CoordinateRefreshPlanInput): CoordinateRefreshPlan {
  const { selected, fresh, observed, checkedAt } = input
  if (!fresh) {
    return skip('freshReadUnavailable', 'Свежее чтение записи перед записью недоступно: без него план не строится.')
  }
  const changed = ownerStateDifference(selected, fresh)
  if (changed.length) {
    return skip('changedSinceRead', `Запись изменилась после чтения (${changed.join(', ')}): старый план не применяется, запись отложена до следующего прогона.`)
  }
  return planAgainst(fresh, observed, checkedAt)
}

/**
 * Предпросмотр по снимку — для режима показа без записи. Полномочия на запись
 * не даёт: перед PATCH план строится заново по свежему чтению.
 */
export function previewCoordinateRefresh(
  record: StoredCoordinateRecord,
  observed: { lat: unknown; lon: unknown },
  checkedAt: string,
): CoordinateRefreshPlan {
  return planAgainst(record, observed, checkedAt)
}

function planAgainst(record: StoredCoordinateRecord, observed: { lat: unknown; lon: unknown }, checkedAt: string): CoordinateRefreshPlan {
  const eligibility = coordinateRefreshEligibility(record)
  if (!eligibility.eligible) return skip(eligibility.refusal, eligibility.message)
  if (!finite(observed.lat) || !finite(observed.lon)) {
    return skip('observedInvalid', 'Google вернул не пару чисел: писать нечего.')
  }
  if (parseMoment(checkedAt) === null) {
    return skip('checkedAtInvalid', 'Момент проверки не является строгим ISO 8601: план не строится.')
  }
  const ids = POI_COORDINATE_FIELD_IDS
  const current = { lat: record.lat as number, lon: record.lon as number }
  const next = { lat: roundCoordinate(observed.lat), lon: roundCoordinate(observed.lon) }
  const shiftKm = haversineKm(current, next)
  if (shiftKm > SUSPICIOUS_SHIFT_KM) {
    return { kind: 'hold', basis: eligibility.basis, shiftKm, fields: { [ids.checkedAt]: checkedAt } }
  }
  const coordinatesChanged = roundCoordinate(current.lat) !== next.lat || roundCoordinate(current.lon) !== next.lon
  return {
    kind: 'write',
    basis: eligibility.basis,
    shiftKm,
    coordinatesChanged,
    fields: { [ids.lat]: next.lat, [ids.lon]: next.lon, [ids.checkedAt]: checkedAt },
  }
}

/**
 * Итог одной записи после PATCH — по независимому чтению, а не по ответу
 * PATCH и не по коду HTTP.
 */
export type PatchOutcome =
  /** Итоговое состояние — допустимое для плана. */
  | { kind: 'verified' }
  /** PATCH не принят, запись не изменилась: не гонка, повтор в следующий прогон. */
  | { kind: 'notApplied'; message: string }
  /** Успеха нет: итог неизвестен либо разошёлся с допустимым — решает человек. */
  | { kind: 'recoveryRequired'; refusal: 'outcomeUnverified' | 'outcomeMismatch'; mismatched: string[]; message: string }

export interface PatchOutcomeInput {
  /** План, по которому шёл PATCH (`write` или `hold`). */
  plan: Extract<CoordinateRefreshPlan, { kind: 'write' | 'hold' }>
  /** Свежее чтение ДО PATCH — по нему план строился. */
  fresh: StoredCoordinateRecord
  /** Независимое чтение ПОСЛЕ PATCH; `null` — недоступно. */
  after: StoredCoordinateRecord | null
  /** Принял ли Airtable PATCH (2xx). Итог всё равно устанавливается чтением. */
  patchAccepted: boolean
}

/** Строгий ISO 8601 с временем: дата, время, необязательные доли секунды, зона `Z` или `±hh:mm`. */
const ISO_MOMENT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/

const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const daysInMonth = (y: number, m: number): number => (m === 2 ? (isLeapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31)

/**
 * Момент времени из значения поля — epoch milliseconds — либо `null`: не
 * строка, не строгий ISO 8601, невозможные день, месяц, время или смещение
 * зоны. Разбор КАЛЕНДАРНО строгий и на `Date.parse` не опирается: движок
 * нормализует переполнение («31 февраля» → 3 марта), и невозможная дата
 * совпадала бы по значению с настоящей (круг 5,
 * `tmp/10f-p-p07-refresh5-repro-OLD-2026-09-03.log`). Компоненты проверяются
 * по календарю (високосный год — по правилу 4/100/400), время — в диапазонах
 * 00–23:00–59:00–59 (секунда 60 не представима в epoch и отвергается),
 * смещение — 00–23:00–59; момент собирается арифметикой `Date.UTC` из уже
 * проверенных компонентов. Сравнение моментов идёт по значению, а не по
 * строке: `…38Z` и `…38.000Z` — один момент.
 */
export function parseMoment(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const m = ISO_MOMENT.exec(raw)
  if (!m) return null
  const [, ys, mos, ds, hs, mis, ss, frac, zone, sign, ohs, oms] = m
  const year = Number(ys)
  const month = Number(mos)
  const day = Number(ds)
  const hour = Number(hs)
  const minute = Number(mis)
  const second = Number(ss)
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  if (hour > 23 || minute > 59 || second > 59) return null
  let offsetMs = 0
  if (zone !== 'Z') {
    const oh = Number(ohs)
    const om = Number(oms)
    if (oh > 23 || om > 59) return null
    offsetMs = (sign === '-' ? -1 : 1) * (oh * 60 + om) * 60_000
  }
  const millis = frac ? Number(frac.padEnd(3, '0')) : 0
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millis)
  return Number.isFinite(utc) ? utc - offsetMs : null
}

const sameMoment = (a: unknown, b: unknown): boolean => {
  const x = parseMoment(a)
  const y = parseMoment(b)
  return x === null && y === null && a == null && b == null ? true : x !== null && x === y
}

/**
 * Отметка проверки, которую ставит писатель: текущий момент целыми секундами.
 * Airtable хранит дату-время с точностью до секунды; отметка с миллисекундами
 * вернулась бы из хранилища другим моментом и ложно провалила бы сверку.
 */
export function checkedAtMoment(now: Date = new Date()): string {
  return new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString()
}

/**
 * Допустимое итоговое состояние: политика и `place_id` — как до записи; пара —
 * как в плане (`write`) либо как до записи (`hold`); отметка — момент из плана
 * (у обоих видов). Всё сравнивается после канонизации, без допусков.
 */
export function classifyPatchOutcome(input: PatchOutcomeInput): PatchOutcome {
  const { plan, fresh, after, patchAccepted } = input
  if (!after) {
    return {
      kind: 'recoveryRequired',
      refusal: 'outcomeUnverified',
      mismatched: [],
      message: 'Итоговое чтение после PATCH недоступно: результат записи неизвестен, успех не объявляется.',
    }
  }
  const ids = POI_COORDINATE_FIELD_IDS
  const canon = (v: unknown): number | null => (finite(v) ? roundCoordinate(v) : null)
  const expectedLat = plan.kind === 'write' ? canon(plan.fields[ids.lat]) : canon(fresh.lat)
  const expectedLon = plan.kind === 'write' ? canon(plan.fields[ids.lon]) : canon(fresh.lon)
  // Отметка — поле плана у ОБОИХ видов; сверяется по значению момента, не по строке.
  const expectedCheckedAt = parseMoment(plan.fields[ids.checkedAt])
  const mismatched: string[] = []
  if (policyKey(after.coordinatePolicy) !== policyKey(fresh.coordinatePolicy)) mismatched.push('coordinatePolicy')
  if (canon(after.lat) !== expectedLat) mismatched.push('lat')
  if (canon(after.lon) !== expectedLon) mismatched.push('lon')
  if (text(after.placeId) !== text(fresh.placeId)) mismatched.push('placeId')
  if (expectedCheckedAt === null || parseMoment(after.checkedAt) !== expectedCheckedAt) mismatched.push('checkedAt')
  if (mismatched.length === 0) return { kind: 'verified' }
  if (!patchAccepted && ownerStateDifference(fresh, after).length === 0 && sameMoment(fresh.checkedAt, after.checkedAt)) {
    return { kind: 'notApplied', message: 'PATCH не принят Airtable, запись не изменилась: повтор в следующий прогон.' }
  }
  return {
    kind: 'recoveryRequired',
    refusal: 'outcomeMismatch',
    mismatched,
    message: `Итоговое состояние после PATCH не соответствует допустимому (${mismatched.join(', ')}): `
      + 'состояние записи изменилось в окне между свежим чтением и записью; успех не объявляется, повтора и отката нет — решает человек.',
  }
}

/** Пачка PATCH в Airtable — и размер свежего и итогового чтения вокруг неё. */
export const REFRESH_BATCH_SIZE = 10

/**
 * Формула Airtable для свежего чтения ровно этих записей перед PATCH:
 * `OR(RECORD_ID()='rec…',…)`. Один раз здесь, чтобы оба писателя читали одно и то же.
 */
export function freshReadFormula(recordIds: readonly string[]): string {
  if (recordIds.length === 0) throw new Error('freshReadFormula: пустой список записей')
  for (const id of recordIds) {
    if (!/^rec[A-Za-z0-9]+$/.test(id)) throw new Error(`freshReadFormula: недопустимый recordId «${id}»`)
  }
  return `OR(${recordIds.map((id) => `RECORD_ID()='${id}'`).join(',')})`
}

/** Разбор сырой записи Airtable (поля по ID) в форму контракта. */
export function storedCoordinateRecordFromFields(fields: Record<string, unknown>): StoredCoordinateRecord {
  const ids = POI_COORDINATE_FIELD_IDS
  return {
    coordinatePolicy: fields[ids.coordinatePolicy],
    lat: fields[ids.lat],
    lon: fields[ids.lon],
    placeId: fields[ids.placeId],
    checkedAt: fields[ids.checkedAt],
  }
}
