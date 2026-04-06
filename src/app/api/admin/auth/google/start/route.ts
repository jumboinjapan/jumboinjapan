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
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex')

  return response
}
