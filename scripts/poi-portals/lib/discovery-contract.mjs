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
 * Роли, которые может иметь страница НИЖЕ каталога. Каталог один, и он лежит
 * в `catalogueEvidence`.
 *
 * ВЫВЕДЕНЫ из `PAGE_ROLES`, а не набраны рядом. Этот же набор отвечает сразу
 * на три вопроса: какой может быть роль цели каталога, какой — роль элемента
 * порядка коллекции и какой — роль вложенной коллекции. Три рукописные копии
 * одного списка разошлись бы молча, и роль, добавленная в одну, осталась бы
 * невозможной в двух других.
 */
export const NON_CATALOGUE_ROLES = Object.freeze(PAGE_ROLES.filter((role) => role !== 'catalogue'))

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
 * ТРИ ВЕРСИИ ФОРМАТА, И ОНИ НЕ СМЕШИВАЮТСЯ.
 *
 * `v1` — опубликованный формат: два вида размещения, два исхода
 * классификатора, порядок без вида коллекции. ЗАМОРОЖЕН и по-прежнему
 * читается: снимки, снятые до 20.08.2026, обязаны проверяться теми
 * правилами, по которым были построены.
 *
 * `v2` — добавлены `containerChild`, `containerTopologyAmbiguous` и
 * `orderRecord.collectionKind`. ТОЖЕ ЗАМОРОЖЕН: по нему снят полный обход
 * 21.08.2026, и он обязан читаться своими правилами — в частности, у него
 * `--limit` действительно экономил сеть, и нижняя граница обменов `v3` к нему
 * неприменима.
 *
 * `v3` — текущий формат: граф коллекций. Порядок стал последовательностью
 * элементов с ролью, появились свидетельства вложенных коллекций и канал
 * отказа узла, счётчик коллекций разделён по происхождению, `poisVisited`
 * переименован в `recordsAttempted`.
 *
 * Прежде новые состояния были добавлены в закрытые перечисления, а версия
 * осталась `v1`, и два несовместимых формата назывались одним именем. Это
 * ошибка уровня контракта: отпечаток `v1`-записи невозможно было отличить
 * от отпечатка записи с новым видом размещения. Домены отпечатков выведены
 * ИЗ ВЕРСИИ, поэтому байты трёх форматов не совпадают ни при каких данных.
 *
 * `poi-fact-lead/v1` не менялся и остаётся `v1`.
 */
export const DISCOVERY_RECORD_SPEC_V1 = 'poi-discovery-record/v1'
export const ORDER_SPEC_V1 = 'poi-discovery-order/v1'
export const SNAPSHOT_SPEC_V1 = 'poi-discovery-snapshot/v1'

export const DISCOVERY_RECORD_SPEC_V2 = 'poi-discovery-record/v2'
export const ORDER_SPEC_V2 = 'poi-discovery-order/v2'
export const SNAPSHOT_SPEC_V2 = 'poi-discovery-snapshot/v2'

/**
 * `v3` — ГРАФ КОЛЛЕКЦИЙ. Измерено полным обходом 21.08.2026.
 *
 * Карточка внутри ранжированной коллекции ведёт не обязательно на объект:
 * из 1 170 «объектов» первого полного обхода 29 оказались коллекциями. 28 из
 * них каталог уже классифицировал сам, и второй запрос отверг fetch-boundary
 * кодом `urlRepeated`; 29-я — `e5041` — коллекция, которой среди целей
 * каталога нет вовсе, и она разобралась как сломанный объект
 * (`structureMismatch`). Настоящий уникальный корпус — 1 141 объект.
 *
 * Поэтому `v3` меняет ровно одно место формата: порядок коллекции перестаёт
 * быть списком ключей объектов и становится ОДНОЙ дискриминированной
 * последовательностью элементов, каждый из которых явно `poi` либо
 * `collection`. Две параллельные таблицы — «объекты» и «вложенные коллекции»
 * — здесь не заводятся: они разошлись бы молча, и элемент, попавший в одну,
 * исчез бы из порядка страницы.
 *
 * Формат ЗАПИСИ при этом НЕ МЕНЯЕТСЯ и остаётся `v2`: ни полей, ни закрытых
 * перечислений, ни доменов отпечатков запись не приобретает. Поднять её
 * версию значило бы объявить несовместимыми байты, которые совпадают. То,
 * что два формата снимка ссылаются на один формат записи, проверяется
 * исполнением — см. `indexPoliciesBy`.
 */
export const ORDER_SPEC_V3 = 'poi-discovery-order/v3'
export const SNAPSHOT_SPEC_V3 = 'poi-discovery-snapshot/v3'

export const DISCOVERY_RECORD_SPEC = DISCOVERY_RECORD_SPEC_V2
export const FACT_LEAD_SPEC = 'poi-fact-lead/v1'
export const ORDER_SPEC = ORDER_SPEC_V3
export const SNAPSHOT_SPEC = SNAPSHOT_SPEC_V3

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

/**
 * Причины, по которым снимок не является полным. ЗАКРЫТЫЙ СПИСОК ПО ВЕРСИИ.
 *
 * Список входит в `VERSION_POLICY`, а не стоит один на все форматы. Иначе
 * причина, заведённая для `v3`, немедленно стала бы законной и в
 * замороженном `v1`: старый снимок объявил бы причину, которой его обход не
 * умел порождать, и «заморожен» снова стало бы словом.
 */
export const INCOMPLETE_REASONS_V12 = Object.freeze([
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
 * `v3` теряет `budgetInsufficient` и приобретает две причины узла графа.
 *
 * `budgetInsufficient` был ОБЪЯВЛЯЕМОЙ причиной: обход считал нижнюю границу
 * оставшихся обменов и не начинал уровень объектов целиком. Уровней у графа
 * нет — роль карточки выясняется только её страницей, — поэтому нехватка
 * бюджета перестаёт быть решением обхода и становится отказом КОНКРЕТНОГО
 * узла с кодом `networkBudgetExhausted`. Объявлять её вдобавок значило бы
 * считать одну и ту же нехватку дважды: один раз словом, другой — отказами.
 *
 * `nodeFetchFailed` и `nodeStructureMismatch` — те же два исхода, что у целей
 * каталога и у объектов, но для страницы, на которую сослалась коллекция и
 * чью роль установить не удалось. Сводить их к `poiStructureMismatch` нельзя:
 * роль как раз и неизвестна, а отказ объекта утверждал бы, что она измерена.
 */
export const INCOMPLETE_REASONS_V3 = Object.freeze([
  'cardRejected',
  'limitApplied',
  'nodeFetchFailed',
  'nodeStructureMismatch',
  'poiStructureMismatch',
  'targetFetchFailed',
  'targetStructureMismatch',
  'unsupportedCatalogueLinkShape',
])

/** Текущий формат. Прежнее имя сохранено: им пользуются потребители снимка. */
export const INCOMPLETE_REASONS = INCOMPLETE_REASONS_V3

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

/**
 * РОЛЬ СТРАНИЦЫ ПРОТИВОРЕЧИТ СЕМЕЙСТВУ ЕЁ АДРЕСА. Только `v3`.
 *
 * `ROLES_BY_FAMILY` описывает измеренное: суффиксный и вложенный адрес бывают
 * только объектами. До `v3` эта матрица применялась лишь на построении
 * порядка — то есть уже ПОСЛЕ обхода, и противоречие роняло бы прогон
 * исключением вместо отказа. В графе такая страница встречается карточкой,
 * поэтому противоречие обязано быть закрытым кодом отказа узла, а не
 * поломкой: иначе одна страница неизмеренной формы уносит весь обход.
 *
 * Кода нет ни в `v1`, ни в `v2`: их обход матрицу на этом месте не применял,
 * и приписать им код задним числом значило бы разморозить формат.
 */
export const ROLE_FAMILY_MISMATCH_CODE = 'roleFamilyMismatch'
export const PAGE_REJECTION_CODES_V3 = Object.freeze([
  ...PAGE_REJECTION_CODES, ROLE_FAMILY_MISMATCH_CODE,
])

/** Ссылка каталога, не попавшая ни в одно измеренное семейство адресов. */
const UNSUPPORTED_SHAPE_CODE = 'unsupportedCatalogueLinkShape'

/**
 * ОТКАЗ ДО ОБМЕНА И ОТКАЗ ПОСЛЕ НЕГО — РАЗНЫЕ ФАКТЫ, И РАЗЛИЧАЕТ ИХ НЕ КОД.
 *
 * Нижняя граница числа обменов считает страницы, которые обход обязан был
 * получить. Отвергнутая страница входит в этот счёт НЕ ВСЕГДА: часть отказов
 * случается раньше первого байта, и прибавлять их значило бы требовать
 * обменов, которых не было.
 *
 * ПЕРВАЯ РЕДАКЦИЯ КЛАССИФИЦИРОВАЛА ПО ОДНОМУ КОДУ — И ЭТО БЫЛО НЕВЕРНО.
 * Она снималась с низкоуровневой функции `canonicalDiscoveryUrl`, где
 * `urlNotCanonical` действительно возникает до запроса. Но `fetchHtmlPage`
 * зовёт тот же канонизатор ВТОРОЙ раз — для `Location` уже полученного
 * 3xx-ответа. Аудит 24.08 предъявил снимок настоящего обхода: цель
 * `japan-guide:e1001` отвергнута с `urlNotCanonical`, обменов было 7, а
 * контракт принимал объявленные 6. Тот же код, две разные стадии.
 *
 * ПОЭТОМУ КЛАССИФИКАЦИЯ КОНТЕКСТНАЯ: она снята с ПУТИ ПОТРЕБИТЕЛЯ, а не с
 * функции, и у каждого канала отказа свой список. Рассуждение для `v3`:
 *
 *   · В `visit()` цель и узел приходят с УЖЕ каноническим адресом. Ссылку
 *     каталога канонизирует `parseCatalogue`, ссылку карточки —
 *     `parseCollection`; негодная ссылка каталога уходит отдельным кодом
 *     `unsupportedCatalogueLinkShape`, негодная ссылка карточки — в канал
 *     карточек. Значит первый `canonicalDiscoveryUrl` внутри `fetchHtmlPage`
 *     на этих адресах отказать не может, и любой код канонизации у цели или
 *     узла пришёл со ВТОРОГО вызова — то есть после 3xx. Обмен состоялся.
 *   · `urlRepeated` — тот же случай. Кэш узлов `visit()` не даёт запросить
 *     один `sourceKey` дважды, а ключ выводится из канонического адреса
 *     взаимно однозначно. Повтор возможен только тогда, когда РЕДИРЕКТ увёл
 *     на уже запрошенный адрес, — и снова после обмена.
 *   · `networkBudgetExhausted` — единственный, кто остаётся досетевым:
 *     `pacer.take` бросает его ДО инкремента, и на нулевом шаге это ровно
 *     «обмена не было».
 *   · `unsupportedCatalogueLinkShape` — досетевой и только у ЦЕЛЕЙ: ссылка
 *     такой формы не запрашивалась вовсе. У узла графа он непредставим, и
 *     это отдельная проверка ниже, а не молчаливое допущение.
 *
 * ОСТАТОК ЗАКРЫТ НЕ ЗДЕСЬ, А ПОТОЛКОМ. `networkBudgetExhausted` тоже бывает
 * на шаге редиректа — тогда обмен состоялся, а слагаемое не прибавлено.
 * Прежняя редакция называла это «не больше одного обмена» и была НЕВЕРНА:
 * одна цель успевает получить до `maxRedirects` ответов 3xx прежде, чем
 * упереться в потолок, и аудит 25.08 предъявил снимок с четырьмя настоящими
 * обменами, объявлявший два. Считать этот код состоявшимся обменом всё равно
 * нельзя — честный снимок, у которого бюджет кончился до первого запроса
 * цели, отвергался бы как подделка. Поэтому дыру закрывает не классификация,
 * а `networkPolicy` в самом снимке: объявленное исчерпание обязано совпасть
 * с потолком. Проверка — при нижней границе в `assertDiscoverySnapshot`.
 *
 * СПИСКИ ДОСЕТЕВЫХ ЗАКРЫТЫ, «после обмена» — их дополнение. Направление
 * выбрано fail-closed: код, забытый в списке, будет сочтён состоявшимся
 * обменом и ПОДНИМЕТ границу, то есть отвергнет снимок. Обратное направление
 * при забытом коде границу бы опустило и пропустило подделку.
 */
const PRE_NETWORK_BY_CHANNEL_V3 = Object.freeze({
  targets: Object.freeze(['networkBudgetExhausted', UNSUPPORTED_SHAPE_CODE]),
  nodes: Object.freeze(['networkBudgetExhausted']),
})

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
const STRUCTURE_CODES = Object.freeze(new Set([
  'structureMismatch', ...PAGE_ROLE_CODES, ROLE_FAMILY_MISMATCH_CODE,
]))

/**
 * Отказ по структуре, а не по сети. ОДИН реестр на контракт и на обход.
 *
 * Обход выводит из кода причину неполноты (`…StructureMismatch` против
 * `…FetchFailed`) и обязан делать это ровно тем же множеством, которым
 * проверка снимка выводит её обратно. Вторая копия множества в обходе
 * разошлась бы молча: код, отнесённый там к сети, а здесь к структуре, дал бы
 * снимок, у которого причины не сходятся с отказами.
 */
export function isStructureRejection(code) {
  return STRUCTURE_CODES.has(code)
}

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
const ORDER_KEYS_V2 = Object.freeze([
  'destinationSourceKey', 'sourcePageDigest', 'collectionKind', 'order', 'orderDigest',
])

/**
 * `v3`: `order` ЗАМЕНЁН на `items` — не дополнен им.
 *
 * Держать оба поля значило бы держать два источника правды об одной
 * последовательности DOM. Разойдясь на один элемент, они дали бы порядок,
 * который сам себе противоречит, и отпечаток покрыл бы только одну из копий.
 */
const ORDER_KEYS_V3 = Object.freeze([
  'destinationSourceKey', 'sourcePageDigest', 'collectionKind', 'items', 'orderDigest',
])

/** Элемент порядка: РОЛЬ И КЛЮЧ, оба обязательны. Умолчания здесь нет. */
export const ORDER_ITEM_KEYS = Object.freeze(['role', 'sourceKey'])

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
 * НАБОР ПОЛЕЙ СНИМКА, СЧЁТЧИКОВ И КАНАЛОВ ОТКАЗА — тоже часть версии.
 *
 * Объявлены здесь, выше `VERSION_POLICY`, ровно по той же причине, что и
 * поля порядка: реестр обязан собираться из уже объявленных величин.
 */
const SNAPSHOT_KEYS_V12 = Object.freeze([
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

/**
 * `v3` добавляет ДВА поля снимка.
 *
 * `nestedCollectionEvidence` — свидетельства коллекций НИЖЕ каталога.
 * `catalogueTargetEvidence` остаётся свидетельством ровно 208 прямых целей
 * каталога и своего смысла не меняет. Переименовать его задним числом в
 * «свидетельства всех коллекций» значило бы объявить, что каталог перечислял
 * `e5041`, — а он её не перечислял.
 *
 * `networkPolicy` — ПОТОЛКИ, ПОД КОТОРЫМИ ШЁЛ ОБХОД. `maxRedirects` бывает и
 * нулём: это режим «за редиректами не ходить», а не отсутствие значения.
 *
 * Без них снимок не может сказать правду о собственном исчерпании бюджета.
 * Аудит 25.08 показал, чем это кончается: при `maxRedirects` = 2 одна цель
 * успевает получить два 302 и лишь на третьем `take` упереться в потолок.
 * Её отказ называется `networkBudgetExhausted` — исход, обмена не стоивший, —
 * а два обмена уже потрачены. Дальше каждая следующая цель падает на нулевом
 * шаге, тоже без обмена, и снимок с четырьмя настоящими обменами объявлял
 * два. Прежняя формулировка «утаить можно не больше одного обмена» была
 * неверна: скрыть можно до `maxRedirects` обменов, и число это снимок обязан
 * назвать сам.
 */
const NETWORK_POLICY_KEYS = Object.freeze(['maxNetworkRequests', 'maxRedirects'])
const SNAPSHOT_KEYS_V3 = Object.freeze([
  'contractVersion',
  'scope',
  'entryUrl',
  'complete',
  'incompleteReasons',
  'networkPolicy',
  'robotsEvidence',
  'catalogueEvidence',
  'catalogueTargetEvidence',
  'nestedCollectionEvidence',
  'orderRecords',
  'records',
  'rejected',
  'counters',
  'snapshotDigest',
])

const COUNTER_KEYS_V12 = Object.freeze([
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

/**
 * `v3` РАЗДЕЛЯЕТ КОЛЛЕКЦИИ ПО ПРОИСХОЖДЕНИЮ, а не переносит старое имя.
 *
 * `collectionsFound` в графе двусмысленно: 150 коллекций каталога и одна
 * вложенная — это 151 коллекция, но не 151 цель каталога, и по одному числу
 * нельзя сказать, какая из двух величин имелась в виду. Имена выбраны один
 * раз и закреплены exact-key контрактом; автоматически переносить прежнее
 * имя было нельзя именно потому, что определения у него не было.
 *
 * ПО ТОЙ ЖЕ ПРИЧИНЕ `poisVisited` СТАЛ `recordsAttempted`.
 *
 * У `v1` и `v2` посещение страницы объекта и попытка построить запись были
 * одним событием: предел резал список ДО получения страниц, и непосещённая
 * страница записи не получала. В графе страница объекта получена ещё на
 * классификации — иначе нельзя было узнать, что это объект, — и «посещено 50»
 * при 1141 полученной странице означало бы ровно обратное правде. Величина
 * осталась той же (сколько раз обход пытался построить запись), а имя
 * приведено к ней. В `v1` и `v2` поле не трогается: там оно верно.
 */
const COUNTER_KEYS_V3 = Object.freeze([
  'networkRequests',
  'catalogueTargetsFound',
  'catalogueCollectionsFound',
  'nestedCollectionsFound',
  'directPoisFound',
  'poisFound',
  'recordsAttempted',
  'recordsBuilt',
  'nonCanonicalLinks',
  'unknownAdmissionLabels',
  'emptyAdmissionValues',
])

/** Имя счётчика попыток построить запись — по версии, один реестр. */
const ATTEMPT_COUNTER = Object.freeze({ v12: 'poisVisited', v3: 'recordsAttempted' })
const attemptCounterName = (policy) =>
  (policy.counterKeys.includes(ATTEMPT_COUNTER.v3) ? ATTEMPT_COUNTER.v3 : ATTEMPT_COUNTER.v12)

/**
 * КАНАЛЫ ОТКАЗА. `v3` добавляет четвёртый — узел графа с неустановленной
 * ролью.
 *
 * Сводить его к любому из трёх прежних нельзя: `targets` означает цель
 * каталога, `cards` — сломанную разметку карточки, `pois` — страницу, про
 * которую ИЗВЕСТНО, что она объект. Страница, на которую сослалась
 * коллекция и чью роль установить не удалось, не является ни тем, ни другим,
 * ни третьим, и запись её в `pois` утверждала бы измерение, которого нет.
 */
const REJECTION_CHANNELS_V12 = Object.freeze(['targets', 'cards', 'pois'])
const REJECTION_CHANNELS_V3 = Object.freeze(['targets', 'cards', 'nodes', 'pois'])

/**
 * ПОЛУЧАЕТ ЛИ ОБХОД КАЖДУЮ КЛАССИФИЦИРОВАННУЮ СТРАНИЦУ.
 *
 * Это свойство ФОРМАТА, а не удобство читателя, и вывести его из наборов
 * ключей нельзя. У `v1` и `v2` предел резал список объектов ДО получения их
 * страниц: снимок canary честно объявлял 259 обменов при 1170 найденных
 * объектах, потому что 1120 страниц не запрашивались вовсе. В графе роль
 * карточки выясняется только её страницей, поэтому получены все — и число
 * обменов снизу ограничено самим составом снимка.
 *
 * Отсюда нижняя граница обменов, проверяемая ниже, применима к `v3` и
 * НЕВЕРНА для замороженных версий. Флаг объявлен, а не угадан по наличию
 * поля: совпадение с `nestedCollectionEvidence` сегодня случайно, а завтра
 * формат мог бы приобрести одно без другого.
 */

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
    snapshotKeys: SNAPSHOT_KEYS_V12,
    counterKeys: COUNTER_KEYS_V12,
    rejectionChannels: REJECTION_CHANNELS_V12,
    placementKinds: PLACEMENT_KINDS_V1,
    pageRejectionCodes: V1_PAGE_REJECTION_CODES,
    cardRejectionCodes: CARD_REJECTION_CODES,
    omissionCodes: V1_OMISSION_CODES,
    incompleteReasons: INCOMPLETE_REASONS_V12,
    urlFamilies: V1_URL_FAMILIES,
    collectionKind: false,
    everyClassifiedPageFetched: false,
    /* Границы обменов у замороженной версии нет — значит нет и классификации
       отказов по стадии. `null`, а не пустая таблица: пустая означала бы «все
       отказы после обмена», то есть действующее правило. */
    preNetworkRejectionCodes: null,
  }),
  [SNAPSHOT_SPEC_V2]: Object.freeze({
    snapshot: SNAPSHOT_SPEC_V2,
    record: DISCOVERY_RECORD_SPEC_V2,
    order: ORDER_SPEC_V2,
    orderKeys: ORDER_KEYS_V2,
    snapshotKeys: SNAPSHOT_KEYS_V12,
    counterKeys: COUNTER_KEYS_V12,
    rejectionChannels: REJECTION_CHANNELS_V12,
    placementKinds: PLACEMENT_KINDS,
    pageRejectionCodes: PAGE_REJECTION_CODES,
    cardRejectionCodes: CARD_REJECTION_CODES,
    omissionCodes: OMISSION_CODES,
    incompleteReasons: INCOMPLETE_REASONS_V12,
    urlFamilies: URL_FAMILIES,
    collectionKind: true,
    everyClassifiedPageFetched: false,
    preNetworkRejectionCodes: null,
  }),
  [SNAPSHOT_SPEC_V3]: Object.freeze({
    snapshot: SNAPSHOT_SPEC_V3,
    /* Формат записи у `v3` тот же, что у `v2`, и это утверждение проверяется
       исполнением: `indexPoliciesBy` уронит модуль, если два формата снимка
       объявят один формат записи с разными правилами. */
    record: DISCOVERY_RECORD_SPEC_V2,
    order: ORDER_SPEC_V3,
    orderKeys: ORDER_KEYS_V3,
    snapshotKeys: SNAPSHOT_KEYS_V3,
    counterKeys: COUNTER_KEYS_V3,
    rejectionChannels: REJECTION_CHANNELS_V3,
    placementKinds: PLACEMENT_KINDS,
    pageRejectionCodes: PAGE_REJECTION_CODES_V3,
    cardRejectionCodes: CARD_REJECTION_CODES,
    omissionCodes: OMISSION_CODES,
    incompleteReasons: INCOMPLETE_REASONS_V3,
    urlFamilies: URL_FAMILIES,
    collectionKind: true,
    everyClassifiedPageFetched: true,
    preNetworkRejectionCodes: PRE_NETWORK_BY_CHANNEL_V3,
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
 *
 * ОДИН ПОДФОРМАТ — ОДИН НАБОР ПРАВИЛ, И ЭТО ПРОВЕРЯЕТСЯ, А НЕ ПОДРАЗУМЕВАЕТСЯ.
 *
 * `v3` намеренно ссылается на формат записи `v2`: запись не менялась. Прежний
 * `Object.fromEntries` при таком совпадении молча оставил бы последнюю
 * политику и подсунул бы `v2`-записи правила `v3` — расхождение, которое
 * никак себя не проявило бы, пока наборы совпадают, и проявилось бы молчаливо
 * в тот день, когда они разойдутся. Здесь совпадение ключа разрешено, а
 * расхождение правил — нет: модуль не загрузится.
 *
 * НАБОР ПОЛИТИК — ПАРАМЕТР, И ЭТО НЕ УДОБСТВО. На замороженном литерале
 * `VERSION_POLICY` отказ недостижим по построению: расхождения там нет и
 * взяться ему неоткуда. Проверка, которую невозможно провалить, ничего не
 * проверяет — её не убивает ни одна мутация. Параметр делает отказ
 * достижимым синтетической парой политик, и мутация, снимающая сверку,
 * честно умирает.
 */
export function indexPoliciesBy(field, shared, what, policies = VERSION_POLICY) {
  const index = {}
  for (const policy of Object.values(policies)) {
    const key = policy[field]
    const first = index[key]
    if (!first) { index[key] = policy; continue }
    for (const name of shared) {
      if (JSON.stringify(first[name]) === JSON.stringify(policy[name])) continue
      throw new TypeError(
        `VERSION_POLICY: ${first.snapshot} и ${policy.snapshot} объявляют один ${what} `
        + `${key}, но расходятся в «${name}» — у одного формата не может быть двух наборов правил`,
      )
    }
  }
  return Object.freeze(index)
}

/** Поля политики, которые относятся к ЗАПИСИ, и только они. */
const RECORD_POLICY_FIELDS = Object.freeze(['placementKinds', 'omissionCodes', 'urlFamilies'])
/** Поля политики, которые относятся к ПОРЯДКУ, и только они. */
const ORDER_POLICY_FIELDS = Object.freeze(['orderKeys', 'urlFamilies', 'collectionKind'])

const POLICY_BY_RECORD_SPEC = indexPoliciesBy('record', RECORD_POLICY_FIELDS, 'формат записи')
const POLICY_BY_ORDER_SPEC = indexPoliciesBy('order', ORDER_POLICY_FIELDS, 'формат порядка')

/**
 * КАКИМ ПОЛЕМ ФОРМАТ ХРАНИТ ПОСЛЕДОВАТЕЛЬНОСТЬ — ВЫВЕДЕНО ИЗ ЕГО КЛЮЧЕЙ.
 *
 * Не отдельное поле политики: оно было бы второй записью того же факта и
 * могло бы разойтись с `orderKeys`. Опознаётся форматом, а не формой
 * переданного объекта: разбор «по тому, что лежит» принял бы за `v3` любой
 * объект с полем `items`.
 */
const ORDER_FIELD_BY_SPEC = Object.freeze(Object.fromEntries(
  Object.values(VERSION_POLICY).map((policy) =>
    [policy.order, policy.orderKeys.includes('items') ? 'items' : 'order'])))

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

/* ── poi-discovery-record — v1/v2 (формат записи в v3 не менялся) ────── */

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
   * Набор ключей у v1 и v2 один, поэтому проверить его можно раньше
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
/**
 * ЧТО ИМЕННО ПОКРЫВАЕТ ОТПЕЧАТОК — по одной записи на формат.
 *
 * Домен отпечатка — сама версия, поэтому байты `v1`, `v2` и `v3` не совпадают
 * ни при каких данных. У `v3` в покрытие входит РОЛЬ каждого элемента: без
 * неё достаточно было бы переписать `poi` на `collection`, не тронув ни
 * ключей, ни порядка, и подделка прошла бы пересчёт.
 */
const ORDER_DIGEST_COVER = Object.freeze({
  [ORDER_SPEC_V1]: (draft) => ({
    destinationSourceKey: draft.destinationSourceKey,
    sourcePageDigest: draft.sourcePageDigest,
    order: [...draft.order],
  }),
  [ORDER_SPEC_V2]: (draft) => ({
    destinationSourceKey: draft.destinationSourceKey,
    sourcePageDigest: draft.sourcePageDigest,
    collectionKind: draft.collectionKind,
    order: [...draft.order],
  }),
  [ORDER_SPEC_V3]: (draft) => ({
    destinationSourceKey: draft.destinationSourceKey,
    sourcePageDigest: draft.sourcePageDigest,
    collectionKind: draft.collectionKind,
    items: draft.items.map((item) => ({ role: item.role, sourceKey: item.sourceKey })),
  }),
})

/**
 * ЭЛЕМЕНТ ПОРЯДКА. Роль обязательна и умолчания не имеет.
 *
 * Умолчание «наверное, объект» и есть тот самый дефект: обход `v2` считал
 * объектом КАЖДУЮ карточку, и 29 коллекций из 1 170 «объектов» полного
 * обхода — цена этого умолчания.
 */
export function orderItem(role, sourceKey) {
  assertEnum(role, NON_CATALOGUE_ROLES, `${ORDER_SPEC}.items[].role`)
  assertNonEmptyString(sourceKey, `${ORDER_SPEC}.items[].sourceKey`)
  return deepFreeze({ role, sourceKey })
}

/** Ключи последовательности в порядке DOM — независимо от версии формата. */
export function orderSequence(row, spec = ORDER_SPEC) {
  return ORDER_FIELD_BY_SPEC[spec] === 'items'
    ? row.items.map((item) => item.sourceKey)
    : row.order
}

/**
 * Ключи ОБЪЕКТОВ этой коллекции.
 *
 * До `v3` вопрос не имел смысла: в порядке лежали только объекты. Начиная с
 * `v3` его задают везде, где считается достижимое множество, — и ответ
 * берётся из роли элемента, а не из формы ключа.
 */
export function orderedPoiKeys(row, spec = ORDER_SPEC) {
  return ORDER_FIELD_BY_SPEC[spec] === 'items'
    ? row.items.filter((item) => item.role === 'poi').map((item) => item.sourceKey)
    : [...row.order]
}

/** Ключи ВЛОЖЕННЫХ КОЛЛЕКЦИЙ этой коллекции. До `v3` их не бывает вовсе. */
export function orderedCollectionKeys(row, spec = ORDER_SPEC) {
  return ORDER_FIELD_BY_SPEC[spec] === 'items'
    ? row.items.filter((item) => item.role === 'collection').map((item) => item.sourceKey)
    : []
}

export function orderDigest(draft, spec = ORDER_SPEC) {
  const cover = ORDER_DIGEST_COVER[spec]
  const policy = POLICY_BY_ORDER_SPEC[spec]
  if (!cover || !policy) throw new TypeError(`orderDigest: неизвестная версия порядка ${JSON.stringify(spec)}`)
  assertNonEmptyString(draft.destinationSourceKey, `${spec}.destinationSourceKey`)
  assertSha256(draft.sourcePageDigest, `${spec}.sourcePageDigest`)
  if (policy.collectionKind) assertEnum(draft.collectionKind, COLLECTION_KINDS, `${spec}.collectionKind`)
  const field = ORDER_FIELD_BY_SPEC[spec]
  if (!Array.isArray(draft[field])) throw new TypeError(`${spec}.${field}: ожидается массив`)
  const seen = new Set()
  for (const key of orderSequence(draft, spec)) {
    assertNonEmptyString(key, `${spec}.${field}[]`)
    if (seen.has(key)) throw new TypeError(`${spec}: повтор ключа ${key} в порядке коллекции`)
    seen.add(key)
  }
  return sha256Of(cover(draft), spec)
}

export function buildOrderRecord({ destinationSourceKey, sourcePageDigest, items, collectionKind }) {
  assertEnum(collectionKind, COLLECTION_KINDS, `${ORDER_SPEC}.collectionKind`)
  if (!Array.isArray(items)) throw new TypeError(`${ORDER_SPEC}.items: ожидается массив`)
  const draft = {
    destinationSourceKey,
    sourcePageDigest,
    collectionKind,
    /* Через `orderItem`, а не копированием: роль обязана пройти закрытое
       перечисление ЗДЕСЬ, а не только в проверке ниже. */
    items: items.map((item) => orderItem(item?.role, item?.sourceKey)),
  }
  const record = { ...draft, orderDigest: orderDigest(draft, ORDER_SPEC) }
  assertOrderRecord(record, ORDER_SPEC, ORDER_SPEC)
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
  const field = ORDER_FIELD_BY_SPEC[spec]
  if (!Array.isArray(record[field])) throw new TypeError(`${where}.${field}: ожидается массив`)
  if (field === 'items') {
    /*
     * РОЛЬ ЭЛЕМЕНТА ПРОВЕРЯЕТСЯ ТОЙ ЖЕ МАТРИЦЕЙ, ЧТО И РОЛЬ СВИДЕТЕЛЬСТВА.
     *
     * `ROLES_BY_FAMILY` описывает измеренное: суффиксный и вложенный адрес
     * бывают только объектами. Поэтому элемент `collection` с ключом
     * `japan-guide:e3034_001` отвергается ЗДЕСЬ, а не позже связностью:
     * связность сказала бы «такой коллекции в снимке нет», то есть назвала бы
     * причиной отсутствие свидетельства, а не невозможность роли.
     */
    record.items.forEach((item, index) => {
      const at = `${where}.items[${index}]`
      assertExactKeys(item, ORDER_ITEM_KEYS, at)
      assertEnum(item.role, NON_CATALOGUE_ROLES, `${at}.role`)
      assertNonEmptyString(item.sourceKey, `${at}.sourceKey`)
      assertKeyFamilyBy(policy, item.sourceKey, `${at}.sourceKey`, spec, item.role)
    })
  } else {
    record.order.forEach((key, index) =>
      assertKeyFamilyBy(policy, key, `${where}.order[${index}]`, spec, 'poi'))
  }
  assertSha256(record.orderDigest, `${where}.orderDigest`)
  /*
   * Наличие вида коллекции берётся ИЗ ПОЛИТИКИ, а не из сравнения с текущей
   * константой. Сравнение `spec === ORDER_SPEC` означало «всё, что не самая
   * свежая версия, вида не имеет» — и следующая версия формата унаследовала
   * бы правило `v1`, ничего не сломав заметно.
   */
  if (policy.collectionKind) assertEnum(record.collectionKind, COLLECTION_KINDS, `${where}.collectionKind`)
  if (record.orderDigest !== orderDigest(record, spec)) {
    throw new TypeError(
      `${where}.orderDigest: не сходится с порядком, ролями элементов, видом коллекции `
      + 'или байтами страницы',
    )
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

/* ── poi-discovery-snapshot — v1/v2/v3 ────────────────────────────────── */

/* Наборы ключей снимка, счётчиков и каналов отказа объявлены выше, рядом с
   `VERSION_POLICY`: они входят в неё и обязаны быть готовы к её сборке. */
const SCOPE_KEYS = Object.freeze(['kind', 'limit'])
const ROBOTS_KEYS = Object.freeze(['url', 'bytes', 'digest', 'observedAt', 'appliedGroups'])
const PAGE_REJECTION_KEYS = Object.freeze(['ref', 'code'])
const CARD_REJECTION_KEYS = Object.freeze(['destination', 'position', 'code'])
/**
 * Отказ УЗЛА ГРАФА: ключ страницы, коллекция, которая на неё сослалась, и код.
 *
 * `origin` обязателен и не выводится: узел попал в обход именно потому, что
 * его назвала конкретная коллекция, и без этого поля отказ нельзя ни
 * привязать к графу, ни отличить от выдуманного.
 */
const NODE_REJECTION_KEYS = Object.freeze(['ref', 'origin', 'code'])
/**
 * Счётчики больше НЕ называют все цели каталога направлениями.
 *
 * Измерение показало, что каталог перечисляет и коллекции, и объекты, поэтому
 * Прежнее имя счётчика объявляло направлением каждую цель — в том числе те, что
 * направлениями не являются. Теперь целей столько, сколько их перечислено, а
 * коллекции и прямые объекты считаются раздельно и обязаны в сумме давать
 * число целей: иначе цель осталась неклассифицированной, и снимок не полон.
 */
const TARGET_EVIDENCE_KEYS = Object.freeze(['sourceKey', 'evidence'])
const REASON_KEYS = Object.freeze(['code', 'count'])

/** Ссылка отказа: ключ источника либо сырой путь непригодной формы. */
const REJECTION_REF = /^[\x21-\x7e]{1,512}$/

/**
 * Что покрывает отпечаток снимка.
 *
 * Набор полей ВЫВЕДЕН из `snapshotKeys` политики, а не набран вторым списком:
 * поле, добавленное в формат и забытое здесь, осталось бы вне отпечатка, и
 * подменить его можно было бы, не тронув `snapshotDigest`. Именно поэтому
 * `nestedCollectionEvidence` не пришлось «не забыть» — его нельзя забыть.
 *
 * Два поля берутся не значением, а отпечатком: порядок и записи покрыты
 * своими собственными `orderDigest` и `observationDigest`.
 */
const SNAPSHOT_COVER_BY_FIELD = Object.freeze({
  orderRecords: (snapshot) => snapshot.orderRecords.map((row) => row.orderDigest),
  records: (snapshot) => snapshot.records.map((record) => record.observationDigest),
  contractVersion: (snapshot) => snapshot.contractVersion ?? SNAPSHOT_SPEC,
})

function snapshotCovered(snapshot, policy = null) {
  const spec = snapshot.contractVersion ?? SNAPSHOT_SPEC
  const keys = (policy ?? VERSION_POLICY[spec] ?? VERSION_POLICY[SNAPSHOT_SPEC]).snapshotKeys
  const covered = {}
  for (const field of keys) {
    if (field === 'snapshotDigest') continue
    const lens = SNAPSHOT_COVER_BY_FIELD[field]
    covered[field] = lens ? lens(snapshot) : snapshot[field]
  }
  return covered
}

/**
 * Сколько отказов каждого рода лежит в массивах.
 *
 * Причины неполноты не объявляются, а ВЫВОДЯТСЯ из отказов и счётчиков.
 * Иначе снимок мог бы нести три недоступных направления и пустой список
 * причин — и назвать себя полным.
 */
function derivedReasonCounts(snapshot, policy) {
  const targets = snapshot.rejected.targets
  const pois = snapshot.rejected.pois
  const derived = {
    targetFetchFailed: targets.filter(
      (row) => !STRUCTURE_CODES.has(row.code) && row.code !== UNSUPPORTED_SHAPE_CODE).length,
    targetStructureMismatch: targets.filter((row) => STRUCTURE_CODES.has(row.code)).length,
    unsupportedCatalogueLinkShape: targets.filter((row) => row.code === UNSUPPORTED_SHAPE_CODE).length,
    cardRejected: snapshot.rejected.cards.length,
    poiStructureMismatch: pois.filter((row) => STRUCTURE_CODES.has(row.code)).length,
  }
  /*
   * `poiFetchFailed` есть у `v1` и `v2` и НЕТ у `v3`.
   *
   * В графе страница объекта получена ещё на классификации: роль «объект»
   * означает, что байты уже в руках. Страница, чьи байты не пришли, роли не
   * получает вовсе и уходит отказом узла. Значит отказ объекта по сетевой
   * причине в `v3` непредставим — и держать причину, которую формат не может
   * породить, значило бы объявить состояние, которого нет.
   */
  if (policy.incompleteReasons.includes('poiFetchFailed')) {
    derived.poiFetchFailed = pois.filter((row) => !STRUCTURE_CODES.has(row.code)).length
  }
  /* Канал узлов есть только у `v3`, и выводить из него причины у форматов,
     которые его не знают, нельзя: там их не бывает. */
  if (policy.rejectionChannels.includes('nodes')) {
    const nodes = snapshot.rejected.nodes
    derived.nodeFetchFailed = nodes.filter((row) => !STRUCTURE_CODES.has(row.code)).length
    derived.nodeStructureMismatch = nodes.filter((row) => STRUCTURE_CODES.has(row.code)).length
  }
  return derived
}

/**
 * Причины, которых нет в массивах отказов и которые поэтому объявляются
 * прогоном: применённый предел и нехватка бюджета. Обе проверяются иначе —
 * через охват и счётчики.
 */
const DECLARED_REASONS = Object.freeze(['limitApplied', 'budgetInsufficient'])

/**
 * Пустые каналы отказа по версии — чтобы строитель не заводил своей копии
 * списка каналов и не мог забыть один из них.
 */
const emptyRejections = (policy) =>
  Object.fromEntries(policy.rejectionChannels.map((channel) => [channel, []]))

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
  networkPolicy,
  robotsEvidence,
  catalogueEvidence,
  catalogueTargetEvidence,
  nestedCollectionEvidence,
  orderRecords,
  records,
  rejected,
  counters,
}) {
  const policy = VERSION_POLICY[SNAPSHOT_SPEC]
  const reasons = [...incompleteReasons]
    .filter((reason) => reason.count > 0)
    .sort((a, b) => compareUtf8(a.code, b.code))
  const byRef = (a, b) => compareUtf8(a.ref, b.ref) || compareUtf8(a.code, b.code)
  const draft = {
    contractVersion: SNAPSHOT_SPEC,
    scope,
    entryUrl,
    complete: scope.kind === 'full' && reasons.length === 0,
    incompleteReasons: reasons,
    /* Потолки — часть снимка, а не окружения прогона: без них утверждение
       «бюджет исчерпан» нечем сверить. Значение НЕ подставляется по умолчанию
       — снимок без потолков не собирается вовсе. */
    networkPolicy,
    robotsEvidence,
    catalogueEvidence,
    catalogueTargetEvidence: sortedBy(catalogueTargetEvidence, (row) => row.sourceKey),
    nestedCollectionEvidence: sortedBy(nestedCollectionEvidence ?? [], (row) => row.sourceKey),
    orderRecords: sortedBy(orderRecords, (row) => row.destinationSourceKey),
    records: sortedBy(records, (record) => record.sourceKey),
    rejected: {
      ...emptyRejections(policy),
      targets: sortedWith(rejected.targets ?? [], byRef),
      cards: sortedWith(rejected.cards ?? [], (a, b) =>
        compareUtf8(a.destination, b.destination)
        || a.position - b.position
        || compareUtf8(a.code, b.code)),
      nodes: sortedWith(rejected.nodes ?? [], byRef),
      pois: sortedWith(rejected.pois ?? [], byRef),
    },
    counters,
  }
  const snapshot = { ...draft, snapshotDigest: sha256Of(snapshotCovered(draft, policy), SNAPSHOT_DIGEST_DOMAIN) }
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
  /* До чтения версии ярлык неизвестен, и НАБОР КЛЮЧЕЙ ТОЖЕ: у `v3` их на
     один больше. Поэтому версия читается первой — данными, а не обращением к
     свойству, — и только потом по ней берётся набор ключей. Проверять форму
     набором «текущей» версии значило бы объявить каждый снимок `v2`
     повреждённым за отсутствие поля, которого его формат не знал. */
  let where = label ?? SNAPSHOT_SPEC
  /*
   * ЧИТАЮТСЯ ВСЕ ВЕРСИИ. Правила берутся по версии САМОГО снимка: `v1` не
   * знает ни `containerChild`, ни `collectionKind`, `v2` не знает элементов
   * с ролью, и проверять их правилами `v3` значило бы не проверять вовсе.
   */
  const snapshotSpec = ownVersion(snapshot, where)
  if (!READABLE_SNAPSHOT_SPECS.includes(snapshotSpec)) {
    throw new TypeError(`${where}.contractVersion: чужая версия ${JSON.stringify(snapshotSpec)}`)
  }
  assertExactKeys(snapshot, VERSION_POLICY[snapshotSpec].snapshotKeys, where)
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

  /*
   * ── ПОТОЛКИ ОБХОДА — ЧАСТЬ СНИМКА, А НЕ ОКРУЖЕНИЯ ──
   *
   * Только там, где формат их объявляет.
   *
   * `maxNetworkRequests` не меньше ЕДИНИЦЫ: обход, которому не разрешён ни
   * один обмен, не получит даже `robots.txt` и снимка не произведёт вовсе.
   *
   * `maxRedirects` не меньше НУЛЯ. Ноль — законный режим «за редиректами не
   * ходить»: `fetchHtmlPage` делает ровно один шаг, и первый же 3xx даёт
   * `redirectLimit`. Прежняя редакция требовала здесь единицы и отвергала
   * снимок обычного обхода с нулём — проверено аудитом 25.08 через настоящий
   * `collectJapanGuideDiscovery`. Обоснование при том требовании было ложным:
   * бюджетные инварианты ниже при нуле работают без единого изменения, а
   * досетевой отказ отличается от исчерпания по коду и по каналу, а не по
   * числу разрешённых редиректов. Отрицательное значение по-прежнему
   * невозможно — это не режим, а бессмыслица.
   */
  if (policy.snapshotKeys.includes('networkPolicy')) {
    assertExactKeys(snapshot.networkPolicy, NETWORK_POLICY_KEYS, `${where}.networkPolicy`)
    assertInteger(snapshot.networkPolicy.maxNetworkRequests, `${where}.networkPolicy.maxNetworkRequests`, 1)
    assertInteger(snapshot.networkPolicy.maxRedirects, `${where}.networkPolicy.maxRedirects`, 0)
  }

  /* ── Отказы: точные схемы и закрытые коды ── */
  assertExactKeys(snapshot.rejected, policy.rejectionChannels, `${where}.rejected`)
  for (const field of policy.rejectionChannels) {
    if (!Array.isArray(snapshot.rejected[field])) {
      throw new TypeError(`${where}.rejected.${field}: ожидается массив`)
    }
  }
  const assertPageRejection = (row, field, index, keys = PAGE_REJECTION_KEYS) => {
    const label = `${where}.rejected.${field}[${index}]`
    assertExactKeys(row, keys, label)
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
  const nodeRejections = policy.rejectionChannels.includes('nodes') ? snapshot.rejected.nodes : []
  nodeRejections.forEach((row, index) => {
    const at = `${where}.rejected.nodes[${index}]`
    /*
     * `unsupportedCatalogueLinkShape` у узла невозможен, и это не
     * придирка к словам: код заведён для ссылки КАТАЛОГА, из которой ключ не
     * строится вовсе. Ссылка карточки такой формы ключа тоже не даёт, но
     * узлом не становится — она отвергается карточкой. Разрешить код здесь
     * значило бы оставить единственную лазейку, в которой `ref` узла не
     * обязан быть каноническим ключом.
     */
    if (row.code === UNSUPPORTED_SHAPE_CODE) {
      throw new TypeError(
        `${at}.code: «${UNSUPPORTED_SHAPE_CODE}» описывает ссылку каталога, а не узел графа`,
      )
    }
    assertPageRejection(row, 'nodes', index, NODE_REJECTION_KEYS)
    assertNonEmptyString(row.origin, `${at}.origin`)
    assertKeyFamily(row.origin, `${at}.origin`)
  })
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
  assertExactKeys(snapshot.counters, policy.counterKeys, `${where}.counters`)
  for (const field of policy.counterKeys) assertInteger(snapshot.counters[field], `${where}.counters.${field}`, 0)

  /* ── Причины неполноты сходятся с отказами и счётчиками ── */
  if (!Array.isArray(snapshot.incompleteReasons)) throw new TypeError(`${where}.incompleteReasons: ожидается массив`)
  const declared = new Map()
  for (const reason of snapshot.incompleteReasons) {
    assertExactKeys(reason, REASON_KEYS, `${where}.incompleteReasons[]`)
    assertEnum(reason.code, policy.incompleteReasons, `${where}.incompleteReasons[].code`)
    assertInteger(reason.count, `${where}.incompleteReasons[].count`, 1)
    if (declared.has(reason.code)) throw new TypeError(`${where}.incompleteReasons: причина ${reason.code} названа дважды`)
    declared.set(reason.code, reason.count)
  }
  assertCanonicalOrder(
    snapshot.incompleteReasons,
    [...snapshot.incompleteReasons].sort((a, b) => compareUtf8(a.code, b.code)),
    `${where}.incompleteReasons`,
  )
  const derived = derivedReasonCounts(snapshot, policy)
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
    /* Второго условия «причина известна ЭТОМУ формату» здесь НЕТ намеренно:
       строкой выше `assertEnum` уже пропустил только коды из
       `policy.incompleteReasons`, поэтому `v3` не может дойти сюда с
       `budgetInsufficient`. Проверка была бы недостижима, а недостижимую не
       убивает ни одна мутация. */
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
    if (!NON_CATALOGUE_ROLES.includes(row.evidence.pageRole)) {
      throw new TypeError(
        `${at}.pageRole: цель каталога не может быть «${row.evidence.pageRole}» — `
        + `допустимо [${NON_CATALOGUE_ROLES.join(', ')}]`,
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
  const catalogueCollectionKeys = new Set(snapshot.catalogueTargetEvidence
    .filter((row) => row.evidence.pageRole === 'collection').map((row) => row.sourceKey))
  const directPoiKeys = new Set(snapshot.catalogueTargetEvidence
    .filter((row) => row.evidence.pageRole === 'poi').map((row) => row.sourceKey))

  /*
   * ── Коллекции НИЖЕ каталога ──
   *
   * Свидетельство у них ровно такое же, как у цели каталога, — но список
   * отдельный, потому что происхождение разное и подменять одно другим
   * нельзя. Роль здесь не «одна из двух», а РОВНО `collection`: страница,
   * попавшая сюда объектом, означала бы, что снимок называет коллекцией то,
   * что сам измерил объектом.
   */
  const nestedEvidence = policy.snapshotKeys.includes('nestedCollectionEvidence')
    ? snapshot.nestedCollectionEvidence
    : []
  if (!Array.isArray(nestedEvidence)) {
    throw new TypeError(`${where}.nestedCollectionEvidence: ожидается массив`)
  }
  for (const row of nestedEvidence) {
    assertExactKeys(row, TARGET_EVIDENCE_KEYS, `${where}.nestedCollectionEvidence[]`)
    const at = `${where}.nestedCollectionEvidence[${row.sourceKey}].evidence`
    assertPageEvidence(row.evidence, at, { expectedRole: 'collection' })
    assertUrlFamily(row.evidence.url, `${at}.url`)
    if (discoverySourceKey(row.evidence.url) !== row.sourceKey) {
      throw new TypeError(
        `${where}.nestedCollectionEvidence[${row.sourceKey}]: ключ не выводится из адреса свидетельства`,
      )
    }
  }
  assertCanonicalOrder(
    nestedEvidence,
    sortedBy(nestedEvidence, (row) => row.sourceKey),
    `${where}.nestedCollectionEvidence`,
  )
  const nestedKeys = nestedEvidence.map((row) => row.sourceKey)
  if (new Set(nestedKeys).size !== nestedKeys.length) {
    throw new TypeError(`${where}.nestedCollectionEvidence: одна коллекция указана дважды`)
  }
  /* ОДНА СТРАНИЦА — ОДНО СВИДЕТЕЛЬСТВО. Ключ, лежащий в обоих списках, дал бы
     два наблюдения одной страницы, которые вправе разойтись байтами. */
  const bothLists = nestedKeys.filter((key) => targetKeys.includes(key))
  if (bothLists.length) {
    throw new TypeError(
      `${where}: ${bothLists[0]} объявлен и целью каталога, и вложенной коллекцией — `
      + 'одно из двух неправда',
    )
  }
  const nestedKeySet = new Set(nestedKeys)
  const collectionKeys = new Set([...catalogueCollectionKeys, ...nestedKeySet])

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
      `${where}: порядок ведётся для ${orderKeys.size} ключей при ${collectionKeys.size} коллекциях `
      + '(целей каталога и вложенных вместе) — '
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
  /* Свидетельство коллекции — из ОБОИХ списков: у порядка вложенной коллекции
     байты страницы лежат в её собственном свидетельстве. */
  const collectionEvidenceByKey = new Map([
    ...snapshot.catalogueTargetEvidence.filter((row) => row.evidence.pageRole === 'collection'),
    ...nestedEvidence,
  ].map((row) => [row.sourceKey, row]))

  /*
   * Порядок коллекции прочитан из тех же байтов, что и её свидетельство.
   * Иначе `orderDigest` можно было взять от прошлой версии страницы, а
   * свидетельство — от нынешней, и мониторинг сообщил бы перестановку,
   * которой на наблюдённой странице нет.
   */
  for (const row of snapshot.orderRecords) {
    const observed = collectionEvidenceByKey.get(row.destinationSourceKey)
    if (!observed) {
      throw new TypeError(
        `${where}.orderRecords[${row.destinationSourceKey}]: порядок без свидетельства коллекции`,
      )
    }
    if (observed.evidence.rawPageDigest !== row.sourcePageDigest) {
      throw new TypeError(
        `${where}.orderRecords[${row.destinationSourceKey}]: порядок прочитан из `
        + `${row.sourcePageDigest}, а свидетельство коллекции — из `
        + `${observed.evidence.rawPageDigest}`,
      )
    }
  }

  const orderByCollection = new Map(snapshot.orderRecords.map((row) =>
    [row.destinationSourceKey, new Set(orderedPoiKeys(row, orderSpec))]))
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
  /*
   * ── ДОСТИЖИМЫЕ ОБЪЕКТЫ — ТОЛЬКО ОБЪЕКТЫ ──
   *
   * До `v3` вопроса не было: в порядке лежали одни объекты, и `flatMap` по
   * `order` давал ровно их. В графе элемент порядка может быть коллекцией, и
   * взять весь порядок значило бы посчитать коллекцию объектом — тот самый
   * дефект, ради которого заведён `v3`: 1 170 «объектов» полного обхода
   * против 1 141 настоящего.
   */
  const reachable = new Set([
    ...snapshot.orderRecords.flatMap((row) => orderedPoiKeys(row, orderSpec)),
    ...directPoiKeys,
  ])

  /*
   * ── ГРАФ КОЛЛЕКЦИЙ СВЯЗЕН И НЕПРОТИВОРЕЧИВ ──
   *
   * Три утверждения, каждое из которых снимок обязан выдерживать сам, без
   * обращения к источнику:
   *   1. элемент с ролью `collection` разрешается ровно в одно свидетельство
   *      коллекции — иначе порядок ссылается на страницу, которой снимок не
   *      наблюдал;
   *   2. каждая вложенная коллекция достижима хотя бы одним таким элементом —
   *      иначе свидетельство приписано странице, до которой обход не дошёл;
   *   3. коллекция никогда не является объектом — ни записью, ни достижимым,
   *      ни отвергнутым объектом.
   * Циклы при этом разрешены: обратное ребро A → B → A законно, потому что
   * это ребро графа, а не второй обход страницы.
   */
  const referencedCollections = new Set(
    snapshot.orderRecords.flatMap((row) => orderedCollectionKeys(row, orderSpec)))
  for (const key of referencedCollections) {
    if (collectionKeys.has(key)) continue
    throw new TypeError(
      `${where}.orderRecords: элемент ${key} объявлен коллекцией, но свидетельства такой `
      + 'коллекции в снимке нет — ни целью каталога, ни вложенной',
    )
  }
  for (const key of nestedKeySet) {
    if (referencedCollections.has(key)) continue
    throw new TypeError(
      `${where}.nestedCollectionEvidence[${key}]: вложенная коллекция ни из одного порядка `
      + 'не достижима — свидетельство приписано странице, до которой обход не доходил',
    )
  }
  /*
   * ТРЕТЬЕ УТВЕРЖДЕНИЕ ПРОВЕРЯЕТСЯ ТОЛЬКО ТАМ, ГДЕ ОНО ВЫРАЗИМО.
   *
   * У `v1` и `v2` порядок — список ключей без ролей, и «коллекция внутри
   * порядка» там не нарушение формата, а ЕДИНСТВЕННЫЙ способ, которым тот
   * обход мог записать такую карточку. Полный артефакт 21.08 именно таков:
   * 28 коллекций лежат в `order[]` своих родителей. Применить правило `v3`
   * задним числом значило бы объявить исторический снимок повреждённым — то
   * есть переписать прошлое измерение вместо того, чтобы его прочитать.
   *
   * Начиная с `v3` роль у элемента есть, и совпадение становится
   * противоречием снимка самому себе.
   */
  if (ORDER_FIELD_BY_SPEC[orderSpec] === 'items') {
    const collectionAsPoi = [...collectionKeys].filter((key) => reachable.has(key))
    if (collectionAsPoi.length) {
      throw new TypeError(
        `${where}: коллекция ${collectionAsPoi[0]} посчитана объектом — `
        + 'коллекция не может быть ни записью, ни достижимым объектом',
      )
    }
  }

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
  /*
   * У `v3` отказ ОБЪЕКТА бывает только структурным — см. вывод причин выше.
   * Проверка стоит здесь, а не подразумевается: без неё снимок `v3` мог бы
   * нести отказ объекта с сетевым кодом, и такой отказ не порождал бы НИ ОДНОЙ
   * причины неполноты — снимок объявил бы себя полным, потеряв страницу.
   */
  if (!policy.incompleteReasons.includes('poiFetchFailed')) {
    for (const row of snapshot.rejected.pois) {
      if (isStructureRejection(row.code)) continue
      throw new TypeError(
        `${where}.rejected.pois: объект ${row.ref} отвергнут кодом «${row.code}» — `
        + `формат ${snapshotSpec} знает у объекта только структурные отказы, потому что `
        + 'страница объекта к этому месту уже получена',
      )
    }
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

  /*
   * ── ОТКАЗ УЗЛА ГРАФА ССЫЛАЕТСЯ НА РЕБРО, КОТОРОЕ СНИМОК ВИДЕЛ ──
   *
   * Отказ узла — утверждение «коллекция `origin` сослалась на страницу `ref`,
   * но роль этой страницы установить не удалось». Каждая половина обязана
   * опираться на снимок: `origin` — наблюдённая коллекция, `ref` — страница,
   * про которую снимок НЕ утверждает ничего другого. Ссылка, которую снимок
   * одновременно называет объектом, записью или наблюдённой коллекцией,
   * делает отказ ложным: роль в этом случае как раз известна.
   */
  const failedNodeRefs = nodeRejections.map((row) => row.ref)
  if (new Set(failedNodeRefs).size !== failedNodeRefs.length) {
    throw new TypeError(`${where}.rejected.nodes: один узел отвергнут дважды`)
  }
  const recordKeySetForNodes = new Set(recordKeys)
  for (const row of nodeRejections) {
    if (!collectionKeys.has(row.origin)) {
      throw new TypeError(
        `${where}.rejected.nodes: узел ${row.ref} пришёл от ${row.origin}, `
        + 'но коллекции с таким ключом снимок не наблюдал',
      )
    }
    if (reachable.has(row.ref) || collectionKeys.has(row.ref) || recordKeySetForNodes.has(row.ref)) {
      throw new TypeError(
        `${where}.rejected.nodes: у ${row.ref} роль объявлена неустановленной, `
        + 'хотя снимок называет эту страницу объектом или коллекцией',
      )
    }
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
  /*
   * СЧЁТЧИКИ КОЛЛЕКЦИЙ — ПО ПРОИСХОЖДЕНИЮ, И ИМЕНА БЕРУТСЯ ИЗ ПОЛИТИКИ.
   *
   * У `v1` и `v2` коллекция бывает только целью каталога, и один
   * `collectionsFound` описывает всё, что тот формат умел различать. У `v3`
   * их два, и требовать от него старого имени значило бы снова сложить в одно
   * число две разные величины.
   */
  const countersByCollectionOrigin = policy.counterKeys.includes('nestedCollectionsFound')
    ? [
      ['catalogueCollectionsFound', catalogueCollectionKeys.size],
      ['nestedCollectionsFound', nestedKeySet.size],
    ]
    : [['collectionsFound', collectionKeys.size]]
  for (const [name, measured] of countersByCollectionOrigin) {
    if (snapshot.counters[name] === measured) continue
    throw new TypeError(
      `${where}.counters.${name}: ${snapshot.counters[name]} `
      + `не сходится с ролями в свидетельствах (${measured})`,
    )
  }
  if (directPoiKeys.size !== snapshot.counters.directPoisFound) {
    throw new TypeError(
      `${where}.counters.directPoisFound: ${snapshot.counters.directPoisFound} `
      + `при ${directPoiKeys.size} целях каталога с ролью «poi»`,
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
  /* Имя берётся из политики: у `v1`/`v2` это `poisVisited`, у `v3` —
     `recordsAttempted`. Величина одна и та же, и сходиться она обязана с
     исходом каждой попытки: запись построена либо объект отвергнут. */
  const attemptName = attemptCounterName(policy)
  const attempts = snapshot.counters[attemptName]
  if (attempts !== snapshot.records.length + snapshot.rejected.pois.length) {
    throw new TypeError(
      `${where}.counters.${attemptName}: ${attempts} при ${snapshot.records.length} записях `
      + `и ${snapshot.rejected.pois.length} отказах объектов — попытки обязаны сходиться с исходом`,
    )
  }

  /*
   * ── НИЖНЯЯ ГРАНИЦА ОБМЕНОВ ВЫВОДИТСЯ ИЗ САМОГО СНИМКА ──
   *
   * Только для форматов, обход которых получает КАЖДУЮ классифицированную
   * страницу. Там число обменов не свободный счётчик, а следствие состава:
   *
   *   2                                   robots и каталог
   *   + свидетельств целей каталога       по обмену на цель
   *   + свидетельств вложенных коллекций  по обмену на каждую
   *   + достижимых объектов вне прямых    страницы прямых уже посчитаны целями
   *   + отказов целей ПОСЛЕ обмена        страница получена, но не принята
   *   + отказов узлов ПОСЛЕ обмена        то же для узла ниже каталога
   *
   * ПОЛУЧЕННАЯ И ОТВЕРГНУТАЯ СТРАНИЦА ТОЖЕ СТОИЛА ОБМЕНА. Первая редакция
   * границы считала только успешные свидетельства, и снимок с одной
   * отвергнутой целью `statusDenied` объявлял 4 обмена при физическом
   * минимуме 5 — проверено аудитом 24.08. Прибавлять все отказы подряд
   * нельзя, но и классифицировать их одним глобальным списком кодов тоже:
   * `urlNotCanonical` у цели приходит уже ПОСЛЕ 3xx, из канонизации
   * `Location`. Списки досетевых кодов КОНТЕКСТНЫ — свой у целей, свой у
   * узлов; оба берутся из политики версии, рассуждение — при
   * `PRE_NETWORK_BY_CHANNEL_V3`.
   *
   * ОТКАЗЫ ОБЪЕКТОВ СЮДА НЕ ВХОДЯТ, и это не упущение: отвергнутый объект
   * обязан лежать в достижимом множестве — так требует связность выше, —
   * а значит его страница уже посчитана слагаемым `fetchedPoiCount`.
   * Прибавить их значило бы посчитать один обмен дважды.
   *
   * Измерено: снимок canary объявлял 259 обменов при 208 целях и 1170
   * объектах — 1063 обмена меньше физически необходимого, и контракт его
   * принимал. Для `v1`/`v2` это НЕ дефект, а честная запись: предел резал
   * список объектов до получения их страниц, и граница там неверна.
   *
   * Неравенство, а не равенство: каждый шаг редиректа проходит через тот же
   * счётчик, поэтому обменов законно бывает больше.
   */
  if (policy.everyClassifiedPageFetched) {
    const fetchedPoiCount = [...reachable].filter((key) => !directPoiKeys.has(key)).length
    const preNetwork = policy.preNetworkRejectionCodes
    const exchanged = (rows, channel) =>
      rows.filter((row) => !preNetwork[channel].includes(row.code)).length
    const exchangedTargets = exchanged(snapshot.rejected.targets, 'targets')
    const exchangedNodes = exchanged(nodeRejections, 'nodes')
    const minimumExchanges = 2
      + snapshot.catalogueTargetEvidence.length
      + nestedEvidence.length
      + fetchedPoiCount
      + exchangedTargets
      + exchangedNodes
    if (snapshot.counters.networkRequests < minimumExchanges) {
      throw new TypeError(
        `${where}.counters.networkRequests: объявлено ${snapshot.counters.networkRequests}, `
        + `а состав снимка требует не меньше ${minimumExchanges} `
        + `(2 + ${snapshot.catalogueTargetEvidence.length} целей + ${nestedEvidence.length} вложенных `
        + `+ ${fetchedPoiCount} объектов вне прямых + ${exchangedTargets} отвергнутых целей `
        + `+ ${exchangedNodes} отвергнутых узлов, у которых обмен состоялся) — обход, получающий `
        + 'каждую классифицированную страницу, столькими обменами обойтись не мог',
      )
    }

    /*
     * ── ВЕРХНЯЯ ГРАНИЦА И ИСЧЕРПАНИЕ БЮДЖЕТА ──
     *
     * Нижняя граница не видит обменов, потраченных ВНУТРИ отказа, который сам
     * по себе обмена не стоил. Аудит 25.08: при `maxRedirects` = 2 первая цель
     * получает два 302 и упирается в потолок на третьем `take`; её отказ —
     * `networkBudgetExhausted`, слагаемого он не даёт, а два обмена уже
     * потрачены. Следующие цели падают на нулевом шаге, тоже без обмена.
     * Обходу стоило 4 обмена, снимок объявлял 2, и состав это позволял.
     *
     * Закрывается это не арифметикой состава, а самим потолком, который снимок
     * теперь обязан назвать:
     *
     *   · объявить БОЛЬШЕ обменов, чем разрешал бюджет, нельзя никогда;
     *   · объявить `networkBudgetExhausted` и при этом НЕ упереться в потолок
     *     нельзя тоже: бюджет исчерпан ровно тогда, когда счётчик равен
     *     потолку, — так его и проверяет `pacer.take`.
     *
     * Равенство, а не «не меньше»: счётчик растёт строго по одному и
     * останавливается на потолке, поэтому «исчерпан» и «равен» — одно
     * утверждение. Вместе с нижней границей это оставляет для утаивания
     * ровно ноль обменов: снимок с исчерпанием обязан объявить весь бюджет.
     *
     * Чего проверка НЕ доказывает и не может: что объявленный потолок — тот
     * самый, под которым шёл обход. Настройка прогона снимку не принадлежит.
     * Она входит в `snapshotDigest`, поэтому подменить её после прогона
     * нельзя, а сверять с `FETCH_LIMITS` — дело операционного потребителя.
     */
    if (snapshot.counters.networkRequests > snapshot.networkPolicy.maxNetworkRequests) {
      throw new TypeError(
        `${where}.counters.networkRequests: объявлено ${snapshot.counters.networkRequests} `
        + `при потолке ${snapshot.networkPolicy.maxNetworkRequests} — `
        + 'обход не мог потратить больше собственного бюджета',
      )
    }
    const exhausted = [...snapshot.rejected.targets, ...nodeRejections]
      .some((row) => row.code === 'networkBudgetExhausted')
    if (exhausted && snapshot.counters.networkRequests !== snapshot.networkPolicy.maxNetworkRequests) {
      throw new TypeError(
        `${where}.counters.networkRequests: снимок объявляет исчерпание бюджета, `
        + `но обменов ${snapshot.counters.networkRequests} при потолке `
        + `${snapshot.networkPolicy.maxNetworkRequests} — исчерпанным бюджет бывает `
        + 'ровно на потолке',
      )
    }
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
    if (attempts !== snapshot.counters.poisFound) {
      throw new TypeError(
        `${where}: у полного снимка найдено ${snapshot.counters.poisFound}, `
        + `${attemptName} — ${attempts}; обход обязан дойти до каждого`,
      )
    }
  }

  /* Домен отпечатка — версия САМОГО снимка: `v1` проверяется доменом `v1`. */
  if (snapshot.snapshotDigest !== sha256Of(snapshotCovered(snapshot, policy), `${snapshotSpec}#snapshot`)) {
    throw new TypeError(`${where}.snapshotDigest: не сходится с содержимым снимка`)
  }
}
