/**
 * Реестр таксономии POI: чтение, проверка инвариантов и производные списки.
 *
 * Потребитель № 1 из ADR-0001 §13. Модуль намеренно ничего не подключает:
 * ни приём, ни Airtable, ни XLSX, ни классификатор. Он читает
 * config/poi-taxonomy.v1.json, проверяет его при загрузке и отдаёт
 * замороженные производные — больше ничего.
 *
 * Правило, ради которого модуль написан: ни одного перечня кодов, подписей,
 * фасетов, бейджей, языков и служебных слов маршрутизации здесь нет. Всё
 * строится из JSON, включая словарь сопоставления (routingVocabulary) и набор
 * языков (languages, defaultLanguage). Тест сверяет строковые литералы модуля
 * со строковыми значениями реестра: пересечение обязано быть пустым.
 *
 * AJV намеренно не импортируется: он объявлен в devDependencies, в
 * production-рантайме его нет. Проверка по JSON Schema живёт в тестах,
 * структурные инварианты — здесь, обычным кодом без зависимостей.
 *
 * Атрибут `with { type: 'json' }` обязателен: без него сборка Next проходит,
 * а запуск из node падает с ERR_IMPORT_ATTRIBUTE_MISSING. С ним читают оба.
 */
import rawRegistry from '../../config/poi-taxonomy.v1.json' with { type: 'json' }

// ── Формы данных ──────────────────────────────────────────────────────────

export type Labels = Readonly<Record<string, string>>
export type HintSets = Readonly<Record<string, readonly string[]>>

export interface Coded {
  readonly code: string
  readonly labels: Labels
}

export interface PoiTypeGroup extends Coded {
  readonly ambiguousHints?: HintSets
  readonly ambiguousHintNote?: string
}

export interface PoiPrimaryType extends Coded {
  readonly group: string
  readonly autoImportAllowed: boolean
  readonly hints?: HintSets
  readonly include?: readonly string[]
  readonly exclude?: readonly string[]
  readonly note?: string
}

export interface Badge extends Coded {
  readonly assignedBy: string
}

export interface RoutingVocabulary {
  readonly note?: string
  readonly wildcard: string
  readonly typeStateKnown: string
  readonly typeStateUnknown: string
  readonly classificationSources: readonly string[]
}

export interface RoutingRule {
  readonly id: string
  readonly entityKind: string
  readonly typeState: string
  readonly classificationSource: string
  readonly disposition: string
  readonly catalogTarget: string | null
  readonly excludeReason?: string
  readonly requiresNote?: boolean
  readonly why: string
}

export interface LegacyCategoryMigration {
  readonly value: string
  readonly mapsTo: string | null
  readonly mode: string
  readonly records: number
  readonly reason?: string
}

export interface TaxonomyRegistry {
  readonly version: string
  readonly note: string
  readonly languages: readonly string[]
  readonly defaultLanguage: string
  readonly routingVocabulary: RoutingVocabulary
  readonly dispositions: readonly string[]
  readonly catalogTargets: readonly string[]
  readonly entityKinds: readonly Coded[]
  readonly excludeReasons: readonly Coded[]
  readonly routingPolicy: readonly RoutingRule[]
  readonly poiTypeGroups: readonly PoiTypeGroup[]
  readonly poiPrimaryTypes: readonly PoiPrimaryType[]
  readonly facets: readonly Coded[]
  readonly badges: readonly Badge[]
  readonly legacyCategoryMigrations: readonly LegacyCategoryMigration[]
  readonly labelHistory: readonly unknown[]
}

export interface RouteInput {
  readonly entityKind: string
  readonly poiPrimaryType?: string | null
  readonly classificationSource: string
}

export interface RouteDecision {
  readonly ruleId: string
  readonly typeState: string
  readonly disposition: string
  readonly catalogTarget: string | null
  readonly excludeReason: string | null
  readonly requiresNote: boolean
  readonly why: string
}

export interface LabelledOption {
  readonly code: string
  readonly label: string
}

export interface PoiTypeOption extends LabelledOption {
  readonly group: string
  readonly groupLabel: string
  readonly autoImportAllowed: boolean
}

// ── Неизменяемость ────────────────────────────────────────────────────────

/**
 * Рекурсивная заморозка. Потребитель получает ту же ссылку, что и все
 * остальные, поэтому любая правка «под себя» испортила бы реестр для всех.
 * В строгом режиме (а ESM всегда строгий) попытка записи бросает TypeError,
 * то есть ломается там же, где написана, а не через три модуля.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as unknown as Record<string, unknown>)[key])
  }
  return value
}

// ── Общие операции над реестром ───────────────────────────────────────────
/* Всё ниже параметризовано реестром, а не берёт загруженный экземпляр из
   замыкания. Иначе получилось бы две реализации маршрутизации: одна для
   resolveRoute, другая для проверки при загрузке — а расходились бы они
   ровно в том случае, ради которого проверка и написана. */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function codesOf(list: readonly Coded[]): string[] {
  return list.map((item) => item.code)
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) dupes.add(value)
    seen.add(value)
  }
  return [...dupes]
}

const TYPE_CODE_CACHE = new WeakMap<object, ReadonlySet<string>>()
const POLICY_STATE_CACHE = new WeakMap<object, ReadonlySet<string>>()
const ENTITY_KIND_CACHE = new WeakMap<object, ReadonlySet<string>>()
const SOURCE_CACHE = new WeakMap<object, ReadonlySet<string>>()

function entityKindCodeSetIn(reg: TaxonomyRegistry): ReadonlySet<string> {
  const cached = ENTITY_KIND_CACHE.get(reg)
  if (cached) return cached
  const built: ReadonlySet<string> = new Set(codesOf(reg.entityKinds))
  ENTITY_KIND_CACHE.set(reg, built)
  return built
}

function sourceSetIn(reg: TaxonomyRegistry): ReadonlySet<string> {
  const cached = SOURCE_CACHE.get(reg)
  if (cached) return cached
  const built: ReadonlySet<string> = new Set(reg.routingVocabulary.classificationSources)
  SOURCE_CACHE.set(reg, built)
  return built
}

function typeCodeSet(reg: TaxonomyRegistry): ReadonlySet<string> {
  const cached = TYPE_CODE_CACHE.get(reg)
  if (cached) return cached
  const built: ReadonlySet<string> = new Set(codesOf(reg.poiPrimaryTypes))
  TYPE_CODE_CACHE.set(reg, built)
  return built
}

/**
 * Коды типов, которые сама политика упоминает как отдельное состояние.
 * Выводятся из данных: заведёт реестр второй такой тип — подхватится сам.
 * Ради этого множества и существует typeStateIn: без него резервный тип
 * считался бы обычным известным, общее правило увело бы его в каталог, а
 * правило, запрещающее его автоимпорт, стало бы недостижимым.
 */
function policyTypeStateSet(reg: TaxonomyRegistry): ReadonlySet<string> {
  const cached = POLICY_STATE_CACHE.get(reg)
  if (cached) return cached
  const types = typeCodeSet(reg)
  const built: ReadonlySet<string> = new Set(
    reg.routingPolicy.map((rule) => rule.typeState).filter((state) => types.has(state)),
  )
  POLICY_STATE_CACHE.set(reg, built)
  return built
}

function typeStateIn(reg: TaxonomyRegistry, code: string | null | undefined): string {
  const vocabulary = reg.routingVocabulary
  if (typeof code !== 'string' || !code) return vocabulary.typeStateUnknown
  if (policyTypeStateSet(reg).has(code)) return code
  return typeCodeSet(reg).has(code) ? vocabulary.typeStateKnown : vocabulary.typeStateUnknown
}

/** Все состояния типа, которые политика обязана уметь разобрать. */
function typeStatesIn(reg: TaxonomyRegistry): string[] {
  const vocabulary = reg.routingVocabulary
  return [...new Set([vocabulary.typeStateKnown, vocabulary.typeStateUnknown, ...policyTypeStateSet(reg)])]
}

function rulesMatching(
  reg: TaxonomyRegistry,
  entityKind: string,
  typeState: string,
  classificationSource: string,
): RoutingRule[] {
  const wildcard = reg.routingVocabulary.wildcard
  return reg.routingPolicy.filter(
    (rule) =>
      rule.entityKind === entityKind &&
      (rule.typeState === wildcard || rule.typeState === typeState) &&
      (rule.classificationSource === wildcard || rule.classificationSource === classificationSource),
  )
}

// ── Проверка инвариантов ──────────────────────────────────────────────────

const VERSION_SHAPE = /^[a-z0-9-]+\/v[0-9]+$/

/**
 * Возвращает список претензий к кандидату. Функция чистая и принимает что
 * угодно: тесты кормят её испорченными копиями реестра, assertTaxonomyInvariants
 * — настоящим. Ни одна проверка не дублирует JSON Schema: схема ловит форму,
 * здесь — ссылочная целостность, согласованность языков и однозначность
 * политики маршрутизации.
 */
export function taxonomyProblems(candidate: unknown): string[] {
  const problems: string[] = []
  if (!isRecord(candidate)) return ['реестр не объект']

  const listFields = [
    'languages',
    'dispositions',
    'catalogTargets',
    'entityKinds',
    'excludeReasons',
    'routingPolicy',
    'poiTypeGroups',
    'poiPrimaryTypes',
    'facets',
    'badges',
    'legacyCategoryMigrations',
    'labelHistory',
  ] as const
  for (const field of listFields) {
    if (!Array.isArray(candidate[field])) problems.push(`поле ${field} не массив`)
  }
  if (typeof candidate.version !== 'string' || !VERSION_SHAPE.test(candidate.version)) {
    problems.push(`версия ${JSON.stringify(candidate.version)} не вида «имя/vN»`)
  }
  if (!isRecord(candidate.routingVocabulary)) problems.push('routingVocabulary не объект')
  if (typeof candidate.defaultLanguage !== 'string') problems.push('defaultLanguage не строка')
  if (problems.length) return problems

  const reg = candidate as unknown as TaxonomyRegistry
  const vocabulary = reg.routingVocabulary

  // ── Словарь маршрутизации ───────────────────────────────────────────────
  const tokens: ReadonlyArray<readonly [string, unknown]> = [
    ['wildcard', vocabulary.wildcard],
    ['typeStateKnown', vocabulary.typeStateKnown],
    ['typeStateUnknown', vocabulary.typeStateUnknown],
  ]
  for (const [name, value] of tokens) {
    if (typeof value !== 'string' || !value.trim()) {
      problems.push(`routingVocabulary/${name}: не заполнено`)
    }
  }
  if (!Array.isArray(vocabulary.classificationSources) || !vocabulary.classificationSources.length) {
    problems.push('routingVocabulary/classificationSources: пусто')
  }
  if (problems.length) return problems

  const wildcard = vocabulary.wildcard
  const sources = vocabulary.classificationSources
  if (new Set([wildcard, vocabulary.typeStateKnown, vocabulary.typeStateUnknown]).size !== 3) {
    problems.push('routingVocabulary: служебные слова совпадают между собой')
  }
  for (const dupe of duplicates(sources)) {
    problems.push(`routingVocabulary/classificationSources: ${dupe} повторяется`)
  }
  if (sources.includes(wildcard)) {
    problems.push('routingVocabulary/classificationSources: содержит служебное слово подстановки')
  }

  // ── Языки ───────────────────────────────────────────────────────────────
  const langs = [...reg.languages]
  if (!langs.length) problems.push('languages: пусто')
  for (const dupe of duplicates(langs)) problems.push(`languages: ${dupe} повторяется`)
  if (!langs.includes(reg.defaultLanguage)) {
    problems.push(`defaultLanguage ${JSON.stringify(reg.defaultLanguage)} не входит в languages`)
  }
  const langKey = [...langs].sort().join('|')

  // ── Коды ────────────────────────────────────────────────────────────────
  const codedGroups: ReadonlyArray<readonly [string, readonly Coded[]]> = [
    ['entityKinds', reg.entityKinds],
    ['excludeReasons', reg.excludeReasons],
    ['poiTypeGroups', reg.poiTypeGroups],
    ['poiPrimaryTypes', reg.poiPrimaryTypes],
    ['facets', reg.facets],
    ['badges', reg.badges],
  ]

  for (const [name, list] of codedGroups) {
    if (!list.length) problems.push(`${name}: пусто`)
    for (const dupe of duplicates(codesOf(list))) {
      problems.push(`${name}: код ${dupe} встречается дважды`)
    }
    for (const item of list) {
      const own = Object.keys(item.labels ?? {})
      if ([...own].sort().join('|') !== langKey) {
        problems.push(`${name}/${item.code}: языки подписей ${own.join(',')} ≠ ${langs.join(',')}`)
      }
      for (const lang of own) {
        if (typeof item.labels[lang] !== 'string' || !item.labels[lang].trim()) {
          problems.push(`${name}/${item.code}: пустая подпись ${lang}`)
        }
      }
    }
  }
  for (const dupe of duplicates(reg.routingPolicy.map((rule) => rule.id))) {
    problems.push(`routingPolicy: идентификатор ${dupe} встречается дважды`)
  }

  const entityKindCodeSet = new Set(codesOf(reg.entityKinds))
  const typeCodes = new Set(codesOf(reg.poiPrimaryTypes))
  const groupCodes = new Set(codesOf(reg.poiTypeGroups))
  const excludeReasonCodes = new Set(codesOf(reg.excludeReasons))
  const dispositionSet = new Set(reg.dispositions)
  const catalogTargetSet = new Set(reg.catalogTargets)
  const sourceSet = new Set(sources)

  // Служебное слово, совпавшее с кодом типа, сделало бы состояние типа
  // двусмысленным: непонятно, обобщённое оно или конкретный тип.
  for (const [name, value] of tokens) {
    if (typeof value === 'string' && typeCodes.has(value)) {
      problems.push(`routingVocabulary/${name}: ${value} совпадает с кодом типа POI`)
    }
  }

  for (const type of reg.poiPrimaryTypes) {
    if (!groupCodes.has(type.group)) {
      problems.push(`poiPrimaryTypes/${type.code}: группа ${type.group} не объявлена`)
    }
    if (typeof type.autoImportAllowed !== 'boolean') {
      problems.push(`poiPrimaryTypes/${type.code}: autoImportAllowed не булево`)
    }
    for (const lang of Object.keys(type.hints ?? {})) {
      if (!langs.includes(lang)) {
        problems.push(`poiPrimaryTypes/${type.code}: подсказки на незаявленном языке ${lang}`)
      }
    }
  }
  for (const group of reg.poiTypeGroups) {
    if (!reg.poiPrimaryTypes.some((type) => type.group === group.code)) {
      problems.push(`poiTypeGroups/${group.code}: группа без типов`)
    }
    for (const lang of Object.keys(group.ambiguousHints ?? {})) {
      if (!langs.includes(lang)) {
        problems.push(`poiTypeGroups/${group.code}: подсказки на незаявленном языке ${lang}`)
      }
    }
  }

  for (const rule of reg.routingPolicy) {
    if (!entityKindCodeSet.has(rule.entityKind)) {
      problems.push(`routingPolicy/${rule.id}: вид сущности ${rule.entityKind} не объявлен`)
    }
    if (!dispositionSet.has(rule.disposition)) {
      problems.push(`routingPolicy/${rule.id}: исход ${rule.disposition} не объявлен`)
    }
    if (rule.catalogTarget !== null && !catalogTargetSet.has(rule.catalogTarget)) {
      problems.push(`routingPolicy/${rule.id}: адрес каталога ${rule.catalogTarget} не объявлен`)
    }
    if (rule.excludeReason !== undefined && !excludeReasonCodes.has(rule.excludeReason)) {
      problems.push(`routingPolicy/${rule.id}: причина исключения ${rule.excludeReason} не объявлена`)
    }
    const state = rule.typeState
    const genericState =
      state === wildcard || state === vocabulary.typeStateKnown || state === vocabulary.typeStateUnknown
    if (!genericState && !typeCodes.has(state)) {
      problems.push(`routingPolicy/${rule.id}: состояние типа ${state} — ни служебное слово, ни код типа`)
    }
    if (rule.classificationSource !== wildcard && !sourceSet.has(rule.classificationSource)) {
      problems.push(`routingPolicy/${rule.id}: источник ${rule.classificationSource} не объявлен`)
    }
    if (!rule.why || typeof rule.why !== 'string') {
      problems.push(`routingPolicy/${rule.id}: правило без объяснения`)
    }
  }

  /* ── Исчерпывающий перебор ──────────────────────────────────────────────
     Раньше он жил только в тестах, а значит пропущенный прогон тестов
     пропускал бы и неоднозначную политику: resolveRoute молча брал бы первое
     подходящее правило. Теперь перебор идёт при загрузке, поэтому импорт
     падает независимо от того, запускались тесты или нет.

     Требование сильнее прежнего «хотя бы одно правило»: на каждое сочетание
     обязано находиться РОВНО одно. Ноль — дыра, больше одного — двусмысленность,
     разрешавшаяся порядком строк в файле. */
  const reachedRules = new Set<string>()
  for (const kind of codesOf(reg.entityKinds)) {
    for (const state of typeStatesIn(reg)) {
      for (const source of sources) {
        const winners = rulesMatching(reg, kind, state, source)
        // Сработавшим считается каждое совпавшее правило, даже когда их
        // несколько. Иначе одно пересечение порождало бы сразу три претензии:
        // саму двусмысленность и две ложные «недостижимости».
        for (const winner of winners) reachedRules.add(winner.id)
        if (winners.length === 0) {
          problems.push(`политика: нет правила для ${kind} / ${state} / ${source}`)
        } else if (winners.length > 1) {
          problems.push(
            `политика: ${kind} / ${state} / ${source} подходит сразу под ${winners
              .map((rule) => rule.id)
              .join(', ')}`,
          )
        }
      }
    }
  }
  for (const rule of reg.routingPolicy) {
    if (!reachedRules.has(rule.id)) {
      problems.push(`routingPolicy/${rule.id}: правило недостижимо ни одним сочетанием`)
    }
  }

  for (const migration of reg.legacyCategoryMigrations) {
    if (migration.mapsTo !== null && !typeCodes.has(migration.mapsTo)) {
      problems.push(`legacyCategoryMigrations/${migration.value}: цель ${migration.mapsTo} не объявлена`)
    }
    if (!Number.isInteger(migration.records) || migration.records < 0) {
      problems.push(`legacyCategoryMigrations/${migration.value}: некорректный счётчик записей`)
    }
  }

  return problems
}

// ── Загрузка ──────────────────────────────────────────────────────────────

const registry = deepFreeze(rawRegistry as unknown as TaxonomyRegistry)

/**
 * Бросает, если реестр не выдерживает инвариантов. Вызывается ниже при
 * загрузке модуля: испорченный реестр обязан ломать импорт, а не всплывать
 * посреди приёма.
 */
export function assertTaxonomyInvariants(candidate: unknown = registry): void {
  const problems = taxonomyProblems(candidate)
  if (problems.length) {
    throw new Error(`Реестр таксономии не прошёл проверку: ${problems.join('; ')}`)
  }
}

assertTaxonomyInvariants()

// ── Производные ───────────────────────────────────────────────────────────

/** Замороженный реестр целиком — на случай, когда потребителю нужен он сам.
 *  Правку бросает. */
export const taxonomy: TaxonomyRegistry = registry

export const taxonomyVersion: string = registry.version
export const taxonomyNote: string = registry.note

export const languages: readonly string[] = registry.languages
export const defaultLanguage: string = registry.defaultLanguage
export const routingVocabulary: RoutingVocabulary = registry.routingVocabulary
export const classificationSources: readonly string[] = registry.routingVocabulary.classificationSources

export const dispositions: readonly string[] = registry.dispositions
export const catalogTargets: readonly string[] = registry.catalogTargets
export const entityKinds: readonly Coded[] = registry.entityKinds
export const excludeReasons: readonly Coded[] = registry.excludeReasons
export const poiTypeGroups: readonly PoiTypeGroup[] = registry.poiTypeGroups
export const poiPrimaryTypes: readonly PoiPrimaryType[] = registry.poiPrimaryTypes
export const facets: readonly Coded[] = registry.facets
export const badges: readonly Badge[] = registry.badges
export const routingPolicy: readonly RoutingRule[] = registry.routingPolicy
export const legacyCategoryMigrations: readonly LegacyCategoryMigration[] =
  registry.legacyCategoryMigrations
export const labelHistory: readonly unknown[] = registry.labelHistory

function indexBy<T extends Coded>(list: readonly T[]): ReadonlyMap<string, T> {
  return new Map(list.map((item) => [item.code, item] as const))
}

const ENTITY_KIND_BY_CODE = indexBy(registry.entityKinds)
const TYPE_BY_CODE = indexBy(registry.poiPrimaryTypes)
const GROUP_BY_CODE = indexBy(registry.poiTypeGroups)
const FACET_BY_CODE = indexBy(registry.facets)
const BADGE_BY_CODE = indexBy(registry.badges)
const EXCLUDE_REASON_BY_CODE = indexBy(registry.excludeReasons)
const MIGRATION_BY_VALUE = new Map(
  registry.legacyCategoryMigrations.map((item) => [item.value, item] as const),
)

export const entityKindCodes: readonly string[] = Object.freeze(codesOf(registry.entityKinds))
export const poiPrimaryTypeCodes: readonly string[] = Object.freeze(
  codesOf(registry.poiPrimaryTypes),
)
export const poiTypeGroupCodes: readonly string[] = Object.freeze(codesOf(registry.poiTypeGroups))
export const facetCodes: readonly string[] = Object.freeze(codesOf(registry.facets))
export const badgeCodes: readonly string[] = Object.freeze(codesOf(registry.badges))
export const policyTypeStates: readonly string[] = Object.freeze([...policyTypeStateSet(registry)])
export const typeStates: readonly string[] = Object.freeze(typeStatesIn(registry))

// ── Подписи ───────────────────────────────────────────────────────────────

function labelIn(item: Coded, lang: string): string {
  const label = item.labels[lang]
  if (typeof label !== 'string') {
    throw new Error(`Нет подписи «${lang}» для кода ${item.code}: языки реестра — ${languages.join(', ')}`)
  }
  return label
}

function labelBy(
  index: ReadonlyMap<string, Coded>,
  dimension: string,
  code: string,
  lang: string,
): string {
  const item = index.get(code)
  if (!item) throw new Error(`Код ${JSON.stringify(code)} не объявлен в реестре (${dimension})`)
  return labelIn(item, lang)
}

export function entityKindLabel(code: string, lang: string = defaultLanguage): string {
  return labelBy(ENTITY_KIND_BY_CODE, 'entityKinds', code, lang)
}
export function poiTypeLabel(code: string, lang: string = defaultLanguage): string {
  return labelBy(TYPE_BY_CODE, 'poiPrimaryTypes', code, lang)
}
export function poiTypeGroupLabel(code: string, lang: string = defaultLanguage): string {
  return labelBy(GROUP_BY_CODE, 'poiTypeGroups', code, lang)
}
export function facetLabel(code: string, lang: string = defaultLanguage): string {
  return labelBy(FACET_BY_CODE, 'facets', code, lang)
}
export function badgeLabel(code: string, lang: string = defaultLanguage): string {
  return labelBy(BADGE_BY_CODE, 'badges', code, lang)
}
export function excludeReasonLabel(code: string, lang: string = defaultLanguage): string {
  return labelBy(EXCLUDE_REASON_BY_CODE, 'excludeReasons', code, lang)
}

function optionsFrom(list: readonly Coded[], lang: string): readonly LabelledOption[] {
  return Object.freeze(
    list.map((item) => Object.freeze({ code: item.code, label: labelIn(item, lang) })),
  )
}

export function entityKindOptions(lang: string = defaultLanguage): readonly LabelledOption[] {
  return optionsFrom(registry.entityKinds, lang)
}
export function facetOptions(lang: string = defaultLanguage): readonly LabelledOption[] {
  return optionsFrom(registry.facets, lang)
}
export function badgeOptions(lang: string = defaultLanguage): readonly LabelledOption[] {
  return optionsFrom(registry.badges, lang)
}
export function poiTypeGroupOptions(lang: string = defaultLanguage): readonly LabelledOption[] {
  return optionsFrom(registry.poiTypeGroups, lang)
}

/**
 * Полный перечень типов с подписями и группой — то, из чего собираются
 * выпадающий список XLSX, промпт классификатора и сверка опций Airtable.
 * Ни одному из них перечислять типы у себя больше не нужно.
 */
export function poiTypeOptions(lang: string = defaultLanguage): readonly PoiTypeOption[] {
  return Object.freeze(
    registry.poiPrimaryTypes.map((type) =>
      Object.freeze({
        code: type.code,
        label: labelIn(type, lang),
        group: type.group,
        groupLabel: poiTypeGroupLabel(type.group, lang),
        autoImportAllowed: type.autoImportAllowed,
      }),
    ),
  )
}

// ── Справки о типах ───────────────────────────────────────────────────────

export function poiType(code: string): PoiPrimaryType | null {
  return TYPE_BY_CODE.get(code) ?? null
}
export function poiTypeGroupOf(code: string): string | null {
  return TYPE_BY_CODE.get(code)?.group ?? null
}
export function autoImportAllowed(code: string): boolean {
  return TYPE_BY_CODE.get(code)?.autoImportAllowed ?? false
}
export function typeHints(code: string, lang: string = defaultLanguage): readonly string[] {
  return Object.freeze([...(TYPE_BY_CODE.get(code)?.hints?.[lang] ?? [])])
}
export function groupAmbiguousHints(code: string, lang: string = defaultLanguage): readonly string[] {
  return Object.freeze([...(GROUP_BY_CODE.get(code)?.ambiguousHints?.[lang] ?? [])])
}
export function legacyCategoryMigration(value: string): LegacyCategoryMigration | null {
  return MIGRATION_BY_VALUE.get(value) ?? null
}

// ── Маршрутизация ─────────────────────────────────────────────────────────

/** Состояние типа для сопоставления с политикой. */
export function typeStateOf(code: string | null | undefined): string {
  return typeStateIn(registry, code)
}

/**
 * Единственное подходящее правило политики для произвольного реестра.
 *
 * Порядок правил в файле значения не имеет: функция собирает ВСЕ совпадения и
 * требует ровно одного. Ноль — дыра в политике, больше одного — двусмысленность.
 * Оба случая ошибка контракта, а не повод выбрать что-нибудь: раньше выбиралось
 * первое по порядку, то есть поведение зависело от того, куда в файл дописали
 * правило.
 *
 * Реестр передаётся аргументом не ради гибкости, а ради проверяемости: тому же
 * перебору при загрузке нужна ровно эта функция, а ветку про двусмысленность
 * иначе нечем было бы вызвать — загруженный реестр до неё не доводит, его
 * останавливает assertTaxonomyInvariants.
 */
export function resolveRouteIn(reg: TaxonomyRegistry, input: RouteInput): RouteDecision {
  const entityKind = (input.entityKind ?? '').trim()
  const classificationSource = (input.classificationSource ?? '').trim()
  if (!entityKind) throw new Error('Маршрутизация: вид сущности не передан')
  if (!classificationSource) throw new Error('Маршрутизация: источник классификации не передан')
  if (!entityKindCodeSetIn(reg).has(entityKind)) {
    throw new Error(`Маршрутизация: вид сущности ${JSON.stringify(entityKind)} не объявлен в реестре`)
  }
  if (!sourceSetIn(reg).has(classificationSource)) {
    throw new Error(
      `Маршрутизация: источник ${JSON.stringify(classificationSource)} не объявлен; допустимы ${reg.routingVocabulary.classificationSources.join(', ')}`,
    )
  }

  const typeState = typeStateIn(reg, input.poiPrimaryType)
  const matched = rulesMatching(reg, entityKind, typeState, classificationSource)
  if (matched.length === 0) {
    throw new Error(
      `Маршрутизация: нет правила для ${entityKind} / ${typeState} / ${classificationSource}`,
    )
  }
  if (matched.length > 1) {
    throw new Error(
      `Маршрутизация: ${entityKind} / ${typeState} / ${classificationSource} подходит сразу под ${matched
        .map((rule) => rule.id)
        .join(', ')}`,
    )
  }

  const rule = matched[0]
  return Object.freeze({
    ruleId: rule.id,
    typeState,
    disposition: rule.disposition,
    catalogTarget: rule.catalogTarget,
    excludeReason: rule.excludeReason ?? null,
    requiresNote: rule.requiresNote === true,
    why: rule.why,
  })
}

/** То же самое для загруженного реестра — обычная точка входа потребителя. */
export function resolveRoute(input: RouteInput): RouteDecision {
  return resolveRouteIn(registry, input)
}
