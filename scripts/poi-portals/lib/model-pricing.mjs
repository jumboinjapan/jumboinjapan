/**
 * Контракт закреплённой таблицы цен, `poi-model-pricing/v1`.
 *
 * Цена — не справочная величина, а вход в арифметику полномочия: по ней
 * preflight считает верхнюю границу того, сколько владелец разрешил
 * потратить. Всё, что таблица молча теряет или подставляет, становится
 * разрешением потратить больше, чем разрешено.
 *
 * Отсюда три правила, которые здесь важнее удобства. Отсутствующая цена не
 * равна нулю — ноль это утверждение «бесплатно», и записывается оно явно.
 * Приблизительного совпадения строки нет: `providerId`, `modelId` и
 * `modelVersion` совпадают точно, иначе прогон оплачивается по цене другой
 * модели. Ближайшей по дате таблицы тоже нет: разрешение выдано на конкретный
 * отпечаток, а не на «примерно те же цены».
 *
 * Канонический реестр `PRICING_TABLES` пуст. Ни одна таблица не объявлена, и
 * пока это так, `resolvePricingTable` отказывает на любом отпечатке.
 * Наполнение реестра — решение владельца, а не коммит с кодом.
 */
import {
  assertExactKeys,
  assertExactly,
  assertInteger,
  assertNoLoneSurrogate,
  assertSha256Value,
  canonicalJsonBytes,
  deepFreeze,
  isPlainObject,
  isStrictCalendarDate,
} from '../../lib/canonical-contract.mjs'
import { DIGEST_ALGORITHM, sha256Bytes, UNIT_SEPARATOR } from '../../lib/byte-digest.mjs'

/** Домен таблицы цен. Входит в подписываемые байты первым полем. */
export const MODEL_PRICING_SPEC = 'poi-model-pricing/v1'

/** Точный состав таблицы. Единственный список в проекте. */
export const PRICING_TABLE_KEYS = Object.freeze([
  'contractVersion', 'pricingTableAsOf', 'currency', 'entries', 'pricingTableDigest',
])

/** Точный состав строки цены. */
export const PRICING_ENTRY_KEYS = Object.freeze([
  'providerId', 'modelId', 'modelVersion',
  'inputMicrosPerMillionTokens', 'outputMicrosPerMillionTokens',
])

/**
 * Единица цены — микроединица валюты за миллион токенов.
 *
 * Названа константой, чтобы знаменатель контракта и делитель арифметики были
 * одним значением: два литерала одной единицы расходятся молча, а расходятся
 * они на деньгах.
 */
export const TOKENS_PER_PRICE_UNIT = 1_000_000

/** Код валюты: ровно три прописные латинские буквы. Выражение приватно. */
const CURRENCY_CODE = /^[A-Z]{3}$/

/**
 * Управляющие символы C0, DEL и C1 — перебором кодовых точек, а не шаблоном.
 *
 * Так диапазон читается ровно теми числами, которые в нём и стоят, и не
 * зависит от того, как исходный текст пережил копирование: символьный класс с
 * буквальными управляющими знаками невидим глазом и ломается при переносе.
 */
function hasControlChar(value) {
  for (const ch of value) {
    const code = ch.codePointAt(0)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

/**
 * Идентификатор строки цены: точный, без нормализации.
 *
 * Обрезка пробелов и приведение регистра запрещены по той же причине, по
 * какой запрещены в имени файла: они принимают то, чего точная сверка с
 * профилем не увидит, и прогон оплачивается по чужой строке.
 */
function assertExactIdentifier(value, where) {
  if (typeof value !== 'string' || !value.length) {
    throw new TypeError(`${where}: ожидается непустая строка, получено ${JSON.stringify(value)}`)
  }
  assertNoLoneSurrogate(value, where)
  if (hasControlChar(value)) {
    throw new TypeError(`${where}: управляющие символы недопустимы`)
  }
  if (value !== value.trim()) {
    throw new TypeError(
      `${where}: окружающие пробелы недопустимы — сверка с профилем точная, и обрезка приняла бы `
      + 'строку, которой в профиле нет',
    )
  }
}

const SEPARATOR = String.fromCharCode(UNIT_SEPARATOR)

/** Составной ключ строки. Разделитель тот же, что и в прочих потоках. */
export function pricingEntryKey({ providerId, modelId, modelVersion }) {
  return `${providerId}${SEPARATOR}${modelId}${SEPARATOR}${modelVersion}`
}

/**
 * Подпись таблицы: всё, кроме самой подписи.
 *
 * Строгая форма исходного объекта снимается до проекции ключей: `Object.keys`
 * не видит символьных, неперечисляемых и accessor-свойств, и две разные
 * таблицы получили бы один отпечаток.
 */
export function pricingTableDigest(table) {
  if (!isPlainObject(table)) {
    throw new TypeError(`${MODEL_PRICING_SPEC}: таблица обязана быть простым объектом`)
  }
  canonicalJsonBytes(table, MODEL_PRICING_SPEC)
  const signed = {}
  for (const key of PRICING_TABLE_KEYS) {
    if (key === 'pricingTableDigest') continue
    if (!(key in table)) throw new TypeError(`${MODEL_PRICING_SPEC}: нет обязательного поля ${key}`)
    signed[key] = table[key]
  }
  const extra = Object.keys(table).filter((key) => !PRICING_TABLE_KEYS.includes(key))
  if (extra.length) throw new TypeError(`${MODEL_PRICING_SPEC}: лишние поля ${extra.join(', ')}`)
  return sha256Bytes(canonicalJsonBytes(signed, MODEL_PRICING_SPEC))
}

/**
 * Единственная проверка таблицы цен.
 *
 * Сохранённому отпечатку доверия нет: он пересчитывается здесь же и является
 * предметом проверки, а не свидетельством.
 */
export function parseAndVerifyPricingTable(raw) {
  if (!isPlainObject(raw)) {
    throw new TypeError(`${MODEL_PRICING_SPEC}: таблица обязана быть простым объектом`)
  }
  canonicalJsonBytes(raw, MODEL_PRICING_SPEC)
  assertExactKeys(raw, PRICING_TABLE_KEYS, MODEL_PRICING_SPEC)
  assertExactly(raw.contractVersion, MODEL_PRICING_SPEC, 'contractVersion')

  if (!isStrictCalendarDate(raw.pricingTableAsOf)) {
    throw new TypeError(
      'pricingTableAsOf: ожидается существующая календарная дата YYYY-MM-DD, получено '
      + `${JSON.stringify(raw.pricingTableAsOf)}`,
    )
  }
  if (typeof raw.currency !== 'string' || !CURRENCY_CODE.test(raw.currency)) {
    throw new TypeError(
      `currency: ожидается ровно три прописные латинские буквы, получено ${JSON.stringify(raw.currency)}`,
    )
  }

  if (!Array.isArray(raw.entries) || !raw.entries.length) {
    throw new TypeError('entries: ожидается непустой массив строк цены')
  }
  const keys = []
  raw.entries.forEach((entry, i) => {
    const where = `entries[${i}]`
    assertExactKeys(entry, PRICING_ENTRY_KEYS, where)
    assertExactIdentifier(entry.providerId, `${where}.providerId`)
    assertExactIdentifier(entry.modelId, `${where}.modelId`)
    assertExactIdentifier(entry.modelVersion, `${where}.modelVersion`)
    /* Ноль допустим и означает «бесплатно». Отсутствие строки нулём не
       считается: молчание — не утверждение о цене. */
    assertInteger(entry.inputMicrosPerMillionTokens, `${where}.inputMicrosPerMillionTokens`, 0)
    assertInteger(entry.outputMicrosPerMillionTokens, `${where}.outputMicrosPerMillionTokens`, 0)
    keys.push(pricingEntryKey(entry))
  })
  const sorted = [...keys].sort()
  if (keys.some((key, i) => key !== sorted[i])) {
    throw new TypeError(
      'entries: строки обязаны быть отсортированы по составному ключу providerId, modelId, modelVersion',
    )
  }
  if (new Set(keys).size !== keys.length) {
    throw new TypeError('entries: составной ключ строки повторяется — цена стала бы неоднозначной')
  }

  assertExactKeys(raw.pricingTableDigest, ['value', 'algorithm', 'spec'], 'pricingTableDigest')
  assertSha256Value(raw.pricingTableDigest.value, 'pricingTableDigest.value')
  assertExactly(raw.pricingTableDigest.algorithm, DIGEST_ALGORITHM, 'pricingTableDigest.algorithm')
  assertExactly(raw.pricingTableDigest.spec, MODEL_PRICING_SPEC, 'pricingTableDigest.spec')
  const recomputed = pricingTableDigest(raw)
  if (recomputed !== raw.pricingTableDigest.value) {
    throw new TypeError(
      `pricingTableDigest не сходится: в таблице ${raw.pricingTableDigest.value}, пересчёт даёт `
      + `${recomputed}. Сохранённое значение здесь не свидетельство, а предмет проверки.`,
    )
  }
  return deepFreeze(structuredClone(raw))
}

/**
 * Канонический реестр таблиц цен. ПУСТ.
 *
 * Ни одна таблица не объявлена, поэтому платный прогон недостижим независимо
 * от того, что лежит в разрешении.
 */
export const PRICING_TABLES = deepFreeze([])

/**
 * Разрешение таблицы по ТОЧНОМУ отпечатку.
 *
 * Ни `options`, ни подставного реестра, ни отката по дате, ни «ближайшей»
 * таблицы: разрешение выдано на конкретный отпечаток, и подставить вместо
 * него похожий значит оплатить прогон по ценам, которых никто не утверждал.
 */
export function resolvePricingTable(digestValue) {
  assertSha256Value(digestValue, `${MODEL_PRICING_SPEC}: отпечаток таблицы`)
  const found = PRICING_TABLES.filter((table) => table?.pricingTableDigest?.value === digestValue)
  if (found.length > 1) {
    throw new Error(
      `${MODEL_PRICING_SPEC}: отпечатку ${digestValue} соответствует ${found.length} таблиц — `
      + 'цена стала бы неоднозначной',
    )
  }
  if (!found.length) {
    throw new Error(
      `${MODEL_PRICING_SPEC}: таблица цен ${digestValue} не объявлена. Канонический реестр пуст: `
      + 'пока в нём нет ни одной таблицы, платный прогон невозможен.',
    )
  }
  return parseAndVerifyPricingTable(structuredClone(found[0]))
}

/** Точная строка цены. Приблизительного совпадения не существует. */
export function findPricingEntry(table, { providerId, modelId, modelVersion }) {
  const wanted = pricingEntryKey({ providerId, modelId, modelVersion })
  const found = table.entries.filter((entry) => pricingEntryKey(entry) === wanted)
  if (found.length !== 1) {
    throw new Error(
      `${MODEL_PRICING_SPEC}: строки цены для ${wanted.split(SEPARATOR).join(' / ')} `
      + `${found.length ? 'больше одной' : 'нет'}. Отсутствующая цена нулём не считается.`,
    )
  }
  return found[0]
}
