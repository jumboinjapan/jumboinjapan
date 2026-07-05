import { NextRequest, NextResponse } from 'next/server'

import { notifyProfileSubmitted } from '@/lib/notifications/telegram'
import {
  createProspectFromProfile,
  updateProspectFactFind,
} from '@/lib/prospects'
import { sanitizeProfilePayload, summarizeProfileForTelegram } from '@/lib/tourist-profile'
import { BASE_URL } from '@/lib/schema'

/**
 * Submit опросника «Профиль туриста».
 *
 * - С токеном: обновляет существующий prospect (whitelist анкетных полей,
 *   стадию НЕ двигает — канон prospects-crm-spec).
 * - Без токена (общая ссылка /profile): создаёт prospect, Source из `src`.
 *
 * PII в логи не пишем — только Prospect ID.
 */

// ── Rate limit ────────────────────────────────────────────────────────────────
// Простой in-memory лимитер по IP: N запросов в окно. Ограничение serverless:
// каждый инстанс functions держит свою Map, так что на Vercel это лимит
// «на инстанс», не глобальный. Для V1 публичной формы этого достаточно;
// глобальный лимитер (KV/Upstash) — при первых признаках злоупотребления.
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 10
const rateBuckets = new Map<string, { count: number; windowStart: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStart: now })
    return false
  }
  bucket.count += 1
  if (rateBuckets.size > 5000) rateBuckets.clear() // защита от роста памяти
  return bucket.count > RATE_MAX
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  if (isRateLimited(ip)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  let body: { token?: unknown; src?: unknown; payload?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const sanitized = sanitizeProfilePayload(body.payload)
  if (!sanitized.ok) {
    return NextResponse.json({ ok: false, error: 'invalid_payload', details: sanitized.errors }, { status: 400 })
  }
  const payload = sanitized.payload

  const token = typeof body.token === 'string' && body.token.trim() !== '' ? body.token.trim() : null
  const src = typeof body.src === 'string' ? body.src : undefined

  let prospectId: string | undefined
  let recordId: string | undefined
  let isNew = false

  if (token) {
    const result = await updateProspectFactFind(token, payload)
    if (!result.success) {
      // Невалидный/чужой токен → мягкий отказ, данные не отдаются и не пишутся.
      const status = result.error === 'not_found' ? 404 : 502
      return NextResponse.json({ ok: false, error: result.error ?? 'update_failed' }, { status })
    }
    prospectId = result.prospectId
    recordId = result.recordId
  } else {
    const result = await createProspectFromProfile(payload, src)
    if (!result.success || !result.record) {
      return NextResponse.json({ ok: false, error: 'create_failed' }, { status: 502 })
    }
    prospectId = result.record.prospectId
    recordId = result.record.id
    isNew = true
  }

  console.log('[profile] submitted:', prospectId ?? 'unknown', isNew ? '(new)' : '(update)')

  // Telegram — best effort: ошибка уведомления не должна ломать submit клиенту.
  try {
    await notifyProfileSubmitted({
      name: payload.contact.name,
      prospectId,
      isNew,
      summary: summarizeProfileForTelegram(payload),
      cardUrl: `${BASE_URL}/admin/clients/${recordId}`,
    })
  } catch {
    console.error('[profile] telegram notify failed for', prospectId ?? 'unknown')
  }

  return NextResponse.json({ ok: true })
}
