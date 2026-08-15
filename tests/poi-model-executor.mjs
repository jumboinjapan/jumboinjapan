/**
 * Provider-neutral запрос и исполнитель — целиком офлайн.
 *
 * Настоящие production-builder, approval, preflight и журнал соединяются с
 * подставным транспортом. Транспорт видит только проверенный
 * `poi-model-request/v1`; endpoint, секрет, HTTP-байты и сеть отсутствуют.
 */
import { existsSync, symlinkSync } from 'node:fs'
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
  MODEL_PRICING_SPEC,
  pricingTableDigest,
} from '../scripts/poi-portals/lib/model-pricing.mjs'
import { PROVIDER_PROFILE_SPEC } from '../scripts/poi-portals/lib/provider-profile.mjs'
import { createArtifactStore } from '../scripts/poi-portals/lib/execution-journal.mjs'
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
  MODEL_EXECUTION_REPORT_SPEC,
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
  let approvalSerial = 0
  const prepare = async (label, decisionOverrides = {}) => {
    approvalSerial += 1
    const approval = buildModelApproval({
      plan: clone(PLAN),
      ...DECISION,
      ...decisionOverrides,
      approvalId: `approval-executor-${approvalSerial}-${label}`,
      limits: clone(LIMITS),
    })
    const fileName = approvalFileName(approval)
    await store.approvals.writeApprovalFile({ approval: clone(approval), plan: clone(PLAN) })
    const preflightInput = {
      approvalFileName: fileName,
      plan: clone(PLAN),
      profile: clone(PROFILE),
      pricingTable: clone(PRICING),
      now: AT,
      store,
      adapters: ADAPTERS,
      resolvePortal: () => portalOf(),
      resolveCodeIdentity: () => ({ ...CODE_IDENTITY }),
      rerunPortal: rerun,
    }
    return { approval, fileName, preflightInput }
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
  t('ключ идемпотентности — готовый requestItemId',
    request.retryPolicy.idempotencyKey, prepared.requestItemId)
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
  t('закреплённый requestSpecDigest', request.requestSpecDigest.value,
    'sha256:6471a80029fc04bccf621991898f88c57132936645bbb81efb9778603ae07f69')
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
  t('домен transport-result объявлен один раз',
    (executorSource.match(/poi-model-transport-result\/v1/g) ?? []).length, 1)
  t('домен результата классификации объявлен один раз',
    (executionSource.match(/classification-result/g) ?? []).length, 1)
  t('живые часы — обязательная функция, а не замороженная строка preflight',
    /нет обязательных полей now/.test(await boomAsync(() => executeModelPlan({
      preflightInput: direct.preflightInput,
      promptText: PROMPT_TEXT,
      schemaObject: clone(SCHEMA_OBJECT),
      transport: async () => { throw new Error('транспорт не должен вызываться') },
    }))), true)

  /* Чистая ошибка сборки запроса обязана случиться до `opened`: разрешение
     остаётся активным, потому что платного эффекта ещё быть не могло. */
  const buildFailureInput = await prepare('build-failure')
  const buildFailure = await boomAsync(() => executeModelPlan({
    preflightInput: buildFailureInput.preflightInput,
    promptText: `${PROMPT_TEXT} дрейф`,
    schemaObject: clone(SCHEMA_OBJECT),
    now: () => AT,
    transport: async () => { throw new Error('транспорт не должен вызываться') },
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
  const writeAhead = []
  const successExecutionId = store.approvalState({ approval: successInput.approval, at: AT }).executionId
  let successTick = 0
  const successNow = () => new Date(Date.parse(AT) + successTick++ * 15 * 60 * 1000).toISOString()
  const success = await executeModelPlan({
    preflightInput: successInput.preflightInput,
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: successNow,
    transport: async (modelRequest) => {
      captured.push(modelRequest)
      const journal = await store.readJournal(successExecutionId)
      const last = journal.records.at(-1)
      writeAhead.push(
        last.type === 'dispatching'
        && last.payload.requestItemId === modelRequest.item.requestItemId
        && last.payload.requestSpecDigest === modelRequest.requestSpecDigest.value,
      )
      return {
        requestItemId: modelRequest.item.requestItemId,
        charged: true,
        response: validProposal(captured.length),
      }
    },
  })
  t('исполнение закрыто', success.state, 'closed')
  t('код успеха нулевой', success.exitCode, 0)
  t('транспорт вызван по одному разу на элемент', captured.length, TOTAL)
  t('каждый вызов увидел синхронизированный dispatching раньше себя',
    writeAhead.every(Boolean), true)
  t('отчёт имеет отдельный домен', success.report.contractVersion, MODEL_EXECUTION_REPORT_SPEC)
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
  const recordTimes = successJournal.records.map((record) => Date.parse(record.at))
  t('каждая стадия получила время из живых часов', new Set(recordTimes).size, recordTimes.length)
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

  /* Итоговая граница не верит даже результату journal.close: отчёт обязан
     самостоятельно свести items и counts. */
  const badSummaryInput = await prepare('bad-summary')
  const badSummaryStore = Object.freeze({
    ...store,
    openJournal: async (options) => {
      const handle = await store.openJournal(options)
      return Object.freeze({
        ...handle,
        close: async (closeOptions) => {
          const summary = await handle.close(closeOptions)
          return {
            ...summary,
            counts: {
              ...summary.counts,
              accepted: summary.counts.accepted - 1,
              rejected: summary.counts.rejected + 1,
            },
          }
        },
      })
    },
  })
  const badSummary = await boomAsync(() => executeModelPlan({
    preflightInput: { ...badSummaryInput.preflightInput, store: badSummaryStore },
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: () => AT,
    transport: async (modelRequest) => ({
      requestItemId: modelRequest.item.requestItemId,
      charged: true,
      response: validProposal(),
    }),
  }))
  t('расхождение summary.counts с items роняет отчёт',
    /report\.summary\.counts\.accepted против items/.test(badSummary), true)

  /* Запись отчёта проходит физическую границу именно в executor, а writer
     не создаёт каталог recursive. Подмена возвращаемого executionDir
     ссылкой не должна вывести байты в её цель. */
  const escapedReportInput = await prepare('escaped-report')
  const linkedExecutionDir = path.join(repoRoot, 'execution-report-link')
  symlinkSync(repoRoot, linkedExecutionDir, 'dir')
  const escapedReportStore = Object.freeze({
    ...store,
    executionDir: () => linkedExecutionDir,
  })
  const escapedReport = await boomAsync(() => executeModelPlan({
    preflightInput: { ...escapedReportInput.preflightInput, store: escapedReportStore },
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: () => AT,
    transport: async (modelRequest) => ({
      requestItemId: modelRequest.item.requestItemId,
      charged: true,
      response: validProposal(),
    }),
  }))
  t('корневая ссылка отчёта отвергается физической границей',
    /сам является символьной ссылкой/.test(escapedReport), true)
  t('за ссылкой файл отчёта не появился',
    (await readdir(repoRoot)).includes(MODEL_EXECUTION_REPORT_FILE_NAME), false)

  /* ── Содержательный отказ модели — терминальный, без повтора ─────── */
  const rejectedInput = await prepare('rejected')
  let rejectedCalls = 0
  const rejected = await executeModelPlan({
    preflightInput: rejectedInput.preflightInput,
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: () => AT,
    transport: async (modelRequest) => {
      rejectedCalls += 1
      return {
        requestItemId: modelRequest.item.requestItemId,
        charged: true,
        response: rejectedCalls % 2
          ? { ...validProposal(rejectedCalls), routeRuleId: 'подмена-маршрута' }
          : `\`\`\`json\n${JSON.stringify(validProposal(rejectedCalls))}\n\`\`\``,
      }
    },
  })
  t('невалидный ответ не ломает исполнение', rejected.state, 'closed')
  t('каждый невалидный ответ стал rejected',
    rejected.report.items.every((item) => item.outcome === 'rejected'), true)
  t('и не вызвал повтор', rejectedCalls, TOTAL)
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
    transport: async () => {
      unknownCalls += 1
      throw new Error('искусственный обрыв транспорта')
    },
  })
  t('ошибка после dispatching требует reconciliation', unknown.state, 'needsReconciliation')
  t('код — сорок', unknown.exitCode, 40)
  t('автоповтора нет', unknownCalls, 1)
  t('отчёта до reconciliation нет', unknown.report, null)
  t('журнал остался незакрытым', unknown.summary.state, 'needsReconciliation')
  t('неопределённый элемент посчитан', unknown.summary.counts.unknown, 1)

  const releaseInput = await prepare('release-failure')
  const releaseFailureStore = Object.freeze({
    ...store,
    openJournal: async (options) => {
      const handle = await store.openJournal(options)
      return Object.freeze({
        ...handle,
        release: async () => {
          await handle.release()
          throw new Error('искусственный отказ release')
        },
      })
    },
  })
  const releaseFailure = await executeModelPlan({
    preflightInput: { ...releaseInput.preflightInput, store: releaseFailureStore },
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: () => AT,
    transport: async () => { throw new Error('исходный обрыв транспорта') },
  })
  t('отказ release не заменяет needsReconciliation',
    releaseFailure.state, 'needsReconciliation')
  t('исходная причина сохранена', releaseFailure.failure.message, 'исходный обрыв транспорта')
  t('отказ уборки сообщён отдельно',
    releaseFailure.releaseFailure.message, 'искусственный отказ release')

  const mismatchInput = await prepare('mismatch')
  let mismatchCalls = 0
  const mismatch = await executeModelPlan({
    preflightInput: mismatchInput.preflightInput,
    promptText: PROMPT_TEXT,
    schemaObject: clone(SCHEMA_OBJECT),
    now: () => AT,
    transport: async () => {
      mismatchCalls += 1
      return { requestItemId: 'f'.repeat(64), charged: true, response: validProposal() }
    },
  })
  t('ответ для чужого элемента не сопоставляется по позиции',
    mismatch.state, 'needsReconciliation')
  t('и тоже не повторяется', mismatchCalls, 1)
  t('причина называет принадлежность ответа',
    /ответ принадлежит/.test(mismatch.failure.message), true)

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
    transport: async () => { refusedCalls += 1 },
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
