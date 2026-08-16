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

/**
 * Нарушение КОНТРАКТА журнала — ожидаемый вердикт о содержимом.
 *
 * Типизированный канал нужен читателю: «прочитали и нашли повреждение» обязано
 * отличаться от «сломался проверяющий». Наследуется от `TypeError`, чтобы уже
 * написанные ожидания не изменились ни на знак.
 */
export class JournalContractError extends TypeError {
  constructor(message, options) {
    super(message, options)
    this.name = 'JournalContractError'
  }
}

/** Точный состав записи журнала. Единственный список в проекте. */
export const RECORD_KEYS = Object.freeze([
  'contractVersion', 'seq', 'at', 'executionId', 'type', 'payload', 'recordDigest',
])

/**
 * Закрытый список типов записи. Неизвестный тип — повреждение, а не пропуск.
 *
 * `reconciled` добавлен расширением v1, а не новой версией: состав записи,
 * состав каждого прежнего payload, корзины, исходы и коды не изменились ни на
 * знак, поэтому все существующие журналы читаются прежним путём и дают
 * прежний вердикт. Цена расширения названа вслух: журнал, дописанный
 * reconciliation, прежним читателем уже не понимается. Потребитель в проекте
 * один, внешних читателей нет.
 */
export const RECORD_TYPES = Object.freeze([
  'opened', 'claimed', 'dispatching', 'settled', 'reconciled', 'released', 'closed',
])

/**
 * Домен РЕШЕНИЯ ВЛАДЕЛЬЦА о судьбе неопределённого запроса.
 *
 * Отдельный от домена результата операции (`poi-model-reconciliation/v1`)
 * намеренно: один домен на две формы означал бы, что отпечаток одной из них
 * ничего не различает.
 *
 * Свидетельство ничего не ДОКАЗЫВАЕТ машинно и таким себя не объявляет.
 * Локального материала, по которому код мог бы сам установить факт списания,
 * не существует: сырой ответ не хранится, сети нет, status-запрос запрещён.
 * Поэтому здесь оформляется наблюдение владельца — что он смотрел
 * (`grounds`), когда (`observedAt`), по какому решению (`decisionRef`) и кто
 * подписал (`approver`). Граница проверяет форму и привязку, а не истинность.
 */
export const RECONCILIATION_EVIDENCE_SPEC = 'poi-model-reconciliation-evidence/v1'

/**
 * Вердикты. Список закрыт двумя значениями.
 *
 * `delivered` здесь нет и в этой версии быть не может: сырой ответ не
 * сохраняется, а восстановить классификацию не из чего. Неопределённость без
 * доказательства выражается отсутствием записи, а не третьим вердиктом.
 */
export const RECONCILIATION_VERDICTS = Object.freeze(['noCharge', 'charged'])

/** Основания — ровно то, на что владелец смотрел. Список закрыт. */
export const RECONCILIATION_GROUNDS = Object.freeze([
  'providerConsole', 'providerInvoice', 'providerSupport',
])

/** Точный состав свидетельства. */
export const RECONCILIATION_EVIDENCE_KEYS = Object.freeze([
  'contractVersion', 'executionId', 'requestItemId', 'requestSpecDigest',
  'verdict', 'grounds', 'observedAt', 'decisionRef', 'approver', 'evidenceDigest',
])

/** Часть, входящая в отпечаток, — всё, кроме самого отпечатка. */
export const RECONCILIATION_EVIDENCE_SIGNED_KEYS = Object.freeze(
  RECONCILIATION_EVIDENCE_KEYS.filter((key) => key !== 'evidenceDigest'),
)

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
  journalForked: 51,
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
/**
 * Payload свидетельства в журнале.
 *
 * `executionId` сюда не дублируется: он уже стоит в самой записи и
 * проверяется общей границей. В отпечаток свидетельства он при этом входит,
 * поэтому свидетельство чужого исполнения не воспроизводит `evidenceDigest`.
 */
const RECONCILED_PAYLOAD_KEYS = Object.freeze([
  'requestItemId', 'requestSpecDigest', 'verdict', 'grounds',
  'observedAt', 'decisionRef', 'approver', 'evidenceDigest',
])
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

/**
 * Отпечаток свидетельства: домен входит В БАЙТЫ, а не лежит рядом со значением.
 *
 * Это SHA-256-отпечаток решения, а НЕ криптографическая подпись владельца:
 * он ничего не аутентифицирует и подделку заинтересованной стороной не
 * закрывает. Нужен он для другого — для идентичности решения: без него «то же
 * самое свидетельство» пришлось бы определять сравнением нескольких полей, и
 * решение с другим основанием прошло бы за повтор прежнего.
 *
 * Функция ПРИВАТНА намеренно. Публичный вычислитель отпечатка проецирует
 * вход раньше, чем кто-либо проверил его форму: `for ... of` по списку ключей
 * не видит ни неперечисляемого, ни символьного, ни accessor-свойства, и
 * объект со спрятанным полем привязки получил бы отпечаток чистого. Наружу
 * идут только builder и parser, и оба снимают строгую форму ВСЕГО сырого
 * объекта до всякой проекции.
 */
function reconciliationEvidenceDigest(evidence) {
  const signed = {}
  for (const key of RECONCILIATION_EVIDENCE_SIGNED_KEYS) signed[key] = evidence[key]
  return sha256Bytes(canonicalJsonBytes(signed, RECONCILIATION_EVIDENCE_SPEC))
}

/** Точный состав входа сборщика: решение владельца целиком и ничего сверх. */
export const RECONCILIATION_EVIDENCE_BUILD_KEYS = Object.freeze(
  RECONCILIATION_EVIDENCE_SIGNED_KEYS.filter((key) => key !== 'contractVersion'),
)

/**
 * Оформление решения владельца.
 *
 * Функция НЕ доказывает ни списание, ни его отсутствие и не обращается ни к
 * провайдеру, ни к файловой системе. Она считает единственную производную
 * величину — отпечаток — и проверяет форму. Истинность наблюдения остаётся на
 * владельце, и именно поэтому `decisionRef` и `approver` обязательны.
 */
export function buildReconciliationEvidence(input) {
  /* Строгая форма ВСЕГО сырого входа — до проекции и до вычисления
     отпечатка. Иначе спрятанное поле не попало бы в отпечаток, оставшись в
     объекте. */
  assertStrictInput(
    input, RECONCILIATION_EVIDENCE_BUILD_KEYS, `${RECONCILIATION_EVIDENCE_SPEC}: параметры сборки`,
  )
  const unsigned = { contractVersion: RECONCILIATION_EVIDENCE_SPEC, ...input }
  return parseAndVerifyReconciliationEvidence({
    ...unsigned,
    evidenceDigest: digest(
      reconciliationEvidenceDigest(unsigned), DIGEST_ALGORITHM, RECONCILIATION_EVIDENCE_SPEC,
    ),
  })
}

/**
 * Единственная проверка свидетельства.
 *
 * Сохранённому отпечатку доверия нет: он пересчитывается здесь же и является
 * предметом проверки, а не свидетельством о себе.
 */
export function parseAndVerifyReconciliationEvidence(raw) {
  assertStrictInput(raw, RECONCILIATION_EVIDENCE_KEYS, `${RECONCILIATION_EVIDENCE_SPEC}: свидетельство`)
  assertExactly(raw.contractVersion, RECONCILIATION_EVIDENCE_SPEC, 'contractVersion')
  assertExecutionId(raw.executionId, 'executionId')
  assertRequestItemId(raw.requestItemId, 'requestItemId')
  assertSha256Value(raw.requestSpecDigest, 'requestSpecDigest')
  if (!RECONCILIATION_VERDICTS.includes(raw.verdict)) {
    throw new TypeError(
      `verdict: ожидается один из ${RECONCILIATION_VERDICTS.join(', ')}, `
      + `получено ${JSON.stringify(raw.verdict)}`,
    )
  }
  if (!RECONCILIATION_GROUNDS.includes(raw.grounds)) {
    throw new TypeError(
      `grounds: ожидается одно из ${RECONCILIATION_GROUNDS.join(', ')}, `
      + `получено ${JSON.stringify(raw.grounds)}`,
    )
  }
  assertCanonicalInstant(raw.observedAt, 'observedAt')
  assertNonEmptyString(raw.decisionRef, 'decisionRef')
  assertNonEmptyString(raw.approver, 'approver')
  assertDigestShape(raw.evidenceDigest, RECONCILIATION_EVIDENCE_SPEC, 'evidenceDigest')
  const recomputed = reconciliationEvidenceDigest(raw)
  if (recomputed !== raw.evidenceDigest.value) {
    throw new TypeError(
      `evidenceDigest не сходится: в свидетельстве ${raw.evidenceDigest.value}, пересчёт даёт `
      + `${recomputed}. Сохранённое значение здесь не свидетельство, а предмет проверки.`,
    )
  }
  return deepFreeze(structuredClone(raw))
}

/** Payload записи из проверенного свидетельства. Второй формы у него нет. */
export const RECONCILED_BUILD_KEYS = Object.freeze(['evidence'])

export function buildReconciledPayload(input) {
  assertStrictOptions(input, { required: RECONCILED_BUILD_KEYS }, 'reconciled: параметры сборки')
  const evidence = parseAndVerifyReconciliationEvidence(input.evidence)
  const payload = {}
  for (const key of RECONCILED_PAYLOAD_KEYS) {
    payload[key] = key === 'evidenceDigest' ? { ...evidence.evidenceDigest } : evidence[key]
  }
  return payload
}

/**
 * Payload свидетельства проверяется вместе с идентификатором исполнения.
 *
 * `executionId` в payload не лежит, но входит в отпечаток, поэтому свидетельство
 * из чужого исполнения здесь не воспроизводит собственный `evidenceDigest` —
 * и отвергается до всякой грамматики.
 */
function assertReconciledPayload(payload, where, executionId) {
  assertExactKeys(payload, RECONCILED_PAYLOAD_KEYS, where)
  assertRequestItemId(payload.requestItemId, `${where}.requestItemId`)
  assertSha256Value(payload.requestSpecDigest, `${where}.requestSpecDigest`)
  assertDigestShape(payload.evidenceDigest, RECONCILIATION_EVIDENCE_SPEC, `${where}.evidenceDigest`)
  parseAndVerifyReconciliationEvidence({
    contractVersion: RECONCILIATION_EVIDENCE_SPEC,
    executionId,
    requestItemId: payload.requestItemId,
    requestSpecDigest: payload.requestSpecDigest,
    verdict: payload.verdict,
    grounds: payload.grounds,
    observedAt: payload.observedAt,
    decisionRef: payload.decisionRef,
    approver: payload.approver,
    evidenceDigest: payload.evidenceDigest,
  })
}

/* ── Протокол владения исполнением ───────────────────────────────────── */

/**
 * Поколение формата журнала.
 *
 * Токен стоит в ИМЕНИ сегмента и повторяется подписью в записи `claimed`.
 * Имя выбирает формат атомарно при создании файла; запись связывает этот
 * выбор с содержимым, поэтому переименование сегмента становится отказом, а
 * не тихой сменой грамматики.
 */
export const JOURNAL_GENERATIONS = Object.freeze(['g1'])

/** Верхняя граница номера эпохи. Шире имени сегмента её не бывает. */
export const MAX_EPOCH = 999999

const SEGMENT_NAME = /^journal\.(g1)\.e([1-9][0-9]{0,5})\.jsonl$/

/** Каноническое имя сегмента. Единственная реализация на весь проект. */
export function segmentName(generation, epoch) {
  if (!JOURNAL_GENERATIONS.includes(generation)) {
    throw new TypeError(`segmentName: неизвестное поколение ${JSON.stringify(generation)}`)
  }
  assertInteger(epoch, 'segmentName.epoch', 1)
  if (epoch > MAX_EPOCH) throw new TypeError(`segmentName.epoch: больше ${MAX_EPOCH}`)
  return `journal.${generation}.e${epoch}.jsonl`
}

/**
 * Разбор имени сегмента. `null` — имя не каноническое.
 *
 * Ведущие нули, верхний регистр и знак отвергаются формой, а не приводятся:
 * `e01` и `e1` описывали бы одну эпоху двумя именами, и `ax` перестал бы
 * быть взаимным исключением.
 */
export function parseSegmentName(name) {
  const match = typeof name === 'string' ? SEGMENT_NAME.exec(name) : null
  if (match === null) return null
  const epoch = Number(match[2])
  if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch > MAX_EPOCH) return null
  return Object.freeze({ generation: match[1], epoch })
}

/** Основания захвата эпохи. Список закрыт. */
export const CLAIM_BASES = Object.freeze(['opened', 'released', 'takeover'])

/** Причины добровольного освобождения эпохи. Список закрыт. */
export const RELEASE_REASONS = Object.freeze(['handoff', 'needsReconciliation'])

/**
 * Домен ПОЛНОМОЧИЯ ВЛАДЕЛЬЦА на перехват исполнения.
 *
 * Полномочие ничего не доказывает машинно и таким себя не объявляет. Живость
 * чужого процесса локальными средствами неустановима, а вывод о ней по
 * времени запрещён. Поэтому здесь оформляется УТВЕРЖДЕНИЕ владельца: что он
 * установил (`grounds`), когда (`observedAt`), по какому решению
 * (`decisionRef`) и кто подписал (`approver`). Граница проверяет форму
 * утверждения и его привязку к точному хвосту, но НЕ его истинность.
 *
 * Отсюда же следует граница обещания всего протокола: ни одна проверка
 * файлов не отменяет байтов, которые чужой живой процесс уже отдал в сокет.
 * Отсутствие уже случившегося сетевого эффекта исключает только правдивое
 * утверждение владельца, и ничто другое.
 */
export const MODEL_TAKEOVER_SPEC = 'poi-model-takeover/v1'

/** Основания перехвата: каждое — утверждение о НЕСПОСОБНОСТИ прежнего процесса отправлять. */
export const TAKEOVER_GROUNDS = Object.freeze([
  'processExited', 'hostRestarted', 'operatorConfirmedStopped',
])

/** Точный состав описания незавершённого сегмента. */
export const SUPERSEDED_SEGMENT_KEYS = Object.freeze(['name', 'bytes', 'rawDigest'])

/** Точный состав полномочия. */
export const TAKEOVER_KEYS = Object.freeze([
  'contractVersion', 'executionId', 'fromEpoch', 'fromSeq', 'fromRecordDigest',
  'fromSegmentBytes', 'fromSegmentRawDigest', 'supersededSegments', 'grounds', 'observedAt',
  'decisionRef', 'approver', 'takeoverDigest',
])

/** Часть, входящая в отпечаток, — всё, кроме самого отпечатка. */
export const TAKEOVER_SIGNED_KEYS = Object.freeze(
  TAKEOVER_KEYS.filter((key) => key !== 'takeoverDigest'),
)

export const TAKEOVER_BUILD_KEYS = Object.freeze(
  TAKEOVER_SIGNED_KEYS.filter((key) => key !== 'contractVersion'),
)

const CLAIMED_PAYLOAD_KEYS = Object.freeze([
  'generation', 'epoch', 'basis', 'fromEpoch', 'fromSeq', 'fromRecordDigest',
  'fromSegmentBytes', 'fromSegmentRawDigest', 'supersededSegments', 'grounds', 'observedAt',
  'decisionRef', 'approver', 'takeoverDigest',
])

const RELEASED_PAYLOAD_KEYS = Object.freeze(['epoch', 'reason'])

/** Пять полей утверждения владельца. Либо все `null`, либо все заполнены. */
const ATTESTATION_KEYS = Object.freeze([
  'grounds', 'observedAt', 'decisionRef', 'approver', 'takeoverDigest',
])

/**
 * Описания незавершённых сегментов.
 *
 * Сырой отпечаток, а не только длина: пустой и оборванный сегмент не
 * пропускаются автоматически, и полномочие обязано указывать на ТЕ САМЫЕ
 * байты, которые владелец видел. Длина без отпечатка допустила бы подмену
 * содержимого той же длины.
 */
function assertSupersededSegments(value, where) {
  if (!Array.isArray(value)) throw new TypeError(`${where}: ожидается массив`)
  const names = []
  value.forEach((entry, index) => {
    const at = `${where}[${index}]`
    if (!isPlainObject(entry)) throw new TypeError(`${at}: ожидается простой объект`)
    assertExactKeys(entry, SUPERSEDED_SEGMENT_KEYS, at)
    if (parseSegmentName(entry.name) === null) {
      throw new TypeError(`${at}.name: имя сегмента не каноническое — ${JSON.stringify(entry.name)}`)
    }
    assertInteger(entry.bytes, `${at}.bytes`, 0)
    assertSha256Value(entry.rawDigest, `${at}.rawDigest`)
    names.push(entry.name)
  })
  return names
}

function assertAttestation(value, where, { required }) {
  if (!required) {
    for (const key of ATTESTATION_KEYS) assertExactly(value[key], null, `${where}.${key}`)
    return
  }
  if (!TAKEOVER_GROUNDS.includes(value.grounds)) {
    throw new TypeError(
      `${where}.grounds: ожидается одно из ${TAKEOVER_GROUNDS.join(', ')}, `
      + `получено ${JSON.stringify(value.grounds)}`,
    )
  }
  assertCanonicalInstant(value.observedAt, `${where}.observedAt`)
  assertNonEmptyString(value.decisionRef, `${where}.decisionRef`)
  assertNonEmptyString(value.approver, `${where}.approver`)
  assertDigestShape(value.takeoverDigest, MODEL_TAKEOVER_SPEC, `${where}.takeoverDigest`)
}

/**
 * Отпечаток полномочия. Приватен: публичная функция над непроверенным входом
 * проецировала бы объект до строгой проверки, и спрятанное поле не попало бы
 * в подпись, оставшись в объекте.
 */
function takeoverDigestOf(unsigned) {
  assertStrictInput(unsigned, TAKEOVER_SIGNED_KEYS, `${MODEL_TAKEOVER_SPEC}: подписываемая часть`)
  return sha256Bytes(canonicalJsonBytes(unsigned, MODEL_TAKEOVER_SPEC))
}

/** Оформление полномочия владельца. Истинности не проверяет и не обещает. */
export function buildTakeover(input) {
  assertStrictInput(input, TAKEOVER_BUILD_KEYS, `${MODEL_TAKEOVER_SPEC}: параметры сборки`)
  const unsigned = { contractVersion: MODEL_TAKEOVER_SPEC, ...input }
  return parseAndVerifyTakeover({
    ...unsigned,
    takeoverDigest: digest(takeoverDigestOf(unsigned), DIGEST_ALGORITHM, MODEL_TAKEOVER_SPEC),
  })
}

/** Единственная проверка полномочия. Сохранённый отпечаток пересчитывается. */
export function parseAndVerifyTakeover(raw) {
  assertStrictInput(raw, TAKEOVER_KEYS, `${MODEL_TAKEOVER_SPEC}: полномочие`)
  assertExactly(raw.contractVersion, MODEL_TAKEOVER_SPEC, 'contractVersion')
  assertExecutionId(raw.executionId, 'executionId')
  assertInteger(raw.fromEpoch, 'fromEpoch', 1)
  assertInteger(raw.fromSeq, 'fromSeq', 0)
  assertSha256Value(raw.fromRecordDigest, 'fromRecordDigest')
  assertInteger(raw.fromSegmentBytes, 'fromSegmentBytes', 1)
  assertSha256Value(raw.fromSegmentRawDigest, 'fromSegmentRawDigest')
  assertSupersededSegments(raw.supersededSegments, 'supersededSegments')
  assertAttestation(raw, MODEL_TAKEOVER_SPEC, { required: true })
  const unsigned = {}
  for (const key of TAKEOVER_SIGNED_KEYS) unsigned[key] = raw[key]
  const recomputed = takeoverDigestOf(unsigned)
  if (recomputed !== raw.takeoverDigest.value) {
    throw new TypeError(
      `takeoverDigest не сходится: в полномочии ${raw.takeoverDigest.value}, `
      + `пересчёт даёт ${recomputed}`,
    )
  }
  return deepFreeze(structuredClone(raw))
}

export const CLAIMED_BUILD_KEYS = Object.freeze([
  'executionId', 'generation', 'epoch', 'basis', 'fromEpoch', 'fromSeq', 'fromRecordDigest',
  'fromSegmentBytes', 'fromSegmentRawDigest', 'supersededSegments', 'takeover',
])

/**
 * Payload захвата эпохи.
 *
 * Полномочие разворачивается полями, как и свидетельство сверки: домен и
 * `executionId` в payload не дублируются, но входят в отпечаток — поэтому
 * полномочие чужого исполнения здесь не воспроизводится.
 *
 * Привязка приходит и параметром, и внутри полномочия, и обе половины
 * сверяются поимённо. Взять одну из них молча значило бы дать хранилищу и
 * владельцу разойтись в том, какой именно хвост перехватывается.
 */
export function buildClaimedPayload(input) {
  assertStrictOptions(input, { required: CLAIMED_BUILD_KEYS }, 'claimed: параметры сборки')
  const checked = input.takeover === null ? null : parseAndVerifyTakeover(input.takeover)
  if (checked !== null) {
    assertExactly(checked.executionId, input.executionId, 'полномочие: executionId')
    assertExactly(checked.fromEpoch, input.fromEpoch, 'полномочие: fromEpoch')
    assertExactly(checked.fromSeq, input.fromSeq, 'полномочие: fromSeq')
    assertExactly(checked.fromRecordDigest, input.fromRecordDigest, 'полномочие: fromRecordDigest')
    assertExactly(checked.fromSegmentBytes, input.fromSegmentBytes, 'полномочие: fromSegmentBytes')
    assertExactly(
      checked.fromSegmentRawDigest, input.fromSegmentRawDigest,
      'полномочие: fromSegmentRawDigest',
    )
    assertSameSegments(
      checked.supersededSegments, input.supersededSegments, 'полномочие: supersededSegments',
    )
  }
  const payload = {
    generation: input.generation,
    epoch: input.epoch,
    basis: input.basis,
    fromEpoch: input.fromEpoch,
    fromSeq: input.fromSeq,
    fromRecordDigest: input.fromRecordDigest,
    fromSegmentBytes: input.fromSegmentBytes,
    fromSegmentRawDigest: input.fromSegmentRawDigest,
    supersededSegments: input.supersededSegments,
    grounds: checked === null ? null : checked.grounds,
    observedAt: checked === null ? null : checked.observedAt,
    decisionRef: checked === null ? null : checked.decisionRef,
    approver: checked === null ? null : checked.approver,
    takeoverDigest: checked === null ? null : { ...checked.takeoverDigest },
  }
  assertClaimedPayload(payload, 'claimed.payload', input.executionId)
  return payload
}

/** Поэлементное сравнение перечней сегментов. Порядок значим. */
function assertSameSegments(left, right, where) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    throw new TypeError(`${where}: ожидаются два массива`)
  }
  assertExactly(left.length, right.length, `${where}: длина`)
  left.forEach((entry, index) => {
    for (const key of SUPERSEDED_SEGMENT_KEYS) {
      assertExactly(entry[key], right[index]?.[key], `${where}[${index}].${key}`)
    }
  })
}

export function assertClaimedPayload(payload, where, executionId) {
  assertExactKeys(payload, CLAIMED_PAYLOAD_KEYS, where)
  if (!JOURNAL_GENERATIONS.includes(payload.generation)) {
    throw new TypeError(
      `${where}.generation: ожидается одно из ${JOURNAL_GENERATIONS.join(', ')}, `
      + `получено ${JSON.stringify(payload.generation)}`,
    )
  }
  assertInteger(payload.epoch, `${where}.epoch`, 1)
  if (payload.epoch > MAX_EPOCH) throw new TypeError(`${where}.epoch: больше ${MAX_EPOCH}`)
  if (!CLAIM_BASES.includes(payload.basis)) {
    throw new TypeError(
      `${where}.basis: ожидается одно из ${CLAIM_BASES.join(', ')}, `
      + `получено ${JSON.stringify(payload.basis)}`,
    )
  }
  assertSha256Value(payload.fromRecordDigest, `${where}.fromRecordDigest`)
  const names = assertSupersededSegments(payload.supersededSegments, `${where}.supersededSegments`)

  if (payload.basis === 'opened') {
    assertExactly(payload.epoch, 1, `${where}.epoch при basis «opened»`)
    assertExactly(payload.fromEpoch, null, `${where}.fromEpoch`)
    assertExactly(payload.fromSeq, 0, `${where}.fromSeq`)
    assertExactly(payload.fromSegmentBytes, null, `${where}.fromSegmentBytes`)
    assertExactly(payload.fromSegmentRawDigest, null, `${where}.fromSegmentRawDigest`)
    assertExactly(names.length, 0, `${where}.supersededSegments`)
    assertAttestation(payload, where, { required: false })
    return
  }

  if (payload.epoch < 2) {
    throw new TypeError(`${where}.epoch: захват по основанию «${payload.basis}» начинается со второй эпохи`)
  }
  assertInteger(payload.fromEpoch, `${where}.fromEpoch`, 1)
  assertInteger(payload.fromSeq, `${where}.fromSeq`, 0)
  assertInteger(payload.fromSegmentBytes, `${where}.fromSegmentBytes`, 1)
  /* Отпечаток ТОЧНОГО префикса хвостового сегмента. Подписи записей его не
     покрывают: оборванная строка в файл входит, а в запись — нет, и без этого
     поля хвост переписывается равной длиной, не тронув ни одной подписи. */
  assertSha256Value(payload.fromSegmentRawDigest, `${where}.fromSegmentRawDigest`)
  if (payload.fromEpoch >= payload.epoch) {
    throw new TypeError(
      `${where}.fromEpoch ${payload.fromEpoch} обязан быть меньше epoch ${payload.epoch}`,
    )
  }
  /* Перечисление незавершённых сегментов не произвольно: между содержательной
     эпохой и новой не может остаться ни одного не названного файла, иначе
     захват прошёл бы мимо занятой эпохи. */
  const expected = []
  for (let epoch = payload.fromEpoch + 1; epoch < payload.epoch; epoch += 1) {
    expected.push(segmentName(payload.generation, epoch))
  }
  assertExactly(
    names.join(','), expected.join(','),
    `${where}.supersededSegments: перечень между fromEpoch и epoch`,
  )
  if (payload.basis === 'released') {
    assertExactly(
      payload.fromEpoch, payload.epoch - 1,
      `${where}.fromEpoch при basis «released»`,
    )
    assertAttestation(payload, where, { required: false })
    return
  }
  assertAttestation(payload, where, { required: true })
  /* Полномочие ПЕРЕСОБИРАЕТСЯ из полей записи вместе с `executionId` самой
     записи, и его отпечаток пересчитывается здесь же. Так полномочие,
     выданное для другого исполнения или для другого хвоста, не
     воспроизводит `takeoverDigest` и границу не проходит. */
  parseAndVerifyTakeover({
    contractVersion: MODEL_TAKEOVER_SPEC,
    executionId,
    fromEpoch: payload.fromEpoch,
    fromSeq: payload.fromSeq,
    fromRecordDigest: payload.fromRecordDigest,
    fromSegmentBytes: payload.fromSegmentBytes,
    fromSegmentRawDigest: payload.fromSegmentRawDigest,
    supersededSegments: payload.supersededSegments,
    grounds: payload.grounds,
    observedAt: payload.observedAt,
    decisionRef: payload.decisionRef,
    approver: payload.approver,
    takeoverDigest: payload.takeoverDigest,
  })
}

/** Форма добровольного освобождения эпохи. */
export function assertReleasedPayload(payload, where) {
  assertExactKeys(payload, RELEASED_PAYLOAD_KEYS, where)
  assertInteger(payload.epoch, `${where}.epoch`, 1)
  if (payload.epoch > MAX_EPOCH) throw new TypeError(`${where}.epoch: больше ${MAX_EPOCH}`)
  if (!RELEASE_REASONS.includes(payload.reason)) {
    throw new TypeError(
      `${where}.reason: ожидается одно из ${RELEASE_REASONS.join(', ')}, `
      + `получено ${JSON.stringify(payload.reason)}`,
    )
  }
}

export const RELEASED_BUILD_KEYS = Object.freeze(['epoch', 'reason'])

export function buildReleasedPayload(input) {
  assertStrictInput(input, RELEASED_BUILD_KEYS, 'released: параметры сборки')
  const payload = { epoch: input.epoch, reason: input.reason }
  assertReleasedPayload(payload, 'released.payload')
  return payload
}

/** Протоколы журнала: прежний формат и защищённый. */
export const JOURNAL_PROTOCOLS = Object.freeze(['preProtocol', 'g1'])

/** Право дозаписи. Список закрыт. */
export const APPENDABILITY_VALUES = Object.freeze(['open', 'owned', 'indeterminate', 'readOnly'])

/** Причины неопределённого владения. Список закрыт. */
export const INDETERMINATE_REASONS = Object.freeze([
  'ownershipIndeterminate', 'protocolInitializationIncomplete',
])

/**
 * Право дозаписи ПО ЗАПИСЯМ. Файловую часть (незавершённые сегменты,
 * расщепление) добавляет хранилище: она про файлы, а не про грамматику.
 */
export function appendabilityOfRecords(verified) {
  if (verified.some((record) => record.type === 'closed')) return 'readOnly'
  const last = verified[verified.length - 1]
  return last.type === 'released' ? 'open' : 'owned'
}

/** Текущая эпоха по записям. `null` — журнал прежнего формата. */
export function currentEpochOf(verified) {
  let epoch = null
  for (const record of verified) {
    if (record.type === 'claimed') epoch = record.payload.epoch
  }
  return epoch
}

function assertPayload(type, payload, where, executionId) {
  if (type === 'opened') return assertOpenedPayload(payload, where)
  if (type === 'claimed') return assertClaimedPayload(payload, where, executionId)
  if (type === 'released') return assertReleasedPayload(payload, where)
  if (type === 'dispatching') {
    assertExactKeys(payload, DISPATCHING_PAYLOAD_KEYS, where)
    assertRequestItemId(payload.requestItemId, `${where}.requestItemId`)
    assertSha256Value(payload.requestSpecDigest, `${where}.requestSpecDigest`)
    return undefined
  }
  if (type === 'reconciled') return assertReconciledPayload(payload, where, executionId)
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
  assertPayload(raw.type, raw.payload, `${raw.type}.payload`, raw.executionId)
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
export const JOURNAL_VERIFY_KEYS = Object.freeze(['records', 'executionId', 'protocol'])

export function parseAndVerifyJournal(input) {
  assertStrictOptions(input, { required: JOURNAL_VERIFY_KEYS }, `${MODEL_EXECUTION_SPEC}: параметры проверки журнала`)
  /* Протокол — параметр вызывающего, а не догадка по содержимому: выбирает
     его ИМЯ сегмента, и оно устанавливается атомарно при создании файла.
     Неизвестное значение — дефект вызывающего, поэтому проверяется до
     разбора и наружу уходит обычным TypeError, а не вердиктом о журнале. */
  if (!JOURNAL_PROTOCOLS.includes(input.protocol)) {
    throw new TypeError(
      `${MODEL_EXECUTION_SPEC}.protocol: ожидается одно из ${JOURNAL_PROTOCOLS.join(', ')}, `
      + `получено ${JSON.stringify(input.protocol)}`,
    )
  }
  try {
    return verifyJournalRecords(input)
  } catch (error) {
    /* Свой вердикт уходит типизированным; сбой самого проверяющего — как есть.
       Честная граница: `TypeError`, брошенный движком ВНУТРИ этой проверки,
       от вердикта формы неотличим и попадёт в контрактный канал. Всё, что
       случилось вне неё, теперь проходит наружу нетронутым. */
    if (error instanceof JournalContractError) throw error
    if (PROGRAMMATIC_ERROR_KINDS.some((kind) => error instanceof kind)) throw error
    if (typeof error?.syscall === 'string') throw error
    throw new JournalContractError(error.message, { cause: error })
  }
}

/** Классы, которые вердиктом о содержимом не бывают никогда. */
const PROGRAMMATIC_ERROR_KINDS = Object.freeze([
  ReferenceError, RangeError, SyntaxError, EvalError, URIError,
])

function verifyJournalRecords(input) {
  const { records, executionId: id, protocol } = input
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
  /* Подписанная инициализация защищённого журнала. Одной записи `opened`
     мало: имя файла говорит «g1», и содержимое обязано это подтвердить,
     иначе переименование сегмента меняло бы грамматику, не меняя ни одного
     отпечатка. Журнал ровно из одной записи — инициализация НЕ завершена;
     это законное читаемое состояние, а право дозаписи закрывает хранилище. */
  let generation = null
  if (protocol === 'g1' && verified.length > 1) {
    if (verified[1].type !== 'claimed') {
      throw new TypeError(
        `${MODEL_EXECUTION_SPEC}: запись 1 обязана быть claimed — сегмент g1 без подписанной инициализации`,
      )
    }
    generation = verified[1].payload.generation
  }
  /* Головной сегмент по контракту всегда первая эпоха: имя `e1` выбирается
     атомарно при создании и другим быть не может. */
  let epoch = protocol === 'g1' ? 1 : null
  let claimedSeen = false
  let releasedEpoch = false

  const planned = new Map(verified[0].payload.items.map((item) => [item.requestItemId, item]))
  const dispatched = new Map()
  const settled = new Set()
  const reconciledOf = new Map()
  let closed = false
  for (let i = 1; i < verified.length; i += 1) {
    const record = verified[i]
    const where = `запись ${i} (${record.type})`
    if (closed) throw new TypeError(`${where}: после closed записей быть не может`)
    if (record.type === 'opened') throw new TypeError(`${where}: второй opened невозможен`)
    if (record.type === 'claimed') {
      if (protocol !== 'g1') {
        throw new TypeError(`${where}: запись протокола в журнале прежнего формата`)
      }
      const payload = record.payload
      assertExactly(payload.generation, generation, `${where}: generation против первой эпохи`)
      const previous = verified[i - 1]
      /* Хвост, к которому привязан захват, всегда ровно предыдущая запись:
         иначе `claimed` описывал бы не то состояние, поверх которого он
         встал. */
      assertExactly(payload.fromSeq, i - 1, `${where}: fromSeq против хвоста`)
      assertExactly(
        payload.fromRecordDigest, previous.recordDigest.value,
        `${where}: fromRecordDigest против хвоста`,
      )
      if (payload.epoch === 1) {
        /* Подписанная инициализация первой эпохи стоит сразу за `opened` и
           нигде больше. */
        assertExactly(i, 1, `${where}: claimed первой эпохи стоит сразу за opened`)
        assertExactly(payload.basis, 'opened', `${where}: basis первой эпохи`)
      } else {
        /* Освобождение снимает нужду в полномочии только тогда, когда после
           него никто не успел зарезервировать эпоху. Незавершённый сегмент —
           тоже занятая эпоха, и перешагнуть через него можно лишь по явному
           утверждению владельца. */
        const freeHandoff = previous.type === 'released'
          && payload.supersededSegments.length === 0
        assertExactly(
          payload.basis, freeHandoff ? 'released' : 'takeover',
          `${where}: basis против предыдущей записи и незавершённых сегментов`,
        )
        assertExactly(payload.fromEpoch, epoch, `${where}: fromEpoch против текущей эпохи`)
        if (payload.epoch <= epoch) {
          throw new TypeError(`${where}: эпоха ${payload.epoch} не больше текущей ${epoch}`)
        }
        if (payload.basis === 'takeover') {
          /* Наблюдение владельца обязано лежать между последней записью
             прежнего владельца и самим захватом. Сделанное раньше, оно
             описывает не тот хвост; сделанное позже захвата — это будущее
             относительно журнала. */
          const tailMs = assertCanonicalInstant(previous.at, `${where}: хвост at`)
          const observedMs = assertCanonicalInstant(payload.observedAt, `${where}.observedAt`)
          const claimMs = assertCanonicalInstant(record.at, `${where}: at`)
          if (observedMs < tailMs) {
            throw new TypeError(
              `${where}: observedAt ${payload.observedAt} раньше последней записи ${previous.at} — `
              + 'наблюдение до неё этот хвост не описывает',
            )
          }
          if (observedMs > claimMs) {
            throw new TypeError(
              `${where}: observedAt ${payload.observedAt} позже самого захвата ${record.at}`,
            )
          }
        }
      }
      epoch = payload.epoch
      claimedSeen = true
      releasedEpoch = false
      continue
    }
    if (protocol === 'g1' && !claimedSeen) {
      throw new TypeError(`${where}: запись до подписанного захвата эпохи`)
    }
    if (releasedEpoch) {
      throw new TypeError(`${where}: эпоха освобождена — до нового claimed записей быть не может`)
    }
    if (record.type === 'released') {
      if (protocol !== 'g1') {
        throw new TypeError(`${where}: запись протокола в журнале прежнего формата`)
      }
      assertExactly(record.payload.epoch, epoch, `${where}: epoch против текущей эпохи`)
      releasedEpoch = true
      continue
    }
    if (record.type === 'closed') { closed = true; continue }
    const itemId = record.payload.requestItemId
    if (!planned.has(itemId)) {
      throw new TypeError(`${where}: элемент ${itemId} не объявлен в opened`)
    }
    if (record.type === 'dispatching') {
      /* Повторная отправка не открывается этой версией и после свидетельства:
         подписанное разрешение владельца несёт `maxRetries === 0`, и снятая
         неопределённость о списании права на новый платный запрос не выдаёт. */
      if (dispatched.has(itemId)) throw new TypeError(`${where}: повторный dispatching элемента ${itemId}`)
      dispatched.set(itemId, { requestSpecDigest: record.payload.requestSpecDigest, at: record.at })
      continue
    }
    if (record.type === 'reconciled') {
      if (!dispatched.has(itemId)) {
        throw new TypeError(
          `${where}: свидетельство без dispatching — о судьбе неотправленного запроса доказывать нечего`,
        )
      }
      if (settled.has(itemId)) {
        throw new TypeError(`${where}: элемент ${itemId} уже урегулирован, свидетельство ничего не решает`)
      }
      if (reconciledOf.has(itemId)) {
        throw new TypeError(`${where}: второе свидетельство элемента ${itemId}`)
      }
      assertExactly(
        record.payload.requestSpecDigest,
        dispatched.get(itemId).requestSpecDigest,
        `${where}: requestSpecDigest против dispatching`,
      )
      /* Наблюдение обязано лежать между отправкой и собственной записью.
         Сделанное до отправки, оно не говорит о её судьбе; сделанное после
         записи — это будущее относительно журнала. */
      const observedMs = assertCanonicalInstant(record.payload.observedAt, `${where}.observedAt`)
      const dispatchMs = assertCanonicalInstant(dispatched.get(itemId).at, `${where}: dispatching.at`)
      const recordMs = assertCanonicalInstant(record.at, `${where}: at`)
      if (observedMs < dispatchMs) {
        throw new TypeError(
          `${where}: observedAt ${record.payload.observedAt} раньше отправки ${dispatched.get(itemId).at} — `
          + 'наблюдение до отправки её судьбы не описывает',
        )
      }
      if (observedMs > recordMs) {
        throw new TypeError(
          `${where}: observedAt ${record.payload.observedAt} позже самой записи ${record.at}`,
        )
      }
      reconciledOf.set(itemId, record.payload.verdict)
      continue
    }
    if (!dispatched.has(itemId)) {
      throw new TypeError(`${where}: settled без dispatching — эффект без записанного намерения`)
    }
    if (settled.has(itemId)) throw new TypeError(`${where}: повторный settled элемента ${itemId}`)
    assertExactly(
      record.payload.requestSpecDigest,
      dispatched.get(itemId).requestSpecDigest,
      `${where}: requestSpecDigest против dispatching`,
    )
    /* Потеря — единственный исход, который не наблюдался исполнителем, а
       восстановлен позже. Без записанного свидетельства о списании превратить
       неопределённость в `lost` значило бы объявить деньги потраченными без
       основания. */
    if (record.payload.outcome === 'lost' && reconciledOf.get(itemId) !== 'charged') {
      throw new TypeError(
        `${where}: исход «lost» допускается только после свидетельства с вердиктом charged`,
      )
    }
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

/**
 * Закрытие журнала БЕЗ единой отправки — граница reconciliation.
 *
 * Отдельно от `buildClosedPayload` намеренно: тот закрывает начатый прогон и
 * прямо отказывается закрывать журнал, до отправки не дошедший. Доказательство
 * здесь — сам write-ahead журнал: намерение синхронизируется ДО эффекта,
 * поэтому отсутствие `dispatching` и есть доказательство отсутствия отправки.
 * Свидетельство владельца тут не требуется и не принимается.
 */
export const ABORTED_CLOSE_BUILD_KEYS = Object.freeze(['verified', 'at'])

export function buildAbortedClosedPayload(input) {
  assertStrictOptions(
    input, { required: ABORTED_CLOSE_BUILD_KEYS }, 'closed:abortedBeforeDispatch: параметры сборки',
  )
  const { verified, at } = input
  if (closableState(verified) !== 'aborted') {
    throw new TypeError(
      'closed:abortedBeforeDispatch: в журнале есть отправка либо он уже закрыт — '
      + 'этот путь закрывает только прогон, не дошедший до первого запроса',
    )
  }
  const counts = countBuckets(verified)
  return {
    deleteAfter: closedDeleteAfter({
      openedDeleteAfter: verified[0].payload.deleteAfter, closedAt: at,
    }),
    outcome: outcomeFromCounts(counts, {
      anyDispatchOrSettle: false, total: verified[0].payload.items.length,
    }),
    counts,
  }
}

/**
 * Можно ли закрыть журнал — производная величина, а не выбор вызывающего.
 *
 * `aborted` — ни одной отправки; `closable` — отправка была и не осталось
 * неопределённых; `open` — осталось; `closed` — уже закрыт.
 */
export function closableState(verified) {
  if (verified.some((record) => record.type === 'closed')) return 'closed'
  const anyDispatchOrSettle = verified.slice(1).some(
    (record) => record.type === 'dispatching' || record.type === 'settled',
  )
  if (!anyDispatchOrSettle) return 'aborted'
  const counts = countBuckets(verified)
  return counts.unknown === 0 && counts.notDispatched === 0 ? 'closable' : 'open'
}

/**
 * Состояние ОДНОГО элемента по журналу.
 *
 * Та же лестница, что и у корзин, только для одного идентификатора:
 * записанный исход сильнее отправки, отправка сильнее её отсутствия. Нужна
 * там, где агрегированных счётчиков мало — по ним нельзя сказать, что
 * потерян именно ЭТОТ элемент.
 */
export function itemOutcomeIn(verified, requestItemId) {
  let dispatched = false
  let outcome = null
  for (const record of verified.slice(1)) {
    if (record.payload?.requestItemId !== requestItemId) continue
    if (record.type === 'dispatching') dispatched = true
    if (record.type === 'settled') outcome = record.payload.outcome
  }
  if (outcome !== null) return outcome
  return dispatched ? 'unknown' : 'notDispatched'
}

/**
 * Элементы с записанным подтверждением отсутствия списания.
 *
 * Это ФАКТ, а не разрешение: право на новый платный запрос ограничено
 * approval (`maxRetries === 0`) и лимитами исполнения, и эта функция его не
 * выдаёт. Поэтому имя говорит о подтверждении, а не о возможности повтора.
 */
export function noChargeConfirmedIds(verified) {
  return Object.freeze(verified
    .filter((record) => record.type === 'reconciled' && record.payload.verdict === 'noCharge')
    .map((record) => record.payload.requestItemId)
    .sort())
}

/**
 * Исход закрытия ИЗ КОРЗИН — единственный вывод на весь проект.
 *
 * Отправка считается начатой, если не все элементы остались неотправленными:
 * это то же условие, что и `anyDispatchOrSettle` у журнала, выраженное через
 * сами корзины. Второй реализации правила приоритетов нет ни здесь, ни у
 * границы итога сверки — обе зовут эту.
 */
export function closedOutcomeFromCounts(counts, total) {
  return outcomeFromCounts(counts, {
    anyDispatchOrSettle: counts.notDispatched !== total, total,
  })
}

/** Код возврата по исходу закрытия. Таблица одна. */
export function outcomeExitCode(outcome) {
  if (!Object.hasOwn(OUTCOME_EXIT, outcome)) {
    throw new TypeError(`неизвестный исход закрытия ${JSON.stringify(outcome)}`)
  }
  return OUTCOME_EXIT[outcome]
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
