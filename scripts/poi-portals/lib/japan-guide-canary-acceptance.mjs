/**
 * Офлайн-приёмка canary Japan Guide.
 *
 * ЭТО НЕ КОНТРАКТ СНИМКА. `assertDiscoverySnapshot` отвечает, можно ли
 * доверять форме и связности артефакта; эта функция отвечает, достиг ли
 * конкретный canary операционной цели 10c. Runner обязан сначала проверить
 * контракт и лишь затем передать снимок сюда. Смешивать два исхода нельзя:
 * негодный JSON и честный, но не принятый canary требуют разных действий.
 *
 * Функция чистая и используется самим runner'ом и тестом. Второй реализации
 * условий приёмки нет: прежние локальные копии зеленели после поломки
 * настоящего потребителя.
 */

import { ROLES_BY_FAMILY } from './discovery-contract.mjs'

export const EXPECTED_NUMERIC_SUFFIX_KEYS = Object.freeze(
  Array.from({ length: 6 }, (_, index) =>
    `japan-guide:e3034_${String(index + 1).padStart(3, '0')}`),
)

const LABELS = Object.freeze({
  scopeMismatch: 'охват соответствует фактически применённому пределу',
  unexpectedIncompleteReasons: 'состав причин неполноты соответствует охвату',
  completeMismatch: 'полнота соответствует фактическому охвату',
  recordsBuiltMismatch: 'число записей соответствует пределу или найденным объектам',
  rejectedTargetsPresent: 'rejected.targets пуст',
  rejectedCardsPresent: 'rejected.cards пуст',
  rejectedPoisPresent: 'rejected.pois пуст',
  catalogueTargetsUnclassified: 'все цели каталога классифицированы',
  nonCanonicalLinksPresent: 'непригодных ссылок каталога нет',
  networkBudgetReached: 'сетевой потолок не достигнут',
  expectedNumericSuffixKeysMissing: 'все e3034_001…_006 присутствуют в orderRecord',
  numericSuffixRolePolicyMismatch: 'legacySuffix допускает только poi',
  reportedBudgetStatusMismatch: 'записанный статус бюджета сходится с первичными счётчиками',
  budgetStatusNotUsable: 'бюджет полного обхода пригоден к использованию',
  reportedBudgetMissing: 'при пригодном бюджете записаны все величины',
  budgetBaseMismatch: 'base сходится с независимым пересчётом',
  budgetStrictMaxMismatch: 'strictMax сходится с независимым пересчётом',
  budgetConditionalUpperMismatch: 'conditionalUpper сходится с независимым пересчётом',
  budgetMaxRedirectsMismatch: 'maxRedirects в бюджете совпадает с контрактом',
})

/** Закрытый список выводится из единственной таблицы, а не повторяет её. */
export const CANARY_ACCEPTANCE_CODES = Object.freeze(Object.keys(LABELS))

function assertNonNegativeInteger(value, where) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${where}: ожидается неотрицательное безопасное целое`)
  }
}

function expectedBudget(snapshot, { maxRedirects, redirectCount }) {
  const counters = snapshot.counters
  const directKeys = new Set(snapshot.catalogueTargetEvidence
    .filter((row) => row.evidence.pageRole === 'poi')
    .map((row) => row.sourceKey))
  const reachable = new Set([
    ...snapshot.orderRecords.flatMap((row) => row.order),
    ...directKeys,
  ])
  const visited = new Set(snapshot.records.map((record) => record.sourceKey))
  const unfetchedUnvisited = [...reachable]
    .filter((key) => !visited.has(key) && !directKeys.has(key))

  const base = 2 + counters.catalogueTargetsFound
    + (counters.poisFound - counters.directPoisFound)
  const strictMax = base * (1 + maxRedirects)
  const conditionalUpper = base + redirectCount + unfetchedUnvisited.length * maxRedirects
  for (const [field, value] of Object.entries({ base, strictMax, conditionalUpper })) {
    assertNonNegativeInteger(value, `canaryBudget.${field}`)
  }
  return Object.freeze({
    base,
    strictMax,
    conditionalUpper,
    maxRedirects,
    unfetchedUnvisited: unfetchedUnvisited.length,
  })
}

/**
 * @param {{
 *   snapshot: object,
 *   limit: number,
 *   maxNetworkRequests: number,
 *   maxRedirects: number,
 *   redirectCount: number,
 *   reportedBudgetStatus: 'usable'|'indeterminate',
 *   reportedBudget: null|{base:number,strictMax:number,conditionalUpper:number,maxRedirects:number},
 * }} input
 */
export function evaluateJapanGuideCanaryAcceptance(input) {
  const {
    snapshot,
    limit,
    maxNetworkRequests,
    maxRedirects,
    redirectCount,
    reportedBudgetStatus,
    reportedBudget,
  } = input
  assertNonNegativeInteger(limit, 'canary.limit')
  if (limit < 1) throw new TypeError('canary.limit: ожидается целое не меньше 1')
  assertNonNegativeInteger(maxNetworkRequests, 'canary.maxNetworkRequests')
  if (maxNetworkRequests < 1) {
    throw new TypeError('canary.maxNetworkRequests: ожидается целое не меньше 1')
  }
  assertNonNegativeInteger(maxRedirects, 'canary.maxRedirects')
  assertNonNegativeInteger(redirectCount, 'canary.redirectCount')

  const counters = snapshot.counters
  const reasons = snapshot.incompleteReasons.map((reason) => reason.code)
  const cutExpected = counters.poisFound > limit
  const expectedReasons = cutExpected ? ['limitApplied'] : []
  const expectedScope = cutExpected
    ? snapshot.scope.kind === 'limited' && snapshot.scope.limit === limit
    : snapshot.scope.kind === 'full' && snapshot.scope.limit === null
  const expectedComplete = !cutExpected
  const expectedRecords = cutExpected ? limit : counters.poisFound

  const budgetBlockers = Object.freeze({
    rejectedTargets: snapshot.rejected.targets.length,
    rejectedCards: snapshot.rejected.cards.length,
    rejectedPois: snapshot.rejected.pois.length,
    targetsWithoutEvidence: counters.catalogueTargetsFound - snapshot.catalogueTargetEvidence.length,
    targetsOutsideRoleSum: counters.catalogueTargetsFound
      - (counters.collectionsFound + counters.directPoisFound),
  })
  const computedBudgetStatus = Object.values(budgetBlockers).some((count) => count !== 0)
    ? 'indeterminate'
    : 'usable'
  const computedBudget = expectedBudget(snapshot, { maxRedirects, redirectCount })

  const orderedKeys = new Set(snapshot.orderRecords.flatMap((row) => row.order))
  const missingNumericSuffixKeys = EXPECTED_NUMERIC_SUFFIX_KEYS
    .filter((key) => !orderedKeys.has(key))
  const poiOnlySuffixPolicy = ROLES_BY_FAMILY.legacySuffix.length === 1
    && ROLES_BY_FAMILY.legacySuffix[0] === 'poi'

  const checks = [
    ['scopeMismatch', expectedScope],
    ['unexpectedIncompleteReasons', JSON.stringify(reasons) === JSON.stringify(expectedReasons)],
    ['completeMismatch', snapshot.complete === expectedComplete],
    ['recordsBuiltMismatch', counters.recordsBuilt === expectedRecords],
    ['rejectedTargetsPresent', snapshot.rejected.targets.length === 0],
    ['rejectedCardsPresent', snapshot.rejected.cards.length === 0],
    ['rejectedPoisPresent', snapshot.rejected.pois.length === 0],
    ['catalogueTargetsUnclassified',
      snapshot.catalogueTargetEvidence.length === counters.catalogueTargetsFound
      && counters.collectionsFound + counters.directPoisFound === counters.catalogueTargetsFound],
    ['nonCanonicalLinksPresent', counters.nonCanonicalLinks === 0],
    ['networkBudgetReached', counters.networkRequests < maxNetworkRequests],
    ['expectedNumericSuffixKeysMissing', missingNumericSuffixKeys.length === 0],
    ['numericSuffixRolePolicyMismatch', poiOnlySuffixPolicy],
    ['reportedBudgetStatusMismatch', reportedBudgetStatus === computedBudgetStatus],
    ['budgetStatusNotUsable', reportedBudgetStatus === 'usable'],
    ['reportedBudgetMissing', computedBudgetStatus !== 'usable' || reportedBudget !== null],
    ['budgetBaseMismatch', computedBudgetStatus !== 'usable'
      || reportedBudget?.base === computedBudget.base],
    ['budgetStrictMaxMismatch', computedBudgetStatus !== 'usable'
      || reportedBudget?.strictMax === computedBudget.strictMax],
    ['budgetConditionalUpperMismatch', computedBudgetStatus !== 'usable'
      || reportedBudget?.conditionalUpper === computedBudget.conditionalUpper],
    ['budgetMaxRedirectsMismatch', computedBudgetStatus !== 'usable'
      || reportedBudget?.maxRedirects === maxRedirects],
  ].map(([code, passed]) => {
    if (!Object.hasOwn(LABELS, code)) throw new TypeError(`canaryAcceptance: неизвестный код ${code}`)
    return Object.freeze({ code, label: LABELS[code], passed })
  })

  const failures = checks.filter((check) => !check.passed)
  return Object.freeze({
    accepted: failures.length === 0,
    checks: Object.freeze(checks),
    failures: Object.freeze(failures),
    failureCodes: Object.freeze(failures.map((failure) => failure.code)),
    computedBudgetStatus,
    computedBudget,
    budgetBlockers,
    missingNumericSuffixKeys: Object.freeze(missingNumericSuffixKeys),
  })
}
