/**
 * Разбор японского адреса и справочник направлений.
 *
 * Зачем. До 11.08.2026 в таблице муниципалитетов рядом с 大阪市 и 渋谷区
 * лежала строка `東京都: 'tokyo'` — подмена уровня. Любой объект префектуры
 * Токио с таким значением уезжал в кластер tokyo, включая острова Огасавара
 * в тысяче километров от Сибуи. Site City — туристическое направление, а не
 * административный тип территории и не доказательство принадлежности
 * муниципалитету.
 */
import { DESTINATIONS, parseJapaneseAddress, resolveSiteCity, TOKYO_SPECIAL_WARDS } from '../src/lib/jp-address.ts'
import { siteCityAgrees } from '../src/lib/poi-portal-place.ts'
import { canonicalPrefecture } from '../src/lib/prefectures.ts'
import { KNOWN_CITIES } from '../src/lib/poi-canon.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}

// ── Разбор адреса ───────────────────────────────────────────────────────
// Реальная строка из выгрузки Осаки: индекс, полноширинный пробел, город,
// район, дом. Выделенной колонки города в этом файле нет — она объявлена
// в заголовке и пуста во всех 2012 строках.
const osaka = parseJapaneseAddress('〒542-0086　大阪市中央区西心斎橋2-6-11 ライアンビル１A')
t('город из склеенного адреса', osaka.municipality, '大阪市')
t('район внутри города', osaka.ward, '中央区')
t('префектуры в строке нет', osaka.prefecture, '')

const kyoto = parseJapaneseAddress('京都府京都市東山区清水1丁目294')
t('префектура распознана', kyoto.prefecture, '京都府')
t('город после префектуры', kyoto.municipality, '京都市')
t('район города', kyoto.ward, '東山区')

// Спецрайон Токио сам себе муниципалитет, района внутри у него нет.
const shibuya = parseJapaneseAddress('東京都渋谷区神宮前1-1-1')
/* Разбор возвращает спецрайон КАНДИДАТОМ, а не муниципалитетом: решение
   принимает resolveSiteCity, когда видит префектуру. */
t('спецрайон — кандидат, а не муниципалитет', shibuya.municipality, '')
t('и он назван кандидатом', shibuya.specialWard, '渋谷区')
t('внутреннего района у спецрайона нет', shibuya.ward, '')
t('а с префектурой из того же адреса даёт tokyo',
  resolveSiteCity({ address: '東京都渋谷区神宮前1-1-1' }).siteCity, 'tokyo')

/* Ленивое `^(.+?市)` на «廿日市市宮島町» даёт «廿日市» — города, которого
   нет. Сопоставление по известным ключам от длинного к короткому такой
   ошибки не допускает. */
t('廿日市市 не режется до 廿日市',
  parseJapaneseAddress('広島県廿日市市宮島町1-1').municipality, '廿日市市')

// ── Уровень префектуры не даёт направления ──────────────────────────────
t('東京都 само по себе направления не даёт', resolveSiteCity({ city: '東京都' }).siteCity, '')
t('大阪府 само по себе направления не даёт', resolveSiteCity({ city: '大阪府' }).siteCity, '')
t('и причина названа',
  /только префектура/.test(resolveSiteCity({ city: '東京都' }).reason), true)

/* Острова Огасавара — префектура Токио, но не Токио: восемнадцать часов
   на пароме. Раньше такой объект получал слаг tokyo по строке 東京都. */
const ogasawara = resolveSiteCity({ address: '東京都小笠原村父島字東町' })
t('Огасавара не попадает в tokyo', ogasawara.siteCity, '')
t('но префектура распознана', ogasawara.prefecture, '東京都')
/* Деревня Огасавара распознаётся как муниципалитет — и это правильно:
   мы точно знаем, где объект, и он не направление. Человеку такое отдавать
   незачем, это география. Раньше он попал бы в tokyo по строке 東京都. */
t('и сама деревня распознана', ogasawara.municipality, '小笠原村')
t('это география, а не вопрос к человеку', /распознан и не входит/.test(ogasawara.reason), true)

/* «Распознан и не входит в справочник» и «не распознан» — разные исходы.
   Первое значит «знаем где, туда не едем» и уходит в географию; второе —
   «не знаем где» и уходит человеку. Слить их значило бы утопить очередь
   разбора в местах, про которые всё понятно. */
const hachioji = resolveSiteCity({ address: '東京都八王子市高尾町2177' })
t('Хатиодзи не попадает в tokyo', hachioji.siteCity, '')
t('но муниципалитет распознан', hachioji.municipality, '八王子市')
t('и причина это называет', /распознан и не входит/.test(hachioji.reason), true)

const sakai = resolveSiteCity({ address: '大阪府堺市堺区大仙町7-1' })
t('Сакаи получает своё направление вместо osaka', sakai.siteCity, 'sakai')
t('Сакаи распознан как муниципалитет', sakai.municipality, '堺市')
t('и его район тоже', sakai.ward, '堺区')

t('Мино получает своё направление вместо osaka', resolveSiteCity({ address: '大阪府箕面市箕面公園1-18' }).siteCity, 'minoh')
t('Мино распознан', resolveSiteCity({ address: '大阪府箕面市箕面公園1-18' }).municipality, '箕面市')

// Уезд перед посёлком муниципалитетом не является.
t('уезд отброшен, посёлок распознан',
  resolveSiteCity({ address: '大阪府泉南郡熊取町大久保北2-11-1' }).municipality, '熊取町')

// Осака без префектуры в адресе — как в самой выгрузке.
t('Хигасиосака не путается с Осакой',
  resolveSiteCity({ address: '東大阪市西石切町5-2-1' }).municipality, '東大阪市')
t('и направления не получает',
  resolveSiteCity({ address: '東大阪市西石切町5-2-1' }).siteCity, '')

// ── Что направление даёт ────────────────────────────────────────────────
t('склеенный адрес Осаки', resolveSiteCity({ address: '〒542-0086　大阪市中央区西心斎橋2-6-11' }).siteCity, 'osaka')
t('выделенная колонка города', resolveSiteCity({ city: '大阪市' }).siteCity, 'osaka')
t('район города-миллионника схлопнут', resolveSiteCity({ city: '京都市右京区' }).siteCity, 'kyoto')
/* Голый район БЕЗ префектуры направления не даёт: 中央区 есть в Осаке,
   Саппоро, Кобе, Тибе и Фукуоке, 北区 и 港区 — тоже не только в Токио. */
t('голый спецрайон без префектуры не даёт tokyo', resolveSiteCity({ city: '渋谷区' }).siteCity, '')
t('и причина это называет', /не только в Токио/.test(resolveSiteCity({ city: '渋谷区' }).reason), true)
t('с подтверждённой префектурой — даёт',
  resolveSiteCity({ prefecture: '東京都', city: '渋谷区' }).siteCity, 'tokyo')
t('спецрайон из адреса даёт tokyo', resolveSiteCity({ address: '東京都台東区浅草2-3-1' }).siteCity, 'tokyo')
t('Миядзима через 廿日市市', resolveSiteCity({ address: '広島県廿日市市宮島町1-1' }).siteCity, 'miyajima')

// Live JG intake refused identified Aichi places because these destinations were absent.
for (const [city, municipality] of [['nagoya', '名古屋市'], ['inuyama', '犬山市']]) {
  t(`JG Aichi ${city}: address resolves`,
    resolveSiteCity({ prefecture: '愛知県', city: municipality }).siteCity, city)
  t(`JG Aichi ${city}: registered canonical city`, KNOWN_CITIES.has(city), true)
  t(`JG Aichi ${city}: intake accepts matching prefecture`,
    siteCityAgrees(city, canonicalPrefecture('愛知県')).ok, true)
  t(`JG Aichi ${city}: intake refuses another prefecture`,
    siteCityAgrees(city, canonicalPrefecture('三重県')).ok, false)
  t(`JG Aichi ${city}: contradictory address is not assigned`,
    resolveSiteCity({ prefecture: '三重県', city: municipality }).siteCity, '')
}
t('Aichi alone does not imply Nagoya', resolveSiteCity({ prefecture: '愛知県' }).siteCity, '')
t('Another Aichi municipality is not silently mapped to Nagoya',
  resolveSiteCity({ prefecture: '愛知県', city: '豊田市' }).siteCity, '')

// Five otherwise eligible rows in the next 50-row JG pass need these four cities.
for (const [city, prefecture, municipality, address] of [
  ['fukuyama', '広島県', '福山市', '広島県福山市丸之内1-8'],
  ['onomichi', '広島県', '尾道市', '広島県尾道市瀬戸田町沢200-2'],
  ['akita', '秋田県', '秋田市', '秋田県秋田市中通1丁目4-2'],
  ['utsunomiya', '栃木県', '宇都宮市', '栃木県宇都宮市大谷町909'],
]) {
  t(`JG50 ${city}: full address resolves`, resolveSiteCity({ address }).siteCity, city)
  t(`JG50 ${city}: canonical city`, KNOWN_CITIES.has(city), true)
  t(`JG50 ${city}: matching prefecture`, siteCityAgrees(city, canonicalPrefecture(prefecture)).ok, true)
  t(`JG50 ${city}: wrong prefecture refused`, siteCityAgrees(city, canonicalPrefecture('大阪府')).ok, false)
  t(`JG50 ${city}: contradictory address refused`, resolveSiteCity({ prefecture: '大阪府', city: municipality }).siteCity, '')
  t(`JG50 ${city}: prefecture alone gives no city`, resolveSiteCity({ prefecture }).siteCity, '')
}

t('спецрайонов ровно 23', TOKYO_SPECIAL_WARDS.length, 23)

// ── Пустое остаётся пустым ──────────────────────────────────────────────
t('пустой вход', resolveSiteCity({}).siteCity, '')
t('и объяснён', /не разобран/.test(resolveSiteCity({}).reason), true)


// ── Колонка города и адрес разбираются независимо ────────────────────────
/* До 11.08.2026 непустая колонка перекрывала полный адрес безусловно.
   «中央区» при адресе в Осаке давал tokyo, при адресе в Саппоро — тоже
   tokyo, а «大阪府大阪市» считалось одной префектурой. */

t('中央区 + адрес Осаки → osaka',
  resolveSiteCity({ city: '中央区', address: '大阪府大阪市中央区西心斎橋2-6-11' }).siteCity, 'osaka')
t('中央区 + адрес Саппоро → sapporo',
  resolveSiteCity({ city: '中央区', address: '北海道札幌市中央区大通西1丁目' }).siteCity, 'sapporo')
t('中央区 + адрес Токио → tokyo',
  resolveSiteCity({ city: '中央区', address: '東京都中央区銀座4-5-6' }).siteCity, 'tokyo')
t('и муниципалитет там — сам район',
  resolveSiteCity({ city: '中央区', address: '東京都中央区銀座4-5-6' }).municipality, '中央区')

t('не распознанный текст в колонке не мешает адресу',
  resolveSiteCity({ city: '不明', address: '〒542-0086　大阪市中央区西心斎橋2-6-11' }).siteCity, 'osaka')
t('«不明» муниципалитетом не считается',
  resolveSiteCity({ city: '不明' }).municipality, '')

t('префектура вместе с городом в одной колонке',
  resolveSiteCity({ city: '大阪府大阪市' }).siteCity, 'osaka')
t('и префектура при этом распознана',
  resolveSiteCity({ city: '大阪府大阪市' }).prefecture, '大阪府')

// ── Противоречие источников — человеку, без догадки ──────────────────────
const clash = resolveSiteCity({ city: '大阪市', address: '京都府京都市東山区清水1丁目294' })
t('спорящие муниципалитеты дают конфликт', clash.conflict, true)
t('и слага не выдумывают', clash.siteCity, '')
t('и обе версии названы', /大阪市/.test(clash.reason) && /京都市/.test(clash.reason), true)

// Согласие источников конфликтом не считается.
const agree = resolveSiteCity({ city: '大阪市', address: '大阪府大阪市北区梅田3-1-1' })
t('согласие источников — не конфликт', agree.conflict, false)
t('и даёт направление', agree.siteCity, 'osaka')
t('и район города сохранён', agree.ward, '北区')

// Явная префектура — третий источник, а не украшение.
t('явная префектура включает спецрайон',
  resolveSiteCity({ prefecture: '東京都', city: '台東区' }).siteCity, 'tokyo')
t('чужая префектура спецрайон не включает',
  resolveSiteCity({ prefecture: '大阪府', city: '中央区' }).siteCity, '')


// ── Префектуры сверяются между собой ────────────────────────────────────
/* Раньше префектура выбиралась через «первое непустое», и ввод
   prefecture 大阪府 при адресе в Киото давал kyoto с префектурой 大阪府 и
   conflict: false — молча склеивал два разных места в одну запись. */
const prefClash = resolveSiteCity({ prefecture: '大阪府', address: '京都府京都市東山区清水1丁目294' })
t('спорящие префектуры дают конфликт', prefClash.conflict, true)
t('и слага не выдумывают', prefClash.siteCity, '')
t('и обе версии названы', /大阪府/.test(prefClash.reason) && /京都府/.test(prefClash.reason), true)
t('и префектура не выбирается наугад', prefClash.prefecture, '')

t('大阪府 против адреса в Токио — конфликт',
  resolveSiteCity({ prefecture: '大阪府', address: '東京都中央区銀座4-5-6' }).conflict, true)

/* Колонка города тоже может нести префектуру. «東京都中央区» при адресе
   в Осаке — спор, а не повод предпочесть колонку. */
const colClash = resolveSiteCity({ city: '東京都中央区', address: '大阪府大阪市中央区西心斎橋2-6-11' })
t('префектура из колонки участвует в сверке', colClash.conflict, true)
t('и tokyo из неё не берётся', colClash.siteCity, '')

// Испорченное явное поле не сохраняется целиком.
const mangled = resolveSiteCity({ prefecture: '大阪府大阪市', address: '大阪府大阪市中央区西心斎橋2-6-11' })
t('«大阪府大阪市» целиком префектурой не становится', mangled.prefecture, '大阪府')
t('и согласию с адресом не мешает', mangled.conflict, false)
t('и направление определяется', mangled.siteCity, 'osaka')

// Согласие всех трёх источников конфликтом не считается.
const allAgree = resolveSiteCity({ prefecture: '大阪府', city: '大阪市', address: '大阪府大阪市北区梅田3-1-1' })
t('три согласных источника — не конфликт', allAgree.conflict, false)
t('и дают направление', allAgree.siteCity, 'osaka')


// ── Направление связано с ПАРОЙ «префектура + муниципалитет» ─────────────
/* Справочник, индексированный только названием города, не умеет возразить
   на «префектура 大阪府, город 京都市»: находит 京都市, отдаёт kyoto и
   оставляет в отчёте чужую префектуру. */
const wrongPref = resolveSiteCity({ prefecture: '大阪府', city: '京都市' })
t('京都市 в 大阪府 — конфликт', wrongPref.conflict, true)
t('и слага не выдумывают', wrongPref.siteCity, '')
t('и названа настоящая префектура', /京都府/.test(wrongPref.reason), true)
t('и заявленная тоже', /大阪府/.test(wrongPref.reason), true)

t('大阪市 в 東京都 — конфликт', resolveSiteCity({ prefecture: '東京都', city: '大阪市' }).conflict, true)
t('神戸市 в 大阪府 — конфликт', resolveSiteCity({ prefecture: '大阪府', city: '神戸市' }).conflict, true)

/* Явное поле несёт муниципалитет, когда приходит склеенным. Его мнение
   участвует в сверке наравне с остальными. */
const declaredClash = resolveSiteCity({
  prefecture: '大阪府京都市', address: '大阪府大阪市中央区西心斎橋2-6-11',
})
t('муниципалитет из поля префектуры участвует в споре', declaredClash.conflict, true)
t('и обе версии названы', /京都市/.test(declaredClash.reason) && /大阪市/.test(declaredClash.reason), true)

const declaredAgree = resolveSiteCity({
  prefecture: '大阪府大阪市', address: '大阪府大阪市中央区西心斎橋2-6-11',
})
t('согласие поля и адреса — не конфликт', declaredAgree.conflict, false)
t('и даёт направление', declaredAgree.siteCity, 'osaka')

/* Префектуры в адресе нет — как во всей выгрузке Осаки. Тогда она берётся
   из справочника: это не догадка, а то же знание, по которому выдан слаг. */
const noPrefInAddress = resolveSiteCity({ address: '大阪市中央区西心斎橋2-6-11' })
t('без префектуры в адресе слаг выдаётся', noPrefInAddress.siteCity, 'osaka')
t('и префектура берётся из справочника', noPrefInAddress.prefecture, '大阪府')

// Справочник не должен содержать одинаковых названий муниципалитетов:
// поиск по названию иначе перестаёт быть однозначным.
t('названия муниципалитетов уникальны',
  new Set(DESTINATIONS.map((d) => d.municipality)).size, DESTINATIONS.length)
t('у каждого направления есть префектура',
  DESTINATIONS.every((d) => /[都道府県]$/u.test(d.prefecture)), true)


// ── Битый почтовый индекс не должен ломать разбор ───────────────────────
// Official addresses from the next Japan Guide batch: towns and villages
// must retain their own destination, rather than the prefectural capital.
for (const [address, city] of [
  ['京都府宮津市字文珠466', 'amanohashidate'],
  ['奈良県高市郡明日香村奥山601', 'asuka'],
  ['奈良県吉野郡吉野町吉野山579', 'yoshino'],
  ['奈良県宇陀市室生78', 'uda'],
  ['石川県輪島市門前町門前1-18-1', 'noto'],
  ['三重県鳥羽市鳥羽1丁目7-1', 'toba'],
]) t(`направление полного адреса ${address}`, resolveSiteCity({ address }).siteCity, city)
// Source batch 2026-09-10: municipality lookup and prefecture mismatch are independent.
for (const [prefecture, municipality, slug] of [["三重県", "志摩市", "shima"], ["三重県", "伊賀市", "iga"], ["長崎県", "長崎市", "nagasaki"], ["長崎県", "島原市", "shimabara"], ["長崎県", "南島原市", "minamishimabara"], ["長崎県", "平戸市", "hirado"], ["長崎県", "雲仙市", "unzen"], ["長崎県", "五島市", "goto"], ["長崎県", "新上五島町", "shinkamigoto"], ["熊本県", "熊本市", "kumamoto"], ["熊本県", "阿蘇市", "aso"], ["熊本県", "水俣市", "minamata"], ["鹿児島県", "鹿児島市", "kagoshima"], ["鹿児島県", "霧島市", "kirishima"], ["鹿児島県", "屋久島町", "yakushima"], ["宮崎県", "えびの市", "ebino"]]) {
  t(`направление нового прохода ${municipality}`, resolveSiteCity({ address: prefecture + municipality }).siteCity, slug)
  t(`чужая префектура для ${municipality}`, resolveSiteCity({ prefecture: '大阪府', city: municipality }).siteCity, '')
}

// Kyushu, Kumano and Sanriku batch: exact municipality and wrong-prefecture control.
for (const [prefecture, municipality, slug] of [["鹿児島県", "南九州市", "minamikyushu"], ["鹿児島県", "指宿市", "ibusuki"], ["鹿児島県", "奄美市", "amami"], ["大分県", "別府市", "beppu"], ["大分県", "大分市", "oita"], ["大分県", "宇佐市", "usa"], ["大分県", "臼杵市", "usuki"], ["福岡県", "福岡市", "fukuoka"], ["福岡県", "太宰府市", "dazaifu"], ["福岡県", "北九州市", "kitakyushu"], ["和歌山県", "田辺市", "tanabe"], ["和歌山県", "新宮市", "shingu"], ["和歌山県", "那智勝浦町", "nachikatsuura"], ["岩手県", "一関市", "ichinoseki"], ["岩手県", "岩泉町", "iwaizumi"], ["岩手県", "宮古市", "miyako"], ["宮城県", "石巻市", "ishinomaki"], ["宮城県", "気仙沼市", "kesennuma"], ["岩手県", "陸前高田市", "rikuzentakata"], ["宮城県", "塩竈市", "shiogama"]]) {
  t(`новые 50: направление ${municipality}`, resolveSiteCity({ address: prefecture + municipality }).siteCity, slug)
  t(`новые 50: чужая префектура ${municipality}`, resolveSiteCity({ prefecture: '大阪府', city: municipality }).siteCity, '')
}

t('новое направление не принимается в чужой префектуре',
  resolveSiteCity({ prefecture: '大阪府', city: '宮津市' }).siteCity, '')

/* Живая строка из выгрузки Осаки: пробел после знака и пять цифр после
   дефиса вместо четырёх. Жёсткий шаблон не срабатывал, префектура
   оставалась за индексом, и объект уходил человеку с причиной «адрес не
   разобран» — хотя город в строке был. */
const brokenZip = resolveSiteCity({ address: '〒 567-08811 大阪府茨木市上中条 2-11-25' })
t('битый индекс не мешает разбору', brokenZip.municipality, '茨木市')
t('и префектура читается', brokenZip.prefecture, '大阪府')
t('Ибараки направления не даёт', brokenZip.siteCity, '')
t('и это география, а не вопрос человеку', /распознан и не входит/.test(brokenZip.reason), true)

t('обычный индекс по-прежнему отбрасывается',
  resolveSiteCity({ address: '〒542-0086　大阪市中央区西心斎橋2-6-11' }).siteCity, 'osaka')
t('индекс без знака тоже',
  resolveSiteCity({ address: '542-0086 大阪市中央区西心斎橋2-6-11' }).siteCity, 'osaka')
t('пустой адрес остаётся неразобранным', resolveSiteCity({ address: '' }).municipality, '')

console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ японский адрес: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
