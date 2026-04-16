const MONDAY_FIRST_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
const DAY_LABELS: Record<number, string> = {
  0: 'Вс',
  1: 'Пн',
  2: 'Вт',
  3: 'Ср',
  4: 'Чт',
  5: 'Пт',
  6: 'Сб',
}

const ENGLISH_LABEL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/^temple grounds?/iu, 'Территория'],
  [/^grounds?/iu, 'Территория'],
  [/^phoenix hall tours?/iu, 'Павильон'],
  [/^phoenix hall/iu, 'Павильон'],
  [/^hall tours?/iu, 'Павильон'],
  [/^museum/iu, 'Музей'],
  [/^parking(?: lot| area)?/iu, 'Парковка'],
  [/^cable car/iu, 'Канатная дорога'],
  [/^ropeway/iu, 'Канатная дорога'],
]

const ENGLISH_DAY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/mondays?/giu, 'понедельник'],
  [/tuesdays?/giu, 'вторник'],
  [/wednesdays?/giu, 'среду'],
  [/thursdays?/giu, 'четверг'],
  [/fridays?/giu, 'пятницу'],
  [/saturdays?/giu, 'субботу'],
  [/sundays?/giu, 'воскресенье'],
]

const ENGLISH_MISC_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bif\b/giu, 'если'],
  [/\bis a national holiday\b/giu, 'это государственный праздник'],
  [/\bnational holiday\b/giu, 'государственный праздник'],
  [/\bdecember\b/giu, 'декабря'],
  [/\bjanuary\b/giu, 'января'],
  [/\bfebruary\b/giu, 'февраля'],
  [/\bmarch\b/giu, 'марта'],
  [/\bapril\b/giu, 'апреля'],
  [/\bmay\b/giu, 'мая'],
  [/\bjune\b/giu, 'июня'],
  [/\bjuly\b/giu, 'июля'],
  [/\baugust\b/giu, 'августа'],
  [/\bseptember\b/giu, 'сентября'],
  [/\boctober\b/giu, 'октября'],
  [/\bnovember\b/giu, 'ноября'],
]

const DAY_ALIASES: Array<{ index: number; aliases: string[] }> = [
  { index: 1, aliases: ['пн', 'пон', 'понед', 'понедельник', 'mon', 'monday'] },
  { index: 2, aliases: ['вт', 'вто', 'вторник', 'tue', 'tues', 'tuesday'] },
  { index: 3, aliases: ['ср', 'сре', 'среда', 'wed', 'wednesday'] },
  { index: 4, aliases: ['чт', 'чет', 'четверг', 'thu', 'thur', 'thurs', 'thursday'] },
  { index: 5, aliases: ['пт', 'пят', 'пятница', 'fri', 'friday'] },
  { index: 6, aliases: ['сб', 'суб', 'суббота', 'sat', 'saturday'] },
  { index: 0, aliases: ['вс', 'воск', 'воскресенье', 'sun', 'sunday'] },
]

function cleanWorkingHoursText(raw: string) {
  return raw
    .replace(/[–—]/g, '–')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s*\n\s*/g, ' | ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function normalizeHoursValue(value: string) {
  return value
    .replace(/^[:\-–—]+\s*/u, '')
    .replace(/24\s*часа\s*в\s*сутки/giu, '24 часа')
    .replace(/24\s*часов\s*в\s*сутки/giu, '24 часа')
    .replace(/\bкруглосуточно\b/giu, '24 часа')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function normalizeTimeRange(segment: string) {
  return segment
    .replace(/(\d{1,2}:\d{2})\s+to\s+(\d{1,2}:\d{2})/giu, '$1–$2')
    .replace(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g, '$1–$2')
}

function translateEnglishDays(segment: string) {
  return ENGLISH_DAY_REPLACEMENTS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    segment,
  )
}

function translateCommonEnglishHoursPhrases(segment: string) {
  return ENGLISH_MISC_REPLACEMENTS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    translateEnglishDays(segment),
  )
}

function normalizeMonthDateRanges(segment: string) {
  return segment.replace(
    /\b(December|January|February|March|April|May|June|July|August|September|October|November)\s+(\d{1,2})\s*[–-]\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/giu,
    (_, startMonth, startDay, endMonth, endDay) => {
      const localized = translateCommonEnglishHoursPhrases(`${startMonth} ${endMonth}`).split(' ')
      return `${startDay} ${localized[0]} – ${endDay} ${localized[1]}`
    },
  )
}

function summarizeGenericHoursSegment(segment: string) {
  let normalized = normalizeMonthDateRanges(normalizeTimeRange(segment))
    .replace(/\s*\((?:entry until|вход до)[^)]+\)/giu, '')
    .replace(/\bentry until\b[^;|]+/giu, '')
    .replace(/\bвход прекращается\b[^;|]+/giu, '')
    .replace(/[.,;:]+$/u, '')
    .trim()

  normalized = translateCommonEnglishHoursPhrases(normalized)

  for (const [pattern, replacement] of ENGLISH_LABEL_REPLACEMENTS) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, replacement)
      break
    }
  }

  normalized = normalized
    .replace(/^closed\s+/iu, 'Выходной: ')
    .replace(/^закрыто\s+/iu, 'Выходной: ')
    .replace(/\bclosed\b/giu, 'выходной')
    .replace(/\bor\b/giu, 'или')
    .replace(/\band\b/giu, 'и')
    .replace(/[ \t]+/g, ' ')
    .trim()

  return normalized
}

function dedupeGenericSegments(segments: string[]) {
  const seen = new Set<string>()
  const uniqueSegments: string[] = []

  for (const segment of segments) {
    const normalizedKey = segment.toLocaleLowerCase('ru-RU')
    if (seen.has(normalizedKey)) continue
    seen.add(normalizedKey)
    uniqueSegments.push(segment)
  }

  return uniqueSegments
}

function formatGenericWorkingHours(cleaned: string) {
  const segments = dedupeGenericSegments(
    cleaned
      .split(/\s*\|\s*|\s*;\s*|\s*[\n\r]+\s*/u)
      .map((segment) => summarizeGenericHoursSegment(segment))
      .filter(Boolean),
  )

  if (segments.length === 0) return cleaned

  return segments.join(' · ')
}

function getDayIndex(label: string) {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/\.+$/u, '')

  for (const { index, aliases } of DAY_ALIASES) {
    if (aliases.some((alias) => normalized === alias || normalized.startsWith(`${alias} `))) {
      return index
    }
  }

  return null
}

function parseDayEntry(segment: string) {
  const trimmed = segment.trim()
  if (!trimmed) return null

  const match = trimmed.match(/^([^:]+?)\s*:\s*(.+)$/u)
  if (!match) return null

  const [, label, value] = match
  const dayIndex = getDayIndex(label)
  if (dayIndex == null) return null

  return {
    dayIndex,
    value: normalizeHoursValue(value),
  }
}

function formatDayRange(days: number[]) {
  if (days.length === 1) return DAY_LABELS[days[0]]
  return `${DAY_LABELS[days[0]]}–${DAY_LABELS[days[days.length - 1]]}`
}

export function formatWorkingHoursForRouteCard(raw?: string | null) {
  if (!raw) return ''

  const cleaned = cleanWorkingHoursText(raw)
  if (!cleaned) return ''

  const segments = cleaned
    .split(/\s*\|\s*|\s*;\s*/u)
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length === 0) return cleaned

  const parsedEntries = segments.map(parseDayEntry)
  if (parsedEntries.some((entry) => !entry)) {
    return formatGenericWorkingHours(cleaned)
  }

  const entries = parsedEntries as Array<{ dayIndex: number; value: string }>
  const byDay = new Map<number, string>()

  for (const entry of entries) {
    if (byDay.has(entry.dayIndex)) return formatGenericWorkingHours(cleaned)
    byDay.set(entry.dayIndex, entry.value)
  }

  if (byDay.size !== 7) return formatGenericWorkingHours(cleaned)

  const ordered = MONDAY_FIRST_DAY_ORDER.map((dayIndex) => ({
    dayIndex,
    value: byDay.get(dayIndex) ?? '',
  }))

  if (ordered.some((entry) => !entry.value)) return formatGenericWorkingHours(cleaned)

  const uniqueValues = Array.from(new Set(ordered.map((entry) => entry.value)))
  if (uniqueValues.length === 1) {
    return `Ежедневно: ${uniqueValues[0]}`
  }

  const groups: Array<{ days: number[]; value: string }> = []

  for (const entry of ordered) {
    const previousGroup = groups[groups.length - 1]
    if (previousGroup && previousGroup.value === entry.value) {
      previousGroup.days.push(entry.dayIndex)
      continue
    }

    groups.push({ days: [entry.dayIndex], value: entry.value })
  }

  return groups
    .map((group) => `${formatDayRange(group.days)}: ${group.value}`)
    .join('; ')
}
