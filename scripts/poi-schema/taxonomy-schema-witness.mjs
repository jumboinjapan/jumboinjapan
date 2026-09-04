/**
 * Независимый живой свидетель схемной операции (10f-P R3 находка 5,
 * 10f-P R4 находка 1).
 *
 * Свидетель независим ОТ ИСПОЛНИТЕЛЯ и по коду чтения, и по коду формы, и по
 * коду классификации. Из модулей цепочки он берёт только адрес Meta API
 * (константа карточки); ожидаемое состояние — ИЗ БАЙТОВ КАРТОЧКИ, а не из
 * реестра и не из state-модуля исполнителя. Поэтому согласованная ошибка
 * функции, общей у исполнителя, свидетелем не разделяется.
 *
 * Что свидетель делает сам и полностью:
 *   • ограниченное сроком чтение (`readLiveSchema`);
 *   • ПОЛНАЯ проверка формы сырого ответа (`shapeProblem`) — корень, tables,
 *     каждая таблица, каждое поле, options и каждая опция; повреждение —
 *     именованный отрицательный вердикт, не исключение;
 *   • классификация «ровно по одному разу» СЧЁТОМ, а не Map/Set: каноническая
 *     таблица (по ID карточки) существует ровно один раз; каждое из четырёх
 *     целевых полей — ровно один раз; ID полей уникальны; select-опции —
 *     список без повторов, равный опциям карточки как мультимножество.
 *     Дубль имени, ID или опции даёт `ambiguous: true` и отказ — схлопнуть
 *     его нечем, потому что ничего не складывается в Map или Set.
 *
 * Авторизованное состояние (явная граница). Таблица по каноническому ID и
 * имени; у каждого поля — имя, тип, множество опций-кодов. `description` в
 * него НЕ входит (см. scope.unverifiedProperties карточки): это подпись,
 * правимая в интерфейсе Airtable, и «точного совпадения» никто не обещает.
 *
 * Результат: { verifiedSuccess, tableId, reason, fieldIds, ambiguous }.
 * `fieldIds` — ровно четыре ID в порядке карточки, только при успехе; gate
 * (taxonomy-schema-gate.mjs) проверяет это независимо и не верит одному
 * флагу verifiedSuccess.
 */

import { AIRTABLE_ORIGIN, CANONICAL_BASE_ID, CANONICAL_POI_TABLE_NAME, assertTaxonomySchemaCard } from './taxonomy-schema-card.mjs'
import { POI_TABLE_ID } from '../../src/lib/airtable-schema.ts'

export const WITNESS_DEFAULT_DEADLINE_MS = 30_000

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const nonEmpty = (v) => typeof v === 'string' && v.length > 0
const verdict = (over) => ({ verifiedSuccess: false, tableId: null, reason: null, fieldIds: [], ambiguous: false, ...over })

/** Собственное ограниченное сроком чтение — отдельный код от транспорта исполнителя. */
async function readLiveSchema({ fetchImpl, url, deadlineMs, setTimeoutImpl, clearTimeoutImpl }) {
  const controller = new AbortController()
  let reject
  const expired = new Promise((_, rej) => { reject = rej })
  expired.catch(() => {})
  const timer = setTimeoutImpl(() => { controller.abort(); reject(Object.assign(new Error(`свидетель: срок чтения ${deadlineMs} мс истёк`), { timedOut: true })) }, deadlineMs)
  try {
    const request = Promise.resolve().then(() => fetchImpl(url, { method: 'GET', headers: { Authorization: 'Bearer witness' }, cache: 'no-store', signal: controller.signal }))
    request.catch(() => {})
    const res = await Promise.race([request, expired])
    let status
    try { status = Number(res?.status) } catch { return { ok: false, reason: 'свидетель: ответ недоступен для чтения (status)' } }
    if (!(status >= 200 && status < 300)) return { ok: false, reason: `свидетель: чтение отклонено (${Number.isFinite(status) ? status : 'без статуса'})` }
    const bodyP = Promise.resolve().then(() => (typeof res.text === 'function' ? res.text() : res.json().then((j) => JSON.stringify(j))))
    bodyP.catch(() => {})
    const text = await Promise.race([bodyP, expired])
    let data
    try { data = JSON.parse(typeof text === 'string' ? text : String(text)) } catch { return { ok: false, reason: 'свидетель: тело не JSON' } }
    return { ok: true, data }
  } catch (error) {
    let message
    try { message = error?.timedOut ? error.message : `свидетель: провод: ${error?.message ?? String(error)}` } catch { message = 'свидетель: провод: описание ошибки недоступно' }
    return { ok: false, reason: message }
  } finally {
    clearTimeoutImpl(timer)
  }
}

/**
 * Полная проверка формы сырого ответа. Возвращает строку-адрес первого
 * повреждения либо null. Ничего не чинит и не отбрасывает: свидетель
 * смотрит на ответ целиком, как он пришёл.
 */
export function shapeProblem(data) {
  if (!isPlain(data)) return 'корень: ожидается объект'
  if (!Array.isArray(data.tables)) return 'tables: ожидается массив'
  for (const [ti, table] of data.tables.entries()) {
    const tw = `tables[${ti}]`
    if (!isPlain(table)) return `${tw}: ожидается объект`
    if (!nonEmpty(table.id)) return `${tw}.id: ожидается непустая строка`
    if (typeof table.name !== 'string') return `${tw}.name: ожидается строка`
    if (!Array.isArray(table.fields)) return `${tw}.fields: ожидается массив`
    for (const [fi, field] of table.fields.entries()) {
      const fw = `${tw}.fields[${fi}]`
      if (!isPlain(field)) return `${fw}: ожидается объект`
      if (!nonEmpty(field.id)) return `${fw}.id: ожидается непустая строка`
      if (typeof field.name !== 'string') return `${fw}.name: ожидается строка`
      if (!nonEmpty(field.type)) return `${fw}.type: ожидается непустая строка`
      if (field.description !== undefined && typeof field.description !== 'string') return `${fw}.description: ожидается строка`
      if (field.options !== undefined) {
        if (!isPlain(field.options)) return `${fw}.options: ожидается объект`
        if (field.options.choices !== undefined) {
          if (!Array.isArray(field.options.choices)) return `${fw}.options.choices: ожидается массив`
          for (const [ci, choice] of field.options.choices.entries()) {
            if (!isPlain(choice) || typeof choice.name !== 'string') return `${fw}.options.choices[${ci}]: ожидается объект с name-строкой`
          }
        }
      }
    }
  }
  return null
}

/** Мультимножество строк: отсортированный список; повторы НЕ схлопываются. */
const sortedList = (names) => [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
const duplicatesOf = (names) => {
  const seen = new Map()
  for (const n of names) seen.set(n, (seen.get(n) ?? 0) + 1)
  return [...seen.entries()].filter(([, k]) => k > 1).map(([n, k]) => `«${n}»×${k}`)
}

/**
 * Классификация «ровно по одному разу» по данным карточки. Чистая функция
 * от уже проверенной по форме схемы; возвращает вердикт, никогда не бросает.
 */
export function classifyWitness(tables, card) {
  const bodies = Array.isArray(card?.fields) ? card.fields.map((f) => f?.request?.body) : []
  // База и таблица — КАНОНИЧЕСКИЕ КОНСТАНТЫ, карточкой не переопределяются.
  const canonicalTableId = POI_TABLE_ID
  const canonicalTableName = CANONICAL_POI_TABLE_NAME
  if (bodies.length !== 4 || bodies.some((b) => !isPlain(b) || !nonEmpty(b.name) || !nonEmpty(b.type))) return verdict({ reason: 'свидетель: карточка обязана нести ровно четыре поля' })
  // Каноническая таблица — ровно один раз по КОНСТАНТЕ ID; имя — каноническое; дубль имени у чужого ID — неоднозначность.
  const byId = tables.filter((t) => t.id === canonicalTableId)
  if (byId.length === 0) return verdict({ reason: `свидетель: таблицы с каноническим ID ${canonicalTableId} нет` })
  if (byId.length > 1) return verdict({ ambiguous: true, reason: `свидетель: таблица с каноническим ID ${canonicalTableId} присутствует ${byId.length} раза — схема неоднозначна` })
  const table = byId[0]
  if (table.name !== canonicalTableName) return verdict({ tableId: table.id, reason: `свидетель: таблица ${canonicalTableId} называется «${table.name}», ожидается «${canonicalTableName}»` })
  const sameName = tables.filter((t) => t.name === canonicalTableName)
  if (sameName.length > 1) return verdict({ tableId: table.id, ambiguous: true, reason: `свидетель: имя «${canonicalTableName}» носят ${sameName.length} таблицы — схема неоднозначна` })
  // ID полей уникальны в таблице.
  const idDupes = duplicatesOf(table.fields.map((f) => f.id))
  if (idDupes.length) return verdict({ tableId: table.id, ambiguous: true, reason: `свидетель: ID полей повторяются: ${idDupes.join(', ')} — схема неоднозначна` })
  const fieldIds = []
  for (const body of bodies) {
    const same = table.fields.filter((f) => f.name === body.name)
    if (same.length === 0) return verdict({ tableId: table.id, reason: `свидетель: поля «${body.name}» нет` })
    if (same.length > 1) return verdict({ tableId: table.id, ambiguous: true, reason: `свидетель: поле «${body.name}» присутствует ${same.length} раза — схема неоднозначна` })
    const live = same[0]
    if (live.type !== body.type) return verdict({ tableId: table.id, reason: `свидетель: поле «${body.name}»: тип ${live.type}, ожидается ${body.type}` })
    const want = body.options?.choices?.map((c) => c?.name) ?? null
    if (want !== null) {
      if (want.some((n) => !nonEmpty(n))) return verdict({ tableId: table.id, reason: `свидетель: карточка: опции поля «${body.name}» повреждены` })
      const wantDupes = duplicatesOf(want)
      if (wantDupes.length) return verdict({ tableId: table.id, reason: `свидетель: карточка: опции поля «${body.name}» повторяются: ${wantDupes.join(', ')}` })
      const have = (live.options?.choices ?? []).map((c) => c.name)
      const haveDupes = duplicatesOf(have)
      if (haveDupes.length) return verdict({ tableId: table.id, ambiguous: true, reason: `свидетель: поле «${body.name}»: опции повторяются: ${haveDupes.join(', ')} — схема неоднозначна` })
      const w = sortedList(want); const h = sortedList(have)
      if (w.length !== h.length || w.some((n, i) => n !== h[i])) {
        const absent = want.filter((n) => !have.includes(n)); const extra = have.filter((n) => !want.includes(n))
        return verdict({ tableId: table.id, reason: `свидетель: поле «${body.name}»: ${[absent.length ? `нет опций: ${absent.join(', ')}` : '', extra.length ? `лишние опции: ${extra.join(', ')}` : ''].filter(Boolean).join('; ')}` })
      }
    }
    fieldIds.push(live.id)
  }
  return { verifiedSuccess: true, tableId: table.id, reason: null, fieldIds, ambiguous: false }
}

/**
 * Читает живую схему сам, проверяет форму сам и классифицирует своим кодом.
 * Никогда не бросает: любой отказ — именованный вердикт.
 *
 * ПОРЯДОК ЗНАЧИМ (10f-P R5, находка 2): полная КАНОНИЧЕСКАЯ проверка карточки
 * (база, таблица, поля — из loader'а) выполняется ДО построения маршрута и ДО
 * единственного сетевого чтения. Ни baseId, ни tableId карточка переопределить
 * не может: URL строится из КОНСТАНТЫ `CANONICAL_BASE_ID`, а таблица ищется по
 * КОНСТАНТЕ `POI_TABLE_ID`, а не из полей карточки. Карточка, не прошедшая
 * строгий контракт (чужой baseId, чужое имя поля), отвергается ДО запроса —
 * credentialed GET в чужую базу невозможен.
 */
export async function witnessTaxonomySchema({
  fetchImpl, cardBytes, deadlineMs = WITNESS_DEFAULT_DEADLINE_MS,
  setTimeoutImpl = globalThis.setTimeout, clearTimeoutImpl = globalThis.clearTimeout,
}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('свидетель: fetchImpl обязателен — свидетель читает сам')
  let card
  try { card = JSON.parse(Buffer.from(cardBytes).toString('utf8')) } catch { return verdict({ reason: 'свидетель: байты карточки не разбираются' }) }
  // Каноническая проверка карточки ДО маршрута и ДО сети. Свидетель не бросает.
  try { assertTaxonomySchemaCard(card) } catch (error) { return verdict({ reason: `свидетель: карточка не прошла канонический контракт: ${error?.message ?? 'отказ'}` }) }
  // Маршрут — из КОНСТАНТЫ канонической базы, не из карточки.
  const url = `${AIRTABLE_ORIGIN}/v0/meta/bases/${CANONICAL_BASE_ID}/tables`
  const read = await readLiveSchema({ fetchImpl, url, deadlineMs, setTimeoutImpl, clearTimeoutImpl })
  if (!read.ok) return verdict({ reason: read.reason })
  const problem = shapeProblem(read.data)
  if (problem !== null) return verdict({ reason: `свидетель: ответ схемы повреждён: ${problem}` })
  return classifyWitness(read.data.tables, card)
}
