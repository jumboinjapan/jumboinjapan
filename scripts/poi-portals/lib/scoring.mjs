/**
 * Скоринг кандидата POI: чистая функция, вход → решение. Без I/O.
 *
 * Повторяет архитектуру, которая уже доказала себя на событиях
 * (evaluateJapanTravelEventIntake): баллы отдельно, блокеры отдельно,
 * каждое решение объяснимо списком сигналов.
 *
 * Зачем слой вообще нужен. В открытых данных Осаки 2012 записей, и это
 * НЕ 2012 достопримечательностей: там 東横INN大阪弁天町, 和泉シティプラザ
 * (муниципальный ДК с библиотекой и отделением мэрии), 森野サンプル
 * (мастер-класс по муляжам еды) и ABCまつり (фестиваль, а не место).
 * Прямой импорт затопит базу мусором, который потом вычищать руками
 * дороже, чем не заводить.
 */

import { classifyByRule, TERMINAL, terminalOutcome } from './classification-contract.mjs'

export const REVIEW_MIN_SCORE = 3
export const IMPORT_MIN_SCORE = 7

/**
 * Детерминированные правила: японский топоним → КОДЫ РЕЕСТРА.
 *
 * Раньше здесь стояли 15 русских названий из старого канона — собственный
 * список категорий, пятый по счёту источник правды. Теперь правило называет
 * вид сущности и тип из реестра, а русские подписи берутся из него же.
 *
 * Порядок и набор шаблонов сохранены дословно: те же альтернативы в том же
 * порядке, поэтому МНОЖЕСТВО записей, которые правила разбирают, не
 * изменилось — изменилось только то, во что они разбираются. Состав корзин
 * зависит от факта совпадения, а не от его результата, и парность старого и
 * нового поведения проверяется тестом.
 *
 * Где один старый шаблон накрывал разные вещи, он РАЗДЕЛЁН, а не переведён
 * ближайшим кодом:
 *
 *   水族館 / 動物園   → zoo_aquarium, а не музей
 *   商店街 / 市場     → shopping_street и market — это разные типы
 *   外湯 / 足湯       → public_onsen; 温泉 остаётся неоднозначным
 *   城跡             → неоднозначно между историческим местом и укреплением
 *   城               → castle_fortification
 *   駅 / 港 / 空港    → вид сущности transport_infrastructure, а не тип POI
 *   旅館             → accommodation, у него свой каталог
 *
 * Неоднозначные шаблоны не получают ближайший тип: они возвращают вид
 * сущности «не опознано», и политика реестра уводит запись к человеку.
 * Догадка тут дороже остановки — ровно этот урок дал первый прогон Осаки.
 */
const UNRESOLVED_ENTITY_KIND = 'unknown'

const CLASSIFICATION_RULES = [
  { pattern: /(神社|大社|神宮|稲荷|八幡宮|天満宮)/, entityKind: 'tourist_poi', poiPrimaryType: 'shinto_shrine' },
  { pattern: /(寺院|[^\s]寺|大仏|観音堂|不動尊|門跡)/, entityKind: 'tourist_poi', poiPrimaryType: 'buddhist_temple' },
  { pattern: /(美術館|ギャラリー)/, entityKind: 'tourist_poi', poiPrimaryType: 'art_venue' },
  { pattern: /(水族館|動物園)/, entityKind: 'tourist_poi', poiPrimaryType: 'zoo_aquarium' },
  { pattern: /(博物館|資料館|記念館|文学館|科学館)/, entityKind: 'tourist_poi', poiPrimaryType: 'museum' },
  { pattern: /(展望台|展望所|展望)/, entityKind: 'tourist_poi', poiPrimaryType: 'viewpoint' },
  { pattern: /(タワー)/, ambiguous: 'башня бывает и смотровой точкой, и архитектурным объектом целиком' },
  { pattern: /(庭園|公園|植物園|花園|緑地)/, entityKind: 'tourist_poi', poiPrimaryType: 'park_garden' },
  { pattern: /(外湯|足湯)/, entityKind: 'tourist_poi', poiPrimaryType: 'public_onsen' },
  { pattern: /(温泉|湯本)/, ambiguous: 'по названию не отличить природный источник, общественную купальню и онсэн при рёкане' },
  { pattern: /(城跡|城址)/, ambiguous: 'руины замка ложатся и в историческое место, и в укрепление' },
  { pattern: /(古墳|遺跡|史跡|旧跡|廃寺|街道|一里塚)/, entityKind: 'tourist_poi', poiPrimaryType: 'historic_site' },
  { pattern: /(城)/, entityKind: 'tourist_poi', poiPrimaryType: 'castle_fortification' },
  { pattern: /(御殿)/, entityKind: 'tourist_poi', poiPrimaryType: 'architectural_landmark' },
  { pattern: /(櫓)/, ambiguous: 'башня-ягура чаще часть укрепления, чем самостоятельный объект' },
  { pattern: /(旅館|温泉宿)/, entityKind: 'accommodation' },
  { pattern: /(商店街)/, entityKind: 'tourist_poi', poiPrimaryType: 'shopping_street' },
  { pattern: /(市場)/, entityKind: 'tourist_poi', poiPrimaryType: 'market' },
  { pattern: /(ストリート|通り)/, ambiguous: '«улица» сама по себе типа не задаёт' },
  { pattern: /(遊園地|テーマパーク|ランド)/, entityKind: 'tourist_poi', poiPrimaryType: 'amusement_park' },
  { pattern: /(スパ|サウナ)/, ambiguous: 'коммерческий day spa исключается, спа при отеле — признак, а в названии бизнес-парка это вообще не про купание' },
  { pattern: /(駅|ターミナル|港|空港)/, entityKind: 'transport_infrastructure' },
  { pattern: /(渓谷|滝|海岸|岬|湖|山頂|峠)/, entityKind: 'tourist_poi', poiPrimaryType: 'natural_landmark' },
  { pattern: /(川床)/, ambiguous: 'помост у реки — форма обслуживания, а не природный объект' },
]

/** Коды, которые правила вообще используют, — для проверки против реестра. */
export const RULE_ENTITY_KINDS = Object.freeze([
  ...new Set(CLASSIFICATION_RULES.map((r) => r.entityKind ?? UNRESOLVED_ENTITY_KIND)),
])
export const RULE_POI_TYPES = Object.freeze([
  ...new Set(CLASSIFICATION_RULES.map((r) => r.poiPrimaryType).filter(Boolean)),
])

/**
 * Ночёвка — это ресурс отеля, у него свой пайплайн. В POI не заводим.
 * «リゾート» и «○○邸/ヴィラ» добавлены после прогона на данных Осаки:
 * «OMO7大阪 by 星野リゾート» проходил в импорт, потому что у отеля есть
 * и координаты, и описание, и телефон — ровно те же сигналы, что у
 * настоящей достопримечательности.
 */
// Расширено 6 августа 2026 по прогону Киото. Фильтр отсеял 40 объектов,
// но пропустил 14 рёканов, у которых в названии нет ни «ホテル», ни «民宿»:
// «丹後温泉はしうど荘», «夕日ヶ浦温泉　あまやどりの宿　佳松苑はなれ風香».
// В корзине записи они выглядели как обычные POI, а имя из них собиралось
// нечитаемым бегущим словом «Юхигаураонсэнкасёэнханарэфука» — то есть
// пропуск фильтра был виден только на выходе транслитератора.
const ACCOMMODATION_NOISE =
  /(ホテル|ＨＯＴＥＬ|HOTEL|INN|イン$|ドーミー|ゲストハウス|ホステル|民宿|ペンション|レジデンス|コテージ|キャンプ場|オートキャンプ|リゾート|ヴィラ|ヴィレッジ|荘$|荘　|旅荘|旅亭|山荘|別邸|貸別荘|の宿|の宿　)/i

/**
 * Розница и общепит как бизнес. Для заведения общепита в реестре есть свой
 * вид сущности и свой каталог, но речь там про место, которое само по себе
 * точка маршрута, а не
 * про аптеку «コクミンドラッグ 心斎橋筋１丁目店» — та тоже прошла в импорт
 * на первом прогоне.
 */
const RETAIL_NOISE =
  /(ドラッグ|薬局|ドン・キホーテ|コンビニ|スーパー|量販|家電|免税店|アウトレット|ショップ$|ストア$)/i

/** Продавцы впечатлений: у них нет самостоятельной ценности как точки маршрута. */
const EXPERIENCE_NOISE =
  /(体験|教室|レッスン|ワークショップ|作り方|手作り|クッキング|Cooking|Making|レンタル|貸出|着付け)/i

/** Муниципальная и служебная инфраструктура. */
const CIVIC_NOISE =
  /(市役所|区役所|町役場|出張所|支所|公民館|コミュニティセンター|保健所|福祉センター|生涯学習|勤労|職業|議会|清掃|水道|下水|斎場|火葬)/

/** Название описывает СОБЫТИЕ, а не место — это в событийный пайплайн. */
const EVENT_SHAPED = /(まつり|祭り|祭$|フェスティバル|フェス$|花火大会|マラソン|展$|コンサート)/

/**
 * Филиал/точка сети: карточка тура на «магазин №3» не нужна.
 * Суффикс «○○店» ловит «心斎橋店», «梅田店» и т.п. — обычная форма
 * названия конкретной точки сети в японских данных.
 */
const CHAIN_SHAPED = /(支店|本店|[０-９0-9]+号店|チェーン|店$)/

/**
 * Что правила смогли сказать о кандидате.
 *
 * @returns {null | { entityKind: string, poiPrimaryType: string|null,
 *                    ambiguous: string|null }}
 *          null — ни один шаблон не совпал, запись пойдёт к модели;
 *          ambiguous — шаблон совпал, но однозначного типа у него нет.
 */
export function classifyByRules(candidate) {
  const haystack = `${candidate.nameJa ?? ''} ${candidate.nameKana ?? ''}`
  for (const rule of CLASSIFICATION_RULES) {
    if (!rule.pattern.test(haystack)) continue
    if (rule.ambiguous) {
      return { entityKind: UNRESOLVED_ENTITY_KIND, poiPrimaryType: null, ambiguous: rule.ambiguous }
    }
    return {
      entityKind: rule.entityKind,
      poiPrimaryType: rule.poiPrimaryType ?? null,
      ambiguous: null,
    }
  }
  return null
}

/**
 * Полный результат правил: предложение + происхождение `rule` + маршрут.
 * Происхождение проставляет ЭТОТ код, а не правило и не модель.
 */
export function classifyCandidateByRules(candidate) {
  const hit = classifyByRules(candidate)
  if (!hit) return null
  return classifyByRule({
    sourceKey: candidate.sourceKey ?? null,
    entityKind: hit.entityKind,
    poiPrimaryType: hit.poiPrimaryType,
    reasons: hit.ambiguous ? [hit.ambiguous] : [],
  })
}

/**
 * @returns {{
 *   qualityVerdict: 'pass'|'weak'|'reject', terminal: string, terminalReason: string,
 *   score: number, signals: object[], blockingReasons: string[],
 *   ruleClassified: boolean, classification: object|null, canAutoImport: boolean
 * }}
 */
export function evaluatePoiCandidate(candidate, { bbox = null } = {}) {
  const signals = []
  const blockingReasons = []
  let score = 0

  const push = (kind, code, delta, note) => {
    score += delta
    signals.push({ kind, code, score: delta, note })
  }
  const block = (code, delta, note) => {
    if (!blockingReasons.includes(code)) blockingReasons.push(code)
    push('block', code, delta, note)
  }

  const name = candidate.nameJa ?? ''
  const description = candidate.descriptionJa ?? ''

  // ── Жёсткие вето ───────────────────────────────────────────────────
  if (!name.trim()) block('missing_name', -10, 'Пустое название')
  if (ACCOMMODATION_NOISE.test(name)) block('accommodation', -6, 'Средство размещения, не POI')
  if (EXPERIENCE_NOISE.test(name)) block('experience_vendor', -5, 'Мастер-класс или прокат')
  if (RETAIL_NOISE.test(name)) block('retail_outlet', -5, 'Розничная точка, не достопримечательность')
  if (CIVIC_NOISE.test(name)) block('civic_facility', -5, 'Муниципальный объект')
  if (EVENT_SHAPED.test(name)) block('looks_like_event', -4, 'Похоже на событие — в событийный пайплайн')
  if (CHAIN_SHAPED.test(name)) push('negative', 'chain_branch', -3, 'Филиал сети')

  // ── География ──────────────────────────────────────────────────────
  const hasCoords = Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon)
  if (hasCoords) {
    push('positive', 'has_coords', 2, `${candidate.lat}, ${candidate.lon}`)
    if (bbox) {
      const inside =
        candidate.lat >= bbox.minLat &&
        candidate.lat <= bbox.maxLat &&
        candidate.lon >= bbox.minLon &&
        candidate.lon <= bbox.maxLon
      if (!inside) block('geo_out_of_bounds', -4, 'Координаты вне заявленного региона')
    }
  } else {
    // Не вето: точку можно завести и геокодировать позже. Но в автоимпорт
    // без координат не пускаем — маршрут по ней не построить.
    push('negative', 'geo_missing', -2, 'Нет координат')
    if (!candidate.address) block('geo_unresolvable', -3, 'Ни координат, ни адреса')
  }

  // ── Классификация правилами ────────────────────────────────────────
  // Вес сигнала и его условие не менялись: он зависит от ФАКТА совпадения
  // шаблона, а не от того, во что шаблон разобрался. Иначе разделение одного
  // старого шаблона на рынок и торговую улицу молча переложило бы записи
  // между корзинами, чего этот шаг делать не должен.
  const ruleHit = classifyByRules(candidate)
  const classification = ruleHit ? classifyCandidateByRules(candidate) : null
  if (ruleHit && !ruleHit.ambiguous) {
    push('positive', 'category_resolved', 3, ruleHit.poiPrimaryType ?? ruleHit.entityKind)
  } else if (ruleHit) {
    // Неоднозначное совпадение НЕ считается разобранной категорией: три балла
    // за него раньше поднимали к порогу записи то, что реестр отправляет к
    // человеку. Шаблон совпал, но типа не назвал — это не заслуга.
    push('neutral', 'category_ambiguous', 0, ruleHit.ambiguous)
  } else {
    push('neutral', 'category_unresolved', 0, 'Классификацию предложит LLM на этапе обогащения')
  }

  // ── Содержательность ───────────────────────────────────────────────
  const len = description.trim().length
  if (len >= 200) push('positive', 'description_rich', 3, `${len} симв.`)
  else if (len >= 60) push('positive', 'description_ok', 2, `${len} симв.`)
  else if (len > 0) push('negative', 'description_thin', -1, `${len} симв.`)
  else block('description_missing', -3, 'Нет описания — писать текст не из чего')

  // ── Практические факты ─────────────────────────────────────────────
  if (candidate.workingHours) push('positive', 'has_hours', 1, candidate.workingHours.slice(0, 40))
  if (candidate.priceLabel) push('positive', 'has_price', 1, null)
  if (candidate.access) push('positive', 'has_access', 1, null)
  if (candidate.website) push('positive', 'has_website', 1, null)
  if (candidate.phone) push('positive', 'has_contact', 1, null)

  // ── Свежесть источника ─────────────────────────────────────────────
  // Выгрузка Киото датирована 2022-04-18. Название и координаты храма за
  // четыре года не изменились, а часы работы и цена билета — почти наверняка.
  // Поэтому запись не отклоняем, но помечаем «волатильные» поля как
  // непроверенные: публиковать их до ручной сверки нельзя.
  let volatileFieldsUnverified = false
  if (candidate.sourceUpdatedAt) {
    const year = Number(String(candidate.sourceUpdatedAt).slice(0, 4))
    const currentYear = new Date().getUTCFullYear()
    if (Number.isFinite(year) && currentYear - year >= 2) {
      push('negative', 'stale_source', -2, `Данные ${year} года`)
      if (candidate.workingHours || candidate.priceLabel) volatileFieldsUnverified = true
    }
  }

  /* Оценка качества — теперь ТОЛЬКО диагностика карточки: хватает ли в ней
     данных, чтобы записью можно было пользоваться. Что с записью делать, она
     больше не решает. Раньше решала: `decision` и `canAutoImport` смотрели на
     факт совпадения шаблона и объявляли import вокзалу и рёкану, потому что
     маршрут реестра в это условие не входил вовсе. */
  const qualityVerdict =
    blockingReasons.length > 0
      ? 'reject'
      : score >= IMPORT_MIN_SCORE
        ? 'pass'
        : score >= REVIEW_MIN_SCORE
          ? 'weak'
          : 'reject'

  // Терминальный исход считает общая функция контракта — та же самая, что
  // отбирает строки в poiWritable. Двух реализаций условия больше нет.
  const terminal = terminalOutcome({
    classification,
    blockingReasons,
    score,
    hasCoords,
    importMinScore: IMPORT_MIN_SCORE,
  })
  const canAutoImport = terminal.outcome === TERMINAL.POI_WRITABLE

  return {
    // Диагностика качества карточки: pass / weak / reject.
    qualityVerdict,
    // Единственный конечный исход, см. TERMINAL в контракте.
    terminal: terminal.outcome,
    terminalReason: terminal.reason,
    score,
    signals,
    blockingReasons,
    // Факт разбора правилами — то, на что смотрят пороги и оценка стоимости.
    ruleClassified: Boolean(ruleHit),
    // Полный результат с происхождением `rule` и маршрутом из реестра.
    classification,
    canAutoImport,
    volatileFieldsUnverified,
  }
}
