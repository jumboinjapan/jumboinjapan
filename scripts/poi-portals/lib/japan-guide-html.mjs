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
  movedCount,
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
} from './html-fetch.mjs'
import { CARD_REJECTION_CODES, PAGE_REJECTION_CODES } from './discovery-contract.mjs'

export const JAPAN_GUIDE_ADAPTER = 'japan-guide-html'

/* ── Селекторы ────────────────────────────────────────────────────────── */

export const SELECTORS = Object.freeze({
  catalogue: Object.freeze({
    signature: 'div.dest_top_destinations__regions',
    title: 'header.dest_top__section_header > h1.dest_top__section_title',
    destinationLinks:
      'div.dest_top_destinations__regions > div.dest_top_destinations__region'
      + ' > div.dest_top_destinations__region_text > div.dest_top_destinations__region_dests a[href]',
  }),
  destination: Object.freeze({
    signature: 'section#section_spot_list header.spot_list__header h2.spot_list__list_title',
    title: 'div.page_title > h1.page_title__title',
    group: 'section#section_spot_list div.spot_list__category',
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
    this.details = details
  }
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
export function classifyPageRole($) {
  /*
   * ПОРЯДОК ОБЯЗАТЕЛЕН: сначала две НЕЗАВИСИМЫЕ положительные сигнатуры,
   * потом их пересечение, и только потом отрицательные ограничения.
   *
   * Прежняя версия определяла POI как «есть H1 И НЕТ признаков collection».
   * При таком определении `collection` и `poi` не могли стать истинными
   * одновременно ни на какой странице, и ветка `pageRoleAmbiguous`
   * существовала только текстом. Проверка, которую невозможно провалить,
   * не проверяет ничего.
   */
  const spotListSections = $('section#section_spot_list').length
  const listTitles = $(SELECTORS.destination.signature).length
  const admissionBlocks = $(SELECTORS.attraction.admissionSection)
    .find(SELECTORS.attraction.admissionBlock).length

  // Положительная сигнатура направления: список объектов с заголовком.
  const collectionCandidate = spotListSections > 0 && listTitles > 0
  // Положительная сигнатура объекта: раздел фактов с блоком компонента.
  const poiCandidate = admissionBlocks > 0

  /*
   * ПЕРЕСЕЧЕНИЕ — ДО любых отрицаний. Достижимо: страница со списком
   * объектов И с блоком часов/входа проходит обе грамматики. Такая страница
   * обязана быть отвергнута, а не приписана к той роли, которую проверили
   * первой.
   */
  if (collectionCandidate && poiCandidate) {
    throw new StructureMismatchError(
      `${JAPAN_GUIDE_ADAPTER}: страница несёт обе положительные сигнатуры сразу — `
      + `список объектов (${listTitles}) и раздел фактов (${admissionBlocks})`,
      { reason: 'pageRoleAmbiguous' },
    )
  }

  /* Отрицательные ограничения конкретной грамматики — только теперь. */
  if (collectionCandidate) {
    const groups = $(SELECTORS.destination.group).toArray()
      .filter((group) => !$(group).children(SELECTORS.destination.groupHeader).length)
    if (listTitles === 1 && groups.length === 1) return 'collection'
    throw new StructureMismatchError(
      `${JAPAN_GUIDE_ADAPTER}: заголовков списка ${listTitles}, групп без заголовка ${groups.length}`,
      { reason: 'pageRoleUnknown' },
    )
  }

  const hasTitle = $(SELECTORS.attraction.title).first().length > 0
  if (poiCandidate) {
    if (hasTitle) return 'poi'
    throw new StructureMismatchError(
      `${JAPAN_GUIDE_ADAPTER}: раздел фактов есть, заголовка объекта нет`,
      { reason: 'pageRoleUnknown' },
    )
  }

  /*
   * Остаток: ни списка, ни раздела фактов. ИЗМЕРЕНО, что это настоящие
   * объекты: обе карточки Nozawa (`section#section_admission` — 0) отдают
   * `name_en` и `official_url_hint`. Требовать раздел фактов как ЕДИНСТВЕННЫЙ
   * признак POI нельзя — тогда эти страницы стали бы `pageRoleUnknown` и
   * полный снимок снова оказался бы недостижим.
   *
   * `section#section_links` в положительную сигнатуру не входит намеренно:
   * измерение показало его И на направлении `/destinations/nozawa-onsen/`,
   * так что он роль не различает.
   *
   * Отрицание применяется ЗДЕСЬ — после проверки пересечения, а не до неё,
   * поэтому двусмысленность остаётся достижимой.
   */
  if (hasTitle && spotListSections === 0) return 'poi'

  throw new StructureMismatchError(
    `${JAPAN_GUIDE_ADAPTER}: страница не проходит ни грамматику направления, ни грамматику объекта`,
    { reason: 'pageRoleUnknown' },
  )
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

export function parseDestination({ html, url }) {
  const $ = load(html)
  /* Разбор направления получает только то, что классифицировано как
     направление. Роль вычисляется здесь же и той же функцией, что и в
     обходе, — второй грамматики «на месте» не заводится. */
  const role = classifyPageRole($)
  if (role !== 'collection') {
    throw new StructureMismatchError(
      `${JAPAN_GUIDE_ADAPTER}: ${url}: роль страницы «${role}», грамматике направления она не подлежит`,
      { reason: 'pageRoleMismatch', role },
    )
  }
  if (!$(SELECTORS.destination.title).first().length) {
    throw new StructureMismatchError(`${JAPAN_GUIDE_ADAPTER}: ${url}: нет заголовка направления`)
  }
  const groups = $(SELECTORS.destination.group).toArray()
    .filter((group) => !$(group).children(SELECTORS.destination.groupHeader).length)
  if (groups.length !== 1) {
    throw new StructureMismatchError(
      `${JAPAN_GUIDE_ADAPTER}: ${url}: групп без заголовка ${groups.length}, ожидается одна`,
    )
  }

  const cards = []
  const rejectedCards = []
  const seen = new Set()
  const usedPositions = new Set()
  let index = 0
  for (const element of $(groups[0]).find(SELECTORS.destination.card).toArray()) {
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
    const position = readListPosition($, card, usedPositions)
    if (position.error) { rejectedCards.push({ index, code: position.error }); continue }
    const spans = anchor.children('span').toArray()
    let editorialLevel
    try {
      editorialLevel = recommendationLevel({
        spanCount: spans.length,
        markerText: spans.length ? $(spans[0]).text() : null,
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
  if (!cards.length) {
    throw new StructureMismatchError(`${JAPAN_GUIDE_ADAPTER}: ${url}: в группе объектов нет ни одной карточки`)
  }
  return { cards, rejectedCards }
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
      if (!kind) { unknownLabels += 1; continue }
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
  const role = classifyPageRole($)
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
 * Полный обход: robots → каталог → направления → объекты.
 *
 * `robots.txt` читается первым обменом КАЖДОГО прогона: запись в реестре —
 * снимок от 6 августа, а не разрешение на сегодня.
 *
 * Перед уровнем объектов бюджет проверяется явно. Нижняя граница известна:
 * по одному обмену на объект. Если она не помещается, уровень не начинается
 * вовсе — обход, упирающийся в потолок на середине, отдал бы снимок, в
 * котором «не найдено» и «не дошли» неразличимы.
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
  const orderRecords = []
  const targetFailures = []
  const cardFailures = []
  const poiOrder = []
  const catalogueSourceKey = discoverySourceKey(cataloguePage.url)
  let collectionsFound = 0
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
   * КАЖДАЯ цель классифицируется по структуре — включая legacy. Прежде
   * legacy-цель без разговоров уходила в `parseDestination`, и объект
   * `/e/e4000.html`, попади он в каталог, был бы объявлен сломанным
   * направлением. Роль решает страница, а не форма адреса.
   *
   * Рекурсии по-прежнему нет: из коллекции берутся только карточки объектов,
   * с объекта не ходим никуда. Вложенная коллекция внутри коллекции обходом
   * не раскрывается — она пришла бы целью каталога или не пришла бы вовсе.
   */
  for (const target of catalogue.targets) {
    let page
    try {
      page = await request(target.url)
    } catch (error) {
      /* Запрет robots останавливает прогон целиком, и держится это ЗАКРЫТЫМ
         списком кодов: `robotsDenied` в нём нет, поэтому `pageRejectionCode`
         бросает дальше. Отдельная проверка `instanceof RobotsError` здесь
         стояла и была снята — она не могла провалиться и потому ничего не
         проверяла. Список кодов и есть проверка. */
      targetFailures.push({ ref: target.sourceKey, code: pageRejectionCode(error) })
      note('targetFetchFailed')
      continue
    }

    let role
    try {
      role = classifyPageRole(load(page.text))
    } catch (error) {
      /* Двусмысленная страница и страница без роли отвергаются ОДИНАКОВО —
         обе неизвестны обходу. Догадка о более вероятной роли здесь была бы
         тем самым молчаливым выбором, который контракт запрещает. */
      targetFailures.push({ ref: target.sourceKey, code: pageRejectionCode(error) })
      note('targetStructureMismatch')
      continue
    }

    if (role === 'poi') {
      /* Прямой объект каталога. Ранга у него нет, и выдумывать его нельзя:
         выдуманная единица неотличима от измеренной. */
      catalogueTargetEvidence.push({ sourceKey: target.sourceKey, evidence: evidenceOf(page, 'poi') })
      directPoisFound += 1
      const bucket = remember(target.sourceKey, target.url)
      /* Страница уже получена. Просить её второй раз значило бы платить
         обменом за то, что лежит в руках, и завышать сетевой счётчик. */
      bucket.page = page
      bucket.placements.push(buildPlacement({
        kind: 'catalogueDirect',
        collectionSourceKey: catalogueSourceKey,
        listPosition: null,
        editorialLevel: null,
        categoryHint: null,
      }))
      continue
    }

    let parsed
    try {
      parsed = parseDestination({ html: page.text, url: page.url })
    } catch (error) {
      targetFailures.push({ ref: target.sourceKey, code: pageRejectionCode(error) })
      note('targetStructureMismatch')
      continue
    }
    catalogueTargetEvidence.push({ sourceKey: target.sourceKey, evidence: evidenceOf(page, 'collection') })
    collectionsFound += 1
    for (const failure of parsed.rejectedCards) {
      cardFailures.push({ destination: target.sourceKey, position: failure.index, code: failure.code })
      note('cardRejected')
    }
    const ordered = []
    for (const card of parsed.cards) {
      ordered.push(card.sourceKey)
      const bucket = remember(card.sourceKey, card.url)
      const common = {
        kind: 'destinationRanking',
        collectionSourceKey: target.sourceKey,
        listPosition: card.listPosition,
        editorialLevel: card.editorialLevel,
      }
      let placement
      try {
        placement = buildPlacement({ ...common, categoryHint: card.categoryHintRaw })
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
    orderRecords.push(buildOrderRecord(target.sourceKey, page.rawPageDigest, ordered))
  }

  if (limit !== null && limit < poiOrder.length) note('limitApplied')
  const selected = limit === null ? poiOrder : poiOrder.slice(0, limit)

  /* Нижняя граница оставшихся обменов: по одному на объект, у которого
     страницы ещё нет. Прямые объекты каталога уже получены на первом
     уровне, и считать их снова значило бы объявить нехватку бюджета там,
     где обменов не требуется. */
  const needFetch = selected.filter((key) => placementsByPoi.get(key).page === null).length
  const budgetFits = pacer.fits(needFetch)
  if (!budgetFits) note('budgetInsufficient')

  const records = []
  const poiFailures = []
  let unknownLabels = 0
  let emptyValues = 0

  if (budgetFits) {
    for (const sourceKey of selected) {
      const bucket = placementsByPoi.get(sourceKey)
      let page = bucket.page
      if (page === null) {
        try {
          page = await request(bucket.url)
        } catch (error) {
          poiFailures.push({ ref: sourceKey, code: pageRejectionCode(error) })
          note('poiFetchFailed')
          continue
        }
      }
      try {
        const parsed = parseAttraction({
          html: page.text, page, placements: bucket.placements, carriedOmissions: bucket.omissions,
        })
        records.push(parsed.record)
        unknownLabels += parsed.unknownLabels
        emptyValues += parsed.emptyValues
      } catch (error) {
        poiFailures.push({ ref: sourceKey, code: pageRejectionCode(error) })
        note('poiStructureMismatch')
      }
    }
  }

  const snapshot = buildDiscoverySnapshot({
    scope: limit === null ? { kind: 'full', limit: null } : { kind: 'limited', limit },
    entryUrl: entry,
    incompleteReasons: [...reasons].map(([code, count]) => ({ code, count })),
    robotsEvidence: robots.evidence,
    catalogueEvidence: evidenceOf(cataloguePage, 'catalogue'),
    catalogueTargetEvidence,
    orderRecords,
    records,
    rejected: { targets: targetFailures, cards: cardFailures, pois: poiFailures },
    counters: {
      networkRequests: pacer.networkRequests,
      catalogueTargetsFound: catalogue.targets.length,
      collectionsFound,
      directPoisFound,
      poisFound: poiOrder.length,
      poisVisited: budgetFits ? selected.length : 0,
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

  const prevOrders = new Map(previous.orderRecords.map((row) => [row.destinationSourceKey, row]))
  const reordered = []
  for (const row of current.orderRecords) {
    const old = prevOrders.get(row.destinationSourceKey)
    if (!old || old.orderDigest === row.orderDigest) continue
    reordered.push({
      destinationSourceKey: row.destinationSourceKey,
      from: old.orderDigest,
      to: row.orderDigest,
      moved: movedCount(old.order, row.order),
    })
  }

  /* Родительские страницы: их байты в записях объектов не отражены, поэтому
     без отдельного раздела смена вёрстки каталога была бы неотличима от
     смены состава направлений. Семантическим изменением объектов это не
     является и в semanticChanges не попадает. */
  const parentPageChanges = []
  if (previous.catalogueEvidence.rawPageDigest !== current.catalogueEvidence.rawPageDigest) {
    parentPageChanges.push({
      page: 'catalogue',
      bytesFrom: previous.catalogueEvidence.pageBytes,
      bytesTo: current.catalogueEvidence.pageBytes,
    })
  }
  const prevTargets = new Map(previous.catalogueTargetEvidence.map((row) => [row.sourceKey, row.evidence]))
  for (const row of current.catalogueTargetEvidence) {
    const old = prevTargets.get(row.sourceKey)
    if (!old || old.rawPageDigest === row.evidence.rawPageDigest) continue
    /* Роль берётся из свидетельства, а не подставляется словом «direction»:
       цель каталога бывает и коллекцией, и объектом, и смена роли между
       снимками — это факт, который отчёт обязан показать, а не сгладить. */
    parentPageChanges.push({
      page: row.evidence.pageRole,
      sourceKey: row.sourceKey,
      roleFrom: old.pageRole,
      roleTo: row.evidence.pageRole,
      bytesFrom: old.pageBytes,
      bytesTo: row.evidence.pageBytes,
    })
  }

  const encodingChanges = []
  const signalsOf = (evidence) => JSON.stringify([
    evidence.encodingDiagnostics.httpCharset,
    evidence.encodingDiagnostics.metaCharset,
    evidence.encodingDiagnostics.decodePolicy,
  ])
  if (signalsOf(previous.catalogueEvidence) !== signalsOf(current.catalogueEvidence)) {
    encodingChanges.push({ page: 'catalogue' })
  }
  if (previous.robotsEvidence.digest !== current.robotsEvidence.digest) {
    encodingChanges.push({ page: 'robots', from: previous.robotsEvidence.digest, to: current.robotsEvidence.digest })
  }

  return {
    comparable: true,
    appeared: appeared.length,
    vanished: vanished.length,
    semanticChanges: semanticChanges.length,
    reorderedDestinations: reordered.length,
    evidenceChanges: evidenceChanges.length,
    parentPageChanges: parentPageChanges.length,
    encodingChanges: encodingChanges.length,
    details: {
      appeared,
      /* Назван так, что вывод о закрытии из него не следует. */
      vanishedForHumanReview: vanished,
      semanticChanges,
      reordered,
      evidenceChanges,
      parentPageChanges,
      encodingChanges,
    },
  }
}
