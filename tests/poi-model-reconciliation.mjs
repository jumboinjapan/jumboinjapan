/**
 * Read-only сверка исполнения — на НАСТОЯЩЕЙ временной файловой системе.
 *
 * Что проверяется здесь и нигде больше: контракт свидетельства владельца и
 * его отпечаток, грамматика записи `reconciled`, три обязательных перехода,
 * идемпотентность, переживающая падение между записями, и то, что при любом
 * отказе байты журнала не меняются.
 *
 * Провайдера, транспорта, адаптеров, модели и Airtable здесь нет ни одного:
 * сверка их не знает, и ни один тест их не импортирует.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as EXECUTION_MODULE from '../scripts/poi-portals/lib/model-execution.mjs'
import { buildModelApproval } from '../scripts/poi-portals/lib/model-approval.mjs'
import { MODEL_PRICING_SPEC } from '../scripts/poi-portals/lib/model-pricing.mjs'
import { PROVIDER_PROFILE_SPEC } from '../scripts/poi-portals/lib/provider-profile.mjs'
import {
  buildModelPlan,
  buildPortalPlanFragment,
  MODEL_INPUT_FIELDS,
} from '../scripts/poi-portals/lib/model-plan.mjs'
import { evaluatePoiCandidate } from '../scripts/poi-portals/lib/scoring.mjs'
import { classifyModelResponse } from '../scripts/poi-portals/lib/classification-contract.mjs'
import {
  buildReconciliationEvidence,
  buildTakeover,
  EXIT_CODES,
  parseAndVerifyReconciliationEvidence,
  RECONCILIATION_EVIDENCE_KEYS,
  RECONCILIATION_EVIDENCE_SPEC,
  RECONCILIATION_GROUNDS,
  JournalContractError,
  RECONCILIATION_VERDICTS,
} from '../scripts/poi-portals/lib/model-execution.mjs'
import { approvalFileName } from '../scripts/poi-portals/lib/approval-store.mjs'
import { createArtifactStore, FILE_IO } from '../scripts/poi-portals/lib/execution-journal.mjs'
import {
  parseAndVerifyReconciliationResult,
  reconcileExecution,
  RECONCILIATION_SPEC,
} from '../scripts/poi-portals/lib/execution-reconciler.mjs'

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

/* ── Фикстуры плана и разрешения ──────────────────────────────────────── */

const awaiting = JSON.parse(await readFile(path.join(FX, 'candidates-awaiting.json'), 'utf8'))
const evaluate = (list) => list.map((c) => ({ candidate: c, verdict: evaluatePoiCandidate(c, { bbox: null }) }))
const NOW = new Date('2026-08-13T00:00:00Z')
const CODE_IDENTITY = { commit: '0'.repeat(40), dirty: false }
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
  pricingTableDigest: { value: `sha256:${'0'.repeat(64)}`, algorithm: 'sha256', spec: MODEL_PRICING_SPEC },
})
const ALLOW = Object.freeze({
  purpose: 'classification',
  allowedProviders: [PROFILE.id],
  fields: [...MODEL_INPUT_FIELDS],
  decisionRef: 'owner/2026-08-14',
  reviewedAt: '2026-08-01',
  validUntil: '2026-12-31',
})
const PORTAL_IDS = ['p-alpha', 'p-beta']
const PLAN = buildModelPlan({
  fragments: PORTAL_IDS.map((id) => buildPortalPlanFragment({
    portal: { id, modelProcessing: ALLOW }, evaluated: evaluate(awaiting), now: NOW, providerProfile: PROFILE,
  })),
  selectedPortalIds: [...PORTAL_IDS],
  meta: {
    planId: 'plan-reconciliation',
    createdAt: '2026-08-13T00:00:00.000Z',
    deleteAfter: '2026-08-20T00:00:00.000Z',
    codeIdentity: CODE_IDENTITY,
    taxonomyVersion: 'poi-taxonomy/v2',
    taxonomyBytes: Buffer.from('{"version":"poi-taxonomy/v2"}\n', 'utf8'),
    taxonomySpec: 'raw-file-bytes/v1',
    promptText: 'фиксированный промпт',
    schemaObject: { type: 'object', properties: { entityKind: { type: 'string' } } },
    providerProfile: PROFILE,
  },
})
const TOTAL = PLAN.portals.reduce((sum, p) => sum + p.plannedItemCount, 0)
const MAX_ITEM_BYTES = PLAN.portals
  .flatMap((p) => p.items.map((i) => i.classificationItemBytes))
  .reduce((max, b) => (b > max ? b : max), 0)
const LIMITS = {
  maxCandidates: TOTAL,
  maxNetworkRequests: TOTAL,
  maxBatchJobs: 0,
  maxItemBytes: MAX_ITEM_BYTES,
  maxInputTokens: 100000,
  maxOutputTokens: 20000,
  maxTotalTokens: 120000,
  maxCostMicros: 5000000,
  currency: 'USD',
  pricingTableDigest: { value: `sha256:${'1'.repeat(64)}`, algorithm: 'sha256', spec: MODEL_PRICING_SPEC },
  pricingTableAsOf: '2026-08-01',
  maxRetries: 0,
}
const DECISION = Object.freeze({
  approvalId: 'approval-reconciliation',
  createdAt: '2026-08-13T00:00:00.000Z',
  validUntil: '2026-08-20T00:00:00.000Z',
  decisionRef: 'owner/2026-08-14',
  approver: 'jumbo',
})
const AT = '2026-08-14T00:00:00.000Z'
const OBSERVED = '2026-08-14T01:00:00.000Z'
const RECONCILED_AT = '2026-08-14T02:00:00.000Z'
const REQUEST_SPEC_DIGEST = `sha256:${'9'.repeat(64)}`
const OTHER_SPEC_DIGEST = `sha256:${'8'.repeat(64)}`

t('подписанное разрешение не допускает ни одного повтора', LIMITS.maxRetries, 0)

/* ── Контракт свидетельства ───────────────────────────────────────────── */

const EXEC_A = 'a'.repeat(64)
const ITEM_A = 'b'.repeat(64)
const evidenceOf = (overrides = {}) => buildReconciliationEvidence({
  executionId: EXEC_A,
  requestItemId: ITEM_A,
  requestSpecDigest: REQUEST_SPEC_DIGEST,
  verdict: 'noCharge',
  grounds: 'providerConsole',
  observedAt: OBSERVED,
  decisionRef: 'owner/2026-08-15: выписка за сутки, строк по этому запросу нет',
  approver: 'jumbo',
  ...overrides,
})
const GOLDEN = evidenceOf()

t('домен свидетельства отдельный', RECONCILIATION_EVIDENCE_SPEC, 'poi-model-reconciliation-evidence/v1')
t('домен результата отдельный', RECONCILIATION_SPEC, 'poi-model-reconciliation/v1')
t('и это разные домены', RECONCILIATION_EVIDENCE_SPEC === RECONCILIATION_SPEC, false)
t('вердиктов ровно два', RECONCILIATION_VERDICTS.join(','), 'noCharge,charged')
t('и список закрыт', Object.isFrozen(RECONCILIATION_VERDICTS), true)
t('оснований ровно три',
  RECONCILIATION_GROUNDS.join(','), 'providerConsole,providerInvoice,providerSupport')
t('положительный контроль: свидетельство собирается и проверяется',
  parseAndVerifyReconciliationEvidence(clone(GOLDEN)).evidenceDigest.value, GOLDEN.evidenceDigest.value)
t('свидетельство заморожено', Object.isFrozen(GOLDEN), true)
t('состав свидетельства закрыт',
  Object.keys(GOLDEN).sort().join(','), [...RECONCILIATION_EVIDENCE_KEYS].sort().join(','))
/* Golden-вектор: известный ответ, закреплённый литералом. Пересчёт тем же
   кодом доказательством не является — он сойдётся с любой формулой, включая
   формулу без домена в байтах.

   Отпечаток здесь — SHA-256 решения, а не криптографическая подпись
   владельца: он даёт идентичность решения и подделку не закрывает. */
t('golden-отпечаток свидетельства', GOLDEN.evidenceDigest.value,
  'sha256:385ba5872b71157f03273c060cdc3242c057737d375b86121298b9cdba7e3b6d')
t('вычислитель отпечатка наружу не выставлен',
  Object.hasOwn(EXECUTION_MODULE, 'reconciliationEvidenceDigest'), false)

/* Обход через публичный вычислитель отпечатка закрыт тем, что вычислителя
   нет: единственные входы — builder и parser, и оба снимают строгую форму
   всего сырого объекта ДО проекции. Проверяется это на них обоих. */
for (const [label, decorate, pattern] of [
  ['неперечисляемое', (o) => { Object.defineProperty(o, 'скрытое', { value: 1, enumerable: false }); return o }, /неперечисляемое/],
  ['символьное', (o) => { o[Symbol('скрытое')] = 1; return o }, /символьные/],
  ['accessor', (o) => { Object.defineProperty(o, 'подставное', { get: () => 1, enumerable: true, configurable: true }); return o }, /accessor/],
]) {
  t(`parser: ${label} свойство отвергается до проекции`,
    pattern.test(boom(() => parseAndVerifyReconciliationEvidence(decorate(clone(GOLDEN))))), true)
  t(`parser: ${label} свойство ВНУТРИ digest отвергается`,
    pattern.test(boom(() => parseAndVerifyReconciliationEvidence({
      ...clone(GOLDEN), evidenceDigest: decorate(clone(GOLDEN.evidenceDigest)),
    }))), true)
}

t('нарушение контракта журнала имеет свой тип',
  new JournalContractError('запись 1: seq') instanceof TypeError, true)
t('перестановка полей привязки меняет отпечаток',
  evidenceOf({ executionId: ITEM_A, requestItemId: EXEC_A }).evidenceDigest.value
    === GOLDEN.evidenceDigest.value, false)
t('подменённый сохранённый digest отвергается',
  /evidenceDigest не сходится/.test(boom(() => parseAndVerifyReconciliationEvidence({
    ...clone(GOLDEN),
    evidenceDigest: { value: `sha256:${'0'.repeat(64)}`, algorithm: 'sha256', spec: RECONCILIATION_EVIDENCE_SPEC },
  }))), true)

for (const [label, mutate, pattern] of [
  ['чужой вердикт', (x) => { x.verdict = 'delivered' }, /verdict/],
  ['чужое основание', (x) => { x.grounds = 'интуиция' }, /grounds/],
  ['пустой decisionRef', (x) => { x.decisionRef = '' }, /decisionRef/],
  ['пустой approver', (x) => { x.approver = '' }, /approver/],
  ['неканонический observedAt', (x) => { x.observedAt = '2026-08-14' }, /observedAt/],
  ['негодный executionId', (x) => { x.executionId = 'нет' }, /executionId/],
  ['негодный requestItemId', (x) => { x.requestItemId = 'нет' }, /requestItemId/],
  ['негодный requestSpecDigest', (x) => { x.requestSpecDigest = 'нет' }, /requestSpecDigest/],
  ['чужая версия контракта', (x) => { x.contractVersion = 'poi-model-reconciliation/v1' }, /contractVersion/],
]) {
  const copy = clone(GOLDEN)
  mutate(copy)
  t(`свидетельство: ${label} отвергается`,
    pattern.test(boom(() => parseAndVerifyReconciliationEvidence(copy))), true)
}
t('свидетельство: лишнее поле отвергается',
  /лишние поля/.test(boom(() => parseAndVerifyReconciliationEvidence({ ...clone(GOLDEN), лишнее: 1 }))), true)
t('свидетельство: недостающее поле отвергается', /нет обязательных полей/.test(boom(() => {
  const copy = clone(GOLDEN)
  delete copy.approver
  return parseAndVerifyReconciliationEvidence(copy)
})), true)
t('сборщик: лишнее поле входа отвергается',
  /лишние поля/.test(boom(() => buildReconciliationEvidence({
    executionId: EXEC_A, requestItemId: ITEM_A, requestSpecDigest: REQUEST_SPEC_DIGEST,
    verdict: 'noCharge', grounds: 'providerConsole', observedAt: OBSERVED,
    decisionRef: 'owner/x', approver: 'jumbo', лишнее: 1,
  }))), true)
t('сборщик: недостающее поле входа отвергается',
  /нет обязательных полей/.test(boom(() => buildReconciliationEvidence({ verdict: 'noCharge' }))), true)
t('сборщик: скрытое поле входа отвергается', /неперечисляемое/.test(boom(() => {
  const input = {
    executionId: EXEC_A, requestItemId: ITEM_A, requestSpecDigest: REQUEST_SPEC_DIGEST,
    verdict: 'noCharge', grounds: 'providerConsole', observedAt: OBSERVED,
    decisionRef: 'owner/x', approver: 'jumbo',
  }
  Object.defineProperty(input, 'скрытое', { value: 1, enumerable: false })
  return buildReconciliationEvidence(input)
})), true)
t('сборщик: accessor-поле входа отвергается', /accessor/.test(boom(() => {
  const input = {
    executionId: EXEC_A, requestItemId: ITEM_A, requestSpecDigest: REQUEST_SPEC_DIGEST,
    verdict: 'noCharge', grounds: 'providerConsole', observedAt: OBSERVED,
    decisionRef: 'owner/x', approver: 'jumbo',
  }
  Object.defineProperty(input, 'подставное', { get: () => 1, enumerable: true, configurable: true })
  return buildReconciliationEvidence(input)
})), true)
t('сборщик: символьное поле входа отвергается', /символьные/.test(boom(() => {
  const input = {
    executionId: EXEC_A, requestItemId: ITEM_A, requestSpecDigest: REQUEST_SPEC_DIGEST,
    verdict: 'noCharge', grounds: 'providerConsole', observedAt: OBSERVED,
    decisionRef: 'owner/x', approver: 'jumbo',
  }
  input[Symbol('скрытое')] = 1
  return buildReconciliationEvidence(input)
})), true)

/* ── Операция на настоящей файловой системе ───────────────────────────── */

const repoRoot = await mkdtemp(path.join(tmpdir(), 'poi-rec-'))
try {
  const store = createArtifactStore({ repoRoot })
  const clockOf = (times) => {
    let i = 0
    return () => times[Math.min(i++, times.length - 1)]
  }
  let approvalSeq = 0
const proposal = () => ({
    entityKind: 'tourist_poi',
    poiPrimaryType: 'museum',
    facets: [],
    confidence: 0.9,
    reasons: ['фикстура'],
    nameRu: 'Тестовый музей',
  })
  /**
   * Журнал в нужном состоянии: N отправленных элементов, из них
   * урегулированы все начиная с `settleFrom`, дескриптор отпущен.
   */
  const prepare = async (dispatchCount, settleFrom = null) => {
    approvalSeq += 1
    const approval = buildModelApproval({
      plan: clone(PLAN), ...DECISION, approvalId: `approval-rec-${approvalSeq}`, limits: clone(LIMITS),
    })
    await store.approvals.writeApprovalFile({ approval: clone(approval), plan: clone(PLAN) })
    const journal = await store.openJournal({
      approvalFileName: approvalFileName(approval), plan: clone(PLAN), at: AT,
    })
    const executionId = journal.executionId
    const items = (await store.readJournal(executionId)).records[0].payload.items
    for (const item of items.slice(0, dispatchCount)) {
      await journal.dispatching({
        requestItemId: item.requestItemId, requestSpecDigest: REQUEST_SPEC_DIGEST, at: AT,
      })
    }
    if (settleFrom !== null) {
      for (const item of items.slice(settleFrom, dispatchCount)) {
        await journal.settled({
          requestItemId: item.requestItemId,
          requestSpecDigest: REQUEST_SPEC_DIGEST,
          outcome: 'accepted',
          charged: true,
          result: classifyModelResponse(proposal(), { sourceKey: item.sourceKey }),
          at: AT,
        })
      }
    }
    await journal.release({ at: AT, reason: 'handoff' })
    return { executionId, items, file: store.journalPath(executionId) }
  }
  const evidenceFor = (executionId, requestItemId, verdict, overrides = {}) => buildReconciliationEvidence({
    executionId,
    requestItemId,
    requestSpecDigest: REQUEST_SPEC_DIGEST,
    verdict,
    grounds: 'providerInvoice',
    observedAt: OBSERVED,
    decisionRef: 'owner/2026-08-15: счёт провайдера за сутки',
    approver: 'jumbo',
    ...overrides,
  })
  const bytesOf = (file) => readFile(file, 'utf8')
  /* Захват эпохи идёт тем же путём, что и в production: план строится до
     открытия дескриптора, а освобождённая эпоха полномочия не требует. */
  const resumeFor = async (executionId, at, takeover = null) => store.resumeJournal({
    plan: await store.planResume({ executionId, takeover, at }),
  })

  /* 1. Положительный: только opened → abortedBeforeDispatch. */
  const aborted = await prepare(0)
  const abortedResult = await reconcileExecution({
    store, executionId: aborted.executionId, evidence: null, takeover: null, now: clockOf([RECONCILED_AT]),
  })
  t('opened-only закрывается сверкой', abortedResult.state, 'closed')
  t('и исход — abortedBeforeDispatch',
    (await store.readJournal(aborted.executionId)).outcome, 'abortedBeforeDispatch')
  t('и дописана ровно одна запись', abortedResult.appendedBusinessRecords.join(','), 'closed')
  t('и свидетельство не требовалось', abortedResult.evidenceApplied, 'none')
  t('и сумма корзин сошлась',
    Object.values(abortedResult.counts).reduce((a, b) => a + b, 0), abortedResult.total)
  t('и все элементы неотправлены', abortedResult.counts.notDispatched, TOTAL)
  t('итог проходит собственную границу',
    parseAndVerifyReconciliationResult(clone(abortedResult)).state, 'closed')

  /* 2. dispatching без settled и без свидетельства — остаётся unknown. */
  const open1 = await prepare(1)
  const beforeOpen1 = await bytesOf(open1.file)
  const untouched = await reconcileExecution({
    store, executionId: open1.executionId, evidence: null, takeover: null, now: clockOf([RECONCILED_AT]),
  })
  t('без свидетельства элемент остаётся неопределённым', untouched.counts.unknown, 1)
  t('и журнал не закрыт', untouched.state, 'needsReconciliation')
  t('и код сорок', untouched.exitCode, EXIT_CODES.needsReconciliation)
  t('и ничего не дописано', untouched.appendedBusinessRecords.length, 0)
  t('и байты журнала не тронуты', await bytesOf(open1.file), beforeOpen1)

  /* 3. Доказанное no-charge. */
  const noChargeEvidence = evidenceFor(open1.executionId, open1.items[0].requestItemId, 'noCharge')
  const noCharge = await reconcileExecution({
    store, executionId: open1.executionId, evidence: noChargeEvidence, takeover: null, now: clockOf([RECONCILED_AT]),
  })
  t('свидетельство noCharge записано', noCharge.appendedBusinessRecords.join(','), 'reconciled')
  t('и применено', noCharge.evidenceApplied, 'applied')
  t('и элемент по-прежнему неопределён', noCharge.counts.unknown, 1)
  t('и журнал остаётся открытым', noCharge.state, 'needsReconciliation')
  t('и код по-прежнему сорок', noCharge.exitCode, EXIT_CODES.needsReconciliation)
  t('и факт подтверждён поимённо',
    noCharge.noChargeConfirmed.join(','), open1.items[0].requestItemId)
  t('и вердикт назван', noCharge.verdict, 'noCharge')
  t('и элемент свидетельства назван', noCharge.evidenceItemId, open1.items[0].requestItemId)
  t('и его состояние — неопределённость', noCharge.evidenceItemOutcome, 'unknown')
  t('но права на повтор итог не выдаёт',
    Object.keys(noCharge).some((key) => /retry|authoriz|planned/i.test(key)), false)
  t('и сумма корзин сошлась',
    Object.values(noCharge.counts).reduce((a, b) => a + b, 0), noCharge.total)

  /* Точный повтор того же решения не открывает файл вовсе. */
  const afterNoCharge = await bytesOf(open1.file)
  let opens = 0
  const countingStore = createArtifactStore({
    repoRoot,
    io: { ...FILE_IO, open: async (target, flags) => { opens += 1; return FILE_IO.open(target, flags) } },
  })
  const repeated = await reconcileExecution({
    store: countingStore,
    executionId: open1.executionId,
    evidence: clone(noChargeEvidence),
    takeover: null, now: clockOf([RECONCILED_AT]),
  })
  t('повтор того же свидетельства ничего не пишет', repeated.appendedBusinessRecords.length, 0)
  t('и назван повтором', repeated.evidenceApplied, 'alreadyRecorded')
  t('и дескриптор не открывался', opens, 0)
  t('и байты не изменились', await bytesOf(open1.file), afterNoCharge)

  /* Другое решение по тому же элементу — отказ, а не вторая запись. */
  const otherEvidence = evidenceFor(open1.executionId, open1.items[0].requestItemId, 'charged')
  t('второе свидетельство того же элемента отвергается',
    /второго свидетельства не бывает/.test(await boomAsync(() => reconcileExecution({
      store, executionId: open1.executionId, evidence: otherEvidence, takeover: null, now: clockOf([RECONCILED_AT]),
    }))), true)
  t('и байты не изменились', await bytesOf(open1.file), afterNoCharge)

  /* Повторная отправка грамматикой по-прежнему запрещена. */
  const reopened = await resumeFor(open1.executionId, RECONCILED_AT)
  t('noCharge не открывает второй dispatching',
    /повторный dispatching/.test(await boomAsync(() => reopened.dispatching({
      requestItemId: open1.items[0].requestItemId,
      requestSpecDigest: REQUEST_SPEC_DIGEST,
      at: RECONCILED_AT,
    }))), true)
  await reopened.release({ at: RECONCILED_AT, reason: 'handoff' })

  /* 4. Доказанное списание — единственный путь к lost и withLoss. */
  const lostRun = await prepare(TOTAL, 1)
  const chargedEvidence = evidenceFor(lostRun.executionId, lostRun.items[0].requestItemId, 'charged')
  const lost = await reconcileExecution({
    store,
    executionId: lostRun.executionId,
    evidence: chargedEvidence,
    takeover: null, now: clockOf([RECONCILED_AT, RECONCILED_AT, RECONCILED_AT]),
  })
  t('charged даёт свидетельство, потерю и закрытие', lost.appendedBusinessRecords.join(','), 'reconciled,settled,closed')
  t('и журнал закрыт', lost.state, 'closed')
  t('и код шестьдесят', lost.exitCode, EXIT_CODES.withLoss)
  t('и элемент посчитан потерянным', lost.counts.lost, 1)
  t('и вердикт назван', lost.verdict, 'charged')
  t('и элемент свидетельства назван', lost.evidenceItemId, lostRun.items[0].requestItemId)
  t('и его состояние — потеря', lost.evidenceItemOutcome, 'lost')
  t('и подтверждений noCharge нет', lost.noChargeConfirmed.length, 0)
  t('и остальные приняты', lost.counts.accepted, TOTAL - 1)
  t('и неотправленных не осталось', lost.counts.notDispatched, 0)
  t('и сумма сошлась', Object.values(lost.counts).reduce((a, b) => a + b, 0), lost.total)
  const lostJournal = await store.readJournal(lostRun.executionId)
  t('исход журнала — withLoss', lostJournal.outcome, 'withLoss')
  const lostRecord = lostJournal.records.find(
    (record) => record.type === 'settled' && record.payload.outcome === 'lost',
  )
  t('и списание записано', lostRecord.payload.charged, true)
  t('и сырого ответа в записи нет', lostRecord.payload.result, null)

  /* Закрытый журнал: новое свидетельство отвергается, применённое — нет. */
  const afterLost = await bytesOf(lostRun.file)
  const secondItemEvidence = evidenceFor(lostRun.executionId, lostRun.items[1].requestItemId, 'charged')
  t('новое свидетельство для закрытого журнала отвергается',
    /журнал закрыт/.test(await boomAsync(() => reconcileExecution({
      store, executionId: lostRun.executionId, evidence: secondItemEvidence, takeover: null, now: clockOf([RECONCILED_AT]),
    }))), true)
  t('и байты закрытого журнала не тронуты', await bytesOf(lostRun.file), afterLost)
  const closedRepeat = await reconcileExecution({
    store, executionId: lostRun.executionId, evidence: clone(chargedEvidence), takeover: null, now: clockOf([RECONCILED_AT]),
  })
  t('уже применённое свидетельство возвращает тот же итог', closedRepeat.exitCode, EXIT_CODES.withLoss)
  t('и ничего не пишет', closedRepeat.appendedBusinessRecords.length, 0)
  t('и байты по-прежнему те же', await bytesOf(lostRun.file), afterLost)

  /* 5. Падение между записями: хвост операции достраивается. */
  const crash1 = await prepare(TOTAL, 1)
  const crashEvidence = evidenceFor(crash1.executionId, crash1.items[0].requestItemId, 'charged')
  const halfHandle = await resumeFor(crash1.executionId, RECONCILED_AT)
  await halfHandle.reconciled({ evidence: crashEvidence, at: RECONCILED_AT })
  await halfHandle.release({ at: RECONCILED_AT, reason: 'handoff' })
  const resumedAfterEvidence = await reconcileExecution({
    store, executionId: crash1.executionId, evidence: clone(crashEvidence), takeover: null, now: clockOf([RECONCILED_AT]),
  })
  t('после падения за свидетельством дописывается потеря и закрытие',
    resumedAfterEvidence.appendedBusinessRecords.join(','), 'settled,closed')
  t('и повтор назван повтором свидетельства', resumedAfterEvidence.evidenceApplied, 'alreadyRecorded')
  t('и журнал закрыт', resumedAfterEvidence.state, 'closed')

  const crash2 = await prepare(TOTAL, 1)
  const crash2Evidence = evidenceFor(crash2.executionId, crash2.items[0].requestItemId, 'charged')
  const halfHandle2 = await resumeFor(crash2.executionId, RECONCILED_AT)
  await halfHandle2.reconciled({ evidence: crash2Evidence, at: RECONCILED_AT })
  await halfHandle2.settled({
    requestItemId: crash2.items[0].requestItemId,
    requestSpecDigest: REQUEST_SPEC_DIGEST,
    outcome: 'lost',
    charged: true,
    result: null,
    at: RECONCILED_AT,
  })
  await halfHandle2.release({ at: RECONCILED_AT, reason: 'handoff' })
  const resumedAfterSettled = await reconcileExecution({
    store, executionId: crash2.executionId, evidence: clone(crash2Evidence), takeover: null, now: clockOf([RECONCILED_AT]),
  })
  t('после падения за потерей дописывается только закрытие',
    resumedAfterSettled.appendedBusinessRecords.join(','), 'closed')
  t('и итог тот же', resumedAfterSettled.exitCode, EXIT_CODES.withLoss)

  /* 6. Чужое и негодное свидетельство отвергается ДО записи. */
  const guarded = await prepare(1)
  const guardedBefore = await bytesOf(guarded.file)
  for (const [label, evidence, pattern] of [
    ['чужое исполнение',
      evidenceFor(EXEC_A, guarded.items[0].requestItemId, 'noCharge'), /executionId против журнала/],
    ['чужой запрос',
      evidenceFor(guarded.executionId, ITEM_A, 'noCharge'), /не объявлен в opened/],
    ['чужой requestSpecDigest',
      evidenceFor(guarded.executionId, guarded.items[0].requestItemId, 'noCharge',
        { requestSpecDigest: OTHER_SPEC_DIGEST }), /requestSpecDigest против dispatching/],
    ['элемент без отправки',
      evidenceFor(guarded.executionId, guarded.items[1].requestItemId, 'noCharge'), /нет dispatching/],
    ['наблюдение раньше отправки',
      evidenceFor(guarded.executionId, guarded.items[0].requestItemId, 'noCharge',
        { observedAt: '2026-08-13T23:00:00.000Z' }), /раньше отправки/],
  ]) {
    t(`${label}: отвергается`, pattern.test(await boomAsync(() => reconcileExecution({
      store, executionId: guarded.executionId, evidence, takeover: null, now: clockOf([RECONCILED_AT]),
    }))), true)
    t(`${label}: байты не тронуты`, await bytesOf(guarded.file), guardedBefore)
  }
  /* Отказ привязки обязан случиться ДО открытия файла: у грамматики есть
     собственный такой же приговор, но он срабатывает уже с открытым
     дескриптором, а сверка не имеет права дойти до записи. */
  let guardOpens = 0
  const guardStore = createArtifactStore({
    repoRoot,
    io: { ...FILE_IO, open: async (file, flags) => { guardOpens += 1; return FILE_IO.open(file, flags) } },
  })
  await boomAsync(() => reconcileExecution({
    store: guardStore,
    executionId: guarded.executionId,
    evidence: evidenceFor(guarded.executionId, guarded.items[0].requestItemId, 'noCharge',
      { requestSpecDigest: OTHER_SPEC_DIGEST }),
    takeover: null, now: clockOf([RECONCILED_AT]),
  }))
  t('чужой requestSpecDigest отвергнут до открытия файла', guardOpens, 0)

  /* Свидетельство из будущего обязано быть отвергнуто ДО открытия файла на
     дозапись: у грамматики есть такой же приговор, но он срабатывает уже с
     открытым дескриптором. */
  let futureOpens = 0
  const futureStore = createArtifactStore({
    repoRoot,
    io: { ...FILE_IO, open: async (file, flags) => { futureOpens += 1; return FILE_IO.open(file, flags) } },
  })
  t('наблюдение позже записи отвергается до открытия файла',
    /позже самой записи/.test(await boomAsync(() => reconcileExecution({
      store: futureStore,
      executionId: guarded.executionId,
      evidence: evidenceFor(guarded.executionId, guarded.items[0].requestItemId, 'noCharge',
        { observedAt: '2026-08-15T00:00:00.000Z' }),
      takeover: null, now: clockOf([RECONCILED_AT]),
    }))), true)
  t('и дескриптор на дозапись не открывался', futureOpens, 0)

  /* Хранилище — вход, а не свидетель: подставные записи обязаны падать на
     собственной проверке сверки, не дойдя до открытия журнала. */
  const realRecords = (await store.readJournal(guarded.executionId)).records
  const forgedStore = (records) => Object.freeze({
    ...store,
    readJournal: async () => Object.freeze({
      state: 'needsReconciliation',
      exitCode: EXIT_CODES.needsReconciliation,
      counts: null,
      outcome: null,
      deleteAfter: null,
      records,
      protocol: 'g1',
      appendability: 'open',
      appendabilityReason: null,
      pendingSegments: [],
      segments: [],
      fork: null,
    }),
    planResume: async () => { throw new Error('журнал не должен открываться на дозапись') },
    resumeJournal: async () => { throw new Error('журнал не должен открываться на дозапись') },
  })
  const brokenItem = clone(realRecords)
  brokenItem[0].payload.items[0].requestItemId = 'не-идентификатор'
  t('подставные записи с негодным requestItemId отвергаются',
    /requestItemId/.test(await boomAsync(() => reconcileExecution({
      store: forgedStore(brokenItem),
      executionId: guarded.executionId,
      evidence: null,
      takeover: null, now: clockOf([RECONCILED_AT]),
    }))), true)
  const forgedClose = clone(realRecords)
  forgedClose.push({
    ...clone(realRecords[realRecords.length - 1]),
    seq: realRecords.length,
    type: 'closed',
    payload: { deleteAfter: '2026-09-20T00:00:00.000Z', outcome: 'allAccepted', counts: {} },
  })
  const forgedMessage = await boomAsync(() => reconcileExecution({
    store: forgedStore(forgedClose),
    executionId: guarded.executionId,
    evidence: null,
    takeover: null, now: clockOf([RECONCILED_AT]),
  }))
  t('подставная запись closed без пересчитанного отпечатка отвергается',
    forgedMessage !== '(без ошибки)', true)
  t('и отказ пришёл от собственной проверки записей, а не от хранилища',
    /recordDigest|closed|counts|payload/.test(forgedMessage), true)
  t('и до открытия журнала на дозапись дело не дошло',
    /не должен открываться/.test(forgedMessage), false)

  /* Наблюдение в будущем относительно самой записи — отказ грамматики. */
  t('наблюдение позже записи отвергается',
    /позже самой записи/.test(await boomAsync(() => reconcileExecution({
      store,
      executionId: guarded.executionId,
      evidence: evidenceFor(guarded.executionId, guarded.items[0].requestItemId, 'noCharge',
        { observedAt: '2026-08-15T00:00:00.000Z' }),
      takeover: null, now: clockOf([RECONCILED_AT]),
    }))), true)
  t('и байты не тронуты', await bytesOf(guarded.file), guardedBefore)
  /* Часы назад относительно последней записи — отказ. */
  t('часы назад отвергаются',
    /раньше предыдущей записи/.test(await boomAsync(() => reconcileExecution({
      store,
      executionId: guarded.executionId,
      evidence: evidenceFor(guarded.executionId, guarded.items[0].requestItemId, 'noCharge'),
      takeover: null, now: clockOf(['2026-08-13T12:00:00.000Z']),
    }))), true)
  t('и байты не тронуты после часов назад', await bytesOf(guarded.file), guardedBefore)

  /* 6а. Грамматика записи — напрямую, без операции: у неё свои приговоры, и
     они обязаны срабатывать сами по себе, а не только через сверку. */
  const grammar = await prepare(1)
  const grammarHandle = await resumeFor(grammar.executionId, RECONCILED_AT)
  t('closeAborted при начатой отправке отвергается',
    /есть отправка/.test(await boomAsync(() => grammarHandle.closeAborted({ at: RECONCILED_AT }))), true)
  t('свидетельство без dispatching отвергается грамматикой',
    /свидетельство без dispatching/.test(await boomAsync(() => grammarHandle.reconciled({
      evidence: evidenceFor(grammar.executionId, grammar.items[1].requestItemId, 'noCharge'),
      at: RECONCILED_AT,
    }))), true)
  t('наблюдение раньше отправки отвергается грамматикой',
    /раньше отправки/.test(await boomAsync(() => grammarHandle.reconciled({
      evidence: evidenceFor(grammar.executionId, grammar.items[0].requestItemId, 'noCharge',
        { observedAt: '2026-08-13T23:00:00.000Z' }),
      at: RECONCILED_AT,
    }))), true)
  await grammarHandle.reconciled({
    evidence: evidenceFor(grammar.executionId, grammar.items[0].requestItemId, 'noCharge'),
    at: RECONCILED_AT,
  })
  t('второе свидетельство того же элемента отвергается грамматикой',
    /второе свидетельство/.test(await boomAsync(() => grammarHandle.reconciled({
      evidence: evidenceFor(grammar.executionId, grammar.items[0].requestItemId, 'charged',
        { decisionRef: 'owner/2026-08-16: другое наблюдение' }),
      at: RECONCILED_AT,
    }))), true)
  await grammarHandle.release({ at: RECONCILED_AT, reason: 'handoff' })

  /* 7. План и разрешение удалены — сверка обязана работать. */
  const orphan = await prepare(1)
  await rm(path.join(repoRoot, 'tmp', 'poi-model-approvals'), { recursive: true, force: true })
  const orphanResult = await reconcileExecution({
    store,
    executionId: orphan.executionId,
    evidence: evidenceFor(orphan.executionId, orphan.items[0].requestItemId, 'noCharge'),
    takeover: null, now: clockOf([RECONCILED_AT]),
  })
  t('сверка работает без плана и без разрешения', orphanResult.appendedBusinessRecords.join(','), 'reconciled')
  t('и элемент остался неопределённым', orphanResult.counts.unknown, 1)

  /* 8. Повреждённый журнал и оборванный хвост не меняются. */
  const corrupt = await prepare(1)
  const corruptFile = corrupt.file
  await writeFile(corruptFile, 'не журнал\n', 'utf8')
  const corruptBytes = await bytesOf(corruptFile)
  const corruptResult = await reconcileExecution({
    store, executionId: corrupt.executionId, evidence: null, takeover: null, now: clockOf([RECONCILED_AT]),
  })
  t('повреждённый журнал назван повреждённым', corruptResult.state, 'journalCorrupt')
  t('и код пятьдесят', corruptResult.exitCode, EXIT_CODES.journalCorrupt)
  t('и ничего не дописано', corruptResult.appendedBusinessRecords.length, 0)
  t('и счётчиков у него нет', corruptResult.counts, null)
  t('и байты не тронуты', await bytesOf(corruptFile), corruptBytes)
  t('итог повреждения проходит границу',
    parseAndVerifyReconciliationResult(clone(corruptResult)).state, 'journalCorrupt')

  const torn = await prepare(1)
  const tornOriginal = await bytesOf(torn.file)
  await writeFile(torn.file, `${tornOriginal}{"частичная`, 'utf8')
  const tornBytes = await bytesOf(torn.file)
  /* Оборванный хвост больше не запирает исполнение навсегда: он делает
     владение неопределённым, и снять неопределённость может только явное
     полномочие владельца. Бизнес-итог при этом сохраняется. */
  const tornResult = await reconcileExecution({
    store,
    executionId: torn.executionId,
    evidence: evidenceFor(torn.executionId, torn.items[0].requestItemId, 'noCharge'),
    takeover: null, now: clockOf([RECONCILED_AT]),
  })
  t('оборванный хвост закрывает дозапись', tornResult.blocked.appendability, 'indeterminate')
  t('и называет причину', tornResult.blocked.reason, 'ownershipIndeterminate')
  t('и ничего не дописано', tornResult.appendedBusinessRecords.length, 0)
  t('и свидетельство не применено', tornResult.evidenceApplied, 'none')
  t('и бизнес-итог не подменён', tornResult.state, 'needsReconciliation')
  t('и счётчики на месте', tornResult.counts.unknown >= 1, true)
  t('итог отказа проходит границу',
    parseAndVerifyReconciliationResult(clone(tornResult)).blocked.reason, 'ownershipIndeterminate')
  t('и байты оборванного журнала не тронуты', await bytesOf(torn.file), tornBytes)

  /* 8а. Право дозаписи: сверка не трогает чужое живое исполнение. */
  const ownedApproval = buildModelApproval({
    plan: clone(PLAN), ...DECISION, approvalId: `approval-владение-${approvalSeq += 1}`,
    limits: clone(LIMITS),
  })
  await store.approvals.writeApprovalFile({ approval: clone(ownedApproval), plan: clone(PLAN) })
  const ownedJournal = await store.openJournal({
    approvalFileName: approvalFileName(ownedApproval), plan: clone(PLAN), at: AT,
  })
  const ownedId = ownedJournal.executionId
  const ownedItems = (await store.readJournal(ownedId)).records[0].payload.items
  await ownedJournal.dispatching({
    requestItemId: ownedItems[0].requestItemId, requestSpecDigest: REQUEST_SPEC_DIGEST, at: AT,
  })
  const ownedBytes = await bytesOf(store.journalPath(ownedId))
  const ownedResult = await reconcileExecution({
    store,
    executionId: ownedId,
    evidence: evidenceFor(ownedId, ownedItems[0].requestItemId, 'noCharge'),
    takeover: null,
    now: clockOf([RECONCILED_AT]),
  })
  t('живое исполнение сверка не дописывает', ownedResult.blocked.reason, 'owned')
  t('и право дозаписи названо', ownedResult.blocked.appendability, 'owned')
  t('и ничего не дописано', ownedResult.appendedBusinessRecords.length, 0)
  t('и свидетельство не применено', ownedResult.evidenceApplied, 'none')
  t('и бизнес-итог сохранён', ownedResult.state, 'needsReconciliation')
  t('и байты живого журнала не тронуты', await bytesOf(store.journalPath(ownedId)), ownedBytes)

  /* По явному полномочию владельца — та же операция проходит. */
  const ownedTakeover = buildTakeover({
    ...(await store.takeoverBinding(ownedId)),
    grounds: 'processExited',
    observedAt: OBSERVED,
    decisionRef: 'owner/2026-08-16: процесс завершён',
    approver: 'jumbo',
  })
  const takenResult = await reconcileExecution({
    store,
    executionId: ownedId,
    evidence: evidenceFor(ownedId, ownedItems[0].requestItemId, 'noCharge'),
    takeover: ownedTakeover,
    now: clockOf([RECONCILED_AT]),
  })
  t('по полномочию владельца свидетельство применяется', takenResult.evidenceApplied, 'applied')
  t('и записано именно свидетельство', takenResult.appendedBusinessRecords.join(','), 'reconciled')
  t('и отказа по протоколу больше нет', takenResult.blocked, null)

  /* 8б. Расщеплённый журнал: логический итог недоказуем, дозаписи нет. */
  const forkedFile = store.journalPath(ownedId)
  const forkedBefore = await bytesOf(forkedFile)
  await writeFile(forkedFile, `${forkedBefore}{"дописано прежним владельцем`, 'utf8')
  const forkedResult = await reconcileExecution({
    store, executionId: ownedId, evidence: null, takeover: null, now: clockOf([RECONCILED_AT]),
  })
  t('расщепление названо своим состоянием', forkedResult.state, 'journalForked')
  t('и получает свой код', forkedResult.exitCode, EXIT_CODES.journalForked)
  t('и корзин у него нет', forkedResult.counts, null)
  t('и ничего не дописано', forkedResult.appendedBusinessRecords.length, 0)
  t('итог расщепления проходит границу',
    parseAndVerifyReconciliationResult(clone(forkedResult)).state, 'journalForked')
  t('и байты расщеплённого журнала не тронуты', await bytesOf(forkedFile),
    `${forkedBefore}{"дописано прежним владельцем`)

  /* 9. Отказ записи и отказ fsync успехом не объявляются. */
  for (const [label, failing] of [
    ['запись', { failWrite: true }],
    ['fsync', { failSync: true }],
  ]) {
    const target = await prepare(1)
    const before = await bytesOf(target.file)
    const failingStore = createArtifactStore({
      repoRoot,
      io: {
        ...FILE_IO,
        open: async (file, flags) => {
          const real = await FILE_IO.open(file, flags)
          return {
            writeFile: async (...args) => {
              if (failing.failWrite) throw new Error(`искусственный отказ записи (${label})`)
              return real.writeFile(...args)
            },
            sync: async () => {
              if (failing.failSync) throw new Error(`искусственный отказ fsync (${label})`)
              return real.sync()
            },
            close: () => real.close(),
          }
        },
      },
    })
    const message = await boomAsync(() => reconcileExecution({
      store: failingStore,
      executionId: target.executionId,
      evidence: evidenceFor(target.executionId, target.items[0].requestItemId, 'noCharge'),
      takeover: null, now: clockOf([RECONCILED_AT]),
    }))
    t(`отказ ${label} не объявляет сверку успешной`,
      new RegExp(`искусственный отказ ${label === 'запись' ? 'записи' : 'fsync'}`).test(message), true)
    const after = await bytesOf(target.file)
    t(`отказ ${label}: журнал читается прежним итогом`,
      (await store.readJournal(target.executionId)).state,
      label === 'запись' ? 'needsReconciliation' : 'needsReconciliation')
    t(`отказ ${label}: прежние записи целы`, after.startsWith(before), true)
  }

  /* 10. Строгая форма входа операции. */
  t('операция отвергает лишнее поле входа',
    /лишние поля/.test(await boomAsync(() => reconcileExecution({
      store, executionId: EXEC_A, evidence: null, now: () => AT, лишнее: 1,
    }))), true)
  t('операция требует часы функцией',
    /ожидается функция/.test(await boomAsync(() => reconcileExecution({
      store, executionId: EXEC_A, evidence: null, takeover: null, now: AT,
    }))), true)

  /* 11. Граница итога: положительный контроль и контрпримеры. */
  const goodResult = clone(untouched)
  t('положительный контроль итога',
    parseAndVerifyReconciliationResult(clone(goodResult)).exitCode, EXIT_CODES.needsReconciliation)
  const brokenSum = clone(goodResult)
  brokenSum.counts.unknown += 1
  t('расхождение суммы корзин роняет итог',
    /сумма против числа элементов/.test(boom(() => parseAndVerifyReconciliationResult(brokenSum))), true)
  const brokenCode = clone(goodResult)
  brokenCode.exitCode = EXIT_CODES.allAccepted
  t('чужой код возврата роняет итог',
    /exitCode/.test(boom(() => parseAndVerifyReconciliationResult(brokenCode))), true)
  const brokenOrder = clone(goodResult)
  brokenOrder.appendedBusinessRecords = ['closed', 'reconciled']
  t('нарушенный порядок дозаписи роняет итог',
    /порядок дозаписи нарушен/.test(boom(() => parseAndVerifyReconciliationResult(brokenOrder))), true)
  const brokenAppended = clone(goodResult)
  brokenAppended.appendedBusinessRecords = ['opened']
  t('недописываемый тип роняет итог',
    /дописать нельзя/.test(boom(() => parseAndVerifyReconciliationResult(brokenAppended))), true)

  /* Полная матрица «состояние × корзины × код». Код закрытого итога выводится
     из корзин единственной общей функцией, поэтому невозможные сочетания
     невыразимы. */
  t('положительный контроль закрытого итога',
    parseAndVerifyReconciliationResult(clone(lost)).exitCode, EXIT_CODES.withLoss)
  const lostWrongCode = clone(lost)
  lostWrongCode.exitCode = EXIT_CODES.allAccepted
  t('потеря с нулевым кодом роняет итог',
    /exitCode против корзин/.test(boom(() => parseAndVerifyReconciliationResult(lostWrongCode))), true)
  const abortedWrongCode = clone(abortedResult)
  abortedWrongCode.exitCode = EXIT_CODES.allAccepted
  t('abortedBeforeDispatch с нулевым кодом роняет итог',
    /exitCode против корзин/.test(boom(() => parseAndVerifyReconciliationResult(abortedWrongCode))), true)
  const closedWithNoCharge = clone(lost)
  closedWithNoCharge.noChargeConfirmed = [lost.noChargeConfirmed[0] ?? 'c'.repeat(64)]
  t('закрытый итог с подтверждением noCharge роняется',
    /оставляет элемент неопределённым/.test(
      boom(() => parseAndVerifyReconciliationResult(closedWithNoCharge))), true)
  const corruptWithEvidence = clone(corruptResult)
  corruptWithEvidence.evidenceApplied = 'applied'
  t('повреждение с применённым свидетельством роняется',
    /evidenceApplied/.test(boom(() => parseAndVerifyReconciliationResult(corruptWithEvidence))), true)
  const openWithoutUnknown = clone(goodResult)
  openWithoutUnknown.counts.unknown = 0
  openWithoutUnknown.counts.notDispatched += 1
  t('открытый итог без неопределённых роняется',
    /только при неопределённых/.test(
      boom(() => parseAndVerifyReconciliationResult(openWithoutUnknown))), true)
  const interrupted = {
    contractVersion: RECONCILIATION_SPEC,
    executionId: abortedResult.executionId,
    state: 'interruptedBeforeDispatch',
    exitCode: EXIT_CODES.needsReconciliation,
    counts: { ...abortedResult.counts },
    total: abortedResult.total,
    appendedBusinessRecords: [],
    appendedProtocolRecords: [],
    evidenceApplied: 'none',
    verdict: null,
    evidenceItemId: null,
    evidenceItemOutcome: null,
    noChargeConfirmed: [],
    reason: null,
    blocked: null,
  }
  t('положительный контроль прерванного до отправки',
    parseAndVerifyReconciliationResult(clone(interrupted)).state, 'interruptedBeforeDispatch')
  const interruptedDirty = clone(interrupted)
  interruptedDirty.counts.notDispatched -= 1
  interruptedDirty.counts.accepted += 1
  t('прерванный до отправки с принятым элементом роняется',
    /interruptedBeforeDispatch/.test(
      boom(() => parseAndVerifyReconciliationResult(interruptedDirty))), true)
  const appliedWithoutRecord = clone(goodResult)
  appliedWithoutRecord.evidenceApplied = 'applied'
  t('«применено» без записи свидетельства роняется',
    /не сходится с evidenceApplied/.test(
      boom(() => parseAndVerifyReconciliationResult(appliedWithoutRecord))), true)
  const settledWithoutEvidence = clone(goodResult)
  settledWithoutEvidence.appendedBusinessRecords = ['settled']
  settledWithoutEvidence.appendedProtocolRecords = ['claimed']
  t('потеря без свидетельства роняется',
    /settled без свидетельства/.test(
      boom(() => parseAndVerifyReconciliationResult(settledWithoutEvidence))), true)
  /* Два обхода, подтверждённые владельцем исполнением. Оба обязаны падать. */
  const noChargeWithoutConfirmation = clone(noCharge)
  noChargeWithoutConfirmation.noChargeConfirmed = []
  t('noCharge без подтверждения элемента роняет итог',
    /подтверждения этого элемента в итоге нет/.test(
      boom(() => parseAndVerifyReconciliationResult(noChargeWithoutConfirmation))), true)
  const closedByReconciled = clone(lost)
  closedByReconciled.appendedBusinessRecords = ['reconciled', 'closed']
  closedByReconciled.evidenceApplied = 'applied'
  closedByReconciled.verdict = 'charged'
  closedByReconciled.evidenceItemOutcome = 'lost'
  closedByReconciled.noChargeConfirmed = []
  t('charged без дописанной потери роняет итог',
    /терминальная потеря не дописана/.test(
      boom(() => parseAndVerifyReconciliationResult(closedByReconciled))), true)
  const closedByNoCharge = clone(closedByReconciled)
  closedByNoCharge.verdict = 'noCharge'
  closedByNoCharge.evidenceItemOutcome = 'unknown'
  closedByNoCharge.noChargeConfirmed = [closedByNoCharge.evidenceItemId]
  t('noCharge, закрывший журнал, роняет итог',
    /журнал закрыться не может/.test(
      boom(() => parseAndVerifyReconciliationResult(closedByNoCharge))), true)
  const appliedWithoutVerdict = clone(noCharge)
  appliedWithoutVerdict.verdict = null
  t('применённое свидетельство без вердикта роняет итог',
    /вердикт не назван/.test(
      boom(() => parseAndVerifyReconciliationResult(appliedWithoutVerdict))), true)
  const noneWithVerdict = clone(goodResult)
  noneWithVerdict.verdict = 'noCharge'
  t('вердикт без применённого свидетельства роняет итог',
    /verdict/.test(boom(() => parseAndVerifyReconciliationResult(noneWithVerdict))), true)
  const chargedAndNoCharge = clone(lost)
  chargedAndNoCharge.noChargeConfirmed = [chargedAndNoCharge.evidenceItemId]
  t('один элемент не бывает и charged, и noCharge',
    /одновременно/.test(boom(() => parseAndVerifyReconciliationResult(chargedAndNoCharge))), true)

  /* Обход `alreadyRecorded: charged` без дописанной потери. На настоящем
     пути такой итог невозможен: свидетельство записано, элемент ещё не
     потерян — reconciler обязан достроить `settled`, а при отказе записи
     бросить исключение, а не вернуть результат. */
  const chargedStillUnknown = clone(noCharge)
  chargedStillUnknown.evidenceApplied = 'alreadyRecorded'
  chargedStillUnknown.verdict = 'charged'
  chargedStillUnknown.appendedBusinessRecords = []
  chargedStillUnknown.appendedProtocolRecords = []
  chargedStillUnknown.noChargeConfirmed = []
  t('charged с неопределённым элементом роняет итог',
    /charged: состояние элемента/.test(
      boom(() => parseAndVerifyReconciliationResult(chargedStillUnknown))), true)
  const chargedWithoutLostCount = clone(chargedStillUnknown)
  chargedWithoutLostCount.evidenceItemOutcome = 'lost'
  t('и объявленная потеря без единой потери в корзинах — тоже',
    /потерянных нет/.test(
      boom(() => parseAndVerifyReconciliationResult(chargedWithoutLostCount))), true)
  const noChargeCalledLost = clone(noCharge)
  noChargeCalledLost.evidenceItemOutcome = 'lost'
  t('noCharge с потерянным элементом роняет итог',
    /noCharge: состояние элемента/.test(
      boom(() => parseAndVerifyReconciliationResult(noChargeCalledLost))), true)
  const outcomeWithoutEvidence = clone(goodResult)
  outcomeWithoutEvidence.evidenceItemOutcome = 'lost'
  t('состояние элемента без свидетельства роняет итог',
    /evidenceItemOutcome/.test(
      boom(() => parseAndVerifyReconciliationResult(outcomeWithoutEvidence))), true)
  const alienOutcome = clone(lost)
  alienOutcome.evidenceItemOutcome = 'accepted'
  t('чужое состояние элемента роняет итог',
    /evidenceItemOutcome/.test(boom(() => parseAndVerifyReconciliationResult(alienOutcome))), true)

  const badConfirmedId = clone(goodResult)
  badConfirmedId.noChargeConfirmed = ['не-идентификатор']
  t('неканонический requestItemId в подтверждениях роняется',
    /noChargeConfirmed/.test(boom(() => parseAndVerifyReconciliationResult(badConfirmedId))), true)
  /* 11а. Записи протокола перечисляются, а не умалчиваются. */
  t('закрывающая сверка называет захват эпохи',
    abortedResult.appendedProtocolRecords.join(','), 'claimed')
  t('и бизнес-записи отдельно', abortedResult.appendedBusinessRecords.join(','), 'closed')
  t('незакрывающая сверка называет и освобождение',
    noCharge.appendedProtocolRecords.join(','), 'claimed,released')
  t('а отказ по протоколу не пишет ничего',
    ownedResult.appendedProtocolRecords.length + ownedResult.appendedBusinessRecords.length, 0)

  /* 11б. Матрица отказа по протоколу закрыта. */
  const blockedSample = clone(ownedResult)
  t('положительный контроль отказа',
    parseAndVerifyReconciliationResult(clone(blockedSample)).blocked.reason, 'owned')
  for (const [label, patch, pattern] of [
    ['owned с readOnly', { blocked: { appendability: 'readOnly', reason: 'owned' } },
      /blocked\.reason «owned»: appendability/],
    ['preProtocol с indeterminate',
      { blocked: { appendability: 'indeterminate', reason: 'preProtocol' } },
      /blocked\.reason «preProtocol»: appendability/],
    ['ownershipIndeterminate с owned',
      { blocked: { appendability: 'owned', reason: 'ownershipIndeterminate' } },
      /blocked\.reason «ownershipIndeterminate»: appendability/],
    ['protocolInitializationIncomplete с readOnly',
      { blocked: { appendability: 'readOnly', reason: 'protocolInitializationIncomplete' } },
      /blocked\.reason «protocolInitializationIncomplete»: appendability/],
  ]) {
    t(`несовместимая пара отвергается: ${label}`,
      pattern.test(boom(() => parseAndVerifyReconciliationResult({ ...blockedSample, ...patch }))),
      true)
  }
  const blockedClosed = clone(closedRepeat)
  blockedClosed.blocked = { appendability: 'owned', reason: 'owned' }
  blockedClosed.evidenceApplied = 'none'
  blockedClosed.verdict = null
  blockedClosed.evidenceItemId = null
  blockedClosed.evidenceItemOutcome = null
  t('закрытый журнал отказа по протоколу не несёт',
    /отказ по протоколу к этому состоянию неприменим/.test(
      boom(() => parseAndVerifyReconciliationResult(blockedClosed))), true)
  const blockedCorrupt = clone(corruptResult)
  blockedCorrupt.blocked = { appendability: 'owned', reason: 'owned' }
  t('повреждённый журнал тоже',
    /отказ по протоколу к этому состоянию неприменим/.test(
      boom(() => parseAndVerifyReconciliationResult(blockedCorrupt))), true)
  const blockedForked = clone(forkedResult)
  blockedForked.blocked = { appendability: 'owned', reason: 'owned' }
  t('и расщеплённый тоже',
    /отказ по протоколу к этому состоянию неприменим/.test(
      boom(() => parseAndVerifyReconciliationResult(blockedForked))), true)
  /* История протокола выводится из бизнес-записей: возможных историй ровно
     три, всё остальное — описание того, чего не бывает. */
  for (const [label, protocol, business] of [
    ['повтор захвата', ['claimed', 'claimed'], null],
    ['два освобождения', ['claimed', 'released', 'released'], null],
    ['освобождение после закрытия', ['claimed', 'released'], ['closed']],
    ['одинокий захват без дозаписи', ['claimed'], []],
    ['дозапись без захвата', [], ['closed']],
    ['освобождение первым', ['released', 'claimed'], null],
  ]) {
    const forged = clone(abortedResult)
    forged.appendedProtocolRecords = protocol
    if (business !== null) forged.appendedBusinessRecords = business
    t(`невозможная история протокола отвергается: ${label}`,
      /история протокола против дописанных бизнес-записей|записью протокола не является/.test(
        boom(() => parseAndVerifyReconciliationResult(forged))), true)
  }
  const незакрытый = clone(noCharge)
  t('положительный контроль незакрытой истории',
    parseAndVerifyReconciliationResult(clone(незакрытый)).appendedProtocolRecords.join(','),
    'claimed,released')

} finally {
  await rm(repoRoot, { recursive: true, force: true })
}

/* ── Ни провайдера, ни сети ───────────────────────────────────────────── */

/* Поведением это не отличить: модуль просто не содержит такого пути. Поэтому
   проверка текстовая, и это сказано вслух. */
const reconcilerSource = await readFile(
  path.join(HERE, '..', 'scripts', 'poi-portals', 'lib', 'execution-reconciler.mjs'), 'utf8',
)
for (const forbidden of ['fetch(', 'node:http', 'undici', 'airtable', 'adapters', 'model-executor', 'transport']) {
  t(`сверка не знает «${forbidden}»`, reconcilerSource.includes(forbidden), false)
}

console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ reconciliation: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
