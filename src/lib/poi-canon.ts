/**
 * Канон POI: что считается допустимой записью и как её привести к норме.
 *
 * ЕДИНАЯ точка правды для всех, кто заводит POI — Telegram-агент, пакетный
 * коллектор, админка, внешние агенты. Правила текста берутся из
 * docs/copy-canon-for-agents.md, здесь они выражены исполняемым кодом.
 *
 * Разделение обязанностей:
 *   poi-canon.ts     — КАКОЙ должна быть запись (нормализация + валидация)
 *   poi-matching.ts  — НЕ ЗАВЕДЕНА ЛИ она уже (дубли и родители)
 *   poi-intake.ts    — оркестрация: исследование → канон → гейт → запись
 */

import { applyCanonSpelling } from './polivanov.ts'

// ── Справочник городов ──────────────────────────────────────────────────

/**
 * Канонические слаги городов. Site City — свободная строка и единственный
 * ключ связи POI с городом, поэтому расхождения здесь стоят дорого:
 * getPoisByCity ищет точным совпадением и молча возвращает неполный список.
 *
 * Проверено на живой базе 06.08.2026 — было три расхождения:
 *   mt-fuji, fujikawaguchiko  →  fuji  (18 записей на три слага, выборка
 *                                      по «fuji» теряла пять)
 *   Кирю (кириллицей)         →  kiryu (getPoisByCity не видел их вообще)
 *   mashu (озеро как город)   →  akan
 */
export const CITY_ALIASES: Record<string, string> = {
  'mt-fuji': 'fuji',
  fujikawaguchiko: 'fuji',
  kawaguchiko: 'fuji',
  'mount-fuji': 'fuji',
  mashu: 'akan',
  Кирю: 'kiryu',
  кирю: 'kiryu',
  токио: 'tokyo',
  киото: 'kyoto',
  осака: 'osaka',
  нара: 'nara',
  хаконе: 'hakone',
  камакура: 'kamakura',
  никко: 'nikko',
}

/** Города, по которым сайт строит страницы. Расширяется по мере роста. */
export const KNOWN_CITIES = new Set([
  'tokyo', 'kyoto', 'osaka', 'nara', 'uji', 'hakone', 'kamakura', 'enoshima',
  'nikko', 'kanazawa', 'himeji', 'fuji', 'koyasan', 'nasu', 'tokamachi',
  'sendai', 'matsushima', 'aomori', 'hiraizumi', 'towada', 'akan', 'kushiro',
  'sapporo', 'otaru', 'hakodate', 'shiretoko', 'daisetsuzan', 'sounkyo',
  'abashiri', 'asahikawa', 'furano', 'toyako', 'noboribetsu', 'kiryu',
  'hiroshima', 'miyajima', 'okinawa', 'kanazawa', 'takayama', 'shirakawago',
  'kobe', 'yokohama', 'chiba', 'gifu', 'zao', 'tsunan', 'kakunodate',
  'hirosaki', 'kitami', 'kamikawa', 'shakotan', 'shiroishi', 'suzuka',
  'tazawa', 'tsurui', 'utoro', 'yoichi', 'mitake', 'takao', 'kiso',
])

/**
 * Японское название муниципалитета → канонический слаг города.
 *
 * Открытые данные приходят по ПРЕФЕКТУРЕ, а не по городу: выгрузка Киото
 * это 1631 объект от самого Киото до деревень Тангоского полуострова
 * в трёх часах езды. В корзине к записи их было 584, и только 252 —
 * в маршрутных городах. Остальные 330 — места, которые в туре не появятся
 * никогда, и заводить их значит утопить базу в шуме.
 *
 * Районы городов-миллионников схлопываются в город: 京都市右京区
 * и 京都市東山区 — это Киото, а не два разных города.
 */
const JP_CITY: Record<string, string> = {
  京都市: 'kyoto', 宇治市: 'uji', 大阪市: 'osaka', 奈良市: 'nara',
  神戸市: 'kobe', 横浜市: 'yokohama', 金沢市: 'kanazawa', 姫路市: 'himeji',
  鎌倉市: 'kamakura', 箱根町: 'hakone', 日光市: 'nikko', 広島市: 'hiroshima',
  廿日市市: 'miyajima', 札幌市: 'sapporo', 小樽市: 'otaru', 函館市: 'hakodate',
  仙台市: 'sendai', 松島町: 'matsushima', 青森市: 'aomori', 平泉町: 'hiraizumi',
  高山市: 'takayama', 白川村: 'shirakawago', 桐生市: 'kiryu',
  富良野市: 'furano', 旭川市: 'asahikawa', 釧路市: 'kushiro',
  網走市: 'abashiri', 斜里町: 'shiretoko', 上川町: 'kamikawa',
  東京都: 'tokyo', 藤沢市: 'enoshima', 高野町: 'koyasan', 那須町: 'nasu',
  十日町市: 'tokamachi', 津南町: 'tsunan', 十和田市: 'towada',
  弟子屈町: 'akan', 洞爺湖町: 'toyako', 登別市: 'noboribetsu',
}

/**
 * Слаг города по японскому названию муниципалитета.
 * Возвращает пустую строку, если города нет в справочнике — это значит,
 * что место вне маршрутной сети, а не что данные плохие.
 */
export function japaneseCityToSlug(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (JP_CITY[raw]) return JP_CITY[raw]
  // 京都市右京区 → 京都市: район города-миллионника это тот же город.
  const ward = raw.match(/^(.+?[市])[^市]*区$/)
  if (ward && JP_CITY[ward[1]]) return JP_CITY[ward[1]]
  return ''
}

export function canonicalCity(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  return CITY_ALIASES[raw] ?? CITY_ALIASES[lower] ?? lower
}

// ── Типографика ─────────────────────────────────────────────────────────

/**
 * Что система НЕ расставляет сама (typoDeep делает только неразрывные
 * пробелы, многоточия и тире между словами) — значит писать надо сразу
 * правильно, и здесь это чинится на входе.
 */
export function canonicalText(value: string | null | undefined): string {
  let s = String(value ?? '')
  if (!s.trim()) return ''

  // Канонические написания топонимов. Правило ЖИЛО в трёх местах прозой —
  // в CLAUDE.md, в промпте исследователя и таблицей исключений в polivanov —
  // и не стерегло ни одного пути записи. Агенты через транслитератор не ходят,
  // они пишут имя сами. Замер 10.08.2026: 58 вхождений «Хаконэ» в живой базе,
  // включая Description Approved (RU), то есть текст, уехавший на сайт.
  // Правило, которое ничто не проверяет, — это не правило, а пожелание.
  s = applyCanonSpelling(s).value

  // Прямые и английские кавычки → «ёлочки». Внутренние пары станут „лапками“
  // только при ручной правке: автоматически вложенность не определить.
  s = s.replace(/"([^"]*)"/g, '«$1»').replace(/[""]([^""]*)[""]/g, '«$1»')

  // Диапазоны — короткое тире без пробелов: 09:00–17:00, 1–2 дня, ¥3 500–7 500.
  s = s.replace(/(\d)\s*[-—]\s*(\d)/g, '$1–$2')

  // Десятичная запятая вместо точки: 2,5 часа.
  s = s.replace(/(\d)\.(\d)(?!\d*\s*(?:км|м|kb|mb))/g, '$1,$2')

  return s.replace(/[ \t]{2,}/g, ' ').trim()
}

/** Часы работы: приводит к формату 09:00–17:00 и убирает английские хвосты. */
export function canonicalWorkingHours(value: string | null | undefined): string {
  let s = canonicalText(value)
  if (!s) return ''
  // Одноразрядный час дополняется нулём: 9:00 → 09:00.
  s = s.replace(/(^|[^\d:])(\d):(\d{2})/g, '$1 0$2:$3').replace(/\s{2,}/g, ' ')
  return s.trim()
}

// ── Типографика английского ─────────────────────────────────────────────

/**
 * Английский текст живёт по своим правилам, и русские к нему НЕПРИМЕНИМЫ.
 *
 * `canonicalText` ставит «ёлочки» и меняет точку на запятую в дробях —
 * для русского это канон, для английского порча: «A "quoted" 2.5 km walk»
 * превратилось бы в «A «quoted» 2,5 km walk». Поэтому здесь отдельная
 * функция, а не флаг у общей.
 *
 * Что расходится:
 *   кавычки      русские «ёлочки»    английские “лапки”
 *   дробь        2,5 часа            2.5 km
 *   разряды      15 000 человек      15,000 people
 *   диапазон     тире без пробелов — одинаково: 09:00–17:00
 */
/**
 * Романизация без макронов — решение владельца от 6 августа 2026.
 *
 * Выбор не в пользу точности, а в пользу поиска: «Tōdai-ji» фонетически
 * вернее, но в строку поиска, в авиабилет и в карту люди набирают
 * «Todaiji». Макрон ломается при копировании, в URL и в части шрифтов.
 *
 * Решение действует на всю базу целиком: до него в описаниях соседствовали
 * «Tōdai-ji» и «Todaiji», «Chūzenji» и «Chuzenji» — одно место в двух
 * написаниях не находится поиском и выглядит как две разные точки.
 */
const MACRONS = /[āīūēōĀĪŪĒŌ]/

/**
 * Британская норма — тоже решение владельца, и по той же причине единства:
 * в базе стояли «harbour» и «recognisable» рядом с «center» и «meter».
 * Британская выбрана как привычная европейской и азиатской аудитории;
 * англоязычная навигация в самой Японии тоже британская.
 *
 * Ключ — американское написание, значение — британское.
 */
const AMERICANISMS: Record<string, string> = {
  center: 'centre', centers: 'centres', meter: 'metre', meters: 'metres',
  kilometer: 'kilometre', kilometers: 'kilometres', liter: 'litre',
  theater: 'theatre', harbor: 'harbour', harbors: 'harbours',
  color: 'colour', colors: 'colours', colored: 'coloured',
  neighbor: 'neighbour', neighbors: 'neighbours',
  neighborhood: 'neighbourhood', neighborhoods: 'neighbourhoods',
  favorite: 'favourite', favorites: 'favourites', honor: 'honour',
  labor: 'labour', rumor: 'rumour', splendor: 'splendour',
  recognize: 'recognise', recognized: 'recognised', recognizable: 'recognisable',
  organize: 'organise', organized: 'organised', organization: 'organisation',
  specialize: 'specialise', specialized: 'specialised',
  realize: 'realise', realized: 'realised', emphasize: 'emphasise',
  traveling: 'travelling', traveled: 'travelled', traveler: 'traveller',
  travelers: 'travellers', modeling: 'modelling', canceled: 'cancelled',
  catalog: 'catalogue', dialog: 'dialogue', defense: 'defence',
  practiced: 'practised', gray: 'grey', jewelry: 'jewellery',
  storyes: 'storeys', storey: 'storey',
}

/**
 * Единая политика написания в английском тексте.
 *
 * Предупреждения, а не ошибки: расхождение в написании не делает текст
 * ложным, а отказ заводить точку из-за «center» вместо «centre» —
 * несоразмерная цена. Копятся они в Notes и вычищаются отдельным проходом.
 */
export function findSpellingIssuesEn(text: string | null | undefined): string[] {
  const s = String(text ?? '')
  const issues: string[] = []
  if (MACRONS.test(s)) {
    issues.push('макроны в японских названиях — канон базы без них (Todaiji, не Tōdai-ji)')
  }
  const found = new Set<string>()
  for (const [us, uk] of Object.entries(AMERICANISMS)) {
    if (new RegExp(`\\b${us}\\b`, 'i').test(s)) found.add(`${us} → ${uk}`)
  }
  if (found.size) issues.push(`американское написание: ${[...found].join(', ')}`)
  return issues
}

export function canonicalTextEn(value: string | null | undefined): string {
  let s = String(value ?? '')
  if (!s.trim()) return ''

  // Прямые кавычки → английские парные. Считаем по порядку: нечётная
  // открывает, чётная закрывает.
  let open = true
  s = s.replace(/"/g, () => (open = !open) ? '”' : '“')
  s = s.replace(/(\w)'(\w)/g, '$1’$2')   // апостроф в don't, Japan's

  // Диапазон — короткое тире без пробелов, как и в русском.
  s = s.replace(/(\d)\s*[-—]\s*(\d)/g, '$1–$2')

  // Разряды числа — запятая, а не пробел: 15,000 people.
  s = s.replace(/(\d)\s(\d{3})(?!\d)/g, '$1,$2')

  return s.replace(/[ \t]{2,}/g, ' ').trim()
}

/**
 * Английские аналоги запрещённых каноном слов.
 *
 * Список не перевод русского, а свой: у английского travel-копирайтинга
 * своя обойма клише, и «nestled», «boasts», «hidden gem» в русском не
 * имеют пары. Здесь `\b` работает — текст латинский.
 */
const BANNED_EN = [
  { label: 'unique', pattern: /\bunique(ly)?\b/i },
  { label: 'unforgettable', pattern: /\bunforgettable\b/i },
  { label: 'must-see / must-visit', pattern: /\bmust[- ](see|visit|do)\b/i },
  { label: 'hidden gem', pattern: /\bhidden gem\b/i },
  { label: 'breathtaking', pattern: /\bbreathtaking\b/i },
  { label: 'stunning', pattern: /\bstunning\b/i },
  { label: 'iconic', pattern: /\biconic\b/i },
  { label: 'nestled', pattern: /\bnestled\b/i },
  { label: 'boasts', pattern: /\bboasts?\b/i },
  { label: 'vibrant', pattern: /\bvibrant\b/i },
  { label: 'bustling', pattern: /\bbustling\b/i },
  { label: 'a true / a real', pattern: /\ba (true|real) [a-z]+\b/i },
  { label: 'premium', pattern: /\bpremium\b/i },
]

export function findBannedWordsEn(text: string | null | undefined): string[] {
  const s = String(text ?? '')
  return BANNED_EN.filter((b) => b.pattern.test(s)).map((b) => b.label)
}

/** Повелительное наклонение к клиенту — запрещено и по-английски. */
const IMPERATIVE_EN =
  /\b(don't miss|be sure to|make sure to|you should visit|don't forget to|check out)\b/i

// ── Валидация ───────────────────────────────────────────────────────────

/**
 * Граница слова для кириллицы.
 *
 * `\b` в JavaScript определён по ASCII и с русскими словами НЕ РАБОТАЕТ:
 * `/\bявляется\b/` не совпадает ни с чем. Ошибка повторялась в этом проекте
 * трижды — в japantravel-event-intake.ts (там она живёт до сих пор), в первой
 * версии poi-matching.ts и в первой версии этого файла. Поэтому граница
 * задаётся явными классами символов, а не `\b`.
 */
function cyrillicWord(body: string): RegExp {
  return new RegExp(`(^|[^а-яёa-z])(?:${body})(?![а-яёa-z])`, 'i')
}

/** Слова, запрещённые каноном: за ними нет доказательства. */
const BANNED = [
  { label: 'уникальный', pattern: cyrillicWord('уникальн(ый|ая|ое|ые|ым|ого|ой|ом|ую)') },
  { label: 'незабываемый', pattern: cyrillicWord('незабываем[а-яё]*') },
  { label: 'премиальный', pattern: cyrillicWord('премиальн[а-яё]*') },
  { label: 'является', pattern: cyrillicWord('явля(ется|ются|лся|лась)') },
  { label: 'осуществлять', pattern: cyrillicWord('осуществля[а-яё]*') },
  // Строго по границам: подстрока «данн» живёт внутри «созданный»,
  // «переданная», «воссозданное». Поиск подстрокой давал 28 ложных
  // срабатываний на 425 записей — ни одного настоящего нарушения.
  // Формы «данные» и «данных» намеренно НЕ включены: это чаще
  // существительное «сведения» («данные о поездке»), а не канцелярское
  // указательное «данный». Ловим только однозначные адъективные формы.
  { label: 'данный', pattern: cyrillicWord('данн(ый|ая|ое|ым|ого|ой|ом|ую)') },
  { label: 'в настоящее время', pattern: /в настоящее время/i },
]

export function findBannedWords(text: string | null | undefined): string[] {
  const s = String(text ?? '')
  return BANNED.filter((b) => b.pattern.test(s)).map((b) => b.label)
}

/* Канон должен доходить до того, кто пишет текст, а не только до того, кто
   его потом проверяет. Генератор черновиков в панели жил отдельной жизнью:
   его промпты не знали ни про запрещённые слова, ни про макроны, ни про
   британскую норму — и соблюдение канона зависело от везения.
   Списки отдаём наружу, чтобы промпт строился из того же источника, что и
   проверка, и они не разъезжались. */

/** Ярлыки запрещённых слов — для промптов генератора. */
export const BANNED_WORD_LABELS_RU: readonly string[] = BANNED.map((entry) => entry.label)
export const BANNED_WORD_LABELS_EN: readonly string[] = BANNED_EN.map((entry) => entry.label)

/** Показательные пары «американское → британское» для промпта. */
export const BRITISH_SPELLING_EXAMPLES: readonly string[] = [
  'center → centre',
  'meter → metre',
  'harbor → harbour',
  'recognize → recognise',
  'traveler → traveller',
]

/** Повелительное наклонение к клиенту канон запрещает. */
const IMPERATIVE = cyrillicWord(
  'идите|попробуйте|возьмите|сходите|посетите|не пропустите|уточняйте|закажите|обязательно сходите',
)

export interface CanonIssue {
  field: string
  level: 'error' | 'warn'
  message: string
}

export interface PoiCanonInput {
  nameRu: string
  nameEn?: string
  siteCity?: string
  categoriesRu?: string[]
  workingHours?: string
  descriptionRu?: string
  /**
   * Английское описание. Путь записи заполняет им «Description Draft (EN)»:
   * исследователь его возвращает, и раньше оно молча терялось — каждая
   * заведённая ботом точка приезжала с русским текстом и пустым английским.
   */
  descriptionEn?: string
  website?: string
  /** Широта WGS 84. Заполняется только вместе с lon. */
  lat?: number | null
  /** Долгота WGS 84. Заполняется только вместе с lat. */
  lon?: number | null
  /**
   * Работает ли объект. Пустое значение — не «работает», а «не проверено»:
   * умолчание в пользу оптимизма однажды уже поставило в программу музей,
   * закрытый на реконструкцию.
   */
  operatingStatus?: string
}

// ── Координаты ──────────────────────────────────────────────────────────

/**
 * Япония целиком, с запасом: от Йонагуни на юго-западе до Эторофу
 * на северо-востоке. Точка вне этой рамки — почти наверняка ошибка
 * источника, а не место в Японии.
 */
const JAPAN_BOX = { latMin: 20, latMax: 46.5, lonMin: 122, lonMax: 154 }

/**
 * Проверяет пару координат и приводит к семи знакам — точности поля.
 *
 * Возвращает `null` вместо частичной пары: одна координата без второй
 * бесполезна для всего, ради чего они заводились (расстояние, карта,
 * логистика дня), а хранение половины создаёт иллюзию заполненности.
 */
export function canonicalCoords(
  lat: number | null | undefined,
  lon: number | null | undefined,
): { lat: number | null; lon: number | null; issues: CanonIssue[] } {
  const issues: CanonIssue[] = []
  const has = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

  if (!has(lat) && !has(lon)) return { lat: null, lon: null, issues }

  if (has(lat) !== has(lon)) {
    issues.push({
      field: 'coords',
      level: 'warn',
      message: 'Дана только одна координата из двух — обе отброшены, точку не поставить на карту',
    })
    return { lat: null, lon: null, issues }
  }

  const la = lat as number
  const lo = lon as number

  // Перестановка широты и долготы — самая частая ошибка внешних источников,
  // и в Японии она ловится сразу: долгота там 122–154, а широта столько
  // быть не может физически.
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) {
    issues.push({
      field: 'coords',
      level: 'error',
      message: `Координаты вне диапазона (${la}, ${lo}) — похоже, широта и долгота переставлены местами`,
    })
    return { lat: null, lon: null, issues }
  }

  if (la < JAPAN_BOX.latMin || la > JAPAN_BOX.latMax || lo < JAPAN_BOX.lonMin || lo > JAPAN_BOX.lonMax) {
    issues.push({
      field: 'coords',
      level: 'error',
      message: `Точка (${la}, ${lo}) лежит вне Японии — источник дал координаты другого объекта`,
    })
    return { lat: null, lon: null, issues }
  }

  return { lat: Number(la.toFixed(7)), lon: Number(lo.toFixed(7)), issues }
}

/** Категории — ровно опции поля Airtable, новых создавать нельзя. */
export const POI_CATEGORIES_RU = [
  'Синтоистское святилище', 'Буддийский храм', 'Архитектурный объект', 'Музей',
  'Арт-пространство / Галерея', 'Смотровая площадка', 'Ландшафтный сад / Парк',
  'Достопримечательность', 'Историческое место', 'Ресторан', 'Японский отель',
  'Парк развлечений', 'Шоппинг', 'Термальный Источник', 'СПА',
  'Городской район', 'Транспортный узел',
  // Решение владельца 10.08.2026: узнаваемый кадр — самостоятельный признак.
  // Ради него едут отдельно от того, храм это, мост или одинокое дерево
  // в поле, поэтому категория стоит РЯДОМ с предметной, а не вместо неё.
  'Знаковый вид',
] as const

// ── Работает ли объект ──────────────────────────────────────────────────

/**
 * Состояние объекта. Заводится ради одного правила, которое до сих пор
 * держалось на внимательности: закрытую точку нельзя ставить в программу.
 *
 * Почему «Сезонный» — отдельное значение, а не разновидность закрытого.
 * Google не различает «закрылось» и «межсезонье»: сад плакучих слив
 * в Судзуке открыт три с половиной недели в году, а остальные одиннадцать
 * месяцев отдаётся как CLOSED_TEMPORARILY. Если сложить их в одну корзину,
 * запрет выкинет сезонный объект из мартовской программы, для которой он
 * и заводился. У нас таких много: лаванда Фурано, поля Биэя, снежный
 * коридор, момидзи, ханами.
 */
export const OPERATING_STATUSES = [
  'Работает',
  'Сезонный',
  'Закрыт временно',
  'Закрыт навсегда',
  'Не проверено',
] as const

export type OperatingStatus = (typeof OPERATING_STATUSES)[number]

/** Статусы, при которых точку в программу ставить нельзя ни при каких условиях. */
const CLOSED_STATUSES: readonly OperatingStatus[] = ['Закрыт временно', 'Закрыт навсегда']

export function canonicalOperatingStatus(value: string | null | undefined): OperatingStatus {
  const raw = String(value ?? '').trim()
  const hit = OPERATING_STATUSES.find((s) => s.toLowerCase() === raw.toLowerCase())
  return hit ?? 'Не проверено'
}

/**
 * Перевод ответа Google в наш статус.
 *
 * `known` — то, что уже стоит в записи. Сезонность Google не видит, знаем
 * о ней только мы, и автоматический прогон НЕ ИМЕЕТ ПРАВА её затирать:
 * иначе каждое лето сад слив будет выпадать из программ, а каждую зиму —
 * лавандовые поля.
 */
export function operatingStatusFromGoogle(
  businessStatus: string | null | undefined,
  known?: string | null,
): OperatingStatus {
  const current = canonicalOperatingStatus(known)
  if (current === 'Сезонный') return 'Сезонный'

  switch (String(businessStatus ?? '').trim().toUpperCase()) {
    case 'OPERATIONAL':
      return 'Работает'
    case 'CLOSED_TEMPORARILY':
      return 'Закрыт временно'
    case 'CLOSED_PERMANENTLY':
      return 'Закрыт навсегда'
    default:
      return 'Не проверено'
  }
}

/**
 * Можно ли ставить точку в программу тура. ЕДИНСТВЕННОЕ место, где это
 * решается, — чтобы правило не пришлось повторять в каждом агенте.
 *
 * `on` — дата дня программы. Без неё сезонный объект пропускается с
 * оговоркой: проверить окно некому, но и отказывать нельзя — большинство
 * программ собирается заранее и без точных дат.
 */
export function checkProgrammeUsable(
  status: string | null | undefined,
  options: { on?: Date | null; seasonFrom?: Date | null; seasonTo?: Date | null } = {},
): { usable: boolean; reason: string } {
  const s = canonicalOperatingStatus(status)

  if (CLOSED_STATUSES.includes(s)) {
    return { usable: false, reason: `Объект со статусом «${s}» в программу не ставится` }
  }
  if (s === 'Сезонный') {
    const { on, seasonFrom, seasonTo } = options
    if (!on || !seasonFrom || !seasonTo) {
      return { usable: true, reason: 'Сезонный объект: сверьте даты тура с окном в Working Hours' }
    }
    const inSeason = on >= seasonFrom && on <= seasonTo
    return inSeason
      ? { usable: true, reason: '' }
      : { usable: false, reason: 'Дата тура вне сезона работы объекта' }
  }
  if (s === 'Не проверено') {
    return { usable: true, reason: 'Состояние объекта не проверялось — сверьте перед выдачей гостю' }
  }
  return { usable: true, reason: '' }
}

/**
 * Приводит запись к канону и сообщает, что осталось не так.
 * Ничего не выбрасывает: решение принимает вызывающий.
 */
export function applyCanon(input: PoiCanonInput): {
  value: PoiCanonInput
  issues: CanonIssue[]
} {
  const issues: CanonIssue[] = []
  const push = (field: string, level: 'error' | 'warn', message: string) =>
    issues.push({ field, level, message })

  const nameRu = canonicalText(input.nameRu)
  if (!nameRu) push('nameRu', 'error', 'Пустое русское название — запись без имени не заводится')

  const siteCity = canonicalCity(input.siteCity)
  if (!siteCity) {
    push('siteCity', 'error', 'Не указан город. Служебные записи помечаются Is System, а не пустым городом')
  } else if (!KNOWN_CITIES.has(siteCity)) {
    push('siteCity', 'warn', `Город «${siteCity}» не в справочнике — проверьте написание или добавьте в KNOWN_CITIES`)
  }
  if (input.siteCity && siteCity !== String(input.siteCity).trim().toLowerCase()) {
    push('siteCity', 'warn', `Слаг приведён к каноническому: «${input.siteCity}» → «${siteCity}»`)
  }

  const categoriesRu = (input.categoriesRu ?? []).filter((c) =>
    (POI_CATEGORIES_RU as readonly string[]).includes(c),
  )
  const dropped = (input.categoriesRu ?? []).filter((c) => !categoriesRu.includes(c))
  if (dropped.length) {
    push('categoriesRu', 'warn', `Отброшены категории вне канона: ${dropped.join(', ')}`)
  }
  if (!categoriesRu.length) {
    push('categoriesRu', 'warn', 'Категория не определена — точку нельзя подобрать под интересы гостя')
  }

  let workingHours = canonicalWorkingHours(input.workingHours)
  if (workingHours && /[A-Za-z]{4,}/.test(workingHours)) {
    // Поле отбрасывается, запись остаётся.
    //
    // Правило заведено ради того, чтобы клиент не увидел латиницу на сайте.
    // Отказ всей записи эту цель не приближает, а вредит: точка не заводится
    // вовсе. Прогон Киото стоил пяти настоящих POI, потерянных из-за одного
    // поля — при том что запись всё равно создаётся черновиком и часы
    // на сайт без проверки человеком не попадают.
    push('workingHours', 'warn', `Часы работы записаны латиницей и отброшены: «${workingHours}»`)
    workingHours = ''
  }

  const descriptionRu = canonicalText(input.descriptionRu)
  const banned = findBannedWords(descriptionRu)
  if (banned.length) push('descriptionRu', 'error', `Запрещённые каноном слова: ${banned.join(', ')}`)
  if (IMPERATIVE.test(descriptionRu)) {
    push('descriptionRu', 'warn', 'Повелительное наклонение к клиенту — канон требует тона консьержа')
  }

  // Английский текст только подрезаем по краям. Прогонять его через
  // canonicalText нельзя: тот ставит «ёлочки» и меняет точку на запятую
  // в дробях — для русского это канон, для английского порча.
  const descriptionEn = canonicalTextEn(input.descriptionEn)
  const bannedEn = findBannedWordsEn(descriptionEn)
  if (bannedEn.length) {
    push('descriptionEn', 'error', `Клише английского травел-копирайтинга: ${bannedEn.join(', ')}`)
  }
  if (IMPERATIVE_EN.test(descriptionEn)) {
    push('descriptionEn', 'warn', 'Повелительное наклонение к клиенту в английском тексте')
  }
  for (const issue of findSpellingIssuesEn(descriptionEn)) {
    push('descriptionEn', 'warn', issue)
  }
  // Описание заводится ТОЛЬКО парой — это ошибка, а не замечание.
  //
  // Замер на живой базе 06.08.2026: 121 запись из 431 с русским текстом
  // и без единого английского, обратных случаев — ноль во всех четырёх
  // парах полей. Односторонний перекос означает не случайные пропуски,
  // а незакрытый путь: исследователь возвращал английский текст, а запись
  // его молча теряла. Предупреждение такой долг только фиксирует; чтобы
  // он перестал расти, половину принимать нельзя.
  //
  // Заведению служебных записей это не мешает: у заглушек описания нет
  // вовсе, пояснение к ним идёт в примечания. Правка существующих записей
  // идёт мимо конвейера, поэтому редактировать тексты правило не трогает.
  if (descriptionRu && !descriptionEn) {
    push('descriptionEn', 'error', 'Есть русское описание, нет английского — описание заводится только парой')
  }

  if (input.website && !/^https?:\/\//i.test(input.website)) {
    push('website', 'warn', 'Сайт без схемы http(s) — Airtable отвергнет значение поля url')
  }

  const coords = canonicalCoords(input.lat, input.lon)
  issues.push(...coords.issues)

  // Закрытый объект — ЗАМЕЧАНИЕ, а не ошибка, и это не мягкость.
  //
  // `error` в этой функции запрещает запись целиком (см. poi-ingest, шаг 1).
  // Сделать закрытость ошибкой значило бы: базе нельзя знать, что объект
  // закрылся. Тогда запрет на использование в программах не на что опереть —
  // проверять будет нечего, и точка вернётся в базу при следующем прогоне
  // коллектора как незнакомая.
  //
  // Запрет живёт в checkProgrammeUsable и срабатывает при постановке точки
  // в день тура. Здесь мы только приводим статус к канону и говорим вслух.
  const operatingStatus = canonicalOperatingStatus(input.operatingStatus)
  const usable = checkProgrammeUsable(operatingStatus)
  if (!usable.usable) push('operatingStatus', 'warn', usable.reason)

  return {
    value: {
      nameRu,
      nameEn: input.nameEn?.trim() || undefined,
      siteCity,
      categoriesRu,
      workingHours,
      descriptionRu,
      descriptionEn: descriptionEn || undefined,
      website: input.website,
      lat: coords.lat,
      lon: coords.lon,
      operatingStatus,
    },
    issues,
  }
}
