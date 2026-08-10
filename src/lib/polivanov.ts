/**
 * Прямая транслитерация по Поливанову: ромадзи → кириллица.
 *
 * Обратное направление (кириллица → ромадзи) живёт в poi-matching.ts и
 * служит сопоставлению имён. Здесь направление другое и задача другая —
 * ЗАВЕСТИ русское название для точки, у которой его ещё нет. Внешние
 * источники дают японское и английское имя; русское первично для сайта,
 * и до этого модуля его приходилось писать руками для каждой записи.
 *
 * ──────────────────────────────────────────────────────────────────────
 * ЧТО ЭТОТ МОДУЛЬ НЕ ДЕЛАЕТ
 *
 * Он не переводит. «Tokyo Skytree» → «Токио Скайтри» и «Nakano Broadway»
 * → «Накано Бродвей» — это записанные каной заимствования, и Поливанов
 * к ним неприменим: в базе они уже стоят в русской традиционной записи.
 * Поэтому `romajiToCyrillic` возвращает не строку, а строку С ОЦЕНКОЙ:
 * если слово не разбирается на японские слоги без остатка, уверенность
 * падает, и вызывающий обязан отдать такую запись человеку, а не писать
 * её в базу молча.
 *
 * Родовое слово ПЕРЕВОДИТСЯ, а не транслитерируется: база написана как
 * «Храм Тодайдзи», «Замок Осака», «Водопад Кэгон» — русское родовое слово
 * впереди, транслитерированное ядро следом. Это же соглашение читает
 * GENERIC_HEAD в poi-matching.ts, то есть имена, собранные здесь, сразу
 * сопоставимы с уже заведёнными.
 * ──────────────────────────────────────────────────────────────────────
 */

import { splitName, stripDiacritics } from './poi-matching.ts'

/**
 * Слоги, от длинных к коротким. Порядок критичен: «shi» обязан
 * разобраться раньше «sh» и «si», иначе получится «схи».
 */
const SYLLABLES: Array<[string, string]> = [
  // Йотированные и шипящие — раньше всех прочих.
  ['shcha', 'ся'],
  ['sha', 'ся'], ['shu', 'сю'], ['sho', 'сё'], ['she', 'сэ'], ['shi', 'си'],
  ['cha', 'тя'], ['chu', 'тю'], ['cho', 'тё'], ['che', 'тэ'], ['chi', 'ти'],
  ['tsu', 'цу'], ['tsa', 'ца'], ['tse', 'цэ'], ['tso', 'цо'],
  ['ja', 'дзя'], ['ju', 'дзю'], ['jo', 'дзё'], ['je', 'дзэ'], ['ji', 'дзи'],
  ['kya', 'кя'], ['kyu', 'кю'], ['kyo', 'кё'],
  ['gya', 'гя'], ['gyu', 'гю'], ['gyo', 'гё'],
  ['nya', 'ня'], ['nyu', 'ню'], ['nyo', 'нё'],
  ['hya', 'хя'], ['hyu', 'хю'], ['hyo', 'хё'],
  ['bya', 'бя'], ['byu', 'бю'], ['byo', 'бё'],
  ['pya', 'пя'], ['pyu', 'пю'], ['pyo', 'пё'],
  ['mya', 'мя'], ['myu', 'мю'], ['myo', 'мё'],
  ['rya', 'ря'], ['ryu', 'рю'], ['ryo', 'рё'],
  ['ka', 'ка'], ['ki', 'ки'], ['ku', 'ку'], ['ke', 'кэ'], ['ko', 'ко'],
  ['ga', 'га'], ['gi', 'ги'], ['gu', 'гу'], ['ge', 'гэ'], ['go', 'го'],
  ['sa', 'са'], ['su', 'су'], ['se', 'сэ'], ['so', 'со'], ['si', 'си'],
  // дза/дзу/дзэ/дзо — Поливанов, не «за/зу/зэ/зо».
  ['za', 'дза'], ['zu', 'дзу'], ['ze', 'дзэ'], ['zo', 'дзо'], ['zi', 'дзи'],
  ['ta', 'та'], ['te', 'тэ'], ['to', 'то'], ['ti', 'ти'], ['tu', 'цу'],
  ['da', 'да'], ['de', 'дэ'], ['do', 'до'], ['di', 'ди'], ['du', 'дзу'],
  ['na', 'на'], ['ni', 'ни'], ['nu', 'ну'], ['ne', 'нэ'], ['no', 'но'],
  ['ha', 'ха'], ['hi', 'хи'], ['he', 'хэ'], ['ho', 'хо'],
  ['fu', 'фу'], ['fa', 'фа'], ['fi', 'фи'], ['fe', 'фэ'], ['fo', 'фо'],
  ['ba', 'ба'], ['bi', 'би'], ['bu', 'бу'], ['be', 'бэ'], ['bo', 'бо'],
  ['pa', 'па'], ['pi', 'пи'], ['pu', 'пу'], ['pe', 'пэ'], ['po', 'по'],
  ['ma', 'ма'], ['mi', 'ми'], ['mu', 'му'], ['me', 'мэ'], ['mo', 'мо'],
  ['ya', 'я'], ['yu', 'ю'], ['yo', 'ё'],
  ['ra', 'ра'], ['ri', 'ри'], ['ru', 'ру'], ['re', 'рэ'], ['ro', 'ро'],
  ['la', 'ра'], ['li', 'ри'], ['lu', 'ру'], ['le', 'рэ'], ['lo', 'ро'],
  ['wa', 'ва'], ['wo', 'о'], ['wi', 'ви'], ['we', 'вэ'],
  ['va', 'ва'], ['vu', 'ву'], ['ve', 'вэ'], ['vi', 'ви'], ['vo', 'во'],
  ['a', 'а'], ['i', 'и'], ['u', 'у'], ['e', 'э'], ['o', 'о'],
  ['nq', 'нъ'],
  ['n', 'н'],
]

/** Согласные, удвоение которых передаёт っ: «Nikko» → «Никко». */
const GEMINATE: Record<string, string> = {
  k: 'к', s: 'с', t: 'т', p: 'п', g: 'г', b: 'б', d: 'д',
  z: 'д', m: 'м', r: 'р', h: 'х', f: 'ф',
}

/**
 * Устоявшиеся написания сайта. Канон важнее Поливанова там, где по
 * поливановской форме людям не найти место поиском.
 *
 * КАК ПОПАСТЬ В ЭТОТ СПИСОК (замер 10.08.2026).
 *
 * Счёт по русской Википедии: insource:"форма" для ОБЕИХ форм, с ОДНИМ
 * И ТЕМ ЖЕ фильтром на японский контекст. Симметрия обязательна: первая
 * версия замера фильтровала только одну чашу весов и давала «Кобе» ×5,3
 * вместо настоящих ×3,7. Регулярным выражением не мерить — оно ловит
 * подстроку и приписывает «Кобе» ещё и Кобеляки с кобелём (3540 вместо 113).
 *
 *   Токио 10759 : 25 Токё        ×430
 *   Иокогама 247 : 17 Ёкохама    ×14,5
 *   Кобе 113 : 31 Кобэ           ×3,7
 *   Хакодате 140 : 64 Хакодатэ   ×2,2
 *   Хаконе 27 : 23 Хаконэ        ×1,17  ← НИЧЬЯ
 *   Сендай 110 : 109 Сэндай      ×1,01  ← НИЧЬЯ
 *
 * ЧТО ЭТОТ ЗАМЕР НЕ РЕШАЕТ. Он мерит корпус энциклопедии, а канон сайта
 * обоснован ПОИСКОМ — тем, как люди набирают запрос. Это разные величины,
 * и подменять вторую первой нельзя: у «Хаконе» корпус даёт ничью, хотя
 * решение владельца (14.07.2026) однозначно. Поэтому:
 *
 *   корпус толстый (разница в разы) — решает счёт;
 *   корпус тонкий (десятки статей, разница в проценты) — решает владелец,
 *   и это записывается как решение, а не выдаётся за измерение.
 *
 * «Хаконе», «Токио», «Киото» — решения владельца, счёт их не опровергает.
 * «Хакодате» вошло по счёту. «Сендай» не вошло: 1% это не довод.
 *
 * Почему тут одни города. У мелких топонимов корпуса нет вовсе: Куродакэ,
 * Сирахигэ и Асахидакэ стоят 1:1 или 1:0. Мерить нечего — держит Поливанов.
 */
export const POLIVANOV_EXCEPTIONS: Record<string, string> = {
  hakone: 'Хаконе',
  hakodate: 'Хакодате',
  tokyo: 'Токио',
  kyoto: 'Киото',
  osaka: 'Осака',
  yokohama: 'Иокогама',
  hokkaido: 'Хоккайдо',
  honshu: 'Хонсю',
  kyushu: 'Кюсю',
  shikoku: 'Сикоку',
  fuji: 'Фудзи',
  fujisan: 'Фудзисан',
  kobe: 'Кобе',
  kioto: 'Киото',
  nikko: 'Никко',
  edo: 'Эдо',
  ginza: 'Гиндза',
  shibuya: 'Сибуя',
  shinjuku: 'Синдзюку',
  asakusa: 'Асакуса',
  ueno: 'Уэно',
  odaiba: 'Одайба',
  hiroshima: 'Хиросима',
  nagasaki: 'Нагасаки',
  sapporo: 'Саппоро',
  sendai: 'Сэндай',
  nara: 'Нара',
  kanazawa: 'Канадзава',
  kamakura: 'Камакура',
  himeji: 'Химэдзи',
}

/**
 * Написания, которые канон запрещает, и чем их заменять.
 *
 * Список НЕ ведётся руками, а выводится: для каждого исключения считается,
 * что дал бы чистый Поливанов, и если это расходится с каноном — расхождение
 * и есть запрещённая форма. «hakone» по правилам даёт «Хаконэ», канон велит
 * «Хаконе» — значит «Хаконэ» в текстах недопустимо.
 *
 * Почему выводится, а не перечисляется. Ручной список — четвёртое место,
 * где живёт одно правило, и он разойдётся с таблицей исключений в тот день,
 * когда в неё добавят строку и забудут про него. Здесь забыть нечего.
 *
 * Замена идёт подстрокой намеренно: канон владельца (14.07.2026)
 * распространяется на производные — Хаконе Дзиндзя, Мотохаконе, Хаконемати.
 * Подстрока чинит их все, перечисление не починило бы ни одного.
 */
export const CANON_SPELLING_FIXES: ReadonlyArray<readonly [wrong: string, right: string]> =
  Object.entries(POLIVANOV_EXCEPTIONS)
    .map(([romaji, canon]) => {
      const plain = romajiToCyrillic(romaji, { ignoreExceptions: true }).value
      const wrong = plain.charAt(0).toUpperCase() + plain.slice(1)
      const right = canon.charAt(0).toUpperCase() + canon.slice(1)
      return [wrong, right] as const
    })
    .filter(([wrong, right]) => wrong && wrong !== right)

/**
 * Приводит русский текст к каноническим написаниям. Возвращает и список правок.
 *
 * Чинятся обе формы, с заглавной и со строчной. Первая версия правила знала
 * только заглавную — и «Мотохаконэ» проходило мимо, хотя производные и есть
 * та причина, по которой правило распространяется подстрокой. Ошибка нашлась
 * на первом же прогоне, потому что производное стояло в проверке.
 */
export function applyCanonSpelling(text: string): { value: string; fixes: string[] } {
  let value = text
  const fixes: string[] = []
  for (const [wrong, right] of CANON_SPELLING_FIXES) {
    for (const [from, to] of [
      [wrong, right],
      [wrong.charAt(0).toLowerCase() + wrong.slice(1), right.charAt(0).toLowerCase() + right.slice(1)],
    ]) {
      if (!value.includes(from)) continue
      value = value.split(from).join(to)
      if (!fixes.includes(`«${wrong}» → «${right}»`)) fixes.push(`«${wrong}» → «${right}»`)
    }
  }
  return { value, fixes }
}

export interface TranslitResult {
  /** Результат. Пустая строка, если разобрать не удалось. */
  value: string
  /**
   * Доля символов, разобранных как японские слоги: 1 — слово разложилось
   * без остатка, 0,7 — почти треть символов пришлось пропустить как есть.
   * Ниже 0,95 запись нельзя заводить молча.
   */
  confidence: number
  /** Символы, которые не легли ни в один слог. */
  leftovers: string
}

/** Транслитерирует ОДНО слово ромадзи. Пробелов внутри не ждёт. */
export function romajiToCyrillic(
  input: string | null | undefined,
  options: { ignoreExceptions?: boolean } = {},
): TranslitResult {
  const raw = stripDiacritics(String(input ?? ''))
    .toLowerCase()
    // Апостроф в ромадзи — не украшение: «n'ya» это ん+я (Дайканъяма),
    // а «nya» это にゃ (Ханяма). Разделитель заменяется на «q» —
    // служебный символ, который таблица слогов превращает в твёрдый знак.
    .replace(/n['’ʼ`](?=[yaiueo])/g, 'nq')
    .replace(/['’ʼ`]/g, '')
    .replace(/[^a-z0-9q]/g, '')
  if (!raw) return { value: '', confidence: 0, leftovers: '' }

  // Регистр здесь не решается: заглавную букву ставит poiNameToRu, когда
  // собирает имя. Иначе исключение приходило бы уже с заглавной, а обычное
  // слово — со строчной, и в середине названия они выглядели бы по-разному.
  // Долгота схлопывается ДО поиска в исключениях: «Toukyou», «Tōkyō»
  // и «Tokyo» — одно слово, и попасть в исключение обязаны все три.
  // Иначе «Toukyou» проходило бы мимо и давало «Токё».
  const key = raw.replace(/ou|oo/g, 'o').replace(/uu/g, 'u')
  // ignoreExceptions нужен ровно одному вызову — тому, что ВЫВОДИТ список
  // запрещённых написаний (см. CANON_SPELLING_FIXES ниже). Ему требуется
  // узнать, что дал бы Поливанов, если бы канона не было.
  const exception = options.ignoreExceptions
    ? undefined
    : (POLIVANOV_EXCEPTIONS[raw] ?? POLIVANOV_EXCEPTIONS[key])
  if (exception) return { value: exception.toLowerCase(), confidence: 1, leftovers: '' }

  let out = ''
  let leftovers = ''
  let i = 0
  let matchedChars = 0

  while (i < raw.length) {
    const ch = raw[i]
    const next = raw[i + 1]

    // Долгая гласная: oo / ou / uu — один звук. «Toukyou» и «Tokyo»
    // обязаны дать одно и то же, иначе одно место заведётся дважды.
    if ((ch === 'o' && (next === 'o' || next === 'u')) || (ch === 'u' && next === 'u')) {
      out += ch === 'o' ? 'о' : 'у'
      i += 2
      matchedChars += 2
      continue
    }

    // Удвоение согласной перед слогом — っ.
    if (next === ch && GEMINATE[ch] && raw[i + 2]) {
      out += GEMINATE[ch]
      i += 1
      matchedChars += 1
      continue
    }
    // «tch» = っ + ти: «Hotchi» → «Хотти».
    if (ch === 't' && next === 'c' && raw[i + 2] === 'h') {
      out += 'т'
      i += 1
      matchedChars += 1
      continue
    }

    // «i» после гласной — «й» ТОЛЬКО после «а» и «э». Измерено на 394
    // парах имён из живой базы, спор решён данными, а не правилом из
    // учебника:
    //   ai → ай  34 случая против 3   (Нусамай, Дайкокутэн, Адзисайдэра)
    //   ei → эй  12 случаев против 0  (Мэйдзи, Хэйан, Тайхэйё)
    //   oi → ои   0 случаев против 5  (Оиси, Коисикава, Бёдоин, Мэйгэцуин)
    // «ой» в базе не встречается ни разу, поэтому «о» из правила исключена.
    // «эй» действует и перед гласной: Heian → Хэйан, а не Хэиан.
    if (ch === 'i' && /[аэ]$/.test(out)) {
      out += 'й'
      i += 1
      matchedChars += 1
      continue
    }

    let matched = false
    for (const [romaji, cyrillic] of SYLLABLES) {
      if (!raw.startsWith(romaji, i)) continue
      // Одинокая «n» перед гласной — это не ん, а начало слога «na/ni/…»,
      // и таблица разберёт его следующей итерацией. Здесь «n» берётся
      // только перед согласной или в конце слова.
      if (romaji === 'n' && /[aiueoy]/.test(raw[i + 1] ?? '')) continue
      out += cyrillic
      i += romaji.length
      matchedChars += romaji.length
      matched = true
      // Долгота, записанная после слога: «Toukyou» = «to»+«u»+«kyo»+«u».
      // Правило в начале цикла ловит только «oo/ou/uu», стоящие подряд
      // с самого начала слова; здесь тот же звук, но хвостом слога.
      // Без этого «Toukyou» давало «тоукёу» вместо «Токио», и одно место
      // заводилось дважды — по написанию с долготой и без неё.
      const last = romaji[romaji.length - 1]
      const follow = raw[i]
      if ((last === 'o' && (follow === 'u' || follow === 'o')) || (last === 'u' && follow === 'u')) {
        i += 1
        matchedChars += 1
      }
      break
    }
    if (!matched) {
      leftovers += ch
      i += 1
    }
  }

  return {
    value: out,
    confidence: Number((matchedChars / raw.length).toFixed(3)),
    leftovers,
  }
}

/**
 * Каноническое русское родовое слово по классу объекта.
 *
 * Значения взяты НЕ из словаря, а из живой базы — так владелец уже пишет:
 * «Водопад Кэгон», «Рынок Нисики», «Квартал Нарамати», «Смотровая Хосоока».
 * Совпадение с GENERIC_HEAD матчера обязательно: собранное здесь имя должно
 * сопоставляться с уже заведёнными по тем же правилам.
 */
const HEAD_RU: Record<string, string> = {
  temple: 'Храм', shrine: 'Святилище', museum: 'Музей',
  'art-museum': 'Художественный музей', garden: 'Сад', park: 'Парк',
  castle: 'Замок', onsen: 'Горячие источники', ropeway: 'Канатная дорога',
  railway: 'Горная железная дорога', lookout: 'Смотровая', mountain: 'Гора',
  lake: 'Озеро', pond: 'Пруд', waterfall: 'Водопад', bridge: 'Мост',
  station: 'Станция', tower: 'Башня', market: 'Рынок', street: 'Улица',
  district: 'Квартал', gallery: 'Галерея', hall: 'Зал', ruins: 'Руины',
  palace: 'Дворец', island: 'Остров', valley: 'Долина', gorge: 'Ущелье',
  gate: 'Ворота', zoo: 'Зоопарк', aquarium: 'Аквариум', beach: 'Пляж',
  amusement: 'Парк развлечений', shopping: 'Торговый центр',
  'botanical-garden': 'Ботанический сад', 'memorial-park': 'Мемориальный парк',
  'national-park': 'Национальный парк', 'history-museum': 'Исторический музей',
  'crater-lake': 'Кратерное озеро', cave: 'Пещера', cape: 'Мыс', bay: 'Залив',
  'castle-ruins': 'Руины замка', dam: 'Плотина', kofun: 'Курган', river: 'Река',
  pass: 'Перевал', brewery: 'Пивоварня', factory: 'Завод', theatre: 'Театр',
  mausoleum: 'Мавзолей', villa: 'Вилла', hills: 'Холмы', plateau: 'Плато',
  forum: 'Форум', cruise: 'Круиз', boat: 'Катер', pier: 'Причал',
}

/**
 * Английские слова, которые НЕ читаются как ромадзи.
 *
 * Разбор идёт по словам, а не отрезанием хвоста. Прежняя версия снимала
 * только последнее слово, и «Hokkaido Museum of Art, Asahikawa» упиралось
 * в «Museum» посреди строки: слово не раскладывалось на слоги, уверенность
 * падала до 0,33, и запись уходила в отказ. На корпусе из 394 имён так
 * отказывалось 188 — почти половина, и почти все по этой причине,
 * а не из-за транслитерации.
 *
 * Ключ — слово в нижнем регистре, значение — класс родового слова
 * (для HEAD_RU) либо `null`, если слово служебное и просто отбрасывается.
 */
const EN_WORDS: Record<string, string | null> = {
  // Родовые: дают русское слово впереди имени.
  temple: 'temple', temples: 'temple', shrine: 'shrine', shrines: 'shrine',
  museum: 'museum', gallery: 'gallery', garden: 'garden', gardens: 'garden',
  park: 'park', castle: 'castle', bridge: 'bridge', tower: 'tower',
  station: 'station', market: 'market', marketplace: 'market',
  street: 'street', avenue: 'street', district: 'district', quarter: 'district',
  hall: 'hall', gate: 'gate', ruins: 'ruins', palace: 'palace',
  island: 'island', islands: 'island', valley: 'valley', gorge: 'gorge',
  canyon: 'gorge', zoo: 'zoo', aquarium: 'aquarium', beach: 'beach',
  beaches: 'beach', lake: 'lake', pond: 'pond', falls: 'waterfall',
  waterfall: 'waterfall', waterfalls: 'waterfall', observatory: 'lookout',
  observation: 'lookout', deck: 'lookout', viewpoint: 'lookout', ropeway: 'ropeway',
  railway: 'railway', cableway: 'ropeway', mount: 'mountain', mt: 'mountain',
  peak: 'mountain', cave: 'cave', caves: 'cave', cape: 'cape', bay: 'bay',
  pass: 'pass', brewery: 'brewery', factory: 'factory', theatre: 'theatre',
  theater: 'theatre', shrinegate: 'gate', onsen: 'onsen',

  // Служебные и уточняющие: отбрасываются, класс не дают.
  the: null, of: null, and: null, at: null, in: null, on: null, to: null,
  a: null, an: null, for: null, with: null, by: null, from: null,
  art: null, fine: null, arts: null, memorial: null, national: null,
  metropolitan: null, prefectural: null, municipal: null, city: null,
  town: null, village: null, central: null, main: null, former: null,
  great: null, grand: null, old: null, new: null, north: null, south: null,
  east: null, west: null, northern: null, southern: null, eastern: null,
  western: null, upper: null, lower: null, inner: null, outer: null,
  open: null, air: null, red: null, blue: null, green: null, white: null,
  black: null, golden: null, silver: null, bronze: null,
  hot: null, spring: null, springs: null, cable: null, car: null,
  history: null, historic: null, historical: null, science: null,
  modern: null, contemporary: null, international: null, forum: 'forum',
  center: null, centre: null, place: null, house: null, hotel: null,
  line: null, sightseeing: null, short: null, excursion: null,
  making: null, check: null, terrace: null, forest: null, workshops: null,
  workshop: null, mint: null, lodging: null, mausoleum: 'mausoleum', world: null, heritage: null,
  site: null, tea: null, view: null, university: null, botanical: null, imperial: null, villa: 'villa',
  crater: null, cruise: 'cruise', boat: 'boat', ferry: null, exhibition: null,
  plateau: 'plateau', peoples: null, people: null, hills: 'hills',
  hill: 'hills', japan: null, japanese: null, universal: null,
  studios: null, studio: null, independent: null, transfer: null, tour: null,
  meet: null, your: null, guide: null, walk: null, walking: null,
  free: null, time: null, lunch: null, dinner: null, breakfast: null,
  day: null, night: null, evening: null, morning: null, area: null,
  spot: null, point: null, trail: null, route: null, course: null,
  shopping: 'shopping', mall: 'shopping', complex: null, plaza: null,
  food: null, fish: null,
  flower: null, flowers: null, rock: null, stone: null, water: null,
  sea: null, ocean: null, river: null, canal: null, port: null,
  harbor: null, harbour: null, tunnel: null, road: null, path: null,
}

/**
 * Японские суффиксы, означающие род объекта. Снимаются ТОЛЬКО те, что
 * владелец снимает сам.
 *
 * Проверено по базе: «Kinkakuji» это «Гинкакудзи»/«Кинкакудзи», а не
 * «Храм Кинкаку»; «Sensoji» — «Сэнсо-дзи»; «Tsurugaoka Hachimangu» —
 * «Цуругаока Хатимангу». То есть -дзи, -ин, -дэра и -гу остаются в имени.
 * А вот -сан и -яма в значении «гора» снимаются: «Takaosan» → «Гора Такао»,
 * «Wakakusayama» → «Гора Вакакуса».
 */
/**
 * Слова, потеря которых меняет смысл названия. Отбрасывать их приходится —
 * русской пары в HEAD_RU у них нет, — но молчать об этом нельзя.
 */
/**
 * Существительные из английских названий словарём НЕ покрываются намеренно.
 *
 * «Sky», «Building», «Bell», «Dome» — это части имени, а не описание типа
 * объекта. Пока они числились служебными, «Umeda Sky Building» усыхало
 * до «Умэда»: два слова из трёх исчезали молча. Теперь такое слово не
 * опознаётся, ядро признаётся заимствованным и остаётся английским
 * целиком — «Umeda Sky Building».
 */

/**
 * Японские бренды — всегда латиницей.
 *
 * Решение владельца от 6 августа 2026, и принято оно не из-за «иностранности»
 * слова: 任天堂 и 三菱 — обычные японские слова, Поливанов разбирает их без
 * труда («Нинтэндо», «Мицубиси»). Проблема была в другом.
 *
 * Без списка бренды раскалывались ПРОИЗВОЛЬНО — по тому, укладывается ли
 * латинская запись в открытые слоги:
 *   nintendo, toshiba, mitsubishi, shiseido  →  кириллица
 *   suntory, panasonic, yakult, bridgestone  →  латиница (не разбираются)
 * Suntory (サントリー) ничуть не менее японский, чем Mitsubishi, но кончается
 * на согласную. В одной базе вставали бы «Музей Мицубиси» и «Музей Suntory»,
 * и это не правило, а совпадение.
 *
 * Латиница выбрана как единственная форма: бренд совпадает со своим
 * логотипом, находится поиском и не требует решать спор «Тосиба» против
 * «Тошиба» — тот самый, где канон сайта («си, а не ши») расходится
 * с привычным написанием.
 *
 * Бренд НЕ делает латинским остальное имя. «Mitsubishi Ichigokan Museum» —
 * это бренд плюс обычное слово 一号館, и получается «Музей Mitsubishi
 * Итигокан». Правило «заимствование целиком английское» действует только
 * для слов, которые вообще не читаются как ромадзи.
 *
 * Ключ — слово в нижнем регистре, значение — каноническое написание.
 */
const LATIN_BRANDS: Record<string, string> = {
  nintendo: 'Nintendo', toshiba: 'Toshiba', mitsubishi: 'Mitsubishi',
  suntory: 'Suntory', panasonic: 'Panasonic', sony: 'Sony', honda: 'Honda',
  toyota: 'Toyota', nissan: 'Nissan', mazda: 'Mazda', subaru: 'Subaru',
  yamaha: 'Yamaha', canon: 'Canon', nikon: 'Nikon', olympus: 'Olympus',
  casio: 'Casio', seiko: 'Seiko', citizen: 'Citizen', shiseido: 'Shiseido',
  kikkoman: 'Kikkoman', kirin: 'Kirin', ajinomoto: 'Ajinomoto',
  bridgestone: 'Bridgestone', yakult: 'Yakult', calpis: 'Calpis',
  uniqlo: 'UNIQLO', muji: 'MUJI', pokemon: 'Pokémon', ghibli: 'Ghibli',
  sanrio: 'Sanrio', teamlab: 'teamLab', lawson: 'Lawson',
  familymart: 'FamilyMart', yodobashi: 'Yodobashi',
  takashimaya: 'Takashimaya', mitsukoshi: 'Mitsukoshi', isetan: 'Isetan',
  parco: 'PARCO', lumine: 'LUMINE', tokyu: 'Tokyu', odakyu: 'Odakyu',
  seibu: 'Seibu', hankyu: 'Hankyu', hanshin: 'Hanshin', kintetsu: 'Kintetsu',
}

/** Служебные слова: не значат ничего сами по себе и в имя не попадают. */
const FUNCTION_WORDS = new Set([
  'the', 'of', 'and', 'at', 'in', 'on', 'to', 'a', 'an', 'for', 'with',
  'by', 'from',
])

const SIGNIFICANT = new Set([
  'national', 'international', 'imperial', 'metropolitan', 'prefectural',
  'municipal', 'memorial', 'historic', 'historical', 'modern', 'contemporary',
  'botanical', 'open', 'air', 'former', 'great', 'grand', 'samurai',
  'peace', 'heritage', 'world', 'university',
])

const JA_SUFFIX: Array<[RegExp, string]> = [
  // Только -сан/-дзан. «-яма» НЕ снимается: в базе «Арасияма» и «Тэнгуяма»
  // остались как есть, потому что это названия местности, а не «гора Араси».
  // Снятие давало «Гора Араси» — места с таким именем не существует.
  [/(?:zan|san)$/i, 'mountain'],
]

export interface PoiNameResult {
  nameRu: string
  /** Минимальная уверенность разбора по японским словам ядра. */
  confidence: number
  headClass: string | null
  /** Латинские слова, оставленные как есть. */
  keptLatin: string[]
  /** Почему имя нельзя считать готовым. Пусто — можно. */
  warnings: string[]
}

/**
 * Собирает русское название POI из английского.
 *
 * Три вида слов, три судьбы:
 *   родовое английское  →  переводится в русское родовое слово впереди
 *   служебное английское →  отбрасывается
 *   ромадзи             →  транслитерируется по Поливанову
 *   остальное           →  ОСТАЁТСЯ ЛАТИНИЦЕЙ
 *
 * Последнее — не капитуляция, а то же, что делает владелец: в базе стоят
 * «Смотровая Shibuya Sky», «Музей Nintendo», «Makuhari Messe». Для
 * заимствования, записанного каной, поливановская форма даёт нечитаемое
 * слово («China House» → «Тина Хоусэ»), и латиница честнее.
 */
export function poiNameToRu(nameEn: string | null | undefined): PoiNameResult {
  const warnings: string[] = []
  const keptLatin: string[] = []
  const source = String(nameEn ?? '').trim()
  if (!source) {
    return { nameRu: '', confidence: 0, headClass: null, keptLatin, warnings: ['Пустое английское имя'] }
  }

  // Скобочное пояснение отрезается: «Kegon Waterfall (Kegon no taki)» —
  // то же имя, записанное иначе.
  // Хвост после запятой — уточнение места, а не часть имени: «Hotokuji
  // Temple, Kiryu» это «Храм Хотокудзи», город стоит в отдельном поле.
  // Прежде он приклеивался к названию и давал «Храм Хотокудзи Кирю».
  const work = source
    .replace(/\s*[（(][^）)]*[）)]\s*/g, ' ')
    .split(',')[0]
    .trim()

  let headClass: string | null = null
  const parts: string[] = []
  const latinCore: string[] = []
  // Слова, съеденные составным родовым словом. «Museum of Art» — это три
  // токена и одно понятие; без учёта «Art» повисало в имени отдельно
  // и давало «Художественный музей Suntory Art».
  const consumed = new Set<number>()
  const brands: string[] = []
  let worst = 1
  let japaneseWords = 0

  const tokens = work.split(/\s+/).filter(Boolean)
  for (const [index, token] of tokens.entries()) {
    const key = token.toLowerCase().replace(/[^a-z]/g, '')
    if (!key || consumed.has(index)) continue

    // Бренд — раньше всего остального: «Canon» и «Kirin» читаются как
    // ромадзи, и без этой ветки ушли бы в «Канон» и «Кирин».
    if (key in LATIN_BRANDS) {
      const canonical = LATIN_BRANDS[key]
      parts.push(canonical)
      latinCore.push(canonical)
      brands.push(canonical)
      continue
    }

    if (key in EN_WORDS) {
      const cls = EN_WORDS[key]
      // «Art» + «Museum» → художественный музей. Отдельный класс, потому
      // что в базе это «Художественный музей Насу», а не «Музей Насу».
      const prev = tokens[index - 1]?.toLowerCase().replace(/[^a-z]/g, '') ?? ''
      // Составные родовые слова: определение стоит ПЕРЕД существительным
      // и меняет русский эквивалент целиком, а не добавляется к нему.
      // В базе это «Художественный музей Насу», «Ботанический сад Хаконе»,
      // «Мемориальный парк Мира», а не «Музей Насу» с потерянным «Art».
      const COMPOUND: Record<string, string> = {
        'art museum': 'art-museum', 'botanical garden': 'botanical-garden',
        'memorial park': 'memorial-park', 'national park': 'national-park',
        'historical museum': 'history-museum', 'history museum': 'history-museum',
        'crater lake': 'crater-lake', 'art gallery': 'art-museum',
      }
      // Определение бывает и после существительного: «Museum of History».
      // Порядок английский, русский эквивалент один и тот же.
      const next2 = tokens[index + 2]?.toLowerCase().replace(/[^a-z]/g, '') ?? ''
      const after = tokens[index + 1]?.toLowerCase().replace(/[^a-z]/g, '') === 'of' ? next2 : ''
      const compound = COMPOUND[`${prev} ${key}`] ?? COMPOUND[`${after} ${key}`]
      if (compound) {
        headClass = compound
        if (after) { consumed.add(index + 1); consumed.add(index + 2) }
      } else if (cls === 'lookout' && headClass === 'lookout') {
        // «Observation Deck» — два слова одного класса, не удваиваем.
      } else if (cls && !headClass) {
        headClass = cls
      } else if (cls && headClass && cls !== headClass) {
        warnings.push(`В названии два родовых слова: ${headClass} и ${cls} — взято первое`)
      }
      // «Hot Springs» без японского «онсэн» — тоже горячие источники.
      if ((key === 'spring' || key === 'springs') && !headClass) headClass = 'onsen'
      // Определение, которое меняет смысл, но не имеет русской пары
      // в HEAD_RU, теряется молча. Живая база показывает цену: «Tokyo
      // National Museum» — это «Токийский национальный музей», а не «Музей
      // Токио», и разница видна клиенту. Поэтому не пропускаем, а помечаем.
      if (SIGNIFICANT.has(key)) warnings.push(`Определение «${token}» отброшено — проверьте имя`)
      // Родовое слово из имени уходит — его заменит русское. Всё
      // остальное английское («Sky», «Studios») остаётся: если ядро
      // окажется заимствованием, оно понадобится целиком.
      // Предлоги и артикли в латинское ядро не идут: «Suntory Museum of
      // Art» давало «Художественный музей Suntory of Art» — предлог повис
      // без своего существительного, потому что «Art» уже ушло в родовое
      // слово.
      if (!cls && !FUNCTION_WORDS.has(key)) latinCore.push(token)
      continue
    }

    // Японское родовое слово ОТДЕЛЬНЫМ токеном: «Yajiro Onsen»,
    // «Fushimi Inari Taisha». Как суффикс внутри слова оно остаётся
    // («Хатимангу», «Кинкакудзи»), а как отдельное слово — переводится,
    // иначе получается «Ядзиро Онсэн» вместо «Горячие источники Ядзиро».
    const JA_HEAD: Record<string, string> = {
      onsen: 'onsen', taisha: 'shrine', jinja: 'shrine', jingu: 'shrine',
      dera: 'temple', tera: 'temple', koen: 'park', kouen: 'park',
      yama: 'mountain', dake: 'mountain', take: 'mountain',
      misaki: 'cape', wan: 'bay', gawa: 'river', hama: 'beach',
    }
    if (index > 0 && key in JA_HEAD) {
      headClass ??= JA_HEAD[key]
      continue
    }

    // Дефис внутри слова — граница слогов, а не слов: «Todai-ji» одно слово.
    const bare = token.replace(/[-–—]/g, '')
    const suffix = JA_SUFFIX.find(([pattern]) => pattern.test(bare) && bare.length > 6)
    const body = suffix ? bare.replace(suffix[0], '') : bare
    const result = romajiToCyrillic(body)

    // Слово, от которого не осталось НИЧЕГО («Sky» — ни одного слога),
    // раньше просто пропускалось: «Shibuya Sky Observation Deck» давало
    // «Смотровая Сибуя», и слово исчезало из имени бесследно. Полный
    // провал разбора — сильнейший признак заимствования, а не повод
    // молчать.
    if (!result.value || result.confidence < 0.95) {
      // Не раскладывается на слоги — это не японское слово. Оставляем как
      // есть: «Skytree» останется «Skytree», а не станет «Скитрээ».
      keptLatin.push(token)
      parts.push(token)
      latinCore.push(token)
      continue
    }
    if (suffix) headClass ??= suffix[1]
    japaneseWords += 1
    worst = Math.min(worst, result.confidence)
    parts.push(result.value[0].toUpperCase() + result.value.slice(1))
    latinCore.push(token)
  }

  if (!parts.length) {
    // Ни одного слова не осталось — всё оказалось служебным («Universal
    // Studios Japan»). Пустое имя вернуть нельзя: канон отвергнет запись,
    // и точка потеряется совсем. Отдаём исходное английское название —
    // ровно так владелец и поступает сам, в базе стоят «Makuhari Messe»
    // и «Музей Nintendo».
    return {
      nameRu: source,
      confidence: 0,
      headClass,
      keptLatin: [source],
      warnings: [...warnings, 'Ни одного японского слова — оставлено английское название целиком'],
    }
  }

  // Заимствование остаётся английским ЦЕЛИКОМ, а не наполовину.
  //
  // Пока правило работало по словам, «Tokyo Skytree» превращалось
  // в «Токио Skytree» —半 транслитерация,半 латиница, и читается это хуже
  // обоих вариантов по отдельности. В базе такого нет: владелец либо
  // транслитерирует всё («Роппонги Хиллз», «Токио Доум Сити»), либо
  // оставляет ядро английским целиком, переводя только родовое слово —
  // «Смотровая Shibuya Sky», «Музей Nintendo», «Makuhari Messe».
  //
  // Признак заимствования — хотя бы одно слово, не читающееся как ромадзи.
  // Тогда ядром становится исходная фраза без родового слова: русское
  // родовое слово впереди остаётся, потому что оно про тип объекта,
  // а не про имя.
  const borrowed = keptLatin.length > 0
  const core = borrowed ? latinCore.join(' ') : parts.join(' ')
  const nameRu = headClass && HEAD_RU[headClass] ? `${HEAD_RU[headClass]} ${core}` : core

  if (borrowed) {
    warnings.push(
      `Ядро оставлено английским: ${keptLatin.join(', ')} не читается как ромадзи — похоже на заимствование`,
    )
  }
  if (brands.length) {
    warnings.push(`Бренд оставлен латиницей: ${brands.join(', ')}`)
  }
  if (!japaneseWords && !brands.length) {
    warnings.push('Ни одно слово не разобрано как японское — имя целиком заимствованное')
  }
  if (!headClass) warnings.push('Родовое слово не распознано — имя собрано без него')

  return {
    nameRu,
    // Бренд — опознанное слово, а не провал разбора: имя из одного
    // бренда и родового слова («Nintendo Museum») готово к записи.
    confidence: japaneseWords || brands.length ? worst : 0,
    headClass,
    keptLatin,
    warnings,
  }
}

// ── Кана → кириллица ────────────────────────────────────────────────────
//
// Кана в базу НЕ ПОПАДАЕТ. Это промежуточное чтение: японские открытые
// данные дают название иероглифами и его чтение каной, а иероглифы читать
// нечем — чтения топонимов нерегулярны (生国魂 это «Икукунитама», и вывести
// это из знаков невозможно). Кана снимает вопрос полностью: она и есть
// звучание, а Поливанов — таблица звучание→кириллица.
//
// Путь через кану НАДЁЖНЕЕ пути через английский. Английское название —
// это перевод, и в нём теряется звучание («Golden Pavilion» вместо
// «Кинкакудзи»), появляются заимствования и спор «Тосиба или Тошиба».
// Кана не переводит, а записывает то, как место называют вслух.

/** Слоги каны, от длинных к коротким: сочетания раньше одиночных. */
const KANA: Array<[string, string]> = [
  ['キャ','кя'],['キュ','кю'],['キョ','кё'],['ギャ','гя'],['ギュ','гю'],['ギョ','гё'],
  ['シャ','ся'],['シュ','сю'],['ショ','сё'],['シェ','сэ'],
  ['ジャ','дзя'],['ジュ','дзю'],['ジョ','дзё'],['ジェ','дзэ'],
  ['チャ','тя'],['チュ','тю'],['チョ','тё'],['チェ','тэ'],
  ['ヂャ','дзя'],['ヂュ','дзю'],['ヂョ','дзё'],
  ['ニャ','ня'],['ニュ','ню'],['ニョ','нё'],
  ['ヒャ','хя'],['ヒュ','хю'],['ヒョ','хё'],
  ['ビャ','бя'],['ビュ','бю'],['ビョ','бё'],
  ['ピャ','пя'],['ピュ','пю'],['ピョ','пё'],
  ['ミャ','мя'],['ミュ','мю'],['ミョ','мё'],
  ['リャ','ря'],['リュ','рю'],['リョ','рё'],
  ['ファ','фа'],['フィ','фи'],['フェ','фэ'],['フォ','фо'],
  ['ティ','ти'],['ディ','ди'],['トゥ','ту'],['ドゥ','ду'],
  ['ウィ','ви'],['ウェ','вэ'],['ウォ','во'],
  ['ツァ','ца'],['ツィ','ци'],['ツェ','цэ'],['ツォ','цо'],
  ['ア','а'],['イ','и'],['ウ','у'],['エ','э'],['オ','о'],
  ['カ','ка'],['キ','ки'],['ク','ку'],['ケ','кэ'],['コ','ко'],
  ['ガ','га'],['ギ','ги'],['グ','гу'],['ゲ','гэ'],['ゴ','го'],
  ['サ','са'],['シ','си'],['ス','су'],['セ','сэ'],['ソ','со'],
  // ざ-ряд — дза/дзи/дзу/дзэ/дзо, а не за/зи/зу.
  ['ザ','дза'],['ジ','дзи'],['ズ','дзу'],['ゼ','дзэ'],['ゾ','дзо'],
  ['タ','та'],['チ','ти'],['ツ','цу'],['テ','тэ'],['ト','то'],
  ['ダ','да'],['ヂ','дзи'],['ヅ','дзу'],['デ','дэ'],['ド','до'],
  ['ナ','на'],['ニ','ни'],['ヌ','ну'],['ネ','нэ'],['ノ','но'],
  ['ハ','ха'],['ヒ','хи'],['フ','фу'],['ヘ','хэ'],['ホ','хо'],
  ['バ','ба'],['ビ','би'],['ブ','бу'],['ベ','бэ'],['ボ','бо'],
  ['パ','па'],['ピ','пи'],['プ','пу'],['ペ','пэ'],['ポ','по'],
  ['マ','ма'],['ミ','ми'],['ム','му'],['メ','мэ'],['モ','мо'],
  ['ヤ','я'],['ユ','ю'],['ヨ','ё'],
  ['ラ','ра'],['リ','ри'],['ル','ру'],['レ','рэ'],['ロ','ро'],
  ['ワ','ва'],['ヲ','о'],['ヴ','ву'],['ン','н'],
]

/** Хирагана приводится к катакане: таблица одна на обе азбуки. */
function toKatakana(value: string): string {
  return value.replace(/[ぁ-ゖ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60),
  )
}

/**
 * Читает кану в кириллицу по Поливанову.
 *
 * Возвращает пустую строку, если на входе не кана: это не ошибка, а
 * сигнал вызывающему, что чтения нет и имя придётся брать иначе.
 */
export function kanaToCyrillic(input: string | null | undefined): TranslitResult {
  const raw = toKatakana(String(input ?? '').trim())
    // Скобочное пояснение — второе чтение того же места.
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s・･、,]/g, '')
  if (!raw) return { value: '', confidence: 0, leftovers: '' }

  let out = ''
  let leftovers = ''
  let i = 0
  let matched = 0

  while (i < raw.length) {
    const ch = raw[i]

    // ー — знак долготы. Поливанов долготу не обозначает, поэтому знак
    // просто исчезает: トーキョー и トウキョウ дают одно и то же.
    if (ch === 'ー' || ch === '－' || ch === '-') { i += 1; matched += 1; continue }

    // っ/ッ — удвоение согласной следующего слога.
    if (ch === 'ッ' || ch === 'っ') {
      const rest = raw.slice(i + 1)
      const next = KANA.find(([k]) => rest.startsWith(k))
      if (next) out += next[1][0]
      i += 1
      matched += 1
      continue
    }

    const hit = KANA.find(([k]) => raw.startsWith(k, i))
    if (!hit) { leftovers += ch; i += 1; continue }

    const [kana] = hit
    let cyr = hit[1]
    // ん перед йотированной — твёрдый знак: ホンヤ → хонъя, а не хоня.
    if (kana === 'ン' && /^[ヤユヨ]/.test(raw.slice(i + 1))) cyr = 'нъ'
    out += cyr
    i += kana.length
    matched += kana.length

    // Долгая гласная, записанная второй гласной: オウ/オオ → о, ウウ → у.
    //
    // Смотреть надо на ЗВУК, а не на букву. «ジョ» это «дзё», и последняя
    // буква — «ё», хотя гласный тут о-образный; «キュ» это «кю» с у-образным.
    // Первая версия сравнивала с «о» и «у» буквально, поэтому 縁城寺
    // (エンジョウジ) давало «Эндзёудзи» вместо «Эндзёдзи», а 久僧
    // (キュウソ) — «Кюусо» вместо «Кюсо».
    const tail = cyr[cyr.length - 1]
    const follow = raw[i]
    const oSound = tail === 'о' || tail === 'ё'
    const uSound = tail === 'у' || tail === 'ю'
    if ((oSound && (follow === 'ウ' || follow === 'オ')) || (uSound && follow === 'ウ')) {
      i += 1
      matched += 1
    }
  }

  // Тот же дифтонг, что и в ромадзи, и по тем же измеренным основаниям:
  // «и» после «а» и «э» становится «й», после «о» — нет.
  out = out.replace(/([аэ])и/g, '$1й')

  return { value: out, confidence: raw.length ? Number((matched / raw.length).toFixed(3)) : 0, leftovers }
}

/**
 * Родовое слово определяется по ИЕРОГЛИФАМ, а не по чтению.
 *
 * Иероглиф однозначен: 寺 это храм всегда. Чтение — нет: «дзи» в конце
 * может оказаться и храмом (東大寺), и частью обычного слова (平地).
 * Классифицировать по кане значило бы гадать там, где рядом лежит точный
 * ответ.
 *
 * Третье поле — что делать с родовым словом В ЧТЕНИИ. Проверено по живой
 * базе: 神社 снимается («Святилище Ицукусима», не «Ицукусима Дзиндзя»),
 * а 寺 и 宮 остаются («Храм Тодайдзи», «Цуругаока Хатимангу»). Правило
 * не выведено из логики, а списано с того, как владелец уже пишет.
 *
 * Порядок важен: длинные раньше коротких, иначе 城跡 разберётся как 城.
 */
const KANJI_TAIL: Array<[string, string, string | null]> = [
  ['海水浴場', 'beach', 'カイスイヨクジョウ'],
  ['博物館', 'museum', 'ハクブツカン'],
  ['美術館', 'art-museum', 'ビジュツカン'],
  ['資料館', 'museum', 'シリョウカン'],
  ['動物園', 'zoo', 'ドウブツエン'],
  ['水族館', 'aquarium', 'スイゾクカン'],
  ['商店街', 'street', 'ショウテンガイ'],
  ['展望台', 'lookout', 'テンボウダイ'],
  ['城跡', 'castle-ruins', 'ジョウシ'],
  ['城址', 'castle-ruins', 'ジョウシ'],
  ['城趾', 'castle-ruins', 'ジョウシ'],
  ['城', 'castle', 'ジョウ'],
  ['神社', 'shrine', 'ジンジャ'],
  ['大社', 'shrine', 'タイシャ'],
  ['公園', 'park', 'コウエン'],
  ['緑地', 'park', 'リョクチ'],
  ['温泉', 'onsen', 'オンセン'],
  ['市場', 'market', 'イチバ'],
  ['渓谷', 'gorge', 'ケイコク'],
  ['ダム', 'dam', 'ダム'],
  ['岬', 'cape', 'ミサキ'],
  ['古墳', 'kofun', 'コフン'],
  ['庭園', 'garden', 'テイエン'],
  ['遺跡', 'ruins', 'イセキ'],
  ['天守閣', 'castle', 'テンシュカク'],
  ['駅', 'station', 'エキ'],
  ['塔', 'tower', 'トウ'],
  ['門', 'gate', 'モン'],
  ['池', 'pond', 'イケ'],
  ['谷', 'valley', 'タニ'],
  ['川', 'river', 'カワ'],
  ['峠', 'pass', 'トウゲ'],
  ['滝', 'waterfall', 'タキ'],
  ['湖', 'lake', 'コ'],
  ['橋', 'bridge', 'ハシ'],
  // Читается «сан» или «яма» — снимаем только «сан»: «Гора Такао»,
  // но «Арасияма» осталась целиком, потому что это название местности.
  ['山', 'mountain', 'サン'],
  ['岳', 'mountain', 'ダケ'],
  // Родовое слово ставится впереди, но из имени НЕ уходит:
  // «Храм Тодайдзи», а не «Храм Тодай».
  ['寺', 'temple', null],
  ['院', 'temple', null],
  ['宮', 'shrine', null],
  ['島', 'island', null],
]

/**
 * Собирает русское имя из иероглифического названия и его чтения каной.
 *
 * Иероглифы нужны только для отчёта — читается кана. Родовое слово
 * снимается с чтения и заменяется русским, остаток транслитерируется.
 */
export function poiNameFromKana(
  nameJa: string | null | undefined,
  kana: string | null | undefined,
): PoiNameResult {
  const warnings: string[] = []
  const reading = toKatakana(String(kana ?? '').trim()).replace(/[（(][^）)]*[）)]/g, '').trim()
  if (!reading) {
    return { nameRu: '', confidence: 0, headClass: null, keptLatin: [], warnings: ['Чтения каной нет'] }
  }

  const kanji = String(nameJa ?? '').replace(/[（(][^）)]*[）)]/g, '').trim()
  let headClass: string | null = null
  let core = reading
  for (const [suffix, cls, kanaTail] of KANJI_TAIL) {
    if (!kanji.endsWith(suffix)) continue
    headClass = cls
    // Снимаем чтение родового слова, только если оно там действительно
    // есть: 山 читается и «сан», и «яма», и во втором случае остаётся.
    if (kanaTail && core.endsWith(kanaTail) && core.length > kanaTail.length + 1) {
      core = core.slice(0, -kanaTail.length)
    }
    break
  }

  const result = kanaToCyrillic(core)
  if (!result.value) {
    return { nameRu: '', confidence: 0, headClass, keptLatin: [], warnings: ['Чтение не разобралось'] }
  }
  if (result.leftovers) {
    warnings.push(`В чтении остались неразобранные знаки: «${result.leftovers}»`)
  }

  const capitalized = result.value[0].toUpperCase() + result.value.slice(1)
  const head = headClass ? HEAD_RU[headClass] : null
  const nameRu = head ? `${head} ${capitalized}` : capitalized
  if (!headClass) warnings.push('Родовое слово в чтении не распознано — имя собрано без него')
  // Кана не размечает границы слов, поэтому длинное название сливается
  // в одно нечитаемое слово: «Юхигаураонсэнкасёэнханарэфука». Само по
  // себе это не ошибка транслитерации — это признак, что объект вообще
  // не POI, а гостиница или заведение с рекламным названием.
  // Порог применяется к ЯДРУ и не зависит от того, нашлось ли родовое
  // слово. Первая версия проверяла только безымянные случаи, и мимо неё
  // прошли «Парк Кётофурицуямасиросогоундокоэнтайёгаока» и «Музей
  // Кётосирицугэйдзюцудайгакугэйдзюцу»: родовое слово там есть, а ядро
  // всё равно нечитаемо. Кана не размечает границы слов, и длинное
  // официальное название сливается в одно.
  if (capitalized.length > 18) {
    warnings.push(
      `Ядро имени — ${capitalized.length} букв слитно: кана не размечает границы слов, имя нужно разбить вручную`,
    )
  }

  return { nameRu, confidence: result.confidence, headClass, keptLatin: [], warnings }
}
