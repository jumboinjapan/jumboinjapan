import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import {
  clearOauthFlowCookies,
  exchangeGoogleCode,
  fetchGoogleProfile,
  getAdminLoginPath,
  getStateCookieName,
  getVerifierCookieName,
  isAllowedAdminEmail,
  isGoogleAdminAuthConfigured,
  setSessionCookie,
  createSignedSessionToken,
} from '@/lib/admin-auth'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)

  if (!isGoogleAdminAuthConfigured()) {
    return NextResponse.redirect(new URL(`${getAdminLoginPath()}?error=config`, requestUrl))
  }

  const code = requestUrl.searchParams.get('code')
  const state = requestUrl.searchParams.get('state')
  const cookieStore = await cookies()
  const expectedState = cookieStore.get(getStateCookieName())?.value
  const codeVerifier = cookieStore.get(getVerifierCookieName())?.value

  if (!code || !state || !expectedState || state !== expectedState || !codeVerifier) {
    return NextResponse.redirect(new URL(`${getAdminLoginPath()}?error=state`, requestUrl))
  }

  try {
    const tokenResponse = await exchangeGoogleCode({
      origin: requestUrl.origin,
      code,
      codeVerifier,
    })

    const profile = await fetchGoogleProfile(tokenResponse.access_token)

    if (!profile.email || profile.email_verified !== true || !isAllowedAdminEmail(profile.email)) {
      return NextResponse.redirect(new URL(`${getAdminLoginPath()}?error=denied`, requestUrl))
    }

    const sessionToken = await createSignedSessionToken({
      email: profile.email,
      name: profile.name ?? profile.email,
      picture: profile.picture ?? '',
    })

    const returnTo = cookieStore.get('admin_return_to')?.value
    const destination = returnTo && returnTo.startsWith('/admin') ? returnTo : '/admin'
    const response = NextResponse.redirect(new URL(destination, requestUrl))
    clearOauthFlowCookies(response)
    response.cookies.delete('admin_return_to')
    setSessionCookie(response, sessionToken)
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex')

    return response
  } catch {
    return NextResponse.redirect(new URL(`${getAdminLoginPath()}?error=oauth`, requestUrl))
  }
}
