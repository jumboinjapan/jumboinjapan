/**
 * Разбор японского адреса и перевод его в туристический слаг.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Раньше вся эта работа сводилась к одной таблице
 * «японское название → слаг» внутри канона, и в таблице рядом с
 * муниципалитетами лежала строка `東京都: 'tokyo'`. Это подмена уровня:
 * 東京都 — субъект уровня префектуры, а не муниципалитет. Единого «города
 * Токио» сейчас нет: центральную городскую территорию образуют 23
 * специальных района, а за их пределами лежат отдельные города, посёлки и
 * деревни — вплоть до островов Огасавара в тысяче километров от Сибуи.
 * Любой объект префектуры Токио, у которого в поле города стояло 東京都,
 * уезжал в кластер `tokyo`.
 *
 * РАЗЛИЧАЮТСЯ ЧЕТЫРЕ СУЩНОСТИ:
 *
 *   Prefecture     административный уровень 都・道・府・県   Tokyo, Osaka
 *   Municipality   市・町・村・特別区                        Osaka-shi, Shibuya-ku
 *   District/Ward  район внутри муниципалитета               Kita-ku в Osaka-shi
 *   Site City      туристический кластер сайта               tokyo, osaka
 *
 * Site City — НЕ административный тип территории и НЕ доказательство
 * муниципальной принадлежности. Это направление продукта, и связь
 * «муниципалитет → направление» задаётся явным справочником ниже. Нет
 * записи в справочнике — нет слага; догадываться по префектуре нельзя.
 *
 * Порядок разбора: адрес → префектура → муниципалитет или спецрайон →
 * справочник направлений → Site City.
 */

/**
 * Справочник направлений: пара «префектура + муниципалитет» → слаг сайта.
 *
 * Пара, а не одно название. Справочник, индексированный только
 * муниципалитетом, не умеет возразить на ввод «префектура 大阪府, город
 * 京都市»: он находит 京都市, отдаёт kyoto и оставляет в отчёте чужую
 * префектуру. Пара делает такое сочетание противоречием, а не находкой.
 *
 * Ключи — только административные единицы. Уровень префектуры сюда не
 * попадает никогда: 東京都 и 大阪府 покрывают территории, которые в тур не
 * входят, а 大阪市 и 渋谷区 — входят.
 */
export interface Destination {
  prefecture: string
  municipality: string
  siteCity: string
}

export const DESTINATIONS: readonly Destination[] = [
  { prefecture: '京都府', municipality: '京都市', siteCity: 'kyoto' },
  { prefecture: '京都府', municipality: '宇治市', siteCity: 'uji' },
  { prefecture: '大阪府', municipality: '大阪市', siteCity: 'osaka' },
  { prefecture: '奈良県', municipality: '奈良市', siteCity: 'nara' },
  { prefecture: '兵庫県', municipality: '神戸市', siteCity: 'kobe' },
  { prefecture: '兵庫県', municipality: '姫路市', siteCity: 'himeji' },
  { prefecture: '神奈川県', municipality: '横浜市', siteCity: 'yokohama' },
  { prefecture: '神奈川県', municipality: '鎌倉市', siteCity: 'kamakura' },
  { prefecture: '神奈川県', municipality: '箱根町', siteCity: 'hakone' },
  { prefecture: '神奈川県', municipality: '藤沢市', siteCity: 'enoshima' },
  { prefecture: '石川県', municipality: '金沢市', siteCity: 'kanazawa' },
  { prefecture: '栃木県', municipality: '日光市', siteCity: 'nikko' },
  { prefecture: '栃木県', municipality: '那須町', siteCity: 'nasu' },
  { prefecture: '広島県', municipality: '広島市', siteCity: 'hiroshima' },
  { prefecture: '広島県', municipality: '廿日市市', siteCity: 'miyajima' },
  { prefecture: '宮城県', municipality: '仙台市', siteCity: 'sendai' },
  { prefecture: '宮城県', municipality: '松島町', siteCity: 'matsushima' },
  { prefecture: '青森県', municipality: '青森市', siteCity: 'aomori' },
  { prefecture: '青森県', municipality: '十和田市', siteCity: 'towada' },
  { prefecture: '岩手県', municipality: '平泉町', siteCity: 'hiraizumi' },
  { prefecture: '岐阜県', municipality: '高山市', siteCity: 'takayama' },
  { prefecture: '岐阜県', municipality: '白川村', siteCity: 'shirakawago' },
  { prefecture: '群馬県', municipality: '桐生市', siteCity: 'kiryu' },
  { prefecture: '和歌山県', municipality: '高野町', siteCity: 'koyasan' },
  { prefecture: '新潟県', municipality: '十日町市', siteCity: 'tokamachi' },
  { prefecture: '新潟県', municipality: '津南町', siteCity: 'tsunan' },
  { prefecture: '北海道', municipality: '札幌市', siteCity: 'sapporo' },
  { prefecture: '北海道', municipality: '小樽市', siteCity: 'otaru' },
  { prefecture: '北海道', municipality: '函館市', siteCity: 'hakodate' },
  { prefecture: '北海道', municipality: '富良野市', siteCity: 'furano' },
  { prefecture: '北海道', municipality: '旭川市', siteCity: 'asahikawa' },
  { prefecture: '北海道', municipality: '釧路市', siteCity: 'kushiro' },
  { prefecture: '北海道', municipality: '網走市', siteCity: 'abashiri' },
  { prefecture: '北海道', municipality: '斜里町', siteCity: 'shiretoko' },
  { prefecture: '北海道', municipality: '上川町', siteCity: 'kamikawa' },
  { prefecture: '北海道', municipality: '弟子屈町', siteCity: 'akan' },
  { prefecture: '北海道', municipality: '洞爺湖町', siteCity: 'toyako' },
  { prefecture: '北海道', municipality: '登別市', siteCity: 'noboribetsu' },
]

/** Быстрый поиск по названию муниципалитета. Названия в справочнике уникальны. */
const BY_MUNICIPALITY = new Map(DESTINATIONS.map((d) => [d.municipality, d]))

/**
 * Плоский вид справочника. Оставлен ради разбора адреса: там нужны только
 * ключи, и префектура ни при чём.
 */
export const SITE_CITY_BY_MUNICIPALITY: Record<string, string> = Object.fromEntries(
  DESTINATIONS.map((d) => [d.municipality, d.siteCity]),
)

/**
 * 23 специальных района Токио. Каждый — самостоятельный муниципалитет, и
 * все вместе они образуют ту территорию, которую турист называет Токио.
 * Всё остальное в префектуре — Хатиодзи, Митака, острова Огасавара —
 * туристическим слагом `tokyo` НЕ является и получает его только через
 * явную запись в справочнике выше.
 */
export const TOKYO_SPECIAL_WARDS: readonly string[] = [
  '千代田区', '中央区', '港区', '新宿区', '文京区', '台東区', '墨田区', '江東区',
  '品川区', '目黒区', '大田区', '世田谷区', '渋谷区', '中野区', '杉並区', '豊島区',
  '北区', '荒川区', '板橋区', '練馬区', '足立区', '葛飾区', '江戸川区',
]

const PREFECTURE = /^(東京都|北海道|京都府|大阪府|[^\s]{2,3}県)/u
/** Уезд идёт перед посёлком и муниципалитетом не является. */
const DISTRICT = /^.{1,4}郡/u
/** Общий разбор: город, посёлок или деревня. */
const MUNICIPALITY = /^(.{1,6}?[市町村])/u
/** Район: либо внутри города-миллионника, либо кандидат в спецрайоны Токио. */
const WARD = /^([^\s\d]{1,4}区)/u

export interface JapaneseAddressParts {
  /** 東京都, 大阪府, 広島県 — как в строке. Пусто, если её там нет. */
  prefecture: string
  /** 市・町・村. Спецрайон Токио сюда НЕ попадает — см. specialWard. */
  municipality: string
  /**
   * Кандидат в специальные районы Токио.
   *
   * Именно кандидат, а не результат. 中央区, 北区, 港区 и ещё несколько
   * названий не уникальны для Токио: 中央区 есть в Осаке, Саппоро, Кобе,
   * Тибе и Фукуоке. Голое название района становится токийским только при
   * подтверждённой префектуре 東京都 — иначе это район какого-то города,
   * и какого именно, из этой строки не следует.
   */
  specialWard: string
  /** Район внутри города-миллионника: 中央区 в 大阪市中央区. */
  ward: string
}

/**
 * Разбор строки адреса или её куска на административные части.
 *
 * Работает и на полном адресе, и на значении колонки города: колонка
 * приходит то как «大阪市», то как «大阪府大阪市», то как «中央区», то как
 * «不明». Разбор один и тот же, а решение о том, чему верить, принимает
 * resolveSiteCity — он видит все источники сразу.
 */
export function parseJapaneseAddress(address: string | null | undefined): JapaneseAddressParts {
  const empty = { prefecture: '', municipality: '', specialWard: '', ward: '' }
  let rest = String(address ?? '').trim()
  if (!rest) return empty

  // Почтовый индекс к административному делению отношения не имеет.
  rest = rest.replace(/^〒?\s*\d{3}-?\d{4}\s*/u, '').replace(/^[\s　]+/u, '')

  const pref = PREFECTURE.exec(rest)
  const prefecture = pref ? pref[1] : ''
  if (pref) rest = rest.slice(pref[1].length)

  // Ключи справочника пробуются раньше общего разбора: ленивое `.+?市` на
  // «廿日市市宮島町» даёт «廿日市» — города, которого нет.
  const known = Object.keys(SITE_CITY_BY_MUNICIPALITY)
    .sort((a, b) => b.length - a.length)
    .find((key) => rest.startsWith(key)) ?? ''
  if (!known) rest = rest.replace(DISTRICT, '')

  const municipality = known || (MUNICIPALITY.exec(rest)?.[1] ?? '')
  if (!municipality) {
    // Муниципалитета нет, но строка может быть голым районом.
    const bare = WARD.exec(rest)?.[1] ?? ''
    return {
      prefecture,
      municipality: '',
      specialWard: bare && TOKYO_SPECIAL_WARDS.includes(bare) ? bare : '',
      ward: '',
    }
  }

  rest = rest.slice(municipality.length)
  return { prefecture, municipality, specialWard: '', ward: WARD.exec(rest)?.[1] ?? '' }
}

export interface SiteCityResolution {
  siteCity: string
  prefecture: string
  municipality: string
  ward: string
  /** true — источники противоречат друг другу; решает человек. */
  conflict: boolean
  /** Почему получилось так. Идёт в отчёт, а не в поле записи. */
  reason: string
}

/** Ключ справочника из разобранной части — с учётом префектуры. */
function municipalityKey(parts: JapaneseAddressParts, prefecture: string): string {
  if (parts.municipality) return parts.municipality
  // Голый район засчитывается только при подтверждённом 東京都.
  if (parts.specialWard && prefecture === '東京都') return parts.specialWard
  return ''
}

/**
 * Туристический слаг по трём источникам сразу.
 *
 * Ни один источник не главнее прочих по факту непустоты. До 11.08.2026
 * непустая колонка города перекрывала полный адрес — и «中央区» при адресе
 * в Осаке давал tokyo, а «大阪府大阪市» считалось одной префектурой. Теперь
 * колонка и адрес разбираются НЕЗАВИСИМО, а расхождение между ними —
 * повод отдать запись человеку, а не выбрать наугад.
 *
 * Три исхода:
 *   слаг            муниципалитет распознан и есть в справочнике;
 *   пусто           распознан и в справочнике его нет — география, отсев;
 *   conflict/пусто  не разобран или источники спорят — человеку.
 */
export function resolveSiteCity(input: {
  prefecture?: string | null
  city?: string | null
  address?: string | null
}): SiteCityResolution {
  const fromAddress = parseJapaneseAddress(input.address)
  const fromCity = parseJapaneseAddress(input.city)
  // Явное поле разбирается тем же парсером, а не берётся строкой: колонка
  // «大阪府大阪市» несёт префектуру и город сразу, и сохранять её целиком
  // как префектуру нельзя. Проверка по префиксу этого не отличала.
  const fromDeclared = parseJapaneseAddress(input.prefecture)

  // ПРЕФЕКТУРЫ СВЕРЯЮТСЯ ДО МУНИЦИПАЛИТЕТА. Раньше значение выбиралось
  // через «первое непустое», и ввод prefecture 大阪府 при адресе в Киото
  // давал siteCity kyoto с префектурой 大阪府 и conflict: false — то есть
  // молча склеивал два разных места в одну запись.
  const prefectures = [...new Set(
    [fromDeclared.prefecture, fromCity.prefecture, fromAddress.prefecture].filter(Boolean),
  )]
  if (prefectures.length > 1) {
    return {
      siteCity: '', prefecture: '', municipality: '', ward: '', conflict: true,
      reason: `источники спорят о префектуре: ${prefectures.map((v) => `«${v}»`).join(', ')}`,
    }
  }
  const prefecture = prefectures[0] ?? ''

  // Муниципалитет сверяется по ВСЕМ трём источникам. Явное поле тоже несёт
  // его, когда приходит склеенным («大阪府京都市»), и молчаливо выбросить
  // его мнение значило бы оставить ту же дыру уровнем ниже.
  const addressKey = municipalityKey(fromAddress, prefecture)
  const cityKey = municipalityKey(fromCity, prefecture)
  const declaredKey = municipalityKey(fromDeclared, prefecture)

  const named = [
    { key: addressKey, from: 'адрес' },
    { key: cityKey, from: 'колонка города' },
    { key: declaredKey, from: 'поле префектуры' },
  ].filter((s) => s.key)
  const uniqueKeys = [...new Set(named.map((s) => s.key))]
  if (uniqueKeys.length > 1) {
    return {
      siteCity: '', prefecture, municipality: '', ward: '', conflict: true,
      reason: `источники спорят о муниципалитете: ${named.map((s) => `${s.from} даёт «${s.key}»`).join(', ')}`,
    }
  }

  // Адрес полнее колонки, поэтому при согласии берётся он; но «полнее» не
  // значит «главнее»: если адреса нет, работает колонка, затем явное поле.
  const key = addressKey || cityKey || declaredKey
  const parts = addressKey ? fromAddress : cityKey ? fromCity : fromDeclared

  if (!key) {
    const sawWard = fromAddress.specialWard || fromCity.specialWard
    return {
      siteCity: '', prefecture, municipality: '', ward: '', conflict: false,
      reason: sawWard
        ? `район «${sawWard}» без подтверждённой префектуры: 中央区, 北区 и другие есть не только в Токио`
        : prefecture
          ? `распознана только префектура «${prefecture}» — направление по ней не определяется`
          : 'муниципалитет не разобран ни из адреса, ни из колонки города',
    }
  }

  if (TOKYO_SPECIAL_WARDS.includes(key)) {
    // До сюда спецрайон доходит только с подтверждённой 東京都: municipalityKey
    // без неё его не засчитывает.
    return {
      siteCity: 'tokyo', prefecture: prefecture || '東京都', municipality: key,
      ward: '', conflict: false, reason: `специальный район «${key}» при подтверждённой 東京都`,
    }
  }

  const destination = BY_MUNICIPALITY.get(key)

  // Муниципалитет известен, но заявленная префектура ему не та. Это спор
  // источников, а не находка: «大阪府 + 京都市» не Киото и не Осака, а
  // испорченные данные, и решать их должен человек.
  if (destination && prefecture && destination.prefecture !== prefecture) {
    return {
      siteCity: '', prefecture: '', municipality: '', ward: '', conflict: true,
      reason: `«${key}» относится к «${destination.prefecture}», а в источниках заявлена «${prefecture}»`,
    }
  }

  const slug = destination?.siteCity ?? ''
  return {
    siteCity: slug,
    // Префектуру справочника подставляем, когда в источниках её не было:
    // это не догадка, а то же самое знание, по которому выдан слаг.
    prefecture: prefecture || destination?.prefecture || '',
    municipality: key,
    ward: parts.ward,
    conflict: false,
    reason: slug
      ? `муниципалитет «${key}» из ${addressKey ? 'адреса' : cityKey ? 'колонки города' : 'поля префектуры'}`
      : `муниципалитет «${key}» распознан и не входит в справочник направлений`,
  }
}
