/**
 * Документ `poi-geography/v1` — географический охват POI и его связи с другими
 * местами. Контракт: `docs/poi-intake/poi-geography-contract.md`.
 *
 * Хранится в поле `POI Geography` одним JSON-документом. Читается сервером при
 * сборке списка и карточки; браузер получает уже разобранные значения. Модуль
 * не тянет `node:*`, чтобы его могли импортировать и скрипты, и серверные
 * модули приложения без ветвления по среде.
 *
 * ПРЕФЕКТУРА ТОЧКИ ЗДЕСЬ НЕ ХРАНИТСЯ. Она остаётся в `Prefecture (EN/RU)`;
 * документ описывает то, чего одной точкой не выразить: гору в двух
 * префектурах, архипелаг, массив — и отношения, которые не являются
 * принадлежностью. Принадлежность («входит в состав») живёт в `Parent POI` и
 * сюда не дублируется: у каждой связи должна быть одна правда.
 *
 * НАПРАВЛЕНИЕ ВСЕГДА `outbound`. Документ говорит только о том, как ЭТА запись
 * относится к цели. Обратную сторону («точки посещения горы») выводит читатель
 * графа по всему списку и никогда не записывает: иначе две записи могли бы
 * утверждать о связи разное.
 */
import { canonicalPrefecture } from './prefectures.ts'
import { parseJapaneseAddress } from './jp-address.ts'

export const POI_GEOGRAPHY_SPEC = 'poi-geography/v1'
export const POI_GEOGRAPHY_FIELD = 'POI Geography'

export const RELATION_KINDS = Object.freeze(['viewOf', 'dedicatedTo', 'visitPointOf'] as const)
export type RelationKind = (typeof RELATION_KINDS)[number]
export const EVIDENCE_STATUSES = Object.freeze(['verified', 'reported'] as const)
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number]
export const RELATION_DIRECTION = 'outbound'
export const MAX_TERRITORIES = 47
export const MAX_RELATIONS = 50

/** Подписи отношений для карточки: со стороны источника и со стороны цели. */
export const RELATION_LABELS: Readonly<Record<RelationKind, { outbound: string; inbound: string }>> = Object.freeze({
  viewOf: Object.freeze({ outbound: 'Вид на', inbound: 'Смотровые точки' }),
  dedicatedTo: Object.freeze({ outbound: 'Посвящён', inbound: 'Посвящённые места' }),
  visitPointOf: Object.freeze({ outbound: 'Точка посещения', inbound: 'Точки посещения' }),
})

export interface GeographySource {
  url: string
  checkedOn: string
  factId: string | null
  decisionRef: string | null
}

export interface GeographyTerritory {
  prefectureEn: string
  municipalityJa: string | null
  status: EvidenceStatus
  source: GeographySource
}

export interface GeographyRelation {
  kind: RelationKind
  target: { poiId: string; recordId: string }
  direction: typeof RELATION_DIRECTION
  status: EvidenceStatus
  source: GeographySource
}

export interface PoiGeographyDocument {
  spec: typeof POI_GEOGRAPHY_SPEC
  updatedAt: string
  territories: GeographyTerritory[]
  relations: GeographyRelation[]
}

const POI_ID_SHAPE = /^POI-\d{6}$/
const RECORD_ID_SHAPE = /^rec[A-Za-z0-9]{14}$/

class GeographyDocumentError extends Error {}
function need(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new GeographyDocumentError(`${POI_GEOGRAPHY_SPEC}: ${reason}`)
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const filled = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], where: string) {
  const own = Object.keys(value).sort().join('|')
  need(own === [...allowed].sort().join('|'), `${where}: ожидаются ровно ключи ${allowed.join(', ')}, получены ${own || '(нет)'}`)
}

/** Snapshot plain JSON data without invoking accessors or toJSON. Browser-safe:
 * this module cannot import the Node digest implementation. Never retain caller
 * objects after validation; the bytes written must describe the checked values. */
function snapshotJson(value: unknown, depth = 0): unknown {
  need(depth <= 16, 'документ слишком глубоко вложен')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') { need(Number.isFinite(value), 'неконечное число'); return value }
  need(typeof value === 'object', 'ожидаются только JSON-данные')
  const array = Array.isArray(value)
  const proto = Object.getPrototypeOf(value)
  need(array ? proto === Array.prototype : proto === Object.prototype || proto === null, 'нужны простые JSON-объекты')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  need(Object.getOwnPropertySymbols(value).length === 0, 'символьные ключи запрещены')
  const keys = Object.keys(descriptors).filter((key) => !(array && key === 'length'))
  if (array) need(keys.length === value.length && keys.every((key, i) => key === String(i)), 'массив с пропусками или лишними ключами')
  const out: Record<string, unknown> = Object.create(null)
  for (const key of keys) {
    const d = descriptors[key]!
    need(Object.hasOwn(d, 'value') && d.enumerable, 'accessor или скрытое свойство запрещено')
    out[key] = snapshotJson(d.value, depth + 1)
  }
  return array ? keys.map((key) => out[key]) : out
}

/**
 * Календарная дата строгой формы `YYYY-MM-DD`, существующая в календаре.
 * Повторяет `isStrictCalendarDate` из `scripts/lib/canonical-contract.mjs`:
 * тот модуль тянет `node:crypto`, а этот обязан работать без `node:*`.
 * Равносильность двух функций закреплена дифференциальным тестом
 * (`tests/poi-geography.mjs`), чтобы редакции не разошлись молча.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function httpsUrl(value: unknown): value is string {
  if (!filled(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function assertSource(value: unknown, where: string): GeographySource {
  need(isObject(value), `${where}: источник обязан быть объектом`)
  exactKeys(value, ['url', 'checkedOn', 'factId', 'decisionRef'], where)
  need(httpsUrl(value.url), `${where}.url: нужен https-адрес источника`)
  need(isCalendarDate(value.checkedOn), `${where}.checkedOn: нужна календарная дата проверки`)
  for (const key of ['factId', 'decisionRef'] as const) {
    need(value[key] === null || filled(value[key]), `${where}.${key}: строка или null`)
  }
  need(value.factId !== null || value.decisionRef !== null, `${where}: назовите факт досье или решение владельца`)
  return value as unknown as GeographySource
}

/**
 * Территория тождественна парой «префектура + муниципалитет». Муниципалитет
 * без префектуры не принимается: 中央区 есть в шести городах, и одно имя
 * ничего не идентифицирует. Разбор — тем же `parseJapaneseAddress`, что и у
 * адресов Intake: второй грамматики муниципалитета здесь нет.
 */
function assertTerritory(value: unknown, where: string): GeographyTerritory {
  need(isObject(value), `${where}: территория обязана быть объектом`)
  exactKeys(value, ['prefectureEn', 'municipalityJa', 'status', 'source'], where)
  const prefecture = filled(value.prefectureEn) ? canonicalPrefecture(value.prefectureEn) : null
  need(prefecture !== null && prefecture.en === value.prefectureEn, `${where}.prefectureEn: ${JSON.stringify(value.prefectureEn)} не каноническое английское имя префектуры`)
  if (value.municipalityJa !== null) {
    need(filled(value.municipalityJa), `${where}.municipalityJa: строка или null`)
    const parts = parseJapaneseAddress(`${prefecture.ja}${value.municipalityJa}`)
    const parsed = parts.municipality || (prefecture.ja === '東京都' ? parts.specialWard : '')
    need(parsed === value.municipalityJa, `${where}.municipalityJa: «${value.municipalityJa}» не разбирается как муниципалитет префектуры ${prefecture.ja}`)
  }
  need((EVIDENCE_STATUSES as readonly unknown[]).includes(value.status), `${where}.status: вне закрытого списка ${EVIDENCE_STATUSES.join(', ')}`)
  assertSource(value.source, `${where}.source`)
  return value as unknown as GeographyTerritory
}

function assertRelation(value: unknown, where: string, ownPoiId: string | null): GeographyRelation {
  need(isObject(value), `${where}: связь обязана быть объектом`)
  exactKeys(value, ['kind', 'target', 'direction', 'status', 'source'], where)
  need((RELATION_KINDS as readonly unknown[]).includes(value.kind), `${where}.kind: вне закрытого списка ${RELATION_KINDS.join(', ')}`)
  need(value.direction === RELATION_DIRECTION, `${where}.direction: хранится только ${RELATION_DIRECTION}; обратная сторона выводится читателем`)
  need(isObject(value.target), `${where}.target: ожидается объект`)
  exactKeys(value.target, ['poiId', 'recordId'], `${where}.target`)
  need(typeof value.target.poiId === 'string' && POI_ID_SHAPE.test(value.target.poiId), `${where}.target.poiId: нужен POI-000000`)
  need(typeof value.target.recordId === 'string' && RECORD_ID_SHAPE.test(value.target.recordId), `${where}.target.recordId: нужен record id Airtable`)
  need(ownPoiId === null || value.target.poiId !== ownPoiId, `${where}: ссылка на себя запрещена`)
  need((EVIDENCE_STATUSES as readonly unknown[]).includes(value.status), `${where}.status: вне закрытого списка ${EVIDENCE_STATUSES.join(', ')}`)
  assertSource(value.source, `${where}.source`)
  return value as unknown as GeographyRelation
}

/**
 * Проверка документа. `ownPoiId` — идентификатор записи, в которой документ
 * лежит: без него ссылка на себя не распознаётся, поэтому writer обязан его
 * передавать; читатель списка передаёт `POI ID` записи.
 */
export function assertPoiGeographyDocument(value: unknown, ownPoiId: string | null = null): PoiGeographyDocument {
  value = snapshotJson(value)
  need(isObject(value), 'ожидается документ-объект')
  exactKeys(value, ['spec', 'updatedAt', 'territories', 'relations'], 'документ')
  need(value.spec === POI_GEOGRAPHY_SPEC, `spec: ожидается ${POI_GEOGRAPHY_SPEC}, получено ${JSON.stringify(value.spec)}`)
  need(isCalendarDate(value.updatedAt), 'updatedAt: нужна календарная дата')
  need(Array.isArray(value.territories) && value.territories.length <= MAX_TERRITORIES, `territories: массив не длиннее ${MAX_TERRITORIES}`)
  need(Array.isArray(value.relations) && value.relations.length <= MAX_RELATIONS, `relations: массив не длиннее ${MAX_RELATIONS}`)
  const territoryKeys = new Set<string>()
  const territories = value.territories.map((item, i) => {
    const territory = assertTerritory(item, `territories[${i}]`)
    const key = `${territory.prefectureEn}|${territory.municipalityJa ?? ''}`
    need(!territoryKeys.has(key), `territories[${i}]: территория повторяется`)
    territoryKeys.add(key)
    return territory
  })
  const relationKeys = new Set<string>()
  const relations = value.relations.map((item, i) => {
    const relation = assertRelation(item, `relations[${i}]`, ownPoiId)
    const key = `${relation.kind}|${relation.target.poiId}`
    need(!relationKeys.has(key), `relations[${i}]: связь ${relation.kind} → ${relation.target.poiId} повторяется`)
    relationKeys.add(key)
    return relation
  })
  return { spec: POI_GEOGRAPHY_SPEC, updatedAt: value.updatedAt, territories, relations }
}

export interface PoiGeographyDocumentRead {
  document: PoiGeographyDocument | null
  /** Текст ошибки разбора; отсутствие поля ошибкой не является. */
  error: string | null
}

/**
 * Чтение поля записи. Пустое поле — документа нет, и это не ошибка: старые
 * карточки живут без охвата. Повреждённый документ возвращается ошибкой с
 * текстом, а не пустотой: пустота скрыла бы дефект данных.
 */
export function readPoiGeographyDocument(fields: Record<string, unknown>, ownPoiId: string | null = null): PoiGeographyDocumentRead {
  const raw = fields[POI_GEOGRAPHY_FIELD]
  if (raw === undefined || raw === null || raw === '') return { document: null, error: null }
  if (typeof raw !== 'string') return { document: null, error: `${POI_GEOGRAPHY_FIELD}: ожидается текст, получено ${typeof raw}` }
  if (!raw.trim()) return { document: null, error: null }
  try {
    return { document: assertPoiGeographyDocument(JSON.parse(raw), ownPoiId), error: null }
  } catch (error) {
    return { document: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Значение поля для writer'а: проверенный документ, детерминированная запись. */
export function serializePoiGeographyDocument(document: PoiGeographyDocument, ownPoiId: string | null = null): string {
  const checked = assertPoiGeographyDocument(document, ownPoiId)
  return JSON.stringify(checked)
}

/** Подтверждённые префектуры охвата — то, по чему ищут фильтры. */
export function confirmedScopePrefectures(document: PoiGeographyDocument | null): string[] {
  if (!document) return []
  return [...new Set(document.territories.filter((t) => t.status === 'verified').map((t) => t.prefectureEn))]
}

/**
 * Живая схема: поле `POI Geography` обязано существовать и быть текстовым,
 * прежде чем writer положит в него документ. Проверяется тем же чтением Meta
 * API, что и поля таксономии (`readSchemaTables`), по канонической таблице.
 * Отсутствие поля — отказ до записи, а не «Airtable сам откажет»: отказ
 * должен называть причину словами, а не кодом UNKNOWN_FIELD_NAME на полпути.
 */
export const POI_GEOGRAPHY_FIELD_TYPE = 'multilineText'

export function verifyGeographySchemaTable(table: { fields?: readonly { name?: string; type?: string }[] } | null | undefined): { checked: true; field: string } {
  const field = (table?.fields ?? []).find((f) => f?.name === POI_GEOGRAPHY_FIELD)
  if (!field) {
    throw new Error(`Схема таблицы POI не содержит поля «${POI_GEOGRAPHY_FIELD}». Запись документа охвата остановлена до первого обращения к базе; поле добавляется только по карточке миграции.`)
  }
  if (field.type !== POI_GEOGRAPHY_FIELD_TYPE) {
    throw new Error(`Поле «${POI_GEOGRAPHY_FIELD}» имеет тип ${JSON.stringify(field.type)}, ожидается ${POI_GEOGRAPHY_FIELD_TYPE}. Запись остановлена.`)
  }
  return { checked: true, field: POI_GEOGRAPHY_FIELD }
}

/** Add/update named entries only. An omitted territory or edge is not a deletion.
 * Repeated proposals retain the stored date; callers can compare exact bytes. */
export function mergePoiGeographyDocument(current: PoiGeographyDocument | null, proposal: PoiGeographyDocument, ownPoiId: string | null = null): PoiGeographyDocument {
  const next = assertPoiGeographyDocument(proposal, ownPoiId)
  const old = current ? assertPoiGeographyDocument(current, ownPoiId) : null
  const territoryKey = (t: GeographyTerritory) => `${t.prefectureEn}|${t.municipalityJa ?? ''}`
  const relationKey = (r: GeographyRelation) => `${r.kind}|${r.target.poiId}`
  function merge<T>(before: T[], after: T[], key: (entry: T) => string): T[] {
    const entries = new Map(before.map((entry) => [key(entry), entry]))
    for (const entry of after) entries.set(key(entry), entry)
    return [...entries.values()].sort((a, b) => key(a).localeCompare(key(b), 'en'))
  }
  const merged = assertPoiGeographyDocument({ ...next,
    territories: merge(old?.territories ?? [], next.territories, territoryKey),
    relations: merge(old?.relations ?? [], next.relations, relationKey),
  }, ownPoiId)
  if (old) {
    const canonical = { ...old,
      territories: merge([], old.territories, territoryKey), relations: merge([], old.relations, relationKey),
      updatedAt: next.updatedAt,
    }
    if (JSON.stringify(canonical) === JSON.stringify(merged)) return old
  }
  return merged
}
