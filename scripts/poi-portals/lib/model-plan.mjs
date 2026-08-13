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
import { DIGEST_ALGORITHM, sha256Bytes } from '../../lib/byte-digest.mjs'

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
    // -0 выводится как 0. Правило описано, а не применено молча: в JSON
    // отрицательного нуля нет, и подменять его на 0 незаметно нельзя.
    return Object.is(value, -0) ? '0' : String(value)
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
  if (!policy.allowedProviders.length) reasons.push('noAllowedProviders')
  /* Каждое спланированное поле называется поимённо. «Полей не разрешено»
     одной строкой не говорит, какого именно разрешения не хватает, и после
     частичного гранта осталось бы верным, ничего не объясняя. */
  for (const field of requiredFields) {
    if (!policy.fields.includes(field)) reasons.push(`missingAllowedFields:${field}`)
  }
  if (policy.decisionRef === null) reasons.push('noDecisionRef')
  if (policy.reviewedAt === null) reasons.push('noReviewedAt')
  if (policy.validUntil === null) reasons.push('noValidUntil')
  else if (now.getTime() >= policyExpiryMs(policy.validUntil)) reasons.push('expired')
  return { state: reasons.length ? 'denied' : 'allowed', reasons: reasons.sort() }
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
    costReason: 'провайдер не выбран: PROVIDER_PROFILES пуст',
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
  return plan
}
