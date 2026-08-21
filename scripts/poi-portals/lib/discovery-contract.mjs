/**
 * Контракты discovery: подсказка, запись объекта, порядок направления и
 * СНИМОК ОБХОДА целиком.
 *
 * Записи этого контракта НЕ являются фактами. Japan Guide не становится
 * источником подтверждённого факта ни при каких условиях: `confidence` —
 * перечисление из одного значения `unverified`, `verified_at` — всегда null.
 *
 * ПРОВЕРКА ПОВТОРЯЕТ ПОСТРОЕНИЕ, А НЕ ДОВЕРЯЕТ ЕМУ.
 *
 * Первая версия этого файла проверяла форму и длину, а алфавит не
 * перепроверяла. Отпечаток считался поверх того, что дали, — поэтому запись
 * с кириллицей в значении и с самостоятельно собранным видом подсказки
 * проходила `assertFactLead` после пересчёта `leadDigest`. Проверка,
 * доверяющая построению, проверяет только то, что построение было.
 *
 * Теперь каждая проверка ЗАНОВО прогоняет значение через `guardValue` и
 * требует побайтового совпадения с канонической формой. Это не удвоение
 * работы: `build*` и `assert*` живут по разные стороны сериализации, и
 * между ними лежит файл на диске, который мог править кто угодно.
 *
 * ПЯТЬ ОТПЕЧАТКОВ, И У КАЖДОГО РОВНО ОДНА РОЛЬ.
 *
 *   leadDigest         содержимое подсказки без момента наблюдения
 *   recordDigest       канонические discovery-поля и omissions
 *   semanticDigest     основание мониторинга: что изменилось ПО СУЩЕСТВУ
 *   pageEvidence       свидетельство наблюдения одной страницы
 *   observationDigest  весь снимок объекта вместе со свидетельствами
 *
 * Плюс `snapshotDigest` на весь обход — он покрывает и родительские
 * страницы, которых в записях объектов нет.
 */

import {
  assertCanonicalInstant,
  assertExactKeys,
  assertInteger,
  assertNonEmptyString,
  canonicalJsonBytes,
  deepFreeze,
} from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import {
  MAX_RECOMMENDATION_LEVEL,
  TEXT_GUARD_SPEC,
  guardValue,
} from './japan-guide-text-guard.mjs'
import {
  DECODE_POLICY,
  EXPECTED_SIGNALS,
  ROBOTS_URL,
  URL_FAMILIES,
  CATALOGUE_ENTRY_URL,
  canonicalDiscoveryUrl,
  discoverySourceKey,
  sourceKeyFamily,
} from './html-fetch.mjs'

/**
 * Роль страницы — ЕДИНСТВЕННОЕ поле, и живёт оно в свидетельстве наблюдения.
 *
 * Не локальная переменная парсера и не вторая копия рядом с целью каталога:
 * роль вычислена наблюдением, значит принадлежит свидетельству этого
 * наблюдения и обязана попадать в отпечатки вместе с ним. Две независимые
 * копии разошлись бы молча.
 */
export const PAGE_ROLES = Object.freeze(['catalogue', 'collection', 'poi'])

/**
 * МАТРИЦА СОВМЕСТИМОСТИ роли и семейства адреса.
 *
 * Роль вычисляется структурой, но не любая роль возможна у любого адреса.
 * Без этой матрицы подложное свидетельство назвало бы вложенную страницу
 * коллекцией или произвольный legacy-адрес — каталогом.
 *
 *   точный вход e623a   только `catalogue`
 *   прочий legacy       `collection` либо `poi`   — измерено: e2157 и e4000
 *   legacySuffix        только `poi`              — измерено: e5025 и e3034_001…_006
 *   destinationRoot     `collection` либо `poi`   — измерено: nozawa и motonosumi
 *   destinationNested   только `poi`              — измерено: обе карточки Nozawa
 *
 * Матрица описывает ИЗМЕРЕННОЕ, а не желаемое: расширять её можно только
 * новым измерением.
 */
export const ROLES_BY_FAMILY = Object.freeze({
  catalogueEntry: Object.freeze(['catalogue']),
  legacy: Object.freeze(['collection', 'poi']),
  /* Измерено 19.08.2026 на трёх буквенных карточках `e5025` и шести
     цифровых `e3034_001…_006`: все девять — объекты. Ни коллекцией, ни
     каталогом суффиксный адрес быть не может, пока измерение не покажет
     обратного. */
  legacySuffix: Object.freeze(['poi']),
  destinationRoot: Object.freeze(['collection', 'poi']),
  destinationNested: Object.freeze(['poi']),
})

/** Семейство с точки зрения матрицы: вход отделён от прочего legacy. */
export function matrixFamily(canonicalUrl) {
  if (canonicalUrl === CATALOGUE_ENTRY_URL) return 'catalogueEntry'
  return canonicalDiscoveryUrl(canonicalUrl).family
}

/* ── Версии и закрытые перечисления ───────────────────────────────────── */

/**
 * ДВЕ ВЕРСИИ ФОРМАТА, И ОНИ НЕ СМЕШИВАЮТСЯ.
 *
 * `v1` — опубликованный формат: два вида размещения, два исхода
 * классификатора, порядок без вида коллекции. Он ЗАМОРОЖЕН и по-прежнему
 * читается: снимки, снятые до 20.08.2026, обязаны проверяться теми
 * правилами, по которым были построены.
 *
 * `v2` — текущий формат: добавлены `containerChild`,
 * `containerTopologyAmbiguous` и `orderRecord.collectionKind`.
 *
 * Прежде новые состояния были добавлены в закрытые перечисления, а версия
 * осталась `v1`, и два несовместимых формата назывались одним именем. Это
 * ошибка уровня контракта: отпечаток `v1`-записи невозможно было отличить
 * от отпечатка записи с новым видом размещения. Домены отпечатков выведены
 * ИЗ ВЕРСИИ, поэтому байты `v1` и `v2` не совпадают ни при каких данных.
 *
 * `poi-fact-lead/v1` не менялся и остаётся `v1`.
 */
export const DISCOVERY_RECORD_SPEC_V1 = 'poi-discovery-record/v1'
export const ORDER_SPEC_V1 = 'poi-discovery-order/v1'
export const SNAPSHOT_SPEC_V1 = 'poi-discovery-snapshot/v1'

export const DISCOVERY_RECORD_SPEC = 'poi-discovery-record/v2'
export const FACT_LEAD_SPEC = 'poi-fact-lead/v1'
export const ORDER_SPEC = 'poi-discovery-order/v2'
export const SNAPSHOT_SPEC = 'poi-discovery-snapshot/v2'

/*
 * Списки читаемых версий ВЫВЕДЕНЫ из `VERSION_POLICY` и объявлены рядом с
 * ней — ниже по файлу. Здесь они стояли набранными вручную и были четвёртым
 * реестром версий: строка, добавленная в политику, в них не попадала, и
 * наоборот.
 */

const recordDomains = (spec) => ({
  record: `${spec}#record`,
  semantic: `${spec}#semantic`,
  observation: `${spec}#observation`,
})
const RECORD_DIGEST_DOMAIN = recordDomains(DISCOVERY_RECORD_SPEC).record
const SEMANTIC_DIGEST_DOMAIN = recordDomains(DISCOVERY_RECORD_SPEC).semantic
const OBSERVATION_DIGEST_DOMAIN = recordDomains(DISCOVERY_RECORD_SPEC).observation
const SNAPSHOT_DIGEST_DOMAIN = `${SNAPSHOT_SPEC}#snapshot`

/**
 * ДОПУСТИМЫЕ СОСТОЯНИЯ v1 — ровно те пять видов, которые этот этап
 * действительно производит.
 *
 * Раньше список был из восьми: пять производимых плюс три объявленных «на
 * будущее». Восемь в перечислении означало восемь принимаемых состояний, и
 * `category_hint`, запрещённый в построении, спокойно проходил проверку
 * сериализованной записи. Перечисление допустимых состояний и список
 * планов — разные вещи, и держать их одним массивом нельзя.
 */
export const LEAD_KINDS = Object.freeze([
  'name_en',
  'hours_hint',
  'closed_hint',
  'admission_hint',
  'official_url_hint',
])

/**
 * Зарезервировано для будущих контрактов. НЕ является допустимым состоянием
 * v1 и проверкой отвергается поимённо — с объяснением, а не с общим «чужой
 * вид».
 *
 * `name_ja` и `name_kana`: японская форма имени встречается только внутри
 * прозы, а в байтах записана в Shift_JIS и при принятой политике
 * декодирования превращается в U+FFFD. Кандзи в декодированном тексте трёх
 * измеренных страниц — ноль.
 *
 * `category_hint`: категория принадлежит СВЯЗИ объекта с направлением и
 * живёт в `placements`. Один объект из трёх направлений дал бы три
 * одинаковые подсказки без указания, к какому направлению какая относится, —
 * то есть второй источник правды для одного значения.
 */
export const RESERVED_LEAD_KINDS = Object.freeze(['name_ja', 'name_kana', 'category_hint'])

/** Локаторы, из которых подсказка МОЖЕТ быть порождена. */
export const LEAD_SOURCE_LOCATORS = Object.freeze([
  'h1',
  'hours_fees_block',
  'links_and_resources_official',
])

/**
 * Локаторы, о потере в которых можно записать omission.
 *
 * Шире списка локаторов подсказок ровно на `top_attractions_card`: категория
 * подсказкой не становится, но её потеря обязана быть записана. Отдельное
 * перечисление, а не общее: иначе `top_attractions_card` снова стал бы
 * допустимым источником подсказки.
 */
export const OMISSION_LOCATORS = Object.freeze([...LEAD_SOURCE_LOCATORS, 'top_attractions_card'])

export const LEAD_CONFIDENCE = 'unverified'

export const OMISSION_CODES = Object.freeze([
  'leadValueTooLong',
  'componentNameTooLong',
  'categoryHintTooLong',
  'nonWhitelistedCodepoint',
  'ambiguousValueBoundary',
  /*
   * Метка поля вне закрытой таблицы `LABEL_TO_KIND`.
   *
   * ИЗМЕРЕНО 18.08: счётчик `unknownAdmissionLabels` показал 1 на 42 записи —
   * и не сказал, у какой. Счётчик прогона суммирует, запись прикрепляет:
   * без omission источник неизвестной метки в снимке отсутствует, и найти
   * его можно только повторным обходом. Проверено по артефакту canary:
   * все 47 блоков отдали ровно три подсказки, то есть асимметрии, по
   * которой запись можно было бы вычислить, в снимке нет.
   *
   * Текст метки не сохраняется: `originalLengthBytes` — длина в байтах.
   * Она достаточна, чтобы догадку о конкретной метке ОПРОВЕРГНУТЬ, и
   * недостаточна, чтобы принять её за факт.
   */
  'unknownAdmissionLabel',
])

/** Причины, по которым снимок не является полным. */
export const INCOMPLETE_REASONS = Object.freeze([
  'budgetInsufficient',
  'cardRejected',
  'targetFetchFailed',
  'targetStructureMismatch',
  'limitApplied',
  'poiFetchFailed',
  'poiStructureMismatch',
  'unsupportedCatalogueLinkShape',
])

/**
 * Исходы классификатора ролей — раздельными кодами, а не одним общим.
 *
 * ИЗМЕРЕНО 18.08: canary отверг 166 целей из 208, и все 166 легли в снимок
 * одним кодом `structureMismatch`. Этот код объединяет разные вещи: страница
 * прошла обе грамматики сразу; страница не прошла ни одной; разбор уже
 * опознанной роли упёрся в сломанную разметку. По снимку они неразличимы —
 * поэтому 166 отказов не сказали ни слова о том, что чинить, и стоили
 * отдельного обхода двух страниц, чтобы это узнать.
 *
 * Перечисление ОДНО и служит сразу трём потребителям: списку кодов отказа,
 * классу ошибки классификатора и выводу причин неполноты. Второго списка
 * тех же кодов нет: разойдясь, они дали бы отказ, законный для
 * классификатора и невозможный для снимка.
 */
/*
 * ОТДЕЛЬНЫХ ИСХОДОВ КЛАССИФИКАТОРА У v1 НЕ БЫЛО ВОВСЕ.
 *
 * Здесь стоял `PAGE_ROLE_CODES_V1 = ['pageRoleAmbiguous', 'pageRoleUnknown']`
 * — придуманный мной список, объявлявший `v1` знающим два из трёх новых
 * кодов. Опубликованный `bd8ebe6` не знал ни одного: страница с неопознанной
 * ролью давала общий `structureMismatch`. Списка нет и быть не может;
 * знание `v1` о кодах отказа целиком лежит в `VERSION_POLICY`.
 */
export const PAGE_ROLE_CODES = Object.freeze([
  'pageRoleAmbiguous',
  /*
   * ТОПОЛОГИЯ ПОХОЖА НА КОНТЕЙНЕР, НО ПРОТИВОРЕЧИВА.
   *
   * Страница `/e/eNNNN.html` ссылается на `/e/eNNNN_<цифры>.html` со своим
   * же базовым номером, но разрядность суффикса не та, которую знает
   * грамматика. Тихо объявить такую страницу объектом значило бы потерять её
   * детей молча — ровно та потеря, из-за которой 18.08 исчезли 145
   * коллекций. Отказ закрыт, диагностируем и попадает в снимок как
   * `targetStructureMismatch`, наравне с прочими исходами классификатора.
   */
  'containerTopologyAmbiguous',
  'pageRoleUnknown',
])

/**
 * Коды отказа СТРАНИЦЫ — сетевые, гейта кодировки и структурные.
 *
 * Закрытый список, а не «любая строка». Отказ с выдуманным кодом невозможно
 * ни посчитать, ни сопоставить с причиной неполноты: снимок с
 * `rejected.targets: [{ code: 'что-то пошло не так' }]` выглядел бы
 * законным и не сходился бы ни с чем.
 */
export const PAGE_REJECTION_CODES = Object.freeze([
  ...PAGE_ROLE_CODES,
  'bodyMissing',
  'bodyReadFailed',
  'contentTypeDenied',
  'contentTypeMissing',
  'hostDenied',
  'httpCharsetChanged',
  'metaChannelChanged',
  'metaCharsetChanged',
  'metaCharsetCountChanged',
  'networkBudgetExhausted',
  'pathDenied',
  'redirectLimit',
  'redirectWithoutLocation',
  'replacementCountMismatch',
  'responseTooLarge',
  'schemeDenied',
  'statusDenied',
  'structureMismatch',
  'unsupportedCatalogueLinkShape',
  'urlNotCanonical',
  'urlRepeated',
  'urlUnparsable',
])

/**
 * ЕДИНАЯ ПОЛИТИКА ВЕРСИИ. Один реестр, из которого читают ВСЕ проверки.
 *
 * Списки `v1` не переписаны от руки и не «выведены вычитанием» — они сняты
 * с ОПУБЛИКОВАННОГО коммита `bd8ebe6` командой `git archive` и совпадают с
 * ним посимвольно. Прошлая версия этого места содержала рукописный список,
 * куда я по ошибке внёс `pageRoleAmbiguous` и `pageRoleUnknown`, которых в
 * `bd8ebe6` не было вовсе: там был один общий `structureMismatch`.
 *
 * Политика покрывает ВСЁ, что закрыто перечислением: виды размещения, коды
 * отказа страницы и карточки, коды omission, семейства адресов. Разойдись
 * хоть один список — «заморожен» снова стало бы словом.
 */
const V1_PAGE_REJECTION_CODES = Object.freeze([
  'bodyMissing', 'bodyReadFailed', 'contentTypeDenied', 'contentTypeMissing', 'hostDenied',
  'httpCharsetChanged', 'metaChannelChanged', 'metaCharsetChanged', 'metaCharsetCountChanged',
  'networkBudgetExhausted', 'pathDenied', 'redirectLimit', 'redirectWithoutLocation',
  'replacementCountMismatch', 'responseTooLarge', 'schemeDenied', 'statusDenied',
  'structureMismatch', 'unsupportedCatalogueLinkShape', 'urlNotCanonical', 'urlRepeated',
  'urlUnparsable',
])
const V1_OMISSION_CODES = Object.freeze([
  'leadValueTooLong', 'componentNameTooLong', 'categoryHintTooLong',
  'nonWhitelistedCodepoint', 'ambiguousValueBoundary',
])
const V1_URL_FAMILIES = Object.freeze(['legacy', 'destinationRoot', 'destinationNested'])

/** Коды отказа КАРТОЧКИ внутри направления. */
export const CARD_REJECTION_CODES = Object.freeze([
  'cardWithoutName',
  'duplicateWithinDestination',
  'hostDenied',
  'invalidMarker',
  'markerWithoutSpan',
  'multipleMarkerSpans',
  'pathDenied',
  'rankElementDuplicated',
  'rankElementMissing',
  'rankEmpty',
  'rankNotPositiveInteger',
  'rankRepeated',
  'schemeDenied',
  'urlNotCanonical',
  'urlUnparsable',
])

/**
 * Отказы по структуре — отдельно от сетевых: у них разные причины неполноты.
 *
 * МНОЖЕСТВО, а не одна строка. Раздельные коды ролей обязаны и дальше
 * сходиться с `targetStructureMismatch`: иначе разделение кодов молча
 * перевело бы 166 структурных отказов в сетевые и снимок стал бы утверждать,
 * что страницы не удалось получить.
 */
const STRUCTURE_CODES = Object.freeze(new Set(['structureMismatch', ...PAGE_ROLE_CODES]))
const UNSUPPORTED_SHAPE_CODE = 'unsupportedCatalogueLinkShape'

export const SNAPSHOT_SCOPES = Object.freeze(['full', 'limited'])

export const BYTE_LIMITS = Object.freeze({
  componentName: 120,
  categoryHint: 120,
  nameEn: 512,
  leadValue: 512,
})

const SHA256_HEX = /^sha256:[0-9a-f]{64}$/

/* ── Служебное ────────────────────────────────────────────────────────── */

/** Побайтовое сравнение UTF-8, а НЕ `localeCompare`: локаль машинно-зависима. */
export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

const sha256Of = (value, domain) => sha256Bytes(canonicalJsonBytes(value, domain))

function assertEnum(value, allowed, where) {
  if (!allowed.includes(value)) {
    throw new TypeError(`${where}: ожидается одно из [${allowed.join(', ')}], получено ${JSON.stringify(value)}`)
  }
}

function assertSha256(value, where) {
  assertNonEmptyString(value, where)
  if (!SHA256_HEX.test(value)) {
    throw new TypeError(`${where}: не отпечаток SHA-256, получено ${JSON.stringify(value)}`)
  }
}

/**
 * Канонический адрес любого из трёх измеренных семейств.
 *
 * Ни одно семейство не объявляется «формой POI»: адрес роли не несёт.
 * Разделяет роли не адрес, а `pageEvidence.pageRole`.
 */
function assertCanonicalUrl(value, where) {
  assertNonEmptyString(value, where)
  let canonical
  try {
    canonical = canonicalDiscoveryUrl(value).url
  } catch (error) {
    throw new TypeError(`${where}: не каноничный адрес страницы (${error.code}): ${JSON.stringify(value)}`)
  }
  if (canonical !== value) {
    throw new TypeError(`${where}: адрес не в канонической форме, ожидалось ${canonical}`)
  }
  return canonical
}

/**
 * Заново прогоняет значение через алфавит и предел и требует побайтового
 * совпадения.
 *
 * Совпадение проверяется по байтам, а не по `===`: строки, различающиеся
 * только формой нормализации Unicode, сравнялись бы как разные, но сообщение
 * об этом было бы непонятным. Байтовое сравнение называет ровно то, что
 * произошло.
 */
function assertGuardedValue(value, { locator, limitBytes, where }) {
  assertNonEmptyString(value, where)
  let canonical
  try {
    canonical = guardValue(value, { locator, limitBytes })
  } catch (error) {
    throw new TypeError(`${where}: значение не проходит ${TEXT_GUARD_SPEC} (${error.code}): ${error.message}`)
  }
  if (Buffer.compare(Buffer.from(canonical, 'utf8'), Buffer.from(value, 'utf8')) !== 0) {
    throw new TypeError(`${where}: значение не в канонической форме — нормализация его меняет`)
  }
  return canonical
}

const sortedBy = (list, key) => [...list].sort((a, b) => compareUtf8(key(a), key(b)))

/**
 * Сортировка по НЕСКОЛЬКИМ полям — явным сравнением, а не склейкой в строку.
 *
 * Здесь стояла склейка через управляющие символы-разделители (U+0000 и
 * U+001F). Разделитель был нужен, чтобы «ab» + «c» не совпало с «a» + «bc»,
 * но записанный в исходник буквально он делал .mjs бинарным файлом: `rg`
 * переставал показывать совпадения в модуле контракта. Явное сравнение полей
 * решает ту же задачу и читается без догадок.
 */
const sortedWith = (list, compare) => [...list].sort(compare)

/**
 * Два свидетельства описывают ОДИН И ТОТ ЖЕ обмен — побайтово.
 *
 * Сравнение полное, а не по одному отпечатку: совпадение `rawPageDigest` при
 * разном `pageBytes` или разной диагностике кодировки означало бы, что одно
 * из двух свидетельств собрано не из этого ответа.
 */
function assertSameObservation(left, right, where, what) {
  const a = canonicalJsonBytes(left, `${DISCOVERY_RECORD_SPEC}#evidence`)
  const b = canonicalJsonBytes(right, `${DISCOVERY_RECORD_SPEC}#evidence`)
  if (!a.equals(b)) {
    throw new TypeError(
      `${where}: ${what} описывают разные наблюдения — `
      + `${left.rawPageDigest} (${left.pageBytes} б, ${left.observedAt}) и `
      + `${right.rawPageDigest} (${right.pageBytes} б, ${right.observedAt})`,
    )
  }
}

function assertCanonicalOrder(list, sorted, where) {
  if (JSON.stringify(list) !== JSON.stringify(sorted)) {
    throw new TypeError(`${where}: порядок не канонический`)
  }
}

/* ── applies_to ───────────────────────────────────────────────────────── */

const APPLIES_TO_KEYS = Object.freeze(['kind', 'name'])

export function buildAppliesTo(name) {
  if (name === null) return null
  const value = guardValue(name, { locator: 'hours_fees_block', limitBytes: BYTE_LIMITS.componentName })
  return deepFreeze({ kind: 'component', name: value })
}

function assertAppliesTo(appliesTo, where) {
  if (appliesTo === null) return
  assertExactKeys(appliesTo, APPLIES_TO_KEYS, where)
  if (appliesTo.kind !== 'component') {
    throw new TypeError(`${where}: единственный вид привязки — «component», получено ${JSON.stringify(appliesTo.kind)}`)
  }
  assertGuardedValue(appliesTo.name, {
    locator: 'hours_fees_block',
    limitBytes: BYTE_LIMITS.componentName,
    where: `${where}.name`,
  })
}

/* ── poi-fact-lead/v1 ─────────────────────────────────────────────────── */

const LEAD_KEYS = Object.freeze([
  'contractVersion',
  'kind',
  'appliesTo',
  'value',
  'source',
  'verifiedAt',
  'confidence',
  'observedAt',
  'sourceLocator',
  'leadDigest',
])

function leadCovered(lead) {
  return {
    contractVersion: FACT_LEAD_SPEC,
    kind: lead.kind,
    appliesTo: lead.appliesTo,
    value: lead.value,
    source: lead.source,
    sourceLocator: lead.sourceLocator,
    confidence: lead.confidence,
    verifiedAt: lead.verifiedAt,
  }
}

/**
 * Единственный путь к подсказке.
 *
 * `official_url_hint` — единственный вид, значение которого не является
 * текстом страницы: это внешний адрес. Он проходит тот же алфавит (адреса
 * ASCII), но каноничным адресом japan-guide не является и таковым не
 * проверяется.
 */
export function buildFactLead({ kind, appliesTo = null, value, source, sourceLocator, observedAt }) {
  assertEnum(kind, LEAD_KINDS, `${FACT_LEAD_SPEC}.kind`)
  assertEnum(sourceLocator, LEAD_SOURCE_LOCATORS, `${FACT_LEAD_SPEC}.source_locator`)
  assertCanonicalUrl(source, `${FACT_LEAD_SPEC}.source`)
  assertCanonicalInstant(observedAt, `${FACT_LEAD_SPEC}.observed_at`)
  assertAppliesTo(appliesTo, `${FACT_LEAD_SPEC}.applies_to`)

  const guarded = guardValue(value, { locator: sourceLocator, limitBytes: BYTE_LIMITS.leadValue })
  const draft = {
    contractVersion: FACT_LEAD_SPEC,
    kind,
    appliesTo,
    value: guarded,
    source,
    verifiedAt: null,
    confidence: LEAD_CONFIDENCE,
    observedAt,
    sourceLocator,
  }
  return deepFreeze({ ...draft, leadDigest: sha256Of(leadCovered(draft), FACT_LEAD_SPEC) })
}

export function assertFactLead(lead, { expectedSource = null } = {}) {
  assertExactKeys(lead, LEAD_KEYS, FACT_LEAD_SPEC)
  if (lead.contractVersion !== FACT_LEAD_SPEC) {
    throw new TypeError(`${FACT_LEAD_SPEC}: чужая версия контракта ${JSON.stringify(lead.contractVersion)}`)
  }
  if (RESERVED_LEAD_KINDS.includes(lead.kind)) {
    /* Отдельный код, а не общий «чужой вид». Без него эту ветку прикрывала бы
       проверка перечисления двумя строками ниже, и снятие любой из двух не
       меняло бы поведения — то есть ни одна из них не проверялась бы. */
    const error = new TypeError(
      `${FACT_LEAD_SPEC}.kind: «${lead.kind}» зарезервирован для будущих контрактов и допустимым `
      + 'состоянием v1 не является',
    )
    error.code = 'reservedLeadKind'
    throw error
  }
  assertEnum(lead.kind, LEAD_KINDS, `${FACT_LEAD_SPEC}.kind`)
  assertEnum(lead.sourceLocator, LEAD_SOURCE_LOCATORS, `${FACT_LEAD_SPEC}.source_locator`)
  if (lead.confidence !== LEAD_CONFIDENCE) {
    throw new TypeError(`${FACT_LEAD_SPEC}.confidence: единственное значение — «${LEAD_CONFIDENCE}»`)
  }
  if (lead.verifiedAt !== null) {
    throw new TypeError(`${FACT_LEAD_SPEC}.verified_at: обязан быть null — этот источник факты не подтверждает`)
  }
  assertAppliesTo(lead.appliesTo, `${FACT_LEAD_SPEC}.applies_to`)
  assertGuardedValue(lead.value, {
    locator: lead.sourceLocator,
    limitBytes: BYTE_LIMITS.leadValue,
    where: `${FACT_LEAD_SPEC}.value`,
  })
  assertCanonicalUrl(lead.source, `${FACT_LEAD_SPEC}.source`)
  if (expectedSource !== null && lead.source !== expectedSource) {
    throw new TypeError(
      `${FACT_LEAD_SPEC}.source: подсказка ссылается на ${lead.source}, а лежит в записи ${expectedSource}`,
    )
  }
  assertCanonicalInstant(lead.observedAt, `${FACT_LEAD_SPEC}.observed_at`)
  if (lead.leadDigest !== sha256Of(leadCovered(lead), FACT_LEAD_SPEC)) {
    throw new TypeError(`${FACT_LEAD_SPEC}.lead_digest: не сходится с содержимым подсказки`)
  }
}

export function sortFactLeads(leads) {
  return [...leads].sort((a, b) =>
    compareUtf8(a.kind, b.kind)
    || compareUtf8(a.appliesTo?.name ?? '', b.appliesTo?.name ?? '')
    || compareUtf8(a.value, b.value))
}

/* ── placements ───────────────────────────────────────────────────────── */

/**
 * ТРИ РАЗНЫХ способа найти объект, и их нельзя описывать одной формой.
 *
 *   destinationRanking  объект стоит карточкой в списке направления —
 *                       у него есть позиция, уровень рекомендации и категория;
 *   catalogueDirect     объект указан прямо в каталоге — позиции в списке
 *                       направления у него НЕТ ВООБЩЕ;
 *   containerChild      объект найден ТОПОЛОГИЕЙ: зонтичная страница
 *                       `/e/eNNNN.html` ссылается на своих детей
 *                       `/e/eNNNN_ddd.html`. Ранга сайт при этом не
 *                       показывает — ни числа, ни маркера.
 *
 * Ранг и уровень для прямого объекта и для ребёнка контейнера пришлось бы
 * ВЫДУМАТЬ. Выдуманное «1» невозможно отличить от измеренного «1», поэтому
 * у обоих три `null`, а не значения по умолчанию: отсутствие обязано
 * читаться как отсутствие. Общий порядок детей хранит `orderRecord`.
 *
 * `containerChild` НЕ сводится к `destinationRanking`: у второго позиция
 * измерена и участвует в мониторинге как факт страницы. Слив их в один вид
 * означал бы, что снимок утверждает измерение, которого не было.
 */
export const PLACEMENT_KINDS_V1 = Object.freeze(['catalogueDirect', 'destinationRanking'])
export const PLACEMENT_KINDS = Object.freeze([
  'catalogueDirect', 'containerChild', 'destinationRanking',
])

/**
 * НАБОР ПОЛЕЙ ПОРЯДКА — тоже часть версии.
 *
 * Объявлен здесь, а не рядом с самим порядком, потому что входит в
 * `VERSION_POLICY`: реестр обязан собираться из уже объявленных величин, а
 * не догонять их позже отдельной таблицей.
 */
const ORDER_KEYS_V1 = Object.freeze(['destinationSourceKey', 'sourcePageDigest', 'order', 'orderDigest'])
const ORDER_KEYS = Object.freeze([
  'destinationSourceKey', 'sourcePageDigest', 'collectionKind', 'order', 'orderDigest',
])

/**
 * Виды БЕЗ ранжирования: три поля обязаны быть `null`.
 *
 * Список один и служит и проверке, и строителю. Две копии разошлись бы
 * молча, и вид, добавленный только в одну, получил бы выдуманный ранг.
 */
const UNRANKED_PLACEMENT_KINDS = Object.freeze(new Set(['catalogueDirect', 'containerChild']))

/**
 * `listPosition` — ПОКАЗАННЫЙ САЙТОМ РАНГ ВНУТРИ ВИЗУАЛЬНОЙ ГРУППЫ, а не
 * место объекта в направлении целиком.
 *
 * ИЗМЕРЕНО 19.08.2026 на `e2158`: список поделён на озаглавленные группы, и
 * нумерация в каждой начинается заново с единицы. Значит два объекта одного
 * направления законно несут `listPosition: 1`, и требовать уникальности по
 * направлению нельзя — это отвергало бы целые группы карточек.
 *
 * Общий порядок направления задаёт НЕ это поле, а `orderRecord`: он один на
 * направление, привязан к байтам страницы и перечисляет ключи стабильным
 * обходом групп и карточек по DOM. Перестановку сообщает `orderDigest`.
 */
const PLACEMENT_KEYS = Object.freeze([
  'kind',
  'collectionSourceKey',
  'listPosition',
  'editorialLevel',
  'categoryHint',
])

/**
 * Ключ точки входа. ВЫВОДИТСЯ из адреса тем же строителем, что и остальные,
 * а не пишется литералом: литерал разошёлся бы с грамматикой ключей молча.
 */
export const CATALOGUE_SOURCE_KEY = discoverySourceKey(CATALOGUE_ENTRY_URL)

/**
 * ПОЛИТИКА ВЕРСИИ ЦЕЛИКОМ — по одной записи на формат.
 *
 * Всё, что закрыто перечислением, лежит здесь и только здесь. Проверки
 * берут набор ПО ВЕРСИИ снимка, а не по «текущему» списку: именно так
 * `v1` перестаёт принимать состояния, которых он не знал.
 */
export const VERSION_POLICY = Object.freeze({
  [SNAPSHOT_SPEC_V1]: Object.freeze({
    snapshot: SNAPSHOT_SPEC_V1,
    record: DISCOVERY_RECORD_SPEC_V1,
    order: ORDER_SPEC_V1,
    orderKeys: ORDER_KEYS_V1,
    placementKinds: PLACEMENT_KINDS_V1,
    pageRejectionCodes: V1_PAGE_REJECTION_CODES,
    cardRejectionCodes: CARD_REJECTION_CODES,
    omissionCodes: V1_OMISSION_CODES,
    urlFamilies: V1_URL_FAMILIES,
    collectionKind: false,
  }),
  [SNAPSHOT_SPEC]: Object.freeze({
    snapshot: SNAPSHOT_SPEC,
    record: DISCOVERY_RECORD_SPEC,
    order: ORDER_SPEC,
    orderKeys: ORDER_KEYS,
    placementKinds: PLACEMENT_KINDS,
    pageRejectionCodes: PAGE_REJECTION_CODES,
    cardRejectionCodes: CARD_REJECTION_CODES,
    omissionCodes: OMISSION_CODES,
    urlFamilies: URL_FAMILIES,
    collectionKind: true,
  }),
})

/**
 * Те же записи, другие ключи входа.
 *
 * Проверки приходят к политике с версией записи или с версией порядка —
 * оба указателя ВЫВЕДЕНЫ из `VERSION_POLICY`, а не набраны рядом. Отдельная
 * таблица «вид размещения по версии» когда-то стояла здесь и могла разойтись
 * с политикой молча: добавленный в неё вид не попадал в политику, и запись
 * проходила проверку вида, но не проверку формата.
 */
const POLICY_BY_RECORD_SPEC = Object.freeze(Object.fromEntries(
  Object.values(VERSION_POLICY).map((policy) => [policy.record, policy])))
const POLICY_BY_ORDER_SPEC = Object.freeze(Object.fromEntries(
  Object.values(VERSION_POLICY).map((policy) => [policy.order, policy])))

/**
 * Версии, которые контракт умеет ЧИТАТЬ. Строит он только текущую.
 *
 * ВЫВЕДЕНЫ, А НЕ НАБРАНЫ. Ручной список читаемых версий был четвёртым
 * реестром рядом с политикой: формат, вписанный в него, но не в
 * `VERSION_POLICY`, проходил бы проверку версии и падал на поиске правил, а
 * формат, вписанный только в политику, объявлялся бы чужим.
 */
export const READABLE_SNAPSHOT_SPECS = Object.freeze(
  Object.values(VERSION_POLICY).map((policy) => policy.snapshot))
export const READABLE_RECORD_SPECS = Object.freeze(Object.keys(POLICY_BY_RECORD_SPEC))
export const READABLE_ORDER_SPECS = Object.freeze(Object.keys(POLICY_BY_ORDER_SPEC))


/** Поля ранжирования: у `destinationRanking` заполнены, у `catalogueDirect` — `null`. */
const RANKING_FIELDS = Object.freeze(['listPosition', 'editorialLevel', 'categoryHint'])

function assertPlacementShape(placement, where, spec = DISCOVERY_RECORD_SPEC) {
  const policy = POLICY_BY_RECORD_SPEC[spec]
  if (!policy) throw new TypeError(`${where}: неизвестная версия формата ${JSON.stringify(spec)}`)
  assertEnum(placement.kind, policy.placementKinds, `${where}.kind`)
  assertNonEmptyString(placement.collectionSourceKey, `${where}.collectionSourceKey`)

  /*
   * Вид и ключ обязаны согласоваться В ОБЕ СТОРОНЫ. Иначе «прямой из
   * каталога» смог бы ссылаться на направление, а ранжирование — на каталог,
   * и связка с `catalogueEvidence` перестала бы что-либо значить.
   */
  const isCatalogueKey = placement.collectionSourceKey === CATALOGUE_SOURCE_KEY
  if (placement.kind === 'catalogueDirect' && !isCatalogueKey) {
    throw new TypeError(
      `${where}: «catalogueDirect» обязан ссылаться на каталог ${CATALOGUE_SOURCE_KEY}, `
      + `указано ${placement.collectionSourceKey}`,
    )
  }
  if (placement.kind === 'destinationRanking' && isCatalogueKey) {
    throw new TypeError(
      `${where}: «destinationRanking» не может ссылаться на сам каталог — `
      + 'каталог даёт цели обхода, а не ранжированные карточки объектов',
    )
  }
  /* Ребёнок контейнера ссылается на СВОЮ зонтичную страницу, не на каталог. */
  if (placement.kind === 'containerChild' && isCatalogueKey) {
    throw new TypeError(
      `${where}: «containerChild» ссылается на зонтичную страницу, а не на каталог`,
    )
  }

  if (UNRANKED_PLACEMENT_KINDS.has(placement.kind)) {
    for (const field of RANKING_FIELDS) {
      if (placement[field] !== null) {
        throw new TypeError(
          `${where}.${field}: у «${placement.kind}» обязан быть null — `
          + `ранга сайт не показывает, указано ${JSON.stringify(placement[field])}`,
        )
      }
    }
    return
  }

  assertInteger(placement.listPosition, `${where}.listPosition`, 1)
  assertInteger(placement.editorialLevel, `${where}.editorialLevel`, 0)
  if (placement.editorialLevel > MAX_RECOMMENDATION_LEVEL) {
    throw new TypeError(`${where}.editorialLevel: вне 0..${MAX_RECOMMENDATION_LEVEL}`)
  }
  if (placement.categoryHint !== null) {
    assertGuardedValue(placement.categoryHint, {
      locator: 'top_attractions_card',
      limitBytes: BYTE_LIMITS.categoryHint,
      where: `${where}.categoryHint`,
    })
  }
}

export function buildPlacement({ kind, collectionSourceKey, listPosition, editorialLevel, categoryHint }) {
  const placement = UNRANKED_PLACEMENT_KINDS.has(kind)
    ? { kind, collectionSourceKey, listPosition: null, editorialLevel: null, categoryHint: null }
    : {
      kind,
      collectionSourceKey,
      listPosition,
      editorialLevel,
      categoryHint: categoryHint === null
        ? null
        : guardValue(categoryHint, { locator: 'top_attractions_card', limitBytes: BYTE_LIMITS.categoryHint }),
    }
  /*
   * Для `catalogueDirect` три поля ЗАТИРАЮТСЯ в null, а не берутся из
   * аргументов — но переданные значения при этом обязаны отсутствовать,
   * иначе строитель молча проглотил бы выдуманный ранг.
   */
  if (UNRANKED_PLACEMENT_KINDS.has(kind)) {
    for (const [field, value] of [
      ['listPosition', listPosition],
      ['editorialLevel', editorialLevel],
      ['categoryHint', categoryHint],
    ]) {
      if (value !== null && value !== undefined) {
        throw new TypeError(
          `placement.${field}: «catalogueDirect» ранжирования не имеет, передано ${JSON.stringify(value)}`,
        )
      }
    }
  }
  assertPlacementShape(placement, 'placement')
  return deepFreeze(placement)
}

function assertPlacement(placement, where, spec = DISCOVERY_RECORD_SPEC) {
  assertExactKeys(placement, PLACEMENT_KEYS, where)
  assertPlacementShape(placement, where, spec)
}

export function sortPlacements(placements) {
  return sortedWith(placements, (a, b) =>
    compareUtf8(a.collectionSourceKey, b.collectionSourceKey)
    || compareUtf8(a.kind, b.kind))
}

/** Коллекции, из которых объект найден. ВЫЧИСЛЯЕТСЯ, а не хранится. */
export function discoveredFrom(placements) {
  return [...new Set(placements.map((p) => p.collectionSourceKey))].sort(compareUtf8)
}

/* ── omissions ────────────────────────────────────────────────────────── */

const OMISSION_KEYS = Object.freeze(['code', 'locator', 'originalLengthBytes'])

export function buildOmission({ code, locator, originalLengthBytes }) {
  assertEnum(code, OMISSION_CODES, 'omission.code')
  assertEnum(locator, OMISSION_LOCATORS, 'omission.locator')
  assertInteger(originalLengthBytes, 'omission.originalLengthBytes', 0)
  return deepFreeze({ code, locator, originalLengthBytes })
}

function assertOmission(omission, where, codes = OMISSION_CODES) {
  assertExactKeys(omission, OMISSION_KEYS, where)
  assertEnum(omission.code, codes, `${where}.code`)
  assertEnum(omission.locator, OMISSION_LOCATORS, `${where}.locator`)
  assertInteger(omission.originalLengthBytes, `${where}.originalLengthBytes`, 0)
}

export function sortOmissions(omissions) {
  return [...omissions].sort((a, b) =>
    compareUtf8(a.code, b.code)
    || compareUtf8(a.locator, b.locator)
    || a.originalLengthBytes - b.originalLengthBytes)
}

/* ── pageEvidence ─────────────────────────────────────────────────────── */

const EVIDENCE_KEYS = Object.freeze(['url', 'pageRole', 'pageBytes', 'rawPageDigest', 'observedAt', 'encodingDiagnostics'])
const DIAGNOSTICS_KEYS = Object.freeze([
  'httpCharset',
  'metaCharset',
  'decodePolicy',
  'textGuardSpec',
  'decodeErrorCount',
  'decodeReplacements',
  'nonWhitelistedCodepoints',
])

export function buildPageEvidence({
  url,
  pageRole,
  pageBytes,
  rawPageDigest,
  observedAt,
  httpCharset,
  metaCharset,
  decodePolicy,
  decodeErrorCount,
  decodeReplacements,
  nonWhitelistedCodepoints,
}) {
  const evidence = {
    url,
    pageRole,
    pageBytes,
    rawPageDigest,
    observedAt,
    encodingDiagnostics: {
      httpCharset,
      metaCharset,
      decodePolicy,
      textGuardSpec: TEXT_GUARD_SPEC,
      decodeErrorCount,
      decodeReplacements,
      nonWhitelistedCodepoints,
    },
  }
  assertPageEvidence(evidence, 'pageEvidence')
  return deepFreeze(evidence)
}

/**
 * Свидетельство наблюдения проверяется целиком, включая СИГНАЛЫ КОДИРОВКИ.
 *
 * Раньше проверялся только состав ключей — поэтому свидетельство с
 * `httpCharset: 'koi8-r'` и `decodePolicy: 'что угодно'` считалось
 * законным. Сигналы обязаны совпадать с наблюдёнными: снимок, у которого они
 * другие, описывает не тот источник, о котором мы договаривались.
 */
export function assertPageEvidence(evidence, where = 'pageEvidence', { expectedRole = null } = {}) {
  assertExactKeys(evidence, EVIDENCE_KEYS, where)
  assertCanonicalUrl(evidence.url, `${where}.url`)
  assertEnum(evidence.pageRole, PAGE_ROLES, `${where}.pageRole`)
  /* Роль обязана быть возможной для этого семейства адреса. */
  const family = matrixFamily(evidence.url)
  if (!ROLES_BY_FAMILY[family].includes(evidence.pageRole)) {
    throw new TypeError(
      `${where}.pageRole: «${evidence.pageRole}» невозможна для семейства «${family}» — `
      + `допустимо [${ROLES_BY_FAMILY[family].join(', ')}]`,
    )
  }
  if (expectedRole !== null && evidence.pageRole !== expectedRole) {
    throw new TypeError(
      `${where}.pageRole: ожидается «${expectedRole}», получено «${evidence.pageRole}» — `
      + 'роль наблюдения не совпадает с ролью, в которой страница используется',
    )
  }
  assertInteger(evidence.pageBytes, `${where}.pageBytes`, 1)
  assertSha256(evidence.rawPageDigest, `${where}.rawPageDigest`)
  assertCanonicalInstant(evidence.observedAt, `${where}.observedAt`)

  const diagnostics = evidence.encodingDiagnostics
  assertExactKeys(diagnostics, DIAGNOSTICS_KEYS, `${where}.encodingDiagnostics`)
  const exact = (field, expected) => {
    if (diagnostics[field] !== expected) {
      throw new TypeError(
        `${where}.encodingDiagnostics.${field}: ожидается «${expected}», получено ${JSON.stringify(diagnostics[field])}`,
      )
    }
  }
  exact('httpCharset', EXPECTED_SIGNALS.httpCharset)
  exact('metaCharset', EXPECTED_SIGNALS.metaCharset)
  exact('decodePolicy', DECODE_POLICY)
  exact('textGuardSpec', TEXT_GUARD_SPEC)
  assertInteger(diagnostics.decodeErrorCount, `${where}.encodingDiagnostics.decodeErrorCount`, 0)
  assertInteger(diagnostics.decodeReplacements, `${where}.encodingDiagnostics.decodeReplacements`, 0)
  assertInteger(diagnostics.nonWhitelistedCodepoints, `${where}.encodingDiagnostics.nonWhitelistedCodepoints`, 0)
  if (diagnostics.decodeErrorCount !== diagnostics.decodeReplacements) {
    throw new TypeError(
      `${where}.encodingDiagnostics: ошибок ${diagnostics.decodeErrorCount}, замен `
      + `${diagnostics.decodeReplacements} — замена перестала помечать отказ`,
    )
  }
}

/* ── poi-discovery-record — v1/v2 ─────────────────────────────────────── */

const RECORD_KEYS = Object.freeze([
  'contractVersion',
  'sourceKey',
  'url',
  'nameEn',
  'placements',
  'factLeads',
  'omissions',
  'pageEvidence',
  'recordDigest',
  'semanticDigest',
  'observationDigest',
])

function recordCovered(record) {
  return {
    /* Версия берётся ИЗ ЗАПИСИ: покрытие v1-записи обязано считаться так же,
       как считалось при её построении. Подставить сюда текущую версию
       значило бы объявить каждую v1-запись повреждённой. */
    contractVersion: record.contractVersion ?? DISCOVERY_RECORD_SPEC,
    sourceKey: record.sourceKey,
    url: record.url,
    nameEn: record.nameEn,
    placements: record.placements,
    factLeads: record.factLeads.map((lead) => lead.leadDigest),
    omissions: record.omissions,
  }
}

/**
 * Основание мониторинга.
 *
 * `listPosition` СЮДА НЕ ВХОДИТ: редакция переставляет карточки свободно, и
 * одна перестановка объявила бы изменившимися все объекты направления.
 * Перестановку сообщает `orderDigest` — один раз на направление.
 *
 * `kind` ВХОДИТ. Переход объекта из прямого указания в каталоге в карточку
 * направления — изменение по существу: меняется то, чем источник считает
 * объект. Без вида размещения такой переход остался бы незаметным, потому
 * что все три поля ранжирования у прямого объекта равны `null`.
 */
function semanticCovered(record) {
  return {
    nameEn: record.nameEn,
    placements: record.placements.map((placement) => ({
      kind: placement.kind,
      collectionSourceKey: placement.collectionSourceKey,
      editorialLevel: placement.editorialLevel,
      categoryHint: placement.categoryHint,
    })),
    factLeads: record.factLeads.map((lead) => lead.leadDigest),
    omissions: record.omissions,
  }
}

export function buildDiscoveryRecord({ sourceKey, url, nameEn, placements, factLeads, omissions, pageEvidence }) {
  const draft = {
    contractVersion: DISCOVERY_RECORD_SPEC,
    sourceKey,
    url,
    nameEn: guardValue(nameEn, { locator: 'h1', limitBytes: BYTE_LIMITS.nameEn }),
    placements: sortPlacements(placements),
    factLeads: sortFactLeads(factLeads),
    omissions: sortOmissions(omissions),
    pageEvidence,
  }
  const record = {
    ...draft,
    recordDigest: sha256Of(recordCovered(draft), RECORD_DIGEST_DOMAIN),
    semanticDigest: sha256Of(semanticCovered(draft), SEMANTIC_DIGEST_DOMAIN),
    observationDigest: sha256Of(
      { record: recordCovered(draft), pageEvidence: draft.pageEvidence },
      OBSERVATION_DIGEST_DOMAIN,
    ),
  }
  assertDiscoveryRecord(record)
  return deepFreeze(record)
}

/**
 * ВЕРСИЯ БЕРЁТСЯ ИЗ СОБСТВЕННОГО ПОЛЯ-ЗНАЧЕНИЯ, А НЕ ОБРАЩЕНИЕМ К СВОЙСТВУ.
 *
 * `value.contractVersion` ЗАПУСКАЕТ accessor. Подсунутый объект исполняет
 * свой код внутри валидатора — раньше любой проверки и столько раз, сколько
 * валидатор прочтёт поле; он же волен возвращать `v1` проверяющему и `v2`
 * потребителю, и тогда версия, по которой запись проверена, и версия, под
 * которой она уедет дальше, — разные.
 *
 * Снимок с диска — всегда данные. Свойство-accessor здесь не ограничение
 * формата, а признак подделки, поэтому отказ, а не молчаливое чтение.
 * Унаследованное свойство тоже не годится: `getOwnPropertyDescriptor`
 * прототип не смотрит, и подмена через него до значения не дотянется.
 */
function ownVersion(value, where) {
  if (value === null || typeof value !== 'object') return undefined
  const slot = Object.getOwnPropertyDescriptor(value, 'contractVersion')
  if (slot && !('value' in slot)) {
    throw new TypeError(
      `${where}.contractVersion: свойство описано accessor'ом, а не значением — `
      + 'версия формата обязана быть данными',
    )
  }
  return slot?.value
}

/**
 * Полная проверка записи: форма, алфавит заново, связность и пересчёт всех
 * трёх отпечатков.
 *
 * Связность названа отдельно, потому что без неё запись остаётся набором
 * независимо правдоподобных полей: подсказка может ссылаться на одну
 * страницу, свидетельство — на другую, ключ — на третью, и каждое поле по
 * отдельности будет законным.
 */
export function assertDiscoveryRecord(record) {
  /*
   * ЯРЛЫК БЕРЁТСЯ ИЗ ЗАПИСИ ДО ПЕРВОЙ ЖЕ ПРОВЕРКИ.
   *
   * Набор ключей у обеих версий один, поэтому проверить его можно раньше
   * чтения версии — но НАЗВАТЬ формат заранее нельзя: запись `v1` с лишним
   * полем сообщала об этом как `poi-discovery-record/v2`, то есть называла
   * формат, которого читатель в руках не держал. Если версия вообще чужая,
   * ярлыком остаётся текущая: другого осмысленного имени нет.
   */
  const declared = ownVersion(record, DISCOVERY_RECORD_SPEC)
  const spec = READABLE_RECORD_SPECS.includes(declared) ? declared : DISCOVERY_RECORD_SPEC
  assertExactKeys(record, RECORD_KEYS, spec)
  /*
   * ЧИТАЕМ ОБЕ ВЕРСИИ, ПРОВЕРЯЕМ КАЖДУЮ ЕЁ СОБСТВЕННЫМИ ПРАВИЛАМИ.
   *
   * Запись `v1` обязана проверяться закрытым перечислением `v1`: иначе
   * старый снимок принял бы вид размещения, которого в его формате не
   * существовало, и «совместимость» означала бы отсутствие проверки.
   */
  if (!READABLE_RECORD_SPECS.includes(declared)) {
    throw new TypeError(`${DISCOVERY_RECORD_SPEC}: чужая версия ${JSON.stringify(declared)}`)
  }
  const policy = POLICY_BY_RECORD_SPEC[spec]
  const domains = recordDomains(spec)
  const url = assertCanonicalUrl(record.url, `${spec}.url`)
  /*
   * СЕМЕЙСТВО АДРЕСА — ТОЖЕ ЧАСТЬ ФОРМАТА.
   *
   * Опубликованный `v1` знал три семейства; `legacySuffix` появился позже.
   * Без этой проверки запись `v1` принимала ключ `japan-guide:e5036_fish`,
   * которого её собственная грамматика адресов построить не умела.
   */
  const family = canonicalDiscoveryUrl(url).family
  if (!policy.urlFamilies.includes(family)) {
    throw new TypeError(
      `${spec}.url: семейство «${family}» формату ${spec} неизвестно — `
      + `допустимы [${policy.urlFamilies.join(', ')}]`,
    )
  }
  const expectedKey = discoverySourceKey(url)
  if (record.sourceKey !== expectedKey) {
    throw new TypeError(
      `${spec}.sourceKey: ${JSON.stringify(record.sourceKey)} не выводится из ${url} `
      + `(ожидалось ${expectedKey})`,
    )
  }
  assertGuardedValue(record.nameEn, {
    locator: 'h1',
    limitBytes: BYTE_LIMITS.nameEn,
    where: `${spec}.nameEn`,
  })

  if (!Array.isArray(record.placements) || !record.placements.length) {
    throw new TypeError(`${spec}.placements: обязателен хотя бы один`)
  }
  record.placements.forEach((placement, index) =>
    assertPlacement(placement, `${spec}.placements[${index}]`, spec))
  const collections = record.placements.map((p) => p.collectionSourceKey)
  if (new Set(collections).size !== collections.length) {
    throw new TypeError(`${spec}.placements: одна коллекция указана дважды`)
  }
  const directPlacements = record.placements.filter((p) => p.kind === 'catalogueDirect')
  if (directPlacements.length > 1) {
    throw new TypeError(`${spec}.placements: «catalogueDirect» может быть только один`)
  }

  if (!Array.isArray(record.factLeads)) throw new TypeError(`${spec}.factLeads: ожидается массив`)
  record.factLeads.forEach((lead) => assertFactLead(lead, { expectedSource: url }))
  if (!Array.isArray(record.omissions)) throw new TypeError(`${spec}.omissions: ожидается массив`)
  record.omissions.forEach((omission, index) =>
    assertOmission(omission, `${spec}.omissions[${index}]`, policy.omissionCodes))

  /* Запись POI строится ТОЛЬКО из наблюдения, классифицированного как объект.
     Это и есть инвариант «страница направления никогда не проходит как запись
     POI»: держит его роль, а не адрес — корневое семейство бывает и тем, и
     другим, что измерено. */
  assertPageEvidence(record.pageEvidence, `${spec}.pageEvidence`, { expectedRole: 'poi' })
  if (record.pageEvidence.url !== url) {
    throw new TypeError(
      `${spec}.pageEvidence.url: свидетельство наблюдения относится к ${record.pageEvidence.url}, `
      + `а запись — к ${url}`,
    )
  }

  assertCanonicalOrder(record.placements, sortPlacements(record.placements), `${spec}.placements`)
  assertCanonicalOrder(record.factLeads, sortFactLeads(record.factLeads), `${spec}.factLeads`)
  assertCanonicalOrder(record.omissions, sortOmissions(record.omissions), `${spec}.omissions`)

  if (record.recordDigest !== sha256Of(recordCovered(record), domains.record)) {
    throw new TypeError(`${spec}.recordDigest: не сходится с содержимым записи`)
  }
  if (record.semanticDigest !== sha256Of(semanticCovered(record), domains.semantic)) {
    throw new TypeError(`${spec}.semanticDigest: не сходится с содержимым записи`)
  }
  const expectedObservation = sha256Of(
    { record: recordCovered(record), pageEvidence: record.pageEvidence },
    domains.observation,
  )
  if (record.observationDigest !== expectedObservation) {
    throw new TypeError(`${spec}.observationDigest: не сходится со снимком`)
  }
}

/* ── Порядок объектов внутри направления ──────────────────────────────── */

/**
 * ВИД КОЛЛЕКЦИИ — ЧАСТЬ ПОРЯДКА, А НЕ ДОГАДКА ЧИТАТЕЛЯ.
 *
 * `ranked`    — карточки списка направления; у каждой измерен ранг.
 * `container` — дети зонтичной страницы; ранга сайт не показывает вовсе.
 *
 * Без этого поля происхождение размещения нельзя было проверить из снимка:
 * достаточно было заменить `destinationRanking` на `containerChild` и
 * пересчитать отпечатки — подделка проходила. Поле входит в `orderDigest`,
 * поэтому подменить его молча нельзя.
 */
export const COLLECTION_KINDS = Object.freeze(['container', 'ranked'])

/** Какой вид размещения какому виду коллекции соответствует. Реестр один. */
export const PLACEMENT_KIND_BY_COLLECTION_KIND = Object.freeze({
  container: 'containerChild',
  ranked: 'destinationRanking',
})

/**
 * Порядок ПРИВЯЗАН К БАЙТАМ страницы, из которой прочитан.
 *
 * Без `sourcePageDigest` порядок можно было взять от старой версии страницы,
 * а свидетельство коллекции — от новой: оба поля по отдельности законны, и
 * снимок сообщал бы перестановку, которой на наблюдённой странице нет.
 * Отпечаток входит В САМ `orderDigest`, а не лежит рядом: иначе подменить
 * его можно было бы, не тронув отпечаток порядка.
 */
export function orderDigest(destinationSourceKey, sourcePageDigest, orderedSourceKeys, collectionKind = null) {
  const spec = collectionKind === null ? ORDER_SPEC_V1 : ORDER_SPEC
  assertNonEmptyString(destinationSourceKey, `${spec}.destinationSourceKey`)
  assertSha256(sourcePageDigest, `${spec}.sourcePageDigest`)
  if (!Array.isArray(orderedSourceKeys)) throw new TypeError(`${spec}: ожидается массив ключей`)
  const seen = new Set()
  for (const key of orderedSourceKeys) {
    assertNonEmptyString(key, `${spec}.order[]`)
    if (seen.has(key)) throw new TypeError(`${spec}: повтор ключа ${key} в порядке направления`)
    seen.add(key)
  }
  /* Домен отпечатка — ВЕРСИЯ формата: байты v1 и v2 не совпадают никогда. */
  if (collectionKind === null) {
    return sha256Of({ destinationSourceKey, sourcePageDigest, order: [...orderedSourceKeys] }, ORDER_SPEC_V1)
  }
  assertEnum(collectionKind, COLLECTION_KINDS, `${spec}.collectionKind`)
  return sha256Of(
    { destinationSourceKey, sourcePageDigest, collectionKind, order: [...orderedSourceKeys] },
    ORDER_SPEC,
  )
}

export function buildOrderRecord(destinationSourceKey, sourcePageDigest, order, collectionKind) {
  assertEnum(collectionKind, COLLECTION_KINDS, `${ORDER_SPEC}.collectionKind`)
  const record = {
    destinationSourceKey,
    sourcePageDigest,
    collectionKind,
    order: [...order],
    orderDigest: orderDigest(destinationSourceKey, sourcePageDigest, order, collectionKind),
  }
  assertOrderRecord(record, ORDER_SPEC)
  return deepFreeze(record)
}

/**
 * КЛЮЧ БЕЗ АДРЕСА — ТА ЖЕ ПРОВЕРКА, ЧТО И АДРЕС.
 *
 * Один помощник на всех потребителей: и на самостоятельный порядок, и на
 * ссылки отказов внутри снимка. Пока проверка жила только в
 * `assertDiscoverySnapshot`, публичная граница порядка была СЛАБЕЕ снимка:
 * `buildOrderRecord` возвращал порядок с ключом `not-a-source-key`, а
 * проверка снимка тот же порядок отвергала. Строитель, отдающий заведомо
 * негодное, — это не «проверим позже», это ложное «годно».
 *
 * Имя формата берётся параметром: у порядка своё, у снимка своё, и
 * сообщение обязано называть тот формат, чьи правила сработали.
 */
function assertKeyFamilyBy(policy, key, at, formatName, requiredRole = null) {
  const parsed = sourceKeyFamily(key)
  if (!parsed.ok) {
    throw new TypeError(
      `${at}: ${JSON.stringify(key)} не выводится ни из одного канонического адреса`,
    )
  }
  if (!policy.urlFamilies.includes(parsed.family)) {
    throw new TypeError(
      `${at}: семейство «${parsed.family}» формату ${formatName} неизвестно — `
      + `допустимы [${policy.urlFamilies.join(', ')}]`,
    )
  }
  if (requiredRole === null) return

  /*
   * КАНОНИЧНОСТЬ КЛЮЧА — ЕЩЁ НЕ ЕГО РОЛЬ.
   *
   * У ключа есть ПОЗИЦИЯ, и позиция требует роли: направление обязано
   * допускать `collection`, элемент порядка — `poi`. Без этого строитель
   * возвращал порядок, который снимок затем отвергал по свидетельствам
   * ролей: `legacySuffix` и `destinationNested` вставали направлением, хотя
   * измерены только как объекты, а точка входа — и направлением, и
   * элементом порядка, хотя она каталог.
   *
   * Матрица ролей одна — `ROLES_BY_FAMILY`, та же, что у свидетельств. Вход
   * отделён от прочего `legacy` тем же правилом, что и в `matrixFamily`:
   * по адресу там, по ключу здесь.
   */
  const matrix = key === CATALOGUE_SOURCE_KEY ? 'catalogueEntry' : parsed.family
  const roles = ROLES_BY_FAMILY[matrix]
  if (!roles) {
    throw new TypeError(`${at}: у семейства «${matrix}» не объявлено ни одной роли`)
  }
  if (!roles.includes(requiredRole)) {
    throw new TypeError(
      `${at}: ${key} не может быть «${requiredRole}» — семейство «${matrix}» `
      + `допускает [${roles.join(', ')}]`,
    )
  }
}

export function assertOrderRecord(record, where = ORDER_SPEC, spec = ORDER_SPEC) {
  const policy = POLICY_BY_ORDER_SPEC[spec]
  if (!policy) throw new TypeError(`${where}: неизвестная версия порядка ${JSON.stringify(spec)}`)
  assertExactKeys(record, policy.orderKeys, where)
  assertNonEmptyString(record.destinationSourceKey, `${where}.destinationSourceKey`)
  assertKeyFamilyBy(policy, record.destinationSourceKey, `${where}.destinationSourceKey`, spec, 'collection')
  assertSha256(record.sourcePageDigest, `${where}.sourcePageDigest`)
  if (!Array.isArray(record.order)) throw new TypeError(`${where}.order: ожидается массив`)
  record.order.forEach((key, index) =>
    assertKeyFamilyBy(policy, key, `${where}.order[${index}]`, spec, 'poi'))
  assertSha256(record.orderDigest, `${where}.orderDigest`)
  /*
   * Наличие вида коллекции берётся ИЗ ПОЛИТИКИ, а не из сравнения с текущей
   * константой. Сравнение `spec === ORDER_SPEC` означало «всё, что не самая
   * свежая версия, вида не имеет» — и следующая версия формата унаследовала
   * бы правило `v1`, ничего не сломав заметно.
   */
  const collectionKind = policy.collectionKind ? record.collectionKind : null
  if (collectionKind !== null) assertEnum(collectionKind, COLLECTION_KINDS, `${where}.collectionKind`)
  const expected = orderDigest(
    record.destinationSourceKey, record.sourcePageDigest, record.order, collectionKind)
  if (record.orderDigest !== expected) {
    throw new TypeError(`${where}.orderDigest: не сходится с порядком, видом коллекции или байтами страницы`)
  }
}

/** Сколько записей сменило позицию между двумя порядками. */
export function movedCount(previousOrder, currentOrder) {
  const before = new Map(previousOrder.map((key, index) => [key, index]))
  let moved = 0
  currentOrder.forEach((key, index) => {
    if (!before.has(key)) return
    if (before.get(key) !== index) moved += 1
  })
  return moved
}

/* ── poi-discovery-snapshot — v1/v2 ───────────────────────────────────── */

const SNAPSHOT_KEYS = Object.freeze([
  'contractVersion',
  'scope',
  'entryUrl',
  'complete',
  'incompleteReasons',
  'robotsEvidence',
  'catalogueEvidence',
  'catalogueTargetEvidence',
  'orderRecords',
  'records',
  'rejected',
  'counters',
  'snapshotDigest',
])
const SCOPE_KEYS = Object.freeze(['kind', 'limit'])
const ROBOTS_KEYS = Object.freeze(['url', 'bytes', 'digest', 'observedAt', 'appliedGroups'])
const REJECTED_KEYS = Object.freeze(['targets', 'cards', 'pois'])
const PAGE_REJECTION_KEYS = Object.freeze(['ref', 'code'])
const CARD_REJECTION_KEYS = Object.freeze(['destination', 'position', 'code'])
/**
 * Счётчики больше НЕ называют все цели каталога направлениями.
 *
 * Измерение показало, что каталог перечисляет и коллекции, и объекты, поэтому
 * Прежнее имя счётчика объявляло направлением каждую цель — в том числе те, что
 * направлениями не являются. Теперь целей столько, сколько их перечислено, а
 * коллекции и прямые объекты считаются раздельно и обязаны в сумме давать
 * число целей: иначе цель осталась неклассифицированной, и снимок не полон.
 */
const COUNTER_KEYS = Object.freeze([
  'networkRequests',
  'catalogueTargetsFound',
  'collectionsFound',
  'directPoisFound',
  'poisFound',
  'poisVisited',
  'recordsBuilt',
  'nonCanonicalLinks',
  'unknownAdmissionLabels',
  'emptyAdmissionValues',
])
const TARGET_EVIDENCE_KEYS = Object.freeze(['sourceKey', 'evidence'])

/** Роли, которые цель каталога может иметь. Каталогом цель быть не может. */
const TARGET_ROLES = Object.freeze(['collection', 'poi'])
const REASON_KEYS = Object.freeze(['code', 'count'])

/** Ссылка отказа: ключ источника либо сырой путь непригодной формы. */
const REJECTION_REF = /^[\x21-\x7e]{1,512}$/

function snapshotCovered(snapshot) {
  return {
    contractVersion: snapshot.contractVersion ?? SNAPSHOT_SPEC,
    scope: snapshot.scope,
    entryUrl: snapshot.entryUrl,
    complete: snapshot.complete,
    incompleteReasons: snapshot.incompleteReasons,
    robotsEvidence: snapshot.robotsEvidence,
    catalogueEvidence: snapshot.catalogueEvidence,
    catalogueTargetEvidence: snapshot.catalogueTargetEvidence,
    orderRecords: snapshot.orderRecords.map((row) => row.orderDigest),
    records: snapshot.records.map((record) => record.observationDigest),
    rejected: snapshot.rejected,
    counters: snapshot.counters,
  }
}

/**
 * Сколько отказов каждого рода лежит в массивах.
 *
 * Причины неполноты не объявляются, а ВЫВОДЯТСЯ из отказов и счётчиков.
 * Иначе снимок мог бы нести три недоступных направления и пустой список
 * причин — и назвать себя полным.
 */
function derivedReasonCounts(snapshot) {
  const targets = snapshot.rejected.targets
  const pois = snapshot.rejected.pois
  return {
    targetFetchFailed: targets.filter(
      (row) => !STRUCTURE_CODES.has(row.code) && row.code !== UNSUPPORTED_SHAPE_CODE).length,
    targetStructureMismatch: targets.filter((row) => STRUCTURE_CODES.has(row.code)).length,
    unsupportedCatalogueLinkShape: targets.filter((row) => row.code === UNSUPPORTED_SHAPE_CODE).length,
    cardRejected: snapshot.rejected.cards.length,
    poiFetchFailed: pois.filter((row) => !STRUCTURE_CODES.has(row.code)).length,
    poiStructureMismatch: pois.filter((row) => STRUCTURE_CODES.has(row.code)).length,
  }
}

/**
 * Причины, которых нет в массивах отказов и которые поэтому объявляются
 * прогоном: применённый предел и нехватка бюджета. Обе проверяются иначе —
 * через охват и счётчики.
 */
const DECLARED_REASONS = Object.freeze(['limitApplied', 'budgetInsufficient'])

/**
 * Снимок обхода целиком.
 *
 * `complete` — не украшение отчёта, а условие, без которого мониторинг
 * работать не имеет права. Неполный обход, поданный как снимок, объявляет
 * исчезнувшими все объекты, до которых не дошёл.
 */
export function buildDiscoverySnapshot({
  scope,
  entryUrl,
  incompleteReasons,
  robotsEvidence,
  catalogueEvidence,
  catalogueTargetEvidence,
  orderRecords,
  records,
  rejected,
  counters,
}) {
  const reasons = [...incompleteReasons]
    .filter((reason) => reason.count > 0)
    .sort((a, b) => compareUtf8(a.code, b.code))
  const draft = {
    contractVersion: SNAPSHOT_SPEC,
    scope,
    entryUrl,
    complete: scope.kind === 'full' && reasons.length === 0,
    incompleteReasons: reasons,
    robotsEvidence,
    catalogueEvidence,
    catalogueTargetEvidence: sortedBy(catalogueTargetEvidence, (row) => row.sourceKey),
    orderRecords: sortedBy(orderRecords, (row) => row.destinationSourceKey),
    records: sortedBy(records, (record) => record.sourceKey),
    rejected: {
      targets: sortedWith(rejected.targets ?? [], (a, b) =>
        compareUtf8(a.ref, b.ref) || compareUtf8(a.code, b.code)),
      cards: sortedWith(rejected.cards ?? [], (a, b) =>
        compareUtf8(a.destination, b.destination)
        || a.position - b.position
        || compareUtf8(a.code, b.code)),
      pois: sortedWith(rejected.pois ?? [], (a, b) =>
        compareUtf8(a.ref, b.ref) || compareUtf8(a.code, b.code)),
    },
    counters,
  }
  const snapshot = { ...draft, snapshotDigest: sha256Of(snapshotCovered(draft), SNAPSHOT_DIGEST_DOMAIN) }
  try {
    assertDiscoverySnapshot(snapshot)
  } catch (error) {
    /*
     * ОТКАЗ ОБЯЗАН БЫТЬ ДИАГНОСТИРУЕМ. Отвергнутый снимок пропадал вместе с
     * исключением: часами собранные счётчики, свидетельства и причины
     * исчезали, и о причине отказа приходилось судить по одной строке
     * сообщения. Черновик прикрепляется к ошибке — вызывающий волен его
     * сохранить или не заметить.
     *
     * Снимок при этом НЕ становится валидным: он не возвращается и не
     * замораживается, а исключение уходит дальше нетронутым по смыслу.
     */
    error.rejectedSnapshot = snapshot
    throw error
  }
  return deepFreeze(snapshot)
}

export function assertDiscoverySnapshot(snapshot, label = null) {
  /* До чтения версии ярлык неизвестен: набор ключей у обоих форматов один. */
  let where = label ?? SNAPSHOT_SPEC
  assertExactKeys(snapshot, SNAPSHOT_KEYS, where)
  /*
   * ЧИТАЮТСЯ ОБЕ ВЕРСИИ. Правила берутся по версии САМОГО снимка: `v1` не
   * знает ни `containerChild`, ни `collectionKind`, и проверять его
   * правилами `v2` значило бы не проверять вовсе.
   */
  const snapshotSpec = ownVersion(snapshot, where)
  if (!READABLE_SNAPSHOT_SPECS.includes(snapshotSpec)) {
    throw new TypeError(`${where}.contractVersion: чужая версия ${JSON.stringify(snapshotSpec)}`)
  }
  /*
   * ЯРЛЫК ОШИБКИ НАЗЫВАЕТ ВЕРСИЮ СНИМКА, А НЕ ТЕКУЩУЮ.
   *
   * Сообщение «poi-discovery-snapshot/v2.rejected…» о снимке `v1` называет
   * формат, которого читатель в руках не держал: отказ v1 читался бы как
   * отказ v2, и по тексту нельзя было бы понять, чьи правила сработали.
   */
  where = label ?? snapshotSpec
  /*
   * ВЕРСИЯ СНИМКА ЗАДАЁТ ВЕРСИЮ ВСЕГО, ЧТО В НЁМ ЛЕЖИТ.
   *
   * Прежде запись проверялась своей собственной `contractVersion`
   * независимо от снимка, и снимок `v1` спокойно нёс записи `v2` с видом
   * размещения, которого в его формате не существовало. «Заморожен» — это
   * и значит, что внутрь не попадает ничего из более поздней версии.
   */
  const policy = VERSION_POLICY[snapshotSpec]
  const recordSpec = policy.record
  const orderSpec = policy.order
  const rejectionCodes = policy.pageRejectionCodes
  const cardCodes = policy.cardRejectionCodes
  /* Один и тот же вопрос к любому адресу снимка: знает ли этот формат такое
     семейство. Набор берётся из политики по версии САМОГО снимка. */
  const assertUrlFamily = (url, at) => {
    const family = canonicalDiscoveryUrl(url).family
    if (!policy.urlFamilies.includes(family)) {
      throw new TypeError(
        `${at}: семейство «${family}» формату ${snapshotSpec} неизвестно — `
        + `допустимы [${policy.urlFamilies.join(', ')}]`,
      )
    }
  }
  /*
   * ТОТ ЖЕ ВОПРОС К ПОЛЯМ, ГДЕ ОТ СТРАНИЦЫ ОСТАЛСЯ ОДИН КЛЮЧ.
   *
   * `orderRecord.order[]`, `rejected.targets[].ref`, `rejected.pois[].ref` и
   * `rejected.cards[].destination` хранят ключ без адреса. Проверка семейства
   * стояла только там, где адрес есть, и все четыре поля принимали любую
   * строку: ограниченный снимок `v1` принял `japan-guide:e5036_fish` в
   * порядке, потому что записи для него нет и до `record.url` дело не
   * доходит. Семейство берётся обратным разбором ключа — одной и той же
   * грамматикой адресов, без второго набора выражений.
   */
  const assertKeyFamily = (key, at) => assertKeyFamilyBy(policy, key, at, snapshotSpec)
  assertExactKeys(snapshot.scope, SCOPE_KEYS, `${where}.scope`)
  assertEnum(snapshot.scope.kind, SNAPSHOT_SCOPES, `${where}.scope.kind`)
  if (snapshot.scope.kind === 'full') {
    if (snapshot.scope.limit !== null) throw new TypeError(`${where}.scope.limit: у полного обхода предела нет`)
  } else {
    assertInteger(snapshot.scope.limit, `${where}.scope.limit`, 1)
  }
  const entryUrl = assertCanonicalUrl(snapshot.entryUrl, `${where}.entryUrl`)

  /* ── Отказы: точные схемы и закрытые коды ── */
  assertExactKeys(snapshot.rejected, REJECTED_KEYS, `${where}.rejected`)
  for (const field of REJECTED_KEYS) {
    if (!Array.isArray(snapshot.rejected[field])) {
      throw new TypeError(`${where}.rejected.${field}: ожидается массив`)
    }
  }
  const assertPageRejection = (row, field, index) => {
    const label = `${where}.rejected.${field}[${index}]`
    assertExactKeys(row, PAGE_REJECTION_KEYS, label)
    assertNonEmptyString(row.ref, `${label}.ref`)
    if (!REJECTION_REF.test(row.ref)) {
      throw new TypeError(`${label}.ref: ожидается печатная ASCII-ссылка не длиннее 512 символов`)
    }
    assertEnum(row.code, rejectionCodes, `${label}.code`)
    /*
     * `unsupportedCatalogueLinkShape` — ЕДИНСТВЕННЫЙ код, у которого `ref`
     * намеренно хранит сырой адрес: ключ из ссылки непригодной формы не
     * строится вовсе, ради этого код и заведён. Во всех прочих случаях `ref`
     * обязан быть каноническим ключом семейства, известного формату снимка.
     */
    if (row.code !== UNSUPPORTED_SHAPE_CODE) assertKeyFamily(row.ref, `${label}.ref`)
  }
  snapshot.rejected.targets.forEach((row, index) => assertPageRejection(row, 'targets', index))
  snapshot.rejected.pois.forEach((row, index) => assertPageRejection(row, 'pois', index))
  snapshot.rejected.cards.forEach((row, index) => {
    const label = `${where}.rejected.cards[${index}]`
    assertExactKeys(row, CARD_REJECTION_KEYS, label)
    assertNonEmptyString(row.destination, `${label}.destination`)
    /*
     * Семейство ключа здесь НЕ проверяется намеренно. Ниже `destination`
     * обязан лежать в `collectionKeys`, а те выведены из свидетельств целей,
     * чьи адреса уже проверены семейством, и чей ключ выведен из адреса.
     * Отдельная проверка была бы недостижима — а недостижимую не убивает ни
     * одна мутация, то есть её никто не проверяет. Измерено: мутация,
     * снимавшая эту строку, выживала.
     */
    assertInteger(row.position, `${label}.position`, 1)
    assertEnum(row.code, cardCodes, `${label}.code`)
  })

  /* ── Счётчики ── */
  assertExactKeys(snapshot.counters, COUNTER_KEYS, `${where}.counters`)
  for (const field of COUNTER_KEYS) assertInteger(snapshot.counters[field], `${where}.counters.${field}`, 0)

  /* ── Причины неполноты сходятся с отказами и счётчиками ── */
  if (!Array.isArray(snapshot.incompleteReasons)) throw new TypeError(`${where}.incompleteReasons: ожидается массив`)
  const declared = new Map()
  for (const reason of snapshot.incompleteReasons) {
    assertExactKeys(reason, REASON_KEYS, `${where}.incompleteReasons[]`)
    assertEnum(reason.code, INCOMPLETE_REASONS, `${where}.incompleteReasons[].code`)
    assertInteger(reason.count, `${where}.incompleteReasons[].count`, 1)
    if (declared.has(reason.code)) throw new TypeError(`${where}.incompleteReasons: причина ${reason.code} названа дважды`)
    declared.set(reason.code, reason.count)
  }
  assertCanonicalOrder(
    snapshot.incompleteReasons,
    [...snapshot.incompleteReasons].sort((a, b) => compareUtf8(a.code, b.code)),
    `${where}.incompleteReasons`,
  )
  const derived = derivedReasonCounts(snapshot)
  for (const [code, count] of Object.entries(derived)) {
    const stated = declared.get(code) ?? 0
    if (stated !== count) {
      throw new TypeError(
        `${where}.incompleteReasons: «${code}» объявлено ${stated}, а по массивам отказов ${count}`,
      )
    }
  }
  for (const code of declared.keys()) {
    if (code in derived) continue
    if (!DECLARED_REASONS.includes(code)) {
      throw new TypeError(`${where}.incompleteReasons: «${code}» ниоткуда не выводится`)
    }
  }
  if (derived.unsupportedCatalogueLinkShape !== snapshot.counters.nonCanonicalLinks) {
    throw new TypeError(
      `${where}: непригодных ссылок каталога ${derived.unsupportedCatalogueLinkShape}, `
      + `а счётчик говорит ${snapshot.counters.nonCanonicalLinks}`,
    )
  }
  /*
   * ОХВАТ ОПИСЫВАЕТ ФАКТ, поэтому связь ДВУСТОРОННЯЯ и обязана ею быть.
   *
   * `scope.kind` — не просьба оператора, а итог: предел, который ничего не
   * отрезал, оставляет обход полным, и такой снимок годится основанием
   * мониторинга. Предел, который отрезал, делает охват ограниченным и
   * обязан назвать себя причиной.
   *
   * Односторонняя связь здесь стояла и СНЯТА как неверная: она позволяла
   * ограниченному охвату молчать о причине, то есть снимку — быть
   * непригодным без объяснения, чем именно он неполон.
   */
  if (declared.has('limitApplied') && snapshot.scope.kind !== 'limited') {
    throw new TypeError(`${where}: «limitApplied» при полном охвате`)
  }
  if (snapshot.scope.kind === 'limited' && !declared.has('limitApplied')) {
    throw new TypeError(`${where}: ограниченный охват без причины «limitApplied»`)
  }

  /* ── Полнота ── */
  if (typeof snapshot.complete !== 'boolean') throw new TypeError(`${where}.complete: ожидается boolean`)
  const expectedComplete = snapshot.scope.kind === 'full' && snapshot.incompleteReasons.length === 0
  if (snapshot.complete !== expectedComplete) {
    throw new TypeError(`${where}.complete: объявлено ${snapshot.complete}, а по составу снимка ${expectedComplete}`)
  }
  /* Отдельной проверки «полный снимок обязан иметь пустые массивы отказов»
     здесь НЕТ, и это не упущение. Она следует из двух проверок выше:
     причины выводятся из массивов отказов и счётчика непригодных адресов, а
     полнота требует пустого списка причин. Любой отказ порождает причину,
     любая причина делает снимок неполным. Проверка, которую невозможно
     провалить, не проверяет ничего — она стояла здесь и снята. */

  /* ── robots ── */
  assertExactKeys(snapshot.robotsEvidence, ROBOTS_KEYS, `${where}.robotsEvidence`)
  if (snapshot.robotsEvidence.url !== ROBOTS_URL) {
    throw new TypeError(
      `${where}.robotsEvidence.url: ожидается ровно ${ROBOTS_URL}, получено ${JSON.stringify(snapshot.robotsEvidence.url)}`,
    )
  }
  assertInteger(snapshot.robotsEvidence.bytes, `${where}.robotsEvidence.bytes`, 1)
  assertSha256(snapshot.robotsEvidence.digest, `${where}.robotsEvidence.digest`)
  assertCanonicalInstant(snapshot.robotsEvidence.observedAt, `${where}.robotsEvidence.observedAt`)
  const groups = snapshot.robotsEvidence.appliedGroups
  if (!Array.isArray(groups) || !groups.length) {
    throw new TypeError(`${where}.robotsEvidence.appliedGroups: обязана быть непустым списком`)
  }
  for (const group of groups) assertNonEmptyString(group, `${where}.robotsEvidence.appliedGroups[]`)
  if (new Set(groups).size !== groups.length) {
    throw new TypeError(`${where}.robotsEvidence.appliedGroups: повтор группы`)
  }
  assertCanonicalOrder(groups, [...groups].sort(compareUtf8), `${where}.robotsEvidence.appliedGroups`)

  /* ── Свидетельства страниц ── */
  assertPageEvidence(snapshot.catalogueEvidence, `${where}.catalogueEvidence`, { expectedRole: 'catalogue' })
  /* Семейство каталога здесь НЕ проверяется намеренно: строкой ниже его
     адрес обязан совпасть с `entryUrl`, а тот выведен из замороженной
     константы входа. Проверка была бы недостижима, а недостижимую проверку
     не убивает ни одна мутация — то есть её никто не проверяет. */
  if (snapshot.catalogueEvidence.url !== entryUrl) {
    throw new TypeError(
      `${where}.catalogueEvidence.url: свидетельство относится к ${snapshot.catalogueEvidence.url}, `
      + `а точка входа обхода — ${entryUrl}`,
    )
  }
  /*
   * Цели каталога — НЕ обязательно направления. Роль каждой цели читается из
   * её собственного свидетельства, а не назначается заранее по тому, что она
   * попала в этот список. Каталогом цель быть не может: каталог один, и он
   * лежит в `catalogueEvidence`.
   */
  if (!Array.isArray(snapshot.catalogueTargetEvidence)) {
    throw new TypeError(`${where}.catalogueTargetEvidence: ожидается массив`)
  }
  for (const row of snapshot.catalogueTargetEvidence) {
    assertExactKeys(row, TARGET_EVIDENCE_KEYS, `${where}.catalogueTargetEvidence[]`)
    const at = `${where}.catalogueTargetEvidence[${row.sourceKey}].evidence`
    assertPageEvidence(row.evidence, at)
    /*
     * СЕМЕЙСТВО АДРЕСА ПРОВЕРЯЕТСЯ И ЗДЕСЬ, А НЕ ТОЛЬКО У ЗАПИСИ.
     *
     * Цель каталога попадает в снимок раньше записи и может остаться без
     * неё вовсе — при ограниченном охвате или при отказе. Проверка семейства
     * стояла только у `record.url`, поэтому адрес нового семейства,
     * положенный сюда, проходил в снимок `v1` целиком: запись оставалась
     * законной `legacy`, и смотреть на цель было некому.
     */
    assertUrlFamily(row.evidence.url, `${at}.url`)
    if (!TARGET_ROLES.includes(row.evidence.pageRole)) {
      throw new TypeError(
        `${at}.pageRole: цель каталога не может быть «${row.evidence.pageRole}» — `
        + `допустимо [${TARGET_ROLES.join(', ')}]`,
      )
    }
    if (discoverySourceKey(row.evidence.url) !== row.sourceKey) {
      throw new TypeError(
        `${where}.catalogueTargetEvidence[${row.sourceKey}]: ключ не выводится из адреса свидетельства`,
      )
    }
  }
  assertCanonicalOrder(
    snapshot.catalogueTargetEvidence,
    sortedBy(snapshot.catalogueTargetEvidence, (row) => row.sourceKey),
    `${where}.catalogueTargetEvidence`,
  )
  const targetKeys = snapshot.catalogueTargetEvidence.map((row) => row.sourceKey)
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new TypeError(`${where}.catalogueTargetEvidence: одна цель указана дважды`)
  }
  const collectionKeys = new Set(snapshot.catalogueTargetEvidence
    .filter((row) => row.evidence.pageRole === 'collection').map((row) => row.sourceKey))
  const directPoiKeys = new Set(snapshot.catalogueTargetEvidence
    .filter((row) => row.evidence.pageRole === 'poi').map((row) => row.sourceKey))

  /* ── Порядок направлений ── */
  if (!Array.isArray(snapshot.orderRecords)) throw new TypeError(`${where}.orderRecords: ожидается массив`)
  /* Семейство ключей порядка проверяет САМ `assertOrderRecord` — повторять
     здесь значило бы держать две копии одного правила. */
  snapshot.orderRecords.forEach((row) => assertOrderRecord(row, `${where}.orderRecords[]`, orderSpec))
  assertCanonicalOrder(
    snapshot.orderRecords,
    sortedBy(snapshot.orderRecords, (row) => row.destinationSourceKey),
    `${where}.orderRecords`,
  )

  /* ── Записи объектов ── */
  if (!Array.isArray(snapshot.records)) throw new TypeError(`${where}.records: ожидается массив`)
  snapshot.records.forEach((record) => {
    /* Версия записи обязана совпадать с версией снимка — иначе `v1` принял
       бы `v2`-запись и «заморозка» не значила бы ничего. */
    if (record.contractVersion !== recordSpec) {
      throw new TypeError(
        `${where}.records[${record.sourceKey}]: версия записи ${JSON.stringify(record.contractVersion)} `
        + `при снимке ${snapshotSpec} — ожидалась ${recordSpec}`,
      )
    }
    assertDiscoveryRecord(record)
  })
  assertCanonicalOrder(
    snapshot.records,
    sortedBy(snapshot.records, (record) => record.sourceKey),
    `${where}.records`,
  )
  const recordKeys = snapshot.records.map((record) => record.sourceKey)
  if (new Set(recordKeys).size !== recordKeys.length) throw new TypeError(`${where}.records: один объект записан дважды`)

  /* ── Связность множеств ──
     Порядок ведётся ТОЛЬКО для целей с ролью `collection`. Требовать порядок
     от прямого объекта значило бы выдумать список, которого у него нет; не
     требовать его от коллекции — принять направление, порядок которого
     неизвестен. Поэтому равенство, а не включение. */
  const orderKeys = new Set(snapshot.orderRecords.map((row) => row.destinationSourceKey))
  if (orderKeys.size !== collectionKeys.size || [...collectionKeys].some((key) => !orderKeys.has(key))) {
    throw new TypeError(
      `${where}: порядок ведётся для ${orderKeys.size} целей при ${collectionKeys.size} коллекциях — `
      + 'множества обязаны совпадать',
    )
  }

  /*
   * Каждая привязка обязана РАЗРЕШАТЬСЯ, и разрешается она по-разному:
   *   destinationRanking → коллекция существует и содержит объект в порядке;
   *   catalogueDirect    → объект действительно перечислен каталогом как POI.
   * Без второй ветви «прямой из каталога» был бы словом без опоры: любая
   * запись могла бы объявить себя найденной напрямую.
   */
  const targetEvidenceByKey = new Map(snapshot.catalogueTargetEvidence.map((row) => [row.sourceKey, row]))

  /*
   * Порядок коллекции прочитан из тех же байтов, что и её свидетельство.
   * Иначе `orderDigest` можно было взять от прошлой версии страницы, а
   * свидетельство — от нынешней, и мониторинг сообщил бы перестановку,
   * которой на наблюдённой странице нет.
   */
  for (const row of snapshot.orderRecords) {
    const target = targetEvidenceByKey.get(row.destinationSourceKey)
    if (!target) {
      throw new TypeError(
        `${where}.orderRecords[${row.destinationSourceKey}]: порядок без свидетельства цели`,
      )
    }
    if (target.evidence.rawPageDigest !== row.sourcePageDigest) {
      throw new TypeError(
        `${where}.orderRecords[${row.destinationSourceKey}]: порядок прочитан из `
        + `${row.sourcePageDigest}, а свидетельство коллекции — из `
        + `${target.evidence.rawPageDigest}`,
      )
    }
  }

  const orderByCollection = new Map(snapshot.orderRecords.map((row) => [row.destinationSourceKey, new Set(row.order)]))
  /* Пусто для v1: там вида коллекции нет, и сверка вырождается — верно. */
  const collectionKindByKey = new Map(snapshot.orderRecords
    .filter((row) => typeof row.collectionKind === 'string')
    .map((row) => [row.destinationSourceKey, row.collectionKind]))
  for (const record of snapshot.records) {
    for (const placement of record.placements) {
      if (placement.kind === 'catalogueDirect') {
        if (snapshot.catalogueEvidence.url !== entryUrl
          || discoverySourceKey(snapshot.catalogueEvidence.url) !== placement.collectionSourceKey) {
          throw new TypeError(
            `${where}.records[${record.sourceKey}]: «catalogueDirect» ссылается на `
            + `${placement.collectionSourceKey}, а каталог снимка — `
            + `${discoverySourceKey(snapshot.catalogueEvidence.url)}`,
          )
        }
        if (!directPoiKeys.has(record.sourceKey)) {
          throw new TypeError(
            `${where}.records[${record.sourceKey}]: объявлен найденным прямо в каталоге, `
            + 'но среди целей каталога с ролью «poi» его нет',
          )
        }
        /*
         * ОДНА страница — ОДНИ байты. Свидетельство цели и свидетельство
         * записи описывают один и тот же обмен: для прямого объекта страница
         * получена ровно один раз. Разойдясь, они означали бы, что имя и
         * подсказки прочитаны не из той версии страницы, которую снимок
         * предъявляет как наблюдение.
         */
        const targetRow = targetEvidenceByKey.get(record.sourceKey)
        assertSameObservation(
          targetRow.evidence,
          record.pageEvidence,
          `${where}.records[${record.sourceKey}]`,
          'свидетельство цели и свидетельство записи',
        )
        continue
      }
      const order = orderByCollection.get(placement.collectionSourceKey)
      if (!order) {
        throw new TypeError(
          `${where}.records[${record.sourceKey}]: привязка к коллекции ${placement.collectionSourceKey}, `
          + 'которой в снимке нет',
        )
      }
      /*
       * ВИД РАЗМЕЩЕНИЯ ОБЯЗАН СХОДИТЬСЯ С ВИДОМ КОЛЛЕКЦИИ.
       *
       * Без этой сверки происхождение `containerChild` из снимка не
       * проверялось: достаточно было заменить вид у объекта ранжированной
       * коллекции и пересчитать все отпечатки — подделка проходила.
       * Проверено исполнением 20.08: проходила.
       *
       * Соответствие берётся из ОДНОГО реестра
       * `PLACEMENT_KIND_BY_COLLECTION_KIND`, а не переписывается здесь.
       */
      const collectionKind = collectionKindByKey.get(placement.collectionSourceKey)
      if (collectionKind) {
        const expectedKind = PLACEMENT_KIND_BY_COLLECTION_KIND[collectionKind]
        if (placement.kind !== expectedKind) {
          throw new TypeError(
            `${where}.records[${record.sourceKey}]: вид размещения «${placement.kind}» при коллекции `
            + `вида «${collectionKind}» — ожидался «${expectedKind}»`,
          )
        }
      }
      if (!order.has(record.sourceKey)) {
        throw new TypeError(
          `${where}.records[${record.sourceKey}]: коллекция ${placement.collectionSourceKey} этого объекта `
          + 'в своём порядке не содержит',
        )
      }
    }
  }

  /*
   * ── Счётчики: инварианты БЕЗУСЛОВНЫЕ ──
   *
   * Раньше почти все связи счётчиков стояли внутри `if (snapshot.complete)`,
   * и неполный снимок принимал любые числа: 999 целей, 777 коллекций, 555
   * объектов при одной коллекции и нуле объектов. Неполный снимок — не
   * черновик: он идёт в отчёт и в диагностику, и числа в нём обязаны
   * описывать его собственный состав. Внутри `complete` остаётся только то,
   * что осмысленно ровно для полного обхода.
   */
  const reachable = new Set([...snapshot.orderRecords.flatMap((row) => row.order), ...directPoiKeys])

  /*
   * ── ОТКАЗ ОБЯЗАН ССЫЛАТЬСЯ НА ТО, ЧТО СНИМОК ВИДЕЛ ──
   *
   * Формы и коды у отказов проверялись, а связи — нет: снимок принимал отказ
   * объекта `japan-guide:e9999`, которого нет ни в одном порядке и среди
   * прямых объектов каталога, и отказ карточки у коллекции, которой он не
   * наблюдал. Счётчики такую подмену не ловят: `poisFound` считается по
   * `reachable`, а отвергнутые в неё не входили вовсе, и суммы сходились.
   *
   * Отказ — это утверждение «страница была найдена, но не прочитана».
   * Ссылка, которой снимок не находил, делает его ложным.
   */
  const failedPoiRefs = snapshot.rejected.pois.map((row) => row.ref)
  if (new Set(failedPoiRefs).size !== failedPoiRefs.length) {
    throw new TypeError(`${where}.rejected.pois: один объект отвергнут дважды`)
  }
  const recordKeySet = new Set(recordKeys)
  for (const ref of failedPoiRefs) {
    if (!reachable.has(ref)) {
      throw new TypeError(
        `${where}.rejected.pois: объект ${ref} отвергнут, но снимок его не находил — `
        + 'ни в одном порядке и ни среди прямых объектов каталога его нет',
      )
    }
    if (recordKeySet.has(ref)) {
      throw new TypeError(
        `${where}.rejected.pois: объект ${ref} одновременно записан и отвергнут — одно из двух неправда`,
      )
    }
  }

  /*
   * Карточка принадлежит КОЛЛЕКЦИИ, а не любому ключу: отказ у прямого
   * объекта каталога или у ненаблюдённой страницы описывает список, которого
   * снимок не читал. Позиция внутри одной коллекции — одна: две записи об
   * одной и той же карточке означали бы, что она отвергнута дважды, а
   * причина неполноты посчитана два раза.
   */
  const rejectedCardSlots = new Set()
  for (const row of snapshot.rejected.cards) {
    if (!collectionKeys.has(row.destination)) {
      throw new TypeError(
        `${where}.rejected.cards: карточка отвергнута у ${row.destination}, `
        + 'но коллекции с таким ключом снимок не наблюдал',
      )
    }
    const slot = `${row.destination}#${row.position}`
    if (rejectedCardSlots.has(slot)) {
      throw new TypeError(
        `${where}.rejected.cards: позиция ${row.position} коллекции ${row.destination} отвергнута дважды`,
      )
    }
    rejectedCardSlots.add(slot)
  }

  /* Отказы целей, пришедших канонической ссылкой. Ссылки непригодной формы
     целями не становились и считаются отдельно — `nonCanonicalLinks`. */
  const failedTargetRefs = snapshot.rejected.targets
    .filter((row) => row.code !== UNSUPPORTED_SHAPE_CODE)
    .map((row) => row.ref)
  if (new Set(failedTargetRefs).size !== failedTargetRefs.length) {
    throw new TypeError(`${where}.rejected.targets: одна цель отвергнута дважды`)
  }
  const evidenceKeys = new Set(targetKeys)
  const bothWays = failedTargetRefs.filter((ref) => evidenceKeys.has(ref))
  if (bothWays.length) {
    throw new TypeError(
      `${where}: цель ${bothWays[0]} одновременно наблюдена и отвергнута — `
      + 'одно из двух неправда',
    )
  }
  if (snapshot.catalogueTargetEvidence.length + failedTargetRefs.length
    !== snapshot.counters.catalogueTargetsFound) {
    throw new TypeError(
      `${where}.counters.catalogueTargetsFound: ${snapshot.counters.catalogueTargetsFound} `
      + `при ${snapshot.catalogueTargetEvidence.length} свидетельствах и ${failedTargetRefs.length} отказах — `
      + 'каждая цель обязана попасть ровно в одно из двух',
    )
  }
  if (collectionKeys.size !== snapshot.counters.collectionsFound
    || directPoiKeys.size !== snapshot.counters.directPoisFound) {
    throw new TypeError(
      `${where}: счётчики (${snapshot.counters.collectionsFound} / ${snapshot.counters.directPoisFound}) `
      + `не сходятся с ролями в свидетельствах (${collectionKeys.size} / ${directPoiKeys.size})`,
    )
  }
  if (reachable.size !== snapshot.counters.poisFound) {
    throw new TypeError(
      `${where}.counters.poisFound: ${snapshot.counters.poisFound} при ${reachable.size} достижимых объектах`,
    )
  }
  if (snapshot.counters.recordsBuilt !== snapshot.records.length) {
    throw new TypeError(
      `${where}.counters.recordsBuilt: ${snapshot.counters.recordsBuilt} при ${snapshot.records.length} записях`,
    )
  }
  if (snapshot.counters.poisVisited !== snapshot.records.length + snapshot.rejected.pois.length) {
    throw new TypeError(
      `${where}.counters.poisVisited: ${snapshot.counters.poisVisited} при ${snapshot.records.length} записях `
      + `и ${snapshot.rejected.pois.length} отказах объектов — посещение обязано сходиться с исходом`,
    )
  }
  /*
   * Сравнения «посещено больше, чем найдено» здесь БОЛЬШЕ НЕТ — оно стало
   * недостижимым, когда отказы объектов связали с достижимым множеством.
   * Посещение пришпилено строкой выше к сумме «записи + отказы»; каждая
   * запись достижима по разрешению размещения, каждый отказ — по проверке
   * связности, и пересекаться они не могут. Значит посещение не превысит
   * найденное ни при каких данных. Недостижимую проверку не убивает ни одна
   * мутация, то есть её никто не проверяет, — а такую в этом файле не держат.
   */

  /* ── Только для ПОЛНОГО снимка ── */
  if (snapshot.complete) {
    if (reachable.size !== recordKeys.length || recordKeys.some((key) => !reachable.has(key))) {
      throw new TypeError(
        `${where}: снимок объявлен полным, но достижимых объектов ${reachable.size} `
        + `при ${recordKeys.length} записях`,
      )
    }
    if (snapshot.counters.poisVisited !== snapshot.counters.poisFound) {
      throw new TypeError(
        `${where}: у полного снимка найдено ${snapshot.counters.poisFound}, посещено `
        + `${snapshot.counters.poisVisited} — обход обязан дойти до каждого`,
      )
    }
  }

  /* Домен отпечатка — версия САМОГО снимка: `v1` проверяется доменом `v1`. */
  if (snapshot.snapshotDigest !== sha256Of(snapshotCovered(snapshot), `${snapshotSpec}#snapshot`)) {
    throw new TypeError(`${where}.snapshotDigest: не сходится с содержимым снимка`)
  }
}
