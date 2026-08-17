/**
 * Provider-neutral запрос и исполнитель — целиком офлайн.
 *
 * Настоящие production-builder, approval, preflight и журнал соединяются с
 * подставным транспортом. Транспорт видит только проверенный
 * `poi-model-request/v1`; endpoint, секрет, HTTP-байты и сеть отсутствуют.
 */
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
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
  MODEL_PRICING_V2_SPEC,
  pricingTableDigest,
} from '../scripts/poi-portals/lib/model-pricing.mjs'
import { PROVIDER_PROFILE_V2_SPEC } from '../scripts/poi-portals/lib/provider-profile.mjs'
import {
  assertEffectCapableStore,
  assertGenuineJournalHandle,
  assertGenuineStore,
  createArtifactStore,
  FILE_IO,
} from '../scripts/poi-portals/lib/execution-journal.mjs'
import {
  assertExecutionId,
  assertRequestItemId,
} from '../scripts/poi-portals/lib/model-execution.mjs'
import { approvalFileName } from '../scripts/poi-portals/lib/approval-store.mjs'
import { rerunPortalCandidates } from '../scripts/poi-portals/collect-pois.mjs'
import {
  buildModelRequest,
  MODEL_REQUEST_KEYS,
  MODEL_REQUEST_SPEC,
  MODEL_REQUEST_TIMEOUT_MS,
  parseAndVerifyModelRequest,
  requestSpecDigest,
} from '../scripts/poi-portals/lib/model-request.mjs'
import {
  executeModelPlan,
  MODEL_EXECUTION_REPORT_FILE_NAME,
  assertExecutionReportV1,
  assertExecutionReportV2,
  MODEL_EXECUTION_REPORT_SPEC,
  MODEL_EXECUTION_REPORT_V2_SPEC,
  parseAndVerifyExecutionReport,
} from '../scripts/poi-portals/lib/model-executor.mjs'

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
const AT = '2026-08-14T00:00:00.000Z'
const CODE_IDENTITY = { commit: '0'.repeat(40), dirty: false }
const PORTAL_ID = 'p-executor'

const ENTRY = {
  providerId: 'example-provider',
  modelId: 'example-model',
  modelVersion: '2026-08-01',
  inputMicrosPerMillionTokens: 3_000_000,
  outputMicrosPerMillionTokens: 15_000_000,
  cachedInputMicrosPerMillionTokens: 0,
  longContextThresholdInputTokens: 272_000,
  longContextInputMicrosPerMillionTokens: 6_000_000,
  longContextOutputMicrosPerMillionTokens: 22_500_000,
}
const pricingBody = {
  contractVersion: MODEL_PRICING_V2_SPEC,
  pricingTableAsOf: '2026-08-01',
  currency: 'USD',
  entries: [ENTRY],
}
const PRICING = {
  ...pricingBody,
  pricingTableDigest: {
    value: pricingTableDigest({ ...pricingBody, pricingTableDigest: null }),
    algorithm: 'sha256',
    spec: MODEL_PRICING_V2_SPEC,
  },
}
const PROFILE = Object.freeze({
  contractVersion: PROVIDER_PROFILE_V2_SPEC,
  id: 'example-profile',
  version: '1.0.0',
  providerId: ENTRY.providerId,
  modelId: ENTRY.modelId,
  modelIdentity: {
    kind: 'dated-snapshot',
    modelVersion: ENTRY.modelVersion,
    catalogObservedAt: null,
    validUntil: null,
    revisionPolicy: 'immutable',
  },
  endpoint: 'https://api.example.com/v1/responses',
  apiVersion: '2026-08-01',
  structuredOutput: { mode: 'json-schema-strict', schemaDialect: 'json-schema-draft-2020-12' },
  serializer: { id: 'openai-responses', version: '2.0.0' },
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
const ADAPTERS = Object.freeze({
  fake: async () => ({ candidates: clone(awaiting), meta: {} }),
})
const rerun = (portal, options) => rerunPortalCandidates(portal, options)
const evaluated = await rerun(portalOf(), { adapters: ADAPTERS })
const PROMPT_TEXT = 'фиксированный промпт исполнителя'
const SCHEMA_OBJECT = { type: 'object', properties: { entityKind: { type: 'string' } } }
const PLAN = buildModelPlan({
  fragments: [buildPortalPlanFragment({
    portal: portalOf(), evaluated, now: NOW, providerProfile: PROFILE,
  })],
  selectedPortalIds: [PORTAL_ID],
  meta: {
    planId: 'plan-executor',
    createdAt: '2026-08-13T00:00:00.000Z',
    deleteAfter: '2026-08-20T00:00:00.000Z',
    codeIdentity: CODE_IDENTITY,
    taxonomyVersion: 'poi-taxonomy/v2',
    taxonomyBytes: Buffer.from('{"version":"poi-taxonomy/v2"}\n', 'utf8'),
    taxonomySpec: 'raw-file-bytes/v1',
    promptText: PROMPT_TEXT,
    schemaObject: SCHEMA_OBJECT,
    providerProfile: PROFILE,
  },
})
const TOTAL = PLAN.portals[0].plannedItemCount
const MAX_ITEM_BYTES = Math.max(...PLAN.portals[0].items.map((item) => item.classificationItemBytes))
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
  createdAt: '2026-08-13T00:00:00.000Z',
  validUntil: '2026-08-20T00:00:00.000Z',
  decisionRef: 'owner/2026-08-14',
  approver: 'jumbo',
}

/* Провод и резолвер учётных данных — единственные инъекции исполнителя.
   Произвольной функции `transport` в его входе больше нет: она обходила разом
   предел ответа, резолвер, канонический адрес, правило о списании и повторную
   проверку владения перед эффектом. */
const CREDENTIAL = `Bearer ${'s'.repeat(32)}`
const credentials = async () => CREDENTIAL
const jsonBody = (value) => ({
  async* [Symbol.asyncIterator]() { yield Uint8Array.from(Buffer.from(JSON.stringify(value), 'utf8')) },
})
/* Ответ Responses API вокруг текста результата. */
const wireOf = (proposalFor) => {
  let calls = 0
  const seen = []
  const client = async (call) => {
    calls += 1
    seen.push(call)
    return {
      status: 200,
      body: jsonBody({
        id: 'resp', object: 'response', status: 'completed',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: JSON.stringify(proposalFor(calls, call)) }],
        }],
      }),
    }
  }
  return { client, seen, count: () => calls }
}

const validProposal = (index = 0) => ({
  entityKind: 'tourist_poi',
  poiPrimaryType: 'museum',
  facets: [],
  confidence: 0.9,
  reasons: [`подставной ответ ${index}`],
  nameRu: `Тестовый музей ${index}`,
})

const repoRoot = await mkdtemp(path.join(tmpdir(), 'poi-executor-'))
try {
  const store = createArtifactStore({ repoRoot })

  /* Отказы в исполнительских сценариях вызываются через ПУБЛИЧНЫЕ часы.
     Подменный `io` сюда больше не годится: хранилище с ним фабрика создаёт
     честно, но права на платный сетевой эффект оно не даёт — без настоящего
     fsync запись о намерении отправить может не пережить обрыв, тогда как
     запрос уже уйдёт. Отказы самого ввода-вывода проверяются ниже границы
     исполнителя, на ручке журнала, в tests/poi-execution-journal.mjs.

     Часы для этого годятся точно: `readClock` вызывается перед каждой
     записью и перед освобождением эпохи, отказ часов — такой же внутренний
     дефект после открытия журнала, и наступает он ровно там, где нужно. */
  const clockFailingAt = (failAt) => {
    let calls = 0
    return () => {
      calls += 1
      if (calls === failAt) throw new Error(`искусственный отказ часов на вызове ${calls}`)
      return AT
    }
  }
  let approvalSerial = 0
  const prepare = async (label, decisionOverrides = {}, useStore = store) => {
    approvalSerial += 1
    const approval = buildModelApproval({
      plan: clone(PLAN),
      ...DECISION,
      ...decisionOverrides,
      approvalId: `approval-executor-${approvalSerial}-${label}`,
      limits: clone(LIMITS),
    })
    const fileName = approvalFileName(approval)
    await useStore.approvals.writeApprovalFile({ approval: clone(approval), plan: clone(PLAN) })
    const preflightInput = {
      approvalFileName: fileName,
      plan: clone(PLAN),
      profile: clone(PROFILE),
      pricingTable: clone(PRICING),
      now: AT,
      store: useStore,
      adapters: ADAPTERS,
      resolvePortal: () => portalOf(),
      resolveCodeIdentity: () => ({ ...CODE_IDENTITY }),
      rerunPortal: rerun,
    }
    return {
      approval,
      fileName,
      preflightInput,
      executionId: useStore.approvalState({ approval, at: AT }).executionId,
    }
  }

  /* ── Спецификация одного запроса ─────────────────────────────────── */
  const direct = await prepare('request')
  const preflight = await (await import(
    '../scripts/poi-portals/lib/execution-preflight.mjs'
  )).runExecutionPreflight(direct.preflightInput)
  t('положительный preflight готовит все элементы', preflight.preparedItems.length, TOTAL)
  const prepared = preflight.preparedItems[0]
  const request = buildModelRequest({
    plan: clone(PLAN),
    approval: clone(direct.approval),
    profile: clone(PROFILE),
    portalId: prepared.portalId,
    requestItemId: prepared.requestItemId,
    classificationItem: clone(prepared.classificationItem),
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
  })
  t('домен запроса', request.contractVersion, MODEL_REQUEST_SPEC)
  t('тайм-аут фиксирован контрактом', request.timeoutMs, MODEL_REQUEST_TIMEOUT_MS)
  t('повторов нет', request.retryPolicy.maxRetries, 0)
  /* Профиль объявляет ключ идемпотентности НЕподдержанным, и запрос несёт
     `null`. Официальной документации на такой заголовок у `/v1/responses` нет,
     а профиль с `supported: true` подготовка отвергает до открытия журнала. */
  t('ключ идемпотентности отсутствует при fail-closed профиле',
    request.retryPolicy.idempotencyKey, null)
  t('requestItemId не переименован', request.item.requestItemId, prepared.requestItemId)
  t('requestItemId имеет отдельную публичную границу',
    assertRequestItemId === assertExecutionId, false)
  t('состав верхнего уровня точный',
    Object.keys(request).sort().join(','), [...MODEL_REQUEST_KEYS].sort().join(','))
  t('запрос проверяется повторно',
    parseAndVerifyModelRequest(clone(request)).requestSpecDigest.value,
    request.requestSpecDigest.value)
  t('подпись пересчитывается общей функцией',
    requestSpecDigest(clone(request)), request.requestSpecDigest.value)
  /* Значение перезакреплено вместе с профилем: он теперь называет
     канонический сериализатор реестра и origin без пути, а профиль входит в
     подпись запроса целиком. */
  t('закреплённый requestSpecDigest', request.requestSpecDigest.value,
    'sha256:7eaf5bdb182bd6289f59f5e29407698c628e348ba12c3137b663a300235b3bc1')
  t('запрос глубоко заморожен', Object.isFrozen(request.item.value), true)
  const serializedRequest = JSON.stringify(request)
  for (const forbidden of ['endpoint', 'authorization', 'sourceKey', 'outboundBytesDigest']) {
    t(`provider-neutral запрос не содержит ${forbidden}`,
      serializedRequest.includes(forbidden), false)
  }
  const wrongId = { ...prepared, requestItemId: 'f'.repeat(64) }
  t('произвольный requestItemId не проходит выборку плана',
    /не найден в проверенной выборке/.test(boom(() => buildModelRequest({
      plan: clone(PLAN), approval: clone(direct.approval), profile: clone(PROFILE),
      portalId: wrongId.portalId, requestItemId: wrongId.requestItemId,
      classificationItem: clone(wrongId.classificationItem),
      promptText: PROMPT_TEXT, schemaObject: clone(SCHEMA_OBJECT),
    }))), true)
  t('дрейф промпта отвергается', /promptDigest/.test(boom(() => buildModelRequest({
    plan: clone(PLAN), approval: clone(direct.approval), profile: clone(PROFILE),
    portalId: prepared.portalId, requestItemId: prepared.requestItemId,
    classificationItem: clone(prepared.classificationItem),
    promptText: `${PROMPT_TEXT} изменён`, schemaObject: clone(SCHEMA_OBJECT),
  }))), true)
  const tampered = clone(request)
  tampered.maxOutputTokens += 1
  t('подмена подписанного поля запроса отвергается',
    /requestSpecDigest/.test(boom(() => parseAndVerifyModelRequest(tampered))), true)
  for (const [label, spoil] of [
    ['скрытое поле', (x) => Object.defineProperty(x, 'скрытое', { value: 1, enumerable: false })],
    ['символьное поле', (x) => { x[Symbol('скрытое')] = 1 }],
    ['accessor', (x) => Object.defineProperty(x.item, 'скрытое', {
      get: () => 1, enumerable: true, configurable: true,
    })],
  ]) {
    const copy = clone(request)
    spoil(copy)
    t(`сырой запрос отвергает ${label}`,
      boom(() => parseAndVerifyModelRequest(copy)) !== '(без ошибки)', true)
  }
  const executorSource = await readFile(
    path.join(HERE, '..', 'scripts', 'poi-portals', 'lib', 'model-executor.mjs'), 'utf8',
  )
  const requestSource = await readFile(
    path.join(HERE, '..', 'scripts', 'poi-portals', 'lib', 'model-request.mjs'), 'utf8',
  )
  const executionSource = await readFile(
    path.join(HERE, '..', 'scripts', 'poi-portals', 'lib', 'model-execution.mjs'), 'utf8',
  )
  t('исполнитель не импортирует сетевой клиент',
    /from ['"]node:https?['"]|\bfetch\s*\(/.test(executorSource), false)
  t('request не дублирует домен плана v2 литералом',
    requestSource.includes("'poi-model-plan/v2'"), false)
  t('request не дублирует домен approval литералом',
    requestSource.includes("'poi-model-approval/v1'"), false)
  t('requestItemId проверяется своим валидатором',
    requestSource.includes('assertRequestItemId(item.requestItemId'), true)
  t('исполнитель не объявляет домен результата транспорта своим литералом',
    /poi-model-transport-result/.test(executorSource), false)
  /* Доменов результата классификации ровно два — по одному на версию, и оба
     собраны из общего `MODEL_EXECUTION_SPEC`. Третьего написания, как и
     голого литерала, здесь нет. */
  t('домены результата классификации объявлены по одному на версию',
    (executionSource.match(/classification-result/g) ?? []).length, 2)
  t('и ни один не написан голым литералом',
    /'poi-model-execution\/v1:classification-result/.test(executionSource), false)
  t('живые часы — обязательная функция, а не замороженная строка preflight',
    /нет обязательных полей now/.test(await boomAsync(() => executeModelPlan({
      preflightInput: direct.preflightInput,
      promptText: PROMPT_TEXT,
      schemaObject: clone(SCHEMA_OBJECT),
      wireClient: async () => { throw new Error('провод не должен вызываться') },
    resolveCredentials: credentials,
    }))), true)

  /* Чистая ошибка сборки запроса обязана случиться до `opened`: разрешение
     остаётся активным, потому что платного эффекта ещё быть не могло. */
  const buildFailureInput = await prepare('build-failure')
  const buildFailure = await boomAsync(() => executeModelPlan({
    preflightInput: buildFailureInput.preflightInput,
    promptText: `${PROMPT_TEXT} дрейф`,
    schemaObject: clone(SCHEMA_OBJECT),
    now: () => AT,
    wireClient: async () => { throw new Error('провод не должен вызываться') },
    resolveCredentials: credentials,
  }))
  t('ошибка сборки запросов проброшена', /promptDigest/.test(buildFailure), true)
  const unconsumed = store.approvalState({ approval: buildFailureInput.approval, at: AT })
  t('ошибка сборки до opened не расходует разрешение', unconsumed.state, 'active')
  t('и каталог исполнения не создан', existsSync(store.executionDir(unconsumed.executionId)), false)

  /* ── Полный успешный проход ──────────────────────────────────────── */
  const successInput = await prepare('success', {
    validUntil: '2026-08-14T00:30:00.000Z',
  })
  const captured = []
  const preparedDigests = []
  const writeAhead = []
  const successExecutionId = store.approvalState({ approval: successInput.approval, at: AT }).executionId
  let successTick = 0
  const successNow = () => new Date(Date.parse(AT) + successTick++ * 15 * 60 * 1000).toISOString()
  const success = await executeModelPlan({
    preflightInput: successInput.preflightInput,
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: successNow,
    resolveCredentials: credentials,
    wireClient: async (call) => {
      captured.push(call)
      const journal = await store.readJournal(successExecutionId)
      const last = journal.records.at(-1)
      const prior = journal.records.at(-2)
      writeAhead.push(last.type === 'dispatching' && prior.type === 'prepared'
        && last.payload.requestSpecDigest === prior.payload.requestSpecDigest)
      preparedDigests.push(prior.payload.outboundBytesDigest)
      return {
        status: 200,
        body: jsonBody({
          id: 'resp', object: 'response', status: 'completed',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: JSON.stringify(validProposal(captured.length)) }],
          }],
        }),
      }
    },
  })
  t('исполнение закрыто', success.state, 'closed')
  t('код успеха нулевой', success.exitCode, 0)
  t('транспорт вызван по одному разу на элемент', captured.length, TOTAL)
  t('каждый вызов увидел синхронизированный dispatching раньше себя',
    writeAhead.every(Boolean), true)
  t('отчёт имеет отдельный домен второй версии',
    success.report.contractVersion, MODEL_EXECUTION_REPORT_V2_SPEC)
  t('отчёт записан в каталог исполнения',
    success.reportPath,
    path.join(store.executionDir(success.preflight.executionId), MODEL_EXECUTION_REPORT_FILE_NAME))
  const persistedReport = JSON.parse(await readFile(success.reportPath, 'utf8'))
  t('сохранённый отчёт совпадает с возвращённым',
    JSON.stringify(persistedReport), JSON.stringify(success.report))
  t('все результаты приняты', success.report.items.every((item) => item.outcome === 'accepted'), true)
  t('происхождение результата — model',
    success.report.items.every((item) => item.result.classification.classificationSource === 'model'), true)
  t('sourceKey присвоен локальным сопоставлением',
    success.report.items.every((item) => item.result.classification.sourceKey === item.sourceKey), true)
  t('отчёт заморожен', Object.isFrozen(success.report.items[0].result), true)
  const successJournal = await store.readJournal(success.preflight.executionId)
  t('журнал закрыт', successJournal.state, 'closed')
  /* `opened` и подписанный захват первой эпохи — ОДНА операция с одним
     fsync и одним чтением часов, поэтому их момент совпадает намеренно.
     У всех остальных стадий он обязан быть своим. */
  const recordTimes = successJournal.records
    .filter((record) => record.type !== 'claimed')
    .map((record) => Date.parse(record.at))
  t('каждая стадия получила время из живых часов', new Set(recordTimes).size, recordTimes.length)
  t('а захват первой эпохи разделил момент с opened',
    successJournal.records[1].at, successJournal.records[0].at)
  t('время журнала монотонно',
    recordTimes.every((value, index) => index === 0 || value >= recordTimes[index - 1]), true)
  const closedAt = successJournal.records.at(-1).at
  t('retention отчёта отсчитан не раньше фактического закрытия',
    success.report.summary.deleteAfter,
    new Date(Date.parse(closedAt) + 30 * 24 * 60 * 60 * 1000).toISOString())
  const dispatchDigests = new Map(successJournal.records
    .filter((record) => record.type === 'dispatching')
    .map((record) => [record.payload.requestItemId, record.payload.requestSpecDigest]))
  t('каждый settled повторяет digest своего dispatching', successJournal.records
    .filter((record) => record.type === 'settled')
    .every((record) => dispatchDigests.get(record.payload.requestItemId)
      === record.payload.requestSpecDigest), true)
  t('сырого ответа отдельным полем в отчёте нет',
    success.report.items.some((item) => Object.hasOwn(item, 'response')), false)
  const expectedReportIds = success.preflight.preparedItems.map((item) => item.requestItemId)
  t('сохранённый отчёт проходит публичную границу',
    parseAndVerifyExecutionReport({
      report: clone(success.report), expectedRequestItemIds: expectedReportIds,
    }).items.length, TOTAL)
  /* Две версии отчёта различаются одним полем contractVersion и
     каждая проверка отвергает чужую версию поимённо. Общий разбор «по набору
     ключей» принял бы отчёт v2 за v1 ровно тогда, когда двух новых полей нет,
     то есть в единственном случае, ради которого различие и нужно. */
  t('отчёт v2 несёт исходящие байты у каждого элемента',
    success.report.items.every(
      (item) => /^sha256:[0-9a-f]{64}$/.test(item.outboundBytesDigest)
        && Number.isSafeInteger(item.outboundBytes) && item.outboundBytes > 0,
    ), true)
  t('и они совпадают с записанными в журнал',
    success.report.items.map((item) => item.outboundBytesDigest).sort().join(','),
    successJournal.records.filter((record) => record.type === 'prepared')
      .map((record) => record.payload.outboundBytesDigest).sort().join(','))
  t('и провод увидел ровно те байты, что записаны подготовкой',
    preparedDigests.sort().join(','),
    successJournal.records.filter((record) => record.type === 'prepared')
      .map((record) => record.payload.outboundBytesDigest).sort().join(','))
  /* Адрес и заголовки собирает транспорт, а не вызывающий: провод видит
     подписанный профилем адрес целиком и заголовок учётных данных со схемой
     из дескриптора. */
  t('провод получил адрес профиля целиком',
    captured.every((call) => call.url === PROFILE.endpoint), true)
  t('и метод из дескриптора', captured.every((call) => call.method === 'POST'), true)
  t('и заголовок учётных данных',
    captured.every((call) => call.headers.authorization === CREDENTIAL), true)
  t('и подготовленный буфер целиком',
    captured.every((call) => Buffer.isBuffer(call.body)), true)
  t('исходящих байтов в журнале нет — только их отпечаток и длина',
    JSON.stringify(successJournal.records).includes(PROMPT_TEXT), false)
  t('и в отчёте тоже нет', JSON.stringify(success.report).includes(PROMPT_TEXT), false)
  const asV1 = clone(success.report)
  asV1.contractVersion = MODEL_EXECUTION_REPORT_SPEC
  t('разбор v1 отвергает отчёт второй версии',
    /лишние поля|report\.contractVersion/.test(boom(() => assertExecutionReportV1(
      asV1, expectedReportIds,
    ))), true)
  t('и общий разбор отвергает его же',
    boom(() => parseAndVerifyExecutionReport({
      report: asV1, expectedRequestItemIds: expectedReportIds,
    })) !== '(без ошибки)', true)
  const strippedV1 = clone(success.report)
  strippedV1.contractVersion = MODEL_EXECUTION_REPORT_SPEC
  for (const item of strippedV1.items) {
    delete item.outboundBytesDigest
    delete item.outboundBytes
  }
  t('разбор v2 отвергает отчёт первой версии',
    /report\.contractVersion/.test(boom(() => assertExecutionReportV2(
      strippedV1, expectedReportIds,
    ))), true)
  t('неизвестная версия отчёта отвергается',
    /ожидается poi-model-execution-report/.test(boom(() => parseAndVerifyExecutionReport({
      report: { ...clone(success.report), contractVersion: 'poi-model-execution-report/v9' },
      expectedRequestItemIds: expectedReportIds,
    }))), true)

  const missingReportItem = clone(success.report)
  missingReportItem.items.pop()
  t('отчёт без ожидаемого элемента отвергается',
    /report\.items против preparedItems/.test(boom(() => parseAndVerifyExecutionReport({
      report: missingReportItem, expectedRequestItemIds: expectedReportIds,
    }))), true)
  const invalidCharged = clone(success.report)
  invalidCharged.items[0].charged = 'да'
  t('не-boolean charged в отчёте отвергается',
    /charged: ожидается boolean/.test(boom(() => parseAndVerifyExecutionReport({
      report: invalidCharged, expectedRequestItemIds: expectedReportIds,
    }))), true)
  /* Верхний sourceKey элемента и sourceKey его классификации — два разных
     поля одного отчёта. Расхождение приписало бы классификацию чужому POI, и
     ловить его обязана сама граница: журнал сверяет свой sourceKey с opened,
     а отчёт читают отдельно от журнала. */
  const swappedSourceKey = clone(success.report)
  swappedSourceKey.items[0].sourceKey = `${swappedSourceKey.items[0].sourceKey}-чужой`
  t('отчёт с чужим sourceKey у принятого элемента отвергается',
    /sourceKey против/.test(boom(() => parseAndVerifyExecutionReport({
      report: swappedSourceKey, expectedRequestItemIds: expectedReportIds,
    }))), true)
  const badExecutionId = clone(success.report)
  badExecutionId.executionId = 'не-идентификатор'
  t('отчёт с негодным executionId отвергается',
    /64 строчных hex/.test(boom(() => parseAndVerifyExecutionReport({
      report: badExecutionId, expectedRequestItemIds: expectedReportIds,
    }))), true)

  /* Итоговая граница не верит счётчикам, пришедшим рядом с items: отчёт
     обязан свести их сам. Проверяется это прямо на границе отчёта — подменять
     ради этого хранилище незачем и больше нельзя. */
  const badSummaryReport = clone(success.report)
  badSummaryReport.summary.counts.accepted -= 1
  badSummaryReport.summary.counts.rejected += 1
  t('расхождение summary.counts с items роняет отчёт',
    /report\.summary\.counts\.accepted против items/.test(
      boom(() => parseAndVerifyExecutionReport({
        report: badSummaryReport, expectedRequestItemIds: expectedReportIds,
      })),
    ), true)

  /* Физическая граница пути стоит на настоящем каталоге исполнений, а не на
     подменённом методе хранилища. Корень — настоящий, фабрика — настоящая,
     а `tmp/poi-model-executions` в нём заранее сделан символьной ссылкой:
     байты не имеют права уйти за неё ни при открытии журнала, ни при записи
     отчёта. */
  const linkedRepo = await mkdtemp(path.join(tmpdir(), 'poi-linked-'))
  const linkTarget = await mkdtemp(path.join(tmpdir(), 'poi-link-target-'))
  mkdirSync(path.join(linkedRepo, 'tmp'), { recursive: true })
  symlinkSync(linkTarget, path.join(linkedRepo, 'tmp', 'poi-model-executions'), 'dir')
  const linkedStore = createArtifactStore({ repoRoot: linkedRepo })
  const escapedReportInput = await prepare('escaped-report', {}, linkedStore)
  const escapedReport = await boomAsync(() => executeModelPlan({
    preflightInput: escapedReportInput.preflightInput,
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: () => AT,
    wireClient: wireOf(() => validProposal()).client,
    resolveCredentials: credentials,
  }))
  t('символьная ссылка на пути исполнений отвергается физической границей',
    /символьная ссылка в пути журнала/.test(escapedReport), true)
  t('и отказ объясняет, куда ушла бы запись',
    /запись ушла бы туда/.test(escapedReport), true)
  t('за ссылкой ничего не появилось', (await readdir(linkTarget)).length, 0)

  /* ── Содержательный отказ модели — терминальный, без повтора ─────── */
  const rejectedInput = await prepare('rejected')
  const rejectedWire = wireOf((n) => (n % 2
    ? { ...validProposal(n), routeRuleId: 'подмена-маршрута' }
    : `\`\`\`json\n${JSON.stringify(validProposal(n))}\n\`\`\``))
  const rejected = await executeModelPlan({
    preflightInput: rejectedInput.preflightInput,
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: () => AT,
    resolveCredentials: credentials,
    wireClient: rejectedWire.client,
  })
  t('невалидный ответ не ломает исполнение', rejected.state, 'closed')
  t('каждый невалидный ответ стал rejected',
    rejected.report.items.every((item) => item.outcome === 'rejected'), true)
  t('и не вызвал повтор', rejectedWire.count(), TOTAL)
  t('сырой ответ не сохранён в журнале',
    JSON.stringify(await store.readJournal(rejected.preflight.executionId))
      .includes('подмена-маршрута'), false)

  /* ── Неопределённость после dispatching ──────────────────────────── */
  const unknownInput = await prepare('unknown')
  let unknownCalls = 0
  const unknown = await executeModelPlan({
    preflightInput: unknownInput.preflightInput,
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: () => AT,
    resolveCredentials: credentials,
    wireClient: async () => {
      unknownCalls += 1
      throw new Error('искусственный обрыв провода')
    },
  })
  t('ошибка после dispatching требует reconciliation', unknown.state, 'needsReconciliation')
  t('код — сорок', unknown.exitCode, 40)
  t('автоповтора нет', unknownCalls, 1)
  t('отчёта до reconciliation нет', unknown.report, null)
  t('журнал остался незакрытым', unknown.summary.state, 'needsReconciliation')
  t('неопределённый элемент посчитан', unknown.summary.counts.unknown, 1)

  /* Порядок обращений к часам: opened(1), prepared(2), dispatching(3), а
     после обрыва провода — released(4).

     Что именно проверяется, сказано точно. Часы бросают при вычислении
     АРГУМЕНТА `journal.release({ at: readClock(...) })`, то есть сам
     `release` не вызывается вовсе. Это ветка «путь освобождения эпохи
     отказал»: отказ уборки сообщается отдельным полем, эпоха остаётся
     невыпущенной, а итогом исполнения этот отказ не становится. Отказ САМОЙ
     ЗАПИСИ `released` — другой сценарий, и он проверяется ниже границы
     исполнителя, на ручке журнала в tests/poi-execution-journal.mjs, где
     подменный ввод-вывод законен. */
  const releaseInput = await prepare('release-failure')
  const releaseFailure = await executeModelPlan({
    preflightInput: releaseInput.preflightInput,
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: clockFailingAt(4),
    resolveCredentials: credentials,
    wireClient: async () => { throw new Error('исходный обрыв провода') },
  })
  t('отказ release не заменяет needsReconciliation',
    releaseFailure.state, 'needsReconciliation')
  t('исходный текст провода не воспроизводится',
    releaseFailure.failure.message.includes('исходный обрыв провода'), false)
  t('и вместо него фиксированный текст',
    /текст исходной ошибки не воспроизводится/.test(releaseFailure.failure.message), true)
  t('отказ пути освобождения сообщён отдельно и тоже без чужого текста',
    releaseFailure.releaseFailure.message.includes('искусственный отказ часов'), false)
  t('и он всё-таки сообщён',
    /текст исходной ошибки не воспроизводится/.test(releaseFailure.releaseFailure.message), true)
  t('и эпоха осталась невыпущенной',
    releaseFailure.summary.records.some((record) => record.type === 'released'), false)
  t('и до самой записи released дело не дошло — часы отказали раньше',
    releaseFailure.summary.records.map((record) => record.type).join(','),
    'opened,claimed,prepared,dispatching')

  /* ── Отказ ДО первого касания провода ─────────────────────────────
     Прежний код объявлял `needsReconciliation` при любом отказе после
     открытия журнала. Но если провода никто не касался, платного эффекта
     быть не могло: сам журнал в этот момент говорит
     `interruptedBeforeDispatch`, и подменять его вычисленный итог жёсткой
     константой — значит утверждать неопределённое списание там, где его нет. */

  /* Отказ на записи `prepared`: запрос ещё не объявлен отправляемым. */
  /* Второе обращение к часам — момент записи `prepared`. */
  const preparedFailInput = await prepare('prepared-failure')
  let preparedFailCalls = 0
  const preparedFail = await executeModelPlan({
    preflightInput: preparedFailInput.preflightInput,
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: clockFailingAt(2),
    resolveCredentials: credentials,
    wireClient: async () => { preparedFailCalls += 1; throw new Error('провод не должен вызываться') },
  })
  t('провода при отказе prepared никто не касался', preparedFailCalls, 0)
  t('и это записано в итоге', preparedFail.wireReached, false)
  t('итог берётся у журнала, а не объявляется reconciliation',
    preparedFail.state, 'interruptedBeforeDispatch')
  t('и код возврата берётся у журнала, а не назначается исполнителем',
    preparedFail.exitCode, preparedFail.summary.exitCode)
  /* Код у незакрытого журнала один и тот же в обоих состояниях, и это
     верно: каталог исполнения существует, разрешение потреблено, и решать
     судьбу прогона всё равно владельцу. Исправлено здесь другое — прежний
     код объявлял СОСТОЯНИЕ `needsReconciliation`, то есть утверждал
     неопределённое списание там, где провода никто не касался. Состояние и
     `wireReached` теперь говорят правду, а код остаётся журнальным. */
  t('состояние при этом не заявляет неопределённого списания',
    preparedFail.state === 'needsReconciliation', false)
  t('журнал при этом говорит то же самое',
    preparedFail.summary.state, 'interruptedBeforeDispatch')
  t('и записи prepared в нём нет',
    preparedFail.summary.records.some((record) => record.type === 'prepared'), false)
  t('и отчёта нет', preparedFail.report, null)

  /* Отказ на записи `dispatching`: подготовка есть, намерения нет. */
  /* Третье обращение — момент записи `dispatching`: подготовка уже на диске. */
  const dispatchFailInput = await prepare('dispatch-failure')
  let dispatchFailCalls = 0
  const dispatchFail = await executeModelPlan({
    preflightInput: dispatchFailInput.preflightInput,
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: clockFailingAt(3),
    resolveCredentials: credentials,
    wireClient: async () => { dispatchFailCalls += 1; throw new Error('провод не должен вызываться') },
  })
  t('провода при отказе dispatching тоже никто не касался', dispatchFailCalls, 0)
  t('и это записано в итоге', dispatchFail.wireReached, false)
  t('подготовка при этом на диске есть',
    dispatchFail.summary.records.some((record) => record.type === 'prepared'), true)
  t('но отправкой это не стало',
    dispatchFail.summary.records.some((record) => record.type === 'dispatching'), false)
  t('и итог по-прежнему берётся у журнала',
    dispatchFail.state, dispatchFail.summary.state)
  t('и он не reconciliation', dispatchFail.state === 'needsReconciliation', false)

  /* А вот отказ ПОСЛЕ касания провода остаётся неопределённостью. */
  t('обрыв провода по-прежнему требует сверки', unknown.state, 'needsReconciliation')
  t('и там провод действительно вызывали', unknown.wireReached, true)

  /* ── Происхождение хранилища и ручки ──────────────────────────────
     Полномочие на сетевой эффект — метод ручки, а ручка приходит из
     хранилища, которое вызывающий передаёт через публичный вход. Пока
     происхождение не проверялось, обёртка
     `{ ...handle, assertOwnedForEffect: async () => {} }` делала защиту эпохи
     пустой функцией, и провод всё равно вызывался. Ниже — пять подмен; ни в
     одной учётные данные не разрешаются и провод не вызывается. */
  const substitution = async (label, wrapStore) => {
    const input = await prepare(label)
    let wire = 0
    let creds = 0
    const failure = await boomAsync(() => executeModelPlan({
      preflightInput: { ...input.preflightInput, store: wrapStore(input.preflightInput.store) },
      promptText: PROMPT_TEXT,
      schemaObject: clone(SCHEMA_OBJECT),
      now: () => AT,
      resolveCredentials: async () => { creds += 1; return CREDENTIAL },
      wireClient: async () => { wire += 1; throw new Error('провод не должен вызываться') },
    }))
    return { failure, wire, creds }
  }

  /* 1. Подменено только полномочие эпохи. */
  const swapCapability = await substitution('swap-capability', (real) => Object.freeze({
    ...real,
    openJournal: async (options) => Object.freeze({
      ...(await real.openJournal(options)),
      assertOwnedForEffect: async () => {},
    }),
  }))
  t('обёртка вокруг хранилища отвергается',
    /создано не фабрикой createArtifactStore/.test(swapCapability.failure), true)
  t('и учётные данные не разрешаются', swapCapability.creds, 0)
  t('и провод не вызывается', swapCapability.wire, 0)

  /* 2. Подменены записи подготовки и намерения. */
  const swapWrites = await substitution('swap-writes', (real) => Object.freeze({
    ...real,
    openJournal: async (options) => Object.freeze({
      ...(await real.openJournal(options)),
      prepared: async () => {},
      dispatching: async () => {},
    }),
  }))
  t('обёртка, гасящая write-ahead, отвергается',
    /создано не фабрикой createArtifactStore/.test(swapWrites.failure), true)
  t('и до провода не доходит', swapWrites.wire, 0)

  /* 3. Настоящая ручка ЧУЖОГО исполнения. Хранилище настоящее, ручка
        настоящая — не сходится только исполнение, которое она держит. */
  const foreignInput = await prepare('foreign-handle')
  const foreignHandle = await store.openJournal({
    approvalFileName: foreignInput.fileName, plan: clone(PLAN), at: AT,
  })
  const victimInput = await prepare('foreign-victim')
  let foreignWire = 0
  const foreignFailure = await boomAsync(() => executeModelPlan({
    preflightInput: {
      ...victimInput.preflightInput,
      store: Object.freeze({ ...store, openJournal: async () => foreignHandle }),
    },
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: () => AT,
    resolveCredentials: credentials,
    wireClient: async () => { foreignWire += 1; throw new Error('провод не должен вызываться') },
  }))
  t('подстановка настоящей ручки чужого исполнения отвергается',
    foreignFailure !== '(без ошибки)', true)
  t('и провод при этом не вызывается', foreignWire, 0)
  /* И сама пара «настоящее хранилище + чужая ручка» отвергается поимённо. */
  t('проверка происхождения называет чужое исполнение',
    /держит исполнение/.test(boom(() => assertGenuineJournalHandle({
      store,
      handle: foreignHandle,
      executionId: victimInput.executionId,
      generation: 'g2',
    }))), true)

  /* 4. Настоящая ручка, УЖЕ освобождённая: владения у неё больше нет. */
  await foreignHandle.release({ at: AT, reason: 'handoff' })
  t('освобождённая ручка полномочий не даёт',
    /больше не владеет эпохой/.test(boom(() => assertGenuineJournalHandle({
      store,
      handle: foreignHandle,
      executionId: foreignInput.executionId,
      generation: 'g2',
    }))), true)

  /* 5. Клон настоящей ручки — другой объект, и реестр его не знает. */
  const cloneInput = await prepare('cloned-handle')
  const realHandle = await store.openJournal({
    approvalFileName: cloneInput.fileName, plan: clone(PLAN), at: AT,
  })
  t('настоящая ручка проходит',
    boom(() => assertGenuineJournalHandle({
      store, handle: realHandle, executionId: cloneInput.executionId, generation: 'g2',
    })) , '(без ошибки)')
  t('её клон — уже не она',
    /создана не этим модулем/.test(boom(() => assertGenuineJournalHandle({
      store, handle: { ...realHandle }, executionId: cloneInput.executionId, generation: 'g2',
    }))), true)
  t('и чужое поколение отвергается',
    /держит поколение/.test(boom(() => assertGenuineJournalHandle({
      store, handle: realHandle, executionId: cloneInput.executionId, generation: 'g1',
    }))), true)
  t('и клон хранилища тоже',
    /создано не фабрикой/.test(boom(() => assertGenuineJournalHandle({
      store: { ...store },
      handle: realHandle,
      executionId: cloneInput.executionId,
      generation: 'g2',
    }))), true)
  /* Ручка другого настоящего хранилища — тоже отказ. */
  const otherRepo = await mkdtemp(path.join(tmpdir(), 'poi-other-store-'))
  const otherStore = createArtifactStore({ repoRoot: otherRepo })
  t('ручка другого хранилища отвергается',
    /принадлежит другому хранилищу/.test(boom(() => assertGenuineJournalHandle({
      store: otherStore, handle: realHandle, executionId: cloneInput.executionId, generation: 'g2',
    }))), true)
  await realHandle.release({ at: AT, reason: 'handoff' })
  await rm(otherRepo, { recursive: true, force: true })

  /* Хранилище с подменным вводом-выводом фабрика создаёт честно — и это
     законно для отказных сценариев ниже границы исполнителя. Но права на
     платный сетевой эффект оно не даёт: без настоящего fsync запись о
     намерении отправить может не пережить обрыв, а запрос уже уйдёт. */
  const noSyncStore = createArtifactStore({
    repoRoot,
    io: Object.freeze({ ...FILE_IO, syncDirectory: async () => {} }),
  })
  const noSyncInput = await prepare('no-sync', {}, noSyncStore)
  let noSyncWire = 0
  const noSyncFailure = await boomAsync(() => executeModelPlan({
    preflightInput: noSyncInput.preflightInput,
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: () => AT,
    resolveCredentials: credentials,
    wireClient: async () => { noSyncWire += 1; throw new Error('провод не должен вызываться') },
  }))
  t('хранилище с подменным вводом-выводом права на эффект не даёт',
    /подменным вводом-выводом/.test(noSyncFailure), true)
  t('и провод при этом не вызывается', noSyncWire, 0)
  t('и каталог исполнения не создан',
    existsSync(noSyncStore.executionDir(noSyncInput.executionId)), false)
  /* А фабрикой оно всё-таки создано: ниже границы исполнителя оно законно. */
  t('но настоящей фабрикой оно создано',
    boom(() => assertGenuineStore(noSyncStore)), '(без ошибки)')
  t('а права на эффект у него нет',
    /подменным вводом-выводом/.test(boom(() => assertEffectCapableStore(noSyncStore))), true)
  t('у настоящего хранилища право на эффект есть',
    boom(() => assertEffectCapableStore(store)), '(без ошибки)')

  /* ── Отказ preflight не создаёт журнал и не вызывает транспорт ───── */
  let refusedCalls = 0
  const refused = await executeModelPlan({
    preflightInput: {
      ...successInput.preflightInput,
      approvalFileName: `${'e'.repeat(64)}.json`,
    },
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: () => AT,
    resolveCredentials: credentials,
    wireClient: async () => { refusedCalls += 1 },
  })
  t('отказ preflight возвращён как refused', refused.state, 'refused')
  t('транспорт до полного preflight не вызван', refusedCalls, 0)
  t('журнал для неизвестного исполнения не создан',
    existsSync(path.join(repoRoot, 'tmp', 'poi-model-executions', 'нет')), false)
} finally {
  await rm(repoRoot, { recursive: true, force: true })
}

console.log(bad.length
  ? `✗ провалено ${bad.length}:\n  ${bad.join('\n  ')}`
  : `✓ model-request/executor: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
