/**
 * НАБЛЮДЕНИЕ ЧАСОВ РАБОТЫ ИЗ ВЫГРУЗКИ BODIK — `poi-hours-observation/v1`
 * (10h-C, SC‑005 U3; решения владельца I‑2.2, I‑2.4, I‑4.4).
 *
 * Наблюдение отвечает на один вопрос: «ЧТО ИСТОЧНИК УТВЕРЖДАЕТ О ЧАСАХ» — и
 * отличает утверждение от его отсутствия и от того, что утверждением быть не
 * может. Пустой, противоречивый, частичный или временный факт НЕ маскируется
 * под постоянные часы: предложить новое значение поля может только `stated`.
 * Всё остальное — именованный род наблюдения, который идёт в очередь
 * `needs_review`, а не в карточку обновления.
 *
 * Роды — закрытый список:
 *   stated         начало и конец заданы, форма HH:MM, конец позже начала,
 *                  примечание не делает факт временным; предложенная строка
 *                  собирается ТОЙ ЖЕ `composeWorkingHours`, что и при создании
 *                  записи, — иначе сравнение с базой сравнивало бы два формата;
 *   absent         ни дней, ни времён, ни примечания — источник молчит;
 *   partial        часть факта: только начало, только конец, только дни;
 *   contradictory  время не разбирается или конец не позже начала;
 *   temporary      примечание (или ячейки времени) говорит о временном или
 *                  условном режиме: временно, изменение, предполагается,
 *                  требует уточнения, не определено, приостановка, каникулы.
 *
 * Тождество наблюдения — только `Source Key` (I‑2.3): сопоставление по имени
 * или координатам тождеством не считается и здесь не делается.
 */
import { composeWorkingHours } from './opendata-csv.mjs'

export const HOURS_OBSERVATION_SPEC = 'poi-hours-observation/v1'
export const HOURS_OBSERVATION_KINDS = Object.freeze(['stated', 'absent', 'partial', 'contradictory', 'temporary'])
/** Поле Airtable, которое пилот вправе предлагать к обновлению (I‑2.2). */
export const HOURS_FIELD = 'Working Hours'

/**
 * Маркеры временного или условного режима — закрытый список подстрок в
 * примечании и ячейках времени. Список намеренно короткий и консервативный:
 * ложное «временно» лишь отправляет строку в очередь на просмотр, ложное
 * «постоянно» затёрло бы часы.
 */
export const TEMPORARY_MARKERS = Object.freeze([
  '臨時', '期間限定', '期間中', '変更', '予定', '要確認', '未定', '休止', '休業中', '当面', '暫定', '一時', '不定期',
])

const TIME_SHAPE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/

/** Разбор времени «H:MM»/«HH:MM[:SS]» в минуты от полуночи; null — не время. */
export function parseClockMinutes(value) {
  if (typeof value !== 'string') return null
  const m = value.trim().match(TIME_SHAPE)
  if (!m) return null
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null
  return hours * 60 + minutes
}

const clean = (value) => (typeof value === 'string' ? value.trim() : '')
const marked = (text) => TEMPORARY_MARKERS.filter((marker) => text.includes(marker))

/**
 * Классификация одной строки источника. Чистая функция; вход — сырые ячейки
 * (`hoursFacts` адаптера). Результат несёт род, причины и — только для
 * `stated` — предложенное значение поля.
 */
export function observeWorkingHours(fact) {
  const sourceKey = typeof fact?.sourceKey === 'string' && fact.sourceKey ? fact.sourceKey : null
  if (!sourceKey) throw new TypeError(`${HOURS_OBSERVATION_SPEC}: наблюдение без ключа источника не строится`)
  const openDays = clean(fact.openDays)
  const openFrom = clean(fact.openFrom)
  const openTo = clean(fact.openTo)
  const openNote = clean(fact.openNote)
  const base = { spec: HOURS_OBSERVATION_SPEC, sourceKey, rowIndex: Number.isInteger(fact.rowIndex) ? fact.rowIndex : null, raw: { openDays, openFrom, openTo, openNote } }
  const result = (kind, reasons, hours = null) => ({ ...base, kind, reasons, hours })

  if (!openDays && !openFrom && !openTo && !openNote) return result('absent', ['источник не сообщает ни дней, ни времени, ни примечания'])
  const temporaryIn = [...new Set([...marked(openNote), ...marked(openDays), ...marked(openFrom), ...marked(openTo)])]
  if (temporaryIn.length) return result('temporary', [`примечание или ячейки времени говорят о временном/условном режиме: ${temporaryIn.join(', ')}`])
  if (!openFrom && !openTo) return result('partial', [openDays ? 'заданы только дни, время не указано' : 'задано только примечание, время не указано'])
  if (!openFrom || !openTo) return result('partial', [openFrom ? 'задано начало без конца' : 'задан конец без начала'])
  const from = parseClockMinutes(openFrom)
  const to = parseClockMinutes(openTo)
  if (from === null || to === null) return result('contradictory', [`время не разбирается как HH:MM: ${from === null ? `начало «${openFrom}»` : ''}${from === null && to === null ? ', ' : ''}${to === null ? `конец «${openTo}»` : ''}`])
  if (to <= from) return result('contradictory', [`конец ${openTo} не позже начала ${openFrom}`])
  const hours = composeWorkingHours({ openDays, openFrom, openTo, openNote })
  if (!hours) return result('contradictory', ['составленная строка часов пуста'])
  return result('stated', [], hours)
}

/** Наблюдения по всем фактам адаптера; повтор ключа — отказ (тождество одно). */
export function observeHoursFacts(facts) {
  if (!Array.isArray(facts)) throw new TypeError(`${HOURS_OBSERVATION_SPEC}: ожидается массив фактов адаптера (hoursFacts)`)
  const seen = new Set()
  return facts.map((fact) => {
    const observation = observeWorkingHours(fact)
    if (seen.has(observation.sourceKey)) throw new Error(`${HOURS_OBSERVATION_SPEC}: ключ ${observation.sourceKey} встречается дважды — тождество наблюдения нарушено`)
    seen.add(observation.sourceKey)
    return observation
  })
}
