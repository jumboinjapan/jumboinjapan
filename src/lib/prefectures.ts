/**
 * Сорок семь префектур в трёх написаниях.
 *
 * Таблица заведена после поломки: прогон простановки префектур писал
 * в «Prefecture (EN)» то, что вернул Google, а тот при languageCode=en
 * иногда отдаёт японское название. Шесть записей уехали с «京都府»
 * в английском поле. Разбирать ответ внешнего источника «как есть» —
 * значит доверять ему схему; таблица здесь именно затем, чтобы чужой
 * ответ приводился к нашим сорока семи значениям или отвергался.
 *
 * Русские написания — по Поливанову с каноническими исключениями
 * (Токио, Киото; см. POLIVANOV_EXCEPTIONS).
 */
export interface Prefecture {
  en: string
  ru: string
  ja: string
}

export const PREFECTURES: readonly Prefecture[] = [
  { en: 'Hokkaido', ru: 'Хоккайдо', ja: '北海道' },
  { en: 'Aomori', ru: 'Аомори', ja: '青森県' },
  { en: 'Iwate', ru: 'Иватэ', ja: '岩手県' },
  { en: 'Miyagi', ru: 'Мияги', ja: '宮城県' },
  { en: 'Akita', ru: 'Акита', ja: '秋田県' },
  { en: 'Yamagata', ru: 'Ямагата', ja: '山形県' },
  { en: 'Fukushima', ru: 'Фукусима', ja: '福島県' },
  { en: 'Ibaraki', ru: 'Ибараки', ja: '茨城県' },
  { en: 'Tochigi', ru: 'Тотиги', ja: '栃木県' },
  { en: 'Gunma', ru: 'Гумма', ja: '群馬県' },
  { en: 'Saitama', ru: 'Сайтама', ja: '埼玉県' },
  { en: 'Chiba', ru: 'Тиба', ja: '千葉県' },
  { en: 'Tokyo', ru: 'Токио', ja: '東京都' },
  { en: 'Kanagawa', ru: 'Канагава', ja: '神奈川県' },
  { en: 'Niigata', ru: 'Ниигата', ja: '新潟県' },
  { en: 'Toyama', ru: 'Тояма', ja: '富山県' },
  { en: 'Ishikawa', ru: 'Исикава', ja: '石川県' },
  { en: 'Fukui', ru: 'Фукуи', ja: '福井県' },
  { en: 'Yamanashi', ru: 'Яманаси', ja: '山梨県' },
  { en: 'Nagano', ru: 'Нагано', ja: '長野県' },
  { en: 'Gifu', ru: 'Гифу', ja: '岐阜県' },
  { en: 'Shizuoka', ru: 'Сидзуока', ja: '静岡県' },
  { en: 'Aichi', ru: 'Айти', ja: '愛知県' },
  { en: 'Mie', ru: 'Миэ', ja: '三重県' },
  { en: 'Shiga', ru: 'Сига', ja: '滋賀県' },
  { en: 'Kyoto', ru: 'Киото', ja: '京都府' },
  { en: 'Osaka', ru: 'Осака', ja: '大阪府' },
  { en: 'Hyogo', ru: 'Хёго', ja: '兵庫県' },
  { en: 'Nara', ru: 'Нара', ja: '奈良県' },
  { en: 'Wakayama', ru: 'Вакаяма', ja: '和歌山県' },
  { en: 'Tottori', ru: 'Тоттори', ja: '鳥取県' },
  { en: 'Shimane', ru: 'Симанэ', ja: '島根県' },
  { en: 'Okayama', ru: 'Окаяма', ja: '岡山県' },
  { en: 'Hiroshima', ru: 'Хиросима', ja: '広島県' },
  { en: 'Yamaguchi', ru: 'Ямагути', ja: '山口県' },
  { en: 'Tokushima', ru: 'Токусима', ja: '徳島県' },
  { en: 'Kagawa', ru: 'Кагава', ja: '香川県' },
  { en: 'Ehime', ru: 'Эхимэ', ja: '愛媛県' },
  { en: 'Kochi', ru: 'Коти', ja: '高知県' },
  { en: 'Fukuoka', ru: 'Фукуока', ja: '福岡県' },
  { en: 'Saga', ru: 'Сага', ja: '佐賀県' },
  { en: 'Nagasaki', ru: 'Нагасаки', ja: '長崎県' },
  { en: 'Kumamoto', ru: 'Кумамото', ja: '熊本県' },
  { en: 'Oita', ru: 'Оита', ja: '大分県' },
  { en: 'Miyazaki', ru: 'Миядзаки', ja: '宮崎県' },
  { en: 'Kagoshima', ru: 'Кагосима', ja: '鹿児島県' },
  { en: 'Okinawa', ru: 'Окинава', ja: '沖縄県' },
]

const flat = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+(prefecture|-fu|-ken|-to|-do)$/g, '')
    .replace(/[^a-zа-яё　-鿿]/g, '')
    .trim()

/**
 * Приводит любое написание префектуры к нашей паре RU/EN.
 * Возвращает null, если такой префектуры нет — это лучше, чем записать
 * в базу то, чего мы не узнали.
 */
export function canonicalPrefecture(value: string | null | undefined): Prefecture | null {
  const key = flat(String(value ?? ''))
  if (!key) return null
  return (
    PREFECTURES.find((p) => flat(p.en) === key || flat(p.ru) === key || flat(p.ja) === key) ?? null
  )
}
