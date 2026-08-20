/**
 * Алфавит сохраняемых значений Japan Guide и грамматика маркера рекомендации.
 *
 * ГРАНИЦА ПРИМЕНИМОСТИ, названная явно, чтобы её не расширили молча:
 * этот список кодовых точек описывает АНГЛОЯЗЫЧНЫЙ japan-guide.com и больше
 * ничего. Для японских официальных источников (этап 10c) он неверен — там
 * ожидаются кана и кандзи, и они здесь запрещены намеренно. Файл назван по
 * источнику, а не «text-guard», ровно поэтому: общее имя рано или поздно
 * превратило бы английский алфавит в политику всего проекта.
 *
 * ЗАЧЕМ ЗАКРЫТЫЙ СПИСОК, А НЕ `\p{L}` ИЛИ Latin script.
 * Измерено 17.08.2026 на трёх живых страницах: документ отдаётся смешанными
 * байтами — преимущественно ASCII, с вкраплениями Shift_JIS и с настоящими
 * UTF-8-последовательностями одновременно. Часть байтовых пар Shift_JIS
 * является валидным UTF-8 и декодируется БЕЗ ошибки и БЕЗ U+FFFD в неверные
 * символы: на всех трёх страницах так возникают U+0242 и U+0082. Проверка
 * «нет U+FFFD» их не видит. `\p{L}` и Latin script пропустили бы U+0242 тоже.
 * Ловит только перечисление разрешённого.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ U+00A0. Неразрывный пробел разрешён к приходу, но до
 * проверки алфавита он не доживает: `normaliseValue` превращает его в
 * обычный пробел шагом раньше. Держать его в списке значило бы держать
 * ветку, которую невозможно провалить. Снимут нормализацию — значение с
 * U+00A0 будет отвергнуто, и это ровно то поведение, которое нужно.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ U+2022. Точка-буллит не является символом значения: это
 * отдельный сигнал редакционной рекомендации, у него своя грамматика
 * (`recommendationLevel`) и своё место в разметке — ЗАВЕРШАЮЩИЙ ряд внутри
 * `span` ссылки-имени. Ни он, ни аннотация перед ним в сохраняемый текст не
 * попадают ни одним путём, поэтому в алфавите значений им делать нечего.
 */

/** Версия контракта алфавита. Пишется рядом с диагностикой страницы. */
export const TEXT_GUARD_SPEC = 'japan-guide-text-guard/v1'

/* ── Закрытый алфавит ─────────────────────────────────────────────────── */

/** Диапазоны разрешённых кодовых точек, границы включительно. */
const ALLOWED_RANGES = Object.freeze([
  Object.freeze([0x0020, 0x007e]), // печатный ASCII
  Object.freeze([0x2010, 0x2014]), // дефис, неразрывный дефис, цифровое тире, en, em
])

/**
 * Одиночные разрешённые кодовые точки.
 *
 * Макронные гласные перечислены составленными формами (NFC). Разложенная
 * форма «A + U+0304» до проверки не доходит: `normaliseValue` применяет NFC
 * первым шагом. Порядок шагов проверяется тестом, а не комментарием.
 */
const ALLOWED_SINGLES = Object.freeze([
  0x00a5, // ¥ — знак иены встречается в ценах
  0x0100, 0x0101, // Ā ā
  0x0112, 0x0113, // Ē ē
  0x012a, 0x012b, // Ī ī
  0x014c, 0x014d, // Ō ō
  0x016a, 0x016b, // Ū ū
  0x2018, 0x2019, 0x201c, 0x201d, // типографские кавычки
  0x2026, // …
])

const ALLOWED_SINGLE_SET = new Set(ALLOWED_SINGLES)

/** Читаемое имя кодовой точки для сообщения об отказе. */
export function describeCodepoint(codepoint) {
  return `U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * Принадлежность закрытому алфавиту.
 *
 * Единственное место, где решается, что символ допустим. Второй такой
 * проверки в проекте нет: разойдясь, две копии списка разошлись бы молча.
 */
export function isAllowedCodepoint(codepoint) {
  if (ALLOWED_SINGLE_SET.has(codepoint)) return true
  for (const [from, to] of ALLOWED_RANGES) {
    if (codepoint >= from && codepoint <= to) return true
  }
  return false
}

/* ── Ошибки ───────────────────────────────────────────────────────────── */

/**
 * Отказ значения. Несёт код, локатор и длину исходной строки в байтах —
 * ровно то, что уходит в `omissions`. Сам текст НЕ несёт: отчёт хранит
 * причину отказа, а не отвергнутое содержимое.
 */
export class TextGuardError extends Error {
  constructor(code, message, { locator = null, originalLengthBytes = null, codepoint = null } = {}) {
    super(message)
    this.name = 'TextGuardError'
    this.code = code
    this.locator = locator
    this.originalLengthBytes = originalLengthBytes
    this.codepoint = codepoint
  }
}

/** Отказ карточки из-за маркера рекомендации. Отвергается карточка целиком. */
export class RecommendationMarkerError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'RecommendationMarkerError'
    this.code = code
  }
}

/* ── Конвейер значения ────────────────────────────────────────────────── */

/**
 * Шаг 1 и 2: NFC, затем нормализация пробелов.
 *
 * Порядок не переставляется: NFC обязан отработать до алфавита, иначе
 * разложенная форма `Ōsakajō` была бы отвергнута по комбинирующему знаку
 * U+0304, которого в списке нет и не будет.
 *
 * Класс `\s` в JavaScript включает U+00A0, U+3000 и остальные пробельные —
 * поэтому неразрывный пробел становится обычным здесь, а не в алфавите.
 */
export function normaliseValue(raw) {
  if (typeof raw !== 'string') {
    throw new TypeError(`${TEXT_GUARD_SPEC}: ожидается строка, получено ${typeof raw}`)
  }
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

/** Длина в байтах UTF-8. Считается после нормализации, как решено владельцем. */
export function utf8Bytes(value) {
  return Buffer.byteLength(value, 'utf8')
}

/**
 * Шаг 3: алфавит. Отвергает по ПЕРВОЙ посторонней кодовой точке и называет её.
 *
 * Обход идёт по кодовым точкам (`for…of`), а не по кодовым единицам UTF-16:
 * суррогатная пара иначе развалилась бы на две половины, и сообщение
 * называло бы кодовую точку, которой в строке нет.
 */
export function assertAllowedCodepoints(value, { locator = null } = {}) {
  for (const character of value) {
    const codepoint = character.codePointAt(0)
    if (isAllowedCodepoint(codepoint)) continue
    throw new TextGuardError(
      'nonWhitelistedCodepoint',
      `${TEXT_GUARD_SPEC}: ${describeCodepoint(codepoint)} вне разрешённого алфавита`,
      { locator, originalLengthBytes: utf8Bytes(value), codepoint },
    )
  }
  return value
}

/**
 * Полный конвейер: NFC → пробелы → алфавит → предел UTF-8.
 *
 * Обрезки нет ни при каких условиях: превышение предела — отказ значения, а
 * не укороченное значение. Укороченная подсказка выглядит как факт и
 * отличается от факта только тем, что неверна.
 *
 * Возвращает нормализованную строку. Пустая строка после нормализации —
 * отказ с кодом `empty`: пустое значение подсказкой не является.
 */
export function guardValue(raw, { locator = null, limitBytes }) {
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) {
    throw new TypeError(`${TEXT_GUARD_SPEC}: предел обязан быть положительным целым, получено ${limitBytes}`)
  }
  const value = normaliseValue(raw)
  if (!value.length) {
    throw new TextGuardError('empty', `${TEXT_GUARD_SPEC}: значение пусто после нормализации`, {
      locator,
      originalLengthBytes: 0,
    })
  }
  assertAllowedCodepoints(value, { locator })
  const bytes = utf8Bytes(value)
  if (bytes > limitBytes) {
    throw new TextGuardError(
      'tooLong',
      `${TEXT_GUARD_SPEC}: ${bytes} байт при пределе ${limitBytes}; обрезка запрещена`,
      { locator, originalLengthBytes: bytes },
    )
  }
  return value
}

/* ── Грамматика маркера рекомендации ──────────────────────────────────── */

/** Закрытый диапазон уровня. Больше трёх точек — отказ, а не усечение. */
export const MAX_RECOMMENDATION_LEVEL = 3

/** Завершающий ряд U+2022: то, что и есть маркер. Может быть пустым. */
const TRAILING_MARKER = /•*$/u

/**
 * Чем ЗАКАНЧИВАЕТСЯ аннотация, когда маркер от неё отделён.
 *
 * Проверяется ТОЛЬКО граница — не алфавит и не содержание. Внутри аннотации
 * допустимо что угодно: «Local·Name» законна, потому что заканчивается
 * буквой.
 *
 * Категории Unicode, а не список ASCII: аннотация бывает японской, и
 * «周辺» обязана заканчиваться буквой так же, как «Local». `Pe` — закрывающая
 * скобка, включая «）» и «」»; `Pf` — завершающая кавычка, включая «»» и «’».
 *
 * ЗАЧЕМ. После правки маркера `span` без U+2022 стал значить уровень 0 —
 * тихо. Смени сайт символ, и «Local··» дало бы ноль на каждой карточке, не
 * подав ни одного сигнала. Граница делает такую подмену громкой ПОКАРТОЧНО:
 * снимок сохраняет направление, позицию и код `invalidMarker`, а не общий
 * счётчик без источника — эту ошибку мы уже разбирали на admission-метке.
 */
const ANNOTATION_BOUNDARY = /[\p{L}\p{N}\p{Pe}\p{Pf}]$/u

/**
 * Уровень редакционной рекомендации по ЗАВЕРШАЮЩЕМУ ряду U+2022 внутри
 * единственного `span` ссылки-имени.
 *
 * ЧТО БЫЛО ИЗМЕРЕНО И ЧТО ОКАЗАЛОСЬ НЕВЕРНЫМ.
 *
 * Прежняя версия требовала, чтобы ВЕСЬ текст `span` был `•`, `••` или `•••`.
 * Модель строилась на одной странице Осаки, где так и выглядело, и была
 * записана как «форма ссылки — текстовый узел плюс `span` с маркером».
 *
 * Probe 10c измерил живые страницы: `span` несёт АННОТАЦИЮ, а маркер —
 * лишь её необязательный завершающий хвост. На `e2157` формы распределились
 * 13 / 10 / 2 — без хвоста, с одним и с двумя U+2022. Прежняя грамматика
 * отвергала ВСЕ 25 карточек кодом `invalidMarker`, и через отбраковку всего
 * списка гибли целые коллекции: 166 отказов и `collectionsFound: 0`.
 *
 * ПРЕФИКС АННОТАЦИИ НЕ ИНТЕРПРЕТИРУЕТСЯ. Он не имя, не сохраняется, не
 * проверяется алфавитом и в маркер не входит: к `editorialLevel` он
 * отношения не имеет. Единственное, что о нём спрашивается, — нет ли внутри
 * него U+2022; такая форма не измерена, и угадывать её смысл нельзя.
 *
 * @param spanCount      сколько `span` найдено внутри ссылки-имени
 * @param annotationText текст единственного `span` целиком — аннотация
 *                       вместе с возможным завершающим рядом U+2022,
 *                       либо null, когда `span` нет
 */
export function recommendationLevel({ spanCount, annotationText }) {
  if (!Number.isSafeInteger(spanCount) || spanCount < 0) {
    throw new TypeError(`${TEXT_GUARD_SPEC}: spanCount обязан быть неотрицательным целым`)
  }
  if (spanCount === 0) {
    if (annotationText !== null) {
      throw new RecommendationMarkerError(
        'markerWithoutSpan',
        `${TEXT_GUARD_SPEC}: аннотация передана без span — форма карточки не та, что измерена`,
      )
    }
    return 0
  }
  if (spanCount > 1) {
    throw new RecommendationMarkerError(
      'multipleMarkerSpans',
      `${TEXT_GUARD_SPEC}: ${spanCount} span в одной карточке; какой из них несёт уровень — неизвестно`,
    )
  }
  if (typeof annotationText !== 'string') {
    throw new RecommendationMarkerError(
      'invalidMarker',
      `${TEXT_GUARD_SPEC}: при одном span ожидается его текст, получено ${typeof annotationText}`,
    )
  }
  const text = annotationText.trim()
  if (!text.length) {
    /* Пустой `span` — не «аннотация без маркера», а форма, которой на
       измеренных страницах нет. Считать её нулём значило бы принять
       за уровень 0 разметку, о которой ничего не известно. */
    throw new RecommendationMarkerError(
      'invalidMarker',
      `${TEXT_GUARD_SPEC}: span пуст — ни аннотации, ни маркера`,
    )
  }
  const level = TRAILING_MARKER.exec(text)[0].length
  if (level > MAX_RECOMMENDATION_LEVEL) {
    throw new RecommendationMarkerError(
      'invalidMarker',
      `${TEXT_GUARD_SPEC}: завершающих точек ${level} при пределе ${MAX_RECOMMENDATION_LEVEL}`,
    )
  }
  const prefix = text.slice(0, text.length - level)
  /* U+2022 в префиксе — форма, которой измерение не видело. Отказ, а не
     догадка: «•Local•» могло бы значить и уровень 1, и уровень 2. */
  if (prefix.includes('•')) {
    throw new RecommendationMarkerError(
      'invalidMarker',
      `${TEXT_GUARD_SPEC}: U+2022 вне завершающего ряда — какая часть маркер, неизвестно`,
    )
  }
  /*
   * Пустой префикс — чистые «•», «••», «•••», форма Осаки. Проверять в ней
   * нечего.
   *
   * Хвостовой пробел снимается ДО проверки границы: «Local ••» — та же
   * аннотация, что и «Local••», разделённая версткой. Считать пробел
   * небезопасным знаком значило бы отвергнуть карточку за разметку, а
   * ложные отказы всего списка мы только что чинили.
   */
  const bounded = prefix.trimEnd()
  if (bounded.length && !ANNOTATION_BOUNDARY.test(bounded)) {
    throw new RecommendationMarkerError(
      'invalidMarker',
      `${TEXT_GUARD_SPEC}: аннотация кончается знаком, который маркером не является — `
      + 'ожидались буква, цифра, закрывающая скобка или завершающая кавычка',
    )
  }
  return level
}
