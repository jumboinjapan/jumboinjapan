import { NextRequest, NextResponse } from 'next/server'

import { getSessionCookieName, verifySessionToken } from '@/lib/admin-auth'

/**
 * ВРЕМЕННЫЙ диагностический роут для загадки admin guard
 * (handoff-2026-07-11 §2: guard работает на превью, 401-ит в проде).
 *
 * Показывает, что видит route handler в конкретном окружении, БЕЗ значений
 * секретов и cookie: только булевы флаги и hash-отпечатки. Доступ — за
 * middleware (нужна валидная сессия), т.е. сам факт ответа означает, что
 * middleware этот же запрос проверил и пропустил.
 *
 * Интерпретация:
 *  - hasSessionCookie=false        → cookie не доезжает до handler (гипотеза 1)
 *  - verifyOk=false, expInFuture=true, wellFormed=true
 *                                  → секрет в рантайме функций другой (гипотеза 2)
 *  - verifyOk=true                 → guard в этом окружении работал бы; искать дальше
 *
 * УДАЛИТЬ после диагноза. Не расширять (историю /api/admin/auth/debug помним).
 */

export const dynamic = 'force-dynamic'

function base64UrlDecodeToString(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder().decode(bytes)
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function GET(request: NextRequest) {
  const cookieName = getSessionCookieName()
  const token = request.cookies.get(cookieName)?.value

  // Разбор токена без проверки подписи — чтобы отличить «подпись не сошлась»
  // от «токен истёк/битый».
  let wellFormed = false
  let expInFuture: boolean | null = null
  if (token) {
    const [encodedPayload, signature] = token.split('.')
    if (encodedPayload && signature) {
      wellFormed = true
      try {
        const payload = JSON.parse(base64UrlDecodeToString(encodedPayload)) as { exp?: number }
        expInFuture = typeof payload.exp === 'number' ? payload.exp > Math.floor(Date.now() / 1000) : null
      } catch {
        wellFormed = false
      }
    }
  }

  let verifyOk = false
  let verifyError: string | null = null
  try {
    verifyOk = Boolean(await verifySessionToken(token))
  } catch (error) {
    verifyError = error instanceof Error ? error.message : String(error)
  }

  const secret = (process.env.ADMIN_AUTH_SECRET ?? '').trim()

  return NextResponse.json(
    {
      where: {
        vercelEnv: process.env.VERCEL_ENV ?? null,
        nodeEnv: process.env.NODE_ENV ?? null,
        region: process.env.VERCEL_REGION ?? null,
        host: request.headers.get('host'),
      },
      cookies: {
        namesSeenByHandler: request.cookies.getAll().map((cookie) => cookie.name),
        hasSessionCookie: Boolean(token),
        sessionCookieName: cookieName,
      },
      token: {
        wellFormed,
        expInFuture,
        verifyOk,
        verifyError,
      },
      secret: {
        configured: Boolean(secret),
        length: secret.length,
        fingerprint: secret ? (await sha256Hex(secret)).slice(0, 12) : null,
      },
    },
    { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
  )
}
