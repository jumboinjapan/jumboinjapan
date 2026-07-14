import fs from 'node:fs'
import path from 'node:path'

import PDFDocument from 'pdfkit'

import type { MultiDayPrintProgram, DayTourPrintProgram, PrintProgram } from '@/lib/print-program'

/**
 * PDF-генератор программ туров (2026-07-14).
 *
 * Почему не печать HTML из браузера: у браузерной печати нет колонтитулов,
 * нет обложки, шрифт зависит от машины гостя, а переносы и разрывы страниц
 * непредсказуемы. Программа тура — первый документ, который гость держит в
 * руках; она должна выглядеть как издание, а не как выгрузка.
 *
 * Гарнитуры вшиты в репозиторий (PT Serif / PT Sans, кириллица): документ
 * выглядит одинаково у нас, у гостя и в типографии.
 *
 * Все размеры в пунктах (1 pt = 1/72"). A4 = 595 × 842 pt.
 */

// ── Палитра «дорогой бумаги» (та же, что на сайте) ────────────────────────────
const INK = '#1E1710'
const INK_SOFT = '#5D5145'
const INK_FAINT = '#9A8D7D'
const ACCENT = '#8C3722'
const RULE = '#D8CFC2'
const PAPER = '#FDFAF6'

const PAGE = { width: 595.28, height: 841.89 }
const MARGIN = { top: 62, bottom: 64, left: 64, right: 64 }
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right

const FONT_DIR = path.join(process.cwd(), 'src/assets/fonts')
const FONTS = {
  serif: path.join(FONT_DIR, 'PT_Serif-Web-Regular.ttf'),
  serifBold: path.join(FONT_DIR, 'PT_Serif-Web-Bold.ttf'),
  serifItalic: path.join(FONT_DIR, 'PT_Serif-Web-Italic.ttf'),
  sans: path.join(FONT_DIR, 'PT_Sans-Web-Regular.ttf'),
  sansBold: path.join(FONT_DIR, 'PT_Sans-Web-Bold.ttf'),
}

const DAY_TYPE_LABELS: Record<string, string> = {
  arrival: 'Прилёт',
  touring: 'Экскурсионный день',
  departure: 'Отъезд',
  independent: 'Самостоятельный день',
}

/**
 * Служебные элементы (транспорт, отель, питание, свободное время) — это
 * логистика, а не впечатление. В документе они идут тихой строкой: иначе
 * «Частный транспорт» весит столько же, сколько храм Сэнсо-дзи.
 */
const SERVICE_ITEM_TYPES = new Set(['transport', 'hotel', 'meal', 'arrival', 'departure', 'day_block'])
const SERVICE_TITLES = new Set([
  'частный транспорт',
  'общественный транспорт',
  'заказной транспорт',
  'самостоятельный трансфер',
  'лимузин сервис',
  'свободное время',
  'прилёт',
  'выезд',
])

function isServiceItem(itemType: string, title: string) {
  return SERVICE_ITEM_TYPES.has(itemType) || SERVICE_TITLES.has(title.trim().toLowerCase())
}

type Doc = InstanceType<typeof PDFDocument>

function formatDayDate(date: Date): string {
  const formatted = date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    timeZone: 'UTC',
  })
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function formatToday(): string {
  return new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Заливка страницы «бумагой» — иначе PDF на экране выглядит стерильно-белым. */
function paintPage(doc: Doc) {
  doc.save().rect(0, 0, PAGE.width, PAGE.height).fill(PAPER).restore()
}

/** Разрядка: pdfkit не умеет letter-spacing, поэтому вставляем тонкие пробелы. */
function tracked(text: string): string {
  return text.split('').join(' ')
}

function hairline(doc: Doc, y: number, x = MARGIN.left, width = CONTENT_WIDTH) {
  doc.save().moveTo(x, y).lineTo(x + width, y).lineWidth(0.5).stroke(RULE).restore()
}

// ── Обложка ──────────────────────────────────────────────────────────────────

function drawCover(doc: Doc, opts: { title: string; intro: string; clientName: string; meta: string; heroPath?: string }) {
  paintPage(doc)

  // Обложка с фотографией, если она задана у маршрута: изображение сверху
  // на треть страницы, текст — под ним. Без фото — чистая типографская обложка.
  let cursor = MARGIN.top

  if (opts.heroPath && fs.existsSync(opts.heroPath)) {
    try {
      const imageHeight = 260
      doc.save()
      doc.rect(0, 0, PAGE.width, imageHeight).clip()
      doc.image(opts.heroPath, 0, 0, { cover: [PAGE.width, imageHeight], align: 'center', valign: 'center' })
      doc.restore()
      cursor = imageHeight + 56
    } catch {
      // Битое изображение не должно ронять генерацию документа.
    }
  }

  doc
    .font(FONTS.sansBold)
    .fontSize(8)
    .fillColor(ACCENT)
    .text(tracked('JUMBO IN JAPAN · ЧАСТНЫЙ ГИД ЭДУАРД РЕВИДОВИЧ'), MARGIN.left, cursor, { width: CONTENT_WIDTH })

  cursor = doc.y + 28

  doc
    .font(FONTS.serif)
    .fontSize(30)
    .fillColor(INK)
    .text(opts.title, MARGIN.left, cursor, { width: CONTENT_WIDTH - 40, lineGap: 4 })

  cursor = doc.y + 22
  hairline(doc, cursor, MARGIN.left, 64)
  cursor += 24

  if (opts.clientName) {
    doc
      .font(FONTS.serifItalic)
      .fontSize(14)
      .fillColor(INK_SOFT)
      .text(`Программа для: ${opts.clientName}`, MARGIN.left, cursor, { width: CONTENT_WIDTH })
    cursor = doc.y + 12
  }

  if (opts.intro) {
    doc
      .font(FONTS.serif)
      .fontSize(12.5)
      .fillColor(INK_SOFT)
      .text(opts.intro, MARGIN.left, cursor, { width: CONTENT_WIDTH - 60, lineGap: 3.5 })
    cursor = doc.y + 18
  }

  doc
    .font(FONTS.sans)
    .fontSize(9)
    .fillColor(INK_FAINT)
    .text(opts.meta, MARGIN.left, cursor, { width: CONTENT_WIDTH })

  // Подпись внизу обложки
  doc
    .font(FONTS.sans)
    .fontSize(8.5)
    .fillColor(INK_FAINT)
    .text(`Подготовлено ${formatToday()}`, MARGIN.left, PAGE.height - MARGIN.bottom - 10, { width: CONTENT_WIDTH })
}

// ── Колонтитулы ──────────────────────────────────────────────────────────────

function drawRunningHeader(doc: Doc, text: string) {
  doc
    .font(FONTS.sans)
    .fontSize(7.5)
    .fillColor(INK_FAINT)
    .text(tracked(text.toUpperCase()), MARGIN.left, 34, { width: CONTENT_WIDTH, lineBreak: false })
  hairline(doc, 48)
}

function drawFooter(doc: Doc, pageNumber: number) {
  const y = PAGE.height - 42
  hairline(doc, y - 12)
  doc
    .font(FONTS.sans)
    .fontSize(7.5)
    .fillColor(INK_FAINT)
    .text('jumboinjapan.com', MARGIN.left, y, { width: CONTENT_WIDTH / 2, lineBreak: false })
  doc
    .font(FONTS.sans)
    .fontSize(7.5)
    .fillColor(INK_FAINT)
    .text(String(pageNumber), MARGIN.left, y, { width: CONTENT_WIDTH, align: 'right', lineBreak: false })
}

/** Новая содержательная страница: бумага + колонтитулы + курсор под шапкой. */
function startContentPage(doc: Doc, state: { page: number; header: string }) {
  doc.addPage()
  state.page += 1
  paintPage(doc)
  drawRunningHeader(doc, state.header)
  drawFooter(doc, state.page)
  doc.y = MARGIN.top + 8
  doc.x = MARGIN.left
}

/** Хватает ли места до нижнего поля; если нет — новая страница. */
function ensureSpace(doc: Doc, needed: number, state: { page: number; header: string }) {
  if (doc.y + needed > PAGE.height - MARGIN.bottom - 20) {
    startContentPage(doc, state)
  }
}

// ── Блоки контента ───────────────────────────────────────────────────────────

function drawDayHeader(doc: Doc, opts: { dayNumber: number; title: string; typeLabel: string; date: string; overnight: string }) {
  const y = doc.y

  // Строка-линейка: «ДЕНЬ 4 ──────── 18 июля, суббота · Экскурсионный день»
  doc.font(FONTS.sansBold).fontSize(8).fillColor(ACCENT)
  const dayLabel = tracked(`ДЕНЬ ${opts.dayNumber}`)
  const dayLabelWidth = doc.widthOfString(dayLabel)
  doc.text(dayLabel, MARGIN.left, y, { lineBreak: false })

  const right = [opts.date, opts.typeLabel].filter(Boolean).join(' · ')
  doc.font(FONTS.sans).fontSize(8).fillColor(INK_FAINT)
  const rightWidth = doc.widthOfString(tracked(right.toUpperCase()))
  doc.text(tracked(right.toUpperCase()), MARGIN.left + CONTENT_WIDTH - rightWidth, y, { lineBreak: false })

  const lineY = y + 4.5
  const lineStart = MARGIN.left + dayLabelWidth + 10
  const lineEnd = MARGIN.left + CONTENT_WIDTH - rightWidth - 10
  if (lineEnd > lineStart) hairline(doc, lineY, lineStart, lineEnd - lineStart)

  doc.y = y + 20

  doc
    .font(FONTS.serif)
    .fontSize(21)
    .fillColor(INK)
    .text(opts.title, MARGIN.left, doc.y, { width: CONTENT_WIDTH, lineGap: 2 })

  if (opts.overnight) {
    doc
      .font(FONTS.sans)
      .fontSize(9)
      .fillColor(INK_FAINT)
      .text(`Ночёвка: ${opts.overnight}`, MARGIN.left, doc.y + 6, { width: CONTENT_WIDTH })
  }

  doc.y += 14
}

function drawDayLead(doc: Doc, text: string) {
  const startY = doc.y
  doc
    .font(FONTS.serifItalic)
    .fontSize(11.5)
    .fillColor(INK_SOFT)
    .text(text, MARGIN.left + 14, startY, { width: CONTENT_WIDTH - 14, lineGap: 3 })
  const endY = doc.y
  doc.save().moveTo(MARGIN.left, startY + 2).lineTo(MARGIN.left, endY - 2).lineWidth(1.5).stroke(ACCENT).restore()
  doc.y = endY + 16
}

function drawStop(doc: Doc, opts: { number: number; title: string; description: string }) {
  const numberColumn = 26
  const textLeft = MARGIN.left + numberColumn
  const textWidth = CONTENT_WIDTH - numberColumn
  const y = doc.y

  doc
    .font(FONTS.sansBold)
    .fontSize(9)
    .fillColor(ACCENT)
    .text(String(opts.number).padStart(2, '0'), MARGIN.left, y + 2, { width: numberColumn, lineBreak: false })

  doc
    .font(FONTS.serifBold)
    .fontSize(13)
    .fillColor(INK)
    .text(opts.title, textLeft, y, { width: textWidth, lineGap: 1 })

  if (opts.description) {
    doc
      .font(FONTS.sans)
      .fontSize(10)
      .fillColor(INK_SOFT)
      .text(opts.description, textLeft, doc.y + 4, { width: textWidth, lineGap: 2.5 })
  }

  doc.y += 16
}

function drawServiceLine(doc: Doc, opts: { label: string; body: string }) {
  const left = MARGIN.left + 26
  const startY = doc.y

  doc
    .font(FONTS.sansBold)
    .fontSize(7.5)
    .fillColor(INK_FAINT)
    .text(tracked(opts.label.toUpperCase()), left + 12, startY, { width: CONTENT_WIDTH - 38 })

  if (opts.body) {
    doc
      .font(FONTS.sans)
      .fontSize(9.5)
      .fillColor(INK_SOFT)
      .text(opts.body, left + 12, doc.y + 2, { width: CONTENT_WIDTH - 38, lineGap: 2 })
  }

  const endY = doc.y
  doc.save().moveTo(left, startY).lineTo(left, endY).lineWidth(0.5).stroke(RULE).restore()
  doc.y = endY + 14
}

// ── Документы ────────────────────────────────────────────────────────────────

function renderMultiDay(doc: Doc, program: MultiDayPrintProgram, clientName: string) {
  const { route } = program
  const heroPath = route.heroImagePath
    ? path.join(process.cwd(), 'public', route.heroImagePath.replace(/^\//, ''))
    : undefined

  drawCover(doc, {
    title: program.title,
    intro: program.intro,
    clientName,
    meta: `${route.dayCount} дней · ${route.startCity} → ${route.endCity}`,
    heroPath,
  })

  const state = { page: 1, header: program.title }
  const startDate = route.startDate ? new Date(route.startDate) : null
  const segmentById = new Map(
    route.days.flatMap((day) => day.transportSegments.map((segment) => [segment.id, segment] as const)),
  )

  for (const day of route.days) {
    // Каждый день — с новой страницы: гость листает документ по дням.
    startContentPage(doc, state)

    const dayDate = startDate ? new Date(startDate.getTime() + (day.dayNumber - 1) * 86400000) : null
    drawDayHeader(doc, {
      dayNumber: day.dayNumber,
      title: day.dayTitle || `День ${day.dayNumber}`,
      typeLabel: DAY_TYPE_LABELS[day.dayType] ?? day.dayType,
      date: dayDate ? formatDayDate(dayDate) : '',
      overnight: day.overnightCity,
    })

    const lead = day.printLead || day.daySummary
    if (lead) {
      ensureSpace(doc, 60, state)
      drawDayLead(doc, lead)
    }

    let stopNumber = 0
    for (const item of day.items) {
      const title = item.displayTitle || item.poiTitle
      if (!title) continue

      if (isServiceItem(item.itemType, title)) {
        const segment = item.transportSegmentId ? segmentById.get(item.transportSegmentId) : undefined
        const body = [item.shortDescription, segment?.reservationNote, segment?.baggageNote].filter(Boolean).join('\n')
        ensureSpace(doc, 50, state)
        drawServiceLine(doc, { label: segment?.displayLabel || title, body })
        continue
      }

      stopNumber += 1
      ensureSpace(doc, 70, state)
      drawStop(doc, { number: stopNumber, title, description: item.shortDescription })
    }

    if (day.printFooterNote) {
      ensureSpace(doc, 40, state)
      doc
        .font(FONTS.serifItalic)
        .fontSize(10)
        .fillColor(INK_SOFT)
        .text(day.printFooterNote, MARGIN.left, doc.y + 4, { width: CONTENT_WIDTH, lineGap: 2 })
    }
  }

  drawClosing(doc, state)
}

function renderDayTour(doc: Doc, program: DayTourPrintProgram, clientName: string) {
  drawCover(doc, {
    title: program.title,
    intro: program.intro,
    clientName,
    meta: [program.tourStartTime, program.tourEndTime].filter(Boolean).join(' — '),
  })

  const state = { page: 1, header: program.title }
  startContentPage(doc, state)

  for (const stop of program.stops) {
    ensureSpace(doc, 90, state)
    drawStop(doc, { number: stop.order, title: stop.title, description: stop.description })

    if (stop.whyThisStopMatters) {
      ensureSpace(doc, 50, state)
      drawServiceLine(doc, { label: 'Зачем эта точка в маршруте', body: stop.whyThisStopMatters })
    }
    if (stop.workingHours) {
      ensureSpace(doc, 30, state)
      drawServiceLine(doc, { label: 'Часы работы', body: stop.workingHours })
    }
    if (stop.transitionToNext || stop.travelNoteToNext) {
      ensureSpace(doc, 40, state)
      drawServiceLine(doc, {
        label: 'Переход',
        body: [stop.transitionToNext, stop.travelNoteToNext].filter(Boolean).join('\n'),
      })
    }
  }

  drawClosing(doc, state)
}

/** Финальная полоса: контакт и честная оговорка о предварительности программы. */
function drawClosing(doc: Doc, state: { page: number; header: string }) {
  ensureSpace(doc, 120, state)
  const y = doc.y + 24
  hairline(doc, y)

  doc
    .font(FONTS.serif)
    .fontSize(11)
    .fillColor(INK_SOFT)
    .text(
      'Программа предварительная: порядок точек, время и состав дня мы уточняем вместе — под погоду, ваш темп и то, что окажется интересным на месте.',
      MARGIN.left,
      y + 18,
      { width: CONTENT_WIDTH - 60, lineGap: 3 },
    )

  doc
    .font(FONTS.sansBold)
    .fontSize(9)
    .fillColor(ACCENT)
    .text(tracked('JUMBO IN JAPAN'), MARGIN.left, doc.y + 18, { width: CONTENT_WIDTH })

  doc
    .font(FONTS.sans)
    .fontSize(9)
    .fillColor(INK_FAINT)
    .text('jumboinjapan.com · hello@jumboinjapan.com', MARGIN.left, doc.y + 4, { width: CONTENT_WIDTH })
}

// ── Точка входа ──────────────────────────────────────────────────────────────

export async function renderTourProgramPdf(program: PrintProgram, clientName = ''): Promise<Buffer> {
  const doc = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margins: MARGIN,
    autoFirstPage: true,
    bufferPages: true,
    info: {
      Title: program.title,
      Author: 'Jumbo in Japan — Эдуард Ревидович',
      Subject: 'Программа тура',
      Creator: 'jumboinjapan.com',
    },
  })

  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  if (program.kind === 'multi-day') {
    renderMultiDay(doc, program, clientName)
  } else {
    renderDayTour(doc, program, clientName)
  }

  doc.end()
  return done
}
