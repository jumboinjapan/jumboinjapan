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
import { DIGEST_ALGORITHM, hmacSha256Hex, RAW_FILE_BYTES_SPEC, sha256Bytes } from '../../lib/byte-digest.mjs'
import {
  assertCanonicalInstant,
  assertCodeIdentity,
  assertDigestShape,
  assertExactKeys,
  assertExactly,
  assertIdentity,
  assertInteger,
  assertNoLoneSurrogate,
  assertNonEmptyString,
  assertStrictArray,
  assertStrictOwnKeys,
  assertStringList,
  canonicalJsonBytes,
  CODE_IDENTITY_KEYS,
  deepFreeze,
  digest,
  DIGEST_KEYS,
  isPlainObject,
  assertSha256Value,
  isStrictCalendarDate,
} from '../../lib/canonical-contract.mjs'
import {
  assertProviderProfileShape,
  providerProfileDigest,
  PROVIDER_PROFILE_SPEC,
  PROVIDER_PROFILES,
} from './provider-profile.mjs'

/* Публичная поверхность модуля не меняется: то, что раньше экспортировалось
   отсюда, экспортируется отсюда и дальше. Потребители — collect-pois.mjs и
   набор тестов — импорт не правят. */
export {
  assertCodeIdentity,
  assertIdentity,
  canonicalJsonBytes,
  CODE_IDENTITY_KEYS,
  DIGEST_KEYS,
}

/* Реестр профилей переехал в `provider-profile.mjs` — он профильные данные,
   а не плановые. Здесь он только читается (`assertStringArray` сверяет с ним
   `allowedProviders`) и переэкспортируется, чтобы существующие потребители
   импорт не правили. Список по-прежнему пуст: пока он пуст, любая непустая
   `allowedProviders` отвергается проверкой формы. */
export { PROVIDER_PROFILES }

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
/** Профиль выбран, но этот источник его не разрешал. */
export const POLICY_PROVIDER_NOT_ALLOWED_PREFIX = 'providerNotAllowed:'

/**
 * Причина, по которой в этой версии стоимость не считается вовсе.
 *
 * Одна константа на builder и парсер: второй литерал разошёлся бы с первым
 * молча, а расхождение читалось бы как «стоимость не посчитана по другой
 * причине» — то есть как факт, которого не было.
 */
export const COST_REASON_NO_PROVIDER = 'провайдер не выбран: PROVIDER_PROFILES пуст'

/**
 * Причина для v2. Провайдер выбран, но стоимость всё равно не считается
 * здесь: оценка токенов помечена `approximate`, и делать приблизительную
 * величину денежной границей нельзя. Консервативную верхнюю границу
 * считает preflight из потолков approval и закреплённой таблицы цен —
 * вся денежная арифметика живёт в одном месте.
 */
export const COST_REASON_UPPER_BOUND_AT_PREFLIGHT = 'верхняя граница стоимости считается preflight по потолкам approval'

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

/* ── Policy: форма (P0) и содержание (P1) ────────────────────────────── */

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
export function assertPolicyShape(source, { profiles = PROVIDER_PROFILES } = {}) {
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
  /* В policy лежат строковые ИДЕНТИФИКАТОРЫ профилей, а в реестре —
     объекты. Сравнивать их напрямую нельзя: пока реестр пуст, ошибка не
     видна, а с первым же профилем разрешающая policy перестала бы
     проходить форму. Второго реестра при этом не заводится — список
     идентификаторов выводится из канонического. */
  assertStringArray(
    policy.allowedProviders, 'allowedProviders', profiles.map((profile) => profile.id), sourceId,
  )

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
export function evaluatePolicy(policy, { now, requiredFields, providerId = null } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('evaluatePolicy: now обязателен и должен быть корректной датой')
  }
  if (!Array.isArray(requiredFields)) {
    throw new TypeError('evaluatePolicy: requiredFields обязателен — без него «разрешено» не с чем сравнивать')
  }
  const reasons = []
  if (!policy.allowedProviders.length) reasons.push(POLICY_REASON_NO_PROVIDERS)
  /* Непустой список ещё не значит «разрешён ЭТОТ». Причина называет
     конкретный профиль: «провайдеры разрешены» без имени после
     частичного гранта осталось бы верным, ничего не объясняя. */
  else if (providerId !== null && !policy.allowedProviders.includes(providerId)) {
    reasons.push(`${POLICY_PROVIDER_NOT_ALLOWED_PREFIX}${providerId}`)
  }
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
  assertPolicyReasonGrammar(reasons, 'evaluatePolicy', { fields: requiredFields, providerId })
  return { state: reasons.length ? POLICY_STATE_DENIED : POLICY_STATE_ALLOWED, reasons }
}

/* ── Сборка плана ────────────────────────────────────────────────────── */

/**
 * Фрагмент плана по одному порталу.
 *
 * Отбирает ровно `awaitingClassification`. Порядок items — по `sourceKey`,
 * поэтому порядок, в котором адаптер вернул строки, на результат не влияет.
 */
export function buildPortalPlanFragment({ portal, evaluated, now, providerProfile = null }) {
  const policy = portal.modelProcessing
  const verdict = evaluatePolicy(policy, {
    now, requiredFields: MODEL_INPUT_FIELDS, providerId: providerProfile?.id ?? null,
  })

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

  const fragment = {
    portalId: portal.id,
    policyDigest: digest(
      sha256Bytes(canonicalJsonBytes(policy, SOURCE_POLICY_SPEC)),
      DIGEST_ALGORITHM,
      SOURCE_POLICY_SPEC,
    ),
    policyState: verdict.state,
    policyReasons: verdict.reasons,
    blockedByPolicy: verdict.state !== POLICY_STATE_ALLOWED,
    /* Портал исполним, только если профиль выбран И этот источник его
       пропустил. Без профиля исполнять нечем — значение остаётся false. */
    executionPermitted: providerProfile !== null && verdict.state === POLICY_STATE_ALLOWED,
    plannedFieldNames: [...MODEL_INPUT_FIELDS],
    policyAllowedFieldNames: [...policy.fields].sort(),
    plannedItemCount: items.length,
    /* v1 не знает, чем отправлять, поэтому обе величины null. v2 знает:
       синхронно, один кандидат — один запрос, партий нет. */
    networkRequestCount: providerProfile === null ? null : items.length,
    batchJobCount: providerProfile === null ? null : 0,
    /* Оба остаются null и в v2: billableTokens — факт из usage ответа, а не
       оценка; верхнюю границу стоимости считает preflight. */
    billableTokens: null,
    estimatedCostUpperBound: null,
    costReason: providerProfile === null ? COST_REASON_NO_PROVIDER : COST_REASON_UPPER_BOUND_AT_PREFLIGHT,
    classificationItemBytesTotal: items.reduce((sum, item) => sum + item.classificationItemBytes, 0),
    tokenEstimate: {
      value: items.reduce((sum, item) => sum + item.tokenEstimate.value, 0),
      spec: TOKEN_ESTIMATE_SPEC,
      approximate: true,
    },
    items,
  }
  /* Вердикт policy вычислен ПОД конкретный профиль, и фрагмент носит его имя.
     Иначе `allowed` был бы безымянным разрешением, которое подходит любому
     провайдеру: план собрали бы с другим профилем, и подпись сошлась бы. */
  if (providerProfile !== null) fragment.providerProfileId = providerProfile.id
  return fragment
}

/**
 * Детерминированная часть плана — то, что подписывается `planDigest`.
 * `planId`, `createdAt` и `deleteAfter` сюда не входят: два прогона одного
 * и того же набора обязаны давать один digest.
 */
function deterministicPart(plan) {
  /* Одна реализация на обе версии: состав подписываемых ключей — ДАННЫЕ
     таблицы версий, а не второй код. Порядок здесь не важен — канонизация
     сортирует ключи, поэтому байты v1 не меняются от того, что объект
     собран циклом. */
  const part = {}
  for (const key of planRules(plan.contractVersion).signedKeys) part[key] = plan[key]
  return part
}

/**
 * Полный план. Порталы сортируются по `portalId`; один и тот же набор
 * обязан давать один и тот же `planDigest`.
 */
export function buildModelPlan({ fragments, selectedPortalIds, meta }) {
  /* Профиль проверяется ПЕРВЫМ, до идентичности кода и до сверки порталов.
     Он определяет версию контракта всего плана, и узнавать о его негодности
     после того, как собрана подпись, — то же самое, что проверять границы
     после записи. Доверия к `meta.providerProfile` нет: обещание вызывающего
     «я уже проверил» доказательством не является. */
  const profile = meta.providerProfile ?? null
  if (profile !== null) assertProviderProfileShape(profile)
  const contractVersion = profile === null
    ? MODEL_PLAN_CONTRACT_VERSION
    : MODEL_PLAN_V2_CONTRACT_VERSION

  assertCodeIdentity(meta.codeIdentity)
  const sorted = [...fragments].sort((a, b) => (a.portalId < b.portalId ? -1 : a.portalId > b.portalId ? 1 : 0))
  assertIdentity(selectedPortalIds, sorted.map((fragment) => fragment.portalId), 'portalId')
  /* Отказ ДО подписи, а не после: подписывать план, в котором разрешение
     выдано одному профилю, а исполнять собираются другим, незачем. Собственная
     граница отвергла бы его и так — но уже подписанным. */
  const boundTo = profile === null ? null : profile.id
  for (const fragment of sorted) {
    const named = fragment.providerProfileId ?? null
    if (named !== boundTo) {
      throw new TypeError(
        `${fragment.portalId}: фрагмент рассчитан для профиля ${JSON.stringify(named)}, `
        + `а план собирается с ${JSON.stringify(boundTo)}. Разрешение, выданное одному `
        + 'профилю, другому не переходит.',
      )
    }
  }
  const promptBytes = Buffer.from(`${MODEL_PROMPT_SPEC}\n${meta.promptText}`, 'utf8')
  const schemaBytes = canonicalJsonBytes(meta.schemaObject, MODEL_SCHEMA_SPEC)

  const plan = {
    contractVersion,
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
    /* В плане живёт только идентичность профиля, а не он сам: весь профиль
       уже подписан отпечатком, а копия в плане была бы вторым источником
       правды о провайдере. */
    providerProfile: profile === null ? null : { id: profile.id, version: profile.version },
    /* Исполним весь план только тогда, когда исполним КАЖДЫЙ портал. Один
       запрещённый источник делает неисполнимым целое: частичного исполнения
       в этой версии нет, и выразить его нечем. */
    executionPermitted: profile !== null && sorted.every((fragment) => fragment.executionPermitted),
    portals: sorted,
  }
  if (profile !== null) {
    plan.providerProfileDigest = digest(
      providerProfileDigest(profile), DIGEST_ALGORITHM, PROVIDER_PROFILE_SPEC,
    )
  }
  plan.planDigest = digest(
    sha256Bytes(canonicalJsonBytes(deterministicPart(plan), contractVersion)),
    DIGEST_ALGORITHM,
    contractVersion,
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

/** Исполняемая версия плана. Введена отдельной версией, а не расширением
    v1: v1 требует providerProfile === null, executionPermitted === false и
    denied у каждого портала — исполняемый план нарушает каждое из этих
    требований. Ослабить их внутри v1 значило бы молча расширить смысл фразы
    «проверенный план v1» с «исполнить нельзя» на «может быть исполним», при
    том что уже подписанные digest продолжали бы сходиться. */
export const MODEL_PLAN_V2_CONTRACT_VERSION = 'poi-model-plan/v2'

/** Состав верхнего уровня v2: тот же, плюс отпечаток профиля. */
export const PLAN_KEYS_V2 = Object.freeze([...PLAN_KEYS, 'providerProfileDigest'])

/** Ссылка на профиль внутри плана: только идентичность, не весь профиль. */
export const PROVIDER_PROFILE_REF_KEYS = Object.freeze(['id', 'version'])

/** Точный состав фрагмента одного портала. */
export const PORTAL_FRAGMENT_KEYS = Object.freeze([
  'portalId', 'policyDigest', 'policyState', 'policyReasons', 'blockedByPolicy',
  'executionPermitted', 'plannedFieldNames', 'policyAllowedFieldNames',
  'plannedItemCount', 'networkRequestCount', 'batchJobCount', 'billableTokens',
  'estimatedCostUpperBound', 'costReason', 'classificationItemBytesTotal',
  'tokenEstimate', 'items',
])
/**
 * Состав фрагмента v2: тот же, плюс ID профиля, ПОД КОТОРЫЙ вычислена policy.
 *
 * Без этого поля вердикт `allowed` безымянен: фрагмент, рассчитанный для
 * профиля A, попал бы в план, собранный с профилем B, и разрешение, выданное
 * одному провайдеру, молча перешло бы к другому. Поле существует только в v2:
 * в v1 профиля нет, называть нечего, и байты v1 не меняются.
 */
export const PORTAL_FRAGMENT_KEYS_V2 = Object.freeze([...PORTAL_FRAGMENT_KEYS, 'providerProfileId'])

const SIGNED_KEYS_V1 = Object.freeze([
  'contractVersion', 'codeIdentity', 'taxonomyVersion', 'taxonomyDigest',
  'promptDigest', 'schemaDigest', 'promptBytes', 'schemaBytes',
  'providerProfile', 'executionPermitted', 'portals',
])
const SIGNED_KEYS_V2 = Object.freeze([...SIGNED_KEYS_V1, 'providerProfileDigest'])

/**
 * Правила версий — данные, а не второй парсер.
 *
 * Состав ключей верхнего уровня, фрагмента, подписываемой части и признак
 * исполнимости задаются отдельно для каждой версии: v1 сохраняет прежний
 * фрагмент, v2 дополнительно требует providerProfileId.
 */
const PLAN_VERSIONS = Object.freeze({
  [MODEL_PLAN_CONTRACT_VERSION]: Object.freeze({
    planKeys: PLAN_KEYS, signedKeys: SIGNED_KEYS_V1,
    fragmentKeys: PORTAL_FRAGMENT_KEYS, executable: false,
  }),
  [MODEL_PLAN_V2_CONTRACT_VERSION]: Object.freeze({
    planKeys: PLAN_KEYS_V2, signedKeys: SIGNED_KEYS_V2,
    fragmentKeys: PORTAL_FRAGMENT_KEYS_V2, executable: true,
  }),
})

function planRules(contractVersion) {
  /* Поиск строго по СОБСТВЕННЫМ ключам таблицы. Через цепочку прототипов
     `PLAN_VERSIONS['toString']` вернул бы функцию, а `'__proto__'` —
     Object.prototype: версией контракта стало бы унаследованное свойство.
     План и тогда был бы отвергнут, но по внутренней ошибке дальше по коду
     и с неверным диагнозом — а закрытый список версий обязан отвечать сам. */
  if (typeof contractVersion !== 'string' || !Object.hasOwn(PLAN_VERSIONS, contractVersion)) {
    throw new TypeError(
      `Неизвестная версия контракта плана ${JSON.stringify(contractVersion)}; `
      + `объявлены ${Object.keys(PLAN_VERSIONS).join(', ')}`,
    )
  }
  return PLAN_VERSIONS[contractVersion]
}


/** Точный состав записи одного кандидата. */
export const PLAN_ITEM_KEYS = Object.freeze([
  'sourceKey', 'candidateInputDigest', 'classificationItemBytes', 'tokenEstimate',
])

/** Точный состав оценки токенов. */
export const TOKEN_ESTIMATE_KEYS = Object.freeze(['value', 'spec', 'approximate'])

function assertTokenEstimateShape(value, where) {
  assertExactKeys(value, TOKEN_ESTIMATE_KEYS, where)
  assertInteger(value.value, `${where}.value`)
  assertExactly(value.spec, TOKEN_ESTIMATE_SPEC, `${where}.spec`)
  assertExactly(value.approximate, true, `${where}.approximate`)
}

/**
 * Закрытая грамматика причин: либо причина из списка без параметра, либо
 * `missingAllowedFields:<поле контракта>`. Третьей формы не существует.
 *
 * `noValidUntil` и `expired` взаимоисключающи: срока либо нет, либо он
 * есть и истёк. Оба сразу означали бы, что причины собраны двумя разными
 * проходами.
 */
function assertPolicyReasonGrammar(reasons, where, { fields = MODEL_INPUT_FIELDS, providerId = null } = {}) {
  for (const reason of reasons) {
    if (POLICY_SIMPLE_REASONS.includes(reason)) continue
    if (reason.startsWith(POLICY_MISSING_FIELD_PREFIX)) {
      const field = reason.slice(POLICY_MISSING_FIELD_PREFIX.length)
      if (fields.includes(field)) continue
      throw new TypeError(`${where}: причина «${reason}» называет поле вне контракта`)
    }
    if (reason.startsWith(POLICY_PROVIDER_NOT_ALLOWED_PREFIX)) {
      /* Причина про провайдера возможна только там, где профиль выбран, и
         называть может только ЕГО. Иначе артефакт объяснял бы запрет
         профилем, которого в нём нет. */
      const named = reason.slice(POLICY_PROVIDER_NOT_ALLOWED_PREFIX.length)
      if (providerId === null) {
        throw new TypeError(`${where}: причина «${reason}» без выбранного профиля невозможна`)
      }
      if (named !== providerId) {
        throw new TypeError(`${where}: причина «${reason}» называет не выбранный профиль «${providerId}»`)
      }
      continue
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

function verifyPortalFragment(fragment, where, rules, providerId) {
  assertExactKeys(fragment, rules.fragmentKeys, where)
  assertNonEmptyString(fragment.portalId, `${where}.portalId`)
  assertDigestShape(fragment.policyDigest, SOURCE_POLICY_SPEC, `${where}.policyDigest`)

  assertStringList(fragment.policyReasons, `${where}.policyReasons`)
  assertPolicyReasonGrammar(fragment.policyReasons, `${where}.policyReasons`, { providerId })

  if (!rules.executable) {
    /* В диагностической версии достижимо ровно одно состояние: профиля нет,
       поэтому `evaluatePolicy` обязана выдать `noAllowedProviders` и запрет
       по любому источнику. Принимать `allowed` значило бы принимать план,
       который этот код построить не мог, — и признать разрешённым то, чего
       никто не разрешал. */
    assertExactly(fragment.policyState, POLICY_STATE_DENIED, `${where}.policyState`)
    assertExactly(fragment.blockedByPolicy, true, `${where}.blockedByPolicy`)
    assertExactly(fragment.executionPermitted, false, `${where}.executionPermitted`)
    if (!fragment.policyReasons.includes(POLICY_REASON_NO_PROVIDERS)) {
      throw new TypeError(
        `${where}.policyReasons: обязана присутствовать причина «${POLICY_REASON_NO_PROVIDERS}» — `
        + 'без выбранного профиля разрешённого провайдера не бывает',
      )
    }
  } else {
    /* В исполняемой версии достижимы оба состояния, но не любые их
       сочетания: три поля описывают одно решение и разойтись не имеют права. */
    if (![POLICY_STATE_ALLOWED, POLICY_STATE_DENIED].includes(fragment.policyState)) {
      throw new TypeError(
        `${where}.policyState: ожидается ${POLICY_STATE_ALLOWED} либо ${POLICY_STATE_DENIED}, `
        + `получено ${JSON.stringify(fragment.policyState)}`,
      )
    }
    /* Разрешение непереносимо: фрагмент обязан называть тот же профиль, что и
       план. Расхождение означает, что вердикт получен для одного провайдера,
       а исполнять собираются другим. */
    assertNonEmptyString(fragment.providerProfileId, `${where}.providerProfileId`)
    assertExactly(fragment.providerProfileId, providerId, `${where}.providerProfileId`)
    const allowed = fragment.policyState === POLICY_STATE_ALLOWED
    assertExactly(fragment.blockedByPolicy, !allowed, `${where}.blockedByPolicy`)
    assertExactly(fragment.executionPermitted, allowed, `${where}.executionPermitted`)
    if (allowed !== (fragment.policyReasons.length === 0)) {
      throw new TypeError(
        `${where}: состояние «${fragment.policyState}» не согласуется с числом причин `
        + `${fragment.policyReasons.length}`,
      )
    }
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

  /* Обе величины остаются `null` в любой версии: `billableTokens` — факт из
     usage ответа, а верхнюю границу стоимости считает preflight. */
  assertExactly(fragment.billableTokens, null, `${where}.billableTokens`)
  assertExactly(fragment.estimatedCostUpperBound, null, `${where}.estimatedCostUpperBound`)
  if (!rules.executable) {
    assertExactly(fragment.networkRequestCount, null, `${where}.networkRequestCount`)
    assertExactly(fragment.batchJobCount, null, `${where}.batchJobCount`)
    assertExactly(fragment.costReason, COST_REASON_NO_PROVIDER, `${where}.costReason`)
  } else {
    /* Синхронно, один кандидат — один запрос. Партий в этой версии нет. */
    assertInteger(fragment.networkRequestCount, `${where}.networkRequestCount`)
    assertExactly(fragment.networkRequestCount, fragment.items.length, `${where}.networkRequestCount`)
    assertExactly(fragment.batchJobCount, 0, `${where}.batchJobCount`)
    assertExactly(fragment.costReason, COST_REASON_UPPER_BOUND_AT_PREFLIGHT, `${where}.costReason`)
  }

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
 * Единственная проверка плана — для ОБЕИХ объявленных версий.
 *
 * Второго парсера нет: версия контракта выбирает строку таблицы
 * `PLAN_VERSIONS` — состав ключей верхнего уровня, состав ключей фрагмента,
 * состав подписываемой части и признак исполнимости. Версия вне таблицы —
 * отказ, а не ближайшее совпадение.
 *
 * Сохранённому `planDigest` не доверяет: он пересчитывается той же
 * `deterministicPart`, которой пользуется builder, и расхождение — отказ.
 * Возвращает глубоко замороженный план и отпечаток всего артефакта.
 *
 * В v1 `providerProfile` обязан быть `null`, `executionPermitted` — `false`,
 * каждый портал `denied`. В v2 профиль обязателен, достижимы оба состояния
 * портала, и каждый фрагмент обязан называть ТОТ ЖЕ профиль, что и план.
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

  /* Версия выбирает правила, а не второй парсер: состав ключей, состав
     подписываемой части и признак исполнимости — данные таблицы версий. */
  const rules = planRules(raw.contractVersion)
  assertExactKeys(raw, rules.planKeys, raw.contractVersion)
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
  assertDigestShape(raw.planDigest, raw.contractVersion, 'planDigest')
  /* Длина хешируемого потока, а не длина строки: домен входит в байты. */
  assertInteger(raw.promptBytes, 'promptBytes', 1)
  assertInteger(raw.schemaBytes, 'schemaBytes', 1)
  let providerId = null
  if (!rules.executable) {
    assertExactly(raw.providerProfile, null, 'providerProfile')
    assertExactly(raw.executionPermitted, false, 'executionPermitted')
  } else {
    assertExactKeys(raw.providerProfile, PROVIDER_PROFILE_REF_KEYS, 'providerProfile')
    assertNonEmptyString(raw.providerProfile.id, 'providerProfile.id')
    assertNonEmptyString(raw.providerProfile.version, 'providerProfile.version')
    providerId = raw.providerProfile.id
    assertDigestShape(raw.providerProfileDigest, PROVIDER_PROFILE_SPEC, 'providerProfileDigest')
    if (typeof raw.executionPermitted !== 'boolean') {
      throw new TypeError(`executionPermitted: ожидается boolean, получено ${typeof raw.executionPermitted}`)
    }
  }

  if (!Array.isArray(raw.portals)) throw new TypeError('portals: ожидается массив')
  const portalIds = raw.portals.map(
    (fragment, i) => verifyPortalFragment(fragment, `portals[${i}]`, rules, providerId),
  )
  if (rules.executable) {
    /* Один запрещённый портал делает неисполнимым весь план: частичного
       исполнения в этой версии нет, и «исполним наполовину» выразить нечем. */
    assertExactly(
      raw.executionPermitted,
      raw.portals.every((fragment) => fragment.executionPermitted),
      'executionPermitted',
    )
  }
  const sortedIds = [...portalIds].sort()
  if (portalIds.some((id, i) => id !== sortedIds[i])) {
    throw new TypeError('portals: фрагменты обязаны быть отсортированы по portalId')
  }
  if (new Set(portalIds).size !== portalIds.length) throw new TypeError('portals: portalId повторяется')

  const recomputed = sha256Bytes(canonicalJsonBytes(deterministicPart(raw), raw.contractVersion))
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


/* ── Идентификатор записи запроса и выборка кандидатов ───────────────────
   Обе величины выводятся ИЗ ПЛАНА и только из него. Поэтому живут рядом с
   остальными плановыми отпечатками: поздний `poi-model-request/v1` получает
   готовый `requestItemId` и формулу не воспроизводит. */

/** Домен идентификатора записи. Входит в хешируемые байты первым полем. */
export const REQUEST_ITEM_SPEC = 'poi-model-request-item/v1'

/** Домен выборки кандидатов. */
export const MODEL_SELECTION_SPEC = 'poi-model-selection/v1'

const SEPARATOR_BYTE = Buffer.from([UNIT_SEPARATOR])

/**
 * Разделитель входит в формат, поэтому значение, которое его содержит, могло
 * бы подделать границу поля: `portalId` «ab» и пара («a», «b») дали бы
 * один поток байтов. Отказ, а не экранирование.
 *
 * Одиночный суррогат отвергается по той же причине, что и в канонизации: при
 * кодировании в UTF-8 он превращается в U+FFFD, и два разных входа дают
 * одинаковые байты.
 */
function assertSeparatorFree(value, where) {
  if (typeof value !== 'string' || !value.length) {
    throw new TypeError(`${where}: ожидается непустая строка, получено ${JSON.stringify(value)}`)
  }
  assertNoLoneSurrogate(value, where)
  if (value.includes(String.fromCharCode(UNIT_SEPARATOR))) {
    throw new TypeError(
      `${where}: содержит U+001F — разделитель полей. Экранирования здесь нет: `
      + 'значение, способное подделать границу, отвергается.',
    )
  }
}

/**
 * Идентификатор записи запроса.
 *
 * `HMAC-SHA-256` с ключом из байтов `planDigest`, поток данных —
 * `UTF8(домен) 0x1F UTF8(portalId) 0x1F UTF8(sourceKey) 0x1F UTF8(candidateInputDigest)`.
 * Результат — ровно 64 строчных hex-знака, без префикса.
 *
 * Честная граница свойства: идентификатор непрозрачен только для стороны, не
 * владеющей планом. Секретом он не является — всякий, у кого есть план,
 * пересчитывает его тривиально, — и обращаться с ним как с секретом нельзя.
 */
export function requestItemId({ planDigest, portalId, sourceKey, candidateInputDigest }) {
  assertSha256Value(planDigest, `${REQUEST_ITEM_SPEC}.planDigest`)
  assertSha256Value(candidateInputDigest, `${REQUEST_ITEM_SPEC}.candidateInputDigest`)
  assertSeparatorFree(portalId, `${REQUEST_ITEM_SPEC}.portalId`)
  assertSeparatorFree(sourceKey, `${REQUEST_ITEM_SPEC}.sourceKey`)
  return hmacSha256Hex(
    Buffer.from(planDigest, 'utf8'),
    Buffer.concat([
      Buffer.from(REQUEST_ITEM_SPEC, 'utf8'), SEPARATOR_BYTE,
      Buffer.from(portalId, 'utf8'), SEPARATOR_BYTE,
      Buffer.from(sourceKey, 'utf8'), SEPARATOR_BYTE,
      Buffer.from(candidateInputDigest, 'utf8'),
    ]),
  )
}

const REQUEST_ITEM_ID = /^[0-9a-f]{64}$/
export const SELECTION_KEYS = Object.freeze(['contractVersion', 'planId', 'planDigest', 'entries'])
export const SELECTION_ENTRY_KEYS = Object.freeze(['portalId', 'requestItemId', 'candidateInputDigest'])

/** Порядок записей: первично portalId, вторично requestItemId. */
const byPortalThenId = (a, b) => {
  if (a.portalId !== b.portalId) return a.portalId < b.portalId ? -1 : 1
  if (a.requestItemId !== b.requestItemId) return a.requestItemId < b.requestItemId ? -1 : 1
  return 0
}

/**
 * Выборка кандидатов по проверенному плану.
 *
 * План проверяется здесь же: обещание вызывающего «я уже проверил»
 * доказательством не является, а выборка по непроверенному плану — подпись
 * под тем, чего никто не читал.
 *
 * Подмножества функция не принимает: в этой версии выборка обязана покрывать
 * план целиком, и «частично утверждено» выразить нечем.
 */
export function buildPlanSelection(plan) {
  const { plan: verified } = parseAndVerifyModelPlan(plan)
  const entries = verified.portals.flatMap((portal) => portal.items.map((item) => ({
    portalId: portal.portalId,
    requestItemId: requestItemId({
      planDigest: verified.planDigest.value,
      portalId: portal.portalId,
      sourceKey: item.sourceKey,
      candidateInputDigest: item.candidateInputDigest.value,
    }),
    candidateInputDigest: item.candidateInputDigest.value,
  }))).sort(byPortalThenId)

  const selection = {
    contractVersion: MODEL_SELECTION_SPEC,
    planId: verified.planId,
    planDigest: verified.planDigest.value,
    entries,
  }
  /* Собственный результат сверяется с планом тем же способом, каким его будет
     сверять исполнитель. Три РАЗНЫЕ проверки, а не одна:
     тождество ключей ловит пропуск и лишнее, парная сверка — перестановку
     digest между записями, пересчёт — подмену самого идентификатора. */
  assertSelectionCoversPlan(selection, verified)
  return deepFreeze(selection)
}

function assertSelectionCoversPlan(selection, verified) {
  const expected = verified.portals.flatMap((portal) => portal.items.map((item) => ({
    portalId: portal.portalId,
    requestItemId: requestItemId({
      planDigest: verified.planDigest.value,
      portalId: portal.portalId,
      sourceKey: item.sourceKey,
      candidateInputDigest: item.candidateInputDigest.value,
    }),
    candidateInputDigest: item.candidateInputDigest.value,
  })))
  const key = (entry) => `${entry.portalId}${String.fromCharCode(UNIT_SEPARATOR)}${entry.requestItemId}`
  /* Тождество, а не сравнение множеств: множества скрыли бы повтор. */
  assertIdentity(
    selection.entries.map(key), expected.map(key),
    `${MODEL_SELECTION_SPEC}: записи выборки против плана`,
  )
  const plannedDigest = new Map(expected.map((entry) => [key(entry), entry.candidateInputDigest]))
  for (const entry of selection.entries) {
    /* Тождество ключей само по себе пропустило бы перестановку digest между
       двумя записями: ключи те же, содержимое переехало. */
    assertExactly(
      entry.candidateInputDigest, plannedDigest.get(key(entry)),
      `${MODEL_SELECTION_SPEC}: candidateInputDigest записи ${entry.requestItemId}`,
    )
  }
}

/**
 * Подпись выборки. Форма проверяется здесь же, как и у плана: сохранённому
 * значению доверия нет, а подписывать непроверенное незачем.
 *
 * Поток: `UTF8(домен) || 0x0A || канонический JSON выборки`.
 */
export function selectionDigest(selection) {
  if (!isPlainObject(selection)) {
    throw new TypeError(`${MODEL_SELECTION_SPEC}: выборка обязана быть простым объектом`)
  }
  canonicalJsonBytes(selection, MODEL_SELECTION_SPEC)
  assertExactKeys(selection, SELECTION_KEYS, MODEL_SELECTION_SPEC)
  assertExactly(selection.contractVersion, MODEL_SELECTION_SPEC, 'contractVersion')
  assertNonEmptyString(selection.planId, 'planId')
  assertSha256Value(selection.planDigest, 'planDigest')
  if (!Array.isArray(selection.entries)) throw new TypeError('entries: ожидается массив')

  const seen = []
  selection.entries.forEach((entry, i) => {
    const where = `entries[${i}]`
    assertExactKeys(entry, SELECTION_ENTRY_KEYS, where)
    assertSeparatorFree(entry.portalId, `${where}.portalId`)
    if (typeof entry.requestItemId !== 'string' || !REQUEST_ITEM_ID.test(entry.requestItemId)) {
      throw new TypeError(
        `${where}.requestItemId: ожидается ровно 64 строчных hex-знака без префикса, `
        + `получено ${JSON.stringify(entry.requestItemId)}`,
      )
    }
    assertSha256Value(entry.candidateInputDigest, `${where}.candidateInputDigest`)
    seen.push(entry)
  })
  const sorted = [...seen].sort(byPortalThenId)
  if (seen.some((entry, i) => entry !== sorted[i])) {
    throw new TypeError(`${MODEL_SELECTION_SPEC}: записи обязаны быть отсортированы по portalId, затем по requestItemId`)
  }
  const ids = seen.map((entry) => entry.requestItemId)
  if (new Set(ids).size !== ids.length) {
    throw new TypeError(`${MODEL_SELECTION_SPEC}: requestItemId повторяется`)
  }
  return sha256Bytes(canonicalJsonBytes(selection, MODEL_SELECTION_SPEC))
}
