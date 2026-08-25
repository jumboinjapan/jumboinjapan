/**
 * Реквизиты инвойса: отправитель Global Strategy, LLC и адресаты.
 *
 * Отдельно от src/lib/brand.ts намеренно: brand.ts — реквизиты JumboInJapan
 * для программ туров, здесь — юридическое лицо, которое выставляет счёт.
 * Совпадает только человек-подписант.
 *
 * Меняется раз в год (банк, адрес), поэтому живёт в коде, а не в Airtable.
 *
 * Адресатов теперь двое, и различаются они не только названием: японскому
 * туроператору уходит японский бланк с переводом позиций и суффиксом 立替金,
 * британскому — английский, в долларах и без единого иероглифа. Всё, что от
 * адресата зависит, собрано в INVOICE_CLIENTS; всё, что общее, осталось в
 * INVOICE_CONFIG.
 */

/** Общее для всех адресатов: отправитель, банк, шапка таблицы, подвал. */
export const INVOICE_CONFIG = {
  company: {
    nameEn: 'GLOBAL STRATEGY LLC',
    address: ['#506, 1-11-1 Higashi', 'Ayase, Adachi-ku, Tokyo'],
    signerTitle: 'Managing Director',
    signerName: 'Revidovich Eduard',
  },

  /**
   * Счёт иеновый. Долларовые инвойсы уходят на него же — конвертирует банк
   * (решение владельца 2026-08-25), поэтому второго набора реквизитов нет.
   */
  paymentDetails: [
    'BENEFICIARY: GLOBAL STRATEGY, LLC',
    'BANK: BANK OF TOKYO MITSUBISHI UFJ',
    'BANK TEL: 03-3881-0131',
    'BRANCH: SENJU BRANCH (166)',
    'SWIFT: BOTKJPJT',
    'ACCOUNT: 0144923 (futsu)',
  ],

  invoice: {
    tableHeader: ['Services renderd', 'Units', 'Unitprice', 'Total'] as const,
    footerLines: [
      'We appreciate your business and look forward to working on our project, we will',
      'do all possible to assure best possible result.',
    ],
  },

  guide: {
    /** {guest} и {dates} подставляются из формы. */
    labelTemplate: 'Service Rendered for {guest} {dates}',
    /** Строка-маркер: по нему отличаем работу гида от прочих позиций. */
    sourceMarker: 'услуги гида',
  },

  /** Временный заём: суффикс ко всем позициям японского бланка, кроме гида. */
  advance: {
    suffix: '立替金',
    /** Идеографический пробел — как в исходном бланке Numbers. */
    separator: '　',
  },

  /** Блёклое зеркальное отражение подписи — есть в исходном бланке. */
  showReflection: true,
} as const

// ── Адресаты ─────────────────────────────────────────────────────────────────

export type InvoiceCurrency = 'JPY' | 'USD'

export const CURRENCY_SIGN: Record<InvoiceCurrency, string> = { JPY: '¥', USD: '$' }

export type InvoiceClientId = 'inari' | 'helentours'

export interface InvoiceClient {
  id: InvoiceClientId
  /** Как адресат называется в селекторе формы. */
  label: string
  /** Заголовок документа: 請求書 или INVOICE. */
  title: string
  /** Строка ATTN. Пустая — строки в бланке не будет. */
  attn: string
  /** Блок адресата: название и адрес, по строке на строку бланка. */
  lines: readonly string[]
  /** Префикс номера: #GS-INR07082026. */
  numberPrefix: string
  /** Префикс имени файла: GSINR07082026.pdf. */
  filePrefix: string
  currency: InvoiceCurrency
  /** Переводить ли позиции на японский и вешать 立替金. */
  translate: boolean
  /** Ставка гида за день по умолчанию, в валюте адресата. */
  dayRate: number
}

export const INVOICE_CLIENTS: Record<InvoiceClientId, InvoiceClient> = {
  inari: {
    id: 'inari',
    label: 'INARI TRAVEL',
    title: '請求書',
    attn: 'ストリグノフ・セルゲイ様',
    lines: ['株式会社　INARI TRAVEL'],
    numberPrefix: '#GS-INR',
    filePrefix: 'GSINR',
    currency: 'JPY',
    translate: true,
    dayRate: 75000,
  },
  helentours: {
    id: 'helentours',
    label: 'Helentours Concierge Management',
    title: 'INVOICE',
    attn: '',
    lines: [
      'Helentours Concierge Management Ltd',
      'Unit A3, Gateway Tower, 32 Western Gateway',
      'London E16 1YL, UK',
    ],
    numberPrefix: '#GS-HEL',
    filePrefix: 'GSHEL',
    currency: 'USD',
    translate: false,
    dayRate: 500,
  },
}

export const DEFAULT_INVOICE_CLIENT: InvoiceClientId = 'inari'

/** Порядок в селекторе формы. */
export const INVOICE_CLIENT_LIST: readonly InvoiceClient[] = [
  INVOICE_CLIENTS.inari,
  INVOICE_CLIENTS.helentours,
]

/** Адресат по идентификатору. Незнакомый и пустой — Inari: серия старше. */
export function invoiceClient(id: string | null | undefined): InvoiceClient {
  return id && id in INVOICE_CLIENTS
    ? INVOICE_CLIENTS[id as InvoiceClientId]
    : INVOICE_CLIENTS[DEFAULT_INVOICE_CLIENT]
}

/** Номер инвойса от даты: #GS-INR07082026. */
export function invoiceNumberFor(isoDate: string, clientId?: string | null): string {
  const [y, m, d] = isoDate.split('-')
  return `${invoiceClient(clientId).numberPrefix}${d}${m}${y}`
}

/**
 * Имя файла от номера: GSINR07082026.pdf.
 *
 * Хвост режется по первой цифре, а не по префиксу: если адресата переключили
 * после того, как номер уже собрался, префикс в номере от нынешнего отличается,
 * и подстановочная замена оставила бы в имени файла чужую серию.
 */
export function invoiceFileName(number: string, clientId?: string | null): string {
  const tail = number.replace(/^\D*/, '') || number.replace(/[^A-Za-z0-9]/g, '')
  return `${invoiceClient(clientId).filePrefix}${tail}.pdf`
}

/** Сумма со знаком валюты адресата. */
export function invoiceMoney(value: number, currency: InvoiceCurrency): string {
  return `${CURRENCY_SIGN[currency]}${(value || 0).toLocaleString('en-US')}`
}
