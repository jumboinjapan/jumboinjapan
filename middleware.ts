import { NextRequest, NextResponse } from 'next/server'

export const config = {
  matcher: ['/from-tokyo/intercity/hakone', '/admin/:path*', '/api/admin/:path*'],
}

function unauthorizedResponse() {
  return new NextResponse('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Admin Workspace"',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
      'Cache-Control': 'private, no-store, max-age=0',
    },
  })
}

function applyAdminHeaders(response: NextResponse) {
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex')
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  return response
}

function isAuthorizedForAdmin(request: NextRequest) {
  const username = process.env.ADMIN_BASIC_AUTH_USER
  const password = process.env.ADMIN_BASIC_AUTH_PASSWORD

  if (!username || !password) {
    return false
  }

  const authorization = request.headers.get('authorization')

  if (!authorization?.startsWith('Basic ')) {
    return false
  }

  try {
    const encoded = authorization.slice('Basic '.length)
    const decoded = atob(encoded)
    const separatorIndex = decoded.indexOf(':')

    if (separatorIndex === -1) {
      return false
    }

    const providedUsername = decoded.slice(0, separatorIndex)
    const providedPassword = decoded.slice(separatorIndex + 1)

    return providedUsername === username && providedPassword === password
  } catch {
    return false
  }
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isAdminPath = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')

  if (isAdminPath) {
    if (!isAuthorizedForAdmin(request)) {
      return unauthorizedResponse()
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
