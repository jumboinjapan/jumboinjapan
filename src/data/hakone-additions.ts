import type { TourAddition } from '@/components/sections/TourAdditions'

// Existing POI identities. Names and approved descriptions are read from Airtable.
export const hakoneMuseumPoiIds = ['POI-000042', 'POI-000367'] as const

// Editorial entries for the local design review; these are not registered POIs.
// Replace with POI references when the builder's optional groups are connected.
// Sources checked 2026-09-20; see docs/design/hakone-additions.md.
export const hakoneOnsen: TourAddition = {
  id: 'hakone-tenseien',
  title: 'Термальные источники Tenseien',
  description: 'Купальни при отеле в Хаконе-Юмото принимают гостей и без ночёвки. Здесь можно сделать паузу в поездке и отдохнуть в горячей воде под открытым небом.',
  note: 'В Tenseien не допускают гостей с татуировками или временными тату-наклейками.',
  website: 'https://www.tenseien.co.jp/dayuse/',
}

export const hakoneLunch: TourAddition[] = [
  {
    id: 'hakone-kihinkan',
    title: 'Kihinkan — соба в исторической вилле',
    description: 'Гречневую лапшу соба подают в бывшей вилле семьи Фудзита, построенной в 1918 году. Деревянный дом и вид на японский сад делают обед отдельной остановкой в маршруте.',
    website: 'https://www.hakonekowakien-mikawaya.jp/kihinkan.html',
  },
  {
    id: 'hakone-kaikatei',
    title: 'Kaikatei — обед у сада музея Окада',
    description: 'Ресторан в старом японском доме на территории музея Окада. Здесь подают удон — толстую пшеничную лапшу, а за окнами видны сад и пруд с карпами.',
    website: 'https://www.okada-museum.com/en/facilities/restaurant_kaikatei/',
  },
]
