export type MultiDayBuilderDayType = 'arrival' | 'touring' | 'departure' | 'independent'
export type MultiDayBuilderItemType = 'poi' | 'transport' | 'hotel' | 'meal' | 'note' | 'arrival' | 'departure' | 'day_block'
export type MultiDayTransportMode = 'walk' | 'train' | 'shinkansen' | 'bus' | 'car' | 'flight' | 'mixed'

/**
 * Как происходит выезд к станции/аэропорту ('' — не задано). Гид —
 * ОТДЕЛЬНАЯ переменная (departureWithGuide): любой способ может быть
 * с гидом или без; без гида выезд считается самостоятельным.
 * 'private' — частный транспорт (гид-водитель; эту формулировку НИКОГДА
 * не произносим публично по юридическим соображениям — только
 * «частный транспорт»).
 */
export type TransportDepartureMode = '' | 'public_transport' | 'chartered' | 'private'

export interface MultiDayBuilderTransportSegment {
  id: string
  order: number
  fromLocation: string
  toLocation: string
  mode: MultiDayTransportMode
  durationMinutes: number | null
  estimatedCostMin: number | null
  estimatedCostMax: number | null
  costBasis: 'manual' | 'heuristic' | 'api'
  pricingProvider: string
  pricingConfidence: 'low' | 'medium' | 'high'
  reservationNote: string
  baggageNote: string
  displayLabel: string
  displayLabelEn: string
  internalNotes: string
  /** Вариант переезда дня (до 3 на день: ЖД/Авиа/Авто) — номер рейса/поезда */
  serviceNumber: string
  /** Как выезжаем к станции/аэропорту */
  departureMode: TransportDepartureMode
  /** Выезд сопровождает гид; false = самостоятельно */
  departureWithGuide: boolean
  /** Рекомендуемое время выезда из отеля, например «08:30» */
  recommendedDepartureTime: string
  /** ПУБЛИЧНЫЙ комментарий для гостей к этому варианту */
  guestComments: string
}

export interface MultiDayBuilderDayItem {
  id: string
  order: number
  itemType: MultiDayBuilderItemType
  displayTitle: string
  displayTitleEn: string
  shortDescription: string
  shortDescriptionEn: string
  sourceMode: 'generated' | 'manual'
  locked: boolean
  poiTitle: string
  transportSegmentId: string | null
  internalNotes: string
}

export interface MultiDayBuilderDay {
  id: string
  dayNumber: number
  dayType: MultiDayBuilderDayType
  dayTitle: string
  dayTitleEn: string
  daySummary: string
  daySummaryEn: string
  overnightCity: string
  /** Номер рейса прилёта (только для дней типа arrival), например SU262 */
  arrivalFlightNumber: string
  /** Номер рейса вылета (только для дней типа departure); аэропорт вылета — endLocation (IATA-код) */
  departureFlightNumber: string
  derivedRegions: string[]
  primaryRegionOverride: string
  startLocation: string
  endLocation: string
  displayStatus: 'Generated' | 'Edited' | 'Locked'
  printLead: string
  printFooterNote: string
  items: MultiDayBuilderDayItem[]
  transportSegments: MultiDayBuilderTransportSegment[]
}

export interface MultiDayBuilderRoute {
  id: string
  title: string
  titleEn: string
  slug: string
  routeType: 'multi-day'
  status: 'Draft' | 'Review' | 'Published' | 'Archived'
  dayCount: number
  /** Дата начала тура (день 1), ISO YYYY-MM-DD; '' если даты не заданы. День N = startDate + (N-1). */
  startDate: string
  /** Когда маршрут последний раз сохранялся конструктором (ISO); заполняется при загрузке из Airtable */
  lastBuilderSync?: string
  /** Обложка для карточки на хабе и hero страницы: путь в /public или URL; '' — дефолт раздела */
  heroImagePath: string
  startCityId: string
  startCity: string
  endCityId: string
  endCity: string
  previewTitle: string
  previewSubtitle: string
  days: MultiDayBuilderDay[]
}

export interface MultiDayBuilderInput {
  titleRu: string
  titleEn: string
  dayCount: number
  startCityId?: string
  startCityLabel?: string
  endCityId?: string
  endCityLabel?: string
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function buildTouringSummary(dayNumber: number) {
  return `День ${dayNumber} готов к заполнению.`
}

function normalizeDayItems(items: MultiDayBuilderDayItem[]) {
  return items.map((item, index) => ({
    ...item,
    order: index + 1,
  }))
}

function normalizeTransportSegments(segments: MultiDayBuilderTransportSegment[]) {
  return segments.map((segment, index) => ({
    ...segment,
    order: index + 1,
  }))
}

function getDefaultDayTitle(dayType: MultiDayBuilderDayType, dayNumber: number) {
  if (dayType === 'arrival') return 'День прилёта'
  if (dayType === 'departure') return 'День отъезда'
  return `День ${dayNumber}`
}

function getDefaultDaySummary(dayType: MultiDayBuilderDayType, dayNumber: number) {
  if (dayType === 'arrival') return 'День прилёта — заполните программу.'
  if (dayType === 'departure') return 'День отъезда — заполните программу.'
  return buildTouringSummary(dayNumber)
}

function createGeneratedItem(
  dayNumber: number,
  itemType: MultiDayBuilderItemType,
  displayTitle: string,
  shortDescription: string,
  displayTitleEn = '',
  shortDescriptionEn = '',
): MultiDayBuilderDayItem {
  return {
    id: `day-${dayNumber}-${itemType}-${Math.random().toString(36).slice(2, 8)}`,
    order: 1,
    itemType,
    displayTitle,
    displayTitleEn,
    shortDescription,
    shortDescriptionEn,
    sourceMode: 'generated',
    locked: false,
    poiTitle: '',
    transportSegmentId: null,
    internalNotes: '',
  }
}

export function buildMultiDaySkeleton(input: MultiDayBuilderInput): MultiDayBuilderRoute {
  const title = input.titleRu.trim() || 'Новый многодневный маршрут'
  const titleEn = input.titleEn.trim() || 'new-multi-day-route'
  const dayCount = Math.min(Math.max(Math.round(input.dayCount) || 2, 2), 21)
  const startCityId = input.startCityId?.trim() ?? ''
  const startCity = input.startCityLabel?.trim() ?? ''
  const endCityId = input.endCityId?.trim() ?? ''
  const endCity = input.endCityLabel?.trim() ?? ''

  const days: MultiDayBuilderDay[] = Array.from({ length: dayCount }, (_, index) => {
    const dayNumber = index + 1
    const isArrival = dayNumber === 1
    const isDeparture = dayNumber === dayCount
    const dayType: MultiDayBuilderDayType = isArrival ? 'arrival' : isDeparture ? 'departure' : 'touring'

    const startLocation = isArrival ? startCity : ''
    const endLocation = isDeparture ? endCity : ''
    const overnightCity = isArrival ? startCity : isDeparture ? '—' : ''

    const transportSegments: MultiDayBuilderTransportSegment[] =
      dayType === 'touring'
        ? [
            {
              id: `transport-${dayNumber}-1`,
              order: 1,
              fromLocation: '',
              toLocation: '',
              mode: 'train',
              durationMinutes: null,
              estimatedCostMin: null,
              estimatedCostMax: null,
              costBasis: 'heuristic',
              pricingProvider: '',
              pricingConfidence: 'low',
              reservationNote: '',
              baggageNote: '',
              displayLabel: 'Блок транспорта',
              displayLabelEn: 'Transport block',
              internalNotes: '',
              serviceNumber: '',
              departureMode: '',
              departureWithGuide: false,
              recommendedDepartureTime: '',
              guestComments: '',
            },
          ]
        : []

    const items =
      dayType === 'arrival'
        ? [
            // Только сам прилёт: трансфер, заселение и прочая логистика —
            // отдельные блоки (у разных групп день строится по-разному:
            // после прилёта может быть и экскурсия, и самостоятельный
            // трансфер, и заказной транспорт). Заглушки «Ночёвка» больше нет:
            // отель добавляется поиском, заселение — служебным POI-000441/442,
            // чей заголовок сам подтягивает название отеля дня.
            createGeneratedItem(dayNumber, 'arrival', 'День прилёта', ''),
          ]
        : dayType === 'departure'
          ? [createGeneratedItem(dayNumber, 'departure', 'День отъезда', '')]
          : []

    return {
      id: `route-day-${dayNumber}`,
      dayNumber,
      dayType,
      dayTitle: isArrival ? 'День прилёта' : isDeparture ? 'День отъезда' : `День ${dayNumber}`,
      dayTitleEn: isArrival ? 'Arrival day' : isDeparture ? 'Departure day' : `Day ${dayNumber}`,
      daySummary:
        dayType === 'arrival'
          ? 'День прилёта — заполните программу.'
          : dayType === 'departure'
            ? 'День отъезда — заполните программу.'
            : buildTouringSummary(dayNumber),
      daySummaryEn:
        dayType === 'arrival'
          ? 'Arrival day — fill in the program.'
          : dayType === 'departure'
            ? 'Departure day — fill in the program.'
            : `Day ${dayNumber} is ready to be filled in.`,
      overnightCity,
      arrivalFlightNumber: '',
      departureFlightNumber: '',
      derivedRegions: [],
      primaryRegionOverride: '',
      startLocation,
      endLocation,
      displayStatus: 'Generated',
      printLead: '',
      printFooterNote: '',
      items,
      transportSegments,
    }
  })

  return {
    id: `multi-day-${Date.now()}`,
    title,
    titleEn,
    // Если в EN-названии уже есть «...-7-days», не дублируем хвост:
    // «classic-japan-7-days» + 7 дней → multi-day/classic-japan-7-days,
    // а не classic-japan-7-days-7-days.
    slug: `multi-day/${(slugify(titleEn) || 'new-route').replace(/-\d+-days$/, '')}-${dayCount}-days`,
    routeType: 'multi-day',
    status: 'Draft',
    dayCount,
    startDate: '',
    heroImagePath: '',
    startCityId,
    startCity,
    endCityId,
    endCity,
    previewTitle: title,
    // Пусто, а не заглушка: previewSubtitle — публичный текст (подпись
    // карточки на /multi-day и hero страницы тура). «Черновик многодневного
    // маршрута» однажды утёк на прод; при пустом значении фронт подставляет
    // нейтральный фолбэк, а реальный текст задаётся в Параметрах маршрута.
    previewSubtitle: '',
    days,
  }
}

// Пустой экскурсионный день для вставки при росте числа дней. Случайный
// суффикс в id транспортного блока обязателен: идентичность Transport
// Segment ID в Airtable уникальна в рамках маршрута, а «transport-N-1»
// после перенумерации дней мог совпасть с уже существующим блоком.
function createEmptyTouringDay(dayNumber: number): MultiDayBuilderDay {
  return {
    id: `route-day-${dayNumber}-${Math.random().toString(36).slice(2, 8)}`,
    dayNumber,
    dayType: 'touring',
    dayTitle: `День ${dayNumber}`,
    dayTitleEn: `Day ${dayNumber}`,
    daySummary: buildTouringSummary(dayNumber),
    daySummaryEn: `Day ${dayNumber} is ready to be filled in.`,
    overnightCity: '',
    arrivalFlightNumber: '',
    departureFlightNumber: '',
    derivedRegions: [],
    primaryRegionOverride: '',
    startLocation: '',
    endLocation: '',
    displayStatus: 'Generated',
    printLead: '',
    printFooterNote: '',
    items: [],
    transportSegments: [
      {
        id: `transport-${dayNumber}-1-${Math.random().toString(36).slice(2, 6)}`,
        order: 1,
        fromLocation: '',
        toLocation: '',
        mode: 'train',
        durationMinutes: null,
        estimatedCostMin: null,
        estimatedCostMax: null,
        costBasis: 'heuristic',
        pricingProvider: '',
        pricingConfidence: 'low',
        reservationNote: '',
        baggageNote: '',
        displayLabel: 'Блок транспорта',
        displayLabelEn: 'Transport block',
        internalNotes: '',
        serviceNumber: '',
        departureMode: '',
        departureWithGuide: false,
        recommendedDepartureTime: '',
        guestComments: '',
      },
    ],
  }
}

function getDefaultDayTitleEn(dayType: MultiDayBuilderDayType, dayNumber: number) {
  if (dayType === 'arrival') return 'Arrival day'
  if (dayType === 'departure') return 'Departure day'
  return `Day ${dayNumber}`
}

function getDefaultDaySummaryEn(dayType: MultiDayBuilderDayType, dayNumber: number) {
  if (dayType === 'arrival') return 'Arrival day — fill in the program.'
  if (dayType === 'departure') return 'Departure day — fill in the program.'
  return `Day ${dayNumber} is ready to be filled in.`
}

export function reconcileMultiDayRoute(route: MultiDayBuilderRoute, input: MultiDayBuilderInput): MultiDayBuilderRoute {
  const skeleton = buildMultiDaySkeleton(input)
  const targetCount = skeleton.dayCount

  // ── Ресайз по правилам владельца (2026-07-11) ──
  // Раньше дни сопоставлялись со скелетоном ПО ИНДЕКСУ: при росте день
  // вылета превращался в экскурсионный посреди маршрута, при сокращении
  // контент резался с конца вместе с вылетом, а тип дня («самостоятельно»)
  // сбрасывался при каждом сохранении. Теперь:
  //   • больше дней  → пустые экскурсионные дни встают В КОНЦЕ, но ПЕРЕД
  //     днём вылета; вся программа существующих дней остаётся как есть;
  //   • меньше дней  → удаляются дни непосредственно перед вылетом;
  //   • прилёт и вылет неприкосновенны (контент, рейсы, аэропорты);
  //   • тип дня — решение владельца и не пересчитывается.
  const existingDays = [...route.days].sort((left, right) => left.dayNumber - right.dayNumber)
  const hasDeparture = existingDays.length > 0 && existingDays[existingDays.length - 1].dayType === 'departure'
  const resized = [...existingDays]

  if (targetCount > resized.length) {
    const fresh: MultiDayBuilderDay[] = []
    for (let n = resized.length; n < targetCount; n += 1) {
      fresh.push(createEmptyTouringDay(n + 1))
    }
    resized.splice(hasDeparture ? resized.length - 1 : resized.length, 0, ...fresh)
  } else if (targetCount < resized.length) {
    let toRemove = resized.length - targetCount
    for (let index = resized.length - (hasDeparture ? 2 : 1); index >= 0 && toRemove > 0; index -= 1) {
      const candidate = resized[index]
      if (candidate.dayType === 'arrival' || candidate.dayType === 'departure') continue
      resized.splice(index, 1)
      toRemove -= 1
    }
  }

  // ── Перенумерация: содержимое дня едет со своим днём, дефолтные
  // заголовки/описания подтягиваются к новому номеру, кастомные — не трогаем.
  const usedIds = new Set<string>()
  const days = resized.map((existingDay, index) => {
    const dayNumber = index + 1
    const oldDefaultTitle = getDefaultDayTitle(existingDay.dayType, existingDay.dayNumber)
    const oldDefaultSummary = getDefaultDaySummary(existingDay.dayType, existingDay.dayNumber)
    const keepCustomTitle = existingDay.dayTitle.trim() && existingDay.dayTitle !== oldDefaultTitle
    const keepCustomSummary = existingDay.daySummary.trim() && existingDay.daySummary !== oldDefaultSummary
    const structureChanged = existingDay.dayNumber !== dayNumber

    let id = existingDay.id || `route-day-${dayNumber}`
    while (usedIds.has(id)) id = `route-day-${dayNumber}-${Math.random().toString(36).slice(2, 6)}`
    usedIds.add(id)

    return {
      ...existingDay,
      id,
      dayNumber,
      dayTitle: keepCustomTitle ? existingDay.dayTitle : getDefaultDayTitle(existingDay.dayType, dayNumber),
      dayTitleEn: existingDay.dayTitleEn?.trim() ? existingDay.dayTitleEn : getDefaultDayTitleEn(existingDay.dayType, dayNumber),
      daySummary: keepCustomSummary ? existingDay.daySummary : getDefaultDaySummary(existingDay.dayType, dayNumber),
      daySummaryEn: existingDay.daySummaryEn?.trim() ? existingDay.daySummaryEn : getDefaultDaySummaryEn(existingDay.dayType, dayNumber),
      arrivalFlightNumber: existingDay.arrivalFlightNumber ?? '',
      departureFlightNumber: existingDay.departureFlightNumber ?? '',
      items: normalizeDayItems(existingDay.items),
      transportSegments: normalizeTransportSegments(existingDay.transportSegments),
      displayStatus: structureChanged && existingDay.displayStatus === 'Generated' ? ('Edited' as const) : existingDay.displayStatus,
    }
  })

  return {
    ...route,
    title: skeleton.title,
    titleEn: skeleton.titleEn,
    slug: skeleton.slug,
    dayCount: skeleton.dayCount,
    startCityId: skeleton.startCityId,
    startCity: skeleton.startCity,
    endCityId: skeleton.endCityId,
    endCity: skeleton.endCity,
    previewTitle: skeleton.previewTitle,
    previewSubtitle: route.previewSubtitle || skeleton.previewSubtitle,
    days,
  }
}
