import { NextRequest, NextResponse } from 'next/server'

import { getSessionCookieName, verifySessionToken } from '@/lib/admin-auth'

/**
 * ВРЕМЕННЫЙ диагностический роут v2 — сессии умирают на проде (2026-07-14).
 * Доступен БЕЗ сессии (исключение в src/proxy.ts), отдаёт только булевы
 * флаги и hash-отпечатки, без значений. Сравнение с заголовками x-proxy-*
 * (ставит proxy) показывает, одинаково ли proxy и route handler видят
 * cookie и секрет. УДАЛИТЬ после диагноза вместе с исключением в proxy.
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
        region: process.env.VERCEL_REGION ?? null,
        host: request.headers.get('host'),
        now: new Date().toISOString(),
      },
      handlerView: {
        cookieNames: request.cookies.getAll().map((cookie) => cookie.name),
        hasSessionCookie: Boolean(token),
        tokenLength: token?.length ?? 0,
        wellFormed,
        expInFuture,
        verifyOk,
        verifyError,
        secretConfigured: Boolean(secret),
        secretLength: secret.length,
        secretFingerprint: secret ? (await sha256Hex(secret)).slice(0, 12) : null,
      },
      note: 'Сравни с заголовками ответа x-proxy-session и x-proxy-secret-fp (их ставит proxy).',
    },
    { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
  )
}
