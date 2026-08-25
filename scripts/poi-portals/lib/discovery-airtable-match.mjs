/**
 * СОПОСТАВЛЕНИЕ ОТКРЫТЫХ POI С ТЕМ, ЧТО УЖЕ ЕСТЬ В AIRTABLE. Только чтение.
 *
 * Здесь НЕ решается, что заводить и что сливать. Здесь раскладывается корпус
 * обхода по исходам, каждый из которых — предъявимое утверждение:
 *
 *   linkedByKey   у ОДНОЙ записи Airtable стоит `Source Key` этого объекта;
 *   linkedByUrl   у ОДНОЙ записи `Website` — ровно эта страница источника;
 *   nameCandidate ни ключа, ни адреса нет, но нормализованное имя совпало;
 *   conflicts     свидетельства ЕСТЬ, но они противоречат друг другу;
 *   ambiguous     свидетельство указывает больше чем на одну запись;
 *   unmatched     ничего из перечисленного.
 *
 * ПОЧЕМУ СОВПАДЕНИЕ ИМЕНИ — КАНДИДАТ, А НЕ СВЯЗЬ. Имя не идентификатор:
 * `Rinnoji Temple` есть и в Никко, и в Сэндае. Связать по имени автоматически
 * значило бы подменить решение о тождестве догадкой и записать её в базу.
 *
 * ПОЧЕМУ СВЯЗЬ СТРОГО ОДИН-К-ОДНОМУ. Аудит 25.08 предъявил запись, у которой
 * `Source Key` указывал на объект A, а `Website` — на страницу объекта B: она
 * связывалась с ОБОИМИ, и каждый из двух объектов считался «покрытым». Два
 * взаимоисключающих утверждения об одной строке — это конфликт, а не две
 * связи. Поэтому после раскладки идёт отдельный проход: запись, на которую
 * претендует больше одного объекта, снимает связь у ВСЕХ претендентов.
 *
 * Сети здесь нет: на вход подаётся снимок обхода и выгрузка, сделанная
 * отдельно и только на чтение. Выгрузка ПРОВЕРЯЕТСЯ до сопоставления.
 */
import { createHash } from 'node:crypto'
import {
  assertExactKeys,
  assertNonEmptyString,
  assertSha256Value,
  assertStringList,
  isStrictCalendarDate,
} from '../../lib/canonical-contract.mjs'
import { assertDiscoverySnapshot } from './discovery-contract.mjs'
import { AIRTABLE_BASE_ID, POI_TABLE_ID } from '../../../src/lib/airtable-schema.ts'

export const AIRTABLE_MATCH_SPEC = 'poi-airtable-match/v1'
export const AIRTABLE_EXPORT_SPEC = 'poi-airtable-export/v1'

/**
 * ТОЖДЕСТВО КАНОНИЧЕСКОЙ ТАБЛИЦЫ — ИЗ ОБЩЕГО МОДУЛЯ СХЕМЫ, И ТОЛЬКО ОТТУДА.
 *
 * Выгрузка из ДРУГОЙ базы — не «другие данные», а другой предмет разговора:
 * `POI-000123` там означает не то же самое.
 *
 * Прежде идентификаторы были переписаны сюда литералами, а проверка принимала
 * параметр `expected` — то есть вызывающий объявлял ожидаемым ровно то, что
 * подал, и подделка проходила. Аудит 25.08 это и предъявил. Теперь источник
 * один — `src/lib/airtable-schema.ts`, тот же, которым пользуются писатели в
 * базу, и подменить его через публичный вход нечем: параметра нет.
 */
const CANONICAL_TABLE = Object.freeze({ baseId: AIRTABLE_BASE_ID, tableId: POI_TABLE_ID })

const EXPORT_KEYS = Object.freeze([
  'contractVersion', 'note', 'baseId', 'tableId', 'fetchedAt', 'fields',
  'totalRecordCount', 'records',
])
/** Поля строки: два обязательных, остальные — по наличию значения в базе. */
const ROW_REQUIRED = Object.freeze(['recordId', 'poiId'])
const ROW_OPTIONAL = Object.freeze([
  'createdTime', 'nameEn', 'nameRu', 'nameJa', 'website', 'sourceKey',
  'seedSource', 'intakeOrigin', 'isSystem', 'siteCity',
])
const ROW_BOOLEAN = Object.freeze(['isSystem'])
/* Метаданные строки Airtable отдаёт всегда; полями они не являются и в
   проекции им места нет. */
const ROW_METADATA = Object.freeze(['recordId', 'createdTime'])
const PROJECTABLE = Object.freeze(
  [...ROW_REQUIRED, ...ROW_OPTIONAL].filter((key) => !ROW_METADATA.includes(key)).sort())

/**
 * ПОЛЯ, БЕЗ КОТОРЫХ СОПОСТАВЛЕНИЕ НЕ СОПОСТАВЛЯЕТ.
 *
 * Проекция — это то, что у базы СПРОСИЛИ. Выгрузка с `fields: ['poiId']`
 * формально исправна: строка без `Source Key` и `Website` — законное состояние
 * базы. Но тогда «не найдено 1140» означало бы не «база их не знает», а «мы не
 * спрашивали»: пустой ответ на незаданный вопрос выдавался бы за измерение.
 * Аудит 25.08 предъявил ровно такую выгрузку. Поэтому проекция обязана
 * ДОКАЗАТЬ, что каждое используемое поле запрошено; пустое значение в
 * отдельной строке при этом законно и означает «в базе пусто».
 */
const REQUIRED_PROJECTION = Object.freeze(['isSystem', 'nameEn', 'poiId', 'sourceKey', 'website'])

/**
 * Области значений строки.
 *
 * `recordId` и `POI ID` — идентификаторы известной формы; их проверка ловит
 * подмену выгрузки чем-то похожим раньше, чем сопоставление начнёт считать
 * такие строки записями базы.
 */
const ROW_DOMAINS = Object.freeze({
  recordId: /^rec[A-Za-z0-9]{14}$/,
  poiId: /^POI-\d{6}$/,
  createdTime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  website: /^https?:\/\/\S+$/,
})

/**
 * Проверка выгрузки перед сопоставлением.
 *
 * Тождество таблицы, точная форма шапки, обязательные поля строк, типы,
 * уникальность `recordId` и `POI ID` и сходимость `totalRecordCount` с длиной
 * массива. Последнее не формальность: выгрузка, потерявшая страницу при
 * пагинации, выглядит исправной ровно до этой проверки.
 */
export function assertAirtableExport(doc, where = AIRTABLE_EXPORT_SPEC) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new TypeError(`${where}: ожидается объект выгрузки`)
  }
  if (doc.contractVersion !== AIRTABLE_EXPORT_SPEC) {
    throw new TypeError(
      `${where}.contractVersion: ожидается «${AIRTABLE_EXPORT_SPEC}», `
      + `получено ${JSON.stringify(doc.contractVersion)}`)
  }
  assertExactKeys(doc, EXPORT_KEYS, where)
  for (const [field, want] of
    [['baseId', CANONICAL_TABLE.baseId], ['tableId', CANONICAL_TABLE.tableId]]) {
    if (doc[field] !== want) {
      throw new TypeError(
        `${where}.${field}: выгрузка из ${JSON.stringify(doc[field])} при каноническом ${want} — `
        + 'идентификаторы записей другой таблицы означают не то же самое')
    }
  }
  assertNonEmptyString(doc.note, `${where}.note`)
  assertNonEmptyString(doc.fetchedAt, `${where}.fetchedAt`)
  /* Дата — КАЛЕНДАРНАЯ, а не «строка нужного вида»: `2026-02-31` совпадает с
     шаблоном и не существует, и выгрузка, датированная несуществующим днём,
     ничего не датирует. Реализация одна на весь проект. */
  if (!isStrictCalendarDate(doc.fetchedAt)) {
    throw new TypeError(
      `${where}.fetchedAt: ожидается существующая календарная дата вида 2026-08-25, `
      + `получено ${JSON.stringify(doc.fetchedAt)}`)
  }
  assertStringList(doc.fields, `${where}.fields`)
  for (const field of doc.fields) {
    if (!PROJECTABLE.includes(field)) {
      throw new TypeError(
        `${where}.fields: поле «${field}» выгрузке неизвестно (метаданные строки полями не являются)`)
    }
  }
  const missing = REQUIRED_PROJECTION.filter((field) => !doc.fields.includes(field))
  if (missing.length) {
    throw new TypeError(
      `${where}.fields: проекция без ${missing.join(', ')} — сопоставление ими пользуется, и на такой `
      + 'выгрузке «не найдено» означало бы «мы не спрашивали», а не «в базе нет»')
  }
  if (!Array.isArray(doc.records)) throw new TypeError(`${where}.records: ожидается массив`)
  if (doc.totalRecordCount !== doc.records.length) {
    throw new TypeError(
      `${where}.totalRecordCount: объявлено ${doc.totalRecordCount} при ${doc.records.length} `
      + 'строках — выгрузка неполна, и сопоставление на ней сделало бы ложный вывод')
  }
  const allowed = new Set([...ROW_METADATA, ...doc.fields])
  const seenRecordIds = new Set()
  const seenPoiIds = new Set()
  doc.records.forEach((row, index) => {
    const at = `${where}.records[${index}]`
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError(`${at}: ожидается объект`)
    }
    for (const key of ROW_REQUIRED) assertNonEmptyString(row[key], `${at}.${key}`)
    for (const key of Object.keys(row)) {
      if (!ROW_REQUIRED.includes(key) && !ROW_OPTIONAL.includes(key)) {
        throw new TypeError(`${at}: поле «${key}» выгрузке неизвестно`)
      }
      /* Значение, которого не запрашивали, — противоречие в самой выгрузке:
         либо проекция лжёт, либо строки взяты из другого запроса. */
      if (!allowed.has(key)) {
        throw new TypeError(
          `${at}: поле «${key}» есть в строке, но в проекции его нет — выгрузка себе противоречит`)
      }
      const value = row[key]
      if (value === undefined) continue
      if (ROW_BOOLEAN.includes(key)) {
        if (typeof value !== 'boolean') throw new TypeError(`${at}.${key}: ожидается логическое значение`)
      } else if (typeof value !== 'string') {
        throw new TypeError(`${at}.${key}: ожидается строка`)
      }
      const domain = ROW_DOMAINS[key]
      if (domain && value !== '' && !domain.test(value)) {
        throw new TypeError(`${at}.${key}: ${JSON.stringify(value)} вне области значений поля`)
      }
    }
    if (seenRecordIds.has(row.recordId)) throw new TypeError(`${at}.recordId: ${row.recordId} встречается дважды`)
    if (seenPoiIds.has(row.poiId)) throw new TypeError(`${at}.poiId: ${row.poiId} встречается дважды`)
    seenRecordIds.add(row.recordId)
    seenPoiIds.add(row.poiId)
  })
  return doc
}

/**
 * Нормализация имени — ровно для СРАВНЕНИЯ, и нигде больше.
 *
 * Источник и база пишут одно и то же по-разному: «Kiyomizudera Temple» против
 * «Kiyomizu-dera». Нормализованное имя НЕ становится ключом и никуда не
 * сохраняется — иначе первая же его правка тихо переставила бы связи.
 */
export function normaliseName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(temple|shrine|museum|park|garden|castle|station)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * ИДЕНТИЧНОСТЬ СТРАНИЦЫ: РАЗБОР ЛЕКСИЧЕСКИЙ, БЕЗ ЧУЖОЙ НОРМАЛИЗАЦИИ.
 *
 * Сравнивать надо страницу, а не запись, — но «привести к одному виду» и
 * «объявить равным» разные вещи.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ `new URL`. Разбор WHATWG чинит адрес ЗА нас и делает это
 * раньше любой нашей проверки: обратные слэши он заменяет на прямые, лишние
 * слэши перед authority отбрасывает, точечные сегменты схлопывает. Аудит 25.08
 * предъявил на живой паре входов две подделки —
 * `https://www.japan-guide.com\e/e3003.html` и
 * `https:////www.japan-guide.com/e/e3003.html`, — и обе автоматически
 * связались с `e3003`, потому что к моменту проверки это были уже не они.
 * Пропускать вход через чинящий разбор и потом проверять результат — значит
 * проверять чужую догадку о том, что имел в виду источник.
 *
 * Поэтому адрес разбирается СВОИМ строгим выражением, и оно описывает ровно
 * то, что мы согласны считать адресом страницы:
 *
 *   · ровно `http://` или `https://` — и ничего другого;
 *   · непустой authority ТОЛЬКО из букв, цифр, точек и дефисов: ни `@`
 *     (учётные данные), ни `:` (порт), ни скобок IPv6;
 *   · путь — последовательность сегментов через ОДИН прямой слэш, без `?`,
 *     `#`, `%`, обратных слэшей и любых пробельных знаков.
 *
 * Приводится: схема, регистр имени хоста, точный префикс `www.` и один
 * хвостовой слэш. Сохраняется РЕГИСТР ПУТИ: в HTTP это разные ресурсы.
 * Идентичности не дают вовсе: точечные сегменты, процентное кодирование,
 * запрос, фрагмент, порт, учётные данные и хост с хвостовой точкой —
 * псевдонимы, а раскрывать псевдоним значит решать за источник, какие его
 * адреса одинаковые.
 */
const PAGE_URL = /^(?:http|https):\/\/([A-Za-z0-9.-]+)((?:\/[^\s/\\?#%]*)*)$/
const DOT_SEGMENT = /(?:^|\/)\.{1,2}(?:\/|$)/

export function pageIdentity(url) {
  /* ТОЛЬКО ПРИМИТИВНАЯ СТРОКА. `String(value).trim()` принимал объект `URL`
     (у него есть `toString`, и он же по дороге чинит написание) и строку с
     внешними пробелами — то есть публичная функция молча делала две
     нормализации, которых контракт не объявлял. Производственный путь Airtable
     таких значений не подаёт; расхождение всё равно закрыто, потому что
     объявленная строгость и есть контракт. */
  if (typeof url !== 'string') return null
  const parsed = PAGE_URL.exec(url)
  if (!parsed) return null
  const [, authority, rawPath] = parsed
  /* Хвостовая точка в имени хоста — тот же узел под другим написанием. */
  if (authority.endsWith('.') || authority.startsWith('.')) return null
  if (DOT_SEGMENT.test(rawPath)) return null
  const host = authority.toLowerCase().replace(/^www\./, '')
  if (!host) return null
  const path = rawPath.replace(/\/$/, '')
  return `${host}${path}`
}

/**
 * СВЯЗЬ ОДИН-К-ОДНОМУ: ПРОВЕРКА, А НЕ ПРИМИРЕНИЕ.
 *
 * Одну запись Airtable нельзя автоматически связать с двумя объектами обхода —
 * это ровно то, что предъявил аудит: `Source Key` на A, `Website` на B, и оба
 * «покрыты».
 *
 * Прежде здесь стоял довод, что после отравления противоречивых записей два
 * претендента НЕВОЗМОЖНЫ, а сторож — тропа для будущей правки. Довод был
 * неверен, и мутация это показала: два объекта на одной странице претендовали
 * на одну строку, не будучи противоречивыми ни в чём. Причина закрыта выше
 * поимённо; сторож остался как утверждение о результате и проверяется прямо —
 * состояние, которого не должно быть, обязано быть ГРОМКИМ, а не молча
 * улаженным выбором «первого попавшегося» претендента.
 */
export function assertOneToOneLinkage(links) {
  const claims = new Map()
  for (const row of links) {
    if (!claims.has(row.poiId)) claims.set(row.poiId, [])
    claims.get(row.poiId).push(row)
  }
  const contested = [...claims].filter(([, rows]) => rows.length > 1)
  if (contested.length) {
    const [poiId, rivals] = contested[0]
    throw new TypeError(
      `${AIRTABLE_MATCH_SPEC}: на запись ${poiId} претендует больше одного объекта обхода `
      + `(${rivals.map((row) => row.sourceKey).sort().join(', ')}) — автоматическая связь обязана `
      + 'быть один-к-одному',
    )
  }
}

/**
 * Раскладка объектов снимка по исходам.
 *
 * `exportDigest` обязателен: отчёт обязан нести отпечаток входа, иначе по нему
 * нельзя сказать, ЧТО именно сопоставляли.
 */
function matchDiscoveryToAirtable(snapshot, airtable, exportDigest) {
  assertAirtableExport(airtable)
  assertSha256Value(exportDigest, `${AIRTABLE_MATCH_SPEC}.inputs.airtable.exportDigest`)

  const rows = airtable.records
  /* Служебные строки — «Заселение в отель», «Свободное время» — объектами мира
     не являются и в сопоставлении не участвуют: попав в него, они дали бы
     ложных кандидатов по имени. */
  const live = rows.filter((row) => !row.isSystem)

  /*
   * КЛЮЧ ИНДЕКСИРУЕТСЯ ОДИН-КО-МНОГИМ.
   *
   * Раньше здесь был `Map`, и вторая строка с тем же `Source Key` МОЛЧА
   * затирала первую: побеждала последняя по порядку выгрузки. Дубль ключа —
   * это дефект базы, о котором надо сказать, а не выбрать из двух записей ту,
   * что оказалась ниже.
   */
  const byKey = new Map()
  const byPage = new Map()
  const byName = new Map()
  const push = (map, key, row) => {
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row)
  }
  for (const row of live) {
    if (row.sourceKey) push(byKey, row.sourceKey, row)
    const page = pageIdentity(row.website)
    if (page) push(byPage, page, row)
    const name = normaliseName(row.nameEn)
    if (name) push(byName, name, row)
  }

  /*
   * ── ПРОТИВОРЕЧИВАЯ ЗАПИСЬ ОТРАВЛЯЕТ ВСЕ СВОИ СВИДЕТЕЛЬСТВА ──
   *
   * Запись, у которой `Source Key` указывает на объект A, а `Website` — на
   * страницу объекта B, не «связана с A и заодно с B»: она утверждает две
   * несовместимые вещи о себе, и верить ей нельзя НИ В ЧЁМ. Первая редакция
   * этой правки снимала связь только у A — и B молча связывался с той же
   * записью по адресу. Поэтому противоречивые записи вычисляются ДО раскладки
   * и выбывают из всех указателей разом.
   */
  const pageBySourceKey = new Map(
    snapshot.records.map((record) => [record.sourceKey, pageIdentity(record.url)]))
  const recordsOnPage = new Map()
  for (const record of snapshot.records) {
    const page = pageIdentity(record.url)
    if (page) push(recordsOnPage, page, record)
  }
  const poisoned = new Map()
  const poison = (row, reason, detail, poiIds) => {
    if (!poisoned.has(row.recordId)) poisoned.set(row.recordId, { row, reason, detail, poiIds })
  }
  for (const [sourceKey, group] of byKey) {
    if (group.length > 1) {
      const poiIds = group.map((row) => row.poiId).sort()
      for (const row of group) {
        poison(row, 'duplicateSourceKey', `Source Key ${sourceKey} стоит у нескольких записей`, poiIds)
      }
      continue
    }
    const [row] = group
    const declaredPage = pageIdentity(row.website)
    const keyPage = pageBySourceKey.get(sourceKey)
    if (declaredPage && keyPage && declaredPage !== keyPage) {
      poison(row, 'sourceKeyWebsiteDisagreement',
        `Source Key указывает на ${keyPage}, а Website — на ${declaredPage}`, [row.poiId])
      continue
    }
    /*
     * ── НЕПУСТОЙ КЛЮЧ, КОТОРОГО ОБХОД НЕ ЗНАЕТ ──
     *
     * Ключ `japan-guide:e999` при `Website` страницы `e1` — это не «ключа нет,
     * возьмём адрес». Прежняя редакция смотрела только на ИЗВЕСТНЫЕ ключи, и
     * такая строка молча связывалась с `e1` по адресу: аудит 25.08 предъявил
     * ровно этот вход. Строка утверждает о себе, что она — другой объект;
     * неизвестный, исчезнувший или чужой портал ничего в этом не меняют.
     *
     * Отравляется она только тогда, когда её адрес ВООБЩЕ попадает на
     * страницу обхода: строка про Наосиму с ключом другого портала никакому
     * японгайдовскому объекту кандидатом не является, и объявлять её
     * конфликтом значило бы называть конфликтом всю остальную базу.
     */
    if (declaredPage && !keyPage && (recordsOnPage.get(declaredPage) ?? []).length) {
      poison(row, 'sourceKeyUnknownToCrawl',
        `Source Key ${sourceKey} обходу неизвестен, а Website ведёт на ${declaredPage}`, [row.poiId])
    }
  }
  const clean = (list) => list.filter((row) => !poisoned.has(row.recordId))

  /*
   * ── ПОЧЕМУ ЗДЕСЬ НЕТ РАЗБОРА «ДВА ОБЪЕКТА НА ОДНОЙ СТРАНИЦЕ» ──
   *
   * В ревизии R1 здесь стояли два правила: запись, связанная по ключу,
   * выбывала из адресного указателя, а страница с несколькими объектами
   * обхода давала неоднозначность. Оба закрывали вход, который тогда БЫЛ
   * возможен: граница принимала снимок без контракта, и фикстура с двумя
   * записями на одной странице проходила.
   *
   * После R3 граница зовёт полный `assertDiscoverySnapshot`, а он требует,
   * чтобы `sourceKey` ВЫВОДИЛСЯ из адреса записи. Значит одна страница — ровно
   * один объект: снимок с двумя записями на одном адресе отвергается либо по
   * невыводимому ключу, либо по неканоническому порядку (оба отказа
   * предъявлены). Правила стали мёртвым кодом, и мутации на них — строками,
   * которые нечем убить; поэтому они удалены, а не оставлены «на всякий
   * случай». Утверждение о результате держит `assertOneToOneLinkage` ниже: он
   * проверяется прямым вызовом.
   */
  const linkedByKey = []
  const linkedByUrl = []
  const nameCandidates = []
  const ambiguous = []
  const conflicts = []
  const unmatched = []

  for (const record of snapshot.records) {
    const page = pageIdentity(record.url)
    const keyedAll = byKey.get(record.sourceKey) ?? []
    const byUrlAll = page ? byPage.get(page) ?? [] : []
    /* Объект, чьё ЕДИНСТВЕННОЕ свидетельство исходит от отравленной записи,
       уходит в конфликт вместе с ней: молча считать его ненайденным значило бы
       спрятать дефект базы за словом «новый». */
    const tainted = [...keyedAll, ...byUrlAll].find((row) => poisoned.has(row.recordId))
    const keyed = clean(keyedAll)
    const byUrl = clean(byUrlAll)
    if (tainted && !keyed.length && !byUrl.length) {
      const { reason, detail, poiIds } = poisoned.get(tainted.recordId)
      conflicts.push({ sourceKey: record.sourceKey, reason, detail, poiIds })
      continue
    }
    if (keyed.length === 1) {
      linkedByKey.push({ sourceKey: record.sourceKey, poiId: keyed[0].poiId, recordId: keyed[0].recordId })
      continue
    }
    if (byUrl.length === 1) {
      linkedByUrl.push({
        sourceKey: record.sourceKey,
        url: record.url,
        poiId: byUrl[0].poiId,
        recordId: byUrl[0].recordId,
      })
      continue
    }
    if (byUrl.length > 1) {
      ambiguous.push({
        sourceKey: record.sourceKey,
        reason: 'severalRowsOnOnePage',
        detail: 'несколько записей ссылаются на одну страницу источника',
        poiIds: byUrl.map((row) => row.poiId).sort(),
      })
      continue
    }
    const named = clean(byName.get(normaliseName(record.nameEn)) ?? [])
    if (named.length === 1) {
      nameCandidates.push({
        sourceKey: record.sourceKey,
        nameEn: record.nameEn,
        poiId: named[0].poiId,
        recordId: named[0].recordId,
        airtableNameEn: named[0].nameEn,
      })
      continue
    }
    if (named.length > 1) {
      ambiguous.push({
        sourceKey: record.sourceKey,
        reason: 'oneNameSeveralRows',
        detail: 'одно имя нашло несколько записей',
        nameEn: record.nameEn,
        poiIds: named.map((row) => row.poiId).sort(),
      })
      continue
    }
    unmatched.push({ sourceKey: record.sourceKey, nameEn: record.nameEn, url: record.url })
  }

  assertOneToOneLinkage([...linkedByKey, ...linkedByUrl])

  /*
   * Обратная сторона: записи Airtable, помеченные этим источником, которых
   * обход больше НЕ НАШЁЛ. Названы так же осторожно, как исчезнувшие объекты в
   * мониторинге: пропажа из списка — редакционное решение сайта или ошибка
   * сопоставления, а не факт о мире.
   */
  const seen = new Set([...linkedByKey, ...linkedByUrl].map((row) => row.poiId))
  const portalRowsNotFound = live
    .filter((row) => (row.sourceKey ?? '').startsWith('japan-guide:')
      || pageIdentity(row.website)?.startsWith('japan-guide.com/'))
    .filter((row) => !seen.has(row.poiId))
    .map((row) => ({ poiId: row.poiId, nameEn: row.nameEn ?? null, website: row.website ?? null }))

  const counts = {
    discoveryRecords: snapshot.records.length,
    airtableRecords: rows.length,
    airtableSystemRows: rows.length - live.length,
    linkedByKey: linkedByKey.length,
    linkedByUrl: linkedByUrl.length,
    nameCandidates: nameCandidates.length,
    conflicts: conflicts.length,
    ambiguous: ambiguous.length,
    unmatched: unmatched.length,
    portalRowsNotFound: portalRowsNotFound.length,
  }

  return {
    contractVersion: AIRTABLE_MATCH_SPEC,
    /*
     * ОТЧЁТ ПРИВЯЗАН К ОБОИМ ВХОДАМ. Без этого один и тот же файл описывал бы
     * любую пару входов: аудит подменил шапку выгрузки, и отчёт остался
     * побайтово прежним.
     */
    inputs: {
      discovery: {
        snapshotDigest: snapshot.snapshotDigest,
        contractVersion: snapshot.contractVersion,
        records: snapshot.records.length,
      },
      airtable: {
        contractVersion: airtable.contractVersion,
        baseId: airtable.baseId,
        tableId: airtable.tableId,
        fetchedAt: airtable.fetchedAt,
        totalRecordCount: airtable.totalRecordCount,
        exportDigest,
      },
    },
    counts,
    linkedByKey,
    linkedByUrl,
    nameCandidates,
    conflicts,
    ambiguous,
    unmatched,
    portalRowsNotFoundByCrawl: portalRowsNotFound,
  }
}

/**
 * ПУБЛИЧНАЯ ПРОИЗВОДСТВЕННАЯ ГРАНИЦА: НА ВХОД — БАЙТЫ ВЫГРУЗКИ.
 *
 * Отпечаток входа отчёт носит как ДОКАЗАТЕЛЬСТВО того, что сопоставляли
 * именно эту выгрузку. Пока его подавал вызывающий, доказательством он не был:
 * аудит 25.08 передал строку «not-a-digest», и она попала в отчёт как есть.
 * Значение, которое можно объявить, ничего не удостоверяет.
 *
 * Поэтому граница принимает БАЙТЫ: сама разбирает, сама проверяет контракт
 * выгрузки и сама считает SHA-256. Чистое ядро раскладки осталось приватным —
 * входа, через который отпечаток подаётся снаружи, в модуле больше нет.
 *
 * СНИМОК ПРОВЕРЯЕТСЯ ПОЛНЫМ ПРОИЗВОДСТВЕННЫМ КОНТРАКТОМ, а не сокращённым
 * заменителем. Прежняя редакция проверяла здесь «то, чем пользуется
 * раскладка»: синтаксис отпечатка, но не его соответствие содержимому. Аудит
 * 25.08 подменил в живом снимке ключ, имя и адрес одной записи, оставив
 * прежний `snapshotDigest`, — граница приняла подделку и опубликовала старый
 * отпечаток как привязку. Публичная граница не может быть слабее скрипта,
 * который её зовёт.
 */
export function reconcileDiscoveryWithAirtable(snapshot, exportBytes) {
  assertDiscoverySnapshot(snapshot)
  if (!ArrayBuffer.isView(exportBytes)) {
    throw new TypeError(
      `${AIRTABLE_MATCH_SPEC}: ожидаются БАЙТЫ выгрузки — отпечаток считается здесь, а не подаётся`)
  }
  const bytes = Buffer.from(exportBytes.buffer, exportBytes.byteOffset, exportBytes.byteLength)
  let airtable
  try {
    airtable = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new TypeError(`${AIRTABLE_EXPORT_SPEC}: байты не разбираются как JSON — ${error.message}`)
  }
  return matchDiscoveryToAirtable(snapshot, airtable, airtableExportDigest(bytes))
}

/** Отпечаток байтов выгрузки — считается там, где байты есть. */
export function airtableExportDigest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}
