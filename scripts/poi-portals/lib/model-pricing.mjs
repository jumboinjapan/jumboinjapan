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
 * Канонический реестр `PRICING_TABLES` содержит одну таблицу — официальные
 * цены OpenAI на `gpt-5.6-luna`, сверенные владельцем 17 августа 2026.
 * `resolvePricingTable` разрешает её по точному отпечатку и отказывает на
 * любом другом. Наполнение реестра — решение владельца: правка исходника.
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

/**
 * Домен таблицы со ступенчатым тарифом.
 *
 * Причина новой версии, а не новых необязательных полей: необязательная цена
 * — это цена, которую можно не объявить, и тогда граница считается по
 * умолчанию. Умолчание в деньгах и есть разрешение потратить больше.
 * В v2 ступень объявлена обязательно, а таблица без неё остаётся v1 и к
 * расчёту границы не допускается вовсе.
 */
export const MODEL_PRICING_V2_SPEC = 'poi-model-pricing/v2'

/** Обе версии домена. Список закрыт: третья версия — правка контракта. */
export const MODEL_PRICING_SPECS = Object.freeze([MODEL_PRICING_SPEC, MODEL_PRICING_V2_SPEC])

/** Точный состав таблицы. Единственный список в проекте. */
export const PRICING_TABLE_KEYS = Object.freeze([
  'contractVersion', 'pricingTableAsOf', 'currency', 'entries', 'pricingTableDigest',
])

/** Точный состав строки цены v1. */
export const PRICING_ENTRY_KEYS = Object.freeze([
  'providerId', 'modelId', 'modelVersion',
  'inputMicrosPerMillionTokens', 'outputMicrosPerMillionTokens',
])

/**
 * Точный состав строки цены v2: девять ключей.
 *
 * `cachedInputMicrosPerMillionTokens` записывается ради наблюдаемости и в
 * верхнюю границу НЕ входит. Кэш только удешевляет, и считать по нему потолок
 * значило бы обещать скидку, которой в конкретном прогоне может не быть.
 *
 * `longContextThresholdInputTokens` — порог, ВЫШЕ которого действует
 * повышенный тариф. Строго выше: у провайдера правило сформулировано как
 * «>272K», и «не менее» вместо «больше» удорожило бы ровно пограничный
 * прогон, то есть посчитало бы границу неверно в единственной точке, где
 * это заметно.
 */
export const PRICING_ENTRY_V2_KEYS = Object.freeze([
  'providerId', 'modelId', 'modelVersion',
  'inputMicrosPerMillionTokens', 'outputMicrosPerMillionTokens',
  'cachedInputMicrosPerMillionTokens', 'longContextThresholdInputTokens',
  'longContextInputMicrosPerMillionTokens', 'longContextOutputMicrosPerMillionTokens',
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
  /* Строгость формы снимается ДО чтения `contractVersion`: accessor-свойство
     прочиталось бы как обычное значение и выбрало бы домен, под которым его
     никто не объявлял. Байты этого прохода отбрасываются — нужен только
     отказ. */
  canonicalJsonBytes(table, MODEL_PRICING_SPEC)
  const spec = pricingContractSpec(table)
  const signed = {}
  for (const key of PRICING_TABLE_KEYS) {
    if (key === 'pricingTableDigest') continue
    if (!(key in table)) throw new TypeError(`${MODEL_PRICING_SPEC}: нет обязательного поля ${key}`)
    signed[key] = table[key]
  }
  const extra = Object.keys(table).filter((key) => !PRICING_TABLE_KEYS.includes(key))
  if (extra.length) throw new TypeError(`${spec}: лишние поля ${extra.join(', ')}`)
  return sha256Bytes(canonicalJsonBytes(signed, spec))
}

/**
 * Версия контракта таблицы. Единственное место, где строка сверяется со
 * списком: второй такой сверки в проекте нет и не заводится.
 */
export function pricingContractSpec(table) {
  if (!isPlainObject(table)) {
    throw new TypeError(`${MODEL_PRICING_SPEC}: таблица обязана быть простым объектом`)
  }
  const spec = table.contractVersion
  if (!MODEL_PRICING_SPECS.includes(spec)) {
    throw new TypeError(
      `contractVersion: ожидается одно из ${MODEL_PRICING_SPECS.join(', ')}; `
      + `получено ${JSON.stringify(spec)}`,
    )
  }
  return spec
}

/**
 * Форма отпечатка таблицы у потребителя, который версию таблицы не видит.
 *
 * Разрешение и профиль ссылаются на таблицу отпечатком, а не содержимым, и
 * версию контракта по одному отпечатку узнать нельзя. Поэтому здесь
 * допускаются оба домена, а привязку к КОНКРЕТНОЙ таблице делает сверка
 * значений в `assertPricingBinding`: она сравнивает сам отпечаток, а не его
 * ярлык.
 */
export function assertPricingDigestShape(value, where) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${where}: отпечаток таблицы обязан быть простым объектом`)
  }
  assertExactKeys(value, ['value', 'algorithm', 'spec'], where)
  assertSha256Value(value.value, `${where}.value`)
  assertExactly(value.algorithm, DIGEST_ALGORITHM, `${where}.algorithm`)
  if (!MODEL_PRICING_SPECS.includes(value.spec)) {
    throw new TypeError(
      `${where}.spec: ожидается одно из ${MODEL_PRICING_SPECS.join(', ')}; `
      + `получено ${JSON.stringify(value.spec)}`,
    )
  }
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
  const spec = pricingContractSpec(raw)
  assertExactKeys(raw, PRICING_TABLE_KEYS, spec)

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
    assertExactKeys(
      entry, spec === MODEL_PRICING_V2_SPEC ? PRICING_ENTRY_V2_KEYS : PRICING_ENTRY_KEYS, where,
    )
    assertExactIdentifier(entry.providerId, `${where}.providerId`)
    assertExactIdentifier(entry.modelId, `${where}.modelId`)
    assertExactIdentifier(entry.modelVersion, `${where}.modelVersion`)
    /* Ноль допустим и означает «бесплатно». Отсутствие строки нулём не
       считается: молчание — не утверждение о цене. */
    assertInteger(entry.inputMicrosPerMillionTokens, `${where}.inputMicrosPerMillionTokens`, 0)
    assertInteger(entry.outputMicrosPerMillionTokens, `${where}.outputMicrosPerMillionTokens`, 0)
    if (spec === MODEL_PRICING_V2_SPEC) assertLongContextTier(entry, where)
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
  /* Ярлык отпечатка обязан назвать домен ЭТОЙ таблицы, а не любой известный:
     таблица v2, подписанная как v1, читалась бы потребителем как таблица без
     ступени. */
  assertExactly(raw.pricingTableDigest.spec, spec, 'pricingTableDigest.spec')
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
 * Ступенчатый тариф длинного контекста.
 *
 * Три правила, и каждое закрывает свой способ занизить границу:
 *
 * — порог обязан быть положительным целым: нулевой порог означал бы, что
 *   повышенный тариф действует всегда, и это была бы другая таблица;
 * — повышающая ступень обязана быть НЕ ДЕШЕВЛЕ обычной. Ступень, которая
 *   дешевле, — это перепутанные местами столбцы, и обнаруживается такая
 *   перестановка только здесь: арифметика границы выберет ступень по
 *   потолку разрешения и посчитает всё «правильно» по неверным числам;
 * — кэшированный вход обязан быть не дороже обычного. Он в границу не
 *   входит, но строка, где скидка дороже цены, — свидетельство того, что
 *   столбцы перепутаны и в остальных полях тоже.
 */
function assertLongContextTier(entry, where) {
  assertInteger(
    entry.longContextThresholdInputTokens, `${where}.longContextThresholdInputTokens`, 1,
  )
  assertInteger(
    entry.cachedInputMicrosPerMillionTokens, `${where}.cachedInputMicrosPerMillionTokens`, 0,
  )
  assertInteger(
    entry.longContextInputMicrosPerMillionTokens,
    `${where}.longContextInputMicrosPerMillionTokens`, 0,
  )
  assertInteger(
    entry.longContextOutputMicrosPerMillionTokens,
    `${where}.longContextOutputMicrosPerMillionTokens`, 0,
  )
  if (entry.cachedInputMicrosPerMillionTokens > entry.inputMicrosPerMillionTokens) {
    throw new RangeError(
      `${where}.cachedInputMicrosPerMillionTokens: ${entry.cachedInputMicrosPerMillionTokens} `
      + `дороже некэшированного ${entry.inputMicrosPerMillionTokens} — столбцы перепутаны`,
    )
  }
  if (entry.longContextInputMicrosPerMillionTokens < entry.inputMicrosPerMillionTokens) {
    throw new RangeError(
      `${where}.longContextInputMicrosPerMillionTokens: ${entry.longContextInputMicrosPerMillionTokens} `
      + `дешевле обычного ${entry.inputMicrosPerMillionTokens} — ступень называется повышающей`,
    )
  }
  if (entry.longContextOutputMicrosPerMillionTokens < entry.outputMicrosPerMillionTokens) {
    throw new RangeError(
      `${where}.longContextOutputMicrosPerMillionTokens: ${entry.longContextOutputMicrosPerMillionTokens} `
      + `дешевле обычного ${entry.outputMicrosPerMillionTokens} — ступень называется повышающей`,
    )
  }
}

/**
 * Канонический реестр таблиц цен.
 *
 * Одна запись — официальные цены OpenAI на `gpt-5.6-luna`, сверенные по
 * странице модели 17 августа 2026 по Asia/Tokyo. Дата сверки — календарная
 * дата ПРОЕКТА, а не UTC: срок годности наблюдения истекает по тому же
 * часовому поясу, и две разные даты у одной проверки разошлись бы на сутки. Значения — микроединицы USD за миллион
 * токенов: \$0.20 входа — это 200 000, \$1.20 выхода — 1 200 000.
 *
 * Отпечаток записан РУКАМИ, а не вычислен при загрузке. Вычисленный при
 * загрузке отпечаток совпал бы с содержимым всегда, чем бы это содержимое ни
 * стало, и проверка `pricingTableDigest` превратилась бы в тавтологию.
 * Записанное значение — подпись владельца под конкретной последовательностью
 * байтов: правка любой цены рассогласует его, и таблица перестанет читаться.
 */
export const PRICING_TABLES = deepFreeze([
  {
    contractVersion: MODEL_PRICING_V2_SPEC,
    pricingTableAsOf: '2026-08-17',
    currency: 'USD',
    entries: [
      {
        providerId: 'openai',
        modelId: 'gpt-5.6-luna',
        modelVersion: 'gpt-5.6-luna',
        inputMicrosPerMillionTokens: 200_000,
        outputMicrosPerMillionTokens: 1_200_000,
        cachedInputMicrosPerMillionTokens: 20_000,
        longContextThresholdInputTokens: 272_000,
        longContextInputMicrosPerMillionTokens: 400_000,
        longContextOutputMicrosPerMillionTokens: 1_800_000,
      },
    ],
    pricingTableDigest: {
      value: 'sha256:90bf1694c3b85ecb248420e26129c910aa09285194597228b95effcde6015f5b',
      algorithm: DIGEST_ALGORITHM,
      spec: MODEL_PRICING_V2_SPEC,
    },
  },
])

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
      `${MODEL_PRICING_SPEC}: таблица цен ${digestValue} не объявлена. `
      + `В каноническом реестре ${PRICING_TABLES.length} `
      + `${PRICING_TABLES.length === 1 ? 'запись' : 'записей'}, и эта не из них.`,
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
