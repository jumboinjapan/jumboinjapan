/**
 * КАРТОЧКА ОБНОВЛЕНИЯ — `poi-update-card/v1` (10h-B, DAG 2.8).
 *
 * Обновление существующих записей идёт только по карточке: замороженный
 * список строк `recordId + old → proposed`, собранный по СВЕЖЕМУ чтению базы
 * ДО серии (карта § 8, маршрут «Update, migration или delete»; change-policy
 * § 21). Карточка — то, что владелец видел и на что выдаёт разрешение; её
 * отпечаток входит в разрешение, в журнал и в отчёт.
 *
 * Что карточка знает о каждой строке:
 *   • `recordId`   — тождество записи в Airtable (по нему идёт PATCH и чтение);
 *   • `poiId`, `sourceKey` — тождество для человека и сверки; изменять их, как и
 *                   координатный контур, этим путём нельзя (`UPDATE_PROTECTED_FIELDS`);
 *   • `expectedOld` — прежние значения РОВНО тех полей, что предлагается
 *                   изменить, как они прочитаны при сборке карточки; это и
 *                   есть резервная копия для ручного восстановления;
 *   • `proposed`   — новые значения тех же полей.
 * Строка, у которой предложенное уже равно прежнему, в карточку не попадает:
 * нечего применять — нечего и разрешать.
 *
 * Карточка ВОССТАНОВЛЕНИЯ (change-policy § 21): после прерванной серии
 * готовится новая карточка ровно на оставшиеся строки; применённые в неё не
 * входят, отпечаток исходной карточки записан в `recoveredFrom`. Исходная
 * карточка и журнал не переписываются.
 */
import {
  assertCanonicalInstant,
  assertExactKeys,
  assertNonEmptyString,
  assertSha256Value,
  canonicalJsonBytes,
  deepFreeze,
} from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { fieldEquals } from './verified-write.mjs'
import { RECORD_ID_SHAPE, UPDATE_PROTECTED_FIELDS } from './update-journal.mjs'

export const UPDATE_CARD_SPEC = 'poi-update-card/v1'
/** Точный состав карточки — закрытый список. */
export const UPDATE_CARD_KEYS = Object.freeze(['spec', 'scopeId', 'portal', 'createdAt', 'recoveredFrom', 'rows', 'note'])
/** Точный состав строки — закрытый список. */
export const UPDATE_ROW_KEYS = Object.freeze(['recordId', 'poiId', 'sourceKey', 'expectedOld', 'proposed'])

const isPlain = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Значение поля Airtable в карточке: JSON-скаляр, null или массив скаляров. */
const isFieldValue = (value) => {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))
  return false
}

/** Канонический отпечаток карточки — тождество для разрешения, журнала и отчёта. */
export function updateCardDigest(card) {
  return sha256Bytes(canonicalJsonBytes(card, UPDATE_CARD_SPEC))
}

/**
 * Разбор и проверка ФОРМЫ карточки. Возвращает замороженное значение.
 * Строки отсортированы по `recordId` и уникальны — иначе две карточки одного
 * состава давали бы разные отпечатки, а одна запись обновлялась бы дважды.
 */
export function parseUpdateCard(raw, where = UPDATE_CARD_SPEC) {
  if (!isPlain(raw)) throw new TypeError(`${where}: карточка обязана быть объектом JSON`)
  const specSlot = Object.getOwnPropertyDescriptor(raw, 'spec')
  const spec = specSlot && 'value' in specSlot ? specSlot.value : undefined
  if (spec !== UPDATE_CARD_SPEC) throw new TypeError(`${where}.spec: ожидается ${UPDATE_CARD_SPEC}, получено ${JSON.stringify(spec)}`)
  assertExactKeys(raw, UPDATE_CARD_KEYS, where)
  assertNonEmptyString(raw.scopeId, `${where}.scopeId`)
  assertNonEmptyString(raw.portal, `${where}.portal`)
  assertNonEmptyString(raw.note, `${where}.note`)
  assertCanonicalInstant(raw.createdAt, `${where}.createdAt`)
  if (raw.recoveredFrom !== null) assertSha256Value(raw.recoveredFrom, `${where}.recoveredFrom`)
  if (!Array.isArray(raw.rows) || !raw.rows.length) throw new TypeError(`${where}.rows: непустой список строк обязателен — карточка называет записи поимённо`)
  const rows = raw.rows.map((row, i) => parseUpdateRow(row, `${where}.rows[${i}]`))
  const ids = rows.map((row) => row.recordId)
  if (new Set(ids).size !== ids.length) throw new TypeError(`${where}.rows: повтор recordId — одна запись обновляется одной строкой`)
  if ([...ids].sort().join(' ') !== ids.join(' ')) throw new TypeError(`${where}.rows: строки обязаны быть отсортированы по recordId — иначе один состав даёт разные отпечатки`)
  return deepFreeze({ ...raw, rows })
}

export function parseUpdateRow(row, where) {
  assertExactKeys(row, UPDATE_ROW_KEYS, where)
  assertNonEmptyString(row.recordId, `${where}.recordId`)
  if (!RECORD_ID_SHAPE.test(row.recordId)) throw new TypeError(`${where}.recordId: ${JSON.stringify(row.recordId)} — не идентификатор записи Airtable`)
  if (row.poiId !== null) assertNonEmptyString(row.poiId, `${where}.poiId`)
  if (row.sourceKey !== null) assertNonEmptyString(row.sourceKey, `${where}.sourceKey`)
  if (!isPlain(row.proposed) || !Object.keys(row.proposed).length) throw new TypeError(`${where}.proposed: непустой объект полей обязателен`)
  if (!isPlain(row.expectedOld)) throw new TypeError(`${where}.expectedOld: ожидается объект прежних значений`)
  const proposedKeys = Object.keys(row.proposed).sort()
  const oldKeys = Object.keys(row.expectedOld).sort()
  if (proposedKeys.join('') !== oldKeys.join('')) {
    throw new TypeError(`${where}: expectedOld обязан нести прежнее значение РОВНО каждого предлагаемого поля (proposed: ${proposedKeys.join(', ')}; expectedOld: ${oldKeys.join(', ')})`)
  }
  for (const key of proposedKeys) {
    if (!key.trim()) throw new TypeError(`${where}.proposed: пустое имя поля`)
    if (UPDATE_PROTECTED_FIELDS.includes(key)) throw new TypeError(`${where}.proposed: защищённое поле ${JSON.stringify(key)} (тождество или координатный контур) этим путём не обновляется`)
    if (!isFieldValue(row.proposed[key])) throw new TypeError(`${where}.proposed[${JSON.stringify(key)}]: значение обязано быть JSON-скаляром, null или списком скаляров`)
    if (!isFieldValue(row.expectedOld[key])) throw new TypeError(`${where}.expectedOld[${JSON.stringify(key)}]: значение обязано быть JSON-скаляром, null или списком скаляров`)
    if (fieldEquals(row.proposed[key], row.expectedOld[key])) {
      throw new TypeError(`${where}.proposed[${JSON.stringify(key)}]: предложенное равно прежнему — полю нечего применять, строка карточки обязана менять каждое названное поле`)
    }
  }
  return { recordId: row.recordId, poiId: row.poiId, sourceKey: row.sourceKey, expectedOld: { ...row.expectedOld }, proposed: { ...row.proposed } }
}

/**
 * Сборка карточки из НАБЛЮДЕНИЙ (свежее чтение базы) и ПРЕДЛОЖЕНИЙ.
 * Чистая функция: сеть — у вызывающего. Для каждой записи в карточку
 * попадают только поля, у которых предложенное отличается от наблюдаемого;
 * записи без единого различия не попадают вовсе. Предложение для записи, у
 * которой нет наблюдения, — отказ: без прежнего значения строка не собирается.
 *
 * @param input.observations  `[{ recordId, poiId, sourceKey, fields }]` — прочитанное
 * @param input.proposals     `[{ recordId, proposed }]` — что предлагается
 */
export function buildUpdateCard({ scopeId, portal, createdAt, note, observations, proposals, recoveredFrom = null }) {
  const observed = new Map()
  for (const o of observations ?? []) {
    if (!isPlain(o) || typeof o.recordId !== 'string') throw new TypeError(`${UPDATE_CARD_SPEC}: наблюдение без recordId`)
    if (observed.has(o.recordId)) throw new TypeError(`${UPDATE_CARD_SPEC}: два наблюдения одной записи ${o.recordId}`)
    observed.set(o.recordId, o)
  }
  const rows = []
  const skipped = []
  const seen = new Set()
  for (const p of proposals ?? []) {
    if (!isPlain(p) || typeof p.recordId !== 'string' || !isPlain(p.proposed)) throw new TypeError(`${UPDATE_CARD_SPEC}: предложение без recordId или полей`)
    if (seen.has(p.recordId)) throw new TypeError(`${UPDATE_CARD_SPEC}: два предложения для одной записи ${p.recordId}`)
    seen.add(p.recordId)
    const o = observed.get(p.recordId)
    if (!o) throw new TypeError(`${UPDATE_CARD_SPEC}: предложение для ${p.recordId} без наблюдения — прежнего значения нет, строка не собирается`)
    const fields = isPlain(o.fields) ? o.fields : {}
    const proposed = {}
    const expectedOld = {}
    for (const key of Object.keys(p.proposed)) {
      if (UPDATE_PROTECTED_FIELDS.includes(key)) throw new TypeError(`${UPDATE_CARD_SPEC}: предложение для ${p.recordId} трогает защищённое поле ${JSON.stringify(key)}`)
      const before = Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : null
      if (fieldEquals(p.proposed[key], before)) continue
      proposed[key] = p.proposed[key]
      expectedOld[key] = before === undefined ? null : before
    }
    if (!Object.keys(proposed).length) { skipped.push({ recordId: p.recordId, reason: 'noChange' }); continue }
    rows.push({ recordId: p.recordId, poiId: o.poiId ?? null, sourceKey: o.sourceKey ?? null, expectedOld, proposed })
  }
  rows.sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0))
  if (!rows.length) return { card: null, skipped }
  const card = parseUpdateCard({ spec: UPDATE_CARD_SPEC, scopeId, portal, createdAt, recoveredFrom, rows, note })
  return { card, skipped }
}

/**
 * Карточка восстановления после прерванной серии (change-policy § 21): ровно
 * оставшиеся строки — те, что не получили `verified` и не стали `noChange`, —
 * собранные ЗАНОВО по свежим наблюдениям: прежние значения в карточке
 * восстановления — те, что в базе сейчас, а не те, что были при исходной
 * карточке. Применённый префикс не входит; отпечаток исходной карточки — в
 * `recoveredFrom`. Строка, чьё свежее значение уже равно предложенному,
 * выпадает как `noChange`. Возвращает `{ card: null, skipped }`, когда
 * восстанавливать нечего.
 *
 * @param input.applied       recordId со строками `verified`
 * @param input.noChange      recordId со строками `noChange`
 * @param input.observations  СВЕЖИЕ наблюдения оставшихся записей
 */
export function recoveryCardFrom(card, { applied = [], noChange = [], observations, createdAt, note }) {
  const done = new Set([...applied, ...noChange])
  const remaining = card.rows.filter((row) => !done.has(row.recordId))
  if (!remaining.length) return { card: null, skipped: [] }
  if (!Array.isArray(observations)) throw new TypeError(`${UPDATE_CARD_SPEC}: карточка восстановления собирается только по свежим наблюдениям оставшихся записей`)
  return buildUpdateCard({
    scopeId: card.scopeId,
    portal: card.portal,
    createdAt,
    note,
    recoveredFrom: updateCardDigest(card),
    observations,
    proposals: remaining.map((row) => ({ recordId: row.recordId, proposed: { ...row.proposed } })),
  })
}
