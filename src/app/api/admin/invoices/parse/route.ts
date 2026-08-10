import { NextRequest, NextResponse } from 'next/server'

import { requireAdminSession, requireSameOrigin } from '@/lib/admin-guard'
import { buildInvoice } from '@/lib/invoice/parse'

/**
 * Разбор вставленного списка расходов: текст → позиции инвойса.
 *
 * Ничего не пишет и не хранит — чистая функция за периметром авторизации.
 * Экран зовёт этот роут на каждое изменение формы, поэтому он должен быть
 * дешёвым: PDF здесь не рисуется.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied
  const crossOrigin = requireSameOrigin(request)
  if (crossOrigin) return crossOrigin

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Ожидался JSON' }, { status: 400 })
  }

  const invoice = buildInvoice({
    text: typeof body.text === 'string' ? body.text : '',
    guest: typeof body.guest === 'string' ? body.guest : undefined,
    dates: typeof body.dates === 'string' ? body.dates : undefined,
    days: Number(body.days) || 0,
    rate: Number(body.rate) || undefined,
    date: typeof body.date === 'string' && body.date ? body.date : undefined,
  })

  return NextResponse.json({ ok: true, invoice })
}
