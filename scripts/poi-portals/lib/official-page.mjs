/**
 * JA-3: СТРУКТУРНЫЕ ФАКТЫ С ОФИЦИАЛЬНОЙ СТРАНИЦЫ — `poi-official-facts/v1`.
 *
 * Читается ТОЛЬКО то, что сайт сам объявил структурными данными: блоки
 * `application/ld+json` со схемой `schema.org`. Ни абзацев, ни заголовков, ни
 * «текста рядом с иконкой часов» — разбора вёрстки здесь нет вовсе, и это не
 * экономия усилий, а граница: разбор вёрстки неизбежно вытаскивает прозу, а
 * прозу чужого сайта мы не берём (план JA-3: «Japan Guide остаётся источником
 * обнаружения, а не источником копируемого описания» — то же и для
 * официальных сайтов объектов).
 *
 * ЧТО МОЖЕТ ПОЛУЧИТЬСЯ. Только поля из `ENRICHABLE_FACTS`: адрес, почтовый
 * индекс, японское имя и его чтение, координаты, официальный адрес страницы.
 * Список закрыт в `source-policy.mjs`, и здесь он не расширяется — каждое
 * значение перед выдачей сверяется с ним, а попытка выдать поле вне списка
 * бросает.
 *
 * КАЖДЫЙ ФАКТ — НАБЛЮДЕНИЕ, А НЕ ПОЛЕ. Он несёт адрес страницы, момент чтения,
 * локатор (откуда именно взят) и `confidence: 'unverified'`, `verifiedAt: null`.
 * Превратить наблюдение в поле карточки этот модуль не может: у него нет ни
 * записи, ни кандидата — только чтение и форма.
 *
 * ПОЧЕМУ ВЕЗДЕ ПОТОЛКИ. Страница чужая и может быть враждебной: сорок тысяч
 * блоков `ld+json`, граф глубиной в тысячу, строка на мегабайт. Каждый потолок
 * здесь — не «оптимизация», а условие того, что разбор завершится и не съест
 * память. Упор в потолок — названный пропуск, а не тихий обрыв.
 *
 * ЗНАКИ ЯПОНСКОГО ПИСЬМА И УПРАВЛЯЮЩИЕ ЗНАКИ ЗАДАНЫ ESCAPE-ПОСЛЕДОВАТЕЛЬНОСТЯМИ.
 * Диапазон, записанный литералами, читается глазами как «какие-то иероглифы» и
 * правится вслепую; управляющий знак литералом невидим вовсе.
 */
import { assertNoLoneSurrogate, deepFreeze } from '../../lib/canonical-contract.mjs'
import { ENRICHABLE_FACTS } from './source-policy.mjs'

export const OFFICIAL_FACTS_SPEC = 'poi-official-facts/v1'

export const PARSE_LIMITS = deepFreeze({
  maxHtmlBytes: 2 * 1024 * 1024,
  maxBlocks: 20,
  maxBlockBytes: 256 * 1024,
  maxNodes: 2000,
  maxDepth: 8,
  maxValueBytes: 512,
})

export const PLACE_TYPES = Object.freeze([
  'Place', 'TouristAttraction', 'TouristDestination', 'LandmarksOrHistoricalBuildings',
  'Museum', 'Park', 'BuddhistTemple', 'PlaceOfWorship', 'Aquarium', 'Zoo',
  'AmusementPark', 'ArtGallery', 'Castle', 'CivicStructure', 'Landform',
])

export const OMISSION_CODES = Object.freeze([
  'htmlTooLarge', 'blockLimitReached', 'blockTooLarge', 'blockNotJson',
  'nodeLimitReached', 'depthLimitReached', 'noPlaceNode',
  'valueTooLong', 'valueRejected', 'valueOutOfRange',
])

export const JAPAN_BBOX = deepFreeze({ minLat: 20.2, maxLat: 45.8, minLon: 122.5, maxLon: 154.0 })

const HAS_JAPANESE = new RegExp('[\\u3040-\\u30ff\\u4e00-\\u9fff\\u3005\\u3006\\u30fc]')
const KANA_ONLY = new RegExp('^[\\u3040-\\u30ff\\u30fc\\s\\u30fb\\uff65-]+$')
const POSTAL = new RegExp('^\\u3012?\\s*(\\d{3})-?(\\d{4})$')
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f]')
const SCHEMA_PREFIX = /^https?:\/\/schema\.org\//
const SCRIPT_BLOCK = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi

const utf8 = (value) => Buffer.byteLength(value, 'utf8')

/**
 * Значение из чужой страницы, приведённое к пригодному виду ЛИБО отвергнутое.
 *
 * Управляющие знаки, одиночные суррогаты и слишком длинные строки не
 * «чинятся»: строка, из которой что-то вырезали, перестаёт быть тем, что
 * сказал источник.
 */
function cleanValue(raw, limitBytes = PARSE_LIMITS.maxValueBytes) {
  if (typeof raw !== 'string') return { ok: false, code: 'valueRejected' }
  if (CONTROL.test(raw)) return { ok: false, code: 'valueRejected' }
  const value = raw.replace(/\s+/g, ' ').trim()
  if (!value) return { ok: false, code: 'valueRejected' }
  if (utf8(value) > limitBytes) return { ok: false, code: 'valueTooLong' }
  try {
    assertNoLoneSurrogate(value, `${OFFICIAL_FACTS_SPEC}.value`)
  } catch {
    return { ok: false, code: 'valueRejected' }
  }
  return { ok: true, value }
}

/** Блоки `ld+json` из HTML — с потолками и названными пропусками. */
export function extractJsonLdBlocks(html, limits = PARSE_LIMITS) {
  if (typeof html !== 'string') throw new TypeError(`${OFFICIAL_FACTS_SPEC}: ожидается текст страницы`)
  if (utf8(html) > limits.maxHtmlBytes) {
    return { blocks: [], omissions: [{ code: 'htmlTooLarge', detail: `страница больше ${limits.maxHtmlBytes} байт` }] }
  }
  const omissions = []
  const blocks = []
  SCRIPT_BLOCK.lastIndex = 0
  let match
  let index = 0
  while ((match = SCRIPT_BLOCK.exec(html)) !== null) {
    index += 1
    if (blocks.length >= limits.maxBlocks) {
      omissions.push({ code: 'blockLimitReached', detail: `блоков ld+json больше ${limits.maxBlocks}` })
      break
    }
    const raw = match[1]
    if (utf8(raw) > limits.maxBlockBytes) {
      omissions.push({ code: 'blockTooLarge', detail: `блок ${index} больше ${limits.maxBlockBytes} байт` })
      continue
    }
    try {
      blocks.push(JSON.parse(raw))
    } catch {
      omissions.push({ code: 'blockNotJson', detail: `блок ${index} не разбирается как JSON` })
    }
  }
  return { blocks, omissions }
}

/** Узлы графа `ld+json` — обход в ширину под потолками узлов и глубины. */
function walkNodes(blocks, limits) {
  const omissions = []
  const nodes = []
  const queue = blocks.map((value) => ({ value, depth: 0 }))
  let deepSeen = false
  while (queue.length) {
    if (nodes.length >= limits.maxNodes) {
      omissions.push({ code: 'nodeLimitReached', detail: `узлов графа больше ${limits.maxNodes}` })
      break
    }
    const { value, depth } = queue.shift()
    if (depth > limits.maxDepth) {
      if (!deepSeen) { omissions.push({ code: 'depthLimitReached', detail: `граф глубже ${limits.maxDepth}` }); deepSeen = true }
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) queue.push({ value: item, depth: depth + 1 })
      continue
    }
    if (!value || typeof value !== 'object') continue
    nodes.push(value)
    for (const key of Object.keys(value)) {
      const child = value[key]
      if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 })
    }
  }
  return { nodes, omissions }
}

const typesOf = (node) => {
  const declared = node['@type']
  if (typeof declared === 'string') return [declared]
  if (Array.isArray(declared)) return declared.filter((item) => typeof item === 'string')
  return []
}

/** Узел — место? Только по закрытому списку типов. */
export function isPlaceNode(node) {
  return typesOf(node).some((type) => PLACE_TYPES.includes(type.replace(SCHEMA_PREFIX, '')))
}

/**
 * ФАКТЫ МЕСТА СО СТРАНИЦЫ.
 *
 * Возвращает `{ facts, omissions, blocks, placeNodes }`. Каждый факт —
 * `{ field, value, sourceUrl, observedAt, locator, confidence, verifiedAt }`;
 * `field` обязан быть в `ENRICHABLE_FACTS`, иначе это не факт, а находка,
 * которой здесь не место.
 *
 * ПРИНАДЛЕЖНОСТЬ ФАКТА МЕСТУ СОХРАНЯЕТСЯ. У каждого факта есть `place` — номер
 * узла, из которого он взят.
 *
 * Аудит JG-2 (находка 03) предъявил, зачем это нужно. Прежняя редакция
 * складывала факты всех узлов в один плоский список и сортировала его: страница
 * с двумя музеями — (34.39, 132.45) и (33.83, 132.76) — давала первую широту от
 * одного и первую долготу от другого, то есть точку (33.83, 132.45), которой в
 * источнике нет вовсе, и имя первого музея к ней в придачу. Выдуманная точка
 * уходила в поиск как наблюдение.
 *
 * Поэтому: факт помнит своё место, координаты берутся ПАРОЙ одного узла, а
 * расхождение узлов по любому полю названо в `conflicts`. Выбрать между двумя
 * местами разбор не вправе — это решение о тождестве, и принимает его человек.
 */
export function collectPlaceFacts({ html, url, observedAt, limits = PARSE_LIMITS }) {
  if (typeof url !== 'string' || !url) throw new TypeError(`${OFFICIAL_FACTS_SPEC}: нужен адрес страницы`)
  if (typeof observedAt !== 'string' || !observedAt) throw new TypeError(`${OFFICIAL_FACTS_SPEC}: нужен момент чтения`)
  const extracted = extractJsonLdBlocks(html, limits)
  const walked = walkNodes(extracted.blocks, limits)
  const omissions = [...extracted.omissions, ...walked.omissions]
  const facts = []
  const seen = new Set()
  let placeIndex = -1
  const add = (field, value, locator) => {
    if (!ENRICHABLE_FACTS.includes(field)) {
      throw new Error(`${OFFICIAL_FACTS_SPEC}: поле «${field}» вне закрытого списка извлекаемого`)
    }
    const key = `${placeIndex} ${field} ${value}`
    if (seen.has(key)) return
    seen.add(key)
    facts.push({ field, value, place: placeIndex, sourceUrl: url, observedAt, locator, confidence: 'unverified', verifiedAt: null })
  }
  const take = (raw, locator, apply) => {
    const cleaned = cleanValue(raw, limits.maxValueBytes)
    if (!cleaned.ok) { omissions.push({ code: cleaned.code, locator }); return }
    apply(cleaned.value)
  }

  const places = walked.nodes.filter(isPlaceNode)
  if (!places.length) omissions.push({ code: 'noPlaceNode', detail: 'структурных данных о месте на странице нет' })

  for (const node of places) {
    placeIndex += 1
    if (node.name !== undefined) {
      take(node.name, 'jsonld:Place.name', (value) => {
        if (!HAS_JAPANESE.test(value)) return
        const kana = KANA_ONLY.test(value)
        add(kana ? 'nameKana' : 'nameJa', value, kana ? 'jsonld:Place.name(kana)' : 'jsonld:Place.name')
      })
    }
    if (node.alternateName !== undefined) {
      take(node.alternateName, 'jsonld:Place.alternateName', (value) => {
        if (KANA_ONLY.test(value)) add('nameKana', value, 'jsonld:Place.alternateName')
      })
    }
    if (node.url !== undefined) {
      take(node.url, 'jsonld:Place.url', (value) => {
        let parsed
        try { parsed = new URL(value) } catch { omissions.push({ code: 'valueRejected', locator: 'jsonld:Place.url' }); return }
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') add('officialUrl', parsed.toString(), 'jsonld:Place.url')
        else omissions.push({ code: 'valueRejected', locator: 'jsonld:Place.url' })
      })
    }
    const address = node.address
    if (typeof address === 'string') {
      take(address, 'jsonld:Place.address', (value) => {
        if (HAS_JAPANESE.test(value)) add('address', value, 'jsonld:Place.address')
      })
    } else if (address && typeof address === 'object' && !Array.isArray(address)) {
      /* Части адреса склеиваются в порядке японской записи: префектура,
         муниципалитет, остальное. Разбор на составляющие делает общий
         `parseJapaneseAddress`, и второй его редакции здесь нет. */
      const parts = ['addressRegion', 'addressLocality', 'streetAddress']
        .map((key) => (typeof address[key] === 'string' ? address[key].trim() : ''))
        .filter(Boolean)
        .join('')
      if (parts) {
        take(parts, 'jsonld:PostalAddress', (value) => {
          if (HAS_JAPANESE.test(value)) add('address', value, 'jsonld:PostalAddress')
        })
      }
      if (address.postalCode !== undefined) {
        take(address.postalCode, 'jsonld:PostalAddress.postalCode', (value) => {
          const matched = POSTAL.exec(value)
          if (matched) add('postalCode', `${matched[1]}-${matched[2]}`, 'jsonld:PostalAddress.postalCode')
          else omissions.push({ code: 'valueRejected', locator: 'jsonld:PostalAddress.postalCode' })
        })
      }
    }
    const geo = node.geo
    if (geo && typeof geo === 'object' && !Array.isArray(geo)) {
      const lat = Number(geo.latitude)
      const lon = Number(geo.longitude)
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const inside = lat >= JAPAN_BBOX.minLat && lat <= JAPAN_BBOX.maxLat
          && lon >= JAPAN_BBOX.minLon && lon <= JAPAN_BBOX.maxLon
        if (inside) {
          /* Пара — или ничего: одна координата места не задаёт. */
          add('lat', String(lat), 'jsonld:GeoCoordinates.latitude')
          add('lon', String(lon), 'jsonld:GeoCoordinates.longitude')
        } else {
          omissions.push({ code: 'valueOutOfRange', locator: 'jsonld:GeoCoordinates', detail: `${lat}, ${lon} вне границ Японии` })
        }
      } else if (geo.latitude !== undefined || geo.longitude !== undefined) {
        omissions.push({ code: 'valueRejected', locator: 'jsonld:GeoCoordinates' })
      }
    }
  }

  for (const omission of omissions) {
    if (!OMISSION_CODES.includes(omission.code)) {
      throw new Error(`${OFFICIAL_FACTS_SPEC}: пропуск «${omission.code}» вне закрытого списка`)
    }
  }
  /* Сортировка внутри места, а не поперёк мест: порядок не должен переносить
     значение с одного узла на другой. */
  facts.sort((left, right) => (left.place - right.place)
    || (left.field < right.field ? -1 : left.field > right.field ? 1
      : left.value < right.value ? -1 : left.value > right.value ? 1 : 0))
  /* РАСХОЖДЕНИЯ МЕЖДУ МЕСТАМИ — НАЗВАНЫ. Поле, по которому два узла страницы
     говорят разное, не выбирается: оно перечислено, и решает человек. */
  const byField = new Map()
  for (const fact of facts) {
    if (!byField.has(fact.field)) byField.set(fact.field, new Set())
    byField.get(fact.field).add(fact.value)
  }
  const conflicts = [...byField.entries()].filter(([, values]) => values.size > 1).map(([field]) => field).sort()
  return {
    spec: OFFICIAL_FACTS_SPEC,
    facts,
    omissions,
    conflicts,
    blocks: extracted.blocks.length,
    placeNodes: places.length,
  }
}
