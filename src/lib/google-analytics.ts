import { canCollectPublicAnalytics, publicAnalyticsReferrer } from './analytics-policy'

declare global {
  interface Window {
    dataLayer?: IArguments[]
  }
}

/** Configure once, before loading gtag.js. GA owns automatic public page views. */
export function initializeGoogleAnalytics(measurementId: string): boolean {
  if (typeof window === 'undefined' || !/^G-[A-Z0-9]+$/.test(measurementId)) return false
  if (!canCollectPublicAnalytics()) return false

  const disableKey = `ga-disable-${measurementId}`
  const descriptor = Object.getOwnPropertyDescriptor(window, disableKey)
  if (descriptor?.get) return true
  let optedOut = descriptor?.value === true
  // Read the current URL at send time, including history changes that happen
  // before React effects. A mount-only /admin check misses SPA navigation.
  Object.defineProperty(window, disableKey, {
    configurable: true,
    get: () => optedOut || !canCollectPublicAnalytics(),
    set: (value: boolean) => { optedOut = value === true },
  })
  window.dataLayer = window.dataLayer || []
  window.gtag = function () {
    // gtag's documented queue uses Arguments objects, not a custom transport.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  window.gtag('js', new Date())
  window.gtag('config', measurementId, {
    page_referrer: publicAnalyticsReferrer(document.referrer),
    // Page views are automatic; do not add a second manual SPA tracker.
    send_page_view: true,
  })
  return true
}
