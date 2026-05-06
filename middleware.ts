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

export const config = {
  matcher: [
    '/from-tokyo/intercity/hakone',
    '/admin/:path*',
    '/api/admin/:path*',
    // Exclude Workflow SDK internal paths
    '/((?!.well-known/workflow/).*)'
  ],
  runtime: 'nodejs',
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
    pathname === '/api/admin/auth/logout'
  )
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

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isAdminPath = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')

  if (isAdminPath) {
    const sessionToken = request.cookies.get(getSessionCookieName())?.value
    const session = await verifySessionToken(sessionToken)
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
        return applyAdminHeaders(NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }))
      }

      const loginUrl = new URL(getAdminLoginPath(), request.url)
      loginUrl.searchParams.set('next', pathname)
      return applyAdminHeaders(NextResponse.redirect(loginUrl))
    }

    if (session && pathname === getAdminLoginPath()) {
      return applyAdminHeaders(NextResponse.redirect(new URL('/admin', request.url)))
    }

    return applyAdminHeaders(NextResponse.next())
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
