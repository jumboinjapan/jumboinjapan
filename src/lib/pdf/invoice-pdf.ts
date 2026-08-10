/**
 * PDF-генератор инвойсов Global Strategy → INARI TRAVEL (2026-08-07).
 *
 * Вёрстка снята прямо с бланка Numbers (GSINR08062026.pdf): координаты,
 * кегли, цвета и базовые линии измерены по исходному PDF и вписаны здесь
 * константами. Инвойсы этой серии уже уходили клиенту, поэтому новый файл
 * обязан быть неотличим от прежних — при правках сверяйте наложением.
 *
 * Все размеры в пунктах. Страница 668.54 × 946.07 pt — нестандартный холст
 * Numbers; сохранён намеренно, чтобы новые инвойсы не отличались от прежних.
 *
 * Вертикаль везде считается ОТ ВЕРХА страницы (так снимались измерения),
 * pdfkit тоже рисует сверху вниз — переводить систему координат не нужно.
 *
 * Латиница — встроенная в PDF Helvetica (в оригинале Helvetica Neue Light,
 * разница на глаз незаметна и метрики близки). Японский и кириллица —
 * IPAexGothic из src/assets/fonts: Hiragino с macOS в PDF не встроить.
 */

import fs from 'node:fs'
import path from 'node:path'

import PDFDocument from 'pdfkit'

import { INVOICE_CONFIG } from '@/lib/invoice/config'
import type { InvoiceData, InvoiceRow } from '@/lib/invoice/types'

type Doc = InstanceType<typeof PDFDocument>

// ── Геометрия бланка ─────────────────────────────────────────────────────────
const PAGE = { width: 668.5393, height: 946.0674 }

const BLUE = '#367DA2'          // фирменный синий: линейки и шапка таблицы
const GREY_TITLE = '#444444'    // 請求書 и номер инвойса
const GREY_ADDR = '#606060'     // адрес компании
const GREY_DASH = '#ADADAD'     // пунктирные разделители таблицы
const GREY_HDR_SEP = '#C8D3D9'  // светлые разделители внутри синей шапки
const GREY_HDR_BOT = '#808080'  // линия под шапкой таблицы
const BLACK = '#000000'
const WHITE = '#FFFFFF'

const RULE = { x0: 67.15, x1: 593.54, topY: 45.22, topWidth: 2.5, bottomY: 736.35, bottomWidth: 0.75 }

const LOGO = { x: 50.71, top: -5.19, width: 214.31, height: 133.84 }  // в оригинале уходит за край
const SEAL = { x: 386.57, width: 77, height: 76 }
const REFLECT = { x: 195.31, width: 357.84, height: 42.63 }

const TABLE_X = [195.31, 418.94, 477.14, 535.34, 593.54]
const TABLE_TOP = 290.79
const TABLE_TOP_CONT = 120       // верх таблицы на страницах-продолжениях
const HEADER_H = 19.96
const ROW_H = 20.71
const PAD = 4
const UNITS_PAD = 4.4
const HEADER_BASE = 13.54        // базовая линия текста от верха шапки
const ROW_BASE = 13.07           // базовая линия текста от верха строки

const SIZE = {
  title: 18, attn: 9, number: 9,
  payHeader: 8, pay: 8,
  company: 9, address: 10,
  tableHeader: 10, desc: 9, units: 10, money: 9,
  footer: 10, sign: 10,
}

// смещения блока «подвал + подпись + печать» от нижней границы таблицы
const OFF = { footer1: 34.72, footer2: 49.06, signTitle: 95.74, signName: 119.09, seal: 94.85, reflect: 125.21 }
const BLOCK_BELOW_TABLE = OFF.reflect + REFLECT.height

const FONT_DIR = path.join(process.cwd(), 'src/assets/fonts')
const ASSET_DIR = path.join(process.cwd(), 'src/assets/invoice')
const JP_FONT = path.join(FONT_DIR, 'ipaexg.ttf')

/**
 * Символы, которые обязаны идти встроенным шрифтом: японский, кириллица
 * (позиции, которых нет в словаре, остаются русскими) и длинные тире, которыми
 * записываются маршруты. Всё остальное — Helvetica.
 */
const EMBEDDED_RE = new RegExp(
  '[\\u3000-\\u303F\\u3040-\\u309F\\u30A0-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF' +
    '\\uF900-\\uFAFF\\uFF00-\\uFFEF\\u0400-\\u04FF\\u2014\\u2015\\u2500\\u2116]',
)

const FONT = { latin: 'Helvetica', latinBold: 'Helvetica-Bold', jp: 'GS-JP' }

interface Run {
  text: string
  embedded: boolean
}

function splitRuns(text: string): Run[] {
  const runs: Run[] = []
  for (const ch of text) {
    const embedded = EMBEDDED_RE.test(ch)
    const last = runs[runs.length - 1]
    if (last && last.embedded === embedded) last.text += ch
    else runs.push({ text: ch, embedded })
  }
  return runs
}

function runFont(run: Run, latinFont: string) {
  return run.embedded ? FONT.jp : latinFont
}

function measure(doc: Doc, text: string, size: number, latinFont: string): number {
  return splitRuns(text).reduce((sum, run) => {
    doc.font(runFont(run, latinFont)).fontSize(size)
    return sum + doc.widthOfString(run.text)
  }, 0)
}

interface TextOptions {
  size: number
  font?: string
  color?: string
  align?: 'left' | 'right'
  /** Если строка шире — кегль уменьшается, но не ниже minSize. */
  maxWidth?: number
  minSize?: number
}

/**
 * Строка с автоматическим переключением шрифта на японских и русских буквах.
 * x — левый край (или правый, если align: 'right'), y — БАЗОВАЯ ЛИНИЯ.
 */
function drawText(doc: Doc, x: number, baseline: number, text: string, options: TextOptions): void {
  if (!text) return
  const latinFont = options.font ?? FONT.latin
  const color = options.color ?? BLACK
  let size = options.size

  if (options.maxWidth) {
    const min = options.minSize ?? 6
    while (size > min && measure(doc, text, size, latinFont) > options.maxWidth) size -= 0.25
  }

  const width = measure(doc, text, size, latinFont)
  let cursor = options.align === 'right' ? x - width : x

  doc.fillColor(color)
  for (const run of splitRuns(text)) {
    const font = runFont(run, latinFont)
    doc.font(font).fontSize(size)
    doc.text(run.text, cursor, baseline, { baseline: 'alphabetic', lineBreak: false })
    cursor += doc.widthOfString(run.text)
  }
}

function money(value: number): string {
  return `¥${value.toLocaleString('en-US')}`
}

// ── Разбивка на страницы ─────────────────────────────────────────────────────
function paginate(rows: InvoiceRow[]): InvoiceRow[][] {
  const lastBottom = RULE.bottomY - 20 - BLOCK_BELOW_TABLE
  const midBottom = RULE.bottomY - 20

  const capacity = (top: number, bottom: number, withTotal: boolean) =>
    Math.max(1, Math.floor((bottom - top - HEADER_H) / ROW_H) - (withTotal ? 1 : 0))

  if (rows.length <= capacity(TABLE_TOP, lastBottom, true)) return [rows]

  const pages: InvoiceRow[][] = []
  let rest = [...rows]
  let top = TABLE_TOP
  while (rest.length) {
    const fitsLast = rest.length <= capacity(top, lastBottom, true)
    // страница не последняя — хотя бы одна строка обязана уйти дальше,
    // иначе итоговая строка и подпись не поместятся
    const take = fitsLast ? rest.length : Math.min(rest.length - 1, capacity(top, midBottom, false))
    pages.push(rest.slice(0, take))
    rest = rest.slice(take)
    top = TABLE_TOP_CONT
  }
  return pages
}

// ── Отрисовка ────────────────────────────────────────────────────────────────
function drawLetterhead(doc: Doc, data: InvoiceData, full: boolean): void {
  // логотип первым: у JPEG белая подложка, поверх неё ложится синяя линейка
  const logo = path.join(ASSET_DIR, 'logo.jpg')
  if (fs.existsSync(logo)) doc.image(logo, LOGO.x, LOGO.top, { width: LOGO.width, height: LOGO.height })

  doc.save().moveTo(RULE.x0, RULE.topY).lineTo(RULE.x1, RULE.topY).lineWidth(RULE.topWidth).stroke(BLUE).restore()
  doc.save().moveTo(RULE.x0, RULE.bottomY).lineTo(RULE.x1, RULE.bottomY).lineWidth(RULE.bottomWidth).stroke(BLUE).restore()

  if (!full) return

  const { company, client, paymentDetails, invoice } = INVOICE_CONFIG

  drawText(doc, 68.95, 133.63, invoice.titleJp, { size: SIZE.title, color: GREY_TITLE })
  drawText(doc, 68.95, 153.61, data.number, { size: SIZE.number, color: GREY_TITLE })
  drawText(doc, 68.95, 195.46, company.nameEn, { size: SIZE.company, font: FONT.latinBold, color: BLUE })
  company.address.forEach((line, i) => {
    drawText(doc, 68.95, 210.4 + i * 14.34, line, { size: SIZE.address, color: GREY_ADDR })
  })

  drawText(doc, 199.31, 130.61, `ATTN: ${client.attn}`, { size: SIZE.attn })
  drawText(doc, 199.31, 148, `${client.companyPrefix}　${client.companyName}`, { size: SIZE.attn })
  drawText(doc, 199.31, 178.94, 'Payment Details', { size: SIZE.payHeader, font: FONT.latinBold })
  paymentDetails.forEach((line, i) => {
    drawText(doc, 199.31, 197.97 + i * 14.115, line, { size: SIZE.pay })
  })
}

function drawRowSeparator(doc: Doc, y: number): void {
  doc.save()
  doc.dash(1.5, { space: 1.5 })
  doc.moveTo(TABLE_X[0], y).lineTo(TABLE_X[2] - 0.5, y).lineWidth(0.75).stroke(GREY_DASH)
  doc.undash()
  doc.moveTo(TABLE_X[2] - 0.5, y).lineTo(TABLE_X[3], y).lineWidth(0.75).stroke(BLACK)
  doc.moveTo(TABLE_X[3], y).lineTo(TABLE_X[4], y).lineWidth(0.75).stroke(BLACK)
  doc.restore()
}

function drawTable(doc: Doc, rows: InvoiceRow[], top: number, withTotal: boolean, grandTotal: number): number {
  const headerBottom = top + HEADER_H

  doc.save().rect(TABLE_X[0], top, TABLE_X[4] - TABLE_X[0], HEADER_H).fill(BLUE).restore()
  INVOICE_CONFIG.invoice.tableHeader.forEach((title, i) => {
    drawText(doc, TABLE_X[i] + PAD, top + HEADER_BASE, title, {
      size: SIZE.tableHeader,
      font: FONT.latinBold,
      color: WHITE,
      maxWidth: TABLE_X[i + 1] - TABLE_X[i] - 2 * PAD,
    })
  })
  doc.save()
  for (const i of [1, 2, 3]) {
    doc.moveTo(TABLE_X[i], top).lineTo(TABLE_X[i], headerBottom - 0.5).lineWidth(0.25).stroke(GREY_HDR_SEP)
  }
  doc.moveTo(TABLE_X[0], headerBottom).lineTo(TABLE_X[4], headerBottom).lineWidth(0.5).stroke(GREY_HDR_BOT)
  doc.restore()

  let y = headerBottom
  for (const row of rows) {
    const baseline = y + ROW_BASE
    drawText(doc, TABLE_X[0] + PAD, baseline, row.desc, {
      size: SIZE.desc,
      maxWidth: TABLE_X[1] - TABLE_X[0] - 2 * PAD,
    })
    drawText(doc, TABLE_X[2] - UNITS_PAD, baseline, String(row.qty), { size: SIZE.units, align: 'right' })
    drawText(doc, TABLE_X[3] - PAD, baseline, money(row.unitPrice), { size: SIZE.money, align: 'right' })
    drawText(doc, TABLE_X[4] - PAD, baseline, money(row.total), { size: SIZE.money, align: 'right' })
    y += ROW_H
    drawRowSeparator(doc, y)
  }

  if (withTotal) {
    drawText(doc, TABLE_X[4] - PAD, y + ROW_BASE + 0.25, money(grandTotal), { size: SIZE.money, align: 'right' })
    y += ROW_H
    doc.save().moveTo(TABLE_X[2] - 0.5, y).lineTo(TABLE_X[4], y).lineWidth(1).stroke(BLACK).restore()
  }

  doc.save()
  doc.dash(1.5, { space: 1.5 })
  for (const i of [1, 2, 3]) {
    doc.moveTo(TABLE_X[i], top).lineTo(TABLE_X[i], y).lineWidth(0.75).stroke(GREY_DASH)
  }
  doc.undash()
  doc.restore()

  return y
}

function drawClosing(doc: Doc, tableBottom: number): void {
  const { company, invoice, showReflection } = INVOICE_CONFIG

  invoice.footerLines.forEach((line, i) => {
    drawText(doc, 199.31, tableBottom + OFF.footer1 + i * (OFF.footer2 - OFF.footer1), line, { size: SIZE.footer })
  })
  drawText(doc, 199.31, tableBottom + OFF.signTitle, company.signerTitle, { size: SIZE.sign })
  drawText(doc, 199.31, tableBottom + OFF.signName, company.signerName, { size: SIZE.sign })

  if (showReflection) {
    const reflection = path.join(ASSET_DIR, 'signature.png')
    if (fs.existsSync(reflection)) {
      doc.image(reflection, REFLECT.x, tableBottom + OFF.reflect, { width: REFLECT.width, height: REFLECT.height })
    }
  }
  const seal = path.join(ASSET_DIR, 'seal.png')
  if (fs.existsSync(seal)) {
    doc.image(seal, SEAL.x, tableBottom + OFF.seal, { width: SEAL.width, height: SEAL.height })
  }
}

/** Инвойс без чеков. Чеки подшивает attachReceipts (pdf-lib). */
export function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margin: 0,
      info: {
        Title: data.number,
        Author: INVOICE_CONFIG.company.nameEn,
        Creator: 'jumboinjapan admin',
      },
    })
    doc.registerFont(FONT.jp, JP_FONT)

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    try {
      const pages = paginate(data.rows)
      pages.forEach((pageRows, index) => {
        if (index > 0) doc.addPage()
        const isLast = index === pages.length - 1
        const top = index === 0 ? TABLE_TOP : TABLE_TOP_CONT
        drawLetterhead(doc, data, index === 0)
        const bottom = drawTable(doc, pageRows, top, isLast, data.grandTotal)
        if (isLast) drawClosing(doc, bottom)
      })
      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}

// ── Подшивка чеков ───────────────────────────────────────────────────────────

export interface ReceiptFile {
  name: string
  type: string
  bytes: Uint8Array
}

export interface AttachResult {
  pdf: Buffer
  pagesAdded: number
  warnings: string[]
}

const RECEIPT_MARGIN = 24

/**
 * Дописывает сканы чеков страницами после инвойса — в том порядке, в котором
 * их выбрали. Картинки вписываются в размер бланка, PDF переносятся как есть.
 *
 * pdfkit не умеет читать чужие PDF, поэтому склейка через pdf-lib. Если его
 * в проекте нет, инвойс всё равно соберётся — чеки просто не подошьются, и об
 * этом будет сказано в warnings, а не тихо потеряно.
 */
export async function attachReceipts(invoicePdf: Buffer, receipts: ReceiptFile[]): Promise<AttachResult> {
  if (!receipts.length) return { pdf: invoicePdf, pagesAdded: 0, warnings: [] }

  let PDFLib: typeof import('pdf-lib')
  try {
    PDFLib = await import('pdf-lib')
  } catch {
    return {
      pdf: invoicePdf,
      pagesAdded: 0,
      warnings: ['Чеки не подшиты: не установлен pdf-lib. Выполните npm install pdf-lib и повторите.'],
    }
  }

  const warnings: string[] = []
  const out = await PDFLib.PDFDocument.load(invoicePdf)
  let pagesAdded = 0

  for (const receipt of receipts) {
    const isPdf = receipt.type === 'application/pdf' || /\.pdf$/i.test(receipt.name)
    try {
      if (isPdf) {
        const source = await PDFLib.PDFDocument.load(receipt.bytes)
        const copied = await out.copyPages(source, source.getPageIndices())
        copied.forEach((page) => {
          out.addPage(page)
          pagesAdded += 1
        })
        continue
      }

      const isPng = receipt.type === 'image/png' || /\.png$/i.test(receipt.name)
      const image = isPng ? await out.embedPng(receipt.bytes) : await out.embedJpg(receipt.bytes)
      const page = out.addPage([PAGE.width, PAGE.height])
      const boxWidth = PAGE.width - 2 * RECEIPT_MARGIN
      const boxHeight = PAGE.height - 2 * RECEIPT_MARGIN
      const scale = Math.min(boxWidth / image.width, boxHeight / image.height)
      const width = image.width * scale
      const height = image.height * scale
      page.drawImage(image, {
        x: (PAGE.width - width) / 2,
        y: (PAGE.height - height) / 2,
        width,
        height,
      })
      pagesAdded += 1
    } catch (error) {
      warnings.push(
        `«${receipt.name}» не подшился: ${error instanceof Error ? error.message : 'не удалось прочитать файл'}`,
      )
    }
  }

  return { pdf: Buffer.from(await out.save()), pagesAdded, warnings }
}
