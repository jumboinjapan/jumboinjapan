/**
 * Контракт исполнения `poi-model-execution/v1` — форма без файловой системы.
 *
 * Здесь живут: детерминированный `executionId`, форма записи журнала и её
 * подпись, закрытая грамматика переходов и единственная функция итога.
 * Файлов, каталогов, сети и часов этот модуль не касается: момент времени
 * приходит параметром, иначе набор недетерминирован.
 *
 * Журнал — не лог. Лог описывает намерение автора, журнал описывает
 * состояние: по нему решается, был ли обращён к провайдеру платный запрос и
 * можно ли начинать заново. Поэтому каждая запись подписана, порядок закрыт,
 * а читатель fail-closed — неизвестное он объявляет повреждением, а не
 * пропускает.
 */
import {
  assertCanonicalInstant,
  assertExactKeys,
  assertExactly,
  assertCodeIdentity,
  assertDigestShape,
  assertInteger,
  assertNonEmptyString,
  assertSha256Value,
  assertStrictOwnKeys,
  assertStringList,
  canonicalJsonBytes,
  deepFreeze,
  digest,
  isPlainObject,
  safeAdd,
} from '../../lib/canonical-contract.mjs'
import { DIGEST_ALGORITHM, sha256Bytes, UNIT_SEPARATOR } from '../../lib/byte-digest.mjs'
import { parseAndVerifyApproval } from './model-approval.mjs'
import { MODEL_SELECTION_SPEC, requestItemId, selectionDigest } from './model-plan.mjs'
import { classifyModelResponse } from './classification-contract.mjs'

/** Домен исполнения. Входит первым полем в поток байтов `executionId`. */
export const MODEL_EXECUTION_SPEC = 'poi-model-execution/v1'
export const MODEL_CLASSIFICATION_RESULT_SPEC = `${MODEL_EXECUTION_SPEC}:classification-result`

/**
 * Домен ОТДЕЛЬНОЙ записи журнала.
 *
 * Отдельный от домена исполнения намеренно: подписывается запись, а не
 * исполнение целиком, и общий домен позволил бы подставить запись из другого
 * контекста, не тронув ни одного байта её содержимого.
 */
export const EXECUTION_RECORD_SPEC = 'poi-model-execution-record/v1'

/** Точный состав записи журнала. Единственный список в проекте. */
export const RECORD_KEYS = Object.freeze([
  'contractVersion', 'seq', 'at', 'executionId', 'type', 'payload', 'recordDigest',
])

/** Закрытый список типов записи. Неизвестный тип — повреждение, а не пропуск. */
export const RECORD_TYPES = Object.freeze(['opened', 'dispatching', 'settled', 'closed'])

/** Терминальные исходы элемента. `unknown` сюда не входит и записью не выражается. */
export const TERMINAL_OUTCOMES = Object.freeze([
  'accepted', 'rejected', 'truncated', 'failed', 'skipped', 'lost',
])

/** Восемь корзин счёта: шесть терминальных плюс два нетерминальных состояния. */
export const COUNT_BUCKETS = Object.freeze([...TERMINAL_OUTCOMES, 'notDispatched', 'unknown'])

/** Исходы закрытия. */
export const CLOSED_OUTCOMES = Object.freeze([
  'allAccepted', 'withFailures', 'withSkips', 'withLoss', 'abortedBeforeDispatch',
])

/** Состояния разрешения во времени. Потребление проверяется файловой системой. */
export const APPROVAL_TIME_STATES = Object.freeze(['notYetValid', 'active', 'expired'])

/** Срок хранения журнала. Ровно тридцать суток по 24 часа, без календаря. */
export const JOURNAL_RETENTION_DAYS = 30
const JOURNAL_RETENTION_MS = JOURNAL_RETENTION_DAYS * 24 * 60 * 60 * 1000

/**
 * Коды возврата. Каждый отвечает на отдельный вопрос владельца, поэтому
 * переиспользования нет: «прогон удался», «часть отказала», «часть
 * пропущена», «журнал не закрыт», «журнал повреждён», «деньги потрачены
 * впустую» — шесть разных ответов и шесть разных кодов.
 */
export const EXIT_CODES = Object.freeze({
  allAccepted: 0,
  /* Preflight: отказ проверки, отказ разрешения и уже потреблённое
     разрешение — три разных ответа владельцу, и различать их обязан код
     возврата, а не текст. Прежние коды исполнения не переиспользуются. */
  preflightFailed: 10,
  preflightApprovalRejected: 11,
  preflightAlreadyConsumed: 12,
  failures: 20,
  skips: 30,
  needsReconciliation: 40,
  journalCorrupt: 50,
  withLoss: 60,
})

const OPENED_PAYLOAD_KEYS = Object.freeze([
  'createdAt', 'deleteAfter', 'approvalId', 'approvalDigest', 'planId', 'planDigest',
  'planArtifactDigest', 'providerProfileDigest', 'selectionDigest', 'codeIdentity', 'items',
])
const OPENED_ITEM_KEYS = Object.freeze([
  'portalId', 'sourceKey', 'requestItemId', 'candidateInputDigest',
])
const DISPATCHING_PAYLOAD_KEYS = Object.freeze(['requestItemId', 'requestSpecDigest'])
const SETTLED_PAYLOAD_KEYS = Object.freeze([
  'requestItemId', 'requestSpecDigest', 'outcome', 'charged', 'result',
])
const CLOSED_PAYLOAD_KEYS = Object.freeze(['deleteAfter', 'outcome', 'counts'])
const CLASSIFICATION_RESULT_KEYS = Object.freeze(['ok', 'problems', 'proposal', 'classification'])

/** Форма голого 64-значного hex. Приватна: экспортированный RegExp — изменяемая
    глобальная политика, и `compile('.*')` отключил бы её у всех импортёров. */
const HEX_64 = /^[0-9a-f]{64}$/

/**
 * Форма идентификатора исполнения: ровно 64 строчных hex-знака без префикса.
 *
 * Выражение приватно: экспортированный `RegExp` — изменяемая глобальная
 * политика, один импортёр вызвал бы `compile('.*')` и отключил бы проверку у
 * всех остальных, а `Object.freeze` этого не закрывает.
 */
function assertHex64Id(value, where) {
  if (typeof value !== 'string' || !HEX_64.test(value)) {
    throw new TypeError(
      `${where}: ожидается ровно 64 строчных hex-знака без префикса, получено ${JSON.stringify(value)}`,
    )
  }
}

/** Одинаковая грамматика не делает executionId и requestItemId одним доменом. */
export function assertExecutionId(value, where) {
  assertHex64Id(value, where)
}

/** Отдельная публичная граница идентификатора элемента модельного запроса. */
export function assertRequestItemId(value, where) {
  assertHex64Id(value, where)
}

/**
 * Строгая форма полного сырого входа публичной функции — до проекции,
 * деструктуризации и чтения вложенных значений.
 *
 * Канонизация смотрит на объект целиком и на всей глубине; `assertExactKeys`
 * после неё закрывает состав. Обратный порядок оставил бы скрытое,
 * символьное и accessor-свойство невидимыми ровно там, где они опаснее
 * всего: во входе функции, выдающей подпись.
 */
export function assertStrictInput(input, keys, where) {
  if (!isPlainObject(input)) throw new TypeError(`${where}: ожидается простой объект`)
  canonicalJsonBytes(input, where)
  assertExactKeys(input, keys, where)
}

/**
 * То же для входов, которые НЕ сериализуемы: несут функции либо часть полей
 * имеет значение по умолчанию.
 *
 * Канонизация здесь неприменима — функцию она отвергнет, — поэтому строгость
 * даёт `assertStrictOwnKeys`: символьные, неперечисляемые и accessor-свойства
 * верхнего уровня отвергаются, а состав проверяется как множество
 * обязательных и допустимых имён. Слабее глубокой канонизации, и там, где
 * канонизация возможна, применяется она.
 */
export function assertStrictOptions(input, { required = [], optional = [] }, where) {
  if (!isPlainObject(input)) throw new TypeError(`${where}: ожидается простой объект`)
  assertStrictOwnKeys(input, where)
  const keys = Object.keys(input)
  const allowed = [...required, ...optional]
  const extra = keys.filter((key) => !allowed.includes(key))
  if (extra.length) throw new TypeError(`${where}: лишние поля ${extra.join(', ')}`)
  const missing = required.filter((key) => !keys.includes(key))
  if (missing.length) throw new TypeError(`${where}: нет обязательных полей ${missing.join(', ')}`)
}

const SEPARATOR_BYTE = Buffer.from([UNIT_SEPARATOR])

/**
 * Идентификатор исполнения.
 *
 * `SHA-256` от потока
 * `UTF8(домен) 0x1F UTF8(approvalDigest.value) 0x1F UTF8(planDigest.value)`.
 * Результат — ровно 64 строчных hex-знака, БЕЗ префикса.
 *
 * Детерминизм здесь — не удобство, а сама проверяемость одноразовости:
 * случайный идентификатор дал бы новый каталог на каждый запуск, и повторный
 * платный прогон по тому же разрешению стал бы неотличим от первого.
 * Поэтому ни UUID, ни счётчиков, ни суффиксов времени.
 *
 * Оба значения входят в поток С префиксом `sha256:`, как они и записаны в
 * артефактах: поток описывает то, что лежит в файле, а не то, что из него
 * вырезано.
 */
export const EXECUTION_ID_INPUT_KEYS = Object.freeze(['approvalDigest', 'planDigest'])

export function executionId(input) {
  assertStrictInput(input, EXECUTION_ID_INPUT_KEYS, `${MODEL_EXECUTION_SPEC}: параметры`)
  const { approvalDigest, planDigest } = input
  assertSha256Value(approvalDigest, `${MODEL_EXECUTION_SPEC}.approvalDigest`)
  assertSha256Value(planDigest, `${MODEL_EXECUTION_SPEC}.planDigest`)
  return sha256Bytes(Buffer.concat([
    Buffer.from(MODEL_EXECUTION_SPEC, 'utf8'),
    SEPARATOR_BYTE,
    Buffer.from(approvalDigest, 'utf8'),
    SEPARATOR_BYTE,
    Buffer.from(planDigest, 'utf8'),
  ])).slice('sha256:'.length)
}

/**
 * Состояние разрешения во времени.
 *
 * Потребление здесь не проверяется и проверено быть не может: оно живёт в
 * файловой системе. Приоритет потребления над сроком обеспечивает
 * `approvalState` в модуле журнала — единственное место, где обе половины
 * сходятся, и порядок там закреплён.
 */
export const APPROVAL_TIME_INPUT_KEYS = Object.freeze(['approval', 'at'])

export function approvalTimeState(input) {
  assertStrictInput(input, APPROVAL_TIME_INPUT_KEYS, `${MODEL_EXECUTION_SPEC}: параметры срока`)
  const { approval, at } = input
  const createdAtMs = assertCanonicalInstant(approval.createdAt, 'approval.createdAt')
  const validUntilMs = assertCanonicalInstant(approval.validUntil, 'approval.validUntil')
  const atMs = assertCanonicalInstant(at, 'at')
  if (atMs < createdAtMs) return 'notYetValid'
  if (atMs < validUntilMs) return 'active'
  return 'expired'
}

/**
 * Полезная нагрузка записи `opened`.
 *
 * Запись самодостаточна намеренно. План живёт семь суток, разрешение —
 * тридцать после истечения силы; журнал переживёт оба. После их удаления
 * `requestItemId` перестал бы что-либо значить, если бы рядом не лежал
 * `sourceKey`. Отсюда полное отображение каждого кандидата.
 *
 * `sourceKey` берётся ИЗ ПЛАНА, а не из выборки: в записи
 * `poi-model-selection/v1` его нет вовсе — там только `portalId`,
 * `requestItemId` и `candidateInputDigest`.
 */
export const OPENED_BUILD_KEYS = Object.freeze(['approval', 'plan', 'at'])

export function buildOpenedPayload(input) {
  assertStrictInput(input, OPENED_BUILD_KEYS, `opened: параметры сборки`)
  const { approval, plan, at } = input
  const { approval: verifiedApproval, plan: verifiedPlan } = parseAndVerifyApproval({ approval, plan })
  const atMs = assertCanonicalInstant(at, 'at')
  const approvalDeleteAfterMs = assertCanonicalInstant(
    verifiedApproval.deleteAfter, 'approval.deleteAfter',
  )
  /* Предварительная нижняя граница. Свидетельство потребления обязано жить
     не меньше самого разрешения: иначе журнал исчез бы раньше, чем истёк
     approval, каталог перестал бы существовать, состояние снова стало бы
     «действует» — и платный прогон можно было бы начать повторно. */
  const deleteAfterMs = Math.max(
    approvalDeleteAfterMs, safeAdd(atMs, JOURNAL_RETENTION_MS, 'opened.deleteAfter'),
  )

  const items = verifiedPlan.portals.flatMap((portal) => portal.items.map((item) => ({
    portalId: portal.portalId,
    sourceKey: item.sourceKey,
    requestItemId: requestItemId({
      planDigest: verifiedPlan.planDigest.value,
      portalId: portal.portalId,
      sourceKey: item.sourceKey,
      candidateInputDigest: item.candidateInputDigest.value,
    }),
    candidateInputDigest: item.candidateInputDigest.value,
  }))).sort((a, b) => {
    if (a.portalId !== b.portalId) return a.portalId < b.portalId ? -1 : 1
    return a.requestItemId < b.requestItemId ? -1 : a.requestItemId > b.requestItemId ? 1 : 0
  })

  return {
    createdAt: at,
    deleteAfter: new Date(deleteAfterMs).toISOString(),
    approvalId: verifiedApproval.approvalId,
    approvalDigest: verifiedApproval.approvalDigest.value,
    planId: verifiedApproval.planId,
    planDigest: verifiedApproval.planDigest.value,
    planArtifactDigest: verifiedApproval.planArtifactDigest.value,
    providerProfileDigest: verifiedApproval.providerProfileDigest.value,
    selectionDigest: verifiedApproval.selectionDigest.value,
    codeIdentity: { ...verifiedApproval.codeIdentity },
    items,
  }
}

/**
 * Подпись записи: `UTF8(домен) 0x0A канонический JSON записи без подписи`.
 *
 * Строгая форма ИСХОДНОГО объекта проверяется до проекции ключей: `Object.keys`
 * не видит символьных, неперечисляемых и accessor-свойств, и три разных
 * объекта получили бы один digest.
 */
export function recordDigest(record) {
  if (!isPlainObject(record)) {
    throw new TypeError(`${EXECUTION_RECORD_SPEC}: запись обязана быть простым объектом`)
  }
  canonicalJsonBytes(record, EXECUTION_RECORD_SPEC)
  const signed = {}
  for (const key of RECORD_KEYS) {
    if (key === 'recordDigest') continue
    if (!(key in record)) throw new TypeError(`${EXECUTION_RECORD_SPEC}: нет обязательного поля ${key}`)
    signed[key] = record[key]
  }
  const extra = Object.keys(record).filter((key) => !RECORD_KEYS.includes(key))
  if (extra.length) throw new TypeError(`${EXECUTION_RECORD_SPEC}: лишние поля ${extra.join(', ')}`)
  return sha256Bytes(canonicalJsonBytes(signed, EXECUTION_RECORD_SPEC))
}

/** Сборка записи. Свой результат проверяет той же границей, что и чужую строку. */
export const RECORD_BUILD_KEYS = Object.freeze(['seq', 'at', 'executionId', 'type', 'payload'])

export function buildRecord(input) {
  assertStrictInput(input, RECORD_BUILD_KEYS, `${EXECUTION_RECORD_SPEC}: параметры сборки`)
  const { seq, at, executionId: id, type, payload } = input
  const record = {
    contractVersion: MODEL_EXECUTION_SPEC,
    seq,
    at,
    executionId: id,
    type,
    payload,
  }
  record.recordDigest = digest(recordDigest(record), DIGEST_ALGORITHM, EXECUTION_RECORD_SPEC)
  return parseAndVerifyRecord(record, { executionId: id })
}

function assertOpenedPayload(payload, where) {
  assertExactKeys(payload, OPENED_PAYLOAD_KEYS, where)
  assertCanonicalInstant(payload.createdAt, `${where}.createdAt`)
  assertCanonicalInstant(payload.deleteAfter, `${where}.deleteAfter`)
  assertNonEmptyString(payload.approvalId, `${where}.approvalId`)
  assertNonEmptyString(payload.planId, `${where}.planId`)
  for (const key of [
    'approvalDigest', 'planDigest', 'planArtifactDigest', 'providerProfileDigest', 'selectionDigest',
  ]) {
    assertSha256Value(payload[key], `${where}.${key}`)
  }
  /* Идентичность кода проверяется тем же валидатором, что и в плане, и
     обязана быть чистой: грязное дерево означает, что commit не описывает
     код, построивший карту кандидатов. */
  assertCodeIdentity(payload.codeIdentity)
  if (payload.codeIdentity.dirty !== false) {
    throw new TypeError(
      `${where}.codeIdentity.dirty: журнал, открытый грязным деревом, выглядит проверяемым, `
      + 'не будучи им',
    )
  }
  if (!Array.isArray(payload.items) || !payload.items.length) {
    throw new TypeError(`${where}.items: ожидается непустой массив`)
  }
  const ids = []
  payload.items.forEach((item, i) => {
    const itemWhere = `${where}.items[${i}]`
    assertExactKeys(item, OPENED_ITEM_KEYS, itemWhere)
    assertNonEmptyString(item.portalId, `${itemWhere}.portalId`)
    assertNonEmptyString(item.sourceKey, `${itemWhere}.sourceKey`)
    if (typeof item.requestItemId !== 'string' || !HEX_64.test(item.requestItemId)) {
      throw new TypeError(
        `${itemWhere}.requestItemId: ожидается ровно 64 строчных hex-знака без префикса`,
      )
    }
    assertSha256Value(item.candidateInputDigest, `${itemWhere}.candidateInputDigest`)
    /* Идентификатор записи ПЕРЕСЧИТЫВАЕТСЯ. После удаления плана журнал —
       единственная карта кандидатов, и принимать её на слово значит доверять
       карте, которую никто не проверял. */
    const recomputed = requestItemId({
      planDigest: payload.planDigest,
      portalId: item.portalId,
      sourceKey: item.sourceKey,
      candidateInputDigest: item.candidateInputDigest,
    })
    if (recomputed !== item.requestItemId) {
      throw new TypeError(
        `${itemWhere}.requestItemId: в записи ${item.requestItemId}, пересчёт по planDigest, `
        + `portalId, sourceKey и candidateInputDigest даёт ${recomputed}`,
      )
    }
    ids.push(`${item.portalId}${String.fromCharCode(UNIT_SEPARATOR)}${item.requestItemId}`)
  })
  assertStringList(ids, `${where}.items: порядок и уникальность`)

  /* Выборка пересобирается из самих элементов и её подпись сверяется с той,
     что записана рядом. Так две половины `opened` — карта кандидатов и
     подпись выборки — проверяют друг друга, а не лежат рядом молча. */
  const rebuilt = {
    contractVersion: MODEL_SELECTION_SPEC,
    planId: payload.planId,
    planDigest: payload.planDigest,
    entries: payload.items.map((item) => ({
      portalId: item.portalId,
      requestItemId: item.requestItemId,
      candidateInputDigest: item.candidateInputDigest,
    })),
  }
  const rebuiltDigest = selectionDigest(rebuilt)
  if (rebuiltDigest !== payload.selectionDigest) {
    throw new TypeError(
      `${where}.selectionDigest: в записи ${payload.selectionDigest}, пересчёт по items даёт `
      + `${rebuiltDigest}`,
    )
  }
}

/**
 * Проверенный локальный результат, а не сырой ответ провайдера.
 *
 * Для принятого предложения граница вызывается повторно: журнал не доверяет
 * объекту с уже проставленным `classificationSource: model`. Для отказа сырой
 * ответ намеренно не хранится, поэтому остаётся строгая форма непустого
 * списка проблем и отсутствие предложения/классификации.
 */
export function assertClassificationResult(result, outcome, where) {
  if (outcome !== 'accepted' && outcome !== 'rejected') {
    if (result !== null) {
      throw new TypeError(`${where}: исход ${outcome} не несёт результата классификации`)
    }
    return
  }
  assertExactKeys(result, CLASSIFICATION_RESULT_KEYS, where)
  if (!Array.isArray(result.problems)) throw new TypeError(`${where}.problems: ожидается массив`)
  result.problems.forEach((problem, i) => assertNonEmptyString(problem, `${where}.problems[${i}]`))
  if (outcome === 'rejected') {
    if (result.ok !== false || !result.problems.length
      || result.proposal !== null || result.classification !== null) {
      throw new TypeError(
        `${where}: rejected требует ok=false, непустые problems и null в proposal/classification`,
      )
    }
    return
  }
  if (result.ok !== true || result.problems.length || !isPlainObject(result.proposal)
    || !isPlainObject(result.classification)) {
    throw new TypeError(
      `${where}: accepted требует ok=true, пустые problems и проверенные proposal/classification`,
    )
  }
  const checked = classifyModelResponse(result.proposal, {
    sourceKey: result.classification.sourceKey ?? null,
  })
  if (!checked.ok
    || canonicalJsonBytes(checked, MODEL_CLASSIFICATION_RESULT_SPEC).compare(
      canonicalJsonBytes(result, MODEL_CLASSIFICATION_RESULT_SPEC),
    ) !== 0) {
    throw new TypeError(
      `${where}: proposal не воспроизводит сохранённую классификацию через classifyModelResponse`,
    )
  }
}

function assertPayload(type, payload, where) {
  if (type === 'opened') return assertOpenedPayload(payload, where)
  if (type === 'dispatching') {
    assertExactKeys(payload, DISPATCHING_PAYLOAD_KEYS, where)
    assertRequestItemId(payload.requestItemId, `${where}.requestItemId`)
    assertSha256Value(payload.requestSpecDigest, `${where}.requestSpecDigest`)
    return undefined
  }
  if (type === 'settled') {
    assertExactKeys(payload, SETTLED_PAYLOAD_KEYS, where)
    assertRequestItemId(payload.requestItemId, `${where}.requestItemId`)
    assertSha256Value(payload.requestSpecDigest, `${where}.requestSpecDigest`)
    if (!TERMINAL_OUTCOMES.includes(payload.outcome)) {
      throw new TypeError(
        `${where}.outcome: ожидается один из ${TERMINAL_OUTCOMES.join(', ')}, `
        + `получено ${JSON.stringify(payload.outcome)}`,
      )
    }
    if (typeof payload.charged !== 'boolean') {
      throw new TypeError(`${where}.charged: ожидается boolean, получено ${typeof payload.charged}`)
    }
    /* Потеря без списания невыразима: «деньги потрачены впустую» — это
       утверждение о списании. Неопределённость уже выражена `dispatching` без
       `settled`, и молча превращать формально записанный исход в
       неопределённость нельзя — это открыло бы дорогу второму `settled`. */
    if (payload.outcome === 'lost' && payload.charged !== true) {
      throw new TypeError(
        `${where}: исход «lost» требует charged === true — потеря без доказанного списания `
        + 'выражается не им, а отсутствием settled',
      )
    }
    assertClassificationResult(payload.result, payload.outcome, `${where}.result`)
    return undefined
  }
  assertExactKeys(payload, CLOSED_PAYLOAD_KEYS, where)
  assertCanonicalInstant(payload.deleteAfter, `${where}.deleteAfter`)
  if (!CLOSED_OUTCOMES.includes(payload.outcome)) {
    throw new TypeError(
      `${where}.outcome: ожидается один из ${CLOSED_OUTCOMES.join(', ')}, `
      + `получено ${JSON.stringify(payload.outcome)}`,
    )
  }
  assertExactKeys(payload.counts, COUNT_BUCKETS, `${where}.counts`)
  for (const bucket of COUNT_BUCKETS) assertInteger(payload.counts[bucket], `${where}.counts.${bucket}`)
  return undefined
}

/** Единственная проверка отдельной записи. */
export function parseAndVerifyRecord(raw, options) {
  assertStrictOptions(options, { required: ['executionId'] }, `${EXECUTION_RECORD_SPEC}: параметры проверки`)
  const id = options.executionId
  if (!isPlainObject(raw)) {
    throw new TypeError(`${EXECUTION_RECORD_SPEC}: запись обязана быть простым объектом`)
  }
  canonicalJsonBytes(raw, EXECUTION_RECORD_SPEC)
  assertExactKeys(raw, RECORD_KEYS, EXECUTION_RECORD_SPEC)
  assertExactly(raw.contractVersion, MODEL_EXECUTION_SPEC, 'contractVersion')
  assertInteger(raw.seq, 'seq')
  assertCanonicalInstant(raw.at, 'at')
  assertExecutionId(raw.executionId, 'executionId')
  /* `null` — «идентификатор ещё не известен», а не «не проверять что попало»:
     сюда его передаёт только разбор отдельной записи вне журнала. */
  if (id !== null) assertExactly(raw.executionId, id, 'executionId')
  if (!RECORD_TYPES.includes(raw.type)) {
    throw new TypeError(
      `type: ожидается один из ${RECORD_TYPES.join(', ')}, получено ${JSON.stringify(raw.type)}`,
    )
  }
  assertPayload(raw.type, raw.payload, `${raw.type}.payload`)
  assertDigestShape(raw.recordDigest, EXECUTION_RECORD_SPEC, 'recordDigest')
  const recomputed = recordDigest(raw)
  if (recomputed !== raw.recordDigest.value) {
    throw new TypeError(
      `recordDigest не сходится: в записи ${raw.recordDigest.value}, пересчёт даёт ${recomputed}. `
      + 'Сохранённое значение здесь не свидетельство, а предмет проверки.',
    )
  }
  return deepFreeze(structuredClone(raw))
}

/**
 * Проверка последовательности записей целиком: нумерация, принадлежность и
 * закрытая грамматика переходов.
 *
 * Отдельно от проверки одной записи, потому что ловит другое: одна запись
 * может быть безупречной и стоять там, где её быть не может.
 */
export const JOURNAL_VERIFY_KEYS = Object.freeze(['records', 'executionId'])

export function parseAndVerifyJournal(input) {
  assertStrictOptions(input, { required: JOURNAL_VERIFY_KEYS }, `${MODEL_EXECUTION_SPEC}: параметры проверки журнала`)
  const { records, executionId: id } = input
  if (!Array.isArray(records) || !records.length) {
    throw new TypeError(`${MODEL_EXECUTION_SPEC}: журнал обязан содержать хотя бы запись opened`)
  }
  let previousAt = null
  const verified = records.map((raw, i) => {
    const record = parseAndVerifyRecord(raw, { executionId: id })
    assertExactly(record.seq, i, `запись ${i}: seq`)
    if (previousAt !== null) {
      const previousMs = assertCanonicalInstant(previousAt, `запись ${i - 1}: at`)
      const currentMs = assertCanonicalInstant(record.at, `запись ${i}: at`)
      if (currentMs < previousMs) {
        throw new TypeError(
          `запись ${i}: at ${record.at} раньше предыдущей записи ${previousAt}`,
        )
      }
    }
    previousAt = record.at
    return record
  })
  if (verified[0].type !== 'opened') {
    throw new TypeError(`${MODEL_EXECUTION_SPEC}: первая запись обязана быть opened`)
  }

  const planned = new Map(verified[0].payload.items.map((item) => [item.requestItemId, item]))
  const dispatched = new Map()
  const settled = new Set()
  let closed = false
  for (let i = 1; i < verified.length; i += 1) {
    const record = verified[i]
    const where = `запись ${i} (${record.type})`
    if (closed) throw new TypeError(`${where}: после closed записей быть не может`)
    if (record.type === 'opened') throw new TypeError(`${where}: второй opened невозможен`)
    if (record.type === 'closed') { closed = true; continue }
    const itemId = record.payload.requestItemId
    if (!planned.has(itemId)) {
      throw new TypeError(`${where}: элемент ${itemId} не объявлен в opened`)
    }
    if (record.type === 'dispatching') {
      if (dispatched.has(itemId)) throw new TypeError(`${where}: повторный dispatching элемента ${itemId}`)
      dispatched.set(itemId, record.payload.requestSpecDigest)
      continue
    }
    if (!dispatched.has(itemId)) {
      throw new TypeError(`${where}: settled без dispatching — эффект без записанного намерения`)
    }
    if (settled.has(itemId)) throw new TypeError(`${where}: повторный settled элемента ${itemId}`)
    assertExactly(
      record.payload.requestSpecDigest,
      dispatched.get(itemId),
      `${where}: requestSpecDigest против dispatching`,
    )
    if (record.payload.outcome === 'accepted') {
      assertExactly(
        record.payload.result.classification.sourceKey,
        planned.get(itemId).sourceKey,
        `${where}: classification.sourceKey против opened`,
      )
    }
    settled.add(itemId)
  }
  /* Семантика `closed` проверяется ЗДЕСЬ, а не только при подсчёте итога:
     иначе граница считала бы журнал корректно закрытым, а чтение объявляло
     повреждённым — два разных ответа на один вопрос. */
  if (closed) assertClosedConsistency(verified)
  return verified
}

/**
 * Согласованность записи `closed` с содержимым журнала: исход, счётчики,
 * их сумма и окончательный срок.
 */
function assertClosedConsistency(verified) {
  const closedRecord = verified.find((record) => record.type === 'closed')
  const counts = countBuckets(verified)
  const total = verified[0].payload.items.length
  const anyDispatchOrSettle = verified.slice(1).some(
    (record) => record.type === 'dispatching' || record.type === 'settled',
  )
  assertExactly(
    closedRecord.payload.outcome,
    outcomeFromCounts(counts, { anyDispatchOrSettle, total }),
    'closed.outcome',
  )
  for (const bucket of COUNT_BUCKETS) {
    assertExactly(closedRecord.payload.counts[bucket], counts[bucket], `closed.counts.${bucket}`)
  }
  assertExactly(
    COUNT_BUCKETS.reduce((acc, bucket) => acc + counts[bucket], 0), total,
    'closed.counts: сумма против числа элементов',
  )
  assertExactly(
    closedRecord.payload.deleteAfter,
    closedDeleteAfter({ openedDeleteAfter: verified[0].payload.deleteAfter, closedAt: closedRecord.at }),
    'closed.deleteAfter',
  )
  return counts
}

function countBuckets(verified) {
  const counts = Object.fromEntries(COUNT_BUCKETS.map((bucket) => [bucket, 0]))
  const planned = verified[0].payload.items.map((item) => item.requestItemId)
  const outcomeOf = new Map()
  const dispatched = new Set()
  for (const record of verified.slice(1)) {
    if (record.type === 'dispatching') dispatched.add(record.payload.requestItemId)
    if (record.type === 'settled') outcomeOf.set(record.payload.requestItemId, record.payload.outcome)
  }
  for (const id of planned) {
    if (outcomeOf.has(id)) counts[outcomeOf.get(id)] += 1
    else if (dispatched.has(id)) counts.unknown += 1
    else counts.notDispatched += 1
  }
  return counts
}

function outcomeFromCounts(counts, { anyDispatchOrSettle, total }) {
  if (!anyDispatchOrSettle) {
    if (counts.notDispatched !== total) {
      throw new TypeError('abortedBeforeDispatch: notDispatched обязан равняться числу элементов')
    }
    return 'abortedBeforeDispatch'
  }
  if (counts.notDispatched !== 0 || counts.unknown !== 0) {
    throw new TypeError(
      'closed запрещён: остались неотправленные либо неурегулированные элементы — '
      + `notDispatched ${counts.notDispatched}, unknown ${counts.unknown}`,
    )
  }
  if (counts.lost > 0) return 'withLoss'
  if (counts.rejected + counts.truncated + counts.failed > 0) return 'withFailures'
  if (counts.skipped > 0) return 'withSkips'
  return 'allAccepted'
}

const OUTCOME_EXIT = Object.freeze({
  allAccepted: EXIT_CODES.allAccepted,
  withFailures: EXIT_CODES.failures,
  withSkips: EXIT_CODES.skips,
  withLoss: EXIT_CODES.withLoss,
  abortedBeforeDispatch: EXIT_CODES.failures,
})

/**
 * Единственная исчерпывающая функция итога.
 *
 * Счётчики и исход выводятся ИЗ ЖУРНАЛА. Параметра, которым вызывающий мог бы
 * их задать, нет: итог, объявленный тем, кто исполнял, — не итог.
 */
export function summarizeJournal(verified) {
  const counts = countBuckets(verified)
  const anyDispatchOrSettle = verified.slice(1).some(
    (record) => record.type === 'dispatching' || record.type === 'settled',
  )
  const closedRecord = verified.find((record) => record.type === 'closed') ?? null

  if (closedRecord === null) {
    /* Незакрытый журнал — всегда работа для reconciliation, независимо от
       того, сколько элементов успело урегулироваться. */
    const state = anyDispatchOrSettle ? 'needsReconciliation' : 'interruptedBeforeDispatch'
    return deepFreeze({
      state, counts, outcome: null, exitCode: EXIT_CODES.needsReconciliation, deleteAfter: null,
    })
  }

  /* Сверку уже выполнила общая граница `parseAndVerifyJournal`; второй
     реализации того же правила здесь нет. */
  return deepFreeze({
    state: 'closed',
    counts,
    outcome: closedRecord.payload.outcome,
    exitCode: OUTCOME_EXIT[closedRecord.payload.outcome],
    deleteAfter: closedRecord.payload.deleteAfter,
  })
}

/**
 * Окончательный срок хранения — вторая фаза.
 *
 * Журнал, открытый давно и закрытый сегодня, обязан пережить закрытие на
 * тридцать суток; журнал, открытый и закрытый в одну минуту, не должен
 * получить срок короче предварительного. Отсюда `max`, а не замена.
 */
export const CLOSED_DELETE_AFTER_KEYS = Object.freeze(['openedDeleteAfter', 'closedAt'])

export function closedDeleteAfter(input) {
  assertStrictInput(input, CLOSED_DELETE_AFTER_KEYS, 'closed.deleteAfter: параметры')
  const { openedDeleteAfter, closedAt } = input
  const openedMs = assertCanonicalInstant(openedDeleteAfter, 'opened.deleteAfter')
  const closedAtMs = assertCanonicalInstant(closedAt, 'closed.at')
  return new Date(Math.max(
    openedMs, safeAdd(closedAtMs, JOURNAL_RETENTION_MS, 'closed.deleteAfter'),
  )).toISOString()
}

/** Полезная нагрузка `closed`, посчитанная из журнала. */
export const CLOSED_BUILD_KEYS = Object.freeze(['verified', 'at'])

export function buildClosedPayload(input) {
  assertStrictOptions(input, { required: CLOSED_BUILD_KEYS }, 'closed: параметры сборки')
  const { verified, at } = input
  const counts = countBuckets(verified)
  const total = verified[0].payload.items.length
  const anyDispatchOrSettle = verified.slice(1).some(
    (record) => record.type === 'dispatching' || record.type === 'settled',
  )
  /* Этот коммит закрывает только прогоны, дошедшие до отправки. Журнал с
     одним `opened` остаётся открытым и читается как interruptedBeforeDispatch:
     закрыть его как abortedBeforeDispatch вправе только reconciliation,
     которая умеет доказать, что отправки не было, а не предположить это. */
  if (!anyDispatchOrSettle) {
    throw new TypeError(
      'closeJournal: прогон не дошёл до первой отправки. Такой журнал закрывает reconciliation '
      + 'отдельной границей, а не текущий процесс.',
    )
  }
  const outcome = outcomeFromCounts(counts, { anyDispatchOrSettle, total })
  return {
    deleteAfter: closedDeleteAfter({
      openedDeleteAfter: verified[0].payload.deleteAfter, closedAt: at,
    }),
    outcome,
    counts,
  }
}
