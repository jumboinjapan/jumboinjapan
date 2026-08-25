/**
 * СОПОСТАВЛЕНИЕ ОБХОДА С AIRTABLE — ни сети, ни базы.
 *
 * Проверяется, что СИЛА свидетельства различается и не сглаживается: связь по
 * ключу — утверждение базы о себе; связь по адресу — совпадение страницы;
 * совпадение имени — догадка; противоречие свидетельств — конфликт, а не
 * выбор победителя.
 *
 * СНИМКИ ЗДЕСЬ НАСТОЯЩИЕ. Фикстуры собираются производственными строителями и
 * проходят полный `assertDiscoverySnapshot` — тот же, что зовёт граница. Пока
 * набор подавал «объект с полем records», он проверял поведение на входах,
 * которых производство не допускает, и ровно там пряталась дыра: граница
 * принимала подделанную живую запись со старым `snapshotDigest`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertDiscoverySnapshot,
  buildDiscoveryRecord,
  buildDiscoverySnapshot,
  buildOrderRecord,
  buildPageEvidence,
  orderItem,
} from '../scripts/poi-portals/lib/discovery-contract.mjs'
import {
  readCanonicalGzip,
  selectPortalSnapshot,
} from '../scripts/poi-portals/lib/discovery-baseline.mjs'
import {
  AIRTABLE_EXPORT_SPEC,
  AIRTABLE_MATCH_SPEC,
  airtableExportDigest,
  assertAirtableExport,
  assertOneToOneLinkage,
  normaliseName,
  pageIdentity,
  reconcileDiscoveryWithAirtable,
} from '../scripts/poi-portals/lib/discovery-airtable-match.mjs'
import { AIRTABLE_BASE_ID, POI_TABLE_ID } from '../src/lib/airtable-schema.ts'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = 'docs/poi-intake/baselines/japan-guide-v3-2026-08-25.json'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (Object.is(actual, expected)) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const eq = (label, a, b) => t(label, JSON.stringify(a), JSON.stringify(b))
const throwsWith = (label, fn, expect = null) => {
  try {
    fn()
    bad.push(`${label}: ждали отказ, вызов прошёл`)
  } catch (error) {
    if (expect && !String(error.message).includes(expect)) {
      bad.push(`${label}: ждали отказ «${expect}», получили «${error.message}»`)
    } else ok++
  }
}
const finish = () => {
  if (bad.length) {
    console.error(`Сопоставление с Airtable: ${bad.length} провалов из ${ok + bad.length}`)
    for (const line of bad) console.error(`  ✗ ${line}`)
    process.exit(1)
  }
  console.log(`Сопоставление с Airtable: ${ok} проверок пройдено`)
  process.exit(0)
}

/* ── Настоящий снимок v3 ──────────────────────────────────────────────── */

const HOST = 'https://www.japan-guide.com'
const ENTRY = `${HOST}/e/e623a.html`
const DEST = `${HOST}/e/e2157.html`
const AT = '2026-08-25T00:00:00.000Z'
const hex = (n) => '0123456789abcdef'[n % 16]
const DIGEST = (n) => `sha256:${hex(n).repeat(64)}`
const evidence = (url, pageRole, rawPageDigest) => buildPageEvidence({
  url,
  pageRole,
  pageBytes: 1024,
  rawPageDigest,
  observedAt: AT,
  httpCharset: 'shift-jis',
  metaCharset: 'utf-8',
  decodePolicy: 'mixed-page-utf8-locators-v1',
  decodeErrorCount: 0,
  decodeReplacements: 0,
  nonWhitelistedCodepoints: 0,
})

/**
 * Корпус обхода как СНИМОК, а не как список записей.
 *
 * Один каталог, одна ранжированная коллекция, объекты в ней. Ключ каждой
 * записи выводится из её адреса — это требование контракта, и именно оно
 * делает невозможным «два объекта на одной странице».
 */
const snapshotOf = (specs) => {
  const rows = [...specs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return buildDiscoverySnapshot({
    scope: { kind: 'full', limit: null },
    entryUrl: ENTRY,
    incompleteReasons: [],
    networkPolicy: { maxNetworkRequests: 6000, maxRedirects: 2 },
    robotsEvidence: {
      url: `${HOST}/robots.txt`, bytes: 64, digest: DIGEST(12), observedAt: AT, appliedGroups: ['*'],
    },
    catalogueEvidence: evidence(ENTRY, 'catalogue', DIGEST(10)),
    catalogueTargetEvidence: [
      { sourceKey: 'japan-guide:e2157', evidence: evidence(DEST, 'collection', DIGEST(11)) },
    ],
    nestedCollectionEvidence: [],
    orderRecords: [buildOrderRecord({
      destinationSourceKey: 'japan-guide:e2157',
      sourcePageDigest: DIGEST(11),
      collectionKind: 'ranked',
      items: rows.map((row) => orderItem('poi', `japan-guide:${row.id}`)),
    })],
    records: rows.map((row, index) => buildDiscoveryRecord({
      sourceKey: `japan-guide:${row.id}`,
      url: `${HOST}/e/${row.id}.html`,
      nameEn: row.nameEn,
      placements: [{
        kind: 'destinationRanking',
        collectionSourceKey: 'japan-guide:e2157',
        listPosition: index + 1,
        editorialLevel: 0,
        categoryHint: null,
      }],
      factLeads: [],
      omissions: [],
      pageEvidence: evidence(`${HOST}/e/${row.id}.html`, 'poi', DIGEST(index)),
    })),
    rejected: { targets: [], cards: [], nodes: [], pois: [] },
    counters: {
      networkRequests: rows.length + 10,
      catalogueTargetsFound: 1,
      catalogueCollectionsFound: 1,
      nestedCollectionsFound: 0,
      directPoisFound: 0,
      poisFound: rows.length,
      recordsAttempted: rows.length,
      recordsBuilt: rows.length,
      nonCanonicalLinks: 0,
      unknownAdmissionLabels: 0,
      emptyAdmissionValues: 0,
    },
  })
}
const urlOf = (id) => `${HOST}/e/${id}.html`
const keyOf = (id) => `japan-guide:${id}`

/*
 * ИДЕНТИФИКАТОРЫ СТРОК — НАСТОЯЩЕЙ ФОРМЫ: области значений тоже
 * производственная граница, и фикстура, спотыкающаяся о неё, проверяла бы не
 * то, что заявлено в её названии.
 */
const R = (n) => `rec${String(n).padStart(14, '0')}`
const P = (n) => `POI-${String(n).padStart(6, '0')}`
const FIELDS = Object.freeze(['isSystem', 'nameEn', 'poiId', 'sourceKey', 'website'])
const exportOf = (records, over = {}) => ({
  contractVersion: AIRTABLE_EXPORT_SPEC,
  note: 'фикстура',
  baseId: AIRTABLE_BASE_ID,
  tableId: POI_TABLE_ID,
  fetchedAt: '2026-08-25',
  fields: [...FIELDS],
  totalRecordCount: records.length,
  records,
  ...over,
})
const bytesOf = (doc) => Buffer.from(JSON.stringify(doc), 'utf8')
const match = (specs, rows, over = {}) =>
  reconcileDiscoveryWithAirtable(snapshotOf(specs), bytesOf(exportOf(rows, over)))

const ALONE = [{ id: 'e4000', nameEn: 'Alpha' }]

/* ── Нормализация имени ───────────────────────────────────────────────── */

t('регистр и дефисы не различают', normaliseName('Kiyomizu-dera'), normaliseName('KIYOMIZUDERA'))
t('служебное слово не различает', normaliseName('Sensoji Temple'), normaliseName('Sensoji'))
t('скобочное уточнение не различает',
  normaliseName('Rinnoji Temple (Sendai)'), normaliseName('Rinnoji Temple'))
t('разные имена не сливаются', normaliseName('Kinkakuji') === normaliseName('Ginkakuji'), false)
t('общее начало имени слияния не даёт',
  normaliseName('Ginkakuji') === normaliseName('Ginzan Onsen'), false)
t('и длинное общее начало тоже',
  normaliseName('Kiyomizudera') === normaliseName('Kiyomizu Kannon'), false)
t('пустое имя ключа не даёт', normaliseName('  '), '')

/* ── Идентичность страницы: что приводится и что НЕ приводится ────────── */

/* Приводится. */
t('схема не различает страницу',
  pageIdentity(`${HOST}/e/e3003.html`), pageIdentity('http://www.japan-guide.com/e/e3003.html'))
t('точный префикс www не различает',
  pageIdentity(`${HOST}/e/e3003.html`), pageIdentity('https://japan-guide.com/e/e3003.html'))
t('регистр имени хоста не различает',
  pageIdentity(`${HOST}/e/e3003.html`), pageIdentity('https://WWW.Japan-Guide.COM/e/e3003.html'))
t('хвостовой слэш не различает',
  pageIdentity(`${HOST}/destinations/nikko/`), pageIdentity(`${HOST}/destinations/nikko`))
t('разные страницы различаются',
  pageIdentity(`${HOST}/e/e3003.html`) === pageIdentity(`${HOST}/e/e3004.html`), false)

/*
 * НЕ ПРИВОДИТСЯ РЕГИСТР ПУТИ.
 *
 * Контрпример аудита 25.08: `/e/E1.html` из Airtable автоматически связывался
 * со снимком `/e/e1.html`. В HTTP путь регистрозависим — это два разных
 * ресурса, и объявлять их одним значило выдумывать факт.
 */
t('регистр пути РАЗЛИЧАЕТ страницу',
  pageIdentity(`${HOST}/e/e1.html`) === pageIdentity(`${HOST}/e/E1.html`), false)
t('и путь сохраняется как есть', pageIdentity(`${HOST}/e/E1.html`), 'japan-guide.com/e/E1.html')

/* Не даёт идентичности вовсе. */
for (const [label, value] of [
  ['запрос', `${HOST}/e/e1.html?utm=1`],
  ['фрагмент', `${HOST}/e/e1.html#top`],
  ['учётные данные', 'https://user:secret@www.japan-guide.com/e/e1.html'],
  ['учётные данные без пароля', 'https://user@www.japan-guide.com/e/e1.html'],
  ['неумолчаный порт', 'https://www.japan-guide.com:8443/e/e1.html'],
  ['точечный сегмент', `${HOST}/e/../e/e1.html`],
  ['текущий каталог в пути', `${HOST}/e/./e1.html`],
  ['процентное кодирование', `${HOST}/e/%65.html`],
  ['чужая схема', 'ftp://www.japan-guide.com/e/e1.html'],
  ['не адрес вовсе', 'japan-guide.com/e/e1.html'],
  ['пустая строка', ''],
  /* Контрпримеры аудита R4: `new URL` чинил их ДО любой проверки. */
  ['обратный слэш', 'https://www.japan-guide.com\\e/e1.html'],
  ['обратный слэш в середине пути', 'https://www.japan-guide.com/e\\e1.html'],
  ['лишние слэши перед authority', 'https:////www.japan-guide.com/e/e1.html'],
  ['три слэша', 'https:///www.japan-guide.com/e/e1.html'],
  ['хост с хвостовой точкой', 'https://www.japan-guide.com./e/e1.html'],
  ['схема в верхнем регистре', 'HTTPS://www.japan-guide.com/e/e1.html'],
]) {
  t(`${label} идентичности не даёт`, pageIdentity(value), null)
}
/*
 * ВХОД — ТОЛЬКО ПРИМИТИВНАЯ СТРОКА, И НИКАКОЙ НЕОБЪЯВЛЕННОЙ НОРМАЛИЗАЦИИ.
 *
 * `String(value).trim()` принимал объект `URL` — а тот по дороге сам чинит
 * написание, то есть возвращал бы идентичность подделке, — и строку с
 * внешними пробелами. Производственный путь Airtable таких значений не подаёт;
 * закрыто потому, что объявленная строгость и есть контракт.
 */
t('объект URL идентичности не даёт', pageIdentity(new URL(`${HOST}/e/e1.html`)), null)
t('и объект URL с подделкой — тем более',
  pageIdentity(new URL('https://www.japan-guide.com\\e/e1.html')), null)
t('число идентичности не даёт', pageIdentity(12345), null)
t('объект с toString — тоже',
  pageIdentity({ toString: () => `${HOST}/e/e1.html` }), null)
t('строка с внешними пробелами не подрезается',
  pageIdentity(`  ${HOST}/e/e1.html  `), null)
t('и с переводом строки тоже', pageIdentity(`${HOST}/e/e1.html\n`), null)
t('и с пробелом внутри пути', pageIdentity(`${HOST}/e/e 1.html`), null)

/* Псевдоним не должен становиться равным настоящему адресу. */
t('обратный слэш не равен странице',
  pageIdentity('https://www.japan-guide.com\\e/e1.html') === pageIdentity(`${HOST}/e/e1.html`), false)
t('лишние слэши не равны странице',
  pageIdentity('https:////www.japan-guide.com/e/e1.html') === pageIdentity(`${HOST}/e/e1.html`), false)
/* Двойной слэш ВНУТРИ пути — другой путь, а не псевдоним: он сохраняется как
   есть и настоящей странице не равен. */
t('двойной слэш внутри пути сохраняется',
  pageIdentity(`${HOST}//e/e1.html`), 'japan-guide.com//e/e1.html')
t('точечный псевдоним не равен странице',
  pageIdentity(`${HOST}/e/../e/e1.html`) === pageIdentity(`${HOST}/e/e1.html`), false)
/* `%65` — это `e`: раскрыв кодирование, мы объявили бы `/e/%65 1.html` тем же
   ресурсом, что `/e/e1.html`. Не раскрываем — и идентичности не выдаём. */
t('кодированный псевдоним тоже',
  pageIdentity(`${HOST}/e/%651.html`) === pageIdentity(`${HOST}/e/e1.html`), false)

/* ── Выгрузка проверяется ДО сопоставления ────────────────────────────── */

const rows = [{ recordId: R(1), poiId: P(1), nameEn: 'Alpha' }]
assertAirtableExport(exportOf(rows)); ok++
throwsWith('чужая версия выгрузки',
  () => assertAirtableExport(exportOf(rows, { contractVersion: 'что-угодно/v9' })), 'contractVersion')
throwsWith('чужая база',
  () => assertAirtableExport(exportOf(rows, { baseId: 'appПОДДЕЛКА' })), 'означают не то же самое')
throwsWith('чужая таблица',
  () => assertAirtableExport(exportOf(rows, { tableId: 'tblПОДДЕЛКА' })), 'означают не то же самое')
/* Каноническое тождество не подменяется вызывающим: параметра нет вовсе. */
throwsWith('подставная пара база/таблица при своём же «ожидаемом»',
  () => assertAirtableExport(
    exportOf(rows, { baseId: 'appПОДДЕЛКА', tableId: 'tblПОДДЕЛКА' }),
    { baseId: 'appПОДДЕЛКА', tableId: 'tblПОДДЕЛКА' }), 'при каноническом')
t('тождество берётся из общего модуля схемы',
  `${AIRTABLE_BASE_ID}/${POI_TABLE_ID}`, 'apppwhjFN82N9zNqm/tblVCmFcHRpXUT24y')

/* Листья шапки: не «есть поле», а что в нём стоит. */
throwsWith('note объектом',
  () => assertAirtableExport(exportOf(rows, { note: { invented: true } })), 'note')
throwsWith('note пустой строкой',
  () => assertAirtableExport(exportOf(rows, { note: '' })), 'note')
throwsWith('дата не в каноническом виде',
  () => assertAirtableExport(exportOf(rows, { fetchedAt: '25 августа' })), 'календарная дата')
throwsWith('несуществующая календарная дата',
  () => assertAirtableExport(exportOf(rows, { fetchedAt: '2026-02-31' })), 'календарная дата')
throwsWith('и високосная тоже проверяется',
  () => assertAirtableExport(exportOf(rows, { fetchedAt: '2026-02-29' })), 'календарная дата')
assertAirtableExport(exportOf(rows, { fetchedAt: '2024-02-29' })); ok++
throwsWith('счётчик не сходится с длиной массива',
  () => assertAirtableExport(exportOf(rows, { totalRecordCount: 1000 })), 'выгрузка неполна')
throwsWith('лишнее поле шапки',
  () => assertAirtableExport({ ...exportOf(rows), extra: 1 }), 'лишние поля')
throwsWith('пропавшее поле шапки', () => {
  const doc = exportOf(rows)
  delete doc.fields
  return assertAirtableExport(doc)
}, 'нет обязательных полей')

/* ── Проекция обязана доказать, что поля запрашивали ──────────────────── */

throwsWith('проекция только из poiId',
  () => assertAirtableExport(exportOf(rows, { fields: ['poiId'] })), 'сопоставление ими пользуется')
throwsWith('проекция без одного используемого поля',
  () => assertAirtableExport(exportOf(rows, { fields: FIELDS.filter((f) => f !== 'website') })),
  'проекция без website')
throwsWith('проекция с неизвестным полем',
  () => assertAirtableExport(exportOf(rows, { fields: [...FIELDS, 'выдумка'].sort() })),
  'выгрузке неизвестно')
throwsWith('метаданные строки полем не являются',
  () => assertAirtableExport(exportOf(rows, { fields: [...FIELDS, 'createdTime'].sort() })),
  'выгрузке неизвестно')
throwsWith('проекция не отсортирована',
  () => assertAirtableExport(exportOf(rows, { fields: ['website', 'poiId', 'nameEn', 'isSystem', 'sourceKey'] })),
  'обязан быть отсортирован')
throwsWith('в строке поле, которого нет в проекции',
  () => assertAirtableExport(exportOf(
    [{ recordId: R(1), poiId: P(1), siteCity: 'kyoto' }])), 'выгрузка себе противоречит')
assertAirtableExport(exportOf([{ recordId: R(1), poiId: P(1) }])); ok++

/* ── Области значений строки ──────────────────────────────────────────── */

throwsWith('строка без recordId',
  () => assertAirtableExport(exportOf([{ poiId: P(1) }])), 'recordId')
throwsWith('recordId не той формы',
  () => assertAirtableExport(exportOf([{ recordId: 'r1', poiId: P(1) }])), 'вне области значений')
throwsWith('POI ID не той формы',
  () => assertAirtableExport(exportOf([{ recordId: R(1), poiId: 'POI-1' }])), 'вне области значений')
throwsWith('адрес не адрес',
  () => assertAirtableExport(exportOf(
    [{ recordId: R(1), poiId: P(1), website: 'ftp://japan-guide.com/e/e1.html' }])),
  'вне области значений')
throwsWith('неизвестное поле строки',
  () => assertAirtableExport(exportOf([{ recordId: R(1), poiId: P(1), выдумка: 1 }])),
  'выгрузке неизвестно')
throwsWith('число вместо строки',
  () => assertAirtableExport(exportOf([{ recordId: R(1), poiId: P(1), nameEn: 7 }])), 'ожидается строка')
throwsWith('строка вместо логического',
  () => assertAirtableExport(exportOf([{ recordId: R(1), poiId: P(1), isSystem: 'да' }])), 'логическое')
throwsWith('повторяющийся recordId',
  () => assertAirtableExport(exportOf([
    { recordId: R(1), poiId: P(1) }, { recordId: R(1), poiId: P(2) },
  ])), 'встречается дважды')
throwsWith('повторяющийся POI ID',
  () => assertAirtableExport(exportOf([
    { recordId: R(1), poiId: P(1) }, { recordId: R(2), poiId: P(1) },
  ])), 'встречается дважды')

/* ── Граница принимает БАЙТЫ и проверяет ОБА входа сама ───────────────── */

throwsWith('граница проверяет выгрузку сама, а не полагается на вызывающего',
  () => match(ALONE, rows, { baseId: 'appПОДДЕЛКА' }), 'означают не то же самое')
throwsWith('и неполную выгрузку тоже',
  () => match(ALONE, rows, { totalRecordCount: 99 }), 'выгрузка неполна')
throwsWith('разобранный объект вместо байт не принимается',
  () => reconcileDiscoveryWithAirtable(snapshotOf(ALONE), exportOf(rows)), 'ожидаются БАЙТЫ')
throwsWith('строка вместо байт тоже',
  () => reconcileDiscoveryWithAirtable(snapshotOf(ALONE), JSON.stringify(exportOf(rows))), 'ожидаются БАЙТЫ')
throwsWith('байты, которые не JSON',
  () => reconcileDiscoveryWithAirtable(snapshotOf(ALONE), Buffer.from('{не json', 'utf8')),
  'не разбираются как JSON')

/*
 * СНИМОК ПРОВЕРЯЕТСЯ ПОЛНЫМ КОНТРАКТОМ.
 *
 * Контрпример аудита: у записи подменены ключ, имя и адрес, а `snapshotDigest`
 * оставлен прежним. Сокращённая проверка видела синтаксис отпечатка и не
 * видела его СООТВЕТСТВИЯ содержимому — граница принимала подделку и
 * публиковала старый отпечаток как привязку.
 */
const tampered = JSON.parse(JSON.stringify(snapshotOf([
  { id: 'e4000', nameEn: 'Alpha' }, { id: 'e4001', nameEn: 'Beta' },
])))
tampered.records[0].nameEn = 'Forged Name'
throwsWith('подделанная запись при прежнем отпечатке — отказ',
  () => reconcileDiscoveryWithAirtable(tampered, bytesOf(exportOf(rows))), 'не сходится с содержимым')
throwsWith('и производственный контракт говорит то же',
  () => assertDiscoverySnapshot(tampered), 'не сходится с содержимым')
const bumped = JSON.parse(JSON.stringify(snapshotOf(ALONE)))
bumped.counters.recordsBuilt = 99
throwsWith('подделанный счётчик — тоже отказ границы',
  () => reconcileDiscoveryWithAirtable(bumped, bytesOf(exportOf(rows))), 'recordsBuilt')
throwsWith('снимок неизвестного формата не принимается',
  () => reconcileDiscoveryWithAirtable(
    { ...snapshotOf(ALONE), contractVersion: 'poi-discovery-snapshot/v9' }, bytesOf(exportOf(rows))),
  'чужая версия')

/*
 * ОДНА СТРАНИЦА — РОВНО ОДИН ОБЪЕКТ, и это не соглашение набора, а требование
 * контракта: `sourceKey` обязан ВЫВОДИТЬСЯ из адреса. Поэтому в раскладке нет
 * и не может быть ветви «два объекта на одной странице» — вход, на котором она
 * срабатывала бы, граница не пропускает.
 */
const twinPage = JSON.parse(JSON.stringify(snapshotOf(ALONE)))
twinPage.records.push({ ...JSON.parse(JSON.stringify(twinPage.records[0])), sourceKey: keyOf('e4001') })
throwsWith('две записи на одной странице границей не принимаются',
  () => reconcileDiscoveryWithAirtable(twinPage, bytesOf(exportOf(rows))), 'не выводится из')

/* Отпечаток входа считается ВНУТРИ границы. */
const boundDoc = exportOf(rows)
const boundBytes = bytesOf(boundDoc)
const bound = reconcileDiscoveryWithAirtable(snapshotOf(ALONE), boundBytes)
t('версия отчёта названа', bound.contractVersion, AIRTABLE_MATCH_SPEC)
t('отпечаток снимка в отчёте настоящий',
  bound.inputs.discovery.snapshotDigest, snapshotOf(ALONE).snapshotDigest)
t('отпечаток выгрузки — SHA-256 поданных байт',
  bound.inputs.airtable.exportDigest, airtableExportDigest(boundBytes))
eq('и тождество таблицы тоже',
  [bound.inputs.airtable.baseId, bound.inputs.airtable.tableId, bound.inputs.airtable.fetchedAt],
  [AIRTABLE_BASE_ID, POI_TABLE_ID, '2026-08-25'])
const spacedBytes = Buffer.from(JSON.stringify(boundDoc, null, 1), 'utf8')
t('другие байты той же выгрузки дают другой отпечаток',
  reconcileDiscoveryWithAirtable(snapshotOf(ALONE), spacedBytes).inputs.airtable.exportDigest
  === airtableExportDigest(boundBytes), false)
t('отпечаток выгрузки считается по байтам',
  airtableExportDigest(Buffer.from('a')) === airtableExportDigest(Buffer.from('b')), false)

/* ── Раскладка по исходам ─────────────────────────────────────────────── */

const corpus = [
  { id: 'e4000', nameEn: 'Keyed Place' },
  { id: 'e4001', nameEn: 'Url Place' },
  { id: 'e4002', nameEn: 'Named Place' },
  { id: 'e4003', nameEn: 'Rinnoji Temple' },
  { id: 'e4004', nameEn: 'Nobody Knows This' },
]
const report = match(corpus, [
  { recordId: R(1), poiId: P(1), nameEn: 'Anything', sourceKey: keyOf('e4000') },
  { recordId: R(2), poiId: P(2), nameEn: 'Other Name', website: urlOf('e4001') },
  { recordId: R(3), poiId: P(3), nameEn: 'Named Place' },
  { recordId: R(4), poiId: P(4), nameEn: 'Rinnoji Temple' },
  { recordId: R(5), poiId: P(5), nameEn: 'Rinnoji Temple (Sendai)' },
  /* Служебная строка с тем же именем: попав в выборку, дала бы ложного
     кандидата пятому объекту. */
  { recordId: R(6), poiId: P(6), nameEn: 'Nobody Knows This', isSystem: true },
])
eq('связь по ключу — сильнейшее свидетельство',
  report.linkedByKey.map((row) => [row.sourceKey, row.poiId]), [[keyOf('e4000'), P(1)]])
eq('связь по адресу — вторая по силе',
  report.linkedByUrl.map((row) => [row.sourceKey, row.poiId]), [[keyOf('e4001'), P(2)]])
eq('совпадение имени остаётся КАНДИДАТОМ',
  report.nameCandidates.map((row) => [row.sourceKey, row.poiId]), [[keyOf('e4002'), P(3)]])
eq('омоним связи не даёт вовсе',
  report.ambiguous.map((row) => [row.sourceKey, row.reason]),
  [[keyOf('e4003'), 'oneNameSeveralRows']])
eq('и остальное честно объявлено ненайденным',
  report.unmatched.map((row) => row.sourceKey), [keyOf('e4004')])
t('служебная строка кандидата не породила', report.counts.airtableSystemRows, 1)
t('каждый объект попал ровно в один исход',
  report.counts.linkedByKey + report.counts.linkedByUrl + report.counts.nameCandidates
  + report.counts.conflicts + report.counts.ambiguous + report.counts.unmatched,
  report.counts.discoveryRecords)
/* Регистр пути в адресе базы связи не даёт — теперь это исход, а не совпадение. */
const upperCase = match(ALONE, [
  { recordId: R(1), poiId: P(1), nameEn: 'Different Name', website: urlOf('E4000') },
])
t('адрес, отличающийся регистром пути, связи не даёт', upperCase.counts.linkedByUrl, 0)
t('и объект остаётся ненайденным', upperCase.counts.unmatched, 1)

/*
 * ПСЕВДОНИМЫ АДРЕСА — ЧЕРЕЗ ГРАНИЦУ, А НЕ ТОЛЬКО ЧЕРЕЗ `pageIdentity`.
 *
 * Аудит R4 предъявил их на живой паре входов: обе подделки автоматически
 * связывались с настоящей страницей. Проверка одной функции этого не показала
 * бы — связь возникает в раскладке, и доказывать надо её.
 */
for (const [label, alias] of [
  ['обратный слэш', 'https://www.japan-guide.com\\e/e4000.html'],
  ['лишние слэши перед authority', 'https:////www.japan-guide.com/e/e4000.html'],
]) {
  const aliased = match(ALONE, [
    { recordId: R(1), poiId: P(1), nameEn: 'Alias Row', website: alias },
  ])
  t(`${label}: связи по адресу нет`, aliased.counts.linkedByUrl, 0)
  t(`${label}: и объект остаётся ненайденным`, aliased.counts.unmatched, 1)
}
/* Тот же вход в каноническом написании связь ДАЁТ — иначе «нет связи»
   доказывало бы лишь то, что фикстура ни с чем не сходится. */
const canonical = match(ALONE, [
  { recordId: R(1), poiId: P(1), nameEn: 'Canonical Row', website: urlOf('e4000') },
])
t('каноническое написание связь даёт', canonical.counts.linkedByUrl, 1)

/* ── Контрпример аудита: дубль Source Key ─────────────────────────────── */

const duplicate = match(ALONE, [
  { recordId: R(1), poiId: P(1), nameEn: 'First', sourceKey: keyOf('e4000') },
  { recordId: R(2), poiId: P(2), nameEn: 'Second', sourceKey: keyOf('e4000') },
])
t('дубль ключа связи не даёт', duplicate.counts.linkedByKey, 0)
eq('и назван конфликтом с обоими POI',
  duplicate.conflicts.map((row) => [row.reason, row.poiIds]),
  [['duplicateSourceKey', [P(1), P(2)]]])
t('последняя строка больше не выигрывает молча', duplicate.counts.conflicts, 1)

/* ── Контрпример аудита: ключ на A, адрес на B ────────────────────────── */

const twoObjects = [{ id: 'e4000', nameEn: 'Alpha' }, { id: 'e4001', nameEn: 'Beta' }]
const disagreement = match(twoObjects, [{
  recordId: R(1), poiId: P(1), nameEn: 'Both', sourceKey: keyOf('e4000'), website: urlOf('e4001'),
}])
t('противоречивая запись не связывается ни с кем', disagreement.counts.linkedByKey, 0)
t('и по адресу тоже', disagreement.counts.linkedByUrl, 0)
eq('оба объекта названы конфликтами одной причиной',
  disagreement.conflicts.map((row) => [row.sourceKey, row.reason]),
  [[keyOf('e4000'), 'sourceKeyWebsiteDisagreement'], [keyOf('e4001'), 'sourceKeyWebsiteDisagreement']])
t('и здесь каждый объект имеет ровно один исход',
  disagreement.counts.linkedByKey + disagreement.counts.linkedByUrl
  + disagreement.counts.nameCandidates + disagreement.counts.conflicts
  + disagreement.counts.ambiguous + disagreement.counts.unmatched,
  disagreement.counts.discoveryRecords)

/* ── Контрпример аудита: непустой ключ, которого обход не знает ────────── */

const strangerKey = match(ALONE, [{
  recordId: R(1), poiId: P(1), nameEn: 'Alpha',
  sourceKey: keyOf('e99999'), website: urlOf('e4000'),
}])
t('неизвестный ключ связи по адресу не даёт', strangerKey.counts.linkedByUrl, 0)
t('и по имени тоже — запись отравлена целиком', strangerKey.counts.nameCandidates, 0)
eq('исход назван', strangerKey.conflicts.map((row) => [row.sourceKey, row.reason]),
  [[keyOf('e4000'), 'sourceKeyUnknownToCrawl']])
const foreignKey = match(ALONE, [{
  recordId: R(1), poiId: P(1), nameEn: 'Alpha',
  sourceKey: 'benesse-artsite:chichu', website: urlOf('e4000'),
}])
eq('ключ другого портала — тот же конфликт',
  foreignKey.conflicts.map((row) => row.reason), ['sourceKeyUnknownToCrawl'])
/* Строка, чей адрес в обход не попадает, свидетельств НЕ теряет. */
const elsewhere = match([{ id: 'e4000', nameEn: 'Chichu Art Museum' }], [{
  recordId: R(1), poiId: P(1), nameEn: 'Chichu Art Museum',
  sourceKey: 'benesse-artsite:chichu', website: 'https://benesse-artsite.jp/art/chichu.html',
}])
t('чужая строка вне обхода конфликтом не объявляется', elsewhere.counts.conflicts, 0)
t('её имя остаётся кандидатом для человека', elsewhere.counts.nameCandidates, 1)
eq('и это тот самый объект',
  elsewhere.nameCandidates.map((row) => [row.sourceKey, row.poiId]), [[keyOf('e4000'), P(1)]])
t('ненайденных при этом нет', elsewhere.counts.unmatched, 0)

/* ── Две записи на одну страницу — неоднозначность ─────────────────────── */

const twoRows = match(ALONE, [
  { recordId: R(1), poiId: P(101), nameEn: 'One', website: urlOf('e4000') },
  { recordId: R(2), poiId: P(102), nameEn: 'Two', website: urlOf('e4000') },
])
t('две записи на одну страницу связи не дают', twoRows.counts.linkedByUrl, 0)
eq('и названы неоднозначностью с обоими POI',
  twoRows.ambiguous.map((row) => row.poiIds), [[P(101), P(102)]])

/* Согласованная запись: ключ и адрес говорят об ОДНОМ объекте — это связь. */
const agreeing = match(ALONE, [{
  recordId: R(1), poiId: P(1), nameEn: 'Alpha', sourceKey: keyOf('e4000'), website: urlOf('e4000'),
}])
t('согласованные ключ и адрес дают связь', agreeing.counts.linkedByKey, 1)
t('и второй раз объект не считается', agreeing.counts.linkedByUrl, 0)
t('и конфликтом не объявляется', agreeing.counts.conflicts, 0)

/* ── Связь один-к-одному: утверждение о результате ────────────────────── */

throwsWith('сторож ловит двойное притязание на одну запись',
  () => assertOneToOneLinkage([
    { sourceKey: keyOf('e4000'), poiId: P(1) },
    { sourceKey: keyOf('e4001'), poiId: P(1) },
  ]), 'один-к-одному')
throwsWith('и называет обоих соперников',
  () => assertOneToOneLinkage([
    { sourceKey: keyOf('e4000'), poiId: P(1) },
    { sourceKey: keyOf('e4001'), poiId: P(1) },
  ]), `${keyOf('e4000')}, ${keyOf('e4001')}`)
assertOneToOneLinkage([
  { sourceKey: keyOf('e4000'), poiId: P(1) },
  { sourceKey: keyOf('e4001'), poiId: P(2) },
]); ok++
const claimed = [...report.linkedByKey, ...report.linkedByUrl].map((row) => row.poiId)
t('ни одна запись не связана дважды', claimed.length, new Set(claimed).size)

/* ── Обратная сторона ─────────────────────────────────────────────────── */

const vanished = match(ALONE, [
  { recordId: R(9), poiId: P(9), nameEn: 'Gone', website: urlOf('e9999') },
])
eq('запись портала, не найденная обходом, названа',
  vanished.portalRowsNotFoundByCrawl.map((row) => row.poiId), [P(9)])
t('а сам объект обхода остаётся ненайденным', vanished.counts.unmatched, 1)

/* ── Живой baseline: подделка на НАСТОЯЩЕМ снимке ─────────────────────── */

/*
 * Синтетика доказывает правило, живой снимок — что правило работает на том
 * самом артефакте, который лежит в репозитории. В матрице мутаций эти шесть
 * секунд ничего не добавляют (правило уже убито синтетикой выше), поэтому там
 * они пропускаются; в `npm test` идут всегда.
 */
if (!process.env.JJ_MUTATION_RUN) {
  const manifest = JSON.parse(readFileSync(path.join(REPO, MANIFEST), 'utf8'))
  const live = selectPortalSnapshot(
    JSON.parse(readCanonicalGzip(readFileSync(path.join(REPO, manifest.artefact.path)))
      .toString('utf8')),
    manifest.artefact.portalId)
  t('живой снимок проходит границу как есть',
    reconcileDiscoveryWithAirtable(live, bytesOf(exportOf([]))).inputs.discovery.snapshotDigest,
    manifest.snapshot.snapshotDigest)
  const forgedLive = JSON.parse(JSON.stringify(live))
  const victim = forgedLive.records[0]
  victim.sourceKey = keyOf('e99999')
  victim.nameEn = 'Forged Place'
  victim.url = urlOf('e99999')
  throwsWith('подделанная живая запись при прежнем отпечатке — отказ',
    () => reconcileDiscoveryWithAirtable(forgedLive, bytesOf(exportOf([]))))
  throwsWith('и производственный контракт отвергает её же',
    () => assertDiscoverySnapshot(forgedLive))
}

finish()
