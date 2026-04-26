import { NextResponse } from 'next/server'

import {
  buildGoogleAuthorizationUrl,
  createPkceChallenge,
  createRandomString,
  getAdminLoginPath,
  isGoogleAdminAuthConfigured,
  setOauthFlowCookies,
} from '@/lib/admin-auth'

export async function GET(request: Request) {
  if (!isGoogleAdminAuthConfigured()) {
    return NextResponse.redirect(new URL(`${getAdminLoginPath()}?error=config`, request.url))
  }

  const origin = new URL(request.url).origin
  const state = createRandomString(24)
  const verifier = createRandomString(48)
  const codeChallenge = await createPkceChallenge(verifier)
  const authorizationUrl = buildGoogleAuthorizationUrl(origin, state, codeChallenge)

  const response = NextResponse.redirect(authorizationUrl)
  setOauthFlowCookies(response, state, verifier)

  // Preserve the page the user was trying to reach (supports both ?returnTo= and ?next=)
  const params = new URL(request.url).searchParams
  const returnTo = params.get('returnTo') ?? params.get('next')
  if (returnTo && returnTo.startsWith('/admin')) {
    response.cookies.set('admin_return_to', returnTo, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 300, // 5 minutes
      path: '/',
    })
  }

  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex')

  return response
}
