import { NextRequest, NextResponse } from 'next/server'

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
 * Авторизация админки жила ИСКЛЮЧИТЕЛЬНО в middleware.ts: ни один
 * /api/admin/**-роут не проверял сессию сам. Любая дыра в middleware (у
 * Next 16.x были CVE именно на обход middleware) означала полный доступ к
 * админ-API — чтение и запись всех данных Airtable, включая клиентскую базу.
 *
 * Использование (request ОБЯЗАТЕЛЕН, см. ниже):
 *
 *   export async function GET(request: NextRequest) {
 *     const denied = await requireAdminSession(request)
 *     if (denied) return denied
 *     ...
 *
 * ПОЧЕМУ ЧЕРЕЗ request, А НЕ next/headers (инцидент 2026-07-11):
 * первая версия читала cookie через `cookies()` из 'next/headers' и в
 * продакшене отклоняла ВСЕ админ-запросы, хотя сессия была валидна
 * (middleware ту же самую cookie видел). Причина в песочнице не
 * воспроизводима — сборка Next локально недоступна. Поэтому guard читает
 * запрос ровно так же, как это делает работающий middleware:
 * request.cookies / request.headers. Не переписывать на next/headers.
 *
 * При отказе пишем причину в лог (без значений секретов) — если guard снова
 * начнёт отклонять валидные сессии, причина будет видна в Vercel Runtime Logs.
 */
export async function requireAdminSession(request: NextRequest): Promise<NextResponse | null> {
  const token = request.cookies.get(getSessionCookieName())?.value

  try {
    const session = await verifySessionToken(token)
    if (session) return null
  } catch (error) {
    // verifySessionToken бросает, если ADMIN_AUTH_SECRET не сконфигурирован
    console.error('[admin-guard] session verify failed:', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ ok: false, error: 'Auth misconfigured' }, { status: 500 })
  }

  // Basic-Auth фолбэк — тот же контракт, что в middleware (по умолчанию выключен)
  if (isBasicAuthFallbackEnabled()) {
    const credentials = decodeBasicAuthHeader(request.headers.get('authorization'))
    const { username, password } = getBasicAuthCredentials()
    if (credentials && username && password && credentials.username === username && credentials.password === password) {
      return null
    }
  }

  console.error('[admin-guard] denied:', request.nextUrl.pathname, token ? 'invalid/expired session token' : 'no session cookie')
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

/**
 * Email админа из текущей сессии — для полей аудита («кто менял ключ»).
 *
 * ДОБАВЛЕНО, А НЕ ВСТРОЕНО В requireAdminSession НАМЕРЕННО: тот возвращает
 * `null` при успехе, и любая правка его контракта задела бы все 24 admin-роута.
 * Инцидент 2026-07-11 показал, чем это кончается. Здесь отдельная функция,
 * читающая cookie тем же способом (request.cookies, не next/headers).
 *
 * Вызывать ТОЛЬКО после успешного requireAdminSession: сама по себе она
 * ничего не запрещает и при отсутствии сессии просто вернёт пустую строку.
 */
export async function getAdminSessionEmail(request: NextRequest): Promise<string> {
  try {
    const session = await verifySessionToken(request.cookies.get(getSessionCookieName())?.value)
    return session?.email ?? ''
  } catch {
    return ''
  }
}

/**
 * Проверка источника запроса для изменяющих admin-роутов.
 *
 * Сессионная cookie — SameSite=Lax, поэтому межсайтовый POST её и так не
 * приложит. Это второй рубеж на случай, если политику cookie когда-нибудь
 * ослабят: запрос с чужого Origin отклоняется независимо от cookie.
 * Запросы без заголовка Origin (curl, серверные вызовы) пропускаем — по
 * ним авторизацию делает сессия.
 */
export function requireSameOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get('origin')
  if (!origin) return null

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  try {
    if (new URL(origin).host === host) return null
  } catch {
    // Неразбираемый Origin — отклоняем.
  }

  console.error('[admin-guard] cross-origin запрос отклонён:', request.nextUrl.pathname)
  return NextResponse.json({ ok: false, error: 'Cross-origin request rejected' }, { status: 403 })
}
