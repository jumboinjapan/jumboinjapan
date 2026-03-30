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
  if (parsedEntries.some((entry) => !entry)) return cleaned

  const entries = parsedEntries as Array<{ dayIndex: number; value: string }>
  const byDay = new Map<number, string>()

  for (const entry of entries) {
    if (byDay.has(entry.dayIndex)) return cleaned
    byDay.set(entry.dayIndex, entry.value)
  }

  if (byDay.size !== 7) return cleaned

  const ordered = MONDAY_FIRST_DAY_ORDER.map((dayIndex) => ({
    dayIndex,
    value: byDay.get(dayIndex) ?? '',
  }))

  if (ordered.some((entry) => !entry.value)) return cleaned

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
