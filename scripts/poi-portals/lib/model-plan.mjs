/**
 * План модельной классификации: что БЫЛО БЫ отправлено, если бы владелец
 * разрешил отправку. Ничего не отправляет и отправить не может.
 *
 * Чистый модуль. Не читает файловую систему, не ходит в сеть, не разбирает
 * JSON реестров и не импортирует граф таксономии: всё, что приходит извне —
 * байты, тексты и объекты — передаёт оркестратор (`collect-pois.mjs`).
 * Единственная внешняя зависимость — общий хешер байтов.
 *
 * Что здесь НЕ решается: выбор провайдера, право на передачу данных,
 * стоимость запроса. Провайдера нет (`PROVIDER_PROFILES` пуст), право у всех
 * источников отсутствует, стоимость поэтому `null`.
 */
import { DIGEST_ALGORITHM, RAW_FILE_BYTES_SPEC, sha256Bytes } from '../../lib/byte-digest.mjs'

/* ── Версии контрактов ────────────────────────────────────────────────────
   Каждая версия входит В ХЕШИРУЕМЫЕ БАЙТЫ своего домена, а не только в
   подпись рядом со значением. Подпись читает человек; байты читает digest.
   Смена версии обязана менять все значения домена — иначе «сравнили планы»
   означало бы «сравнили планы, посчитанные разными правилами». */
export const MODEL_PLAN_CONTRACT_VERSION = 'poi-model-plan/v1'
export const CLASSIFICATION_ITEM_SPEC = 'poi-classification-item/v1'
export const MODEL_INPUT_SPEC = 'poi-model-input/v1'
export const SOURCE_POLICY_SPEC = 'poi-source-policy/v1'
export const MODEL_PROMPT_SPEC = 'poi-model-prompt/v1'
export const MODEL_SCHEMA_SPEC = 'poi-model-schema/v1'
export const TOKEN_ESTIMATE_SPEC = 'poi-token-estimate/v1'

/**
 * Содержательная часть задачи классификации, версия 1.
 *
 * Выведена из самой задачи, а НЕ из текущего правила и не из прогноза
 * стоимости. Правило (`classifyByRules`) читает только `nameJa` и
 * `nameKana`; очередь `awaitingClassification` — ровно те кандидаты, где
 * этих двух полей не хватило. Значит первые два нужны как контекст, а
 * единственный оставшийся текст с типологическим сигналом — `descriptionJa`.
 *
 * `address` не входит: в конвейере он несёт географический сигнал
 * (`geo_unresolvable`), доказательств пользы для классификации нет, и его
 * включение расширило бы отправляемое без основания. Решение владельца
 * от 13.08.2026.
 */
export const MODEL_INPUT_FIELDS = Object.freeze(['nameJa', 'nameKana', 'descriptionJa'])

/**
 * Канонические профили провайдеров.
 *
 * Пуст намеренно и это не заглушка: добавление первого кода — и есть тот
 * коммит, которым владелец фиксирует выбор провайдера. Пока список пуст,
 * любая непустая `allowedProviders` отвергается проверкой формы, и
 * разрешить передачу нельзя даже по невнимательности.
 *
 * Замороженный массив, а не Map: у Map есть set/delete/clear, которые
 * Object.freeze не закрывает.
 */
export const PROVIDER_PROFILES = Object.freeze([])

/** Точный набор ключей `modelProcessing`. Ни больше, ни меньше. */
export const POLICY_KEYS = Object.freeze([
  'purpose', 'allowedProviders', 'fields', 'decisionRef', 'reviewedAt', 'validUntil',
])

/** Единственное допустимое назначение в этой версии контракта. */
export const POLICY_PURPOSE = 'classification'

/* ── Закрытая грамматика причин policy ────────────────────────────────────
   Один источник на производителя (`evaluatePolicy`) и потребителя
   (`parseAndVerifyModelPlan`). Список, который парсер согласен прочитать,
   обязан быть тем же, который умеет породить оценка политики: иначе
   «причина неизвестна» и «причины нет» стали бы неразличимы. */

export const POLICY_STATE_ALLOWED = 'allowed'
export const POLICY_STATE_DENIED = 'denied'

export const POLICY_REASON_NO_PROVIDERS = 'noAllowedProviders'
export const POLICY_REASON_NO_DECISION_REF = 'noDecisionRef'
export const POLICY_REASON_NO_REVIEWED_AT = 'noReviewedAt'
export const POLICY_REASON_NO_VALID_UNTIL = 'noValidUntil'
export const POLICY_REASON_EXPIRED = 'expired'

/** Причины без параметра. Причина с полем — только с этим префиксом. */
export const POLICY_SIMPLE_REASONS = Object.freeze([
  POLICY_REASON_NO_PROVIDERS,
  POLICY_REASON_NO_DECISION_REF,
  POLICY_REASON_NO_REVIEWED_AT,
  POLICY_REASON_NO_VALID_UNTIL,
  POLICY_REASON_EXPIRED,
])
export const POLICY_MISSING_FIELD_PREFIX = 'missingAllowedFields:'

/**
 * Причина, по которой в этой версии стоимость не считается вовсе.
 *
 * Одна константа на builder и парсер: второй литерал разошёлся бы с первым
 * молча, а расхождение читалось бы как «стоимость не посчитана по другой
 * причине» — то есть как факт, которого не было.
 */
export const COST_REASON_NO_PROVIDER = 'провайдер не выбран: PROVIDER_PROFILES пуст'

/**
 * Терминальный исход, по которому отбирается очередь.
 *
 * Значение продублировано здесь намеренно, чтобы модуль не тянул за собой
 * граф таксономии (тот загружает реестр с диска на этапе импорта, а этот
 * модуль обязан оставаться чистым). Дублирование не молчаливое: оркестратор
 * сверяет эту константу с `TERMINAL.AWAITING` на каждом прогоне, и
 * расхождение останавливает режим.
 */
export const AWAITING_TERMINAL = 'awaitingClassification'

/* ── Канонический JSON ────────────────────────────────────────────────────
   Не `JSON.stringify`: тот молча выкидывает ключи со значением undefined,
   сериализует Date и Map как «что-то», зависит от порядка вставки ключей и
   не отвергает ничего. Здесь всё перечисленное — отказ. */

const OBJECT_PROTO = Object.getPrototypeOf({})

/**
 * Строгий контракт собственных ключей.
 *
 * `Object.keys` видит только перечисляемые строковые свойства. Символьные,
 * неперечисляемые и accessor-свойства он пропускает молча — они остаются в
 * объекте, но в подпись не попадают. Тогда два разных объекта дают один
 * digest, и подпись перестаёт отвечать на вопрос, ради которого считается.
 * Поэтому не «пропускаем», а отказываемся.
 */
function assertStrictOwnKeys(value, where) {
  if (Object.getOwnPropertySymbols(value).length) {
    throw new TypeError(`${where}: символьные ключи не сериализуются`)
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor.get || descriptor.set) {
      throw new TypeError(`${where}.${key}: accessor-свойство не сериализуется`)
    }
    if (!descriptor.enumerable) {
      throw new TypeError(`${where}.${key}: неперечисляемое собственное свойство не сериализуется`)
    }
  }
}

/**
 * Строгий контракт массива: без дыр и без посторонних ключей.
 *
 * `new Array(1)` имеет длину 1 и не имеет элемента 0. `JSON.stringify`
 * подставил бы туда `null`, превратив «элемента нет» в «элемент есть и он
 * null» — разные входы, одинаковые байты.
 */
function assertStrictArray(value, where) {
  if (Object.getOwnPropertySymbols(value).length) {
    throw new TypeError(`${where}: символьные ключи не сериализуются`)
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === 'length') continue
    /* Канонический ключ индекса и только он: String(index) === key.
       Number('00') равно нулю, Number('1e0') — единице, Number('-0') — нулю;
       все три прошли бы проверку «целое в диапазоне» и дали бы два разных
       объекта с одинаковой подписью. */
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      throw new TypeError(`${where}.${key}: неканонический или посторонний ключ массива не сериализуется`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor.get || descriptor.set) throw new TypeError(`${where}[${index}]: accessor-элемент не сериализуется`)
    if (!descriptor.enumerable) throw new TypeError(`${where}[${index}]: неперечисляемый элемент не сериализуется`)
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`${where}[${index}]: разрежённый массив — дыра неотличима от null`)
    }
  }
}

function assertNoLoneSurrogate(value, where) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${where}: одиночный старший суррогат в позиции ${i}`)
      }
      i += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${where}: одиночный младший суррогат в позиции ${i}`)
    }
  }
}

function encodeString(value, where) {
  /* Одиночный суррогат при кодировании в UTF-8 превращается в U+FFFD.
     Два разных входа дали бы одинаковые байты и одинаковый digest — ровно
     то свойство, ради которого digest и считается. Поэтому отказ, а не
     замена. */
  assertNoLoneSurrogate(value, where)
  let out = '"'
  for (const ch of value) {
    const code = ch.codePointAt(0)
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return `${out}"`
}

function encodeValue(value, seen, where) {
  if (value === null) return 'null'
  const type = typeof value
  if (type === 'boolean') return value ? 'true' : 'false'
  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${where}: не конечное число ${String(value)}`)
    }
    /* -0 — отказ, а не нормализация. Прежний код подменял его на 0, хотя
       комментарий рядом утверждал обратное: два разных runtime-входа
       давали одни байты и одну подпись — ровно то свойство, ради которого
       digest и считается. Та же причина, что у одиночного суррогата. */
    if (Object.is(value, -0)) {
      throw new TypeError(`${where}: -0 не сериализуется — в JSON отрицательного нуля нет`)
    }
    return String(value)
  }
  if (type === 'string') return encodeString(value, where)
  if (type === 'undefined' || type === 'function' || type === 'symbol' || type === 'bigint') {
    throw new TypeError(`${where}: значение типа ${type} не сериализуется`)
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`${where}: циклическая ссылка`)
    assertStrictArray(value, where)
    seen.add(value)
    const out = `[${value.map((item, i) => encodeValue(item, seen, `${where}[${i}]`)).join(',')}]`
    seen.delete(value)
    return out
  }
  if (type === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== OBJECT_PROTO && proto !== null) {
      // Date, Map, Set и классы дали бы `{}` — пустой объект вместо данных.
      throw new TypeError(`${where}: только простые объекты; получен ${value.constructor?.name ?? 'объект с прототипом'}`)
    }
    assertStrictOwnKeys(value, where)
    if (seen.has(value)) throw new TypeError(`${where}: циклическая ссылка`)
    seen.add(value)
    const keys = Object.keys(value).sort()
    const out = `{${keys
      .map((key) => `${encodeString(key, `${where}.${key}`)}:${encodeValue(value[key], seen, `${where}.${key}`)}`)
      .join(',')}}`
    seen.delete(value)
    return out
  }
  throw new TypeError(`${where}: неподдерживаемое значение`)
}

/**
 * Канонические байты домена: `<домен>\n<канонический JSON>` в UTF-8.
 *
 * Ключи объектов сортируются рекурсивно по кодовым единицам UTF-16, порядок
 * массивов сохраняется, пробелов нет.
 */
export function canonicalJsonBytes(value, domain) {
  if (typeof domain !== 'string' || !domain) {
    throw new TypeError('canonicalJsonBytes: домен обязателен')
  }
  return Buffer.from(`${domain}\n${encodeValue(value, new Set(), domain)}`, 'utf8')
}

/* ── Classification item ──────────────────────────────────────────────── */

/**
 * Содержательная часть задачи по одному кандидату, provider-neutral.
 *
 * Единственный источник тела: digest, проверка `policy.fields`, счёт байтов
 * и будущий исполнитель обязаны брать результат отсюда и не собирать тело
 * самостоятельно.
 *
 * Три состояния поля наблюдаемы как данные, а не как отсутствие данных:
 * `A` — ключа у кандидата нет, `N` — значение `null`, `S` — строка. Пустая
 * строка это `S` длины 0 и от `N` отличается. Запись присутствует для
 * каждого поля контракта всегда, поэтому форма переживает JSON и читается
 * тестом.
 */
export function buildClassificationItem(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError(`${CLASSIFICATION_ITEM_SPEC}: кандидат должен быть объектом`)
  }
  const entries = MODEL_INPUT_FIELDS.map((field) => {
    if (!Object.hasOwn(candidate, field)) return { field, state: 'A', value: null }
    const raw = candidate[field]
    if (raw === null) return { field, state: 'N', value: null }
    if (typeof raw === 'string') return { field, state: 'S', value: raw }
    if (raw === undefined) {
      throw new TypeError(
        `${CLASSIFICATION_ITEM_SPEC}: поле «${field}» присутствует со значением undefined — `
        + 'неотличимо от отсутствия. Уберите ключ или поставьте null.',
      )
    }
    throw new TypeError(
      `${CLASSIFICATION_ITEM_SPEC}: поле «${field}» имеет тип ${typeof raw}; допустимы строка и null`,
    )
  })
  return Object.freeze({
    version: CLASSIFICATION_ITEM_SPEC,
    fields: MODEL_INPUT_FIELDS,
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
  })
}

const UNIT_SEPARATOR = 0x1f
const RECORD_SEPARATOR = 0x1e

/**
 * Канонические байты `poi-model-input/v1`.
 *
 * Порядок полей задаёт контракт, а не порядок свойств объекта. Длина
 * значения в байтах идёт перед самим значением: без неё значение,
 * содержащее разделитель, подделало бы границу записи.
 */
export function canonicalItemBytes(item) {
  assertItemShape(item)
  const chunks = [Buffer.from(`${MODEL_INPUT_SPEC}\n`, 'utf8')]
  for (const entry of item.entries) {
    const payload = entry.state === 'S' ? Buffer.from(entry.value, 'utf8') : Buffer.alloc(0)
    if (entry.state === 'S') assertNoLoneSurrogate(entry.value, `${MODEL_INPUT_SPEC}.${entry.field}`)
    chunks.push(
      Buffer.from(entry.field, 'utf8'),
      Buffer.from([UNIT_SEPARATOR]),
      Buffer.from(entry.state, 'utf8'),
      Buffer.from([UNIT_SEPARATOR]),
      Buffer.from(String(payload.length), 'utf8'),
      Buffer.from([UNIT_SEPARATOR]),
      payload,
      Buffer.from([RECORD_SEPARATOR]),
    )
  }
  return Buffer.concat(chunks)
}

function assertItemShape(item) {
  if (!item || item.version !== CLASSIFICATION_ITEM_SPEC) {
    throw new TypeError(`${MODEL_INPUT_SPEC}: ожидается item версии ${CLASSIFICATION_ITEM_SPEC}`)
  }
  if (!Array.isArray(item.fields) || item.fields.length !== MODEL_INPUT_FIELDS.length
    || item.fields.some((field, i) => field !== MODEL_INPUT_FIELDS[i])) {
    throw new TypeError(
      `${MODEL_INPUT_SPEC}: item.fields обязан совпадать с контрактом по составу и порядку: `
      + `${MODEL_INPUT_FIELDS.join(', ')}`,
    )
  }
  if (!Array.isArray(item.entries) || item.entries.length !== MODEL_INPUT_FIELDS.length) {
    throw new TypeError(`${MODEL_INPUT_SPEC}: записей должно быть ${MODEL_INPUT_FIELDS.length}`)
  }
  item.entries.forEach((entry, i) => {
    if (entry.field !== MODEL_INPUT_FIELDS[i]) {
      throw new TypeError(`${MODEL_INPUT_SPEC}: порядок записей не совпадает с контрактом`)
    }
    if (!['A', 'N', 'S'].includes(entry.state)) {
      throw new TypeError(`${MODEL_INPUT_SPEC}: неизвестное состояние «${entry.state}»`)
    }
    const isString = typeof entry.value === 'string'
    if ((entry.state === 'S') !== isString) {
      throw new TypeError(`${MODEL_INPUT_SPEC}: состояние «${entry.state}» не соответствует значению`)
    }
  })
}

/** Digest содержательной части одного кандидата. */
export function candidateInputDigest(item) {
  return sha256Bytes(canonicalItemBytes(item))
}

/** Точное число UTF-8-байтов КАНОНИЧЕСКОГО ПРЕДСТАВЛЕНИЯ item — и ничего больше. */
export function classificationItemBytes(item) {
  return canonicalItemBytes(item).length
}

/**
 * Приблизительная оценка токенов, `poi-token-estimate/v1`.
 *
 * Заморожена с эвристики `enrich.mjs#estimateTokens`, ветка «ja»:
 * `ceil(length * 1.05)`. Считает кодовые ЕДИНИЦЫ UTF-16, поэтому символы
 * вне BMP учитываются как два. Это приблизительная величина по определению,
 * и она помечена `approximate: true` везде, где появляется.
 */
export function estimateItemTokens(item) {
  assertItemShape(item)
  let total = 0
  for (const entry of item.entries) {
    if (entry.state === 'S') total += Math.ceil(entry.value.length * 1.05)
  }
  return total
}

/* ── Тождество множеств ──────────────────────────────────────────────── */

/**
 * Не «сравнение множеств»: множества скрыли бы повтор.
 * Проверяются четыре вещи по отдельности — уникальность слева, уникальность
 * справа, равенство длин, поэлементное равенство отсортированных копий.
 * Контрпример: [A,B] против [A,A,B] обязан упасть.
 */
export function assertIdentity(left, right, label) {
  const duplicates = (list) => {
    const seen = new Set()
    const found = []
    for (const value of list) {
      if (seen.has(value)) found.push(value)
      seen.add(value)
    }
    return [...new Set(found)]
  }
  const leftDupes = duplicates(left)
  if (leftDupes.length) {
    throw new Error(`${label}: повторы в выбранном множестве: ${leftDupes.join(', ')}`)
  }
  const rightDupes = duplicates(right)
  if (rightDupes.length) {
    throw new Error(`${label}: повторы в спланированном множестве: ${rightDupes.join(', ')}`)
  }
  if (left.length !== right.length) {
    throw new Error(`${label}: выбрано ${left.length}, спланировано ${right.length}`)
  }
  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  for (let i = 0; i < leftSorted.length; i += 1) {
    if (leftSorted[i] !== rightSorted[i]) {
      throw new Error(`${label}: множества расходятся на «${leftSorted[i]}» против «${rightSorted[i]}»`)
    }
  }
}

/* ── Policy: форма (P0) и содержание (P1) ────────────────────────────── */

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === OBJECT_PROTO || proto === null
}

function isStrictCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function assertStringArray(value, key, allowed, sourceId) {
  if (!Array.isArray(value)) {
    throw new Error(`${sourceId}: modelProcessing.${key} должен быть массивом строк`)
  }
  /* Строгая форма массива проверяется ДО чтения элементов: `some` и `filter`
     дыры пропускают, и `new Array(1)` прошёл бы как пустой список. */
  assertStrictArray(value, `${sourceId}: modelProcessing.${key}`)
  if (value.some((item) => typeof item !== 'string')) {
    throw new Error(`${sourceId}: modelProcessing.${key} должен быть массивом строк`)
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`${sourceId}: modelProcessing.${key} содержит повторы`)
  }
  const unknown = value.filter((item) => !allowed.includes(item))
  if (unknown.length) {
    throw new Error(
      `${sourceId}: modelProcessing.${key} содержит необъявленные значения ${unknown
        .map((item) => `«${item}»`)
        .join(', ')}. Допустимы: ${allowed.length ? allowed.join(', ') : '(список пуст)'}`,
    )
  }
}

/**
 * ФОРМА policy. Нарушение формы — ошибка реестра и отказ прогона.
 * Истёкший `validUntil` формой не нарушается: это валидная запрещающая
 * policy, и оценивается она в P1.
 */
export function assertPolicyShape(source) {
  const sourceId = source?.id ?? '(источник без id)'
  const policy = source?.modelProcessing
  if (!isPlainObject(policy)) {
    throw new Error(
      `${sourceId}: нет modelProcessing или это не простой объект. `
      + 'Отсутствие разрешения обязано быть записано явно, а не подразумеваться.',
    )
  }
  /* Тот же строгий контракт, что у канонизации: policy с символьным,
     неперечисляемым или accessor-полем обязана падать, а не проходить
     мимо проверки состава ключей. */
  assertStrictOwnKeys(policy, `${sourceId}: modelProcessing`)
  const keys = Object.keys(policy).sort()
  const expected = [...POLICY_KEYS].sort()
  const missing = expected.filter((key) => !keys.includes(key))
  const extra = keys.filter((key) => !expected.includes(key))
  if (missing.length) throw new Error(`${sourceId}: в modelProcessing нет полей ${missing.join(', ')}`)
  if (extra.length) throw new Error(`${sourceId}: в modelProcessing лишние поля ${extra.join(', ')}`)

  if (policy.purpose !== POLICY_PURPOSE) {
    throw new Error(`${sourceId}: modelProcessing.purpose обязан быть «${POLICY_PURPOSE}»`)
  }
  assertStringArray(policy.fields, 'fields', MODEL_INPUT_FIELDS, sourceId)
  assertStringArray(policy.allowedProviders, 'allowedProviders', PROVIDER_PROFILES, sourceId)

  if (!(policy.decisionRef === null || (typeof policy.decisionRef === 'string' && policy.decisionRef.length))) {
    throw new Error(`${sourceId}: modelProcessing.decisionRef — null либо непустая строка`)
  }
  for (const key of ['reviewedAt', 'validUntil']) {
    const value = policy[key]
    if (!(value === null || isStrictCalendarDate(value))) {
      throw new Error(`${sourceId}: modelProcessing.${key} — null либо существующая дата YYYY-MM-DD`)
    }
  }
}

/** Смещение Asia/Tokyo. Летнего времени Япония не применяет, база IANA не нужна. */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** Момент, в который срок истекает: начало следующих суток по Asia/Tokyo. */
export function policyExpiryMs(validUntil) {
  const [year, month, day] = validUntil.split('-').map(Number)
  return Date.UTC(year, month - 1, day + 1) - JST_OFFSET_MS
}

/**
 * СОДЕРЖАНИЕ policy. Запрет — ожидаемый диагностический результат, а не
 * ошибка: план считается локально и без него.
 */
export function evaluatePolicy(policy, { now, requiredFields } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('evaluatePolicy: now обязателен и должен быть корректной датой')
  }
  if (!Array.isArray(requiredFields)) {
    throw new TypeError('evaluatePolicy: requiredFields обязателен — без него «разрешено» не с чем сравнивать')
  }
  const reasons = []
  if (!policy.allowedProviders.length) reasons.push(POLICY_REASON_NO_PROVIDERS)
  /* Каждое спланированное поле называется поимённо. «Полей не разрешено»
     одной строкой не говорит, какого именно разрешения не хватает, и после
     частичного гранта осталось бы верным, ничего не объясняя. */
  for (const field of requiredFields) {
    if (!policy.fields.includes(field)) reasons.push(`${POLICY_MISSING_FIELD_PREFIX}${field}`)
  }
  if (policy.decisionRef === null) reasons.push(POLICY_REASON_NO_DECISION_REF)
  if (policy.reviewedAt === null) reasons.push(POLICY_REASON_NO_REVIEWED_AT)
  if (policy.validUntil === null) reasons.push(POLICY_REASON_NO_VALID_UNTIL)
  else if (now.getTime() >= policyExpiryMs(policy.validUntil)) reasons.push(POLICY_REASON_EXPIRED)
  reasons.sort()
  /* Тот же валидатор, которым проверяется чужой артефакт. Здесь он ловит
     расхождение производителя с собственной грамматикой — например новую
     причину, добавленную мимо списка. */
  assertPolicyReasonGrammar(reasons, 'evaluatePolicy', requiredFields)
  return { state: reasons.length ? POLICY_STATE_DENIED : POLICY_STATE_ALLOWED, reasons }
}

/* ── Сборка плана ────────────────────────────────────────────────────── */

/**
 * Идентичность кода проверяется ДО подписи.
 *
 * Полный hex-hash, а не сокращённый: сокращённый неоднозначен, и подпись,
 * которую нельзя разрешить в один коммит, подписью не является. Сорок
 * знаков — SHA-1, шестьдесят четыре — репозиторий на SHA-256.
 */
export const CODE_IDENTITY_KEYS = Object.freeze(['commit', 'dirty'])

export function assertCodeIdentity(codeIdentity) {
  if (!isPlainObject(codeIdentity)) {
    throw new TypeError('codeIdentity обязан быть простым объектом')
  }
  assertStrictOwnKeys(codeIdentity, 'codeIdentity')
  const keys = Object.keys(codeIdentity).sort()
  const expected = [...CODE_IDENTITY_KEYS].sort()
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) {
    throw new TypeError(
      `codeIdentity обязан содержать ровно ${expected.join(' и ')}; получено ${keys.join(', ') || '(пусто)'}`,
    )
  }
  const commit = codeIdentity?.commit
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(commit)) {
    throw new TypeError(
      `codeIdentity.commit обязан быть полным hex-hash'ем Git (40 или 64 знака), получено ${JSON.stringify(commit)}`,
    )
  }
  if (typeof codeIdentity.dirty !== 'boolean') {
    throw new TypeError(`codeIdentity.dirty обязан быть boolean, получено ${typeof codeIdentity.dirty}`)
  }
}

function digest(value, algorithm, spec) {
  return { value, algorithm, spec }
}

/**
 * Фрагмент плана по одному порталу.
 *
 * Отбирает ровно `awaitingClassification`. Порядок items — по `sourceKey`,
 * поэтому порядок, в котором адаптер вернул строки, на результат не влияет.
 */
export function buildPortalPlanFragment({ portal, evaluated, now }) {
  const policy = portal.modelProcessing
  const verdict = evaluatePolicy(policy, { now, requiredFields: MODEL_INPUT_FIELDS })

  const keys = evaluated.map((entry) => entry.candidate?.sourceKey)
  keys.forEach((key, i) => {
    if (typeof key !== 'string' || !key.length) {
      throw new Error(`${portal.id}: у кандидата ${i} нет sourceKey — план строить не на чем`)
    }
  })
  const duplicated = keys.filter((key, i) => keys.indexOf(key) !== i)
  if (duplicated.length) {
    throw new Error(`${portal.id}: sourceKey повторяется: ${[...new Set(duplicated)].join(', ')}`)
  }

  const selected = evaluated
    .filter((entry) => entry.verdict?.terminal === AWAITING_TERMINAL)
    .map((entry) => entry.candidate)
  const selectedKeys = selected.map((candidate) => candidate.sourceKey)

  const items = selected
    .map((candidate) => {
      const item = buildClassificationItem(candidate)
      return {
        sourceKey: candidate.sourceKey,
        candidateInputDigest: digest(candidateInputDigest(item), DIGEST_ALGORITHM, MODEL_INPUT_SPEC),
        classificationItemBytes: classificationItemBytes(item),
        tokenEstimate: { value: estimateItemTokens(item), spec: TOKEN_ESTIMATE_SPEC, approximate: true },
      }
    })
    .sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0))

  assertIdentity(selectedKeys, items.map((item) => item.sourceKey), `${portal.id}: sourceKey`)

  return {
    portalId: portal.id,
    policyDigest: digest(
      sha256Bytes(canonicalJsonBytes(policy, SOURCE_POLICY_SPEC)),
      DIGEST_ALGORITHM,
      SOURCE_POLICY_SPEC,
    ),
    policyState: verdict.state,
    policyReasons: verdict.reasons,
    blockedByPolicy: verdict.state !== 'allowed',
    executionPermitted: false,
    plannedFieldNames: [...MODEL_INPUT_FIELDS],
    policyAllowedFieldNames: [...policy.fields].sort(),
    plannedItemCount: items.length,
    networkRequestCount: null,
    batchJobCount: null,
    billableTokens: null,
    estimatedCostUpperBound: null,
    costReason: COST_REASON_NO_PROVIDER,
    classificationItemBytesTotal: items.reduce((sum, item) => sum + item.classificationItemBytes, 0),
    tokenEstimate: {
      value: items.reduce((sum, item) => sum + item.tokenEstimate.value, 0),
      spec: TOKEN_ESTIMATE_SPEC,
      approximate: true,
    },
    items,
  }
}

/**
 * Детерминированная часть плана — то, что подписывается `planDigest`.
 * `planId`, `createdAt` и `deleteAfter` сюда не входят: два прогона одного
 * и того же набора обязаны давать один digest.
 */
function deterministicPart(plan) {
  return {
    contractVersion: plan.contractVersion,
    codeIdentity: plan.codeIdentity,
    taxonomyVersion: plan.taxonomyVersion,
    taxonomyDigest: plan.taxonomyDigest,
    promptDigest: plan.promptDigest,
    schemaDigest: plan.schemaDigest,
    promptBytes: plan.promptBytes,
    schemaBytes: plan.schemaBytes,
    providerProfile: plan.providerProfile,
    executionPermitted: plan.executionPermitted,
    portals: plan.portals,
  }
}

/**
 * Полный план. Порталы сортируются по `portalId`; один и тот же набор
 * обязан давать один и тот же `planDigest`.
 */
export function buildModelPlan({ fragments, selectedPortalIds, meta }) {
  assertCodeIdentity(meta.codeIdentity)
  const sorted = [...fragments].sort((a, b) => (a.portalId < b.portalId ? -1 : a.portalId > b.portalId ? 1 : 0))
  assertIdentity(selectedPortalIds, sorted.map((fragment) => fragment.portalId), 'portalId')
  const promptBytes = Buffer.from(`${MODEL_PROMPT_SPEC}\n${meta.promptText}`, 'utf8')
  const schemaBytes = canonicalJsonBytes(meta.schemaObject, MODEL_SCHEMA_SPEC)

  const plan = {
    contractVersion: MODEL_PLAN_CONTRACT_VERSION,
    planId: meta.planId,
    createdAt: meta.createdAt,
    deleteAfter: meta.deleteAfter,
    codeIdentity: meta.codeIdentity,
    taxonomyVersion: meta.taxonomyVersion,
    taxonomyDigest: digest(sha256Bytes(meta.taxonomyBytes), DIGEST_ALGORITHM, meta.taxonomySpec),
    promptDigest: digest(sha256Bytes(promptBytes), DIGEST_ALGORITHM, MODEL_PROMPT_SPEC),
    /* Точное число байтов ровно того потока, который и хешируется:
       «<домен>\n<текст промпта>» в UTF-8. Не длина строки и не размер файла. */
    promptBytes: promptBytes.length,
    schemaDigest: digest(sha256Bytes(schemaBytes), DIGEST_ALGORITHM, MODEL_SCHEMA_SPEC),
    /* То же для схемы: длина канонического JSON с доменом впереди. */
    schemaBytes: schemaBytes.length,
    providerProfile: null,
    executionPermitted: false,
    portals: sorted,
  }
  plan.planDigest = digest(
    sha256Bytes(canonicalJsonBytes(deterministicPart(plan), MODEL_PLAN_CONTRACT_VERSION)),
    DIGEST_ALGORITHM,
    MODEL_PLAN_CONTRACT_VERSION,
  )
  /* Собственный результат проверяется той же границей, что и чужой файл.
     Обхода нет и параметра «не проверять» нет: иначе builder и исполнитель
     разошлись бы молча, а расхождение обнаружилось бы уже на оплаченном
     прогоне. Побочное следствие намеренное — результат глубоко заморожен. */
  return parseAndVerifyModelPlan(plan).plan
}

/* ── Каноническая граница проверки плана ─────────────────────────────────
   Одна реализация на двоих: её вызывает собственный builder сразу после
   подписи и будет вызывать исполнитель, читающий чужой файл. Второй
   `deterministicPart` и второй список ключей в другом модуле означали бы,
   что «проверено» и «построено» — про разные контракты. */

/**
 * Полный отпечаток артефакта плана.
 *
 * Отдельный домен, а не расширение `poi-model-plan/v1`. Подпись плана
 * намеренно НЕ покрывает `planId`, `createdAt` и `deleteAfter`: два прогона
 * одного набора обязаны давать один `planDigest`. Разрешение владельца,
 * наоборот, выдаётся на конкретный файл с конкретным сроком, и ему нужен
 * отпечаток всего артефакта целиком.
 *
 * Внутрь плана этот digest не кладётся: самоссылки нет, форма
 * `poi-model-plan/v1` не меняется.
 */
export const MODEL_PLAN_ARTIFACT_SPEC = 'poi-model-plan-artifact/v1'

/** Точный состав верхнего уровня плана. Единственный список в проекте. */
export const PLAN_KEYS = Object.freeze([
  'contractVersion', 'planId', 'createdAt', 'deleteAfter', 'codeIdentity',
  'taxonomyVersion', 'taxonomyDigest', 'promptDigest', 'promptBytes',
  'schemaDigest', 'schemaBytes', 'providerProfile', 'executionPermitted',
  'portals', 'planDigest',
])

/** Точный состав фрагмента одного портала. */
export const PORTAL_FRAGMENT_KEYS = Object.freeze([
  'portalId', 'policyDigest', 'policyState', 'policyReasons', 'blockedByPolicy',
  'executionPermitted', 'plannedFieldNames', 'policyAllowedFieldNames',
  'plannedItemCount', 'networkRequestCount', 'batchJobCount', 'billableTokens',
  'estimatedCostUpperBound', 'costReason', 'classificationItemBytesTotal',
  'tokenEstimate', 'items',
])

/** Точный состав записи одного кандидата. */
export const PLAN_ITEM_KEYS = Object.freeze([
  'sourceKey', 'candidateInputDigest', 'classificationItemBytes', 'tokenEstimate',
])

/** Точный состав digest и оценки токенов. */
export const DIGEST_KEYS = Object.freeze(['value', 'algorithm', 'spec'])
export const TOKEN_ESTIMATE_KEYS = Object.freeze(['value', 'spec', 'approximate'])

/** Величины, которые в этой версии контракта не вычисляются вовсе. */
const UNPRICED_KEYS = Object.freeze([
  'networkRequestCount', 'batchJobCount', 'billableTokens', 'estimatedCostUpperBound',
])

const SHA256_VALUE = /^sha256:[0-9a-f]{64}$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function assertExactKeys(value, expected, where) {
  if (!isPlainObject(value)) throw new TypeError(`${where}: ожидается простой объект`)
  const keys = Object.keys(value).sort()
  const want = [...expected].sort()
  const missing = want.filter((key) => !keys.includes(key))
  const extra = keys.filter((key) => !want.includes(key))
  if (missing.length) throw new TypeError(`${where}: нет обязательных полей ${missing.join(', ')}`)
  if (extra.length) throw new TypeError(`${where}: лишние поля ${extra.join(', ')}`)
}

function assertNonEmptyString(value, where) {
  if (typeof value !== 'string' || !value.length) {
    throw new TypeError(`${where}: ожидается непустая строка, получено ${JSON.stringify(value)}`)
  }
}

/**
 * Безопасное целое, а не просто целое.
 *
 * `Number.isInteger` истинно и выше `Number.MAX_SAFE_INTEGER`, где числа
 * перестают быть точными: 2**53 и 2**53+1 там неразличимы. Для байтов,
 * токенов и счётчиков это означало бы, что сумма сошлась не потому, что
 * она верна, а потому, что разницу нечем выразить.
 *
 * `-0` отвергается отдельно: он безопасное целое и проходит `>= 0`, а
 * канонизация его уже не приняла бы — но эта функция вызывается и на
 * агрегатах, посчитанных здесь же, и полагаться на чужой порядок нечем.
 */
function assertInteger(value, where, min = 0) {
  if (typeof value !== 'number' || Object.is(value, -0) || !Number.isSafeInteger(value) || value < min) {
    throw new TypeError(
      `${where}: ожидается безопасное целое не меньше ${min}, получено ${JSON.stringify(value) ?? String(value)}`,
    )
  }
}

/** `Object.is`, а не `===`: иначе -0 прошёл бы там, где ждут 0. */
function assertExactly(value, expected, where) {
  if (!Object.is(value, expected)) {
    throw new TypeError(`${where}: ожидается ${String(expected)}, получено ${JSON.stringify(value) ?? String(value)}`)
  }
}

function assertStringList(value, where) {
  if (!Array.isArray(value)) throw new TypeError(`${where}: ожидается массив строк`)
  value.forEach((item, i) => assertNonEmptyString(item, `${where}[${i}]`))
  const sorted = [...value].sort()
  if (value.some((item, i) => item !== sorted[i])) {
    throw new TypeError(`${where}: список обязан быть отсортирован — порядок входит в подпись`)
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${where}: список содержит повторы`)
}

function assertDigestShape(value, spec, where) {
  assertExactKeys(value, DIGEST_KEYS, where)
  if (typeof value.value !== 'string' || !SHA256_VALUE.test(value.value)) {
    throw new TypeError(
      `${where}.value: ожидается «sha256:» и ровно 64 строчных hex-знака, получено ${JSON.stringify(value.value)}`,
    )
  }
  assertExactly(value.algorithm, DIGEST_ALGORITHM, `${where}.algorithm`)
  assertExactly(value.spec, spec, `${where}.spec`)
}

function assertTokenEstimateShape(value, where) {
  assertExactKeys(value, TOKEN_ESTIMATE_KEYS, where)
  assertInteger(value.value, `${where}.value`)
  assertExactly(value.spec, TOKEN_ESTIMATE_SPEC, `${where}.spec`)
  assertExactly(value.approximate, true, `${where}.approximate`)
}

/**
 * Канонический момент времени: ровно `toISOString()` и ничего иного.
 * Регулярное выражение задаёт форму, обратное преобразование — существование:
 * `2026-02-30T00:00:00.000Z` форму проходит, а моментом времени не является.
 */
function assertCanonicalInstant(value, where) {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) {
    throw new TypeError(
      `${where}: ожидается канонический момент вида 2026-08-13T00:00:00.000Z, получено ${JSON.stringify(value)}`,
    )
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${where}: ${JSON.stringify(value)} не существует как момент времени`)
  }
  return parsed.getTime()
}

/**
 * `Object.freeze` мелкий: он закрывает верхний объект и оставляет вложенные
 * живыми. Проверенный план обязан быть неизменяемым целиком — иначе
 * «проверено» относится к состоянию, которого уже нет.
 *
 * Циклов здесь быть не может: канонизация отвергает их до этой точки.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  Object.freeze(value)
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key])
  return value
}

/**
 * Закрытая грамматика причин: либо причина из списка без параметра, либо
 * `missingAllowedFields:<поле контракта>`. Третьей формы не существует.
 *
 * `noValidUntil` и `expired` взаимоисключающи: срока либо нет, либо он
 * есть и истёк. Оба сразу означали бы, что причины собраны двумя разными
 * проходами.
 */
function assertPolicyReasonGrammar(reasons, where, fields = MODEL_INPUT_FIELDS) {
  for (const reason of reasons) {
    if (POLICY_SIMPLE_REASONS.includes(reason)) continue
    if (reason.startsWith(POLICY_MISSING_FIELD_PREFIX)) {
      const field = reason.slice(POLICY_MISSING_FIELD_PREFIX.length)
      if (fields.includes(field)) continue
      throw new TypeError(`${where}: причина «${reason}» называет поле вне контракта`)
    }
    throw new TypeError(`${where}: причина «${reason}» вне закрытой грамматики evaluatePolicy`)
  }
  if (reasons.includes(POLICY_REASON_NO_VALID_UNTIL) && reasons.includes(POLICY_REASON_EXPIRED)) {
    throw new TypeError(
      `${where}: «${POLICY_REASON_NO_VALID_UNTIL}» и «${POLICY_REASON_EXPIRED}» взаимоисключающи`,
    )
  }
}

function verifyPlanItem(item, where) {
  assertExactKeys(item, PLAN_ITEM_KEYS, where)
  assertNonEmptyString(item.sourceKey, `${where}.sourceKey`)
  assertDigestShape(item.candidateInputDigest, MODEL_INPUT_SPEC, `${where}.candidateInputDigest`)
  /* Не меньше единицы: канонический поток всегда несёт строку домена, и
     нулевая длина означала бы, что байты считал не тот код. */
  assertInteger(item.classificationItemBytes, `${where}.classificationItemBytes`, 1)
  assertTokenEstimateShape(item.tokenEstimate, `${where}.tokenEstimate`)
  return item.sourceKey
}

function verifyPortalFragment(fragment, where) {
  assertExactKeys(fragment, PORTAL_FRAGMENT_KEYS, where)
  assertNonEmptyString(fragment.portalId, `${where}.portalId`)
  assertDigestShape(fragment.policyDigest, SOURCE_POLICY_SPEC, `${where}.policyDigest`)

  /* В этой версии достижимо ровно одно состояние. `PROVIDER_PROFILES` пуст,
     поэтому `evaluatePolicy` обязана выдать `noAllowedProviders` и запрет
     по любому источнику. Принимать `allowed` значило бы принимать план,
     который этот код построить не мог, — и признать разрешённым то, чего
     никто не разрешал. Расширит контракт коммит с профилем провайдера. */
  assertExactly(fragment.policyState, POLICY_STATE_DENIED, `${where}.policyState`)
  assertExactly(fragment.blockedByPolicy, true, `${where}.blockedByPolicy`)
  assertExactly(fragment.executionPermitted, false, `${where}.executionPermitted`)
  assertStringList(fragment.policyReasons, `${where}.policyReasons`)
  assertPolicyReasonGrammar(fragment.policyReasons, `${where}.policyReasons`)
  if (!fragment.policyReasons.includes(POLICY_REASON_NO_PROVIDERS)) {
    throw new TypeError(
      `${where}.policyReasons: обязана присутствовать причина «${POLICY_REASON_NO_PROVIDERS}» — `
      + 'PROVIDER_PROFILES пуст, и разрешённого провайдера в этой версии не бывает',
    )
  }

  if (!Array.isArray(fragment.plannedFieldNames)
    || fragment.plannedFieldNames.length !== MODEL_INPUT_FIELDS.length
    || fragment.plannedFieldNames.some((field, i) => field !== MODEL_INPUT_FIELDS[i])) {
    throw new TypeError(
      `${where}.plannedFieldNames обязан совпадать с контрактом по составу и порядку: ${MODEL_INPUT_FIELDS.join(', ')}`,
    )
  }
  assertStringList(fragment.policyAllowedFieldNames, `${where}.policyAllowedFieldNames`)
  const unknown = fragment.policyAllowedFieldNames.filter((field) => !MODEL_INPUT_FIELDS.includes(field))
  if (unknown.length) {
    throw new TypeError(`${where}.policyAllowedFieldNames: поля вне контракта ${unknown.join(', ')}`)
  }
  /* Причины и грант описывают одно и то же: чего именно не разрешено.
     Тождество, а не сравнение множеств — повтор обязан упасть. */
  assertIdentity(
    fragment.policyReasons
      .filter((reason) => reason.startsWith(POLICY_MISSING_FIELD_PREFIX))
      .map((reason) => reason.slice(POLICY_MISSING_FIELD_PREFIX.length)),
    MODEL_INPUT_FIELDS.filter((field) => !fragment.policyAllowedFieldNames.includes(field)),
    `${where}: missingAllowedFields против policyAllowedFieldNames`,
  )

  for (const key of UNPRICED_KEYS) assertExactly(fragment[key], null, `${where}.${key}`)
  assertExactly(fragment.costReason, COST_REASON_NO_PROVIDER, `${where}.costReason`)

  if (!Array.isArray(fragment.items)) throw new TypeError(`${where}.items: ожидается массив`)
  const sourceKeys = fragment.items.map((item, i) => verifyPlanItem(item, `${where}.items[${i}]`))
  const sorted = [...sourceKeys].sort()
  if (sourceKeys.some((key, i) => key !== sorted[i])) {
    throw new TypeError(`${where}.items: записи обязаны быть отсортированы по sourceKey`)
  }
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    throw new TypeError(`${where}.items: sourceKey повторяется внутри портала`)
  }

  /* Счётчики сверяются с данными, а не принимаются на слово: расхождение
     означает, что артефакт собрали в два прохода и один из них устарел. */
  assertInteger(fragment.plannedItemCount, `${where}.plannedItemCount`)
  assertExactly(fragment.plannedItemCount, fragment.items.length, `${where}.plannedItemCount`)
  assertInteger(fragment.classificationItemBytesTotal, `${where}.classificationItemBytesTotal`)
  assertExactly(
    fragment.classificationItemBytesTotal,
    fragment.items.reduce((sum, item) => sum + item.classificationItemBytes, 0),
    `${where}.classificationItemBytesTotal`,
  )
  assertTokenEstimateShape(fragment.tokenEstimate, `${where}.tokenEstimate`)
  assertExactly(
    fragment.tokenEstimate.value,
    fragment.items.reduce((sum, item) => sum + item.tokenEstimate.value, 0),
    `${where}.tokenEstimate.value`,
  )

  return fragment.portalId
}

/**
 * Единственная проверка плана `poi-model-plan/v1`.
 *
 * Сохранённому `planDigest` не доверяет: он пересчитывается той же
 * `deterministicPart`, которой пользуется builder, и расхождение — отказ.
 * Возвращает глубоко замороженный план и отпечаток всего артефакта.
 *
 * `providerProfile` обязан быть `null`, `executionPermitted` — `false`:
 * это форма ТЕКУЩЕЙ версии. Коммит с профилем провайдера либо осознанно
 * расширит контракт, либо поднимет версию; угадывать его форму здесь нечем.
 */
export function parseAndVerifyModelPlan(raw) {
  if (!isPlainObject(raw)) {
    throw new TypeError(`${MODEL_PLAN_CONTRACT_VERSION}: план обязан быть простым объектом`)
  }
  /* Структурная строгость не переписывается вторым списком правил:
     канонизация на всей глубине отвергает символьные, accessor- и
     неперечисляемые свойства, разрежённые массивы, неканонические ключи
     индексов, одиночные суррогаты, не-простые прототипы, -0, не конечные
     числа и циклы. Байты артефакта — побочный продукт того же прохода. */
  const artifactBytes = canonicalJsonBytes(raw, MODEL_PLAN_ARTIFACT_SPEC)

  assertExactKeys(raw, PLAN_KEYS, MODEL_PLAN_CONTRACT_VERSION)
  assertExactly(raw.contractVersion, MODEL_PLAN_CONTRACT_VERSION, 'contractVersion')
  assertNonEmptyString(raw.planId, 'planId')

  const createdAt = assertCanonicalInstant(raw.createdAt, 'createdAt')
  const deleteAfter = assertCanonicalInstant(raw.deleteAfter, 'deleteAfter')
  if (deleteAfter <= createdAt) {
    throw new TypeError(
      `deleteAfter обязан быть строго позже createdAt: ${raw.createdAt} → ${raw.deleteAfter}`,
    )
  }

  assertCodeIdentity(raw.codeIdentity)
  /* Форма — не чистота. `dirty: true` означает, что commit не описывает
     код, построивший план: подпись выглядит проверяемой, не будучи ею.
     Проверка стоит ДО пересчёта planDigest намеренно — грязный план с
     безупречно пересчитанной подписью обязан получить ошибку чистоты, а
     не «подпись сошлась». */
  if (raw.codeIdentity.dirty !== false) {
    throw new TypeError(
      `codeIdentity.dirty: отслеживаемое рабочее дерево было изменено, commit ${raw.codeIdentity.commit} `
      + 'исполняемый код не описывает. План, подписанный такой идентичностью, хуже отсутствующего.',
    )
  }
  assertNonEmptyString(raw.taxonomyVersion, 'taxonomyVersion')
  assertDigestShape(raw.taxonomyDigest, RAW_FILE_BYTES_SPEC, 'taxonomyDigest')
  assertDigestShape(raw.promptDigest, MODEL_PROMPT_SPEC, 'promptDigest')
  assertDigestShape(raw.schemaDigest, MODEL_SCHEMA_SPEC, 'schemaDigest')
  assertDigestShape(raw.planDigest, MODEL_PLAN_CONTRACT_VERSION, 'planDigest')
  /* Длина хешируемого потока, а не длина строки: домен входит в байты. */
  assertInteger(raw.promptBytes, 'promptBytes', 1)
  assertInteger(raw.schemaBytes, 'schemaBytes', 1)
  assertExactly(raw.providerProfile, null, 'providerProfile')
  assertExactly(raw.executionPermitted, false, 'executionPermitted')

  if (!Array.isArray(raw.portals)) throw new TypeError('portals: ожидается массив')
  const portalIds = raw.portals.map((fragment, i) => verifyPortalFragment(fragment, `portals[${i}]`))
  const sortedIds = [...portalIds].sort()
  if (portalIds.some((id, i) => id !== sortedIds[i])) {
    throw new TypeError('portals: фрагменты обязаны быть отсортированы по portalId')
  }
  if (new Set(portalIds).size !== portalIds.length) throw new TypeError('portals: portalId повторяется')

  const recomputed = sha256Bytes(canonicalJsonBytes(deterministicPart(raw), MODEL_PLAN_CONTRACT_VERSION))
  if (recomputed !== raw.planDigest.value) {
    throw new TypeError(
      `planDigest не сходится: в артефакте ${raw.planDigest.value}, пересчёт даёт ${recomputed}. `
      + 'Сохранённое значение здесь не свидетельство, а предмет проверки.',
    )
  }

  /* Возвращается СОБСТВЕННАЯ копия: заморозка чужого объекта — побочный
     эффект, о котором вызывающий не просил. Через builder это заморозило бы
     переданные ему fragments и meta.codeIdentity, то есть объекты, живущие
     дальше в оркестраторе. Копия делается после проверок: клонировать
     непроверенное незачем. */
  return deepFreeze({
    plan: structuredClone(raw),
    planArtifactDigest: digest(sha256Bytes(artifactBytes), DIGEST_ALGORITHM, MODEL_PLAN_ARTIFACT_SPEC),
  })
}
