/**
 * Адаптер discovery-обхода japan-guide.com.
 *
 * Что делает: узнаёт, КАКИЕ объекты существуют, и собирает неподтверждённые
 * подсказки. Чего не делает: не сохраняет ни строки чужой прозы, ни
 * изображений, не пишет в Airtable, не строит план модели.
 *
 * ВСЕ СЕЛЕКТОРЫ ИЗМЕРЕНЫ 17.08.2026 на трёх живых страницах. Три структурные
 * подписи различают уровни однозначно:
 *
 *   каталог      div.dest_top_destinations__regions           есть  9 регионов
 *   направление  h2.spot_list__list_title внутри #section_spot_list  ровно один
 *   объект       div.page_title > h1.page_title__title, и НЕТ list_title
 *
 * Пять ловушек, каждая подтверждена измерением:
 *
 *   1. Каталог содержит блок «Top Destinations», дублирующий региональные
 *      списки. Он не берётся вовсе.
 *   2. «Side Trips» — не отдельный раздел, а ВТОРАЯ группа внутри того же
 *      #section_spot_list. Группа Top attractions отличается структурно: у
 *      неё нет собственного div.spot_list__category__header.
 *   3. Заголовки «Get There» и «Hours & Fees» встречаются ДВАЖДЫ — сначала
 *      внутристраничная навигация, потом настоящий раздел. Якорь идёт по
 *      идентификатору #section_admission.
 *   4. Маркеры рекомендации лежат в отдельном span и ни разу не попадают в
 *      текстовый узел: уровень читается структурно.
 *   5. Класс spot_list__spot__meta несёт категорию только внутри группы Top
 *      attractions; в карточках отелей в том же классе лежит рейтинг
 *      звёздами.
 *
 * ОБХОД, КОТОРЫЙ ЧЕГО-ТО НЕ ДОСЧИТАЛ, НЕ ЯВЛЯЕТСЯ СНИМКОМ. Любая потеря —
 * недоступное направление, отвергнутая карточка, применённый `--limit` —
 * делает `complete: false`, и мониторинг такой снимок не принимает. Иначе
 * страницы, до которых обход не дошёл, читались бы как удалённые источником.
 */

import { load } from 'cheerio'

import {
  BYTE_LIMITS,
  PLACEMENT_KIND_BY_COLLECTION_KIND,
  ROLES_BY_FAMILY,
  ROLE_FAMILY_MISMATCH_CODE,
  VERSION_POLICY,
  assertDiscoverySnapshot,
  buildAppliesTo,
  buildDiscoveryRecord,
  buildDiscoverySnapshot,
  buildFactLead,
  buildOmission,
  buildOrderRecord,
  buildPageEvidence,
  buildPlacement,
  compareUtf8,
  isStructureRejection,
  matrixFamily,
  movedCount,
  orderItem,
  orderSequence,
} from './discovery-contract.mjs'
import {
  RecommendationMarkerError,
  TextGuardError,
  normaliseValue,
  recommendationLevel,
  utf8Bytes,
} from './japan-guide-text-guard.mjs'
import {
  FETCH_LIMITS,
  canonicalDiscoveryUrl,
  canonicalPageUrl,
  createRequestPacer,
  discoverySourceKey,
  fetchHtmlPage,
  fetchRobots,
  sameOriginUrl,
} from './html-fetch.mjs'
import { CARD_REJECTION_CODES, PAGE_REJECTION_CODES, PAGE_ROLE_CODES } from './discovery-contract.mjs'

export const JAPAN_GUIDE_ADAPTER = 'japan-guide-html'

/* ── Селекторы ────────────────────────────────────────────────────────── */

const SPOT_LIST_SECTION = 'section#section_spot_list'
const SIGNATURE_INSIDE = 'header.spot_list__header h2.spot_list__list_title'
const GROUP_INSIDE = 'div.spot_list__category'

export const SELECTORS = Object.freeze({
  catalogue: Object.freeze({
    signature: 'div.dest_top_destinations__regions',
    title: 'header.dest_top__section_header > h1.dest_top__section_title',
    destinationLinks:
      'div.dest_top_destinations__regions > div.dest_top_destinations__region'
      + ' > div.dest_top_destinations__region_text > div.dest_top_destinations__region_dests a[href]',
  }),
  destination: Object.freeze({
    /*
     * Секция и то, что ищется ВНУТРИ неё, названы раздельно, а составной
     * селектор собирается из них. Прежде составной был единственным, и
     * искать «внутри выбранной секции» было нечем: любой поиск снова уходил
     * по всему документу. Так вспомогательные `spot_list` за пределами
     * сигнатурной секции попадали в разбор направления.
     */
    section: SPOT_LIST_SECTION,
    signatureInside: SIGNATURE_INSIDE,
    signature: `${SPOT_LIST_SECTION} ${SIGNATURE_INSIDE}`,
    title: 'div.page_title > h1.page_title__title',
    groupInside: GROUP_INSIDE,
    group: `${SPOT_LIST_SECTION} ${GROUP_INSIDE}`,
    groupHeader: 'div.spot_list__category__header',
    card: 'li.spot_list__spot',
    cardName: 'a.spot_list__spot__name',
    cardMeta: 'div.spot_list__spot__meta',
    cardRank: 'div.spot_list__spot__rank_no',
  }),
  attraction: Object.freeze({
    title: 'div.page_title > h1.page_title__title',
    admissionSection: 'section#section_admission',
    admissionBlock: 'div.page_admission',
    admissionTitle: 'h3.page_admission__title',
    admissionItem: 'div.page_admission__item',
    admissionLabel: 'h4.page_admission__item_label',
    admissionContent: 'div.page_admission__item_content',
    linksRow: 'section#section_links .page_links__link a[href]',
  }),
})

/** Метка поля → вид подсказки. Закрытая таблица: чужая метка не извлекается. */
const LABEL_TO_KIND = Object.freeze({
  Hours: 'hours_hint',
  Closed: 'closed_hint',
  Admission: 'admission_hint',
})

const OFFICIAL_LINK_TEXT = /official website/i

const BLOCK_TAGS = Object.freeze(new Set([
  'p', 'div', 'ul', 'ol', 'li', 'table', 'section', 'article', 'header', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]))

const BUTTON_CLASS = 'button'

/* ── Ошибки уровня страницы ───────────────────────────────────────────── */

export class StructureMismatchError extends Error {
  constructor(message, details = null) {
    super(message)
    this.name = 'StructureMismatchError'
    this.code = 'structureMismatch'
    /*
     * ОСТАВШИЙСЯ ВТОРОЙ КАНАЛ, и это осознанный долг, а не забытое место.
     *
     * `details.reason` до снимка не доходит: `pageRejectionCode` читает
     * только `code`. Для исходов классификатора ролей канал снят — там
     * теперь `PageRoleError`. Здесь он ещё нужен двум причинам уровня
     * записи (`titleElementMissing`, `titleEmpty`), и они сворачиваются
     * в `structureMismatch` ровно так же, как сворачивались роли.
     *
     * Расширять правку до `rejected.pois` без отдельного решения владельца
     * нельзя: это меняет коды уже принятого контракта. Дефект назван.
     */
    this.details = details
  }
}

/**
 * Отказ КЛАССИФИКАТОРА РОЛИ — своим кодом, а не общим `structureMismatch`.
 *
 * Прежде исход классификатора лежал в `details.reason`, а в снимок уходил
 * `error.code`. Второй канал был короче первого: `pageRejectionCode` читает
 * только `code`, поэтому `details` терялся на границе снимка. Так 166
 * отказов canary и стали неразличимой кучей.
 *
 * Теперь исход и есть код: одно поле, один канал, никакого расхождения.
 * Код сверяется с `PAGE_ROLE_CODES` ЗДЕСЬ, а не на границе снимка: опечатка
 * иначе обрушила бы обход на первой же такой странице — после того как за
 * неё уже заплачен обмен.
 */
export class PageRoleError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PageRoleError'
    if (!PAGE_ROLE_CODES.includes(code)) {
      throw new TypeError(`${JAPAN_GUIDE_ADAPTER}: «${code}» не исход классификатора ролей`)
    }
    this.code = code
  }
}

/* ── Отбор структуры коллекции ────────────────────────────────────────── */

/**
 * ЕДИНСТВЕННЫЙ отбор структуры направления. Потребителей ровно два —
 * классификатор ролей и `parseDestination`, — и оба зовут эту функцию.
 *
 * Прежде отбор существовал ДВАЖДЫ: классификатор считал заголовки и группы
 * своим кодом, `parseDestination` — своим, и оба искали группы ПО ВСЕМУ
 * ДОКУМЕНТУ. Две копии расходились молча, а глобальный поиск захватывал
 * вспомогательные `spot_list` вне сигнатурной секции.
 *
 * ПОРЯДОК ШАГОВ ИЗМЕРЕН:
 *   1. секция — ровно одна `section#section_spot_list` с настоящей
 *      сигнатурой; ноль или больше одной — структура не отбирается;
 *   2. группы ищутся ТОЛЬКО внутри неё;
 *   3. одна безымянная группа — берётся только она; так сохраняется
 *      отсечение «Side Trips», у которых собственный заголовок есть;
 *   4. безымянных нет — берутся ВСЕ группы секции: измеренная форма
 *      `e2158`, `e2164`, `e3800`, `e4175`, где озаглавлены все;
 *   5. безымянных несколько — форма не измерена, структура не отбирается.
 *
 * ИСХОД ДИСКРИМИНИРОВАН, а не «структура или null». Один `null` смешивал
 * ДВА разных факта: коллекции здесь нет вовсе и коллекция есть, но
 * повреждена. Первое — обычная страница объекта, второе — форма, которой
 * измерение не видело, и молча спускать её в остаточную ветку POI нельзя.
 *
 *   selected  ровно одна сигнатурная секция и измеренный набор групп
 *   absent    сигнатурной секции нет
 *   invalid   сигнатура есть, но секций несколько, групп нет либо форма
 *             групп не измерена (безымянных больше одной)
 *
 * @returns {{kind: 'selected', section: object, groups: object[]}
 *          |{kind: 'absent'}
 *          |{kind: 'invalid', reason: string}}
 */
export function selectCollectionStructure($) {
  const signed = $(SELECTORS.destination.section).toArray()
    .filter((element) => $(element).find(SELECTORS.destination.signatureInside).length > 0)
  if (signed.length === 0) return { kind: 'absent' }
  if (signed.length > 1) return { kind: 'invalid', reason: `сигнатурных секций ${signed.length}` }
  const section = signed[0]
  /* Поиск ОТ СЕКЦИИ, а не от документа: в этом и была потеря. */
  const groups = $(section).find(SELECTORS.destination.groupInside).toArray()
  if (!groups.length) return { kind: 'invalid', reason: 'в сигнатурной секции нет групп' }
  const headless = groups.filter(
    (group) => !$(group).children(SELECTORS.destination.groupHeader).length)
  if (headless.length === 1) return { kind: 'selected', section, groups: headless }
  if (headless.length === 0) return { kind: 'selected', section, groups }
  return { kind: 'invalid', reason: `групп без заголовка ${headless.length}` }
}

/**
 * Есть ли хоть один ПОЛОЖИТЕЛЬНЫЙ ранг в списках страницы.
 *
 * Ранг — признак ранжированного списка, то есть коллекции. На странице без
 * сигнатуры он означает, что сигнатура могла быть утрачена вёрсткой, а
 * список остался. Объявить такую страницу объектом значило бы потерять её
 * карточки молча.
 *
 * Считается ровно та же величина, что читает `readListPosition`:
 * непустое положительное целое. Пустые и нечисловые ранги ранжированием
 * не считаются — вспомогательные списки как раз такие.
 */
export function hasPositiveRank($) {
  return $(SELECTORS.destination.section)
    .find(SELECTORS.destination.cardRank).toArray()
    .some((element) => /^[1-9][0-9]*$/.test(normaliseValue($(element).text() || '')))
}

/* ── Топология зонтичной страницы ─────────────────────────────────────── */

/** Ребёнком контейнер считается не раньше, чем их станет двое. */
export const CONTAINER_MIN_CHILDREN = 2

/** Несоставной legacy-адрес: только он может быть зонтичной страницей. */
const PLAIN_LEGACY_PATH = /^\/e\/(e\d+)\.html$/
/** Любая цифровая форма ребёнка — разрядность проверяется отдельно. */
const NUMERIC_CHILD_PATH = /^\/e\/(e\d+)_(\d+)\.html$/
/** Измеренная разрядность суффикса ребёнка. */
const CHILD_SUFFIX_DIGITS = 3

/**
 * КОНТЕЙНЕР ОПРЕДЕЛЯЕТСЯ ТОЛЬКО ГРАФОМ ССЫЛОК.
 *
 * Ни `admission`, ни число `spot_list`, ни H1, ни любой другой контент в
 * решение не входят — и это не осторожность, а необходимость: census 20.08
 * показал, что контент зонтичной страницы неотличим от контента обычного
 * объекта. Отличает их ровно одно — исходящие рёбра.
 *
 * ПРАВИЛО:
 *   1. текущая страница имеет несоставной адрес `/e/eNNNN.html`;
 *   2. на ней не меньше двух УНИКАЛЬНЫХ канонических ссылок
 *      `/e/eNNNN_ddd.html`;
 *   3. `NNNN` каждого ребёнка совпадает с базовым номером страницы;
 *   4. суффикс — ровно три цифры;
 *   5. только `https://www.japan-guide.com`, без query, fragment,
 *      percent-encoding и смены origin;
 *   6. повтор ссылки — одно ребро; порядок первого появления сохраняется.
 *
 * FAIL-CLOSED. Ссылка с ТЕМ ЖЕ базовым номером, но иной разрядностью
 * (`_1`, `_01`, `_0001`) — противоречие: детей на странице ждут, а прочесть
 * их грамматика не умеет. Такая страница не становится объектом тихо; она
 * получает закрытый код `containerTopologyAmbiguous`.
 *
 * @returns {{kind: 'container', children: {sourceKey: string, url: string}[]}
 *          |{kind: 'ambiguous', conflicts: string[]}
 *          |{kind: 'notContainer', reason: string}}
 */
export function detectContainerChildren($, pageUrl) {
  const canonical = canonicalDiscoveryUrl(pageUrl).url
  const base = PLAIN_LEGACY_PATH.exec(new URL(canonical).pathname)
  if (!base) return { kind: 'notContainer', reason: 'адрес страницы не несоставной legacy' }
  const baseId = base[1]

  const children = []
  const seen = new Set()
  const conflicts = []
  for (const element of $('a[href]').toArray()) {
    const raw = String(element.attribs?.href ?? '')
    /* Percent-encoding не разбирается вовсе: `new URL` нормализовал бы его
       и неканоническая ссылка выдала бы себя за каноническую. */
    if (raw.includes('%')) continue
    let url
    try {
      url = sameOriginUrl(raw, canonical)
    } catch {
      continue
    }
    if (url.search || url.hash) continue
    const match = NUMERIC_CHILD_PATH.exec(url.pathname)
    if (!match) continue
    /* Чужой базовый номер ребёнком не делает и противоречием не является:
       зонтичная страница вправе ссылаться на детей соседей. */
    if (match[1] !== baseId) continue
    if (match[2].length !== CHILD_SUFFIX_DIGITS) {
      conflicts.push(url.pathname)
      continue
    }
    const sourceKey = discoverySourceKey(url.href)
    if (seen.has(sourceKey)) continue
    seen.add(sourceKey)
    children.push({ sourceKey, url: url.href })
  }

  if (conflicts.length) return { kind: 'ambiguous', conflicts }
  if (children.length < CONTAINER_MIN_CHILDREN) {
    return { kind: 'notContainer', reason: `детей ${children.length}, нужно ${CONTAINER_MIN_CHILDREN}` }
  }
  return { kind: 'container', children }
}

/* ── Классификатор ролей ──────────────────────────────────────────────── */

/**
 * Роль страницы по СТРУКТУРЕ, закрытым перечислением.
 *
 * Проверяется для КАЖДОЙ цели каталога, включая legacy: измерение показало,
 * что `/e/eNNNN.html` бывает и направлением (`e2157`), и объектом (`e4000`),
 * а `/destinations/<slug>/` — тоже и тем, и другим. Адрес роли не несёт.
 *
 * Две грамматики сразу — `pageRoleAmbiguous`, ни одной — `pageRoleUnknown`.
 * Обе — отказ страницы, а не догадка о том, какая вероятнее.
 */
/**
 * ЕДИНЫЙ РАЗБОР СТРАНИЦЫ. Вычисляется ОДИН раз и служит трём потребителям:
 * классификатору, разбору коллекции и обходу.
 *
 * Прежде классификатор и разбор приходили к РАЗНЫМ выводам на одной
 * странице: `classifyPageRole` возвращал `collection`, а `parseDestination`
 * на той же зонтичной странице отказывал `structureMismatch`. Обход обходил
 * это отдельной веткой и вторым разбором DOM. Расхождение публичных
 * потребителей — дефект границы, а не неудобство.
 *
 * ПОРЯДОК РЕШЕНИЙ. Топология идёт ПЕРВОЙ и выигрывает у любого контентного
 * признака: зонтичная страница вправе нести и валидный список карточек, и
 * раздел `admission`, и H1 — контейнером её делают исходящие рёбра.
 * Контрпример аудита: топология `container` + структура `selected` +
 * `admission` давали `pageRoleAmbiguous`, то есть контент отменял топологию.
 *
 * @param {{document: object, pageUrl: string}} input
 * @returns {{kind: 'containerCollection', children: object[]}
 *          |{kind: 'rankedCollection', structure: object}
 *          |{kind: 'poi'}}
 */
export function analysePage({ document: $, pageUrl }) {
  const topology = detectContainerChildren($, pageUrl)
  if (topology.kind === 'ambiguous') {
    throw new PageRoleError(
      'containerTopologyAmbiguous',
      `${JAPAN_GUIDE_ADAPTER}: ссылки того же номера с неизмеренной разрядностью суффикса: `
      + `${topology.conflicts.join(', ')}`,
    )
  }
  if (topology.kind === 'container') return { kind: 'containerCollection', children: topology.children }

  const admissionBlocks = $(SELECTORS.attraction.admissionSection)
    .find(SELECTORS.attraction.admissionBlock).length
  const hasTitle = $(SELECTORS.attraction.title).first().length > 0
  const structure = selectCollectionStructure($)

  /* Пересечение достижимо и после топологии: страница со списком карточек
     И с разделом фактов, но без детей, по-прежнему двусмысленна. */
  if (structure.kind === 'selected' && admissionBlocks > 0) {
    throw new PageRoleError(
      'pageRoleAmbiguous',
      `${JAPAN_GUIDE_ADAPTER}: страница несёт обе положительные сигнатуры сразу — `
      + `список объектов (групп ${structure.groups.length}) и раздел фактов (${admissionBlocks})`,
    )
  }
  if (structure.kind === 'selected') return { kind: 'rankedCollection', structure }

  /* Повреждённая коллекция — не объект, даже при живом H1. */
  if (structure.kind === 'invalid') {
    throw new PageRoleError(
      'pageRoleUnknown',
      `${JAPAN_GUIDE_ADAPTER}: сигнатура коллекции есть, но форма не измерена: ${structure.reason}`,
    )
  }
  if (!hasTitle) {
    throw new PageRoleError(
      'pageRoleUnknown',
      `${JAPAN_GUIDE_ADAPTER}: ни сигнатуры коллекции, ни заголовка объекта`,
    )
  }
  if (admissionBlocks > 0) return { kind: 'poi' }
  if (!hasPositiveRank($)) return { kind: 'poi' }
  throw new PageRoleError(
    'pageRoleUnknown',
    `${JAPAN_GUIDE_ADAPTER}: сигнатуры коллекции нет, но список ранжирован — `
    + 'страница может быть коллекцией с утраченной сигнатурой',
  )
}

/** Вид коллекции для `orderRecord` по исходу разбора. Реестр один. */
export const COLLECTION_KIND_BY_ANALYSIS = Object.freeze({
  containerCollection: 'container',
  rankedCollection: 'ranked',
})

/**
 * Роль страницы по СТРУКТУРЕ и ТОПОЛОГИИ, закрытым перечислением.
 *
 * Тонкая обёртка над `analysePage`: второй грамматики здесь не заводится.
 * `pageUrl` — собственный канонический адрес страницы, её идентичность, а не
 * место, откуда пришла ссылка: census 20.08 доказал, что по происхождению
 * роль не определяется, и это проверяется прогоном одного документа обоими
 * путями.
 */
export function classifyPageRole($, pageUrl) {
  const analysis = analysePage({ document: $, pageUrl })
  return analysis.kind === 'poi' ? 'poi' : 'collection'
}

export class AmbiguousValueError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AmbiguousValueError'
    this.code = 'ambiguousValueBoundary'
  }
}

/* ── Разбор значения по границе ───────────────────────────────────────── */

function hasClassToken(node, token) {
  return String(node?.attribs?.class ?? '').split(/\s+/).includes(token)
}

/**
 * Значение поля: обход дочерних узлов ДО первого `<br>` или `<a class=button>`.
 *
 * Измерено на всех шести полях Osaka Castle. Ни «весь textContent», ни
 * «первый непосредственный блок» не годятся: первый приклеивает к цене
 * редакционную заметку на 250 байт, второй обрывает часы посреди фразы на
 * строчной ссылке. Граница даёт 66 / 24 / 42 / 139 / 75 / 50 байт.
 */
export function valueWithBoundary($, contentElement) {
  const parts = []
  let blockChildren = 0
  for (const node of $(contentElement).contents().toArray()) {
    if (node.type === 'tag') {
      if (node.name === 'br') break
      if (node.name === 'a' && hasClassToken(node, BUTTON_CLASS)) break
      if (BLOCK_TAGS.has(node.name)) blockChildren += 1
    }
    parts.push($(node).text())
  }
  if (blockChildren > 1) {
    throw new AmbiguousValueError(
      `${JAPAN_GUIDE_ADAPTER}: ${blockChildren} блочных значения без структурной границы — `
      + 'какое из них ответ, неизвестно; склейка запрещена',
    )
  }
  return normaliseValue(parts.join(''))
}

const GUARD_CODE_TO_OMISSION = Object.freeze({
  tooLong: {
    leadValue: 'leadValueTooLong',
    componentName: 'componentNameTooLong',
    categoryHint: 'categoryHintTooLong',
  },
  nonWhitelistedCodepoint: {
    leadValue: 'nonWhitelistedCodepoint',
    componentName: 'nonWhitelistedCodepoint',
    categoryHint: 'nonWhitelistedCodepoint',
  },
})

function omissionFromGuardError(error, field, locator) {
  const byField = GUARD_CODE_TO_OMISSION[error.code]
  if (!byField || !byField[field]) return null
  return buildOmission({ code: byField[field], locator, originalLengthBytes: error.originalLengthBytes ?? 0 })
}

/** Печатная ASCII-ссылка для записи отказа. Прозы источника здесь нет. */
function printableRef(value) {
  const trimmed = String(value).replace(/[^\x21-\x7e]/g, '').slice(0, 512)
  return trimmed.length ? trimmed : 'unreadable-href'
}

/**
 * Код отказа страницы или объекта.
 *
 * Неизвестный код — не «прочая ошибка», а сигнал, что упало что-то наше.
 * Записать его в снимок значило бы выдать собственную поломку за свойство
 * источника, поэтому такая ошибка летит наружу.
 */
function pageRejectionCode(error) {
  const code = error?.code
  if (PAGE_REJECTION_CODES.includes(code)) return code
  throw error
}

function cardRejectionCode(error) {
  const code = error?.code
  if (CARD_REJECTION_CODES.includes(code)) return code
  throw error
}

/* ── Уровень 1: каталог ───────────────────────────────────────────────── */

export function parseCatalogue({ html, url }) {
  const $ = load(html)
  if (!$(SELECTORS.catalogue.signature).length) {
    throw new StructureMismatchError(`${JAPAN_GUIDE_ADAPTER}: ${url} не является каталогом направлений`)
  }
  if (!$(SELECTORS.catalogue.title).length) {
    throw new StructureMismatchError(`${JAPAN_GUIDE_ADAPTER}: ${url}: нет заголовка каталога`)
  }
  const seen = new Set()
  const targets = []
  const unsupported = []
  for (const anchor of $(SELECTORS.catalogue.destinationLinks).toArray()) {
    const href = String($(anchor).attr('href') ?? '')
    let canonical
    try {
      /*
       * Каталог перечисляет ЦЕЛИ, а не направления, и цели бывают трёх
       * измеренных семейств. Прежде здесь стоял `canonicalPageUrl`,
       * принимавший одну legacy-форму, и обе новые формы уходили в
       * `unsupported` — то есть обход заведомо не доходил до части источника.
       *
       * Роль цели по её адресу НЕ определяется: измерение 17.08.2026 дало
       * `/destinations/nozawa-onsen/` как коллекцию и
       * `/destinations/motonosumi-shrine/` той же формы как объект. Здесь
       * известен только путь; роль выяснит классификатор, когда страница
       * будет получена.
       */
      canonical = canonicalDiscoveryUrl(href, url).url
    } catch {
      /* Остаётся то, что ни в одно семейство не попадает: чужой хост, путь
         вне `/e/` и `/destinations/`, query, fragment, percent-encoding.
         Каждая такая ссылка называется поимённо и делает снимок неполным —
         молча пропустить её значило бы потерять цель. */
      unsupported.push(printableRef(href))
      continue
    }
    const sourceKey = discoverySourceKey(canonical)
    if (seen.has(sourceKey)) continue
    seen.add(sourceKey)
    targets.push({ sourceKey, url: canonical })
  }
  if (!targets.length) {
    throw new StructureMismatchError(`${JAPAN_GUIDE_ADAPTER}: ${url}: региональные списки пусты`)
  }
  targets.sort((left, right) => compareUtf8(left.sourceKey, right.sourceKey))
  return { targets, unsupported }
}

/* ── Уровень 2: направление ───────────────────────────────────────────── */

/**
 * Позиция карточки берётся ТОЛЬКО из её собственного элемента ранга.
 *
 * Прежняя версия при негодном ранге подставляла порядковый номер в DOM. Это
 * превращало поломку локатора в правдоподобное число: отчёт выглядел
 * исправным, а `listPosition` означал уже не то, что заявлено. Теперь любое
 * отклонение — отказ карточки, и отказ попадает в причины неполноты снимка.
 *
 * Проверяются пять случаев: элемента нет, элемент пуст, значение дробное или
 * нечисловое, значение повторяется внутри группы, элементов больше одного.
 */
function readListPosition($, card, usedPositions) {
  const elements = card.find(SELECTORS.destination.cardRank)
  if (elements.length === 0) return { error: 'rankElementMissing' }
  if (elements.length > 1) return { error: 'rankElementDuplicated' }
  const text = normaliseValue(elements.first().text() || '')
  if (!text.length) return { error: 'rankEmpty' }
  if (!/^[1-9][0-9]*$/.test(text)) return { error: 'rankNotPositiveInteger' }
  const value = Number(text)
  if (!Number.isSafeInteger(value)) return { error: 'rankNotPositiveInteger' }
  if (usedPositions.has(value)) return { error: 'rankRepeated' }
  usedPositions.add(value)
  return { value }
}

/**
 * Разбор КОЛЛЕКЦИИ — обоих её видов, одним дискриминированным исходом.
 *
 * `collectionKind: 'container'` — дети зонтичной страницы, карточек нет;
 * `collectionKind: 'ranked'`    — карточки списка направления.
 *
 * Прежде эта граница знала только ранжированный вид и отказывала на
 * зонтичной странице, которую классификатор уже назвал коллекцией. Теперь
 * обе стороны берут ОДИН `analysePage`, и разойтись им нечем.
 */
function parseCollectionWithAnalysis({ document: $, url, analysis }) {
  const decided = analysis
  if (decided.kind === 'containerCollection') {
    return { collectionKind: 'container', children: decided.children, cards: [], rejectedCards: [] }
  }
  if (decided.kind !== 'rankedCollection') {
    throw new StructureMismatchError(
      `${JAPAN_GUIDE_ADAPTER}: ${url}: роль страницы «poi», грамматике направления она не подлежит`,
      { reason: 'pageRoleMismatch', role: 'poi' },
    )
  }
  if (!$(SELECTORS.destination.title).first().length) {
    throw new StructureMismatchError(`${JAPAN_GUIDE_ADAPTER}: ${url}: нет заголовка направления`)
  }
  const structure = decided.structure

  /*
   * ОТСУТСТВИЕ КАРТОЧЕК И ИХ ОТБРАКОВКА — РАЗНЫЕ СОБЫТИЯ.
   *
   * Пустая группа — сломанная разметка направления: списку неоткуда взяться,
   * и страница действительно не подлежит грамматике. Это отказ страницы.
   *
   * Группа с карточками, ни одна из которых не прошла ворота приёмки, — не
   * сломанная страница, а полностью отбракованный список. Роль измерена,
   * структура цела, известно даже, сколько карточек и почему отвергнута
   * каждая. Прежний общий `throw` в этой ветке уничтожал `rejectedCards`
   * вместе со стеком и превращал исправную коллекцию в цель с неизвестной
   * структурой. ИЗМЕРЕНО 18.08: так пропали все 166 целей и все коллекции
   * до единой — снимок сообщил `collectionsFound: 0` о сайте, состоящем
   * из направлений.
   *
   * Проверка стоит ДО цикла: она о разметке, а не об исходе приёмки.
   */
  /*
   * Обход групп и карточек — стабильный, по DOM: порядок объекта обязан
   * воспроизводиться байт в байт при повторе. `flatMap` сохраняет и порядок
   * групп, и порядок карточек внутри каждой.
   */
  const items = structure.groups.flatMap((group, groupIndex) =>
    $(group).find(SELECTORS.destination.card).toArray().map((card) => ({ card, groupIndex })))
  if (!items.length) {
    throw new StructureMismatchError(
      `${JAPAN_GUIDE_ADAPTER}: ${url}: в группе объектов нет ни одной DOM-карточки`,
    )
  }

  const cards = []
  const rejectedCards = []
  const seen = new Set()
  /*
   * РАНГИ ПРОВЕРЯЮТСЯ ВНУТРИ ГРУППЫ, а не по всему направлению.
   *
   * ИЗМЕРЕНО 19.08 на `e2158`: ранги сбрасываются с единицы в каждой
   * визуальной группе. Общее множество объявляло бы вторую группу целиком
   * повтором и отвергало её карточки кодом `rankRepeated`.
   *
   * `seen` при этом ОСТАЁТСЯ общим: один и тот же объект дважды в одном
   * направлении — по-прежнему дубль, в какой бы группе он ни лежал.
   */
  const usedByGroup = structure.groups.map(() => new Set())
  let index = 0
  for (const { card: element, groupIndex } of items) {
    index += 1
    const card = $(element)
    const anchor = card.find(SELECTORS.destination.cardName).first()
    if (!anchor.length) { rejectedCards.push({ index, code: 'cardWithoutName' }); continue }
    let canonical
    try {
      canonical = canonicalDiscoveryUrl(String(anchor.attr('href') ?? ''), url).url
    } catch (error) {
      rejectedCards.push({ index, code: cardRejectionCode(error) })
      continue
    }
    const position = readListPosition($, card, usedByGroup[groupIndex])
    if (position.error) { rejectedCards.push({ index, code: position.error }); continue }
    const spans = anchor.children('span').toArray()
    let editorialLevel
    try {
      /* Передаётся ВЕСЬ текст `span` — это аннотация, а маркер лишь её
         завершающий хвост. Резать здесь нечего: где кончается аннотация и
         начинается маркер, знает грамматика, а не место вызова. */
      editorialLevel = recommendationLevel({
        spanCount: spans.length,
        annotationText: spans.length ? $(spans[0]).text() : null,
      })
    } catch (error) {
      if (!(error instanceof RecommendationMarkerError)) throw error
      rejectedCards.push({ index, code: cardRejectionCode(error) })
      continue
    }
    const sourceKey = discoverySourceKey(canonical)
    if (seen.has(sourceKey)) { rejectedCards.push({ index, code: 'duplicateWithinDestination' }); continue }
    seen.add(sourceKey)
    const metaElement = card.find(SELECTORS.destination.cardMeta).first()
    cards.push({
      sourceKey,
      url: canonical,
      listPosition: position.value,
      editorialLevel,
      categoryHintRaw: metaElement.length ? metaElement.text() : null,
    })
  }
  /*
   * Пустой `cards` при непустом `rejectedCards` — ЗАКОННЫЙ исход разбора.
   * Обход получает свидетельство коллекции, пустой порядок, привязанный к
   * байтам той же страницы, и каждый отказ карточки позицией и кодом.
   * Снимок остаётся неполным — по причине `cardRejected`, — но больше не
   * утверждает, что роль или структура страницы неизвестны.
   */
  return { collectionKind: 'ranked', cards, rejectedCards }
}

/**
 * ПУБЛИЧНАЯ ГРАНИЦА: только разметка и собственный адрес страницы.
 *
 * Ни `analysis`, ни готовый разобранный документ снаружи не принимаются.
 * Прежде принимались — и через подставной `analysis` обычный объект можно
 * было выдать за контейнерную коллекцию, минуя и топологию, и структуру:
 * граница проверяла бы то, что ей передали, а не то, что на странице.
 * Разбор всегда вычисляется здесь, из HTML.
 */
export function parseDestination({ html, url }) {
  const $ = load(html)
  return parseCollectionWithAnalysis({ document: $, url, analysis: analysePage({ document: $, pageUrl: url }) })
}

/* ── Уровень 3: объект ────────────────────────────────────────────────── */

function admissionLeads($, { source, observedAt }) {
  const leads = []
  const omissions = []
  let unknownLabels = 0
  let emptyValues = 0
  const section = $(SELECTORS.attraction.admissionSection)
  if (section.length > 1) {
    throw new StructureMismatchError(
      `${JAPAN_GUIDE_ADAPTER}: ${source}: разделов «Hours and Fees» ${section.length}, ожидается не больше одного`,
    )
  }
  for (const blockElement of section.find(SELECTORS.attraction.admissionBlock).toArray()) {
    const block = $(blockElement)
    const titleElement = block.find(SELECTORS.attraction.admissionTitle).first()
    const rawName = titleElement.length ? titleElement.text() : null

    let appliesTo = null
    let nameFailure = null
    try {
      appliesTo = buildAppliesTo(rawName)
    } catch (error) {
      if (!(error instanceof TextGuardError)) throw error
      /* Подмена имени компонента на null запрещена: «часы башни» превратились
         бы в «часы объекта». Отвергаются ВСЕ подсказки компонента. */
      nameFailure = error
    }

    for (const itemElement of block.find(SELECTORS.attraction.admissionItem).toArray()) {
      const item = $(itemElement)
      const label = normaliseValue(item.find(SELECTORS.attraction.admissionLabel).first().text() || '')
      const kind = LABEL_TO_KIND[label]
      if (!kind) {
        unknownLabels += 1
        /*
         * Счётчик суммирует по прогону, omission прикрепляется к записи.
         * Без него снимок canary сообщил «неизвестных меток 1» и не сообщил,
         * у какой из 42 записей. Вычислить её из снимка нельзя: все 47
         * блоков отдали ровно три подсказки, асимметрии нет.
         *
         * Текста метки здесь не появляется — только её длина в байтах.
         * Догадку о конкретной метке она опровергает, фактом не делает.
         */
        omissions.push(buildOmission({
          code: 'unknownAdmissionLabel',
          locator: 'hours_fees_block',
          originalLengthBytes: utf8Bytes(label),
        }))
        continue
      }
      if (nameFailure) {
        const omission = omissionFromGuardError(nameFailure, 'componentName', 'hours_fees_block')
        if (omission) omissions.push(omission)
        continue
      }
      const contentElement = item.find(SELECTORS.attraction.admissionContent).first()
      if (!contentElement.length) { emptyValues += 1; continue }
      let value
      try {
        value = valueWithBoundary($, contentElement)
      } catch (error) {
        if (!(error instanceof AmbiguousValueError)) throw error
        omissions.push(buildOmission({
          code: 'ambiguousValueBoundary',
          locator: 'hours_fees_block',
          originalLengthBytes: utf8Bytes(normaliseValue(contentElement.text())),
        }))
        continue
      }
      if (!value.length) { emptyValues += 1; continue }
      try {
        leads.push(buildFactLead({ kind, appliesTo, value, source, sourceLocator: 'hours_fees_block', observedAt }))
      } catch (error) {
        if (!(error instanceof TextGuardError)) throw error
        const omission = omissionFromGuardError(error, 'leadValue', 'hours_fees_block')
        if (omission) omissions.push(omission)
        else emptyValues += 1
      }
    }
  }
  return { leads, omissions, unknownLabels, emptyValues }
}

function officialLinkLeads($, { source, observedAt }) {
  const leads = []
  const omissions = []
  for (const anchor of $(SELECTORS.attraction.linksRow).toArray()) {
    const element = $(anchor)
    if (!OFFICIAL_LINK_TEXT.test(normaliseValue(element.text() || ''))) continue
    let absolute
    try {
      absolute = new URL(String(element.attr('href') ?? ''), source)
    } catch {
      continue
    }
    if (absolute.protocol !== 'https:' && absolute.protocol !== 'http:') continue
    try {
      leads.push(buildFactLead({
        kind: 'official_url_hint',
        appliesTo: null,
        value: absolute.href,
        source,
        sourceLocator: 'links_and_resources_official',
        observedAt,
      }))
    } catch (error) {
      if (!(error instanceof TextGuardError)) throw error
      const omission = omissionFromGuardError(error, 'leadValue', 'links_and_resources_official')
      if (omission) omissions.push(omission)
    }
  }
  return { leads, omissions }
}

export function parseAttraction({ html, page, placements, carriedOmissions = [] }) {
  const $ = load(html)
  const role = classifyPageRole($, page.url)
  if (role !== 'poi') {
    throw new StructureMismatchError(
      `${JAPAN_GUIDE_ADAPTER}: ${page.url}: роль страницы «${role}», грамматике объекта она не подлежит`,
      { reason: 'pageRoleMismatch', role },
    )
  }
  /* Два разных отказа, а не один: пропавший элемент заголовка означает смену
     разметки, пустой заголовок при живом элементе — смену содержания. */
  const titleElement = $(SELECTORS.attraction.title).first()
  if (!titleElement.length) {
    throw new StructureMismatchError(
      `${JAPAN_GUIDE_ADAPTER}: ${page.url}: элемента заголовка объекта нет — запись не порождается`,
      { reason: 'titleElementMissing' },
    )
  }
  const nameEn = normaliseValue(titleElement.text())
  if (!nameEn.length) {
    throw new StructureMismatchError(
      `${JAPAN_GUIDE_ADAPTER}: ${page.url}: заголовок объекта пуст — запись не порождается`,
      { reason: 'titleEmpty' },
    )
  }

  const source = page.url
  const observedAt = page.observedAt
  const admission = admissionLeads($, { source, observedAt })
  const official = officialLinkLeads($, { source, observedAt })

  const leads = [...admission.leads, ...official.leads]
  const omissions = [...carriedOmissions, ...admission.omissions, ...official.omissions]

  try {
    leads.push(buildFactLead({
      kind: 'name_en', appliesTo: null, value: nameEn, source, sourceLocator: 'h1', observedAt,
    }))
  } catch (error) {
    if (!(error instanceof TextGuardError)) throw error
    throw new StructureMismatchError(
      `${JAPAN_GUIDE_ADAPTER}: ${page.url}: имя объекта отвергнуто (${error.code})`,
      { reason: 'nameRejected', code: error.code },
    )
  }

  const record = buildDiscoveryRecord({
    sourceKey: discoverySourceKey(page.url),
    url: page.url,
    nameEn,
    placements,
    factLeads: leads,
    omissions,
    pageEvidence: buildPageEvidence({
      url: page.url,
      pageRole: 'poi',
      pageBytes: page.pageBytes,
      rawPageDigest: page.rawPageDigest,
      observedAt: page.observedAt,
      ...page.diagnostics,
    }),
  })
  return { record, unknownLabels: admission.unknownLabels, emptyValues: admission.emptyValues }
}

/* ── State machine ────────────────────────────────────────────────────── */

const evidenceOf = (page, pageRole) => buildPageEvidence({
  url: page.url,
  pageRole,
  pageBytes: page.pageBytes,
  rawPageDigest: page.rawPageDigest,
  observedAt: page.observedAt,
  ...page.diagnostics,
})

/**
 * Полный обход: robots → каталог → ГРАФ КОЛЛЕКЦИЙ → записи объектов.
 *
 * `robots.txt` читается первым обменом КАЖДОГО прогона: запись в реестре —
 * снимок от 6 августа, а не разрешение на сегодня.
 *
 * ЧТО ИЗМЕРЕНИЕ 21.08 ОПРОВЕРГЛО. Прежний обход держал уровни: каталог даёт
 * цели, коллекция даёт карточки, карточка — объект. Комментарий на этом месте
 * прямо утверждал: «вложенная коллекция внутри коллекции обходом не
 * раскрывается — она пришла бы целью каталога или не пришла бы вовсе». Первый
 * полный обход показал обратное: 28 карточек вели на коллекции, которые
 * каталог УЖЕ классифицировал (второй GET отверг fetch-boundary кодом
 * `urlRepeated`), а `e5041` оказалась коллекцией, которой среди 208 целей
 * каталога нет вовсе, и разобралась сломанным объектом.
 *
 * ПОЭТОМУ УРОВНЕЙ БОЛЬШЕ НЕТ, ЕСТЬ ГРАФ. Узел — страница; ребро — карточка
 * или ребёнок зонтичной страницы. Обход — детерминированный BFS по порядку
 * первого появления. Инварианты, за которые отвечает именно этот код:
 *
 *   1. один GET и один `analysePage` на канонический URL — за это отвечает
 *      `visit`, единственный владелец кэша узлов;
 *   2. роль решает СТРАНИЦА, а не позиция ссылки: карточка равно может вести
 *      на объект и на коллекцию;
 *   3. коллекция никогда не попадает в очередь объектов;
 *   4. объект нескольких родителей строится один раз и сохраняет ВСЕ
 *      привязки;
 *   5. цикл A → B → A — обычное ребро: страница уже посещена, второго
 *      запроса нет, и `urlRepeated` при этом не ослабляется — граница
 *      по-прежнему отвергла бы повтор, просто обход её не зовёт.
 *
 * БЮДЖЕТ БОЛЬШЕ НЕ ПРОВЕРЯЕТСЯ ЗАРАНЕЕ, И ЭТО НЕ ПОСЛАБЛЕНИЕ. Нижняя граница
 * «по обмену на объект» была вычислима, пока список объектов был известен до
 * их обхода. У графа он неизвестен: чтобы узнать, объект ли карточка, её
 * страницу надо получить. Поэтому нехватка бюджета перестала быть решением
 * прогона и стала отказом КОНКРЕТНОГО узла с кодом `networkBudgetExhausted` —
 * fail-closed ровно там, где он случился, и с именем страницы.
 */
export async function collectJapanGuideDiscovery(portal, {
  limit = null,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  sleep = null,
  limits = FETCH_LIMITS,
} = {}) {
  const pacer = createRequestPacer({ limits, sleep })
  const clock = () => now().getTime()

  const entry = canonicalPageUrl(portal.discovery.entry)
  const reasons = new Map()
  const note = (code, count = 1) => reasons.set(code, (reasons.get(code) ?? 0) + count)

  /* robots.txt — первый обмен. Policy разбирается один раз и дальше
     спрашивается перед каждым запросом, включая цели редиректов. */
  const robots = await fetchRobots({ fetchImpl, now, pacer, clock, limits })
  const request = (url) => fetchHtmlPage({ url, fetchImpl, now, pacer, clock, limits, robots: robots.policy })

  const cataloguePage = await request(entry)
  const catalogue = parseCatalogue({ html: cataloguePage.text, url: cataloguePage.url })

  const placementsByPoi = new Map()
  const catalogueTargetEvidence = []
  const nestedCollectionEvidence = []
  const orderRecords = []
  const targetFailures = []
  const cardFailures = []
  const nodeFailures = []
  const poiOrder = []
  const catalogueSourceKey = discoverySourceKey(cataloguePage.url)
  const catalogueTargetKeys = new Set(catalogue.targets.map((target) => target.sourceKey))
  let directPoisFound = 0

  /* Ссылки непригодной формы названы поимённо, а не сведены к числу. */
  for (const href of catalogue.unsupported) {
    targetFailures.push({ ref: href, code: 'unsupportedCatalogueLinkShape' })
    note('unsupportedCatalogueLinkShape')
  }

  const remember = (sourceKey, url) => {
    if (!placementsByPoi.has(sourceKey)) {
      placementsByPoi.set(sourceKey, { url, placements: [], omissions: [], page: null })
      poiOrder.push(sourceKey)
    }
    return placementsByPoi.get(sourceKey)
  }

  /*
   * ── ЕДИНСТВЕННЫЙ ВЛАДЕЛЕЦ КЭША СТРАНИЦ ──
   *
   * Ни один другой участок обхода не зовёт `request` и не зовёт `analysePage`:
   * «один GET и один разбор на канонический URL» держится тем, что второго
   * места, где это возможно, просто нет. Узел строится ЦЕЛИКОМ и лишь потом
   * попадает в кэш — наполовину классифицированный узел не должен быть
   * достижим ни при каком порядке обхода.
   *
   * Исход дискриминирован: `code !== null` — узел не состоялся, роли у него
   * нет; `code === null` — роль измерена, а у коллекции ещё и разобран
   * порядок. Двух состояний «роль есть, но разбор не удался» не бывает
   * намеренно: тогда коллекция попала бы в свидетельства, а её порядок — нет.
   */
  const nodes = new Map()

  /* Запрет robots останавливает прогон целиком, и держится это ЗАКРЫТЫМ
     списком кодов: `robotsDenied` в нём нет, поэтому `pageRejectionCode`
     бросает дальше. Список кодов и есть проверка. */
  const fetchNode = async (url) => {
    try {
      return { page: await request(url), code: null }
    } catch (error) {
      return { page: null, code: pageRejectionCode(error) }
    }
  }

  const visit = async (sourceKey, url) => {
    const known = nodes.get(sourceKey)
    if (known) return known
    const node = { sourceKey, url, page: null, role: null, parsed: null, code: null }

    const fetched = await fetchNode(url)
    if (fetched.code) {
      nodes.set(sourceKey, { ...node, code: fetched.code })
      return nodes.get(sourceKey)
    }
    const page = fetched.page
    node.page = page

    /* РАЗБОР ОДИН НА СТРАНИЦУ: DOM разбирается один раз, `analysePage`
       вызывается один раз, и его исход служит и роли, и разбору. */
    const document = load(page.text)
    let analysis
    try {
      analysis = analysePage({ document, pageUrl: page.url })
    } catch (error) {
      /* Двусмысленная страница и страница без роли отвергаются обе — догадка
         о более вероятной роли здесь была бы тем самым молчаливым выбором,
         который контракт запрещает. Но записываются они РАЗНЫМИ кодами. */
      nodes.set(sourceKey, { ...node, code: pageRejectionCode(error) })
      return nodes.get(sourceKey)
    }
    const role = analysis.kind === 'poi' ? 'poi' : 'collection'

    /*
     * РОЛЬ ОБЯЗАНА БЫТЬ ВОЗМОЖНОЙ ДЛЯ СЕМЕЙСТВА АДРЕСА — ЗДЕСЬ, А НЕ В
     * СТРОИТЕЛЕ ПОРЯДКА.
     *
     * `ROLES_BY_FAMILY` описывает измеренное: суффиксный и вложенный адрес
     * бывают только объектами. До графа матрица применялась впервые уже на
     * построении порядка, то есть ПОСЛЕ обхода, и противоречие уронило бы
     * весь прогон исключением. В графе такая страница приходит карточкой, и
     * одна страница неизмеренной формы не имеет права уносить обход: отказ
     * закрытым кодом, диагностируемый и привязанный к узлу.
     */
    const allowed = ROLES_BY_FAMILY[matrixFamily(page.url)]
    if (!allowed || !allowed.includes(role)) {
      nodes.set(sourceKey, { ...node, code: ROLE_FAMILY_MISMATCH_CODE })
      return nodes.get(sourceKey)
    }

    if (role === 'collection') {
      try {
        node.parsed = parseCollectionWithAnalysis({ document, url: page.url, analysis })
      } catch (error) {
        nodes.set(sourceKey, { ...node, page, parsed: null, code: pageRejectionCode(error) })
        return nodes.get(sourceKey)
      }
    }
    node.role = role
    nodes.set(sourceKey, node)
    return node
  }

  /* Страница отвергается ОДИН раз, в канале того пути, которым найдена
     первым. Иначе цель каталога, упавшая на классификации и позже встреченная
     карточкой, лежала бы отказом и цели, и узла — два утверждения об одном
     событии, и обе причины неполноты посчитаны дважды. */
  const rejectedOnce = new Set()

  const collectionQueue = []
  const enqueued = new Set()
  const enqueue = (sourceKey, node) => {
    if (enqueued.has(sourceKey)) return
    enqueued.add(sourceKey)
    collectionQueue.push(sourceKey)
    /* Свидетельство коллекции НИЖЕ каталога — отдельным списком: цели
       каталога свой смысл не меняют, и приписывать им `e5041` нельзя. */
    if (!catalogueTargetKeys.has(sourceKey)) {
      nestedCollectionEvidence.push({ sourceKey, evidence: evidenceOf(node.page, 'collection') })
    }
  }

  /*
   * ── Уровень каталога: 208 целей, по одной классификации на цель ──
   *
   * КАЖДАЯ цель классифицируется по структуре — включая legacy. Прежде
   * legacy-цель без разговоров уходила в `parseDestination`, и объект
   * `/e/e4000.html`, попади он в каталог, был бы объявлен сломанным
   * направлением. Роль решает страница, а не форма адреса.
   */
  for (const target of catalogue.targets) {
    const node = await visit(target.sourceKey, target.url)
    if (node.code) {
      rejectedOnce.add(target.sourceKey)
      targetFailures.push({ ref: target.sourceKey, code: node.code })
      note(isStructureRejection(node.code) ? 'targetStructureMismatch' : 'targetFetchFailed')
      continue
    }
    catalogueTargetEvidence.push({ sourceKey: target.sourceKey, evidence: evidenceOf(node.page, node.role) })
    if (node.role === 'poi') {
      /* Прямой объект каталога. Ранга у него нет, и выдумывать его нельзя:
         выдуманная единица неотличима от измеренной. */
      directPoisFound += 1
      const bucket = remember(target.sourceKey, target.url)
      /* Страница уже получена. Просить её второй раз значило бы платить
         обменом за то, что лежит в руках, и завышать сетевой счётчик. */
      bucket.page = node.page
      bucket.placements.push(buildPlacement({
        kind: 'catalogueDirect',
        collectionSourceKey: catalogueSourceKey,
        listPosition: null,
        editorialLevel: null,
        categoryHint: null,
      }))
      continue
    }
    enqueue(target.sourceKey, node)
  }

  /*
   * ── BFS по графу коллекций ──
   *
   * Порядок — первого появления: очередь пополняется в том же порядке, в
   * каком элементы встречены в DOM, и обходится с головы. Никакой
   * неограниченной параллельности и никаких повторов: `visit` вернёт уже
   * известный узел, не тронув сеть.
   */
  for (let head = 0; head < collectionQueue.length; head += 1) {
    const destinationSourceKey = collectionQueue[head]
    const node = nodes.get(destinationSourceKey)
    const parsed = node.parsed
    const collectionKind = parsed.collectionKind
    const placementKind = PLACEMENT_KIND_BY_COLLECTION_KIND[collectionKind]

    for (const failure of parsed.rejectedCards) {
      cardFailures.push({ destination: destinationSourceKey, position: failure.index, code: failure.code })
      note('cardRejected')
    }

    /*
     * ОДНА ПОСЛЕДОВАТЕЛЬНОСТЬ РЁБЕР НА ОБА ВИДА КОЛЛЕКЦИИ.
     *
     * Зонтичная страница даёт детей топологией, ранжированная — карточками,
     * но дальше с ними происходит ровно одно и то же: узел классифицируется
     * и становится элементом порядка со своей ролью. Две ветки здесь
     * означали бы две копии обхода, которые разойдутся.
     */
    const links = collectionKind === 'container'
      ? parsed.children.map((child) => ({ sourceKey: child.sourceKey, url: child.url, card: null }))
      : parsed.cards.map((card) => ({ sourceKey: card.sourceKey, url: card.url, card }))

    const items = []
    for (const link of links) {
      const child = await visit(link.sourceKey, link.url)
      if (child.code) {
        if (!rejectedOnce.has(link.sourceKey)) {
          rejectedOnce.add(link.sourceKey)
          nodeFailures.push({ ref: link.sourceKey, origin: destinationSourceKey, code: child.code })
          note(isStructureRejection(child.code) ? 'nodeStructureMismatch' : 'nodeFetchFailed')
        }
        continue
      }
      items.push(orderItem(child.role, link.sourceKey))
      if (child.role === 'collection') {
        enqueue(link.sourceKey, child)
        continue
      }
      /* Объект: страница уже в руках, привязка добавляется к общему ведру.
         Второй родитель НЕ создаёт второго ведра — иначе общий объект был бы
         построен дважды и каждая копия знала бы одну связь из двух. */
      const bucket = remember(link.sourceKey, link.url)
      bucket.page = child.page
      if (link.card === null) {
        bucket.placements.push(buildPlacement({
          kind: placementKind,
          collectionSourceKey: destinationSourceKey,
          listPosition: null,
          editorialLevel: null,
          categoryHint: null,
        }))
        continue
      }
      const common = {
        kind: placementKind,
        collectionSourceKey: destinationSourceKey,
        listPosition: link.card.listPosition,
        editorialLevel: link.card.editorialLevel,
      }
      let placement
      try {
        placement = buildPlacement({ ...common, categoryHint: link.card.categoryHintRaw })
      } catch (error) {
        if (!(error instanceof TextGuardError)) throw error
        placement = buildPlacement({ ...common, categoryHint: null })
        const omission = omissionFromGuardError(error, 'categoryHint', 'top_attractions_card')
        if (omission) bucket.omissions.push(omission)
      }
      bucket.placements.push(placement)
    }

    /* Порядок привязан к байтам той страницы, из которой прочитан: то же
       наблюдение, что и в свидетельстве коллекции. */
    orderRecords.push(buildOrderRecord({
      destinationSourceKey,
      sourcePageDigest: node.page.rawPageDigest,
      items,
      collectionKind,
    }))
  }

  /*
   * ОХВАТ ОПИСЫВАЕТ ФАКТ, А НЕ ПРОСЬБУ.
   *
   * `--limit 50` при 50 и менее объектах не теряет ничего: обход прошёл все
   * цели и все объекты. Объявлять такой снимок ограниченным значило бы
   * навсегда запретить его как основание мониторинга — при том что терять
   * ему нечего.
   *
   * ЧЕГО `--limit` БОЛЬШЕ НЕ ДЕЛАЕТ — он не экономит обмены. Страница объекта
   * получена ещё на классификации: не получив её, нельзя было узнать, что это
   * объект. Предел режет ПОСТРОЕНИЕ ЗАПИСЕЙ, и снимок честно называет себя
   * ограниченным.
   */
  const limitApplied = limit !== null && limit < poiOrder.length
  if (limitApplied) note('limitApplied')
  const selected = limitApplied ? poiOrder.slice(0, limit) : poiOrder

  const records = []
  const poiFailures = []
  let unknownLabels = 0
  let emptyValues = 0

  for (const sourceKey of selected) {
    const bucket = placementsByPoi.get(sourceKey)
    try {
      const parsed = parseAttraction({
        html: bucket.page.text,
        page: bucket.page,
        placements: bucket.placements,
        carriedOmissions: bucket.omissions,
      })
      records.push(parsed.record)
      unknownLabels += parsed.unknownLabels
      emptyValues += parsed.emptyValues
    } catch (error) {
      /* Сетевого исхода здесь быть не может: страница получена на
         классификации, второго запроса нет. Причина поэтому одна. */
      poiFailures.push({ ref: sourceKey, code: pageRejectionCode(error) })
      note('poiStructureMismatch')
    }
  }

  const snapshot = buildDiscoverySnapshot({
    scope: limitApplied ? { kind: 'limited', limit } : { kind: 'full', limit: null },
    entryUrl: entry,
    incompleteReasons: [...reasons].map(([code, count]) => ({ code, count })),
    /* Потолки берутся у ТЕХ ЖЕ `limits`, под которыми шёл обход, а не у
       значения по умолчанию: прогон с переопределённым бюджетом обязан
       записать в снимок свой бюджет — иначе утверждение об исчерпании
       сверялось бы не с тем числом. */
    networkPolicy: {
      maxNetworkRequests: limits.maxNetworkRequests,
      maxRedirects: limits.maxRedirects,
    },
    robotsEvidence: robots.evidence,
    catalogueEvidence: evidenceOf(cataloguePage, 'catalogue'),
    catalogueTargetEvidence,
    nestedCollectionEvidence,
    orderRecords,
    records,
    rejected: {
      targets: targetFailures, cards: cardFailures, nodes: nodeFailures, pois: poiFailures,
    },
    counters: {
      networkRequests: pacer.networkRequests,
      catalogueTargetsFound: catalogue.targets.length,
      catalogueCollectionsFound: catalogueTargetEvidence
        .filter((row) => row.evidence.pageRole === 'collection').length,
      nestedCollectionsFound: nestedCollectionEvidence.length,
      directPoisFound,
      poisFound: poiOrder.length,
      /* Не «посещено»: страницы всех объектов получены на классификации.
         Считается ровно число попыток построить запись. */
      recordsAttempted: selected.length,
      recordsBuilt: records.length,
      nonCanonicalLinks: catalogue.unsupported.length,
      unknownAdmissionLabels: unknownLabels,
      emptyAdmissionValues: emptyValues,
    },
  })

  return {
    discovery: snapshot,
    meta: {
      adapter: JAPAN_GUIDE_ADAPTER,
      entry,
      complete: snapshot.complete,
      scope: snapshot.scope,
      incompleteReasons: snapshot.incompleteReasons,
      networkRequests: snapshot.counters.networkRequests,
      budgetRemaining: pacer.remaining,
      limits: {
        maxResponseBytes: limits.maxResponseBytes,
        maxNetworkRequests: limits.maxNetworkRequests,
        requestIntervalMs: limits.requestIntervalMs,
        byteLimits: BYTE_LIMITS,
      },
    },
  }
}

/* ── Мониторинг ───────────────────────────────────────────────────────── */

/**
 * Различия между двумя снимками discovery.
 *
 * ОБА СНИМКА ПРОВЕРЯЮТСЯ ПЕРВЫМ ДЕЛОМ, и оба обязаны быть полными снимками
 * одного охвата. Неполный снимок сравнивать не с чем: страницы, до которых
 * обход не дошёл, выглядели бы удалёнными источником, а `--limit` объявил бы
 * исчезнувшими все объекты за пределом.
 *
 * Разделов четыре и они независимы. Семантика — про содержание объекта.
 * Наблюдение — про байты его страницы. Порядок — про перестановку внутри
 * направления, один раз на направление. Родительские страницы — про каталог
 * и страницы направлений, чьи байты в записях объектов не отражены вовсе.
 */
export function diffDiscoverySnapshot(current, previous) {
  if (!previous) {
    return { comparable: false, refusal: 'нет предыдущего снимка для сравнения' }
  }
  /*
   * СРАВНИВАТЬ РАЗНЫЕ ВЕРСИИ НЕЛЬЗЯ — БЕЗ МИГРАТОРА ЭТО ЛОЖНЫЕ ИЗМЕНЕНИЯ.
   *
   * Домены отпечатков выведены из версии, поэтому семантически ОДИНАКОВЫЕ
   * снимки `v1` и `v2` дают разные `semanticDigest` на каждой записи и
   * разный `orderDigest` на каждой коллекции. Мониторинг сообщил бы, что
   * изменился весь сайт, хотя не изменилось ничего.
   *
   * Отказ, а не догадка: мигратора нет, и придумывать соответствие
   * отпечатков здесь значило бы выдать пересчёт за наблюдение.
   */
  if (current.contractVersion !== previous.contractVersion) {
    return {
      comparable: false,
      refusal: `версии снимков разные: ${current.contractVersion} и ${previous.contractVersion}; `
        + 'мигратора нет, сравнение отпечатков дало бы ложные изменения',
    }
  }
  for (const [label, snapshot] of [['текущий', current], ['предыдущий', previous]]) {
    try {
      assertDiscoverySnapshot(snapshot)
    } catch (error) {
      return { comparable: false, refusal: `${label} снимок не проходит проверку контракта: ${error.message}` }
    }
  }
  if (!current.complete || !previous.complete) {
    const which = [!previous.complete && 'предыдущий', !current.complete && 'текущий'].filter(Boolean).join(' и ')
    return {
      comparable: false,
      refusal: `${which} снимок неполон — сравнение объявило бы недошедшие страницы исчезнувшими`,
      incompleteReasons: {
        current: current.incompleteReasons,
        previous: previous.incompleteReasons,
      },
    }
  }
  if (current.scope.kind !== previous.scope.kind) {
    return { comparable: false, refusal: 'охваты снимков различаются — сравнивать нечего' }
  }

  const index = (snapshot) => new Map(snapshot.records.map((record) => [record.sourceKey, record]))
  const before = index(previous)
  const after = index(current)

  const appeared = []
  const semanticChanges = []
  const evidenceChanges = []
  for (const [sourceKey, record] of after) {
    const old = before.get(sourceKey)
    if (!old) { appeared.push({ sourceKey, nameEn: record.nameEn }); continue }
    if (old.semanticDigest !== record.semanticDigest) {
      semanticChanges.push({
        sourceKey,
        from: old.semanticDigest,
        to: record.semanticDigest,
        nameChanged: old.nameEn !== record.nameEn,
        leadsChanged: JSON.stringify(old.factLeads.map((l) => l.leadDigest))
          !== JSON.stringify(record.factLeads.map((l) => l.leadDigest)),
        omissionsChanged: JSON.stringify(old.omissions) !== JSON.stringify(record.omissions),
      })
    }
    if (old.pageEvidence.rawPageDigest !== record.pageEvidence.rawPageDigest) {
      evidenceChanges.push({
        sourceKey,
        bytesFrom: old.pageEvidence.pageBytes,
        bytesTo: record.pageEvidence.pageBytes,
        decodeErrorsFrom: old.pageEvidence.encodingDiagnostics.decodeErrorCount,
        decodeErrorsTo: record.pageEvidence.encodingDiagnostics.decodeErrorCount,
      })
    }
  }
  const vanished = []
  for (const [sourceKey, record] of before) {
    if (!after.has(sourceKey)) vanished.push({ sourceKey, nameEn: record.nameEn })
  }

  const orderSpec = VERSION_POLICY[current.contractVersion].order
  const prevOrders = new Map(previous.orderRecords.map((row) => [row.destinationSourceKey, row]))
  /*
   * ПЕРЕСТАНОВКА — ЭТО ИЗМЕНИВШАЯСЯ ПОСЛЕДОВАТЕЛЬНОСТЬ, А НЕ ИЗМЕНИВШИЙСЯ
   * ОТПЕЧАТОК.
   *
   * `orderDigest` покрывает и байты страницы, из которой порядок прочитан.
   * Поэтому переверстанная коллекция с тем же списком карточек давала запись
   * о перестановке с `moved: 0` — сообщение, которое читателю нечем отличить
   * от настоящей. Байты сообщает раздел родительских страниц; здесь остаётся
   * только то, что действительно переставилось.
   */
  const reordered = []
  for (const row of current.orderRecords) {
    const old = prevOrders.get(row.destinationSourceKey)
    if (!old || old.orderDigest === row.orderDigest) continue
    const wasSequence = orderSequence(old, orderSpec)
    const nowSequence = orderSequence(row, orderSpec)
    if (JSON.stringify(wasSequence) === JSON.stringify(nowSequence)) continue
    reordered.push({
      destinationSourceKey: row.destinationSourceKey,
      from: old.orderDigest,
      to: row.orderDigest,
      /* Последовательность взята ПО ВЕРСИИ формата, а не по форме объекта:
         у `v3` она лежит в `items` вместе с ролями, у `v1`/`v2` — в `order`.
         Версии здесь заведомо совпадают: сравнение разных отвергнуто выше. */
      moved: movedCount(wasSequence, nowSequence),
    })
  }

  /*
   * ── РОДИТЕЛЬСКИЕ СТРАНИЦЫ — ВЕСЬ ГРАФ, А НЕ ТОЛЬКО КАТАЛОГ И ЕГО ЦЕЛИ ──
   *
   * Их байты в записях объектов не отражены, поэтому без отдельного раздела
   * смена вёрстки каталога была бы неотличима от смены состава направлений.
   * Семантическим изменением объектов это не является и в `semanticChanges`
   * не попадает.
   *
   * ИЗМЕРЕНО 24.08: раздел смотрел только на каталог и его цели, а вложенные
   * коллекции не смотрел вовсе. Изменившиеся байты `e5041` давали ноль
   * родительских изменений и всплывали «перестановкой» с `moved: 0` — то
   * есть монитор сообщал о факте, которого не было, и молчал о факте,
   * который был. Набор родительских страниц собирается ОДИН раз и по
   * политике версии: у `v1`/`v2` вложенных коллекций нет, и множество
   * вырождается в прежнее.
   */
  const parentEvidenceOf = (snapshot) => {
    const policy = VERSION_POLICY[snapshot.contractVersion]
    const nested = policy.snapshotKeys.includes('nestedCollectionEvidence')
      ? snapshot.nestedCollectionEvidence
      : []
    return new Map([
      ...snapshot.catalogueTargetEvidence.map((row) => [row.sourceKey, { row, origin: 'catalogueTarget' }]),
      ...nested.map((row) => [row.sourceKey, { row, origin: 'nestedCollection' }]),
    ])
  }
  const prevParents = parentEvidenceOf(previous)
  const currentParents = parentEvidenceOf(current)

  const parentPageChanges = []
  if (previous.catalogueEvidence.rawPageDigest !== current.catalogueEvidence.rawPageDigest) {
    parentPageChanges.push({
      page: 'catalogue',
      origin: 'catalogue',
      bytesFrom: previous.catalogueEvidence.pageBytes,
      bytesTo: current.catalogueEvidence.pageBytes,
    })
  }
  for (const [sourceKey, { row, origin }] of currentParents) {
    const old = prevParents.get(sourceKey)
    if (!old || old.row.evidence.rawPageDigest === row.evidence.rawPageDigest) continue
    /* Роль берётся из свидетельства, а не подставляется словом «direction»:
       цель каталога бывает и коллекцией, и объектом, и смена роли между
       снимками — это факт, который отчёт обязан показать, а не сгладить. */
    parentPageChanges.push({
      page: row.evidence.pageRole,
      origin,
      sourceKey,
      roleFrom: old.row.evidence.pageRole,
      roleTo: row.evidence.pageRole,
      bytesFrom: old.row.evidence.pageBytes,
      bytesTo: row.evidence.pageBytes,
    })
  }

  /*
   * ── ТОПОЛОГИЯ ГРАФА: УЗЛЫ ПОЯВИЛИСЬ И ИСЧЕЗЛИ ──
   *
   * Прежде ни один раздел не сообщал о появлении или исчезновении САМОЙ
   * коллекции: `reordered` пропускал неизвестный ключ, а родительские
   * страницы — отсутствующее свидетельство. Целая коллекция могла прийти и
   * уйти при нулевом отчёте, если её объекты уже лежали в других коллекциях.
   *
   * Множество узлов — ключи порядков: у каждой наблюдённой коллекции порядок
   * ведётся, и это равенство держит контракт.
   */
  const nodeKeysOf = (snapshot) =>
    new Set(snapshot.orderRecords.map((row) => row.destinationSourceKey))
  const prevNodes = nodeKeysOf(previous)
  const currentNodes = nodeKeysOf(current)
  const graphChanges = []
  for (const sourceKey of currentNodes) {
    if (prevNodes.has(sourceKey)) continue
    graphChanges.push({
      change: 'collectionAppeared',
      sourceKey,
      origin: currentParents.get(sourceKey)?.origin ?? null,
    })
  }
  for (const sourceKey of prevNodes) {
    if (currentNodes.has(sourceKey)) continue
    graphChanges.push({
      change: 'collectionVanishedForHumanReview',
      sourceKey,
      origin: prevParents.get(sourceKey)?.origin ?? null,
    })
  }

  /*
   * Сигналы кодировки — по тем же родительским страницам, что и байты.
   * Диагностика в `rawPageDigest` не входит, поэтому страница может остаться
   * побайтово той же и при этом декодироваться иначе; на вложенных
   * коллекциях такое изменение раньше не было видно ни одним разделом.
   */
  const encodingChanges = []
  const signalsOf = (evidence) => JSON.stringify([
    evidence.encodingDiagnostics.httpCharset,
    evidence.encodingDiagnostics.metaCharset,
    evidence.encodingDiagnostics.decodePolicy,
    evidence.encodingDiagnostics.decodeErrorCount,
    evidence.encodingDiagnostics.decodeReplacements,
    evidence.encodingDiagnostics.nonWhitelistedCodepoints,
  ])
  if (signalsOf(previous.catalogueEvidence) !== signalsOf(current.catalogueEvidence)) {
    encodingChanges.push({ page: 'catalogue', origin: 'catalogue' })
  }
  for (const [sourceKey, { row, origin }] of currentParents) {
    const old = prevParents.get(sourceKey)
    if (!old || signalsOf(old.row.evidence) === signalsOf(row.evidence)) continue
    encodingChanges.push({ page: row.evidence.pageRole, origin, sourceKey })
  }
  if (previous.robotsEvidence.digest !== current.robotsEvidence.digest) {
    encodingChanges.push({ page: 'robots', origin: 'robots', from: previous.robotsEvidence.digest, to: current.robotsEvidence.digest })
  }

  return {
    comparable: true,
    appeared: appeared.length,
    vanished: vanished.length,
    semanticChanges: semanticChanges.length,
    reorderedDestinations: reordered.length,
    evidenceChanges: evidenceChanges.length,
    parentPageChanges: parentPageChanges.length,
    graphChanges: graphChanges.length,
    encodingChanges: encodingChanges.length,
    details: {
      appeared,
      /* Назван так, что вывод о закрытии из него не следует. */
      vanishedForHumanReview: vanished,
      semanticChanges,
      reordered,
      evidenceChanges,
      parentPageChanges,
      graphChanges,
      encodingChanges,
    },
  }
}
