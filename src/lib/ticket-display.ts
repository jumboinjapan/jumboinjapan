import type { AirtableTicket } from '@/lib/airtable'

export interface TicketDisplayLine {
  key: string
  label: string
  groupLabel: string
  ageLabel: string | null
  price: number
  priority: number
  ticketIds: string[]
  hasMultiplePrices: boolean
}

export interface TicketDisplay {
  summary: string | null
  detailLines: string[]
  primaryPrice: number | null
  lines: TicketDisplayLine[]
  compactLines: TicketDisplayLine[]
}

function formatYen(price: number) {
  return `¥${price.toLocaleString('ru-RU')}`
}

function normalizeTicketType(type: string, ticketId: string) {
  const haystack = `${type} ${ticketId}`.toLowerCase()

  if (/infant|0-5|0–5|preschool|до\s*6/u.test(haystack)) {
    return { key: 'infant', label: 'до 6 лет', groupLabel: 'Детский', ageLabel: 'до 6 лет', priority: 10 }
  }

  if (/primary|elementary|6-11|6–11|6-12|6–12|child|chd/u.test(haystack)) {
    return { key: 'primary', label: '6–12 лет', groupLabel: 'Детский', ageLabel: '6–12 лет', priority: 20 }
  }

  if (/middle|junior\s*high|13-15|13–15/u.test(haystack)) {
    return { key: 'middle', label: '13–15 лет', groupLabel: 'Детский', ageLabel: '13–15 лет', priority: 30 }
  }

  if (/university|college|high\s*school|student/u.test(haystack)) {
    return { key: 'student', label: '16–18 лет / студенты', groupLabel: 'Студенты', ageLabel: '16–18 / вуз', priority: 40 }
  }

  if (/senior\s*65|65\+/u.test(haystack)) {
    return { key: 'senior65', label: '65+', groupLabel: 'Пожилые', ageLabel: '65+', priority: 70 }
  }

  if (/senior\s*60|60\+/u.test(haystack)) {
    return { key: 'senior60', label: '60+', groupLabel: 'Пожилые', ageLabel: '60+', priority: 70 }
  }

  if (/adult|adl|one/u.test(haystack)) {
    return { key: 'adult', label: 'взрослый', groupLabel: 'Взрослый', ageLabel: '18+', priority: 50 }
  }

  if (/general|admission|free/u.test(haystack)) {
    return { key: 'general', label: 'общий билет', groupLabel: 'Билет', ageLabel: null, priority: 60 }
  }

  const fallback = type.trim() || 'билет'
  return { key: `custom:${fallback.toLowerCase()}`, label: fallback, groupLabel: fallback, ageLabel: null, priority: 90 }
}

function sortDisplayLines(a: TicketDisplayLine, b: TicketDisplayLine) {
  if (a.priority !== b.priority) return a.priority - b.priority
  if (a.price !== b.price) return a.price - b.price
  return a.label.localeCompare(b.label, 'ru')
}

function compactSimilarSchoolLines(lines: TicketDisplayLine[]) {
  const primary = lines.find((line) => line.key === 'primary')
  const middle = lines.find((line) => line.key === 'middle')

  if (!primary || !middle || primary.price !== middle.price) {
    return lines
  }

  const merged: TicketDisplayLine = {
    key: 'school-6-15',
    label: '6–15 лет',
    groupLabel: 'Детский',
    ageLabel: '6–15 лет',
    price: primary.price,
    priority: 20,
    ticketIds: [...primary.ticketIds, ...middle.ticketIds],
    hasMultiplePrices: primary.hasMultiplePrices || middle.hasMultiplePrices,
  }

  return [
    ...lines.filter((line) => line.key !== 'primary' && line.key !== 'middle'),
    merged,
  ].sort(sortDisplayLines)
}

function chooseCompactLines(lines: TicketDisplayLine[]) {
  const adult = lines.find((line) => line.key === 'adult')
  const general = lines.find((line) => line.key === 'general')
  const childOrStudent = lines.find((line) => ['infant', 'primary', 'school-6-15', 'middle', 'student'].includes(line.key))
  const senior = lines.find((line) => line.key.startsWith('senior'))

  const result = [adult ?? general ?? lines[0], childOrStudent, senior]
    .filter((line): line is TicketDisplayLine => Boolean(line))

  return result.filter((line, index, arr) => arr.findIndex((candidate) => candidate.key === line.key) === index)
}

export function buildTicketDisplay(tickets: AirtableTicket[]): TicketDisplay {
  const grouped = new Map<string, TicketDisplayLine[]>()

  for (const ticket of tickets) {
    if (!Number.isFinite(ticket.price) || ticket.price < 0) continue

    const normalized = normalizeTicketType(ticket.type, ticket.ticketId)
    const group = grouped.get(normalized.key) ?? []
    group.push({
      ...normalized,
      price: ticket.price,
      ticketIds: ticket.ticketId ? [ticket.ticketId] : [],
      hasMultiplePrices: false,
    })
    grouped.set(normalized.key, group)
  }

  let lines = [...grouped.entries()].map(([key, group]) => {
    const base = group[0]
    const prices = [...new Set(group.map((line) => line.price))].sort((a, b) => a - b)
    const price = prices[0]

    return {
      key,
      label: base.label,
      groupLabel: base.groupLabel,
      ageLabel: base.ageLabel,
      price,
      priority: base.priority,
      ticketIds: [...new Set(group.flatMap((line) => line.ticketIds))],
      hasMultiplePrices: prices.length > 1,
    } satisfies TicketDisplayLine
  }).sort(sortDisplayLines)

  lines = compactSimilarSchoolLines(lines)

  const detailLines = lines.map((line) => {
    const price = line.price === 0 ? 'бесплатно' : formatYen(line.price)
    const prefix = line.hasMultiplePrices ? 'от ' : ''
    return `${line.label}: ${prefix}${price}`
  })

  const compactLines = chooseCompactLines(lines)
  const summary = compactLines.length > 0
    ? compactLines
        .map((line) => {
          const price = line.price === 0 ? 'бесплатно' : formatYen(line.price)
          const prefix = line.hasMultiplePrices ? 'от ' : ''
          return `${line.label} ${prefix}${price}`
        })
        .join(' · ')
    : null

  const primaryLine = lines.find((line) => line.key === 'adult')
    ?? lines.find((line) => line.key === 'general')
    ?? lines.find((line) => line.price > 0)
    ?? null

  return {
    summary,
    detailLines,
    primaryPrice: primaryLine?.price ?? null,
    lines,
    compactLines,
  }
}
