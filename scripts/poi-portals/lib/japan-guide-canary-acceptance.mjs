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

import { ROLES_BY_FAMILY, VERSION_POLICY, orderedPoiKeys } from './discovery-contract.mjs'

/**
 * Правила ЭТОГО снимка, а не «текущие».
 *
 * Приёмка читает снимки любых читаемых версий, и достижимое множество у них
 * считается по-разному: у `v1`/`v2` порядок — список объектов, у `v3` —
 * последовательность с ролями, где коллекция объектом не является. Брать
 * правила «текущей» версии значило бы считать роль там, где её не записывали,
 * и наоборот. Чужая версия сюда не доходит: контракт проверен раньше.
 */
const policyOf = (snapshot) => VERSION_POLICY[snapshot.contractVersion]

/**
 * ОБЛАСТЬ ЭТОЙ ПРИЁМКИ — `v1` и `v2`, И ЭТО НЕ УПУЩЕНИЕ.
 *
 * Условия приёмки здесь — буквально операционная цель этапа 10c: canary с
 * `--limit 50` под потолком 300 обменов. Экономика у неё двухуровневая:
 * предел резал список объектов ДО получения их страниц, и 259 обменов при
 * 1170 найденных объектах были честной записью.
 *
 * В `v3` предел сеть не экономит: роль карточки выясняется только её
 * страницей, поэтому ограниченный обход графа стоит столько же, сколько
 * полный, и под потолок 300 нынешний корпус не помещается ни при каких
 * данных. Оценщик, продолжающий считать по старой формуле, принял бы
 * операционно невозможный снимок — измерено: фикстуру на 259 обменов он
 * принимал целиком.
 *
 * Операционная цель для `v3` владельцем не задана. Выдумать её здесь значило
 * бы выдать собственный критерий за согласованный, поэтому приёмка
 * ОТКАЗЫВАЕТ именованным кодом, а не подгоняет формулу. Целостность самого
 * снимка при этом проверяется строже прежнего — нижняя граница обменов
 * выведена из состава снимка и живёт в контракте, то есть действует на КАЖДЫЙ
 * снимок `v3`, а не только на canary.
 */
const SUPPORTED_SNAPSHOT_SPECS = Object.freeze([
  'poi-discovery-snapshot/v1',
  'poi-discovery-snapshot/v2',
])

/** Объекты, достижимые из порядков коллекций, — по правилам самого снимка. */
const reachablePoiKeys = (snapshot) => {
  const spec = policyOf(snapshot).order
  return snapshot.orderRecords.flatMap((row) => orderedPoiKeys(row, spec))
}

/**
 * Сколько ЦЕЛЕЙ КАТАЛОГА оказалось коллекциями.
 *
 * Ветви «а если формат разделяет коллекции по происхождению» здесь НЕТ, и это
 * не упущение: до этого места доходят только `v1` и `v2`, а у них счётчик
 * один и называется `collectionsFound`. Ветвь для `v3` была бы недостижима, а
 * недостижимую не убивает ни одна мутация — то есть её никто не проверяет.
 */
const catalogueCollectionCount = (snapshot) => snapshot.counters.collectionsFound

export const EXPECTED_NUMERIC_SUFFIX_KEYS = Object.freeze(
  Array.from({ length: 6 }, (_, index) =>
    `japan-guide:e3034_${String(index + 1).padStart(3, '0')}`),
)

const LABELS = Object.freeze({
  unsupportedSnapshotVersion: 'формат снимка входит в область этой приёмки',
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
  const reachable = new Set([...reachablePoiKeys(snapshot), ...directKeys])
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

  /*
   * ВЕРСИЯ ПРОВЕРЯЕТСЯ ПЕРВОЙ И ЗАКРЫВАЕТ ВЫЗОВ.
   *
   * Отказ, а не «предупреждение среди прочих»: считать бюджет по формуле
   * `v2` для снимка `v3` значило бы отдать число, у которого нет смысла, —
   * и вызывающий не смог бы отличить его от посчитанного.
   */
  if (!SUPPORTED_SNAPSHOT_SPECS.includes(snapshot.contractVersion)) {
    const checks = Object.freeze([Object.freeze({
      code: 'unsupportedSnapshotVersion',
      label: LABELS.unsupportedSnapshotVersion,
      passed: false,
    })])
    return Object.freeze({
      accepted: false,
      checks,
      failures: checks,
      failureCodes: Object.freeze(['unsupportedSnapshotVersion']),
      computedBudgetStatus: 'indeterminate',
      computedBudget: null,
      budgetBlockers: Object.freeze({}),
      missingNumericSuffixKeys: Object.freeze([]),
      supportedSnapshotSpecs: SUPPORTED_SNAPSHOT_SPECS,
    })
  }

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
    /* Сумма с прямыми объектами обязана давать число целей каталога, и
       вложенные коллекции в неё не входят: они не цели каталога. */
    targetsOutsideRoleSum: counters.catalogueTargetsFound
      - (catalogueCollectionCount(snapshot) + counters.directPoisFound),
  })
  const computedBudgetStatus = Object.values(budgetBlockers).some((count) => count !== 0)
    ? 'indeterminate'
    : 'usable'
  const computedBudget = expectedBudget(snapshot, { maxRedirects, redirectCount })

  const orderedKeys = new Set(reachablePoiKeys(snapshot))
  const missingNumericSuffixKeys = EXPECTED_NUMERIC_SUFFIX_KEYS
    .filter((key) => !orderedKeys.has(key))
  const poiOnlySuffixPolicy = ROLES_BY_FAMILY.legacySuffix.length === 1
    && ROLES_BY_FAMILY.legacySuffix[0] === 'poi'

  const checks = [
    /* Версия уже отфильтрована выше; строка нужна, чтобы состав проверок не
       зависел от исхода и вызывающий видел один и тот же список. */
    ['unsupportedSnapshotVersion', true],
    ['scopeMismatch', expectedScope],
    ['unexpectedIncompleteReasons', JSON.stringify(reasons) === JSON.stringify(expectedReasons)],
    ['completeMismatch', snapshot.complete === expectedComplete],
    ['recordsBuiltMismatch', counters.recordsBuilt === expectedRecords],
    ['rejectedTargetsPresent', snapshot.rejected.targets.length === 0],
    ['rejectedCardsPresent', snapshot.rejected.cards.length === 0],
    ['rejectedPoisPresent', snapshot.rejected.pois.length === 0],
    ['catalogueTargetsUnclassified',
      snapshot.catalogueTargetEvidence.length === counters.catalogueTargetsFound
      && catalogueCollectionCount(snapshot) + counters.directPoisFound
        === counters.catalogueTargetsFound],
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
    supportedSnapshotSpecs: SUPPORTED_SNAPSHOT_SPECS,
  })
}
