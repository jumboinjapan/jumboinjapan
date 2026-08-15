/**
 * Execution-preflight: двенадцать ворот до первого платного обращения.
 *
 * All-or-nothing. Любой отказ отменяет ВЕСЬ прогон: портал или кандидат молча
 * не исключается. Исключить один источник значило бы исполнить не тот набор,
 * на который выдано разрешение, и подпись при этом сошлась бы — потому что
 * подписан план, а не то, что от него осталось.
 *
 * Preflight ничего не создаёт. Ни при успехе, ни при отказе он не открывает
 * журнал, не пишет `opened` и не трогает чужие исполнения: журнал откроет
 * исполнитель, и только после успешного результата.
 *
 * Все входы приходят значением и проверяются здесь заново. Ни один из них не
 * является подставной политикой: план, разрешение, профиль и таблица цен
 * проходят те же production-границы, что и всюду, а адаптеры — те же самые,
 * что запускает коллектор. Инъекция здесь ровно та же, что у часов: откуда
 * взялось значение, решает вызывающий, годится ли оно — решает граница.
 *
 * ## Что проверяет каждое ворота
 *
 * | Ворота | Предмет |
 * |---|---|
 * | P0  | повтор ТОГО ЖЕ детерминированного `executionId` — и ничего больше |
 * | P1  | план как артефакт: форма, собственная подпись, чистая идентичность |
 * | P2  | план исполняем: `poi-model-plan/v2` и `executionPermitted === true` |
 * | P3  | статические authority-входы: профиль и таблица цен |
 * | P4  | файл разрешения: имя, байты, JSON, полный approval, подпись, имя ↔ подпись |
 * | P5  | идентичность кода — СОСТАВНЫЕ ворота, до источников и после |
 * | P6  | время: разрешение действует, план не подлежит удалению |
 * | P7  | текущая policy каждого портала на `now` |
 * | P8  | набор порталов: исчезнувший, подменённый, лишний |
 * | P9  | набор кандидатов: `sourceKey` пустой, повторный, изменившийся |
 * | P10 | содержательный вход модели: неканоничный или изменившийся |
 * | P11 | консервативная верхняя граница стоимости против потолка разрешения |
 *
 * ## Почему порядок исполнения не равен порядку номеров
 *
 * `executionId` выводится из ДВУХ проверенных подписей — разрешения и плана.
 * Взять их из непроверенного JSON нельзя: тогда одноразовость проверялась бы
 * по идентификатору, который назвал сам файл. Поэтому P0 исполняется после
 * P1–P4, а до них остаётся `notRun` — и это не «отложенная проверка», а
 * честное «проверка ворот не исполнялась».
 *
 * ## Статусы ворот
 *
 * `passed` и `failed` означают, что проверка ИСПОЛНЯЛАСЬ. `notRun` означает
 * ровно одно: не исполнялась. Уже пройденные ворота в `notRun` не
 * сбрасываются никогда — иначе отчёт скрывал бы проделанную работу и врал бы
 * о том, что именно осталось непроверенным.
 *
 * P5 — составные ворота: идентичность кода читается дважды, до обращения к
 * источникам и после него, и пройденными они считаются только после второго
 * чтения. Поэтому при позднем drift P5 = `failed`, действительно пройденные
 * P6–P10 остаются `passed`, а P11 — `notRun`. Различить два случая позволяет
 * машинная фаза отказа: `beforeSources` или `afterSources`.
 *
 * ## Ожидаемый отказ и сбой
 *
 * Ожидаемый отказ приходит результатом с `ok: false`, своим кодом и своим
 * кодом возврата. Программная ошибка и недоказуемое состояние файловой
 * системы бросаются исключением: превратить внутренний дефект или `EIO` в
 * аккуратное `ok: false` значит выдать «проверено и не разрешено» там, где на
 * деле «не проверено». Ожидаемые отказы поэтому классифицируются по ТИПУ и
 * по названному классу, а не сплошным `catch (error) → ворота`.
 */
import {
  assertIdentity,
  assertPolicyShape,
  buildClassificationItem,
  buildPortalPlanFragment,
  candidateInputDigest,
  evaluatePolicy,
  MODEL_INPUT_FIELDS,
  MODEL_PLAN_V2_CONTRACT_VERSION,
  parseAndVerifyModelPlan,
  POLICY_STATE_ALLOWED,
  requestItemId,
} from './model-plan.mjs'
import { ApprovalRejected } from './approval-store.mjs'
import {
  assertProviderProfileShape,
  providerProfileDigest,
  PROVIDER_PROFILE_SPEC,
} from './provider-profile.mjs'
import { findPricingEntry, parseAndVerifyPricingTable } from './model-pricing.mjs'
import {
  assertStrictOptions,
  EXIT_CODES,
  executionId as computeExecutionId,
} from './model-execution.mjs'
import { assertPricingBinding, BUDGET_CODES, BudgetError, computeCostUpperBound } from './execution-cost.mjs'
import {
  assertCanonicalInstant,
  assertCodeIdentity,
  deepFreeze,
  digest,
} from '../../lib/canonical-contract.mjs'
import { DIGEST_ALGORITHM } from '../../lib/byte-digest.mjs'

/** Ворота в фиксированном порядке. Список закрыт. */
export const PREFLIGHT_GATES = Object.freeze([
  'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11',
])

/**
 * Состояния ворот. `notRun` означает ровно «проверка не исполнялась» — ни
 * «отложена», ни «сброшена после чужого отказа».
 */
export const GATE_STATUSES = Object.freeze(['passed', 'failed', 'notRun'])

/**
 * Фаза отказа относительно первого обращения к источникам. Машинная: по ней
 * вызывающий отличает drift, случившийся до сети, от drift'а после неё, не
 * разбирая текст сообщения.
 */
export const PREFLIGHT_PHASES = Object.freeze(['beforeSources', 'afterSources'])

/** Машинные коды отказа. Разбирать текст сообщения вызывающий не должен. */
export const PREFLIGHT_CODES = Object.freeze({
  executionAlreadyConsumed: 'executionAlreadyConsumed',
  approvalRejected: 'approvalRejected',
  approvalNotYetValid: 'approvalNotYetValid',
  approvalExpired: 'approvalExpired',
  planRejected: 'planRejected',
  planExpired: 'planExpired',
  codeIdentityDrift: 'codeIdentityDrift',
  policyDenied: 'policyDenied',
  portalSetMismatch: 'portalSetMismatch',
  candidateSetMismatch: 'candidateSetMismatch',
  inputDrift: 'inputDrift',
  budgetExceeded: BUDGET_CODES.exceeded,
  budgetUnprovable: BUDGET_CODES.unprovable,
})

/** Параметры. Все обязательны: умолчания расходятся с production молча. */
export const PREFLIGHT_INPUT_KEYS = Object.freeze([
  'approvalFileName', 'plan', 'profile', 'pricingTable', 'now',
  'store', 'adapters', 'resolvePortal', 'resolveCodeIdentity', 'rerunPortal',
])

/** Отказ ворот. Ожидаемый исход, а не программная ошибка. */
class GateFailure extends Error {
  constructor(gate, code, message, exitCode, phase) {
    super(message)
    this.name = 'GateFailure'
    this.gate = gate
    this.code = code
    this.exitCode = exitCode
    this.phase = phase
  }
}

/**
 * Денежный отказ — в код ворот.
 *
 * Единственное место, где это превращение происходит, и происходит оно по
 * ТИПУ: `BudgetError` несёт машинный код, всё остальное — программная ошибка,
 * и «граница недоказуема» из неё не выводится. Функция экспортируется
 * намеренно: из production-входов сюда не добраться — к моменту P11 лимиты,
 * профиль и таблица уже проверены, — а сторож, которого нечем вызвать,
 * сторожем не является.
 */
export function budgetFailureCode(error) {
  if (!(error instanceof BudgetError)) throw error
  if (error.code === BUDGET_CODES.exceeded) return PREFLIGHT_CODES.budgetExceeded
  if (error.code === BUDGET_CODES.unprovable) return PREFLIGHT_CODES.budgetUnprovable
  /* Fail-closed: «всё остальное — недоказуемость» превратило бы опечатку в
     коде в осмысленный вердикт. Неизвестный код — программная ошибка. */
  throw new TypeError(
    `budgetFailureCode: неизвестный код бюджета ${JSON.stringify(error.code)} — `
    + 'вердикт по умолчанию из него не выводится',
  )
}

const SEPARATOR = String.fromCharCode(0x1f)
const candidateKey = (portalId, sourceKey) => `${portalId}${SEPARATOR}${sourceKey}`

/**
 * Прогон preflight.
 *
 * Возвращает глубоко замороженный результат. `process.exitCode` эта функция
 * не трогает — решение о завершении процесса принимает вызывающий.
 */
export async function runExecutionPreflight(input) {
  assertStrictOptions(
    input, { required: PREFLIGHT_INPUT_KEYS }, 'runExecutionPreflight: параметры',
  )
  const {
    approvalFileName, plan, profile, pricingTable, now,
    store, adapters, resolvePortal, resolveCodeIdentity, rerunPortal,
  } = input
  /* Момент проверяется как момент, а `checkedAt` остаётся строкой. Прежняя
     запись `assertCanonicalInstant(now) && now` на эпохе давала `0`:
     миллисекунды эпохи ложны, и в отчёт вместо канонической строки попадало
     число — ровно на том единственном входе, который проще всего не заметить. */
  const nowMs = assertCanonicalInstant(now, 'now')
  const checkedAt = now

  const gates = Object.fromEntries(PREFLIGHT_GATES.map((gate) => [gate, 'notRun']))
  const warnings = []
  let executionId = null
  let budget = null
  let preparedItems = null
  let phase = PREFLIGHT_PHASES[0]

  const pass = (gate) => { gates[gate] = 'passed' }
  const fail = (gate, code, message, exitCode = EXIT_CODES.preflightFailed) => {
    throw new GateFailure(gate, code, message, exitCode, phase)
  }

  /**
   * Вердикт ЧИСТОЙ границы — отказом ворот.
   *
   * Оборачивается ровно один вызов, и это валидатор: файловой системы, сети и
   * внешнего состояния он не касается, поэтому любой его отказ — суждение о
   * предъявленном артефакте, а не сбой среды. Системная ошибка (у неё есть
   * `syscall`) и отказ другого гейта уходят наружу как есть.
   */
  const verdictOf = (gate, code, run, where, exitCode = EXIT_CODES.preflightFailed) => {
    try {
      return run()
    } catch (error) {
      if (error instanceof GateFailure) throw error
      if (typeof error?.syscall === 'string') throw error
      throw new GateFailure(
        gate, code, where ? `${where}: ${error.message}` : error.message, exitCode, phase,
      )
    }
  }

  try {
    /* ── P1. План как артефакт ────────────────────────────────────────── */
    /* План уходит в парсер КАК ЕСТЬ. Клонировать его перед проверкой нельзя:
       `structuredClone` выбрасывает неперечисляемые и символьные свойства и
       материализует accessor в обычное значение — то есть чинит ровно тот
       вход, который обязан быть отвергнут, и делает это до валидатора.
       Собственную безопасную копию парсер возвращает сам. */
    const reparsed = verdictOf(
      'P1', PREFLIGHT_CODES.planRejected, () => parseAndVerifyModelPlan(plan), 'план',
    )
    const verifiedPlan = reparsed.plan
    pass('P1')

    /* ── P2. План исполняем ───────────────────────────────────────────── */
    if (verifiedPlan.contractVersion !== MODEL_PLAN_V2_CONTRACT_VERSION) {
      fail('P2', PREFLIGHT_CODES.planRejected,
        `план ${verifiedPlan.contractVersion}: исполняется только ${MODEL_PLAN_V2_CONTRACT_VERSION}`)
    }
    if (verifiedPlan.executionPermitted !== true) {
      fail('P2', PREFLIGHT_CODES.planRejected, 'план не исполним: executionPermitted !== true')
    }
    pass('P2')

    /* ── P3. Статические authority-входы, ДО первого адаптера ──────────
       Профиль и таблица цен — не денежная арифметика, а полномочие: под них
       посчитан план, ими названа цена, и непроверенный профиль не имеет права
       ни попасть в P7, ни дожить до повторного обращения к источникам. Сам
       денежный итог остаётся за P11 — здесь проверяется только то, из чего он
       будет посчитан. */
    verdictOf('P3', PREFLIGHT_CODES.budgetUnprovable,
      () => assertProviderProfileShape(profile), 'профиль провайдера')
    const profileDigest = digest(
      providerProfileDigest(profile), DIGEST_ALGORITHM, PROVIDER_PROFILE_SPEC,
    )
    if (profileDigest.value !== verifiedPlan.providerProfileDigest.value) {
      fail('P3', PREFLIGHT_CODES.budgetUnprovable,
        `отпечаток профиля ${profileDigest.value} не равен отпечатку плана `
        + `${verifiedPlan.providerProfileDigest.value}`)
    }
    if (profile.id !== verifiedPlan.providerProfile.id
      || profile.version !== verifiedPlan.providerProfile.version) {
      fail('P3', PREFLIGHT_CODES.budgetUnprovable,
        `профиль ${profile.id}@${profile.version} не тот, на который построен план`)
    }
    /* Таблица — тоже как есть, по той же причине, что и план. */
    const verifiedTable = verdictOf('P3', PREFLIGHT_CODES.budgetUnprovable,
      () => parseAndVerifyPricingTable(pricingTable), 'таблица цен')
    if (profile.pricingTableDigest.value !== verifiedTable.pricingTableDigest.value) {
      fail('P3', PREFLIGHT_CODES.budgetUnprovable,
        `профиль ссылается на таблицу цен ${profile.pricingTableDigest.value}, проверена `
        + `${verifiedTable.pricingTableDigest.value}`)
    }
    /* Точная строка модели — тоже статический вход: узнавать о её отсутствии
       после повторной выгрузки источников незачем, причина известна заранее. */
    verdictOf('P3', PREFLIGHT_CODES.budgetUnprovable, () => findPricingEntry(verifiedTable, {
      providerId: profile.providerId, modelId: profile.modelId, modelVersion: profile.modelVersion,
    }), 'строка цены')
    pass('P3')

    /* ── P4. Файл разрешения целиком ──────────────────────────────────── */
    let verifiedApproval = null
    try {
      const read = await store.approvals.readApprovalFile({ fileName: approvalFileName, plan })
      verifiedApproval = read.approval
    } catch (error) {
      /* Только типизированный отказ хранилища. EIO, EACCES, EPERM и любая
         программная ошибка сюда не попадают и уходят наружу: «не прочитано»
         не равно «отвергнуто», и штатным отказом с кодом 11 не становится. */
      if (!(error instanceof ApprovalRejected)) throw error
      fail('P4', PREFLIGHT_CODES.approvalRejected,
        `разрешение ${approvalFileName}: ${error.message}`,
        EXIT_CODES.preflightApprovalRejected)
    }
    /* Привязка полномочия к разрешению: тот же отпечаток профиля и та же
       таблица цен с той же датой и валютой. Форма обоих проверена в P3 —
       здесь сверяется то, на что разрешение выдано. */
    if (profileDigest.value !== verifiedApproval.providerProfileDigest.value) {
      fail('P4', PREFLIGHT_CODES.budgetUnprovable,
        `отпечаток профиля не равен отпечатку разрешения ${verifiedApproval.providerProfileDigest.value}`)
    }
    verdictOf('P4', PREFLIGHT_CODES.budgetUnprovable, () => assertPricingBinding({
      pricingTable: verifiedTable, profile, limits: verifiedApproval.limits,
    }))
    pass('P4')

    /* ── P0. Одноразовость ────────────────────────────────────────────── */
    executionId = computeExecutionId({
      approvalDigest: verifiedApproval.approvalDigest.value,
      planDigest: verifiedApproval.planDigest.value,
    })
    const state = store.approvalState({ approval: verifiedApproval, at: now }).state
    if (state === 'consumed') {
      fail(
        'P0', PREFLIGHT_CODES.executionAlreadyConsumed,
        `исполнение ${executionId} уже начиналось: каталог существует, и повторный платный прогон `
        + 'по тому же разрешению не начинается независимо от того, закрыт журнал или нет',
        EXIT_CODES.preflightAlreadyConsumed,
      )
    }
    /* Чужие журналы — предупреждение, а не запрет: это другие исполнения, и
       связи между ними нет. Сканер только читает. */
    for (const seen of await store.scanExecutions()) {
      if (seen.executionId === executionId) continue
      if (seen.state === 'closed') continue
      warnings.push(Object.freeze({
        executionId: seen.executionId,
        state: seen.state,
        reason: seen.reason,
      }))
    }
    pass('P0')

    /* ── P5, первая половина. Идентичность кода до источников ─────────── */
    const identityBefore = resolveCodeIdentity()
    assertCodeIdentity(identityBefore)
    if (identityBefore.dirty !== false) {
      fail('P5', PREFLIGHT_CODES.codeIdentityDrift,
        `до источников отслеживаемое дерево изменено, commit ${identityBefore.commit} код не описывает`)
    }
    if (identityBefore.commit !== verifiedPlan.codeIdentity.commit) {
      fail('P5', PREFLIGHT_CODES.codeIdentityDrift,
        `HEAD ${identityBefore.commit} не равен идентичности плана ${verifiedPlan.codeIdentity.commit}`)
    }

    /* ── P6. Время ────────────────────────────────────────────────────── */
    const createdMs = assertCanonicalInstant(verifiedApproval.createdAt, 'approval.createdAt')
    const validUntilMs = assertCanonicalInstant(verifiedApproval.validUntil, 'approval.validUntil')
    const planDeleteMs = assertCanonicalInstant(verifiedPlan.deleteAfter, 'plan.deleteAfter')
    if (nowMs < createdMs) {
      fail('P6', PREFLIGHT_CODES.approvalNotYetValid,
        `разрешение действует с ${verifiedApproval.createdAt}, сейчас ${now}`,
        EXIT_CODES.preflightApprovalRejected)
    }
    if (nowMs >= validUntilMs) {
      /* Равенство правой границе — истечение: полномочие действует ДО момента,
         а не включительно. `deleteAfter` разрешения к сроку полномочия
         отношения не имеет — это срок хранения файла. */
      fail('P6', PREFLIGHT_CODES.approvalExpired,
        `разрешение истекло ${verifiedApproval.validUntil}, сейчас ${now}`,
        EXIT_CODES.preflightApprovalRejected)
    }
    if (nowMs >= planDeleteMs) {
      fail('P6', PREFLIGHT_CODES.planExpired,
        `план подлежит удалению с ${verifiedPlan.deleteAfter}, сейчас ${now}`)
    }
    pass('P6')

    /* ── P8. Набор порталов ───────────────────────────────────────────
       Исчезнувший из реестра портал — ожидаемый drift, а не программная
       ошибка: реестр вправе не знать источник, которого больше нет, и назвать
       это обязаны ворота, а не необработанное исключение из середины P7. */
    const planPortalIds = verifiedPlan.portals.map((fragment) => fragment.portalId)
    const portals = planPortalIds.map((portalId) => {
      /* Контракт резолвера явный и узкий: «такого источника больше нет»
         выражается ЗНАЧЕНИЕМ (`null` или `undefined`), а не исключением.
         Исключение отсюда наружу и уходит: объявить программную ошибку внутри
         реестра ожидаемым исчезновением портала значило бы выдать вердикт
         ворот там, где на деле сломался код. Подмена источника другим ловится
         тождеством ниже. */
      const portal = resolvePortal(portalId)
      if (portal === null || portal === undefined) {
        fail('P8', PREFLIGHT_CODES.portalSetMismatch,
          `${portalId}: реестр не знает такого источника — портал исчез, исполнять нечего`)
      }
      if (typeof portal !== 'object' || Array.isArray(portal) || typeof portal.id !== 'string') {
        throw new TypeError(
          `resolvePortal(${JSON.stringify(portalId)}): ожидается источник со строковым id либо `
          + `null; получено ${Array.isArray(portal) ? 'массив' : typeof portal}`,
        )
      }
      return portal
    })
    verdictOf('P8', PREFLIGHT_CODES.portalSetMismatch, () => {
      assertIdentity(planPortalIds, [...verifiedApproval.allowedPortalIds], 'порталы плана против разрешения')
      assertIdentity(planPortalIds, portals.map((portal) => portal.id), 'порталы плана против повторного прогона')
    })
    pass('P8')

    /* ── P7. Текущая policy каждого портала на now ────────────────────── */
    for (const portal of portals) {
      /* Известных этому прогону профилей ровно один — тот, на который
         построен план: его форма и привязка отпечатка к плану и разрешению
         проверены в P3 и P4. Подставить сюда произвольный список нельзя,
         потому что список выводится из проверенного профиля, а не приходит
         параметром. */
      verdictOf('P7', PREFLIGHT_CODES.policyDenied,
        () => assertPolicyShape(portal, { profiles: [profile] }), `${portal.id}: форма policy`)
      const verdict = evaluatePolicy(portal.modelProcessing, {
        now: new Date(nowMs), requiredFields: MODEL_INPUT_FIELDS, providerId: profile.id,
      })
      if (verdict.state !== POLICY_STATE_ALLOWED) {
        fail('P7', PREFLIGHT_CODES.policyDenied,
          `${portal.id}: policy на ${now} запрещает прогон — ${verdict.reasons.join(', ')}`)
      }
    }
    pass('P7')

    /* ── P9, P10. Повторный запуск источников ─────────────────────────── */
    phase = PREFLIGHT_PHASES[1]
    const fresh = []
    const freshClassificationItems = new Map()
    for (const portal of portals) {
      const evaluated = await rerunPortal(portal, { adapters })
      /* Ключи источника — предмет P9, и проверяются они ДО сборки фрагмента:
         пустой и повторный `sourceKey` означают, что сверять набор не с чем,
         и это расхождение набора, а не дефект кода. */
      const keys = evaluated.map((entry, i) => {
        const key = entry?.candidate?.sourceKey
        if (typeof key !== 'string' || !key.length) {
          fail('P9', PREFLIGHT_CODES.candidateSetMismatch,
            `${portal.id}: у кандидата ${i} нет sourceKey — сверять набор не с чем`)
        }
        return key
      })
      const duplicated = [...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))]
      if (duplicated.length) {
        fail('P9', PREFLIGHT_CODES.candidateSetMismatch,
          `${portal.id}: sourceKey повторяется: ${duplicated.join(', ')} — набор стал неоднозначным`)
      }
      /* Содержательный вход — предмет P10, и считается он ТЕМИ ЖЕ функциями,
         которыми его посчитал план. Неканоничное значение (одиночный суррогат,
         поле не той формы) — тоже drift входа, а не программная ошибка. */
      evaluated.forEach((entry, i) => {
        const item = verdictOf('P10', PREFLIGHT_CODES.inputDrift,
          () => buildClassificationItem(entry.candidate),
          `${portal.id} / ${keys[i]}: вход модели`)
        verdictOf('P10', PREFLIGHT_CODES.inputDrift,
          () => candidateInputDigest(item), `${portal.id} / ${keys[i]}: digest входа модели`)
        freshClassificationItems.set(candidateKey(portal.id, keys[i]), item)
      })
      /* Фрагмент собирает production-сборщик — тот же, что строил план.
         Обёртки здесь нет намеренно: обе его ожидаемые причины отказа уже
         названы воротами выше, поэтому всё, что осталось, — программная
         ошибка, и она обязана пройти наружу, а не стать вердиктом. */
      fresh.push(buildPortalPlanFragment({
        portal, evaluated, now: new Date(nowMs), providerProfile: profile,
      }))
    }
    const plannedItems = new Map()
    for (const fragment of verifiedPlan.portals) {
      for (const item of fragment.items) {
        plannedItems.set(candidateKey(fragment.portalId, item.sourceKey), item.candidateInputDigest.value)
      }
    }
    const freshItems = new Map()
    for (const fragment of fresh) {
      for (const item of fragment.items) {
        freshItems.set(candidateKey(fragment.portalId, item.sourceKey), item.candidateInputDigest.value)
      }
    }
    verdictOf('P9', PREFLIGHT_CODES.candidateSetMismatch, () => assertIdentity(
      [...plannedItems.keys()], [...freshItems.keys()], 'кандидаты плана против повторного прогона',
    ))
    pass('P9')

    for (const [key, plannedDigest] of plannedItems) {
      const freshDigest = freshItems.get(key)
      if (freshDigest !== plannedDigest) {
        fail('P10', PREFLIGHT_CODES.inputDrift,
          `${key.split(SEPARATOR).join(' / ')}: вход модели изменился — в плане ${plannedDigest}, `
          + `сейчас ${freshDigest}`)
      }
    }
    pass('P10')

    /* Точные item'ы передаются исполнителю ТОЛЬКО в памяти и только после
       полного совпадения P9/P10. Повторный запуск адаптеров после preflight
       открыл бы окно TOCTOU: запрос мог бы уйти уже с другими байтами, чем
       проверили ворота. requestItemId выводится здесь единственной общей
       формулой и поздний request/executor получает его готовым. */
    preparedItems = verifiedPlan.portals.flatMap((fragment) => fragment.items.map((item) => {
      const key = candidateKey(fragment.portalId, item.sourceKey)
      const classificationItem = freshClassificationItems.get(key)
      if (!classificationItem) {
        throw new TypeError(`${key}: после пройденных P9/P10 нет подготовленного item`)
      }
      return {
        portalId: fragment.portalId,
        sourceKey: item.sourceKey,
        requestItemId: requestItemId({
          planDigest: verifiedPlan.planDigest.value,
          portalId: fragment.portalId,
          sourceKey: item.sourceKey,
          candidateInputDigest: item.candidateInputDigest.value,
        }),
        candidateInputDigest: item.candidateInputDigest.value,
        classificationItem,
      }
    })).sort((left, right) => {
      if (left.portalId !== right.portalId) return left.portalId < right.portalId ? -1 : 1
      return left.requestItemId < right.requestItemId ? -1 : left.requestItemId > right.requestItemId ? 1 : 0
    })

    /* ── P5, вторая половина. Идентичность после источников ───────────── */
    const identityAfter = resolveCodeIdentity()
    assertCodeIdentity(identityAfter)
    if (identityAfter.dirty !== false) {
      fail('P5', PREFLIGHT_CODES.codeIdentityDrift,
        `после источников отслеживаемое дерево изменено, commit ${identityAfter.commit}`)
    }
    if (identityAfter.commit !== identityBefore.commit) {
      fail('P5', PREFLIGHT_CODES.codeIdentityDrift,
        `идентичность кода изменилась во время прогона: было ${identityBefore.commit}, `
        + `стало ${identityAfter.commit}`)
    }
    if (identityAfter.commit !== verifiedPlan.codeIdentity.commit) {
      fail('P5', PREFLIGHT_CODES.codeIdentityDrift,
        `HEAD ${identityAfter.commit} не равен идентичности плана ${verifiedPlan.codeIdentity.commit}`)
    }
    pass('P5')

    /* ── P11. Денежный итог ───────────────────────────────────────────
       Всё, из чего он считается, проверено в P3 и P4; здесь остаётся сама
       арифметика и сравнение с потолком разрешения. */
    try {
      budget = computeCostUpperBound({
        limits: verifiedApproval.limits, pricingTable: verifiedTable, profile,
      })
    } catch (error) {
      /* Классификация — отдельной функцией: только денежный отказ с машинным
         кодом становится вердиктом, всё остальное пробрасывается ею же. */
      fail('P11', budgetFailureCode(error), error.message)
    }
    pass('P11')

    return deepFreeze({
      ok: true,
      exitCode: EXIT_CODES.allAccepted,
      executionId,
      checkedAt,
      gates,
      warnings,
      budget,
      preparedItems,
      failure: null,
    })
  } catch (error) {
    if (!(error instanceof GateFailure)) throw error
    /* Отказавшие ворота помечаются отказом, и только они. Уже пройденные
       остаются пройденными: `notRun` здесь означало бы, что проверка не
       исполнялась, — а она исполнялась и прошла. */
    gates[error.gate] = 'failed'
    return deepFreeze({
      ok: false,
      exitCode: error.exitCode,
      executionId,
      checkedAt,
      gates,
      warnings,
      budget: null,
      preparedItems: null,
      failure: {
        gate: error.gate, code: error.code, phase: error.phase, message: error.message,
      },
    })
  }
}
