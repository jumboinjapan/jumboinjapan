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
// ── Антиспам ──────────────────────────────────────────────────────────────────
// Тот же паттерн, что в /api/profile: in-memory лимитер по IP (на инстанс
// serverless-функции — для V1 достаточно), honeypot и минимальное время
// заполнения. Спам отбрасывается с fake-success, чтобы боты не учились.
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 5
const rateBuckets = new Map<string, { count: number; windowStart: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStart: now })
    return false
  }
  bucket.count += 1
  if (rateBuckets.size > 5000) rateBuckets.clear()
  return bucket.count > RATE_MAX
}

const MIN_FILL_SECONDS = 3

export async function POST(request: Request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  if (isRateLimited(ip)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  const body = (await request.json()) as ContactFormInput & {
    hp?: unknown
    elapsedSeconds?: unknown
  }

  // Honeypot заполнен или форма отправлена быстрее, чем человек способен
  // её заполнить, — молча отбрасываем с видимым успехом (без Airtable/Telegram).
  const hpFilled = typeof body.hp === 'string' && body.hp.trim() !== ''
  const tooFast =
    typeof body.elapsedSeconds === 'number' && body.elapsedSeconds < MIN_FILL_SECONDS
  if (hpFilled || tooFast) {
    console.warn('[contact] spam rejected:', hpFilled ? 'honeypot' : 'too_fast')
    return NextResponse.json({ ok: true })
  }

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
