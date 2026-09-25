const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY?.trim() ?? ''

type RecaptchaVerdict = { verdict: 'pass' | 'suspicious' | 'reject' | 'skipped'; score: number | null }

export async function verifyRecaptcha(token: unknown, ip: string): Promise<RecaptchaVerdict> {
  if (!RECAPTCHA_SECRET_KEY) return { verdict: 'skipped', score: null }
  if (typeof token !== 'string' || token.trim() === '') return { verdict: 'reject', score: null }

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: RECAPTCHA_SECRET_KEY,
        response: token,
        ...(ip !== 'unknown' ? { remoteip: ip } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    })
    const data = (await response.json()) as { success?: boolean; score?: number; action?: string }
    const score = typeof data.score === 'number' ? data.score : null
    if (!data.success || score === null) return { verdict: 'reject', score }
    if (score < 0.3) return { verdict: 'reject', score }
    if (score < 0.5) return { verdict: 'suspicious', score }
    return { verdict: 'pass', score }
  } catch {
    // Google недоступен — не блокируем живых клиентов, помечаем для проверки.
    console.error('[recaptcha] verify unavailable')
    return { verdict: 'suspicious', score: null }
  }
}
