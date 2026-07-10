import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'

import { createProspect, parseContactFormToProspect } from '@/lib/prospects'
import { notifyNewContact } from '@/lib/notifications/telegram'
import type { ContactFormInput } from '@/workflows/contact-form'

/**
 * Приём формы /contact.
 *
 * Prospect создаётся синхронно (не через durable workflow): экрану успеха
 * нужна персональная ссылка на опросник «Профиль туриста» сразу в ответе
 * (решение владельца, Задание 12). Ретраи на 429 даёт airtable-retry;
 * Telegram — best effort.
 *
 * PII клиентов в логи не пишем — только Prospect ID.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as ContactFormInput

  // Validate required fields
  if (!body.name?.trim() || !body.contact?.trim()) {
    return NextResponse.json(
      { ok: false, error: 'Name and contact are required' },
      { status: 400 }
    )
  }

  const prospectData = parseContactFormToProspect(body)
  const result = await createProspect(prospectData)

  if (!result.success || !result.record) {
    console.error('[contact] prospect create failed:', result.error ?? 'unknown')
    // Заявку не теряем молча: сообщаем в Telegram без записи в Airtable.
    try {
      await notifyNewContact({
        name: body.name,
        contact: body.contact,
        travelDate: body.travelDate,
        groupSize: body.groupSize,
        interests: body.interests,
      })
    } catch {
      console.error('[contact] telegram notify failed (no prospect)')
    }
    return NextResponse.json({ ok: true, fallback: true })
  }

  const { prospectId, factFindUrl } = result.record

  try {
    await notifyNewContact({
      name: body.name,
      contact: body.contact,
      travelDate: body.travelDate,
      groupSize: body.groupSize,
      interests: body.interests,
      prospectId,
      factFindUrl,
    })
  } catch {
    console.error('[contact] telegram notify failed for', prospectId)
  }

  revalidateTag('airtable:prospects', 'max')
  return NextResponse.json({ ok: true, profileUrl: factFindUrl })
}
