/**
 * Опознание места во внешних источниках при заведении POI.
 *
 * ЗАЧЕМ. До 10.08.2026 запись из Telegram-бота приезжала без place_id,
 * координат и префектуры. Следствие было не косметическим: без place_id
 * ежемесячный прогон обновления координат такую запись пропускает, а
 * статус «Работает» проставить нечем — исследователю его писать запрещено
 * (он выводит статус из отсутствия новостей и ошибается молча), а сверять
 * с Google не по чему. Петля, заведённая ради контроля закрытий, для новых
 * точек не замыкалась вовсе.
 *
 * ЧТО ОТКУДА И ПОЧЕМУ ИМЕННО ТАК.
 *
 *   place_id            Google, хранится бессрочно — так разрешают условия
 *   координаты          Google, срок годности 30 дней, обновляет крон
 *   businessStatus      Google, туда же
 *   префектура          Google, но НЕ «как есть»: ответ приводится к нашей
 *                       таблице из 47 значений или отвергается
 *   Name (JA)           Wikidata, лицензия CC0 — хранить можно вечно
 *
 * Японское имя не берётся у Google намеренно, хотя оно там есть. Условия
 * Maps Platform разрешают бессрочно хранить только идентификатор; имя —
 * содержимое, и на него распространяются те же тридцать дней. А Name (JA)
 * у нас ключ сверки дублей: он обязан быть постоянным, иначе через месяц
 * матчер начнёт заводить дубли. Поэтому имя — из корпуса, который хранить
 * разрешено, даже ценой меньшего покрытия.
 */
import { canonicalPrefecture, type Prefecture } from './prefectures.ts'
import { describeThrownSafely } from './thrown-value.ts'

const JP = { latMin: 24, latMax: 46, lonMin: 122, lonMax: 154 }

export interface ResolvedPlace {
  placeId: string
  lat: number
  lon: number
  businessStatus: string
  prefecture: Prefecture | null
  /** Что именно вернул источник — для отчёта владельцу, не для записи. */
  matchedName: string
}

/**
 * ЗАКРЫТЫЙ МАШИННЫЙ ИСХОД опознания.
 *
 * Заведён потому, что вызывающие начали разбирать текст `reason`, чтобы отличить
 * «не нашли» от «не смогли выбрать». Текст — для человека: он меняется при
 * первой же правке формулировки, и разбор его строкой — это второй, необъявленный
 * контракт. Здесь список закрыт, и решение принимается по нему.
 */
export const PLACE_RESOLUTION_OUTCOMES = Object.freeze([
  /** Прошёл ровно один кандидат. Только здесь `place` не null. */
  'resolved',
  /** Искать нечем: ни японского, ни английского имени. */
  'noQuery',
  /** Провайдер не ответил или ответил ошибкой. */
  'providerError',
  /** Ответ не той формы, которую объявляет контракт провайдера. */
  'malformedResponse',
  /** Провайдер ответил, но ни один кандидат не прошёл проверки. */
  'notFound',
  /**
   * Проверки прошли ДВОЕ и более. Это не «нашли», а «не смогли выбрать»:
   * ни Place ID, ни координат такой исход не даёт.
   */
  'ambiguous',
] as const)

export type PlaceResolutionOutcome = (typeof PLACE_RESOLUTION_OUTCOMES)[number]

export interface ResolveOutcome {
  /** Машинный исход. Решения принимаются по нему, а не по разбору `reason`. */
  outcome: PlaceResolutionOutcome
  place: ResolvedPlace | null
  /** Почему не опознано или чем подтверждено. Идёт в отчёт человеку. */
  reason: string
}

/** Что граница приёма знает о месте до поиска. Общий вход всех резолверов. */
export interface PlaceQuery {
  /**
   * Японское имя. ГЛАВНЫЙ ключ поиска, когда он есть: у японских открытых
   * данных английского названия нет вовсе (в корпусе Осаки — ноль строк из 132),
   * а японское есть у всех. Поиск по нему идёт с `languageCode: 'ja'`, и
   * сравнение имени тоже японское.
   */
  nameJa?: string
  /** Английское имя. Запасной ключ — для Telegram и источников без японского. */
  nameEn?: string
  nameRu?: string
  siteCity?: string
  prefectureEn?: string
  /**
   * Точка источника как ПРЕДПОЧТЕНИЕ поиска, не как гарантия точности и не как
   * жёсткое ограничение. Либо полная конечная пара, либо ничего: половина пары
   * смещает поиск неизвестно куда.
   */
  locationBias?: { lat: number; lon: number }
}

/**
 * Опознание места во внешнем источнике. Подставляется в тестах.
 *
 * Тип живёт здесь, рядом с `resolvePlace`, а не у каждого потребителя: две
 * границы приёма (Telegram и портальная) обязаны говорить об одном и том же
 * резолвере, и два одинаковых на вид объявления разошлись бы молча.
 */
export type PlaceResolver = (input: PlaceQuery) => Promise<ResolveOutcome>

/**
 * ПОЛИТИКА ТОЖДЕСТВА ИМЁН. Закрытая и исполняемая.
 *
 * Прежняя редакция вычёркивала родовые слова — `castle`, `station`, `park`,
 * `museum` и прочие — и сравнивала остаток через `includes`. Это ровно наоборот
 * тому, что нужно: родовое слово и есть то, что различает объекты с общим ядром.
 * Аудит предъявил четыре пары, которые она принимала за одно место:
 * «Osaka Castle ≡ Osaka Station», «Ueno Park ≡ Ueno Zoo»,
 * «Osaka Museum of History ≡ Osaka Castle Park», «Nara Park ≡ Nara».
 * Последняя опаснее прочих: `includes` объявляет частью целого любое имя,
 * которое короче.
 *
 * Правило теперь одно: РАВЕНСТВО МНОЖЕСТВ ЗНАЧАЩИХ ТОКЕНОВ. Ни одно значащее
 * слово не выбрасывается — ни родовое, ни различающее. Выбрасываются только
 * грамматические служебные слова, которые не называют ничего
 * (`the`, `a`, `an`, `of`, `at`, `in`, `on`, `and`), и нормализуются только
 * различия написания: регистр, диакритика, пробелы, знаки, ширина символов.
 *
 * Неизвестное совпадение — отказ, а не догадка: если множества не равны,
 * ответ отрицательный, и никакого «похоже» здесь нет.
 */

/** Грамматические слова без собственного значения. Закрытый список. */
const GRAMMATICAL_TOKENS: ReadonlySet<string> = new Set(['the', 'a', 'an', 'of', 'at', 'in', 'on', 'and'])

/**
 * Явно перечисленные эквиваленты написания. Закрытая таблица: сюда попадает
 * только то, что действительно одно и то же слово в двух написаниях, а не
 * «похожие» объекты.
 */
const TOKEN_EQUIVALENTS: Readonly<Record<string, string>> = Object.freeze({
  mt: 'mount',
  mtn: 'mount',
  st: 'saint',
  /* 大社 — «великое святилище»; в латинице объект пишется и «X Taisha», и
     «X Shrine», и это ОДНО написание одного объекта, а не догадка о похожести.
     Ровно для таких случаев таблица и заведена: «Fushimi Inari Taisha» —
     то же место, что «Fushimi Inari Shrine». Родовые слова при этом не
     выбрасываются: множества сравниваются целиком, и «Ueno Park» с «Ueno Zoo»
     по-прежнему разные. */
  taisha: 'shrine',
  jinja: 'shrine',
})

/** Общая для обоих алфавитов нормализация написания. */
const normalizeWriting = (value: string): string =>
  String(value ?? '')
    .normalize('NFKC')
    // Диакритика снимается отдельно: «Ōsaka» и «Osaka» — одно написание.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/** Значащие токены латинского имени. Пустое множество означает «сравнивать нечем». */
function latinTokens(value: string): string[] {
  return normalizeWriting(value)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token && !GRAMMATICAL_TOKENS.has(token))
    .map((token) => TOKEN_EQUIVALENTS[token] ?? token)
}

/**
 * Японское имя сравнивается строгим равенством написания.
 *
 * Токенов у японского имени нет — оно пишется без пробелов, — а любое
 * послабление вроде «одно содержит другое» вернуло бы ровно тот дефект, из-за
 * которого переписана латинская ветка: 大阪城 лежит внутри 大阪城公園, это
 * разные объекты. Строгое равенство — fail-closed: расхождение отправляет
 * кандидата человеку, а не заводит запись на чужое место.
 */
function japaneseForm(value: string): string {
  return normalizeWriting(value).replace(/[\s\u3000]+/g, '').replace(/[・･、。,.()（）「」【】]/g, '')
}

/** Есть ли в строке японское письмо — по нему выбирается ветка сравнения. */
export function hasJapaneseScript(value: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(value ?? ''))
}

/**
 * Совпадают ли имена по сути. Проверка ОБЯЗАТЕЛЬНА и в геометрической ветке.
 *
 * Без неё «Numa-no-Daira Plateau» принимал «Daisetsuzan National Park»:
 * та же префектура, двадцать два километра от центра — обе геометрические
 * проверки проходят, и только имя показывает, что это разные места.
 */
export function namesAgree(ours: string, theirs: string): boolean {
  const ourJa = hasJapaneseScript(ours)
  const theirJa = hasJapaneseScript(theirs)

  /* Разные алфавиты сравнивать нечем: транслитерации у нас нет, а догадка тут
     запрещена. Отказ. */
  if (ourJa !== theirJa) return false

  if (ourJa) {
    const a = japaneseForm(ours)
    const b = japaneseForm(theirs)
    return Boolean(a) && a === b
  }

  /* Сравниваются МНОЖЕСТВА, а не списки: таблица эквивалентов вправе свести два
     токена в один («Fushimi Inari Taisha Shrine» → …, shrine, shrine), и длина
     списка после этого различается там, где написание одно и то же. Порядок слов
     тождества тоже не меняет. */
  const left = new Set(latinTokens(ours))
  const right = new Set(latinTokens(theirs))
  if (!left.size || !right.size || left.size !== right.size) return false
  for (const token of left) if (!right.has(token)) return false
  return true
}

/**
 * ЧТЕНИЕ ФОРМЫ, А НЕ ПРИВЕДЕНИЕ ТИПОВ.
 *
 * Прежняя редакция объявляла форму ответа приведением: `as Array<...>`,
 * `as string[]`, `as string`. Приведение в TypeScript — обещание компилятору, а
 * не проверка в рантайме, и провайдер этого обещания не давал. Аудит предъявил
 * три ответа, на которых обещание не выполнялось, и каждый выносил исключение
 * НАРУЖУ, мимо заголовка «ничего не бросает»:
 *
 *   addressComponents = {}                  → `components.find is not a function`
 *   addressComponents = [null]              → чтение `types` у null
 *   types = 42                              → `includes is not a function`
 *
 * Поэтому каждый уровень читается проверкой факта, а результат чтения — закрытый
 * разбор: либо значение, либо названная причина повреждения. Молчаливого
 * «пустого массива вместо мусора» здесь нет: подстановка пустоты превращает
 * «провайдер прислал не то» в «ничего не нашлось», а это разные вещи и разные
 * решения владельца.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value !== 'undefined' && typeof value === 'object' && !Array.isArray(value)

/** Как назвать то, что пришло, не приводя его к строке. */
const shapeOf = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'массив' : typeof value

type PrefectureRead =
  | { ok: true; prefecture: Prefecture | null }
  | { ok: false; why: string }

function readPrefecture(value: unknown): PrefectureRead {
  /* Поля может не быть вовсе — это законно: field mask не гарантирует
     административную единицу у каждого места. `null` законным НЕ считается:
     это уже присланное значение, и оно не той формы. */
  if (typeof value === 'undefined') return { ok: true, prefecture: null }
  if (!Array.isArray(value)) return { ok: false, why: `addressComponents не массив (${shapeOf(value)})` }

  /* Проверяются ВСЕ компоненты, а не только первый подходящий. Компонент,
     до которого поиск не дошёл, — всё равно часть присланной структуры, и
     объявлять ответ валидным, не посмотрев на него, значит проверять выдачу,
     а не форму. */
  let matched = false
  let prefecture: Prefecture | null = null
  for (const item of value) {
    if (!isPlainObject(item)) return { ok: false, why: `компонент адреса не объект (${shapeOf(item)})` }
    const types = item.types
    if (!Array.isArray(types)) return { ok: false, why: `types не массив (${shapeOf(types)})` }
    for (const type of types) {
      if (typeof type !== 'string') return { ok: false, why: `types содержит не строку (${shapeOf(type)})` }
    }
    const longText = item.longText
    const shortText = item.shortText
    if (typeof longText !== 'undefined' && typeof longText !== 'string') {
      return { ok: false, why: `longText не строка (${shapeOf(longText)})` }
    }
    if (typeof shortText !== 'undefined' && typeof shortText !== 'string') {
      return { ok: false, why: `shortText не строка (${shapeOf(shortText)})` }
    }
    /* Берётся ПЕРВЫЙ подходящий компонент — как и прежде. Если его написание
       нашей таблице неизвестно, префектуры нет: следующий компонент того же
       типа заменой не служит. */
    if (!matched && types.includes('administrative_area_level_1')) {
      matched = true
      prefecture = canonicalPrefecture(longText ?? shortText ?? '')
    }
  }
  return { ok: true, prefecture }
}

/** Нормализованный кандидат: структура уже проверена, проверки смысла — нет. */
interface CandidateShape {
  id: string
  shown: string
  lat: number
  lon: number
  businessStatus: string
  prefecture: Prefecture | null
}

type CandidateRead = { ok: true; value: CandidateShape } | { ok: false; why: string }

function readCandidate(raw: unknown): CandidateRead {
  /* ОБЩИЙ FAIL-CLOSED БАРЬЕР НА ВСЁ ЧТЕНИЕ. `fetchImpl` инъецируется, а разбор
     ответа вправе вернуть что угодно: у объекта может оказаться getter, который
     бросает, у Proxy — ловушка. Ни одна аккуратность чтения этого не отменяет,
     поэтому отказ чтения объявлен исходом, а не аварией. Описание брошенного
     идёт через барьер, который сам не бросает. */
  try {
    if (!isPlainObject(raw)) return { ok: false, why: `кандидат не объект (${shapeOf(raw)})` }

    const displayName = raw.displayName
    if (!isPlainObject(displayName)) return { ok: false, why: `displayName не объект (${shapeOf(displayName)})` }
    const shown = displayName.text
    if (typeof shown !== 'string') return { ok: false, why: `displayName.text не строка (${shapeOf(shown)})` }

    const location = raw.location
    if (!isPlainObject(location)) return { ok: false, why: `location не объект (${shapeOf(location)})` }
    const lat = location.latitude
    const lon = location.longitude
    if (typeof lat !== 'number' || !Number.isFinite(lat)) {
      return { ok: false, why: `location.latitude не конечное число (${shapeOf(lat)})` }
    }
    if (typeof lon !== 'number' || !Number.isFinite(lon)) {
      return { ok: false, why: `location.longitude не конечное число (${shapeOf(lon)})` }
    }

    const id = raw.id
    if (typeof id !== 'string') return { ok: false, why: `id не строка (${shapeOf(id)})` }

    const prefecture = readPrefecture(raw.addressComponents)
    if (!prefecture.ok) return { ok: false, why: prefecture.why }

    /* `businessStatus` — содержимое, а не тождество: его отсутствие штатно, и
       поводом объявить весь ответ повреждённым оно не служит. Не-строка сюда не
       переписывается: пустая строка означает «статус не сообщён». */
    const status = raw.businessStatus

    return {
      ok: true,
      value: {
        id,
        shown,
        lat,
        lon,
        businessStatus: typeof status === 'string' ? status : '',
        prefecture: prefecture.prefecture,
      },
    }
  } catch (error) {
    return { ok: false, why: `чтение кандидата отказало: ${describeThrownSafely(error)}` }
  }
}

/**
 * Ищет место в Google Places и отдаёт его ТОЛЬКО если оно прошло проверки.
 * Ничего не бросает: не опознали — вернём причину, запись всё равно заведётся.
 */
export async function resolvePlace(
  input: PlaceQuery,
  options: { apiKey: string; fetchImpl?: typeof fetch },
): Promise<ResolveOutcome> {
  const doFetch = options.fetchImpl ?? fetch

  /* ЯПОНСКОЕ ИМЯ — ГЛАВНЫЙ КЛЮЧ. У японских открытых данных английского названия
     нет вовсе: в сохранённом корпусе Осаки английское имя есть у нуля строк из
     132, японское — у всех. Пока ключом было только английское имя, портальный
     путь платил Google за гарантированный промах. Английское остаётся запасным
     ключом для Telegram и источников без японского названия. */
  const nameJa = (input.nameJa ?? '').trim()
  const nameEn = (input.nameEn ?? '').trim()
  const name = nameJa || nameEn
  const languageCode = nameJa ? 'ja' : 'en'
  if (!name) {
    return { outcome: 'noQuery', place: null, reason: 'Ни японского, ни английского имени — искать нечем' }
  }

  // Город словами, а не слагом: «koyasan» Google понимает хуже, чем «Koyasan».
  const city = (input.siteCity ?? '').replace(/-/g, ' ').trim()
  /* Город и «Japan» дописываются только к латинскому запросу: японскому имени
     они не помогают, а лишние латинские слова смещают выдачу. */
  const query = nameJa ? name : [name, city, 'Japan'].filter(Boolean).join(', ')

  /* ТОЧКА ИСТОЧНИКА — ПРЕДПОЧТЕНИЕ, А НЕ ОГРАНИЧЕНИЕ. `locationBias` смещает
     выдачу к нужному месту и не отсекает правильный ответ, лежащий чуть дальше;
     `locationRestriction` отсёк бы. Радиус 500 м — то, что владелец разрешил как
     предпочтение поиска. Половина пары координат смещает поиск неизвестно куда,
     поэтому принимается только полная конечная пара. */
  const bias = input.locationBias
  const biasUsable = Boolean(bias) && Number.isFinite(bias?.lat) && Number.isFinite(bias?.lon)
  const body: Record<string, unknown> = { textQuery: query, languageCode, maxResultCount: 5 }
  if (biasUsable && bias) {
    body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lon }, radius: 500 } }
  }

  /* ВЕСЬ РАЗБОР ОТВЕТА — ВНУТРИ ГРАНИЦЫ. Прежняя редакция читала `data.places`
     ЗА пределами `try`, и тело, разобравшееся в `null`, роняло функцию, хотя её
     заголовок обещает «ничего не бросает». Через Telegram это роняло весь приём.
     Теперь и разбор JSON, и проверка формы стоят здесь. */
  let candidates: unknown[]
  try {
    const res = await doFetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': options.apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.businessStatus,places.addressComponents',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) return { outcome: 'providerError', place: null, reason: `Google ответил ${res.status}` }
    const data: unknown = await res.json()
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return {
        outcome: 'malformedResponse',
        place: null,
        reason: `Google вернул тело не той формы: ${data === null ? 'null' : Array.isArray(data) ? 'массив' : typeof data}`,
      }
    }
    const places = (data as Record<string, unknown>).places
    if (places !== undefined && !Array.isArray(places)) {
      return { outcome: 'malformedResponse', place: null, reason: 'Google вернул places не массивом' }
    }
    candidates = Array.isArray(places) ? places : []
  } catch (error) {
    /* НЕ `(error as Error).message`. Брошенное значение приходит извне и Error'ом
       быть не обязано: `throw null` роняло сам catch на чтении `message`, а
       `throw Symbol()` молча выносил чужой текст. Описание идёт через барьер,
       который не бросает ни на чём, включая Proxy с враждебными ловушками. */
    return { outcome: 'providerError', place: null, reason: `Google недоступен: ${describeThrownSafely(error)}` }
  }

  if (!candidates.length) {
    return { outcome: 'notFound', place: null, reason: `Google ничего не нашёл по «${query}»` }
  }

  const wantPrefecture = canonicalPrefecture(input.prefectureEn)
  const rejected: string[] = []
  /* ВСЕ кандидаты, а не первый прошедший. Прежняя редакция возвращала первого и
     не замечала, что прошёл и второй: «нашли одно место» было неотличимо от
     «не смогли выбрать». */
  const passed: ResolvedPlace[] = []

  /* ПОВРЕЖДЁННАЯ СТРУКТУРА И НЕПОДХОДЯЩИЙ КАНДИДАТ — РАЗНЫЕ СПИСКИ, и это не
     аккуратность ради аккуратности. «Провайдер прислал не то» требует разбора
     ответа, «место не подошло» — разбора выдачи; сложенные в один список, они
     дают отчёт, по которому нельзя решить, куда смотреть. */
  const malformed: string[] = []

  for (const raw of candidates) {
    const read = readCandidate(raw)
    if (!read.ok) {
      malformed.push(read.why)
      continue
    }
    const c = read.value
    if (c.lat < JP.latMin || c.lat > JP.latMax || c.lon < JP.lonMin || c.lon > JP.lonMax) {
      rejected.push(`«${c.shown}» вне рамки Японии`)
      continue
    }
    /* Сравниваем с ТЕМ именем и на ТОМ языке, которыми искали. */
    if (!namesAgree(name, c.shown)) {
      rejected.push(`«${c.shown}» — имя не сходится с «${name}»`)
      continue
    }
    const prefecture = c.prefecture
    if (wantPrefecture && prefecture && prefecture.en !== wantPrefecture.en) {
      rejected.push(`«${c.shown}» в префектуре ${prefecture.en}, ожидали ${wantPrefecture.en}`)
      continue
    }
    const placeId = c.id.trim()
    if (!placeId) {
      rejected.push(`«${c.shown}» без идентификатора места`)
      continue
    }
    passed.push({
      placeId,
      lat: c.lat,
      lon: c.lon,
      businessStatus: c.businessStatus,
      /* БЕЗ ЭХА ОЖИДАНИЯ. Прежде здесь стояло `prefecture ?? wantPrefecture`, и
         при ответе без административной единицы наружу уходила НАША ЖЕ догадка
         под видом ответа провайдера: проверить принадлежность направлению
         становилось нечем, а в запись попадала выдуманная префектура.
         Ожидаемая префектура — условие проверки, а не данные провайдера. */
      prefecture,
      matchedName: c.shown,
    })
  }

  /* Сколько кандидатов вообще имели пригодную к разбору структуру. */
  const structurallyValid = candidates.length - malformed.length
  const spoiled = malformed.length
    ? ` Отброшено повреждённых кандидатов: ${malformed.length} (${malformed.join('; ')})`
    : ''

  if (passed.length === 1) {
    return {
      outcome: 'resolved',
      place: passed[0],
      reason: `Опознано как «${passed[0].matchedName}»${spoiled}`,
    }
  }
  if (passed.length > 1) {
    /* НЕ «нашли», а «не смогли выбрать»: ни Place ID, ни координат такой исход
       не даёт — иначе выбор между двумя местами делала бы очередь выдачи. */
    return {
      outcome: 'ambiguous',
      place: null,
      reason: `Проверки прошли ${passed.length} кандидата: ${passed.map((p) => `«${p.matchedName}»`).join(', ')}. Выбор за человеком${spoiled}`,
    }
  }

  /* ПОВРЕЖДЕНИЕ НЕ НАЗЫВАЕТСЯ «НЕ НАЙДЕНО». Если ни один кандидат не имел
     пригодной структуры, провайдер прислал невалидный ответ — и владельцу надо
     смотреть на ответ, а не искать место под другим именем. Смешанный случай
     остаётся `notFound`: валидные структуры были и проверок не прошли, а
     отброшенные названы в причине поимённо. */
  if (structurallyValid === 0 && malformed.length) {
    return {
      outcome: 'malformedResponse',
      place: null,
      reason: `Ни один кандидат Google не имеет пригодной структуры: ${malformed.join('; ')}`,
    }
  }
  return {
    outcome: 'notFound',
    place: null,
    reason: `Ни один кандидат не прошёл проверку: ${rejected.join('; ')}${spoiled}`,
  }
}

/**
 * Японское имя и QID из Wikidata. Лицензия CC0 — хранить можно бессрочно,
 * в отличие от всего, что отдаёт Google.
 */
export async function resolveJapaneseName(
  input: { nameEn?: string },
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{ nameJa: string; qid: string } | null> {
  const doFetch = options.fetchImpl ?? fetch
  const name = (input.nameEn ?? '').trim()
  if (!name) return null
  try {
    const url =
      'https://www.wikidata.org/w/api.php?' +
      new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: `${name} haswbstatement:P17=Q17`,
        srlimit: '1',
        format: 'json',
      })
    const res = await doFetch(url, { headers: { 'User-Agent': 'jumboinjapan-poi-intake/1.0' } })
    if (!res.ok) return null
    const found = (await res.json()) as { query?: { search?: Array<{ title?: string }> } }
    const qid = found.query?.search?.[0]?.title
    if (!qid) return null

    const entity = await doFetch(
      'https://www.wikidata.org/w/api.php?' +
        new URLSearchParams({ action: 'wbgetentities', ids: qid, props: 'labels', languages: 'ja', format: 'json' }),
      { headers: { 'User-Agent': 'jumboinjapan-poi-intake/1.0' } },
    )
    if (!entity.ok) return null
    const body = (await entity.json()) as {
      entities?: Record<string, { labels?: { ja?: { value?: string } } }>
    }
    const nameJa = body.entities?.[qid]?.labels?.ja?.value
    return nameJa ? { nameJa, qid } : null
  } catch {
    return null
  }
}
