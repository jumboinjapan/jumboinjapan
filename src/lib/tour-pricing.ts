import type {
  MultiDayBuilderDay,
  MultiDayBuilderRoute,
  RoutePricingData,
  TourDayPricingFormat,
  TourPricingRateKey,
} from '@/lib/multi-day-builder'

/**
 * Расчёт стоимости тура (2026-07-14, задание владельца).
 *
 * Матрица базовых ставок живёт в Airtable (таблица Pricing, ключ Rate Key) и
 * редактируется в админке; здесь — чистая логика: вывод формата дня из данных
 * программы, подсчёт ночёвок гида вне Токио и сборка финальной таблицы.
 *
 * Деньги в USD. Вся математика — целые доллары; копейки в этом бизнесе не нужны.
 */

export interface TourPricingRate {
  key: TourPricingRateKey
  label: string
  amount: number
  currency: string
  unit: string
}

export type TourPricingMatrix = Record<TourPricingRateKey, TourPricingRate>

/**
 * Fallback, если таблица Pricing недоступна или строка удалена: ставки
 * владельца на момент внедрения. Канон — Airtable; эти числа только страхуют
 * расчёт от пустого экрана.
 */
export const FALLBACK_PRICING_MATRIX: TourPricingMatrix = {
  guide_day: { key: 'guide_day', label: 'Работа гида (без транспорта)', amount: 500, currency: 'USD', unit: 'день' },
  guide_day_private_transport: {
    key: 'guide_day_private_transport',
    label: 'Работа гида, частный транспорт',
    amount: 1000,
    currency: 'USD',
    unit: 'день',
  },
  guide_night_outside_tokyo: {
    key: 'guide_night_outside_tokyo',
    label: 'Проживание гида по маршруту',
    amount: 150,
    currency: 'USD',
    unit: 'ночь',
  },
}

export const PRICING_RATE_KEYS: TourPricingRateKey[] = [
  'guide_day',
  'guide_day_private_transport',
  'guide_night_outside_tokyo',
]

export const DAY_FORMAT_LABELS: Record<TourDayPricingFormat, string> = {
  no_guide: 'Без гида',
  guide_day: 'Гид (без транспорта)',
  guide_day_private_transport: 'Гид + частный транспорт',
}

export function createEmptyRoutePricingData(): RoutePricingData {
  return {
    paxCount: null,
    rates: {},
    dayFormatOverrides: {},
    nightOverrides: {},
    extraLines: [],
    includeInPdf: true,
  }
}

function isDayFormat(value: unknown): value is TourDayPricingFormat {
  return value === 'no_guide' || value === 'guide_day' || value === 'guide_day_private_transport'
}

function toFiniteOrNull(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

/**
 * Санитайзер JSON из Routes.'Pricing Data' (и из тела POST конструктора):
 * битое/чужое содержимое не должно ронять загрузку маршрута — возвращаем
 * дефолты по каждому полю отдельно.
 */
export function parseRoutePricingData(raw: unknown): RoutePricingData | null {
  let source: unknown = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return null
    try {
      source = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof source !== 'object' || source === null) return null
  const record = source as Record<string, unknown>
  const result = createEmptyRoutePricingData()

  const pax = toFiniteOrNull(record.paxCount)
  result.paxCount = pax !== null && pax >= 1 ? Math.round(pax) : null

  if (typeof record.rates === 'object' && record.rates !== null) {
    for (const key of PRICING_RATE_KEYS) {
      const value = toFiniteOrNull((record.rates as Record<string, unknown>)[key])
      if (value !== null && value >= 0) result.rates[key] = value
    }
  }

  if (typeof record.dayFormatOverrides === 'object' && record.dayFormatOverrides !== null) {
    for (const [dayKey, value] of Object.entries(record.dayFormatOverrides as Record<string, unknown>)) {
      if (isDayFormat(value)) result.dayFormatOverrides[dayKey] = value
    }
  }

  if (typeof record.nightOverrides === 'object' && record.nightOverrides !== null) {
    for (const [dayKey, value] of Object.entries(record.nightOverrides as Record<string, unknown>)) {
      if (typeof value === 'boolean') result.nightOverrides[dayKey] = value
    }
  }

  if (Array.isArray(record.extraLines)) {
    result.extraLines = record.extraLines
      .filter((line): line is Record<string, unknown> => typeof line === 'object' && line !== null)
      .map((line, index) => ({
        id: typeof line.id === 'string' && line.id ? line.id : `extra-${index + 1}`,
        label: typeof line.label === 'string' ? line.label : '',
        amount: toFiniteOrNull(line.amount),
      }))
      .filter((line) => line.label.trim() !== '' || line.amount !== null)
  }

  result.includeInPdf = record.includeInPdf !== false

  return result
}

/**
 * «Токио» для правила проживания гида: ночёвка в Токио бесплатна, вне —
 * по ставке guide_night_outside_tokyo. Сравниваем по подстроке, потому что
 * в Overnight City встречаются уточнения («Токио (Синдзюку)»).
 */
export function isTokyoOvernight(city: string): boolean {
  const normalized = city.trim().toLowerCase()
  if (!normalized) return false
  return normalized.includes('токио') || normalized.includes('tokyo')
}

const PRIVATE_TRANSPORT_TITLE_MARKERS = ['частный транспорт', 'заказной транспорт', 'лимузин']

/**
 * Авто-формат дня из данных программы:
 *  - independent → без гида;
 *  - маркеры частного/заказного транспорта (блок дня, переезд на авто,
 *    departureMode private/chartered) → гид + частный транспорт;
 *  - иначе → гид без транспорта.
 * Ручной override в таблице расчёта всегда сильнее.
 */
export function deriveDayPricingFormat(day: MultiDayBuilderDay): TourDayPricingFormat {
  if (day.dayType === 'independent') return 'no_guide'

  const hasPrivateTransportItem = day.items.some((item) => {
    const title = (item.displayTitle || item.poiTitle).trim().toLowerCase()
    return PRIVATE_TRANSPORT_TITLE_MARKERS.some((marker) => title.includes(marker))
  })
  if (hasPrivateTransportItem) return 'guide_day_private_transport'

  const hasPrivateTransportSegment = day.transportSegments.some(
    (segment) => segment.mode === 'car' || segment.departureMode === 'private' || segment.departureMode === 'chartered',
  )
  if (hasPrivateTransportSegment) return 'guide_day_private_transport'

  return 'guide_day'
}

export function resolveDayPricingFormat(day: MultiDayBuilderDay, pricing: RoutePricingData | null | undefined) {
  const derived = deriveDayPricingFormat(day)
  const override = pricing?.dayFormatOverrides[String(day.dayNumber)]
  return { format: override ?? derived, derived, isOverridden: override !== undefined && override !== derived }
}

/**
 * Авто-правило ночёвки гида: считается, если ночёвка дня задана и вне Токио,
 * день не отъездный, и гид в этот ИЛИ следующий день работает (в полностью
 * самостоятельном отрезке маршрута гиду ночевать рядом незачем).
 */
function deriveGuideNight(days: MultiDayBuilderDay[], index: number, formats: TourDayPricingFormat[]): boolean {
  const day = days[index]
  if (!day.overnightCity.trim() || isTokyoOvernight(day.overnightCity)) return false
  if (day.dayType === 'departure') return false
  const guidedToday = formats[index] !== 'no_guide'
  const guidedTomorrow = index + 1 < days.length && formats[index + 1] !== 'no_guide'
  return guidedToday || guidedTomorrow
}

export function resolveRate(
  key: TourPricingRateKey,
  matrix: TourPricingMatrix,
  pricing: RoutePricingData | null | undefined,
): number {
  const override = pricing?.rates[key]
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) return override
  return matrix[key]?.amount ?? FALLBACK_PRICING_MATRIX[key].amount
}

export interface TourPricingDayRow {
  dayNumber: number
  dayTitle: string
  overnightCity: string
  format: TourDayPricingFormat
  derivedFormat: TourDayPricingFormat
  formatOverridden: boolean
  amount: number
  nightCounted: boolean
  nightDerived: boolean
  nightOverridden: boolean
  nightAmount: number
}

export interface TourPricingSummaryLine {
  key: string
  label: string
  quantity: number
  unit: string
  rate: number
  amount: number
}

export interface TourPricingResult {
  currency: string
  dayRows: TourPricingDayRow[]
  summaryLines: TourPricingSummaryLine[]
  extraLines: Array<{ id: string; label: string; amount: number }>
  total: number
  paxCount: number | null
  perPerson: number | null
}

/** Полный расчёт тура: строки по дням, свод по статьям, итог и цена на человека. */
export function computeTourPricing(route: MultiDayBuilderRoute, matrix: TourPricingMatrix): TourPricingResult {
  const pricing = route.pricing ?? null
  const days = [...route.days].sort((left, right) => left.dayNumber - right.dayNumber)

  const rateGuideDay = resolveRate('guide_day', matrix, pricing)
  const ratePrivate = resolveRate('guide_day_private_transport', matrix, pricing)
  const rateNight = resolveRate('guide_night_outside_tokyo', matrix, pricing)

  const formats = days.map((day) => resolveDayPricingFormat(day, pricing).format)

  const dayRows: TourPricingDayRow[] = days.map((day, index) => {
    const { format, derived, isOverridden } = resolveDayPricingFormat(day, pricing)
    const amount = format === 'guide_day' ? rateGuideDay : format === 'guide_day_private_transport' ? ratePrivate : 0

    const nightDerived = deriveGuideNight(days, index, formats)
    const nightOverride = pricing?.nightOverrides[String(day.dayNumber)]
    const nightCounted = nightOverride ?? nightDerived

    return {
      dayNumber: day.dayNumber,
      dayTitle: day.dayTitle,
      overnightCity: day.overnightCity,
      format,
      derivedFormat: derived,
      formatOverridden: isOverridden,
      amount,
      nightCounted,
      nightDerived,
      nightOverridden: nightOverride !== undefined && nightOverride !== nightDerived,
      nightAmount: nightCounted ? rateNight : 0,
    }
  })

  const guideDays = dayRows.filter((row) => row.format === 'guide_day').length
  const privateDays = dayRows.filter((row) => row.format === 'guide_day_private_transport').length
  const nights = dayRows.filter((row) => row.nightCounted).length

  const summaryLines: TourPricingSummaryLine[] = []
  if (guideDays > 0) {
    summaryLines.push({
      key: 'guide_day',
      label: matrix.guide_day?.label ?? FALLBACK_PRICING_MATRIX.guide_day.label,
      quantity: guideDays,
      unit: 'дн.',
      rate: rateGuideDay,
      amount: guideDays * rateGuideDay,
    })
  }
  if (privateDays > 0) {
    summaryLines.push({
      key: 'guide_day_private_transport',
      label: matrix.guide_day_private_transport?.label ?? FALLBACK_PRICING_MATRIX.guide_day_private_transport.label,
      quantity: privateDays,
      unit: 'дн.',
      rate: ratePrivate,
      amount: privateDays * ratePrivate,
    })
  }
  if (nights > 0) {
    summaryLines.push({
      key: 'guide_night_outside_tokyo',
      label: matrix.guide_night_outside_tokyo?.label ?? FALLBACK_PRICING_MATRIX.guide_night_outside_tokyo.label,
      quantity: nights,
      unit: 'ноч.',
      rate: rateNight,
      amount: nights * rateNight,
    })
  }

  const extraLines = (pricing?.extraLines ?? [])
    .filter((line) => line.label.trim() !== '' && typeof line.amount === 'number' && Number.isFinite(line.amount))
    .map((line) => ({ id: line.id, label: line.label.trim(), amount: line.amount as number }))

  const total =
    summaryLines.reduce((sum, line) => sum + line.amount, 0) + extraLines.reduce((sum, line) => sum + line.amount, 0)

  const paxCount = pricing?.paxCount && pricing.paxCount >= 1 ? pricing.paxCount : null
  // Цена на человека: округляем вверх до доллара — недосчитать хуже, чем пересчитать.
  const perPerson = paxCount ? Math.ceil(total / paxCount) : null

  return { currency: 'USD', dayRows, summaryLines, extraLines, total, paxCount, perPerson }
}

/** «$1 500» — неразрывный узкий пробел между тысячами, как в остальных суммах сайта. */
export function formatUsd(amount: number): string {
  const rounded = Math.round(amount)
  const formatted = Math.abs(rounded).toLocaleString('ru-RU').replace(/\s/g, ' ')
  return `${rounded < 0 ? '−' : ''}$${formatted}`
}
