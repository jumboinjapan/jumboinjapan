const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY?.trim() ?? ''

type RecaptchaVerdict = {
  verdict: 'pass' | 'suspicious'
  score: number | null
  warning?: string
}

function review(reason: string, score: number | null = null): RecaptchaVerdict {
  return { verdict: 'suspicious', score, warning: `Проверить вручную: ${reason}` }
}

// reCAPTCHA is a review signal, never a reason to silently lose a valid enquiry.
export async function verifyRecaptcha(
  token: unknown,
  ip: string,
  action: 'contact_submit' | 'profile_submit'
): Promise<RecaptchaVerdict> {
  if (!RECAPTCHA_SECRET_KEY) return review('reCAPTCHA не настроена')
  if (typeof token !== 'string' || token.trim() === '') return review('нет токена reCAPTCHA')

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
    if (!response.ok) return review('reCAPTCHA недоступна')
    const data = (await response.json()) as { success?: boolean; score?: number; action?: string } | null
    const score = typeof data?.score === 'number' && Number.isFinite(data.score) && data.score >= 0 && data.score <= 1
      ? data.score : null
    if (data?.success !== true || score === null) return review('reCAPTCHA не подтвердила проверку', score)
    if (data.action !== action) return review('действие reCAPTCHA не совпало', score)
    if (score < 0.5) return review(`reCAPTCHA score ${score}`, score)
    return { verdict: 'pass', score }
  } catch {
    console.error('[recaptcha] verify unavailable')
    return review('reCAPTCHA недоступна')
  }
}
