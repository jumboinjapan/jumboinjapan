/**
 * Execution-preflight и денежная арифметика — на настоящей временной ФС.
 *
 * Что проверяется здесь и нигде больше: двенадцать ворот all-or-nothing,
 * консервативная верхняя граница стоимости в целых числах с округлением
 * вверх, контракт таблицы цен и то, что ни при успехе, ни при отказе preflight
 * не создаёт журнал и не трогает чужие исполнения.
 *
 * Состояния ворот проверяются ЦЕЛИКОМ, а не срезом «после отказавших —
 * notRun»: `notRun` означает ровно «проверка не исполнялась», и порядок
 * исполнения не равен порядку номеров — P0 нуждается в двух проверенных
 * подписях и потому идёт после P1–P4.
 *
 * Профиль и таблица цен — ФИКСТУРЫ ФОРМЫ: оба канонических реестра пусты, и
 * production-путь к платному прогону недостижим. Фикстура проходит те же
 * границы, что и настоящий артефакт, и «зарегистрирована» этим не становится.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildModelApproval } from '../scripts/poi-portals/lib/model-approval.mjs'
import {
  buildModelPlan,
  buildPortalPlanFragment,
  MODEL_INPUT_FIELDS,
} from '../scripts/poi-portals/lib/model-plan.mjs'
import {
  assertProviderProfileShape,
  providerProfileDigest,
  PROVIDER_PROFILE_SPEC,
} from '../scripts/poi-portals/lib/provider-profile.mjs'
import * as PRICING_MODULE from '../scripts/poi-portals/lib/model-pricing.mjs'
import {
  MODEL_PRICING_SPEC,
  parseAndVerifyPricingTable,
  PRICING_TABLES,
  pricingEntryKey,
  pricingTableDigest,
  resolvePricingTable,
} from '../scripts/poi-portals/lib/model-pricing.mjs'
import {
  assertPricingBinding,
  BUDGET_CODES,
  BudgetError,
  ceilDivMicros,
  computeCostUpperBound,
} from '../scripts/poi-portals/lib/execution-cost.mjs'
import {
  createArtifactStore,
  FILE_IO,
  JOURNAL_FILE_NAME,
} from '../scripts/poi-portals/lib/execution-journal.mjs'
import {
  APPROVAL_REJECTION_REASONS,
  ApprovalRejected,
  approvalFileName,
} from '../scripts/poi-portals/lib/approval-store.mjs'
import { EXIT_CODES } from '../scripts/poi-portals/lib/model-execution.mjs'
import {
  budgetFailureCode,
  PREFLIGHT_CODES,
  PREFLIGHT_GATES,
  PREFLIGHT_PHASES,
  runExecutionPreflight,
} from '../scripts/poi-portals/lib/execution-preflight.mjs'
import { main, rerunPortalCandidates } from '../scripts/poi-portals/collect-pois.mjs'
import { digest } from '../scripts/lib/canonical-contract.mjs'
import { DIGEST_ALGORITHM } from '../scripts/lib/byte-digest.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FX = path.join(HERE, 'fixtures', 'poi-model-plan')

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e.message } }
const boomAsync = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e.message } }
const clone = (value) => JSON.parse(JSON.stringify(value))

/* ── Таблица цен ──────────────────────────────────────────────────────── */

const table = (entries, extra = {}) => {
  const body = {
    contractVersion: MODEL_PRICING_SPEC,
    pricingTableAsOf: '2026-08-01',
    currency: 'USD',
    entries,
    ...extra,
  }
  return { ...body, pricingTableDigest: { value: pricingTableDigest({ ...body, pricingTableDigest: null }), algorithm: 'sha256', spec: MODEL_PRICING_SPEC } }
}
const ENTRY = {
  providerId: 'example-provider',
  modelId: 'example-model',
  modelVersion: '2026-08-01',
  inputMicrosPerMillionTokens: 3_000_000,
  outputMicrosPerMillionTokens: 15_000_000,
}
const PRICING = table([ENTRY])

t('таблица проходит production-парсер',
  parseAndVerifyPricingTable(clone(PRICING)).pricingTableDigest.value, PRICING.pricingTableDigest.value)
t('парсер возвращает замороженную копию',
  Object.isFrozen(parseAndVerifyPricingTable(clone(PRICING)).entries[0]), true)
t('канонический реестр таблиц пуст', PRICING_TABLES.length, 0)
t('и заморожен', Object.isFrozen(PRICING_TABLES), true)
t('resolver отказывает на любом отпечатке',
  /реестр пуст/.test(boom(() => resolvePricingTable(PRICING.pricingTableDigest.value))), true)
t('resolver не принимает options',
  PRICING_MODULE.resolvePricingTable.length, 1)
t('подменённый сохранённый отпечаток отвергается',
  /pricingTableDigest не сходится/.test(boom(() => parseAndVerifyPricingTable({
    ...clone(PRICING),
    pricingTableDigest: { value: `sha256:${'0'.repeat(64)}`, algorithm: 'sha256', spec: MODEL_PRICING_SPEC },
  }))), true)

for (const [label, mutate, pattern] of [
  ['чужая версия контракта', (x) => { x.contractVersion = 'poi-model-pricing/v2' }, /contractVersion/],
  ['несуществующая дата', (x) => { x.pricingTableAsOf = '2026-02-30' }, /календарная дата/],
  ['валюта строчными', (x) => { x.currency = 'usd' }, /три прописные/],
  ['валюта из четырёх букв', (x) => { x.currency = 'USDT' }, /три прописные/],
  ['пустой список строк', (x) => { x.entries = [] }, /непустой массив/],
  ['дробная цена', (x) => { x.entries[0].inputMicrosPerMillionTokens = 0.5 }, /inputMicros/],
  ['отрицательная цена', (x) => { x.entries[0].outputMicrosPerMillionTokens = -1 }, /outputMicros/],
  ['пробел в идентификаторе', (x) => { x.entries[0].modelId = ' example-model' }, /пробелы/],
  ['пустой идентификатор', (x) => { x.entries[0].providerId = '' }, /непустая строка/],
  ['лишнее поле строки', (x) => { x.entries[0].лишнее = 1 }, /лишние поля/],
]) {
  const copy = clone(PRICING)
  mutate(copy)
  t(`таблица: ${label} отвергается`, pattern.test(boom(() => parseAndVerifyPricingTable(copy))), true)
}

const twoRows = table([
  ENTRY,
  { ...ENTRY, modelVersion: '2026-09-01' },
].sort((a, b) => (pricingEntryKey(a) < pricingEntryKey(b) ? -1 : 1)))
t('две строки в правильном порядке проходят',
  boom(() => parseAndVerifyPricingTable(clone(twoRows))), '(без ошибки)')
const unsorted = table([{ ...ENTRY, modelVersion: '2026-09-01' }, ENTRY])
t('нарушенный порядок строк отвергается',
  /отсортированы/.test(boom(() => parseAndVerifyPricingTable(clone(unsorted)))), true)
const duplicated = table([ENTRY, ENTRY])
t('повтор составного ключа отвергается',
  /повторяется/.test(boom(() => parseAndVerifyPricingTable(clone(duplicated)))), true)
t('нулевая цена допустима',
  boom(() => parseAndVerifyPricingTable(clone(table([{
    ...ENTRY, inputMicrosPerMillionTokens: 0, outputMicrosPerMillionTokens: 0,
  }])))), '(без ошибки)')

/* ── Денежная арифметика ──────────────────────────────────────────────── */

t('округление вверх на остатке в одну микроединицу', ceilDivMicros(1n, 1n), 1n)
t('точное деление не округляется', ceilDivMicros(1_000_000n, 7n), 7n)
t('остаток даёт +1', ceilDivMicros(1_000_001n, 7n), 8n)
t('ноль токенов — ноль', ceilDivMicros(0n, 15_000_000n), 0n)
t('Number на вход не принимается',
  /BigInt/.test(boom(() => ceilDivMicros(1, 1n))), true)

const LIMITS_BASE = {
  maxBatchJobs: 0,
  maxInputTokens: 1000,
  maxOutputTokens: 200,
  maxTotalTokens: 2_000_000,
  currency: 'USD',
  pricingTableDigest: clone(PRICING.pricingTableDigest),
  pricingTableAsOf: '2026-08-01',
  maxRetries: 0,
}
const PROFILE_FOR_COST = {
  providerId: ENTRY.providerId, modelId: ENTRY.modelId, modelVersion: ENTRY.modelVersion,
}
const costOf = (overrides) => computeCostUpperBound({
  limits: { ...LIMITS_BASE, maxNetworkRequests: 10, maxCostMicros: 1_000_000_000, ...overrides },
  pricingTable: parseAndVerifyPricingTable(clone(PRICING)),
  profile: PROFILE_FOR_COST,
})
const baseCost = costOf({})
t('верхняя граница входных токенов', baseCost.inputTokensUpperBound, 10_000)
t('верхняя граница выходных токенов', baseCost.outputTokensUpperBound, 2_000)
t('стоимость входа округлена вверх', baseCost.inputCostMicrosUpperBound, 30_000)
t('стоимость выхода округлена вверх', baseCost.outputCostMicrosUpperBound, 30_000)
t('итог — сумма частей', baseCost.totalCostMicrosUpperBound, 60_000)
t('валюта и дата взяты из таблицы',
  `${baseCost.currency}|${baseCost.pricingTableAsOf}`, 'USD|2026-08-01')
t('результат заморожен', Object.isFrozen(baseCost), true)

t('равенство потолку допустимо',
  costOf({ maxCostMicros: 60_000 }).totalCostMicrosUpperBound, 60_000)
t('превышение на единицу отвергается',
  /превышает потолок/.test(boom(() => costOf({ maxCostMicros: 59_999 }))), true)
t('и код отказа — превышение бюджета', (() => {
  try { costOf({ maxCostMicros: 59_999 }); return null } catch (e) { return e.code }
})(), BUDGET_CODES.exceeded)
t('переполнение произведения — недоказуемость', (() => {
  try { costOf({ maxNetworkRequests: Number.MAX_SAFE_INTEGER, maxInputTokens: 1000 }); return null }
  catch (e) { return e.code }
})(), BUDGET_CODES.unprovable)
t('отсутствие точной строки цены — недоказуемость', (() => {
  try {
    computeCostUpperBound({
      limits: { ...LIMITS_BASE, maxNetworkRequests: 1, maxCostMicros: 1_000_000 },
      pricingTable: parseAndVerifyPricingTable(clone(PRICING)),
      profile: { ...PROFILE_FOR_COST, modelVersion: '2027-01-01' },
    })
    return null
  } catch (e) { return e.code }
})(), BUDGET_CODES.unprovable)
t('и отсутствие цены нулём не считается',
  /нулём не считается/.test(boom(() => computeCostUpperBound({
    limits: { ...LIMITS_BASE, maxNetworkRequests: 1, maxCostMicros: 1_000_000 },
    pricingTable: parseAndVerifyPricingTable(clone(PRICING)),
    profile: { ...PROFILE_FOR_COST, modelId: 'другая-модель' },
  }))), true)

/* ── Строгая форма ДЕНЕЖНЫХ публичных входов ──────────────────────────
   Проверяется весь сырой объект-вход до деструктуризации: лишнее, скрытое,
   символьное и accessor-свойство отвергаются, и отвергаются на всей глубине. */

const withHidden = (base, key) => {
  const copy = { ...base }
  Object.defineProperty(copy, key, { value: 1, enumerable: false })
  return copy
}
const withAccessor = (base, key) => {
  const copy = { ...base }
  Object.defineProperty(copy, key, { get: () => 1, enumerable: true, configurable: true })
  return copy
}
const withSymbol = (base) => {
  const copy = { ...base }
  copy[Symbol('скрытое')] = 1
  return copy
}

const COST_INPUT = Object.freeze({
  limits: { ...LIMITS_BASE, maxNetworkRequests: 10, maxCostMicros: 1_000_000_000 },
  pricingTable: parseAndVerifyPricingTable(clone(PRICING)),
  profile: { ...PROFILE_FOR_COST },
})
const BINDING_INPUT = Object.freeze({
  pricingTable: parseAndVerifyPricingTable(clone(PRICING)),
  profile: { ...PROFILE_FOR_COST, pricingTableDigest: clone(PRICING.pricingTableDigest) },
  limits: { ...LIMITS_BASE, maxNetworkRequests: 10, maxCostMicros: 1_000_000_000 },
})

t('положительный контроль: computeCostUpperBound принимает объявленный вход',
  boom(() => computeCostUpperBound({ ...COST_INPUT })), '(без ошибки)')
t('положительный контроль: assertPricingBinding принимает объявленный вход',
  boom(() => assertPricingBinding({ ...BINDING_INPUT })), '(без ошибки)')

for (const [name, call] of [
  ['computeCostUpperBound', (extra) => computeCostUpperBound(extra)],
  ['assertPricingBinding', (extra) => assertPricingBinding(extra)],
]) {
  const base = name === 'computeCostUpperBound' ? COST_INPUT : BINDING_INPUT
  t(`${name}: лишнее поле входа отвергается`,
    /лишние поля/.test(boom(() => call({ ...base, лишнее: 1 }))), true)
  t(`${name}: скрытое поле входа отвергается`,
    /неперечисляемое/.test(boom(() => call(withHidden(base, 'скрытое')))), true)
  t(`${name}: accessor-поле входа отвергается`,
    /accessor/.test(boom(() => call(withAccessor(base, 'подставное')))), true)
  t(`${name}: символьное поле входа отвергается`,
    /символьные/.test(boom(() => call(withSymbol(base)))), true)
  const withoutLimits = Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'limits'))
  t(`${name}: недостающее поле входа отвергается`,
    /нет обязательных полей/.test(boom(() => call(withoutLimits))), true)
  t(`${name}: скрытое поле ВНУТРИ limits отвергается`,
    /неперечисляемое/.test(boom(() => call({ ...base, limits: withHidden(base.limits, 'скрытое') }))), true)
  t(`${name}: accessor ВНУТРИ profile отвергается`,
    /accessor/.test(boom(() => call({ ...base, profile: withAccessor(base.profile, 'подставное') }))), true)
}

/* ── Денежный отказ становится кодом ворот только по типу ─────────────
   Из production-входов сюда не добраться: к моменту P11 всё проверено.
   Поэтому сторож вызывается напрямую — иначе его нечем проверить. */

t('BudgetError отвергает код вне закрытого списка',
  /не из закрытого списка/.test(boom(() => new BudgetError('опечатка-в-коде', 'нечем'))), true)
t('и принимает объявленный',
  new BudgetError(BUDGET_CODES.exceeded, 'потолок').code, BUDGET_CODES.exceeded)
t('ApprovalRejected отвергает причину вне закрытого списка',
  /не из закрытого списка/.test(boom(() => new ApprovalRejected('опечатка-в-причине', 'нет'))), true)
t('и принимает объявленную',
  new ApprovalRejected(APPROVAL_REJECTION_REASONS[0], 'нет').reason, APPROVAL_REJECTION_REASONS[0])
t('перечень причин закрыт и заморожен', Object.isFrozen(APPROVAL_REJECTION_REASONS), true)
t('неизвестный код бюджета не становится недоказуемостью',
  /неизвестный код бюджета/.test(boom(() => budgetFailureCode(
    Object.assign(new BudgetError(BUDGET_CODES.unprovable, 'нечем'), { code: 'опечатка-в-коде' }),
  ))), true)

t('превышение бюджета становится кодом ворот',
  budgetFailureCode(new BudgetError(BUDGET_CODES.exceeded, 'потолок')), PREFLIGHT_CODES.budgetExceeded)
t('недоказуемость становится своим кодом',
  budgetFailureCode(new BudgetError(BUDGET_CODES.unprovable, 'нечем')), PREFLIGHT_CODES.budgetUnprovable)
t('а программная ошибка пробрасывается, а не становится вердиктом',
  /программный дефект/.test(boom(() => budgetFailureCode(new TypeError('программный дефект')))), true)
t('и системная ошибка тоже',
  /EIO/.test(boom(() => budgetFailureCode(Object.assign(new Error('EIO: сбой'), { code: 'EIO', syscall: 'read' })))), true)

/* ── Фикстуры плана, профиля и разрешения ─────────────────────────────── */

const awaiting = JSON.parse(await readFile(path.join(FX, 'candidates-awaiting.json'), 'utf8'))
const NOW = new Date('2026-08-13T00:00:00Z')
const AT = '2026-08-14T00:00:00.000Z'
const CODE_IDENTITY = { commit: '0'.repeat(40), dirty: false }

const PROFILE = Object.freeze({
  contractVersion: PROVIDER_PROFILE_SPEC,
  id: 'example-profile',
  version: '1.0.0',
  providerId: ENTRY.providerId,
  modelId: ENTRY.modelId,
  modelVersion: ENTRY.modelVersion,
  endpoint: 'https://api.example.com/v1/messages',
  apiVersion: '2026-08-01',
  structuredOutput: { mode: 'json-schema-strict', schemaDialect: 'json-schema-draft-2020-12' },
  serializer: { id: 'node-json', version: '1.0.0' },
  capabilities: {
    idempotencyKey: { supported: true, header: 'idempotency-key', scope: 'request' },
    statusEndpoint: { supported: true, billable: false, path: '/v1/messages/status' },
    batch: { supported: false, returnsRequestItemId: null },
  },
  pricingTableDigest: clone(PRICING.pricingTableDigest),
})
t('фикстура профиля валидна', boom(() => assertProviderProfileShape(PROFILE)), '(без ошибки)')

const ALLOW = Object.freeze({
  purpose: 'classification',
  allowedProviders: [PROFILE.id],
  fields: [...MODEL_INPUT_FIELDS],
  decisionRef: 'owner/2026-08-14',
  reviewedAt: '2026-08-01',
  validUntil: '2026-12-31',
})
const DENY = Object.freeze({ ...ALLOW, allowedProviders: [] })
const PORTAL_IDS = ['p-alpha', 'p-beta']
const portalOf = (id, policy = ALLOW) => ({
  id, adapter: 'fake', regionKeys: [], modelProcessing: policy,
})
const ADAPTERS = { fake: async () => ({ candidates: clone(awaiting), meta: {} }) }
const rerun = (portal, options) => rerunPortalCandidates(portal, options)

const evaluatedOf = async (id) => rerun(portalOf(id), { adapters: ADAPTERS })
const PLAN_META = {
  planId: 'plan-preflight',
  createdAt: '2026-08-13T00:00:00.000Z',
  deleteAfter: '2026-08-20T00:00:00.000Z',
  codeIdentity: CODE_IDENTITY,
  taxonomyVersion: 'poi-taxonomy/v2',
  taxonomyBytes: Buffer.from('{"version":"poi-taxonomy/v2"}\n', 'utf8'),
  taxonomySpec: 'raw-file-bytes/v1',
  promptText: 'фиксированный промпт',
  schemaObject: { type: 'object', properties: { entityKind: { type: 'string' } } },
}
const PLAN = buildModelPlan({
  fragments: await Promise.all(PORTAL_IDS.map(async (id) => buildPortalPlanFragment({
    portal: portalOf(id), evaluated: await evaluatedOf(id), now: NOW, providerProfile: PROFILE,
  }))),
  selectedPortalIds: [...PORTAL_IDS],
  meta: { ...PLAN_META, providerProfile: PROFILE },
})
/* Диагностический план v1 — без профиля. В нём достижимо ровно одно
   состояние policy: профиля нет, значит разрешённого провайдера нет тоже.
   План валиден и исполняемым не является; ворота P2 обязаны это увидеть, а не
   пропустить дальше. */
const PLAN_V1 = buildModelPlan({
  fragments: await Promise.all(PORTAL_IDS.map(async (id) => buildPortalPlanFragment({
    portal: portalOf(id, DENY), evaluated: await evaluatedOf(id), now: NOW,
  }))),
  selectedPortalIds: [...PORTAL_IDS],
  meta: { ...PLAN_META, planId: 'plan-preflight-v1' },
})
const TOTAL = PLAN.portals.reduce((sum, p) => sum + p.plannedItemCount, 0)
const MAX_ITEM_BYTES = PLAN.portals
  .flatMap((p) => p.items.map((i) => i.classificationItemBytes))
  .reduce((max, b) => (b > max ? b : max), 0)
t('план исполняемый', PLAN.executionPermitted, true)
t('кандидатов больше одного', TOTAL > 1, true)
t('диагностический план v1 построен и не исполняем', PLAN_V1.executionPermitted, false)

const LIMITS = {
  maxCandidates: TOTAL,
  maxNetworkRequests: TOTAL,
  maxBatchJobs: 0,
  maxItemBytes: MAX_ITEM_BYTES,
  maxInputTokens: 1000,
  maxOutputTokens: 200,
  maxTotalTokens: 2_000_000,
  maxCostMicros: 1_000_000_000,
  currency: 'USD',
  pricingTableDigest: clone(PRICING.pricingTableDigest),
  pricingTableAsOf: '2026-08-01',
  maxRetries: 0,
}
const DECISION = {
  approvalId: 'approval-preflight',
  createdAt: '2026-08-13T00:00:00.000Z',
  validUntil: '2026-08-20T00:00:00.000Z',
  decisionRef: 'owner/2026-08-14',
  approver: 'jumbo',
}
const APPROVAL = buildModelApproval({ plan: clone(PLAN), ...DECISION, limits: clone(LIMITS) })
const FILE_NAME = approvalFileName(APPROVAL)

/* ── Прогон preflight ─────────────────────────────────────────────────── */

/**
 * Порядок, в котором ворота становятся `passed`.
 *
 * Он не совпадает с порядком номеров, и это часть контракта: `executionId`
 * выводится из двух ПРОВЕРЕННЫХ подписей, поэтому P0 идёт после P1–P4, а P5 —
 * составные ворота и закрываются только вторым чтением идентичности, уже
 * после источников.
 */
const PASS_ORDER = ['P1', 'P2', 'P3', 'P4', 'P0', 'P6', 'P8', 'P7', 'P9', 'P10', 'P5', 'P11']
t('порядок прохождения покрывает все ворота ровно по разу',
  [...PASS_ORDER].sort().join(','), [...PREFLIGHT_GATES].sort().join(','))

const gateMap = (result) => PREFLIGHT_GATES.map((g) => `${g}:${result.gates[g]}`).join(' ')
const expectMap = (passed, failedGate) => PREFLIGHT_GATES
  .map((g) => `${g}:${g === failedGate ? 'failed' : passed.includes(g) ? 'passed' : 'notRun'}`)
  .join(' ')
/** Все ворота, пройденные до указанного, в порядке прохождения. */
const upTo = (gate) => PASS_ORDER.slice(0, PASS_ORDER.indexOf(gate))

const repoRoot = await mkdtemp(path.join(tmpdir(), 'poi-pre-'))
try {
  const store = createArtifactStore({ repoRoot })
  await store.approvals.writeApprovalFile({ approval: clone(APPROVAL), plan: clone(PLAN) })

  const identity = { value: { ...CODE_IDENTITY } }
  const run = (overrides = {}) => runExecutionPreflight({
    approvalFileName: FILE_NAME,
    plan: clone(PLAN),
    profile: clone(PROFILE),
    pricingTable: clone(PRICING),
    now: AT,
    store,
    adapters: ADAPTERS,
    resolvePortal: (id) => portalOf(id),
    resolveCodeIdentity: () => ({ ...identity.value }),
    rerunPortal: rerun,
    ...overrides,
  })

  const good = await run()
  t('положительный контроль: preflight проходит', good.ok, true)
  t('и код возврата нулевой', good.exitCode, EXIT_CODES.allAccepted)
  t('и отказа нет', good.failure, null)
  t('все двенадцать ворот пройдены',
    PREFLIGHT_GATES.every((gate) => good.gates[gate] === 'passed'), true)
  t('ворота перечислены в фиксированном порядке',
    Object.keys(good.gates).join(','), PREFLIGHT_GATES.join(','))
  t('идентификатор исполнения выведен', /^[0-9a-f]{64}$/.test(good.executionId), true)
  t('предупреждений нет', good.warnings.length, 0)
  t('результат заморожен', Object.isFrozen(good), true)
  t('бюджет посчитан', good.budget.totalCostMicrosUpperBound > 0, true)
  t('и не превышает потолок',
    good.budget.totalCostMicrosUpperBound <= good.budget.maxCostMicros, true)
  t('в бюджете нет содержательных полей кандидатов',
    Object.keys(good.budget).sort().join(','),
    ['currency', 'inputCostMicrosUpperBound', 'inputTokensUpperBound', 'maxCostMicros',
      'outputCostMicrosUpperBound', 'outputTokensUpperBound', 'pricingTableAsOf',
      'pricingTableDigest', 'totalCostMicrosUpperBound'].join(','))
  t('момент проверки остался канонической строкой', good.checkedAt, AT)

  /* Главное: preflight ничего не создал. */
  t('каталог исполнений не создан',
    existsSync(path.join(repoRoot, 'tmp', 'poi-model-executions')), false)
  t('журнал не создан', existsSync(store.journalPath(good.executionId)), false)

  /* ── Сырое чтение разрешения ────────────────────────────────────────── */

  t('сырой reader не принимает план',
    /лишние поля/.test(await boomAsync(() => store.approvals.readApprovalRaw({
      fileName: FILE_NAME, plan: clone(PLAN),
    }))), true)
  const rawRead = await store.approvals.readApprovalRaw({ fileName: FILE_NAME })
  t('сырой reader отдаёт точные байты файла',
    rawRead.bytes.equals(await readFile(store.approvals.approvalPath(FILE_NAME))), true)
  t('и не разбирает их', Object.keys(rawRead).sort().join(','), 'bytes,target')

  /* ── Контрпримеры ───────────────────────────────────────────────────── */

  const failed = async (label, overrides, gate, code, passed, exitCode = EXIT_CODES.preflightFailed) => {
    const result = await run(overrides)
    t(`${label}: preflight отказывает`, result.ok, false)
    t(`${label}: ворота ${gate}`, result.failure?.gate, gate)
    t(`${label}: код ${code}`, result.failure?.code, code)
    t(`${label}: код возврата ${exitCode}`, result.exitCode, exitCode)
    t(`${label}: состояния ворот`, gateMap(result), expectMap(passed, gate))
    t(`${label}: бюджет не выдан`, result.budget, null)
    t(`${label}: журнал не создан`, existsSync(path.join(repoRoot, 'tmp', 'poi-model-executions', result.executionId ?? 'нет')), false)
    return result
  }

  /* P1: план как артефакт. Подменённое поле рушит собственную подпись. */
  await failed('план подменён', { plan: { ...clone(PLAN), taxonomyVersion: 'подмена' } },
    'P1', PREFLIGHT_CODES.planRejected, [])
  /* Скрытое, символьное и accessor-свойство обязано отвергаться на СЫРОМ
     плане. `structuredClone` перед валидатором убрал бы первые два и
     материализовал третье, то есть починил бы ровно то, что обязано падать. */
  const planWith = (mutate) => { const copy = clone(PLAN); mutate(copy); return copy }
  for (const [label, mutate, pattern] of [
    ['скрытое поле плана', (p) => Object.defineProperty(p, 'скрытое', { value: 1, enumerable: false }), /неперечисляемое/],
    ['символьное поле плана', (p) => { p[Symbol('скрытое')] = 1 }, /символьные/],
    ['accessor-поле плана', (p) => Object.defineProperty(p, 'подставное', { get: () => 1, enumerable: true, configurable: true }), /accessor/],
    ['скрытое поле ВНУТРИ фрагмента', (p) => Object.defineProperty(p.portals[0], 'скрытое', { value: 1, enumerable: false }), /неперечисляемое/],
  ]) {
    const result = await failed(label, { plan: planWith(mutate) }, 'P1', PREFLIGHT_CODES.planRejected, [])
    t(`${label}: отказ назван строгой формой`, pattern.test(result.failure.message), true)
  }

  /* P2: диагностический план v1 исполнять нечем. */
  const v1Run = await failed('план v1 не исполняется', { plan: clone(PLAN_V1) },
    'P2', PREFLIGHT_CODES.planRejected, upTo('P2'))
  t('и отказ называет версию контракта', /poi-model-plan\/v2/.test(v1Run.failure.message), true)

  /* P3: статические authority-входы — до адаптеров. */
  await failed('профиль подменён', { profile: { ...clone(PROFILE), modelVersion: '2027-01-01' } },
    'P3', PREFLIGHT_CODES.budgetUnprovable, upTo('P3'))
  await failed('таблица цен подменена',
    { pricingTable: clone(table([{ ...ENTRY, inputMicrosPerMillionTokens: 1 }])) },
    'P3', PREFLIGHT_CODES.budgetUnprovable, upTo('P3'))
  await failed('таблица цен не та, что назвал профиль',
    { pricingTable: clone(table([{ ...ENTRY, modelId: 'другая-модель' }])) },
    'P3', PREFLIGHT_CODES.budgetUnprovable, upTo('P3'))
  const tableWith = (mutate) => { const copy = clone(PRICING); mutate(copy); return copy }
  for (const [label, mutate, pattern] of [
    ['скрытое поле таблицы цен', (x) => Object.defineProperty(x, 'скрытое', { value: 1, enumerable: false }), /неперечисляемое/],
    ['символьное поле таблицы цен', (x) => { x[Symbol('скрытое')] = 1 }, /символьные/],
    ['accessor-поле таблицы цен', (x) => Object.defineProperty(x, 'подставное', { get: () => 1, enumerable: true, configurable: true }), /accessor/],
    ['скрытое поле ВНУТРИ строки цены', (x) => Object.defineProperty(x.entries[0], 'скрытое', { value: 1, enumerable: false }), /неперечисляемое/],
  ]) {
    const result = await failed(label, { pricingTable: tableWith(mutate) }, 'P3',
      PREFLIGHT_CODES.budgetUnprovable, upTo('P3'))
    t(`${label}: отказ назван строгой формой`, pattern.test(result.failure.message), true)
  }

  /* Профиль, у которого строка цены та же, а отпечаток другой: подмену
     ловит только сверка отпечатка с планом и разрешением. */
  const sameRowProfile = { ...clone(PROFILE), apiVersion: '2027-01-01' }
  t('у подменённого профиля строка цены прежняя',
    `${sameRowProfile.providerId}|${sameRowProfile.modelId}|${sameRowProfile.modelVersion}`,
    `${PROFILE.providerId}|${PROFILE.modelId}|${PROFILE.modelVersion}`)
  t('и отпечаток при этом другой',
    providerProfileDigest(sameRowProfile) === providerProfileDigest(PROFILE), false)
  const sameRowRun = await failed('профиль с тем же тарифом, но другим отпечатком',
    { profile: sameRowProfile }, 'P3', PREFLIGHT_CODES.budgetUnprovable, upTo('P3'))
  t('и подменённый профиль до адаптеров не доживает', sameRowRun.gates.P7, 'notRun')

  /* P4: файл разрешения. */
  await failed('разрешения нет', { approvalFileName: `${'e'.repeat(64)}.json` }, 'P4',
    PREFLIGHT_CODES.approvalRejected, upTo('P4'), EXIT_CODES.preflightApprovalRejected)
  /* Негодное имя — тоже штатный отказ P4, а не необработанное исключение:
     имя приходит снаружи, и путём быть не может. */
  for (const [label, wrongName] of [
    ['имя не выведено из подписи', 'произвольное.json'],
    ['имя пытается стать путём', '../побег.json'],
    ['имя в верхнем регистре', `${'A'.repeat(64)}.json`],
    ['имя не строка', 42],
  ]) {
    const result = await failed(`разрешение: ${label}`, { approvalFileName: wrongName }, 'P4',
      PREFLIGHT_CODES.approvalRejected, upTo('P4'), EXIT_CODES.preflightApprovalRejected)
    t(`${label}: отказ по имени, а не по содержимому`,
      /имя разрешения/.test(result.failure.message), true)
  }
  const badName = `${'f'.repeat(64)}.json`
  await writeFile(path.join(repoRoot, 'tmp', 'poi-model-approvals', badName),
    Buffer.from([0x7b, 0xff, 0xfe, 0x7d]))
  const notUtf8 = await failed('байты разрешения не UTF-8', { approvalFileName: badName }, 'P4',
    PREFLIGHT_CODES.approvalRejected, upTo('P4'), EXIT_CODES.preflightApprovalRejected)
  t('и отказ назван декодированием', /не декодируются как UTF-8/.test(notUtf8.failure.message), true)

  /* EIO, EACCES, EPERM и программная ошибка приговором разрешению не
     становятся: они пробрасываются, а не превращаются в approvalRejected. */
  const failingStore = (error) => Object.freeze({
    ...store,
    approvals: Object.freeze({
      ...store.approvals,
      readApprovalFile: async () => { throw error },
    }),
  })
  const systemError = (code, syscall) => Object.assign(
    new Error(`${code}: искусственный сбой ввода-вывода, ${syscall}`),
    { code, errno: -5, syscall, path: 'tmp/poi-model-approvals' },
  )
  for (const code of ['EIO', 'EACCES', 'EPERM']) {
    const message = await boomAsync(() => run({ store: failingStore(systemError(code, 'read')) }))
    t(`${code} пробрасывается, а не становится отказом ворот`,
      new RegExp(`^${code}: искусственный сбой`).test(message), true)
  }
  t('программная ошибка чтения тоже пробрасывается',
    /программный дефект/.test(await boomAsync(() => run({
      store: failingStore(new TypeError('программный дефект в хранилище')),
    }))), true)

  /* P5: составные ворота, обе половины. */
  const dirtyIdentity = await failed('грязное дерево',
    { resolveCodeIdentity: () => ({ commit: '0'.repeat(40), dirty: true }) }, 'P5',
    PREFLIGHT_CODES.codeIdentityDrift, upTo('P6'))
  t('и отказ назван до источников', /до источников/.test(dirtyIdentity.failure.message), true)
  t('и фаза машинно различима', dirtyIdentity.failure.phase, PREFLIGHT_PHASES[0])
  await failed('другой HEAD',
    { resolveCodeIdentity: () => ({ commit: '1'.repeat(40), dirty: false }) }, 'P5',
    PREFLIGHT_CODES.codeIdentityDrift, upTo('P6'))

  /* Смена HEAD ВНУТРИ адаптера ловится только повторным чтением. */
  let calls = 0
  const drifting = await run({
    resolveCodeIdentity: () => {
      calls += 1
      return calls === 1 ? { ...CODE_IDENTITY } : { commit: '2'.repeat(40), dirty: false }
    },
  })
  t('смена HEAD во время источников отвергается', drifting.failure?.gate, 'P5')
  t('и названа именно сменой', /изменилась во время прогона/.test(drifting.failure.message), true)
  t('и идентичность читалась дважды', calls >= 2, true)
  t('и фаза — после источников', drifting.failure.phase, PREFLIGHT_PHASES[1])
  t('и пройденные P6–P10 в notRun не сброшены',
    gateMap(drifting), expectMap(upTo('P5'), 'P5'))
  t('и P11 при позднем drift не исполнялся', drifting.gates.P11, 'notRun')

  /* P6, P7. */
  await failed('разрешение ещё не действует', { now: '2026-08-12T00:00:00.000Z' }, 'P6',
    PREFLIGHT_CODES.approvalNotYetValid, upTo('P6'), EXIT_CODES.preflightApprovalRejected)
  await failed('разрешение истекло', { now: '2026-08-20T00:00:00.000Z' }, 'P6',
    PREFLIGHT_CODES.approvalExpired, upTo('P6'), EXIT_CODES.preflightApprovalRejected)
  const epochRun = await run({ now: '1970-01-01T00:00:00.000Z' })
  t('эпоха остаётся строкой в отчёте', epochRun.checkedAt, '1970-01-01T00:00:00.000Z')
  t('и это именно строка', typeof epochRun.checkedAt, 'string')

  await failed('policy одного портала запрещает',
    { resolvePortal: (id) => portalOf(id, id === PORTAL_IDS[1] ? DENY : ALLOW) },
    'P7', PREFLIGHT_CODES.policyDenied, upTo('P7'))
  await failed('policy истекла',
    { resolvePortal: (id) => portalOf(id, { ...ALLOW, validUntil: '2026-08-01' }) },
    'P7', PREFLIGHT_CODES.policyDenied, upTo('P7'))

  /* P8: исчезнувший и подменённый портал — ворота, а не исключение. */
  /* Контракт резолвера: «источника больше нет» — это ЗНАЧЕНИЕ, а не
     исключение. Только оно становится воротами P8. */
  const gonePortal = await failed('портал исчез из реестра',
    { resolvePortal: (id) => (id === PORTAL_IDS[1] ? null : portalOf(id)) },
    'P8', PREFLIGHT_CODES.portalSetMismatch, upTo('P8'))
  t('и отказ назвал портал', /p-beta/.test(gonePortal.failure.message), true)
  await failed('реестр вернул undefined вместо портала',
    { resolvePortal: (id) => (id === PORTAL_IDS[1] ? undefined : portalOf(id)) },
    'P8', PREFLIGHT_CODES.portalSetMismatch, upTo('P8'))
  t('исключение резолвера пробрасывается, а не становится исчезновением портала',
    /программный дефект в реестре/.test(await boomAsync(() => run({
      resolvePortal: (id) => {
        if (id === PORTAL_IDS[1]) throw new TypeError('программный дефект в реестре')
        return portalOf(id)
      },
    }))), true)
  t('и негодная форма источника — тоже программная ошибка',
    /ожидается источник со строковым id/.test(await boomAsync(() => run({
      resolvePortal: (id) => (id === PORTAL_IDS[1] ? 'p-beta' : portalOf(id)),
    }))), true)
  await failed('портал подменён другим',
    { resolvePortal: (id) => portalOf(id === PORTAL_IDS[1] ? 'p-чужой' : id) },
    'P8', PREFLIGHT_CODES.portalSetMismatch, upTo('P8'))

  /* P9: набор кандидатов. */
  await failed('кандидат исчез',
    { rerunPortal: async (portal, options) => {
      const list = await rerun(portal, options)
      return portal.id === PORTAL_IDS[0] ? list.slice(1) : list
    } }, 'P9', PREFLIGHT_CODES.candidateSetMismatch, upTo('P9'))
  await failed('кандидат добавился',
    { rerunPortal: async (portal, options) => {
      const list = await rerun(portal, options)
      if (portal.id !== PORTAL_IDS[0]) return list
      const extra = clone(list[0])
      extra.candidate.sourceKey = `${extra.candidate.sourceKey}-новый`
      return [...list, extra]
    } }, 'P9', PREFLIGHT_CODES.candidateSetMismatch, upTo('P9'))
  const repeated = await failed('sourceKey повторяется',
    { rerunPortal: async (portal, options) => {
      const list = await rerun(portal, options)
      if (portal.id !== PORTAL_IDS[0]) return list
      return [...clone(list), clone(list[0])]
    } }, 'P9', PREFLIGHT_CODES.candidateSetMismatch, upTo('P9'))
  t('и повтор назван повтором', /повторяется/.test(repeated.failure.message), true)
  const emptyKey = await failed('sourceKey пуст',
    { rerunPortal: async (portal, options) => {
      const list = await rerun(portal, options)
      if (portal.id !== PORTAL_IDS[0]) return list
      const copy = clone(list)
      copy[0].candidate.sourceKey = ''
      return copy
    } }, 'P9', PREFLIGHT_CODES.candidateSetMismatch, upTo('P9'))
  t('и пустой ключ назван отсутствующим', /нет sourceKey/.test(emptyKey.failure.message), true)

  /* P10: содержательный вход — изменившийся и неканоничный. */
  await failed('вход кандидата изменился',
    { rerunPortal: async (portal, options) => {
      const list = await rerun(portal, options)
      if (portal.id !== PORTAL_IDS[0]) return list
      const copy = clone(list)
      copy[0].candidate.nameJa = `${copy[0].candidate.nameJa} (переименован)`
      return copy
    } }, 'P10', PREFLIGHT_CODES.inputDrift, upTo('P10'))
  const lone = await failed('вход кандидата неканоничен',
    { rerunPortal: async (portal, options) => {
      const list = await rerun(portal, options)
      if (portal.id !== PORTAL_IDS[0]) return list
      const copy = clone(list)
      copy[0].candidate.nameJa = `${copy[0].candidate.nameJa}\uD800`
      return copy
    } }, 'P10', PREFLIGHT_CODES.inputDrift, upTo('P9'))
  t('и отказ назван суррогатом', /суррогат/.test(lone.failure.message), true)

  /* P11: стоимость ровно по потолку и на единицу выше. */
  const tight = buildModelApproval({
    plan: clone(PLAN), ...DECISION, approvalId: 'approval-впритык',
    limits: { ...clone(LIMITS), maxCostMicros: costOf({ maxNetworkRequests: TOTAL }).totalCostMicrosUpperBound },
  })
  await store.approvals.writeApprovalFile({ approval: clone(tight), plan: clone(PLAN) })
  const tightRun = await run({ approvalFileName: approvalFileName(tight) })
  t('стоимость ровно по потолку проходит', tightRun.ok, true)
  const over = buildModelApproval({
    plan: clone(PLAN), ...DECISION, approvalId: 'approval-превышение',
    limits: { ...clone(LIMITS), maxCostMicros: costOf({ maxNetworkRequests: TOTAL }).totalCostMicrosUpperBound - 1 },
  })
  await store.approvals.writeApprovalFile({ approval: clone(over), plan: clone(PLAN) })
  await failed('потолок стоимости превышен', { approvalFileName: approvalFileName(over) },
    'P11', PREFLIGHT_CODES.budgetExceeded, upTo('P11'))

  /* ── Одноразовость и чужие журналы ──────────────────────────────────── */

  const alien = 'a'.repeat(64)
  mkdirSync(path.join(repoRoot, 'tmp', 'poi-model-executions', alien), { recursive: true })
  await writeFile(path.join(repoRoot, 'tmp', 'poi-model-executions', alien, JOURNAL_FILE_NAME),
    'не журнал\n', 'utf8')
  const withAlien = await run()
  t('чужой повреждённый журнал не блокирует', withAlien.ok, true)
  t('но становится предупреждением', withAlien.warnings.length, 1)
  t('и назван повреждённым', withAlien.warnings[0].state, 'journalCorrupt')
  t('и не изменён', await readFile(path.join(repoRoot, 'tmp', 'poi-model-executions', alien, JOURNAL_FILE_NAME), 'utf8'), 'не журнал\n')

  /* А вот НЕДОСТУПНЫЙ чужой журнал предупреждением не становится:
     «не удалось прочитать» и «прочитали и нашли повреждение» — разные ответы,
     и первый обязан остановить прогон, а не украсить его примечанием. */
  for (const code of ['EIO', 'EACCES', 'EPERM']) {
    const unreadable = createArtifactStore({
      repoRoot,
      io: {
        ...FILE_IO,
        readFile: async () => {
          throw Object.assign(new Error(`${code}: искусственный сбой ввода-вывода, read`),
            { code, errno: -5, syscall: 'read' })
        },
      },
    })
    t(`preflight останавливается на недоступном чужом журнале (${code})`,
      new RegExp(`^${code}: искусственный сбой`).test(
        await boomAsync(() => run({ store: unreadable })),
      ), true)
  }

  /* Каталог исполнения создаётся здесь руками — это и есть свидетельство
     потребления, поэтому проверка «журнал не создан» к этому случаю
     неприменима и ворота сверяются напрямую. */
  mkdirSync(store.executionDir(good.executionId), { recursive: true })
  const consumed = await run()
  t('тот же executionId уже потреблён', consumed.ok, false)
  t('и это P0', consumed.failure?.gate, 'P0')
  t('и код возврата двенадцать', consumed.exitCode, EXIT_CODES.preflightAlreadyConsumed)
  t('и код отказа назван', consumed.failure?.code, PREFLIGHT_CODES.executionAlreadyConsumed)
  t('и состояния ворот', gateMap(consumed), expectMap(upTo('P0'), 'P0'))
  t('и идентификатор в отчёте назван', consumed.executionId, good.executionId)
  t('и журнал внутри каталога всё равно не создан',
    existsSync(store.journalPath(good.executionId)), false)

  /* ── Строгая форма входа ────────────────────────────────────────────── */

  t('preflight отвергает лишнее поле входа',
    /лишние поля/.test(await boomAsync(() => run({ лишнее: 1 }))), true)
} finally {
  await rm(repoRoot, { recursive: true, force: true })
}

/* ── Исполняемый план несовместим с --limit ───────────────────────────── */

const limitRun = await boomAsync(() => main(
  ['node', 'x', '--portal', 'bodik-osaka-tourism', '--model-plan', '--limit', '5',
    '--model-provider-profile', 'example-profile@1.0.0', '--out', 'tmp/poi-model-plans/нет.json'],
  { adapters: {}, persistReport: async () => {}, resolveCodeIdentity: () => ({ ...CODE_IDENTITY }) },
))
t('--limit с исполняемым планом отвергается', /несовместим с --limit/.test(limitRun), true)
t('и отказ приходит до первого адаптера', /план строится/.test(limitRun), true)
/* Отчёт обычного прогона печатается в stdout — здесь он не нужен, поэтому
   вывод на время вызова перехватывается. Проверяется только то, что запрет
   не задел диагностический режим: тот же --model-plan и тот же --limit, но
   БЕЗ профиля провайдера — план v1 ничего не исполняет и корпус не подписывает. */
const quiet = async (fn) => {
  const log = console.log
  const err = console.error
  console.log = () => {}
  console.error = () => {}
  try { return await boomAsync(fn) } finally { console.log = log; console.error = err }
}
/* Адаптер подставляется тот же по имени, что и production (`opendata-csv`), и
   возвращает ту же фикстуру кандидатов: проверяется не заглушка, а то, что
   диагностический прогон с --limit доходит до конца и строит план v1. Отчёт
   никуда не пишется — persistReport подставлен пустым. */
const OPENDATA = {
  'opendata-csv': async () => ({ candidates: clone(awaiting), meta: { rows: awaiting.length } }),
}
const persisted = []
const v1WithLimit = await quiet(() => main(
  ['node', 'x', '--portal', 'bodik-osaka-tourism', '--model-plan', '--limit', '5',
    '--out', 'tmp/poi-model-plans/диагностический-v1.json'],
  { adapters: OPENDATA, now: NOW, resolveCodeIdentity: () => ({ ...CODE_IDENTITY }),
    persistReport: async (out, report, options) => { persisted.push({ out, report, options }) } },
))
t('диагностический план v1 с --limit проходит целиком', v1WithLimit, '(без ошибки)')
t('и отчёт дошёл до записи ровно один раз', persisted.length, 1)
t('и план в нём построен', persisted[0]?.report?.modelPlan?.contractVersion, 'poi-model-plan/v1')
t('и он не исполняем', persisted[0]?.report?.modelPlan?.executionPermitted, false)
t('и кандидаты в нём есть',
  persisted[0]?.report?.modelPlan?.portals?.[0]?.plannedItemCount > 0, true)
t('и файла по --out при этом не создано',
  existsSync(path.join(process.cwd(), 'tmp', 'poi-model-plans', 'диагностический-v1.json')), false)

t('отпечаток профиля считается тем же способом',
  digest(providerProfileDigest(PROFILE), DIGEST_ALGORITHM, PROVIDER_PROFILE_SPEC).value,
  PLAN.providerProfileDigest.value)

console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ execution-preflight: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
