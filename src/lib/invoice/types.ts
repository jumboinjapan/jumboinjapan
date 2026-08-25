import type { InvoiceClientId } from './config'

/** Позиция инвойса — то, что уходит в строку таблицы. */
export interface InvoiceRow {
  /** Готовая формулировка для документа (обычно японская). */
  desc: string
  qty: number
  unitPrice: number
  total: number
  /** Исходная русская строка — ключ для правок и для словаря. */
  source: string
}

/** Полный инвойс: и для отрисовки PDF, и для отдачи в интерфейс. */
export interface InvoiceData {
  /** Адресат: от него зависят бланк, язык позиций, валюта и серия номера. */
  client: InvoiceClientId
  number: string
  /** ISO-дата инвойса (YYYY-MM-DD). */
  date: string
  guest: string
  dates: string
  days: number
  dayRate: number
  rows: InvoiceRow[]
  /** Сумма без услуг гида — то, что идёт как 立替金. */
  advancesTotal: number
  grandTotal: number
  /** Что стоит проверить глазами: не переведено, не сошлись суммы. */
  warnings: string[]
}

/** Разобранная строка расхода до перевода. */
export interface ParsedExpense {
  source: string
  qty: number
  unitPrice: number
  total: number
}
