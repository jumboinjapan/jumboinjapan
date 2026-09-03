/**
 * ОРКЕСТРАЦИЯ МОДЕЛЬНОГО ИСПОЛНЕНИЯ — единственная композиция CLI → исполнитель.
 *
 * Один узкий модуль, и он ничего не изобретает. Ни второго исполнителя, ни
 * второго preflight, ни своей проверки плана, разрешения, профиля, цены или
 * кода возврата: всё это уже есть, и здесь только собирается в том порядке,
 * который требует контракт. Единственная production-ссылка на
 * `model-executor.mjs` — здесь, и набор недостижимости проверяет, что она
 * ровно одна.
 *
 * ЧТО ЭТОТ МОДУЛЬ НЕ ДЕЛАЕТ:
 *   — не принимает произвольный путь: план читается по ИМЕНИ из разрешённого
 *     каталога, разрешение — по имени через собственный store;
 *   — не принимает профиль и таблицу цен вторым пользовательским вводом: они
 *     выводятся из подписанного плана и канонических реестров;
 *   — не создаёт разрешения, не смягчает policy и не трогает реестр источников;
 *   — не читает секрет и не идёт в сеть: это делает транспорт внутри
 *     исполнителя и только после полного preflight.
 *
 * ЧТО ПОДМЕНЯЮТ НАБОРЫ: часы, файловый корень, чтение идентичности кода,
 * низкоуровневый `request` и окружение. Ни исполнитель, ни preflight, ни
 * транспорт не подменяются — иначе проверялась бы композиция, которой в
 * production нет.
 */
import path from 'node:path'
import { readFileSync } from 'node:fs'

import { executeModelPlan } from './model-executor.mjs'
import { createArtifactStore } from './execution-journal.mjs'
import { MODEL_PLAN_ARTIFACT_SPEC, parseAndVerifyModelPlan } from './model-plan.mjs'
import { providerProfileDigest, resolveProviderProfile } from './provider-profile.mjs'
import { resolvePricingTable } from './model-pricing.mjs'
import { createCredentialsResolver, createProductionWireClient } from './model-wire.mjs'
import { assertDigestShape, canonicalJsonBytes } from '../../lib/canonical-contract.mjs'
import { assertExistingRegularFile, assertPathContainment, ARTIFACT_NAMES } from '../../lib/path-boundary.mjs'

/**
 * Разрешённый каталог планов — ЕДИНСТВЕННОЕ объявление на проект.
 *
 * Здесь, а не в CLI: каталог нужен и записи плана, и его чтению, а две
 * константы разошлись бы молча — и разошлись бы ровно на том, что писатель
 * положил бы файл туда, куда читатель не смотрит.
 */
export const PLAN_ROOT_SEGMENTS = Object.freeze(['tmp', 'poi-model-plans'])
export const PLAN_DIR_REL = path.join(...PLAN_ROOT_SEGMENTS)

/** Имя файла конверта: одно звено, строчное `.json`, без разделителей пути и «..». */
const PLAN_FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,127}\.json$/

const RUN_INPUT_KEYS = Object.freeze([
  'repoRoot', 'planFileName', 'approvalFileName',
  'adapters', 'resolvePortal', 'rerunPortal', 'resolveCodeIdentity',
  'now', 'request', 'env', 'promptText', 'schemaObject',
])

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function assertExactKeys(value, keys, where) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${where}: ожидается объект, получено ${value === null ? 'null' : typeof value}`)
  }
  const own = Reflect.ownKeys(value)
  const extra = own.filter((key) => typeof key !== 'string' || !keys.includes(key))
  const missing = keys.filter((key) => !own.includes(key))
  if (extra.length || missing.length) {
    const parts = []
    if (missing.length) parts.push(`нет обязательных полей ${missing.join(', ')}`)
    if (extra.length) parts.push(`лишние поля ${extra.map(String).join(', ')}`)
    throw new TypeError(`${where}: ${parts.join('; ')}`)
  }
}

/* ═══ ИСПОЛНЯЕМЫЙ АРТЕФАКТ — КОНВЕРТ ПЛАНА, А НЕ ОТЧЁТ ПРОГОНА ═════════════

   Две прежние редакции читателя принимали в качестве исполняемого артефакта
   ПОЛНЫЙ ОТЧЁТ `--model-plan --out` — сначала по одному полю `modelPlan`,
   затем по закрытому списку ключей. Аудит показал, что закрытый список
   закрывает форму, а не смысл: отчёт с `dryRun: false`, `startedAt` на
   30 февраля и `portals: [{portalId: 'not-the-signed-plan'}]` при плане на
   `bodik-osaka-tourism` внутри читался с тем же отпечатком, что и честный.
   Эти поля выглядят авторитетными, но никем не подписаны, к плану не
   привязаны и разрешением не покрыты; читатель их «проверял», а исполнитель
   не читал вовсе. Проверка поля, которое ни на что не влияет, — это не
   граница, а её вид.

   Выбрана АРХИТЕКТУРА A: исполняемый артефакт — отдельный минимальный
   версионированный конверт, в котором нет ничего, кроме того, что относится
   к его контракту и границе полномочий:

     contractVersion    — версия конверта, полем, а не выводом из формы;
     planArtifactDigest — объявленный отпечаток артефакта плана, тот самый,
                          который несёт разрешение владельца;
     plan               — подписанный план, и только он.

   Времени, режима прогона и списка порталов в конверте нет — не потому, что
   их «пока не проверяют», а потому, что источник каждого из них уже внутри
   плана и подписан: `createdAt`/`deleteAfter` проходят общий
   `assertCanonicalInstant`, набор порталов сортирован, без повторов и входит
   в `planDigest`. Второй, внешней копии этих величин конверт не даёт, и
   расходиться с планом ему нечем.

   Человеческий отчёт остаётся отчётом: он и есть выгрузка данных источника
   (см. runbook), полномочий не несёт и подписанным артефактом не притворяется.
   Читатель узнаёт его по полю `modelPlan` и отказывает, называя конверт.
   Производитель пишет конверт тем же прогоном рядом с отчётом —
   `<имя>.envelope.json` — и только после того, как отчёт записан. */

export const MODEL_PLAN_ENVELOPE_SPEC = 'poi-model-plan-envelope/v1'

/** Суффикс конверта; выводится из `--out` производителя и нигде не вводится. */
export const ENVELOPE_SUFFIX = '.envelope.json'

/** Ровно три поля. Список закрыт: четвёртого конверт не подписывает. */
export const ENVELOPE_KEYS = Object.freeze(['contractVersion', 'planArtifactDigest', 'plan'])

/**
 * Путь конверта — из пути отчёта, одной формулой на писателя и документацию.
 *
 * `--out`, сам оканчивающийся на суффикс конверта, отвергается: иначе отчёт
 * назывался бы конвертом, а конверт — `x.envelope.envelope.json`, и по имени
 * их было бы не различить.
 */
export function envelopePathFor(outPath) {
  if (typeof outPath !== 'string' || !outPath.endsWith('.json')) {
    throw new TypeError(`envelopePathFor: ожидается путь отчёта с расширением .json, получено ${JSON.stringify(outPath)}`)
  }
  if (outPath.endsWith(ENVELOPE_SUFFIX)) {
    throw new Error(
      `${outPath}: --out не может оканчиваться на «${ENVELOPE_SUFFIX}» — это имя зарезервировано `
      + 'за исполняемым конвертом, который прогон пишет рядом с отчётом.',
    )
  }
  return `${outPath.slice(0, -'.json'.length)}${ENVELOPE_SUFFIX}`
}

/**
 * Конверт из ПОДПИСАННОГО плана. Отпечаток считает тот же разбор, что
 * строил план и что сверяет разрешение: своей формулы здесь нет.
 */
export function buildPlanEnvelope(plan) {
  const { plan: verified, planArtifactDigest } = parseAndVerifyModelPlan(plan)
  return Object.freeze({
    contractVersion: MODEL_PLAN_ENVELOPE_SPEC,
    planArtifactDigest: Object.freeze({ ...planArtifactDigest }),
    plan: verified,
  })
}

/**
 * Разбор конверта: чужая форма названа → каноническая строгость → ровно три
 * поля → версия → отпечаток по форме → план своим разбором → отпечаток по
 * значению.
 *
 * Чужие формы узнаются по НАЛИЧИЮ ключа, без чтения значения: отчёт прогона —
 * по `modelPlan`, голый план — по `planId`. Дальше всё поддерево проходит
 * `canonicalJsonBytes` — тот же проход, что подписывает план: символьные,
 * accessor- и неперечисляемые свойства, не-простые прототипы и циклы
 * отвергаются им, а не вторым списком правил здесь.
 *
 * Отпечаток в конверте — предмет проверки, а не свидетельство: он
 * пересчитывается из плана и обязан совпасть. Конверт, объявляющий один
 * отпечаток и несущий план с другим, принадлежит двум артефактам сразу — то
 * есть ни одному.
 */
export function parsePlanEnvelope(raw, where) {
  if (!isPlainObject(raw)) {
    throw new Error(`${where}: исполняемый артефакт обязан быть объектом-конвертом ${MODEL_PLAN_ENVELOPE_SPEC}`)
  }
  if (Object.hasOwn(raw, 'modelPlan')) {
    throw new Error(
      `${where}: это отчёт прогона «--model-plan --out» (поле «modelPlan»), а не исполняемый артефакт. `
      + 'Отчёт — выгрузка данных источника, полномочий он не несёт и не подписан. Исполняется только '
      + `конверт ${MODEL_PLAN_ENVELOPE_SPEC} — файл «<имя>${ENVELOPE_SUFFIX}», который тот же прогон `
      + 'пишет рядом с отчётом.',
    )
  }
  if (Object.hasOwn(raw, 'planId')) {
    throw new Error(
      `${where}: это голый план, а не исполняемый артефакт. Исполняется только конверт `
      + `${MODEL_PLAN_ENVELOPE_SPEC} — файл «<имя>${ENVELOPE_SUFFIX}», который пишет «--model-plan --out».`,
    )
  }
  canonicalJsonBytes(raw, where)
  assertExactKeys(raw, ENVELOPE_KEYS, where)

  if (raw.contractVersion !== MODEL_PLAN_ENVELOPE_SPEC) {
    throw new Error(
      `${where}: версия конверта ${JSON.stringify(raw.contractVersion)}, ожидается «${MODEL_PLAN_ENVELOPE_SPEC}»`,
    )
  }
  assertDigestShape(raw.planArtifactDigest, MODEL_PLAN_ARTIFACT_SPEC, `${where}: planArtifactDigest`)
  if (!isPlainObject(raw.plan)) {
    throw new Error(`${where}: поле «plan» не содержит плана`)
  }
  /* Отпечаток считает ТОТ ЖЕ разбор, что строил план и что сверяет
     разрешение: своей проверки формы плана здесь нет — вторая реализация
     разошлась бы с первой молча. */
  const verified = parseAndVerifyModelPlan(raw.plan)
  if (verified.planArtifactDigest.value !== raw.planArtifactDigest.value) {
    throw new Error(
      `${where}: конверт объявляет отпечаток плана ${raw.planArtifactDigest.value}, а план внутри даёт `
      + `${verified.planArtifactDigest.value}. Конверт и план принадлежат разным артефактам; исполнять нечего.`,
    )
  }
  return { plan: verified.plan, planArtifactDigest: verified.planArtifactDigest }
}

/**
 * Чтение конверта по ИМЕНИ из разрешённого каталога.
 *
 * Произвольного пути нет и быть не может: имя проверяется формой, затем путь
 * — физически. Лексического `startsWith` недостаточно (символьная ссылка
 * внутри пути его не нарушает), поэтому вложенность проверяет
 * `assertPathContainment`, а leaf — `assertExistingRegularFile`: внутри
 * проверенного каталога может лежать ссылка, каталог или FIFO с нужным именем.
 */
export function readPlanByName({ repoRoot, planFileName }) {
  if (typeof planFileName !== 'string' || !PLAN_FILE_NAME.test(planFileName)) {
    throw new Error(
      `--model-plan-file: ожидается имя конверта вида «plan${ENVELOPE_SUFFIX}» из ${PLAN_DIR_REL}, `
      + `получено ${JSON.stringify(planFileName)}. Путь, разделители и «..» не принимаются: `
      + 'конверт читается только из разрешённого каталога.',
    )
  }
  const insideDir = path.join(repoRoot, PLAN_DIR_REL)
  const target = path.join(insideDir, planFileName)
  const names = ARTIFACT_NAMES.planEnvelope
  assertPathContainment(target, { insideDir, names })
  assertExistingRegularFile(target, { names })
  const bytes = readFileSync(target)
  let raw
  try {
    raw = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`${target}: конверт плана не разбирается как JSON`)
  }
  const { plan, planArtifactDigest } = parsePlanEnvelope(raw, target)
  return { plan, planArtifactDigest, path: target }
}

/**
 * Профиль и таблица цен — ИЗ ПЛАНА и канонических реестров, не от пользователя.
 *
 * Второй пользовательский ввод здесь означал бы, что разрешение, выданное под
 * один профиль и одну цену, исполняется под другими. Отпечаток профиля
 * сверяется с планом: реестр мог измениться после подписи.
 */
export function resolveExecutionBinding(plan) {
  if (plan.providerProfile === null) {
    throw new Error(
      'План v1 не исполняется: в нём нет профиля провайдера, а исполнение без профиля '
      + 'не к чему привязать. Постройте план с --model-provider-profile.',
    )
  }
  const profile = resolveProviderProfile(plan.providerProfile.id, plan.providerProfile.version)
  const digest = providerProfileDigest(profile)
  if (digest !== plan.providerProfileDigest.value) {
    throw new Error(
      `Профиль ${plan.providerProfile.id}@${plan.providerProfile.version} из реестра не совпадает `
      + 'с отпечатком в плане: план подписан под другой профиль. Исполнение остановлено.',
    )
  }
  const pricingTable = resolvePricingTable(profile.pricingTableDigest.value)
  return { profile, pricingTable }
}

/**
 * Полная композиция: план → разрешение → preflight → исполнитель.
 *
 * Возвращается результат исполнителя как есть — вместе с его `exitCode`.
 * Своего кода возврата здесь нет: подменить чужой вердикт своим значило бы
 * потерять именно то, ради чего он вычисляется.
 */
export async function runModelExecution(input) {
  assertExactKeys(input, RUN_INPUT_KEYS, 'runModelExecution: параметры')
  const {
    repoRoot, planFileName, approvalFileName,
    adapters, resolvePortal, rerunPortal, resolveCodeIdentity,
    now, request, env, promptText, schemaObject,
  } = input
  if (typeof now !== 'function') {
    throw new TypeError('runModelExecution.now: ожидаются часы-функция')
  }

  const { plan } = readPlanByName({ repoRoot, planFileName })
  const { profile, pricingTable } = resolveExecutionBinding(plan)
  const store = createArtifactStore({ repoRoot })

  /* ЧАСЫ — ОДНА ФОРМА НА ОБЕ ГРАНИЦЫ: функция, возвращающая канонический
     момент строкой. Так их читает исполнитель (`readClock` перед каждой
     записью журнала), и preflight получает ПЕРВОЕ чтение тех же часов, а не
     собственное. Два независимых чтения времени дали бы двум воротам разные
     ответы на один вопрос, и разошлись бы они ровно на границе срока. */
  const at = now()
  if (typeof at !== 'string' || at === '') {
    throw new TypeError('runModelExecution.now: часы обязаны вернуть канонический момент строкой')
  }

  return executeModelPlan({
    preflightInput: {
      approvalFileName,
      plan,
      profile,
      pricingTable,
      now: at,
      store,
      adapters,
      resolvePortal,
      resolveCodeIdentity,
      rerunPortal,
    },
    /* Провод и учётные данные собираются ЗДЕСЬ, но не вызываются: их зовёт
       транспорт внутри исполнителя, и только после того, как preflight принял
       все двенадцать ворот. Сборка адаптера эффектом не является. */
    wireClient: createProductionWireClient({ request }),
    resolveCredentials: createCredentialsResolver({ env }),
    promptText,
    schemaObject,
    now,
  })
}
