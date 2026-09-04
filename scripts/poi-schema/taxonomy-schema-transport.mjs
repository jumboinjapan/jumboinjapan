/**
 * Транспорт Meta API для схемной операции: два метода — прочитать схему и
 * создать поле. Ничего другого он не умеет по построению: ни PATCH, ни
 * DELETE, ни записи строк.
 *
 * Срок (10f-P R3, находка 1). КАЖДЫЙ полный сетевой обмен — соединение,
 * заголовки и тело — ограничен одним сроком `deadlineMs`. Зависший GET или
 * POST не держит процесс: по истечении срока обмен прерывается (AbortSignal),
 * чтение тела тоже. Истёкший GET — исключение с `cause: 'readTimeout'`;
 * истёкший POST — `ambiguous`: эффект неизвестен, и его устанавливает только
 * отдельное ограниченное чтение выше, без повтора POST.
 *
 * Форма ответа (находка 2). Сырой ответ схемы валидируется ЗДЕСЬ полностью
 * (`parseSchemaTables`): таблицы, поля, опции — только ожидаемой формы.
 * Повреждённый ответ — исключение с `cause: 'schemaCorrupt'`, а не
 * TypeError из глубины классификации. Исполнитель превращает любую причину
 * недоступности чтения после POST в именованный исход `unknown`.
 *
 * Исход POST классифицируется здесь только по форме HTTP-ответа;
 * неопределённость (исключение провода, обрыв, 5xx, срок) возвращается как
 * `ambiguous` и решается выше — перечитыванием схемы.
 */

import { AIRTABLE_ORIGIN, META_FIELDS_PATH, META_TABLES_PATH } from './taxonomy-schema-card.mjs'

export { AIRTABLE_ORIGIN }
/** Срок одного полного обмена по умолчанию: соединение + заголовки + тело. */
export const DEFAULT_EXCHANGE_DEADLINE_MS = 30_000
export const READ_FAILURE_CAUSES = Object.freeze(['readTimeout', 'readFailed', 'readRefused', 'schemaCorrupt'])

/** Ошибка чтения схемы с именованной причиной (`cause` ∈ READ_FAILURE_CAUSES). */
export class SchemaReadError extends Error {
  constructor(cause, message) {
    super(message)
    this.name = 'SchemaReadError'
    if (!READ_FAILURE_CAUSES.includes(cause)) throw new TypeError(`SchemaReadError: неизвестная причина ${cause}`)
    this.cause = cause
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const nonEmpty = (v) => typeof v === 'string' && v.length > 0

/**
 * Безопасный разбор брошенного значения на границе провода (10f-P R5,
 * находки 1 и 3). Само брошенное значение может быть СЫРЫМ отозванным Proxy:
 * `error?.timedOut` и `error?.message` через `?.` всё равно срабатывают на
 * trap и бросают. Здесь каждый доступ обёрнут — функция не бросает никогда.
 */
function inspectThrown(error) {
  let timedOut = false
  try { timedOut = error?.timedOut === true } catch { timedOut = false }
  let message = 'значение недоступно'
  try {
    if (error instanceof Error) message = String(error.message ?? '')
    else message = String(error)
  } catch { message = 'значение недоступно (возможно отозванный Proxy)' }
  return { timedOut, message: message.slice(0, 300) }
}

/**
 * Полная валидация сырого ответа `GET /v0/meta/bases/{baseId}/tables`.
 * Возвращает НОВЫЙ массив таблиц ровно ожидаемой формы (лишние ключи
 * отброшены) или бросает SchemaReadError('schemaCorrupt', …) с адресом
 * повреждения. Ничего не «чинит» и не пропускает молча.
 */
export function parseSchemaTables(data) {
  const corrupt = (where, what) => { throw new SchemaReadError('schemaCorrupt', `ответ схемы повреждён: ${where}: ${what}`) }
  if (!isPlain(data)) corrupt('корень', 'ожидается объект')
  if (!Array.isArray(data.tables)) corrupt('tables', 'ожидается массив')
  return data.tables.map((table, ti) => {
    const where = `tables[${ti}]`
    if (!isPlain(table)) corrupt(where, 'ожидается объект')
    if (!nonEmpty(table.id)) corrupt(`${where}.id`, 'ожидается непустая строка')
    if (typeof table.name !== 'string') corrupt(`${where}.name`, 'ожидается строка')
    if (!Array.isArray(table.fields)) corrupt(`${where}.fields`, 'ожидается массив')
    const fields = table.fields.map((field, fi) => {
      const fw = `${where}.fields[${fi}]`
      if (!isPlain(field)) corrupt(fw, 'ожидается объект')
      if (!nonEmpty(field.id)) corrupt(`${fw}.id`, 'ожидается непустая строка')
      if (typeof field.name !== 'string') corrupt(`${fw}.name`, 'ожидается строка')
      if (!nonEmpty(field.type)) corrupt(`${fw}.type`, 'ожидается непустая строка')
      if (field.description !== undefined && typeof field.description !== 'string') corrupt(`${fw}.description`, 'ожидается строка')
      const out = { id: field.id, name: field.name, type: field.type }
      if (field.description !== undefined) out.description = field.description
      if (field.options !== undefined) {
        if (!isPlain(field.options)) corrupt(`${fw}.options`, 'ожидается объект')
        if (field.options.choices !== undefined) {
          if (!Array.isArray(field.options.choices)) corrupt(`${fw}.options.choices`, 'ожидается массив')
          const choices = field.options.choices.map((choice, ci) => {
            if (!isPlain(choice) || typeof choice.name !== 'string') corrupt(`${fw}.options.choices[${ci}]`, 'ожидается объект с name-строкой')
            return { name: choice.name }
          })
          out.options = { choices }
        } else {
          out.options = {}
        }
      }
      return out
    })
    return { id: table.id, name: table.name, fields }
  })
}

/**
 * Один полный обмен под одним сроком. Возвращает { status, text } либо
 * бросает { timedOut: true, phase } при истечении срока. Подвисший fetch
 * прерывается сигналом; его поздний отказ гасится, чтобы не стать
 * необработанным отклонением.
 */
async function exchange({ fetchImpl, url, init, deadlineMs, setTimeoutImpl, clearTimeoutImpl }) {
  const controller = new AbortController()
  let timer = null
  let phase = 'headers'
  let expire
  const expired = new Promise((_, reject) => { expire = reject })
  // Отказ по сроку всегда имеет потребителя: без этого срабатывание таймера в
  // обход race стало бы необработанным отклонением и уронило бы процесс.
  expired.catch(() => {})
  timer = setTimeoutImpl(() => {
    controller.abort()
    expire(Object.assign(new Error(`срок обмена ${deadlineMs} мс истёк (${phase === 'headers' ? 'до заголовков' : 'на теле'})`), { timedOut: true, phase }))
  }, deadlineMs)
  try {
    const request = Promise.resolve().then(() => fetchImpl(url, { ...init, signal: controller.signal }))
    request.catch(() => {})
    const res = await Promise.race([request, expired])
    phase = 'body'
    const body = Promise.resolve().then(() => (typeof res?.text === 'function' ? res.text() : res.json().then((j) => JSON.stringify(j))))
    body.catch(() => {})
    const text = await Promise.race([body, expired])
    return { status: Number(res?.status), text: typeof text === 'string' ? text : String(text) }
  } finally {
    clearTimeoutImpl(timer)
  }
}

export function createMetaTransport({
  token, fetchImpl = globalThis.fetch, deadlineMs = DEFAULT_EXCHANGE_DEADLINE_MS,
  setTimeoutImpl = globalThis.setTimeout, clearTimeoutImpl = globalThis.clearTimeout,
}) {
  if (typeof token !== 'string' || !token.trim()) throw new TypeError('транспорт схемы: токен обязателен')
  if (typeof fetchImpl !== 'function') throw new TypeError('транспорт схемы: fetch обязателен')
  if (!Number.isInteger(deadlineMs) || deadlineMs <= 0) throw new TypeError('транспорт схемы: deadlineMs — целое число миллисекунд > 0')
  const headers = { Authorization: `Bearer ${token}` }
  const timers = { setTimeoutImpl, clearTimeoutImpl }
  return Object.freeze({
    deadlineMs,
    /**
     * GET схемы базы под одним сроком, с полной валидацией формы. Любой отказ —
     * SchemaReadError с причиной: readTimeout | readFailed | readRefused | schemaCorrupt.
     * Чтение повторяемо и неопределённости не создаёт.
     */
    async readSchema() {
      let res
      try {
        res = await exchange({ fetchImpl, url: `${AIRTABLE_ORIGIN}${META_TABLES_PATH}`, init: { method: 'GET', headers, cache: 'no-store' }, deadlineMs, ...timers })
      } catch (error) {
        const { timedOut, message } = inspectThrown(error)
        if (timedOut) throw new SchemaReadError('readTimeout', `Meta API read: ${message}`)
        throw new SchemaReadError('readFailed', `Meta API read: провод: ${message}`)
      }
      if (!(res.status >= 200 && res.status < 300)) throw new SchemaReadError('readRefused', `Meta API read: ${res.status} ${res.text.slice(0, 300)}`)
      let data
      try { data = JSON.parse(res.text) } catch { throw new SchemaReadError('schemaCorrupt', 'ответ схемы повреждён: тело не JSON') }
      return parseSchemaTables(data)
    },
    /**
     * POST одного поля под одним сроком. Возвращает:
     *   { kind: 'applied', fieldId }        — 2xx с id поля;
     *   { kind: 'refused', status, body }   — 4xx: провайдер отказал, эффекта нет по его словам;
     *   { kind: 'ambiguous', reason }       — срок, исключение провода или 5xx: эффект неизвестен.
     * Никогда не бросает после отправки и никогда не повторяет: неопределённость — значение.
     */
    async createField(body) {
      // Защита НА УРОВНЕ ТРАНСПОРТА: чем бы ни ответил внедрённый fetchImpl —
      // броском, зависанием, ответом с бросающими геттерами — наружу выходит
      // только { kind }, никогда исключение. `exchange` читает ответ и тело
      // внутри этого try, поэтому враждебная реализация провода не выпускает
      // исключение из транспорта. Исполнитель на это не полагается и защищён сам.
      let res
      try {
        res = await exchange({
          fetchImpl, url: `${AIRTABLE_ORIGIN}${META_FIELDS_PATH}`,
          init: { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
          deadlineMs, ...timers,
        })
      } catch (error) {
        const { timedOut, message } = inspectThrown(error)
        if (timedOut) return { kind: 'ambiguous', reason: `POST: ${message}; эффект устанавливается только чтением` }
        return { kind: 'ambiguous', reason: `провод: ${message}` }
      }
      const status = res.status
      if (status >= 200 && status < 300) {
        let data = null
        try { data = JSON.parse(res.text) } catch { return { kind: 'ambiguous', reason: 'тело 2xx не разбирается' } }
        return typeof data?.id === 'string' ? { kind: 'applied', fieldId: data.id } : { kind: 'ambiguous', reason: '2xx без id поля' }
      }
      if (status >= 400 && status < 500) return { kind: 'refused', status, body: String(res.text).slice(0, 500) }
      return { kind: 'ambiguous', reason: `статус ${Number.isFinite(status) ? status : 'неизвестен'}` }
    },
  })
}
