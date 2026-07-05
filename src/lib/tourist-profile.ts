/**
 * Опросник «Профиль туриста» — модель payload, валидация и денормализация.
 *
 * Канон: docs/tourist-profile-questionnaire-spec.md. Полный payload хранится
 * как JSON в Airtable-поле `Fact Find Answers` (единственный источник для
 * рендера профиля в карточке клиента); параллельно денормализуются колонки,
 * нужные доске/дашборду/фильтрам (см. denormalizeProfile).
 *
 * Этот модуль не ходит в Airtable — доступ к Prospects только через
 * src/lib/prospects.ts.
 */

// ─── Типы payload (JSON-модель из спеки, 1-в-1) ─────────────────────────────

export type DatesPrecision = 'exact' | 'flexible' | 'month_only'
export type FirstTripRoute = 'keep' | 'add' | 'change' | 'recommend'
export type RepeatMode = 'only_new' | 'repeat_classic' | 'mix'
export type NewType = 'known_new' | 'rare_exotic' | 'both'
export type MobilityFlag = 'kids_u6' | 'seniors_70' | 'limited_mobility' | 'elevator_needed' | 'none'
export type InterestKey = 'gastronomy' | 'hiking' | 'outdoor' | 'photography' | 'art' | 'crafts' | 'none'
export type InterestsDepth = 'accent' | 'dedicated_tour'
export type ProfilePace = 'relaxed' | 'balanced' | 'intense'
export type HotelBooking = 'self' | 'recommend' | 'full_service'
export type GuideFormat = 'self' | 'partial_days' | 'full'
export type GuideMode = 'single' | 'local' | 'recommend'
export type ContactChannel = 'telegram' | 'whatsapp' | 'email'

export interface TouristProfilePayload {
  dates: {
    start: string | null
    end: string | null
    precision: DatesPrecision
    month: string | null
  }
  first_trip: boolean
  first_trip_route: FirstTripRoute | null
  first_trip_route_note: string | null
  regions_visited_text: string | null
  repeat_mode: RepeatMode | null
  new_type: NewType | null
  new_ideas_note: string | null
  group: {
    adults: number
    children: Array<{ age: number }>
    final: boolean
  }
  mobility: MobilityFlag[]
  interests: InterestKey[]
  interests_custom: string | null
  interests_depth: InterestsDepth | null
  pace: ProfilePace
  hotel_budget_usd: { min: number; max: number }
  ryokan_night: boolean
  hotel_undecided: boolean
  hotel_booking: HotelBooking
  guide_format: GuideFormat
  guide_mode: GuideMode | null
  notes: string
  contact: { name: string; channel: ContactChannel; value: string }
}

// ─── Валидация / санитизация ─────────────────────────────────────────────────

const MAX_TEXT = 3000
const MAX_SHORT = 300

const PRECISIONS: DatesPrecision[] = ['exact', 'flexible', 'month_only']
const FIRST_TRIP_ROUTES: FirstTripRoute[] = ['keep', 'add', 'change', 'recommend']
const REPEAT_MODES: RepeatMode[] = ['only_new', 'repeat_classic', 'mix']
const NEW_TYPES: NewType[] = ['known_new', 'rare_exotic', 'both']
const MOBILITY_FLAGS: MobilityFlag[] = ['kids_u6', 'seniors_70', 'limited_mobility', 'elevator_needed', 'none']
const INTEREST_KEYS: InterestKey[] = ['gastronomy', 'hiking', 'outdoor', 'photography', 'art', 'crafts', 'none']
const INTEREST_DEPTHS: InterestsDepth[] = ['accent', 'dedicated_tour']
const PACES: ProfilePace[] = ['relaxed', 'balanced', 'intense']
const HOTEL_BOOKINGS: HotelBooking[] = ['self', 'recommend', 'full_service']
const GUIDE_FORMATS: GuideFormat[] = ['self', 'partial_days', 'full']
const GUIDE_MODES: GuideMode[] = ['single', 'local', 'recommend']
const CONTACT_CHANNELS: ContactChannel[] = ['telegram', 'whatsapp', 'email']

function text(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed.slice(0, max)
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function int(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  return rounded < min || rounded > max ? null : rounded
}

/**
 * Валидирует сырой payload с публичной формы. Whitelist по построению:
 * читаются только известные поля, всё прочее отбрасывается. Возвращает
 * очищенный payload или список проблем (без PII в текстах ошибок).
 */
export function sanitizeProfilePayload(
  raw: unknown
): { ok: true; payload: TouristProfilePayload } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['payload must be an object'] }
  }
  const r = raw as Record<string, unknown>

  // Даты
  const rawDates = (typeof r.dates === 'object' && r.dates !== null ? r.dates : {}) as Record<string, unknown>
  const precision = oneOf(rawDates.precision, PRECISIONS)
  if (!precision) errors.push('dates.precision is required')
  const dates = {
    start: isoDate(rawDates.start),
    end: isoDate(rawDates.end),
    precision: precision ?? 'flexible',
    month: text(rawDates.month, 40),
  }
  if (precision === 'month_only' && !dates.month) errors.push('dates.month is required for month_only')

  // Опыт
  if (typeof r.first_trip !== 'boolean') errors.push('first_trip is required')
  const firstTrip = r.first_trip === true

  // Состав группы
  const rawGroup = (typeof r.group === 'object' && r.group !== null ? r.group : {}) as Record<string, unknown>
  const adults = int(rawGroup.adults, 1, 20)
  if (adults === null) errors.push('group.adults is required (1–20)')
  const children: Array<{ age: number }> = []
  if (Array.isArray(rawGroup.children)) {
    for (const child of rawGroup.children.slice(0, 10)) {
      const age = int((child as Record<string, unknown> | null)?.age, 0, 17)
      if (age !== null) children.push({ age })
    }
  }

  // Мультивыборы
  const mobility = Array.isArray(r.mobility)
    ? [...new Set(r.mobility.map((v) => oneOf(v, MOBILITY_FLAGS)).filter((v): v is MobilityFlag => v !== null))]
    : []
  const interests = Array.isArray(r.interests)
    ? [...new Set(r.interests.map((v) => oneOf(v, INTEREST_KEYS)).filter((v): v is InterestKey => v !== null))]
    : []

  const pace = oneOf(r.pace, PACES)
  if (!pace) errors.push('pace is required')

  // Отели
  const rawBudget = (typeof r.hotel_budget_usd === 'object' && r.hotel_budget_usd !== null
    ? r.hotel_budget_usd
    : {}) as Record<string, unknown>
  const budgetMin = int(rawBudget.min, 0, 5000) ?? 80
  const budgetMax = int(rawBudget.max, 0, 5000) ?? 800
  const hotelBooking = oneOf(r.hotel_booking, HOTEL_BOOKINGS)
  if (!hotelBooking) errors.push('hotel_booking is required')

  // Сопровождение
  const guideFormat = oneOf(r.guide_format, GUIDE_FORMATS)
  if (!guideFormat) errors.push('guide_format is required')

  // Контакт
  const rawContact = (typeof r.contact === 'object' && r.contact !== null ? r.contact : {}) as Record<string, unknown>
  const contactName = text(rawContact.name, MAX_SHORT)
  const contactChannel = oneOf(rawContact.channel, CONTACT_CHANNELS)
  const contactValue = text(rawContact.value, MAX_SHORT)
  if (!contactName) errors.push('contact.name is required')
  if (!contactChannel) errors.push('contact.channel is required')
  if (!contactValue) errors.push('contact.value is required')

  if (errors.length > 0) return { ok: false, errors }

  const payload: TouristProfilePayload = {
    dates,
    first_trip: firstTrip,
    first_trip_route: firstTrip ? oneOf(r.first_trip_route, FIRST_TRIP_ROUTES) : null,
    first_trip_route_note: firstTrip ? text(r.first_trip_route_note) : null,
    regions_visited_text: firstTrip ? null : text(r.regions_visited_text),
    repeat_mode: firstTrip ? null : oneOf(r.repeat_mode, REPEAT_MODES),
    new_type: firstTrip ? null : oneOf(r.new_type, NEW_TYPES),
    new_ideas_note: firstTrip ? null : text(r.new_ideas_note),
    group: { adults: adults ?? 1, children, final: rawGroup.final !== false },
    mobility,
    interests,
    interests_custom: text(r.interests_custom),
    interests_depth: oneOf(r.interests_depth, INTEREST_DEPTHS),
    pace: pace ?? 'balanced',
    hotel_budget_usd: { min: Math.min(budgetMin, budgetMax), max: Math.max(budgetMin, budgetMax) },
    ryokan_night: r.ryokan_night === true,
    hotel_undecided: r.hotel_undecided === true,
    hotel_booking: hotelBooking ?? 'recommend',
    guide_format: guideFormat ?? 'self',
    guide_mode: guideFormat === 'full' ? oneOf(r.guide_mode, GUIDE_MODES) : null,
    notes: text(r.notes) ?? '',
    contact: {
      name: contactName ?? '',
      channel: contactChannel ?? 'email',
      value: contactValue ?? '',
    },
  }

  return { ok: true, payload }
}

/** Пытается распарсить сохранённый JSON из `Fact Find Answers`. */
export function parseStoredProfile(json: string | null | undefined): TouristProfilePayload | null {
  if (!json) return null
  try {
    const result = sanitizeProfilePayload(JSON.parse(json))
    return result.ok ? result.payload : null
  } catch {
    return null
  }
}

// ─── Денормализация в колонки Prospects ──────────────────────────────────────

/** payload.pace → Airtable `Pace` (relaxed | moderate | active). */
const PACE_TO_AIRTABLE: Record<ProfilePace, string> = {
  relaxed: 'relaxed',
  balanced: 'moderate',
  intense: 'active',
}

/** payload.interests → опции Airtable `Interests`; прочее живёт только в JSON. */
const INTEREST_TO_AIRTABLE: Partial<Record<InterestKey, string>> = {
  gastronomy: 'food',
  hiking: 'hiking',
  photography: 'photography',
  art: 'art',
}

export function formatHotelBudget(payload: TouristProfilePayload): string {
  const base = payload.hotel_undecided
    ? 'undecided'
    : `$${payload.hotel_budget_usd.min}–${payload.hotel_budget_usd.max}`
  return payload.ryokan_night ? `${base} + ryokan` : base
}

export function formatChildren(children: Array<{ age: number }>): string {
  if (children.length === 0) return ''
  const ages = children.map((c) => c.age).join(', ')
  return `${children.length} дет., возраст: ${ages}`
}

/**
 * Строит фильтруемые Airtable-колонки из канонического payload
 * (раздел «Технические решения» спеки опросника). JSON-канон пишется
 * отдельно, в `Fact Find Answers`.
 */
export function denormalizeProfile(payload: TouristProfilePayload): Record<string, unknown> {
  const fields: Record<string, unknown> = {}

  if (payload.dates.precision !== 'month_only') {
    if (payload.dates.start) fields['Arrival Date'] = payload.dates.start
    if (payload.dates.end) fields['Departure Date'] = payload.dates.end
  }
  fields['Flexible Dates'] = payload.dates.precision !== 'exact'

  fields['Party Size'] = payload.group.adults + payload.group.children.length
  if (payload.group.children.length > 0) fields['Children'] = formatChildren(payload.group.children)

  fields['Pace'] = PACE_TO_AIRTABLE[payload.pace]
  fields['Mobility'] =
    payload.mobility.includes('limited_mobility') || payload.mobility.includes('elevator_needed')
      ? 'limited'
      : 'full'

  const mappedInterests = payload.interests
    .map((key) => INTEREST_TO_AIRTABLE[key])
    .filter((v): v is string => Boolean(v))
  if (mappedInterests.length > 0) fields['Interests'] = mappedInterests

  const mustSee = [payload.first_trip_route_note, payload.new_ideas_note].filter(Boolean).join('\n')
  if (mustSee) fields['Must See'] = mustSee
  if (payload.notes) fields['Notes'] = payload.notes

  fields['Name'] = payload.contact.name
  fields['Contact'] = `${payload.contact.channel}: ${payload.contact.value}`

  fields['First Trip'] = payload.first_trip
  fields['Guide Format'] = payload.guide_format
  fields['Hotel Booking'] = payload.hotel_booking
  fields['Hotel Budget'] = formatHotelBudget(payload)

  return fields
}

// ─── Сводка для Telegram-уведомления ─────────────────────────────────────────

const MONTH_LABELS: Record<string, string> = {
  '01': 'январь', '02': 'февраль', '03': 'март', '04': 'апрель',
  '05': 'май', '06': 'июнь', '07': 'июль', '08': 'август',
  '09': 'сентябрь', '10': 'октябрь', '11': 'ноябрь', '12': 'декабрь',
}

export function formatProfileDates(payload: TouristProfilePayload): string {
  const { start, end, precision, month } = payload.dates
  if (precision === 'month_only') {
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, mm] = month.split('-')
      return `${MONTH_LABELS[mm] ?? month} ${year} (только месяц)`
    }
    return month ? `${month} (только месяц)` : 'не указаны'
  }
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
  if (start && end) return `${fmt(start)} — ${fmt(end)}${precision === 'flexible' ? ' (±)' : ''}`
  if (start) return `с ${fmt(start)}${precision === 'flexible' ? ' (±)' : ''}`
  return 'не указаны'
}

export function formatProfileParty(payload: TouristProfilePayload): string {
  const parts = [`${payload.group.adults} взр.`]
  if (payload.group.children.length > 0) parts.push(formatChildren(payload.group.children))
  return parts.join(', ')
}

const GUIDE_FORMAT_SUMMARY: Record<GuideFormat, string> = {
  self: 'самостоятельно',
  partial_days: 'гид в отдельные дни',
  full: 'гид на всём маршруте',
}

/** Короткая сводка для Telegram: даты, состав, опыт, формат. Без канцелярита. */
export function summarizeProfileForTelegram(payload: TouristProfilePayload): string[] {
  return [
    `Даты: ${formatProfileDates(payload)}`,
    `Состав: ${formatProfileParty(payload)}`,
    `Опыт: ${payload.first_trip ? 'первая поездка' : 'уже были в Японии'}`,
    `Формат: ${GUIDE_FORMAT_SUMMARY[payload.guide_format]}`,
    `Отели: ${formatHotelBudget(payload)}`,
  ]
}
