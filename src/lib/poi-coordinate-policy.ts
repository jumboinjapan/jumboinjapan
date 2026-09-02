/**
 * Политика координат POI: единственный источник допустимых значений и
 * единственное место, где решается, какая политика соответствует записи.
 *
 * Зачем отдельный модуль. До 1 сентября 2026 года тройку значений держали
 * порознь проверка целостности и независимый сборщик baseline, а путь записи
 * не знал о поле вовсе: `ingestPoi` писал `Latitude` и `Longitude` и оставлял
 * политику пустой. Каждый импорт увеличивал долг вместо того, чтобы его не
 * создавать. Два списка расходятся молча, поэтому список здесь один, и его
 * импортируют и писатель, и сторож.
 *
 * Правило вывода намеренно неудобное. `exactObjectPoint` выводится ТОЛЬКО из
 * полной пары, пришедшей от доверенного резолвера места: сверяется не только
 * наличие `placeId`, но и совпадение записываемой точки с той, которую вернул
 * резолвер. Иначе «происхождение» подтверждалось бы соседним полем, а не самой
 * координатой, и модель, выдавшая правдоподобную широту, получала бы отметку
 * точности за чужой счёт.
 *
 * `representativePoint` и `notApplicable` машиной не выводятся никогда. Это
 * предметные утверждения о самом объекте — «у него нет одной осмысленной
 * точки» и «точка неприменима», — и принять их может только человек.
 * Отсутствие координат таким решением НЕ является: пустая пара означает, что
 * работа не сделана, а не что она сделана и дала отрицательный ответ.
 */

import { roundCoordinate } from './poi-canon.ts'

/** Все допустимые значения поля `Coordinate Policy` в Airtable. */
export const COORDINATE_POLICIES = ['exactObjectPoint', 'representativePoint', 'notApplicable'] as const

export type CoordinatePolicy = (typeof COORDINATE_POLICIES)[number]

/** Имя поля в таблице POI. Один раз здесь, чтобы не расходилось по строкам. */
export const COORDINATE_POLICY_FIELD = 'Coordinate Policy'

/**
 * Значения, которые машина вывести не может и которые обязан назвать человек.
 * `exactObjectPoint` сюда не входит: он проверяем, и просить о нём решение
 * значит принимать на веру то, что можно установить.
 */
export const SUBJECT_DECISION_POLICIES = ['representativePoint', 'notApplicable'] as const

export type SubjectDecisionPolicy = (typeof SUBJECT_DECISION_POLICIES)[number]

export type CoordinatePolicyRefusal =
  /** Координат нет вовсе. Это не `notApplicable`, а незакрытая работа. */
  | 'noCoordinates'
  /** Записана одна координата из двух. На карту такую точку не поставить. */
  | 'halfPair'
  /** Пара полная, но происхождение точки не подтверждено резолвером. */
  | 'unknownProvenance'
  /** Явное решение названо, но такого значения не существует. */
  | 'unknownDecision'
  /** Явное решение противоречит тому, что записано в координатах. */
  | 'decisionContradictsCoordinates'

export interface CoordinatePolicyInput {
  lat?: number | null
  lon?: number | null
  /**
   * Что вернул резолвер места. Доверенным считается только случай, когда
   * есть `placeId` И координаты резолвера совпадают с записываемыми.
   */
  resolved?: { placeId?: string; lat?: number; lon?: number } | null
  /** Явное предметное решение человека, если оно было принято. */
  decision?: string | null
}

export type CoordinatePolicyVerdict =
  | { ok: true; policy: CoordinatePolicy; derivedFrom: 'resolvedGooglePlace' | 'subjectDecision' }
  | { ok: false; refusal: CoordinatePolicyRefusal; message: string }

export function isCoordinatePolicy(value: unknown): value is CoordinatePolicy {
  return typeof value === 'string' && (COORDINATE_POLICIES as readonly string[]).includes(value)
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Единственное вычисление политики. Чистая функция: ни сети, ни часов, ни
 * чтения базы. Отказ — это не пустое поле, а именованная причина, по которой
 * запись не должна появиться.
 */
export function classifyCoordinatePolicy(input: CoordinatePolicyInput): CoordinatePolicyVerdict {
  const hasLat = finite(input.lat)
  const hasLon = finite(input.lon)
  const decision = typeof input.decision === 'string' ? input.decision.trim() : ''

  if (decision) {
    if (!(SUBJECT_DECISION_POLICIES as readonly string[]).includes(decision)) {
      return {
        ok: false,
        refusal: 'unknownDecision',
        message: `Явным решением можно назвать только ${SUBJECT_DECISION_POLICIES.join(' или ')}; получено «${decision}».`,
      }
    }
    if (decision === 'notApplicable') {
      if (hasLat || hasLon) {
        return {
          ok: false,
          refusal: 'decisionContradictsCoordinates',
          message: 'Решение notApplicable требует пустой пары координат, а координаты записаны.',
        }
      }
      return { ok: true, policy: 'notApplicable', derivedFrom: 'subjectDecision' }
    }
    if (!(hasLat && hasLon)) {
      return {
        ok: false,
        refusal: 'decisionContradictsCoordinates',
        message: 'Решение representativePoint требует полной пары координат: это всё ещё точка.',
      }
    }
    return { ok: true, policy: 'representativePoint', derivedFrom: 'subjectDecision' }
  }

  if (hasLat !== hasLon) {
    return { ok: false, refusal: 'halfPair', message: 'Записана одна координата из двух.' }
  }
  if (!hasLat) {
    return {
      ok: false,
      refusal: 'noCoordinates',
      message: 'Координат нет. Пустая пара сама по себе не является решением notApplicable.',
    }
  }

  const resolved = input.resolved ?? null
  const placeId = typeof resolved?.placeId === 'string' ? resolved.placeId.trim() : ''
  if (!placeId || !finite(resolved?.lat) || !finite(resolved?.lon)) {
    return {
      ok: false,
      refusal: 'unknownProvenance',
      message: 'Происхождение точки не подтверждено: нет опознанного места с собственными координатами.',
    }
  }
  // ОБЕ пары приводятся к канону ОДНИМ И ТЕМ ЖЕ правилом и только потом
  // сравниваются. Круг R5, находка P0-B: записываемая пара проходила канон
  // приёма, а пара резолвера — нет, и одна и та же точка Google
  // (`35.76001173325338` против `35.7600117`) объявлялась чужой. Допуска здесь
  // нет и быть не должно: допуск — это произвольное число, которое пришлось бы
  // обосновывать, а канонизация обеих сторон обосновывает себя сама.
  const sameLat = roundCoordinate(resolved.lat) === roundCoordinate(input.lat as number)
  const sameLon = roundCoordinate(resolved.lon) === roundCoordinate(input.lon as number)
  if (!sameLat || !sameLon) {
    return {
      ok: false,
      refusal: 'unknownProvenance',
      message: 'Записываемая точка не совпадает с точкой резолвера: подтверждено чужое место, а не эта координата.',
    }
  }
  return { ok: true, policy: 'exactObjectPoint', derivedFrom: 'resolvedGooglePlace' }
}

/**
 * Согласуется ли уже записанная политика с уже записанной парой координат.
 *
 * Живёт здесь, а не в проверке целостности, по той же причине, что и список
 * значений: сторож, повторивший правило у себя, разойдётся с писателем молча.
 * Это НЕ вывод политики — вывод делает classifyCoordinatePolicy. Здесь только
 * вопрос о существующей записи: не противоречит ли она сама себе.
 *
 * Пустая политика согласия не нарушает: у legacy-записи её просто нет, и это
 * отдельный долг миграции, а не противоречие в данных.
 */
export function coordinatePolicyAgreesWithCoords(
  policy: unknown,
  lat: number | null | undefined,
  lon: number | null | undefined,
): boolean {
  // Пустая политика — отдельный переходный случай: у legacy-записи её просто
  // нет, и это долг миграции, а не противоречие в данных.
  const empty = policy === null || policy === undefined || (typeof policy === 'string' && policy.trim() === '')
  if (empty) return true
  // Неизвестное НЕПУСТОЕ значение согласия не даёт. Прежняя редакция
  // возвращала на нём `true` — то есть неизвестное значение объявлялось
  // согласованным с любыми координатами. Это fail-open: непонятое принималось
  // за безобидное.
  if (!isCoordinatePolicy(policy)) return false
  const hasBoth = finite(lat) && finite(lon)
  const hasNeither = !finite(lat) && !finite(lon)
  if (policy === 'notApplicable') return hasNeither
  return hasBoth
}
