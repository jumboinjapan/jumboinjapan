import { NextResponse } from 'next/server'

import { clearSessionCookie, getAdminLoginPath } from '@/lib/admin-auth'

/**
 * Logout. ЗАЩИТА ОТ ПРЕФЕТЧА (инцидент 2026-07-14): next/link на этот роут
 * префетчился и молча разлогинивал владельца через секунды после входа.
 * Кнопка «Выйти» теперь обычный <a>, но на случай будущих регрессий роут
 * игнорирует любые префетч/спекулятивные запросы — сессию убивает только
 * настоящий клик пользователя.
 */
export async function GET(request: Request) {
  const isPrefetch =
    request.headers.get('next-router-prefetch') !== null ||
    request.headers.get('sec-purpose')?.includes('prefetch') ||
    request.headers.get('purpose') === 'prefetch' ||
    request.headers.get('x-middleware-prefetch') !== null ||
    request.headers.get('rsc') !== null

  if (isPrefetch) {
    // Ничего не чистим и не редиректим — префетч не должен иметь побочных эффектов.
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  }

  const response = NextResponse.redirect(new URL(getAdminLoginPath(), request.url))
  clearSessionCookie(response)
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex')
  return response
}
