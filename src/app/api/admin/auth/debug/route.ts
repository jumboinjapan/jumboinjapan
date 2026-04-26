import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { getSessionCookieName, verifySessionToken } from '@/lib/admin-auth'

export async function GET() {
  const cookieStore = await cookies()
  const sessionCookieName = getSessionCookieName()
  const token = cookieStore.get(sessionCookieName)?.value

  const session = await verifySessionToken(token)

  return NextResponse.json({
    cookieName: sessionCookieName,
    hasCookie: !!token,
    tokenLength: token?.length ?? 0,
    sessionValid: !!session,
    sessionEmail: session?.email ?? null,
    sessionExp: session?.exp ?? null,
    now: Math.floor(Date.now() / 1000),
    allCookies: cookieStore.getAll().map((c) => c.name),
  })
}
