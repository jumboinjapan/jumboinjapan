/**
 * Реквизиты инвойса Global Strategy, LLC → INARI TRAVEL.
 *
 * Отдельно от src/lib/brand.ts намеренно: brand.ts — реквизиты JumboInJapan
 * для программ туров, здесь — юридическое лицо, которое выставляет счёт
 * туроператору. Совпадает только человек-подписант.
 *
 * Меняется раз в год (банк, адрес), поэтому живёт в коде, а не в Airtable.
 */

export const INVOICE_CONFIG = {
  company: {
    nameEn: 'GLOBAL STRATEGY LLC',
    address: ['#506, 1-11-1 Higashi', 'Ayase, Adachi-ku, Tokyo'],
    signerTitle: 'Managing Director',
    signerName: 'Revidovich Eduard',
  },

  paymentDetails: [
    'BENEFICIARY: GLOBAL STRATEGY, LLC',
    'BANK: BANK OF TOKYO MITSUBISHI UFJ',
    'BANK TEL: 03-3881-0131',
    'BRANCH: SENJU BRANCH (166)',
    'SWIFT: BOTKJPJT',
    'ACCOUNT: 0144923 (futsu)',
  ],

  client: {
    attn: 'ストリグノフ・セルゲイ様',
    companyPrefix: '株式会社',
    companyName: 'INARI TRAVEL',
  },

  invoice: {
    titleJp: '請求書',
    numberPrefix: '#GS-INR',
    filePrefix: 'GSINR',
    tableHeader: ['Services renderd', 'Units', 'Unitprice', 'Total'] as const,
    footerLines: [
      'We appreciate your business and look forward to working on our project, we will',
      'do all possible to assure best possible result.',
    ],
  },

  /** Услуги гида: ставка за один день работы. Переопределяется в форме. */
  guide: {
    dayRate: 75000,
    /** {guest} и {dates} подставляются из формы. */
    labelTemplate: 'Service Rendered for {guest} {dates}',
    /** Строка-маркер: по нему отличаем работу гида от 立替金-позиций. */
    sourceMarker: 'услуги гида',
  },

  /** Временный заём: суффикс ко всем позициям, кроме услуг гида. */
  advance: {
    suffix: '立替金',
    /** Идеографический пробел — как в исходном бланке Numbers. */
    separator: '　',
  },

  /** Блёклое зеркальное отражение подписи — есть в исходном бланке. */
  showReflection: true,
} as const
