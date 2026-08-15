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
import { PROVIDER_PROFILE_SPEC } from '../scripts/poi-portals/lib/provider-profile.mjs'
import {
  buildModelPlan,
  buildPortalPlanFragment,
  MODEL_INPUT_FIELDS,
} from '../scripts/poi-portals/lib/model-plan.mjs'
import { evaluatePoiCandidate } from '../scripts/poi-portals/lib/scoring.mjs'
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
  parseAndVerifyJournal,
  parseAndVerifyRecord,
  recordDigest,
  RECORD_KEYS,
} from '../scripts/poi-portals/lib/model-execution.mjs'
import { approvalFileName } from '../scripts/poi-portals/lib/approval-store.mjs'
import {
  ARTIFACT_STORE,
  createArtifactStore,
  EXECUTION_ROOT_REL,
  FILE_IO,
  JOURNAL_FILE_NAME,
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

/* ── Фикстуры ─────────────────────────────────────────────────────────── */

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
  seq: 0,
  at: '2026-08-13T00:00:00.000Z',
  executionId: GOLDEN_ID,
  type: 'dispatching',
  payload: { requestItemId: 'c'.repeat(64) },
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
  /recordDigest не сходится/.test(boom(() => parseAndVerifyRecord(tampered, { executionId: GOLDEN_ID }))), true)

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
    seq: 1, at: AT, executionId: GOLDEN_ID, type: 'settled',
    payload: { requestItemId: 'c'.repeat(64), outcome: 'lost', charged: false },
  }))), true)
t('неизвестный тип записи отвергается',
  /ожидается один из/.test(boom(() => buildRecord({
    seq: 0, at: AT, executionId: GOLDEN_ID, type: 'reconciled', payload: {},
  }))), true)

/* Закреплённый поток байтов записи: длина и результат, а не только форма. */
const GOLDEN_RECORD = {
  contractVersion: MODEL_EXECUTION_SPEC,
  seq: 0,
  at: '2026-08-13T00:00:00.000Z',
  executionId: GOLDEN_ID,
  type: 'dispatching',
  payload: { requestItemId: 'c'.repeat(64) },
}
const GOLDEN_STREAM = canonicalJsonBytes(GOLDEN_RECORD, EXECUTION_RECORD_SPEC)
t('длина потока байтов записи', GOLDEN_STREAM.length, 311)
t('домен стоит первым полем потока',
  GOLDEN_STREAM.toString('utf8').startsWith(`${EXECUTION_RECORD_SPEC}\n`), true)
t('закреплённый recordDigest', recordDigest(GOLDEN_RECORD),
  'sha256:34ec250272a1f0cbdb54d335ac23d9572bc4161878f6fea4e7106cfcb46213fd')

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
  type: 'dispatching', payload: { requestItemId: 'c'.repeat(64) },
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
    return parseAndVerifyRecord(copy, { executionId: GOLDEN_ID })
  })), true)

/* Строгая форма распространяется на ВСЕ публичные object-входы модуля, а не
   только на те, что выдают подпись: лишнее поле, молча выброшенное
   деструктуризацией, — это принятое обещание, которого никто не проверил. */
const RECORD_FOR_JOURNAL = buildRecord({
  seq: 0, at: '2026-08-13T00:00:00.000Z', executionId: GOLDEN_ID, type: 'dispatching',
  payload: { requestItemId: 'c'.repeat(64) },
})
t('parseAndVerifyJournal отвергает лишнее поле входа',
  /лишние поля extra/.test(boom(() => parseAndVerifyJournal({
    records: [clone(RECORD_FOR_JOURNAL)], executionId: GOLDEN_ID, extra: 'ignored',
  }))), true)
t('parseAndVerifyRecord отвергает лишнее поле параметров',
  /лишние поля extra/.test(boom(() => parseAndVerifyRecord(
    clone(RECORD_FOR_JOURNAL), { executionId: GOLDEN_ID, extra: 1 },
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
      records: [clone(RECORD_FOR_JOURNAL)], executionId: GOLDEN_ID,
    }, kind))) !== '(без ошибки)', true)
}

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
    ['resumeJournal', () => store.resumeJournal({ executionId: 'a'.repeat(64), лишнее: 1 })],
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
    handle.path, path.join(repoRoot, 'tmp', 'poi-model-executions', ID, JOURNAL_FILE_NAME))

  const openedOnDisk = (await readFile(handle.path, 'utf8')).trim().split('\n')
  t('на диске ровно одна запись сразу после открытия', openedOnDisk.length, 1)
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

  const items = openedRecord.payload.items.map((i) => i.requestItemId)
  await handle.dispatching({ requestItemId: items[0], at: AT })
  const afterDispatch = (await readFile(handle.path, 'utf8')).trim().split('\n')
  t('намерение на диске сразу после возврата', afterDispatch.length, 2)
  t('и это dispatching', JSON.parse(afterDispatch[1]).type, 'dispatching')

  t('settled без dispatching отвергается',
    /settled без dispatching/.test(await boomAsync(() => handle.settled({
      requestItemId: items[1], outcome: 'accepted', charged: true, at: AT,
    }))), true)
  t('повторный dispatching отвергается',
    /повторный dispatching/.test(await boomAsync(() => handle.dispatching({
      requestItemId: items[0], at: AT,
    }))), true)
  t('элемент вне opened отвергается',
    /не объявлен в opened/.test(await boomAsync(() => handle.dispatching({
      requestItemId: 'f'.repeat(64), at: AT,
    }))), true)

  await handle.settled({ requestItemId: items[0], outcome: 'accepted', charged: true, at: AT })
  t('повторный settled отвергается',
    /повторный settled/.test(await boomAsync(() => handle.settled({
      requestItemId: items[0], outcome: 'rejected', charged: true, at: AT,
    }))), true)

  t('закрытие при неурегулированных отвергается',
    /остались неотправленные либо неурегулированные/.test(
      await boomAsync(() => handle.close({ at: AT }))), true)

  const midway = await store.readJournal(ID)
  t('незакрытый журнал требует сверки', midway.state, 'needsReconciliation')
  t('и код возврата — сорок', midway.exitCode, EXIT_CODES.needsReconciliation)
  t('неотправленные посчитаны', midway.counts.notDispatched, TOTAL - 1)

  for (const id of items.slice(1)) {
    await handle.dispatching({ requestItemId: id, at: AT })
    await handle.settled({ requestItemId: id, outcome: 'accepted', charged: true, at: AT })
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
    /уже закрыт/.test(await boomAsync(() => store.resumeJournal({ executionId: ID }))), true)

  /* ── Восстановление без плана и без разрешения ──────────────────────── */

  const secondApproval = buildModelApproval({
    plan: clone(PLAN), ...DECISION, approvalId: 'approval-второе', limits: clone(LIMITS),
  })
  const secondName = approvalFileName(secondApproval)
  await store.approvals.writeApprovalFile({ approval: clone(secondApproval), plan: clone(PLAN) })
  const second = await store.openJournal({ approvalFileName: secondName, plan: clone(PLAN), at: AT })
  const secondId = second.executionId
  const secondItems = (await store.readJournal(secondId)).records[0].payload.items
    .map((i) => i.requestItemId)
  await second.dispatching({ requestItemId: secondItems[0], at: AT })
  await second.release()

  const interrupted = await store.readJournal(secondId)
  t('прерванный после отправки журнал требует сверки', interrupted.state, 'needsReconciliation')
  t('и неопределённый элемент посчитан', interrupted.counts.unknown, 1)

  /* Исходные артефакты удаляются: восстановление обязано работать и без них. */
  await rm(path.join(repoRoot, 'tmp', 'poi-model-approvals', secondName))
  const resumed = await store.resumeJournal({ executionId: secondId })
  t('восстановление работает без файла разрешения и без плана', resumed.executionId, secondId)
  await resumed.settled({ requestItemId: secondItems[0], outcome: 'lost', charged: true, at: AT })
  for (const id of secondItems.slice(1)) {
    await resumed.dispatching({ requestItemId: id, at: AT })
    await resumed.settled({ requestItemId: id, outcome: 'accepted', charged: true, at: AT })
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
  await third.release()
  const beforeDispatch = await store.readJournal(third.executionId)
  t('прогон без единой отправки', beforeDispatch.state, 'interruptedBeforeDispatch')
  t('и он тоже не закрыт', beforeDispatch.exitCode, EXIT_CODES.needsReconciliation)
  const resumedThird = await store.resumeJournal({ executionId: third.executionId })
  t('текущий close такой журнал не закрывает',
    /закрывает reconciliation/.test(await boomAsync(() => resumedThird.close({ at: AT }))), true)
  await resumedThird.release()

  /* ── Повреждения ────────────────────────────────────────────────────── */

  const corruptId = second.executionId
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
  const settledLine = JSON.parse(lines[2])
  const lostNoCharge = clone(settledLine)
  lostNoCharge.payload = { ...lostNoCharge.payload, outcome: 'lost', charged: false }
  await damage(`${lines[0]}\n${lines[1]}\n${signed(lostNoCharge)}\n`, 'lost без charged')

  /* Закрытие при неотправленных элементах, записанное в файл вручную. */
  const forgedClose = clone(JSON.parse(lines[0]))
  forgedClose.seq = 1
  forgedClose.type = 'closed'
  forgedClose.payload = {
    deleteAfter: closedDeleteAfter({
      openedDeleteAfter: JSON.parse(lines[0]).payload.deleteAfter, closedAt: AT,
    }),
    outcome: 'allAccepted',
    counts: Object.fromEntries(COUNT_BUCKETS.map((b) => [b, b === 'notDispatched' ? TOTAL : 0])),
  }
  await damage(`${lines[0]}\n${signed(forgedClose)}\n`, 'closed при неотправленных')

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

    const spyIds = (await spyStore.readJournal(spyHandle.executionId)).records[0].payload.items
      .map((i) => i.requestItemId)
    trace.length = 0
    await spyHandle.dispatching({ requestItemId: spyIds[0], at: AT })
    t('намерение: записать → синхронизировать, каталог не трогается',
      trace.join(','), 'write,sync')

    /* Отказ синхронизации ПОСЛЕ успешной записи: файл уже содержит строку,
       память о ней не обновлена. Ручка обязана стать непригодной. */
    failAt.sync = trace.filter((x) => x === 'sync').length + 1
    const failed = await boomAsync(() => spyHandle.settled({
      requestItemId: spyIds[0], outcome: 'accepted', charged: true, at: AT,
    }))
    failAt.sync = null
    t('отказ синхронизации виден вызывающему', /искусственный отказ sync/.test(failed), true)
    t('ручка помечена непригодной', spyHandle.poisoned(), true)
    for (const attempt of [
      () => spyHandle.dispatching({ requestItemId: spyIds[1], at: AT }),
      () => spyHandle.settled({ requestItemId: spyIds[0], outcome: 'accepted', charged: true, at: AT }),
      () => spyHandle.close({ at: AT }),
    ]) {
      t('дальнейшая дозапись запрещена',
        /ручка непригодна после отказа записи/.test(await boomAsync(attempt)), true)
    }
    /* Продолжить можно ровно одним способом — перечитав файл. */
    const recovered = await spyStore.resumeJournal({ executionId: spyHandle.executionId })
    t('после перечитывания работа продолжается', recovered.poisoned(), false)
    await recovered.release()

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
    const partialError = await boomAsync(() => partialHandle.dispatching({
      requestItemId: partialItems[0], at: AT,
    }))
    failAt.partialWrite = false
    t('частичная запись видна вызывающему', /обрыв на середине строки/.test(partialError), true)
    t('ручка после частичной записи отравлена', partialHandle.poisoned(), true)
    const tornBytes = await readFile(partialFile, 'utf8')
    t('файл действительно содержит оборванный хвост', tornBytes.endsWith('\n'), false)
    const resumeError = await boomAsync(() => spyStore.resumeJournal({ executionId: partialId }))
    t('восстановление по оборванному хвосту отвергается',
      /последняя строка не дописана/.test(resumeError), true)
    t('и файл при этом не изменён', await readFile(partialFile, 'utf8'), tornBytes)
    t('а чтение оборванный хвост по-прежнему игнорирует',
      (await spyStore.readJournal(partialId)).state, 'interruptedBeforeDispatch')
    t('и чтение файл тоже не изменило', await readFile(partialFile, 'utf8'), tornBytes)

    /* Строгая форма входа у методов ручки. */
    const fresh = await spyStore.resumeJournal({ executionId: spyHandle.executionId })
    for (const kind of SPOILS) {
      t(`dispatching отвергает вход: ${kind}`,
        await boomAsync(() => fresh.dispatching(spoil({ requestItemId: spyIds[1], at: AT }, kind)))
          !== '(без ошибки)', true)
    }
    await fresh.release()
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
    const ids = (await store.readJournal(journal.executionId)).records[0].payload.items
      .map((i) => i.requestItemId)
    for (const [index, id] of ids.entries()) {
      const outcome = outcomes[index % outcomes.length]
      await journal.dispatching({ requestItemId: id, at: AT })
      await journal.settled({ requestItemId: id, outcome, charged: outcome !== 'skipped', at: AT })
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
  const abortedId = third.executionId
  const abortedFile = store.journalPath(abortedId)
  const abortedOpened = JSON.parse((await readFile(abortedFile, 'utf8')).trim())
  const abortedClosed = {
    contractVersion: MODEL_EXECUTION_SPEC,
    seq: 1,
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
    `${JSON.stringify(abortedOpened)}\n${JSON.stringify(abortedClosed)}\n`, 'utf8')
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
    `${JSON.stringify(abortedOpened)}\n${JSON.stringify(forgedAborted)}\n`, 'utf8')
  t('abortedBeforeDispatch при ненулевых счётчиках — повреждение',
    (await store.readJournal(abortedId)).state, 'journalCorrupt')
  t('и восстановление называет его повреждённым, а не закрытым',
    /closed\.counts|closed\.outcome/.test(
      await boomAsync(() => store.resumeJournal({ executionId: abortedId }))), true)

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

  /* ── Границы пути журнала ───────────────────────────────────────────── */

  const strangerId = 'a'.repeat(64)
  mkdirSync(path.join(repoRoot, 'tmp', 'poi-model-executions', strangerId))
  symlinkSync(journalFile, path.join(repoRoot, 'tmp', 'poi-model-executions', strangerId, JOURNAL_FILE_NAME))
  const viaLink = await store.readJournal(strangerId)
  t('символьная ссылка на месте журнала — повреждение', viaLink.state, 'journalCorrupt')
  t('и восстановление по ней отвергается',
    /символьная ссылка/.test(await boomAsync(() => store.resumeJournal({ executionId: strangerId }))), true)

  const dirId = 'e'.repeat(64)
  mkdirSync(path.join(repoRoot, 'tmp', 'poi-model-executions', dirId))
  mkdirSync(path.join(repoRoot, 'tmp', 'poi-model-executions', dirId, JOURNAL_FILE_NAME))
  t('каталог на месте журнала отвергается',
    /каталог/.test(await boomAsync(() => store.resumeJournal({ executionId: dirId }))), true)

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
  const alienId = 'c'.repeat(64)
  mkdirSync(path.join(repoRoot, 'tmp', 'poi-model-executions', alienId))
  await writeFile(
    path.join(repoRoot, 'tmp', 'poi-model-executions', alienId, JOURNAL_FILE_NAME),
    original, 'utf8',
  )
  const alien = await store.readJournal(alienId)
  t('журнал в чужом каталоге — повреждение', alien.state, 'journalCorrupt')

  /* Тот же журнал, но переписанный целиком под чужой каталог: поле
     `executionId` у каждой записи подменено и подпись пересчитана. Теперь
     сходится всё, кроме одного — самих подписей разрешения и плана внутри
     `opened`. Отсюда пересчёт идентификатора ИЗ ЖУРНАЛА: без него журнал
     чужого разрешения выглядел бы своим. */
  const relabelled = original.trim().split('\n').map((line) => {
    const record = clone(JSON.parse(line))
    record.executionId = alienId
    return signed(record)
  }).join('\n')
  await writeFile(path.join(repoRoot, 'tmp', 'poi-model-executions', alienId, JOURNAL_FILE_NAME),
    `${relabelled}\n`, 'utf8')
  const relabelledRead = await store.readJournal(alienId)
  t('переклеенный журнал тоже повреждение', relabelledRead.state, 'journalCorrupt')
  t('и отказ называет обе принадлежности',
    relabelledRead.reason.includes(alienId) && relabelledRead.reason.includes(corruptId), true)
  t('и восстановление по нему отвергается',
    /принадлежит/.test(await boomAsync(() => store.resumeJournal({ executionId: alienId }))), true)

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
