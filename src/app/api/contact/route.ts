import { verifyRecaptcha } from '@/lib/recaptcha'
import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'

import { createProspect, parseContactFormToProspect, type ContactFormInput } from '@/lib/prospects'
import { notifyNewContact } from '@/lib/notifications/telegram'

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
// заполнения. Только honeypot отбрасывается с fake-success.
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

  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 })
  }
  const input = parsed as Record<string, unknown>
  for (const field of ['name', 'contact', 'interests', 'travelDate', 'groupSize']) {
    if (input[field] !== undefined && typeof input[field] !== 'string') {
      return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 })
    }
  }
  if (typeof input.name !== 'string' || typeof input.contact !== 'string' ||
      !input.name.trim() || !input.contact.trim()) {
    return NextResponse.json({ ok: false, error: 'Name and contact are required' }, { status: 400 })
  }
  const body: ContactFormInput & { hp?: unknown; elapsedSeconds?: unknown } = {
    name: input.name.trim().slice(0, 300),
    contact: input.contact.trim().slice(0, 300),
    interests: (input.interests as string | undefined)?.slice(0, 3000),
    travelDate: (input.travelDate as string | undefined)?.slice(0, 3000),
    groupSize: (input.groupSize as string | undefined)?.slice(0, 300),
    hp: input.hp,
    elapsedSeconds: input.elapsedSeconds,
  }

  // Только заполненная ловушка даёт тихий отказ. Время и reCAPTCHA —
  // сигналы для ручной проверки, поскольку возможны ложные срабатывания.
  const hpFilled = typeof body.hp === 'string' && body.hp.trim() !== ''
  if (hpFilled) {
    console.warn('[contact] honeypot triggered')
    return NextResponse.json({ ok: true })
  }
  const tooFast = typeof body.elapsedSeconds === 'number' &&
    Number.isFinite(body.elapsedSeconds) && body.elapsedSeconds >= 0 && body.elapsedSeconds < MIN_FILL_SECONDS
  const recaptcha = await verifyRecaptcha(input.recaptchaToken, ip, 'contact_submit')
  const spamWarning = [
    recaptcha.warning,
    tooFast ? 'Проверить вручную: форма отправлена слишком быстро' : undefined,
  ].filter(Boolean).join('; ') || undefined

  const prospectData = parseContactFormToProspect(body)
  const result = await createProspect(prospectData, spamWarning)

  if (!result.success || !result.record) {
    console.error('[contact] prospect create failed:', result.error ?? 'unknown')
    // Резервный успех допустим только при подтверждённой доставке уведомления.
    try {
      const notification = await notifyNewContact({
        spamWarning,
        name: body.name,
        contact: body.contact,
        travelDate: body.travelDate,
        groupSize: body.groupSize,
        interests: body.interests,
      })
      if (notification.success) return NextResponse.json({ ok: true, fallback: true })
    } catch {
      console.error('[contact] telegram notify failed (no prospect)')
    }
    return NextResponse.json({ ok: false, error: 'submission_failed' }, { status: 502 })
  }

  const { prospectId, factFindUrl } = result.record

  try {
    await notifyNewContact({
      spamWarning,
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
