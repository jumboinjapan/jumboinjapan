import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'

import {
  decodeBasicAuthHeader,
  getBasicAuthCredentials,
  getSessionCookieName,
  isBasicAuthFallbackEnabled,
  verifySessionToken,
} from '@/lib/admin-auth'

/**
 * Defense-in-depth для admin API (аудит 2026-07-11).
 *
 * До этого авторизация админки жила ИСКЛЮЧИТЕЛЬНО в middleware.ts: ни один
 * /api/admin/**-роут не проверял сессию сам. Любая дыра в middleware (а у
 * Next 16.x были CVE именно на обход middleware через segment-prefetch и
 * dynamic route params) означала полный доступ к админ-API — чтение и
 * запись всех данных Airtable, включая клиентскую базу с контактами.
 *
 * Теперь каждый мутирующий/чувствительный роут проверяет сессию сам:
 *
 *   const denied = await requireAdminSession()
 *   if (denied) return denied
 *
 * Middleware остаётся первым рубежом (редиректы, заголовки), этот guard —
 * вторым. Стоит одну строку на роут; убирает единственную точку отказа.
 */
export async function requireAdminSession(): Promise<NextResponse | null> {
  const cookieStore = await cookies()
  const session = await verifySessionToken(cookieStore.get(getSessionCookieName())?.value)
  if (session) return null

  // Basic-Auth фолбэк (ADMIN_BASIC_AUTH_FALLBACK=true) — тот же контракт,
  // что в middleware: без него старые сценарии входа перестали бы работать.
  if (isBasicAuthFallbackEnabled()) {
    const headerStore = await headers()
    const credentials = decodeBasicAuthHeader(headerStore.get('authorization'))
    const { username, password } = getBasicAuthCredentials()
    if (credentials && username && password && credentials.username === username && credentials.password === password) {
      return null
    }
  }

  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}
