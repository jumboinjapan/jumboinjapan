import type { AirtablePoi, AirtableRouteStop } from '@/lib/airtable'
import { buildTicketDisplay } from '@/lib/ticket-display'
import type { RouteStop } from '@/components/RouteAccordion'

export interface SellingHighlight {
  title: string
  body: string
}

export type IntercityRouteStopSeedType = 'landmark' | 'nature' | 'gastronomy' | 'transport' | 'museum' | 'cruise' | 'ropeway' | 'volcano' | 'shrine'

export interface IntercityRouteStopSeed extends RouteStop {
  type?: IntercityRouteStopSeedType
  photoPath?: string
  photoAlt?: string
  poiId?: string
  category?: string[]
  tags?: string[]
  sellingHighlights?: SellingHighlight[]
}

export type IntercitySlug =
  | 'enoshima'
  | 'fuji'
  | 'hakone'
  | 'himeji'
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
    'Смотровая башня «Морская свеча»': 'POI-000263',
    'Пещеры Ивая': 'POI-000017',
  },
  fuji: {
    'Пятая станция горы Фудзи': 'POI-000239',
    'Обсерватория на горе Тэндзё': 'POI-000237',
    'Парк Ияси-но Сато': 'POI-000240',
    'Музей кимоно Итику Кубота': 'POI-000234',
  },
  himeji: {
    'Замок Химэдзи': 'POI-000265',
    'Кокоэн': 'POI-000266',
  },
  hakone: {
    'Застава Хаконэ Сэкисё': 'POI-000054',
    'Хаконэ Дзиндзя': 'POI-000041',
    'Круиз по озеру Аси': 'POI-000347',
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
    'Район Хигаси Тчя-гай': 'POI-000210',
    'Музей современного искусства 21 века': 'POI-000212',
  },
  'kyoto-1': {
    'Золотой павильон Кинкакудзи': 'POI-000115',
    'Сад камней Рёандзи': 'POI-000124',
    'Рынок Нисики': 'POI-000123',
    'Храм Киёмидзудэра': 'POI-000119',
    'Квартал Гион': 'POI-000122',
  },
  'kyoto-2': {
    'Гинкакудзи': 'POI-000001',
    'Философская тропа': 'POI-000121',
    'Эйкандо (Зэнрин-дзи)': 'POI-000348',
    'Нандзэн-дзи': 'POI-000129',
    'Храм Тэнрюдзи': 'POI-000118',
    'Арасияма': 'POI-000117',
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
    'Прогулка по чайной улочке к Павильону Феникса': 'POI-000349',
    'Павильон Феникса Бёдо-ин': 'POI-000243',
    'Музей повести о Гэндзи': 'POI-000350',
  },
}

export const hakoneRouteSeed: IntercityRouteStopSeed[] = [
  {
    eyebrow: 'Экскурс в историю',
    title: 'Застава Хаконэ Сэкисё',
    description: '',
    tags: ['История'],
    sellingHighlights: [
      { title: 'Тюремная камера', body: 'Реконструкция камеры для задержанных — неожиданно мрачная деталь формально-туристического места.' },
      { title: 'Кедровая аллея', body: 'Аллея из старых японских кедров ведёт к воротам — лучший момент для фото до открытия касс.' },
    ],
  },
  {
    eyebrow: 'Место силы',
    title: 'Хаконэ Дзиндзя',
    description: '',
    tags: ['Религия'],
    sellingHighlights: [
      { title: 'Тории в воде', body: 'Ворота стоят у самой кромки озера — в туманное утро они исчезают в дымке.' },
      { title: 'Камень взросления', body: 'Камень \'Сэгайши\' — местные верят: перейти через него означает завершить переход во взрослость.' },
    ],
  },
  {
    eyebrow: 'Красоты местной природы',
    title: 'Круиз по озеру Аси',
    description: '',
    photoPath: '/tours/hakone/hakone-2.jpg',
    photoAlt: 'Круиз по озеру Аси, Хаконэ',
    tags: ['Транспорт', 'Озеро'],
    // sellingHighlights absent (transport point)
  },
  {
    eyebrow: 'Подъём',
    title: 'Канатная дорога Хаконэ',
    description: 'Подъём над лесом к вулканической долине Овакудани, откуда открывается вид на Фудзи (при ясной погоде).',
    tags: ['Транспорт', 'СмотроваяПлощадка'],
    sellingHighlights: [
      { title: 'Окно на Фудзи', body: 'Если Фудзи открыт, лучший вид — первые 2 минуты подъёма, до поворота кабины.' },
      { title: 'Промежуточная Овакудани', body: 'Кабина останавливается в Овакудани — выйти здесь, не ехать до конца.' },
    ],
  },
  {
    eyebrow: 'Вулканическая долина',
    title: 'Овакудани',
    description: '',
    photoPath: '/tours/hakone/hakone-3.jpg',
    photoAlt: 'Вулканическая долина Овакудани',
    tags: ['СмотроваяПлощадка'],
    sellingHighlights: [
      { title: 'Кудзётамаго', body: 'Чёрные яйца варятся прямо здесь в серных источниках — одно яйцо, говорят, продлевает жизнь на 7 лет.' },
      { title: 'Вулканическая тропа', body: 'Короткая тропа к кратеру открыта только в хорошую погоду и только по записи — узнать заранее у гида.' },
    ],
  },
  {
    eyebrow: 'Прогулка по парку',
    title: 'Музей "Роща скульптур" под открытым небом',
    description: 'Музей скульптуры под открытым небом в Хаконэ — одна из крупнейших коллекций современного искусства на открытом воздухе в Японии.',
    poiId: 'POI-000038',
    // no tags (avoids duplicate with title)
    sellingHighlights: [
      { title: 'Зал Пикассо и Родена', body: 'Крупнейшая коллекция Пикассо в Японии — внутри закрытого здания, рядом с парком.' },
      { title: 'Стеклянная башня', body: 'Башня из цветного витражного стекла — внутри неё можно подняться, снаружи она светится на закате.' },
    ],
  },
]

function getRoutePoiMap(slug: IntercitySlug) {
  return routePoiIdsBySlug[slug]
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
  routeStops: IntercityRouteStopSeed[],
  pois: AirtablePoi[],
) {
  const poiByPoiId = new Map(pois.map((poi) => [poi.poiId, poi]))
  const routePoiMap = getRoutePoiMap(slug)

  return routeStops.flatMap((stop) => {
    const poiId = routePoiMap[stop.title] ?? stop.poiId
    const airtablePoi = poiId ? poiByPoiId.get(poiId) : undefined

    if (!airtablePoi) return []

    const ticketDisplay = buildTicketDisplay(airtablePoi.tickets)

    return [{
      eyebrow: stop.eyebrow,
      title: airtablePoi.nameRu || stop.title,
      description: airtablePoi.descriptionRu || stop.description,
      workingHours: airtablePoi.workingHours,
      minPrice: ticketDisplay.primaryPrice,
      ticketSummary: ticketDisplay.summary,
      ticketDetails: ticketDisplay.detailLines,
      ticketDisplayLines: ticketDisplay.compactLines,
      photoPath: stop.photoPath,
      photoAlt: stop.photoAlt,
      poiId: airtablePoi.poiId,
      category: airtablePoi.category,
      tags: stop.tags,
      sellingHighlights: stop.sellingHighlights,
    } satisfies IntercityRouteStopSeed
  ]
  })
}

export function getIntercityRouteSeed(slug: IntercitySlug): IntercityRouteStopSeed[] {
  if (slug === 'hakone') {
    return hakoneRouteSeed
  }
  throw new Error(`No route seed defined for slug: ${slug}. Add it to getIntercityRouteSeed in intercity-pois.ts`)
}

export function buildIntercityRouteStopsFromAirtable(
  routeStops: AirtableRouteStop[],
  pois: AirtablePoi[],
): IntercityRouteStopSeed[] {
  const poiByPoiId = new Map(pois.map((poi) => [poi.poiId, poi]))
  return routeStops
    .filter(s => !s.isHelper && s.status !== 'Inactive')
    .sort((a, b) => a.order - b.order)
    .flatMap((stop) => {
      const poi = poiByPoiId.get(stop.poiId)
      if (!poi) return []
      const ticketDisplay = buildTicketDisplay(poi.tickets)
      return [{
        eyebrow: stop.eyebrow || stop.titleOverride || poi.nameRu || stop.poiNameSnapshot,
        title: stop.titleOverride || poi.nameRu || stop.poiNameSnapshot,
        description: stop.descriptionOverride || poi.descriptionRu || '',
        workingHours: poi.workingHours,
        minPrice: ticketDisplay.primaryPrice,
        ticketSummary: ticketDisplay.summary,
        ticketDetails: ticketDisplay.detailLines,
        ticketDisplayLines: ticketDisplay.compactLines,
        photoPath: stop.photoPath || undefined,
        photoAlt: stop.photoAlt || undefined,
        poiId: poi.poiId,
        category: poi.category,
        tags: stop.tags.length > 0 ? stop.tags : undefined,
        sellingHighlights: stop.sellingHighlights.length > 0 ? stop.sellingHighlights : undefined,
        type: (stop.stopType as any) || undefined,
      } satisfies IntercityRouteStopSeed]
    })
}

export function buildHelperPoisFromAirtable(
  routeStops: AirtableRouteStop[],
  pois: AirtablePoi[],
): { poi: AirtablePoi; criteriaLabel: string }[] {
  const poiByPoiId = new Map(pois.map((poi) => [poi.poiId, poi]))
  return routeStops
    .filter(s => s.isHelper && s.status !== 'Inactive')
    .sort((a, b) => a.order - b.order)
    .flatMap((stop) => {
      const poi = poiByPoiId.get(stop.poiId)
      if (!poi) return []
      return [{ poi, criteriaLabel: stop.helperCriteriaLabel || stop.eyebrow || 'Можно добавить' }]
    })
}

// Note: hakoneRouteSeed kept for other intercity routes not yet migrated to Airtable
