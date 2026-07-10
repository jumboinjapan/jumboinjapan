export type MultiDayBuilderDayType = 'arrival' | 'touring' | 'departure' | 'independent'
export type MultiDayBuilderItemType = 'poi' | 'transport' | 'hotel' | 'meal' | 'note' | 'arrival' | 'departure' | 'day_block'
export type MultiDayTransportMode = 'walk' | 'train' | 'shinkansen' | 'bus' | 'car' | 'flight' | 'mixed'

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

function slugify(value: string) {
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
    slug: `multi-day/${slugify(titleEn) || 'new-route'}-${dayCount}-days`,
    routeType: 'multi-day',
    status: 'Draft',
    dayCount,
    startDate: '',
    startCityId,
    startCity,
    endCityId,
    endCity,
    previewTitle: title,
    previewSubtitle: 'Черновик многодневного маршрута',
    days,
  }
}

export function reconcileMultiDayRoute(route: MultiDayBuilderRoute, input: MultiDayBuilderInput): MultiDayBuilderRoute {
  const skeleton = buildMultiDaySkeleton(input)

  const days = skeleton.days.map((skeletonDay, index) => {
    const existingDay = route.days[index]
    if (!existingDay) return skeletonDay

    const existingDefaultTitle = getDefaultDayTitle(existingDay.dayType, existingDay.dayNumber)
    const existingDefaultSummary = getDefaultDaySummary(existingDay.dayType, existingDay.dayNumber)
    const keepCustomTitle = existingDay.dayTitle.trim() && existingDay.dayTitle !== existingDefaultTitle
    const keepCustomSummary = existingDay.daySummary.trim() && existingDay.daySummary !== existingDefaultSummary
    const structureChanged = existingDay.dayNumber !== skeletonDay.dayNumber || existingDay.dayType !== skeletonDay.dayType

    return {
      ...existingDay,
      id: existingDay.id || skeletonDay.id,
      dayNumber: skeletonDay.dayNumber,
      dayType: skeletonDay.dayType,
      dayTitle: keepCustomTitle ? existingDay.dayTitle : skeletonDay.dayTitle,
      dayTitleEn: existingDay.dayTitleEn || skeletonDay.dayTitleEn,
      daySummary: keepCustomSummary ? existingDay.daySummary : skeletonDay.daySummary,
      daySummaryEn: existingDay.daySummaryEn || skeletonDay.daySummaryEn,
      startLocation: skeletonDay.dayType === 'arrival' ? existingDay.startLocation || skeletonDay.startLocation : existingDay.startLocation,
      arrivalFlightNumber: existingDay.arrivalFlightNumber ?? '',
      departureFlightNumber: existingDay.departureFlightNumber ?? '',
      endLocation: skeletonDay.dayType === 'departure' ? existingDay.endLocation || skeletonDay.endLocation : existingDay.endLocation,
      items: normalizeDayItems(existingDay.items),
      transportSegments: normalizeTransportSegments(existingDay.transportSegments),
      displayStatus: structureChanged && existingDay.displayStatus === 'Generated' ? 'Edited' : existingDay.displayStatus,
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
