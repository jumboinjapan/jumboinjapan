#!/usr/bin/env node
/**
 * Связь «реестр таксономии ↔ схема Airtable ↔ writer» (10f-P, P04.3).
 *
 *   node tests/poi-taxonomy-airtable.mjs
 *
 * Что доказывается.
 *   • Ожидаемая схема четырёх полей ВЫВОДИТСЯ из loader'а: списки опций —
 *     это коды реестра, а не второй список рядом с ним.
 *   • `taxonomyRecordFields` fail-closed: чужой код, повтор фасета, чужой
 *     источник, чужая версия — отказ с именем; версия пишется из loader'а.
 *   • `diffTaxonomySchema` различает «полей нет» (миграция L3 не сделана) и
 *     «поле есть, но не то» (дрейф), сравнивает опции как множества и
 *     считает лишнюю опцию расхождением.
 *   • `ingestPoi` кладёт значения в поля записи и останавливает запись с
 *     негодной таксономией тем же исходом, что и негодный канон.
 *   • Airtable-store читает живую схему Meta API и отказывает до записи.
 */

import {
  TAXONOMY_FIELDS,
  expectedTaxonomyFieldSchema,
  taxonomyRecordFields,
  diffTaxonomySchema,
  describeTaxonomySchemaDiff,
} from '../src/lib/poi-taxonomy-airtable.ts'
import {
  classificationSources,
  facetCodes,
  poiPrimaryTypeCodes,
  taxonomyVersion,
} from '../src/lib/poi-taxonomy.ts'
import { ingestPoi, ingestPoiBatch } from '../src/lib/poi-ingest.ts'
import { createAirtablePoiStore, AIRTABLE_META_TABLES_PATH } from '../scripts/poi-portals/lib/airtable-store.mjs'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'
import { createMemoryPoiStore, isMemoryPoiStore } from '../src/lib/poi-memory-store.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${text}» нет «${needle}»`)
}
const boom = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e.message } }
const eq = (label, a, b) => t(label, JSON.stringify(a), JSON.stringify(b))

/* ── 1. Ожидаемая схема — из loader'а ─────────────────────────────────── */
{
  const schema = expectedTaxonomyFieldSchema()
  t('четыре поля', schema.length, 4)
  eq('имена полей — из TAXONOMY_FIELDS', schema.map((f) => f.name),
    [TAXONOMY_FIELDS.type, TAXONOMY_FIELDS.facets, TAXONOMY_FIELDS.source, TAXONOMY_FIELDS.version])
  eq('имена полей закреплены', Object.values(TAXONOMY_FIELDS), ['POI Type', 'POI Facets', 'Type Source', 'Taxonomy Version'])
  t('тип — singleSelect', schema[0].type, 'singleSelect')
  t('фасеты — multipleSelects', schema[1].type, 'multipleSelects')
  t('источник — singleSelect', schema[2].type, 'singleSelect')
  t('версия — singleLineText без опций', schema[3].type === 'singleLineText' && schema[3].choices === null, true)
  eq('опции типа = коды реестра', schema[0].choices, [...poiPrimaryTypeCodes])
  eq('опции фасетов = коды реестра', schema[1].choices, [...facetCodes])
  eq('опции источника = источники реестра', schema[2].choices, [...classificationSources])
  t('кодов типа больше, чем умеет старый мост (9)', poiPrimaryTypeCodes.length > 9, true)
  t('схема заморожена', Object.isFrozen(schema), true)
  t('опции — коды, а не подписи (нет кириллицы и пробелов)',
    schema.flatMap((f) => f.choices ?? []).every((c) => /^[a-z0-9_]+$/.test(c)), true)
}

/* ── 2. Значения записи — fail-closed по каждому измерению ────────────── */
{
  const good = { poiPrimaryType: 'shinto_shrine', facets: [], classificationSource: 'rule', taxonomyVersion }
  const v = taxonomyRecordFields(good)
  t('годный вход принят', v.ok, true)
  eq('поля записи — коды', v.fields, {
    'POI Type': 'shinto_shrine', 'POI Facets': undefined, 'Type Source': 'rule', 'Taxonomy Version': taxonomyVersion,
  })
  t('пустые фасеты — поле не пишется', 'POI Facets' in v.fields && v.fields['POI Facets'] === undefined, true)
  const facetsIn = ['onsen', 'hot_spring']
  const withFacets = taxonomyRecordFields({ ...good, poiPrimaryType: 'public_onsen', facets: facetsIn })
  t('фасеты записываются списком кодов', withFacets.ok && withFacets.fields['POI Facets'].join(','), 'onsen,hot_spring')
  /* 10f-P R1, находка 6: прежнее утверждение сравнивало массив с объектом
     полей и было пустым. Здесь — со ВХОДНЫМ массивом, и различающий
     контрпример: правка входа после сборки не должна менять поля записи. */
  t('фасеты не разделяют массив со входом', withFacets.fields['POI Facets'] !== facetsIn, true)
  facetsIn.push('spa')
  t('правка входного массива после сборки не меняет поля записи', withFacets.fields['POI Facets'].join(','), 'onsen,hot_spring')
  const facetsAbsent = taxonomyRecordFields({ ...good, facets: undefined })
  t('facets можно не передавать', facetsAbsent.ok, true)
  const say = (over, needle, label) => {
    const r = taxonomyRecordFields({ ...good, ...over })
    t(`${label}: отказ`, r.ok, false)
    has(`${label}: причина названа`, (r.issues ?? []).join(' | '), needle)
  }
  say({ poiPrimaryType: 'castle_x' }, 'тип «castle_x» не из реестра', 'чужой тип')
  say({ poiPrimaryType: 'Синтоистское святилище' }, 'не из реестра', 'подпись вместо кода')
  say({ facets: ['onsen', 'onsen'] }, 'фасеты повторяются', 'повтор фасета')
  say({ facets: ['night'] }, 'фасет «night» не из реестра', 'чужой фасет')
  say({ facets: 'onsen' }, 'facets должен быть массивом', 'фасеты строкой')
  say({ classificationSource: 'bot' }, 'источник «bot» не из rule/model/human', 'чужой источник')
  say({ taxonomyVersion: 'poi-taxonomy/v1' }, 'не совпадает с реестром', 'устаревшая версия')
  say({ taxonomyVersion: undefined }, 'не совпадает с реестром', 'версия не передана')
  const many = taxonomyRecordFields({ poiPrimaryType: 'x', facets: ['y'], classificationSource: 'z', taxonomyVersion: 'w' })
  t('все нарушения перечислены, а не первое', many.issues.length, 4)
  t('не объект — отказ', taxonomyRecordFields(null).ok, false)
  for (const code of poiPrimaryTypeCodes) {
    const r = taxonomyRecordFields({ ...good, poiPrimaryType: code })
    if (!(r.ok && r.fields['POI Type'] === code)) bad.push(`код ${code} не представим`)
    else ok++
  }
}

/* ── 3. Сверка живой схемы ────────────────────────────────────────────── */
const liveOf = (over = {}) => {
  const fields = expectedTaxonomyFieldSchema().map((f) => ({
    name: f.name,
    type: f.type,
    options: f.choices ? { choices: f.choices.map((name) => ({ name })) } : undefined,
  }))
  return fields.map((f) => (over[f.name] ? { ...f, ...over[f.name] } : f))
}
{
  const none = diffTaxonomySchema([{ name: 'POI ID', type: 'singleLineText' }])
  t('полей нет — не ok', none.ok, false)
  eq('полей нет — все четыре названы', none.missing, Object.values(TAXONOMY_FIELDS))
  t('полей нет — расхождений нет', none.mismatched.length, 0)
  has('описание: нет полей', describeTaxonomySchemaDiff(none), 'нет полей: POI Type, POI Facets, Type Source, Taxonomy Version')

  const exact = diffTaxonomySchema([{ name: 'POI ID', type: 'singleLineText' }, ...liveOf()])
  t('точная схема — ok', exact.ok, true)
  t('описание: совпадает', describeTaxonomySchemaDiff(exact), 'схема таксономии совпадает с реестром')

  const shuffled = liveOf()
  shuffled[0] = { ...shuffled[0], options: { choices: [...shuffled[0].options.choices].reverse().map((c) => ({ name: c.name })) } }
  t('порядок опций не важен', diffTaxonomySchema(shuffled).ok, true)

  const wrongType = diffTaxonomySchema(liveOf({ 'POI Type': { type: 'singleLineText', options: undefined } }))
  t('чужой тип поля — расхождение', wrongType.ok, false)
  has('чужой тип поля назван', describeTaxonomySchemaDiff(wrongType), 'POI Type: тип singleLineText, ожидается singleSelect')

  const dropped = liveOf()
  dropped[0] = { ...dropped[0], options: { choices: dropped[0].options.choices.filter((c) => c.name !== 'market') } }
  const missingOption = diffTaxonomySchema(dropped)
  t('нет опции — расхождение', missingOption.ok, false)
  has('нет опции — назван код', describeTaxonomySchemaDiff(missingOption), 'POI Type: нет опций: market')

  const extra = liveOf()
  extra[2] = { ...extra[2], options: { choices: [...extra[2].options.choices, { name: 'bot' }] } }
  const extraOption = diffTaxonomySchema(extra)
  t('лишняя опция — расхождение', extraOption.ok, false)
  has('лишняя опция названа', describeTaxonomySchemaDiff(extraOption), 'Type Source: лишние опции: bot')

  const labels = liveOf()
  labels[0] = { ...labels[0], options: { choices: labels[0].options.choices.map((c) => ({ name: c.name === 'shinto_shrine' ? 'Синтоистское святилище' : c.name })) } }
  t('подпись вместо кода в опциях — расхождение', diffTaxonomySchema(labels).ok, false)

  const halfMissing = diffTaxonomySchema(liveOf().slice(0, 2))
  eq('часть полей — названы именно недостающие', halfMissing.missing, ['Type Source', 'Taxonomy Version'])
  t('ожидаемая схема приложена к диффу', halfMissing.expected.length, 4)
}

/* ── 4. ingestPoi: значения доезжают до полей записи ──────────────────── */
/* Хранилище в памяти — по тождеству фабрики writer'а (10f-P R2): только оно
   получает поля таксономии без живой схемы. */
const memStore = () => {
  const created = []
  const store = createMemoryPoiStore([], { observe: (e) => { if (e.kind === 'create') created.push(e.fields) } })
  return { created, store }
}
const request = (taxonomy) => ({
  source: { kind: 'portal-collector', id: 'bodik-osaka-tourism', externalKey: 'shrine-1' },
  poi: {
    nameRu: 'Святилище Сумиёси', nameEn: 'Sumiyoshi Taisha', siteCity: 'osaka',
    lat: 34.6125, lon: 135.4931, resolved: { placeId: 'PID-SUMIYOSHI', lat: 34.6125, lon: 135.4931 },
    ...(taxonomy === undefined ? {} : { taxonomy }),
  },
})
{
  const m = memStore()
  const r = await ingestPoi(request({ poiPrimaryType: 'shinto_shrine', facets: [], classificationSource: 'rule', taxonomyVersion }), m.store)
  t('с таксономией — запись создана', r.outcome, 'created')
  const f = m.created[0] ?? {}
  t('POI Type — код', f['POI Type'], 'shinto_shrine')
  t('Type Source — источник', f['Type Source'], 'rule')
  t('Taxonomy Version — версия loader’а', f['Taxonomy Version'], taxonomyVersion)
  t('пустые фасеты — поля нет в JSON', JSON.stringify(f).includes('POI Facets'), false)
  t('старое поле категории не тронуто таксономией', 'POI Category (RU)' in f && f['POI Category (RU)'] === undefined, true)
}
{
  const m = memStore()
  const r = await ingestPoi(request({ poiPrimaryType: 'public_onsen', facets: ['onsen'], classificationSource: 'model', taxonomyVersion }), m.store)
  t('с фасетами — запись создана', r.outcome, 'created')
  eq('POI Facets — список кодов', (m.created[0] ?? {})['POI Facets'], ['onsen'])
  t('Type Source — model', (m.created[0] ?? {})['Type Source'], 'model')
}
{
  const m = memStore()
  const r = await ingestPoi(request({ poiPrimaryType: 'shinto_shrine', facets: [], classificationSource: 'rule', taxonomyVersion: 'poi-taxonomy/v1' }), m.store)
  t('устаревшая версия — отказ канона', r.outcome, 'rejected_canon')
  t('причина — поле taxonomy', r.canonIssues.some((i) => i.field === 'taxonomy' && i.level === 'error'), true)
  has('причина названа', r.canonIssues.map((i) => i.message).join(' | '), 'не совпадает с реестром')
  t('записи нет', m.created.length, 0)
}
{
  const m = memStore()
  const r = await ingestPoi(request({ poiPrimaryType: 'appeared_later', facets: [], classificationSource: 'rule', taxonomyVersion }), m.store)
  t('чужой код — отказ канона', r.outcome, 'rejected_canon')
  t('записи нет', m.created.length, 0)
}
{
  const m = memStore()
  const r = await ingestPoi(request(undefined), m.store)
  t('без таксономии (путь Telegram) — запись создана', r.outcome, 'created')
  t('без таксономии — полей нет', 'POI Type' in (m.created[0] ?? {}), false)
}
/* 10f-P R2, находка 1 — сторож в САМОМ writer'е: ветка «схемы нет» открыта
   только хранилищу в памяти ПО ТОЖДЕСТВУ. Объявление, копия, прототип —
   эффектное хранилище: обязано отдать живую схему, которую writer сверит сам. */
{
  const taxonomy = { poiPrimaryType: 'shinto_shrine', facets: [], classificationSource: 'rule', taxonomyVersion }
  const effectful = (extra = {}) => {
    const seen = { reads: 0, creates: 0, schema: 0 }
    const store = {
      writeTarget: 'memory', // объявление — не тождество
      async listExisting() { seen.reads += 1; return [] },
      async findBySourceKey() { seen.reads += 1; return null },
      async create() { seen.creates += 1; return { poiId: 'x', recordId: 'y' } },
      ...extra,
    }
    return { seen, store }
  }
  const declared = effectful()
  has('объявление memory без схемы + таксономия — отказ', await boom(() => ingestPoi(request(taxonomy), declared.store)), 'не является хранилищем в памяти')
  has('в отказе сказано: объявление — не тождество', await boom(() => ingestPoi(request(taxonomy), declared.store)), 'объявление — не тождество')
  t('объявление memory: база не прочитана', declared.seen.reads, 0)
  t('объявление memory: записи нет', declared.seen.creates, 0)
  has('ingestPoiBatch: тот же отказ до снимка базы', await boom(() => ingestPoiBatch([request(taxonomy)], declared.store)), 'не является хранилищем в памяти')
  t('ingestPoiBatch: база не прочитана', declared.seen.reads, 0)
  const mem = createMemoryPoiStore([])
  has('копия снимка (spread) — эффектное хранилище, отказ', await boom(() => ingestPoi(request(taxonomy), { ...mem })), 'не является хранилищем в памяти')
  has('копия снимка со своим create — отказ', await boom(() => ingestPoi(request(taxonomy), { ...mem, async create() { return { poiId: 'x', recordId: 'y' } } })), 'не является хранилищем в памяти')
  has('прототипная обёртка со своим create — отказ', await boom(() => ingestPoi(request(taxonomy), Object.assign(Object.create(mem), { async create() { return { poiId: 'x', recordId: 'y' } } }))), 'не является хранилищем в памяти')
  t('сам снимок — тождество', isMemoryPoiStore(mem), true)
  t('копия — не тождество', isMemoryPoiStore({ ...mem }), false)
  const hijacked = createMemoryPoiStore([])
  hijacked.create = async () => ({ poiId: 'x', recordId: 'y' }) // подмена метода НА МЕСТЕ
  t('подмена метода на месте — тождество потеряно', isMemoryPoiStore(hijacked), false)
  has('подмена метода на месте — эффектное хранилище, отказ', await boom(() => ingestPoi(request(taxonomy), hijacked)), 'не является хранилищем в памяти')
  // Самоаттестация не принимается: writer сверяет сырые таблицы сам.
  const selfAttested = effectful({
    async assertTaxonomySchema() { return { checked: true, tableId: POI_TABLE_ID, fields: [] } },
    async readSchemaTables() { return [{ id: 'tblFOREIGN000000', name: 'POI', fields: liveOf() }] },
  })
  has('самоаттестация хранилища не принимается — writer сверяет таблицы сам', await boom(() => ingestPoi(request(taxonomy), selfAttested.store)), 'чужой ID tblFOREIGN000000')

  const tablesOf = (fields) => [{ id: POI_TABLE_ID, name: 'POI', fields }, { id: 'tblX', name: 'Route Stops', fields: [] }]
  const withSchema = effectful({ async readSchemaTables() { withSchema.seen.schema += 1; return tablesOf(liveOf()) } })
  const r = await ingestPoiBatch([request(taxonomy), request(taxonomy)], withSchema.store)
  t('эффектное хранилище с годной схемой: схема прочитана один раз на объект', withSchema.seen.schema, 1)
  t('эффектное хранилище с годной схемой: первая запись создана', r[0]?.outcome, 'created')
  t('эффектное хранилище с годной схемой: вторая — гейтом дублей', r[1]?.outcome, 'blocked_duplicate')
  const drifted = liveOf(); drifted[0] = { ...drifted[0], options: { choices: drifted[0].options.choices.filter((c) => c.name !== 'market') } }
  const bad = effectful({ async readSchemaTables() { return tablesOf(drifted) } })
  has('эффектное хранилище с дрейфом схемы — отказ writer’а', await boom(() => ingestPoi(request(taxonomy), bad.store)), 'POI Type: нет опций: market')
  t('дрейф схемы: база не прочитана', bad.seen.reads, 0)
  const impostor = effectful({ async readSchemaTables() { return [{ id: 'tblFOREIGN000000', name: 'POI', fields: liveOf() }] } })
  has('таблица «POI» с чужим ID — отказ writer’а', await boom(() => ingestPoi(request(taxonomy), impostor.store)), 'чужой ID tblFOREIGN000000')
  const failing = effectful({ async readSchemaTables() { throw new Error('Meta API 403') } })
  has('чтение схемы упало — отказ, не пропуск', await boom(() => ingestPoi(request(taxonomy), failing.store)), 'Meta API 403')
  const telegramLike = await ingestPoi(request(undefined), effectful().store)
  t('эффектное хранилище без таксономии (Telegram) — путь не изменён', telegramLike.outcome, 'created')
}

/* ── 5. Airtable-store: живая схема через Meta API ────────────────────── */
const storeWith = (schemaResponse) => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', auth: init.headers?.Authorization ?? null })
    return schemaResponse
  }
  return { calls, store: createAirtablePoiStore({ token: 'tok', baseId: 'appTEST', fetchImpl }) }
}
const tables = (fields, over = {}) => ({ ok: true, json: async () => ({ tables: [{ id: POI_TABLE_ID, name: 'POI', fields, ...over }, { id: 'tblX', name: 'Route Stops', fields: [] }] }) })
{
  t('путь Meta API закреплён', AIRTABLE_META_TABLES_PATH, '/v0/meta/bases/{baseId}/tables')
  t('канонический ID таблицы POI закреплён', POI_TABLE_ID, 'tblVCmFcHRpXUT24y')
  const exact = storeWith(tables([{ name: 'POI ID', type: 'singleLineText' }, ...liveOf()]))
  const checked = await exact.store.assertTaxonomySchema()
  t('точная схема — проверка пройдена', checked.checked, true)
  t('таблица названа каноническим ID', checked.tableId, POI_TABLE_ID)
  eq('поля перечислены', checked.fields, Object.values(TAXONOMY_FIELDS))
  t('ровно одно чтение', exact.calls.length, 1)
  t('хранилище отдаёт сырую схему writer’у', Array.isArray(await exact.store.readSchemaTables()), true)
  t('чтение — GET', exact.calls[0].method, 'GET')
  t('чтение — Meta API базы', exact.calls[0].url, 'https://api.airtable.com/v0/meta/bases/appTEST/tables')
  t('чтение — с токеном', exact.calls[0].auth, 'Bearer tok')

  const none = storeWith(tables([{ name: 'POI ID', type: 'singleLineText' }]))
  has('без полей — отказ до записи', await boom(() => none.store.assertTaxonomySchema()), 'нет полей: POI Type, POI Facets, Type Source, Taxonomy Version')
  has('без полей — про замороженную карточку', await boom(() => none.store.assertTaxonomySchema()), 'замороженной карточке')

  const drifted = liveOf()
  drifted[0] = { ...drifted[0], options: { choices: drifted[0].options.choices.filter((c) => c.name !== 'market') } }
  has('дрейф опций — отказ с именем поля', await boom(() => storeWith(tables(drifted)).store.assertTaxonomySchema()), 'POI Type: нет опций: market')

  const forbidden = storeWith({ ok: false, status: 403, text: async () => 'INVALID_PERMISSIONS' })
  const msg = await boom(() => forbidden.store.assertTaxonomySchema())
  has('нет scope — отказ, а не пропуск', msg, '403')
  has('нет scope — подсказка про scope', msg, 'schema.bases:read')

  const noTable = storeWith({ ok: true, json: async () => ({ tables: [{ id: 'tblX', name: 'Other', fields: [] }] }) })
  has('нет таблицы с каноническим ID — отказ', await boom(() => noTable.store.assertTaxonomySchema()), `таблицы с каноническим ID ${POI_TABLE_ID} нет`)

  /* 10f-P R1, находка 3: таблица с именем «POI» под чужим ID — не целевая. */
  const impostor = storeWith({ ok: true, json: async () => ({ tables: [{ id: 'tblFOREIGN000000', name: 'POI', fields: liveOf() }] }) })
  const impostorMessage = await boom(() => impostor.store.assertTaxonomySchema())
  has('таблица «POI» с чужим ID — терминальный отказ', impostorMessage, 'таблицы с каноническим ID')
  has('таблица «POI» с чужим ID — самозванец назван', impostorMessage, 'таблица с именем «POI» имеет чужой ID tblFOREIGN000000')
  const renamed = storeWith(tables(liveOf(), { name: 'POI (old)' }))
  has('таблица с каноническим ID, но чужим именем — остановка как дрейф', await boom(() => renamed.store.assertTaxonomySchema()), 'называется «POI (old)», ожидается «POI»')
  const both = storeWith({ ok: true, json: async () => ({ tables: [{ id: 'tblFOREIGN000000', name: 'POI', fields: [] }, { id: POI_TABLE_ID, name: 'POI', fields: liveOf() }] }) })
  let bothVerdict = null
  try { bothVerdict = (await both.store.assertTaxonomySchema()).tableId } catch (e) { bothVerdict = `отказ: ${e.message.slice(0, 80)}` }
  t('при двух таблицах «POI» берётся та, что с каноническим ID', bothVerdict, POI_TABLE_ID)

  /* Маршрут ЗАПИСИ тоже адресует таблицу ID, а не именем. */
  const routes = []
  const routed = createAirtablePoiStore({ token: 't', baseId: 'appTEST', fetchImpl: async (url, init = {}) => {
    routes.push({ url: String(url), method: init.method ?? 'GET' })
    if (/\/meta\//.test(String(url))) return tables([{ name: 'POI ID', type: 'singleLineText' }, ...liveOf()])
    if ((init.method ?? 'GET') === 'GET') return { ok: true, json: async () => ({ records: [] }) }
    return { ok: true, json: async () => ({ records: [{ id: 'recNEW' }] }) }
  } })
  await routed.assertTaxonomySchema()
  await routed.listExisting()
  await routed.create({ 'POI Name (RU)': 'x', Notes: '' })
  t('чтение записей — по каноническому ID таблицы', routes.some((r) => r.method === 'GET' && r.url.startsWith(`https://api.airtable.com/v0/appTEST/${POI_TABLE_ID}?`)), true)
  t('создание записи — по каноническому ID таблицы', routes.some((r) => r.method === 'POST' && r.url === `https://api.airtable.com/v0/appTEST/${POI_TABLE_ID}`), true)
  t('имя таблицы в маршрутах записи не используется', routes.some((r) => /\/v0\/appTEST\/POI(\?|$)/.test(r.url)), false)
}

if (bad.length) {
  console.error(`✗ таксономия ↔ Airtable: провалено ${bad.length} из ${ok + bad.length}`)
  for (const line of bad) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`✓ таксономия ↔ Airtable: ${ok} проверок пройдено`)
