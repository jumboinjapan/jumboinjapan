/**
 * Офлайн-исполнитель provider-neutral спецификаций.
 *
 * Эффекты — существующий локальный журнал и производный `report.json` после
 * его закрытия. Транспорт приходит функцией и в production по умолчанию не
 * существует; модуль не импортирует HTTP-клиент, `fetch`, endpoint или
 * секреты. Конкретный транспорт и outbound-байты — следующий отдельный
 * контракт.
 *
 * Порядок: полный preflight → `opened` → `dispatching` с requestSpecDigest
 * и fsync → инъецируемый транспорт → ТОЛЬКО `classifyModelResponse` →
 * `settled` → `closed` → проверенный отчёт в памяти. Сырой ответ в журнал и
 * отчёт не попадает.
 */
import {
  assertCanonicalInstant,
  assertExactKeys,
  assertExactly,
  assertIdentity,
  assertInteger,
  assertNonEmptyString,
  assertSha256Value,
  canonicalJsonBytes,
  deepFreeze,
  isPlainObject,
} from '../../lib/canonical-contract.mjs'
import path from 'node:path'
import { ARTIFACT_NAMES } from '../../lib/path-boundary.mjs'
import { writeExclusiveJsonArtifact } from '../../lib/report-writer.mjs'
import { classifyModelResponse } from './classification-contract.mjs'
import { runExecutionPreflight } from './execution-preflight.mjs'
import {
  COUNT_BUCKETS,
  EXIT_CODES,
  assertClassificationResult,
  assertExecutionId,
  assertRequestItemId,
  assertStrictOptions,
} from './model-execution.mjs'
import { buildModelRequest } from './model-request.mjs'

export const MODEL_EXECUTION_REPORT_SPEC = 'poi-model-execution-report/v1'
export const MODEL_TRANSPORT_RESULT_SPEC = 'poi-model-transport-result/v1'
export const MODEL_EXECUTION_REPORT_FILE_NAME = 'report.json'
export const EXECUTOR_RESULT_STATES = Object.freeze(['refused', 'closed', 'needsReconciliation'])

const EXECUTOR_INPUT_KEYS = Object.freeze([
  'preflightInput', 'transport', 'promptText', 'schemaObject', 'now',
])
const TRANSPORT_RESULT_KEYS = Object.freeze(['requestItemId', 'charged', 'response'])
const REPORT_KEYS = Object.freeze([
  'contractVersion', 'executionId', 'checkedAt', 'planId', 'planDigest',
  'approvalDigest', 'providerProfileDigest', 'items', 'summary',
])
const REPORT_ITEM_KEYS = Object.freeze([
  'requestItemId', 'sourceKey', 'candidateInputDigest', 'requestSpecDigest',
  'outcome', 'charged', 'result',
])
const SUMMARY_KEYS = Object.freeze(['state', 'counts', 'outcome', 'exitCode', 'deleteAfter'])
const REPORT_VERIFY_KEYS = Object.freeze(['report', 'expectedRequestItemIds'])

function safeFailure(error) {
  return Object.freeze({
    name: typeof error?.name === 'string' && error.name ? error.name : 'Error',
    message: typeof error?.message === 'string' && error.message
      ? error.message
      : 'транспорт завершился без проверяемого сообщения',
  })
}

function parseTransportResult(raw, expectedRequestItemId) {
  if (!isPlainObject(raw)) throw new TypeError('transport: ожидается простой объект результата')
  canonicalJsonBytes(raw, MODEL_TRANSPORT_RESULT_SPEC)
  assertExactKeys(raw, TRANSPORT_RESULT_KEYS, 'transport: результат')
  assertNonEmptyString(raw.requestItemId, 'transport.requestItemId')
  if (raw.requestItemId !== expectedRequestItemId) {
    throw new TypeError(
      `transport: ответ принадлежит ${raw.requestItemId}, ожидался ${expectedRequestItemId}; `
      + 'сопоставление по позиции запрещено',
    )
  }
  if (typeof raw.charged !== 'boolean') {
    throw new TypeError(`transport.charged: ожидается boolean, получено ${typeof raw.charged}`)
  }
  /* Канонизация выше уже отвергла undefined, функции, классы, циклы,
     скрытые и accessor-свойства во всём response. Его семантика принадлежит
     единственной границе classifyModelResponse ниже. */
  return raw
}

function readClock(now, where) {
  if (typeof now !== 'function') {
    throw new TypeError(`executeModelPlan.now: ожидается функция, получено ${typeof now}`)
  }
  const at = now()
  assertCanonicalInstant(at, where)
  return at
}

function assertReport(report, expectedRequestItemIds) {
  canonicalJsonBytes(report, MODEL_EXECUTION_REPORT_SPEC)
  assertExactKeys(report, REPORT_KEYS, MODEL_EXECUTION_REPORT_SPEC)
  if (report.contractVersion !== MODEL_EXECUTION_REPORT_SPEC) {
    throw new TypeError(`${MODEL_EXECUTION_REPORT_SPEC}: чужая версия ${report.contractVersion}`)
  }
  assertExecutionId(report.executionId, 'report.executionId')
  assertCanonicalInstant(report.checkedAt, 'report.checkedAt')
  assertNonEmptyString(report.planId, 'report.planId')
  assertSha256Value(report.planDigest, 'report.planDigest')
  assertSha256Value(report.approvalDigest, 'report.approvalDigest')
  assertSha256Value(report.providerProfileDigest, 'report.providerProfileDigest')
  if (!Array.isArray(report.items) || !report.items.length) {
    throw new TypeError('report.items: ожидается непустой массив')
  }
  assertIdentity(
    report.items.map((item) => item.requestItemId),
    expectedRequestItemIds,
    'report.items против preparedItems',
  )
  const expectedCounts = Object.fromEntries(COUNT_BUCKETS.map((bucket) => [bucket, 0]))
  for (const [index, item] of report.items.entries()) {
    const where = `report.items[${index}]`
    assertExactKeys(item, REPORT_ITEM_KEYS, where)
    assertRequestItemId(item.requestItemId, `${where}.requestItemId`)
    assertNonEmptyString(item.sourceKey, `${where}.sourceKey`)
    assertSha256Value(item.candidateInputDigest, `${where}.candidateInputDigest`)
    assertSha256Value(item.requestSpecDigest, `${where}.requestSpecDigest`)
    if (item.outcome !== 'accepted' && item.outcome !== 'rejected') {
      throw new TypeError(`${where}.outcome: исполнитель v1 закрывает только accepted либо rejected`)
    }
    if (typeof item.charged !== 'boolean') {
      throw new TypeError(`${where}.charged: ожидается boolean, получено ${typeof item.charged}`)
    }
    assertClassificationResult(item.result, item.outcome, `${where}.result`)
    /* Верхний sourceKey элемента и sourceKey его классификации — два разных
       поля, и расходиться они не имеют права: расхождение приписывает
       классификацию чужому POI. Журнал сверяет свой sourceKey с записью
       opened, но отчёт читают отдельно от журнала, поэтому связка обязана
       держаться и здесь. */
    if (item.outcome === 'accepted') {
      assertExactly(
        item.result.classification.sourceKey, item.sourceKey,
        `${where}.result.classification.sourceKey против ${where}.sourceKey`,
      )
    }
    expectedCounts[item.outcome] += 1
  }
  assertExactKeys(report.summary, SUMMARY_KEYS, 'report.summary')
  assertExactly(report.summary.state, 'closed', 'report.summary.state')
  assertExactKeys(report.summary.counts, COUNT_BUCKETS, 'report.summary.counts')
  for (const bucket of COUNT_BUCKETS) {
    assertInteger(report.summary.counts[bucket], `report.summary.counts.${bucket}`)
    assertExactly(
      report.summary.counts[bucket], expectedCounts[bucket],
      `report.summary.counts.${bucket} против items`,
    )
  }
  assertExactly(
    COUNT_BUCKETS.reduce((sum, bucket) => sum + report.summary.counts[bucket], 0),
    report.items.length,
    'report.summary.counts: сумма против items',
  )
  const expectedOutcome = expectedCounts.rejected ? 'withFailures' : 'allAccepted'
  assertExactly(report.summary.outcome, expectedOutcome, 'report.summary.outcome против items')
  assertExactly(
    report.summary.exitCode,
    expectedOutcome === 'allAccepted' ? EXIT_CODES.allAccepted : EXIT_CODES.failures,
    'report.summary.exitCode против outcome',
  )
  assertCanonicalInstant(report.summary.deleteAfter, 'report.summary.deleteAfter')
}

/** Проверка производного отчёта против полного ожидаемого набора запроса. */
export function parseAndVerifyExecutionReport(input) {
  canonicalJsonBytes(input, `${MODEL_EXECUTION_REPORT_SPEC}: параметры проверки`)
  assertExactKeys(
    input, REPORT_VERIFY_KEYS, `${MODEL_EXECUTION_REPORT_SPEC}: параметры проверки`,
  )
  if (!Array.isArray(input.expectedRequestItemIds) || !input.expectedRequestItemIds.length) {
    throw new TypeError('expectedRequestItemIds: ожидается непустой массив')
  }
  input.expectedRequestItemIds.forEach(
    (id, index) => assertRequestItemId(id, `expectedRequestItemIds[${index}]`),
  )
  assertReport(input.report, input.expectedRequestItemIds)
  return deepFreeze(structuredClone(input.report))
}

function buildReport({ preflight, approval, items, summary, expectedItems }) {
  const report = {
    contractVersion: MODEL_EXECUTION_REPORT_SPEC,
    executionId: preflight.executionId,
    checkedAt: preflight.checkedAt,
    planId: approval.planId,
    planDigest: approval.planDigest.value,
    approvalDigest: approval.approvalDigest.value,
    providerProfileDigest: approval.providerProfileDigest.value,
    items,
    summary,
  }
  return parseAndVerifyExecutionReport({
    report,
    expectedRequestItemIds: expectedItems.map((item) => item.requestItemId),
  })
}

/**
 * Полный офлайн-проход. `transport` — async-функция над проверенной
 * спецификацией. Её исключение после `dispatching` не превращается в
 * `failed`: списание неизвестно, журнал остаётся незакрытым и требует
 * reconciliation.
 */
export async function executeModelPlan(input) {
  assertStrictOptions(input, { required: EXECUTOR_INPUT_KEYS }, 'executeModelPlan: параметры')
  const { preflightInput, transport, promptText, schemaObject, now } = input
  if (typeof transport !== 'function') {
    throw new TypeError(`executeModelPlan.transport: ожидается функция, получено ${typeof transport}`)
  }
  if (typeof now !== 'function') {
    throw new TypeError(`executeModelPlan.now: ожидается функция, получено ${typeof now}`)
  }

  const preflight = await runExecutionPreflight(preflightInput)
  if (!preflight.ok) {
    return deepFreeze({ state: 'refused', exitCode: preflight.exitCode, preflight, report: null })
  }

  const { plan, profile, store, approvalFileName } = preflightInput
  const { approval } = await store.approvals.readApprovalFile({ fileName: approvalFileName, plan })
  /* Все чистые сборщики завершаются ДО `opened`: внутренний дефект формы не
     имеет права израсходовать разрешение. После открытия остаются только
     журнал и эффект транспорта. */
  const preparedRequests = preflight.preparedItems.map((prepared) => ({
    prepared,
    request: buildModelRequest({
      plan,
      approval,
      profile,
      portalId: prepared.portalId,
      requestItemId: prepared.requestItemId,
      classificationItem: prepared.classificationItem,
      promptText,
      schemaObject,
    }),
  }))
  const journal = await store.openJournal({
    approvalFileName, plan, at: readClock(now, 'executeModelPlan: opened.at'),
  })
  const reportItems = []

  for (const { prepared, request } of preparedRequests) {
    const requestDigest = request.requestSpecDigest.value
    await journal.dispatching({
      requestItemId: prepared.requestItemId,
      requestSpecDigest: requestDigest,
      at: readClock(now, 'executeModelPlan: dispatching.at'),
    })

    let envelope
    let result
    let outcome
    try {
      envelope = parseTransportResult(await transport(request), prepared.requestItemId)
      result = classifyModelResponse(envelope.response, { sourceKey: prepared.sourceKey })
      outcome = result.ok ? 'accepted' : 'rejected'
      await journal.settled({
        requestItemId: prepared.requestItemId,
        requestSpecDigest: requestDigest,
        outcome,
        charged: envelope.charged,
        result,
        at: readClock(now, 'executeModelPlan: settled.at'),
      })
    } catch (error) {
      /* После `dispatching` любой отказ — транспорта, классификатора или
         фиксации `settled` — оставляет платный эффект неопределённым. */
      let releaseFailure = null
      try {
        /* Освобождение эпохи — ЗАПИСЬ, а не закрытие дескриптора: без неё
           исполнение осталось бы во владении этой эпохи навсегда, и сверке
           пришлось бы требовать полномочие владельца после каждого обрыва
           транспорта. */
        await journal.release({
          at: readClock(now, 'executeModelPlan: released.at'),
          reason: 'needsReconciliation',
        })
      } catch (releaseError) {
        /* Освобождение не удалось: исполнение остаётся во владении, и
           продолжение потребует полномочия владельца. Дескриптор всё равно
           отпускается, но итогом исполнения этот отказ не становится. */
        releaseFailure = safeFailure(releaseError)
        try { await journal.detach() } catch { /* дескриптор уже мог быть закрыт */ }
      }
      const summary = await store.readJournal(preflight.executionId)
      return deepFreeze({
        state: 'needsReconciliation',
        exitCode: EXIT_CODES.needsReconciliation,
        preflight,
        report: null,
        failure: safeFailure(error),
        releaseFailure,
        summary,
      })
    }

    reportItems.push({
      requestItemId: prepared.requestItemId,
      sourceKey: prepared.sourceKey,
      candidateInputDigest: prepared.candidateInputDigest,
      requestSpecDigest: requestDigest,
      outcome,
      charged: envelope.charged,
      result,
    })
  }

  const summary = await journal.close({ at: readClock(now, 'executeModelPlan: closed.at') })
  const report = buildReport({
    preflight, approval, items: reportItems, summary, expectedItems: preflight.preparedItems,
  })
  const executionDir = store.executionDir(preflight.executionId)
  const reportPath = path.join(executionDir, MODEL_EXECUTION_REPORT_FILE_NAME)
  await writeExclusiveJsonArtifact(reportPath, report, {
    insideDir: executionDir,
    names: ARTIFACT_NAMES.executionReport,
  })
  return deepFreeze({
    state: 'closed', exitCode: summary.exitCode, preflight, report, reportPath,
  })
}
