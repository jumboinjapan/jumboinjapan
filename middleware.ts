import { NextRequest, NextResponse } from 'next/server'

export const config = {
  matcher: ['/from-tokyo/intercity/hakone'],
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  // If variant cookie already set, keep it (sticky)
  const existing = request.cookies.get('ab-hakone')
  if (existing) return response

  // Assign new visitor to A or B
  const variant = Math.random() < 0.5 ? 'a' : 'b'
  response.cookies.set('ab-hakone', variant, {
    maxAge: 60 * 60 * 24 * 30, // 30 days
    httpOnly: false, // needs to be readable client-side for analytics event
    sameSite: 'lax',
  })

  return response
}
