import { NextRequest, NextResponse } from 'next/server'

import {
  decodeBasicAuthHeader,
  getAdminLoginPath,
  getBasicAuthCredentials,
  getSessionCookieName,
  isBasicAuthFallbackEnabled,
  isGoogleAdminAuthConfigured,
  verifySessionToken,
} from '@/lib/admin-auth'

/**
 * Next 16: middleware.ts переименован в proxy.ts, старый файл МОЛЧА
 * игнорируется при сборке (инцидент 2026-07-14: админка простояла открытой
 * с момента перехода на Next 16 — ни логина, ни 401, при этом код
 * middleware.ts был цел). Функция обязана называться `proxy` (или быть
 * default export). `runtime` в config задавать НЕЛЬЗЯ — proxy всегда
 * Node.js, опция бросает ошибку сборки.
 */

export const config = {
  matcher: [
    '/from-tokyo/intercity/hakone',
    '/admin/:path*',
    '/api/admin/:path*',
    // Exclude Workflow SDK internal paths
    '/((?!.well-known/workflow/).*)'
  ],
}

function applyAdminHeaders(response: NextResponse) {
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex')
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  return response
}

function unauthorizedResponse() {
  return applyAdminHeaders(
    new NextResponse('Unauthorized', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Admin Workspace"',
      },
    }),
  )
}

function isAllowedAdminPath(pathname: string) {
  return (
    pathname === getAdminLoginPath() ||
    pathname.startsWith('/api/admin/auth/google/') ||
    pathname === '/api/admin/auth/logout' ||
    // ВРЕМЕННО (диагностика умирающих сессий 2026-07-14): diagnose доступен
    // без сессии, отдаёт только флаги/отпечатки. Убрать вместе с роутом.
    pathname === '/api/admin/auth/diagnose'
  )
}

// ВРЕМЕННО (диагностика 2026-07-14): proxy подписывает admin-ответы своим
// взглядом на сессию и секрет — сравнивается с handlerView diagnose-роута.
// Убрать после диагноза.
async function withProxyDiagnostics(response: NextResponse, sessionState: string) {
  response.headers.set('x-proxy-session', sessionState)
  const secret = (process.env.ADMIN_AUTH_SECRET ?? '').trim()
  if (secret) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
    const fp = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
    response.headers.set('x-proxy-secret-fp', fp)
  } else {
    response.headers.set('x-proxy-secret-fp', 'none')
  }
  return response
}

function isBasicAuthAuthorized(request: NextRequest) {
  if (!isBasicAuthFallbackEnabled()) return false

  const credentials = decodeBasicAuthHeader(request.headers.get('authorization'))
  const { username, password } = getBasicAuthCredentials()

  if (!credentials || !username || !password) {
    return false
  }

  return credentials.username === username && credentials.password === password
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isAdminPath = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')

  if (isAdminPath) {
    const sessionToken = request.cookies.get(getSessionCookieName())?.value
    let session: Awaited<ReturnType<typeof verifySessionToken>> = null
    let sessionState = 'no-cookie'
    if (sessionToken) {
      try {
        session = await verifySessionToken(sessionToken)
        sessionState = session ? 'ok' : 'invalid'
      } catch (error) {
        sessionState = `error:${error instanceof Error ? error.message.slice(0, 40) : 'unknown'}`
      }
    }
    const googleConfigured = isGoogleAdminAuthConfigured()
    const allowWithoutAuth = isAllowedAdminPath(pathname)

    if (!session && !allowWithoutAuth) {
      if (!googleConfigured && isBasicAuthAuthorized(request)) {
        return applyAdminHeaders(NextResponse.next())
      }

      if (!googleConfigured && pathname.startsWith('/api/admin')) {
        return unauthorizedResponse()
      }

      if (pathname.startsWith('/api/admin')) {
        return withProxyDiagnostics(applyAdminHeaders(NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })), sessionState)
      }

      const loginUrl = new URL(getAdminLoginPath(), request.url)
      loginUrl.searchParams.set('next', pathname)
      return withProxyDiagnostics(applyAdminHeaders(NextResponse.redirect(loginUrl)), sessionState)
    }

    if (session && pathname === getAdminLoginPath()) {
      return withProxyDiagnostics(applyAdminHeaders(NextResponse.redirect(new URL('/admin', request.url))), sessionState)
    }

    return withProxyDiagnostics(applyAdminHeaders(NextResponse.next()), sessionState)
  }

  const response = NextResponse.next()

  const existing = request.cookies.get('ab-hakone')
  if (existing) return response

  const variant = Math.random() < 0.5 ? 'a' : 'b'
  response.cookies.set('ab-hakone', variant, {
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: false,
    sameSite: 'lax',
  })

  return response
}
