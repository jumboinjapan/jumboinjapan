import { NextResponse } from 'next/server'

import { clearSessionCookie, getAdminLoginPath } from '@/lib/admin-auth'

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL(getAdminLoginPath(), request.url))
  clearSessionCookie(response)
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex')
  return response
}
