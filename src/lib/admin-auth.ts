const SESSION_COOKIE = 'admin_session'
const STATE_COOKIE = 'admin_oauth_state'
const VERIFIER_COOKIE = 'admin_oauth_verifier'
const CALLBACK_PATH = '/api/admin/auth/google/callback'
const LOGIN_PATH = '/admin/login'

interface AdminSessionPayload {
  email: string
  name: string
  picture: string
  exp: number
}

function getEnv(name: string) {
  const value = process.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

function getAllowedEmails() {
  return getEnv('ADMIN_ALLOWED_EMAILS')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

function getAuthSecret() {
  return getEnv('ADMIN_AUTH_SECRET')
}

export function isGoogleAdminAuthConfigured() {
  return Boolean(getEnv('GOOGLE_CLIENT_ID') && getEnv('GOOGLE_CLIENT_SECRET') && getAuthSecret() && getAllowedEmails().length)
}

export function isBasicAuthFallbackEnabled() {
  return getEnv('ADMIN_BASIC_AUTH_FALLBACK') === 'true'
}

export function getBasicAuthCredentials() {
  return {
    username: getEnv('ADMIN_BASIC_AUTH_USER'),
    password: getEnv('ADMIN_BASIC_AUTH_PASSWORD'),
  }
}

export function getAdminLoginPath() {
  return LOGIN_PATH
}

export function getGoogleCallbackPath() {
  return CALLBACK_PATH
}

export function getSessionCookieName() {
  return SESSION_COOKIE
}

export function getStateCookieName() {
  return STATE_COOKIE
}

export function getVerifierCookieName() {
  return VERIFIER_COOKIE
}

export function isAllowedAdminEmail(email: string) {
  return getAllowedEmails().includes(email.trim().toLowerCase())
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function base64ToBytes(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function base64UrlEncodeString(value: string) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value))
}

function base64UrlEncodeBytes(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecodeToString(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return new TextDecoder().decode(base64ToBytes(padded))
}

async function signValue(value: string) {
  const secret = getAuthSecret()

  if (!secret) {
    throw new Error('ADMIN_AUTH_SECRET is required for admin auth')
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return base64UrlEncodeBytes(new Uint8Array(signature))
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64UrlEncodeBytes(new Uint8Array(digest))
}

function shouldUseSecureCookies() {
  return process.env.NODE_ENV === 'production'
}

function getDefaultCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}

export function createRandomString(length = 32) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64UrlEncodeBytes(bytes)
}

export async function createPkceChallenge(verifier: string) {
  return sha256(verifier)
}

export async function createSignedSessionToken(input: Omit<AdminSessionPayload, 'exp'> & { expiresInSeconds?: number }) {
  const payload: AdminSessionPayload = {
    ...input,
    exp: Math.floor(Date.now() / 1000) + (input.expiresInSeconds ?? 60 * 60 * 24 * 14),
  }

  const encodedPayload = base64UrlEncodeString(JSON.stringify(payload))
  const signature = await signValue(encodedPayload)

  return `${encodedPayload}.${signature}`
}

export async function verifySessionToken(token: string | undefined | null): Promise<AdminSessionPayload | null> {
  if (!token) return null

  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) return null

  const expectedSignature = await signValue(encodedPayload)
  if (expectedSignature !== signature) return null

  try {
    const payload = JSON.parse(base64UrlDecodeToString(encodedPayload)) as AdminSessionPayload

    if (!payload.email || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

export function setSessionCookie(response: Response, token: string) {
  response.headers.append(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, token, getDefaultCookieOptions(60 * 60 * 24 * 14)),
  )
}

export function clearSessionCookie(response: Response) {
  response.headers.append('Set-Cookie', serializeCookie(SESSION_COOKIE, '', { ...getDefaultCookieOptions(0), maxAge: 0 }))
}

export function setOauthFlowCookies(response: Response, state: string, verifier: string) {
  const options = getDefaultCookieOptions(60 * 10)
  response.headers.append('Set-Cookie', serializeCookie(STATE_COOKIE, state, options))
  response.headers.append('Set-Cookie', serializeCookie(VERIFIER_COOKIE, verifier, options))
}

export function clearOauthFlowCookies(response: Response) {
  response.headers.append('Set-Cookie', serializeCookie(STATE_COOKIE, '', { ...getDefaultCookieOptions(0), maxAge: 0 }))
  response.headers.append('Set-Cookie', serializeCookie(VERIFIER_COOKIE, '', { ...getDefaultCookieOptions(0), maxAge: 0 }))
}

function serializeCookie(name: string, value: string, options: ReturnType<typeof getDefaultCookieOptions>) {
  const segments = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`, `Max-Age=${options.maxAge}`, 'HttpOnly', 'SameSite=Lax']

  if (options.secure) {
    segments.push('Secure')
  }

  return segments.join('; ')
}

export function buildGoogleAuthorizationUrl(origin: string, state: string, codeChallenge: string) {
  const clientId = getEnv('GOOGLE_CLIENT_ID')

  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is required for Google admin auth')
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', `${origin}${CALLBACK_PATH}`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('prompt', 'select_account')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')

  return url.toString()
}

export async function exchangeGoogleCode({
  origin,
  code,
  codeVerifier,
}: {
  origin: string
  code: string
  codeVerifier: string
}) {
  const clientId = getEnv('GOOGLE_CLIENT_ID')
  const clientSecret = getEnv('GOOGLE_CLIENT_SECRET')

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for Google admin auth')
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: codeVerifier,
      redirect_uri: `${origin}${CALLBACK_PATH}`,
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status}`)
  }

  return (await response.json()) as { access_token: string }
}

export async function fetchGoogleProfile(accessToken: string) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Google profile fetch failed: ${response.status}`)
  }

  return (await response.json()) as {
    email: string
    email_verified?: boolean
    name?: string
    picture?: string
  }
}

export function decodeBasicAuthHeader(header: string | null) {
  if (!header?.startsWith('Basic ')) return null

  try {
    const encoded = header.slice('Basic '.length)
    const decoded = base64ToBytes(encoded)
    const value = new TextDecoder().decode(decoded)
    const separatorIndex = value.indexOf(':')

    if (separatorIndex === -1) return null

    return {
      username: value.slice(0, separatorIndex),
      password: value.slice(separatorIndex + 1),
    }
  } catch {
    return null
  }
}
