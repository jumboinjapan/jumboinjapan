/**
 * Единственная исполняемая связь «реестр таксономии ↔ схема Airtable ↔ writer».
 *
 * Зачем. До 10f-P выход классификации v2 (тип, фасеты, источник, версия)
 * до таблицы POI не доезжал: писатель знал только старое поле
 * `POI Category (RU)`, а мост в него переводил 9 кодов из 20 и останавливал
 * запись на остальных. Реестр жил в config, схема — в Airtable, и связывал
 * их только человек. Здесь эта связь записана один раз и исполняется:
 *
 *   • имена полей объявлены ЗДЕСЬ и нигде больше;
 *   • ожидаемая схема ВЫВОДИТСЯ из loader'а реестра, а не переписывается
 *     списком: новый код в реестре — новая ожидаемая опция, без правки здесь;
 *   • `taxonomyRecordFields` собирает значения записи и отвергает чужой код,
 *     чужой источник и чужую версию — устаревший отчёт с кодами прошлой
 *     версии до записи не доходит;
 *   • `diffTaxonomySchema` сверяет живую схему с ожидаемой; читают её
 *     `check:poi` (дрейф — поломка) и `writeRun` (preflight до первой записи).
 *
 * В поля пишутся КОДЫ, а не подписи. Подпись — функция от кода и языка и
 * живёт в реестре; записанная в базу она устарела бы при первом же
 * переименовании. Опции select-полей поэтому тоже коды: Airtable сам
 * отвергнет значение вне списка — второй, независимый от нас отказ.
 *
 * Что НЕ пишется. `entityKind` — производное: в таблицу POI попадает только
 * `tourist_poi` по построению маршрута, и второе место для того же факта —
 * второе место расхождения. Бейджи назначает редактор, а не приём.
 * Диспозиция и каталог — маршрут, а не свойство объекта.
 */

import {
  classificationSources,
  facetCodes,
  poiPrimaryTypeCodes,
  taxonomyVersion,
} from './poi-taxonomy.ts'
import { POI_TABLE_ID } from './airtable-schema.ts'

/** Имя канонической таблицы — только для сверки; адресация всегда по ID. */
export const POI_TABLE_NAME = 'POI'

/** Имена полей таблицы POI. Один раз здесь. */
export const TAXONOMY_FIELDS = Object.freeze({
  type: 'POI Type',
  facets: 'POI Facets',
  source: 'Type Source',
  version: 'Taxonomy Version',
})

export type TaxonomyFieldKey = keyof typeof TAXONOMY_FIELDS

/** Описание одного поля так, как его отдаёт Meta API Airtable. */
export interface TaxonomyFieldSchema {
  name: string
  type: 'singleSelect' | 'multipleSelects' | 'singleLineText'
  /** Опции select-полей — коды реестра в порядке реестра. */
  choices: readonly string[] | null
}

/**
 * Ожидаемая схема четырёх полей. Вычисляется при каждом вызове из
 * loader'а: кэшировать нечего, а «замороженный» список стал бы вторым.
 */
export function expectedTaxonomyFieldSchema(): readonly TaxonomyFieldSchema[] {
  return Object.freeze([
    { name: TAXONOMY_FIELDS.type, type: 'singleSelect', choices: [...poiPrimaryTypeCodes] },
    { name: TAXONOMY_FIELDS.facets, type: 'multipleSelects', choices: [...facetCodes] },
    { name: TAXONOMY_FIELDS.source, type: 'singleSelect', choices: [...classificationSources] },
    { name: TAXONOMY_FIELDS.version, type: 'singleLineText', choices: null },
  ])
}

export interface TaxonomyRecordInput {
  poiPrimaryType: string
  facets?: readonly string[] | null
  classificationSource: string
  taxonomyVersion: string
}

export type TaxonomyRecordVerdict =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; issues: string[] }

/**
 * Значения четырёх полей для записи. Fail-closed по каждому измерению:
 * чужой код, повтор фасета, чужой источник, чужая версия — отказ с именем.
 * Версия сверяется с loader'ом, а не берётся на веру из входа: отчёт,
 * собранный под прошлой версией реестра, несёт коды прошлой версии, и
 * подписывать их текущей версией значило бы врать о происхождении.
 */
export function taxonomyRecordFields(input: TaxonomyRecordInput): TaxonomyRecordVerdict {
  const issues: string[] = []
  if (!input || typeof input !== 'object') return { ok: false, issues: ['таксономия: ожидается объект'] }
  if (!poiPrimaryTypeCodes.includes(input.poiPrimaryType)) {
    issues.push(`таксономия: тип «${String(input.poiPrimaryType)}» не из реестра ${taxonomyVersion}`)
  }
  const facets = input.facets ?? []
  if (!Array.isArray(facets)) {
    issues.push('таксономия: facets должен быть массивом кодов')
  } else {
    for (const facet of facets) {
      if (!facetCodes.includes(facet)) issues.push(`таксономия: фасет «${String(facet)}» не из реестра ${taxonomyVersion}`)
    }
    if (new Set(facets).size !== facets.length) issues.push('таксономия: фасеты повторяются')
  }
  if (!classificationSources.includes(input.classificationSource)) {
    issues.push(`таксономия: источник «${String(input.classificationSource)}» не из ${classificationSources.join('/')}`)
  }
  if (input.taxonomyVersion !== taxonomyVersion) {
    issues.push(`таксономия: версия «${String(input.taxonomyVersion)}» не совпадает с реестром ${taxonomyVersion}; отчёт устарел`)
  }
  if (issues.length) return { ok: false, issues }
  return {
    ok: true,
    fields: {
      [TAXONOMY_FIELDS.type]: input.poiPrimaryType,
      // Пустой список фасетов — пустое поле, а не [] : Airtable трактует
      // пустой массив как «очистить», а нам нечего очищать у новой записи.
      [TAXONOMY_FIELDS.facets]: facets.length ? [...facets] : undefined,
      [TAXONOMY_FIELDS.source]: input.classificationSource,
      [TAXONOMY_FIELDS.version]: taxonomyVersion,
    },
  }
}

/** Поле живой схемы в форме Meta API (`GET /v0/meta/bases/{baseId}/tables`). */
export interface LiveField {
  name: string
  type: string
  options?: { choices?: Array<{ name: string }> } | null
}

export interface TaxonomySchemaDiff {
  ok: boolean
  /** Полей нет вовсе — миграция схемы (L3) ещё не выполнена. */
  missing: string[]
  /** Поле есть, но тип или опции расходятся с реестром. */
  mismatched: Array<{ field: string; reason: string }>
  /** Ожидаемая схема, по которой шла сверка, — для карточки и отчёта. */
  expected: readonly TaxonomyFieldSchema[]
}

/**
 * Сверка живой схемы с ожидаемой. Опции сравниваются как МНОЖЕСТВА кодов:
 * порядок в Airtable — дело интерфейса. Лишняя опция — тоже расхождение:
 * значение, которого реестр не знает, база принять не должна.
 */
export function diffTaxonomySchema(liveFields: readonly LiveField[]): TaxonomySchemaDiff {
  const expected = expectedTaxonomyFieldSchema()
  const byName = new Map(liveFields.map((f) => [f.name, f] as const))
  const missing: string[] = []
  const mismatched: Array<{ field: string; reason: string }> = []
  for (const want of expected) {
    const live = byName.get(want.name)
    if (!live) { missing.push(want.name); continue }
    if (live.type !== want.type) {
      mismatched.push({ field: want.name, reason: `тип ${live.type}, ожидается ${want.type}` })
      continue
    }
    if (want.choices === null) continue
    const liveChoices = new Set((live.options?.choices ?? []).map((c) => c.name))
    const wanted = new Set(want.choices)
    const absent = want.choices.filter((c) => !liveChoices.has(c))
    const extra = [...liveChoices].filter((c) => !wanted.has(c))
    if (absent.length || extra.length) {
      mismatched.push({
        field: want.name,
        reason: [
          absent.length ? `нет опций: ${absent.join(', ')}` : '',
          extra.length ? `лишние опции: ${extra.join(', ')}` : '',
        ].filter(Boolean).join('; '),
      })
    }
  }
  return { ok: missing.length === 0 && mismatched.length === 0, missing, mismatched, expected }
}

/** Одна строка для сообщений об отказе. */
export function describeTaxonomySchemaDiff(diff: TaxonomySchemaDiff): string {
  if (diff.ok) return 'схема таксономии совпадает с реестром'
  return [
    diff.missing.length ? `нет полей: ${diff.missing.join(', ')}` : '',
    ...diff.mismatched.map((m) => `${m.field}: ${m.reason}`),
  ].filter(Boolean).join('; ')
}

/** Таблица из ответа Meta API в сыром виде. */
export interface LiveTable {
  id?: string
  name?: string
  fields?: LiveField[]
}

export type PoiTableLookup =
  | { ok: true; table: LiveTable; reason: null }
  | { ok: false; table: null; reason: string }

/**
 * Таблица POI из ответа Meta API — по каноническому ID, с проверкой имени.
 * Имя изменяемо, поэтому самозванец под именем «POI» с чужим ID — отказ, а
 * чужое имя у таблицы с каноническим ID — остановка как дрейф базы.
 */
export function findPoiTable(tables: unknown): PoiTableLookup {
  const list: LiveTable[] = Array.isArray(tables) ? (tables as LiveTable[]) : []
  const table = list.find((t) => t?.id === POI_TABLE_ID)
  if (!table) {
    const impostor = list.find((t) => t?.name === POI_TABLE_NAME)
    return {
      ok: false,
      table: null,
      reason: `таблицы с каноническим ID ${POI_TABLE_ID} нет`
        + (impostor ? `; таблица с именем «${POI_TABLE_NAME}» имеет чужой ID ${impostor.id} — целевой она не является` : ''),
    }
  }
  if (table.name !== POI_TABLE_NAME) {
    return { ok: false, table: null, reason: `таблица ${POI_TABLE_ID} называется «${table.name}», ожидается «${POI_TABLE_NAME}»` }
  }
  return { ok: true, table, reason: null }
}

export interface VerifiedTaxonomySchema {
  checked: true
  tableId: string
  fields: string[]
}

/**
 * Единственная проверка живой схемы для записи: сырые таблицы Meta API →
 * таблица по каноническому ID и имени → четыре поля против реестра. Бросает
 * при любом расхождении. Её зовёт writer (не хранилище): хранилище отдаёт
 * данные, решает — связь реестр↔схема.
 */
export function verifyTaxonomySchemaTables(tables: unknown): VerifiedTaxonomySchema {
  const found = findPoiTable(tables)
  if (!found.ok) throw new Error(`Airtable schema read: ${found.reason}. Запись остановлена.`)
  const diff = diffTaxonomySchema(found.table.fields ?? [])
  if (!diff.ok) {
    throw new Error(
      `Схема таблицы POI не соответствует реестру таксономии: ${describeTaxonomySchemaDiff(diff)}. `
      + 'Запись остановлена до первого обращения к базе; поля добавляются только по замороженной карточке.',
    )
  }
  return { checked: true, tableId: POI_TABLE_ID, fields: diff.expected.map((f) => f.name) }
}
