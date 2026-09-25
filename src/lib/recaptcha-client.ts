const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? ''

interface Grecaptcha {
  ready: (cb: () => void) => void
  execute: (siteKey: string, options: { action: string }) => Promise<string>
}

declare global {
  interface Window {
    grecaptcha?: Grecaptcha
  }
}

export function loadRecaptchaScript() {
  if (!RECAPTCHA_SITE_KEY || typeof window === 'undefined') return
  if (document.querySelector('script[data-recaptcha]')) return
  const script = document.createElement('script')
  script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`
  script.async = true
  script.defer = true
  script.dataset.recaptcha = 'true'
  document.head.appendChild(script)
}

export async function getRecaptchaToken(action = 'profile_submit'): Promise<string | null> {
  if (!RECAPTCHA_SITE_KEY || typeof window === 'undefined' || !window.grecaptcha) return null
  try {
    const grecaptcha = window.grecaptcha
    await new Promise<void>((resolve) => grecaptcha.ready(resolve))
    return await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action })
  } catch {
    return null
  }
}
