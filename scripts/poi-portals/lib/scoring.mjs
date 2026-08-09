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

/** @typedef {'import'|'review'|'reject'|'duplicate'} PoiDecision */

export const REVIEW_MIN_SCORE = 3
export const IMPORT_MIN_SCORE = 7

/**
 * Правила категоризации: японский топоним → канон категорий проекта.
 * Порядок важен — первое совпадение выигрывает, поэтому более
 * специфичные шаблоны идут выше.
 *
 * Покрывают крупную часть японских объектов почти без ошибок, потому что
 * японские названия самоописательны: «⋯神社» — это всегда святилище.
 * Всё, что правила не разобрали, уходит в LLM (см. enrich.mjs) —
 * и это на порядок дешевле, чем гнать через модель все записи подряд.
 */
const CATEGORY_RULES = [
  [/(神社|大社|神宮|稲荷|八幡宮|天満宮)/, 'Синтоистское святилище'],
  [/(寺院|[^\s]寺|大仏|観音堂|不動尊|門跡)/, 'Буддийский храм'],
  [/(美術館|ギャラリー)/, 'Арт-пространство / Галерея'],
  [/(博物館|資料館|記念館|文学館|科学館|水族館|動物園)/, 'Музей'],
  [/(展望台|展望所|タワー|展望)/, 'Смотровая площадка'],
  [/(庭園|公園|植物園|花園|緑地)/, 'Ландшафтный сад / Парк'],
  [/(温泉|湯本|外湯|足湯)/, 'Термальный Источник'],
  [/(城跡|城址|古墳|遺跡|史跡|旧跡|廃寺|街道|一里塚)/, 'Историческое место'],
  [/(城|御殿|櫓)/, 'Архитектурный объект'],
  [/(旅館|温泉宿)/, 'Японский отель'],
  [/(商店街|市場|ストリート|通り)/, 'Шоппинг'],
  [/(遊園地|テーマパーク|ランド)/, 'Парк развлечений'],
  [/(スパ|サウナ)/, 'СПА'],
  [/(駅|ターミナル|港|空港)/, 'Транспортный узел'],
  [/(渓谷|滝|海岸|岬|湖|山頂|峠|川床)/, 'Достопримечательность'],
]

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
 * Розница и общепит как бизнес. Отдельная категория «Ресторан» в каноне
 * есть, но она про заведение, которое само по себе точка маршрута, а не
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

export function resolveCategory(candidate) {
  const haystack = `${candidate.nameJa ?? ''} ${candidate.nameKana ?? ''}`
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(haystack)) return category
  }
  return null
}

/**
 * @returns {{
 *   decision: PoiDecision, score: number, signals: object[],
 *   blockingReasons: string[], category: string|null, canAutoImport: boolean
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

  // ── Категория ──────────────────────────────────────────────────────
  const category = resolveCategory(candidate)
  if (category) push('positive', 'category_resolved', 3, category)
  else push('neutral', 'category_unresolved', 0, 'Категорию определит LLM на этапе обогащения')

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

  // Нераспознанная категория ограничивает решение потолком «review».
  // Урок первого прогона по Осаке: аптека и сетевой ресторан набирали
  // проходной балл на координатах, описании и телефоне — у бизнес-листинга
  // ровно тот же профиль сигналов, что у достопримечательности. Отличает
  // их именно то, что объект не ложится ни в одну категорию канона.
  const decision =
    blockingReasons.length > 0
      ? 'reject'
      : score >= IMPORT_MIN_SCORE && category
        ? 'import'
        : score >= REVIEW_MIN_SCORE
          ? 'review'
          : 'reject'

  // Автоимпорт требует ОДНОВРЕМЕННО: нет блокеров, порог взят,
  // категория разобрана правилами, координаты есть.
  const canAutoImport =
    blockingReasons.length === 0 && score >= IMPORT_MIN_SCORE && Boolean(category) && hasCoords

  return {
    decision,
    score,
    signals,
    blockingReasons,
    category,
    canAutoImport,
    volatileFieldsUnverified,
  }
}
