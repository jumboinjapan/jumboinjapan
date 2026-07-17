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
  if (typeof window === 'undefined') return

  // GA4 (может отсутствовать: adblock, до загрузки тега).
  try {
    if (typeof window.gtag === 'function') window.gtag('event', name, params ?? {})
  } catch {
    // Аналитика никогда не должна ломать UX.
  }

  // First-party дубль в Airtable через /api/track — питает блок «Воронка»
  // в админке. sendBeacon переживает уход со страницы (клики по ссылкам).
  try {
    const payload = JSON.stringify({
      event: name,
      params: { page: window.location.pathname, ...params },
    })
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }))
    } else {
      void fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => undefined)
    }
  } catch {
    // ignore
  }
}
