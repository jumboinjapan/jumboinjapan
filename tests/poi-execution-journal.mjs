/**
 * Корни артефактов исполнения и журнал упреждающей записи — на НАСТОЯЩЕЙ
 * временной файловой системе.
 *
 * Что проверяется здесь и нигде больше: детерминизм `executionId`, подпись
 * отдельной записи, закрытая грамматика переходов, приоритет потребления над
 * сроком, двухфазный срок хранения, самодостаточное восстановление без плана
 * и без файла разрешения, и fail-closed чтение, которое не чинит файл.
 *
 * Чего здесь нет намеренно: провайдера, сети, денег и reconciliation. План,
 * профиль и разрешение — ФИКСТУРЫ ФОРМЫ: канонический реестр профилей пуст,
 * и production CLI такого плана не строит.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

import { buildModelApproval } from '../scripts/poi-portals/lib/model-approval.mjs'
import { MODEL_PRICING_SPEC } from '../scripts/poi-portals/lib/model-pricing.mjs'
import { PROVIDER_PROFILE_V2_SPEC } from '../scripts/poi-portals/lib/provider-profile.mjs'
import {
  buildModelPlan,
  buildPortalPlanFragment,
  MODEL_INPUT_FIELDS,
} from '../scripts/poi-portals/lib/model-plan.mjs'
import { evaluatePoiCandidate } from '../scripts/poi-portals/lib/scoring.mjs'
import { classifyModelResponse } from '../scripts/poi-portals/lib/classification-contract.mjs'
import { canonicalJsonBytes } from '../scripts/lib/canonical-contract.mjs'
import * as EXECUTION_MODULE from '../scripts/poi-portals/lib/model-execution.mjs'
import {
  buildRecord,
  closedDeleteAfter,
  COUNT_BUCKETS,
  EXECUTION_RECORD_SPEC,
  EXIT_CODES,
  executionId,
  JOURNAL_RETENTION_DAYS,
  MODEL_EXECUTION_SPEC,
  approvalTimeState,
  buildClosedPayload,
  buildOpenedPayload,
  buildReconciliationEvidence,
  assertClaimedPayload,
  buildClaimedPayload,
  assertClassificationResult,
  buildTakeover,
  formatProblem,
  MODEL_TAKEOVER_SPEC,
  TAKEOVER_GROUNDS,
  parseAndVerifyJournal,
  parseAndVerifyRecord,
  segmentName,
  recordDigest,
  RECORD_KEYS,
  RECORD_TYPES,
} from '../scripts/poi-portals/lib/model-execution.mjs'
import { approvalFileName } from '../scripts/poi-portals/lib/approval-store.mjs'
import {
  ARTIFACT_STORE,
  createArtifactStore,
  EXECUTION_ROOT_REL,
  FILE_IO,
  JOURNAL_GENERATION,
  LEGACY_JOURNAL_FILE_NAME,
  REPO_ROOT,
} from '../scripts/poi-portals/lib/execution-journal.mjs'

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
const SEGMENT_1 = segmentName(JOURNAL_GENERATION, 1)
/* Полномочие владельца строится ИЗ ПРИВЯЗКИ, выданной хранилищем: угадать
   длину сегмента и подпись хвоста вручную нельзя, а подписывать не тот
   хвост, который осматривал, владельцу нечем. */
const takeoverFor = async (st, id, at, grounds = 'operatorConfirmedStopped') => buildTakeover({
  ...(await st.takeoverBinding(id)),
  grounds,
  observedAt: at,
  decisionRef: 'owner/takeover-2026-08-16',
  approver: 'owner',
})
const resume = async (st, id, { takeover = null, at }) => st.resumeJournal({
  plan: await st.planResume({ executionId: id, takeover, at }),
})

/* ── Фикстуры ─────────────────────────────────────────────────────────── */

const awaiting = JSON.parse(await readFile(path.join(FX, 'candidates-awaiting.json'), 'utf8'))
const evaluate = (list) => list.map((c) => ({ candidate: c, verdict: evaluatePoiCandidate(c, { bbox: null }) }))
const NOW = new Date('2026-08-13T00:00:00Z')
const CODE_IDENTITY = { commit: '0'.repeat(40), dirty: false }

const PROFILE = Object.freeze({
  contractVersion: PROVIDER_PROFILE_V2_SPEC,
  id: 'example-profile',
  version: '1.0.0',
  providerId: 'example-provider',
  modelId: 'example-model',
  modelIdentity: {
    kind: 'dated-snapshot',
    modelVersion: '2026-08-01',
    catalogObservedAt: null,
    validUntil: null,
    revisionPolicy: 'immutable',
  },
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
    planId: 'plan-execution-fixed',
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
t('кандидатов в плане больше одного', TOTAL > 1, true)

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
  approvalId: 'approval-execution-fixed',
  createdAt: '2026-08-13T00:00:00.000Z',
  validUntil: '2026-08-20T00:00:00.000Z',
  decisionRef: 'owner/2026-08-14',
  approver: 'jumbo',
})
const APPROVAL = buildModelApproval({ plan: clone(PLAN), ...DECISION, limits: clone(LIMITS) })
const FILE_NAME = approvalFileName(APPROVAL)
const AT = '2026-08-14T00:00:00.000Z'
const REQUEST_SPEC_DIGEST = `sha256:${'9'.repeat(64)}`
const proposal = () => ({
  entityKind: 'tourist_poi',
  poiPrimaryType: 'museum',
  facets: [],
  confidence: 0.9,
  reasons: ['тест'],
  nameRu: 'Тестовый музей',
})
const resultFor = (outcome, sourceKey) => {
  if (outcome === 'accepted') return classifyModelResponse(proposal(), { sourceKey })
  if (outcome === 'rejected') {
    /* Журналы, которые пишет ЭТОТ код, — поколения g2, а там проблема не
       строка, а ограниченная запись: вид, полная длина, отпечаток полного
       текста, ограниченное начало и признак обрезки. */
    return {
      ok: false,
      problems: [formatProblem('schemaViolation', 'ответ отвергнут')],
      proposal: null,
      classification: null,
    }
  }
  return null
}
const dispatchInput = (requestItemId, at = AT) => ({
  requestItemId, requestSpecDigest: REQUEST_SPEC_DIGEST, at,
})
/* Поколение g2 требует записанных исходящих байтов ПЕРЕД намерением
   отправить. Отпечатки здесь произвольные, но формы правильной: журнал
   проверяет форму и связку, а соответствие настоящему буферу — граница
   транспорта, которой журнал байтов не показывает. */
const SERIALIZER_DIGEST = `sha256:${'5'.repeat(64)}`
const PROFILE_DIGEST_VALUE = `sha256:${'6'.repeat(64)}`
const OUTBOUND_DIGEST = `sha256:${'7'.repeat(64)}`
const preparedInput = (requestItemId, at = AT) => ({
  requestItemId,
  requestSpecDigest: REQUEST_SPEC_DIGEST,
  serializerDescriptorDigest: SERIALIZER_DIGEST,
  providerProfileDigest: PROFILE_DIGEST_VALUE,
  outboundBytesDigest: OUTBOUND_DIGEST,
  outboundBytes: 1024,
  at,
})
/* Обе записи одним вызовом: сценарии ниже говорят о том, что проверяют, а не
   о протоколе. Порядок внутри — тот же, что в исполнителе. */
const dispatch = async (handle, requestItemId, at = AT) => {
  await handle.prepared(preparedInput(requestItemId, at))
  return handle.dispatching(dispatchInput(requestItemId, at))
}
/* Свидетельство владельца о судьбе неопределённого запроса. Формируется
   ровно тем же production-сборщиком, что и в reconciliation. */
const evidenceFor = (execId, requestItemId, verdict, observedAt = AT) => buildReconciliationEvidence({
  executionId: execId,
  requestItemId,
  requestSpecDigest: REQUEST_SPEC_DIGEST,
  verdict,
  grounds: 'providerConsole',
  observedAt,
  decisionRef: 'owner/2026-08-15: выписка провайдера за сутки',
  approver: 'jumbo',
})
const settledInput = (requestItemId, outcome, charged, sourceKey, at = AT) => ({
  requestItemId,
  requestSpecDigest: REQUEST_SPEC_DIGEST,
  outcome,
  charged,
  result: resultFor(outcome, sourceKey),
  at,
})

/* ── Публичная поверхность и закрытые списки ──────────────────────────── */

t('домен исполнения', MODEL_EXECUTION_SPEC, 'poi-model-execution/v1')
t('домен записи отдельный', EXECUTION_RECORD_SPEC, 'poi-model-execution-record/v1')
t('состав записи — семь ключей', RECORD_KEYS.length, 7)
t('корзин счёта восемь', COUNT_BUCKETS.length, 8)
t('срок хранения журнала', JOURNAL_RETENTION_DAYS, 30)
t('коды возврата не переиспользуются',
  new Set(Object.values(EXIT_CODES)).size, Object.keys(EXIT_CODES).length)
t('код потери отдельный', EXIT_CODES.withLoss, 60)
t('production-корень выведен из модуля, а не из cwd', REPO_ROOT, path.resolve(HERE, '..'))
t('production-хранилище указывает в фиксированный каталог',
  ARTIFACT_STORE.root, path.join(REPO_ROOT, EXECUTION_ROOT_REL))
for (const key of Object.keys(EXECUTION_MODULE)) {
  if (typeof EXECUTION_MODULE[key] === 'object' && EXECUTION_MODULE[key] !== null) {
    t(`константа ${key} заморожена`, Object.isFrozen(EXECUTION_MODULE[key]), true)
  }
}

/* ── executionId: закреплённые байты ──────────────────────────────────── */

const GOLDEN_ID = 'b277843923dcf6addc4d5c54e5b18c54a5ab87d07300fca4a61a4cd0ecd70437'
const GOLD_A = `sha256:${'a'.repeat(64)}`
const GOLD_P = `sha256:${'b'.repeat(64)}`
t('закреплённый executionId',
  executionId({ approvalDigest: GOLD_A, planDigest: GOLD_P }), GOLDEN_ID)
t('перестановка digest даёт другой идентификатор',
  executionId({ approvalDigest: GOLD_P, planDigest: GOLD_A }) === GOLDEN_ID, false)
t('идентификатор — ровно 64 строчных hex без префикса',
  /^[0-9a-f]{64}$/.test(executionId({ approvalDigest: GOLD_A, planDigest: GOLD_P })), true)
t('детерминизм: второй вызов даёт то же',
  executionId({ approvalDigest: GOLD_A, planDigest: GOLD_P }),
  executionId({ approvalDigest: GOLD_A, planDigest: GOLD_P }))
for (const wrong of [`${'a'.repeat(64)}`, `SHA256:${'a'.repeat(64)}`, `sha256:${'A'.repeat(64)}`,
  `sha256:${'a'.repeat(63)}`, '', null, 42]) {
  t(`значение неправильной формы ${JSON.stringify(wrong)} отвергается`,
    /ожидается «sha256:»/.test(boom(() => executionId({ approvalDigest: wrong, planDigest: GOLD_P }))), true)
}

/* ── Подпись записи ───────────────────────────────────────────────────── */

const SAMPLE_RECORD = buildRecord({
  generation: null,
  seq: 0,
  at: '2026-08-13T00:00:00.000Z',
  executionId: GOLDEN_ID,
  type: 'dispatching',
  payload: { requestItemId: 'c'.repeat(64), requestSpecDigest: REQUEST_SPEC_DIGEST },
})
t('подпись записи — sha256 нужной формы',
  /^sha256:[0-9a-f]{64}$/.test(SAMPLE_RECORD.recordDigest.value), true)
t('домен подписи записи', SAMPLE_RECORD.recordDigest.spec, EXECUTION_RECORD_SPEC)
t('запись заморожена', Object.isFrozen(SAMPLE_RECORD), true)
t('подпись не покрывает саму себя — пересчёт сходится',
  recordDigest({ ...clone(SAMPLE_RECORD) }), SAMPLE_RECORD.recordDigest.value)
for (const mutate of [
  (r) => { r.seq = 1 }, (r) => { r.at = '2026-08-13T00:00:01.000Z' },
  (r) => { r.type = 'settled' }, (r) => { r.payload.requestItemId = 'd'.repeat(64) },
  (r) => { r.executionId = 'f'.repeat(64) },
]) {
  const copy = clone(SAMPLE_RECORD)
  mutate(copy)
  t('изменение поля меняет подпись', recordDigest(copy) === SAMPLE_RECORD.recordDigest.value, false)
}
const tampered = clone(SAMPLE_RECORD)
tampered.recordDigest.value = `sha256:${'0'.repeat(64)}`
t('подменённая подпись отвергается',
  /recordDigest не сходится/.test(boom(() => parseAndVerifyRecord(tampered, { executionId: GOLDEN_ID, generation: null }))), true)

const hiddenRecord = clone(SAMPLE_RECORD)
Object.defineProperty(hiddenRecord, 'granted', { value: true, enumerable: false })
t('скрытое поле записи отвергается до проекции',
  boom(() => recordDigest(hiddenRecord)) !== '(без ошибки)', true)
const symbolRecord = clone(SAMPLE_RECORD)
symbolRecord[Symbol('granted')] = true
t('символьное поле записи отвергается',
  boom(() => recordDigest(symbolRecord)) !== '(без ошибки)', true)

t('lost без charged невыразим',
  /исход «lost» требует charged === true/.test(boom(() => buildRecord({
    generation: null,
    seq: 1, at: AT, executionId: GOLDEN_ID, type: 'settled',
    payload: {
      requestItemId: 'c'.repeat(64), requestSpecDigest: REQUEST_SPEC_DIGEST,
      outcome: 'lost', charged: false, result: null,
    },
  }))), true)
t('неизвестный тип записи отвергается',
  /ожидается один из/.test(boom(() => buildRecord({
    generation: null,
    seq: 0, at: AT, executionId: GOLDEN_ID, type: 'reconciliation', payload: {},
  }))), true)
/* Версию результата классификации выбирает ПОКОЛЕНИЕ ЖУРНАЛА, а не форма
   значения. Набор ключей у v1 и v2 одинаков, и различить их «по виду
   problems» нельзя: у принятого предложения список пуст в обеих версиях, и
   всякий раз, когда он пуст, догадка по форме даёт v1. Здесь закреплены оба
   контрпримера, которых догадка не переживает. */
const stringProblems = { ok: false, problems: ['текст'], proposal: null, classification: null }
const objectProblems = {
  ok: false,
  problems: [formatProblem('schemaViolation', 'текст')],
  proposal: null,
  classification: null,
}
t('строковые проблемы в журнале прежнего формата принимаются',
  boom(() => assertClassificationResult(stringProblems, 'rejected', 'v1', null)), '(без ошибки)')
t('и в журнале g1 тоже',
  boom(() => assertClassificationResult(stringProblems, 'rejected', 'v1', 'g1')), '(без ошибки)')
t('но в журнале g2 они отвергаются',
  boom(() => assertClassificationResult(stringProblems, 'rejected', 'v2', 'g2'))
    !== '(без ошибки)', true)
t('ограниченные проблемы в журнале g2 принимаются',
  boom(() => assertClassificationResult(objectProblems, 'rejected', 'v2', 'g2')), '(без ошибки)')
t('но в журнале прежнего формата они отвергаются',
  boom(() => assertClassificationResult(objectProblems, 'rejected', 'v1', null))
    !== '(без ошибки)', true)
t('и в журнале g1 тоже',
  boom(() => assertClassificationResult(objectProblems, 'rejected', 'v1', 'g1'))
    !== '(без ошибки)', true)
t('неизвестное поколение — отказ, а не мягкая проверка',
  /неизвестное поколение/.test(
    boom(() => assertClassificationResult(objectProblems, 'rejected', 'v3', 'g3')),
  ), true)
/* Обрезка начала идёт по границе последовательности UTF-8: разрубленная
   многобайтовая последовательность декодировалась бы символом-заменителем,
   то есть текстом, которого не было. */
const longCyrillic = formatProblem('schemaViolation', 'я'.repeat(500))
t('длинная проблема помечена обрезанной', longCyrillic.truncated, true)
t('и её начало не длиннее предела',
  Buffer.byteLength(longCyrillic.prefix, 'utf8') <= 200, true)
t('и начало декодируется без символа-заменителя',
  longCyrillic.prefix.includes('\ufffd'), false)
t('и полная длина названа', longCyrillic.bytes, Buffer.byteLength('я'.repeat(500), 'utf8'))
t('а короткая проблема самодостаточна',
  boom(() => assertClassificationResult(objectProblems, 'rejected', 'v2', 'g2')), '(без ошибки)')
const forged = clone(objectProblems)
forged.problems[0].prefix = 'подменённый текст'
t('подмена начала у необрезанной проблемы отвергается',
  boom(() => assertClassificationResult(forged, 'rejected', 'v2', 'g2')) !== '(без ошибки)', true)

t('грамматика знает восемь типов и ни одним больше',
  RECORD_TYPES.join(','),
  'opened,claimed,prepared,dispatching,settled,reconciled,released,closed')
t('и список закрыт', Object.isFrozen(RECORD_TYPES), true)

/* Закреплённый поток байтов записи: длина и результат, а не только форма. */
const GOLDEN_RECORD = {
  contractVersion: MODEL_EXECUTION_SPEC,
  seq: 0,
  at: '2026-08-13T00:00:00.000Z',
  executionId: GOLDEN_ID,
  type: 'dispatching',
  payload: { requestItemId: 'c'.repeat(64), requestSpecDigest: REQUEST_SPEC_DIGEST },
}
const GOLDEN_STREAM = canonicalJsonBytes(GOLDEN_RECORD, EXECUTION_RECORD_SPEC)
t('длина потока байтов записи', GOLDEN_STREAM.length, 405)
t('домен стоит первым полем потока',
  GOLDEN_STREAM.toString('utf8').startsWith(`${EXECUTION_RECORD_SPEC}\n`), true)
t('закреплённый recordDigest', recordDigest(GOLDEN_RECORD),
  'sha256:5961ba9ecc0afcfc65847218a7020ce04b78c6bfd8fbb368937fe15855941e0d')

/* Строгая форма ПОЛНОГО сырого входа обеих публичных функций. */
const spoil = (base, kind) => {
  const copy = clone(base)
  if (kind === 'лишнее поле') copy.лишнее = 1
  if (kind === 'скрытое поле') Object.defineProperty(copy, 'скрытое', { value: 1, enumerable: false })
  if (kind === 'символьное поле') copy[Symbol('скрытое')] = 1
  if (kind === 'accessor') {
    const [first] = Object.keys(copy)
    const value = copy[first]
    delete copy[first]
    Object.defineProperty(copy, first, { get: () => value, enumerable: true })
  }
  return copy
}
const SPOILS = ['лишнее поле', 'скрытое поле', 'символьное поле', 'accessor']
const ID_INPUT = { approvalDigest: GOLD_A, planDigest: GOLD_P }
const RECORD_INPUT = {
  seq: 0, at: '2026-08-13T00:00:00.000Z', executionId: GOLDEN_ID,
  type: 'dispatching', generation: null,
  payload: { requestItemId: 'c'.repeat(64), requestSpecDigest: REQUEST_SPEC_DIGEST },
}
for (const kind of SPOILS) {
  t(`executionId отвергает вход: ${kind}`,
    boom(() => executionId(spoil(ID_INPUT, kind))) !== '(без ошибки)', true)
  t(`и не выдаёт для «${kind}» тот же идентификатор`,
    boom(() => executionId(spoil(ID_INPUT, kind))) === GOLDEN_ID, false)
  t(`buildRecord отвергает вход: ${kind}`,
    boom(() => buildRecord(spoil(RECORD_INPUT, kind))) !== '(без ошибки)', true)
}
t('неиспорченный вход идентификатор получает', executionId(clone(ID_INPUT)), GOLDEN_ID)
t('и запись собирается', buildRecord(clone(RECORD_INPUT)).seq, 0)
t('лишнее поле внутри recordDigest отвергается',
  /recordDigest: лишние поля/.test(boom(() => {
    const copy = clone(SAMPLE_RECORD)
    copy.recordDigest.лишнее = 1
    return parseAndVerifyRecord(copy, { executionId: GOLDEN_ID, generation: null })
  })), true)

/* Строгая форма распространяется на ВСЕ публичные object-входы модуля, а не
   только на те, что выдают подпись: лишнее поле, молча выброшенное
   деструктуризацией, — это принятое обещание, которого никто не проверил. */
const RECORD_FOR_JOURNAL = buildRecord({
  generation: null,
  seq: 0, at: '2026-08-13T00:00:00.000Z', executionId: GOLDEN_ID, type: 'dispatching',
  payload: { requestItemId: 'c'.repeat(64), requestSpecDigest: REQUEST_SPEC_DIGEST },
})
t('parseAndVerifyJournal отвергает лишнее поле входа',
  /лишние поля extra/.test(boom(() => parseAndVerifyJournal({
    protocol: 'preProtocol',
    records: [clone(RECORD_FOR_JOURNAL)], executionId: GOLDEN_ID, extra: 'ignored',
  }))), true)
t('parseAndVerifyRecord отвергает лишнее поле параметров',
  /лишние поля extra/.test(boom(() => parseAndVerifyRecord(
    clone(RECORD_FOR_JOURNAL), { executionId: GOLDEN_ID, generation: null, extra: 1 },
  ))), true)
t('parseAndVerifyRecord требует параметры явно',
  boom(() => parseAndVerifyRecord(clone(RECORD_FOR_JOURNAL))) !== '(без ошибки)', true)
t('approvalTimeState отвергает лишнее поле',
  /лишние поля/.test(boom(() => approvalTimeState({
    approval: clone(APPROVAL), at: AT, extra: 1,
  }))), true)
t('buildOpenedPayload отвергает лишнее поле',
  /лишние поля/.test(boom(() => buildOpenedPayload({
    approval: clone(APPROVAL), plan: clone(PLAN), at: AT, extra: 1,
  }))), true)
t('closedDeleteAfter отвергает лишнее поле',
  /лишние поля/.test(boom(() => closedDeleteAfter({
    openedDeleteAfter: AT, closedAt: AT, extra: 1,
  }))), true)
t('buildClosedPayload отвергает лишнее поле',
  /лишние поля/.test(boom(() => buildClosedPayload({ verified: [], at: AT, extra: 1 }))), true)
for (const kind of ['скрытое поле', 'символьное поле']) {
  t(`parseAndVerifyJournal отвергает вход: ${kind}`,
    boom(() => parseAndVerifyJournal(spoil({
      protocol: 'preProtocol',
      records: [clone(RECORD_FOR_JOURNAL)], executionId: GOLDEN_ID,
    }, kind))) !== '(без ошибки)', true)
}

/* Связи между записями проверяются последовательностью, а не формой одной
   строки: settled обязан принадлежать тому же requestSpec и тому же
   sourceKey, что были зафиксированы до эффекта. */
const LINK_ID = executionId({
  approvalDigest: APPROVAL.approvalDigest.value,
  planDigest: APPROVAL.planDigest.value,
})
const LINK_OPENED = buildRecord({
  generation: null,
  seq: 0,
  at: AT,
  executionId: LINK_ID,
  type: 'opened',
  payload: buildOpenedPayload({ approval: clone(APPROVAL), plan: clone(PLAN), at: AT }),
})
const LINK_ITEM = LINK_OPENED.payload.items[0]
const LINK_DISPATCH = buildRecord({
  generation: null,
  seq: 1, at: AT, executionId: LINK_ID, type: 'dispatching',
  payload: {
    requestItemId: LINK_ITEM.requestItemId,
    requestSpecDigest: REQUEST_SPEC_DIGEST,
  },
})
const linkedSettled = (requestSpecDigest, sourceKey) => buildRecord({
  generation: null,
  seq: 2, at: AT, executionId: LINK_ID, type: 'settled',
  payload: {
    requestItemId: LINK_ITEM.requestItemId,
    requestSpecDigest,
    outcome: 'accepted',
    charged: true,
    result: resultFor('accepted', sourceKey),
  },
})
t('связанный dispatching/settled проходит',
  boom(() => parseAndVerifyJournal({
    protocol: 'preProtocol',
    records: [LINK_OPENED, LINK_DISPATCH, linkedSettled(
      REQUEST_SPEC_DIGEST, LINK_ITEM.sourceKey,
    )],
    executionId: LINK_ID,
  })), '(без ошибки)')
t('settled с чужим requestSpecDigest отвергается',
  /requestSpecDigest против dispatching/.test(boom(() => parseAndVerifyJournal({
    protocol: 'preProtocol',
    records: [LINK_OPENED, LINK_DISPATCH, linkedSettled(
      `sha256:${'8'.repeat(64)}`, LINK_ITEM.sourceKey,
    )],
    executionId: LINK_ID,
  }))), true)
t('принятая классификация с чужим sourceKey отвергается',
  /classification.sourceKey против opened/.test(boom(() => parseAndVerifyJournal({
    protocol: 'preProtocol',
    records: [LINK_OPENED, LINK_DISPATCH, linkedSettled(
      REQUEST_SPEC_DIGEST, 'чужой-source-key',
    )],
    executionId: LINK_ID,
  }))), true)
t('время записей не может идти назад',
  /раньше предыдущей записи/.test(boom(() => parseAndVerifyJournal({
    protocol: 'preProtocol',
    records: [
      LINK_OPENED,
      LINK_DISPATCH,
      buildRecord({
        generation: null,
        seq: 2,
        at: '2026-08-13T23:59:59.000Z',
        executionId: LINK_ID,
        type: 'settled',
        payload: {
          requestItemId: LINK_ITEM.requestItemId,
          requestSpecDigest: REQUEST_SPEC_DIGEST,
          outcome: 'accepted',
          charged: true,
          result: resultFor('accepted', LINK_ITEM.sourceKey),
        },
      }),
    ],
    executionId: LINK_ID,
  }))), true)

/* ── Захват эпохи: форма записи и привязка полномочия ─────────────────── */

const TAKEOVER_BINDING = Object.freeze({
  executionId: GOLDEN_ID,
  fromEpoch: 1,
  fromSeq: 4,
  fromRecordDigest: `sha256:${'b'.repeat(64)}`,
  fromSegmentBytes: 900,
  fromSegmentRawDigest: `sha256:${'e'.repeat(64)}`,
  supersededSegments: [
    { name: 'journal.g1.e2.jsonl', bytes: 0, rawDigest: `sha256:${'c'.repeat(64)}` },
  ],
})
const GOLDEN_TAKEOVER = buildTakeover({
  ...TAKEOVER_BINDING,
  grounds: 'operatorConfirmedStopped',
  observedAt: '2026-08-16T00:00:00.000Z',
  decisionRef: 'owner/2026-08-16: процесс остановлен',
  approver: 'owner',
})
const claimedPayloadOf = (overrides = {}) => buildClaimedPayload({
  ...TAKEOVER_BINDING,
  generation: 'g1',
  epoch: 3,
  basis: 'takeover',
  takeover: GOLDEN_TAKEOVER,
  ...overrides,
})
t('полномочие несёт свой домен', GOLDEN_TAKEOVER.contractVersion, 'poi-model-takeover/v1')
t('и закрытый список оснований', TAKEOVER_GROUNDS.join(','),
  'processExited,hostRestarted,operatorConfirmedStopped')
t('положительный контроль захвата', claimedPayloadOf().basis, 'takeover')

/* Перечень перешагнутых сегментов не произвольный: между содержательной
   эпохой и новой не может остаться ни одного неназванного файла. */
t('пропуск перешагнутого сегмента отвергается',
  /перечень между fromEpoch и epoch/.test(boom(() => claimedPayloadOf({
    supersededSegments: [],
    takeover: buildTakeover({
      ...TAKEOVER_BINDING,
      supersededSegments: [],
      grounds: 'processExited',
      observedAt: '2026-08-16T00:00:00.000Z',
      decisionRef: 'owner/2026-08-16',
      approver: 'owner',
    }),
  }))), true)
t('лишний перешагнутый сегмент отвергается так же',
  /перечень между fromEpoch и epoch/.test(boom(() => {
    const extra = [
      ...TAKEOVER_BINDING.supersededSegments,
      { name: 'journal.g1.e5.jsonl', bytes: 0, rawDigest: `sha256:${'d'.repeat(64)}` },
    ]
    return claimedPayloadOf({
      supersededSegments: extra,
      takeover: buildTakeover({
        ...TAKEOVER_BINDING,
        supersededSegments: extra,
        grounds: 'processExited',
        observedAt: '2026-08-16T00:00:00.000Z',
        decisionRef: 'owner/2026-08-16',
        approver: 'owner',
      }),
    })
  })), true)

/* Полномочие связано с исполнением через свой отпечаток, хотя `executionId` в
   payload не лежит: подставить чужое разрешение нечем. */
t('полномочие чужого исполнения не проходит границу записи',
  /takeoverDigest не сходится/.test(boom(
    () => assertClaimedPayload(claimedPayloadOf(), 'claimed.payload', 'd'.repeat(64)),
  )), true)
t('и полномочие с чужим хвостом тоже',
  /takeoverDigest не сходится/.test(boom(() => assertClaimedPayload(
    { ...claimedPayloadOf(), fromSeq: 5 }, 'claimed.payload', GOLDEN_ID,
  ))), true)

/* ── Двухфазный срок ──────────────────────────────────────────────────── */

const DAY = 24 * 60 * 60 * 1000
t('окончательный срок не короче предварительного',
  closedDeleteAfter({ openedDeleteAfter: '2027-01-01T00:00:00.000Z', closedAt: AT }),
  '2027-01-01T00:00:00.000Z')
t('и не короче тридцати суток после закрытия',
  closedDeleteAfter({ openedDeleteAfter: '2026-08-15T00:00:00.000Z', closedAt: AT }),
  new Date(Date.parse(AT) + 30 * DAY).toISOString())

/* ── Файловая система ─────────────────────────────────────────────────── */

const repoRoot = await mkdtemp(path.join(tmpdir(), 'poi-exec-'))
try {
  const store = createArtifactStore({ repoRoot })
  const ID = executionId({
    approvalDigest: APPROVAL.approvalDigest.value, planDigest: APPROVAL.planDigest.value,
  })

  /* ── Разрешение: запись, повторное обнаружение, проверка ────────────── */

  t('имя разрешения выводится из подписи',
    FILE_NAME, `${APPROVAL.approvalDigest.value.slice('sha256:'.length)}.json`)
  const written = await store.approvals.writeApprovalFile({ approval: clone(APPROVAL), plan: clone(PLAN) })
  t('файл разрешения создан', lstatSync(written.path).isFile(), true)
  t('и лежит в фиксированном каталоге',
    written.path, path.join(repoRoot, 'tmp', 'poi-model-approvals', FILE_NAME))
  t('повторная запись того же разрешения отвергается',
    /уже существует/.test(await boomAsync(() => store.approvals.writeApprovalFile({
      approval: clone(APPROVAL), plan: clone(PLAN),
    }))), true)

  const rediscovered = await store.approvals.readApprovalFile({ fileName: FILE_NAME, plan: clone(PLAN) })
  t('прочитанное разрешение совпадает с записанным',
    rediscovered.approval.approvalDigest.value, APPROVAL.approvalDigest.value)

  for (const wrongName of [
    '../побег.json', '/абсолютный.json', 'подкаталог/имя.json', '..\\побег.json',
    `${'A'.repeat(64)}.json`, `${'a'.repeat(63)}.json`, `${'a'.repeat(64)}.JSON`, 'произвольное.json',
  ]) {
    const message = await boomAsync(() => store.approvals.readApprovalFile({
      fileName: wrongName, plan: clone(PLAN),
    }))
    t(`имя ${JSON.stringify(wrongName)} отвергается до чтения`, message !== '(без ошибки)', true)
    t(`и отказ по имени, а не по содержимому (${JSON.stringify(wrongName)})`,
      /имя разрешения/.test(message), true)
  }
  t('отсутствующий файл разрешения отвергается',
    /не найден/.test(await boomAsync(() => store.approvals.readApprovalFile({
      fileName: `${'e'.repeat(64)}.json`, plan: clone(PLAN),
    }))), true)

  const foreignName = `${'d'.repeat(64)}.json`
  await writeFile(
    path.join(repoRoot, 'tmp', 'poi-model-approvals', foreignName),
    `${JSON.stringify(APPROVAL, null, 2)}\n`, 'utf8',
  )
  t('верное разрешение под чужим именем отвергается',
    /не совпадает с подписью разрешения/.test(await boomAsync(() => store.approvals.readApprovalFile({
      fileName: foreignName, plan: clone(PLAN),
    }))), true)

  const brokenName = `${'c'.repeat(64)}.json`
  await writeFile(path.join(repoRoot, 'tmp', 'poi-model-approvals', brokenName), '{не json', 'utf8')
  t('неразбираемое содержимое отвергается',
    /не разбирается как JSON/.test(await boomAsync(() => store.approvals.readApprovalFile({
      fileName: brokenName, plan: clone(PLAN),
    }))), true)

  const linkName = `${'b'.repeat(64)}.json`
  symlinkSync(written.path, path.join(repoRoot, 'tmp', 'poi-model-approvals', linkName))
  t('символьная ссылка на месте разрешения отвергается',
    /символьная ссылка/.test(await boomAsync(() => store.approvals.readApprovalFile({
      fileName: linkName, plan: clone(PLAN),
    }))), true)

  /* Разрешение из памяти сессию не открывает: путь к нему — файл, и
     имя проверяется раньше всего остального. */
  for (const notAName of [APPROVAL, clone(APPROVAL), 42, null, ['имя']]) {
    t(`объект вместо имени разрешения отвергается (${typeof notAName})`,
      /имя разрешения/.test(await boomAsync(() => store.openJournal({
        approvalFileName: notAName, plan: clone(PLAN), at: AT,
      }))), true)
  }

  /* Содержимое подменено, а поле подписи оставлено прежним: имя файла от
     этого не меняется и сойдётся, а подпись — нет. Проверяется в отдельном
     корне, чтобы не затереть настоящее разрешение тем же именем. */
  const tamperedRepo = await mkdtemp(path.join(tmpdir(), 'poi-tamper-'))
  try {
    const tamperedStore = createArtifactStore({ repoRoot: tamperedRepo })
    const tamperedApproval = clone(APPROVAL)
    tamperedApproval.approver = 'кто-то другой'
    t('имя от подмены содержимого не изменилось', approvalFileName(tamperedApproval), FILE_NAME)
    mkdirSync(path.join(tamperedRepo, 'tmp'))
    mkdirSync(path.join(tamperedRepo, 'tmp', 'poi-model-approvals'))
    await writeFile(
      path.join(tamperedRepo, 'tmp', 'poi-model-approvals', FILE_NAME),
      `${JSON.stringify(tamperedApproval, null, 2)}\n`, 'utf8',
    )
    t('подменённое содержимое под своим же именем отвергается',
      /approvalDigest не сходится/.test(await boomAsync(() => tamperedStore.approvals.readApprovalFile({
        fileName: FILE_NAME, plan: clone(PLAN),
      }))), true)
    t('и сессию по нему открыть нельзя',
      /approvalDigest не сходится/.test(await boomAsync(() => tamperedStore.openJournal({
        approvalFileName: FILE_NAME, plan: clone(PLAN), at: AT,
      }))), true)
    t('и каталог исполнения при этом не создан',
      existsSync(path.join(tamperedRepo, 'tmp', 'poi-model-executions')), false)
  } finally {
    await rm(tamperedRepo, { recursive: true, force: true })
  }

  /* Строгая форма входов фабрики и методов хранилища. Вход, несущий
     функции, канонизировать нельзя — строгость здесь даёт проверка
     собственных ключей верхнего уровня. */
  t('фабрика хранилища отвергает лишнее поле',
    /лишние поля/.test(boom(() => createArtifactStore({ repoRoot, лишнее: 1 }))), true)
  t('фабрика требует корень',
    /нет обязательных полей repoRoot/.test(boom(() => createArtifactStore({}))), true)
  t('фабрика отвергает скрытое поле', boom(() => {
    const input = { repoRoot }
    Object.defineProperty(input, 'скрытое', { value: 1, enumerable: false })
    return createArtifactStore(input)
  }) !== '(без ошибки)', true)
  t('фабрика принимает io как объявленный необязательный параметр',
    boom(() => createArtifactStore({ repoRoot, io: FILE_IO })), '(без ошибки)')
  for (const [label, call] of [
    ['readApprovalFile', () => store.approvals.readApprovalFile({
      fileName: FILE_NAME, plan: clone(PLAN), лишнее: 1,
    })],
    ['writeApprovalFile', () => store.approvals.writeApprovalFile({
      approval: clone(APPROVAL), plan: clone(PLAN), лишнее: 1,
    })],
    ['openJournal', () => store.openJournal({
      approvalFileName: FILE_NAME, plan: clone(PLAN), at: AT, лишнее: 1,
    })],
    ['planResume', () => store.planResume({
      executionId: 'a'.repeat(64), takeover: null, at: AT, лишнее: 1,
    })],
    ['resumeJournal', () => store.resumeJournal({ plan: null, лишнее: 1 })],
  ]) {
    t(`${label} отвергает лишнее поле входа`,
      /лишние поля/.test(await boomAsync(call)), true)
  }
  t('approvalState отвергает лишнее поле входа',
    /лишние поля/.test(boom(() => store.approvalState({
      approval: clone(APPROVAL), at: AT, лишнее: 1,
    }))), true)

  /* ── Состояния разрешения ───────────────────────────────────────────── */

  t('до открытия разрешение действует',
    store.approvalState({ approval: rediscovered.approval, at: AT }).state, 'active')
  t('до начала срока — notYetValid',
    store.approvalState({ approval: rediscovered.approval, at: '2026-08-01T00:00:00.000Z' }).state,
    'notYetValid')
  t('после validUntil — expired',
    store.approvalState({ approval: rediscovered.approval, at: '2026-09-01T00:00:00.000Z' }).state,
    'expired')
  t('идентификатор в состоянии — тот же детерминированный',
    store.approvalState({ approval: rediscovered.approval, at: AT }).executionId, ID)

  t('истёкшее разрешение новую сессию не открывает',
    /состояние «expired»/.test(await boomAsync(() => store.openJournal({
      approvalFileName: FILE_NAME, plan: clone(PLAN), at: '2026-09-01T00:00:00.000Z',
    }))), true)
  t('и каталог исполнения при этом не создан', existsSync(store.executionDir(ID)), false)

  /* ── Открытие журнала ───────────────────────────────────────────────── */

  const handle = await store.openJournal({ approvalFileName: FILE_NAME, plan: clone(PLAN), at: AT })
  t('журнал открыт по детерминированному идентификатору', handle.executionId, ID)
  t('файл журнала создан', lstatSync(handle.path).isFile(), true)
  t('и лежит по ожидаемому пути',
    handle.path, path.join(repoRoot, 'tmp', 'poi-model-executions', ID, SEGMENT_1))
  t('и это первая эпоха', handle.epoch, 1)

  const openedOnDisk = (await readFile(handle.path, 'utf8')).trim().split('\n')
  /* Две записи одним вызовом и одним fsync: `opened` и подписанная
     инициализация протокола. Разбить их на две операции значило бы добавить
     лишнее окно обрыва без единого нового доказательства. */
  t('на диске ровно две записи сразу после открытия', openedOnDisk.length, 2)
  t('вторая — подписанный захват первой эпохи', JSON.parse(openedOnDisk[1]).type, 'claimed')
  t('и она связывает поколение с именем сегмента',
    JSON.parse(openedOnDisk[1]).payload.generation, JOURNAL_GENERATION)
  t('и ссылается на отпечаток opened',
    JSON.parse(openedOnDisk[1]).payload.fromRecordDigest,
    JSON.parse(openedOnDisk[0]).recordDigest.value)
  const openedRecord = JSON.parse(openedOnDisk[0])
  t('первая запись — opened', openedRecord.type, 'opened')
  t('и её номер нулевой', openedRecord.seq, 0)
  t('opened несёт всех кандидатов плана', openedRecord.payload.items.length, TOTAL)
  t('и у каждого есть sourceKey',
    openedRecord.payload.items.every((i) => typeof i.sourceKey === 'string' && i.sourceKey.length), true)
  t('предварительный срок не короче срока разрешения',
    Date.parse(openedRecord.payload.deleteAfter) >= Date.parse(APPROVAL.deleteAfter), true)

  t('после открытия разрешение израсходовано',
    store.approvalState({ approval: rediscovered.approval, at: AT }).state, 'consumed')
  t('и потребление сильнее истёкшего срока',
    store.approvalState({ approval: rediscovered.approval, at: '2026-09-01T00:00:00.000Z' }).state,
    'consumed')
  t('и сильнее ненаступившего',
    store.approvalState({ approval: rediscovered.approval, at: '2026-08-01T00:00:00.000Z' }).state,
    'consumed')
  t('повторное открытие того же разрешения отвергается',
    /состояние «consumed»/.test(await boomAsync(() => store.openJournal({
      approvalFileName: FILE_NAME, plan: clone(PLAN), at: AT,
    }))), true)

  /* ── Упреждающая запись ─────────────────────────────────────────────── */

  const openedById = new Map(openedRecord.payload.items.map((item) => [item.requestItemId, item]))
  const items = [...openedById.keys()]
  await dispatch(handle, items[0])
  const afterDispatch = (await readFile(handle.path, 'utf8')).trim().split('\n')
  t('подготовка и намерение на диске сразу после возврата', afterDispatch.length, 4)
  t('сначала подготовка', JSON.parse(afterDispatch[2]).type, 'prepared')
  t('и только потом dispatching', JSON.parse(afterDispatch[3]).type, 'dispatching')
  const preparedOnDisk = JSON.parse(afterDispatch[2]).payload
  t('подготовка называет исходящие байты', preparedOnDisk.outboundBytesDigest, OUTBOUND_DIGEST)
  t('и их длину', preparedOnDisk.outboundBytes, 1024)
  t('и сериализатор', preparedOnDisk.serializerDescriptorDigest, SERIALIZER_DIGEST)
  t('и профиль', preparedOnDisk.providerProfileDigest, PROFILE_DIGEST_VALUE)
  t('отправка без подготовки невозможна',
    /dispatching без prepared/.test(await boomAsync(
      () => handle.dispatching(dispatchInput(items[1])),
    )), true)
  t('повторная подготовка отвергается',
    /повторный prepared/.test(await boomAsync(
      () => handle.prepared(preparedInput(items[0])),
    )), true)

  t('settled без dispatching отвергается',
    /settled без dispatching/.test(await boomAsync(() => handle.settled(settledInput(
      items[1], 'accepted', true, openedById.get(items[1]).sourceKey,
    )))), true)
  t('повторный dispatching отвергается',
    /повторный dispatching/.test(await boomAsync(
      () => handle.dispatching(dispatchInput(items[0])),
    )), true)
  t('элемент вне opened отвергается',
    /не объявлен в opened/.test(await boomAsync(
      () => handle.dispatching(dispatchInput('f'.repeat(64))),
    )), true)

  await handle.settled(settledInput(
    items[0], 'accepted', true, openedById.get(items[0]).sourceKey,
  ))
  t('повторный settled отвергается',
    /повторный settled/.test(await boomAsync(() => handle.settled(settledInput(
      items[0], 'rejected', true, openedById.get(items[0]).sourceKey,
    )))), true)

  t('закрытие при неурегулированных отвергается',
    /остались неотправленные либо неурегулированные/.test(
      await boomAsync(() => handle.close({ at: AT }))), true)

  const midway = await store.readJournal(ID)
  t('незакрытый журнал требует сверки', midway.state, 'needsReconciliation')
  t('и код возврата — сорок', midway.exitCode, EXIT_CODES.needsReconciliation)
  t('неотправленные посчитаны', midway.counts.notDispatched, TOTAL - 1)

  for (const id of items.slice(1)) {
    await dispatch(handle, id)
    await handle.settled(settledInput(id, 'accepted', true, openedById.get(id).sourceKey))
  }
  const summary = await handle.close({ at: AT })
  t('журнал закрыт', summary.state, 'closed')
  t('исход — всё принято', summary.outcome, 'allAccepted')
  t('код возврата нулевой', summary.exitCode, EXIT_CODES.allAccepted)
  t('сумма счётчиков равна числу элементов',
    COUNT_BUCKETS.reduce((sum, b) => sum + summary.counts[b], 0), TOTAL)
  t('окончательный срок — тридцать суток после закрытия либо предварительный',
    summary.deleteAfter,
    closedDeleteAfter({ openedDeleteAfter: openedRecord.payload.deleteAfter, closedAt: AT }))

  const reread = await store.readJournal(ID)
  t('перечитанный журнал даёт тот же итог', reread.outcome, 'allAccepted')
  t('дозаписи в закрытый журнал нет',
    /закрыт/.test(await boomAsync(() => resume(store, ID, { at: AT }))), true)

  /* ── Восстановление без плана и без разрешения ──────────────────────── */

  const secondApproval = buildModelApproval({
    plan: clone(PLAN), ...DECISION, approvalId: 'approval-второе', limits: clone(LIMITS),
  })
  const secondName = approvalFileName(secondApproval)
  await store.approvals.writeApprovalFile({ approval: clone(secondApproval), plan: clone(PLAN) })
  const second = await store.openJournal({ approvalFileName: secondName, plan: clone(PLAN), at: AT })
  const secondId = second.executionId
  const secondOpened = (await store.readJournal(secondId)).records[0].payload.items
  const secondById = new Map(secondOpened.map((item) => [item.requestItemId, item]))
  const secondItems = [...secondById.keys()]
  await dispatch(second, secondItems[0])
  await second.release({ at: AT, reason: 'needsReconciliation' })

  const interrupted = await store.readJournal(secondId)
  t('прерванный после отправки журнал требует сверки', interrupted.state, 'needsReconciliation')
  t('и неопределённый элемент посчитан', interrupted.counts.unknown, 1)

  /* Исходные артефакты удаляются: восстановление обязано работать и без них. */
  await rm(path.join(repoRoot, 'tmp', 'poi-model-approvals', secondName))
  t('освобождённая эпоха полномочия владельца не требует',
    (await store.readJournal(secondId)).appendability, 'open')
  t('а полномочие владельца у освобождённой эпохи отвергается',
    /не требуется и не принимается/.test(await boomAsync(async () => store.planResume({
      executionId: secondId, takeover: await takeoverFor(store, secondId, AT), at: AT,
    }))), true)
  const resumed = await resume(store, secondId, { at: AT })
  t('восстановление работает без файла разрешения и без плана', resumed.executionId, secondId)
  t('и идёт уже во второй эпохе', resumed.epoch, 2)
  t('прежний сегмент при этом не дописывается',
    resumed.path.endsWith(segmentName(JOURNAL_GENERATION, 2)), true)
  /* Потеря — не наблюдение исполнителя, а восстановленный вывод, поэтому
     сначала записывается свидетельство о списании, и только по нему грамматика
     пропускает терминальный «lost». */
  t('lost без свидетельства о списании отвергается',
    /только после свидетельства с вердиктом charged/.test(await boomAsync(() => resumed.settled(
      settledInput(secondItems[0], 'lost', true, secondById.get(secondItems[0]).sourceKey),
    ))), true)
  await resumed.reconciled({ evidence: evidenceFor(secondId, secondItems[0], 'charged'), at: AT })
  await resumed.settled(settledInput(
    secondItems[0], 'lost', true, secondById.get(secondItems[0]).sourceKey,
  ))
  for (const id of secondItems.slice(1)) {
    await dispatch(resumed, id)
    await resumed.settled(settledInput(id, 'accepted', true, secondById.get(id).sourceKey))
  }
  const lostSummary = await resumed.close({ at: AT })
  t('потеря даёт свой исход', lostSummary.outcome, 'withLoss')
  t('и свой код возврата', lostSummary.exitCode, EXIT_CODES.withLoss)
  t('потеря посчитана', lostSummary.counts.lost, 1)

  /* ── Прерывание до первой отправки ──────────────────────────────────── */

  const thirdApproval = buildModelApproval({
    plan: clone(PLAN), ...DECISION, approvalId: 'approval-третье', limits: clone(LIMITS),
  })
  const thirdName = approvalFileName(thirdApproval)
  await store.approvals.writeApprovalFile({ approval: clone(thirdApproval), plan: clone(PLAN) })
  const third = await store.openJournal({ approvalFileName: thirdName, plan: clone(PLAN), at: AT })
  await third.release({ at: AT, reason: 'handoff' })
  const beforeDispatch = await store.readJournal(third.executionId)
  t('прогон без единой отправки', beforeDispatch.state, 'interruptedBeforeDispatch')
  t('и он тоже не закрыт', beforeDispatch.exitCode, EXIT_CODES.needsReconciliation)
  const resumedThird = await resume(store, third.executionId, { at: AT })
  t('текущий close такой журнал не закрывает',
    /закрывает reconciliation/.test(await boomAsync(() => resumedThird.close({ at: AT }))), true)
  await resumedThird.release({ at: AT, reason: 'handoff' })

  /* ── Повреждения ────────────────────────────────────────────────────── */

  /* Повреждения проверяются на журнале ОДНОЙ эпохи: содержимое сегмента и
     границы между сегментами — разные вопросы, и смешивать их в одном
     наборе значило бы ловить второе, думая, что ловишь первое. */
  const damageApproval = buildModelApproval({
    plan: clone(PLAN), ...DECISION, approvalId: 'approval-повреждение', limits: clone(LIMITS),
  })
  await store.approvals.writeApprovalFile({ approval: clone(damageApproval), plan: clone(PLAN) })
  const damageHandle = await store.openJournal({
    approvalFileName: approvalFileName(damageApproval), plan: clone(PLAN), at: AT,
  })
  const corruptId = damageHandle.executionId
  for (const item of (await store.readJournal(corruptId)).records[0].payload.items) {
    await dispatch(damageHandle, item.requestItemId)
    await damageHandle.settled(settledInput(item.requestItemId, 'accepted', true, item.sourceKey))
  }
  await damageHandle.close({ at: AT })
  const journalFile = store.journalPath(corruptId)
  const original = await readFile(journalFile, 'utf8')

  const damage = async (text, label) => {
    await writeFile(journalFile, text, 'utf8')
    const before = await readFile(journalFile, 'utf8')
    const result = await store.readJournal(corruptId)
    const after = await readFile(journalFile, 'utf8')
    t(`${label} → journalCorrupt`, result.state, 'journalCorrupt')
    t(`${label}: код пятьдесят`, result.exitCode, EXIT_CODES.journalCorrupt)
    /* Читатель не чинит и не дописывает: байты до и после совпадают. */
    t(`${label}: файл не изменён`, after, before)
  }

  const lines = original.trim().split('\n')
  const signed = (record) => {
    const copy = clone(record)
    delete copy.recordDigest
    copy.recordDigest = {
      value: recordDigest(copy), algorithm: 'sha256', spec: EXECUTION_RECORD_SPEC,
    }
    return JSON.stringify(copy)
  }

  await damage('', 'пустой файл')
  await damage('{"частичная', 'только torn tail без единой полной записи')
  await damage(`${lines[0]}\nне json\n`, 'полная строка не JSON')
  await damage(`${lines[0]}\n${lines[2]}\n`, 'дыра в нумерации')
  await damage(`${lines[0]}\n${lines[1]}\n${lines[1]}\n`, 'повтор номера')
  await damage(`${lines[0]}\n${lines[0]}\n`, 'второй opened')

  /* Номер, сдвинутый при безупречных переходах и настоящей подписи. Дыру и
     повтор ловит грамматика переходов, а это — только нумерация. */
  const shifted = clone(JSON.parse(lines[1]))
  shifted.seq = 5
  await damage(`${lines[0]}\n${signed(shifted)}\n`, 'сдвинутый номер при верных переходах')

  const foreign = clone(JSON.parse(lines[1]))
  foreign.executionId = 'a'.repeat(64)
  await damage(`${lines[0]}\n${signed(foreign)}\n`, 'чужой executionId')

  const badDigest = clone(JSON.parse(lines[1]))
  badDigest.recordDigest.value = `sha256:${'0'.repeat(64)}`
  await damage(`${lines[0]}\n${JSON.stringify(badDigest)}\n`, 'подменённая подпись записи')

  /* Формально записанный `lost` без списания. Подпись у строки настоящая —
     поэтому единственный, кто обязан её отвергнуть, это семантика исхода.
     Молчаливое превращение такой записи в «неопределённость» открыло бы
     дорогу второму `settled` по тому же элементу. */
  const settledLine = JSON.parse(lines[3])
  const lostNoCharge = clone(settledLine)
  lostNoCharge.payload = { ...lostNoCharge.payload, outcome: 'lost', charged: false }
  await damage(
    `${lines[0]}\n${lines[1]}\n${lines[2]}\n${signed(lostNoCharge)}\n`, 'lost без charged',
  )

  /* Закрытие при неотправленных элементах, записанное в файл вручную. */
  const forgedClose = clone(JSON.parse(lines[0]))
  forgedClose.seq = 2
  forgedClose.type = 'closed'
  forgedClose.payload = {
    deleteAfter: closedDeleteAfter({
      openedDeleteAfter: JSON.parse(lines[0]).payload.deleteAfter, closedAt: AT,
    }),
    outcome: 'allAccepted',
    counts: Object.fromEntries(COUNT_BUCKETS.map((b) => [b, b === 'notDispatched' ? TOTAL : 0])),
  }
  await damage(`${lines[0]}\n${lines[1]}\n${signed(forgedClose)}\n`, 'closed при неотправленных')

  /* А вот torn tail после ЦЕЛОГО журнала повреждением не является. */
  await writeFile(journalFile, `${original}{"частичная`, 'utf8')
  const beforeTorn = await readFile(journalFile, 'utf8')
  const tornOk = await store.readJournal(corruptId)
  t('torn tail после целого журнала игнорируется', tornOk.state, 'closed')
  t('и файл при этом не тронут', await readFile(journalFile, 'utf8'), beforeTorn)

  await writeFile(journalFile, original, 'utf8')
  t('восстановленный файл снова читается', (await store.readJournal(corruptId)).state, 'closed')
  /* ── Порядок вызовов и непригодность ручки после отказа ─────────────── */

  /* Обёртка ВОКРУГ настоящего ввода-вывода: файлы создаются настоящие, а
     последовательность вызовов записывается. Подделки файловой системы
     здесь нет — иначе проверялась бы она, а не граница. */
  const trace = []
  const failAt = { sync: null, partialWrite: false }
  const spyIo = {
    open: async (target, flags) => {
      trace.push(`open:${flags}`)
      const real = await FILE_IO.open(target, flags)
      return {
        writeFile: async (...args) => {
          trace.push('write')
          if (failAt.partialWrite) {
            /* Настоящий дескриптор, настоящая запись — но только половина. */
            const [text, ...rest] = args
            await real.writeFile(text.slice(0, Math.max(1, Math.floor(text.length / 2))), ...rest)
            throw new Error('искусственный обрыв на середине строки')
          }
          return real.writeFile(...args)
        },
        sync: async () => {
          trace.push('sync')
          if (failAt.sync !== null && trace.filter((x) => x === 'sync').length === failAt.sync) {
            throw new Error('искусственный отказ sync после успешной записи')
          }
          return real.sync()
        },
        close: async () => { trace.push('close'); return real.close() },
      }
    },
    readFile: async (target) => FILE_IO.readFile(target),
    /* Fencing виден в журнале вызовов: `readdir` ищет чужую эпоху, `size` —
       изменение отсечённого сегмента. Обе обязаны стоять и до записи, и
       после её fsync. */
    readdir: async (dir) => { trace.push('readdir'); return FILE_IO.readdir(dir) },
    size: async (target) => { trace.push('size'); return FILE_IO.size(target) },
    syncDirectory: async (dir) => { trace.push('syncDir'); return FILE_IO.syncDirectory(dir) },
  }

  const spyRepo = await mkdtemp(path.join(tmpdir(), 'poi-spy-'))
  try {
    const spyStore = createArtifactStore({ repoRoot: spyRepo, io: spyIo })
    const spyApproval = buildModelApproval({
      plan: clone(PLAN), ...DECISION, approvalId: 'approval-порядок', limits: clone(LIMITS),
    })
    const spyName = approvalFileName(spyApproval)
    trace.length = 0
    await spyStore.approvals.writeApprovalFile({ approval: clone(spyApproval), plan: clone(PLAN) })
    t('разрешение: открыть exclusive → записать → синхронизировать файл → каталог',
      trace.join(','), 'open:wx,write,sync,syncDir,close')

    trace.length = 0
    const spyHandle = await spyStore.openJournal({
      approvalFileName: spyName, plan: clone(PLAN), at: AT,
    })
    t('журнал: открыть exclusive → записать → синхронизировать файл → каталог',
      trace.join(','), 'open:ax,write,sync,syncDir')

    const spyOpened = (await spyStore.readJournal(spyHandle.executionId)).records[0].payload.items
    const spyById = new Map(spyOpened.map((item) => [item.requestItemId, item]))
    const spyIds = [...spyById.keys()]
    trace.length = 0
    await dispatch(spyHandle, spyIds[0])
    t('подготовка и намерение: у каждой fencing → записать → синхронизировать → fencing',
      trace.join(','), 'readdir,write,sync,readdir,readdir,write,sync,readdir')
    t('и синхронизаций ровно две — по одной на запись',
      trace.filter((x) => x === 'sync').length, 2)

    /* Отказ синхронизации ПОСЛЕ успешной записи: файл уже содержит строку,
       память о ней не обновлена. Ручка обязана стать непригодной. */
    failAt.sync = trace.filter((x) => x === 'sync').length + 1
    const failed = await boomAsync(() => spyHandle.settled(settledInput(
      spyIds[0], 'accepted', true, spyById.get(spyIds[0]).sourceKey,
    )))
    failAt.sync = null
    t('отказ синхронизации виден вызывающему', /искусственный отказ sync/.test(failed), true)
    t('ручка помечена непригодной', spyHandle.poisoned(), true)
    for (const attempt of [
      () => dispatch(spyHandle, spyIds[1]),
      () => spyHandle.settled(settledInput(
        spyIds[0], 'accepted', true, spyById.get(spyIds[0]).sourceKey,
      )),
      () => spyHandle.close({ at: AT }),
    ]) {
      t('дальнейшая дозапись запрещена',
        /ручка непригодна/.test(await boomAsync(attempt)), true)
    }
    /* Продолжить можно ровно одним способом — перечитав файл. */
    /* Ручка отравлена, но эпоху она НЕ освободила: продолжить можно только
       по явному полномочию владельца. Это и есть разница между
       обнаружением коллизии и владением жизненным циклом. */
    t('без полномочия владельца продолжения нет',
      /принадлежит незакрытой эпохе/.test(await boomAsync(
        () => resume(spyStore, spyHandle.executionId, { at: AT }),
      )), true)
    const spyTakeover = await takeoverFor(spyStore, spyHandle.executionId, AT)
    t('полномочие несёт свой домен', spyTakeover.contractVersion, MODEL_TAKEOVER_SPEC)
    const recovered = await resume(spyStore, spyHandle.executionId, {
      takeover: spyTakeover, at: AT,
    })
    t('после перехвата работа продолжается', recovered.poisoned(), false)
    t('и идёт во второй эпохе', recovered.epoch, 2)
    trace.length = 0
    await recovered.release({ at: AT, reason: 'handoff' })
    t('fencing второй эпохи сверяет и чужую эпоху, и длину отсечённого сегмента',
      trace.join(','), 'readdir,size,write,sync,readdir,size,close')

    /* Частичная запись: обёртка пишет ЧАСТЬ строки настоящим дескриптором и
       падает. Файл остаётся с оборванным хвостом; дозапись приклеилась бы к
       нему и повредила журнал — восстановление обязано отказать, не тронув
       ни байта. */
    const partialApproval = buildModelApproval({
      plan: clone(PLAN), ...DECISION, approvalId: 'approval-обрыв', limits: clone(LIMITS),
    })
    await spyStore.approvals.writeApprovalFile({
      approval: clone(partialApproval), plan: clone(PLAN),
    })
    const partialHandle = await spyStore.openJournal({
      approvalFileName: approvalFileName(partialApproval), plan: clone(PLAN), at: AT,
    })
    const partialId = partialHandle.executionId
    const partialFile = spyStore.journalPath(partialId)
    const partialItems = (await spyStore.readJournal(partialId)).records[0].payload.items
      .map((i) => i.requestItemId)
    failAt.partialWrite = true
    const partialError = await boomAsync(() => dispatch(partialHandle, partialItems[0]))
    failAt.partialWrite = false
    t('частичная запись видна вызывающему', /обрыв на середине строки/.test(partialError), true)
    t('ручка после частичной записи отравлена', partialHandle.poisoned(), true)
    const tornBytes = await readFile(partialFile, 'utf8')
    t('файл действительно содержит оборванный хвост', tornBytes.endsWith('\n'), false)
    t('оборванный хвост делает владение неопределённым',
      (await spyStore.readJournal(partialId)).appendability, 'indeterminate')
    const resumeError = await boomAsync(() => resume(spyStore, partialId, { at: AT }))
    t('и без полномочия владельца продолжения нет',
      /принадлежит незакрытой эпохе/.test(resumeError), true)
    t('и файл при этом не изменён', await readFile(partialFile, 'utf8'), tornBytes)
    /* Дозаписи к оборванной строке больше не существует как операции: новая
       эпоха всегда создаёт НОВЫЙ файл, и приклеить строку к недописанной
       нечем. Прежний необратимый отказ исчезает вместе с причиной. */
    const partialResumed = await resume(spyStore, partialId, {
      takeover: await takeoverFor(spyStore, partialId, AT), at: AT,
    })
    t('перехват пишет в новый сегмент', partialResumed.epoch, 2)
    t('а оборванный сегмент не тронут', await readFile(partialFile, 'utf8'), tornBytes)
    await partialResumed.release({ at: AT, reason: 'handoff' })
    t('а чтение оборванный хвост по-прежнему игнорирует',
      (await spyStore.readJournal(partialId)).state, 'interruptedBeforeDispatch')
    t('и чтение файл тоже не изменило', await readFile(partialFile, 'utf8'), tornBytes)

    /* Строгая форма входа у методов ручки. */
    const fresh = await resume(spyStore, spyHandle.executionId, { at: AT })
    for (const kind of SPOILS) {
      t(`dispatching отвергает вход: ${kind}`,
        await boomAsync(() => fresh.dispatching(spoil(dispatchInput(spyIds[1]), kind)))
          !== '(без ошибки)', true)
    }
    await fresh.release({ at: AT, reason: 'handoff' })
  } finally {
    await rm(spyRepo, { recursive: true, force: true })
  }

  /* ── Все терминальные исходы и приоритеты между ними ────────────────── */

  /* Каждый исход исполняется через production-путь: отдельный approval,
     отдельный журнал, полный цикл до закрытия. Таблица исчерпывающая —
     шесть терминальных исходов и четыре исхода закрытия. */
  const runOutcomes = async (label, outcomes) => {
    const approval = buildModelApproval({
      plan: clone(PLAN), ...DECISION, approvalId: `approval-${label}`, limits: clone(LIMITS),
    })
    await store.approvals.writeApprovalFile({ approval: clone(approval), plan: clone(PLAN) })
    const journal = await store.openJournal({
      approvalFileName: approvalFileName(approval), plan: clone(PLAN), at: AT,
    })
    const outcomeItems = (await store.readJournal(journal.executionId)).records[0].payload.items
    for (const [index, item] of outcomeItems.entries()) {
      const outcome = outcomes[index % outcomes.length]
      await dispatch(journal, item.requestItemId)
      /* «lost» — единственный исход, который исполнитель не наблюдает: он
         восстанавливается сверкой и требует записанного свидетельства о
         списании. Здесь оно записывается тем же production-путём. */
      if (outcome === 'lost') {
        await journal.reconciled({
          evidence: evidenceFor(journal.executionId, item.requestItemId, 'charged'), at: AT,
        })
      }
      await journal.settled(settledInput(
        item.requestItemId, outcome, outcome !== 'skipped', item.sourceKey,
      ))
    }
    return journal.close({ at: AT })
  }

  for (const [outcome, expectedClosed, expectedCode] of [
    ['accepted', 'allAccepted', EXIT_CODES.allAccepted],
    ['rejected', 'withFailures', EXIT_CODES.failures],
    ['truncated', 'withFailures', EXIT_CODES.failures],
    ['failed', 'withFailures', EXIT_CODES.failures],
    ['skipped', 'withSkips', EXIT_CODES.skips],
    ['lost', 'withLoss', EXIT_CODES.withLoss],
  ]) {
    const result = await runOutcomes(outcome, [outcome])
    t(`исход ${outcome} → ${expectedClosed}`, result.outcome, expectedClosed)
    t(`и код ${expectedCode} для ${outcome}`, result.exitCode, expectedCode)
    t(`и счётчик ${outcome} равен числу элементов`, result.counts[outcome], TOTAL)
  }

  /* Смешанные наборы: приоритет lost над отказами, отказов над пропусками. */
  const mixedLoss = await runOutcomes('смесь-потеря', ['lost', 'rejected', 'skipped', 'accepted'])
  t('потеря сильнее отказа и пропуска', mixedLoss.outcome, 'withLoss')
  t('и код потери', mixedLoss.exitCode, EXIT_CODES.withLoss)
  const mixedFail = await runOutcomes('смесь-отказ', ['failed', 'skipped', 'accepted'])
  t('отказ сильнее пропуска', mixedFail.outcome, 'withFailures')
  t('и код отказа', mixedFail.exitCode, EXIT_CODES.failures)
  const mixedSkip = await runOutcomes('смесь-пропуск', ['skipped', 'accepted'])
  t('пропуск сильнее успеха', mixedSkip.outcome, 'withSkips')
  t('и код пропуска', mixedSkip.exitCode, EXIT_CODES.skips)

  /* Читаемый abortedBeforeDispatch. Текущий close его не пишет, но контракт
     читателя обязан его разбирать — иначе журнал, закрытый будущей
     reconciliation, старый читатель объявил бы повреждённым. */
  const abortedApproval = buildModelApproval({
    plan: clone(PLAN), ...DECISION, approvalId: 'approval-аборт', limits: clone(LIMITS),
  })
  await store.approvals.writeApprovalFile({ approval: clone(abortedApproval), plan: clone(PLAN) })
  const abortedHandle = await store.openJournal({
    approvalFileName: approvalFileName(abortedApproval), plan: clone(PLAN), at: AT,
  })
  const abortedId = abortedHandle.executionId
  await abortedHandle.release({ at: AT, reason: 'handoff' })
  const abortedFile = store.journalPath(abortedId)
  const abortedLines = (await readFile(abortedFile, 'utf8')).trim().split('\n')
  const abortedOpened = JSON.parse(abortedLines[0])
  const abortedClosed = {
    contractVersion: MODEL_EXECUTION_SPEC,
    seq: 2,
    at: AT,
    executionId: abortedId,
    type: 'closed',
    payload: {
      deleteAfter: closedDeleteAfter({
        openedDeleteAfter: abortedOpened.payload.deleteAfter, closedAt: AT,
      }),
      outcome: 'abortedBeforeDispatch',
      counts: Object.fromEntries(COUNT_BUCKETS.map(
        (b) => [b, b === 'notDispatched' ? abortedOpened.payload.items.length : 0],
      )),
    },
  }
  abortedClosed.recordDigest = {
    value: recordDigest(abortedClosed), algorithm: 'sha256', spec: EXECUTION_RECORD_SPEC,
  }
  await writeFile(abortedFile,
    `${abortedLines[0]}\n${abortedLines[1]}\n${JSON.stringify(abortedClosed)}\n`, 'utf8')
  const abortedRead = await store.readJournal(abortedId)
  t('abortedBeforeDispatch читается', abortedRead.state, 'closed')
  t('и даёт свой исход', abortedRead.outcome, 'abortedBeforeDispatch')
  t('и код двадцать', abortedRead.exitCode, EXIT_CODES.failures)
  t('и все элементы числятся неотправленными',
    abortedRead.counts.notDispatched, abortedOpened.payload.items.length)

  /* Тот же исход при ненулевых прочих счётчиках — повреждение. */
  const forgedAborted = clone(abortedClosed)
  delete forgedAborted.recordDigest
  forgedAborted.payload.counts.accepted = 1
  forgedAborted.recordDigest = {
    value: recordDigest(forgedAborted), algorithm: 'sha256', spec: EXECUTION_RECORD_SPEC,
  }
  await writeFile(abortedFile,
    `${abortedLines[0]}\n${abortedLines[1]}\n${JSON.stringify(forgedAborted)}\n`, 'utf8')
  t('abortedBeforeDispatch при ненулевых счётчиках — повреждение',
    (await store.readJournal(abortedId)).state, 'journalCorrupt')
  t('и восстановление называет его повреждённым, а не закрытым',
    /closed\.counts|closed\.outcome/.test(
      await boomAsync(() => resume(store, abortedId, { at: AT }))), true)

  /* ── `opened` проверяется по существу, а не только по форме ─────────── */

  /* После удаления плана журнал — единственная карта кандидатов. Принять её
     на слово значит доверять карте, которую никто не проверял: `opened`
     обязан сойтись сам с собой — идентичность кода, каждый `requestItemId`
     и подпись выборки, пересобранная из тех же элементов. */
  const openedOf = (mutate) => {
    const copy = clone(JSON.parse(lines[0]))
    delete copy.recordDigest
    mutate(copy.payload)
    copy.recordDigest = {
      value: recordDigest(copy), algorithm: 'sha256', spec: EXECUTION_RECORD_SPEC,
    }
    return JSON.stringify(copy)
  }
  for (const [label, mutate, pattern] of [
    ['ненастоящий commit', (p) => { p.codeIdentity = { commit: 'не-коммит', dirty: false } }, /commit/],
    ['нестроковый dirty', (p) => { p.codeIdentity = { commit: '0'.repeat(40), dirty: 'да' } }, /dirty/],
    ['грязное дерево', (p) => { p.codeIdentity = { commit: '0'.repeat(40), dirty: true } }, /dirty/],
    ['произвольный requestItemId', (p) => {
      p.items = p.items.map((item, i) => (i === 0 ? { ...item, requestItemId: 'a'.repeat(64) } : item))
      p.items.sort((x, y) => (x.portalId === y.portalId
        ? (x.requestItemId < y.requestItemId ? -1 : 1)
        : (x.portalId < y.portalId ? -1 : 1)))
    }, /requestItemId/],
    ['подменённый sourceKey', (p) => { p.items[0].sourceKey = 'чужой-ключ' }, /requestItemId/],
    ['произвольная подпись выборки',
      (p) => { p.selectionDigest = `sha256:${'9'.repeat(64)}` }, /selectionDigest/],
  ]) {
    await writeFile(journalFile, `${openedOf(mutate)}\n`, 'utf8')
    const result = await store.readJournal(corruptId)
    t(`opened: ${label} → journalCorrupt`, result.state, 'journalCorrupt')
    t(`opened: ${label} — отказ называет причину`, pattern.test(result.reason), true)
  }
  await writeFile(journalFile, original, 'utf8')
  t('исходный журнал снова читается', (await store.readJournal(corruptId)).state, 'closed')

  /* «Не удалось прочитать» не равно «прочитали и нашли повреждение».
     Системная ошибка и программный дефект journalCorrupt'ом не становятся:
     иначе недоступный журнал читался бы как повреждённый, и решение
     принималось бы по состоянию, которого никто не видел. */
  const beforeSystemProbe = await readFile(journalFile, 'utf8')
  const failingIo = (fail) => ({ ...FILE_IO, readFile: async () => { throw fail() } })
  for (const code of ['EIO', 'EACCES', 'EPERM']) {
    const failingStore = createArtifactStore({
      repoRoot,
      io: failingIo(() => Object.assign(
        new Error(`${code}: искусственный сбой ввода-вывода, read`),
        { code, errno: -5, syscall: 'read' },
      )),
    })
    t(`${code} не превращается в journalCorrupt`,
      new RegExp(`^${code}: искусственный сбой`).test(
        await boomAsync(() => failingStore.readJournal(corruptId)),
      ), true)
    t(`${code}: файл не тронут`, await readFile(journalFile, 'utf8'), beforeSystemProbe)
  }
  /* Самый частый класс программного дефекта в JavaScript — обычный
     `TypeError` из кода, который не проверяет то, чем пользуется. Здесь он
     возникает ВНЕ валидатора: чтение вернуло не строку, и разбор строк упал.
     Повреждением журнала это не является и вердиктом стать не имеет права. */
  t('обычный TypeError вне валидатора пробрасывается',
    /first argument must be of type string/.test(await boomAsync(() => createArtifactStore({
      repoRoot, io: { ...FILE_IO, readFile: async () => 42 },
    }).readJournal(corruptId))), true)
  t('и файл не тронут после него', await readFile(journalFile, 'utf8'), beforeSystemProbe)
  t('а нарушение контракта журнала по-прежнему вердикт, а не исключение',
    (await store.readJournal(corruptId)).state, 'closed')

  t('программная ошибка чтения тоже пробрасывается',
    /программный дефект в io/.test(await boomAsync(() => createArtifactStore({
      repoRoot, io: failingIo(() => new TypeError('программный дефект в io')),
    }).readJournal(corruptId))), true)
  t('и файл не тронут после программной ошибки',
    await readFile(journalFile, 'utf8'), beforeSystemProbe)


  /* ── Владение исполнением: эпохи, перехват, fencing, расщепление ────── */

  const newJournal = async (label) => {
    const approval = buildModelApproval({
      plan: clone(PLAN), ...DECISION, approvalId: `approval-${label}`, limits: clone(LIMITS),
    })
    await store.approvals.writeApprovalFile({ approval: clone(approval), plan: clone(PLAN) })
    const journal = await store.openJournal({
      approvalFileName: approvalFileName(approval), plan: clone(PLAN), at: AT,
    })
    const opened = (await store.readJournal(journal.executionId)).records[0].payload.items
    return { journal, id: journal.executionId, items: opened }
  }
  const segmentFile = (id, epoch) =>
    path.join(repoRoot, 'tmp', 'poi-model-executions', id, segmentName(JOURNAL_GENERATION, epoch))

  /* Контрпример владельца целиком: первый процесс УСПЕШНО записал и
     синхронизировал запись и остаётся жив; второй читает уже обновлённый
     журнал. Захватить эпоху он не имеет права ни при каком состоянии
     содержимого — только по явному полномочию владельца. */
  const alive = await newJournal('живой')
  await dispatch(alive.journal, alive.items[0].requestItemId)
  const seenByOther = await store.readJournal(alive.id)
  t('второй процесс видит уже записанную запись', seenByOther.counts.unknown, 1)
  t('и журнал числится за незакрытой эпохой', seenByOther.appendability, 'owned')
  t('бизнес-итог при этом обычный', seenByOther.state, 'needsReconciliation')
  t('второй процесс не может захватить исполнение',
    /принадлежит незакрытой эпохе 1/.test(
      await boomAsync(() => resume(store, alive.id, { at: AT })),
    ), true)

  const aliveTakeover = await takeoverFor(store, alive.id, AT)
  t('полномочие связано с точной длиной сегмента в БАЙТАХ',
    aliveTakeover.fromSegmentBytes,
    Buffer.byteLength(await readFile(segmentFile(alive.id, 1), 'utf8'), 'utf8'))
  t('и с подписью последней записи',
    aliveTakeover.fromRecordDigest,
    seenByOther.records[seenByOther.records.length - 1].recordDigest.value)
  t('а последняя запись — это dispatching после своей подготовки',
    seenByOther.records.map((record) => record.type).join(','),
    'opened,claimed,prepared,dispatching')
  const takenOver = await resume(store, alive.id, { takeover: aliveTakeover, at: AT })
  t('перехват открывает вторую эпоху', takenOver.epoch, 2)
  t('и пишет в отдельный файл', takenOver.path, segmentFile(alive.id, 2))

  /* Прежняя ручка ещё жива и её дескриптор открыт. Fencing обязан отрезать её
     ДО записи, а не после. */
  t('прежний владелец больше не пишет',
    /перехвачено эпохой 2/.test(await boomAsync(
      () => dispatch(alive.journal, alive.items[1].requestItemId),
    )), true)
  t('и его ручка отравлена навсегда', alive.journal.poisoned(), true)
  await takenOver.release({ at: AT, reason: 'handoff' })

  /* Тот же случай при СНЯТОМ предупредительном слое: байты прежнего владельца
     ложатся в отсечённый сегмент. Логическим журналом они не становятся — и
     молча не исчезают. */
  const firstSegment = segmentFile(alive.id, 1)
  const beforeOrphan = await readFile(firstSegment, 'utf8')
  const orphanRecord = clone(seenByOther.records[2])
  orphanRecord.seq = seenByOther.records.length
  orphanRecord.payload = {
    ...orphanRecord.payload, requestItemId: alive.items[1].requestItemId,
  }
  await writeFile(firstSegment, `${beforeOrphan}${signed(orphanRecord)}\n`, 'utf8')
  const forked = await store.readJournal(alive.id)
  t('запись за границей расщепляет журнал', forked.state, 'journalForked')
  t('и получает свой код возврата', forked.exitCode, EXIT_CODES.journalForked)
  t('код расщепления отличается от кода повреждения',
    forked.exitCode === EXIT_CODES.journalCorrupt, false)
  t('логический итог при расщеплении недоказуем', forked.counts, null)
  t('расщеплён ровно один сегмент', forked.fork.segments.length, 1)
  t('сироты посчитаны', forked.fork.totalOrphanRecords, 1)
  t('и названы номером', forked.fork.segments[0].firstOrphanSeq, seenByOther.records.length)
  t('и измерены в байтах',
    forked.fork.totalOrphanBytes, Buffer.byteLength(`${signed(orphanRecord)}\n`, 'utf8'))
  t('оборванных байтов пока нет', forked.fork.totalTornOrphanBytes, 0)
  t('и агрегаты сходятся с разбивкой',
    forked.fork.totalCompleteOrphanBytes + forked.fork.totalTornOrphanBytes,
    forked.fork.totalOrphanBytes)
  t('граница названа явно', forked.fork.segments[0].boundaryBytes, aliveTakeover.fromSegmentBytes)
  t('расщеплённый журнал дозаписи не принимает',
    /журнал расщеплён/.test(await boomAsync(() => resume(store, alive.id, { at: AT }))), true)
  t('и полномочия на него не выдаются',
    /расщеплён/.test(await boomAsync(() => store.takeoverBinding(alive.id))), true)

  /* Оборванный хвост за границей — тоже сирота, и считается отдельно. */
  await writeFile(firstSegment, `${beforeOrphan}${signed(orphanRecord)}\n{"обрыв`, 'utf8')
  const forkedTorn = await store.readJournal(alive.id)
  t('оборванный хвост за границей учтён',
    forkedTorn.fork.totalTornOrphanBytes, Buffer.byteLength('{"обрыв', 'utf8'))
  t('и в общий счёт сиротских байтов он тоже входит',
    forkedTorn.fork.totalOrphanBytes,
    forkedTorn.fork.totalTornOrphanBytes + Buffer.byteLength(`${signed(orphanRecord)}\n`, 'utf8'))
  t('а число ПОЛНЫХ сиротских записей от обрывка не растёт',
    forkedTorn.fork.totalOrphanRecords, 1)

  /* Только обрывок за границей: полных сирот нет, номера назвать нечем. */
  await writeFile(firstSegment, `${beforeOrphan}{"обрыв`, 'utf8')
  const forkedOnlyTorn = await store.readJournal(alive.id)
  t('один обрывок за границей — тоже расщепление', forkedOnlyTorn.state, 'journalForked')
  t('и номера сироты у него нет', forkedOnlyTorn.fork.segments[0].firstOrphanSeq, null)
  await writeFile(firstSegment, beforeOrphan, 'utf8')
  t('восстановленный сегмент снова читается',
    (await store.readJournal(alive.id)).state, 'needsReconciliation')

  /* Существование сегмента резервирует эпоху НЕМЕДЛЕННО. Пустой файл не
     доказывает смерти своего создателя, и пропустить его нельзя. */
  const reserved = await newJournal('резерв')
  await reserved.journal.release({ at: AT, reason: 'handoff' })
  await writeFile(segmentFile(reserved.id, 2), '', 'utf8')
  const indeterminate = await store.readJournal(reserved.id)
  t('пустой сегмент делает владение неопределённым',
    indeterminate.appendability, 'indeterminate')
  t('и называет причину', indeterminate.appendabilityReason, 'ownershipIndeterminate')
  t('и перечисляет незавершённые сегменты',
    indeterminate.pendingSegments.map((s) => s.name).join(','),
    segmentName(JOURNAL_GENERATION, 2))
  t('бизнес-итог протокольным условием не подменяется',
    indeterminate.state, 'interruptedBeforeDispatch')
  t('и его код тоже прежний', indeterminate.exitCode, EXIT_CODES.needsReconciliation)
  t('пустой сегмент не пропускается автоматически',
    /принадлежит незакрытой эпохе/.test(
      await boomAsync(() => resume(store, reserved.id, { at: AT })),
    ), true)

  const reservedTakeover = await takeoverFor(store, reserved.id, AT)
  t('полномочие называет незавершённый сегмент по имени',
    reservedTakeover.supersededSegments[0].name, segmentName(JOURNAL_GENERATION, 2))
  t('и по длине', reservedTakeover.supersededSegments[0].bytes, 0)
  t('и по сырому отпечатку сегмента',
    reservedTakeover.supersededSegments[0].rawDigest.startsWith('sha256:'), true)

  /* Создатель пустого сегмента дописал его после того, как владелец подписал
     полномочие. Полномочие описывает уже не те байты — и не действует. */
  await writeFile(segmentFile(reserved.id, 2), '{"дописано позже', 'utf8')
  t('дописанный незавершённый сегмент делает полномочие недействительным',
    /состояние сегментов изменилось|supersededSegments/.test(await boomAsync(
      () => resume(store, reserved.id, { takeover: reservedTakeover, at: AT }),
    )), true)
  await writeFile(segmentFile(reserved.id, 2), '', 'utf8')
  const superseded = await resume(store, reserved.id, { takeover: reservedTakeover, at: AT })
  t('перехват поверх незавершённой эпохи открывает следующую', superseded.epoch, 3)
  await superseded.release({ at: AT, reason: 'handoff' })

  /* `EEXIST` — отказ и только отказ: номер не пересчитывается. */
  const raced = await newJournal('гонка')
  await raced.journal.release({ at: AT, reason: 'handoff' })
  const renamedRaceId = raced.id
  const occupied = await newJournal('занято')
  await occupied.journal.release({ at: AT, reason: 'handoff' })
  const occupiedPlan = await store.planResume({ executionId: occupied.id, takeover: null, at: AT })
  await writeFile(segmentFile(occupied.id, 2), '', 'utf8')
  t('появившийся сегмент делает план недействительным',
    /состояние сегментов изменилось/.test(
      await boomAsync(() => store.resumeJournal({ plan: occupiedPlan })),
    ), true)
  t('и следующего сегмента при этом не создано',
    existsSync(segmentFile(occupied.id, 3)), false)
  /* Гонку за само имя выигрывает `ax`, и её исход — отказ, а не следующий
     номер. Настоящая гонка невоспроизводима, поэтому отказ создания
     предъявляется напрямую. */
  const eexistStore = createArtifactStore({
    repoRoot,
    io: {
      ...FILE_IO,
      open: async (target, flags) => {
        if (flags === 'ax' && target.endsWith(segmentName(JOURNAL_GENERATION, 2))) {
          const error = new Error('EEXIST: file already exists')
          error.code = 'EEXIST'
          throw error
        }
        return FILE_IO.open(target, flags)
      },
    },
  })
  const racedPlan = await eexistStore.planResume({
    executionId: renamedRaceId, takeover: null, at: AT,
  })
  t('занятая эпоха не обходится следующим номером',
    /уже занята/.test(await boomAsync(() => eexistStore.resumeJournal({ plan: racedPlan }))), true)
  t('и номер не пересчитывается',
    existsSync(segmentFile(renamedRaceId, 3)), false)

  /* Разрыв в нумерации эпох. */
  const gapped = await newJournal('разрыв')
  await gapped.journal.release({ at: AT, reason: 'handoff' })
  await writeFile(segmentFile(gapped.id, 3), '', 'utf8')
  t('разрыв в нумерации эпох — отказ',
    (await store.readJournal(gapped.id)).state, 'journalCorrupt')
  t('и он назван прямо',
    /номера эпох обязаны быть непрерывными/.test((await store.readJournal(gapped.id)).reason), true)

  /* Неканоническое имя и посторонний файл в каталоге исполнения. */
  const strayed = await newJournal('посторонний')
  await strayed.journal.release({ at: AT, reason: 'handoff' })
  const strayFile = path.join(
    repoRoot, 'tmp', 'poi-model-executions', strayed.id, 'journal.g1.e02.jsonl',
  )
  await writeFile(strayFile, '', 'utf8')
  t('имя эпохи с ведущим нулём — отказ, а не пропуск',
    /неожиданный файл/.test((await store.readJournal(strayed.id)).reason), true)
  await writeFile(strayFile, '', 'utf8')
  await rm(strayFile)
  await writeFile(
    path.join(repoRoot, 'tmp', 'poi-model-executions', strayed.id, 'заметка.txt'), 'x', 'utf8',
  )
  t('посторонний файл в каталоге исполнения — тоже отказ',
    /неожиданный файл/.test((await store.readJournal(strayed.id)).reason), true)
  await rm(path.join(repoRoot, 'tmp', 'poi-model-executions', strayed.id, 'заметка.txt'))
  t('а отчёт исполнения посторонним не считается', await (async () => {
    await writeFile(
      path.join(repoRoot, 'tmp', 'poi-model-executions', strayed.id, 'report.json'), '{}', 'utf8',
    )
    const read = await store.readJournal(strayed.id)
    return read.state
  })(), 'interruptedBeforeDispatch')

  /* Переименование сегмента меняет порядок эпох, не меняя ни одной подписи —
     поэтому имя сверяется с содержимым. */
  const renamed = await newJournal('переименование')
  await renamed.journal.release({ at: AT, reason: 'handoff' })
  const renamedSecond = await resume(store, renamed.id, { at: AT })
  await renamedSecond.release({ at: AT, reason: 'handoff' })
  const secondText = await readFile(segmentFile(renamed.id, 2), 'utf8')
  await writeFile(segmentFile(renamed.id, 3), secondText, 'utf8')
  await rm(segmentFile(renamed.id, 2))
  t('переименованный сегмент не сходится с собственным содержимым',
    (await store.readJournal(renamed.id)).state, 'journalCorrupt')
  await writeFile(segmentFile(renamed.id, 2), secondText, 'utf8')
  await rm(segmentFile(renamed.id, 3))
  t('и на месте он снова читается',
    (await store.readJournal(renamed.id)).state, 'interruptedBeforeDispatch')

  /* Запись, ПЕРЕСЕКАЮЩАЯ границу: на момент захвата не хватало только
     перевода строки, и прежний владелец дописал его позже. Целиком внутри
     границы она не помещается — значит, логическим журналом не является. */
  const straddle = await newJournal('пересечение')
  await dispatch(straddle.journal, straddle.items[0].requestItemId)
  const straddleFile = segmentFile(straddle.id, 1)
  const straddleRecords = (await store.readJournal(straddle.id)).records
  const straddleNext = clone(straddleRecords[straddleRecords.length - 1])
  straddleNext.seq = straddleRecords.length
  straddleNext.payload = {
    ...straddleNext.payload, requestItemId: straddle.items[1].requestItemId,
  }
  const straddleLine = signed(straddleNext)
  const straddleBase = await readFile(straddleFile, 'utf8')
  await writeFile(straddleFile, `${straddleBase}${straddleLine}`, 'utf8')
  t('недописанная строка делает владение неопределённым',
    (await store.readJournal(straddle.id)).appendability, 'indeterminate')
  const straddleTakeover = await takeoverFor(store, straddle.id, AT)
  t('граница включает недописанные байты',
    straddleTakeover.fromSegmentBytes,
    Buffer.byteLength(`${straddleBase}${straddleLine}`, 'utf8'))
  const straddleHandle = await resume(store, straddle.id, {
    takeover: straddleTakeover, at: AT,
  })
  await straddleHandle.release({ at: AT, reason: 'handoff' })
  await writeFile(straddleFile, `${straddleBase}${straddleLine}\n`, 'utf8')
  const straddled = await store.readJournal(straddle.id)
  t('дописанный перевод строки не втягивает запись в журнал',
    straddled.state, 'journalForked')
  t('и она названа сиротой', straddled.fork.totalOrphanRecords, 1)
  t('и сиротских байтов ровно один', straddled.fork.totalOrphanBytes, 1)
  t('и это не оборванный хвост', straddled.fork.totalTornOrphanBytes, 0)

  /* Одно исполнение — одно поколение.

     Контрпример стал ДОСТИЖИМ только теперь: пока поколение было одно, имя
     сегмента другого поколения просто не разбиралось, и проверка «сегменты
     разных поколений» никакой мутацией не роняла набор. С появлением g2
     каталог, где рядом лежат journal.g1.e1 и journal.g2.e2, — законно
     разбираемый и потому обязан быть отвергнут явно: иначе часть эпох
     читалась бы одной грамматикой, часть другой, и вердикт о деньгах зависел
     бы от того, с какого сегмента начали. */
  const mixedRepo = await mkdtemp(path.join(tmpdir(), 'poi-mixed-'))
  try {
    const mixedStore = createArtifactStore({ repoRoot: mixedRepo })
    const mixed = await newJournal('поколения-рядом')
    await mixed.journal.release({ at: AT, reason: 'handoff' })
    const mixedDir = path.join(mixedRepo, 'tmp', 'poi-model-executions', mixed.id)
    mkdirSync(mixedDir, { recursive: true })
    const mixedBody = await readFile(segmentFile(mixed.id, 1), 'utf8')
    await writeFile(path.join(mixedDir, segmentName('g2', 1)), mixedBody, 'utf8')
    const mixedOnly = await mixedStore.readJournal(mixed.id)
    t('один сегмент одного поколения читается', mixedOnly.protocol, 'g2')
    await writeFile(path.join(mixedDir, segmentName('g1', 2)), mixedBody, 'utf8')
    const mixedRead = await mixedStore.readJournal(mixed.id)
    t('сегменты разных поколений в одном исполнении — повреждение',
      mixedRead.state, 'journalCorrupt')
    t('и отказ называет именно поколения',
      /сегменты разных поколений \(g1, g2\)/.test(mixedRead.reason), true)
    t('и бизнес-итог из такого каталога не выводится', mixedRead.outcome, null)
    t('и дозаписи по нему нет', mixedRead.appendability, 'readOnly')
  } finally {
    await rm(mixedRepo, { recursive: true, force: true })
  }

  /* Имя сегмента объявляет поколение формата, запись `claimed` его
     подписывает. Расхождение — отказ с точным диагнозом, а не общий «неизвестное
     поколение»: иначе переименование файла и опечатка в записи давали бы один
     ответ на два разных вопроса. */
  const mismatched = await newJournal('поколение')
  await mismatched.journal.release({ at: AT, reason: 'handoff' })
  const mismatchedFile = segmentFile(mismatched.id, 1)
  const mismatchedLines = (await readFile(mismatchedFile, 'utf8')).trim().split('\n')
  const mismatchedClaim = clone(JSON.parse(mismatchedLines[1]))
  mismatchedClaim.payload = { ...mismatchedClaim.payload, generation: 'g1' }
  await writeFile(mismatchedFile, `${mismatchedLines[0]}\n${signed(mismatchedClaim)}\n`
    + `${mismatchedLines.slice(2).join('\n')}\n`, 'utf8')
  const mismatchedRead = await store.readJournal(mismatched.id)
  t('поколение в записи сверяется с именем сегмента', mismatchedRead.state, 'journalCorrupt')
  t('и отказ называет именно это расхождение',
    /не совпадает с именем сегмента/.test(mismatchedRead.reason), true)

  /* Перешагнутый сегмент, переписанный ТОЙ ЖЕ длиной: свидетельство, которое
     видел владелец, уничтожено, и длина этого не показывает. */
  const rewritten = await newJournal('подмена')
  await rewritten.journal.release({ at: AT, reason: 'handoff' })
  await writeFile(segmentFile(rewritten.id, 2), '{"обрыв', 'utf8')
  const rewrittenTakeover = await takeoverFor(store, rewritten.id, AT)
  const rewrittenHandle = await resume(store, rewritten.id, {
    takeover: rewrittenTakeover, at: AT,
  })
  await rewrittenHandle.release({ at: AT, reason: 'handoff' })
  t('перешагнутый сегмент на месте — журнал читается',
    (await store.readJournal(rewritten.id)).state, 'interruptedBeforeDispatch')
  await writeFile(segmentFile(rewritten.id, 2), '{"друго', 'utf8')
  const rewrittenRead = await store.readJournal(rewritten.id)
  t('подмена перешагнутого сегмента той же длиной — повреждение',
    rewrittenRead.state, 'journalCorrupt')
  t('и отказ называет отпечаток префикса перешагнутого сегмента',
    /отпечаток префикса .* перешагнутого сегмента/.test(rewrittenRead.reason), true)

  /* Незавершённая инициализация: имя уже называет поколение, подписи
     протокола ещё нет. Это НЕ прежний формат и не повреждение. */
  const halfRepo = await mkdtemp(path.join(tmpdir(), 'poi-half-'))
  const legacyRepo = await mkdtemp(path.join(tmpdir(), 'poi-legacy-'))
  try {
    const half = await newJournal('половина')
    const halfLines = (await readFile(segmentFile(half.id, 1), 'utf8')).trim().split('\n')
    const halfStore = createArtifactStore({ repoRoot: halfRepo })
    mkdirSync(path.join(halfRepo, 'tmp', 'poi-model-executions', half.id), { recursive: true })
    await writeFile(
      path.join(halfRepo, 'tmp', 'poi-model-executions', half.id,
        segmentName(JOURNAL_GENERATION, 1)),
      `${halfLines[0]}\n`, 'utf8',
    )
    const halfRead = await halfStore.readJournal(half.id)
    t('сегмент без claimed — незавершённая инициализация, а не прежний формат',
      halfRead.appendabilityReason, 'protocolInitializationIncomplete')
    t('и протокол у него всё-таки поколение сегмента',
      halfRead.protocol, JOURNAL_GENERATION)
    t('и бизнес-итог считается как обычно', halfRead.state, 'interruptedBeforeDispatch')
    t('и дозаписи без полномочия владельца нет',
      /принадлежит незакрытой эпохе/.test(
        await boomAsync(() => resume(halfStore, half.id, { at: AT })),
      ), true)
    const halfResumed = await resume(halfStore, half.id, {
      takeover: await takeoverFor(halfStore, half.id, AT), at: AT,
    })
    t('а по полномочию — открывается вторая эпоха', halfResumed.epoch, 2)
    await halfResumed.release({ at: AT, reason: 'handoff' })

    /* Прежний формат: тот же журнал без записи протокола и с прежним именем
       файла. Бизнес-итог обязан остаться прежним до последнего поля. */
    const legacySource = await newJournal('прежний-формат')
    for (const item of legacySource.items) {
      await dispatch(legacySource.journal, item.requestItemId)
      await legacySource.journal.settled(
        settledInput(item.requestItemId, 'accepted', true, item.sourceKey),
      )
    }
    const legacyClosed = await legacySource.journal.close({ at: AT })
    const legacyLines = (await readFile(segmentFile(legacySource.id, 1), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line))
    let legacySeq = 0
    /* Из журнала выбрасываются ОБЕ записи, которых прежний формат не знает:
       `claimed` — протокол владения, `prepared` — поколение g2. Оставить их
       значило бы проверять не «прежний журнал читается по-прежнему», а
       «новый журнал под старым именем». */
    const legacyText = legacyLines.filter(
      (record) => record.type !== 'claimed' && record.type !== 'prepared',
    ).map((record) => {
      const copy = clone(record)
      copy.seq = legacySeq
      legacySeq += 1
      return signed(copy)
    }).join('\n')
    const legacyStore = createArtifactStore({ repoRoot: legacyRepo })
    mkdirSync(path.join(legacyRepo, 'tmp', 'poi-model-executions', legacySource.id),
      { recursive: true })
    await writeFile(
      path.join(legacyRepo, 'tmp', 'poi-model-executions', legacySource.id,
        LEGACY_JOURNAL_FILE_NAME),
      `${legacyText}\n`, 'utf8',
    )
    const legacyRead = await legacyStore.readJournal(legacySource.id)
    t('журнал прежнего формата читается', legacyRead.protocol, 'preProtocol')
    t('и его состояние прежнее', legacyRead.state, legacyClosed.state)
    t('и исход прежний', legacyRead.outcome, legacyClosed.outcome)
    t('и код возврата прежний', legacyRead.exitCode, legacyClosed.exitCode)
    t('и счётчики прежние',
      JSON.stringify(legacyRead.counts), JSON.stringify(legacyClosed.counts))
    t('нового кода возврата у прежнего формата нет',
      legacyRead.exitCode === EXIT_CODES.journalForked, false)
    t('но дозаписи он не принимает', legacyRead.appendability, 'readOnly')
    t('и причина у readOnly не заполняется', legacyRead.appendabilityReason, null)
    t('и захват эпохи по нему невозможен',
      /прежнего формата/.test(await boomAsync(() => resume(legacyStore, legacySource.id, { at: AT }))),
      true)

    /* Прежний формат рядом с сегментами — каталог собран не одним кодом. */
    await writeFile(
      path.join(legacyRepo, 'tmp', 'poi-model-executions', legacySource.id,
        segmentName(JOURNAL_GENERATION, 1)),
      `${legacyText}\n`, 'utf8',
    )
    t('прежний формат рядом с сегментами — отказ',
      /собран не одним кодом/.test((await legacyStore.readJournal(legacySource.id)).reason), true)
  } finally {
    await rm(halfRepo, { recursive: true, force: true })
    await rm(legacyRepo, { recursive: true, force: true })
  }

  /* ── План захвата непрозрачен и одноразов ─────────────────────────────── */

  const opaque = await newJournal('непрозрачность')
  await opaque.journal.release({ at: AT, reason: 'handoff' })
  const opaquePlan = await store.planResume({ executionId: opaque.id, takeover: null, at: AT })
  t('клон плана отвергается до открытия файла',
    /не выдан этим хранилищем/.test(await boomAsync(
      () => store.resumeJournal({ plan: { ...opaquePlan } }),
    )), true)
  t('и план с подменённым именем сегмента тоже',
    /не выдан этим хранилищем/.test(await boomAsync(() => store.resumeJournal({
      plan: { ...opaquePlan, segment: '../../../escape.jsonl' },
    }))), true)
  t('и наружу ничего не создано',
    existsSync(path.join(repoRoot, 'tmp', 'escape.jsonl'))
      || existsSync(path.join(repoRoot, 'escape.jsonl')), false)
  const otherStore = createArtifactStore({ repoRoot })
  t('план другого экземпляра хранилища отвергается',
    /не выдан этим хранилищем/.test(await boomAsync(
      () => otherStore.resumeJournal({ plan: opaquePlan }),
    )), true)
  const opaqueHandle = await store.resumeJournal({ plan: opaquePlan })
  t('свой план срабатывает', opaqueHandle.epoch, 2)
  await opaqueHandle.release({ at: AT, reason: 'handoff' })
  t('повторное использование того же плана отвергается',
    /уже использован/.test(await boomAsync(() => store.resumeJournal({ plan: opaquePlan }))), true)
  /* Проверка канонического имени и вложенности в `resumeJournal` остаётся
     вторым рубежом: подложить объект в приватный реестр нечем, поэтому её
     контрпример через публичный интерфейс недостижим, и тестом она здесь не
     закрыта. Это сказано вслух, а не оставлено выглядеть проверенным. */

  /* ── Полномочие связано с точными байтами хвоста и с временем ─────────── */

  const rawBound = await newJournal('сырой-хвост')
  await dispatch(rawBound.journal, rawBound.items[0].requestItemId)
  const rawFile = segmentFile(rawBound.id, 1)
  const rawBase = await readFile(rawFile, 'utf8')
  await writeFile(rawFile, `${rawBase}{"alpha`, 'utf8')
  const rawTakeover = await takeoverFor(store, rawBound.id, AT)
  t('полномочие несёт отпечаток точного префикса',
    rawTakeover.fromSegmentRawDigest.startsWith('sha256:'), true)
  await writeFile(rawFile, `${rawBase}{"bravo`, 'utf8')
  t('переписанный равной длиной хвост делает полномочие недействительным',
    /fromSegmentRawDigest/.test(await boomAsync(
      () => resume(store, rawBound.id, { takeover: rawTakeover, at: AT }),
    )), true)
  await writeFile(rawFile, `${rawBase}{"alpha`, 'utf8')
  const rawResumed = await resume(store, rawBound.id, { takeover: rawTakeover, at: AT })
  t('а с теми же байтами захват проходит', rawResumed.epoch, 2)
  await rawResumed.release({ at: AT, reason: 'handoff' })
  /* Тот же приём УЖЕ ПОСЛЕ захвата: длина отсечённого сегмента не изменилась,
     подписи записей целы, а байты внутри границы другие. Поймать это может
     только отпечаток префикса. */
  await writeFile(rawFile, `${rawBase}{"bravo`, 'utf8')
  const rawRewritten = await store.readJournal(rawBound.id)
  t('подмена байтов внутри границы равной длиной — повреждение',
    rawRewritten.state, 'journalCorrupt')
  t('и отказ называет отпечаток префикса',
    /отпечаток префикса/.test(rawRewritten.reason), true)
  t('и расщеплением это не называется', rawRewritten.fork, null)
  await writeFile(rawFile, `${rawBase}{"alpha`, 'utf8')
  t('возвращённые байты снова читаются',
    (await store.readJournal(rawBound.id)).state, 'needsReconciliation')

  const timed = await newJournal('время-перехвата')
  await dispatch(timed.journal, timed.items[0].requestItemId)
  const earlyTakeover = buildTakeover({
    ...(await store.takeoverBinding(timed.id)),
    grounds: 'processExited',
    observedAt: '2026-08-12T00:00:00.000Z',
    decisionRef: 'owner/2026-08-12',
    approver: 'owner',
  })
  t('наблюдение раньше последней записи отвергается',
    /раньше последней записи/.test(await boomAsync(
      () => resume(store, timed.id, { takeover: earlyTakeover, at: AT }),
    )), true)
  const lateTakeover = buildTakeover({
    ...(await store.takeoverBinding(timed.id)),
    grounds: 'processExited',
    observedAt: '2026-08-15T00:00:00.000Z',
    decisionRef: 'owner/2026-08-15',
    approver: 'owner',
  })
  t('наблюдение позже самого захвата отвергается',
    /позже самого захвата/.test(await boomAsync(
      () => resume(store, timed.id, { takeover: lateTakeover, at: AT }),
    )), true)
  const timelyHandle = await resume(store, timed.id, {
    takeover: lateTakeover, at: '2026-08-15T00:00:00.000Z',
  })
  t('а наблюдение между хвостом и захватом принимается', timelyHandle.epoch, 2)
  await timelyHandle.release({ at: '2026-08-15T00:00:00.000Z', reason: 'handoff' })

  /* ── Номер эпохи связан с именем физического сегмента ─────────────────── */

  const packed = await newJournal('склейка')
  await packed.journal.release({ at: AT, reason: 'handoff' })
  const packedSecond = await resume(store, packed.id, { at: AT })
  await packedSecond.release({ at: AT, reason: 'handoff' })
  const packedThird = await resume(store, packed.id, { at: AT })
  await packedThird.release({ at: AT, reason: 'handoff' })
  const packedE2 = await readFile(segmentFile(packed.id, 2), 'utf8')
  const packedE3 = await readFile(segmentFile(packed.id, 3), 'utf8')
  await writeFile(segmentFile(packed.id, 2), `${packedE2}${packedE3}`, 'utf8')
  await rm(segmentFile(packed.id, 3))
  const packedRead = await store.readJournal(packed.id)
  t('две записи claimed в одном сегменте — повреждение', packedRead.state, 'journalCorrupt')
  t('и отказ называет их число',
    /записей claimed в сегменте 2/.test(packedRead.reason), true)
  await writeFile(segmentFile(packed.id, 2), packedE2, 'utf8')
  await writeFile(segmentFile(packed.id, 3), packedE3, 'utf8')
  t('разложенные обратно сегменты снова читаются',
    (await store.readJournal(packed.id)).state, 'interruptedBeforeDispatch')
  await writeFile(segmentFile(packed.id, 3), packedE2, 'utf8')
  const swapped = await store.readJournal(packed.id)
  t('эпоха из чужого сегмента не сходится с именем файла', swapped.state, 'journalCorrupt')
  t('и отказ называет именно это',
    /не совпадает с именем сегмента|отпечаток префикса/.test(swapped.reason), true)

  /* ── Расщеплений может быть несколько ─────────────────────────────────── */

  const many = await newJournal('много-сирот')
  await many.journal.release({ at: AT, reason: 'handoff' })
  const manySecond = await resume(store, many.id, { at: AT })
  await manySecond.release({ at: AT, reason: 'handoff' })
  const manyThird = await resume(store, many.id, { at: AT })
  await manyThird.release({ at: AT, reason: 'handoff' })
  const tailA = '{"сирота-один'
  const tailB = '{"сирота-два-длиннее'
  await writeFile(segmentFile(many.id, 1),
    `${await readFile(segmentFile(many.id, 1), 'utf8')}${tailA}`, 'utf8')
  await writeFile(segmentFile(many.id, 2),
    `${await readFile(segmentFile(many.id, 2), 'utf8')}${tailB}`, 'utf8')
  const manyForked = await store.readJournal(many.id)
  t('расщеплены оба сегмента', manyForked.fork.segments.length, 2)
  t('и они перечислены по возрастанию эпох',
    manyForked.fork.segments.map((entry) => entry.epoch).join(','), '1,2')
  t('и агрегат считает все сиротские байты, а не первые',
    manyForked.fork.totalOrphanBytes,
    Buffer.byteLength(tailA, 'utf8') + Buffer.byteLength(tailB, 'utf8'))
  t('и все они оборванные', manyForked.fork.totalTornOrphanBytes,
    manyForked.fork.totalOrphanBytes)
  t('и полных сиротских записей нет', manyForked.fork.totalOrphanRecords, 0)
  t('и агрегаты сходятся с разбивкой',
    manyForked.fork.segments.reduce((sum, entry) => sum + entry.orphanBytes, 0),
    manyForked.fork.totalOrphanBytes)

  /* ── Перешагнутый сегмент не возвращается в цепочку дозаписью ─────────── */

  const revived = await newJournal('оживление')
  await revived.journal.release({ at: AT, reason: 'handoff' })
  /* Резервирование с оборванным хвостом: у него есть подписанный префикс, и
     подменить его незаметно нельзя. Обрыв здесь настоящий — недописанная
     строка, которую прежний владелец позже дописал бы до конца. */
  const revivedFullLine = await (async () => {
    const source = (await readFile(segmentFile(revived.id, 1), 'utf8')).trim().split('\n')
    const record = clone(JSON.parse(source[1]))
    record.payload = { ...record.payload, epoch: 2, supersededSegments: [] }
    return signed(record)
  })()
  const revivedReservation = revivedFullLine.slice(0, 12)
  await writeFile(segmentFile(revived.id, 2), revivedReservation, 'utf8')
  const revivedTakeover = await takeoverFor(store, revived.id, AT)
  const revivedThird = await resume(store, revived.id, { takeover: revivedTakeover, at: AT })
  t('перехват поверх резервирования открыл третью эпоху', revivedThird.epoch, 3)
  await revivedThird.release({ at: AT, reason: 'handoff' })
  /* Прежний владелец дописывает строку до конца УЖЕ в перешагнутом сегменте.
     Эпохой это не становится: решать, кто в цепочке, по наличию полной строки
     значило бы отдавать решение тому, кого уже отрезали. */
  await writeFile(segmentFile(revived.id, 2), `${revivedFullLine}\n`, 'utf8')
  const revivedRead = await store.readJournal(revived.id)
  t('дозапись в перешагнутый сегмент — расщепление, а не повреждение',
    revivedRead.state, 'journalForked')
  t('и сегмент назван', revivedRead.fork.segments[0].name, segmentName(JOURNAL_GENERATION, 2))
  t('и граница у него — длина резервирования',
    revivedRead.fork.segments[0].boundaryBytes,
    Buffer.byteLength(revivedReservation, 'utf8'))
  t('и сирота посчитана', revivedRead.fork.totalOrphanRecords, 1)
  t('и её номер назван настоящим',
    revivedRead.fork.segments[0].firstOrphanSeq, JSON.parse(revivedFullLine).seq)
  t('и оборванных байтов у неё нет', revivedRead.fork.totalTornOrphanBytes, 0)

  /* Тот же сегмент, но выросший ВМЕСТЕ с подменой подписанного префикса.
     Длина изменилась, поэтому «сверять отпечаток только при равной длине»
     пропустило бы ровно это. */
  await writeFile(segmentFile(revived.id, 2),
    `${revivedFullLine.replace('contract', 'cxntract')}\n`, 'utf8')
  const revivedRewritten = await store.readJournal(revived.id)
  t('перешагнутый сегмент, выросший вместе с подменой префикса, — повреждение',
    revivedRewritten.state, 'journalCorrupt')
  t('и отказ называет префикс',
    new RegExp(`отпечаток префикса ${Buffer.byteLength(revivedReservation, 'utf8')} байт `
      + 'перешагнутого сегмента').test(revivedRewritten.reason), true)
  t('и расщеплением это не объявляется', revivedRewritten.fork, null)

  /* Тот же приём на СОДЕРЖАТЕЛЬНОМ сегменте цепочки: дописать длиннее и
     переписать подписанный префикс — одно движение. */
  const grown = await newJournal('рост-с-подменой')
  await dispatch(grown.journal, grown.items[0].requestItemId)
  const grownFile = segmentFile(grown.id, 1)
  const grownBase = await readFile(grownFile, 'utf8')
  await writeFile(grownFile, `${grownBase}{"alpha`, 'utf8')
  const grownHandle = await resume(store, grown.id, {
    takeover: await takeoverFor(store, grown.id, AT), at: AT,
  })
  await grownHandle.release({ at: AT, reason: 'handoff' })
  await writeFile(grownFile, `${grownBase}{"bravo-plus`, 'utf8')
  const grownRead = await store.readJournal(grown.id)
  t('рост вместе с подменой префикса — повреждение, а не расщепление',
    grownRead.state, 'journalCorrupt')
  t('и расщеплением это не объявляется', grownRead.fork, null)

  /* ── Закрытие сильнее неопределённости ───────────────────────────────── */

  const closedWithPending = await newJournal('закрытие-и-резерв')
  for (const item of closedWithPending.items) {
    await dispatch(closedWithPending.journal, item.requestItemId)
    await closedWithPending.journal.settled(
      settledInput(item.requestItemId, 'accepted', true, item.sourceKey),
    )
  }
  const closedSummary = await closedWithPending.journal.close({ at: AT })
  await writeFile(segmentFile(closedWithPending.id, 2), '', 'utf8')
  const closedRead = await store.readJournal(closedWithPending.id)
  t('закрытый журнал остаётся закрытым', closedRead.state, 'closed')
  t('и его исход прежний', closedRead.outcome, closedSummary.outcome)
  t('и право дозаписи у него readOnly, а не indeterminate',
    closedRead.appendability, 'readOnly')
  t('и причины неопределённости у него нет', closedRead.appendabilityReason, null)
  t('а резервирование по-прежнему видно диагностически',
    closedRead.pendingSegments.map((entry) => entry.name).join(','),
    segmentName(JOURNAL_GENERATION, 2))
  t('и полномочия на перехват закрытый журнал не выдаёт',
    /закрыт/.test(await boomAsync(() => store.takeoverBinding(closedWithPending.id))), true)
  t('и захват эпохи по нему невозможен',
    /закрыт/.test(await boomAsync(() => resume(store, closedWithPending.id, { at: AT }))), true)

  /* ── Границы пути журнала ───────────────────────────────────────────── */

  const strangerId = 'a'.repeat(64)
  mkdirSync(path.join(repoRoot, 'tmp', 'poi-model-executions', strangerId))
  symlinkSync(journalFile, path.join(repoRoot, 'tmp', 'poi-model-executions', strangerId, SEGMENT_1))
  const viaLink = await store.readJournal(strangerId)
  t('символьная ссылка на месте журнала — повреждение', viaLink.state, 'journalCorrupt')
  t('и восстановление по ней отвергается',
    /символьная ссылка/.test(await boomAsync(() => resume(store, strangerId, { at: AT }))), true)

  const dirId = 'e'.repeat(64)
  mkdirSync(path.join(repoRoot, 'tmp', 'poi-model-executions', dirId))
  mkdirSync(path.join(repoRoot, 'tmp', 'poi-model-executions', dirId, SEGMENT_1))
  t('каталог на месте журнала отвергается',
    /каталог/.test(await boomAsync(() => resume(store, dirId, { at: AT }))), true)

  /* Корень исполнений — символьная ссылка наружу. Цепочка обязана отказать
     до создания чего бы то ни было: recursive-mkdir прошёл бы её насквозь. */
  const escapeRoot = await mkdtemp(path.join(tmpdir(), 'poi-escape-'))
  const linkedRepo = await mkdtemp(path.join(tmpdir(), 'poi-linked-'))
  mkdirSync(path.join(linkedRepo, 'tmp'))
  symlinkSync(escapeRoot, path.join(linkedRepo, 'tmp', 'poi-model-executions'))
  const escaped = createArtifactStore({ repoRoot: linkedRepo })
  await escaped.approvals.writeApprovalFile({ approval: clone(APPROVAL), plan: clone(PLAN) })
  const escapeMessage = await boomAsync(() => escaped.openJournal({
    approvalFileName: FILE_NAME, plan: clone(PLAN), at: AT,
  }))
  t('корень исполнений — символьная ссылка: отказ',
    /символьная ссылка в пути/.test(escapeMessage), true)
  t('и наружу ничего не создано', existsSync(path.join(escapeRoot, 'tmp')), false)
  const escapedEntries = await readdir(escapeRoot)
  t('и каталога исполнения за ссылкой нет', escapedEntries.length, 0)
  await rm(escapeRoot, { recursive: true, force: true })
  await rm(linkedRepo, { recursive: true, force: true })

  /* Журнал, положенный в чужой каталог. Имя каталога и подписи внутри
     самого журнала обязаны сходиться — иначе восстановление шло бы по
     журналу, принадлежащему другому разрешению. */
  /* Журнал со свидетельством, целиком в одной эпохе: переклейка обязана
     ломаться на подписи свидетельства раньше, чем дело дойдёт до пересчёта
     идентификатора. */
  const evidenceApproval = buildModelApproval({
    plan: clone(PLAN), ...DECISION, approvalId: 'approval-свидетельство', limits: clone(LIMITS),
  })
  await store.approvals.writeApprovalFile({ approval: clone(evidenceApproval), plan: clone(PLAN) })
  const evidenceHandle = await store.openJournal({
    approvalFileName: approvalFileName(evidenceApproval), plan: clone(PLAN), at: AT,
  })
  const evidenceId = evidenceHandle.executionId
  const evidenceItems = (await store.readJournal(evidenceId)).records[0].payload.items
  for (const [index, item] of evidenceItems.entries()) {
    await dispatch(evidenceHandle, item.requestItemId)
    if (index === 0) {
      await evidenceHandle.reconciled({
        evidence: evidenceFor(evidenceId, item.requestItemId, 'charged'), at: AT,
      })
      await evidenceHandle.settled(settledInput(item.requestItemId, 'lost', true, item.sourceKey))
      continue
    }
    await evidenceHandle.settled(settledInput(item.requestItemId, 'accepted', true, item.sourceKey))
  }
  await evidenceHandle.close({ at: AT })
  const evidenceText = await readFile(store.journalPath(evidenceId), 'utf8')

  const alienId = 'c'.repeat(64)
  mkdirSync(path.join(repoRoot, 'tmp', 'poi-model-executions', alienId))
  await writeFile(
    path.join(repoRoot, 'tmp', 'poi-model-executions', alienId, SEGMENT_1),
    evidenceText, 'utf8',
  )
  const alien = await store.readJournal(alienId)
  t('журнал в чужом каталоге — повреждение', alien.state, 'journalCorrupt')

  /* Тот же журнал, но переписанный целиком под чужой каталог: поле
     `executionId` у каждой записи подменено и подпись пересчитана. Теперь
     сходится всё, кроме одного — самих подписей разрешения и плана внутри
     `opened`. Отсюда пересчёт идентификатора ИЗ ЖУРНАЛА: без него журнал
     чужого разрешения выглядел бы своим. */
  const relabelled = evidenceText.trim().split('\n').map((line) => {
    const record = clone(JSON.parse(line))
    record.executionId = alienId
    return signed(record)
  }).join('\n')
  await writeFile(path.join(repoRoot, 'tmp', 'poi-model-executions', alienId, SEGMENT_1),
    `${relabelled}\n`, 'utf8')
  const relabelledRead = await store.readJournal(alienId)
  t('переклеенный журнал тоже повреждение', relabelledRead.state, 'journalCorrupt')
  /* В этом журнале есть свидетельство, и переклейка ломает его подпись
     раньше, чем дело доходит до пересчёта идентификатора: `executionId`
     входит в подписываемые байты свидетельства, хотя в payload не лежит. */
  t('переклейка ломает подпись свидетельства',
    /evidenceDigest не сходится/.test(relabelledRead.reason), true)
  t('и восстановление по нему отвергается',
    /evidenceDigest не сходится/.test(await boomAsync(() => resume(store, alienId, { at: AT }))), true)

  /* Тот же приём на журнале БЕЗ свидетельства доходит до пересчёта
     идентификатора из самого журнала — и отвергается уже им. */
  const plainApproval = buildModelApproval({
    plan: clone(PLAN), ...DECISION, approvalId: 'approval-переклейка', limits: clone(LIMITS),
  })
  await store.approvals.writeApprovalFile({ approval: clone(plainApproval), plan: clone(PLAN) })
  const plainJournal = await store.openJournal({
    approvalFileName: approvalFileName(plainApproval), plan: clone(PLAN), at: AT,
  })
  await plainJournal.release({ at: AT, reason: 'handoff' })
  const plainText = await readFile(store.journalPath(plainJournal.executionId), 'utf8')
  const plainAlienId = 'f'.repeat(64)
  const plainAlienFile = path.join(repoRoot, 'tmp', 'poi-model-executions', plainAlienId, SEGMENT_1)
  mkdirSync(path.join(repoRoot, 'tmp', 'poi-model-executions', plainAlienId))
  await writeFile(plainAlienFile, `${plainText.trim().split('\n').map((line) => {
    const record = clone(JSON.parse(line))
    record.executionId = plainAlienId
    return signed(record)
  }).join('\n')}\n`, 'utf8')
  /* Наивная переклейка ломается РАНЬШЕ пересчёта идентификатора: подписанная
     инициализация протокола ссылается на отпечаток `opened`, а он от смены
     `executionId` меняется. Это второй барьер, а не замена первому. */
  t('переклейка ломает подписанную инициализацию протокола',
    /fromRecordDigest против хвоста/.test((await store.readJournal(plainAlienId)).reason), true)

  /* Та же переклейка, но с починенной цепочкой: инициализация снова сходится,
     и остаётся ровно один свидетель принадлежности — пересчёт идентификатора
     из подписей разрешения и плана внутри самого `opened`. */
  let relabelledOpenedDigest = null
  const repaired = plainText.trim().split('\n').map((line) => {
    const record = clone(JSON.parse(line))
    record.executionId = plainAlienId
    if (record.type === 'claimed' && record.payload.basis === 'opened') {
      record.payload = { ...record.payload, fromRecordDigest: relabelledOpenedDigest }
    }
    const rewritten = signed(record)
    if (record.type === 'opened') relabelledOpenedDigest = JSON.parse(rewritten).recordDigest.value
    return rewritten
  }).join('\n')
  await writeFile(plainAlienFile, `${repaired}\n`, 'utf8')
  const plainRelabelled = await store.readJournal(plainAlienId)
  t('переклеенный журнал без свидетельства — тоже повреждение',
    plainRelabelled.state, 'journalCorrupt')
  t('и отказ называет обе принадлежности',
    plainRelabelled.reason.includes(plainAlienId)
      && plainRelabelled.reason.includes(plainJournal.executionId), true)

  for (const wrongId of ['../побег', 'A'.repeat(64), 'a'.repeat(63), '', 'нет']) {
    t(`идентификатор ${JSON.stringify(wrongId)} отвергается`,
      /64 строчных hex-знака/.test(boom(() => store.journalPath(wrongId))), true)
  }
  /* Корень репозитория выводится из модуля, а не из текущего каталога:
     проверяется дочерним процессом, запущенным ИЗ ДРУГОГО каталога. */
  const probe = execFileSync(process.execPath, ['--input-type=module', '--eval', `
    import { REPO_ROOT } from ${JSON.stringify(pathToFileURL(
      path.join(HERE, '..', 'scripts', 'poi-portals', 'lib', 'execution-journal.mjs'),
    ).href)}
    console.log(REPO_ROOT)
  `], { cwd: tmpdir(), encoding: 'utf8' }).trim()
  t('корень репозитория не зависит от текущего каталога', probe, path.resolve(HERE, '..'))
  t('и текущий каталог при этом был другим', tmpdir() === path.resolve(HERE, '..'), false)
} finally {
  await rm(repoRoot, { recursive: true, force: true })
}

console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ журнал исполнения: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
