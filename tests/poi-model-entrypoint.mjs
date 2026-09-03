/**
 * PRODUCTION-ENTRYPOINT МОДЕЛЬНОГО ИСПОЛНЕНИЯ (P03.3).
 *
 * Что здесь доказывается и чего здесь НЕТ.
 *
 * Доказывается композиция: пользовательский CLI действительно способен дойти
 * до `executeModelPlan` при полном валидном наборе входов, и останавливается
 * до учётных данных, журнала и провода при любом несовпадении. Подменяются
 * только низкоуровневые зависимости — часы, файловый корень, чтение
 * идентичности кода, `request` и окружение. Ни исполнитель, ни preflight, ни
 * транспорт, ни серализатор не подменяются: подмена любого из них проверяла
 * бы композицию, которой в production нет.
 *
 * ГРАНИЦА ДОКАЗАТЕЛЬСТВА, названная вслух. Полный проход всех двенадцати ворот
 * через `main()` СЕГОДНЯ НЕВОЗМОЖЕН, и это не пробел набора, а проверяемое
 * свойство системы: policy всех двенадцати источников реестра запрещает
 * модельную обработку, и ворота P7 останавливают прогон. Открыть их можно было
 * бы только правкой реестра источников ради теста — ровно то, что запрещено.
 * Поэтому доказательство разделено:
 *
 *   • полная композиция (план → разрешение → preflight → исполнитель →
 *     транспорт → журнал → отчёт) исполняется от `runModelExecution` с
 *     фикстурным `resolvePortal`, у которого policy разрешает;
 *   • вклад самого CLI — разбор, изоляция режима, реестр источников, точный
 *     код возврата — проверяется настоящим процессом, и на реальном реестре
 *     прогон честно останавливается воротами.
 *
 * Ни сети, ни Airtable, ни модели: `request` подставлен, и ни одна ветка до
 * настоящего сокета не доходит.
 */
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { acceptedFlags, EXECUTION_MODE_FLAGS, helpText, main, runCli } from '../scripts/poi-portals/collect-pois.mjs'
import {
  buildPlanEnvelope, ENVELOPE_KEYS, ENVELOPE_SUFFIX, envelopePathFor, MODEL_PLAN_ENVELOPE_SPEC,
  parsePlanEnvelope, PLAN_DIR_REL, readPlanByName, runModelExecution,
} from '../scripts/poi-portals/lib/model-run.mjs'
import { createCredentialsResolver, createProductionWireClient } from '../scripts/poi-portals/lib/model-wire.mjs'
import { buildModelApproval } from '../scripts/poi-portals/lib/model-approval.mjs'
import { approvalFileName, createApprovalStore } from '../scripts/poi-portals/lib/approval-store.mjs'
import { FILE_IO } from '../scripts/poi-portals/lib/execution-journal.mjs'
import { EXIT_CODES } from '../scripts/poi-portals/lib/model-execution.mjs'
import { PREFLIGHT_CODES, PREFLIGHT_PHASES } from '../scripts/poi-portals/lib/execution-preflight.mjs'
import {
  buildModelPlan,
  buildPortalPlanFragment,
  MODEL_INPUT_FIELDS,
  parseAndVerifyModelPlan,
} from '../scripts/poi-portals/lib/model-plan.mjs'
import { resolvePricingTable } from '../scripts/poi-portals/lib/model-pricing.mjs'
import { PROVIDER_PROFILES } from '../scripts/poi-portals/lib/provider-profile.mjs'
import { rerunPortalCandidates } from '../scripts/poi-portals/collect-pois.mjs'

const run = promisify(execFile)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const FX = path.join(HERE, 'fixtures', 'poi-model-plan')

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok += 1
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok += 1
  else bad.push(`${label}: в ${JSON.stringify(text)} нет «${needle}»`)
}
const said = async (fn) => {
  try { await fn(); return '(без ошибки)' } catch (error) { return String(error?.message ?? error) }
}
const clone = (value) => JSON.parse(JSON.stringify(value))
const quiet = async (fn) => {
  const [e, l] = [console.error, console.log]
  console.error = () => {}; console.log = () => {}
  try { return await fn() } finally { console.error = e; console.log = l }
}

/* ── Фикстура: план, профиль, цена, разрешение ───────────────────────────── */

const awaiting = JSON.parse(await readFile(path.join(FX, 'candidates-awaiting.json'), 'utf8'))
/* ПРОФИЛЬ И ЦЕНА — КАНОНИЧЕСКИЕ, а не фикстурные, и это не удобство.
   Оркестратор выводит их ИЗ ПЛАНА через канонические реестры и вторым
   пользовательским вводом не принимает; профиль, которого в реестре нет, он
   отвергает. Фикстура, подставившая свой профиль, проверяла бы композицию, до
   которой production не доходит. Даты выбраны внутри срока годности
   канонического профиля: раньше — он ещё не наблюдался, позже — просрочен. */
const NOW = new Date('2026-08-18T00:00:00Z')
const AT = '2026-08-19T00:00:00.000Z'
const CODE_IDENTITY = Object.freeze({ commit: '0'.repeat(40), dirty: false })
const PORTAL_ID = 'p-entrypoint'

const PROFILE = PROVIDER_PROFILES[0]
const PRICING = resolvePricingTable(PROFILE.pricingTableDigest.value)

const POLICY = Object.freeze({
  purpose: 'classification',
  allowedProviders: [PROFILE.id],
  fields: [...MODEL_INPUT_FIELDS],
  decisionRef: 'owner/2026-08-14',
  reviewedAt: '2026-08-01',
  validUntil: '2026-12-31',
})
const portalOf = (over = {}) => ({
  id: PORTAL_ID, adapter: 'fake', regionKeys: [], modelProcessing: POLICY, ...over,
})
const ADAPTERS = Object.freeze({ fake: async () => ({ candidates: clone(awaiting), meta: {} }) })
const evaluated = await rerunPortalCandidates(portalOf(), { adapters: ADAPTERS })

const PROMPT_TEXT = 'фиксированный промпт entrypoint'
const SCHEMA_OBJECT = { type: 'object', properties: { entityKind: { type: 'string' } } }
/* Исполнимый план фикстуры; идентификатор — параметр, чтобы «другой план»
   отличался от этого ровно им и ничем больше. */
const fixturePlan = (planId) => buildModelPlan({
  fragments: [buildPortalPlanFragment({
    portal: portalOf(), evaluated, now: NOW, providerProfile: PROFILE,
  })],
  selectedPortalIds: [PORTAL_ID],
  meta: {
    planId,
    createdAt: '2026-08-18T00:00:00.000Z',
    deleteAfter: '2026-08-25T00:00:00.000Z',
    codeIdentity: clone(CODE_IDENTITY),
    taxonomyVersion: 'poi-taxonomy/v2',
    taxonomyBytes: Buffer.from('{"version":"poi-taxonomy/v2"}\n', 'utf8'),
    taxonomySpec: 'raw-file-bytes/v1',
    promptText: PROMPT_TEXT,
    schemaObject: SCHEMA_OBJECT,
    providerProfile: PROFILE,
  },
})
const PLAN = fixturePlan('plan-entrypoint')
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
  currency: PRICING.currency,
  pricingTableDigest: clone(PRICING.pricingTableDigest),
  pricingTableAsOf: PRICING.pricingTableAsOf,
  maxRetries: 0,
}
const DECISION = {
  createdAt: '2026-08-18T00:00:00.000Z',
  validUntil: '2026-08-25T00:00:00.000Z',
  decisionRef: 'owner/2026-08-14',
  approver: 'jumbo',
}

/* ── Подставные низкоуровневые зависимости ──────────────────────────────── */

/** Окружение, которое СЧИТАЕТ обращения к себе. Читает его только резолвер. */
const countingEnv = (values = {}) => {
  const state = { reads: 0 }
  const target = { ...values }
  state.env = new Proxy(target, {
    getOwnPropertyDescriptor(obj, key) {
      state.reads += 1
      return Object.getOwnPropertyDescriptor(obj, key)
    },
  })
  return state
}

/** Провод: считает вызовы и отдаёт ответ Responses API. */
const wireOf = () => {
  const state = { calls: 0, seen: [] }
  state.request = (url, options, onResponse) => {
    state.calls += 1
    state.seen.push({ url, method: options.method, headers: options.headers })
    const body = JSON.stringify({
      id: 'resp', object: 'response', status: 'completed',
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: JSON.stringify({
          entityKind: 'tourist_poi',
          poiPrimaryType: 'museum',
          facets: [],
          confidence: 0.9,
          reasons: ['подставной ответ'],
          nameRu: `Тестовый музей ${state.calls}`,
        }) }],
      }],
    })
    const response = {
      statusCode: 200,
      destroy() {},
      async* [Symbol.asyncIterator]() { yield Uint8Array.from(Buffer.from(body, 'utf8')) },
    }
    queueMicrotask(() => onResponse(response))
    return { on() {}, end() {}, destroy() {} }
  }
  return state
}

const CREDENTIAL_ENV = { POI_MODEL_EXECUTION_OPENAI_API_KEY: 's'.repeat(32) }

/* ── Общая подготовка временного корня ──────────────────────────────────── */

/* СНИМОК НАСТОЯЩЕГО КАТАЛОГА ПЛАНОВ — до первой строки работы.
   Набор не имеет права ничего оставить в репозитории: остаток R0 пережил
   прогон и уронил повторный запуск на EPERM. Сравнение «до/после» ловит любую
   запись сюда, откуда бы она ни пришла. */
const REAL_PLAN_DIR = path.join(REPO, PLAN_DIR_REL)
const listReal = async () => (await readdir(REAL_PLAN_DIR).catch(() => [])).sort()
const REAL_PLANS_BEFORE = (await listReal()).join(',')
/* Имена, которыми пользуется САМ набор. Сравнения «до/после» мало: остаток
   предыдущего прогона делает «до» равным «после», и набор, который пишет в
   репозиторий, снова выглядит чистым. Эти имена не должны лежать в настоящем
   каталоге планов ни при каком исходе. */
const TEST_ARTIFACT_NAMES = Object.freeze([
  'plan.json', 'produced.json', 'produced.envelope.json', 'broken.json', 'tampered.json', 'v1.json',
  'unknown-profile.json', 'twin-profile.json', 'bare.json', 'nested.json', 'array.json', 'a.json',
  'x.envelope.json', 'y.json', 'y.envelope.json', 'z.json', 'z.envelope.json', 'w.json', 'w.envelope.json',
  'hostile.json', 'hostile.envelope.json', 'hostile-null.json', 'hostile-proxy.json',
])

const roots = []
const freshRoot = async (label) => {
  const root = await mkdtemp(path.join(tmpdir(), `poi-entry-${label}-`))
  roots.push(root)
  await mkdir(path.join(root, PLAN_DIR_REL), { recursive: true })
  return root
}
/**
 * АРТЕФАКТЫ ПРОИЗВОДИТЕЛЯ — один раз, настоящим `main()`.
 *
 * `--model-plan --out` пишет ДВА файла: полный отчёт прогона (план внутри
 * полем `modelPlan`) и рядом — исполняемый конверт `<имя>.envelope.json`:
 * версия, отпечаток артефакта плана и сам план, ничего сверх. Дальше наборы
 * кладут в конверт той же формы исполнимый план фикстуры — иначе исполнителя
 * не проверить: у всех двенадцати источников реестра policy запрещает
 * обработку, и произведённый план исполнимым не будет никогда. Что форма
 * конверта именно такая, доказывает раздел 0 на неизменённых файлах
 * производителя, а не эта подстановка.
 */
const produceArtifact = async (name = 'produced.json') => {
  const root = await freshRoot('producer')
  const out = path.join(root, PLAN_DIR_REL, name)
  await quiet(() => main(
    ['node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism', '--model-plan', '--out', out],
    {
      adapters: { 'opendata-csv': async () => ({ candidates: [], meta: {} }) },
      resolveCodeIdentity: () => clone(CODE_IDENTITY),
      repoRoot: root,
    },
  ))
  const envelopePath = path.join(root, PLAN_DIR_REL, `${name.slice(0, -'.json'.length)}${ENVELOPE_SUFFIX}`)
  const readJson = async (file) => {
    try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) { return `(не прочитан: ${error.message})` }
  }
  return {
    root, out, name,
    envelopeName: path.basename(envelopePath),
    artifact: await readJson(out),
    envelope: await readJson(envelopePath),
  }
}
const PRODUCED = await produceArtifact()
/* Конверт оснастки — ПРОИЗВОДСТВЕННЫМ builder'ом, когда план цел: форма та
   же, что у файла производителя. Для заведомо сломанного плана builder
   отказывает, и конверт собирается с отпечатком правильной формы: до сверки
   отпечатка читатель всё равно не дойдёт — план отвергнет его собственный
   разбор, и именно это утверждает набор. */
const PLACEHOLDER_DIGEST = Object.freeze({
  value: `sha256:${'0'.repeat(64)}`, algorithm: 'sha256', spec: 'poi-model-plan-artifact/v1',
})
const envelopeOf = (plan) => {
  try {
    return clone(buildPlanEnvelope(plan))
  } catch {
    return { contractVersion: MODEL_PLAN_ENVELOPE_SPEC, planArtifactDigest: clone(PLACEHOLDER_DIGEST), plan }
  }
}
const writePlan = async (root, plan, name = 'plan.json') => {
  /* Каталог создаётся, если его нет: иначе запись в чужой корень падала бы
     ENOENT'ом раньше, чем сработал бы сторож остатка, и «набор пишет не туда»
     выглядело бы сломанным набором. */
  await mkdir(path.join(root, PLAN_DIR_REL), { recursive: true })
  await writeFile(path.join(root, PLAN_DIR_REL, name), JSON.stringify(envelopeOf(plan)), 'utf8')
  return name
}
const writeApproval = async (root, { plan = PLAN, overrides = {}, limits = LIMITS } = {}) => {
  const store = createApprovalStore({ repoRoot: root, io: FILE_IO })
  const approval = buildModelApproval({
    plan: clone(plan), ...DECISION, ...overrides,
    approvalId: `approval-entrypoint-${roots.length}-${Math.random().toString(36).slice(2, 8)}`,
    limits: clone(limits),
  })
  await store.writeApprovalFile({ approval: clone(approval), plan: clone(plan) })
  return approvalFileName(approval)
}

/** Полный вход оркестратора: фикстурными остаются только низкие уровни. */
const execution = async (root, over = {}) => {
  const env = over.envState ?? countingEnv(CREDENTIAL_ENV)
  const wire = over.wireState ?? wireOf()
  /* Оркестратор НЕ обязан бросать, но если бросит — это проваленная проверка,
     а не упавший набор: у результата остаётся форма, и каждое утверждение
     проваливается словами. Исходное сообщение сохраняется в `state`, чтобы
     причина не пропала. */
  const result = await quiet(() => runModelExecution({
    repoRoot: root,
    planFileName: over.planFileName ?? 'plan.json',
    approvalFileName: over.approvalFileName,
    adapters: over.adapters ?? ADAPTERS,
    resolvePortal: over.resolvePortal ?? (() => portalOf()),
    rerunPortal: (portal, options) => rerunPortalCandidates(portal, options),
    resolveCodeIdentity: over.resolveCodeIdentity ?? (() => clone(CODE_IDENTITY)),
    now: over.now ?? (() => AT),
    request: wire.request,
    env: env.env,
    promptText: over.promptText ?? PROMPT_TEXT,
    schemaObject: over.schemaObject ?? SCHEMA_OBJECT,
  })).catch((error) => ({
    state: `БРОСИЛ: ${String(error?.message ?? error)}`,
    exitCode: null, preflight: null, report: null, reportPath: null,
  }))
  return { result, env, wire }
}

/* Чтение исхода БЕЗ падения. Утверждение обязано провалиться словами, а не
   уронить набор на `null.gate`: упавший набор не печатает итога, и регрессия
   выглядит сломанным тестом. */
const gateOf = (result) => result?.preflight?.failure?.gate ?? '(отказа нет)'
/* Машинный код и фаза отказа — теми же безопасными чтениями. Разбирать текст
   сообщения потребитель не должен, поэтому код проверяется отдельно от него. */
const codeOf = (result) => result?.preflight?.failure?.code ?? '(отказа нет)'
const phaseOf = (result) => result?.preflight?.failure?.phase ?? '(отказа нет)'
/* Текст отказа — ВСЕГДА строка: `has` на `undefined` провалился бы словами о
   типе, а не о причине, и утверждение про причину читалось бы как поломка. */
const failureSaid = (result) => {
  const message = result?.preflight?.failure?.message
  return typeof message === 'string' ? message : `(текста отказа нет: ${typeof message})`
}
/* Исход одной строкой: либо состояние исполнителя, либо текст отказа сборки.
   Раньше эти случаи различались тем, бросает ли оркестратор, — а он бросать
   не обязан, и утверждение «должен был отказать» ломалось на форме. */
const outcomeOf = async (root, over) => {
  const { result } = await execution(root, over)
  return typeof result.state === 'string' ? result.state : String(result.state)
}

const executionsDir = (root) => path.join(root, 'tmp', 'poi-model-executions')
const executionCount = async (root) => {
  const dir = executionsDir(root)
  if (!existsSync(dir)) return 0
  return (await readdir(dir)).length
}

/* ═══ 0. Производитель и потребитель говорят об ОДНОМ артефакте — конверте ═
   Отчёт и конверт строит настоящий `main()`, конверт читает настоящий
   `readPlanByName()`, и тот же план получает оркестратор. Файлы между этими
   шагами не трогаются: ручная запись здесь доказательством не была бы —
   именно она и скрыла несовместимость в R0.

   R3: исполняемый артефакт — КОНВЕРТ, а не отчёт. Прежний читатель принимал
   отчёт по закрытому списку ключей и с тем же отпечатком читал `dryRun:
   false`, `startedAt` на 30 февраля и чужой `portals[]` — поля, которые никто
   не подписывал и которые ни на что не влияют. Ниже каждый контрпример
   воспроизводится на НЕИЗМЕНЁННОМ плане производителя и отвергается: не
   потому, что поле проверено, а потому, что отчёт исполняемым артефактом не
   является, а в конверте таких полей нет и быть не может. */
{
  /* Конверт читается через заместитель: если производитель его не написал,
     каждое утверждение ниже обязано провалиться словами, а не уронить набор
     на `undefined.value` — упавший набор не печатает итога. */
  const ENVELOPE = (PRODUCED.envelope !== null && typeof PRODUCED.envelope === 'object')
    ? PRODUCED.envelope
    : { contractVersion: `(конверт не прочитан: ${PRODUCED.envelope})`,
      planArtifactDigest: { value: '(конверта нет)' }, plan: { contractVersion: '(конверта нет)', portals: [] } }
  t('производитель сохранил отчёт', typeof PRODUCED.artifact, 'object')
  t('и план лежит в отчёте полем modelPlan', 'modelPlan' in PRODUCED.artifact, true)
  t('а верхний уровень отчёта — не план и не конверт',
    'contractVersion' in PRODUCED.artifact, false)
  t('отчёт больше не объявляет себя версионированным артефактом',
    'modelPlanArtifactVersion' in PRODUCED.artifact, false)
  t('производитель сохранил конверт рядом с отчётом', typeof PRODUCED.envelope, 'object')
  t('и имя конверта выводится из имени отчёта одной формулой',
    PRODUCED.envelopeName, `produced${ENVELOPE_SUFFIX}`)
  t('та же формула — публичная функция производителя',
    envelopePathFor(PRODUCED.out), path.join(PRODUCED.root, PLAN_DIR_REL, PRODUCED.envelopeName))
  t('конверт несёт ровно три поля',
    Object.keys(ENVELOPE).sort().join(','), [...ENVELOPE_KEYS].sort().join(','))
  t('и версию конверта полем', ENVELOPE.contractVersion, MODEL_PLAN_ENVELOPE_SPEC)
  t('и тот же план, что в отчёте, побайтово',
    JSON.stringify(ENVELOPE.plan), JSON.stringify(PRODUCED.artifact.modelPlan))
  t('и отпечаток артефакта плана, сходящийся с пересчётом',
    ENVELOPE.planArtifactDigest.value,
    await said(() => { throw new Error(parseAndVerifyModelPlan(ENVELOPE.plan).planArtifactDigest.value) }))
  t('в конверте нет ни времени, ни режима, ни порталов отчёта',
    ['startedAt', 'dryRun', 'portals'].some((key) => key in ENVELOPE), false)
  t('оснастка набора строит конверт той же формы, что производитель',
    JSON.stringify(envelopeOf(ENVELOPE.plan)), JSON.stringify(ENVELOPE))

  /* Чтение через обёртку: отказ обязан стать проваленной проверкой, а не
     уронить набор — упавший набор не печатает итога. */
  const readOrSay = (over) => {
    try { return readPlanByName(over) } catch (error) { return { failed: String(error?.message ?? error) } }
  }
  const read = readOrSay({ repoRoot: PRODUCED.root, planFileName: PRODUCED.envelopeName })
  t('потребитель прочитал НЕИЗМЕНЁННЫЙ конверт производителя',
    read.plan?.contractVersion ?? read.failed, ENVELOPE.plan.contractVersion)
  t('и это тот же план побайтово',
    JSON.stringify(read.plan ?? null), JSON.stringify(ENVELOPE.plan))
  t('и отпечаток артефакта — тот, что объявлен конвертом',
    read.planArtifactDigest?.value ?? read.failed, ENVELOPE.planArtifactDigest.value)

  /* Тот же конверт через оркестратор: чтение не отказало, и дело дошло до
     привязки исполнения, а не до разбора формата. Произведённый план — v1
     (профиль не запрошен), и привязка отказывает по своей, названной причине. */
  const throughRunner = await outcomeOf(PRODUCED.root, {
    planFileName: PRODUCED.envelopeName,
    approvalFileName: `${'a'.repeat(64)}.json`,
  })
  has('оркестратор на конверте производителя проходит формат и доходит до привязки',
    throughRunner, 'План v1 не исполняется')

  /* НЕИЗМЕНЁННЫЙ ОТЧЁТ производителя — не исполняемый артефакт. Не потому,
     что в нём что-то не так, а потому, что он отчёт. */
  const reportRead = readOrSay({ repoRoot: PRODUCED.root, planFileName: PRODUCED.name })
  has('неизменённый отчёт производителя отвергнут как отчёт', reportRead.failed, 'это отчёт прогона')
  has('и отказ называет конверт по имени', reportRead.failed, ENVELOPE_SUFFIX)
  has('и объясняет, почему отчёт не артефакт', reportRead.failed, 'полномочий он не несёт')

  /* Голый план — тоже не артефакт, и сказано это прямо. */
  const bareRoot = await freshRoot('bare')
  await writeFile(path.join(bareRoot, PLAN_DIR_REL, 'bare.json'), JSON.stringify(PLAN), 'utf8')
  has('голый план отвергнут с указанием конверта',
    await said(() => readPlanByName({ repoRoot: bareRoot, planFileName: 'bare.json' })),
    'это голый план')

  /* ── КОНТРПРИМЕРЫ АУДИТА R3: отчёт с ТЕМ ЖЕ подписанным планом внутри ──
     Каждый отчёт ниже несёт неизменённый план производителя — тот же
     отпечаток, что в конверте, — и «авторитетные» поля, которых никто не
     подписывал. Прежний читатель принимал их все с тем же отпечатком. */
  const signedPortals = ENVELOPE.plan.portals.map((fragment) => fragment.portalId)
  t('подписанный план называет свои порталы', signedPortals.join(','), 'bodik-osaka-tourism')
  const reportSays = async (label, mutate) => {
    const r = await freshRoot(`report-${label}`)
    const value = mutate(clone(PRODUCED.artifact))
    t(`отчёт «${label}» несёт тот же подписанный план`,
      JSON.stringify(value.modelPlan), JSON.stringify(ENVELOPE.plan))
    await writeFile(path.join(r, PLAN_DIR_REL, 'a.json'), JSON.stringify(value), 'utf8')
    has(`отчёт «${label}» отвергнут как не-артефакт`,
      await said(() => readPlanByName({ repoRoot: r, planFileName: 'a.json' })), 'это отчёт прогона')
  }
  await reportSays('30 февраля', (a) => ({ ...a, startedAt: '2026-02-30T00:00:00.000Z' }))
  await reportSays('dryRun=false', (a) => ({ ...a, dryRun: false }))
  await reportSays('пустой portals', (a) => ({ ...a, portals: [] }))
  await reportSays('чужой portalId', (a) => ({ ...a, portals: [{ portalId: 'not-the-signed-plan' }] }))
  await reportSays('порталы в другом порядке',
    (a) => ({ ...a, portals: [{ portalId: 'not-the-signed-plan' }, ...a.portals] }))
  await reportSays('дубль портала', (a) => ({ ...a, portals: [...a.portals, ...a.portals] }))
  await reportSays('контрпример аудита целиком', (a) => ({
    ...a, dryRun: false, startedAt: '2026-02-30T00:00:00.000Z', portals: [{ portalId: 'not-the-signed-plan' }],
  }))

  /* ── ТЕ ЖЕ ПОЛЯ, ПОДСУНУТЫЕ В КОНВЕРТ ─────────────────────────────────
     В конверте им места нет: четвёртое поле — отказ по имени, а не проверка
     по смыслу. Момент времени и набор порталов остаются только в плане, где
     они подписаны и проверяются его собственным разбором. */
  const envelopeSays = async (label, mutate, needle) => {
    const r = await freshRoot(`envelope-${label}`)
    const value = mutate(clone(ENVELOPE))
    await writeFile(path.join(r, PLAN_DIR_REL, 'a.json'), JSON.stringify(value), 'utf8')
    has(`конверт: ${label}`,
      await said(() => readPlanByName({ repoRoot: r, planFileName: 'a.json' })), needle)
  }
  await envelopeSays('startedAt на 30 февраля подсунут',
    (e) => ({ ...e, startedAt: '2026-02-30T00:00:00.000Z' }), 'лишние поля startedAt')
  await envelopeSays('dryRun=false подсунут', (e) => ({ ...e, dryRun: false }), 'лишние поля dryRun')
  await envelopeSays('чужие portals подсунуты',
    (e) => ({ ...e, portals: [{ portalId: 'not-the-signed-plan' }] }), 'лишние поля portals')
  await envelopeSays('modelPlan рядом с plan',
    (e) => ({ ...e, modelPlan: e.plan }), 'это отчёт прогона')

  /* ── ВНЕШНЯЯ АВТОРИТЕТНАЯ ЧАСТЬ КОНВЕРТА изменена, разрешение — нет ────
     Объявленный отпечаток — предмет проверки: он пересчитывается из плана.
     Конверт, объявляющий один отпечаток и несущий план с другим, не
     принадлежит ни одному артефакту. */
  await envelopeSays('объявленный отпечаток заменён',
    (e) => ({ ...e, planArtifactDigest: { ...e.planArtifactDigest, value: `sha256:${'f'.repeat(64)}` } }),
    'принадлежат разным артефактам')
  await envelopeSays('план подменён при прежнем отпечатке',
    (e) => ({ ...e, plan: clone(PLAN) }), 'принадлежат разным артефактам')
  await envelopeSays('план подменён вместе с отпечатком, но подпись плана сломана',
    (e) => {
      const broken = clone(PLAN)
      broken.taxonomyVersion = 'poi-taxonomy/v3'
      return { ...e, plan: broken, planArtifactDigest: clone(parseAndVerifyModelPlan(PLAN).planArtifactDigest) }
    }, 'planDigest не сходится')
  {
    /* Конверт пересобран ЦЕЛИКОМ и честно под другой план, а разрешение
       осталось от прежнего: читатель конверт принимает — и правильно, он
       цел, — а ворота разрешения отказывают. Полномочие живёт в разрешении,
       конверт его не выдаёт. */
    const r = await freshRoot('envelope-reissued')
    const approvalName = await writeApproval(r)
    await writePlan(r, fixturePlan('plan-entrypoint-reissued'))
    const reissued = readOrSay({ repoRoot: r, planFileName: 'plan.json' })
    t('пересобранный конверт сам по себе цел и читается',
      reissued.plan?.planId ?? reissued.failed, 'plan-entrypoint-reissued')
    const after = await execution(r, { approvalFileName: approvalName })
    t('конверт под другой план при прежнем разрешении отвергнут', after.result.state, 'refused')
    t('и это отказ разрешения', after.result.exitCode, EXIT_CODES.preflightApprovalRejected)
    t('и отказали ворота привязки разрешения', gateOf(after.result), 'P4')
    t('и провод не вызывался', after.wire.calls, 0)
    t('и журнал не открывался', await executionCount(r), 0)
  }

  /* ── ЗАКРЫТАЯ ФОРМА КОНВЕРТА: контрпримеры по каждому полю ────────────── */
  await envelopeSays('только plan', (e) => ({ plan: e.plan }),
    'нет обязательных полей contractVersion, planArtifactDigest')
  await envelopeSays('лишний ключ', (e) => ({ ...e, лишнее: 1 }), 'лишние поля лишнее')
  await envelopeSays('версия не та',
    (e) => ({ ...e, contractVersion: 'poi-model-plan-envelope/v2' }), 'ожидается «poi-model-plan-envelope/v1»')
  await envelopeSays('версия прежнего файла-отчёта вместо версии конверта',
    (e) => ({ ...e, contractVersion: 'poi-model-plan-file/v1' }), 'ожидается «poi-model-plan-envelope/v1»')
  await envelopeSays('отпечаток не sha256',
    (e) => ({ ...e, planArtifactDigest: { ...e.planArtifactDigest, value: 'sha256:xyz' } }),
    'ровно 64 строчных hex-знака')
  await envelopeSays('отпечаток чужого домена',
    (e) => ({ ...e, planArtifactDigest: { ...e.planArtifactDigest, spec: 'poi-model-plan/v2' } }),
    'planArtifactDigest.spec')
  await envelopeSays('отпечаток строкой',
    (e) => ({ ...e, planArtifactDigest: e.planArtifactDigest.value }), 'ожидается простой объект')
  await envelopeSays('plan строкой', (e) => ({ ...e, plan: 'строка' }), 'не содержит плана')
  await envelopeSays('plan массивом', (e) => ({ ...e, plan: [] }), 'не содержит плана')

  /* Accessor, унаследованное, символьное и неперечисляемое — на ПУБЛИЧНОЙ
     функции, а не через файл: JSON их не переносит, а публичная граница обязана
     отвергать и такой вход. Отвергает их тот же канонический проход, что
     подписывает план, — своего второго списка правил у конверта нет. */
  const good = () => clone(ENVELOPE)
  const withAccessor = good()
  Object.defineProperty(withAccessor, 'plan', { get() { return PLAN }, enumerable: true, configurable: true })
  has('форма конверта: accessor вместо значения',
    await said(() => parsePlanEnvelope(withAccessor, 'проба')), 'accessor-свойство не сериализуется')

  const inherited = Object.create({ contractVersion: MODEL_PLAN_ENVELOPE_SPEC })
  Object.assign(inherited, { planArtifactDigest: good().planArtifactDigest, plan: good().plan })
  has('форма конверта: унаследованная версия не считается своей',
    await said(() => parsePlanEnvelope(inherited, 'проба')), 'только простые объекты')

  const withSymbol = good()
  withSymbol[Symbol('скрытое')] = 1
  has('форма конверта: символьное свойство отвергнуто',
    await said(() => parsePlanEnvelope(withSymbol, 'проба')), 'символьные ключи не сериализуются')

  const hidden = good()
  Object.defineProperty(hidden, 'dryRun', { value: false, enumerable: false, configurable: true })
  has('форма конверта: неперечисляемое поле отвергнуто',
    await said(() => parsePlanEnvelope(hidden, 'проба')), 'неперечисляемое собственное свойство')

  has('форма конверта: массив', await said(() => parsePlanEnvelope([1], 'проба')),
    'обязан быть объектом-конвертом')
  has('форма конверта: null', await said(() => parsePlanEnvelope(null, 'проба')),
    'обязан быть объектом-конвертом')

  /* ── ПРОИЗВОДИТЕЛЬ: имя конверта и порядок записи ─────────────────────── */
  has('--out с суффиксом конверта отвергается формулой имени',
    await said(() => envelopePathFor(path.join('tmp', 'poi-model-plans', 'x.envelope.json'))),
    'зарезервировано за исполняемым конвертом')
  const producerRun = async (root, out, extra = {}) => {
    const calls = { adapter: 0, persisted: [] }
    const message = await said(() => quiet(() => main(
      ['node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism', '--model-plan', '--out', out],
      {
        adapters: { 'opendata-csv': async () => { calls.adapter += 1; return { candidates: [], meta: {} } } },
        resolveCodeIdentity: () => clone(CODE_IDENTITY),
        repoRoot: root,
        ...extra,
      },
    )))
    return { calls, message }
  }
  {
    const r = await freshRoot('producer-suffix')
    const { calls, message } = await producerRun(r, path.join(r, PLAN_DIR_REL, 'x.envelope.json'))
    has('--out с суффиксом конверта отвергнут производителем', message, 'зарезервировано за исполняемым конвертом')
    t('суффикс конверта в --out: до адаптера дело не дошло', calls.adapter, 0)
  }
  {
    const r = await freshRoot('producer-busy')
    await writeFile(path.join(r, PLAN_DIR_REL, 'y.envelope.json'), '{}', 'utf8')
    const { calls, message } = await producerRun(r, path.join(r, PLAN_DIR_REL, 'y.json'))
    has('занятое имя конверта останавливает прогон', message, 'Конверт плана не перезаписывается')
    t('занятое имя конверта: до адаптера дело не дошло', calls.adapter, 0)
    t('и отчёт не записан', existsSync(path.join(r, PLAN_DIR_REL, 'y.json')), false)
  }
  {
    const r = await freshRoot('producer-order')
    const persisted = []
    const { message } = await producerRun(r, path.join(r, PLAN_DIR_REL, 'z.json'), {
      persistReport: async (outPath, body, options) => { persisted.push({ outPath, body, options }) },
    })
    t('производитель прошёл до конца', message, '(без ошибки)')
    t('писатель вызван дважды: отчёт и конверт', persisted.length, 2)
    t('первым — отчёт', persisted[0]?.outPath, path.join(r, PLAN_DIR_REL, 'z.json'))
    t('и он эксклюзивен', persisted[0]?.options?.mode, 'exclusive')
    t('вторым — конверт', persisted[1]?.outPath, path.join(r, PLAN_DIR_REL, `z${ENVELOPE_SUFFIX}`))
    t('и он эксклюзивен', persisted[1]?.options?.mode, 'exclusive')
    t('и назван конвертом, а не отчётом', persisted[1]?.options?.names?.nominative, 'Конверт плана')
    t('и конверт несёт план отчёта побайтово',
      JSON.stringify(persisted[1]?.body?.plan ?? null), JSON.stringify(persisted[0]?.body?.modelPlan ?? null))
    t('и ровно три поля', Object.keys(persisted[1]?.body ?? {}).sort().join(','), [...ENVELOPE_KEYS].sort().join(','))
  }
  {
    const r = await freshRoot('producer-report-failed')
    const persisted = []
    const { message } = await producerRun(r, path.join(r, PLAN_DIR_REL, 'w.json'), {
      persistReport: async (outPath) => { persisted.push(outPath); throw new Error('диск отказал') },
    })
    has('отказ записи отчёта поднимается наружу', message, 'диск отказал')
    t('и конверт без отчёта не пишется', persisted.length, 1)
  }
}

/* ═══ 1. Обычный режим коллектора: ни исполнителя, ни секрета, ни провода ══ */
{
  const env = countingEnv(CREDENTIAL_ENV)
  const wire = wireOf()
  const report = await quiet(() => main(
    ['node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism'],
    {
      adapters: { 'opendata-csv': async () => ({ candidates: [], meta: {} }) },
      request: wire.request,
      env: env.env,
    },
  ))
  t('обычный прогон исполнителя не запускает', report?.modelExecution ?? null, null)
  t('и провод не вызывался', wire.calls, 0)
  t('и окружение не читалось', env.reads, 0)
}

/* ═══ 2. Неполные и несовместимые аргументы — до любых эффектов ═══════════ */
{
  const env = countingEnv(CREDENTIAL_ENV)
  const wire = wireOf()
  const deps = { adapters: ADAPTERS, request: wire.request, env: env.env }
  const cases = [
    [['--model-execute'], '--model-execute требует --model-plan-file и --model-approval'],
    [['--model-execute', '--model-plan-file', 'plan.json'], '--model-execute требует --model-approval'],
    [['--model-execute', '--model-plan-file', 'p.json', '--model-approval', 'a.json', '--write'],
      '--model-execute несовместим с --write'],
    /* `--dry-write` ставит два поля разом, поэтому в сообщении оба флага:
       проверяется наличие своего, а не точный текст всего списка. */
    [['--model-execute', '--model-plan-file', 'p.json', '--model-approval', 'a.json', '--dry-write'],
      '--dry-write'],
    [['--model-execute', '--model-plan-file', 'p.json', '--model-approval', 'a.json', '--model-plan'],
      '--model-execute несовместим с --model-plan'],
    [['--model-execute', '--model-plan-file', 'p.json', '--model-approval', 'a.json', '--limit', '5'],
      '--model-execute несовместим с --limit'],
    [['--model-execute', '--model-plan-file', 'p.json', '--model-approval', 'a.json', '--existing', 'e.json'],
      '--model-execute несовместим с --existing'],
    [['--model-execute', '--model-plan-file', 'p.json', '--model-approval', 'a.json', '--monitor', 'm.json'],
      '--model-execute несовместим с --monitor'],
    [['--model-execute', '--model-plan-file', 'p.json', '--model-approval', 'a.json', '--out', 'o.json'],
      '--model-execute несовместим с --out'],
    [['--model-execute', '--model-plan-file', 'p.json', '--model-approval', 'a.json', '--all'],
      '--model-execute несовместим с --all'],
    /* ЯВНЫЙ ФЛАГ СО ЗНАЧЕНИЕМ ПО УМОЛЧАНИЮ. `--samples 8` ставит ровно
       умолчание, и по значениям его от «флага не было» не отличить: прежняя
       редакция сравнивала значения и пропускала его в режим исполнения. */
    [['--model-execute', '--model-plan-file', 'p.json', '--model-approval', 'a.json', '--samples', '8'],
      '--model-execute несовместим с --samples'],
    [['--model-execute', '--model-plan-file', 'p.json', '--model-approval', 'a.json', '--samples', '99'],
      '--model-execute несовместим с --samples'],
    [['--model-execute', '--model-execute', '--model-plan-file', 'p.json', '--model-approval', 'a.json'],
      '--model-execute указан дважды'],
    [['--model-execute', '--model-plan-file', 'p.json', '--model-plan-file', 'q.json', '--model-approval', 'a.json'],
      '--model-plan-file указан дважды'],
    [['--model-execute', '--model-plan-file', '', '--model-approval', 'a.json'],
      '--model-plan-file требует значения'],
    [['--model-execute', '--model-plan-file', 'p.json', '--model-approval', ''],
      '--model-approval требует значения'],
    [['--model-plan-file', 'p.json'], '--model-plan-file имеет смысл только с --model-execute'],
    [['--model-execute', '--model-plan-file', 'p.json', '--model-approval', 'a.json', '--неизвестный'],
      'Неизвестный аргумент: --неизвестный'],
  ]
  for (const [argv, needle] of cases) {
    const message = await said(() => quiet(() => main(['node', 'collect-pois.mjs', ...argv], deps)))
    has(`отказ на «${argv.join(' ')}»`, message, needle)
  }
  t('ни один отказ аргументов не тронул провод', wire.calls, 0)
  t('и ни один не прочитал окружение', env.reads, 0)
}

/* ═══ 3. Произвольный путь к плану не принимается ═════════════════════════ */
{
  const root = await freshRoot('paths')
  await writePlan(root, PLAN)
  const approvalName = await writeApproval(root)
  for (const name of [
    '../../../etc/passwd', 'sub/plan.json', '/etc/passwd', 'plan.JSON', 'plan.json.bak',
    '..', '.', 'план.json',
  ]) {
    const message = await outcomeOf(root, { planFileName: name, approvalFileName: approvalName })
    has(`имя конверта «${name}» отвергнуто`, message, '--model-plan-file: ожидается имя конверта')
  }
  t('и ни одного исполнения при этом не открылось', await executionCount(root), 0)
}

/* ═══ 4. План: форма, подпись, срок, чужая идентичность кода ══════════════ */
{
  const root = await freshRoot('plan')
  const approvalName = await writeApproval(root)

  await writeFile(path.join(root, PLAN_DIR_REL, 'broken.json'), '{ не json', 'utf8')
  has('конверт, не разбирающийся как JSON, отвергнут',
    await outcomeOf(root, { planFileName: 'broken.json', approvalFileName: approvalName }),
    'конверт плана не разбирается как JSON')

  const tampered = clone(PLAN)
  tampered.portals[0].plannedItemCount += 1
  await writePlan(root, tampered, 'tampered.json')
  const tamperedSaid = await outcomeOf(root, { planFileName: 'tampered.json', approvalFileName: approvalName })
  has('подделанный план не проходит собственный разбор', tamperedSaid, 'БРОСИЛ')

  /* Настоящий план v1: тот же builder, но без профиля. Файл-фикстура из
     каталога планов сюда не годится — она хранит фрагмент, а не артефакт. */
  /* Портал с ЗАПРЕЩАЮЩЕЙ policy: план v1 диагностический, и разрешённое
     состояние policy он не принимает вовсе. */
  const deniedPortal = portalOf({
    modelProcessing: {
      purpose: 'classification', allowedProviders: [], fields: [],
      decisionRef: null, reviewedAt: null, validUntil: null,
    },
  })
  const v1 = buildModelPlan({
    fragments: [buildPortalPlanFragment({ portal: deniedPortal, evaluated, now: NOW, providerProfile: null })],
    selectedPortalIds: [PORTAL_ID],
    meta: {
      planId: 'plan-entrypoint-v1',
      createdAt: '2026-08-18T00:00:00.000Z',
      deleteAfter: '2026-08-25T00:00:00.000Z',
      codeIdentity: clone(CODE_IDENTITY),
      taxonomyVersion: 'poi-taxonomy/v2',
      taxonomyBytes: Buffer.from('{"version":"poi-taxonomy/v2"}\n', 'utf8'),
      taxonomySpec: 'raw-file-bytes/v1',
      promptText: PROMPT_TEXT,
      schemaObject: SCHEMA_OBJECT,
      providerProfile: null,
    },
  })
  await writePlan(root, v1, 'v1.json')
  has('план v1 исполнять нечем',
    await outcomeOf(root, { planFileName: 'v1.json', approvalFileName: approvalName }),
    'План v1 не исполняется')

  const unknownProfile = clone(PLAN)
  unknownProfile.providerProfile = { id: 'openai-responses-luna', version: '9.9.9' }
  await writePlan(root, unknownProfile, 'unknown-profile.json')
  const unknownSaid = await outcomeOf(root, { planFileName: 'unknown-profile.json', approvalFileName: approvalName })
  has('план с несуществующей версией профиля не исполняется', unknownSaid, 'БРОСИЛ')

  /* ПРОФИЛЬ-ДВОЙНИК: та же пара id@version, что в каноническом реестре, но
     другое содержимое. План при этом внутренне согласован — отпечаток посчитан
     от двойника, — и отличить его от настоящего можно ТОЛЬКО сверив отпечаток
     реестра с отпечатком плана. Без этой сверки разрешение, выданное под один
     профиль, исполнялось бы под другим. */
  const twin = { ...clone(PROFILE), apiVersion: '2026-01-01' }
  const twinPlan = buildModelPlan({
    fragments: [buildPortalPlanFragment({ portal: portalOf(), evaluated, now: NOW, providerProfile: twin })],
    selectedPortalIds: [PORTAL_ID],
    meta: {
      planId: 'plan-entrypoint-twin',
      createdAt: '2026-08-18T00:00:00.000Z',
      deleteAfter: '2026-08-25T00:00:00.000Z',
      codeIdentity: clone(CODE_IDENTITY),
      taxonomyVersion: 'poi-taxonomy/v2',
      taxonomyBytes: Buffer.from('{"version":"poi-taxonomy/v2"}\n', 'utf8'),
      taxonomySpec: 'raw-file-bytes/v1',
      promptText: PROMPT_TEXT,
      schemaObject: SCHEMA_OBJECT,
      providerProfile: twin,
    },
  })
  await writePlan(root, twinPlan, 'twin-profile.json')
  const twinApproval = await writeApproval(root, { plan: twinPlan })
  has('профиль-двойник с тем же id@version отвергнут по отпечатку',
    await outcomeOf(root, { planFileName: 'twin-profile.json', approvalFileName: twinApproval }),
    'не совпадает с отпечатком в плане')

  await writePlan(root, PLAN)
  const dirty = await execution(root, {
    approvalFileName: approvalName,
    resolveCodeIdentity: () => ({ commit: '1'.repeat(40), dirty: false }),
  })
  t('чужая идентичность кода останавливает прогон', dirty.result.state, 'refused')
  t('и это ворота P5', gateOf(dirty.result), 'P5')
  t('и провод не вызывался', dirty.wire.calls, 0)
  t('и окружение не читалось', dirty.env.reads, 0)
  t('и журнал не открывался', await executionCount(root), 0)

  const dirtyTree = await execution(root, {
    approvalFileName: approvalName,
    resolveCodeIdentity: () => ({ commit: CODE_IDENTITY.commit, dirty: true }),
  })
  t('грязное дерево останавливает прогон', dirtyTree.result.state, 'refused')
  t('и провод не вызывался', dirtyTree.wire.calls, 0)
}

/* ═══ 5. Разрешение: отсутствует, повреждено, просрочено, не про этот план ═ */
{
  const root = await freshRoot('approval')
  await writePlan(root, PLAN)

  const missing = await execution(root, { approvalFileName: `${'a'.repeat(64)}.json` })
  t('отсутствующее разрешение останавливает прогон', missing.result.state, 'refused')
  t('и код возврата — отказ разрешения', missing.result.exitCode, EXIT_CODES.preflightApprovalRejected)
  t('и провод не вызывался', missing.wire.calls, 0)
  t('и окружение не читалось', missing.env.reads, 0)
  t('и журнал не открывался', await executionCount(root), 0)

  /* ПРОИЗВОЛЬНЫЙ ПУТЬ К РАЗРЕШЕНИЮ: причина отказа читается ИМЕНОВАННОЙ, из
     `preflight.failure` ТОГО ЖЕ исполнения.

     Прежняя редакция звала оркестратор вторым разом и сверяла его исход с
     ПУСТОЙ строкой (`has(…, '')`): такое утверждение проходит на любом
     тексте, включая «(без ошибки)», — то есть проверка существовала на вид, а
     проверяла ничто, и лишний прогон исполнялся ради этого «ничто». Теперь
     исполнение одно, и по нему сверяются четыре независимые величины: ворота,
     машинный код, фаза и текст. Код проверяется ОТДЕЛЬНО от текста намеренно:
     разбирать сообщение потребитель не должен, а сообщение — единственное
     место, где видно, что имя отвергнуто именно как путь. */
  const outsideRoot = await execution(root, { approvalFileName: '../../../etc/passwd' })
  t('разрешение вне корня отвергнуто', outsideRoot.result.state, 'refused')
  t('и это отказ разрешения', outsideRoot.result.exitCode, EXIT_CODES.preflightApprovalRejected)
  t('и отказали ворота разрешения', gateOf(outsideRoot.result), 'P4')
  t('и машинный код отказа назван', codeOf(outsideRoot.result), PREFLIGHT_CODES.approvalRejected)
  t('и отказ случился до обращения к источникам', phaseOf(outsideRoot.result), PREFLIGHT_PHASES[0])
  has('и причина названа: путь именем разрешения не задаётся',
    failureSaid(outsideRoot.result), 'путь именем не задаётся')
  has('и отказ называет отвергнутое имя целиком',
    failureSaid(outsideRoot.result), '../../../etc/passwd')
  t('и провод при этом не вызывался', outsideRoot.wire.calls, 0)
  t('и окружение не читалось', outsideRoot.env.reads, 0)
  t('и журнал не открывался', await executionCount(root), 0)

  const good = await writeApproval(root)
  const corruptPath = path.join(root, 'tmp', 'poi-model-approvals', good)
  await writeFile(corruptPath, '{ повреждено', 'utf8')
  const corrupt = await execution(root, { approvalFileName: good })
  t('повреждённое разрешение отвергнуто', corrupt.result.state, 'refused')
  t('и это отказ разрешения', corrupt.result.exitCode, EXIT_CODES.preflightApprovalRejected)

  const expiredRoot = await freshRoot('approval-expired')
  await writePlan(expiredRoot, PLAN)
  const expiredName = await writeApproval(expiredRoot, {
    overrides: { createdAt: '2026-08-18T00:00:00.000Z', validUntil: '2026-08-18T12:00:00.000Z' },
  })
  const expired = await execution(expiredRoot, { approvalFileName: expiredName })
  t('просроченное разрешение останавливает прогон', expired.result.state, 'refused')
  t('и код возврата — отказ разрешения', expired.result.exitCode, EXIT_CODES.preflightApprovalRejected)
  t('и провод не вызывался', expired.wire.calls, 0)

  const otherRoot = await freshRoot('approval-other-plan')
  const otherPlan = buildModelPlan({
    fragments: [buildPortalPlanFragment({
      portal: portalOf(), evaluated, now: NOW, providerProfile: PROFILE,
    })],
    selectedPortalIds: [PORTAL_ID],
    meta: {
      planId: 'plan-entrypoint-other',
      createdAt: '2026-08-18T00:00:00.000Z',
      deleteAfter: '2026-08-25T00:00:00.000Z',
      codeIdentity: clone(CODE_IDENTITY),
      taxonomyVersion: 'poi-taxonomy/v2',
      taxonomyBytes: Buffer.from('{"version":"poi-taxonomy/v2"}\n', 'utf8'),
      taxonomySpec: 'raw-file-bytes/v1',
      promptText: PROMPT_TEXT,
      schemaObject: SCHEMA_OBJECT,
      providerProfile: PROFILE,
    },
  })
  await writePlan(otherRoot, PLAN)
  const foreignApproval = await writeApproval(otherRoot, { plan: otherPlan })
  const mismatch = await execution(otherRoot, { approvalFileName: foreignApproval })
  t('разрешение от другого плана отвергнуто', mismatch.result.state, 'refused')
  t('и это отказ разрешения', mismatch.result.exitCode, EXIT_CODES.preflightApprovalRejected)
  t('и журнал не открывался', await executionCount(otherRoot), 0)
}

/* ═══ 6. Policy источника запрещает исполнение ════════════════════════════ */
{
  const root = await freshRoot('policy')
  await writePlan(root, PLAN)
  const approvalName = await writeApproval(root)
  const denied = await execution(root, {
    approvalFileName: approvalName,
    resolvePortal: () => portalOf({
      modelProcessing: {
        purpose: 'classification',
        allowedProviders: [],
        fields: [],
        decisionRef: null,
        reviewedAt: null,
        validUntil: null,
      },
    }),
  })
  t('запрещающая policy останавливает прогон', denied.result.state, 'refused')
  t('и это ворота P7', gateOf(denied.result), 'P7')
  t('и провод не вызывался', denied.wire.calls, 0)
  t('и окружение не читалось', denied.env.reads, 0)
  t('и журнал не открывался', await executionCount(root), 0)
}

/* ═══ 7. Набор порталов и кандидатов изменился ════════════════════════════ */
{
  const root = await freshRoot('drift')
  await writePlan(root, PLAN)
  const approvalName = await writeApproval(root)

  const vanished = await execution(root, { approvalFileName: approvalName, resolvePortal: () => null })
  t('исчезнувший портал останавливает прогон', vanished.result.state, 'refused')
  t('и это ворота P8', gateOf(vanished.result), 'P8')
  t('и провод не вызывался', vanished.wire.calls, 0)

  const shifted = await execution(root, {
    approvalFileName: approvalName,
    adapters: { fake: async () => ({ candidates: clone(awaiting).slice(1), meta: {} }) },
  })
  t('изменившийся набор кандидатов останавливает прогон', shifted.result.state, 'refused')
  t('и провод не вызывался', shifted.wire.calls, 0)
  t('и журнал не открывался', await executionCount(root), 0)
}

/* ═══ 8. Бюджет превышен ══════════════════════════════════════════════════ */
{
  const root = await freshRoot('budget')
  await writePlan(root, PLAN)
  const tight = await writeApproval(root, { limits: { ...clone(LIMITS), maxCostMicros: 1 } })
  const over = await execution(root, { approvalFileName: tight })
  t('превышенный бюджет останавливает прогон', over.result.state, 'refused')
  t('и это ворота P11', gateOf(over.result), 'P11')
  t('и провод не вызывался', over.wire.calls, 0)
  t('и окружение не читалось', over.env.reads, 0)
  t('и журнал не открывался', await executionCount(root), 0)
}

/* ═══ 9. Полностью валидная фикстура доходит до исполнителя ═══════════════ */
{
  const root = await freshRoot('happy')
  await writePlan(root, PLAN)
  const approvalName = await writeApproval(root)
  const { result, wire, env } = await execution(root, { approvalFileName: approvalName })

  t('исполнение закрыто', result.state, 'closed')
  t('и код возврата — успех', result.exitCode, EXIT_CODES.allAccepted)
  t('preflight принял все ворота', result.preflight?.ok ?? '(preflight не отработал)', true)
  t('провод вызван ровно по числу разрешённых элементов', wire.calls, TOTAL)
  t('и окружение прочитано ровно столько же раз', env.reads, TOTAL)
  t('журнал исполнения создан ровно один', await executionCount(root), 1)

  /* Дальше читается настоящий каталог исполнения. Если исполнения не было,
     утверждения обязаны провалиться словами, а не уронить набор на `null`:
     упавший набор не печатает итога, и регрессия выглядит сломанным тестом. */
  const executionId = typeof result.preflight?.executionId === 'string' ? result.preflight.executionId : null
  t('идентификатор исполнения получен', typeof executionId, 'string')
  const dir = executionId === null ? null : path.join(executionsDir(root), executionId)
  const segments = dir === null ? [] : await readdir(dir)
  t('в каталоге исполнения есть журнал и отчёт',
    segments.includes('report.json') && segments.some((n) => n.endsWith('.jsonl')), true)
  const report = segments.includes('report.json')
    ? JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8'))
    : { contractVersion: '(отчёта нет)', items: [] }
  t('отчёт исполнения назван своим контрактом', report.contractVersion.startsWith('poi-model-execution-report/'), true)
  t('и покрывает все элементы', report.items.length, TOTAL)

  const journalName = segments.find((n) => n.endsWith('.jsonl')) ?? null
  const journal = journalName === null ? '' : await readFile(path.join(dir, journalName), 'utf8')
  t('журнал непустой', journal.split('\n').filter(Boolean).length > TOTAL, true)
  t('секрет в журнал не попал', journal.includes(CREDENTIAL_ENV.POI_MODEL_EXECUTION_OPENAI_API_KEY), false)
  t('и в отчёт исполнения тоже',
    JSON.stringify(report).includes(CREDENTIAL_ENV.POI_MODEL_EXECUTION_OPENAI_API_KEY), false)

  const authorizations = wire.seen.map((call) => call.headers?.authorization ?? '')
  t('провод получил заголовок с учётными данными', authorizations.every((v) => v.startsWith('Bearer ')), true)
  t('и ходил ровно по адресу профиля',
    wire.seen.every((call) => call.url === PROFILE.endpoint), true)
}

/* ═══ 10. Настоящий процесс: код возврата доходит точным ══════════════════ */
{
  const cli = path.join(REPO, 'scripts', 'poi-portals', 'collect-pois.mjs')
  const exitOf = async (argv, options = {}) => {
    try {
      await run(process.execPath, argv, { cwd: REPO, timeout: 120_000, ...options })
      return 0
    } catch (error) {
      return typeof error.code === 'number' ? error.code : -1
    }
  }

  /* Настоящий CLI, без единого файла: эти ветки ничего не читают и ничего не
     оставляют после себя. */
  t('обычный отказ аргументов даёт единицу',
    await exitOf([cli, '--model-execute']), 1)
  t('отсутствующий план даёт единицу',
    await exitOf([cli, '--model-execute', '--model-plan-file', 'нет.json',
      '--model-approval', `${'a'.repeat(64)}.json`]), 1)
  t('справка даёт ноль', await exitOf([cli, '--help']), 0)

  /* ТОЧНЫЙ КОД ВОРОТ — в ИЗОЛИРОВАННОМ корне.
     Прежняя редакция клала план в настоящий `tmp/poi-model-plans/` и надеялась
     убрать его за собой; в средах, где удаление запрещено, остаток переживал
     прогон и второй запуск падал на EPERM. Набор, который нельзя запустить
     дважды, доказательством не является.

     Оснастка — не копия production-логики: драйвер зовёт ТЕ ЖЕ
     `main()` и `applyModelExecutionExitCode()`, что и запуск внизу
     `collect-pois.mjs`, и отличается только корнем артефактов, который у
     `main()` и так параметр. Разрешение не создаётся: проверяется именно его
     отсутствие. */
  const root = await freshRoot('process')
  await writePlan(root, PLAN)
  /* Драйвер зовёт ОДНУ production-функцию запуска — ту же, что и блок точки
     входа внизу `collect-pois.mjs`. Своей копии then/catch у него нет: копия
     проверяла бы копию, и мутация настоящего вызова прошла бы мимо. */
  const driver = path.join(root, 'driver.mjs')
  await writeFile(driver, [
    `import { runCli } from ${JSON.stringify(path.join(REPO, 'scripts/poi-portals/collect-pois.mjs'))}`,
    'await runCli(process.argv, { repoRoot: process.env.JJ_ROOT })',
  ].join('\n'), 'utf8')

  const gateCode = await exitOf(
    [driver, '--model-execute', '--model-plan-file', 'plan.json',
      '--model-approval', `${'a'.repeat(64)}.json`],
    { env: { ...process.env, JJ_ROOT: root } },
  )
  t('отказ ворот доходит до процесса своим кодом', gateCode, EXIT_CODES.preflightApprovalRejected)
  /* Та же функция, но в процессе НАБОРА и с подставным `target`: перевод кода
     возврата проверяется напрямую, без ожидания дочернего процесса. */
  const box = { exitCode: 0 }
  await quiet(() => runCli(
    ['node', 'collect-pois.mjs', '--model-execute', '--model-plan-file', 'plan.json',
      '--model-approval', `${'a'.repeat(64)}.json`],
    { repoRoot: root }, box,
  ))
  t('и runCli выставляет тот же код своему target', box.exitCode, EXIT_CODES.preflightApprovalRejected)
  const okBox = { exitCode: 0 }
  await quiet(() => runCli(['node', 'collect-pois.mjs', '--model-execute'], {}, okBox))
  t('а отказ разбора аргументов — единицу', okBox.exitCode, 1)
  t('и это не единица и не ноль',
    EXIT_CODES.preflightApprovalRejected !== 0 && EXIT_CODES.preflightApprovalRejected !== 1, true)
}

/* ═══ 10а. runCli fail-closed на ЛЮБОМ брошенном значении ═════════════════
   Прежний перехват читал `error.message` напрямую. `throw null` и
   `throw undefined` роняли сам перехват («Cannot read properties of null»),
   а бросающий getter, Proxy с бросающей ловушкой и отозванный Proxy выносили
   своё исключение мимо него — процесс завершался не единицей, а
   необработанным отказом, и код возврата оставался нулём.

   Здесь каждое значение бросается из НАСТОЯЩЕЙ зависимости настоящего
   `main()` и проходит через настоящий `runCli`: ни одно не покидает его, код
   возврата — единица, чужой текст на stderr не попадает, эффектов после
   отказа нет. Описание даёт общий `describeThrownSafely`: всё, для чего
   безопасного текста нет, описывается типом. */
{
  const FOREIGN_TEXT = ['ЯД-ИЗ-ГЕТТЕРА', 'ЛОВУШКА', 'ЧУЖОЕ-ОПИСАНИЕ', 'секретное-сообщение']
  const trapProxy = () => new Proxy({}, {
    get() { throw new Error('ЛОВУШКА') },
    getOwnPropertyDescriptor() { throw new Error('ЛОВУШКА') },
    getPrototypeOf() { throw new Error('ЛОВУШКА') },
    has() { throw new Error('ЛОВУШКА') },
    ownKeys() { throw new Error('ЛОВУШКА') },
  })
  const hostile = [
    ['null', () => null, 'null'],
    ['undefined', () => undefined, 'undefined'],
    ['Symbol', () => Symbol('ЧУЖОЕ-ОПИСАНИЕ'), 'symbol'],
    ['getter message бросает', () => {
      const error = new Error('секретное-сообщение')
      Object.defineProperty(error, 'message', {
        get() { throw new Error('ЯД-ИЗ-ГЕТТЕРА') }, configurable: true, enumerable: false,
      })
      return error
    }, 'object'],
    ['отозванный Proxy', () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy }, 'object'],
    ['Proxy с бросающей ловушкой', trapProxy, 'object'],
  ]
  /* stderr собирается целиком; stdout гасится. Аргумент печати — всегда
     строка с префиксом, и `String` здесь приводит строку, а не чужое значение. */
  const captured = async (fn) => {
    const [e, l] = [console.error, console.log]
    const lines = []
    console.error = (...args) => { lines.push(args.map((arg) => (typeof arg === 'string' ? arg : typeof arg)).join(' ')) }
    console.log = () => {}
    try { return { value: await fn(), lines } } finally { console.error = e; console.log = l }
  }
  const leaked = (lines) => FOREIGN_TEXT.filter((needle) => lines.join('\n').includes(needle)).join(',')

  /* ── Плановый режим: бросок — первая зависимость после разбора аргументов,
     до адаптера, до отчёта и до конверта. Значение доходит до runCli как есть. */
  for (const [label, make, kind] of hostile) {
    const r = await freshRoot(`hostile-plan-${label}`)
    const out = path.join(r, PLAN_DIR_REL, 'hostile.json')
    const calls = { adapter: 0 }
    const box = { exitCode: 0 }
    let escaped = '(не покинуло)'
    const { value, lines } = await captured(() => runCli(
      ['node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism', '--model-plan', '--out', out],
      {
        adapters: { 'opendata-csv': async () => { calls.adapter += 1; return { candidates: [], meta: {} } } },
        resolveCodeIdentity: () => { throw make() },
        repoRoot: r,
      },
      box,
    ).catch((thrown) => { escaped = `ПОКИНУЛО: значение типа ${thrown === null ? 'null' : typeof thrown}`; return null }))
    t(`план, ${label}: исключение не покинуло runCli`, escaped, '(не покинуло)')
    t(`план, ${label}: exitCode единица`, box.exitCode, 1)
    t(`план, ${label}: runCli вернул единицу`, value, 1)
    t(`план, ${label}: stderr — ровно описание типом`, lines.join('\n'), `[poi-portals] брошено значение типа ${kind}`)
    t(`план, ${label}: чужой текст не вышел`, leaked(lines), '')
    t(`план, ${label}: адаптер не вызывался`, calls.adapter, 0)
    t(`план, ${label}: отчёт не записан`, existsSync(out), false)
    t(`план, ${label}: конверт не записан`, existsSync(envelopePathFor(out)), false)
  }

  /* ── Режим исполнения: бросок — идентичность кода на воротах P5, после
     плана и разрешения, до источников, провода и журнала. Значение идёт через
     внешний перехват preflight, где стоит `instanceof GateFailure`:
     null, undefined, символ и объект с бросающим getter'ом проходят его как
     есть, а отозванный Proxy и Proxy с бросающей ловушкой `getPrototypeOf`
     ЗАМЕНЯЮТСЯ там тем, что бросила рефлексия. Это граница preflight, а не
     runCli; здесь утверждается то, за что отвечает runCli: ни одно значение
     не покидает его, код — единица, текст getter'а, описание символа и
     исходное сообщение наружу не выходят, эффектов нет. */
  for (const [label, make, kind] of hostile) {
    const r = await freshRoot(`hostile-exec-${label}`)
    await writePlan(r, PLAN)
    const approvalName = await writeApproval(r)
    const env = countingEnv(CREDENTIAL_ENV)
    const wire = wireOf()
    const box = { exitCode: 0 }
    let escaped = '(не покинуло)'
    const { value, lines } = await captured(() => runCli(
      ['node', 'collect-pois.mjs', '--model-execute', '--model-plan-file', 'plan.json', '--model-approval', approvalName],
      { repoRoot: r, resolveCodeIdentity: () => { throw make() }, request: wire.request, env: env.env },
      box,
    ).catch((thrown) => { escaped = `ПОКИНУЛО: значение типа ${thrown === null ? 'null' : typeof thrown}`; return null }))
    t(`исполнение, ${label}: исключение не покинуло runCli`, escaped, '(не покинуло)')
    t(`исполнение, ${label}: exitCode единица`, box.exitCode, 1)
    t(`исполнение, ${label}: runCli вернул единицу`, value, 1)
    t(`исполнение, ${label}: stderr — одна строка с префиксом`,
      lines.length === 1 && lines[0].startsWith('[poi-portals] '), true)
    if (label.includes('Proxy')) {
      t(`исполнение, ${label}: текст getter'а, символа и исходного сообщения не вышел`,
        leaked(lines).split(',').filter((x) => x && x !== 'ЛОВУШКА').join(','), '')
    } else {
      t(`исполнение, ${label}: stderr — ровно описание типом`,
        lines.join('\n'), `[poi-portals] брошено значение типа ${kind}`)
      t(`исполнение, ${label}: чужой текст не вышел`, leaked(lines), '')
    }
    t(`исполнение, ${label}: провод не вызывался`, wire.calls, 0)
    t(`исполнение, ${label}: окружение не читалось`, env.reads, 0)
    t(`исполнение, ${label}: журнал не открывался`, await executionCount(r), 0)
  }

  /* ── Настоящий процесс: два самых злых значения через тот же драйвер, что
     и раздел 10. Код возврата процесса — единица, а не необработанный отказ. */
  const cli = path.join(REPO, 'scripts', 'poi-portals', 'collect-pois.mjs')
  const r = await freshRoot('hostile-process')
  const driver = path.join(r, 'hostile-driver.mjs')
  await writeFile(driver, [
    `import { runCli } from ${JSON.stringify(cli)}`,
    'const make = {',
    '  null: () => null,',
    "  proxy: () => new Proxy({}, { get() { throw new Error('ЛОВУШКА') },",
    "    getOwnPropertyDescriptor() { throw new Error('ЛОВУШКА') }, getPrototypeOf() { throw new Error('ЛОВУШКА') } }),",
    '}[process.env.JJ_HOSTILE]',
    'await runCli(process.argv, {',
    '  repoRoot: process.env.JJ_ROOT,',
    "  adapters: { 'opendata-csv': async () => { throw new Error('АДАПТЕР НЕ ДОЛЖЕН ВЫЗЫВАТЬСЯ') } },",
    '  resolveCodeIdentity: () => { throw make() },',
    '})',
  ].join('\n'), 'utf8')
  for (const [which, kind] of [['null', 'null'], ['proxy', 'object']]) {
    const out = path.join(r, PLAN_DIR_REL, `hostile-${which}.json`)
    let rc = 0
    let stderr = ''
    try {
      const done = await run(process.execPath,
        [driver, '--portal', 'bodik-osaka-tourism', '--model-plan', '--out', out],
        { cwd: REPO, timeout: 120_000, env: { ...process.env, JJ_ROOT: r, JJ_HOSTILE: which } })
      stderr = done.stderr
    } catch (error) {
      rc = typeof error.code === 'number' ? error.code : -1
      stderr = String(error.stderr ?? '')
    }
    t(`процесс, ${which}: код возврата единица, а не необработанный отказ`, rc, 1)
    has(`процесс, ${which}: stderr описывает значение типом`, stderr, `[poi-portals] брошено значение типа ${kind}`)
    t(`процесс, ${which}: чужой текст не вышел`, leaked([stderr]), '')
    t(`процесс, ${which}: перехват не упал сам`, stderr.includes('Cannot read properties'), false)
    t(`процесс, ${which}: адаптер не вызывался`, stderr.includes('АДАПТЕР НЕ ДОЛЖЕН'), false)
    t(`процесс, ${which}: отчёт не записан`, existsSync(out), false)
    t(`процесс, ${which}: конверт не записан`, existsSync(envelopePathFor(out)), false)
  }
}

/* ═══ 11. Справка и acceptedFlags строятся из того же разбора ═════════════ */
{
  const flags = [...acceptedFlags()].sort()
  const help = helpText()
  t('все флаги разбора описаны в справке', flags.filter((f) => !help.includes(f)).join(','), '')
  t('режим исполнения объявлен', flags.includes('--model-execute'), true)
  t('имя плана объявлено', flags.includes('--model-plan-file'), true)
  t('имя разрешения объявлено', flags.includes('--model-approval'), true)
  const parsedOnly = help.match(/^\s{2}(--[a-z-]+)/gm)?.map((s) => s.trim()) ?? []
  t('в справке нет флага, которого не знает разбор',
    parsedOnly.filter((f) => !flags.includes(f)).join(','), '')

  /* СТОРОЖ КЛАССИФИКАЦИИ. Каждый разобранный флаг обязан быть либо в списке
     режима исполнения, либо в списке несовместимых с ним — и оба списка
     закреплены здесь поимённо. Новый флаг в таблице разбора роняет набор до
     того, как кто-нибудь совместит его с платным прогоном молча. */
  t('флаги режима исполнения закреплены',
    [...EXECUTION_MODE_FLAGS].sort().join(','), '--help,--model-approval,--model-execute,--model-plan-file,-h')
  const incompatible = flags.filter((f) => !EXECUTION_MODE_FLAGS.includes(f)).sort()
  t('и список несовместимых закреплён целиком',
    incompatible.join(','),
    '--all,--base-snapshot,--dry-write,--existing,--limit,--max-place-lookups,'
    + '--model-plan,--model-provider-profile,--monitor,--names,--out,--portal,--samples,--write')
  t('каждый разобранный флаг классифицирован',
    flags.filter((f) => !EXECUTION_MODE_FLAGS.includes(f) && !incompatible.includes(f)).join(','), '')
}

/* ═══ 12. Сегодняшняя конфигурация остаётся fail-closed ═══════════════════ */
{
  const wire = wireOf()
  const env = countingEnv({})
  const root = await freshRoot('real-registry')
  await writePlan(root, PLAN)
  const approvalName = await writeApproval(root)
  /* Тот же прогон, но с НАСТОЯЩИМ реестром источников: портала `p-entrypoint`
     в нём нет, и ворота останавливают исполнение до провода. */
  const { ALL_SOURCES } = await import('../scripts/poi-portals/registry.mjs')
  const real = await quiet(() => runModelExecution({
    repoRoot: root,
    planFileName: 'plan.json',
    approvalFileName: approvalName,
    adapters: ADAPTERS,
    resolvePortal: (id) => ALL_SOURCES.find((portal) => portal.id === id) ?? null,
    rerunPortal: (portal, options) => rerunPortalCandidates(portal, options),
    resolveCodeIdentity: () => clone(CODE_IDENTITY),
    now: () => AT,
    request: wire.request,
    env: env.env,
    promptText: PROMPT_TEXT,
    schemaObject: SCHEMA_OBJECT,
  })).catch((error) => ({ state: `БРОСИЛ: ${String(error?.message ?? error)}` }))
  t('на реальном реестре исполнение остановлено', real.state, 'refused')
  t('и провод не вызывался', wire.calls, 0)
  t('и окружение не читалось', env.reads, 0)
  t('и журнал не открывался', await executionCount(root), 0)

  t('ни один источник реестра не разрешает провайдера',
    ALL_SOURCES.filter((s) => s.modelProcessing.allowedProviders.length).length, 0)
  t('и ни у одного нет решения владельца',
    ALL_SOURCES.filter((s) => s.modelProcessing.decisionRef !== null).length, 0)
  t('переменная секрета в окружении прогона не задана',
    typeof process.env.POI_MODEL_EXECUTION_OPENAI_API_KEY, 'undefined')
}

/* ═══ 13. Провод и учётные данные: границы самих адаптеров ═══════════════ */
{
  const SECRET = 'S'.repeat(48)
  const resolver = createCredentialsResolver({ env: { POI_MODEL_EXECUTION_OPENAI_API_KEY: SECRET } })
  const descriptor = { credentialScheme: 'Bearer', credentialHeader: 'authorization' }
  const profile = { providerId: 'openai' }

  t('секрет отдаётся значением заголовка', await resolver({ profile, descriptor }), `Bearer ${SECRET}`)

  const empty = createCredentialsResolver({ env: {} })
  const missing = await said(() => empty({ profile, descriptor }))
  has('незаданная переменная названа по имени', missing, 'POI_MODEL_EXECUTION_OPENAI_API_KEY')
  has('и сказано, что она закрывает путь', missing, 'закрывает платный путь')

  const unknown = await said(() => resolver({ profile: { providerId: 'нет-такого' }, descriptor }))
  has('неизвестный провайдер — отказ, а не догадка', unknown, 'не объявлена')

  const dirty = createCredentialsResolver({ env: { POI_MODEL_EXECUTION_OPENAI_API_KEY: 'с пробелом внутри' } })
  const dirtySaid = await said(() => dirty({ profile, descriptor }))
  t('в тексте отказа нет самого значения', dirtySaid.includes('пробелом'), false)
  t('и нет его длины', /\b17\b|\b48\b/.test(dirtySaid), false)

  has('лишнее поле вызова отвергается',
    await said(() => resolver({ profile, descriptor, extra: 1 })), 'лишние поля extra')

  /* ── Провод ─────────────────────────────────────────────────────────── */
  const responseOf = (chunks, { statusCode = 200, stall = false } = {}) => ({
    statusCode,
    destroy() { this.destroyed = true },
    async* [Symbol.asyncIterator]() {
      for (const chunk of chunks) yield Uint8Array.from(Buffer.from(chunk, 'utf8'))
      if (stall) await new Promise(() => {})
    },
  })
  const requestOf = (response) => (url, options, onResponse) => {
    queueMicrotask(() => onResponse(response))
    return { on() {}, end() {}, destroy() {} }
  }
  const callOf = (over = {}) => ({
    method: 'POST', url: 'https://api.example.com/v1/responses',
    headers: { authorization: `Bearer ${SECRET}` }, body: Buffer.from('{}', 'utf8'),
    timeoutMs: 60_000, maxResponseBytes: 32, ...over,
  })

  const okWire = createProductionWireClient({ request: requestOf(responseOf(['{"a":1}'])) })
  const okResult = await okWire(callOf())
  t('ответ отдаётся ровно двумя ключами', Reflect.ownKeys(okResult).join(','), 'status,body')
  t('и статус доезжает', okResult.status, 200)
  const collected = []
  for await (const chunk of okResult.body) collected.push(Buffer.from(chunk).toString('utf8'))
  t('и тело читается целиком', collected.join(''), '{"a":1}')

  /* ПОТОЛОК БАЙТОВ — на теле, а не на заголовках: ответ, влезший в статус и
     не влезший в предел, обязан оборваться названным отказом. */
  const bigWire = createProductionWireClient({
    request: requestOf(responseOf(['x'.repeat(20), 'y'.repeat(20)])),
  })
  const big = await bigWire(callOf())
  const bigSaid = await said(async () => { for await (const c of big.body) void c })
  has('превышение предела тела названо', bigSaid, 'превысило объявленный предел')

  /* СРОК ПОКРЫВАЕТ ОПЕРАЦИЮ ЦЕЛИКОМ, включая тело: поток, который не
     заканчивается, обязан оборваться по сроку, а не висеть вечно. */
  const stallWire = createProductionWireClient({
    request: requestOf(responseOf(['{"a":1}'], { stall: true })),
  })
  const stalled = await stallWire(callOf({ timeoutMs: 60, maxResponseBytes: 1024 }))
  const stalledSaid = await said(async () => { for await (const c of stalled.body) void c })
  has('незавершённое тело обрывается по сроку', stalledSaid, 'срок ожидания операции истёк')

  has('лишнее поле вызова провода отвергается',
    await said(() => okWire(callOf({ extra: 1 }))), 'лишние поля extra')
  has('тело не байтами отвергается',
    await said(() => okWire(callOf({ body: '{}' }))), 'ожидаются байты')
  has('срок без значения отвергается',
    await said(() => okWire(callOf({ timeoutMs: 0 }))), 'ожидается положительное целое')

  const badStatus = createProductionWireClient({ request: requestOf(responseOf([''], { statusCode: 999 })) })
  has('негодный статус — отказ провода', await said(() => badStatus(callOf())), 'обращение не состоялось')

  /* СРОК ПОКРЫВАЕТ И ОЖИДАНИЕ ЗАГОЛОВКОВ. Клиент принял запрос, обработчик
     ответа не позвал, а его `destroy()` ничего не испускает — на таком входе
     прежняя редакция висела вечно: она ждала `error`, которого не будет.
     Проверяется и то, что вызов ЗАВЕРШИЛСЯ, и то, что завершился в срок. */
  const stalledHeaders = createProductionWireClient({
    request: () => ({ on() {}, end() {}, destroy() {} }),
  })
  const startedAt = Date.now()
  const hung = await Promise.race([
    said(() => stalledHeaders(callOf({ timeoutMs: 120, maxResponseBytes: 1024 }))),
    new Promise((resolve) => setTimeout(() => resolve('ЗАВИС'), 4000)),
  ])
  has('зависший запрос без ответа обрывается по сроку', hung, 'срок ожидания операции истёк')
  t('и обрывается в объявленный срок, а не когда-нибудь', Date.now() - startedAt < 3000, true)

  /* ПОЗДНИЙ ОТВЕТ ПОСЛЕ СРОКА. Клиент зовёт обработчик через 80 мс, срок — 20;
     `destroy()` ничего не испускает. Исход обязан остаться сроком, поздний
     ответ — быть уничтоженным, а второго завершения и висящего отказа быть не
     должно. */
  const late = { destroyed: 0, unhandled: [] }
  const onUnhandled = (reason) => late.unhandled.push(String(reason?.message ?? reason))
  process.on('unhandledRejection', onUnhandled)
  const lateResponse = {
    statusCode: 200,
    destroy() { late.destroyed += 1 },
    async* [Symbol.asyncIterator]() { yield Uint8Array.from(Buffer.from('{}', 'utf8')) },
  }
  let settlements = 0
  const lateWire = createProductionWireClient({
    request: (_url, _options, onResponse) => {
      setTimeout(() => { settlements += 1; onResponse(lateResponse) }, 80)
      return { on() {}, end() {}, destroy() {} }
    },
  })
  /* Гонка с запасом: если срок перестанет работать, набор обязан провалить
     утверждение словами, а не повиснуть — повисший набор не печатает итога. */
  const lateOutcome = await Promise.race([
    said(() => lateWire(callOf({ timeoutMs: 20, maxResponseBytes: 1024 }))),
    new Promise((resolve) => setTimeout(() => resolve('ЗАВИС'), 4000)),
  ])
  has('поздний ответ не отменяет истёкшего срока', lateOutcome, 'срок ожидания операции истёк')
  /* Ждём дольше позднего ответа: он придёт уже после вердикта. */
  await new Promise((resolve) => setTimeout(resolve, 150))
  t('поздний ответ действительно пришёл', settlements, 1)
  t('и был уничтожен, а не оставлен висеть', late.destroyed >= 1, true)
  t('исход при этом не изменился', lateOutcome.includes('срок ожидания операции истёк'), true)
  t('незамеченных отказов промисов не появилось', late.unhandled.join(','), '')
  process.off('unhandledRejection', onUnhandled)
}

/* ═══ Уборка и остаток ═══════════════════════════════════════════════════
   Отказ уборки НЕ подавляется: он становится проваленной проверкой. Набор,
   который убрал за собой «почти», нельзя запустить дважды, а набор, который
   об этом молчит, узнаёт об этом на втором запуске чужими руками. */
for (const root of roots) {
  const failure = await rm(root, { recursive: true }).then(() => null, (error) => error.message)
  t(`временный корень убран: ${path.basename(root)}`, failure, null)
  t(`и его больше нет: ${path.basename(root)}`, existsSync(root), false)
}
t('в настоящем каталоге планов набор ничего не оставил',
  (await listReal()).join(','), REAL_PLANS_BEFORE)
t('и ни одного своего имени там нет',
  (await listReal()).filter((name) => TEST_ARTIFACT_NAMES.includes(name)).join(','), '')

console.log(bad.length
  ? `✗ production-entrypoint модели: провалено ${bad.length} из ${ok + bad.length}:\n  ` + bad.join('\n  ')
  : `✓ production-entrypoint модели: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
