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

  const declared = String(input.prefecture ?? '').trim()
  const prefecture =
    (PREFECTURE.test(declared) ? declared : '') || fromAddress.prefecture || fromCity.prefecture

  const addressKey = municipalityKey(fromAddress, prefecture)
  const cityKey = municipalityKey(fromCity, prefecture)

  if (addressKey && cityKey && addressKey !== cityKey) {
    return {
      siteCity: '', prefecture, municipality: '', ward: '', conflict: true,
      reason: `источники спорят: адрес даёт «${addressKey}», колонка города — «${cityKey}»`,
    }
  }

  // Адрес полнее колонки, поэтому при согласии берётся он; но «полнее» не
  // значит «главнее»: если адреса нет, работает колонка.
  const key = addressKey || cityKey
  const parts = addressKey ? fromAddress : fromCity

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

  const slug = TOKYO_SPECIAL_WARDS.includes(key) ? 'tokyo' : SITE_CITY_BY_MUNICIPALITY[key] ?? ''
  return {
    siteCity: slug,
    prefecture,
    municipality: key,
    ward: parts.ward,
    conflict: false,
    reason: slug
      ? `муниципалитет «${key}» из ${addressKey ? 'адреса' : 'колонки города'}`
      : `муниципалитет «${key}» распознан и не входит в справочник направлений`,
  }
}
