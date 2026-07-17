/**
 * GA4-события воронки (клиент). Безопасная обёртка над window.gtag:
 * молча no-op, если тег не загружен (adblock, SSR, /admin с выключенным
 * page_view). Имена событий — snake_case, по конвенции GA4.
 *
 * События сайта:
 *  - generate_lead        — успешная отправка контактной формы (рекомендованное GA4-имя)
 *  - contact_form_error   — отправка формы упала
 *  - questionnaire_open   — клик «Рассказать о поездке» после отправки формы
 *  - questionnaire_step   — шаг опросника пройден (params: step, index)
 *  - questionnaire_submit — опросник отправлен
 *  - cta_contact_click    — клик по любой ссылке на /contact или t.me (params: href, label, page)
 */

type GtagFn = (...args: unknown[]) => void

declare global {
  interface Window {
    gtag?: GtagFn
  }
}

export function trackEvent(name: string, params?: Record<string, string | number | boolean>) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return
  try {
    window.gtag('event', name, params ?? {})
  } catch {
    // Аналитика никогда не должна ломать UX.
  }
}
