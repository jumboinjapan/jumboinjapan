/**
 * Реестр таксономии POI: чтение, проверка инвариантов и производные списки.
 *
 * Потребитель № 1 из ADR-0001 §13. Модуль намеренно ничего не подключает:
 * ни приём, ни Airtable, ни XLSX, ни классификатор. Он читает
 * config/poi-taxonomy.v1.json, проверяет его при загрузке и отдаёт
 * замороженные производные — больше ничего.
 *
 * Правило, ради которого модуль написан: ни один перечень кодов, подписей,
 * фасетов, бейджей и правил маршрутизации не хранится тут строками. Всё
 * строится из JSON. Единственное исключение — три служебных слова
 * сопоставления (CONTROL_VOCABULARY ниже); tests/poi-taxonomy-loader.mjs
 * проверяет, что этот список не растёт.
 *
 * AJV здесь не импортируется намеренно: он объявлен в devDependencies, в
 * production-рантайме его нет. Проверка по JSON Schema живёт в тестах,
 * структурные инварианты — здесь, обычным кодом без зависимостей.
 *
 * Атрибут `with { type: 'json' }` обязателен: без него сборка Next проходит,
 * а запуск из node падает с ERR_IMPORT_ATTRIBUTE_MISSING. С ним читают оба.
 */
import rawRegistry from '../../config/poi-taxonomy.v1.json' with { type: 'json' }

/* ── Служебный словарь сопоставления ───────────────────────────────────────
   Три слова, которые реестр использует как управляющие значения, но нигде не
   объявляет списком. Вывести их из данных нельзя: по самому JSON не видно,
   какое из двух обобщённых состояний означает «тип есть в реестре», а какое —
   «типа нет». Поэтому они живут здесь, объявлены явно и покрыты тестом,
   который падает, если словарь пополнится. */
const WILDCARD = 'any'
const STATE_KNOWN = 'known'
const STATE_UNKNOWN = 'unknown'

export const CONTROL_VOCABULARY: readonly string[] = Object.freeze([
  WILDCARD,
  STATE_KNOWN,
  STATE_UNKNOWN,
])

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

// ── Проверка инвариантов ──────────────────────────────────────────────────

const VERSION_SHAPE = /^[a-z0-9-]+\/v[0-9]+$/

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

/**
 * Возвращает список претензий к кандидату. Функция чистая и принимает что
 * угодно: тесты кормят ею испорченные копии реестра, а assertTaxonomyInvariants
 * — настоящий. Ни одна проверка не дублирует JSON Schema: схема ловит форму,
 * здесь — ссылочная целостность и достижимость правил.
 */
export function taxonomyProblems(candidate: unknown): string[] {
  const problems: string[] = []
  if (!isRecord(candidate)) return ['реестр не объект']

  const listFields = [
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
  if (problems.length) return problems

  const reg = candidate as unknown as TaxonomyRegistry
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
  }
  for (const dupe of duplicates(reg.routingPolicy.map((rule) => rule.id))) {
    problems.push(`routingPolicy: идентификатор ${dupe} встречается дважды`)
  }

  // Языки: набор ключей подписей обязан совпадать во всём реестре, иначе
  // список для одного языка окажется короче списка для другого.
  const langs = Object.keys(reg.entityKinds[0]?.labels ?? {}).sort()
  if (!langs.length) problems.push('подписи без языков')
  for (const [name, list] of codedGroups) {
    for (const item of list) {
      const own = Object.keys(item.labels ?? {}).sort()
      if (own.join('|') !== langs.join('|')) {
        problems.push(`${name}/${item.code}: языки подписей ${own.join(',')} ≠ ${langs.join(',')}`)
      }
      for (const lang of own) {
        if (typeof item.labels[lang] !== 'string' || !item.labels[lang].trim()) {
          problems.push(`${name}/${item.code}: пустая подпись ${lang}`)
        }
      }
    }
  }

  const entityKindCodes = new Set(codesOf(reg.entityKinds))
  const typeCodes = new Set(codesOf(reg.poiPrimaryTypes))
  const groupCodes = new Set(codesOf(reg.poiTypeGroups))
  const excludeReasonCodes = new Set(codesOf(reg.excludeReasons))
  const dispositions = new Set(reg.dispositions)
  const catalogTargets = new Set(reg.catalogTargets)

  for (const type of reg.poiPrimaryTypes) {
    if (!groupCodes.has(type.group)) {
      problems.push(`poiPrimaryTypes/${type.code}: группа ${type.group} не объявлена`)
    }
    if (typeof type.autoImportAllowed !== 'boolean') {
      problems.push(`poiPrimaryTypes/${type.code}: autoImportAllowed не булево`)
    }
  }
  for (const group of reg.poiTypeGroups) {
    if (!reg.poiPrimaryTypes.some((type) => type.group === group.code)) {
      problems.push(`poiTypeGroups/${group.code}: группа без типов`)
    }
  }

  const coveredKinds = new Set<string>()
  for (const rule of reg.routingPolicy) {
    if (!entityKindCodes.has(rule.entityKind)) {
      problems.push(`routingPolicy/${rule.id}: вид сущности ${rule.entityKind} не объявлен`)
    } else {
      coveredKinds.add(rule.entityKind)
    }
    if (!dispositions.has(rule.disposition)) {
      problems.push(`routingPolicy/${rule.id}: исход ${rule.disposition} не объявлен`)
    }
    if (rule.catalogTarget !== null && !catalogTargets.has(rule.catalogTarget)) {
      problems.push(`routingPolicy/${rule.id}: адрес каталога ${rule.catalogTarget} не объявлен`)
    }
    if (rule.excludeReason !== undefined && !excludeReasonCodes.has(rule.excludeReason)) {
      problems.push(`routingPolicy/${rule.id}: причина исключения ${rule.excludeReason} не объявлена`)
    }
    const state = rule.typeState
    const generic = state === WILDCARD || state === STATE_KNOWN || state === STATE_UNKNOWN
    if (!generic && !typeCodes.has(state)) {
      problems.push(`routingPolicy/${rule.id}: состояние типа ${state} — ни служебное слово, ни код типа`)
    }
    if (!rule.why || typeof rule.why !== 'string') {
      problems.push(`routingPolicy/${rule.id}: правило без объяснения`)
    }
  }
  for (const kind of entityKindCodes) {
    if (!coveredKinds.has(kind)) problems.push(`entityKinds/${kind}: ни одного правила маршрутизации`)
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

/** Замороженный реестр целиком — на случай, когда потребителю нужен он сам
 *  (например, чтобы посчитать хеш и записать его в артефакт). Правку бросает. */
export const taxonomy: TaxonomyRegistry = registry

export const taxonomyVersion: string = registry.version
export const taxonomyNote: string = registry.note

export const languages: readonly string[] = Object.freeze(
  Object.keys(registry.entityKinds[0].labels),
)
export const defaultLanguage: string = languages[0]

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

/**
 * Коды типов, которые сама политика упоминает как отдельное состояние.
 * Выводятся из данных, а не перечисляются: если реестр заведёт второй такой
 * тип, он подхватится сам. Ради этого множества и существует typeStateOf —
 * без него резервный тип считался бы обычным «известным», и правило,
 * запрещающее его автоимпорт, стало бы недостижимым.
 */
const POLICY_TYPE_STATES: ReadonlySet<string> = new Set(
  registry.routingPolicy.map((rule) => rule.typeState).filter((state) => TYPE_BY_CODE.has(state)),
)

export const policyTypeStates: readonly string[] = Object.freeze([...POLICY_TYPE_STATES])

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

/**
 * Состояние типа для сопоставления с политикой. Резервный тип возвращает сам
 * себя, а не обобщённое «известен»: иначе первое же правило по обобщённому
 * состоянию перехватило бы его и увело в каталог, хотя политика для него
 * говорит обратное.
 */
export function typeStateOf(code: string | null | undefined): string {
  if (typeof code !== 'string' || !code) return STATE_UNKNOWN
  if (POLICY_TYPE_STATES.has(code)) return code
  if (TYPE_BY_CODE.has(code)) return STATE_KNOWN
  return STATE_UNKNOWN
}

function matches(ruleValue: string, actual: string): boolean {
  return ruleValue === WILDCARD || ruleValue === actual
}

/**
 * Первое подходящее правило политики. Порядок правил в реестре значим:
 * частные случаи стоят выше общих. Если не подошло ни одно — это дыра в
 * политике, и молча выбирать исход нельзя.
 */
export function resolveRoute(input: RouteInput): RouteDecision {
  const entityKind = (input.entityKind ?? '').trim()
  const classificationSource = (input.classificationSource ?? '').trim()
  if (!entityKind) throw new Error('Маршрутизация: вид сущности не передан')
  if (!classificationSource) throw new Error('Маршрутизация: источник классификации не передан')

  const typeState = typeStateOf(input.poiPrimaryType)
  const rule = registry.routingPolicy.find(
    (candidate) =>
      candidate.entityKind === entityKind &&
      matches(candidate.typeState, typeState) &&
      matches(candidate.classificationSource, classificationSource),
  )
  if (!rule) {
    throw new Error(
      `Маршрутизация: нет правила для ${entityKind} / ${typeState} / ${classificationSource}`,
    )
  }
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
