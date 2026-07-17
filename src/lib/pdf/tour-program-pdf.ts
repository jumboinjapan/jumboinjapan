import fs from 'node:fs'
import path from 'node:path'

import PDFDocument from 'pdfkit'

import { isOwnerActionNote } from '@/lib/print-program'
import type { MultiDayPrintProgram, DayTourPrintProgram, PrintProgram, PrintPricingSummary } from '@/lib/print-program'
import { BRAND, DAY_TYPE_LABELS } from '@/lib/brand'

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
  drawWatermark(doc)
}

/**
 * Водяной знак jumboinjapan.com на каждой странице (задание владельца
 * 2026-07-14: чтобы программу не «уводили» без источника). Рисуется сразу
 * после заливки бумаги — под контентом, диагонально, еле заметный.
 */
function drawWatermark(doc: Doc) {
  const prevX = doc.x
  const prevY = doc.y
  doc.save()
  doc.rotate(-32, { origin: [PAGE.width / 2, PAGE.height / 2] })
  doc
    .font(FONTS.sansBold)
    .fontSize(52)
    .fillColor(ACCENT)
    .fillOpacity(0.055)
    .text(BRAND.domain, 0, PAGE.height / 2 - 26, { width: PAGE.width, align: 'center', lineBreak: false })
  doc.restore()
  // save/restore возвращает графическое состояние PDF, но не курсор pdfkit.
  doc.x = prevX
  doc.y = prevY
}

/**
 * Разрядка капса (колонтитулы, «ДЕНЬ N», бренд-строки) — через штатный
 * characterSpacing pdfkit. Первая версия вставляла тонкие пробелы U+2009,
 * которых нет в PT Sans — во всех разреженных строках печатались квадраты.
 */
const TRACKING = 1.6

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
    .text(BRAND.coverEyebrow, MARGIN.left, cursor, { width: CONTENT_WIDTH, characterSpacing: TRACKING })

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

  // Подпись внизу обложки (у нижнего поля — без автопереноса страницы)
  textBelowBottomMargin(doc, () => {
    doc
      .font(FONTS.sans)
      .fontSize(8.5)
      .fillColor(INK_FAINT)
      .text(`Подготовлено ${formatToday()}`, MARGIN.left, PAGE.height - MARGIN.bottom - 10, {
        width: CONTENT_WIDTH,
        lineBreak: false,
      })
  })
}

// ── Колонтитулы ──────────────────────────────────────────────────────────────

function drawRunningHeader(doc: Doc, text: string) {
  doc
    .font(FONTS.sans)
    .fontSize(7.5)
    .fillColor(INK_FAINT)
    .text(text.toUpperCase(), MARGIN.left, 34, { width: CONTENT_WIDTH, lineBreak: false, characterSpacing: TRACKING })
  hairline(doc, 48)
}

/**
 * Текст ниже нижнего поля страницы (колонтитулы, подпись обложки). pdfkit
 * автоматически добавляет страницу, когда строка не помещается до margins.bottom
 * — даже с lineBreak: false. Из-за этого каждый колонтитул порождал ПУСТУЮ
 * страницу после содержательной (баг первой версии генератора). Обнуляем
 * нижнее поле на время печати и возвращаем обратно.
 */
function textBelowBottomMargin(doc: Doc, draw: () => void) {
  const bottomMargin = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  draw()
  doc.page.margins.bottom = bottomMargin
}

function drawFooter(doc: Doc, pageNumber: number) {
  const y = PAGE.height - 42
  hairline(doc, y - 12)
  textBelowBottomMargin(doc, () => {
    doc
      .font(FONTS.sans)
      .fontSize(7.5)
      .fillColor(INK_FAINT)
      .text(BRAND.domain, MARGIN.left, y, { width: CONTENT_WIDTH / 2, lineBreak: false })
    doc
      .font(FONTS.sans)
      .fontSize(7.5)
      .fillColor(INK_FAINT)
      .text(String(pageNumber), MARGIN.left, y, { width: CONTENT_WIDTH, align: 'right', lineBreak: false })
  })
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
  const dayLabel = `ДЕНЬ ${opts.dayNumber}`
  const dayLabelWidth = doc.widthOfString(dayLabel, { characterSpacing: TRACKING })
  doc.text(dayLabel, MARGIN.left, y, { lineBreak: false, characterSpacing: TRACKING })

  const rightText = [opts.date, opts.typeLabel].filter(Boolean).join(' · ').toUpperCase()
  doc.font(FONTS.sans).fontSize(8).fillColor(INK_FAINT)
  // Длинная дата («Понедельник, 17 августа · …») в разрядку может быть шире
  // строки и наехать на «ДЕНЬ N» — если не помещается, печатаем без разрядки.
  let rightTracking = TRACKING
  let rightWidth = doc.widthOfString(rightText, { characterSpacing: rightTracking })
  if (rightWidth > CONTENT_WIDTH - dayLabelWidth - 24) {
    rightTracking = 0
    rightWidth = doc.widthOfString(rightText)
  }
  doc.text(rightText, MARGIN.left + CONTENT_WIDTH - rightWidth, y, { lineBreak: false, characterSpacing: rightTracking })

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
      // «Гостиница», не «ночёвка» — решение владельца 2026-07-15 (просторечие в клиентской выдаче).
      .text(`Гостиница: ${opts.overnight}`, MARGIN.left, doc.y + 6, { width: CONTENT_WIDTH })
  }

  doc.y += 14
}

function drawDayLead(doc: Doc, text: string) {
  const startY = doc.y
  // Вводка с примечанием владельца («Уточнить: …») — акцентом, чтобы не потерялась.
  const isAction = isOwnerActionNote(text)
  doc
    .font(FONTS.serifItalic)
    .fontSize(11.5)
    .fillColor(isAction ? ACCENT : INK_SOFT)
    .text(text, MARGIN.left + 14, startY, { width: CONTENT_WIDTH - 14, lineGap: 3 })
  const endY = doc.y
  doc.save().moveTo(MARGIN.left, startY + 2).lineTo(MARGIN.left, endY - 2).lineWidth(1.5).stroke(ACCENT).restore()
  doc.y = endY + 16
}

/**
 * Остановка. Два уровня текста:
 *  — подпись из конструктора (зачем эта точка именно в этом дне),
 *  — полное описание POI из базы (что это за место).
 * Гость читает документ перед поездкой — ему нужно и то, и другое; дублирующий
 * текст мы отсекаем, чтобы не печатать одно и то же дважды.
 */
function drawStop(
  doc: Doc,
  opts: { number: number; title: string; note: string; description: string; workingHours: string },
) {
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

  const note = opts.note.trim()
  const description = opts.description.trim()
  const noteIsRedundant = note && description && description.startsWith(note.slice(0, 40))

  if (note && !noteIsRedundant) {
    // Примечания владельца («Требует предварительной организации», «по желанию
    // гостей», «Уточнить: …») — крупнее и акцентом: их легко пропустить.
    const noteIsAction = isOwnerActionNote(note)
    doc
      .font(FONTS.sansBold)
      .fontSize(noteIsAction ? 10.5 : 9.5)
      .fillColor(noteIsAction ? ACCENT : INK)
      .text(note, textLeft, doc.y + 5, { width: textWidth, lineGap: 2 })
  }

  if (description) {
    doc
      .font(FONTS.serif)
      .fontSize(10.5)
      .fillColor(INK_SOFT)
      .text(description, textLeft, doc.y + 5, { width: textWidth, lineGap: 3, align: 'left' })
  }

  if (opts.workingHours) {
    doc
      .font(FONTS.sans)
      .fontSize(8.5)
      .fillColor(INK_FAINT)
      .text(`Часы работы: ${opts.workingHours}`, textLeft, doc.y + 5, { width: textWidth, lineGap: 1.5 })
  }

  doc.y += 18
}

function drawServiceLine(doc: Doc, opts: { label: string; body: string }) {
  const left = MARGIN.left + 26
  const startY = doc.y

  doc
    .font(FONTS.sansBold)
    .fontSize(7.5)
    .fillColor(INK_FAINT)
    .text(opts.label.toUpperCase(), left + 12, startY, { width: CONTENT_WIDTH - 38, characterSpacing: TRACKING })

  if (opts.body) {
    const bodyIsAction = isOwnerActionNote(opts.body)
    doc
      .font(bodyIsAction ? FONTS.sansBold : FONTS.sans)
      .fontSize(bodyIsAction ? 10.5 : 9.5)
      .fillColor(bodyIsAction ? ACCENT : INK_SOFT)
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
    // Продолжительность намеренно не печатается (решение владельца 2026-07-18):
    // поле переменное — программа под клиента может расти/сжиматься.
    meta: [route.startCity, route.endCity].filter(Boolean).join(' → '),
    heroPath,
  })

  const state = { page: 1, header: program.title }
  const startDate = route.startDate ? new Date(route.startDate) : null
  const segmentById = new Map(
    route.days.flatMap((day) => day.transportSegments.map((segment) => [segment.id, segment] as const)),
  )

  // Компактный поток (решение владельца 2026-07-15): день продолжает текущую
  // страницу, если на ней хватает места под шапку дня, вводный абзац и хотя бы
  // одну точку (~240 pt) — иначе документ на 14 дней раздувался до 18 страниц,
  // где «свободные» дни занимали по целой странице с одной строкой.
  const DAY_MIN_SPACE = 240
  let isFirstDay = true

  for (const day of route.days) {
    if (isFirstDay || doc.y + DAY_MIN_SPACE > PAGE.height - MARGIN.bottom - 20) {
      startContentPage(doc, state)
      isFirstDay = false
    } else {
      // Продолжаем страницу: воздух перед линейкой следующего дня.
      doc.y += 30
    }

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
      const details = program.poiDetailsByItemId[item.id]
      ensureSpace(doc, 110, state)
      drawStop(doc, {
        number: stopNumber,
        title,
        note: item.shortDescription,
        description: details?.description ?? '',
        workingHours: details?.workingHours ?? '',
      })
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

  // Смета есть в программе всегда, когда расчёт заполнен; в PDF она попадает
  // только при включённом флажке «Печатать в PDF» (HTML-превью показывает всегда).
  if (program.pricing?.printInPdf) {
    drawPricingPage(doc, state, program.pricing)
  }

  drawClosing(doc, state, program.disclaimers)
}

/**
 * Страница «Стоимость программы» (задание владельца 2026-07-14): цена на
 * человека с разбивкой по статьям. Печатается только если в конструкторе
 * включён флажок «Печатать в PDF» блока «Расчёт тура».
 */
function drawPricingPage(doc: Doc, state: { page: number; header: string }, pricing: PrintPricingSummary) {
  startContentPage(doc, state)

  doc
    .font(FONTS.sansBold)
    .fontSize(8)
    .fillColor(ACCENT)
    .text('СТОИМОСТЬ ПРОГРАММЫ', MARGIN.left, doc.y, { width: CONTENT_WIDTH, characterSpacing: TRACKING })

  doc.y += 10

  doc
    .font(FONTS.serif)
    .fontSize(21)
    .fillColor(INK)
    .text('Стоимость программы', MARGIN.left, doc.y, { width: CONTENT_WIDTH, lineGap: 2 })

  doc.y += 18

  // ── Таблица по дням: какой день — какая работа, ночёвка гида ──
  if (pricing.dayRows && pricing.dayRows.length > 0) {
    const nightColWidth = 84
    const workColWidth = 84
    const dayColWidth = 56
    const nightX = MARGIN.left + CONTENT_WIDTH - nightColWidth
    const workX = nightX - workColWidth
    const formatX = MARGIN.left + dayColWidth

    // Шапка таблицы
    doc.font(FONTS.sansBold).fontSize(7).fillColor(INK_FAINT)
    const headerY = doc.y
    doc.text('ДЕНЬ', MARGIN.left, headerY, { lineBreak: false, characterSpacing: 1 })
    doc.text('ФОРМАТ РАБОТЫ', formatX, headerY, { lineBreak: false, characterSpacing: 1 })
    doc.text('РАБОТА ГИДА', workX, headerY, { width: workColWidth, align: 'right', lineBreak: false, characterSpacing: 1 })
    doc.text('НОЧЁВКА ГИДА', nightX, headerY, { width: nightColWidth, align: 'right', lineBreak: false, characterSpacing: 1 })
    doc.y = headerY + 12
    hairline(doc, doc.y)
    doc.y += 8

    for (const row of pricing.dayRows) {
      ensureSpace(doc, 18, state)
      const rowY = doc.y
      doc.font(FONTS.sansBold).fontSize(9).fillColor(INK).text(row.day, MARGIN.left, rowY, { lineBreak: false })
      doc
        .font(FONTS.sans)
        .fontSize(9)
        .fillColor(INK_SOFT)
        .text(row.format, formatX, rowY, { width: workX - formatX - 10, lineBreak: false })
      doc.font(FONTS.sans).fontSize(9).fillColor(INK).text(row.work, workX, rowY, { width: workColWidth, align: 'right', lineBreak: false })
      doc
        .font(FONTS.sans)
        .fontSize(9)
        .fillColor(row.night === '—' ? INK_FAINT : INK)
        .text(row.night, nightX, rowY, { width: nightColWidth, align: 'right', lineBreak: false })
      doc.y = rowY + 15
    }

    doc.y += 4
    hairline(doc, doc.y)
    doc.y += 16
  }

  for (const line of pricing.lines) {
    ensureSpace(doc, line.note ? 68 : 34, state)
    const y = doc.y

    // Сумма — первой: doc.text с явной позицией сбрасывает doc.y, поэтому
    // левая колонка (label/detail/note) рисуется после и честно двигает курсор.
    doc
      .font(FONTS.sansBold)
      .fontSize(11)
      .fillColor(INK)
      .text(line.amount, MARGIN.left, y + 1, { width: CONTENT_WIDTH, align: 'right', lineBreak: false })

    doc
      .font(FONTS.serif)
      .fontSize(11.5)
      .fillColor(INK)
      .text(line.label, MARGIN.left, y, { width: CONTENT_WIDTH - 110, lineGap: 1.5 })

    if (line.detail) {
      doc
        .font(FONTS.sans)
        .fontSize(8.5)
        .fillColor(INK_FAINT)
        .text(line.detail, MARGIN.left, doc.y + 2, { width: CONTENT_WIDTH - 110 })
    }

    // Ремарка владельца из матрицы Pricing: что включено/не включено в ставку.
    if (line.note) {
      doc
        .font(FONTS.serifItalic)
        .fontSize(9)
        .fillColor(INK_SOFT)
        .text(line.note, MARGIN.left, doc.y + 3, { width: CONTENT_WIDTH - 110, lineGap: 1.5 })
    }

    doc.y += 10
    hairline(doc, doc.y)
    doc.y += 12
  }

  ensureSpace(doc, 80, state)
  doc.y += 6

  const totalY = doc.y
  doc
    .font(FONTS.serifBold)
    .fontSize(13)
    .fillColor(INK)
    .text('Итого', MARGIN.left, totalY, { lineBreak: false })
  doc
    .font(FONTS.serifBold)
    .fontSize(13)
    .fillColor(INK)
    .text(pricing.total, MARGIN.left, totalY, { width: CONTENT_WIDTH, align: 'right', lineBreak: false })

  doc.y = totalY + 22

  if (pricing.perPerson && pricing.paxCount) {
    const perPersonY = doc.y
    doc
      .font(FONTS.serif)
      .fontSize(11.5)
      .fillColor(INK_SOFT)
      .text(`Стоимость на человека (группа ${pricing.paxCount} чел.)`, MARGIN.left, perPersonY, { lineBreak: false })
    doc
      .font(FONTS.sansBold)
      .fontSize(12)
      .fillColor(ACCENT)
      .text(pricing.perPerson, MARGIN.left, perPersonY, { width: CONTENT_WIDTH, align: 'right', lineBreak: false })
    doc.y = perPersonY + 26
  }
  // Общей оговорки внизу нет: что включено и что оплачивается по факту,
  // говорят ремарки владельца под каждой строкой (Pricing.Notes).
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
    ensureSpace(doc, 110, state)
    // У однодневных туров описание уже каноническое (Stop Override → POI Approved),
    // отдельной «подписи» нет — поэтому note пуст.
    drawStop(doc, {
      number: stop.order,
      title: stop.title,
      note: '',
      description: stop.description,
      workingHours: stop.workingHours,
    })

    if (stop.whyThisStopMatters) {
      ensureSpace(doc, 50, state)
      drawServiceLine(doc, { label: 'Зачем эта точка в маршруте', body: stop.whyThisStopMatters })
    }
    if (stop.transitionToNext || stop.travelNoteToNext) {
      ensureSpace(doc, 40, state)
      drawServiceLine(doc, {
        label: 'Переход',
        body: [stop.transitionToNext, stop.travelNoteToNext].filter(Boolean).join('\n'),
      })
    }
  }

  drawClosing(doc, state, program.disclaimers)
}

/**
 * Финальная полоса: глобальные оговорки (Document Settings) и контакт.
 * Тексты оговорок приходят из программы (build-время, print-program.ts) —
 * если владелец их отключил, блок оговорок просто не печатается. Бренд-строка
 * и контакт — из единого источника brand.ts.
 */
function drawClosing(doc: Doc, state: { page: number; header: string }, disclaimers: string[]) {
  ensureSpace(doc, 120, state)
  const y = doc.y + 24
  hairline(doc, y)
  doc.y = y + 18

  for (const disclaimer of disclaimers) {
    ensureSpace(doc, 40, state)
    doc
      .font(FONTS.serif)
      .fontSize(11)
      .fillColor(INK_SOFT)
      .text(disclaimer, MARGIN.left, doc.y, { width: CONTENT_WIDTH - 60, lineGap: 3 })
    doc.y += 8
  }

  doc
    .font(FONTS.sansBold)
    .fontSize(9)
    .fillColor(ACCENT)
    .text(BRAND.mark, MARGIN.left, doc.y + 10, { width: CONTENT_WIDTH, characterSpacing: TRACKING })

  doc
    .font(FONTS.sans)
    .fontSize(9)
    .fillColor(INK_FAINT)
    .text(BRAND.contactLine, MARGIN.left, doc.y + 4, { width: CONTENT_WIDTH })
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
      Author: BRAND.pdfAuthor,
      Subject: BRAND.pdfSubject,
      Creator: BRAND.pdfCreator,
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
