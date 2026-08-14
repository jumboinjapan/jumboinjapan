/**
 * Контракт разрешения владельца, `poi-model-approval/v1`.
 *
 * Разрешение — не флаг и не строка в конфигурации: это отдельный артефакт,
 * выданный на КОНКРЕТНЫЙ проверенный план, конкретный профиль и конкретную
 * выборку кандидатов, со сроком и с потолками. Всё, что подпись разрешения
 * молча теряет, становится разрешённым без разрешения.
 *
 * Полномочий модуль не выдаёт. `buildModelApproval` — чистая функция: кто
 * разрешил, на основании чего, на какой срок и с какими потолками, приходит
 * снаружи целиком и здесь не придумывается; считается только производное от
 * плана и подпись. Реальное разрешение создаёт владелец локально после
 * owner-коммита; кода, который выдал бы его сам себе, в модуле нет.
 *
 * Денежной арифметики здесь нет. Потолки ОБЪЯВЛЯЮТСЯ и проверяются на форму
 * и на внутренние отношения между собой; консервативную верхнюю границу
 * стоимости считает preflight — по этим потолкам и по закреплённой таблице
 * цен. Вся денежная арифметика обязана жить в одном месте, иначе два места
 * разойдутся молча, и разойдутся они на деньгах.
 *
 * Сети, файловой системы и провайдера модуль не касается.
 */
import { DIGEST_ALGORITHM, sha256Bytes } from '../../lib/byte-digest.mjs'
import {
  assertCanonicalInstant,
  assertCodeIdentity,
  assertDigestShape,
  assertExactKeys,
  assertExactly,
  assertIdentity,
  assertInteger,
  assertNonEmptyString,
  assertStringList,
  canonicalJsonBytes,
  deepFreeze,
  digest,
  isPlainObject,
  isStrictCalendarDate,
  safeAdd,
  safeMul,
} from '../../lib/canonical-contract.mjs'
import { MODEL_PRICING_SPEC } from './model-pricing.mjs'
import { PROVIDER_PROFILE_SPEC } from './provider-profile.mjs'
import {
  assertSelectionCoversPlan,
  buildPlanSelection,
  MODEL_PLAN_ARTIFACT_SPEC,
  MODEL_PLAN_V2_CONTRACT_VERSION,
  MODEL_SELECTION_SPEC,
  parseAndVerifyModelPlan,
  selectionDigest,
} from './model-plan.mjs'

/** Домен разрешения. Входит в подписываемые байты первым полем. */
export const MODEL_APPROVAL_SPEC = 'poi-model-approval/v1'

/**
 * Точный состав разрешения. Единственный список в проекте.
 *
 * Поля плана продублированы в разрешении не для удобства: разрешение обязано
 * быть читаемым и проверяемым САМО, не требуя догадок о том, к какому файлу
 * оно относилось. Сверка с планом от этого не отменяется — наоборот, именно
 * она превращает дубликат в проверяемую привязку.
 */
export const APPROVAL_KEYS = Object.freeze([
  'contractVersion', 'approvalId', 'createdAt', 'validUntil', 'deleteAfter',
  'planId', 'planDigest', 'planCreatedAt', 'planDeleteAfter', 'planArtifactDigest',
  'codeIdentity', 'providerProfileDigest', 'allowedPortalIds', 'selectionDigest',
  'limits', 'decisionRef', 'approver', 'approvalDigest',
])

/**
 * Подписываемая часть — ВСЁ, кроме самой подписи.
 *
 * Здесь это не то же самое, что у плана. У плана `planId`, `createdAt` и
 * `deleteAfter` из подписи исключены, потому что два прогона одного набора
 * обязаны давать один `planDigest`. Разрешение, наоборот, выдаётся один раз
 * на один файл с одним сроком: срок, изменённый после подписи, — это другое
 * разрешение, и подпись обязана это заметить.
 */
export const APPROVAL_SIGNED_KEYS = Object.freeze(
  APPROVAL_KEYS.filter((key) => key !== 'approvalDigest'),
)

/** Точный состав блока потолков. */
export const APPROVAL_LIMIT_KEYS = Object.freeze([
  'maxCandidates', 'maxNetworkRequests', 'maxBatchJobs', 'maxItemBytes',
  'maxInputTokens', 'maxOutputTokens', 'maxTotalTokens', 'maxCostMicros',
  'currency', 'pricingTableDigest', 'pricingTableAsOf', 'maxRetries',
])

/**
 * Срок хранения разрешения после истечения его силы.
 *
 * Ровно тридцать суток, а не «около месяца»: `deleteAfter` — авторитетное
 * поле, по которому уборка удаляет файл, и вычисляемая величина обязана
 * проверяться равенством, а не диапазоном. Календарной арифметики здесь нет
 * и быть не должно: тридцать суток — это ровно 30 × 24 часа, а не «то же
 * число следующего месяца», у которого нет однозначного значения.
 */
export const APPROVAL_RETENTION_DAYS = 30
const APPROVAL_RETENTION_MS = APPROVAL_RETENTION_DAYS * 24 * 60 * 60 * 1000

/**
 * Код валюты: ровно три прописные латинские буквы.
 *
 * Выражение приватно намеренно. Экспортированный `RegExp` — изменяемая
 * глобальная политика: один импортёр вызвал бы `compile('.*')` и отключил бы
 * проверку валюты у всех остальных, а `Object.freeze` этого не закрывает.
 */
const CURRENCY_CODE = /^[A-Z]{3}$/

/**
 * Потолки: форма и внутренние отношения. Денег не считает.
 *
 * Отношения проверяются ПРОТИВ ПЛАНА, а не только между собой: потолок, не
 * покрывающий уже спланированное, — это разрешение, которое исполнить нельзя,
 * и узнать об этом на оплаченном прогоне поздно.
 */
function assertLimitsShape(limits, verified, where) {
  assertExactKeys(limits, APPROVAL_LIMIT_KEYS, where)

  /* Полное число кандидатов плана и самая большая запись — считаются из
     плана, а не берутся из разрешения: величина, которую разрешение сообщает
     о себе, здесь предмет проверки, а не свидетельство. */
  const plannedCandidates = verified.portals.reduce(
    (sum, portal) => safeAdd(sum, portal.plannedItemCount, `${where}: кандидаты плана`), 0,
  )
  const plannedItemBytes = verified.portals
    .flatMap((portal) => portal.items.map((item) => item.classificationItemBytes))
    .reduce((max, bytes) => (bytes > max ? bytes : max), 0)

  /* Повторов в этой версии нет, партий тоже: выразить их нечем, а «ноль»
     объявлен явно, чтобы отсутствие механики не читалось как её разрешение. */
  assertInteger(limits.maxRetries, `${where}.maxRetries`)
  assertExactly(limits.maxRetries, 0, `${where}.maxRetries`)
  assertInteger(limits.maxBatchJobs, `${where}.maxBatchJobs`)
  assertExactly(limits.maxBatchJobs, 0, `${where}.maxBatchJobs`)

  assertInteger(limits.maxCandidates, `${where}.maxCandidates`, 1)
  if (limits.maxCandidates < plannedCandidates) {
    throw new RangeError(
      `${where}.maxCandidates: потолок ${limits.maxCandidates} меньше уже спланированных `
      + `${plannedCandidates} кандидатов — такое разрешение исполнить нельзя`,
    )
  }

  /* Минимум одно обращение на кандидата, максимум — по числу попыток.
     Верхняя граница считается safeMul: посчитанная обычным умножением, она
     при больших потолках потеряла бы точность и разрешила бы больше. */
  assertInteger(limits.maxNetworkRequests, `${where}.maxNetworkRequests`, 1)
  if (limits.maxNetworkRequests < limits.maxCandidates) {
    throw new RangeError(
      `${where}.maxNetworkRequests: ${limits.maxNetworkRequests} меньше числа кандидатов `
      + `${limits.maxCandidates} — синхронно один кандидат требует одного обращения`,
    )
  }
  const attemptsCeiling = safeMul(
    limits.maxCandidates,
    safeAdd(1, limits.maxRetries, `${where}: попытки на кандидата`),
    `${where}: потолок обращений`,
  )
  if (limits.maxNetworkRequests > attemptsCeiling) {
    throw new RangeError(
      `${where}.maxNetworkRequests: ${limits.maxNetworkRequests} больше потолка попыток `
      + `${attemptsCeiling} — потолок повторов обойдён числом обращений`,
    )
  }

  assertInteger(limits.maxItemBytes, `${where}.maxItemBytes`, 1)
  if (limits.maxItemBytes < plannedItemBytes) {
    throw new RangeError(
      `${where}.maxItemBytes: потолок ${limits.maxItemBytes} меньше самой большой `
      + `спланированной записи ${plannedItemBytes} байт`,
    )
  }

  assertInteger(limits.maxInputTokens, `${where}.maxInputTokens`, 1)
  assertInteger(limits.maxOutputTokens, `${where}.maxOutputTokens`, 1)
  assertInteger(limits.maxTotalTokens, `${where}.maxTotalTokens`, 1)
  const tokenFloor = safeAdd(
    limits.maxInputTokens, limits.maxOutputTokens, `${where}: сумма потолков токенов`,
  )
  if (limits.maxTotalTokens < tokenFloor) {
    throw new RangeError(
      `${where}.maxTotalTokens: ${limits.maxTotalTokens} меньше суммы потолков ввода и `
      + `вывода ${tokenFloor} — общий потолок не может быть ниже своих частей`,
    )
  }

  /* Деньги только целым числом микроединиц. Дробное значение здесь означало
     бы, что где-то выше поделили, и потолок стал приблизительным. */
  assertInteger(limits.maxCostMicros, `${where}.maxCostMicros`, 1)
  if (typeof limits.currency !== 'string' || !CURRENCY_CODE.test(limits.currency)) {
    throw new TypeError(
      `${where}.currency: ожидается ровно три прописные латинские буквы, `
      + `получено ${JSON.stringify(limits.currency)}`,
    )
  }
  assertDigestShape(limits.pricingTableDigest, MODEL_PRICING_SPEC, `${where}.pricingTableDigest`)
  if (!isStrictCalendarDate(limits.pricingTableAsOf)) {
    throw new TypeError(
      `${where}.pricingTableAsOf: ожидается существующая календарная дата ГГГГ-ММ-ДД, `
      + `получено ${JSON.stringify(limits.pricingTableAsOf)}`,
    )
  }
}

/**
 * План годится под разрешение только исполняемый.
 *
 * Одна реализация на builder и на границу: разрешение поверх
 * диагностического плана v1 — это разрешение исполнить то, что исполнить
 * нельзя, и два места, проверяющие это по-своему, разошлись бы молча.
 */
function assertExecutablePlan(verified) {
  assertExactly(verified.contractVersion, MODEL_PLAN_V2_CONTRACT_VERSION, 'plan.contractVersion')
  assertExactly(verified.executionPermitted, true, 'plan.executionPermitted')
}

/**
 * Подпись разрешения: `UTF8(домен) || 0x0A || канонический JSON` — та же
 * схема, что у выборки; поток байтов у каждого домена свой.
 *
 * Функция принимает и разрешение без подписи (так его собирает владелец), и
 * подписанное целиком: подпись считается по семнадцати полям, а восемнадцатое
 * в поток не входит и войти не может — самоссылки не бывает.
 */
export function approvalDigest(approval) {
  if (!isPlainObject(approval)) {
    throw new TypeError(`${MODEL_APPROVAL_SPEC}: разрешение обязано быть простым объектом`)
  }
  /* Строгая форма ИСХОДНОГО объекта — до проекции подписываемых ключей.
     Проекция идёт через `Object.keys`, а он не видит символьных,
     неперечисляемых и accessor-свойств: они остались бы в объекте и не
     попали бы в подпись, и три разных runtime-объекта получили бы один
     digest. Подпись перестала бы отвечать на вопрос, ради которого
     считается. Канонизация проверяет это на всей глубине, а не только
     сверху: спрятать поле внутри `limits` не легче, чем снаружи. */
  canonicalJsonBytes(approval, MODEL_APPROVAL_SPEC)
  const keys = Object.keys(approval)
  const extra = keys.filter((key) => !APPROVAL_KEYS.includes(key))
  if (extra.length) {
    throw new TypeError(`${MODEL_APPROVAL_SPEC}: лишние поля ${extra.sort().join(', ')}`)
  }
  const missing = APPROVAL_SIGNED_KEYS.filter((key) => !keys.includes(key))
  if (missing.length) {
    throw new TypeError(`${MODEL_APPROVAL_SPEC}: нет обязательных полей ${missing.join(', ')}`)
  }
  const part = {}
  for (const key of APPROVAL_SIGNED_KEYS) part[key] = approval[key]
  return sha256Bytes(canonicalJsonBytes(part, MODEL_APPROVAL_SPEC))
}

/**
 * Параметры builder'а. Ровно эти и никаких других.
 *
 * Список закрыт намеренно: производные поля вычисляются, а не принимаются.
 * Переданный снаружи `planDigest` или `deleteAfter` — это попытка объявить
 * связь вместо того, чтобы её вывести, и она отвергается по имени параметра,
 * а не молча игнорируется деструктуризацией.
 */
export const APPROVAL_BUILD_KEYS = Object.freeze([
  'plan', 'approvalId', 'createdAt', 'validUntil', 'decisionRef', 'approver', 'limits',
])

/**
 * Сборка разрешения по решению владельца.
 *
 * Полномочий функция не выдаёт и выдать не может: решение приходит снаружи
 * целиком — кто разрешил (`approver`), на основании чего (`decisionRef`), с
 * какого и по какой момент, и с какими потолками. Ни одно из этих значений
 * здесь не придумывается и не подставляется по умолчанию.
 *
 * Функция считает ПРОИЗВОДНОЕ: всё, что выводится из плана, срок хранения и
 * подпись. Файлов, сети и CLI не касается — план приходит значением.
 *
 * Собственный результат проверяется той же границей, что и чужой файл:
 * параметра «не проверять» нет, иначе builder и читатель разошлись бы молча.
 */
export function buildModelApproval(input) {
  if (!isPlainObject(input)) {
    throw new TypeError(`${MODEL_APPROVAL_SPEC}: параметры сборки обязаны быть простым объектом`)
  }
  /* Строгая форма ВСЕГО входа — до состава ключей и до деструктуризации.
     `assertExactKeys` работает через `Object.keys`: скрытого и символьного
     свойства он не видит вовсе, а accessor читает как обычное значение. Такой
     вход прошёл бы состав, деструктуризация вернула бы из него значения, и
     четыре разных объекта дали бы одно разрешение с одной подписью. Проверка
     идёт на всей глубине: спрятать поле внутри `limits` или внутри `plan` не
     легче, чем на верхнем уровне. Канонизация здесь — единственный сторож,
     который смотрит на объект целиком, а не на его проекцию. */
  canonicalJsonBytes(input, `${MODEL_APPROVAL_SPEC}: параметры сборки`)
  assertExactKeys(input, APPROVAL_BUILD_KEYS, `${MODEL_APPROVAL_SPEC}: параметры сборки`)
  const { plan, approvalId, createdAt, validUntil, decisionRef, approver, limits } = input

  const { plan: verified, planArtifactDigest } = parseAndVerifyModelPlan(plan)
  assertExecutablePlan(verified)

  /* Срок хранения — вычисляемая величина, и вычисляется он здесь ровно так
     же, как проверяется на границе: ни календарной арифметики, ни округления
     до суток. */
  const validUntilMs = assertCanonicalInstant(validUntil, 'validUntil')
  const deleteAfter = new Date(
    safeAdd(validUntilMs, APPROVAL_RETENTION_MS, 'deleteAfter: срок хранения'),
  ).toISOString()

  const unsigned = {
    contractVersion: MODEL_APPROVAL_SPEC,
    approvalId,
    createdAt,
    validUntil,
    deleteAfter,
    planId: verified.planId,
    planDigest: { ...verified.planDigest },
    planCreatedAt: verified.createdAt,
    planDeleteAfter: verified.deleteAfter,
    planArtifactDigest: { ...planArtifactDigest },
    codeIdentity: { ...verified.codeIdentity },
    providerProfileDigest: { ...verified.providerProfileDigest },
    /* Порядок входит в подпись, поэтому список сортируется здесь, а не
       ожидается отсортированным от плана. */
    allowedPortalIds: verified.portals.map((portal) => portal.portalId).sort(),
    selectionDigest: digest(
      selectionDigest(buildPlanSelection(plan)), DIGEST_ALGORITHM, MODEL_SELECTION_SPEC,
    ),
    /* Потолки кладутся КАК ЕСТЬ, без structuredClone: клонирование молча
       выбросило бы скрытое, символьное и accessor-свойство, и объект,
       который обязан быть отвергнут, превратился бы в чистый. Строгость
       на всей глубине проверит подпись ниже, а собственную копию сделает
       граница — вход вызывающего от этого не страдает. */
    limits,
    decisionRef,
    approver,
  }
  const approval = {
    ...unsigned,
    approvalDigest: digest(approvalDigest(unsigned), DIGEST_ALGORITHM, MODEL_APPROVAL_SPEC),
  }
  return parseAndVerifyApproval({ approval, plan }).approval
}

/**
 * Единственная проверка разрешения.
 *
 * План принимается СЫРЫМ и проверяется здесь же — вместе с выборкой и
 * отпечатком артефакта. Принять «уже проверенный» план значило бы поверить
 * вызывающему в том единственном утверждении, ради которого эта граница и
 * стоит. Побочный продукт того же прохода — проверенный план; он
 * возвращается, чтобы потребителю не пришлось проверять его третий раз, и
 * обещанием не является: он посчитан здесь.
 *
 * Разрешение годится только для исполняемого плана `poi-model-plan/v2` с
 * `executionPermitted === true`. Разрешение поверх диагностического плана
 * v1 — это разрешение исполнить то, что исполнить нельзя.
 */
export function parseAndVerifyApproval({ approval: raw, plan }) {
  if (!isPlainObject(raw)) {
    throw new TypeError(`${MODEL_APPROVAL_SPEC}: разрешение обязано быть простым объектом`)
  }
  /* Структурная строгость на всей глубине: символьные, accessor- и
     неперечисляемые свойства, разрежённые массивы, неканонические ключи
     индексов, одиночные суррогаты, `-0`, нечисла и циклы отвергаются до
     чтения значений. Второго списка правил формы здесь нет. */
  canonicalJsonBytes(raw, MODEL_APPROVAL_SPEC)

  assertExactKeys(raw, APPROVAL_KEYS, MODEL_APPROVAL_SPEC)
  assertExactly(raw.contractVersion, MODEL_APPROVAL_SPEC, 'contractVersion')

  /* План — первым: он определяет, к чему вообще применимо разрешение, и
     проверять потолки против неизвестного плана незачем. */
  const { plan: verified, planArtifactDigest } = parseAndVerifyModelPlan(plan)
  assertExecutablePlan(verified)

  assertNonEmptyString(raw.approvalId, 'approvalId')
  assertNonEmptyString(raw.decisionRef, 'decisionRef')
  assertNonEmptyString(raw.approver, 'approver')

  const createdAtMs = assertCanonicalInstant(raw.createdAt, 'createdAt')
  const validUntilMs = assertCanonicalInstant(raw.validUntil, 'validUntil')
  if (validUntilMs <= createdAtMs) {
    throw new TypeError(
      `validUntil обязан быть строго позже createdAt: ${raw.createdAt} → ${raw.validUntil}`,
    )
  }
  const deleteAfterMs = assertCanonicalInstant(raw.deleteAfter, 'deleteAfter')
  const expectedDeleteAfterMs = safeAdd(
    validUntilMs, APPROVAL_RETENTION_MS, 'deleteAfter: срок хранения',
  )
  assertExactly(deleteAfterMs, expectedDeleteAfterMs, 'deleteAfter')

  /* Привязка к плану: тождество по каждому продублированному полю.
     Достаточно ли одного `planDigest`? Нет: `planId`, `createdAt` и
     `deleteAfter` в подпись плана не входят, поэтому два разных файла с одной
     подписью существуют законно, и разрешение обязано называть тот, на
     который выдано. */
  assertExactly(raw.planId, verified.planId, 'planId')
  assertDigestShape(raw.planDigest, MODEL_PLAN_V2_CONTRACT_VERSION, 'planDigest')
  assertExactly(raw.planDigest.value, verified.planDigest.value, 'planDigest.value')
  assertCanonicalInstant(raw.planCreatedAt, 'planCreatedAt')
  assertExactly(raw.planCreatedAt, verified.createdAt, 'planCreatedAt')
  assertCanonicalInstant(raw.planDeleteAfter, 'planDeleteAfter')
  assertExactly(raw.planDeleteAfter, verified.deleteAfter, 'planDeleteAfter')

  /* Отпечаток артефакта пересчитывается. Сохранённое значение здесь не
     свидетельство, а предмет проверки: именно на конкретный файл со
     конкретным сроком и выдаётся разрешение. */
  assertDigestShape(raw.planArtifactDigest, MODEL_PLAN_ARTIFACT_SPEC, 'planArtifactDigest')
  assertExactly(
    raw.planArtifactDigest.value, planArtifactDigest.value, 'planArtifactDigest.value',
  )

  /* Идентичность кода: форма — не чистота, поэтому `dirty` проверяется
     отдельно и до сверки с планом. Разрешение, подписанное грязным деревом,
     выглядит проверяемым, не будучи им. */
  assertCodeIdentity(raw.codeIdentity)
  if (raw.codeIdentity.dirty !== false) {
    throw new TypeError(
      `codeIdentity.dirty: отслеживаемое рабочее дерево было изменено, commit `
      + `${raw.codeIdentity.commit} исполняемый код не описывает`,
    )
  }
  assertExactly(raw.codeIdentity.commit, verified.codeIdentity.commit, 'codeIdentity.commit')
  assertExactly(raw.codeIdentity.dirty, verified.codeIdentity.dirty, 'codeIdentity.dirty')

  assertDigestShape(raw.providerProfileDigest, PROVIDER_PROFILE_SPEC, 'providerProfileDigest')
  assertExactly(
    raw.providerProfileDigest.value, verified.providerProfileDigest.value,
    'providerProfileDigest.value',
  )

  /* Список источников отсортирован и без повторов — это проверяет
     `assertStringList`, потому что порядок входит в подпись. Тождество с
     порталами плана — отдельно: подмножество означало бы частичное
     исполнение, которого в этой версии нет. */
  assertStringList(raw.allowedPortalIds, 'allowedPortalIds')
  assertIdentity(
    raw.allowedPortalIds, verified.portals.map((portal) => portal.portalId),
    'allowedPortalIds против порталов плана',
  )

  /* Выборка пересчитывается по полному плану и сверяется с ним той же
     границей, которой её будет сверять исполнитель. Сохранённой подписи
     выборки доверия нет — иначе разрешение выдавалось бы на список,
     который никто не читал. */
  assertDigestShape(raw.selectionDigest, MODEL_SELECTION_SPEC, 'selectionDigest')
  const selection = buildPlanSelection(plan)
  assertSelectionCoversPlan(selection, plan)
  assertExactly(raw.selectionDigest.value, selectionDigest(selection), 'selectionDigest.value')

  assertLimitsShape(raw.limits, verified, 'limits')

  /* Подпись — последней: она покрывает всё проверенное выше, и сходиться ей
     положено уже после того, как проверено содержание. Обратный порядок
     означал бы «подпись сошлась» вместо «разрешение верно». */
  assertDigestShape(raw.approvalDigest, MODEL_APPROVAL_SPEC, 'approvalDigest')
  const recomputed = approvalDigest(raw)
  if (recomputed !== raw.approvalDigest.value) {
    throw new TypeError(
      `approvalDigest не сходится: в артефакте ${raw.approvalDigest.value}, пересчёт даёт `
      + `${recomputed}. Сохранённое значение здесь не свидетельство, а предмет проверки.`,
    )
  }

  /* Возвращается СОБСТВЕННАЯ копия: заморозка чужого объекта — побочный
     эффект, о котором вызывающий не просил. Копия делается после проверок:
     клонировать непроверенное незачем. */
  return deepFreeze({ approval: structuredClone(raw), plan: verified })
}
