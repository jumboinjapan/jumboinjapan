/**
 * Разбор вставленного списка расходов и перевод позиций на японский.
 *
 * Формат ввода — тот, в котором владелец и так ведёт расходы по маршруту:
 *
 *   +       1,200 налог Westin
 *   +       1,710 посещение zuihoden
 *   -------------
 *   +       2,910
 *
 * Плюсы, пробелы, запятые в числах и линейка игнорируются; одинокая сумма
 * внизу считается контрольной и сверяется с суммой позиций.
 *
 * Количество:
 *   «+ 42,000 x3 канатная дорога» — 42 000 всего, три штуки по 14 000
 *   «+ 14,000 @3 канатная дорога» — 14 000 за штуку, три штуки, итого 42 000
 */

import { INVOICE_CONFIG } from './config'
import {
  INVOICE_KINDS,
  INVOICE_OVERRIDES,
  INVOICE_PLACES,
  INVOICE_ROUTE_TERMS,
  type DictKind,
  type DictPlace,
} from './dictionary'
import type { InvoiceData, InvoiceRow, ParsedExpense } from './types'

// ── Разбор текста ────────────────────────────────────────────────────────────

const HEADER_ALIASES: Record<string, string> = {
  'гость': 'guest', 'guest': 'guest', 'турист': 'guest', 'группа': 'guest',
  'даты': 'dates', 'dates': 'dates', 'период': 'dates',
  'дней': 'days', 'дни': 'days', 'days': 'days',
  'ставка': 'rate', 'rate': 'rate',
  'дата': 'invoiceDate', 'invoice date': 'invoiceDate',
  'номер': 'number', 'number': 'number',
}

const HEADER_RE = /^([A-Za-zА-Яа-яЁё №]+)\s*[:：]\s*(.+)$/
const AMOUNT_RE = /^\s*[+＋]?\s*[¥￥]?\s*([0-9][0-9\s.,]*)\s*(?:円|yen|jpy)?\s*(.*)$/i
const QTY_TOTAL_RE = /(?:^|\s)[xхXХ×]\s*(\d+)(?:\s|$)/
const QTY_UNIT_RE = /(?:^|\s)@\s*(\d+)(?:\s|$)/
const SEPARATOR_RE = /^[\s+\-–—_=*.]{3,}$/

export interface ParseResult {
  headers: Record<string, string>
  expenses: ParsedExpense[]
  /** Итоговая сумма из текста, если она там была. */
  control: number | null
  warnings: string[]
}

function parseAmount(raw: string): number | null {
  const s = raw.replace(/[\s ,]/g, '')
  if (!s) return null
  // «1.200» — это тысяча двести, а «1200.50» — копейки; различаем по хвосту
  const dotted = s.match(/^(\d+)\.(\d{1,2})$/)
  if (dotted) return Math.round(parseFloat(s))
  const digits = s.replace(/\./g, '')
  return /^\d+$/.test(digits) ? parseInt(digits, 10) : null
}

export function parseExpenseText(text: string): ParseResult {
  const headers: Record<string, string> = {}
  const expenses: ParsedExpense[] = []
  const warnings: string[] = []
  let control: number | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || SEPARATOR_RE.test(line)) continue

    const header = HEADER_RE.exec(line)
    if (header) {
      const key = HEADER_ALIASES[header[1].trim().toLowerCase()]
      if (key) {
        headers[key] = header[2].trim()
        continue
      }
    }

    const match = AMOUNT_RE.exec(line)
    if (!match) {
      warnings.push(`строка не разобрана и пропущена: «${line}»`)
      continue
    }

    const amount = parseAmount(match[1])
    let desc = match[2].trim().replace(/^[.,;·—-]+|[.,;·—-]+$/g, '').trim()
    if (amount === null) {
      warnings.push(`не понял сумму и пропустил: «${line}»`)
      continue
    }
    if (!desc) {
      control = amount // одинокая сумма внизу списка — контрольный итог
      continue
    }

    let qty = 1
    let unitPrice = amount
    let total = amount

    const asTotal = QTY_TOTAL_RE.exec(desc)
    const asUnit = QTY_UNIT_RE.exec(desc)
    if (asTotal) {
      qty = parseInt(asTotal[1], 10)
      desc = desc.replace(QTY_TOTAL_RE, ' ').trim()
      if (qty > 0 && amount % qty === 0) {
        unitPrice = amount / qty
      } else {
        unitPrice = amount
        total = amount * qty
        warnings.push(`«${desc}»: ${amount.toLocaleString('en-US')} не делится на ${qty} — счёл это ценой за штуку`)
      }
    } else if (asUnit) {
      qty = parseInt(asUnit[1], 10)
      desc = desc.replace(QTY_UNIT_RE, ' ').trim()
      unitPrice = amount
      total = amount * qty
    }

    expenses.push({ source: desc, qty, unitPrice, total })
  }

  return { headers, expenses, control, warnings }
}

// ── Перевод RU → JP ──────────────────────────────────────────────────────────

const ROUTE_RE = /^(.+?)\s*(?:\s-\s|[—–ー→>])\s*(.+)$/

function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/^[.,;:\s]+|[.,;:\s]+$/g, '')
}

function findBest<T extends { keys: string[]; transport?: boolean }>(
  entries: readonly T[],
  text: string,
): { entry: T | null; key: string } {
  let best: T | null = null
  let bestKey = ''
  let bestRank: [number, number] = [-1, 0]

  for (const entry of entries) {
    for (const rawKey of entry.keys) {
      const key = normalize(rawKey)
      if (!key || !text.includes(key)) continue
      const rank: [number, number] = [entry.transport ? 1 : 0, key.length]
      if (rank[0] > bestRank[0] || (rank[0] === bestRank[0] && rank[1] > bestRank[1])) {
        best = entry
        bestKey = key
        bestRank = rank
      }
    }
  }
  return { entry: best, key: bestKey }
}

/** «Одавара — отель» → «小田原ーホテル». null, если это не маршрут. */
function translateRoute(rest: string): string | null {
  const match = ROUTE_RE.exec(rest)
  if (!match) return null

  const ends: string[] = []
  for (const raw of [match[1], match[2]]) {
    const part = normalize(raw).replace(/^[-—–\s]+|[-—–\s]+$/g, '')
    if (!part) return null
    let term: string | undefined = INVOICE_ROUTE_TERMS[part]
    if (!term) {
      const place = findBest<DictPlace>(INVOICE_PLACES, part).entry
      term = place?.jp
    }
    if (!term) return null
    ends.push(term)
  }
  return ends.join('ー')
}

/** 箱根ロープウェイ + ロープウェイ乗車券代 → 箱根ロープウェイ　乗車券代 */
function joinWithoutRepeat(place: string, kind: string, separator: string): string {
  let tail = kind
  for (let n = Math.min(place.length, kind.length); n > 1; n -= 1) {
    if (place.endsWith(kind.slice(0, n))) {
      tail = kind.slice(n)
      break
    }
  }
  return tail ? place + separator + tail : place
}

export interface Translation {
  jp: string
  /** Нужен ли суффикс 立替金. */
  advance: boolean
  warning: string | null
}

export function translateExpense(source: string): Translation {
  const norm = normalize(source)

  for (const [key, jp] of Object.entries(INVOICE_OVERRIDES)) {
    if (normalize(key) === norm) return { jp, advance: true, warning: null }
  }

  const kindMatch = findBest<DictKind>(INVOICE_KINDS, norm)
  let kind = kindMatch.entry

  // «такси Одавара — отель» → タクシー代　小田原ーホテル
  if (kind?.transport) {
    const route = translateRoute(norm.replace(kindMatch.key, ' '))
    if (route) {
      return { jp: kind.jp + INVOICE_CONFIG.advance.separator + route, advance: true, warning: null }
    }
  }

  const place = findBest<DictPlace>(INVOICE_PLACES, norm).entry
  const placeKind = place?.kind

  // Вид расхода объекта точнее общего «посещение/билет» — общий ему уступает
  if (kind && placeKind && kind.generic) kind = null

  const kindJp = kind ? kind.jp : placeKind
  const advance = !(kind?.no_advance)

  if (place && kindJp) {
    return { jp: joinWithoutRepeat(place.jp, kindJp, INVOICE_CONFIG.advance.separator), advance, warning: null }
  }
  if (place) {
    return { jp: place.jp, advance, warning: `«${source}»: не понял вид расхода, оставил только объект` }
  }
  if (kindJp) {
    return { jp: kindJp, advance, warning: `«${source}»: не узнал объект, оставил только вид расхода` }
  }
  return { jp: source, advance: true, warning: `«${source}»: НЕТ В СЛОВАРЕ — впишите японское название вручную` }
}

/** Перевод плюс суффикс 立替金 там, где он нужен. */
export function describeExpense(source: string): { desc: string; warning: string | null } {
  const { jp, advance, warning } = translateExpense(source)
  const { suffix, separator } = INVOICE_CONFIG.advance
  const desc = advance && suffix && !jp.includes(suffix) ? jp + separator + suffix : jp
  return { desc, warning }
}

// ── Сборка инвойса ───────────────────────────────────────────────────────────

export interface BuildInvoiceInput {
  text: string
  guest?: string
  dates?: string
  days?: number
  rate?: number
  /** ISO-дата (YYYY-MM-DD). По умолчанию — сегодня по японскому времени. */
  date?: string
  number?: string
}

/** Номер инвойса от даты: #GS-INR07082026. */
export function invoiceNumberFor(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${INVOICE_CONFIG.invoice.numberPrefix}${d}${m}${y}`
}

/** Имя файла от номера: GSINR07082026.pdf. */
export function invoiceFileName(number: string): string {
  const tail = number.replace(INVOICE_CONFIG.invoice.numberPrefix, '')
  return `${INVOICE_CONFIG.invoice.filePrefix}${tail}.pdf`
}

/** Сегодня в Токио — инвойс выставляется по японской дате, а не по UTC. */
export function todayInTokyo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

export function buildInvoice(input: BuildInvoiceInput): InvoiceData {
  const { headers, expenses, control, warnings: parseWarnings } = parseExpenseText(input.text ?? '')
  const warnings = [...parseWarnings]

  const date = input.date || headers.invoiceDate || todayInTokyo()
  const number = input.number || headers.number || invoiceNumberFor(date)

  const guest = input.guest ?? headers.guest ?? ''
  const dates = input.dates ?? headers.dates ?? ''
  const days = Number.isFinite(input.days) ? Number(input.days) : parseInt(headers.days ?? '0', 10) || 0
  const dayRate = Number.isFinite(input.rate) && Number(input.rate) > 0
    ? Number(input.rate)
    : parseInt(headers.rate ?? '', 10) || INVOICE_CONFIG.guide.dayRate

  const rows: InvoiceRow[] = []

  if (days > 0) {
    const label = INVOICE_CONFIG.guide.labelTemplate
      .replace('{guest}', guest)
      .replace('{dates}', dates)
      .replace(/\s{2,}/g, ' ')
      .trim()
    rows.push({
      desc: label,
      qty: days,
      unitPrice: dayRate,
      total: days * dayRate,
      source: INVOICE_CONFIG.guide.sourceMarker,
    })
  } else {
    warnings.push('дни работы гида не указаны — строка услуг гида в инвойс не попала')
  }

  for (const item of expenses) {
    const { desc, warning } = describeExpense(item.source)
    if (warning) warnings.push(warning)
    rows.push({ desc, qty: item.qty, unitPrice: item.unitPrice, total: item.total, source: item.source })
  }

  const advancesTotal = rows
    .filter((row) => row.source !== INVOICE_CONFIG.guide.sourceMarker)
    .reduce((sum, row) => sum + row.total, 0)

  if (control !== null && control !== advancesTotal) {
    warnings.push(
      `контрольная сумма в тексте ${control.toLocaleString('en-US')} ≠ сумме расходов ` +
        `${advancesTotal.toLocaleString('en-US')} — проверьте список`,
    )
  }

  return {
    number,
    date,
    guest,
    dates,
    days,
    dayRate,
    rows,
    advancesTotal,
    grandTotal: rows.reduce((sum, row) => sum + row.total, 0),
    warnings,
  }
}

/** Пересчёт после ручных правок в таблице — источник правды для сумм. */
export function recalcInvoice(data: InvoiceData): InvoiceData {
  const rows = data.rows.map((row) => {
    const qty = Math.max(0, Math.round(Number(row.qty) || 0))
    const unitPrice = Math.max(0, Math.round(Number(row.unitPrice) || 0))
    return { ...row, qty, unitPrice, total: qty * unitPrice }
  })
  const advancesTotal = rows
    .filter((row) => row.source !== INVOICE_CONFIG.guide.sourceMarker)
    .reduce((sum, row) => sum + row.total, 0)
  return { ...data, rows, advancesTotal, grandTotal: rows.reduce((sum, row) => sum + row.total, 0) }
}
