// Международные аэропорты Японии, сгруппированные по регионам (Kanto,
// Kansai, Chūbu, Tōhoku, Chūgoku, Shikoku, Kyūshū, Hokkaido, Okinawa).
// Источник истины по кодам — Airtable Regions.«Airport Codes»
// (fldeMgFOLAxISB73q), собранный research'ем 2026-07-10. Список здесь —
// ручная синхронизация для клиентского UI Конструктора тура (день прилёта):
// обновлять оба места одновременно, если состав аэропортов меняется.
export interface AirportOption {
  code: string
  nameRu: string
  nameEn: string
  regionRu: string
}

export const JAPAN_INTERNATIONAL_AIRPORTS: AirportOption[] = [
  { code: 'NRT', nameRu: 'Нарита', nameEn: 'Narita', regionRu: 'Канто' },
  { code: 'HND', nameRu: 'Ханэда', nameEn: 'Haneda', regionRu: 'Канто' },
  { code: 'IBR', nameRu: 'Ибараки', nameEn: 'Ibaraki', regionRu: 'Канто' },
  { code: 'KIX', nameRu: 'Кансай', nameEn: 'Kansai', regionRu: 'Кансай' },
  { code: 'NGO', nameRu: 'Тюбу Сентрэр (Нагоя)', nameEn: 'Chubu Centrair (Nagoya)', regionRu: 'Тюбу' },
  { code: 'KMQ', nameRu: 'Комацу', nameEn: 'Komatsu', regionRu: 'Тюбу' },
  { code: 'FSZ', nameRu: 'Сидзуока', nameEn: 'Shizuoka', regionRu: 'Тюбу' },
  { code: 'KIJ', nameRu: 'Ниигата', nameEn: 'Niigata', regionRu: 'Тюбу' },
  { code: 'TOY', nameRu: 'Тояма', nameEn: 'Toyama', regionRu: 'Тюбу' },
  { code: 'SDJ', nameRu: 'Сендай', nameEn: 'Sendai', regionRu: 'Тохоку' },
  { code: 'AOJ', nameRu: 'Аомори', nameEn: 'Aomori', regionRu: 'Тохоку' },
  { code: 'AXT', nameRu: 'Акита', nameEn: 'Akita', regionRu: 'Тохоку' },
  { code: 'FKS', nameRu: 'Фукусима', nameEn: 'Fukushima', regionRu: 'Тохоку' },
  { code: 'HIJ', nameRu: 'Хиросима', nameEn: 'Hiroshima', regionRu: 'Тюгоку' },
  { code: 'OKJ', nameRu: 'Окаяма', nameEn: 'Okayama', regionRu: 'Тюгоку' },
  { code: 'YGJ', nameRu: 'Ёнаго (Михо)', nameEn: 'Yonago (Miho)', regionRu: 'Тюгоку' },
  { code: 'TAK', nameRu: 'Такамацу', nameEn: 'Takamatsu', regionRu: 'Сикоку' },
  { code: 'MYJ', nameRu: 'Мацуяма', nameEn: 'Matsuyama', regionRu: 'Сикоку' },
  { code: 'KCZ', nameRu: 'Коти', nameEn: 'Kochi', regionRu: 'Сикоку' },
  { code: 'FUK', nameRu: 'Фукуока', nameEn: 'Fukuoka', regionRu: 'Кюсю' },
  { code: 'KOJ', nameRu: 'Кагосима', nameEn: 'Kagoshima', regionRu: 'Кюсю' },
  { code: 'KMJ', nameRu: 'Кумамото', nameEn: 'Kumamoto', regionRu: 'Кюсю' },
  { code: 'HSG', nameRu: 'Сага', nameEn: 'Saga', regionRu: 'Кюсю' },
  { code: 'KKJ', nameRu: 'Китакюсю', nameEn: 'Kitakyushu', regionRu: 'Кюсю' },
  { code: 'OIT', nameRu: 'Оита', nameEn: 'Oita', regionRu: 'Кюсю' },
  { code: 'CTS', nameRu: 'Титосэ (Саппоро)', nameEn: 'New Chitose (Sapporo)', regionRu: 'Хоккайдо' },
  { code: 'HKD', nameRu: 'Хакодате', nameEn: 'Hakodate', regionRu: 'Хоккайдо' },
  { code: 'OKA', nameRu: 'Наха', nameEn: 'Naha', regionRu: 'Окинава' },
]

export function getAirportLabel(code: string): string {
  const airport = JAPAN_INTERNATIONAL_AIRPORTS.find((item) => item.code === code)
  return airport ? airport.nameRu : code
}

export function getAirportLabelEn(code: string): string {
  const airport = JAPAN_INTERNATIONAL_AIRPORTS.find((item) => item.code === code)
  return airport ? airport.nameEn : code
}
