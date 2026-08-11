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
 * Справочник направлений: муниципалитет или специальный район → слаг сайта.
 *
 * Ключи — административные единицы, и только они. Уровень префектуры сюда
 * не попадает никогда: 東京都 и 大阪府 покрывают территории, которые в тур
 * не входят, а 大阪市 и 渋谷区 — входят.
 */
export const SITE_CITY_BY_MUNICIPALITY: Record<string, string> = {
  京都市: 'kyoto', 宇治市: 'uji', 大阪市: 'osaka', 奈良市: 'nara',
  神戸市: 'kobe', 横浜市: 'yokohama', 金沢市: 'kanazawa', 姫路市: 'himeji',
  鎌倉市: 'kamakura', 箱根町: 'hakone', 日光市: 'nikko', 広島市: 'hiroshima',
  廿日市市: 'miyajima', 札幌市: 'sapporo', 小樽市: 'otaru', 函館市: 'hakodate',
  仙台市: 'sendai', 松島町: 'matsushima', 青森市: 'aomori', 平泉町: 'hiraizumi',
  高山市: 'takayama', 白川村: 'shirakawago', 桐生市: 'kiryu',
  富良野市: 'furano', 旭川市: 'asahikawa', 釧路市: 'kushiro',
  網走市: 'abashiri', 斜里町: 'shiretoko', 上川町: 'kamikawa',
  藤沢市: 'enoshima', 高野町: 'koyasan', 那須町: 'nasu',
  十日町市: 'tokamachi', 津南町: 'tsunan', 十和田市: 'towada',
  弟子屈町: 'akan', 洞爺湖町: 'toyako', 登別市: 'noboribetsu',
}

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

const PREFECTURE = /^(東京都|北海道|京都府|大阪府|[^\s]{2,3}県)/

export interface JapaneseAddressParts {
  /** 東京都, 大阪府, 広島県 — как в адресе. Пусто, если адрес его не несёт. */
  prefecture: string
  /** 市・町・村 или специальный район Токио. */
  municipality: string
  /** Район внутри города-миллионника: 中央区 в 大阪市中央区. */
  ward: string
}

/**
 * Разбор адреса на административные части.
 *
 * Муниципалитет определяется по справочнику направлений и списку
 * спецрайонов, а не регулярным выражением на 市・町・村. Причина простая:
 * ленивое `^(.+?市)` на строке «廿日市市宮島町» даёт «廿日市» — город,
 * которого нет. Сопоставление по известным ключам, от длинного к короткому,
 * такой ошибки не допускает и заодно честно говорит «не знаю» там, где
 * места в туре нет.
 */
export function parseJapaneseAddress(address: string | null | undefined): JapaneseAddressParts {
  const empty = { prefecture: '', municipality: '', ward: '' }
  let rest = String(address ?? '').trim()
  if (!rest) return empty

  // Почтовый индекс идёт первым и к административному делению отношения
  // не имеет: «〒542-0086　大阪市中央区…».
  rest = rest.replace(/^〒?\s*\d{3}-?\d{4}\s*/u, '').replace(/^[\s　]+/u, '')

  const pref = PREFECTURE.exec(rest)
  const prefecture = pref ? pref[1] : ''
  if (pref) rest = rest.slice(pref[1].length)

  // Спецрайоны Токио и муниципалитеты справочника — единый список ключей,
  // отсортированный по длине: «大阪市» не должен обгонять «大阪狭山市».
  const keys = [...TOKYO_SPECIAL_WARDS, ...Object.keys(SITE_CITY_BY_MUNICIPALITY)]
    .sort((a, b) => b.length - a.length)
  const known = keys.find((key) => rest.startsWith(key)) ?? ''

  // Уезд идёт перед посёлком и муниципалитетом не является:
  // «泉南郡熊取町» — это посёлок Кумтори в уезде Сэннан.
  if (!known) rest = rest.replace(/^.{1,4}郡/u, '')

  // Ключи справочника пробуются ПЕРВЫМИ, и только потом общий разбор.
  // Порядок важен: ленивое `.+?市` на «廿日市市宮島町» даёт «廿日市» —
  // города, которого нет. Пока 廿日市市 стоит в справочнике, до общего
  // разбора дело не доходит; для незнакомых имён такой формы разбор
  // ошибётся, и это записано здесь, а не выяснится на живых данных.
  const municipality = known || (/^(.{1,6}?[市町村])/u.exec(rest)?.[1] ?? '')
  if (!municipality) return { prefecture, municipality: '', ward: '' }

  rest = rest.slice(municipality.length)
  // Район внутри города-миллионника: 大阪市 → 中央区. У спецрайона Токио
  // своего района нет, он сам муниципалитет.
  const ward = TOKYO_SPECIAL_WARDS.includes(municipality) ? '' : (/^([^\s\d]{1,4}区)/u.exec(rest)?.[1] ?? '')

  return { prefecture, municipality, ward }
}

export interface SiteCityResolution {
  siteCity: string
  prefecture: string
  municipality: string
  ward: string
  /** Почему получилось так. Идёт в отчёт, а не в поле записи. */
  reason: string
}

/**
 * Туристический слаг по адресу или по названию муниципалитета.
 *
 * Пустой `siteCity` — это НЕ «плохие данные». Это «муниципалитет известен,
 * но в туристическую сеть не входит» либо «муниципалитет не распознан».
 * Оба случая решает человек, а не догадка: подставить слаг по префектуре
 * значит отправить остров Титидзима в кластер Токио.
 */
export function resolveSiteCity(input: {
  city?: string | null
  address?: string | null
}): SiteCityResolution {
  const direct = String(input.city ?? '').trim()

  // Выделенная колонка города, если она заполнена. Уровень префектуры
  // отвергается явно: 東京都 и 大阪府 — не муниципалитеты.
  if (direct) {
    if (PREFECTURE.test(direct) && !SITE_CITY_BY_MUNICIPALITY[direct]) {
      return {
        siteCity: '', prefecture: direct, municipality: '', ward: '',
        reason: `«${direct}» — уровень префектуры, а не муниципалитет: определить направление по нему нельзя`,
      }
    }
    const slug = SITE_CITY_BY_MUNICIPALITY[direct]
    if (slug) {
      return { siteCity: slug, prefecture: '', municipality: direct, ward: '', reason: 'муниципалитет из выделенной колонки' }
    }
    const wardOfCity = /^(.+?[市])[^市]*区$/u.exec(direct)
    if (wardOfCity && SITE_CITY_BY_MUNICIPALITY[wardOfCity[1]]) {
      return {
        siteCity: SITE_CITY_BY_MUNICIPALITY[wardOfCity[1]], prefecture: '',
        municipality: wardOfCity[1], ward: direct.slice(wardOfCity[1].length),
        reason: 'район города-миллионника схлопнут в город',
      }
    }
    if (TOKYO_SPECIAL_WARDS.includes(direct)) {
      return { siteCity: 'tokyo', prefecture: '東京都', municipality: direct, ward: '', reason: 'специальный район Токио' }
    }
    return {
      siteCity: '', prefecture: '', municipality: direct, ward: '',
      reason: `муниципалитет «${direct}» распознан и не входит в справочник направлений`,
    }
  }

  // Колонка пуста — разбираем склеенный адрес. У Осаки все 2012 строк
  // приходят именно так: 所在地_市区町村 объявлена и пуста, всё лежит в
  // 所在地_連結表記.
  const parts = parseJapaneseAddress(input.address)
  if (!parts.municipality) {
    // Муниципалитет НЕ РАСПОЗНАН — это не то же самое, что «распознан и не
    // входит в справочник». Второе значит «знаем где, туда не едем»; первое —
    // «не знаем где», и решает человек. Догадаться по префектуре нельзя.
    return {
      ...parts, siteCity: '',
      reason: parts.prefecture
        ? `в адресе распознана только префектура «${parts.prefecture}» — направление по ней не определяется`
        : 'адрес не разобран: ни муниципалитета, ни префектуры',
    }
  }
  const slug = TOKYO_SPECIAL_WARDS.includes(parts.municipality)
    ? 'tokyo'
    : SITE_CITY_BY_MUNICIPALITY[parts.municipality] ?? ''
  return {
    ...parts,
    siteCity: slug,
    reason: slug ? 'муниципалитет разобран из адреса' : `муниципалитет «${parts.municipality}» распознан и не входит в справочник направлений`,
  }
}
