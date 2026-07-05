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

// ── reCAPTCHA v3 (Фаза 1 финального стека) ────────────────────────────────────
// Единственный основной слой защиты от ботов на старте. Без RECAPTCHA_SECRET_KEY
// в env слой отключён (форма работает) — чтобы деплой не зависел от ключей.
// Политика: success=false или score < 0.3 → тихий отказ (как honeypot);
// score 0.3–0.5 → принимаем с пометкой для ручной проверки в Telegram.

const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY?.trim() ?? ''

type RecaptchaVerdict = { verdict: 'pass' | 'suspicious' | 'reject' | 'skipped'; score: number | null }

async function verifyRecaptcha(token: unknown, ip: string): Promise<RecaptchaVerdict> {
  if (!RECAPTCHA_SECRET_KEY) return { verdict: 'skipped', score: null }
  if (typeof token !== 'string' || token.trim() === '') return { verdict: 'reject', score: null }

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: RECAPTCHA_SECRET_KEY,
        response: token,
        ...(ip !== 'unknown' ? { remoteip: ip } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    })
    const data = (await response.json()) as { success?: boolean; score?: number; action?: string }
    const score = typeof data.score === 'number' ? data.score : null
    if (!data.success || score === null) return { verdict: 'reject', score }
    if (score < 0.3) return { verdict: 'reject', score }
    if (score < 0.5) return { verdict: 'suspicious', score }
    return { verdict: 'pass', score }
  } catch {
    // Google недоступен — не блокируем живых клиентов, помечаем для проверки.
    console.error('[profile] recaptcha verify unavailable')
    return { verdict: 'suspicious', score: null }
  }
}

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

  let body: {
    token?: unknown
    src?: unknown
    payload?: unknown
    hp?: unknown
    elapsedSeconds?: unknown
    recaptchaToken?: unknown
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  // Honeypot (техбриф v3): скрытое поле заполнено → бот. Отклоняем тихо,
  // с фейковым успехом — не подсказываем боту, что он обнаружен.
  if (typeof body.hp === 'string' && body.hp.trim() !== '') {
    console.log('[profile] honeypot triggered, dropping submission')
    return NextResponse.json({ ok: true })
  }

  // reCAPTCHA v3: основной слой Фазы 1. Низкий score → тихий отказ.
  const recaptcha = await verifyRecaptcha(body.recaptchaToken, ip)
  if (recaptcha.verdict === 'reject') {
    console.log('[profile] recaptcha rejected, score:', recaptcha.score ?? 'n/a')
    return NextResponse.json({ ok: true })
  }

  // Время заполнения: слишком быстрое прохождение — пометка для ручной
  // проверки в Telegram, не автоматический отказ (ложные срабатывания
  // возможны при заранее открытой вкладке с черновиком).
  const elapsedSeconds =
    typeof body.elapsedSeconds === 'number' && Number.isFinite(body.elapsedSeconds)
      ? Math.round(body.elapsedSeconds)
      : null
  const suspiciouslyFast = elapsedSeconds !== null && elapsedSeconds >= 0 && elapsedSeconds < 25

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
    const summary = summarizeProfileForTelegram(payload)
    if (suspiciouslyFast) {
      summary.push(`⚠️ Анкета заполнена за ${elapsedSeconds} сек — проверьте вручную, возможен бот`)
    }
    if (recaptcha.verdict === 'suspicious') {
      summary.push(
        recaptcha.score !== null
          ? `⚠️ reCAPTCHA score ${recaptcha.score} — проверьте вручную`
          : '⚠️ reCAPTCHA недоступна — заявка не проверена'
      )
    }
    await notifyProfileSubmitted({
      name: payload.contact.name,
      prospectId,
      isNew,
      summary,
      cardUrl: `${BASE_URL}/admin/clients/${recordId}`,
    })
  } catch {
    console.error('[profile] telegram notify failed for', prospectId ?? 'unknown')
  }

  return NextResponse.json({ ok: true })
}
