/**
 * ЖУРНАЛ ЭФФЕКТОВ ОБНОВЛЕНИЯ СУЩЕСТВУЮЩИХ ЗАПИСЕЙ — `poi-update-journal/v1`
 * (10h-B, DAG 2.8; решения владельца I‑3.1 и II‑4.1 от 06.09.2026).
 *
 * Журнал создания (`poi-write-journal/v1`, 10f-R) отвечает на два вопроса —
 * «что собирались сделать» и «что получилось» — для POST. Этот журнал отвечает
 * на те же два вопроса для PATCH существующей записи и добавляет третий,
 * которого у создания нет: «ЧТО БЫЛО ДО». Обновление меняет значение, которое
 * уже кто-то выбрал; без прежнего значения ни восстановить его, ни доказать,
 * что PATCH лёг поверх ожидаемого, а не поверх чужой правки, нельзя.
 *
 * Порядок на одну запись — обязателен и проверяется грамматикой:
 *   1. `observe`  — свежее чтение записи ПЕРЕД строкой: прежние значения
 *                   изменяемых полей целиком и их digest, тождество
 *                   (`recordId`, `POI ID`, `Source Key`) — до любого эффекта;
 *   2. `update`   — ТОЧНАЯ нагрузка PATCH, которую хранилище собирается
 *                   отправить (только действительно меняющиеся поля) — до
 *                   сетевого вызова, с `fsync`;
 *   3. эффект;
 *   4. `outcome`  — после независимого чтения по `recordId`, с `fsync`.
 * Строка без `update` — это доказанное ОТСУТСТВИЕ эффекта: намерение пишется
 * до PATCH, значит, PATCH не отправлялся. Поэтому `deferred` и `noChange`
 * возможны только без `update`, а `verified` и `notApplied` — только после.
 *
 * Ключ попытки — `recordId`: одна попытка на запись за журнал. Ключ источника
 * и номер записываются для человека и поздней сверки, но тождеством не служат:
 * PATCH адресует запись по id, и исход доказывается чтением по id.
 *
 * Механика дозаписи — общая с журналом создания (`openNdjsonJournal`):
 * эксклюзивное создание, дескриптор + `sync`, печать после отказа, оборванный
 * хвост, ноль байт после закрывающей строки. Здесь — только версия, роды строк
 * и грамматика.
 */
import {
  intentFieldsDigest,
  isCanonicalInstant,
  openNdjsonJournal,
  readNdjsonJournalDetailed,
  WRITE_JOURNAL_FILE,
} from './write-journal.mjs'

export const UPDATE_JOURNAL_SPEC = 'poi-update-journal/v1'
/** Каталог журналов обновлений — отдельный от журналов создания. */
export const UPDATE_JOURNAL_DIR = 'tmp/poi-update-journal'
export const UPDATE_JOURNAL_FILE = WRITE_JOURNAL_FILE

/** Роды строк — закрытый список. */
export const UPDATE_JOURNAL_KINDS = Object.freeze(['runStarted', 'intent', 'outcome', 'runFinished'])
/** Способ независимой проверки — закрытый список из одного значения. */
export const UPDATE_VERIFICATION_KINDS = Object.freeze(['liveRead'])
/**
 * Шаги намерения — закрытый список и обязательный порядок на одну запись:
 *   observe — прежние значения изменяемых полей по свежему чтению перед строкой;
 *   update  — точная нагрузка PATCH (ровно те поля, что уйдут в базу).
 */
export const UPDATE_INTENT_STEPS = Object.freeze(['observe', 'update'])
/** Закрытые схемы строк: ровно эти ключи. */
export const UPDATE_LINE_KEYS = Object.freeze({
  runStarted: Object.freeze(['spec', 'seq', 'at', 'runId', 'kind', 'meta']),
  intent: Object.freeze(['spec', 'seq', 'at', 'runId', 'kind', 'recordId', 'verification', 'step', 'fields', 'fieldsDigest', 'sourceKey', 'poiId']),
  outcome: Object.freeze(['spec', 'seq', 'at', 'runId', 'kind', 'recordId', 'verification', 'state', 'reason', 'sourceKey', 'poiId', 'differing']),
  runFinished: Object.freeze(['spec', 'seq', 'at', 'runId', 'kind', 'attempts', 'applied', 'failed']),
})

/**
 * Состояния исхода одной попытки обновления — ЗАКРЫТЫЙ СПИСОК. Успех — два
 * состояния, и оба доказаны: `verified` — чтением после эффекта, `noChange` —
 * тем, что эффекта не требовалось (свежие значения уже равны предложенным).
 */
export const UPDATE_STATES = Object.freeze([
  'verified',    // PATCH отправлен; независимое чтение по id: каждое предложенное поле равно предложенному
  'noChange',    // эффекта не было: свежее чтение уже совпадает с предложенным
  'deferred',    // эффекта не было: запись изменилась с момента карточки, тождество разошлось или чтение перед строкой отказало
  'notApplied',  // PATCH объявлен; независимое чтение показало прежние значения всех полей — эффекта не состоялось
  'mismatch',    // PATCH объявлен; в базе ни ожидаемый итог, ни прежнее состояние (часть полей, чужие значения, запись исчезла)
  'unknown',     // проверить нечем: чтение после эффекта отказало или отдало не ту запись
])
/** Состояния, требующие ручного разбора по журналу. */
export const UPDATE_RECOVERY_STATES = Object.freeze(['mismatch', 'unknown'])
/** Состояния без эффекта — строка ждёт карточки восстановления, разбора не требует. */
export const UPDATE_NO_EFFECT_STATES = Object.freeze(['deferred', 'noChange'])
/** Успешные исходы. */
export const UPDATE_SUCCESS_STATES = Object.freeze(['verified', 'noChange'])
/** Состояния, допустимые БЕЗ объявленного эффекта и ТОЛЬКО с ним. */
const STATES_WITHOUT_EFFECT = Object.freeze(['deferred', 'noChange', 'unknown'])
const STATES_AFTER_EFFECT = Object.freeze(['verified', 'notApplied', 'mismatch', 'unknown'])

/** Поля тождества: обновлять их этим путём нельзя — по ним исход и доказывается. */
export const UPDATE_IDENTITY_FIELDS = Object.freeze(['POI ID', 'Source Key'])
/**
 * ЗАЩИЩЁННЫЕ ПОЛЯ — закрытый список того, что этот путь не обновляет никогда:
 * тождество (по нему доказывается исход) и координатный контур (P07: поля
 * координат и политики пишут только `ingestPoi` при создании и контракт
 * `src/lib/poi-coordinate-refresh.ts`; решения владельца о точке живут в
 * реестре под git). Проверяется в карточке, в разрешении, в грамматике журнала,
 * на границе и в самом хранилище — до любого сетевого вызова.
 */
export const UPDATE_PROTECTED_FIELDS = Object.freeze([
  ...UPDATE_IDENTITY_FIELDS,
  'Latitude', 'Longitude', 'Coords Checked At', 'Coordinate Policy', 'Google Place ID',
])
/** Идентификатор записи Airtable — он попадает в путь запроса, форма закрыта. */
export const RECORD_ID_SHAPE = /^rec[A-Za-z0-9]{14}$/

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0
const isNullableString = (value) => value === null || isNonEmptyString(value)
const exactKeys = (entry, keys) => {
  const own = Object.keys(entry).sort()
  const want = [...keys].sort()
  return own.length === want.length && own.every((k, i) => k === want[i])
}

/**
 * ГРАММАТИКА — одна у писателя (до записи) и у читателя. Семантика:
 *   • запись открывается `observe` РОВНО ОДИН РАЗ за журнал;
 *   • `update` — только после `observe` и только один раз; нагрузка не пуста и
 *     не трогает защищённые поля (тождество, координатный контур);
 *   • `outcome` — после `observe`; `verified`/`notApplied`/`mismatch` — только
 *     после `update`; `deferred`/`noChange` — только БЕЗ `update`;
 *   • `runFinished.attempts` = число `observe`, `applied` = число `verified`,
 *     `failed` — есть попытка без успешного исхода.
 */
export function updateJournalGrammar(file = '(журнал)') {
  const where = `${UPDATE_JOURNAL_SPEC}: ${file}`
  let count = 0
  let runId = null
  let finished = false
  /* recordId → { step, verification, state } — state null, пока исхода нет. */
  const attempts = new Map()
  const closing = () => ({
    attempts: attempts.size,
    applied: [...attempts.values()].filter((a) => a.state === 'verified').length,
    failed: [...attempts.values()].some((a) => !UPDATE_SUCCESS_STATES.includes(a.state)),
  })
  return {
    accept(entry, { last = false, apply = true } = {}) {
      const i = count
      const refuse = (why) => { throw new Error(`${where}, строка ${i + 1}: ${why}`) }
      const mutations = []
      if (finished) refuse('runFinished допустим только последней строкой')
      if (!isPlainObject(entry) || entry.spec !== UPDATE_JOURNAL_SPEC) refuse('не принадлежит журналу этой версии')
      if (!UPDATE_JOURNAL_KINDS.includes(entry.kind)) refuse(`неизвестный род ${JSON.stringify(entry.kind)}`)
      if (!exactKeys(entry, UPDATE_LINE_KEYS[entry.kind])) {
        refuse(`строка рода ${entry.kind} не соответствует закрытой схеме: ожидались ровно ключи ${UPDATE_LINE_KEYS[entry.kind].join(', ')}`)
      }
      if (entry.seq !== i + 1) refuse(`seq ${JSON.stringify(entry.seq)} нарушает сплошную нумерацию (ожидалось ${i + 1})`)
      const expectedRunId = i === 0 ? entry.runId : runId
      if (i === 0) mutations.push(() => { runId = entry.runId })
      if (!isNonEmptyString(entry.runId) || entry.runId !== expectedRunId) refuse('runId отсутствует или отличается от первой строки')
      if (!isCanonicalInstant(entry.at)) refuse(`at ${JSON.stringify(entry.at)} — не календарно строгий канонический момент`)
      if (i === 0 && entry.kind !== 'runStarted') refuse('журнал обязан начинаться с runStarted')
      if (i > 0 && entry.kind === 'runStarted') refuse('runStarted допустим только первой строкой')
      if (entry.kind === 'runStarted' && !isPlainObject(entry.meta)) refuse('runStarted.meta обязан быть объектом')
      if (entry.kind === 'runFinished') {
        if (!last) refuse('runFinished допустим только последней строкой')
        if (!Number.isInteger(entry.attempts) || entry.attempts < 0 || !Number.isInteger(entry.applied) || entry.applied < 0 || typeof entry.failed !== 'boolean') {
          refuse('runFinished: attempts и applied — целые ≥ 0, failed — булево')
        }
        const expected = closing()
        if (entry.attempts !== expected.attempts) refuse(`runFinished.attempts ${entry.attempts} противоречит журналу: наблюдений observe — ${expected.attempts}`)
        if (entry.applied !== expected.applied) refuse(`runFinished.applied ${entry.applied} противоречит журналу: исходов verified — ${expected.applied}`)
        if (entry.failed !== expected.failed) {
          refuse(`runFinished.failed ${entry.failed} противоречит журналу: ${expected.failed ? 'есть попытка без успешного исхода' : 'все попытки успешны'}`)
        }
        mutations.push(() => { finished = true })
      }
      if (entry.kind === 'intent' || entry.kind === 'outcome') {
        if (!isNonEmptyString(entry.recordId) || !RECORD_ID_SHAPE.test(entry.recordId)) refuse(`${entry.kind} без идентификатора записи допустимой формы`)
        if (!UPDATE_VERIFICATION_KINDS.includes(entry.verification)) refuse(`${entry.kind}.verification ${JSON.stringify(entry.verification)} вне закрытого списка (${UPDATE_VERIFICATION_KINDS.join(', ')})`)
        if (!isNullableString(entry.sourceKey) || !isNullableString(entry.poiId)) refuse(`${entry.kind}: sourceKey и poiId — непустая строка или null`)
      }
      if (entry.kind === 'intent') {
        if (!UPDATE_INTENT_STEPS.includes(entry.step)) refuse(`intent.step ${JSON.stringify(entry.step)} вне закрытого списка`)
        if (!isPlainObject(entry.fields) || !Object.keys(entry.fields).length) refuse('intent без полей')
        if (entry.fieldsDigest !== intentFieldsDigest(entry.fields)) refuse('fieldsDigest не совпадает с полями намерения')
        const known = attempts.get(entry.recordId)
        if (entry.step === 'observe') {
          if (known) {
            refuse(known.state === null
              ? `повторное наблюдение для ${entry.recordId} без исхода предыдущего`
              : `повторная попытка для ${entry.recordId}: запись уже завершена исходом ${known.state}, вторая попытка в том же журнале запрещена`)
          }
          mutations.push(() => attempts.set(entry.recordId, { step: 'observe', verification: entry.verification, state: null }))
        } else {
          if (!known || known.state !== null || known.step !== 'observe') refuse(`update для ${entry.recordId} без предшествующего observe (или повторный update)`)
          if (known.verification !== entry.verification) refuse('способ проверки отличается от observe')
          const touched = Object.keys(entry.fields).filter((key) => UPDATE_PROTECTED_FIELDS.includes(key))
          if (touched.length) refuse(`update трогает защищённые поля (${touched.join(', ')}) — этим путём они не обновляются`)
          mutations.push(() => { known.step = 'update' })
        }
      }
      if (entry.kind === 'outcome') {
        if (!UPDATE_STATES.includes(entry.state)) refuse(`outcome с состоянием вне закрытого списка: ${JSON.stringify(entry.state)}`)
        if (typeof entry.reason !== 'string') refuse('outcome.reason обязан быть строкой')
        if (!Array.isArray(entry.differing) || entry.differing.some((d) => !isNonEmptyString(d))) refuse('outcome.differing — список имён полей')
        const known = attempts.get(entry.recordId)
        if (!known || known.state !== null) refuse(`outcome для ${entry.recordId} без предшествующего observe`)
        if (known.verification !== entry.verification) refuse('способ проверки исхода отличается от намерения')
        if (known.step === 'observe' && !STATES_WITHOUT_EFFECT.includes(entry.state)) {
          refuse(`${entry.state} для ${entry.recordId} без объявленного эффекта (update): ${entry.state === 'verified' ? 'успех без эффекта — не успех' : 'исход эффекта, которого не было'}`)
        }
        if (known.step === 'update' && !STATES_AFTER_EFFECT.includes(entry.state)) {
          refuse(`${entry.state} для ${entry.recordId} после объявленного эффекта: эффект мог состояться, «без эффекта» утверждать нельзя`)
        }
        if (entry.state === 'verified' && !isNonEmptyString(entry.poiId)) refuse('verified обязан нести poiId из базы')
        mutations.push(() => { known.state = entry.state })
      }
      if (apply) {
        for (const mutate of mutations) mutate()
        count += 1
      }
    },
    closing,
  }
}

export function assertUpdateJournalGrammar(entries, file = '(журнал)') {
  if (!Array.isArray(entries) || !entries.length) throw new Error(`${UPDATE_JOURNAL_SPEC}: ${file}: журнал пуст`)
  const grammar = updateJournalGrammar(file)
  entries.forEach((entry, i) => grammar.accept(entry, { last: i === entries.length - 1 }))
  return entries
}

/**
 * Открывает журнал обновлений прогона. Каталог свой у каждого `runId`.
 * `meta` обязан назвать карточку обновления (`cardDigest`) — журнал без
 * карточки не привязан к тому, что владелец видел и разрешил.
 */
export async function openUpdateJournal({ dir = UPDATE_JOURNAL_DIR, runId, now = new Date(), meta = {}, io = null } = {}) {
  if (!isPlainObject(meta) || !isNonEmptyString(meta.cardDigest)) {
    throw new TypeError(`${UPDATE_JOURNAL_SPEC}: журнал обновлений открывается только с отпечатком карточки обновления (meta.cardDigest)`)
  }
  const core = await openNdjsonJournal({
    dir, runId, fileName: UPDATE_JOURNAL_FILE, spec: UPDATE_JOURNAL_SPEC, kinds: UPDATE_JOURNAL_KINDS, grammar: updateJournalGrammar, now, meta, io,
  })
  const { append } = core
  return {
    file: core.file,
    runDir: core.runDir,
    get entries() { return core.entries },
    get sealed() { return core.sealed },
    /** Намерение — ДО эффекта. `observe` несёт прежние значения, `update` — нагрузку PATCH. */
    async intent(payload) {
      if (!UPDATE_INTENT_STEPS.includes(payload?.step)) {
        throw new TypeError(`${UPDATE_JOURNAL_SPEC}.intent.step: ожидается один из ${UPDATE_INTENT_STEPS.join(', ')}, получено ${JSON.stringify(payload?.step)}`)
      }
      if (!UPDATE_VERIFICATION_KINDS.includes(payload?.verification)) {
        throw new TypeError(`${UPDATE_JOURNAL_SPEC}.intent.verification: ожидается один из ${UPDATE_VERIFICATION_KINDS.join(', ')}`)
      }
      if (!isPlainObject(payload?.fields) || !Object.keys(payload.fields).length) {
        throw new TypeError(`${UPDATE_JOURNAL_SPEC}.intent: намерение обязано нести поля целиком`)
      }
      const fieldsDigest = intentFieldsDigest(payload.fields)
      if (payload.fieldsDigest !== undefined && payload.fieldsDigest !== fieldsDigest) {
        throw new TypeError(`${UPDATE_JOURNAL_SPEC}.intent: fieldsDigest не совпадает с полями`)
      }
      return append('intent', {
        recordId: payload.recordId,
        verification: payload.verification,
        step: payload.step,
        fields: payload.fields,
        fieldsDigest,
        sourceKey: payload.sourceKey ?? null,
        poiId: payload.poiId ?? null,
      })
    },
    /** Исход — ПОСЛЕ независимого чтения (или доказанного отсутствия эффекта). */
    async outcome(payload) {
      if (!UPDATE_STATES.includes(payload?.state)) {
        throw new TypeError(`${UPDATE_JOURNAL_SPEC}.outcome.state: ожидается один из ${UPDATE_STATES.join(', ')}, получено ${JSON.stringify(payload?.state)}`)
      }
      if (!UPDATE_VERIFICATION_KINDS.includes(payload?.verification)) {
        throw new TypeError(`${UPDATE_JOURNAL_SPEC}.outcome.verification: ожидается один из ${UPDATE_VERIFICATION_KINDS.join(', ')}`)
      }
      return append('outcome', {
        recordId: payload.recordId,
        verification: payload.verification,
        state: payload.state,
        reason: String(payload.reason ?? ''),
        sourceKey: payload.sourceKey ?? null,
        poiId: payload.poiId ?? null,
        differing: Array.isArray(payload.differing) ? payload.differing : [],
      })
    },
    async finish() { return core.finish() },
    get closing() { return core.closing },
  }
}

export async function readUpdateJournalDetailed(file) {
  return readNdjsonJournalDetailed(file, { spec: UPDATE_JOURNAL_SPEC, assertGrammar: assertUpdateJournalGrammar })
}

export async function readUpdateJournal(file) {
  return (await readUpdateJournalDetailed(file)).entries
}

/**
 * Сводит журнал к состоянию каждой попытки. Наблюдение без исхода —
 * `unknown`, если эффект объявлен (PATCH мог уйти), и `deferred`, если нет:
 * намерение `update` пишется ДО PATCH, значит, без него PATCH не отправлялся.
 */
export function summarizeUpdateJournal(entries) {
  const byRecord = new Map()
  const known = (id) => {
    if (!byRecord.has(id)) byRecord.set(id, { recordId: id, observe: null, update: null, outcome: null })
    return byRecord.get(id)
  }
  let meta = {}
  for (const entry of entries) {
    if (entry.kind === 'runStarted') meta = entry.meta
    if (entry.kind === 'intent') {
      const attempt = known(entry.recordId)
      if (entry.step === 'observe') {
        if (attempt.observe) throw new Error(`${UPDATE_JOURNAL_SPEC}: сводка отказана — повторная попытка для ${entry.recordId} в одном журнале`)
        attempt.observe = entry
      } else {
        if (attempt.update) throw new Error(`${UPDATE_JOURNAL_SPEC}: сводка отказана — второй update для ${entry.recordId}`)
        attempt.update = entry
      }
    } else if (entry.kind === 'outcome') {
      const attempt = known(entry.recordId)
      if (attempt.outcome) throw new Error(`${UPDATE_JOURNAL_SPEC}: сводка отказана — второй исход для ${entry.recordId}`)
      attempt.outcome = entry
    }
  }
  const attempts = [...byRecord.values()].map((attempt) => {
    const effectIntended = Boolean(attempt.update)
    const state = attempt.outcome?.state ?? (effectIntended ? 'unknown' : 'deferred')
    return {
      recordId: attempt.recordId,
      state,
      reason: attempt.outcome?.reason ?? (effectIntended ? 'нагрузка PATCH объявлена, исход не записан' : 'наблюдение записано, PATCH не объявлялся — эффекта не было'),
      sourceKey: attempt.outcome?.sourceKey ?? attempt.observe?.sourceKey ?? null,
      poiId: attempt.outcome?.poiId ?? attempt.observe?.poiId ?? null,
      verification: attempt.outcome?.verification ?? attempt.observe?.verification ?? null,
      effectIntended,
      observedFields: attempt.observe?.fields ?? null,
      expectedFields: attempt.update?.fields ?? null,
      expectedDigest: attempt.update?.fieldsDigest ?? null,
    }
  })
  const byState = {}
  for (const attempt of attempts) byState[attempt.state] = (byState[attempt.state] ?? 0) + 1
  return {
    meta,
    attempts,
    byState,
    applied: attempts.filter((a) => a.state === 'verified').map((a) => a.recordId),
    recoveryRequired: attempts.filter((a) => UPDATE_RECOVERY_STATES.includes(a.state)),
    /* Строки без эффекта — кандидаты в карточку восстановления. */
    pending: attempts.filter((a) => a.state === 'deferred').map((a) => a.recordId),
  }
}
