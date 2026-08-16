/**
 * Граница транспорта — целиком офлайн.
 *
 * Настоящие production-builder запроса и сериализатора соединяются с
 * подставным проводом и подставным резолвером учётных данных. Ни одного
 * настоящего HTTP-запроса здесь не выполняется: клиент инъецируется, а
 * модуль транспорта сети не импортирует.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildModelApproval } from '../scripts/poi-portals/lib/model-approval.mjs'
import { approvalFileName } from '../scripts/poi-portals/lib/approval-store.mjs'
import { createArtifactStore } from '../scripts/poi-portals/lib/execution-journal.mjs'
import { runExecutionPreflight } from '../scripts/poi-portals/lib/execution-preflight.mjs'
import {
  buildModelPlan,
  buildPortalPlanFragment,
  MODEL_INPUT_FIELDS,
} from '../scripts/poi-portals/lib/model-plan.mjs'
import {
  MODEL_PRICING_SPEC,
  pricingTableDigest,
} from '../scripts/poi-portals/lib/model-pricing.mjs'
import { PROVIDER_PROFILE_SPEC } from '../scripts/poi-portals/lib/provider-profile.mjs'
import { rerunPortalCandidates } from '../scripts/poi-portals/collect-pois.mjs'
import { buildModelRequest } from '../scripts/poi-portals/lib/model-request.mjs'
import {
  prepareOutbound,
  resolveModelSerializer,
} from '../scripts/poi-portals/lib/model-serializers.mjs'
import {
  assertTransportResult,
  createModelTransport,
  MODEL_TRANSPORT_RESULT_SPEC,
  MODEL_TRANSPORT_SPEC,
  ModelTransportError,
  TRANSPORT_RESULT_KEYS,
} from '../scripts/poi-portals/lib/model-transport.mjs'
import { formatProblem } from '../scripts/poi-portals/lib/model-execution.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FX = path.join(HERE, 'fixtures', 'poi-model-plan')

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok += 1
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e.message } }
const boomAsync = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e.message } }
const clone = (value) => JSON.parse(JSON.stringify(value))

const awaiting = JSON.parse(await readFile(path.join(FX, 'candidates-awaiting.json'), 'utf8'))
const NOW = new Date('2026-08-13T00:00:00Z')
const CODE_IDENTITY = { commit: '0'.repeat(40), dirty: false }
const PORTAL_ID = 'p-transport'

const ENTRY = {
  providerId: 'example-provider',
  modelId: 'example-model',
  modelVersion: '2026-08-01',
  inputMicrosPerMillionTokens: 3_000_000,
  outputMicrosPerMillionTokens: 15_000_000,
}
const pricingBody = {
  contractVersion: MODEL_PRICING_SPEC,
  pricingTableAsOf: '2026-08-01',
  currency: 'USD',
  entries: [ENTRY],
}
const PRICING = {
  ...pricingBody,
  pricingTableDigest: {
    value: pricingTableDigest({ ...pricingBody, pricingTableDigest: null }),
    algorithm: 'sha256',
    spec: MODEL_PRICING_SPEC,
  },
}
const PROFILE = Object.freeze({
  contractVersion: PROVIDER_PROFILE_SPEC,
  id: 'example-profile',
  version: '1.0.0',
  providerId: ENTRY.providerId,
  modelId: ENTRY.modelId,
  modelVersion: ENTRY.modelVersion,
  endpoint: 'https://api.example.com/v1/responses',
  apiVersion: '2026-08-01',
  structuredOutput: { mode: 'json-schema-strict', schemaDialect: 'json-schema-draft-2020-12' },
  serializer: { id: 'openai-responses', version: '1.0.0' },
  capabilities: {
    idempotencyKey: { supported: false, header: null, scope: null },
    statusEndpoint: { supported: false, billable: null, path: null },
    batch: { supported: false, returnsRequestItemId: null },
  },
  pricingTableDigest: clone(PRICING.pricingTableDigest),
})
const POLICY = Object.freeze({
  purpose: 'classification',
  allowedProviders: [PROFILE.id],
  fields: [...MODEL_INPUT_FIELDS],
  decisionRef: 'owner/2026-08-14',
  reviewedAt: '2026-08-01',
  validUntil: '2026-12-31',
})
const portalOf = () => ({
  id: PORTAL_ID, adapter: 'fake', regionKeys: [], modelProcessing: POLICY,
})
const ADAPTERS = Object.freeze({ fake: async () => ({ candidates: clone(awaiting), meta: {} }) })
const evaluated = await rerunPortalCandidates(portalOf(), { adapters: ADAPTERS })
const SCHEMA_OBJECT = { type: 'object', properties: { entityKind: { type: 'string' } } }

const AT = '2026-08-14T00:00:00.000Z'
const repoRoot = await mkdtemp(path.join(tmpdir(), 'poi-transport-'))
const store = createArtifactStore({ repoRoot })

/** План, разрешение и запрос под заданный текст промпта. */
const requestFor = async (promptText, serial) => {
  const plan = buildModelPlan({
    fragments: [buildPortalPlanFragment({
      portal: portalOf(), evaluated, now: NOW, providerProfile: PROFILE,
    })],
    selectedPortalIds: [PORTAL_ID],
    meta: {
      planId: `plan-transport-${serial}`,
      createdAt: '2026-08-13T00:00:00.000Z',
      deleteAfter: '2026-08-20T00:00:00.000Z',
      codeIdentity: CODE_IDENTITY,
      taxonomyVersion: 'poi-taxonomy/v2',
      taxonomyBytes: Buffer.from('{"version":"poi-taxonomy/v2"}\n', 'utf8'),
      taxonomySpec: 'raw-file-bytes/v1',
      promptText,
      schemaObject: SCHEMA_OBJECT,
      providerProfile: PROFILE,
    },
  })
  const total = plan.portals[0].plannedItemCount
  const approval = buildModelApproval({
    plan: clone(plan),
    approvalId: `approval-transport-${serial}`,
    createdAt: '2026-08-13T00:00:00.000Z',
    validUntil: '2026-08-20T00:00:00.000Z',
    decisionRef: 'owner/2026-08-14',
    approver: 'jumbo',
    limits: {
      maxCandidates: total,
      maxNetworkRequests: total,
      maxBatchJobs: 0,
      maxItemBytes: Math.max(...plan.portals[0].items.map((i) => i.classificationItemBytes)),
      maxInputTokens: 1000,
      maxOutputTokens: 200,
      maxTotalTokens: 2_000_000,
      maxCostMicros: 1_000_000_000,
      currency: 'USD',
      pricingTableDigest: clone(PRICING.pricingTableDigest),
      pricingTableAsOf: '2026-08-01',
      maxRetries: 0,
    },
  })
  await store.approvals.writeApprovalFile({ approval: clone(approval), plan: clone(plan) })
  const preflight = await runExecutionPreflight({
    approvalFileName: approvalFileName(approval),
    plan: clone(plan),
    profile: clone(PROFILE),
    pricingTable: clone(PRICING),
    now: AT,
    store,
    adapters: ADAPTERS,
    resolvePortal: () => portalOf(),
    resolveCodeIdentity: () => ({ ...CODE_IDENTITY }),
    rerunPortal: (portal, options) => rerunPortalCandidates(portal, options),
  })
  if (!preflight.ok) throw new Error(`preflight отказал: ${JSON.stringify(preflight.gates ?? null)}`)
  const prepared = preflight.preparedItems[0]
  return buildModelRequest({
    plan: clone(plan),
    approval: clone(approval),
    profile: clone(PROFILE),
    portalId: prepared.portalId,
    requestItemId: prepared.requestItemId,
    classificationItem: clone(prepared.classificationItem),
    promptText,
    schemaObject: clone(SCHEMA_OBJECT),
  })
}

/* ── Подставной провод ────────────────────────────────────────────────── */

/* Каждый исход тела назван СВОИМ фиксированным текстом: общий текст на оба
   случая позволил бы поменять их местами незамеченно. */
const TORN = 'чтение ответа провайдера оборвалось'
const NOT_BYTES = 'тело ответа провайдера отдало не байты'

const SECRET = 'sk-подставной-секрет-которого-нигде-быть-не-должно'
const CREDENTIAL = `Bearer ${'s'.repeat(32)}`
const { descriptor } = resolveModelSerializer('openai-responses', '1.0.0')

const validProposal = (index = 0) => ({
  entityKind: 'tourist_poi',
  poiPrimaryType: 'museum',
  facets: [],
  confidence: 0.9,
  reasons: [`подставной ответ ${index}`],
  nameRu: `Тестовый музей ${index}`,
})

/** Ответ Responses API вокруг текста результата. */
const responseAround = (text) => ({
  id: 'resp_подставной',
  object: 'response',
  status: 'completed',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
})

/** Тело в виде потока кусков — ровно так, как обязан вести себя клиент. */
const streamOf = (bytes, chunkSize = 7) => ({
  async* [Symbol.asyncIterator]() {
    for (let at = 0; at < bytes.length; at += chunkSize) {
      yield Uint8Array.prototype.slice.call(bytes, at, at + chunkSize)
    }
  },
})
const jsonStream = (value, chunkSize) => streamOf(
  Buffer.from(JSON.stringify(value), 'utf8'), chunkSize,
)

const PROMPT_TEXT = 'фиксированный промпт транспорта'
const request = await requestFor(PROMPT_TEXT, 'main')
const outbound = prepareOutbound({ request: clone(request), profile: clone(PROFILE) })

const calls = []
const clientOf = (respond) => async (call) => { calls.push(call); return respond(call) }
const okClient = clientOf(() => ({ status: 200, body: jsonStream(responseAround(
  JSON.stringify(validProposal(1)),
)) }))
const credentials = async () => CREDENTIAL
/* Полномочие на эффект. В исполнении его выдаёт настоящая ручка журнала;
   здесь оно подставное, но той же формы, и каждый сценарий видит, сколько раз
   его спросили. */
let ownershipChecks = 0
let ownershipFails = false
const owned = async () => {
  ownershipChecks += 1
  if (ownershipFails) throw new Error('исполнение перехвачено эпохой 2')
}
const transportOf = (wireClient, resolveCredentials = credentials) => createModelTransport({
  wireClient, resolveCredentials,
})
const dispatchWith = (wireClient, resolveCredentials, extra = {}) => transportOf(
  wireClient, resolveCredentials,
)({
  request: clone(request), profile: clone(PROFILE), outbound, assertOwnedForEffect: owned, ...extra,
})

/* ── Модуль не знает сети ─────────────────────────────────────────────── */

const transportSource = await readFile(
  path.join(HERE, '..', 'scripts', 'poi-portals', 'lib', 'model-transport.mjs'), 'utf8',
)
t('транспорт не импортирует node:http/https',
  /from ['"]node:https?['"]/.test(transportSource), false)
t('и не зовёт fetch', /\bfetch\s*\(/.test(transportSource), false)
t('и не импортирует SDK провайдера',
  /from ['"](openai|@anthropic-ai|undici|axios|node-fetch)/.test(transportSource), false)
t('и не читает окружение', /process\.env/.test(transportSource), false)
t('транспорта по умолчанию не существует',
  /нет обязательных полей|обязательн/.test(boom(() => createModelTransport({}))), true)
t('провод обязан быть функцией',
  /wireClient: ожидается функция/.test(boom(
    () => createModelTransport({ wireClient: null, resolveCredentials: credentials }),
  )), true)
t('резолвер обязан быть функцией',
  /resolveCredentials: ожидается функция/.test(boom(
    () => createModelTransport({ wireClient: okClient, resolveCredentials: 'из окружения' }),
  )), true)
t('лишний параметр транспорта отвергается',
  /лишние поля/.test(boom(() => createModelTransport({
    wireClient: okClient, resolveCredentials: credentials, endpoint: 'https://api.example.com',
  }))), true)

/* ── Успешный проход ──────────────────────────────────────────────────── */

const success = await dispatchWith(okClient)
t('состав результата точный',
  Object.keys(success).sort().join(','), [...TRANSPORT_RESULT_KEYS].sort().join(','))
t('домен результата второй версии', MODEL_TRANSPORT_RESULT_SPEC, 'poi-model-transport-result/v2')
t('результат принадлежит своему элементу', success.requestItemId, outbound.requestItemId)
t('полученный ответ означает списание', success.charged, true)
t('претензий нет', success.problems, null)
t('предложение довезено без правок',
  JSON.stringify(success.response), JSON.stringify(validProposal(1)))
t('результат заморожен', Object.isFrozen(success), true)

const call = calls.at(-1)
t('метод из дескриптора', call.method, descriptor.method)
t('адрес взят у профиля целиком, а не собран из origin', call.url, PROFILE.endpoint)
t('тело — ровно подготовленный буфер', call.body.compare(outbound.bytes), 0)
t('тайм-аут передан из проверенного запроса', call.timeoutMs, request.timeoutMs)
t('предел ответа передан из дескриптора', call.maxResponseBytes, descriptor.maxResponseBytes)
t('заголовок учётных данных назван дескриптором',
  Object.keys(call.headers).sort().join(','), 'authorization,content-type')
t('и его значение — то, что вернул резолвер', call.headers.authorization, CREDENTIAL)
t('значение учётных данных в результат не попало',
  JSON.stringify(success).includes(CREDENTIAL), false)

/* Резолвер получает перепроверенный профиль и разрешённый дескриптор — и
   ничего сверх: произвольного параметра у него нет. */
let seen = null
await dispatchWith(okClient, async (args) => { seen = args; return CREDENTIAL })
t('резолвер получает ровно два поля',
  Object.keys(seen).sort().join(','), 'descriptor,profile')
t('и профиль в них — проверенный', seen.profile.id, PROFILE.id)
t('и дескриптор — разрешённый из реестра',
  seen.descriptor.descriptorDigest.value, descriptor.descriptorDigest.value)
t('резолвер зовётся ровно один раз на отправку', calls.length, 2)

t('чужая схема заголовка отвергается',
  /значение заголовка вида/.test(await boomAsync(
    () => dispatchWith(okClient, async () => `Basic ${'s'.repeat(32)}`),
  )), true)
t('и перевод строки в значении отвергается',
  /значение заголовка вида/.test(await boomAsync(
    () => dispatchWith(okClient, async () => `Bearer ключ\r\nx-inject: 1`),
  )), true)
t('и пустое значение отвергается',
  /значение заголовка вида/.test(await boomAsync(
    () => dispatchWith(okClient, async () => 'Bearer '),
  )), true)
t('отказ по учётным данным не называет их длину',
  /\b\d{2,}\b/.test(await boomAsync(
    () => dispatchWith(okClient, async () => 'нет ключа'),
  )), false)

/* ── Целостность исходящих на самой границе ───────────────────────────── */

const callsBeforeDrift = calls.length
const drifted = { ...outbound, bytes: Buffer.from(outbound.bytes) }
drifted.bytes[1] = drifted.bytes[1] === 0x20 ? 0x21 : 0x20
t('подмена байтов между подготовкой и отправкой видна',
  /отпечаток против outboundBytesDigest/.test(await boomAsync(
    () => transportOf(okClient)({ request: clone(request), profile: clone(PROFILE), outbound: drifted, assertOwnedForEffect: owned }),
  )), true)
t('и провод при этом не зовётся', calls.length, callsBeforeDrift)
/* Верхняя проверка байтов стоит ДО разрешения учётных данных, и это её
   собственное наблюдаемое свойство: испорченный буфер не имеет права стать
   поводом искать ключ. Нижняя проверка, вплотную к проводу, поймала бы ту же
   порчу — но уже после обращения к резолверу, то есть после лишнего касания
   секрета. */
let resolverCallsOnDrift = 0
await boomAsync(() => transportOf(okClient, async () => {
  resolverCallsOnDrift += 1
  return CREDENTIAL
})({
  request: clone(request),
  profile: clone(PROFILE),
  outbound: drifted,
  assertOwnedForEffect: owned,
}))
t('и учётные данные ради испорченного буфера не разрешаются', resolverCallsOnDrift, 0)
/* И владение ради него тоже не спрашивается: до нижних проверок дело не
   доходит вовсе. */
const ownershipBeforeDrift = ownershipChecks
await boomAsync(() => transportOf(okClient, credentials)({
  request: clone(request),
  profile: clone(PROFILE),
  outbound: drifted,
  assertOwnedForEffect: owned,
}))
t('и владение ради него не спрашивается', ownershipChecks, ownershipBeforeDrift)

const foreignProfile = { ...clone(PROFILE), id: 'other-profile' }
t('владение проверяется перед каждой отправкой', ownershipChecks >= 1, true)

/* ── Окно между учётными данными и проводом ───────────────────────────── */

/* Между верхней проверкой байтов и вызовом провода стоит `await` резолвера,
   то есть целый оборот цикла событий. Внешний держатель успевает переписать
   буфер, и без повторной проверки изменённые байты уходят в сокет. */
const racedOutbound = { ...outbound, bytes: Buffer.from(outbound.bytes) }
const racedCalls = []
const racedFailure = await boomAsync(() => transportOf(
  clientOf((c) => { racedCalls.push(c); return { status: 200, body: jsonStream(responseAround('{}')) } }),
  async () => {
    /* Держатель правит буфер ровно в окне ожидания учётных данных. */
    racedOutbound.bytes[5] = racedOutbound.bytes[5] === 0x20 ? 0x21 : 0x20
    return CREDENTIAL
  },
)({
  request: clone(request),
  profile: clone(PROFILE),
  outbound: racedOutbound,
  assertOwnedForEffect: owned,
}))
t('мутация буфера во время ожидания учётных данных не проходит незамеченной',
  /отпечаток против outboundBytesDigest/.test(racedFailure), true)
t('и до провода изменённые байты не доходят', racedCalls.length, 0)

/* В том же окне чужой процесс успевает захватить исполнение новой эпохой.
   Три прежние проверки владения стоят вокруг записи журнала и это окно не
   покрывают. */
const takeoverCalls = []
ownershipFails = false
const takeoverFailure = await boomAsync(() => transportOf(
  clientOf((c) => { takeoverCalls.push(c); return { status: 200, body: jsonStream(responseAround('{}')) } }),
  async () => { ownershipFails = true; return CREDENTIAL },
)({
  request: clone(request),
  profile: clone(PROFILE),
  outbound,
  assertOwnedForEffect: owned,
}))
ownershipFails = false
t('перехват во время ожидания учётных данных останавливает отправку',
  /перехвачено эпохой 2/.test(takeoverFailure), true)
t('и до провода дело не доходит', takeoverCalls.length, 0)
t('полномочие обязано быть функцией ручки журнала',
  /assertOwnedForEffect: ожидается функция/.test(await boomAsync(
    () => dispatchWith(okClient, credentials, { assertOwnedForEffect: null }),
  )), true)

t('чужой профиль на границе отвергается',
  /providerProfileDigest профиля против подготовленных байтов/.test(await boomAsync(
    () => transportOf(okClient)({ request: clone(request), profile: foreignProfile, outbound, assertOwnedForEffect: owned }),
  )), true)
const foreignRequest = clone(request)
foreignRequest.maxOutputTokens += 1
t('подменённый запрос на границе отвергается',
  /requestSpecDigest/.test(await boomAsync(
    () => transportOf(okClient)({ request: foreignRequest, profile: clone(PROFILE), outbound, assertOwnedForEffect: owned }),
  )), true)
t('лишний параметр вызова отвергается',
  /лишние поля/.test(await boomAsync(() => transportOf(okClient)({
    request: clone(request), profile: clone(PROFILE), outbound, assertOwnedForEffect: owned, credential: SECRET,
  }))), true)

/* ── Полученный ответ — деньги потрачены ──────────────────────────────── */

for (const status of [400, 401, 429, 500, 503]) {
  const answer = await dispatchWith(clientOf(() => ({
    status, body: jsonStream({ error: { message: `внутренний текст ${SECRET}` } }),
  })))
  t(`HTTP ${status} — списание`, answer.charged, true)
  t(`HTTP ${status} — терминальные претензии, а не предложение`, answer.response, null)
  t(`HTTP ${status} — вид проблемы назван`, answer.problems[0].type, 'httpStatus')
  t(`HTTP ${status} — статус назван`, answer.problems[0].prefix.includes(String(status)), true)
  t(`HTTP ${status} — тело ошибки не воспроизводится`,
    JSON.stringify(answer).includes(SECRET), false)
}

const tooLarge = await dispatchWith(clientOf(() => ({
  status: 200,
  body: streamOf(Buffer.alloc(descriptor.maxResponseBytes + 1, 0x61), 4096),
})))
t('превышение предела ответа — списание', tooLarge.charged, true)
t('и терминальный отказ', tooLarge.problems[0].type, 'responseTooLarge')
t('и предел назван', tooLarge.problems[0].prefix.includes(String(descriptor.maxResponseBytes)), true)
t('и разбора не было', tooLarge.response, null)

/* Ранний выход обязан ОТМЕНИТЬ поток. Без `return()` генератор остаётся
   приостановленным, а за ним у настоящего клиента — незакрытое тело и живое
   соединение: предел, после которого мы перестали читать, но не перестали
   держать, пределом не является. */
const cancellableBody = (chunks) => {
  let cancelled = 0
  let index = 0
  return {
    cancelled: () => cancelled,
    body: {
      [Symbol.asyncIterator]: () => ({
        next: async () => (index < chunks.length
          ? { done: false, value: chunks[index++] }
          : { done: true, value: undefined }),
        return: async () => { cancelled += 1; return { done: true, value: undefined } },
      }),
    },
  }
}
const overLimit = cancellableBody([
  Uint8Array.from(Buffer.alloc(descriptor.maxResponseBytes + 1, 0x61)),
])
const cancelledTooLarge = await dispatchWith(clientOf(() => ({
  status: 200, body: overLimit.body,
})))
t('превышение предела отменяет поток', overLimit.cancelled(), 1)
t('и вердикт прежний', cancelledTooLarge.problems[0].type, 'responseTooLarge')

const badChunk = cancellableBody(['не байты'])
const cancelledNotBytes = await dispatchWith(clientOf(() => ({ status: 200, body: badChunk.body })))
t('не-байтовый кусок тоже отменяет поток', badChunk.cancelled(), 1)
t('и вердикт прежний', cancelledNotBytes.problems[0].prefix, NOT_BYTES)

/* Отказ самой отмены вердикта не меняет: это чужой код, и его исключение
   ничего не решает. Проверяются обе формы отказа — синхронная и через
   отклонённый промис, — и вторая обязана быть погашена: всплыв как
   `unhandledRejection`, она уронила бы процесс уже ПОСЛЕ возврата вердикта. */
const unhandled = []
const onUnhandled = (reason) => { unhandled.push(reason) }
process.on('unhandledRejection', onUnhandled)

const rudeCancel = {
  [Symbol.asyncIterator]: () => ({
    next: async () => ({ done: false, value: Uint8Array.from(Buffer.alloc(4, 0x61)) }),
    return: () => { throw new TypeError(`отмена ${SECRET}`) },
  }),
}
const rude = await dispatchWith(clientOf(() => ({ status: 200, body: rudeCancel })))
t('синхронный отказ отмены вердикта не меняет', rude.problems[0].type, 'responseTooLarge')
t('и его текст наружу не выходит', JSON.stringify(rude).includes(SECRET), false)

const rejectingCancel = {
  [Symbol.asyncIterator]: () => ({
    next: async () => ({ done: false, value: Uint8Array.from(Buffer.alloc(4, 0x61)) }),
    return: async () => { throw new TypeError(`отклонённая отмена ${SECRET}`) },
  }),
}
const rejecting = await dispatchWith(clientOf(() => ({ status: 200, body: rejectingCancel })))
t('отклонённая отмена вердикта не меняет', rejecting.problems[0].type, 'responseTooLarge')

/* Главное: `return()` чужой стороны вправе не завершиться НИКОГДА. Ждать
   его — значит подвесить уже известный вердикт: статус получен, предел
   превышен, деньги потрачены. Отмена запрашивается и отпускается. */
const hangingCancel = {
  [Symbol.asyncIterator]: () => ({
    next: async () => ({ done: false, value: Uint8Array.from(Buffer.alloc(4, 0x61)) }),
    return: () => new Promise(() => {}),
  }),
}
const hangingVerdict = await Promise.race([
  dispatchWith(clientOf(() => ({ status: 200, body: hangingCancel }))),
  new Promise((resolve) => { setTimeout(() => resolve('ЗАВИС'), 2000).unref?.() }),
])
t('незавершающаяся отмена вердикт не подвешивает', hangingVerdict === 'ЗАВИС', false)
t('и вердикт всё тот же терминальный', hangingVerdict.problems[0].type, 'responseTooLarge')
t('и списание при этом известно', hangingVerdict.charged, true)

/* Отклонения отмены не всплывают: их гасят на месте. */
await new Promise((resolve) => { setImmediate(resolve) })
process.off('unhandledRejection', onUnhandled)
t('отклонённая отмена не всплывает как unhandledRejection', unhandled.length, 0)

/* Успешное чтение до конца отменять нечего: генератор завершился сам. */
const complete = cancellableBody([Uint8Array.from(Buffer.from('{}', 'utf8'))])
await dispatchWith(clientOf(() => ({ status: 200, body: complete.body })))
t('дочитанный до конца поток не отменяется', complete.cancelled(), 0)

const refusal = await dispatchWith(clientOf(() => ({
  status: 200,
  body: jsonStream({
    id: 'resp', object: 'response', status: 'completed',
    output: [{
      type: 'message', role: 'assistant',
      content: [{ type: 'refusal', refusal: `текст отказа ${SECRET}` }],
    }],
  }),
})))
t('отказ провайдера — списание', refusal.charged, true)
t('и вид проблемы назван', refusal.problems[0].type, 'providerRefusal')
t('и текст отказа не воспроизводится', JSON.stringify(refusal).includes(SECRET), false)

const incomplete = await dispatchWith(clientOf(() => ({
  status: 200,
  body: jsonStream({
    id: 'resp', object: 'response', status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' }, output: [],
  }),
})))
t('обрыв по пределу выходных токенов — списание', incomplete.charged, true)
t('и вид проблемы назван', incomplete.problems[0].type, 'providerIncomplete')
t('и причина названа из закрытого списка',
  incomplete.problems[0].prefix.includes('max_output_tokens'), true)

const strangeReason = await dispatchWith(clientOf(() => ({
  status: 200,
  body: jsonStream({
    id: 'resp', object: 'response', status: 'incomplete',
    incomplete_details: { reason: `выдуманная ${SECRET}` }, output: [],
  }),
})))
t('неизвестная причина сводится к other',
  strangeReason.problems[0].prefix.includes('other'), true)
t('и чужой текст в неё не попадает',
  JSON.stringify(strangeReason).includes(SECRET), false)

for (const [label, payload] of [
  ['не объект', 42],
  ['нет output', { id: 'r', object: 'response', status: 'completed' }],
  ['нет output_text', {
    id: 'r', object: 'response', status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [] }],
  }],
  ['два output_text', {
    id: 'r', object: 'response', status: 'completed',
    output: [{
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'output_text', text: '{}' },
        { type: 'output_text', text: '{}' },
      ],
    }],
  }],
]) {
  const answer = await dispatchWith(clientOf(() => ({ status: 200, body: jsonStream(payload) })))
  t(`негодный ответ (${label}) — списание`, answer.charged, true)
  t(`негодный ответ (${label}) — malformedResponse`, answer.problems[0].type, 'malformedResponse')
}

const notJson = await dispatchWith(clientOf(() => ({
  status: 200, body: streamOf(Buffer.from(`не json ${SECRET}`, 'utf8')),
})))
t('неразбираемое тело — терминальный отказ', notJson.problems[0].type, 'malformedResponse')
t('и в проблему попали длина и отпечаток, а не содержимое',
  /\d+ байт, sha256:[0-9a-f]{64}/.test(notJson.problems[0].prefix), true)
t('и само содержимое не воспроизводится',
  JSON.stringify(notJson).includes(SECRET), false)

const badInner = await dispatchWith(clientOf(() => ({
  status: 200, body: jsonStream(responseAround(`не json ${SECRET}`)),
})))
t('output_text не JSON — терминальный отказ', badInner.problems[0].type, 'malformedResponse')
t('и модельный фрагмент не воспроизводится',
  JSON.stringify(badInner).includes(SECRET), false)

const torn = await dispatchWith(clientOf(() => ({
  status: 200,
  body: {
    async* [Symbol.asyncIterator]() {
      yield Uint8Array.from(Buffer.from('{"output"', 'utf8'))
      throw new Error(`обрыв чтения ${SECRET}`)
    },
  },
})))
t('обрыв чтения после статуса — списание', torn.charged, true)
t('и терминальный отказ, а не неопределённость', torn.problems[0].type, 'malformedResponse')
t('и текст обрыва не воспроизводится', JSON.stringify(torn).includes(SECRET), false)

/* ── Отказ ДО ответа — неопределённость ───────────────────────────────── */

const beforeAnswer = await boomAsync(() => dispatchWith(clientOf(() => {
  throw new Error(`соединение не установлено ${SECRET} https://api.example.com/v1/responses`)
})))
t('отказ до ответа — исключение, а не вердикт',
  /отказ на этапе «отправка запроса»/.test(beforeAnswer), true)
t('и чужой текст в нём не воспроизводится', beforeAnswer.includes(SECRET), false)
t('и адрес в нём не воспроизводится', beforeAnswer.includes('api.example.com'), false)
t('но элемент назван', beforeAnswer.includes(outbound.requestItemId), true)
t('и отпечаток исходящих назван', beforeAnswer.includes(outbound.outboundBytesDigest), true)

const resolverFailure = await boomAsync(() => dispatchWith(okClient, async () => {
  throw new Error(`ключ не найден: ${SECRET}`)
}))
t('отказ резолвера — исключение с фиксированным текстом',
  /отказ на этапе «разрешение учётных данных»/.test(resolverFailure), true)
t('и секрет в нём не воспроизводится', resolverFailure.includes(SECRET), false)

let thrown = null
try {
  await dispatchWith(clientOf(() => { throw new Error('обрыв') }))
} catch (error) { thrown = error }
t('класс отказа отдельный', thrown instanceof ModelTransportError, true)
t('и он несёт размер исходящих', thrown.outboundBytes, outbound.outboundBytes)

/* Класс исключения чужого callback ничего не доказывает о его
   происхождении: его выбирает тот, кто бросает. Поэтому очищается любое —
   и `TypeError`, и `ReferenceError` тоже. */
const typedResolver = await boomAsync(() => dispatchWith(okClient, async () => {
  throw new TypeError(`ключ не найден: ${SECRET}`)
}))
t('TypeError резолвера очищается наравне с прочими',
  /отказ на этапе «разрешение учётных данных»/.test(typedResolver), true)
t('и секрет из него наружу не выходит', typedResolver.includes(SECRET), false)
const typedWire = await boomAsync(() => dispatchWith(clientOf(() => {
  throw new ReferenceError(`несуществующая переменная ${SECRET}`)
})))
t('ReferenceError провода до ответа очищается',
  /отказ на этапе «отправка запроса»/.test(typedWire), true)
t('и секрет из него наружу не выходит', typedWire.includes(SECRET), false)
const typedStream = await dispatchWith(clientOf(() => ({
  status: 200,
  body: {
    async* [Symbol.asyncIterator]() {
      yield Uint8Array.from(Buffer.from('{"out', 'utf8'))
      throw new TypeError(`обрыв ${SECRET}`)
    },
  },
})))
t('TypeError потока ПОСЛЕ статуса — терминальный вердикт, а не исключение',
  typedStream.problems[0].type, 'malformedResponse')
t('и списание при этом названо', typedStream.charged, true)
t('и секрет из него наружу не выходит', JSON.stringify(typedStream).includes(SECRET), false)
t('исходное исключение не выводится через cause',
  (await (async () => {
    try { await dispatchWith(clientOf(() => { throw new Error(SECRET) })) } catch (e) { return e }
  })()).cause, undefined)
/* ── Ленивое поведение объекта, возвращённого проводом ────────────────
   Исключение, брошенное самим `wireClient`, очищается — но чужой код
   продолжает исполняться позже: в getter'ах `status` и `body`, в
   `Symbol.asyncIterator`, в `iterator.next`, в `step.done` и `step.value`.
   Всё это одна внешняя ленивая граница, и очищаться она обязана целиком. */

/* Статус подтверждается ПЕРВЫМ и отдельно. Пока он не подтверждён, дефект —
   неопределённость: был ли ответ, неизвестно. Значения берутся из
   дескриптора, поэтому accessor не исполняется вовсе. */
let statusGetterCalls = 0
const accessorStatus = await boomAsync(() => dispatchWith(clientOf(() => {
  const wire = { body: jsonStream({}) }
  Object.defineProperty(wire, 'status', {
    enumerable: true,
    configurable: true,
    get() { statusGetterCalls += 1; throw new TypeError(`статус ${SECRET}`) },
  })
  return wire
})))
t('accessor у status не даёт подтвердить статус',
  /отказ на этапе «чтение статуса ответа»/.test(accessorStatus), true)
t('и сам getter не исполняется', statusGetterCalls, 0)
t('и секрет наружу не выходит', accessorStatus.includes(SECRET), false)

/* А вот при ПОДТВЕРЖДЁННОМ статусе дефект формы — уже терминальный вердикт:
   ответ был, деньги потрачены, и объявлять списание неизвестным нельзя. */
const confirmedShapeFailures = [
  ['accessor у body', () => {
    const wire = { status: 200 }
    Object.defineProperty(wire, 'body', {
      enumerable: true,
      configurable: true,
      get() { bodyGetterCalls += 1; throw new TypeError(`тело ${SECRET}`) },
    })
    return wire
  }],
  ['лишнее поле', () => ({
    status: 200, body: jsonStream({}), headers: { authorization: SECRET },
  })],
  ['символьное поле', () => {
    const wire = { status: 200, body: jsonStream({}) }
    wire[Symbol('скрытое')] = SECRET
    return wire
  }],
  ['неперечисляемое поле', () => {
    const wire = { status: 200, body: jsonStream({}) }
    Object.defineProperty(wire, 'скрытое', { value: SECRET, enumerable: false })
    return wire
  }],
  ['body отсутствует', () => ({ status: 200 })],
]
let bodyGetterCalls = 0
for (const [label, respond] of confirmedShapeFailures) {
  const answer = await dispatchWith(clientOf(respond))
  t(`${label} при подтверждённом статусе: списание известно`, answer.charged, true)
  t(`${label}: терминальный вердикт`, answer.problems[0].type, 'malformedResponse')
  t(`${label}: назван дефект формы`,
    answer.problems[0].prefix, 'форма ответа провода не соответствует контракту')
  t(`${label}: чужой текст не воспроизводится`, JSON.stringify(answer).includes(SECRET), false)
}
t('accessor у body так и не исполнился', bodyGetterCalls, 0)

/* Proxy перехватывает саму рефлексию: `getPrototypeOf` (то есть
   `isPlainObject`), `ownKeys` и `getOwnPropertyDescriptor`. Раньше эти
   вызовы стояли вне `try`, и ловушка выносила секрет наружу. */
const protoTrap = await boomAsync(() => dispatchWith(clientOf(() => new Proxy(
  { status: 200, body: jsonStream({}) },
  { getPrototypeOf() { throw new TypeError(`прототип ${SECRET}`) } },
))))
t('ловушка getPrototypeOf не даёт подтвердить статус',
  /отказ на этапе «чтение статуса ответа»/.test(protoTrap), true)
t('и секрет наружу не выходит', protoTrap.includes(SECRET), false)

const descriptorTrap = await boomAsync(() => dispatchWith(clientOf(() => new Proxy(
  { status: 200, body: jsonStream({}) },
  { getOwnPropertyDescriptor() { throw new TypeError(`дескриптор ${SECRET}`) } },
))))
t('ловушка getOwnPropertyDescriptor не даёт подтвердить статус',
  /отказ на этапе «чтение статуса ответа»/.test(descriptorTrap), true)
t('и секрет наружу не выходит', descriptorTrap.includes(SECRET), false)

/* Здесь статус уже подтверждён дескриптором, а ловушка бросает ПОЗЖЕ — на
   перечислении ключей. Значит ответ был, и вердикт терминальный. */
const ownKeysTrap = await dispatchWith(clientOf(() => new Proxy(
  { status: 200, body: jsonStream({}) },
  { ownKeys() { throw new TypeError(`ключи ${SECRET}`) } },
)))
t('ловушка ownKeys после подтверждённого статуса — терминальный вердикт',
  ownKeysTrap.problems[0].type, 'malformedResponse')
t('и списание известно', ownKeysTrap.charged, true)
t('и секрет наружу не выходит', JSON.stringify(ownKeysTrap).includes(SECRET), false)

/* Ловушка `get` при РАЗБОРЕ не срабатывает: значения берутся из
   дескриптора. Единственное обращение — `then`, и делает его сам язык,
   проверяя возврат клиента на thenable в `await`; оно стоит внутри `try`
   вокруг вызова провода, поэтому тоже очищается. */
const getTrapKeys = []
const getTrap = await dispatchWith(clientOf(() => new Proxy(
  { status: 200, body: jsonStream(responseAround(JSON.stringify(validProposal(9)))) },
  {
    get(target, key, receiver) {
      getTrapKeys.push(String(key))
      return Reflect.get(target, key, receiver)
    },
  },
)))
t('ловушка get не спрашивается ни про status, ни про body',
  getTrapKeys.filter((key) => key !== 'then').join(','), '')
t('единственное обращение — проверка на thenable самим языком',
  getTrapKeys.join(','), 'then')
t('и годный ответ через Proxy доходит', getTrap.problems, null)

/* Бросающий `then` — это отказ ВНУТРИ `await` вокруг вызова провода: ответа
   мы не получили, и значит исход — неопределённость без чужого текста. */
const thenTrap = await boomAsync(() => dispatchWith(clientOf(() => new Proxy(
  { status: 200, body: jsonStream({}) },
  { get(target, key) { if (key === 'then') throw new TypeError(`then ${SECRET}`); return target[key] } },
))))
t('бросающий then очищается как отказ отправки',
  /отказ на этапе «отправка запроса»/.test(thenTrap), true)
t('и секрет наружу не выходит', thenTrap.includes(SECRET), false)

/* Негодный статус: значение не воспроизводится, статус не подтверждён,
   поэтому исход — неопределённость, а не терминальный вердикт. */
const badStatus = await boomAsync(
  () => dispatchWith(clientOf(() => ({ status: `700 ${SECRET}`, body: jsonStream({}) }))),
)
t('негодный статус — отказ на своём этапе',
  /отказ на этапе «чтение статуса ответа»/.test(badStatus), true)
t('и его значение не воспроизводится', badStatus.includes(SECRET), false)

/* ── После подтверждённого статуса деньги потрачены ───────────────────
   Поэтому любой отказ тела — терминальный вердикт с `charged: true`, а не
   неопределённость: прежний код бросал здесь `TypeError` и превращал
   известное списание в «неизвестно». */
const bodyFailures = [
  ['тела нет вовсе', () => ({ status: 200, body: null }), TORN],
  ['тело не итерируемо', () => ({ status: 200, body: {} }), TORN],
  ['getter Symbol.asyncIterator бросает', () => {
    const body = {}
    Object.defineProperty(body, Symbol.asyncIterator, {
      get() { throw new TypeError(`итератор ${SECRET}`) },
    })
    return { status: 200, body }
  }, TORN],
  ['вызов Symbol.asyncIterator бросает', () => ({
    status: 200,
    body: { [Symbol.asyncIterator]() { throw new TypeError(`создание ${SECRET}`) } },
  }), TORN],
  ['getter next бросает', () => ({
    status: 200,
    body: {
      [Symbol.asyncIterator]() {
        const iterator = {}
        Object.defineProperty(iterator, 'next', {
          get() { throw new TypeError(`next ${SECRET}`) },
        })
        return iterator
      },
    },
  }), TORN],
  ['getter step.done бросает', () => ({
    status: 200,
    body: {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          const step = {}
          Object.defineProperty(step, 'done', {
            get() { throw new TypeError(`done ${SECRET}`) },
          })
          return step
        },
      }),
    },
  }), TORN],
  ['getter step.value бросает', () => ({
    status: 200,
    body: {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          const step = { done: false }
          Object.defineProperty(step, 'value', {
            get() { throw new TypeError(`value ${SECRET}`) },
          })
          return step
        },
      }),
    },
  }), TORN],
  /* Не-байтовый кусок — СВОЙ исход: он не обрыв, а годно прочитанное
     значение не того типа. Общий текст на оба случая позволил бы поменять их
     местами незамеченно. */
  ['кусок не Uint8Array', () => ({
    status: 200,
    body: { async* [Symbol.asyncIterator]() { yield `строка ${SECRET}` } },
  }), NOT_BYTES],
  ['next возвращает не объект', () => ({
    status: 200,
    body: { [Symbol.asyncIterator]: () => ({ next: async () => 42 }) },
  }), TORN],
]
for (const [label, respond, expectedText] of bodyFailures) {
  const answer = await dispatchWith(clientOf(respond))
  t(`${label}: списание известно`, answer.charged, true)
  t(`${label}: терминальный вердикт, а не исключение`, answer.problems[0].type, 'malformedResponse')
  t(`${label}: исход назван своим текстом`, answer.problems[0].prefix, expectedText)
  t(`${label}: предложения нет`, answer.response, null)
  t(`${label}: чужой текст не воспроизводится`,
    JSON.stringify(answer).includes(SECRET), false)
}

/* ── Проверка чужого результата ───────────────────────────────────────── */

t('чужой результат проверяется той же границей',
  boom(() => assertTransportResult({
    requestItemId: outbound.requestItemId, charged: true, response: validProposal(), problems: null,
  }, outbound.requestItemId)) , '(без ошибки)')
/* Результат существует только после полученного HTTP-ответа: до ответа
   функция бросает исключение. `charged: false` описывало бы состояние,
   которого у этого типа не бывает. */
t('ответ с charged: false отвергается',
  /charged: ожидается true/.test(boom(() => assertTransportResult({
    requestItemId: outbound.requestItemId, charged: false, response: validProposal(), problems: null,
  }, outbound.requestItemId))), true)
t('и отказ с charged: false тоже',
  /charged: ожидается true/.test(boom(() => assertTransportResult({
    requestItemId: outbound.requestItemId,
    charged: false,
    response: null,
    problems: [formatProblem('httpStatus', 'HTTP 500')],
  }, outbound.requestItemId))), true)
/* Непустой список чего попало — не список проблем. */
t('строка вместо ограниченной проблемы отвергается',
  boom(() => assertTransportResult({
    requestItemId: outbound.requestItemId, charged: true, response: null, problems: ['текст'],
  }, outbound.requestItemId)) !== '(без ошибки)', true)
t('и проблема с подменённым видом тоже',
  boom(() => assertTransportResult({
    requestItemId: outbound.requestItemId,
    charged: true,
    response: null,
    problems: [{ ...formatProblem('httpStatus', 'HTTP 500'), type: 'выдуманный' }],
  }, outbound.requestItemId)) !== '(без ошибки)', true)
t('и проблема с подменённым началом тоже',
  boom(() => assertTransportResult({
    requestItemId: outbound.requestItemId,
    charged: true,
    response: null,
    problems: [{ ...formatProblem('httpStatus', 'HTTP 500'), prefix: 'другой текст' }],
  }, outbound.requestItemId)) !== '(без ошибки)', true)
t('ответ для чужого элемента не сопоставляется по позиции',
  /ответ принадлежит/.test(boom(() => assertTransportResult({
    requestItemId: 'f'.repeat(64), charged: true, response: validProposal(), problems: null,
  }, outbound.requestItemId))), true)
t('заполненные разом response и problems отвергаются',
  /ровно одно из response и problems/.test(boom(() => assertTransportResult({
    requestItemId: outbound.requestItemId,
    charged: true,
    response: validProposal(),
    problems: [formatProblem('httpStatus', 'HTTP 500')],
  }, outbound.requestItemId))), true)
t('пустые разом тоже отвергаются',
  /ровно одно из response и problems/.test(boom(() => assertTransportResult({
    requestItemId: outbound.requestItemId, charged: true, response: null, problems: null,
  }, outbound.requestItemId))), true)
t('пустой список претензий отвергается',
  /непустой массив/.test(boom(() => assertTransportResult({
    requestItemId: outbound.requestItemId, charged: true, response: null, problems: [],
  }, outbound.requestItemId))), true)
t('домен транспорта объявлен', MODEL_TRANSPORT_SPEC, 'poi-model-transport/v1')

await rm(repoRoot, { recursive: true, force: true })

console.log(bad.length
  ? `✗ провалено ${bad.length}:\n  ${bad.join('\n  ')}`
  : `✓ граница транспорта: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
