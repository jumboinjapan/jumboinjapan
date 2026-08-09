/**
 * Сопоставление названий POI: дубли и родительские объекты.
 *
 * ЕДИНСТВЕННЫЙ источник правды для всех путей добавления POI:
 *   src/lib/poi-intake.ts            — агент приёма из Telegram
 *   scripts/poi-portals/*.mjs        — пакетный сбор с внешних источников
 *   админка                          — ручное заведение
 *
 * Ни один из них не должен иметь собственной реализации сравнения имён.
 * Скрипты на .mjs импортируют этот файл напрямую с расширением `.ts` —
 * так же, как scripts/import-japantravel-events.mjs импортирует
 * src/lib/japantravel-events.ts (Node ≥22 снимает типы сам).
 *
 * ──────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЭТО НЕ ПРОСТОЕ СРАВНЕНИЕ СТРОК
 *
 * Проверено на живой базе (431 запись, август 2026). Наивное двустороннее
 * вхождение подстроки, которое стояло здесь раньше, давало 142 пары
 * кандидатов — больше половины мусор, и при этом пропускало настоящие дубли.
 * Разбор ошибок дал четыре независимых правила, каждое из которых
 * закрывает свой класс:
 *
 *  1. РОДОВОЕ СЛОВО ОТДЕЛЬНО ОТ ЯДРА.
 *     «Художественный музей Пола» ⟷ «Художественный музей Хаконе» — одно
 *     родовое слово, разные объекты. «Канатная дорога Хаконе» ⟷
 *     «Ботанический сад Хаконе» — одно ядро, разные объекты.
 *     Дубль требует совпадения И ТОГО, И ДРУГОГО (берётся минимум).
 *
 *  2. МЕЖАЛФАВИТНОЕ СРАВНЕНИЕ ЧЕРЕЗ РОМАДЗИ.
 *     «Храм Токэйдзи» и «Tōkei-ji Temple» не имеют общих символов.
 *     В базе русское имя заполнено у 100% записей, английское — у 91%,
 *     а внешние источники дают только латиницу и японский.
 *
 *  3. СКЕЛЕТ ТОЛЬКО МЕЖДУ АЛФАВИТАМИ.
 *     Внутри одного языка скелет вреден: сняв родовые слова, он оставляет
 *     от «Канатная дорога Хаконе» просто «hakone».
 *
 *  4. ВХОЖДЕНИЕ — ТОЛЬКО ПО ГРАНИЦЕ СЛОВА.
 *     «engakuji» является подстрокой «sengakuji» (разница в букве «s»),
 *     и без этого условия Энгакудзи в Камакуре сливался с Сэнгакудзи
 *     в Токио.
 *
 * Итог на живой базе: 142 → 17 кандидатов, все четыре настоящих дубля
 * найдены, контрольная пара «Храм Риннодзи (Сэндай)» / «Храм Риннодзи»
 * корректно НЕ признана дублем.
 * ──────────────────────────────────────────────────────────────────────
 */

// ── Нормализация ────────────────────────────────────────────────────────

export function normalizeName(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    // «э» → «е»: в русской записи японских слов это самое частое расхождение
    // у одного и того же места. В живой базе есть пара «Руины замка Сендай»
    // и «Руины замка Сэндай» — один объект, заведённый дважды, и без этой
    // замены их ядра расходятся настолько, что дубль не находится.
    .replace(/э/g, 'е')
    // Скобочное пояснение СОХРАНЯЕТСЯ: владелец использует его как
    // различитель — «Храм Риннодзи (Сэндай)» заведён отдельно от
    // никкоского «Храм Риннодзи». Выбрасывая скобки, мы уничтожили бы
    // единственный признак, который их разводит.
    .replace(/[（(）)«»"']/g, ' ')
    .replace(/[・･]/g, ' ')
    .replace(/\b(?:the|a)\s+/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Родовые слова в начале русского названия и в конце английского. */
const GENERIC_HEAD = new RegExp(
  '^(?:' +
    [
      'художественный музей', 'национальный музей', 'ботанический сад',
      'мемориальный парк', 'канатная дорога', 'смотровая площадка',
      'горная железная дорога', 'горячие источники', 'горячий источник',
      'руины замка', 'парк развлечений', 'исторический музей',
      'музей современного искусства',
      'храм', 'святилище', 'музей', 'сад', 'парк', 'замок', 'мост', 'озеро',
      'гора', 'водопад', 'квартал', 'улица', 'рынок', 'башня', 'станция',
      'остров', 'долина', 'ущелье', 'пруд', 'ворота', 'дворец', 'усадьба',
      'галерея', 'аквариум', 'зоопарк', 'смотровая', 'онсэн', 'пляж', 'пляжи',
      'temple', 'shrine', 'museum', 'garden', 'park', 'castle', 'bridge',
      'lake', 'mount', 'mt', 'falls', 'station', 'tower', 'street', 'market',
    ].join('|') +
    ')\\s+',
)

/**
 * Родовое слово В КОНЦЕ — английский порядок: «Todai-ji Temple»,
 * «Hakone Ropeway», «Nijo Castle».
 *
 * Без этого правило №1 (родовое слово отдельно от ядра) для английских
 * названий просто НЕ РАБОТАЛО: GENERIC_HEAD привязан к началу строки,
 * а в английском родовое слово стоит в конце, поэтому head оставался
 * пустым и сравнивались целые строки вместе с родовым словом. Замер на
 * настоящих парах показал, что ошибка идёт в обе стороны сразу:
 *
 *   «Todai-ji Temple»   ⟷ «Todaiji»            0,50  — один храм, пропуск
 *   «Sengaku-ji Temple» ⟷ «Engaku-ji Temple»   0,86  — разные, почти блок
 *
 * Общее слово «temple» тянуло вверх непохожие названия и ничего не давало
 * похожим. Для коллектора это критично: внешние источники дают латиницу
 * и японский, то есть именно ту пару, где сравнение было слабее всего.
 */
const GENERIC_TAIL = new RegExp(
  '\\s+(?:' +
    ['temple', 'temples', 'shrine', 'shrines', 'museum', 'garden', 'gardens',
     'park', 'castle', 'bridge', 'station', 'tower', 'market', 'onsen',
     'ropeway', 'observatory', 'hall', 'ruins', 'falls', 'waterfall',
     'taisha', 'jinja', 'jingu', 'dera', 'district', 'street', 'avenue',
     'hot spring', 'hot springs', 'art museum', 'memorial park',
     'observation deck', 'national park'].join('|') +
    ')$',
)

/**
 * Класс родового слова. Сравнивать родовые слова СТРОКАМИ нельзя: одно и
 * то же понятие приходит на трёх языках сразу.
 *
 *   «Fushimi Inari Taisha» ⟷ «Fushimi Inari Shrine»   taisha = shrine
 *   «Meiji Jingu»          ⟷ «Meiji Shrine»           jingu  = shrine
 *   «Храм Хасэдэра»        ⟷ «Hase-dera Temple»       храм   = dera = temple
 *
 * Первая версия правила «голова должна совпасть» сравнивала эти пары
 * посимвольно и давала ровный ноль — то есть на настоящих дублях
 * срабатывала ХУЖЕ, чем полное отсутствие правила. Поэтому сравниваются
 * не слова, а классы: «святилище» — это одна сущность, как бы её ни
 * записали, и она не равна «храму», хотя оба слова про культовое здание.
 */
/**
 * В один класс попадают только ПЕРЕВОДЫ И ТОЧНЫЕ СИНОНИМЫ, но не слова
 * из одной области. Проверено на живой базе: первая версия объединила
 * «канатную дорогу» и «горную железную дорогу» как «примерно одно и то же»,
 * и Hakone Ropeway (POI-000047) немедленно заблокировал Hakone Tozan
 * Railway (POI-000048) — два разных вида транспорта в одном городе, оба
 * с ядром «хаконе». По той же причине разведены сад и парк, озеро и пруд,
 * зоопарк и аквариум, долина и ущелье.
 */
const GENERIC_CLASS = new Map<string, string>(
  Object.entries({
    shrine: 'святилище|shrine|shrines|taisha|jinja|jingu',
    temple: 'храм|храмовый|temple|temples|dera|ji',
    museum:
      'музей|художественный музей|национальный музей|исторический музей|музей современного искусства|museum|art museum',
    garden: 'сад|ботанический сад|ландшафтный сад|garden|gardens',
    park: 'парк|мемориальный парк|park|national park|memorial park',
    castle: 'замок|руины замка|castle',
    onsen: 'онсэн|горячие источники|горячий источник|onsen|hot spring|hot springs',
    ropeway: 'канатная дорога|ropeway|cable car',
    railway: 'горная железная дорога|railway',
    lookout: 'смотровая|смотровая площадка|observation deck|observatory',
    mountain: 'гора|mount|mt',
    lake: 'озеро|lake',
    pond: 'пруд|pond',
    waterfall: 'водопад|falls|waterfall',
    bridge: 'мост|bridge',
    station: 'станция|station',
    tower: 'башня|tower',
    market: 'рынок|market',
    street: 'улица|street|avenue',
    district: 'квартал|городской район|район|district',
    gallery: 'галерея|gallery',
    hall: 'зал|hall',
    ruins: 'руины|развалины|ruins',
    palace: 'дворец|palace',
    island: 'остров|island',
    valley: 'долина|valley',
    gorge: 'ущелье|gorge',
    gate: 'ворота|gate',
    zoo: 'зоопарк|zoo',
    aquarium: 'аквариум|aquarium',
    beach: 'пляж|пляжи|beach',
    amusement: 'парк развлечений|amusement park',
  }).flatMap(([cls, words]) => words.split('|').map((word) => [word, cls] as [string, string])),
)

export interface SplitName {
  head: string
  core: string
  full: string
}

export function splitName(value: string | null | undefined): SplitName {
  const normalized = normalizeName(value)
  if (!normalized) return { head: '', core: '', full: '' }

  const head = normalized.match(GENERIC_HEAD)
  if (head) {
    const core = normalized.slice(head[0].length).trim()
    // Название целиком состоит из родового слова («Синдзюку») — оно и есть ядро.
    if (core.length >= 3) return { head: head[0].trim(), core, full: normalized }
    return { head: '', core: normalized, full: normalized }
  }

  const tail = normalized.match(GENERIC_TAIL)
  if (tail) {
    const core = normalized.slice(0, normalized.length - tail[0].length).trim()
    if (core.length >= 3) return { head: tail[0].trim(), core, full: normalized }
  }

  return { head: '', core: normalized, full: normalized }
}

export function nameCore(value: string | null | undefined): string {
  return splitName(value).core
}

// ── Ромадзи: мост между алфавитами ──────────────────────────────────────

export function stripDiacritics(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ōŌ]/g, 'o')
    .replace(/[ūŪ]/g, 'u')
    .replace(/[āĀ]/g, 'a')
    .replace(/[īĪ]/g, 'i')
    .replace(/[ēĒ]/g, 'e')
}

const EN_GENERIC = new RegExp(
  '\\b(?:' +
    ['temple', 'shrine', 'museum', 'castle', 'park', 'garden', 'gardens',
     'station', 'tower', 'bridge', 'street', 'market', 'onsen', 'ropeway',
     'observation', 'deck', 'observatory', 'art', 'memorial', 'hall',
     'ruins', 'site', 'the', 'of', 'mt', 'mount', 'lake', 'river', 'falls',
     'waterfall', 'hot', 'spring', 'springs', 'cable', 'car',
     // Ведомственные определения. Без них «National Museum» даёт скелет
     // «national», который является приставкой «nationalwestern» (из
     // «National Museum of Western Art») — и два разных музея сливались
     // с весом 0,9. В базе такие обеднённые английские названия есть:
     // у POI-000254 «Национальный музей Нара» английское имя записано
     // просто как «National Museum».
     'national', 'metropolitan', 'prefectural', 'municipal', 'city', 'town',
     'village', 'central', 'main', 'former', 'great', 'grand', 'old', 'new'].join('|') +
    ')\\b', 'g',
)

/**
 * Русские родовые слова — набор токенов, НЕ регулярка с `\b`.
 *
 * В JavaScript `\b` определён по ASCII, поэтому `/\bхрам\b/` не совпадает
 * с русским словом. Первая версия этого кода была написана с `\b` и молча
 * не снимала ни одного русского слова: «Храм Токэйдзи» превращалось
 * в «hramtokeiji» и не сходилось с «tokeiji».
 *
 * Тот же дефект живёт в src/lib/japantravel-event-intake.ts — все
 * контентные фильтры там построены на `\b` и на не-английском тексте
 * молча не срабатывают.
 */
const RU_GENERIC = new Set([
  'художественный', 'ботанический', 'национальный', 'мемориальный',
  'императорский', 'исторический', 'современного', 'современный', 'искусства',
  'храм', 'храмовый', 'святилище', 'музей', 'сад', 'парк', 'замок', 'мост',
  'озеро', 'гора', 'водопад', 'квартал', 'улица', 'рынок', 'башня', 'станция',
  'остров', 'долина', 'ущелье', 'пруд', 'ворота', 'дворец', 'галерея',
  'аквариум', 'зоопарк', 'смотровая', 'площадка', 'канатная', 'дорога',
  'горячие', 'горячий', 'источники', 'источник', 'руины', 'развалины',
  'пляж', 'пляжи', 'тропы', 'тропа', 'большой', 'великий', 'священный',
  'пятая', 'центр', 'всемирного', 'наследия', 'комплекс', 'район', 'онсэн',
  'в', 'на', 'и', 'по',
])

/**
 * Обратная транслитерация Поливанова. Порядок ключей критичен —
 * многобуквенные сочетания разбираются раньше односимвольных, иначе
 * «дзи» распадётся на «д» + «з» + «и».
 */
const POLIVANOV: Array<[string, string]> = [
  ['дзю', 'ju'], ['дзя', 'ja'], ['дзё', 'jo'], ['дзе', 'je'], ['дзи', 'ji'],
  ['дза', 'za'], ['дзу', 'zu'], ['дзо', 'zo'], ['дз', 'dz'],
  ['тя', 'cha'], ['тю', 'chu'], ['тё', 'cho'], ['ти', 'chi'],
  ['ся', 'sha'], ['сю', 'shu'], ['сё', 'sho'], ['си', 'shi'],
  ['дя', 'ja'], ['дю', 'ju'], ['дё', 'jo'], ['джи', 'ji'], ['дж', 'j'],
  ['ця', 'tsa'], ['цу', 'tsu'], ['ц', 'ts'],
  ['ня', 'nya'], ['ню', 'nyu'], ['нё', 'nyo'],
  ['мя', 'mya'], ['мю', 'myu'], ['мё', 'myo'],
  ['ря', 'rya'], ['рю', 'ryu'], ['рё', 'ryo'],
  ['кя', 'kya'], ['кю', 'kyu'], ['кё', 'kyo'],
  ['гя', 'gya'], ['гю', 'gyu'], ['гё', 'gyo'],
  ['хя', 'hya'], ['хю', 'hyu'], ['хё', 'hyo'],
  ['бя', 'bya'], ['бю', 'byu'], ['бё', 'byo'],
  ['пя', 'pya'], ['пю', 'pyu'], ['пё', 'pyo'],
  ['ё', 'yo'], ['ю', 'yu'], ['я', 'ya'],
  // «е» обязана быть в таблице: без неё «Хаконе» давало «hakon» и не
  // сходилось с «Hakone Ropeway». Буква проходила насквозь как
  // кириллическая и вырезалась фильтром уже после транслитерации —
  // то есть отказ был бесшумным.
  ['е', 'e'],
  ['а', 'a'], ['и', 'i'], ['у', 'u'], ['э', 'e'], ['о', 'o'],
  ['к', 'k'], ['г', 'g'], ['с', 's'], ['з', 'z'], ['т', 't'], ['д', 'd'],
  ['н', 'n'], ['х', 'h'], ['ф', 'f'], ['б', 'b'], ['п', 'p'],
  ['м', 'm'], ['р', 'r'], ['в', 'v'], ['л', 'l'], ['ж', 'j'], ['ш', 'sh'],
  ['щ', 'sh'], ['ч', 'ch'], ['й', 'i'], ['ы', 'i'], ['ь', ''], ['ъ', ''],
]

export function cyrillicToRomaji(value: string | null | undefined): string {
  // Латинские части названия СОХРАНЯЮТСЯ. Прежний разбор выкидывал их
  // вместе с пунктуацией, и «teamLab Planets (Тоёсу)» сжималось до одного
  // слова «toyosu» — голого топонима, который совпадал с «Toyosu Fish
  // Market». Два совершенно разных объекта признавались дублями.
  const cleaned = String(value ?? '')
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/)
    .filter((token) => token && !RU_GENERIC.has(token))
    .join(' ')

  let out = ''
  let i = 0
  while (i < cleaned.length) {
    let matched = false
    for (const [ru, la] of POLIVANOV) {
      if (cleaned.startsWith(ru, i)) {
        out += la
        i += ru.length
        matched = true
        break
      }
    }
    if (!matched) {
      out += cleaned[i]
      i += 1
    }
  }
  return out
}

/**
 * «Скелет ромадзи» — общее представление для любого из трёх языков.
 *   «Храм Токэйдзи»   → tokeiji
 *   «Tokeiji Temple»  → tokeiji
 *   «Tōkei-ji Temple» → tokeiji
 */
export function romajiSkeleton(value: string | null | undefined): string {
  if (!value) return ''
  const raw = String(value)
  const hasCyrillic = /[Ѐ-ӿ]/.test(raw)
  let s = hasCyrillic ? cyrillicToRomaji(raw) : stripDiacritics(raw).toLowerCase()
  if (!hasCyrillic) s = s.replace(EN_GENERIC, ' ')
  return s
    .replace(/[^a-z0-9]+/g, '')
    // Долгота гласной в ромадзи записывается по-разному (oo / ou / ō / o).
    .replace(/([aeiou])\1+/g, '$1')
    .trim()
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `
  const out = new Set<string>()
  for (let i = 0; i < padded.length - 2; i += 1) out.add(padded.slice(i, i + 3))
  return out
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const ta = trigrams(a)
  const tb = trigrams(b)
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared += 1
  return (2 * shared) / (ta.size + tb.size)
}

/**
 * @param cityTokens скелеты названий городов обеих записей. Нужны, чтобы
 *   вхождение не срабатывало на голом топониме: «Sendai Castle Ruins» даёт
 *   скелет «sendai», и он является окончанием «rinnojisendai» (из «Храм
 *   Риннодзи (Сэндай)»). Без этой поправки руины замка Сэндай признавались
 *   дублем сэндайского храма Риннодзи с весом 0,9 — совпало только имя
 *   города, а оно есть у половины записей в любом городе.
 */
export function skeletonMatch(
  a: string | null | undefined,
  b: string | null | undefined,
  cityTokens: string[] = [],
): number {
  const sa = romajiSkeleton(a)
  const sb = romajiSkeleton(b)
  if (!sa || !sb || sa.length < 4 || sb.length < 4) return 0
  // Совпадение скелетов, сводящееся к имени города, — не свидетельство.
  // «Канатная дорога Хаконе» и «Ботанический сад Хаконе» после снятия
  // родовых слов обе дают «hakone».
  if (sa === sb) return cityTokens.includes(sa) ? 0 : 1

  const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa]
  if (long.includes(short) && !cityTokens.includes(short)) {
    const extra = long.length - short.length
    // Вхождение засчитывается ТОЛЬКО как приставка или окончание и только
    // если лишняя часть — самостоятельное слово, а не пара букв.
    // Без этого «engakuji» ⊂ «sengakuji» давало 0,9 и сливало два разных
    // храма. Порог длины 5 (не 6) нужен для «Святилище Мэйдзи» → «meiji»
    // против «Meiji Jingū» → «meijijingu»: японское родовое слово
    // в английском остаётся в ромадзи, а в русском переводится.
    // 0.85 — НАМЕРЕННО ниже порога блокировки (DUPLICATE_BLOCK = 0.9).
    //
    // Вхождение одного названия в другое принципиально двусмысленно: это
    // либо дубль («Хасэдэра» внутри «Храм Хасэ Каннон (Хасэдэра)»), либо
    // отношение часть-целое («Тоёсу» внутри «Рыбный рынок Тоёсу»). Отличить
    // их по строкам нельзя, поэтому такие пары идут человеку на проверку,
    // а не блокируются автоматически. Блокирует только точное совпадение.
    const atBoundary = long.startsWith(short) || long.endsWith(short)
    if (atBoundary && short.length >= 5 && extra >= 3) return 0.85
    return 0.5
  }

  // Нечёткое сходство скелетов — самый слабый из трёх сигналов, и его
  // приходится придерживать. «Тодайдзи» и «Тосёдайдзи» (два разных храма
  // Нары) дают по триграммам 0,74 — чуть выше порога 0,72. Коэффициент
  // 0,85 опускает такие пары ниже порога, не задевая настоящие совпадения:
  // те приходят либо точным равенством скелетов, либо вхождением по границе.
  const ga = trigrams(short)
  const gb = trigrams(long)
  let shared = 0
  for (const g of ga) if (gb.has(g)) shared += 1
  const fuzzy = (2 * shared) / (ga.size + gb.size)
  return Number((fuzzy * 0.85).toFixed(4))
}

/**
 * Сходство родовых слов. Одна сторона без родового слова — не улика
 * против: «Todaiji» без слова «Temple» это тот же храм.
 */
function headSimilarity(a: string, b: string): number {
  if (!a || !b) return 1
  if (a === b) return 1
  const ca = GENERIC_CLASS.get(a)
  const cb = GENERIC_CLASS.get(b)
  // Оба слова известны: решает класс, а не написание. Разные классы —
  // это разные объекты («канатная дорога» против «ботанического сада»),
  // и здесь ноль стоит по делу.
  if (ca && cb) return ca === cb ? 1 : 0
  // Хотя бы одно слово вне справочника — падаем на посимвольное сравнение,
  // а не на ноль: неизвестное слово не должно отменять совпадение ядер.
  return Math.max(dice(a, b), 0.5)
}

/** Сходство двух названий: 0..1. */
export function nameSimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
  cityTokens: string[] = [],
): number {
  const sa = splitName(a)
  const sb = splitName(b)
  if (!sa.full || !sb.full) return 0
  if (sa.full === sb.full) return 1

  const scriptA = /[Ѐ-ӿ]/.test(sa.full) ? 'cyr' : 'lat'
  const scriptB = /[Ѐ-ӿ]/.test(sb.full) ? 'cyr' : 'lat'

  // Между алфавитами посимвольные меры бесполезны — только скелет.
  //
  // Результат ограничен сверху 0.85, то есть НИКОГДА не блокирует сам по
  // себе. Межалфавитное сравнение — цепочка допущений: транслитерация по
  // Поливанову, снятие родовых слов, схлопывание долгих гласных. На выходе
  // от названия остаётся ядро, и если это ядро — топоним, разные объекты
  // одного места сливаются. Замерено на живой базе:
  //   «Гора Асахидакэ» ⟷ «Asahidake Onsen Village»   обе → asahidake
  //   «Toyosu Market»  ⟷ «Тоёсу (район)»             обе → toyosu
  // Ни одна пара не дубль. Поэтому межалфавитное совпадение всегда
  // показывается владельцу, но решение остаётся за ним; блокирует только
  // согласие в пределах одного алфавита.
  if (scriptA !== scriptB) return Math.min(skeletonMatch(a, b, cityTokens), 0.85)

  // ВНУТРИ ОДНОГО АЛФАВИТА СКЕЛЕТ НЕ ПРИМЕНЯЕТСЯ.
  //
  // Соблазн его включить велик, и я его проверил на живой базе: снимая
  // родовые слова, скелет оставляет от названия голый топоним, и все
  // объекты вокруг одного места схлопываются в одну строку. Прогон дал
  // 17 ложных блокировок на 431 записи, среди них:
  //   «Рыбный рынок Тоёсу» ⟷ «Тоёсу (район)»          обе → toyosu
  //   «Храм Тюдзэндзи»     ⟷ «Озеро Тюдзэндзи»        обе → chuzenji
  //   «Онсэн Асахидакэ»    ⟷ «Гора Асахидакэ»         обе → asahidake
  //   «Смотровая Shibuya Sky» ⟷ «Сибуя»
  // Поправка на siteCity здесь не спасает: Тоёсу и Тюдзэндзи — не слаги
  // городов, а произвольные топонимы внутри названия, и заранее их
  // списком не перечислить.
  //
  // Ложная блокировка хуже пропущенного дубля: она мешает завести
  // законную точку, и владелец начинает обходить гейт силой.
  // Пробелы и дефисы в ромадзи расставляются произвольно: «Todai-ji»,
  // «Todaiji» и «Todai ji» — одно слово, записанное тремя способами, и
  // ни один из них не «правильный». Поэтому ядра сравниваются дважды:
  // как есть и слитно, берётся лучший результат. Слитное сравнение может
  // только поднять вес, и поднимает его ровно там, где расхождение было
  // в расстановке пробелов, — «hakone ropeway» и «hakone botanical garden»
  // слитно так же далеки, как и раздельно.
  const despace = (s: string) => s.replace(/\s+/g, '')
  const coreScore = Math.max(dice(sa.core, sb.core), dice(despace(sa.core), despace(sb.core)))
  const headScore = headSimilarity(sa.head, sb.head)
  const score = Math.min(coreScore, headScore)

  // Родовое слово есть только у ОДНОЙ стороны — потолок 0,85, как
  // у межалфавитного сравнения, и по той же причине.
  //
  // Снятие родового слова оставляет от названия ядро, и если это ядро —
  // топоним, разница между дублем и отношением «часть-целое» исчезает:
  //   «Todai-ji Temple» ⟷ «Todaiji»        один храм
  //   «Toyosu Market»   ⟷ «Тоёсу (район)»  рынок внутри района
  // Обе пары дают ровно 1,0, и различить их по строкам нечем. Живая база
  // подтвердила: без потолка вторая пара (POI-000314 и POI-000324)
  // блокировалась как дубль. Потолок отправляет обе владельцу, а разводит
  // их расстояние — если координаты есть, то у одного места они совпадут,
  // а у рынка с районом разойдутся.
  const oneSidedHead = Boolean(sa.head) !== Boolean(sb.head)
  return Number((oneSidedHead ? Math.min(score, 0.85) : score).toFixed(4))
}

/**
 * Отношение «часть — целое»: «Роппонги» и «Роппонги Хиллз», «Синдзюку» и
 * «Синдзюку Гёэн». Это НЕ дубли, а кандидат в Parent POI. Путать нельзя:
 * слияние такой пары уничтожит настоящую запись.
 */
export function containmentRelation(
  a: string | null | undefined,
  b: string | null | undefined,
): 'a_is_parent' | 'b_is_parent' | null {
  const ca = nameCore(a)
  const cb = nameCore(b)
  if (!ca || !cb || ca === cb || ca.length < 4 || cb.length < 4) return null
  if (cb.startsWith(`${ca} `) || cb.endsWith(` ${ca}`)) return 'a_is_parent'
  if (ca.startsWith(`${cb} `) || ca.endsWith(` ${cb}`)) return 'b_is_parent'
  return null
}

// ── География ───────────────────────────────────────────────────────────

/**
 * Координаты — единственный признак, не зависящий от языка записи.
 *
 * Всё выше в этом файле — работа со строками, и у неё есть предел: между
 * алфавитами сравнение сводится к транслитерации, и результат намеренно
 * ограничен 0,85, то есть сам по себе никогда не блокирует. Две точки в
 * тридцати метрах друг от друга — один объект независимо от того, как
 * записаны их имена. Поэтому расстояние здесь не ещё один похожий сигнал,
 * а независимая ось, которая и подтверждает решение по именам, и опровергает.
 */

/** Ближе этого — считаем одним местом, если имена хотя бы похожи. */
export const GEO_SAME_PLACE_M = 150
/** Дальше этого — блокировку по именам снимаем, как бы они ни совпадали. */
export const GEO_DIFFERENT_PLACE_M = 2000
/** Соседи в этом радиусе показываются владельцу даже при непохожих именах. */
export const GEO_NEIGHBOUR_M = 60

export interface GeoPoint {
  lat?: number | null
  lon?: number | null
}

function hasCoords(point: GeoPoint | undefined | null): point is { lat: number; lon: number } {
  return Boolean(
    point &&
      typeof point.lat === 'number' &&
      Number.isFinite(point.lat) &&
      typeof point.lon === 'number' &&
      Number.isFinite(point.lon),
  )
}

/**
 * Расстояние по большому кругу, метры. Формула гаверсинуса.
 *
 * Сферическая Земля даёт ошибку до 0,5% — на японских широтах это метры
 * на километр. Для порогов в 60 и 150 метров разница между сферой и
 * эллипсоидом (Vincenty) роли не играет, а зависимость исчезает.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number | null {
  if (!hasCoords(a) || !hasCoords(b)) return null
  const R = 6_371_008.8
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return Number((2 * R * Math.asin(Math.min(1, Math.sqrt(h)))).toFixed(1))
}

// ── Гейт добавления ─────────────────────────────────────────────────────

/** Пороги. Ниже REVIEW запись считается новой. */
export const DUPLICATE_BLOCK = 0.9
export const DUPLICATE_REVIEW = 0.72
export const PARENT_MIN = 0.8

export interface PoiLike extends GeoPoint {
  poiId: string
  nameRu: string
  nameEn?: string
  siteCity?: string
  recordId?: string
}

export interface PoiMatch {
  candidate: PoiLike
  score: number
  sameCity: boolean
  /** Расстояние в метрах, если координаты есть у обеих записей. */
  distanceM: number | null
  /** По какой паре имён сработало — для объяснимости в отчёте. */
  basis: string
}

/** Ранжированное сопоставление кандидата со всей базой. */
export function matchPoi(
  input: { nameRu: string; nameEn?: string; siteCity?: string } & GeoPoint,
  existing: PoiLike[],
): PoiMatch[] {
  const matches: PoiMatch[] = []
  for (const record of existing) {
    // Названия городов обеих записей — исключаются из сравнения как
    // самостоятельное основание для совпадения.
    const cityTokens = [romajiSkeleton(input.siteCity), romajiSkeleton(record.siteCity)].filter(
      (token) => token.length >= 4,
    )
    const pairs: Array<[string, string | undefined, string]> = [
      [input.nameRu, record.nameRu, 'ru↔ru'],
      [input.nameEn ?? '', record.nameEn, 'en↔en'],
      [input.nameRu, record.nameEn, 'ru↔en'],
      [input.nameEn ?? '', record.nameRu, 'en↔ru'],
    ]
    let best = 0
    let basis = ''
    for (const [x, y, label] of pairs) {
      if (!x || !y) continue
      const score = nameSimilarity(x, y, cityTokens)
      if (score > best) {
        best = score
        basis = label
      }
    }
    const distanceM = haversineMeters(input, record)
    // Запись без единого общего слова, но в тридцати метрах, всё равно
    // попадает в выдачу: имя может быть записано иначе (по-японски,
    // по названию комплекса), а место то же самое.
    const nearby = distanceM !== null && distanceM <= GEO_NEIGHBOUR_M
    if (best <= 0 && !nearby) continue
    matches.push({
      candidate: record,
      score: Number(best.toFixed(4)),
      sameCity: Boolean(input.siteCity && record.siteCity && input.siteCity === record.siteCity),
      distanceM,
      basis: basis || (nearby ? 'geo' : ''),
    })
  }
  // Совпадение в том же городе весомее: тёзок вроде «Храм Риннодзи»
  // в Японии много, и город — главный различитель. Близость по координатам
  // весомее города: город — это слаг длиной в слово, координаты — точка.
  const rank = (m: PoiMatch) =>
    m.score +
    (m.sameCity ? 0.05 : 0) +
    (m.distanceM !== null && m.distanceM <= GEO_SAME_PLACE_M ? 0.08 : 0)
  matches.sort((a, b) => rank(b) - rank(a))
  return matches
}

export type PoiScreenVerdict = 'blocked_duplicate' | 'needs_review' | 'clear'

export interface PoiScreenResult {
  verdict: PoiScreenVerdict
  /** Запись, из-за которой создание заблокировано. */
  blockingDuplicate: PoiMatch | null
  /** Похожие записи для показа владельцу — всегда, даже при verdict 'clear'. */
  duplicates: PoiMatch[]
  /** Найденный родитель. */
  parent: PoiMatch | null
  /** Родитель не проставлен, потому что кандидатов несколько и они близки. */
  parentAmbiguous: PoiMatch[]
  /**
   * Записи в радиусе GEO_NEIGHBOUR_M, чьи имена НЕ похожи. Не дубли —
   * это либо части одного комплекса (ворота, пагода, главный зал), либо
   * тот же объект под непохожим именем. Решает владелец.
   */
  geoNeighbours: PoiMatch[]
  reasons: string[]
}

/**
 * ГЕЙТ. Через него обязан проходить КАЖДЫЙ путь создания POI — агент
 * приёма, пакетный коллектор, ручное заведение, и в том числе создание
 * заглушек (родительских и из списка мест). Раньше заглушки создавались
 * в обход любой проверки, и это был основной источник дублей.
 *
 * @param input      что собираемся завести
 * @param existing   вся база (снимок делается один раз на прогон)
 * @param parentName имя родителя из исследования, если указано
 */
export function screenNewPoi(
  input: { nameRu: string; nameEn?: string; siteCity?: string } & GeoPoint,
  existing: PoiLike[],
  parentName?: { nameRu?: string; nameEn?: string },
): PoiScreenResult {
  const reasons: string[] = []
  const all = matchPoi(input, existing)

  // Отношение «часть — целое» — это не дубль. «Роппонги Хиллз» не должен
  // блокироваться существующим «Роппонги»: это разные точки маршрута.
  const duplicates: PoiMatch[] = []
  const partOfWhole: PoiMatch[] = []
  for (const match of all) {
    if (match.score < DUPLICATE_REVIEW) break
    const relation = containmentRelation(input.nameRu, match.candidate.nameRu)
    // Скобочное уточнение городом — это НЕ отношение «часть-целое».
    // «Храм Риннодзи» и «Храм Риннодзи (Сэндай)» отличаются ровно именем
    // города: владелец так разводит тёзок. Считать второй дочерним к
    // первому неверно — это два самостоятельных храма, и при совпадении
    // города они кандидаты в дубли, а не в родитель-потомок.
    const extraIsCity =
      relation !== null &&
      [input.siteCity, match.candidate.siteCity]
        .filter(Boolean)
        .some((city) => {
          const cityToken = romajiSkeleton(city)
          if (cityToken.length < 4) return false
          const longer = relation === 'a_is_parent' ? match.candidate.nameRu : input.nameRu
          const shorter = relation === 'a_is_parent' ? input.nameRu : match.candidate.nameRu
          return romajiSkeleton(longer).replace(romajiSkeleton(shorter), '') === cityToken
        })

    if (relation && !extraIsCity && match.score < 0.95) partOfWhole.push(match)
    else duplicates.push(match)
  }

  const top = duplicates[0] ?? null
  let verdict: PoiScreenVerdict = 'clear'
  let blockingDuplicate: PoiMatch | null = null

  // Координаты работают в обе стороны, и обе важны.
  //
  // ПОДТВЕРЖДЕНИЕ снимает главное ограничение строкового сравнения: между
  // алфавитами оно упирается в потолок 0,85 и не блокирует ничего. Если при
  // этом объекты стоят в ста метрах друг от друга — это одна точка, и
  // внешний источник заводит её повторно.
  //
  // ОПРОВЕРЖЕНИЕ важнее. Совпадение имён при двух километрах между точками
  // означает тёзку, а не дубль: «Храм Дзёдзёдзи» есть в каждой второй
  // префектуре. Слаг города здесь не помогает — Токио один слаг на сорок
  // километров. Блокировка в такой паре — ложная, а ложная блокировка
  // мешает завести законную точку, и владелец начинает обходить гейт силой.
  const topDistance = top?.distanceM ?? null
  const geoConfirms = topDistance !== null && topDistance <= GEO_SAME_PLACE_M
  const geoRefutes = topDistance !== null && topDistance > GEO_DIFFERENT_PLACE_M

  if (top && geoRefutes) {
    verdict = 'needs_review'
    reasons.push(
      `Совпадение ${top.score} с ${top.candidate.poiId} «${top.candidate.nameRu}», но между точками ${Math.round(topDistance / 100) / 10} км — это тёзка, а не дубль. Блокировка снята координатами.`,
    )
  } else if (top && geoConfirms && top.score >= DUPLICATE_REVIEW) {
    verdict = 'blocked_duplicate'
    blockingDuplicate = top
    reasons.push(
      `Та же точка: ${Math.round(topDistance)} м до ${top.candidate.poiId} «${top.candidate.nameRu}» при совпадении имён ${top.score}.`,
    )
  } else if (top && top.score >= DUPLICATE_BLOCK && top.sameCity) {
    verdict = 'blocked_duplicate'
    blockingDuplicate = top
    reasons.push(
      `Совпадение ${top.score} с ${top.candidate.poiId} «${top.candidate.nameRu}» в том же городе (${top.candidate.siteCity}).`,
    )
  } else if (top && top.score >= DUPLICATE_BLOCK) {
    // Высокое совпадение, но разные города — в Японии полно тёзок
    // («Храм Риннодзи» в Никко и в Сэндае). Не блокируем, но показываем.
    verdict = 'needs_review'
    reasons.push(
      `Совпадение ${top.score} с ${top.candidate.poiId} «${top.candidate.nameRu}», но город другой (${top.candidate.siteCity} против ${input.siteCity ?? '—'}). Проверьте, не тёзка ли это.`,
    )
  } else if (top) {
    verdict = 'needs_review'
    reasons.push(`Похоже на ${top.candidate.poiId} «${top.candidate.nameRu}» (${top.score}).`)
  }

  // ── Соседи по координатам ─────────────────────────────────────────────
  // Непохожие имена в шестидесяти метрах. Блокировать нельзя: храмовый
  // комплекс — это ворота, пагода и главный зал в одной точке, и все трое
  // законные отдельные записи. Но и молчать нельзя: ровно так же выглядит
  // тот же объект, заведённый под японским именем вместо русского.
  const geoNeighbours = all.filter(
    (m) =>
      m.distanceM !== null &&
      m.distanceM <= GEO_NEIGHBOUR_M &&
      m.score < DUPLICATE_REVIEW &&
      m.candidate.poiId !== top?.candidate.poiId,
  )
  if (geoNeighbours.length) {
    if (verdict === 'clear') verdict = 'needs_review'
    reasons.push(
      `Рядом уже есть: ${geoNeighbours
        .slice(0, 3)
        .map((m) => `${m.candidate.poiId} «${m.candidate.nameRu}» (${Math.round(m.distanceM!)} м)`)
        .join(', ')}. Проверьте, не тот ли это объект под другим именем.`,
    )
  }

  // ── Родитель ──────────────────────────────────────────────────────────
  let parent: PoiMatch | null = null
  const parentAmbiguous: PoiMatch[] = []

  const parentQuery = parentName?.nameRu || parentName?.nameEn
  if (parentQuery) {
    const parentMatches = matchPoi(
      { nameRu: parentName?.nameRu ?? '', nameEn: parentName?.nameEn, siteCity: input.siteCity },
      existing,
    ).filter((m) => m.score >= PARENT_MIN)

    if (parentMatches.length === 1) {
      parent = parentMatches[0]
    } else if (parentMatches.length > 1) {
      const [first, second] = parentMatches
      // Кандидаты близки по весу — привязку не делаем. Раньше здесь
      // молча брался ПЕРВЫЙ по порядку записей, без ранжирования,
      // и неверный Parent POI проставлялся без единого следа в отчёте.
      if (first.score - second.score >= 0.1) parent = first
      else {
        parentAmbiguous.push(...parentMatches.slice(0, 3))
        reasons.push(
          `Родитель не проставлен: несколько близких кандидатов (${parentMatches
            .slice(0, 3)
            .map((m) => `${m.candidate.poiId} ${m.score}`)
            .join(', ')}). Выберите вручную.`,
        )
      }
    }
  }

  // Часть-целое найдено, а родитель из исследования не указан — подсказка.
  if (!parent && !parentQuery && partOfWhole.length) {
    reasons.push(
      `Возможный родитель по названию: ${partOfWhole
        .slice(0, 2)
        .map((m) => `${m.candidate.poiId} «${m.candidate.nameRu}»`)
        .join(', ')}.`,
    )
  }

  return {
    verdict,
    blockingDuplicate,
    duplicates: duplicates.slice(0, 5),
    parent,
    parentAmbiguous,
    geoNeighbours: geoNeighbours.slice(0, 5),
    reasons,
  }
}

/** Адаптер записи Airtable в форму, понятную матчеру. */
export function toPoiLike(record: { id: string; fields: Record<string, unknown> }): PoiLike {
  const text = (key: string) => {
    const value = record.fields[key]
    return typeof value === 'string' ? value : ''
  }
  // Airtable отдаёт число из поля number, но пустая ячейка — это отсутствие
  // ключа, а не 0. Нулевая широта — точка в Атлантике; принять её за
  // «координат нет» безопаснее, чем считать реальным местом в Японии.
  const num = (key: string): number | undefined => {
    const value = record.fields[key]
    return typeof value === 'number' && Number.isFinite(value) && value !== 0 ? value : undefined
  }
  return {
    poiId: text('POI ID'),
    nameRu: text('POI Name (RU)'),
    nameEn: text('POI Name (EN)'),
    siteCity: text('Site City'),
    lat: num('Latitude'),
    lon: num('Longitude'),
    recordId: record.id,
  }
}
