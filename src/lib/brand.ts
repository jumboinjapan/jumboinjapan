import { BASE_URL } from '@/lib/schema'

/**
 * Единый источник бренд-реквизитов и каркасных лейблов печатного документа
 * (2026-07-16). До него имя гида, email, домен, метка бренда и подписи типов
 * дня были зашиты РАЗДЕЛЬНО в PDF-генераторе (`src/lib/pdf/tour-program-pdf.ts`)
 * и в HTML-превью печати (`src/app/admin/print/[...slug]/page.tsx`) — правка
 * почты или подписи требовала ручного обхода нескольких файлов и легко
 * рассинхронивала PDF с превью.
 *
 * Теперь оба рендерера читают отсюда. Это НЕ пер-туровые данные (они живут в
 * конструкторе/Airtable) и НЕ редактируемые из админки оговорки (те — таблица
 * Document Settings, `document-settings-storage.ts`): здесь то, что одинаково
 * для всех туров и меняется раз в год — правится в этом файле, в одном месте.
 *
 * Домен берётся из `BASE_URL` (`schema.ts`) — второго объявления адреса сайта
 * не заводим.
 */

/** Имя частного гида — фигурирует на обложке и в метаданных PDF. */
const GUIDE_NAME = 'Эдуард Ревидович'

/** Название бренда в человекочитаемом регистре. */
const BRAND_NAME = 'Jumbo in Japan'

/** Домен без схемы — «jumboinjapan.com» из канонического BASE_URL. */
const DOMAIN = BASE_URL.replace(/^https?:\/\//, '')

/** Контактная почта для клиентских документов. */
const EMAIL = 'hello@jumboinjapan.com'

export const BRAND = {
  guideName: GUIDE_NAME,
  brandName: BRAND_NAME,
  domain: DOMAIN,
  url: BASE_URL,
  email: EMAIL,

  /** Метка бренда капсом (закрытие PDF, шапка админки). */
  mark: 'JUMBO IN JAPAN',

  /** Эйлайн на обложке PDF (капс, разрядка). */
  coverEyebrow: `JUMBO IN JAPAN · ЧАСТНЫЙ ГИД ${GUIDE_NAME.toUpperCase()}`,

  /** Бренд-строка на обложке HTML-превью (обычный регистр). */
  previewBrandLine: `${BRAND_NAME} · частный гид ${GUIDE_NAME}`,

  /** Контактная строка в подвале документа. */
  contactLine: `${DOMAIN} · ${EMAIL}`,

  /** Метаданные PDF-файла. */
  pdfAuthor: `${BRAND_NAME} — ${GUIDE_NAME}`,
  pdfCreator: DOMAIN,
  pdfSubject: 'Программа тура',
} as const

/**
 * Подписи типов дня в печатной программе. Каркас шаблона, не контент тура —
 * раньше константа дублировалась в PDF-генераторе и в HTML-превью; правка в
 * одном месте молча расходилась с другим. Теперь один источник.
 */
export const DAY_TYPE_LABELS: Record<string, string> = {
  arrival: 'Прилёт',
  touring: 'Экскурсионный день',
  departure: 'Отъезд',
  independent: 'Самостоятельный день',
}
