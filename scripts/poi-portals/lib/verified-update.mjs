/**
 * ГРАНИЦА ПРОВЕРЯЕМОГО ОБНОВЛЕНИЯ СУЩЕСТВУЮЩИХ ЗАПИСЕЙ (10h-B, DAG 2.8).
 *
 * Доказывается ровно одно: ЧТО СТАЛО С ЗАПИСЬЮ после PATCH — и
 * устанавливается это независимым чтением по `recordId`, а не кодом ответа,
 * не телом ответа и не кэшем writer'а (change-policy § 21). Сверх границы
 * создания (10f-R) здесь есть то, чего у POST нет: ПРЕЖНЕЕ ЗНАЧЕНИЕ.
 * Обновление ложится поверх чужого выбора, поэтому:
 *   • перед КАЖДОЙ строкой — свежее чтение записи; если она изменилась с
 *     момента карточки (`expectedOld` ≠ прочитанному) или разошлось тождество
 *     (`POI ID`, `Source Key`), строка откладывается БЕЗ эффекта (`deferred`) —
 *     чужая правка не затирается, решает человек (I‑4.4);
 *   • если свежее значение уже равно предложенному — `noChange`, эффекта нет;
 *   • намерение `observe` (прежние значения) и `update` (точная нагрузка) — в
 *     журнал с `fsync` ДО PATCH; отказ намерения отменяет эффект;
 *   • исход — только чтением по id после PATCH: каждое предложенное поле равно
 *     предложенному → `verified`; все прежние → `notApplied`; иначе —
 *     `mismatch`; чтение отказало или отдало не ту запись → `unknown`;
 *   • бюджет PATCH (`maxUpdates`) считается здесь; исчерпание — остановка ДО
 *     PATCH.
 * Серия (`runUpdateSeries`) останавливается на первом неподтверждённом исходе
 * (`notApplied`, `mismatch`, `unknown`) и на исчерпании бюджета (I‑4.6):
 * доказанный префикс остаётся, хвост не пишется, повтора и отката нет.
 * Оставшиеся строки собираются в карточку восстановления по свежим чтениям
 * (`update-card.mjs`), а не продолжаются по исходной.
 *
 * Обёртка ставится вокруг ХРАНИЛИЩА и только на живой путь: dry-run и снимок
 * за неё не ставятся — журнала успеха без эффекта не бывает.
 */
import { describeThrownSafely } from '../../../src/lib/thrown-value.ts'
import { fieldEquals } from './verified-write.mjs'
import { UPDATE_IDENTITY_FIELDS, UPDATE_PROTECTED_FIELDS, UPDATE_RECOVERY_STATES, UPDATE_SUCCESS_STATES } from './update-journal.mjs'

export const VERIFIED_UPDATE_SPEC = 'poi-verified-update/v1'
export const UPDATE_VERIFICATION_KINDS = Object.freeze(['liveRead'])
/** Исходы, на которых серия останавливается: эффект мог состояться, а доказательства нет, либо он не состоялся при объявленном PATCH. */
export const UPDATE_STOP_STATES = Object.freeze(['notApplied', 'mismatch', 'unknown'])

export class VerifiedUpdateError extends Error {
  constructor({ state, recordId, reason, poiId = null, sourceKey = null, stop = true }) {
    super(`${VERIFIED_UPDATE_SPEC}: ${recordId}: ${state} — ${reason}`)
    this.name = 'VerifiedUpdateError'
    this.state = state
    this.recordId = recordId
    this.reason = reason
    this.poiId = poiId
    this.sourceKey = sourceKey
    this.recoveryRequired = UPDATE_RECOVERY_STATES.includes(state)
    /* Остановка серии: и неподтверждённый исход, и исчерпанный бюджет. */
    this.stop = stop
  }
}

/** Как проверять исход у ЭТОГО хранилища: только независимое чтение по id. */
export function updateVerificationFor(store) {
  if (typeof store?.readFreshByRecordId !== 'function') {
    throw new TypeError(`${VERIFIED_UPDATE_SPEC}: хранилище не умеет независимо перечитать запись по id (readFreshByRecordId); устанавливать исход ответом PATCH или кэшем запрещено`)
  }
  if (typeof store?.update !== 'function') {
    throw new TypeError(`${VERIFIED_UPDATE_SPEC}: хранилище не умеет обновлять запись (update)`)
  }
  return { kind: 'liveRead', read: (recordId, fieldNames) => store.readFreshByRecordId(recordId, fieldNames) }
}

const isPlain = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const identityOf = (row) => (typeof row?.recordId === 'string' && row.recordId.trim() ? row.recordId : null)
const fieldOf = (row, key) => {
  const value = row?.fields?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}
const absent = (value) => value === undefined || value === null || value === ''
const show = (value) => (absent(value) ? '(пусто)' : JSON.stringify(value).slice(0, 60))

/**
 * Классификация исхода ПОСЛЕ объявленного PATCH по результату независимого
 * чтения. Чистая функция: ни сети, ни журнала.
 *
 * @param recordId  тождество записи, по которому шёл PATCH
 * @param expected  `{ proposed, observed }` — нагрузка PATCH и прежние значения тех же полей
 * @param found     что вернуло чтение по id: запись или null
 * @param readError описание отказа чтения или null
 */
export function classifyUpdateOutcome({ recordId, expected, found, readError }) {
  if (readError !== null && readError !== undefined) {
    return { state: 'unknown', reason: `независимое чтение отказало: ${readError}` }
  }
  if (!isPlain(expected) || !isPlain(expected.proposed) || !Object.keys(expected.proposed).length) {
    return { state: 'unknown', reason: 'нагрузка PATCH не передана — сверять содержание нечем' }
  }
  if (found === null || found === undefined) {
    return { state: 'mismatch', reason: `запись ${recordId} не найдена после PATCH — её нет в базе`, differing: Object.keys(expected.proposed) }
  }
  const id = identityOf(found)
  if (!id) return { state: 'unknown', reason: 'независимое чтение отдало запись без id — тождество не установлено' }
  if (id !== recordId) return { state: 'unknown', reason: `чтение по id ${recordId} отдало запись ${id} — результат не доказывает исход` }
  if (!isPlain(found.fields)) return { state: 'unknown', reason: 'независимое чтение не отдало полей записи — сверить содержание нечем', recordId: id }
  const poiId = fieldOf(found, 'POI ID')
  const sourceKey = fieldOf(found, 'Source Key')
  const keys = Object.keys(expected.proposed)
  const differing = keys.filter((key) => !fieldEquals(expected.proposed[key], found.fields[key]))
  if (!differing.length) {
    return { state: 'verified', reason: 'независимое чтение по id: каждое предложенное поле равно предложенному', recordId: id, poiId, sourceKey }
  }
  const observed = isPlain(expected.observed) ? expected.observed : {}
  const allOld = keys.every((key) => fieldEquals(observed[key], found.fields[key]))
  if (allOld) {
    return { state: 'notApplied', reason: `независимое чтение показало прежние значения всех полей (${keys.join(', ')}) — эффект не состоялся`, recordId: id, poiId, sourceKey, differing }
  }
  const described = differing.map((key) => `${key}: ожидалось ${show(expected.proposed[key])}, в базе ${show(found.fields[key])}`).join('; ')
  return { state: 'mismatch', reason: `содержание записи ${id} — ни ожидаемый итог, ни прежнее состояние: ${described}`, recordId: id, poiId, sourceKey, differing }
}

/**
 * Свежее наблюдение против строки карточки: что расходится ДО эффекта.
 *
 * Возвращает ФАКТИЧЕСКИ ПРОЧИТАННОЕ (`observed`) всегда, когда у записи есть
 * поля, — в том числе при разошедшемся тождестве (10h-B R1, находка 04):
 * журнал обязан хранить то, что прочитано, а не то, что ждала карточка.
 * Когда наблюдения нет вовсе (записи нет, чтение отдало не ту запись или
 * без полей), это `noObservation`: строка откладывается, но выдуманных
 * «свежих» значений не бывает.
 */
export function compareObservation(row, found) {
  if (found === null || found === undefined) return { deferred: true, noObservation: true, reason: `запись ${row.recordId} не найдена — обновлять нечего` }
  const id = identityOf(found)
  if (id !== row.recordId) return { deferred: true, noObservation: true, reason: `чтение по id ${row.recordId} отдало ${JSON.stringify(id)} — тождество не установлено, эффект не начат` }
  if (!isPlain(found.fields)) return { deferred: true, noObservation: true, reason: 'чтение не отдало полей записи — прежнее значение не установлено, эффект не начат' }
  const poiId = fieldOf(found, 'POI ID')
  const sourceKey = fieldOf(found, 'Source Key')
  const keys = Object.keys(row.proposed)
  const observed = Object.fromEntries(keys.map((key) => [key, found.fields[key] === undefined ? null : found.fields[key]]))
  if (row.poiId !== null && row.poiId !== undefined && row.poiId !== poiId) {
    return { deferred: true, reason: `тождество разошлось: карточка ждала POI ID ${row.poiId}, в базе ${poiId ?? '(пусто)'}`, poiId, sourceKey, observed }
  }
  if (row.sourceKey !== null && row.sourceKey !== undefined && row.sourceKey !== sourceKey) {
    return { deferred: true, reason: `тождество разошлось: карточка ждала Source Key ${row.sourceKey}, в базе ${sourceKey ?? '(пусто)'}`, poiId, sourceKey, observed }
  }
  const drifted = keys.filter((key) => !fieldEquals(row.expectedOld[key], observed[key]) && !fieldEquals(row.proposed[key], observed[key]))
  if (drifted.length) {
    const described = drifted.map((key) => `${key}: карточка ждала ${show(row.expectedOld[key])}, в базе ${show(observed[key])}`).join('; ')
    return { deferred: true, reason: `запись изменилась с момента карточки — ${described}; чужая правка не затирается`, poiId, sourceKey, observed, differing: drifted }
  }
  /* Что действительно меняется: поля, где база ещё несёт прежнее значение. */
  const changes = Object.fromEntries(keys.filter((key) => !fieldEquals(row.proposed[key], observed[key])).map((key) => [key, row.proposed[key]]))
  return { deferred: false, poiId, sourceKey, observed, changes }
}

/**
 * Оборачивает `update` хранилища проверяемым обновлением по строке карточки.
 * Возвращает НОВЫЙ объект; исходное хранилище не мутируется.
 *
 * `wrapped.update(row)` — `row` из карточки обновления (`update-card.mjs`).
 * Возвращает исход (`{ state, recordId, ... }`) для `verified`, `noChange`,
 * `deferred`; бросает `VerifiedUpdateError` для `notApplied`, `mismatch`,
 * `unknown` и при исчерпании бюджета (`stop: true`).
 */
export function withVerifiedUpdates(store, { journal, maxUpdates = 0, onOutcome = () => {} } = {}) {
  if (!journal || typeof journal.intent !== 'function' || typeof journal.outcome !== 'function') {
    throw new TypeError(`${VERIFIED_UPDATE_SPEC}: живое обновление без журнала не начинается — доказательству намерения негде лечь`)
  }
  if (!Number.isInteger(maxUpdates) || maxUpdates < 0) {
    throw new TypeError(`${VERIFIED_UPDATE_SPEC}: бюджет PATCH обязан быть целым не меньше нуля, получено ${JSON.stringify(maxUpdates)}`)
  }
  const verification = updateVerificationFor(store)
  let updatesUsed = 0
  /* ОТКАЗ УВЕДОМЛЕНИЯ — НЕ ИСХОД ЗАПИСИ (10h-B R1, находка 03). Наблюдатель
     отчёта может бросить; доказанный исход уже лежит в журнале и не меняется.
     Отказ записывается отдельно и виден потребителю (`notificationFailures`). */
  const notificationFailures = []
  /* ДОЖИДАЕТСЯ И СИНХРОННОГО, И АСИНХРОННОГО ОТКАЗА (10h-B R2, находка R2‑01):
     `await` внутри `try` превращает отклонённый Promise обработчика в
     перехваченный отказ; без него он оставался необработанным и обрывал
     процесс. Все вызовы `notify` дожидаются. */
  const notify = async (outcome) => {
    try {
      await onOutcome(outcome)
    } catch (thrown) {
      notificationFailures.push({ recordId: outcome.recordId, state: outcome.state, reason: describeThrownSafely(thrown) })
    }
  }

  const wrapped = Object.create(Object.getPrototypeOf(store))
  for (const key of Reflect.ownKeys(store)) Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(store, key))
  Object.defineProperty(wrapped, 'notificationFailures', { value: notificationFailures, enumerable: false })

  wrapped.update = async (row) => {
    if (!isPlain(row) || typeof row.recordId !== 'string' || !isPlain(row.proposed) || !isPlain(row.expectedOld)) {
      throw new TypeError(`${VERIFIED_UPDATE_SPEC}: update ждёт строку карточки обновления (recordId, expectedOld, proposed)`)
    }
    const { recordId } = row
    const keys = Object.keys(row.proposed)
    if (!keys.length) throw new TypeError(`${VERIFIED_UPDATE_SPEC}: строка ${recordId} без предлагаемых полей`)
    const touched = keys.filter((key) => UPDATE_PROTECTED_FIELDS.includes(key))
    if (touched.length) throw new TypeError(`${VERIFIED_UPDATE_SPEC}: строка ${recordId} трогает защищённые поля (${touched.join(', ')})`)

    const record = (state, reason, extra = {}) => ({
      recordId, state, reason, verification: verification.kind,
      poiId: extra.poiId ?? null, sourceKey: extra.sourceKey ?? null,
      ...(extra.differing ? { differing: extra.differing } : {}),
    })
    /* Отказ журнала ДО эффекта — это остановка серии без эффекта (`deferred`,
       `stop`), а не «неизвестно»: PATCH ещё не отправлялся. Запечатанный
       журнал не примет и следующих строк, поэтому серия останавливается. */
    const stopBeforeEffect = (reason, extra = {}) => new VerifiedUpdateError({
      state: 'deferred', recordId, reason, poiId: extra.poiId ?? null, sourceKey: extra.sourceKey ?? null, stop: true,
    })
    const recordNoEffect = async (outcome, { stop = false } = {}) => {
      try {
        await journal.outcome(outcome)
      } catch (thrown) {
        await notify({ ...outcome, reason: `${outcome.reason}; исход без эффекта не записан в журнал: ${describeThrownSafely(thrown)}` })
        throw stopBeforeEffect(`${outcome.reason}; исход без эффекта не записан в журнал: ${describeThrownSafely(thrown)} — серия остановлена до эффекта`, outcome)
      }
      await notify(outcome)
      if (stop) throw stopBeforeEffect(outcome.reason, outcome)
      return outcome
    }

    /* 1. СВЕЖЕЕ ЧТЕНИЕ ПЕРЕД СТРОКОЙ — до любого намерения и любого эффекта.
          Отказ чтения — строка откладывается БЕЗ следа в журнале: наблюдения
          нет, записывать нечего; отчёт серии её называет. Эффект не начат. */
    let found = null
    try {
      found = await verification.read(recordId, [...keys, ...UPDATE_IDENTITY_FIELDS])
    } catch (thrown) {
      const outcome = record('deferred', `чтение перед строкой отказало: ${describeThrownSafely(thrown)}; эффект не начат, в журнал строка не вошла`, { poiId: row.poiId ?? null, sourceKey: row.sourceKey ?? null })
      await notify(outcome)
      return outcome
    }
    const compared = compareObservation(row, found)
    if (compared.noObservation) {
      /* Наблюдения нет — записывать нечего: в журнал строка не входит,
         выдуманных «свежих» значений не бывает (находка 04). Эффект не начат. */
      const outcome = record('deferred', `${compared.reason}; в журнал строка не вошла — наблюдения нет`, { poiId: row.poiId ?? null, sourceKey: row.sourceKey ?? null })
      await notify(outcome)
      return outcome
    }
    /* 2. НАБЛЮДЕНИЕ — в журнал: прежние значения, КАК ОНИ ПРОЧИТАНЫ СЕЙЧАС,
          и при разошедшемся тождестве тоже. */
    const observedFields = compared.observed
    try {
      await journal.intent({ recordId, verification: verification.kind, step: 'observe', fields: observedFields, sourceKey: compared.sourceKey ?? null, poiId: compared.poiId ?? null })
    } catch (thrown) {
      throw stopBeforeEffect(`наблюдение не записано в журнал: ${describeThrownSafely(thrown)} — эффект не начат, серия остановлена`, compared)
    }
    if (compared.deferred) return recordNoEffect(record('deferred', compared.reason, compared))
    if (!Object.keys(compared.changes).length) {
      return recordNoEffect(record('noChange', 'свежее чтение уже совпадает с предложенным — эффект не требуется', compared))
    }
    /* 3. БЮДЖЕТ — до PATCH. Исчерпание — остановка серии без эффекта. */
    if (updatesUsed >= maxUpdates) {
      return recordNoEffect(record('deferred', `бюджет PATCH исчерпан (${maxUpdates}): строка не применяется, серия останавливается до эффекта`, compared), { stop: true })
    }
    updatesUsed += 1

    /* 4. НАМЕРЕНИЕ `update` — из объявления хранилища с ТОЧНОЙ нагрузкой, ДО PATCH.
          Хранилище ДОЖИДАЕТСЯ этого вызова: брошенное здесь отменяет PATCH. */
    let expected = null
    let refusedBeforeEffect = null
    const onEffect = async (effect) => {
      if (effect?.step !== 'update' || effect.recordId !== recordId) {
        refusedBeforeEffect = `хранилище объявило неожиданный эффект ${JSON.stringify(effect?.step)} для ${JSON.stringify(effect?.recordId)}`
        throw new Error(refusedBeforeEffect)
      }
      const payload = { ...effect.payload }
      const foreign = Object.keys(payload).filter((key) => !Object.prototype.hasOwnProperty.call(compared.changes, key) || !fieldEquals(payload[key], compared.changes[key]))
      if (foreign.length || Object.keys(payload).length !== Object.keys(compared.changes).length) {
        refusedBeforeEffect = `нагрузка PATCH хранилища расходится с предложенным (${foreign.join(', ') || 'состав полей'})`
        throw new Error(refusedBeforeEffect)
      }
      try {
        await journal.intent({ recordId, verification: verification.kind, step: 'update', fields: payload, sourceKey: compared.sourceKey ?? null, poiId: compared.poiId ?? null })
      } catch (thrown) {
        refusedBeforeEffect = `намерение update не записано в журнал: ${describeThrownSafely(thrown)}`
        throw new Error(refusedBeforeEffect)
      }
      expected = payload
    }

    /* 5. ЭФФЕКТ. Брошенное значение описывается безопасно. */
    let claimed = null
    let effectError = null
    try {
      claimed = await store.update(recordId, compared.changes, { onEffect })
    } catch (thrown) {
      effectError = describeThrownSafely(thrown)
    }
    if (!expected) {
      /* Нагрузка не объявлена — намерение пишется ДО PATCH, значит, PATCH не
         отправлялся. Исход без эффекта; серия останавливается: хранилище или
         журнал отказали, следующая строка упрётся в то же. */
      const reason = refusedBeforeEffect
        ? `${refusedBeforeEffect} — эффект не начат`
        : `хранилище не объявило нагрузку PATCH${effectError ? ` (${effectError})` : ''} — эффекта не было`
      return recordNoEffect(record('deferred', reason, compared), { stop: true })
    }

    /* 6. НЕЗАВИСИМОЕ ЧТЕНИЕ ПО ID — единственный источник исхода. */
    let after = null
    let afterError = null
    try {
      after = await verification.read(recordId, [...keys, ...UPDATE_IDENTITY_FIELDS])
    } catch (thrown) {
      afterError = describeThrownSafely(thrown)
    }
    const classified = classifyUpdateOutcome({ recordId, expected: { proposed: expected, observed: observedFields }, found: after, readError: afterError })
    const claimedNote = claimed ? `; writer заявил ${claimed.recordId ?? '(без id)'}` : ''
    const outcome = record(classified.state, `${classified.reason}${classified.state === 'verified' ? '' : claimedNote}${effectError ? `; writer сообщил об ошибке: ${effectError}` : ''}`, classified)
    /* 7. ИСХОД — в журнал. Отказ записи исхода ПОСЛЕ возможного эффекта — recoveryRequired. */
    try {
      await journal.outcome(outcome)
    } catch (thrown) {
      const reason = `исход не записан в журнал после возможного эффекта: ${describeThrownSafely(thrown)}`
      await notify({ ...outcome, state: 'unknown', reason })
      throw new VerifiedUpdateError({ state: 'unknown', recordId, reason, poiId: outcome.poiId, sourceKey: outcome.sourceKey })
    }
    await notify(outcome)
    if (!UPDATE_SUCCESS_STATES.includes(outcome.state)) {
      throw new VerifiedUpdateError({ state: outcome.state, recordId, reason: outcome.reason, poiId: outcome.poiId, sourceKey: outcome.sourceKey })
    }
    return outcome
  }
  return wrapped
}

/**
 * Серия по карточке: строки в порядке карточки, остановка на первом
 * неподтверждённом исходе или исчерпании бюджета. Ничего не повторяет и не
 * откатывает. Возвращает поимённый доказанный префикс и оставшиеся строки —
 * материал для карточки восстановления.
 */
export async function runUpdateSeries(wrapped, card, { onRow = () => {} } = {}) {
  const outcomes = []
  /* Отказ обработчика отчёта — отдельно от исхода строки (находка 03):
     исход установлен журналом и чтением, уведомление его не меняет. */
  const reportFailures = []
  /* Дожидается и отклонённого Promise обработчика (R2‑01). */
  const report = async (outcome) => {
    try {
      await onRow(outcome)
    } catch (thrown) {
      reportFailures.push({ recordId: outcome.recordId, state: outcome.state, reason: describeThrownSafely(thrown) })
    }
  }
  let stoppedAt = null
  for (const row of card.rows) {
    let outcome = null
    try {
      outcome = await wrapped.update(row)
    } catch (thrown) {
      if (thrown instanceof VerifiedUpdateError) {
        outcome = { recordId: thrown.recordId, state: thrown.state, reason: thrown.reason, poiId: thrown.poiId, sourceKey: thrown.sourceKey, verification: 'liveRead' }
        stoppedAt = { recordId: thrown.recordId, state: thrown.state, reason: thrown.reason, recoveryRequired: thrown.recoveryRequired }
      } else {
        stoppedAt = { recordId: row.recordId, state: 'unknown', reason: `граница обновления бросила неожиданное значение: ${describeThrownSafely(thrown)}`, recoveryRequired: true }
        outcome = { recordId: row.recordId, state: 'unknown', reason: stoppedAt.reason, poiId: null, sourceKey: null, verification: 'liveRead' }
      }
    }
    /* Ровно один исход на запись — независимо от судьбы уведомления. */
    outcomes.push(outcome)
    await report(outcome)
    if (stoppedAt) break
  }
  const seen = new Set(outcomes.map((o) => o.recordId))
  const byState = {}
  for (const o of outcomes) byState[o.state] = (byState[o.state] ?? 0) + 1
  return {
    spec: VERIFIED_UPDATE_SPEC,
    outcomes,
    byState,
    applied: outcomes.filter((o) => o.state === 'verified').map((o) => o.recordId),
    noChange: outcomes.filter((o) => o.state === 'noChange').map((o) => o.recordId),
    deferred: outcomes.filter((o) => o.state === 'deferred').map((o) => o.recordId),
    recoveryRequired: outcomes.filter((o) => UPDATE_RECOVERY_STATES.includes(o.state)).map((o) => o.recordId),
    stoppedAt,
    /* Не начатые строки: серия остановилась раньше них. */
    notStarted: card.rows.filter((row) => !seen.has(row.recordId)).map((row) => row.recordId),
    /* Отказы уведомлений — названы отдельно, на исходы не влияют. */
    reportFailures: [...reportFailures, ...(Array.isArray(wrapped?.notificationFailures) ? wrapped.notificationFailures : [])],
  }
}
