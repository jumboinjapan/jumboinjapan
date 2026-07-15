import { NextRequest, NextResponse } from 'next/server'

import { requireAdminSession } from '@/lib/admin-guard'
import { loadDisclaimers, updateDisclaimers, type DisclaimerUpdate } from '@/lib/document-settings-storage'

/**
 * Настройки печатного документа (таблица Document Settings в Airtable).
 * GET — текущие оговорки для редактора /admin/document-settings;
 * PATCH { disclaimers: [{ id, title?, text?, enabled?, order? }] } — обновление.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const disclaimers = await loadDisclaimers()
    return NextResponse.json({ disclaimers })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const body = (await request.json()) as { disclaimers?: unknown }
    const raw = Array.isArray(body.disclaimers) ? body.disclaimers : []

    const updates: DisclaimerUpdate[] = []
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue
      const record = item as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id : ''
      if (!id) continue
      const update: DisclaimerUpdate = { id }
      if (typeof record.title === 'string') update.title = record.title
      if (typeof record.text === 'string') update.text = record.text
      if (typeof record.enabled === 'boolean') update.enabled = record.enabled
      if (typeof record.order === 'number' && Number.isFinite(record.order)) update.order = record.order
      updates.push(update)
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Нет оговорок для обновления' }, { status: 400 })
    }

    const disclaimers = await updateDisclaimers(updates)
    return NextResponse.json({ ok: true, disclaimers })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
