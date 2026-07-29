/**
 * Предельная длина текста по ролям — единый источник правды.
 *
 * Откуда числа. Замерена фактическая ёмкость строки на мобильном (390 px,
 * это узкое место — десктоп заведомо шире) для каждой роли в её настоящем
 * контейнере и кегле:
 *
 *   роль                кегль   знаков в строке
 *   герой h1            35 px   18
 *   заголовок раздела   29 px   22
 *   заголовок карточки  25 px   23
 *   вопрос FAQ          18 px   28
 *   метка-надзаголовок  11 px   38
 *   лид                 17 px   40
 *
 * Дальше — арифметика: «идеал» это столько знаков, сколько помещается в
 * комфортное число строк, «предел» — на строку больше. За пределом заголовок
 * начинает ломать блок: карточка растёт в высоту и рвёт сетку, шапка раздела
 * съезжает на четыре строки и перестаёт читаться как заголовок.
 *
 * Правило, ради которого всё это существует: длинный заголовок не лечится
 * уменьшением кегля. Кегль — часть иерархии, и если его двигать под текст,
 * иерархия рассыпается. Лечится текст.
 *
 * ГДЕ ПРИМЕНЯЕТСЯ:
 *   — админка: подсказка под полем (CopyLengthHint) предупреждает на вводе;
 *   — CI/локально: npm run check:copy — проходит по коду и Airtable;
 *   — агенты-копирайтеры: канон в CLAUDE.md ссылается сюда.
 */

export type CopyRole =
  | 'heroTitle'
  | 'pageTitle'
  | 'sectionTitle'
  | 'cardTitle'
  | 'eyebrow'
  | 'lead'
  | 'intro'
  | 'cardSummary'
  | 'faqQuestion'
  | 'faqAnswer'
  | 'ctaLabel'
  | 'metaTitle'
  | 'metaDescription'

export interface CopyLimit {
  /** Человеческое имя роли — попадает в текст предупреждения. */
  label: string
  /** Комфортная длина: столько текста роль несёт без напряжения. */
  ideal: number
  /** Предел: дальше блок начинает ломаться. */
  max: number
  /** Чем обосновано — показывается в подсказке, чтобы решение не выглядело произволом. */
  rationale: string
}

export const COPY_LIMITS: Record<CopyRole, CopyLimit> = {
  heroTitle: {
    label: 'Заголовок героя',
    ideal: 36,
    max: 54,
    rationale: 'На телефоне 18 знаков в строке: идеал — две строки, предел — три.',
  },
  pageTitle: {
    label: 'Заголовок страницы (h1)',
    ideal: 40,
    max: 60,
    rationale: 'Две строки на телефоне; третья уже отодвигает содержание за первый экран.',
  },
  sectionTitle: {
    label: 'Шапка раздела (h2)',
    ideal: 44,
    max: 66,
    rationale: '22 знака в строке: две строки — заголовок, четыре — абзац, набранный крупно.',
  },
  cardTitle: {
    label: 'Заголовок карточки (h3)',
    ideal: 26,
    max: 46,
    rationale: 'Одна строка держит сетку карточек ровной; вторая допустима, третья ломает ряд.',
  },
  eyebrow: {
    label: 'Метка над заголовком',
    ideal: 32,
    max: 38,
    rationale: 'Разрядка съедает ширину: в две строки прописная метка превращается в шум.',
  },
  lead: {
    label: 'Лид-абзац',
    ideal: 120,
    max: 160,
    rationale: 'Три строки на телефоне. Дальше это уже не подводка, а первый абзац текста.',
  },
  intro: {
    label: 'Вводный текст маршрута',
    ideal: 420,
    max: 700,
    rationale: 'Три-четыре предложения. Дальше вступление конкурирует с программой ниже.',
  },
  cardSummary: {
    label: 'Описание карточки',
    ideal: 140,
    max: 200,
    rationale: 'Четыре строки. Карточки в ряду выравниваются по самой высокой.',
  },
  faqQuestion: {
    label: 'Вопрос FAQ',
    ideal: 56,
    max: 84,
    rationale: 'Вопрос должен читаться в свёрнутом виде целиком, не разворачивая ответ.',
  },
  faqAnswer: {
    label: 'Ответ FAQ',
    ideal: 400,
    max: 700,
    rationale: 'Ответ длиннее — признак того, что вопросов на самом деле два.',
  },
  ctaLabel: {
    label: 'Надпись на кнопке',
    ideal: 20,
    max: 28,
    rationale: 'Кнопка не переносится: длинная надпись растягивает её на всю колонку.',
  },
  metaTitle: {
    label: 'SEO-заголовок',
    ideal: 55,
    max: 60,
    rationale: 'Дальше поисковая выдача обрезает — читатель не увидит хвост.',
  },
  metaDescription: {
    label: 'SEO-описание',
    ideal: 150,
    max: 160,
    rationale: 'Дальше поисковая выдача обрезает — читатель не увидит хвост.',
  },
}

export type CopyLengthStatus = 'ok' | 'warn' | 'over'

export interface CopyLengthCheck {
  role: CopyRole
  label: string
  length: number
  ideal: number
  max: number
  status: CopyLengthStatus
  /** Готовая формулировка для человека; null, когда всё в порядке. */
  message: string | null
}

/**
 * Считает длину без учёта краевых пробелов и схлопывая внутренние —
 * иначе лишний перенос строки съедал бы лимит.
 */
export function copyLength(text: string): number {
  return text.trim().replace(/\s+/g, ' ').length
}

export function checkCopyLength(role: CopyRole, text: string): CopyLengthCheck {
  const limit = COPY_LIMITS[role]
  const length = copyLength(text)
  const status: CopyLengthStatus = length > limit.max ? 'over' : length > limit.ideal ? 'warn' : 'ok'

  const message =
    status === 'over'
      ? `${limit.label}: ${length} знаков при пределе ${limit.max}. ${limit.rationale} Нужно сократить на ${length - limit.max}.`
      : status === 'warn'
        ? `${limit.label}: ${length} знаков, комфортно до ${limit.ideal}. ${limit.rationale}`
        : null

  return { role, label: limit.label, length, ideal: limit.ideal, max: limit.max, status, message }
}
