/**
 * Контракт разрешения владельца, `poi-model-approval/v1`.
 *
 * Что проверяется здесь и нигде больше: строгая форма разрешения, привязка
 * к конкретному проверенному плану v2 по каждому продублированному полю,
 * пересчёт отпечатка артефакта и подписи выборки, отношения потолков между
 * собой и против плана, подпись разрешения.
 *
 * Чего здесь нет намеренно: провайдера, сети, денежной арифметики, журнала и
 * любого runtime-артефакта. План и профиль в этом наборе — ФИКСТУРЫ ФОРМЫ:
 * канонический реестр профилей пуст, и production CLI такого плана не строит.
 * «Форма разрешения верна» и «прогон разрешён» — разные утверждения, и
 * второе здесь не делается. `buildModelApproval` собирает артефакт, но
 * полномочий не создаёт: решение владельца приходит в него параметрами, и
 * проверки ниже требуют, чтобы производные поля он вычислял, а не принимал.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as APPROVAL_MODULE from '../scripts/poi-portals/lib/model-approval.mjs'
import {
  APPROVAL_BUILD_KEYS,
  APPROVAL_KEYS,
  APPROVAL_LIMIT_KEYS,
  APPROVAL_RETENTION_DAYS,
  APPROVAL_SIGNED_KEYS,
  approvalDigest,
  buildModelApproval,
  MODEL_APPROVAL_SPEC,
  parseAndVerifyApproval,
} from '../scripts/poi-portals/lib/model-approval.mjs'
import { MODEL_PRICING_SPEC } from '../scripts/poi-portals/lib/model-pricing.mjs'
import {
  assertProviderProfileShape,
  PROVIDER_PROFILE_SPEC,
} from '../scripts/poi-portals/lib/provider-profile.mjs'
import {
  assertSelectionCoversPlan,
  buildModelPlan,
  buildPlanSelection,
  buildPortalPlanFragment,
  MODEL_INPUT_FIELDS,
  MODEL_PLAN_ARTIFACT_SPEC,
  MODEL_PLAN_V2_CONTRACT_VERSION,
  MODEL_SELECTION_SPEC,
  parseAndVerifyModelPlan,
  selectionDigest,
} from '../scripts/poi-portals/lib/model-plan.mjs'
import { evaluatePoiCandidate } from '../scripts/poi-portals/lib/scoring.mjs'
import { safeAdd, safeMul } from '../scripts/lib/canonical-contract.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FX = path.join(HERE, 'fixtures', 'poi-model-plan')

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e.message } }
const clone = (value) => JSON.parse(JSON.stringify(value))

const fixture = async (name) => JSON.parse(await readFile(path.join(FX, name), 'utf8'))
const NOW = new Date('2026-08-13T00:00:00Z')
const CODE_IDENTITY = { commit: '0000000000000000000000000000000000000000', dirty: false }
const awaiting = await fixture('candidates-awaiting.json')
const evaluate = (list) => list.map((c) => ({ candidate: c, verdict: evaluatePoiCandidate(c, { bbox: null }) }))

/* ── Фикстуры: профиль, разрешающая policy, исполняемый план v2 ────────── */

const PROFILE = Object.freeze({
  contractVersion: PROVIDER_PROFILE_SPEC,
  id: 'example-profile',
  version: '1.0.0',
  providerId: 'example-provider',
  modelId: 'example-model',
  modelVersion: '2026-08-01',
  endpoint: 'https://api.example.com/v1/messages',
  apiVersion: '2026-08-01',
  structuredOutput: { mode: 'json-schema-strict', schemaDialect: 'json-schema-draft-2020-12' },
  serializer: { id: 'node-json', version: '1.0.0' },
  capabilities: {
    idempotencyKey: { supported: true, header: 'idempotency-key', scope: 'request' },
    statusEndpoint: { supported: true, billable: false, path: '/v1/messages/status' },
    batch: { supported: false, returnsRequestItemId: null },
  },
  pricingTableDigest: {
    value: `sha256:${'0'.repeat(64)}`, algorithm: 'sha256', spec: MODEL_PRICING_SPEC,
  },
})
t('фикстура профиля валидна по production-границе',
  boom(() => assertProviderProfileShape(PROFILE)), '(без ошибки)')

const ALLOW = Object.freeze({
  purpose: 'classification',
  allowedProviders: [PROFILE.id],
  fields: [...MODEL_INPUT_FIELDS],
  decisionRef: 'owner/2026-08-14',
  reviewedAt: '2026-08-01',
  validUntil: '2026-12-31',
})

const PORTAL_IDS = ['p-alpha', 'p-beta']
const META = {
  planId: 'plan-approval-fixed',
  createdAt: '2026-08-13T00:00:00.000Z',
  deleteAfter: '2026-08-20T00:00:00.000Z',
  codeIdentity: CODE_IDENTITY,
  taxonomyVersion: 'poi-taxonomy/v2',
  taxonomyBytes: Buffer.from('{"version":"poi-taxonomy/v2"}\n', 'utf8'),
  taxonomySpec: 'raw-file-bytes/v1',
  promptText: 'фиксированный промпт',
  schemaObject: { type: 'object', properties: { entityKind: { type: 'string' } } },
  providerProfile: PROFILE,
}
const PLAN = buildModelPlan({
  fragments: PORTAL_IDS.map((id) => buildPortalPlanFragment({
    portal: { id, modelProcessing: ALLOW }, evaluated: evaluate(awaiting), now: NOW, providerProfile: PROFILE,
  })),
  selectedPortalIds: [...PORTAL_IDS],
  meta: META,
})
t('план фикстуры — исполняемый v2', PLAN.contractVersion, MODEL_PLAN_V2_CONTRACT_VERSION)
t('и исполнение разрешено', PLAN.executionPermitted, true)
t('порталов в плане два', PLAN.portals.length, 2)

const VERIFIED = parseAndVerifyModelPlan(clone(PLAN))
const SELECTION = buildPlanSelection(clone(PLAN))
const PLANNED_CANDIDATES = PLAN.portals.reduce((sum, p) => sum + p.plannedItemCount, 0)
const PLANNED_ITEM_BYTES = PLAN.portals
  .flatMap((p) => p.items.map((i) => i.classificationItemBytes))
  .reduce((max, b) => (b > max ? b : max), 0)
t('кандидаты в плане есть', PLANNED_CANDIDATES > 0, true)

const LIMITS = {
  maxCandidates: PLANNED_CANDIDATES,
  maxNetworkRequests: PLANNED_CANDIDATES,
  maxBatchJobs: 0,
  maxItemBytes: PLANNED_ITEM_BYTES,
  maxInputTokens: 100000,
  maxOutputTokens: 20000,
  maxTotalTokens: 120000,
  maxCostMicros: 5000000,
  currency: 'USD',
  pricingTableDigest: { value: `sha256:${'1'.repeat(64)}`, algorithm: 'sha256', spec: MODEL_PRICING_SPEC },
  pricingTableAsOf: '2026-08-01',
  maxRetries: 0,
}

/* Положительная фикстура собирается ПРОДАКШЕН-ПУТЁМ. Ручная сборка доказала
   бы только то, что тест умеет писать JSON: расхождение builder'а с границей
   на ней осталось бы невидимым. Владелец передаёт решение и потолки, всё
   производное считает builder. */
const DECISION = Object.freeze({
  approvalId: 'approval-fixed',
  createdAt: '2026-08-13T00:00:00.000Z',
  validUntil: '2026-08-20T00:00:00.000Z',
  decisionRef: 'owner/2026-08-14',
  approver: 'jumbo',
})
const APPROVAL = buildModelApproval({ plan: clone(PLAN), ...DECISION, limits: clone(LIMITS) })
const UNSIGNED = (() => { const copy = clone(APPROVAL); delete copy.approvalDigest; return copy })()

/* Срок хранения — вычисляемая величина, а не совпадение: тридцать суток
   считаются здесь независимо от модуля и сверяются с зафиксированной датой. */
t('deleteAfter — ровно validUntil плюс срок хранения',
  new Date(Date.parse(APPROVAL.validUntil) + APPROVAL_RETENTION_DAYS * 86400000).toISOString(),
  APPROVAL.deleteAfter)

/* ── Форма модуля ─────────────────────────────────────────────────────── */

t('состав верхнего уровня — восемнадцать ключей', APPROVAL_KEYS.length, 18)
t('подписывается семнадцать', APPROVAL_SIGNED_KEYS.length, 17)
t('вне подписи ровно approvalDigest',
  APPROVAL_KEYS.filter((k) => !APPROVAL_SIGNED_KEYS.includes(k)).join(','), 'approvalDigest')
t('состав потолков — двенадцать ключей', APPROVAL_LIMIT_KEYS.length, 12)
t('списки заморожены', Object.isFrozen(APPROVAL_KEYS) && Object.isFrozen(APPROVAL_LIMIT_KEYS), true)
t('срок хранения — тридцать суток', APPROVAL_RETENTION_DAYS, 30)
t('домен разрешения', MODEL_APPROVAL_SPEC, 'poi-model-approval/v1')

/* Регулярное выражение наружу не выдаётся: экспортированный RegExp —
   изменяемая глобальная политика, `compile('.*')` у одного импортёра
   отключил бы проверку у всех. */
t('модуль не экспортирует ни одного RegExp',
  Object.values(APPROVAL_MODULE).some((v) => v instanceof RegExp), false)
t('экспортов ровно девять', Object.keys(APPROVAL_MODULE).length, 9)
t('параметров сборки ровно семь', APPROVAL_BUILD_KEYS.length, 7)

/* ── Положительный проход ─────────────────────────────────────────────── */

const verified = parseAndVerifyApproval({ approval: clone(APPROVAL), plan: clone(PLAN) })
t('разрешение проходит границу', typeof verified.approval, 'object')
t('возврат — ровно два поля', Object.keys(verified).sort().join(','), 'approval,plan')
t('вернулся тот же план', verified.plan.planDigest.value, PLAN.planDigest.value)
t('результат заморожен на глубине', Object.isFrozen(verified.approval.limits), true)
t('заморожен и вложенный digest', Object.isFrozen(verified.approval.planDigest), true)
t('подпись разрешения — своя спецификация', verified.approval.approvalDigest.spec, MODEL_APPROVAL_SPEC)
t('отпечаток артефакта плана — своя спецификация',
  verified.approval.planArtifactDigest.spec, MODEL_PLAN_ARTIFACT_SPEC)
t('и он равен пересчитанному по плану',
  verified.approval.planArtifactDigest.value, VERIFIED.planArtifactDigest.value)
t('подпись разрешения отличается от подписи плана',
  verified.approval.approvalDigest.value === PLAN.planDigest.value, false)

/* Вход вызывающего не трогается: заморозка чужого объекта — побочный эффект,
   о котором никто не просил. */
const untouched = clone(APPROVAL)
parseAndVerifyApproval({ approval: untouched, plan: clone(PLAN) })
t('чужой объект не заморожен', Object.isFrozen(untouched), false)

/* Порядок свойств на подпись не влияет: канонизация сортирует ключи. */
const shuffled = {}
for (const key of [...APPROVAL_KEYS].reverse()) shuffled[key] = clone(APPROVAL[key])
t('порядок свойств разрешения на подпись не влияет',
  approvalDigest(shuffled), APPROVAL.approvalDigest.value)
t('и перемешанное разрешение проходит границу',
  boom(() => parseAndVerifyApproval({ approval: shuffled, plan: clone(PLAN) })), '(без ошибки)')

/* Закреплённый ответ: поток байтов подписи меняться не имеет права молча. */
const KNOWN_APPROVAL_DIGEST = 'sha256:349f99cba3b0a79b1a98ab7c364601822a60c92d204a59a4f18276bedb9fc5aa'
t('подпись разрешения совпала с зафиксированной',
  APPROVAL.approvalDigest.value, KNOWN_APPROVAL_DIGEST)

/* ── Отказы: форма и состав ───────────────────────────────────────────── */

const rejects = (label, mutate, pattern) => {
  const copy = clone(APPROVAL)
  mutate(copy)
  const message = boom(() => parseAndVerifyApproval({ approval: copy, plan: clone(PLAN) }))
  t(label, pattern.test(message), true)
  if (!pattern.test(message)) bad.push(`  ↑ сообщение было: ${message}`)
}
/* Пересчёт подписи после порчи: иначе КАЖДЫЙ отказ объяснялся бы
   расхождением approvalDigest, и ни одна проверка содержания не была бы
   доказана. Подпись здесь честная, а отвергается именно содержание. */
const rejectsResigned = (label, mutate, pattern) => {
  const copy = clone(APPROVAL)
  delete copy.approvalDigest
  mutate(copy)
  copy.approvalDigest = { value: approvalDigest(copy), algorithm: 'sha256', spec: MODEL_APPROVAL_SPEC }
  const message = boom(() => parseAndVerifyApproval({ approval: copy, plan: clone(PLAN) }))
  t(label, pattern.test(message), true)
  if (!pattern.test(message)) bad.push(`  ↑ сообщение было: ${message}`)
}

t('не объект отвергается',
  /простым объектом/.test(boom(() => parseAndVerifyApproval({ approval: null, plan: clone(PLAN) }))), true)
t('массив отвергается',
  /простым объектом/.test(boom(() => parseAndVerifyApproval({ approval: [], plan: clone(PLAN) }))), true)

for (const key of APPROVAL_KEYS) {
  rejects(`без верхнего ключа ${key} разрешение отвергается`, (a) => { delete a[key] },
    /нет обязательных полей|ожидается простой объект/)
}
rejects('лишний верхний ключ отвергается', (a) => { a.granted = true }, /лишние поля granted/)
rejectsResigned('чужая версия контракта отвергается',
  (a) => { a.contractVersion = 'poi-model-approval/v2' }, /contractVersion/)

for (const key of ['approvalId', 'decisionRef', 'approver']) {
  rejectsResigned(`пустой ${key} отвергается`, (a) => { a[key] = '' }, new RegExp(key))
  rejectsResigned(`нестроковый ${key} отвергается`, (a) => { a[key] = 7 }, new RegExp(key))
}

/* Неперечисляемое свойство: `Object.keys` его не видит, в подпись оно не
   попадёт, а в объекте останется. Отказ до чтения значений. */
t('неперечисляемое поле разрешения отвергается',
  /неперечисл|перечисл/.test(boom(() => {
    const copy = clone(APPROVAL)
    Object.defineProperty(copy, 'granted', { value: true, enumerable: false })
    return parseAndVerifyApproval({ approval: copy, plan: clone(PLAN) })
  })), true)

/* ── Отказы: сроки ────────────────────────────────────────────────────── */

rejectsResigned('validUntil раньше createdAt отвергается',
  (a) => { a.validUntil = '2026-08-12T00:00:00.000Z'; a.deleteAfter = '2026-09-11T00:00:00.000Z' },
  /validUntil обязан быть строго позже createdAt/)
rejectsResigned('validUntil равный createdAt отвергается',
  (a) => { a.validUntil = a.createdAt; a.deleteAfter = '2026-09-12T00:00:00.000Z' },
  /validUntil обязан быть строго позже createdAt/)
rejectsResigned('deleteAfter на сутки короче отвергается',
  (a) => { a.deleteAfter = '2026-09-18T00:00:00.000Z' }, /deleteAfter/)
rejectsResigned('deleteAfter на сутки длиннее отвергается',
  (a) => { a.deleteAfter = '2026-09-20T00:00:00.000Z' }, /deleteAfter/)
rejectsResigned('deleteAfter «то же число через месяц» отвергается',
  (a) => { a.deleteAfter = '2026-09-20T00:00:00.000Z' }, /deleteAfter/)
for (const [label, value] of [
  ['без миллисекунд', '2026-08-20T00:00:00Z'],
  ['со смещением', '2026-08-20T00:00:00.000+00:00'],
  ['несуществующий момент', '2026-02-30T00:00:00.000Z'],
]) {
  rejectsResigned(`validUntil ${label} отвергается`, (a) => { a.validUntil = value },
    /validUntil/)
}

/* ── Отказы: привязка к плану ─────────────────────────────────────────── */

rejectsResigned('чужой planId отвергается', (a) => { a.planId = 'plan-другой' }, /planId/)
rejectsResigned('чужая подпись плана отвергается',
  (a) => { a.planDigest.value = `sha256:${'a'.repeat(64)}` }, /planDigest/)
rejectsResigned('чужая спецификация подписи плана отвергается',
  (a) => { a.planDigest.spec = 'poi-model-plan/v1' }, /planDigest/)
rejectsResigned('чужой planCreatedAt отвергается',
  (a) => { a.planCreatedAt = '2026-08-12T00:00:00.000Z' }, /planCreatedAt/)
rejectsResigned('чужой planDeleteAfter отвергается',
  (a) => { a.planDeleteAfter = '2026-08-21T00:00:00.000Z' }, /planDeleteAfter/)
rejectsResigned('чужой отпечаток артефакта отвергается',
  (a) => { a.planArtifactDigest.value = `sha256:${'b'.repeat(64)}` }, /planArtifactDigest/)
rejectsResigned('чужая идентичность кода отвергается',
  (a) => { a.codeIdentity.commit = '1'.repeat(40) }, /codeIdentity\.commit/)
rejectsResigned('грязная идентичность кода отвергается',
  (a) => { a.codeIdentity.dirty = true }, /dirty/)
rejectsResigned('чужой отпечаток профиля отвергается',
  (a) => { a.providerProfileDigest.value = `sha256:${'c'.repeat(64)}` }, /providerProfileDigest/)
rejectsResigned('чужая подпись выборки отвергается',
  (a) => { a.selectionDigest.value = `sha256:${'d'.repeat(64)}` }, /selectionDigest/)

/* Отпечаток артефакта пересчитывается, а не читается: поля, которые в
   подпись плана не входят, меняют артефакт — и разрешение обязано это
   заметить, даже когда planDigest сходится. */
const otherArtifact = clone(PLAN)
otherArtifact.planId = 'plan-другой'
t('planDigest у другого файла тот же',
  parseAndVerifyModelPlan(clone(otherArtifact)).plan.planDigest.value, PLAN.planDigest.value)
t('а отпечаток артефакта другой',
  parseAndVerifyModelPlan(clone(otherArtifact)).planArtifactDigest.value
    === VERIFIED.planArtifactDigest.value, false)
t('разрешение поверх другого файла того же плана отвергается',
  /planId/.test(boom(() => parseAndVerifyApproval({
    approval: clone(APPROVAL), plan: otherArtifact,
  }))), true)

/* ── Отказы: список источников ────────────────────────────────────────── */

rejectsResigned('неотсортированный список источников отвергается',
  (a) => { a.allowedPortalIds = [...PORTAL_IDS].reverse() }, /отсортирован/)
rejectsResigned('повтор в списке источников отвергается',
  (a) => { a.allowedPortalIds = [PORTAL_IDS[0], PORTAL_IDS[0]] }, /повтор/)
rejectsResigned('подмножество источников отвергается',
  (a) => { a.allowedPortalIds = [PORTAL_IDS[0]] }, /allowedPortalIds против порталов плана/)
rejectsResigned('лишний источник отвергается',
  (a) => { a.allowedPortalIds = [...PORTAL_IDS, 'p-гамма'].sort() },
  /allowedPortalIds против порталов плана/)
rejectsResigned('пустой список источников отвергается',
  (a) => { a.allowedPortalIds = [] }, /allowedPortalIds против порталов плана/)

/* ── Отказы: план не тот ──────────────────────────────────────────────── */

const planV1 = await (async () => {
  const { ...metaV1 } = META
  delete metaV1.providerProfile
  return buildModelPlan({
    fragments: PORTAL_IDS.map((id) => buildPortalPlanFragment({
      portal: { id, modelProcessing: { ...ALLOW, allowedProviders: [] } },
      evaluated: evaluate(awaiting), now: NOW,
    })),
    selectedPortalIds: [...PORTAL_IDS],
    meta: metaV1,
  })
})()
t('диагностический план v1 построен', planV1.contractVersion, 'poi-model-plan/v1')
t('разрешение поверх плана v1 отвергается',
  /plan\.contractVersion/.test(boom(() => parseAndVerifyApproval({
    approval: clone(APPROVAL), plan: clone(planV1),
  }))), true)

const planDenied = buildModelPlan({
  fragments: [
    buildPortalPlanFragment({
      portal: { id: PORTAL_IDS[0], modelProcessing: ALLOW },
      evaluated: evaluate(awaiting), now: NOW, providerProfile: PROFILE,
    }),
    buildPortalPlanFragment({
      portal: { id: PORTAL_IDS[1], modelProcessing: { ...ALLOW, allowedProviders: ['другой-профиль'] } },
      evaluated: evaluate(awaiting), now: NOW, providerProfile: PROFILE,
    }),
  ],
  selectedPortalIds: [...PORTAL_IDS],
  meta: META,
})
t('план с запрещённым порталом неисполним', planDenied.executionPermitted, false)
t('разрешение поверх неисполнимого плана отвергается',
  /plan\.executionPermitted/.test(boom(() => parseAndVerifyApproval({
    approval: clone(APPROVAL), plan: clone(planDenied),
  }))), true)

/* ── Отказы: потолки ──────────────────────────────────────────────────── */

const rejectsLimit = (label, mutate, pattern) => rejectsResigned(label, (a) => mutate(a.limits), pattern)

for (const key of APPROVAL_LIMIT_KEYS) {
  rejectsLimit(`без потолка ${key} разрешение отвергается`, (l) => { delete l[key] },
    /нет обязательных полей/)
}
rejectsLimit('лишний потолок отвергается', (l) => { l.unlimited = true }, /лишние поля unlimited/)

for (const key of ['maxCandidates', 'maxNetworkRequests', 'maxItemBytes',
  'maxInputTokens', 'maxOutputTokens', 'maxTotalTokens', 'maxCostMicros']) {
  rejectsLimit(`нулевой ${key} отвергается`, (l) => { l[key] = 0 }, new RegExp(key))
  rejectsLimit(`дробный ${key} отвергается`, (l) => { l[key] = 1.5 }, new RegExp(key))
  rejectsLimit(`строковый ${key} отвергается`, (l) => { l[key] = '10' }, new RegExp(key))
  rejectsLimit(`небезопасно большой ${key} отвергается`,
    (l) => { l[key] = Number.MAX_SAFE_INTEGER + 2 }, new RegExp(key))
}

rejectsLimit('потолок кандидатов ниже спланированного отвергается',
  (l) => { l.maxCandidates = PLANNED_CANDIDATES - 1; l.maxNetworkRequests = PLANNED_CANDIDATES - 1 },
  /maxCandidates: потолок .* меньше уже спланированных/)
rejectsLimit('обращений меньше кандидатов отвергается',
  (l) => { l.maxNetworkRequests = PLANNED_CANDIDATES - 1 },
  /maxNetworkRequests: .* меньше числа кандидатов/)
rejectsLimit('обращений больше потолка попыток отвергается',
  (l) => { l.maxNetworkRequests = PLANNED_CANDIDATES + 1 },
  /maxNetworkRequests: .* больше потолка попыток/)
rejectsLimit('повторы не ноль — отвергается', (l) => { l.maxRetries = 1 }, /maxRetries/)
rejectsLimit('партии не ноль — отвергается', (l) => { l.maxBatchJobs = 1 }, /maxBatchJobs/)
rejectsLimit('потолок байтов записи ниже спланированного отвергается',
  (l) => { l.maxItemBytes = PLANNED_ITEM_BYTES - 1 },
  /maxItemBytes: потолок .* меньше самой большой/)
rejectsLimit('общий потолок токенов ниже суммы частей отвергается',
  (l) => { l.maxTotalTokens = l.maxInputTokens + l.maxOutputTokens - 1 },
  /maxTotalTokens: .* меньше суммы потолков/)
t('общий потолок ровно по сумме частей принимается', (() => {
  const copy = clone(APPROVAL)
  delete copy.approvalDigest
  copy.limits.maxTotalTokens = copy.limits.maxInputTokens + copy.limits.maxOutputTokens
  copy.approvalDigest = { value: approvalDigest(copy), algorithm: 'sha256', spec: MODEL_APPROVAL_SPEC }
  return boom(() => parseAndVerifyApproval({ approval: copy, plan: clone(PLAN) }))
})(), '(без ошибки)')

for (const [label, value] of [
  ['строчными', 'usd'], ['смешанным регистром', 'Usd'], ['двумя буквами', 'US'],
  ['четырьмя буквами', 'USDX'], ['цифрами', 'US1'], ['с пробелом', 'US '],
  ['пустой строкой', ''], ['числом', 840],
]) {
  rejectsLimit(`валюта ${label} отвергается`, (l) => { l.currency = value }, /currency/)
}
rejectsLimit('чужая спецификация таблицы цен отвергается',
  (l) => { l.pricingTableDigest.spec = 'poi-model-plan/v1' }, /pricingTableDigest/)
rejectsLimit('битое значение отпечатка таблицы цен отвергается',
  (l) => { l.pricingTableDigest.value = 'sha256:короткий' }, /pricingTableDigest/)
for (const [label, value] of [
  ['несуществующая дата', '2026-02-30'], ['с временем', '2026-08-01T00:00:00.000Z'],
  ['без ведущего нуля', '2026-8-1'], ['числом', 20260801],
]) {
  rejectsLimit(`дата таблицы цен ${label} отвергается`,
    (l) => { l.pricingTableAsOf = value }, /pricingTableAsOf/)
}

/* Денежная арифметика здесь не выполняется: потолок стоимости объявлен и
   проверен на форму, но ни на что не умножается. Доказательство — сумма,
   заведомо не сходящаяся ни с какой таблицей цен, проходит границу. */
t('нелепый по величине потолок стоимости формой не отвергается', (() => {
  const copy = clone(APPROVAL)
  delete copy.approvalDigest
  copy.limits.maxCostMicros = 1
  copy.approvalDigest = { value: approvalDigest(copy), algorithm: 'sha256', spec: MODEL_APPROVAL_SPEC }
  return boom(() => parseAndVerifyApproval({ approval: copy, plan: clone(PLAN) }))
})(), '(без ошибки)')

/* ── Подпись разрешения ───────────────────────────────────────────────── */

for (const key of APPROVAL_SIGNED_KEYS) {
  const copy = clone(APPROVAL)
  delete copy.approvalDigest
  const before = approvalDigest(copy)
  if (typeof copy[key] === 'string') copy[key] = `${copy[key]}х`
  else if (typeof copy[key] === 'object') copy[key] = { ...copy[key], zzz: 1 }
  t(`изменение подписываемого ключа ${key} меняет подпись`, approvalDigest(copy) === before, false)
}
/* Поимённо, отдельно от цикла выше: цикл ходит по тому же списку, который
   и проверяет, поэтому сузившийся список сузил бы вместе с собой проверку.
   Эти три поля названы здесь буквально и из списка не выводятся. */
const resign = (mutate) => { const copy = clone(UNSIGNED); mutate(copy); return approvalDigest(copy) }
t('изменение потолков меняет подпись',
  resign((a) => { a.limits.maxCostMicros += 1 }) === APPROVAL.approvalDigest.value, false)
t('изменение срока действия меняет подпись',
  resign((a) => { a.validUntil = '2026-08-21T00:00:00.000Z' }) === APPROVAL.approvalDigest.value, false)
t('изменение approvalId меняет подпись',
  resign((a) => { a.approvalId = 'approval-другой' }) === APPROVAL.approvalDigest.value, false)
t('изменение allowedPortalIds меняет подпись',
  resign((a) => { a.allowedPortalIds = [...a.allowedPortalIds].reverse() }) === APPROVAL.approvalDigest.value,
  false)

rejects('подмена подписи разрешения отвергается',
  (a) => { a.approvalDigest.value = `sha256:${'e'.repeat(64)}` }, /approvalDigest не сходится/)
rejects('чужая спецификация подписи разрешения отвергается',
  (a) => { a.approvalDigest.spec = MODEL_SELECTION_SPEC }, /approvalDigest/)
t('подпись считается и по разрешению без неё, и по подписанному',
  approvalDigest(UNSIGNED), approvalDigest(APPROVAL))
t('подпись сама в поток не входит',
  approvalDigest({ ...UNSIGNED, approvalDigest: { value: `sha256:${'f'.repeat(64)}`, algorithm: 'sha256', spec: MODEL_APPROVAL_SPEC } }),
  approvalDigest(UNSIGNED))
t('без подписываемого ключа подпись не считается',
  /нет обязательных полей approvalId/.test(boom(() => {
    const copy = clone(UNSIGNED); delete copy.approvalId; return approvalDigest(copy)
  })), true)
t('с лишним ключом подпись не считается',
  /лишние поля/.test(boom(() => approvalDigest({ ...UNSIGNED, granted: true }))), true)

/* ── Сборка разрешения production-путём ───────────────────────────────── */

t('собранное разрешение проходит собственную границу',
  boom(() => parseAndVerifyApproval({ approval: clone(APPROVAL), plan: clone(PLAN) })), '(без ошибки)')
t('builder возвращает замороженный результат', Object.isFrozen(APPROVAL.limits), true)

/* Производное вычисляется, а не принимается. Каждое поле проверяется
   отдельно: совпадение всего объекта скрыло бы, какое из них builder на
   самом деле считает, а какое просто скопировал из входа — входа у них нет. */
t('deleteAfter вычислен из validUntil', APPROVAL.deleteAfter, '2026-09-19T00:00:00.000Z')
t('planId взят из плана', APPROVAL.planId, PLAN.planId)
t('подпись плана взята из плана', APPROVAL.planDigest.value, PLAN.planDigest.value)
t('planCreatedAt взят из плана', APPROVAL.planCreatedAt, PLAN.createdAt)
t('planDeleteAfter взят из плана', APPROVAL.planDeleteAfter, PLAN.deleteAfter)
t('отпечаток артефакта пересчитан builder-ом',
  APPROVAL.planArtifactDigest.value, VERIFIED.planArtifactDigest.value)
t('идентичность кода взята из плана', APPROVAL.codeIdentity.commit, PLAN.codeIdentity.commit)
t('отпечаток профиля взят из плана',
  APPROVAL.providerProfileDigest.value, PLAN.providerProfileDigest.value)
t('список источников выведен из плана и отсортирован',
  APPROVAL.allowedPortalIds.join(','), [...PORTAL_IDS].sort().join(','))
t('подпись выборки пересчитана по плану',
  APPROVAL.selectionDigest.value, selectionDigest(SELECTION))
t('решение владельца перенесено дословно',
  [APPROVAL.approvalId, APPROVAL.createdAt, APPROVAL.validUntil, APPROVAL.decisionRef, APPROVAL.approver].join('|'),
  [DECISION.approvalId, DECISION.createdAt, DECISION.validUntil, DECISION.decisionRef, DECISION.approver].join('|'))

/* Список параметров закрыт: связь, объявленная снаружи вместо выведенной,
   отвергается по имени параметра, а не игнорируется деструктуризацией. */
for (const extra of ['planId', 'planDigest', 'deleteAfter', 'approvalDigest', 'allowedPortalIds']) {
  t(`builder отвергает переданное производное поле ${extra}`,
    /лишние поля/.test(boom(() => buildModelApproval({
      plan: clone(PLAN), ...DECISION, limits: clone(LIMITS), [extra]: 'что-нибудь',
    }))), true)
}
for (const missing of APPROVAL_BUILD_KEYS) {
  const input = { plan: clone(PLAN), ...DECISION, limits: clone(LIMITS) }
  delete input[missing]
  t(`builder отвергает вызов без параметра ${missing}`,
    /нет обязательных полей/.test(boom(() => buildModelApproval(input))), true)
}
t('builder отвергает не объект',
  /простым объектом/.test(boom(() => buildModelApproval(null))), true)

/* Builder проверяет план тем же правилом, что и граница. */
t('builder отвергает диагностический план v1',
  /plan\.contractVersion/.test(boom(() => buildModelApproval({
    plan: clone(planV1), ...DECISION, limits: clone(LIMITS),
  }))), true)
t('builder отвергает неисполнимый план',
  /plan\.executionPermitted/.test(boom(() => buildModelApproval({
    plan: clone(planDenied), ...DECISION, limits: clone(LIMITS),
  }))), true)
t('builder отвергает потолок ниже спланированного',
  /maxCandidates/.test(boom(() => buildModelApproval({
    plan: clone(PLAN), ...DECISION,
    limits: { ...clone(LIMITS), maxCandidates: 1, maxNetworkRequests: 1 },
  }))), true)
t('builder отвергает несогласованный срок',
  /validUntil обязан быть строго позже createdAt/.test(boom(() => buildModelApproval({
    plan: clone(PLAN), ...DECISION, validUntil: '2026-08-12T00:00:00.000Z', limits: clone(LIMITS),
  }))), true)

/* Вход вызывающего builder не трогает и результат не подменяет входом. */
const buildInput = { plan: clone(PLAN), ...DECISION, limits: clone(LIMITS) }
buildModelApproval(buildInput)
t('builder не заморозил вход', Object.isFrozen(buildInput.limits), false)
t('builder детерминирован', buildModelApproval({
  plan: clone(PLAN), ...DECISION, limits: clone(LIMITS),
}).approvalDigest.value, APPROVAL.approvalDigest.value)

/* Другое решение владельца — другая подпись: решение входит в подпись. */
t('другой approver даёт другую подпись', buildModelApproval({
  plan: clone(PLAN), ...DECISION, approver: 'другой', limits: clone(LIMITS),
}).approvalDigest.value === APPROVAL.approvalDigest.value, false)
t('другие потолки дают другую подпись', buildModelApproval({
  plan: clone(PLAN), ...DECISION, limits: { ...clone(LIMITS), maxCostMicros: LIMITS.maxCostMicros + 1 },
}).approvalDigest.value === APPROVAL.approvalDigest.value, false)

/* ── Строгая форма ВХОДА builder'а ────────────────────────────────────── */

/* `assertExactKeys` смотрит на проекцию `Object.keys`: скрытого и
   символьного свойства он не видит, accessor читает как значение. Без
   канонизации всего входа четыре разных объекта дали бы одно разрешение с
   одной подписью, и «параметров ровно семь» доказывало бы только то, что
   лишнее восьмое умеет прятаться. */
const buildInputOf = (mutate) => {
  const input = { plan: clone(PLAN), ...DECISION, limits: clone(LIMITS) }
  mutate(input)
  return input
}
const inputCases = [
  ['скрытый planId', buildInputOf((input) => {
    Object.defineProperty(input, 'planId', { value: 'чужой-план', enumerable: false })
  })],
  ['скрытое поле верхнего уровня', buildInputOf((input) => {
    Object.defineProperty(input, 'granted', { value: true, enumerable: false })
  })],
  ['символьное поле', buildInputOf((input) => { input[Symbol('granted')] = true })],
  ['accessor у approvalId', buildInputOf((input) => {
    delete input.approvalId
    Object.defineProperty(input, 'approvalId', { get: () => 'approval-fixed', enumerable: true })
  })],
  ['скрытое поле внутри потолков', buildInputOf((input) => {
    Object.defineProperty(input.limits, 'unlimited', { value: true, enumerable: false })
  })],
  ['символьное поле внутри потолков', buildInputOf((input) => {
    input.limits[Symbol('unlimited')] = true
  })],
  ['accessor внутри потолков', buildInputOf((input) => {
    delete input.limits.maxCandidates
    Object.defineProperty(input.limits, 'maxCandidates', { get: () => 1_000_000, enumerable: true })
  })],
  ['скрытое поле внутри плана', buildInputOf((input) => {
    Object.defineProperty(input.plan, 'granted', { value: true, enumerable: false })
  })],
]
for (const [label, input] of inputCases) {
  const message = boom(() => buildModelApproval(input))
  t(`builder отвергает вход: ${label}`, message !== '(без ошибки)', true)
  t(`и «${label}» не даёт разрешения с обычной подписью`,
    message === APPROVAL.approvalDigest.value, false)
}
/* Тот же вход без порчи разрешение всё же даёт — иначе отказы выше
   доказывали бы лишь то, что builder перестал работать. */
t('неиспорченный вход разрешение получает',
  buildModelApproval(buildInputOf(() => {})).approvalDigest.value, APPROVAL.approvalDigest.value)

/* ── Строгая форма исходного объекта в публичной approvalDigest ───────── */

/* Проекция идёт через `Object.keys`: скрытое, символьное и accessor-свойство
   исчезли бы до канонизации, и три разных объекта получили бы один digest.
   Отказ, а не молчаливая потеря. */
const hidden = clone(UNSIGNED)
Object.defineProperty(hidden, 'granted', { value: true, enumerable: false })
const symbolic = clone(UNSIGNED)
symbolic[Symbol('granted')] = true
const accessor = clone(UNSIGNED)
Object.defineProperty(accessor, 'granted', { get: () => true, enumerable: true })
const nestedHidden = clone(UNSIGNED)
Object.defineProperty(nestedHidden.limits, 'unlimited', { value: true, enumerable: false })
const nestedSymbol = clone(UNSIGNED)
nestedSymbol.limits[Symbol('unlimited')] = true

for (const [label, object] of [
  ['скрытое поле', hidden], ['символьное поле', symbolic], ['accessor-свойство', accessor],
  ['скрытое поле внутри потолков', nestedHidden], ['символьное поле внутри потолков', nestedSymbol],
]) {
  t(`approvalDigest отвергает ${label}`,
    boom(() => approvalDigest(object)) !== '(без ошибки)', true)
  t(`и не выдаёт для «${label}» ту же подпись, что для обычного объекта`,
    boom(() => approvalDigest(object)) === APPROVAL.approvalDigest.value, false)
}
t('обычный объект подпись всё же получает', approvalDigest(clone(UNSIGNED)), APPROVAL.approvalDigest.value)

/* Та же строгость на границе и в builder'е — теми же объектами. */
t('граница отвергает разрешение со скрытым полем',
  boom(() => parseAndVerifyApproval({ approval: hidden, plan: clone(PLAN) })) !== '(без ошибки)', true)
t('builder отвергает потолки со скрытым полем',
  boom(() => buildModelApproval({
    plan: clone(PLAN), ...DECISION, limits: nestedHidden.limits,
  })) !== '(без ошибки)', true)

/* ── Граница потребителя: выборка против плана ────────────────────────── */

t('assertSelectionCoversPlan экспортирована',
  typeof assertSelectionCoversPlan, 'function')
t('полная выборка покрывает план',
  boom(() => assertSelectionCoversPlan(clone(SELECTION), clone(PLAN))), '(без ошибки)')
t('выборка без одной записи отвергается',
  /записи выборки против плана/.test(boom(() => {
    const short = clone(SELECTION); short.entries.pop(); return assertSelectionCoversPlan(short, clone(PLAN))
  })), true)
t('выборка с лишним ключом отвергается границей',
  /лишние поля/.test(boom(() => {
    const fat = clone(SELECTION); fat.approved = true
    return assertSelectionCoversPlan(fat, clone(PLAN))
  })), true)
t('выборка с битой записью отвергается границей',
  /requestItemId/.test(boom(() => {
    const broken = clone(SELECTION); broken.entries[0].requestItemId = 'НЕ-HEX'
    return assertSelectionCoversPlan(broken, clone(PLAN))
  })), true)
t('выборка с чужим planId отвергается',
  /planId/.test(boom(() => {
    const other = clone(SELECTION); other.planId = 'plan-другой'
    return assertSelectionCoversPlan(other, clone(PLAN))
  })), true)
t('выборка с чужой подписью плана отвергается',
  /planDigest/.test(boom(() => {
    const other = clone(SELECTION); other.planDigest = `sha256:${'a'.repeat(64)}`
    return assertSelectionCoversPlan(other, clone(PLAN))
  })), true)
t('перестановка candidateInputDigest между записями отвергается',
  /candidateInputDigest/.test(boom(() => {
    const swapped = clone(SELECTION)
    const [a, b] = [swapped.entries[0], swapped.entries[1]]
    const keep = a.candidateInputDigest
    a.candidateInputDigest = b.candidateInputDigest
    b.candidateInputDigest = keep
    return assertSelectionCoversPlan(swapped, clone(PLAN))
  })), true)
t('непроверенный план границей не принимается',
  /planDigest не сходится/.test(boom(() => {
    const broken = clone(PLAN); broken.portals[0].plannedItemCount += 0; broken.planDigest.value = `sha256:${'0'.repeat(64)}`
    return assertSelectionCoversPlan(clone(SELECTION), broken)
  })), true)

/* ── Безопасная арифметика ────────────────────────────────────────────── */

t('safeAdd складывает', safeAdd(2, 3, 'проба'), 5)
t('safeMul умножает', safeMul(4, 5, 'проба'), 20)
t('safeAdd отвергает выход за безопасное целое',
  /выходит за безопасное целое/.test(boom(() => safeAdd(Number.MAX_SAFE_INTEGER, 1, 'проба'))), true)
t('safeMul отвергает выход за безопасное целое',
  /выходит за безопасное целое/.test(boom(() => safeMul(94906266, 94906266, 'проба'))), true)
t('обычное сложение на этой паре теряет точность',
  Number.MAX_SAFE_INTEGER + 1 === Number.MAX_SAFE_INTEGER + 2, true)
t('safeAdd отвергает дробное', /безопасное целое/.test(boom(() => safeAdd(1.5, 1, 'проба'))), true)
t('safeMul отвергает отрицательное', /безопасное целое/.test(boom(() => safeMul(-1, 2, 'проба'))), true)
t('safeMul на нуле не делит', safeMul(0, 12345, 'проба'), 0)
t('safeAdd на нулях', safeAdd(0, 0, 'проба'), 0)

console.log(bad.length
  ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ')
  : `✓ контракт разрешения владельца: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
