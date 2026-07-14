import { NextRequest, NextResponse } from 'next/server'

import { requireAdminSession } from '@/lib/admin-guard'
import { PRICING_RATE_KEYS } from '@/lib/tour-pricing'
import { loadTourPricingMatrix, updateTourPricingMatrix } from '@/lib/tour-pricing-storage'
import type { TourPricingRateKey } from '@/lib/multi-day-builder'

/**
 * Матрица базовых ставок расчёта тура (таблица Pricing в Airtable).
 * GET — текущие ставки для блока «Расчёт тура» конструктора;
 * PATCH { rates: { guide_day?: number, ... } } — обновление Amount.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const matrix = await loadTourPricingMatrix()
    return NextResponse.json({ matrix })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const body = (await request.json()) as { rates?: Record<string, unknown> }
    const rates = body.rates ?? {}

    const updates: Array<{ key: TourPricingRateKey; amount: number }> = []
    for (const key of PRICING_RATE_KEYS) {
      if (!(key in rates)) continue
      const amount = typeof rates[key] === 'number' ? (rates[key] as number) : Number(rates[key])
      if (!Number.isFinite(amount) || amount < 0) {
        return NextResponse.json({ error: `Некорректная ставка для «${key}»` }, { status: 400 })
      }
      updates.push({ key, amount })
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Нет ставок для обновления' }, { status: 400 })
    }

    const matrix = await updateTourPricingMatrix(updates)
    return NextResponse.json({ ok: true, matrix })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
