/**
 * Портальная граница опознания места — первая production-граница ПОСЛЕ
 * проверенного извлечения фактов и до приёма записи.
 *
 * ЗАЧЕМ. Единый контракт `resolvePlace` существовал, но проходил его только
 * путь Telegram (`poi-intake.ts`). Портальный коллектор `request.poi.resolved`
 * не наполнял вовсе: он клал в запрос широту и долготу, пришедшие из выгрузки
 * источника, и ни `Google Place ID`, ни происхождения точки у записи не
 * появлялось. Следствий два, и оба тихие. Без `place_id` ежемесячный прогон
 * обновления координат запись пропускает — петля контроля закрытий для
 * портальных точек не замыкается. А без подтверждённого происхождения точки
 * `classifyCoordinatePolicy` отвечает `unknownProvenance`, и приём
 * останавливается на каждом кандидате: ось объявлена и не исполняется.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО ЗДЕСЬ НЕТ. Здесь нет ни одной строки поиска места:
 * алгоритм живёт в `place-resolve.ts` и вызывается тем же самым, каким его
 * вызывает Telegram. Здесь есть ровно две вещи, которых у Telegram нет и быть
 * не может: контракт входа (портальный кандидат — не то же самое, что ответ
 * исследователя) и проверка ответа резолвера против того, что портальный путь
 * уже знает о месте сам — направления и имени.
 *
 * ПОЧЕМУ ВХОД — ОТДЕЛЬНЫЙ КОНТРАКТ. Japan Guide отдаёт записи
 * `poi-discovery-record/v2`: это НЕ факты, у каждой подсказки `confidence`
 * равен `unverified`. Такая запись не имеет права дойти до резолвера и тем
 * более до Airtable, поэтому граница принимает не «любой объект с именем», а
 * названный контракт и отвергает чужую версию поимённо. Промежуточный шаг,
 * превращающий неподтверждённое свидетельство в проверенный факт, живёт вне
 * этой границы и в неё не входит.
 *
 * ПОЧЕМУ ОТКАЗ, А НЕ ДОГАДКА. Каждый неуверенный исход заканчивается
 * ИМЕНОВАННЫМ отказом и нулём обращений к хранилищу. Догадаться здесь было бы
 * особенно дёшево — координаты у кандидата уже есть, — и именно поэтому
 * доверять им нельзя: их прислал вызывающий, а не резолвер.
 */

import { prefectureJaForSiteCity } from './jp-address.ts'
import { canonicalPrefecture } from './prefectures.ts'
import { PLACE_RESOLUTION_OUTCOMES, resolvePlace, type PlaceResolver } from './place-resolve.ts'
/* Описание брошенного значения вынесено в отдельный модуль: та же процедура
   нужна каноническому резолверу, а он импортируется отсюда — обратный импорт
   был бы циклом, копия рядом разошлась бы молча. Реэкспорт сохранён: набор
   границы читает потолок и постоянный текст отказа отсюда, и менять его
   импорты вслед за переносом означало бы менять предмет проверки. */
import {
  describeThrownSafely,
  RESOLVER_ERROR_TEXT_LIMIT,
  UNDESCRIBABLE_THROWN,
} from './thrown-value.ts'

export { RESOLVER_ERROR_TEXT_LIMIT, UNDESCRIBABLE_THROWN }
import type { PoiIngestRequest } from './poi-ingest.ts'

/**
 * Контракт входа границы: та часть проверенного результата извлечения, которую
 * читает опознание места. Ровно четыре значения — и каждое здесь читается.
 * Поле, которого не читает ни одна проверка, было бы вторым источником правды.
 */
export const PORTAL_PLACE_SUBJECT_SPEC = 'poi-portal-place-subject/v1'

export interface PortalPlaceSubject {
  contractVersion: typeof PORTAL_PLACE_SUBJECT_SPEC
  /** Ключ кандидата в источнике. Идёт в сообщения об отказе, не в запись. */
  sourceKey: string
  /**
   * Английское имя — РОВНО ТО, которое поедет в запись. Не имя из выгрузки,
   * если владелец переопределил его файлом `--names`: иначе место опознавалось
   * бы под одним именем, а записывалось под другим.
   *
   * Пустая строка допустима. Отказ по ней выносит резолвер, а не эта граница:
   * «искать нечем» обязано быть доказанным исходом опознания, а не догадкой
   * до него.
   */
  nameEn: string
  /**
   * Японское имя — ГЛАВНЫЙ ключ поиска. У японских открытых данных английского
   * названия нет вовсе, поэтому портальный путь опознаёт место по нему.
   */
  nameJa: string
  /** Слаг направления — ровно тот, который поедет в поле `Site City`. */
  siteCity: string
  /**
   * Точка источника: ПРЕДПОЧТЕНИЕ поиска и диагностический сигнал тождества,
   * не гарантия точности. В запись она не идёт — записывается точка резолвера.
   * Либо полная конечная пара, либо оба `null`: половина пары смещает поиск
   * неизвестно куда.
   */
  sourceLat: number | null
  sourceLon: number | null
  /**
   * Префектура из адреса источника, как она там записана. Пустая строка —
   * источник её не дал. Это подсказка ЗАПРОСУ, а не проверке: проверка идёт
   * против ожидаемой префектуры направления.
   */
  prefectureJa: string
}

export const PORTAL_PLACE_SUBJECT_KEYS: readonly string[] = Object.freeze([
  'contractVersion',
  'sourceKey',
  'nameEn',
  'nameJa',
  'siteCity',
  'prefectureJa',
  'sourceLat',
  'sourceLon',
])

/** Ключи, значения которых обязаны быть строками. Координаты проверяются иначе. */
const SUBJECT_STRING_KEYS: readonly string[] = Object.freeze([
  'contractVersion', 'sourceKey', 'nameEn', 'nameJa', 'siteCity', 'prefectureJa',
])

/**
 * Закрытый список причин отказа. Каждая называет свой класс ошибки; общего
 * «не получилось» здесь нет, потому что по нему нельзя ни отобрать записи для
 * разбора, ни понять, кто виноват — источник, резолвер или справочник.
 */
export const PORTAL_PLACE_REFUSALS = Object.freeze([
  /** Резолвер не подставлен: ключа Google нет. Не повод писать без места. */
  'noResolver',
  /** Резолвер отработал и места не назвал: не нашёл. */
  'notResolved',
  /**
   * Проверки прошли двое и более кандидатов. Отдельная причина, а не
   * `notResolved`: «не нашли» — вопрос к имени и направлению, «не смогли
   * выбрать» — вопрос к человеку, и очередь разбора у них разная.
   */
  'ambiguous',
  /**
   * Резолвер не отработал вовсе — бросил исключение.
   *
   * Отдельная причина, а не `notResolved` и не `unknownResolverShape`. Эти три
   * различает не педантизм, а то, что по ним делают дальше: «не нашёл» — вопрос
   * к имени и направлению кандидата, «чужая форма» — к контракту резолвера,
   * «бросил» — к среде и внешнему ответу. Свести их в одну значило бы отправить
   * человека искать не там.
   */
  'resolverThrew',
  /** Ответ резолвера не той формы, которую объявляет его контракт. */
  'unknownResolverShape',
  /**
   * Резолвер отработал, но провайдер оказался непригоден: не ответил, ответил
   * ошибкой или прислал тело не той формы.
   *
   * Отдельно от `notResolved` намеренно. «Место не опознано» — вопрос к имени и
   * направлению кандидата, и разбирать его человеку; «провайдер прислал мусор» —
   * вопрос к сети и провайдеру, и кандидат тут ни при чём. Свести их в одну
   * причину значило бы отправить человека искать дефект в данных там, где
   * сломался Google.
   */
  'providerUnusable',
  /** Резолвер вернул одну координату из двух. Точки нет. */
  'halfCoordinates',
  /** Место опознано, а `Google Place ID` пуст: ось не наполнить. */
  'missingPlaceId',
  /** Принадлежность направлению проверить нечем — ни у слага, ни у ответа. */
  'siteCityUnverifiable',
  /** Место опознано в другой префектуре, чем стоит за направлением. */
  'cityConflict',
] as const)

export type PortalPlaceRefusal = (typeof PORTAL_PLACE_REFUSALS)[number]

/** Ровно тот объект, который потребляет production Intake. Не копия рядом. */
type IngestResolved = NonNullable<PoiIngestRequest['poi']['resolved']>

export type PortalPlaceOutcome =
  | {
      ok: true
      /** Точка РЕЗОЛВЕРА. Именно она поедет в `Latitude`/`Longitude`. */
      lat: number
      lon: number
      businessStatus: string
      resolved: IngestResolved
      /** Что сказал резолвер. Идёт в отчёт владельцу. */
      reason: string
    }
  | { ok: false; refusal: PortalPlaceRefusal; message: string; reason: string }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)





/**
 * Строгая проверка собственных ключей — ДО чтения значений.
 *
 * `Object.keys` не видит неперечисляемых и символьных свойств, а
 * accessor-свойство исполняет чужой код внутри проверки и вправе вернуть
 * проверяющему одно значение, а потребителю другое. Здесь оба случая — отказ,
 * а не молчаливое чтение.
 */
function readExactOwn(value: unknown, keys: readonly string[], where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${where}: ожидается объект, получено ${Array.isArray(value) ? 'массив' : typeof value}`)
  }
  if (Object.getOwnPropertySymbols(value).length) {
    throw new TypeError(`${where}: символьные собственные свойства запрещены`)
  }
  const own = Object.getOwnPropertyNames(value)
  for (const key of own) {
    const slot = Object.getOwnPropertyDescriptor(value, key)
    if (slot && !('value' in slot)) {
      throw new TypeError(`${where}.${key}: свойство описано accessor'ом, а не значением`)
    }
  }
  const extra = own.filter((key) => !keys.includes(key))
  const missing = keys.filter((key) => !own.includes(key))
  if (extra.length || missing.length) {
    const parts = []
    if (missing.length) parts.push(`не объявлены поля ${missing.map((k) => `«${k}»`).join(', ')}`)
    if (extra.length) parts.push(`неизвестные поля ${extra.map((k) => `«${k}»`).join(', ')}`)
    throw new TypeError(`${where}: ${parts.join('; ')}`)
  }
  return value as Record<string, unknown>
}

/**
 * Проверка входа границы. Нарушение контракта — ИСКЛЮЧЕНИЕ, а не отказ:
 * отказ описывает исход опознания конкретного места, а сюда приходит ошибка
 * вызывающего, и молчаливо превратить её в «эту точку не опознали» значило бы
 * спрятать дефект кода в очередь к человеку.
 */
export function assertPortalPlaceSubject(value: unknown, where = PORTAL_PLACE_SUBJECT_SPEC): PortalPlaceSubject {
  /* ВЕРСИЯ ЧИТАЕТСЯ ПЕРВОЙ — и как собственное data-свойство.
     Порядок не косметический. Запись обхода `poi-discovery-record/v2` не
     совпадает с этим контрактом ни одним ключом, и проверка ключей отвергла бы
     её как «неизвестные поля url, placements, …». Формально верно и бесполезно:
     читатель узнаёт про опечатку там, где ему подсунули другой формат. Отказ
     обязан называть отвергнутую версию.
     Accessor вместо значения — признак подделки, а не формата: он исполняет
     чужой код внутри проверки и волен вернуть проверяющему одно, а потребителю
     другое. */
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const slot = Object.getOwnPropertyDescriptor(value, 'contractVersion')
    if (slot && !('value' in slot)) {
      throw new TypeError(`${where}.contractVersion: свойство описано accessor'ом, а не значением`)
    }
    if (slot && slot.value !== PORTAL_PLACE_SUBJECT_SPEC) {
      throw new TypeError(
        `${where}: чужая версия ${JSON.stringify(slot.value)}. `
        + 'Граница принимает только проверенный результат извлечения; запись обхода '
        + '(её подсказки помечены confidence «unverified») готовым POI не является',
      )
    }
  }
  const raw = readExactOwn(value, PORTAL_PLACE_SUBJECT_KEYS, where)
  for (const key of SUBJECT_STRING_KEYS) {
    if (typeof raw[key] !== 'string') {
      throw new TypeError(`${where}.${key}: ожидается строка, получено ${typeof raw[key]}`)
    }
  }
  /* Координаты источника: ЛИБО полная конечная пара, ЛИБО обе отсутствуют.
     Половина пары — не «почти точка», а смещение поиска неизвестно куда. */
  for (const key of ['sourceLat', 'sourceLon'] as const) {
    const v = raw[key]
    if (v !== null && !(typeof v === 'number' && Number.isFinite(v))) {
      throw new TypeError(`${where}.${key}: ожидается конечное число или null, получено ${typeof v}`)
    }
  }
  if ((raw.sourceLat === null) !== (raw.sourceLon === null)) {
    throw new TypeError(`${where}: точка источника задана наполовину — нужна полная пара либо оба null`)
  }
  /* Ключи проверены, поэтому версия здесь заведомо наша — но проверка остаётся:
     без неё единственным сторожем версии был бы блок выше, а он пропускает
     объект, у которого поля вовсе нет. */
  if (raw.contractVersion !== PORTAL_PLACE_SUBJECT_SPEC) {
    throw new TypeError(`${where}: чужая версия ${JSON.stringify(raw.contractVersion)}`)
  }
  for (const key of ['sourceKey', 'siteCity'] as const) {
    if (!(raw[key] as string).trim()) throw new TypeError(`${where}.${key}: пустая или пробельная строка`)
  }
  return raw as unknown as PortalPlaceSubject
}

const RESOLVE_OUTCOME_KEYS: readonly string[] = Object.freeze(['outcome', 'place', 'reason'])
const RESOLVED_PLACE_KEYS: readonly string[] = Object.freeze([
  'placeId',
  'lat',
  'lon',
  'businessStatus',
  'prefecture',
  'matchedName',
])
const PREFECTURE_KEYS: readonly string[] = Object.freeze(['en', 'ru', 'ja'])

const refuse = (refusal: PortalPlaceRefusal, message: string, reason: string): PortalPlaceOutcome =>
  ({ ok: false, refusal, message, reason })

/**
 * Проводит портальный кандидат через КАНОНИЧЕСКИЙ `resolvePlace` и отдаёт то,
 * что Intake запишет как место: точку резолвера, `Google Place ID`,
 * префектуру из нашей таблицы сорока семи и момент снятия координат.
 *
 * Момент времени приходит параметром: функция не читает часы, иначе одна и та
 * же фикстура давала бы разные байты.
 */
export async function resolvePortalPlace(
  subject: unknown,
  options: { resolver: PlaceResolver | null; now: Date },
): Promise<PortalPlaceOutcome> {
  const input = assertPortalPlaceSubject(subject)
  if (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime())) {
    throw new TypeError(`${PORTAL_PLACE_SUBJECT_SPEC}: options.now обязан быть годной датой`)
  }

  /* Ожидаемая префектура направления — ДО обращения к резолверу. Все причины
     отказа, известные заранее, обязаны сработать до дорогого ввода-вывода:
     узнавать, что проверить принадлежность направлению нечем, после платного
     запроса незачем. */
  const expected = canonicalPrefecture(prefectureJaForSiteCity(input.siteCity))
  if (!expected) {
    return refuse(
      'siteCityUnverifiable',
      `Направление «${input.siteCity}» не значится в справочнике направлений — `
      + 'проверить принадлежность опознанного места этому направлению нечем',
      '',
    )
  }

  if (!options.resolver) {
    return refuse(
      'noResolver',
      'Резолвер места не подставлен (GOOGLE_PLACES_API_KEY не задан) — место не опознано, '
      + 'координат и place_id не будет',
      '',
    )
  }

  /* Запросу отдаётся то, что источник сказал о себе САМ, а не ожидаемая
     префектура направления. Иначе резолвер отфильтровал бы чужое место
     собственным гейтом, и расхождение между направлением и адресом — ровно то,
     ради чего проверка ниже и заведена, — стало бы невидимым. */
  const askPrefecture = canonicalPrefecture(input.prefectureJa)

  /* Исключение резолвера — ИСХОД ЭТОГО КАНДИДАТА, а не авария пакета.
     Прежде его не ловил никто: оно поднималось из этой функции через цикл
     опознания и наружу из `writeRun`, где `main` записывал его в `report.write.error`.
     Один кандидат уносил с собой весь прогон — законные соседи, счётчики и
     очередь разбора исчезали вместе с ним, а инвариант суммы до проверки уже
     не доходил. Хранилища это не касалось (до него не доходили), но «пакет
     упал» именованным исходом записи не является.

     Ловится РОВНО вызов резолвера и ничего больше. Обернуть всю функцию было
     бы ошибкой того же рода: нарушение контракта входа (`assertPortalPlaceSubject`)
     и негодные часы — ошибки вызывающего кода, и превращать их в отказ по
     кандидату значило бы спрятать дефект кода в очередь к человеку.

     Достижимо не только подставным резолвером: любой резолвер — чужой код, а
     ловушка прокси способна отравить даже форматирование отказа (см. барьер
     `describeThrownSafely`). Разбор ответа Google после F-24 живёт внутри
     границы самого `resolvePlace` и наружу больше не бросает. */
  let outcome: unknown
  try {
    outcome = await options.resolver({
      /* Японское имя — главный ключ; английское остаётся запасным. Точка
         источника идёт ПРЕДПОЧТЕНИЕМ поиска, полной парой или никак. */
      nameJa: input.nameJa || undefined,
      nameEn: input.nameEn || undefined,
      siteCity: input.siteCity,
      prefectureEn: askPrefecture?.en,
      locationBias: input.sourceLat !== null && input.sourceLon !== null
        ? { lat: input.sourceLat, lon: input.sourceLon }
        : undefined,
    })
  } catch (error) {
    return refuse(
      'resolverThrew',
      `Резолвер места бросил исключение: ${describeThrownSafely(error)}`,
      '',
    )
  }

  let shell: Record<string, unknown>
  try {
    shell = readExactOwn(outcome, RESOLVE_OUTCOME_KEYS, 'ответ резолвера')
  } catch (error) {
    return refuse('unknownResolverShape', (error as Error).message, '')
  }
  if (typeof shell.reason !== 'string') {
    return refuse('unknownResolverShape', `ответ резолвера.reason: ожидается строка, получено ${typeof shell.reason}`, '')
  }
  const reason = shell.reason
  /* Решение принимается по ЗАКРЫТОМУ машинному исходу, а не по разбору текста
     `reason`: текст меняется при первой правке формулировки, и его разбор был бы
     вторым, необъявленным контрактом. */
  if (typeof shell.outcome !== 'string' || !(PLACE_RESOLUTION_OUTCOMES as readonly string[]).includes(shell.outcome)) {
    return refuse('unknownResolverShape', `ответ резолвера.outcome: неизвестный исход ${JSON.stringify(shell.outcome)}`, reason)
  }
  if (shell.outcome === 'ambiguous') {
    return refuse('ambiguous', `Резолвер не смог выбрать между кандидатами: ${reason}`, reason)
  }
  if (shell.outcome === 'providerError' || shell.outcome === 'malformedResponse') {
    return refuse('providerUnusable', `Провайдер места непригоден: ${reason}`, reason)
  }
  if (shell.place === null) {
    if (shell.outcome === 'resolved') {
      return refuse('unknownResolverShape', 'ответ резолвера: исход resolved без места', reason)
    }
    return refuse('notResolved', `Резолвер не назвал места: ${reason}`, reason)
  }
  if (shell.outcome !== 'resolved') {
    return refuse('unknownResolverShape', `ответ резолвера: место при исходе ${shell.outcome}`, reason)
  }

  let place: Record<string, unknown>
  try {
    place = readExactOwn(shell.place, RESOLVED_PLACE_KEYS, 'ответ резолвера.place')
  } catch (error) {
    return refuse('unknownResolverShape', (error as Error).message, reason)
  }
  if (typeof place.matchedName !== 'string' || typeof place.businessStatus !== 'string') {
    return refuse('unknownResolverShape', 'ответ резолвера.place: matchedName и businessStatus обязаны быть строками', reason)
  }

  const hasLat = finite(place.lat)
  const hasLon = finite(place.lon)
  if (hasLat !== hasLon) {
    return refuse(
      'halfCoordinates',
      `Резолвер вернул одну координату из двух (${hasLat ? 'широту' : 'долготу'}) — точки нет`,
      reason,
    )
  }
  if (!hasLat) {
    return refuse('unknownResolverShape', 'ответ резолвера.place: место опознано без координат', reason)
  }

  /* Пустой Place ID — ИМЕНОВАННЫЙ отказ, а не пропущенное поле. Молча потерять
     его здесь значило бы завести запись, которую ежемесячный прогон обновления
     координат никогда не увидит, и узнать об этом было бы уже не по чему. */
  const placeId = typeof place.placeId === 'string' ? place.placeId.trim() : ''
  if (!placeId) {
    return refuse(
      'missingPlaceId',
      'Место опознано, но Google Place ID пуст — ось идентификатора не наполнить',
      reason,
    )
  }

  if (place.prefecture === null) {
    return refuse(
      'siteCityUnverifiable',
      `Резолвер не назвал префектуру опознанного места — принадлежность направлению «${input.siteCity}» не проверить`,
      reason,
    )
  }
  let prefectureRaw: Record<string, unknown>
  try {
    prefectureRaw = readExactOwn(place.prefecture, PREFECTURE_KEYS, 'ответ резолвера.place.prefecture')
  } catch (error) {
    return refuse('unknownResolverShape', (error as Error).message, reason)
  }
  /* Ответ приводится к НАШЕЙ таблице сорока семи, а не берётся как есть: ровно
     из-за доверия чужому написанию шесть записей однажды уехали с «京都府»
     в английском поле. */
  const prefecture = canonicalPrefecture(prefectureRaw.en as string)
  if (!prefecture) {
    return refuse(
      'unknownResolverShape',
      `ответ резолвера.place.prefecture.en: ${JSON.stringify(prefectureRaw.en)} нет среди сорока семи префектур`,
      reason,
    )
  }
  if (prefecture.en !== expected.en) {
    return refuse(
      'cityConflict',
      `Место опознано в префектуре ${prefecture.en}, а за направлением «${input.siteCity}» стоит ${expected.en}`,
      reason,
    )
  }

  /* ТОЖДЕСТВА ЗДЕСЬ НЕТ, И ЭТО НЕ ПРОПУСК.
     До финального пакета граница повторно звала `namesAgree` — ту же функцию,
     которой резолвер уже отверг несходные имена, — и называла это независимым
     контролем. Независимым он не был ни дня: одна и та же функция на тех же
     входах не может ответить иначе, поэтому `identityConflict` был структурно
     мёртв, а не «недостижим сегодня». Изображать вторую проверку одним и тем же
     кодом хуже, чем не иметь её вовсе: в отчёте она выглядит защитой.
     Тождество имён — предмет резолвера, и там оно переписано: равенство множеств
     значащих токенов, без вычёркивания родовых слов, плюс отдельный исход
     `ambiguous`, когда прошёл не один кандидат. Здесь граница проверяет то, чего
     резолвер не знает: направление и происхождение префектуры. */
  const lat = place.lat as number
  const lon = place.lon as number
  return {
    ok: true,
    lat,
    lon,
    businessStatus: place.businessStatus,
    resolved: {
      placeId,
      /* Те же координаты кладутся и в `resolved`: по ним политика координат
         подтверждает, что записывается именно точка резолвера. */
      lat,
      lon,
      prefectureRu: prefecture.ru,
      prefectureEn: prefecture.en,
      coordsCheckedAt: options.now.toISOString(),
    },
    reason,
  }
}

/**
 * Production-резолвер портального пути: тот же `resolvePlace`, что и у
 * Telegram, замкнутый на ключ. Нет ключа — нет резолвера, и граница честно
 * отвечает `noResolver`. Отсутствие настройки закрывает путь записи, а не
 * открывает его.
 */


export function canonicalPortalPlaceResolver(apiKey: string | null | undefined): PlaceResolver | null {
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!key) return null
  return (input) => resolvePlace(input, { apiKey: key })
}
