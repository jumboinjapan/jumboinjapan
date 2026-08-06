import { revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

import { requireAdminSession } from '@/lib/admin-guard'
import {
  loadAdminFaq,
  updateAdminFaq,
  FAQ_STATUS_VALUES,
  type AdminFaqUpdate,
  type FaqStatus,
} from '@/lib/admin-faq'
import { FAQ_ATTR_VALUES, type FaqAttr } from '@/lib/faq-general'

/**
 * Общий FAQ (/faq) — редактор в админке.
 * GET — все вопросы и разделы, включая черновики и служебные поля.
 * PATCH { items: [{ id, question?, answer?, sectionId?, order?, status?, attrs?, note?, checkedAt? }] }.
 *
 * После записи инвалидируется тег 'airtable:faq': правка появляется на сайте
 * сразу, а не через час, который держит unstable_cache.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const data = await loadAdminFaq()
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const body = (await request.json()) as { items?: unknown }
    const raw = Array.isArray(body.items) ? body.items : []

    const updates: AdminFaqUpdate[] = []
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue
      const record = entry as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id : ''
      if (!id) continue

      const update: AdminFaqUpdate = { id }
      if (typeof record.question === 'string') update.question = record.question.trim()
      if (typeof record.answer === 'string') update.answer = record.answer
      if (record.sectionId === null || typeof record.sectionId === 'string') {
        update.sectionId = record.sectionId as string | null
      }
      if (typeof record.order === 'number' && Number.isFinite(record.order)) update.order = record.order
      if (typeof record.status === 'string' && FAQ_STATUS_VALUES.includes(record.status as FaqStatus)) {
        update.status = record.status as FaqStatus
      }
      if (Array.isArray(record.attrs)) {
        update.attrs = record.attrs.filter((a): a is FaqAttr => FAQ_ATTR_VALUES.includes(a as FaqAttr))
      }
      if (typeof record.note === 'string') update.note = record.note
      if (typeof record.checkedAt === 'string') update.checkedAt = record.checkedAt.trim()

      updates.push(update)
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Нет вопросов для обновления' }, { status: 400 })
    }

    const data = await updateAdminFaq(updates)
    revalidateTag('airtable:faq', 'max')

    return NextResponse.json({ ok: true, ...data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
