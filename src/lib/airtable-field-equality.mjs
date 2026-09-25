/** Pure Airtable field comparison shared by runtime Intake and CLI verification. No I/O. */
import { parseMoment } from './poi-coordinate-refresh.ts'

/** Значение поля, которое Airtable не хранит: пустая строка, null, undefined. */
export const isEmptyAirtableField = (value) => value === undefined || value === null || value === ''

/**
 * Равенство одного поля — то, что обещано, против того, что прочитано.
 * Нормализуется только различие «отсутствует», объявленное самим Airtable
 * (пустое значение не хранится); всё остальное сравнивается точно.
 */
const INSTANT_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
/**
 * Момент — КАЛЕНДАРНО СТРОГИЙ (10f-R R5, находка 2). `Date.parse` нормализует
 * переполнение: `2026-02-31T12:00:00.000Z` он читал как 3 марта, и невозможный
 * момент подтверждал поле записи. Разбор — `parseMoment` (10f-P): день по
 * месяцу, високосный год, диапазоны времени; иначе null.
 */
const asInstant = (value) => (typeof value === 'string' && INSTANT_SHAPE.test(value) ? parseMoment(value) : null)

export function fieldEquals(expected, actual, fieldName = null) {
  /* Coords Checked At принимает календарный день; Airtable dateTime возвращает
     его как полночь UTC. Нормализация только этого поля: другие строки и
     неполночные моменты не превращаются в тот же день. parseMoment проверяет
     календарь и не допускает переполнение вроде 31 февраля. */
  const dayShape = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  if (fieldName === 'Coords Checked At' && (dayShape(expected) || dayShape(actual))) {
    const instant = (value) => asInstant(dayShape(value) ? `${value}T00:00:00.000Z` : value)
    const left = instant(expected)
    const right = instant(actual)
    return left !== null && right !== null && left === right
  }
  if (isEmptyAirtableField(expected) && isEmptyAirtableField(actual)) return true
  if (isEmptyAirtableField(expected) || isEmptyAirtableField(actual)) return false
  /* Момент времени: Airtable возвращает dateTime в своём каноническом ISO
     (с миллисекундами или без — по настройке поля). Сравнивается САМ момент,
     а не его написание; это единственная нормализация помимо «отсутствует»,
     и она объявлена самим типом поля. Значение ФОРМЫ момента, но календарно
     невозможное, не равно ничему — даже побайтово такой же строке: такого
     момента нет, и подтверждать им поле нельзя. */
  const shaped = (v) => typeof v === 'string' && INSTANT_SHAPE.test(v)
  if (shaped(expected) || shaped(actual)) {
    const left = asInstant(expected)
    const right = asInstant(actual)
    if (left === null || right === null) return false
    return left === right
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return false
    const key = (v) => JSON.stringify(v)
    const left = expected.map(key).sort()
    const right = actual.map(key).sort()
    return left.every((v, i) => v === right[i])
  }
  if (typeof expected === 'object' || typeof actual === 'object') {
    return JSON.stringify(expected) === JSON.stringify(actual)
  }
  return expected === actual
}

