import { NextRequest, NextResponse } from 'next/server'

import { requireAdminSession, requireSameOrigin } from '@/lib/admin-guard'
import { invoiceFileName, recalcInvoice } from '@/lib/invoice/parse'
import type { InvoiceData } from '@/lib/invoice/types'
import { attachReceipts, renderInvoicePdf, type ReceiptFile } from '@/lib/pdf/invoice-pdf'

/**
 * PDF инвойса. Два режима на одном роуте:
 *   application/json      — предпросмотр, без чеков (зовётся на каждую правку)
 *   multipart/form-data   — итоговый файл: поле `invoice` (JSON) + файлы `receipts`
 *
 * Node-рантайм обязателен — pdfkit читает шрифты и печать с диска. Файлы
 * попадают в бандл функции через outputFileTracingIncludes в next.config.ts.
 *
 * Ничего не сохраняется на сервере: файловая система на Vercel только для
 * чтения, а хранить инвойсы с персональными данными «на всякий случай» смысла
 * нет. Готовый PDF уходит в браузер, дальше владелец кладёт его куда нужно.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_RECEIPT_BYTES = 25 * 1024 * 1024
const MAX_RECEIPTS = 30

function isInvoiceData(value: unknown): value is InvoiceData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<InvoiceData>
  return typeof data.number === 'string' && Array.isArray(data.rows)
}

export async function POST(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied
  const crossOrigin = requireSameOrigin(request)
  if (crossOrigin) return crossOrigin

  let raw: unknown
  const receipts: ReceiptFile[] = []
  const contentType = request.headers.get('content-type') ?? ''

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      raw = JSON.parse(String(form.get('invoice') ?? 'null'))
      for (const entry of form.getAll('receipts')) {
        if (!(entry instanceof File) || !entry.size) continue
        if (receipts.length >= MAX_RECEIPTS) break
        if (entry.size > MAX_RECEIPT_BYTES) continue
        receipts.push({
          name: entry.name,
          type: entry.type,
          bytes: new Uint8Array(await entry.arrayBuffer()),
        })
      }
    } else {
      raw = await request.json()
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Не разобрал запрос' }, { status: 400 })
  }

  const payload = raw && typeof raw === 'object' && 'invoice' in (raw as object)
    ? (raw as { invoice: unknown }).invoice
    : raw

  if (!isInvoiceData(payload)) {
    return NextResponse.json({ ok: false, error: 'Нет данных инвойса' }, { status: 400 })
  }
  if (!payload.rows.length) {
    return NextResponse.json({ ok: false, error: 'В инвойсе нет позиций' }, { status: 400 })
  }

  try {
    const invoice = recalcInvoice(payload)
    const rendered = await renderInvoicePdf(invoice)
    const { pdf, pagesAdded, warnings } = await attachReceipts(rendered, receipts)

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${invoiceFileName(invoice.number)}"`,
        'Cache-Control': 'no-store',
        'X-Invoice-Number': encodeURIComponent(invoice.number),
        'X-Receipt-Pages': String(pagesAdded),
        'X-Invoice-Warnings': encodeURIComponent(warnings.join(' | ')),
      },
    })
  } catch (error) {
    console.error('[invoices/pdf]', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Не удалось собрать PDF' },
      { status: 500 },
    )
  }
}
