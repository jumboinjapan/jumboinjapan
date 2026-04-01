import type { AirtablePoi } from '@/lib/airtable'
import type { RouteStop } from '@/components/RouteAccordion'

export type IntercitySlug =
  | 'enoshima'
  | 'fuji'
  | 'hakone'
  | 'kamakura'
  | 'kanazawa'
  | 'kyoto-1'
  | 'kyoto-2'
  | 'nara'
  | 'nikko'
  | 'osaka'
  | 'uji'

const routePoiIdsBySlug: Record<IntercitySlug, Record<string, string>> = {
  enoshima: {
    'Святилище Эносима': 'POI-000015',
    'Сад Самуэля Кокинга': 'POI-000016',
    'Смотровая башня «Морская свеча»': 'POI-000016',
    'Пещеры Ивая': 'POI-000017',
  },
  fuji: {
    'Пятая станция горы Фудзи': 'POI-000239',
    'Обсерватория на горе Тэндзё': 'POI-000237',
    'Парк Ияси-но Сато': 'POI-000240',
    'Музей кимоно Итику Кубота': 'POI-000234',
  },
  hakone: {
    'Застава Хаконэ Сэкисё': 'POI-000054',
    'Хаконэ Дзиндзя': 'POI-000041',
    'Канатная дорога Хаконэ': 'POI-000047',
    'Овакудани': 'POI-000039',
    'Музей под открытым небом Хаконэ': 'POI-000038',
  },
  kamakura: {
    'Улица Комати-дори в Камакуре': 'POI-000264',
    'Святилище Цуругаока Хатимангу': 'POI-000021',
    'Большой Будда — Дайбуцу': 'POI-000019',
    'Буддийский храм Хасэ-дэра': 'POI-000020',
  },
  kanazawa: {
    'Сад Кэнрокуэн': 'POI-000208',
    'Замок Канадзава': 'POI-000209',
    'Рыбный рынок Омитё': 'POI-000214',
    'Район Хигаси Тяя-гай': 'POI-000210',
    'Музей современного искусства 21 века': 'POI-000212',
  },
  'kyoto-1': {
    'Золотой павильон Кинкакудзи': 'POI-000115',
    'Сад камней Рёандзи': 'POI-000124',
    'Рынок Нисики': 'POI-000123',
    'Квартал Гион': 'POI-000122',
  },
  'kyoto-2': {
    'Гинкакудзи': 'POI-000001',
    'Философская тропа': 'POI-000121',
    'Нандзэн-дзи': 'POI-000129',
  },
  nara: {
    'Парк Нара. Кормление оленей': 'POI-000201',
    'Храм Тодайдзи': 'POI-000200',
    'Касуга Тайся — святилище тысячи фонарей': 'POI-000202',
  },
  nikko: {
    'Священный мост Синкё': 'POI-000227',
    'Святилище Тосёгу': 'POI-000217',
    'Аллея исчезающих Будд «Канмангафути»': 'POI-000159',
    'Горное озеро Тюдзэндзи': 'POI-000220',
    'Водопад Кэгон': 'POI-000225',
  },
  osaka: {
    'Океанариум Каиюкан': 'POI-000186',
    'Осакский замок': 'POI-000182',
    'Квартал Дотонбори': 'POI-000183',
  },
  uji: {
    'Павильон Феникса Бёдо-ин': 'POI-000243',
  },
}

function getRoutePoiMap(slug: IntercitySlug) {
  return routePoiIdsBySlug[slug]
}

function normalizeText(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/[«»"'“”„.,!?…:;()\-–—]/g, '')
    .replace(/\s+/g, ' ')
}

function isUsefulPoiDescription(description: string, title: string) {
  const normalizedDescription = normalizeText(description)
  const normalizedTitle = normalizeText(title)

  if (!normalizedDescription) return false
  if (normalizedDescription === normalizedTitle) return false
  if (normalizedDescription.length < 80) return false

  return true
}

export function getIntercityRoutePoiIds(slug: IntercitySlug) {
  return [...new Set(Object.values(getRoutePoiMap(slug)))]
}

export function getIntercityHelperPois(slug: IntercitySlug, pois: AirtablePoi[]) {
  const routePoiIds = new Set(getIntercityRoutePoiIds(slug))
  return pois.filter((poi) => !routePoiIds.has(poi.poiId))
}

export function buildIntercityRouteStops(
  slug: IntercitySlug,
  routeStops: RouteStop[],
  pois: AirtablePoi[],
) {
  const poiByPoiId = new Map(pois.map((poi) => [poi.poiId, poi]))
  const routePoiMap = getRoutePoiMap(slug)

  return routeStops.map((stop) => {
    const poiId = routePoiMap[stop.title]
    const airtablePoi = poiId ? poiByPoiId.get(poiId) : undefined
    const fallbackTitle = stop.title
    const fallbackDescription = stop.description
    const airtableTitle = airtablePoi?.nameRu?.trim() ?? ''
    const airtableDescription = airtablePoi?.descriptionRu?.trim() ?? ''

    return {
      eyebrow: stop.eyebrow,
      title: airtableTitle || fallbackTitle,
      description: isUsefulPoiDescription(airtableDescription, airtableTitle || fallbackTitle)
        ? airtableDescription
        : fallbackDescription,
      workingHours: airtablePoi?.workingHours,
      minPrice: airtablePoi?.tickets.length
        ? Math.min(...airtablePoi.tickets.map((ticket) => ticket.price))
        : null,
    } satisfies RouteStop
  })
}
