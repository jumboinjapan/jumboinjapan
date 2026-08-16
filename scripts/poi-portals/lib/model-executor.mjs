/**
 * Исполнитель проверенных спецификаций.
 *
 * Эффекты — локальный журнал поколения `g2`, один вызов инъецированного
 * транспорта на элемент и производный `report.json` после закрытия журнала.
 * HTTP-клиента, `fetch`, адреса и секретов этот модуль не импортирует: за
 * провод отвечает `model-transport.mjs`, и приходит он параметром.
 *
 * Порядок закреплён и держится на write-ahead: полный preflight → сборка и
 * проверка всех запросов → подготовка исходящих байтов КАЖДОГО запроса (одна
 * сериализация, собственная копия, отпечаток и длина с копии, сверка с
 * пределом) → и только теперь `opened` → на каждый элемент `prepared` с
 * fsync, затем `dispatching` с fsync и fencing, и лишь затем буфер уходит в
 * провод → `settled` → `closed` → проверенный отчёт.
 *
 * Ни сырой ответ, ни исходящие байты, ни значение учётных данных в журнал и
 * отчёт не попадают: там лежат только отпечатки, размеры и результат
 * классификации.
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
import {
  assertEffectCapableStore,
  assertGenuineJournalHandle,
} from './execution-journal.mjs'
import { runExecutionPreflight } from './execution-preflight.mjs'
import {
  COUNT_BUCKETS,
  EXIT_CODES,
  assertClassificationResult,
  assertExecutionId,
  assertRequestItemId,
  assertStrictOptions,
  formatProblem,
} from './model-execution.mjs'
import { buildModelRequest } from './model-request.mjs'
import { prepareOutbound } from './model-serializers.mjs'
import { assertTransportResult, createModelTransport } from './model-transport.mjs'

/** Прежняя версия отчёта. Разбирается по-прежнему и не переписывается. */
export const MODEL_EXECUTION_REPORT_SPEC = 'poi-model-execution-report/v1'

/**
 * Вторая версия отчёта.
 *
 * Отличие ровно одно: у элемента появились `outboundBytesDigest` и
 * `outboundBytes`. Без них отчёт называл намерение (`requestSpecDigest`), но
 * молчал о том, что именно ушло в провод, — а платит владелец за второе.
 */
export const MODEL_EXECUTION_REPORT_V2_SPEC = 'poi-model-execution-report/v2'

export const MODEL_EXECUTION_REPORT_FILE_NAME = 'report.json'
/**
 * Исходы исполнения.
 *
 * `interruptedBeforeDispatch` добавлен потому, что прежний код объявлял
 * `needsReconciliation` при ЛЮБОМ отказе после открытия журнала — включая
 * отказ на записи `prepared`, когда провода ещё никто не касался. Код 40 и
 * слова «списание неизвестно» там были неправдой: журнал в этот момент сам
 * говорит `interruptedBeforeDispatch`, и подменять его вычисленный итог
 * жёсткой константой нельзя.
 */
export const EXECUTOR_RESULT_STATES = Object.freeze([
  'refused', 'closed', 'needsReconciliation', 'interruptedBeforeDispatch',
])

/** Поколение журнала, которым работает ЭТОТ исполнитель. Не параметр. */
export const EXECUTOR_GENERATION = 'g2'

/**
 * Точный состав входа исполнителя.
 *
 * Параметра `transport` здесь больше НЕТ. Произвольная функция на его месте
 * обходила разом всё, ради чего существует `model-transport.mjs`: предел
 * ответа до разбора, резолвер учётных данных, канонический адрес и
 * заголовки, правило «любой полученный ответ означает списание», защищённый
 * разбор Responses и повторную проверку владения перед эффектом. Наружу
 * выведены ровно две инъекции — провод и резолвер, — а транспорт вокруг них
 * собирает сам исполнитель.
 */
const EXECUTOR_INPUT_KEYS = Object.freeze([
  'preflightInput', 'wireClient', 'resolveCredentials', 'promptText', 'schemaObject', 'now',
])
const REPORT_KEYS = Object.freeze([
  'contractVersion', 'executionId', 'checkedAt', 'planId', 'planDigest',
  'approvalDigest', 'providerProfileDigest', 'items', 'summary',
])
const REPORT_ITEM_KEYS = Object.freeze([
  'requestItemId', 'sourceKey', 'candidateInputDigest', 'requestSpecDigest',
  'outcome', 'charged', 'result',
])
const REPORT_ITEM_V2_KEYS = Object.freeze([
  ...REPORT_ITEM_KEYS, 'outboundBytesDigest', 'outboundBytes',
])
const SUMMARY_KEYS = Object.freeze(['state', 'counts', 'outcome', 'exitCode', 'deleteAfter'])
const REPORT_VERIFY_KEYS = Object.freeze(['report', 'expectedRequestItemIds'])

/**
 * Имена классов ошибок, которые допускается называть вслух.
 *
 * Список закрыт намеренно: `error.name` у чужой функции — обычная строка
 * произвольной длины и происхождения, и пропускать её в артефакт значило бы
 * открыть тот же канал, который закрывает отказ от `error.message`.
 */
const NAMED_ERROR_KINDS = Object.freeze([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'EvalError', 'URIError',
  'ModelTransportError', 'JournalCorruptError', 'JournalContractError',
])

/**
 * Описание отказа БЕЗ чужого текста.
 *
 * `error.message` не воспроизводится никогда — ни от транспорта, ни от
 * резолвера учётных данных, ни от журнала. В сообщении бывает и адрес, и
 * заголовок, и тело ответа, а у резолвера — значение секрета. Наружу уходит
 * фиксированный текст, имя класса из закрытого списка, идентификатор
 * элемента, отпечаток исходящих байтов и их длина: этого хватает, чтобы
 * найти запись в журнале, и не хватает, чтобы что-нибудь раскрыть.
 */
function safeFailure(error) {
  const name = typeof error?.name === 'string' && NAMED_ERROR_KINDS.includes(error.name)
    ? error.name
    : 'Error'
  const requestItemId = typeof error?.requestItemId === 'string' ? error.requestItemId : null
  const outboundBytesDigest = typeof error?.outboundBytesDigest === 'string'
    ? error.outboundBytesDigest
    : null
  const outboundBytes = Number.isSafeInteger(error?.outboundBytes) ? error.outboundBytes : null
  return Object.freeze({
    name,
    message: 'отказ на границе исполнения; текст исходной ошибки не воспроизводится — '
      + 'в нём бывают адрес, заголовки, тело ответа и учётные данные',
    requestItemId,
    outboundBytesDigest,
    outboundBytes,
  })
}

function readClock(now, where) {
  if (typeof now !== 'function') {
    throw new TypeError(`executeModelPlan.now: ожидается функция, получено ${typeof now}`)
  }
  const at = now()
  assertCanonicalInstant(at, where)
  return at
}

/**
 * Результат классификации второй версии из проверенного ответа.
 *
 * Строки прежней проверки складываются из фрагментов ответа модели, поэтому
 * каждая проходит через ограниченный детерминированный формат: вид, полная
 * длина, отпечаток полного текста, ограниченное начало и признак обрезки.
 */
function classifyToV2(response, sourceKey) {
  const checked = classifyModelResponse(response, { sourceKey })
  if (checked.ok) {
    return {
      ok: true, problems: [], proposal: checked.proposal, classification: checked.classification,
    }
  }
  return {
    ok: false,
    problems: checked.problems.map((problem) => formatProblem('schemaViolation', problem)),
    proposal: null,
    classification: null,
  }
}

function assertReportCommon(report, expectedRequestItemIds, itemKeys, generation) {
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
    assertExactKeys(item, itemKeys, where)
    assertRequestItemId(item.requestItemId, `${where}.requestItemId`)
    assertNonEmptyString(item.sourceKey, `${where}.sourceKey`)
    assertSha256Value(item.candidateInputDigest, `${where}.candidateInputDigest`)
    assertSha256Value(item.requestSpecDigest, `${where}.requestSpecDigest`)
    if (itemKeys === REPORT_ITEM_V2_KEYS) {
      assertSha256Value(item.outboundBytesDigest, `${where}.outboundBytesDigest`)
      assertInteger(item.outboundBytes, `${where}.outboundBytes`, 1)
    }
    if (item.outcome !== 'accepted' && item.outcome !== 'rejected') {
      throw new TypeError(`${where}.outcome: исполнитель закрывает только accepted либо rejected`)
    }
    if (typeof item.charged !== 'boolean') {
      throw new TypeError(`${where}.charged: ожидается boolean, получено ${typeof item.charged}`)
    }
    assertClassificationResult(item.result, item.outcome, `${where}.result`, generation)
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

/**
 * Проверка отчёта ПЕРВОЙ версии.
 *
 * Отчёт второй версии она отвергает первой же сверкой: две версии с общим
 * набором обязательных полей, читаемые одной функцией, рано или поздно
 * разойдутся молча, и цену этого платит владелец.
 */
export function assertExecutionReportV1(report, expectedRequestItemIds) {
  canonicalJsonBytes(report, MODEL_EXECUTION_REPORT_SPEC)
  assertExactKeys(report, REPORT_KEYS, MODEL_EXECUTION_REPORT_SPEC)
  assertExactly(report.contractVersion, MODEL_EXECUTION_REPORT_SPEC, 'report.contractVersion')
  assertReportCommon(report, expectedRequestItemIds, REPORT_ITEM_KEYS, 'g1')
}

/** Проверка отчёта ВТОРОЙ версии. Первую отвергает так же поимённо. */
export function assertExecutionReportV2(report, expectedRequestItemIds) {
  canonicalJsonBytes(report, MODEL_EXECUTION_REPORT_V2_SPEC)
  assertExactKeys(report, REPORT_KEYS, MODEL_EXECUTION_REPORT_V2_SPEC)
  assertExactly(report.contractVersion, MODEL_EXECUTION_REPORT_V2_SPEC, 'report.contractVersion')
  assertReportCommon(report, expectedRequestItemIds, REPORT_ITEM_V2_KEYS, EXECUTOR_GENERATION)
}

/**
 * Проверка производного отчёта против полного ожидаемого набора запроса.
 *
 * Версия выбирается по `contractVersion` — единственному полю, которое сам
 * отчёт про себя утверждает. Угадывание по набору ключей здесь запрещено:
 * оно приняло бы отчёт второй версии за первый ровно тогда, когда двух новых
 * полей нет, то есть в единственном случае, ради которого различие и нужно.
 */
export function parseAndVerifyExecutionReport(input) {
  canonicalJsonBytes(input, `${MODEL_EXECUTION_REPORT_V2_SPEC}: параметры проверки`)
  assertExactKeys(
    input, REPORT_VERIFY_KEYS, `${MODEL_EXECUTION_REPORT_V2_SPEC}: параметры проверки`,
  )
  if (!Array.isArray(input.expectedRequestItemIds) || !input.expectedRequestItemIds.length) {
    throw new TypeError('expectedRequestItemIds: ожидается непустой массив')
  }
  input.expectedRequestItemIds.forEach(
    (id, index) => assertRequestItemId(id, `expectedRequestItemIds[${index}]`),
  )
  if (!isPlainObject(input.report)) {
    throw new TypeError('report: ожидается простой объект отчёта')
  }
  const version = input.report.contractVersion
  if (version === MODEL_EXECUTION_REPORT_SPEC) {
    assertExecutionReportV1(input.report, input.expectedRequestItemIds)
  } else if (version === MODEL_EXECUTION_REPORT_V2_SPEC) {
    assertExecutionReportV2(input.report, input.expectedRequestItemIds)
  } else {
    throw new TypeError(
      `report.contractVersion: ожидается ${MODEL_EXECUTION_REPORT_SPEC} либо `
      + `${MODEL_EXECUTION_REPORT_V2_SPEC}, получено ${JSON.stringify(version)}`,
    )
  }
  return deepFreeze(structuredClone(input.report))
}

function buildReport({ preflight, approval, items, summary, expectedItems }) {
  const report = {
    contractVersion: MODEL_EXECUTION_REPORT_V2_SPEC,
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
 * Полный проход.
 *
 * Наружу выведены ровно две инъекции: `wireClient` — провод, отдающий поток
 * байтов ответа, и `resolveCredentials` — резолвер значения заголовка
 * учётных данных. Транспорт вокруг них собирается здесь, и обойти его
 * вызывающему нечем.
 *
 * Отказ провода после `dispatching` не превращается в `failed`: списание
 * неизвестно, журнал остаётся незакрытым и требует сверки. Отказ ДО первого
 * вызова провода реконсиляцией не объявляется — итог берётся у самого
 * журнала.
 */
export async function executeModelPlan(input) {
  assertStrictOptions(input, { required: EXECUTOR_INPUT_KEYS }, 'executeModelPlan: параметры')
  const { preflightInput, wireClient, resolveCredentials, promptText, schemaObject, now } = input
  if (typeof wireClient !== 'function') {
    throw new TypeError(`executeModelPlan.wireClient: ожидается функция, получено ${typeof wireClient}`)
  }
  if (typeof resolveCredentials !== 'function') {
    throw new TypeError(
      `executeModelPlan.resolveCredentials: ожидается функция, получено ${typeof resolveCredentials}`,
    )
  }
  if (typeof now !== 'function') {
    throw new TypeError(`executeModelPlan.now: ожидается функция, получено ${typeof now}`)
  }

  /* Признак «провод действительно вызывали» снимается ЗДЕСЬ, обёрткой
     вокруг инъецированного клиента, а не спрашивается у него самого:
     вызывающий на этот флаг влияния не имеет. Он и решает, чем закончилось
     исполнение — неопределённостью или честным «до отправки не дошло». */
  let wireReached = false
  const transport = createModelTransport({
    wireClient: (call) => {
      wireReached = true
      return wireClient(call)
    },
    resolveCredentials,
  })

  const preflight = await runExecutionPreflight(preflightInput)
  if (!preflight.ok) {
    return deepFreeze({ state: 'refused', exitCode: preflight.exitCode, preflight, report: null })
  }

  const { plan, profile, store, approvalFileName } = preflightInput
  /* Право хранилища на ПЛАТНЫЙ ЭФФЕКТ спрашивается ДО открытия журнала:
     открытие само по себе эффект — оно создаёт каталог исполнения и тем
     потребляет разрешение. Требуется не только настоящая фабрика, но и
     настоящий ввод-вывод: хранилище с подменным `io` фабрика создаёт честно,
     а пишет оно журнал без fsync — запись о намерении отправить может не
     пережить обрыв, тогда как запрос уже уйдёт. */
  assertEffectCapableStore(store)
  const { approval } = await store.approvals.readApprovalFile({ fileName: approvalFileName, plan })
  /* Все чистые сборщики завершаются ДО `opened`: внутренний дефект формы не
     имеет права израсходовать разрешение. Сюда же перенесена подготовка
     исходящих байтов — сериализация, собственная копия, отпечаток, длина и
     сверка с `maxOutboundBytes`. Запрос, который не помещается в предел,
     обязан отказать до открытия журнала, а не после. */
  const preparedRequests = preflight.preparedItems.map((prepared) => {
    const request = buildModelRequest({
      plan,
      approval,
      profile,
      portalId: prepared.portalId,
      requestItemId: prepared.requestItemId,
      classificationItem: prepared.classificationItem,
      promptText,
      schemaObject,
    })
    return { prepared, request, outbound: prepareOutbound({ request, profile }) }
  })
  const journal = await store.openJournal({
    approvalFileName, plan, at: readClock(now, 'executeModelPlan: opened.at'),
  })
  /* Происхождение РУЧКИ — до первого эффекта и до единственного обращения к
     учётным данным: принадлежность этому хранилищу, исполнение, поколение и
     то, что ручка ещё владеет эпохой. Прежняя сверка `journal.generation`
     этим поглощена: она спрашивала поле у того, чьё происхождение никто не
     проверял.

     Названо вслух: ЧЕРЕЗ ЭТУ ФУНКЦИЮ проверка сегодня недостижима. Обёртку
     вокруг хранилища отсекает `assertGenuineStore` строкой выше, а настоящее
     хранилище чужой, клонированной или освобождённой ручки не выдаёт —
     `openJournal` всегда создаёт свою. Мутация «убрать эту проверку» набор не
     роняет, и это сказано здесь, а не скрыто. Класс, который она закрывает, —
     появление любого пути, где ручка приходит не прямо из `openJournal` этого
     же хранилища: переиспользование, передача между исполнениями, кэш. Сама
     проверка при этом покрыта прямо — тестами над `assertGenuineJournalHandle`
     с чужим исполнением, чужим поколением, чужим хранилищем, освобождённой
     ручкой и её клоном. */
  try {
    assertGenuineJournalHandle({
      store,
      handle: journal,
      executionId: preflight.executionId,
      generation: EXECUTOR_GENERATION,
    })
  } catch (error) {
    /* Дескриптор отпускается по мере возможности: подставная ручка могла и
       не иметь `detach`, и это её дело, а не наше. */
    try { await journal.detach() } catch { /* дескриптор уже мог быть закрыт */ }
    throw error
  }
  const reportItems = []

  for (const { prepared, request, outbound } of preparedRequests) {
    const requestDigest = request.requestSpecDigest.value
    let result
    let outcome
    let charged
    try {
      /* Write-ahead в два шага. Сначала фиксируются и синхронизируются
         исходящие байты: их отпечаток, длина, сериализатор и профиль. Только
         потом — намерение отправить. Между ними fsync, поэтому платный эффект
         не может опередить запись о своём содержимом. */
      await journal.prepared({
        requestItemId: prepared.requestItemId,
        requestSpecDigest: requestDigest,
        serializerDescriptorDigest: outbound.serializerDescriptorDigest,
        providerProfileDigest: outbound.providerProfileDigest,
        outboundBytesDigest: outbound.outboundBytesDigest,
        outboundBytes: outbound.outboundBytes,
        at: readClock(now, 'executeModelPlan: prepared.at'),
      })
      /* `dispatching` возвращается только после fsync И повторной сверки
         ограждения. Буфер уходит в провод строкой ниже — и ни на шаг раньше. */
      await journal.dispatching({
        requestItemId: prepared.requestItemId,
        requestSpecDigest: requestDigest,
        at: readClock(now, 'executeModelPlan: dispatching.at'),
      })

      const envelope = assertTransportResult(
        await transport({
          request,
          profile,
          outbound,
          /* Полномочие на эффект берётся у НАСТОЯЩЕЙ ручки этого журнала.
             Снаружи его подставить нечем: транспорт собран здесь же. */
          assertOwnedForEffect: journal.assertOwnedForEffect,
        }),
        prepared.requestItemId,
      )
      charged = envelope.charged
      if (envelope.problems !== null) {
        /* Терминальный отказ самого транспорта. Классификатор здесь не
           зовётся: предложения не было, и претензии к схеме были бы выдумкой. */
        result = { ok: false, problems: envelope.problems, proposal: null, classification: null }
        outcome = 'rejected'
      } else {
        result = classifyToV2(envelope.response, prepared.sourceKey)
        outcome = result.ok ? 'accepted' : 'rejected'
      }
      await journal.settled({
        requestItemId: prepared.requestItemId,
        requestSpecDigest: requestDigest,
        outcome,
        charged,
        result,
        at: readClock(now, 'executeModelPlan: settled.at'),
      })
    } catch (error) {
      /* После `dispatching` любой отказ — транспорта, классификатора или
         фиксации `settled` — оставляет платный эффект неопределённым.
         До `dispatching` он тоже приходит сюда: журнал остаётся незакрытым,
         и это ровно тот вердикт, который сверка и ожидает увидеть. */
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
      /* Журнал перечитывается и проверяется заново, и его вердикт НЕ
         подменяется. Если провода никто не касался, платного эффекта быть не
         могло, и объявлять списание неопределённым — неправда: сам журнал в
         этот момент говорит `interruptedBeforeDispatch`. Если провод вызвали,
         судьба запроса неизвестна независимо от того, что успел записать
         журнал, и тогда вердикт один — `needsReconciliation`. */
      const summary = await store.readJournal(preflight.executionId)
      const state = wireReached ? 'needsReconciliation' : summary.state
      const exitCode = wireReached ? EXIT_CODES.needsReconciliation : summary.exitCode
      return deepFreeze({
        state,
        exitCode,
        preflight,
        report: null,
        failure: safeFailure(error),
        releaseFailure,
        wireReached,
        summary,
      })
    }

    reportItems.push({
      requestItemId: prepared.requestItemId,
      sourceKey: prepared.sourceKey,
      candidateInputDigest: prepared.candidateInputDigest,
      requestSpecDigest: requestDigest,
      outboundBytesDigest: outbound.outboundBytesDigest,
      outboundBytes: outbound.outboundBytes,
      outcome,
      charged,
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
