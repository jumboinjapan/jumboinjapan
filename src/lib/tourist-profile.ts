/**
 * Опросник «Профиль туриста» v3 — модель payload, валидация и денормализация.
 *
 * Канон: docs/tourist-profile-questionnaire-spec.md (спецификация владельца
 * v3, 2026-07-05). Полный payload хранится как JSON в Airtable-поле
 * `Fact Find Answers` (единственный источник для рендера профиля в карточке
 * клиента); параллельно денормализуются колонки, нужные доске/дашборду.
 *
 * Отличия v3 от v2 (старых заполненных анкет на момент перехода не было,
 * миграция не нужна): Q3a без географии (first_trip_preference), интересы —
 * active/art_hunting/culture с под-ветками, ритм — no_hotel_change/few_moves/
 * max_experience, бюджет отеля без опции «затрудняюсь», hotel_booking и
 * guide_format — новые ключи, Q10a (один гид/локальные) убран.
 *
 * Этот модуль не ходит в Airtable — доступ к Prospects только через
 * src/lib/prospects.ts.
 */

// ─── Типы payload (JSON-модель из спеки v3, 1-в-1) ──────────────────────────

export type DatesPrecision = 'exact' | 'flexible' | 'month_only'
export type FirstTripPreference = 'main_highlights' | 'off_beaten_path' | 'mix' | 'recommend'
export type RepeatMode = 'only_new' | 'repeat_familiar' | 'mix'
export type NewType = 'known_new' | 'rare_exotic' | 'both'
export type MobilityFlag = 'kids_u6' | 'seniors_70' | 'limited_mobility' | 'elevator_needed' | 'none'
export type InterestKey = 'gastronomy' | 'active' | 'photography' | 'art_hunting' | 'culture' | 'none'
export type ArtHuntingType = 'modern' | 'traditional' | 'both'
export type InterestsDepth = 'accent' | 'dedicated_tour'
export type ProfilePace = 'no_hotel_change' | 'few_moves' | 'max_experience'
export type HotelBooking = 'self_with_recs' | 'full_service' | 'self_no_recs'
export type GuideFormat = 'self_with_route_recs' | 'partial_tours' | 'full_guide'
export type ContactChannel = 'telegram' | 'whatsapp' | 'email'

export interface TouristProfilePayload {
  dates: {
    start: string | null
    end: string | null
    precision: DatesPrecision
    month: string | null
  }
  first_trip: boolean
  first_trip_preference: FirstTripPreference | null
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
  active_detail: { custom: string | null; ask_recommend: boolean } | null
  art_hunting_type: ArtHuntingType | null
  interests_custom: string | null
  interests_depth: InterestsDepth | null
  pace: ProfilePace
  hotel_budget_usd: { min: number; max: number }
  ryokan_night: boolean
  hotel_booking: HotelBooking
  guide_format: GuideFormat
  notes: string
  contact: { name: string; channel: ContactChannel; value: string }
}

// ─── Валидация / санитизация ─────────────────────────────────────────────────

const MAX_TEXT = 3000
const MAX_SHORT = 300

const PRECISIONS: DatesPrecision[] = ['exact', 'flexible', 'month_only']
const FIRST_TRIP_PREFERENCES: FirstTripPreference[] = ['main_highlights', 'off_beaten_path', 'mix', 'recommend']
const REPEAT_MODES: RepeatMode[] = ['only_new', 'repeat_familiar', 'mix']
const NEW_TYPES: NewType[] = ['known_new', 'rare_exotic', 'both']
const MOBILITY_FLAGS: MobilityFlag[] = ['kids_u6', 'seniors_70', 'limited_mobility', 'elevator_needed', 'none']
const INTEREST_KEYS: InterestKey[] = ['gastronomy', 'active', 'photography', 'art_hunting', 'culture', 'none']
const ART_HUNTING_TYPES: ArtHuntingType[] = ['modern', 'traditional', 'both']
const INTEREST_DEPTHS: InterestsDepth[] = ['accent', 'dedicated_tour']
const PACES: ProfilePace[] = ['no_hotel_change', 'few_moves', 'max_experience']
const HOTEL_BOOKINGS: HotelBooking[] = ['self_with_recs', 'full_service', 'self_no_recs']
const GUIDE_FORMATS: GuideFormat[] = ['self_with_route_recs', 'partial_tours', 'full_guide']
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
 * Формат контакта по каналу (техбриф v3: Telegram/WhatsApp — валидация
 * формата без round-trip; email — формат здесь, OTP — отдельный слой).
 */
export function isValidContactValue(channel: ContactChannel, value: string): boolean {
  const v = value.trim()
  switch (channel) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
    case 'telegram':
      // @username, username, ссылка t.me или телефон
      return (
        /^@?[A-Za-z0-9_]{4,32}$/.test(v) ||
        /^(https?:\/\/)?t\.me\/[A-Za-z0-9_]{4,32}$/.test(v) ||
        /^\+?[\d\s()-]{7,20}$/.test(v)
      )
    case 'whatsapp':
      return /^\+?[\d\s()-]{7,20}$/.test(v)
  }
}

/**
 * Валидирует сырой payload с публичной формы. Whitelist по построению:
 * читаются только известные поля, всё прочее отбрасывается. Серверная
 * валидация дублирует клиентскую намеренно (техбриф v3): клиентскую легко
 * обойти прямым POST. Возвращает очищенный payload или список проблем
 * (без PII в текстах ошибок).
 */
export function sanitizeProfilePayload(
  raw: unknown
): { ok: true; payload: TouristProfilePayload } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['payload must be an object'] }
  }
  const r = raw as Record<string, unknown>

  // Q1 Даты
  const rawDates = (typeof r.dates === 'object' && r.dates !== null ? r.dates : {}) as Record<string, unknown>
  const precision = oneOf(rawDates.precision, PRECISIONS)
  if (!precision) errors.push('dates.precision is required')
  const dates = {
    start: isoDate(rawDates.start),
    end: isoDate(rawDates.end),
    precision: precision ?? 'flexible',
    month: text(rawDates.month, 40),
  }
  if (precision === 'exact' && (!dates.start || !dates.end)) errors.push('dates range is required for exact')
  if ((precision === 'month_only' || precision === 'flexible') && !dates.month)
    errors.push('dates.month is required')

  // Q2 Опыт
  if (typeof r.first_trip !== 'boolean') errors.push('first_trip is required')
  const firstTrip = r.first_trip === true

  // Ветки Q3
  const firstTripPreference = firstTrip ? oneOf(r.first_trip_preference, FIRST_TRIP_PREFERENCES) : null
  if (firstTrip && !firstTripPreference) errors.push('first_trip_preference is required')
  const repeatMode = !firstTrip ? oneOf(r.repeat_mode, REPEAT_MODES) : null
  if (!firstTrip && typeof r.first_trip === 'boolean' && !repeatMode) errors.push('repeat_mode is required')

  // Q4 Состав группы
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

  // Q5 Мобильность — обязательный шаг (минимум «все готовы много ходить»)
  const mobility = Array.isArray(r.mobility)
    ? [...new Set(r.mobility.map((v) => oneOf(v, MOBILITY_FLAGS)).filter((v): v is MobilityFlag => v !== null))]
    : []
  if (mobility.length === 0) errors.push('mobility is required')

  // Q6 Интересы — обязательный шаг (минимум «ничего специального»)
  const interests = Array.isArray(r.interests)
    ? [...new Set(r.interests.map((v) => oneOf(v, INTEREST_KEYS)).filter((v): v is InterestKey => v !== null))]
    : []
  const interestsCustom = text(r.interests_custom)
  if (interests.length === 0 && !interestsCustom) errors.push('interests is required')

  const rawActiveDetail = (typeof r.active_detail === 'object' && r.active_detail !== null
    ? r.active_detail
    : null) as Record<string, unknown> | null

  // Q7 Ритм
  const pace = oneOf(r.pace, PACES)
  if (!pace) errors.push('pace is required')

  // Q8 Отели — без опции «затрудняюсь» (v3)
  const rawBudget = (typeof r.hotel_budget_usd === 'object' && r.hotel_budget_usd !== null
    ? r.hotel_budget_usd
    : {}) as Record<string, unknown>
  const budgetMin = int(rawBudget.min, 0, 5000)
  const budgetMax = int(rawBudget.max, 0, 5000)
  if (budgetMin === null || budgetMax === null) errors.push('hotel_budget_usd is required')

  // Q9 Рекомендации отелей
  const hotelBooking = oneOf(r.hotel_booking, HOTEL_BOOKINGS)
  if (!hotelBooking) errors.push('hotel_booking is required')

  // Q10 Сопровождение
  const guideFormat = oneOf(r.guide_format, GUIDE_FORMATS)
  if (!guideFormat) errors.push('guide_format is required')

  // Q11 Контакт: имя + канал + значение в корректном формате
  const rawContact = (typeof r.contact === 'object' && r.contact !== null ? r.contact : {}) as Record<string, unknown>
  const contactName = text(rawContact.name, MAX_SHORT)
  const contactChannel = oneOf(rawContact.channel, CONTACT_CHANNELS)
  const contactValue = text(rawContact.value, MAX_SHORT)
  if (!contactName) errors.push('contact.name is required')
  if (!contactChannel) errors.push('contact.channel is required')
  if (!contactValue) errors.push('contact.value is required')
  if (contactChannel && contactValue && !isValidContactValue(contactChannel, contactValue)) {
    errors.push('contact.value has invalid format')
  }

  if (errors.length > 0) return { ok: false, errors }

  const hasRealInterest = interests.some((i) => i !== 'none') || Boolean(interestsCustom)
  const resolvedMin = Math.min(budgetMin ?? 150, budgetMax ?? 400)
  const resolvedMax = Math.max(budgetMin ?? 150, budgetMax ?? 400)

  const payload: TouristProfilePayload = {
    dates,
    first_trip: firstTrip,
    first_trip_preference: firstTripPreference,
    regions_visited_text: firstTrip ? null : text(r.regions_visited_text),
    repeat_mode: repeatMode,
    new_type:
      !firstTrip && (repeatMode === 'only_new' || repeatMode === 'mix') ? oneOf(r.new_type, NEW_TYPES) : null,
    new_ideas_note: firstTrip ? null : text(r.new_ideas_note),
    group: { adults: adults ?? 1, children, final: rawGroup.final !== false },
    mobility,
    interests,
    active_detail: interests.includes('active')
      ? {
          custom: text(rawActiveDetail?.custom, MAX_SHORT),
          ask_recommend: rawActiveDetail?.ask_recommend === true,
        }
      : null,
    art_hunting_type: interests.includes('art_hunting') ? oneOf(r.art_hunting_type, ART_HUNTING_TYPES) : null,
    interests_custom: interestsCustom,
    interests_depth: hasRealInterest ? oneOf(r.interests_depth, INTEREST_DEPTHS) : null,
    pace: pace ?? 'few_moves',
    hotel_budget_usd: { min: resolvedMin, max: resolvedMax },
    ryokan_night: r.ryokan_night === true,
    hotel_booking: hotelBooking ?? 'self_with_recs',
    guide_format: guideFormat ?? 'self_with_route_recs',
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
// Опции Airtable-селектов не меняются (relaxed/moderate/active и т.д.) —
// v3-ключи мапятся в существующие значения.

/** payload.pace (v3) → Airtable `Pace` (relaxed | moderate | active). */
const PACE_TO_AIRTABLE: Record<ProfilePace, string> = {
  no_hotel_change: 'relaxed',
  few_moves: 'moderate',
  max_experience: 'active',
}

/** payload.hotel_booking (v3) → Airtable `Hotel Booking` (self | recommend | full_service). */
const HOTEL_BOOKING_TO_AIRTABLE: Record<HotelBooking, string> = {
  self_with_recs: 'recommend',
  full_service: 'full_service',
  self_no_recs: 'self',
}

/** payload.guide_format (v3) → Airtable `Guide Format` (self | partial_days | full). */
const GUIDE_FORMAT_TO_AIRTABLE: Record<GuideFormat, string> = {
  self_with_route_recs: 'self',
  partial_tours: 'partial_days',
  full_guide: 'full',
}

/** payload.interests (v3) → опции Airtable `Interests`; прочее живёт только в JSON. */
const INTEREST_TO_AIRTABLE: Partial<Record<InterestKey, string>> = {
  gastronomy: 'food',
  photography: 'photography',
  art_hunting: 'art',
}

export function formatHotelBudget(payload: TouristProfilePayload): string {
  const base = `$${payload.hotel_budget_usd.min}–${payload.hotel_budget_usd.max}`
  return payload.ryokan_night ? `${base} + ryokan` : base
}

export function formatChildren(children: Array<{ age: number }>): string {
  if (children.length === 0) return ''
  const ages = children.map((c) => c.age).join(', ')
  return `${children.length} дет., возраст: ${ages}`
}

/**
 * Строит фильтруемые Airtable-колонки из канонического payload.
 * JSON-канон пишется отдельно, в `Fact Find Answers`.
 */
export function denormalizeProfile(payload: TouristProfilePayload): Record<string, unknown> {
  const fields: Record<string, unknown> = {}

  if (payload.dates.precision === 'exact') {
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

  const mustSee = [payload.new_ideas_note, payload.active_detail?.custom].filter(Boolean).join('\n')
  if (mustSee) fields['Must See'] = mustSee
  if (payload.notes) fields['Notes'] = payload.notes

  fields['Name'] = payload.contact.name
  fields['Contact'] = `${payload.contact.channel}: ${payload.contact.value}`

  fields['First Trip'] = payload.first_trip
  fields['Guide Format'] = GUIDE_FORMAT_TO_AIRTABLE[payload.guide_format]
  fields['Hotel Booking'] = HOTEL_BOOKING_TO_AIRTABLE[payload.hotel_booking]
  fields['Hotel Budget'] = formatHotelBudget(payload)

  return fields
}

// ─── Русские подписи значений (карточка клиента, «Профиль туриста») ──────────

export const FIRST_TRIP_PREFERENCE_LABELS: Record<FirstTripPreference, string> = {
  main_highlights: 'Хотят увидеть главное',
  off_beaten_path: 'Тянет туда, где меньше туристов',
  mix: 'И то и другое, если получится совместить',
  recommend: 'Не знают — ждут предложения',
}

export const REPEAT_MODE_LABELS: Record<RepeatMode, string> = {
  only_new: 'Хотят только новое',
  repeat_familiar: 'Готовы вернуться в знакомые места',
  mix: 'Микс: знакомые города, новая программа',
}

export const NEW_TYPE_LABELS: Record<NewType, string> = {
  known_new: 'Известная Япония, где ещё не были',
  rare_exotic: 'Редкие направления и экзотика',
  both: 'И то и другое — микс',
}

export const MOBILITY_FLAG_LABELS: Record<MobilityFlag, string> = {
  kids_u6: 'Дети до 6 лет',
  seniors_70: 'Участники старше 70',
  limited_mobility: 'Ограниченная мобильность',
  elevator_needed: 'Нужен лифт / минимум пеших переходов',
  none: 'Все готовы много ходить',
}

export const INTEREST_LABELS: Record<InterestKey, string> = {
  gastronomy: 'Гастрономия',
  active: 'Активный отдых',
  photography: 'Фототур',
  art_hunting: 'Охота за искусством',
  culture: 'Культура',
  none: 'Ничего специального',
}

export const ART_HUNTING_TYPE_LABELS: Record<ArtHuntingType, string> = {
  modern: 'современное',
  traditional: 'традиционное',
  both: 'современное и традиционное',
}

export const INTEREST_DEPTH_LABELS: Record<InterestsDepth, string> = {
  accent: 'Как акцент',
  dedicated_tour: 'Как отдельный тур',
}

export const PROFILE_PACE_LABELS: Record<ProfilePace, string> = {
  no_hotel_change: 'Выездные туры без смены отеля',
  few_moves: 'Пара переездов ради ярких остановок',
  max_experience: 'Максимум впечатлений за отведённое время',
}

export const HOTEL_BOOKING_LABELS: Record<HotelBooking, string> = {
  self_with_recs: 'Бронирует сам(а), нужны рекомендации',
  full_service: 'Хочет делегировать бронирование',
  self_no_recs: 'Бронирует сам(а), рекомендации не нужны',
}

export const GUIDE_FORMAT_LABELS: Record<GuideFormat, string> = {
  self_with_route_recs: 'Самостоятельно, с рекомендациями по маршруту',
  partial_tours: 'Отдельные экскурсии и туры с гидом',
  full_guide: 'Сопровождение гида по всему маршруту',
}

export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  email: 'Email',
}

// ─── Сводка для Telegram-уведомления ─────────────────────────────────────────

const MONTH_LABELS: Record<string, string> = {
  '01': 'январь', '02': 'февраль', '03': 'март', '04': 'апрель',
  '05': 'май', '06': 'июнь', '07': 'июль', '08': 'август',
  '09': 'сентябрь', '10': 'октябрь', '11': 'ноябрь', '12': 'декабрь',
}

export function formatProfileDates(payload: TouristProfilePayload): string {
  const { start, end, precision, month } = payload.dates
  if (precision !== 'exact') {
    const suffix = precision === 'flexible' ? ' (примерно)' : ' (только месяц)'
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, mm] = month.split('-')
      return `${MONTH_LABELS[mm] ?? month} ${year}${suffix}`
    }
    return month ? `${month}${suffix}` : 'не указаны'
  }
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
  if (start && end) {
    const nights = Math.round((Date.parse(end) - Date.parse(start)) / 86400_000)
    return `${fmt(start)} — ${fmt(end)}${nights > 0 ? ` (${nights} ноч.)` : ''}`
  }
  if (start) return `с ${fmt(start)}`
  return 'не указаны'
}

export function formatProfileParty(payload: TouristProfilePayload): string {
  const parts = [`${payload.group.adults} взр.`]
  if (payload.group.children.length > 0) parts.push(formatChildren(payload.group.children))
  return parts.join(', ')
}

/** Короткая сводка для Telegram: даты, состав, опыт, формат. Без канцелярита. */
export function summarizeProfileForTelegram(payload: TouristProfilePayload): string[] {
  return [
    `Даты: ${formatProfileDates(payload)}`,
    `Состав: ${formatProfileParty(payload)}`,
    `Опыт: ${payload.first_trip ? 'первая поездка' : 'уже были в Японии'}`,
    `Формат: ${GUIDE_FORMAT_LABELS[payload.guide_format]}`,
    `Отели: ${formatHotelBudget(payload)}`,
  ]
}
