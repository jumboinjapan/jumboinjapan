/**
 * Read-only сверка незакрытого исполнения.
 *
 * Read-only относительно провайдера и production-базы: ни модели, ни
 * транспорта, ни адаптеров, ни Airtable, ни Intake, ни status-запроса этот
 * модуль не знает и не импортирует. Единственный эффект — дозапись в
 * append-only журнал; существующие байты не чинятся, не обрезаются и не
 * переписываются ни при каком исходе.
 *
 * План и разрешение не требуются: кандидат опознаётся по самодостаточной
 * записи `opened`, поэтому сверка работает и после удаления runtime-плана.
 *
 * Что сверка МОЖЕТ:
 *
 * — журнал с одним `opened` закрыть как `abortedBeforeDispatch`. Доказательство
 *   здесь не решение владельца, а сам write-ahead журнал: намерение
 *   синхронизируется ДО эффекта, поэтому отсутствие `dispatching` и есть
 *   доказательство отсутствия отправки;
 * — записать проверенное свидетельство владельца о неопределённом запросе;
 * — по свидетельству `charged` записать терминальный `settled:lost` и, если
 *   неопределённых не осталось, закрыть журнал как `withLoss`.
 *
 * Чего сверка НЕ делает никогда: не отправляет запрос, не разрешает повтор и
 * не выдаёт права его отправить. Подтверждённое отсутствие списания —
 * необходимое условие возможного повтора, но право на новый платный запрос
 * ограничено отдельно: подписанное разрешение несёт `maxRetries === 0`, а
 * лимиты сети проверяет исполнение. Поэтому в результате есть
 * `noChargeConfirmed` — факт, — и нет ни `retryable`, ни `authorized`.
 *
 * Автоматического повтора после timeout и потерянного ответа нет и быть не
 * может: «ответ доставлен» в этой версии не выводится ниоткуда — сырой ответ
 * не хранится, а status-запрос принадлежит более позднему контракту.
 */
import {
  assertCanonicalInstant,
  assertExactKeys,
  assertExactly,
  assertInteger,
  assertNonEmptyString,
  assertStringList,
  canonicalJsonBytes,
  deepFreeze,
  isPlainObject,
} from '../../lib/canonical-contract.mjs'
import {
  assertExecutionId,
  assertRequestItemId,
  assertStrictOptions,
  buildReconciledPayload,
  buildRecord,
  closableState,
  closedOutcomeFromCounts,
  COUNT_BUCKETS,
  EXIT_CODES,
  itemOutcomeIn,
  noChargeConfirmedIds,
  outcomeExitCode,
  parseAndVerifyJournal,
  parseAndVerifyReconciliationEvidence,
  RECONCILIATION_VERDICTS,
  summarizeJournal,
} from './model-execution.mjs'

/** Домен ПРОВЕРЕННОГО РЕЗУЛЬТАТА операции. Не домен свидетельства. */
export const RECONCILIATION_SPEC = 'poi-model-reconciliation/v1'

/** Состояния итога. Список закрыт. */
export const RECONCILIATION_STATES = Object.freeze([
  'closed', 'needsReconciliation', 'interruptedBeforeDispatch', 'journalCorrupt', 'journalForked',
])

/**
 * Состояния, в которых логический итог НЕДОКАЗУЕМ.
 *
 * Расщепление сюда входит наравне с повреждением: записи-сироты описывают
 * настоящие эффекты, и считать корзины, делая вид, что их нет, значило бы
 * выдать догадку за итог.
 */
const UNREADABLE_STATES = Object.freeze(['journalCorrupt', 'journalForked'])

/**
 * БИЗНЕС-записи, которые операция вправе дописать. Порядок значим.
 *
 * Записи протокола владения (`claimed`, `released`) сюда не входят и никогда
 * не входили: они описывают, кто держит исполнение, а не что с ним стало.
 * Перечисляются они отдельным полем — молчаливое умолчание сделало бы поле
 * `appended` неполным, не сказав об этом.
 */
export const BUSINESS_RECORD_TYPES = Object.freeze(['reconciled', 'settled', 'closed'])

/** Записи протокола владения в фактическом порядке дозаписи. */
export const PROTOCOL_RECORD_TYPES = Object.freeze(['claimed', 'released'])

/** Судьба предъявленного свидетельства. */
export const EVIDENCE_STATES = Object.freeze(['applied', 'alreadyRecorded', 'none'])

export const RECONCILE_INPUT_KEYS = Object.freeze([
  'store', 'executionId', 'evidence', 'takeover', 'now',
])

/** Почему дозапись закрыта при читаемом журнале. Список закрыт. */
export const BLOCKED_REASONS = Object.freeze([
  'preProtocol', 'owned', 'ownershipIndeterminate', 'protocolInitializationIncomplete',
])

const BLOCKED_KEYS = Object.freeze(['appendability', 'reason'])
const BLOCKED_APPENDABILITY = Object.freeze(['readOnly', 'owned', 'indeterminate'])

/** Единственная таблица соответствия причины и права дозаписи. */
const BLOCKED_PAIRS = Object.freeze({
  preProtocol: 'readOnly',
  owned: 'owned',
  ownershipIndeterminate: 'indeterminate',
  protocolInitializationIncomplete: 'indeterminate',
})

/**
 * Состояния, к которым отказ по протоколу неприменим: закрытый журнал ничего
 * не ждёт, а нечитаемый не даёт даже права спросить.
 */
const UNBLOCKABLE_STATES = Object.freeze(['closed', 'journalCorrupt', 'journalForked'])

export const RECONCILIATION_RESULT_KEYS = Object.freeze([
  'contractVersion', 'executionId', 'state', 'exitCode', 'counts', 'total',
  'appendedBusinessRecords', 'appendedProtocolRecords', 'evidenceApplied', 'verdict',
  'evidenceItemId', 'evidenceItemOutcome', 'noChargeConfirmed', 'reason', 'blocked',
])

/**
 * Состояния элемента, к которому относится свидетельство. Список закрыт.
 *
 * Без свидетельства состояния нет; подтверждённое отсутствие списания
 * оставляет элемент неопределённым; доказанное списание делает его
 * потерянным. Ничего другого сверка с этим элементом сделать не может.
 */
export const EVIDENCE_ITEM_OUTCOMES = Object.freeze([null, 'unknown', 'lost'])

const OPEN_STATES = Object.freeze(['needsReconciliation', 'interruptedBeforeDispatch'])
const CLOSED_EXIT_CODES = Object.freeze([
  EXIT_CODES.allAccepted, EXIT_CODES.failures, EXIT_CODES.skips, EXIT_CODES.withLoss,
])

/**
 * Единственная проверка итога.
 *
 * Итог, объявленный тем, кто его посчитал, — не итог: состояние, код,
 * счётчики, их сумма и множества сверяются здесь, до возврата вызывающему.
 */
export function parseAndVerifyReconciliationResult(raw) {
  if (!isPlainObject(raw)) throw new TypeError(`${RECONCILIATION_SPEC}: итог обязан быть простым объектом`)
  canonicalJsonBytes(raw, RECONCILIATION_SPEC)
  assertExactKeys(raw, RECONCILIATION_RESULT_KEYS, RECONCILIATION_SPEC)
  assertExactly(raw.contractVersion, RECONCILIATION_SPEC, 'contractVersion')
  assertExecutionId(raw.executionId, 'executionId')
  if (!RECONCILIATION_STATES.includes(raw.state)) {
    throw new TypeError(
      `state: ожидается один из ${RECONCILIATION_STATES.join(', ')}, получено ${JSON.stringify(raw.state)}`,
    )
  }
  if (!EVIDENCE_STATES.includes(raw.evidenceApplied)) {
    throw new TypeError(
      `evidenceApplied: ожидается одно из ${EVIDENCE_STATES.join(', ')}, `
      + `получено ${JSON.stringify(raw.evidenceApplied)}`,
    )
  }
  if (!Array.isArray(raw.appendedBusinessRecords)) {
    throw new TypeError('appendedBusinessRecords: ожидается массив')
  }
  let previous = -1
  for (const [index, type] of raw.appendedBusinessRecords.entries()) {
    const position = BUSINESS_RECORD_TYPES.indexOf(type)
    if (position < 0) {
      throw new TypeError(`appendedBusinessRecords[${index}]: ${JSON.stringify(type)} дописать нельзя`)
    }
    if (position <= previous) {
      throw new TypeError(
        `appendedBusinessRecords[${index}]: порядок дозаписи нарушен — ${type} после `
        + `${raw.appendedBusinessRecords[index - 1]}`,
      )
    }
    previous = position
  }
  /* Записи протокола перечисляются в ФАКТИЧЕСКОМ порядке: захват всегда
     первым, освобождение — если эпоха была отдана. Бизнес-запись без захвата
     невозможна: дозаписывать её было бы нечем. */
  if (!Array.isArray(raw.appendedProtocolRecords)) {
    throw new TypeError('appendedProtocolRecords: ожидается массив')
  }
  for (const [index, type] of raw.appendedProtocolRecords.entries()) {
    if (!PROTOCOL_RECORD_TYPES.includes(type)) {
      throw new TypeError(`appendedProtocolRecords[${index}]: ${JSON.stringify(type)} записью протокола не является`)
    }
  }
  /* Отказ по протоколу — ОТДЕЛЬНОЕ поле, а не подмена бизнес-итога.
     Журнал, который никем не освобождён, всё равно уже сообщил о деньгах,
     и стирать этот ответ протокольным условием нельзя. */
  if (raw.blocked !== null) {
    if (!isPlainObject(raw.blocked)) throw new TypeError('blocked: ожидается простой объект либо null')
    assertExactKeys(raw.blocked, BLOCKED_KEYS, 'blocked')
    if (!BLOCKED_APPENDABILITY.includes(raw.blocked.appendability)) {
      throw new TypeError(
        `blocked.appendability: ожидается одно из ${BLOCKED_APPENDABILITY.join(', ')}, `
        + `получено ${JSON.stringify(raw.blocked.appendability)}`,
      )
    }
    if (!BLOCKED_REASONS.includes(raw.blocked.reason)) {
      throw new TypeError(
        `blocked.reason: ожидается одно из ${BLOCKED_REASONS.join(', ')}, `
        + `получено ${JSON.stringify(raw.blocked.reason)}`,
      )
    }
    if (raw.appendedBusinessRecords.length || raw.appendedProtocolRecords.length) {
      throw new TypeError('blocked: журнал без права дозаписи ничего не принимает')
    }
    assertExactly(raw.evidenceApplied, 'none', 'blocked: evidenceApplied')
    /* Матрица закрыта: причина и право дозаписи описывают одно и то же
       состояние, и разойтись они не имеют права. */
    const expected = BLOCKED_PAIRS[raw.blocked.reason]
    assertExactly(raw.blocked.appendability, expected, `blocked.reason «${raw.blocked.reason}»: appendability`)
    if (UNBLOCKABLE_STATES.includes(raw.state)) {
      throw new TypeError(`state «${raw.state}»: отказ по протоколу к этому состоянию неприменим`)
    }
  }
  assertStringList(raw.noChargeConfirmed, 'noChargeConfirmed')
  raw.noChargeConfirmed.forEach(
    (id, index) => assertRequestItemId(id, `noChargeConfirmed[${index}]`),
  )
  /* Дозапись и судьба свидетельства описывают одно и то же событие и
     расходиться не имеют права. */
  const wroteEvidence = raw.appendedBusinessRecords.includes('reconciled')
  if (wroteEvidence !== (raw.evidenceApplied === 'applied')) {
    throw new TypeError(
      `appendedBusinessRecords ${JSON.stringify(raw.appendedBusinessRecords)} не сходится с evidenceApplied `
      + `${JSON.stringify(raw.evidenceApplied)}`,
    )
  }
  if (raw.appendedBusinessRecords.includes('settled') && raw.evidenceApplied === 'none') {
    throw new TypeError('settled без свидетельства: потеря записывается только по доказательству')
  }
  /* История протокола ВЫВОДИТСЯ из бизнес-записей, а не проверяется по
     кусочкам. Возможных историй ровно три, и перечислять их отдельными
     запретами значило бы завести вторую реализацию одного правила: она
     разошлась бы с первой молча и пропустила бы то, что не перечислили.

     Ничего не дописали — эпоху не захватывали. Дописали и закрыли — закрытие
     само завершает эпоху, освобождать нечего. Дописали и не закрыли — эпоху
     обязаны отдать. */
  const expectedProtocol = raw.appendedBusinessRecords.length === 0
    ? []
    : (raw.appendedBusinessRecords.includes('closed') ? ['claimed'] : ['claimed', 'released'])
  assertExactly(
    raw.appendedProtocolRecords.join(','), expectedProtocol.join(','),
    'appendedProtocolRecords: история протокола против дописанных бизнес-записей',
  )
  /* Одних названий типов в `appended` мало: без вердикта и без имени элемента
     итог не описывает, ЧТО именно применено, и невозможные сочетания
     проходили бы границу. */
  if (raw.verdict !== null && !RECONCILIATION_VERDICTS.includes(raw.verdict)) {
    throw new TypeError(`verdict: неизвестное значение ${JSON.stringify(raw.verdict)}`)
  }
  if (raw.evidenceApplied === 'none') {
    assertExactly(raw.verdict, null, 'evidenceApplied «none»: verdict')
    assertExactly(raw.evidenceItemId, null, 'evidenceApplied «none»: evidenceItemId')
    assertExactly(raw.evidenceItemOutcome, null, 'evidenceApplied «none»: evidenceItemOutcome')
  } else {
    if (raw.verdict === null) {
      throw new TypeError('свидетельство применено, но вердикт не назван')
    }
    assertRequestItemId(raw.evidenceItemId, 'evidenceItemId')
    if (!EVIDENCE_ITEM_OUTCOMES.includes(raw.evidenceItemOutcome)) {
      throw new TypeError(
        `evidenceItemOutcome: ожидается одно из ${EVIDENCE_ITEM_OUTCOMES.map(String).join(', ')}, `
        + `получено ${JSON.stringify(raw.evidenceItemOutcome)}`,
      )
    }
    if (raw.verdict === 'noCharge') {
      if (!raw.noChargeConfirmed.includes(raw.evidenceItemId)) {
        throw new TypeError(
          `noCharge применён к ${raw.evidenceItemId}, но подтверждения этого элемента в итоге нет`,
        )
      }
      if (raw.appendedBusinessRecords.includes('settled')) {
        throw new TypeError('noCharge не порождает settled: неопределённость снята не была')
      }
      if (raw.state === 'closed') {
        throw new TypeError('noCharge оставляет элемент неопределённым — журнал закрыться не может')
      }
      assertExactly(raw.evidenceItemOutcome, 'unknown', 'noCharge: состояние элемента')
      if (raw.counts.unknown < 1) {
        throw new TypeError('noCharge: элемент объявлен неопределённым, а неопределённых нет')
      }
    } else {
      if (raw.noChargeConfirmed.includes(raw.evidenceItemId)) {
        throw new TypeError(`charged и noCharge одновременно для ${raw.evidenceItemId}`)
      }
      /* Не только при `applied`: потеря могла быть дописана предыдущим,
         оборвавшимся вызовом. Тогда она уже лежит в журнале — и обязана там
         лежать. «Списание доказано, а элемент всё ещё неопределён» успешным
         итогом не бывает: при отказе записи функция бросает исключение, а не
         возвращает результат. */
      assertExactly(raw.evidenceItemOutcome, 'lost', 'charged: состояние элемента')
      if (raw.counts.lost < 1) {
        throw new TypeError('charged: элемент объявлен потерянным, а потерянных нет')
      }
      if (raw.evidenceApplied === 'applied' && !raw.appendedBusinessRecords.includes('settled')) {
        throw new TypeError('charged записан, но терминальная потеря не дописана')
      }
      if (raw.state === 'closed' && raw.counts.lost < 1) {
        throw new TypeError('charged закрыл журнал без единого потерянного элемента')
      }
    }
  }

  if (UNREADABLE_STATES.includes(raw.state)) {
    assertExactly(
      raw.exitCode,
      raw.state === 'journalCorrupt' ? EXIT_CODES.journalCorrupt : EXIT_CODES.journalForked,
      'exitCode',
    )
    assertExactly(raw.blocked, null, 'нечитаемый журнал: blocked')
    assertExactly(
      raw.appendedProtocolRecords.length, 0, `${raw.state}: записи протокола`,
    )
    assertExactly(raw.counts, null, 'counts')
    assertExactly(raw.total, null, 'total')
    assertNonEmptyString(raw.reason, 'reason')
    assertExactly(raw.evidenceApplied, 'none', `${raw.state}: evidenceApplied`)
    if (raw.appendedBusinessRecords.length) throw new TypeError(`${raw.state}: такой журнал не дописывается`)
    if (raw.noChargeConfirmed.length) {
      throw new TypeError(`${raw.state}: у нечитаемого журнала подтверждений нет`)
    }
    return deepFreeze(structuredClone(raw))
  }

  assertExactly(raw.reason, null, 'reason')
  assertExactKeys(raw.counts, COUNT_BUCKETS, 'counts')
  for (const bucket of COUNT_BUCKETS) assertInteger(raw.counts[bucket], `counts.${bucket}`)
  assertInteger(raw.total, 'total', 1)
  assertExactly(
    COUNT_BUCKETS.reduce((sum, bucket) => sum + raw.counts[bucket], 0), raw.total,
    'counts: сумма против числа элементов',
  )
  if (raw.state === 'closed') {
    /* Исход и код выводятся ЕДИНСТВЕННОЙ общей функцией — той же, которой
       журнал проверяет собственную запись `closed`. Второй реализации
       приоритетов исходов в проекте нет. */
    const outcome = closedOutcomeFromCounts(raw.counts, raw.total)
    assertExactly(raw.exitCode, outcomeExitCode(outcome), 'exitCode против корзин')
    if (!CLOSED_EXIT_CODES.includes(raw.exitCode)) {
      throw new TypeError(`exitCode ${raw.exitCode}: закрытый журнал так завершиться не может`)
    }
    /* Подтверждённое отсутствие списания оставляет элемент неопределённым,
       поэтому закрытый журнал таких подтверждений нести не может. */
    if (raw.noChargeConfirmed.length) {
      throw new TypeError('closed: подтверждение noCharge оставляет элемент неопределённым')
    }
    return deepFreeze(structuredClone(raw))
  }
  if (!OPEN_STATES.includes(raw.state)) throw new TypeError(`state ${raw.state}: журнал не закрыт`)
  assertExactly(raw.exitCode, EXIT_CODES.needsReconciliation, 'exitCode')
  if (raw.state === 'interruptedBeforeDispatch') {
    assertExactly(raw.counts.notDispatched, raw.total, 'interruptedBeforeDispatch: notDispatched')
    for (const bucket of COUNT_BUCKETS) {
      if (bucket === 'notDispatched') continue
      assertExactly(raw.counts[bucket], 0, `interruptedBeforeDispatch: counts.${bucket}`)
    }
    if (raw.noChargeConfirmed.length) {
      throw new TypeError('interruptedBeforeDispatch: отправки не было, подтверждать нечего')
    }
    return deepFreeze(structuredClone(raw))
  }
  if (raw.counts.unknown < 1) {
    throw new TypeError(
      'needsReconciliation: журнал остаётся открытым только при неопределённых элементах',
    )
  }
  return deepFreeze(structuredClone(raw))
}

/**
 * Привязка свидетельства к ПРОВЕРЕННОМУ журналу. Приватная намеренно.
 *
 * Публичной её сделать нельзя: она принимает уже проверенные записи, и
 * экспортированная версия приняла бы обещание вызывающего «журнал проверен»
 * за доказательство. Читает и проверяет журнал только `reconcileExecution`,
 * своей же production-границей.
 */
function findRecordedEvidence(evidence, verified) {
  return verified.find((record) => record.type === 'reconciled'
    && record.payload.requestItemId === evidence.requestItemId) ?? null
}

function bindEvidence(evidence, verified) {
  const planned = new Map(verified[0].payload.items.map((item) => [item.requestItemId, item]))
  if (!planned.has(evidence.requestItemId)) {
    throw new TypeError(
      `свидетельство: элемент ${evidence.requestItemId} не объявлен в opened этого исполнения`,
    )
  }
  let dispatch = null
  let settled = false
  let recorded = null
  for (const record of verified.slice(1)) {
    if (record.payload?.requestItemId !== evidence.requestItemId) continue
    if (record.type === 'dispatching') dispatch = record
    if (record.type === 'settled') settled = true
    if (record.type === 'reconciled') recorded = record
  }
  if (dispatch === null) {
    throw new TypeError(
      `свидетельство: у элемента ${evidence.requestItemId} нет dispatching — `
      + 'о судьбе неотправленного запроса доказывать нечего',
    )
  }
  assertExactly(
    evidence.requestSpecDigest, dispatch.payload.requestSpecDigest,
    'свидетельство: requestSpecDigest против dispatching',
  )
  const observedMs = assertCanonicalInstant(evidence.observedAt, 'свидетельство: observedAt')
  const dispatchMs = assertCanonicalInstant(dispatch.at, 'свидетельство: dispatching.at')
  if (observedMs < dispatchMs) {
    throw new TypeError(
      `свидетельство: observedAt ${evidence.observedAt} раньше отправки ${dispatch.at} — `
      + 'наблюдение до отправки её судьбы не описывает',
    )
  }
  /* Порядок значим: «уже урегулирован» проверяется ПОСЛЕ повтора. Для
     применённого решения `charged` элемент урегулирован именно этим решением,
     и отказывать здесь значило бы запретить достроить хвост операции после
     падения между записями. */
  if (recorded !== null) {
    /* Расхождение отпечатка уже поймано выше, до всякой грамматики; здесь
       остаётся тот же приговор на случай прямого вызова. */
    if (recorded.payload.evidenceDigest.value !== evidence.evidenceDigest.value) {
      throw new TypeError(
        `свидетельство: для элемента ${evidence.requestItemId} уже записано другое решение `
        + `(${recorded.payload.evidenceDigest.value}); второго свидетельства не бывает`,
      )
    }
    return { alreadyRecorded: true, settled }
  }
  if (settled) {
    throw new TypeError(
      `свидетельство: элемент ${evidence.requestItemId} уже урегулирован — доказывать нечего`,
    )
  }
  return { alreadyRecorded: false, settled }
}

const buildResult = (fields) => parseAndVerifyReconciliationResult({
  contractVersion: RECONCILIATION_SPEC, blocked: null, ...fields,
})

/**
 * Судьба свидетельства и ФАКТИЧЕСКОЕ состояние его элемента.
 *
 * Состояние выводится из журнала, а не назначается вердиктом: агрегированные
 * счётчики связать `lost` именно с этим элементом не могут, и без такого поля
 * «списание доказано, а элемент всё ещё неопределён» проходило бы границу
 * успешным итогом.
 */
const evidenceFields = (checked, applied, verified) => ({
  evidenceApplied: applied,
  verdict: checked === null ? null : checked.verdict,
  evidenceItemId: checked === null ? null : checked.requestItemId,
  evidenceItemOutcome: checked === null ? null : itemOutcomeIn(verified, checked.requestItemId),
})

const summaryFields = (verified) => {
  /* Итог выводится ИЗ ПРОВЕРЕННЫХ ЗАПИСЕЙ той же исчерпывающей функцией, что
     и всюду. Состояние, счётчики и код, объявленные хранилищем, здесь не
     используются: хранилище — вход, а не свидетель. */
  const summary = summarizeJournal(verified)
  return {
    state: summary.state,
    exitCode: summary.exitCode,
    counts: { ...summary.counts },
    total: verified[0].payload.items.length,
    noChargeConfirmed: [...noChargeConfirmedIds(verified)],
    reason: null,
  }
}

/**
 * Чтение журнала и САМОСТОЯТЕЛЬНАЯ его проверка.
 *
 * `store.readJournal` здесь источник байтов, а не источник истины: обещание
 * «записи уже проверены» не принимается ни от production-хранилища, ни от
 * подставного. Поэтому записи каждый раз проходят общую границу заново — и
 * при первом чтении, и после дозаписи, и перед возвратом итога.
 */
async function readVerifiedJournal(store, executionId) {
  const read = await store.readJournal(executionId)
  if (UNREADABLE_STATES.includes(read?.state)) {
    return { unreadable: read.state, reason: read.reason, read, verified: null }
  }
  /* Протокол приходит из хранилища, потому что выбирает его ИМЯ сегмента,
     а не содержимое. Записи при этом всё равно проверяются заново: чужому
     обещанию «уже проверено» здесь не верят ни в одном поле. */
  return {
    unreadable: null,
    reason: null,
    read,
    verified: parseAndVerifyJournal({
      records: read?.records, executionId, protocol: read?.protocol,
    }),
  }
}

/**
 * Порядок: чтение → проверка → сборка → дозапись с fsync → перечитывание с
 * диска → итог.
 *
 * Файл открывается на дозапись ТОЛЬКО если есть что дописать. При пустом
 * свидетельстве, повреждённом журнале, оборванном хвосте и точном повторе
 * уже записанного решения дескриптор не открывается вовсе, и файл не меняется
 * ни на байт.
 */
export async function reconcileExecution(input) {
  assertStrictOptions(input, { required: RECONCILE_INPUT_KEYS }, 'reconcileExecution: параметры')
  const { store, executionId, evidence, takeover, now } = input
  assertExecutionId(executionId, 'executionId')
  if (typeof now !== 'function') {
    throw new TypeError(`reconcileExecution.now: ожидается функция, получено ${typeof now}`)
  }
  const readClock = (where) => {
    const at = now()
    assertCanonicalInstant(at, where)
    return at
  }

  /* Журнал перечитывается и проверяется общей production-границей. Обещание
     вызывающего «журнал уже проверен» не принимается: параметра для него нет. */
  const before = await readVerifiedJournal(store, executionId)
  if (before.unreadable !== null) {
    return buildResult({
      executionId,
      state: before.unreadable,
      exitCode: before.unreadable === 'journalCorrupt'
        ? EXIT_CODES.journalCorrupt
        : EXIT_CODES.journalForked,
      counts: null,
      total: null,
      appendedBusinessRecords: [],
      appendedProtocolRecords: [],
      ...evidenceFields(null, 'none', null),
      noChargeConfirmed: [],
      reason: before.reason,
    })
  }
  const verified = before.verified
  const closability = closableState(verified)

  const checked = evidence === null ? null : parseAndVerifyReconciliationEvidence(evidence)
  /* Принадлежность исполнению — первым делом: свидетельство чужого прогона не
     обсуждается ни в каком состоянии журнала. */
  if (checked !== null) {
    assertExactly(checked.executionId, executionId, 'свидетельство: executionId против журнала')
  }
  /* Совпадение с уже записанным решением ищется ДО грамматических проверок:
     закрытый журнал и урегулированный элемент — законное состояние повтора,
     и отказывать в нём значило бы запретить перечитать собственный итог. */
  const recorded = checked === null ? null : findRecordedEvidence(checked, verified)
  const sameDecision = recorded !== null
    && recorded.payload.evidenceDigest.value === checked.evidenceDigest.value

  if (closability === 'closed') {
    /* Закрытый журнал на дозапись не открывается. Прочитать его итог можно,
       новое решение — нельзя: оно относилось бы к тому, что уже решено. */
    if (checked !== null && !sameDecision) {
      throw new TypeError(
        `${executionId}: журнал закрыт — новое свидетельство к нему не применяется`,
      )
    }
    return buildResult({
      executionId,
      ...summaryFields(verified),
      appendedBusinessRecords: [],
      appendedProtocolRecords: [],
      ...evidenceFields(checked, checked === null ? 'none' : 'alreadyRecorded', verified),
    })
  }

  const bound = checked === null ? null : bindEvidence(checked, verified)
  const needReconciled = checked !== null && !bound.alreadyRecorded
  /* Хвост операции `charged` достраивается и после падения между записями:
     свидетельство уже записано, а терминальной записи ещё нет. Отвечать
     «уже записано» и не делать ничего в этом состоянии нельзя. */
  const needSettled = checked !== null && checked.verdict === 'charged' && !bound.settled
  /* Журнал, доведённый до терминального состояния и не закрытый, закрывает
     сверка: между последним `settled` и `closed` исполнитель мог упасть. */
  const needClose = closability === 'aborted' || closability === 'closable'
  if (!needReconciled && !needSettled && !needClose) {
    return buildResult({
      executionId,
      ...summaryFields(verified),
      appendedBusinessRecords: [],
      appendedProtocolRecords: [],
      ...evidenceFields(checked, checked === null ? 'none' : 'alreadyRecorded', verified),
    })
  }

  /* Право дозаписи спрашивается ровно тогда, когда дозапись действительно
     нужна: журнал, которому нечего дописать, чужим владением не задет.
     Бизнес-итог при отказе сохраняется — протокольное условие не имеет
     права стереть то, что журнал уже сообщил о деньгах. */
  let blocked = null
  if (before.read.protocol !== 'g1') {
    blocked = { appendability: before.read.appendability, reason: 'preProtocol' }
  } else if (takeover === null && before.read.appendability === 'owned') {
    blocked = { appendability: 'owned', reason: 'owned' }
  } else if (takeover === null && before.read.appendability === 'indeterminate') {
    blocked = { appendability: 'indeterminate', reason: before.read.appendabilityReason }
  }
  if (blocked !== null) {
    return buildResult({
      executionId,
      ...summaryFields(verified),
      appendedBusinessRecords: [],
      appendedProtocolRecords: [],
      ...evidenceFields(null, 'none', verified),
      blocked: Object.freeze(blocked),
    })
  }

  /* Момент каждой будущей записи снимается ЗДЕСЬ, и обе записи строятся и
     проверяются общей грамматикой ДО открытия дескриптора на дозапись.
     Иначе свидетельство из будущего отвергалось бы уже с открытым файлом:
     байты не пострадали бы, но открывать журнал ради заведомо негодного
     решения незачем. */
  const claimAt = readClock('claimed.at')
  const reconciledAt = needReconciled ? readClock('reconciled.at') : null
  const settledAt = needSettled ? readClock('settled.at') : null
  /* План захвата эпохи строится ДО открытия дескриптора и содержит ту же
     запись `claimed`, которую напишет захват. Иначе будущие записи
     проверялись бы против журнала, которого не будет: между хвостом и
     ними встанет ещё одна запись. */
  const plan = await store.planResume({ executionId, takeover, at: claimAt })
  const planned = []
  if (needReconciled) {
    planned.push(buildRecord({
      seq: plan.verified.length + planned.length,
      at: reconciledAt,
      executionId,
      type: 'reconciled',
      payload: buildReconciledPayload({ evidence: checked }),
    }))
  }
  if (needSettled) {
    planned.push(buildRecord({
      seq: plan.verified.length + planned.length,
      at: settledAt,
      executionId,
      type: 'settled',
      payload: {
        requestItemId: checked.requestItemId,
        requestSpecDigest: checked.requestSpecDigest,
        outcome: 'lost',
        charged: true,
        result: null,
      },
    }))
  }
  if (planned.length) {
    parseAndVerifyJournal({
      records: [...plan.verified, ...planned], executionId, protocol: 'g1',
    })
  }

  const appended = []
  const protocolAppended = []
  const handle = await store.resumeJournal({ plan })
  /* Захват эпохи — настоящая запись в журнале, и умолчать о ней в итоге
     значило бы объявить неполный перечень полным. */
  protocolAppended.push('claimed')
  let released = false
  try {
    if (needReconciled) {
      await handle.reconciled({ evidence: checked, at: reconciledAt })
      appended.push('reconciled')
    }
    if (needSettled) {
      await handle.settled({
        requestItemId: checked.requestItemId,
        requestSpecDigest: checked.requestSpecDigest,
        outcome: 'lost',
        charged: true,
        result: null,
        at: settledAt,
      })
      appended.push('settled')
    }
    /* Закрывать или нет — величина производная, а не выбор вызывающего, и
       считается она по перечитанному с диска и заново проверенному журналу. */
    const middle = await readVerifiedJournal(store, executionId)
    if (middle.unreadable !== null) {
      throw new Error(
        `${executionId}: журнал после дозаписи не читается (${middle.unreadable}) — ${middle.reason}`,
      )
    }
    const after = closableState(middle.verified)
    if (after === 'aborted') {
      await handle.closeAborted({ at: readClock('closed.at') })
      appended.push('closed')
      released = true
    } else if (after === 'closable') {
      await handle.close({ at: readClock('closed.at') })
      appended.push('closed')
      released = true
    } else {
      /* Эпоха освобождается ЗАПИСЬЮ: иначе исполнение осталось бы во
         владении этой сверки, и следующему пришлось бы нести полномочие
         владельца после штатного, ничем не примечательного завершения. */
      await handle.release({ at: readClock('released.at'), reason: 'handoff' })
      protocolAppended.push('released')
      released = true
    }
  } catch (error) {
    /* Отказ записи или fsync успешной сверкой не объявляется. Дескриптор
       отпускается, файл остаётся в том состоянии, в каком его застал отказ, и
       продолжение возможно только новым чтением с диска. */
    if (!released) {
      /* Записать освобождение уже нечем: отказ мог случиться именно на
         записи. Дескриптор отпускается без записи, владение остаётся за
         эпохой, и продолжение потребует полномочия владельца. */
      try { await handle.detach() } catch { /* дескриптор уже мог быть закрыт */ }
    }
    throw error
  }

  const final = await readVerifiedJournal(store, executionId)
  if (final.unreadable !== null) {
    throw new Error(
      `${executionId}: журнал после сверки не читается (${final.unreadable}) — ${final.reason}`,
    )
  }
  return buildResult({
    executionId,
    ...summaryFields(final.verified),
    appendedBusinessRecords: appended,
    appendedProtocolRecords: protocolAppended,
    ...evidenceFields(
      checked,
      checked === null ? 'none' : (needReconciled ? 'applied' : 'alreadyRecorded'),
      final.verified,
    ),
  })
}
