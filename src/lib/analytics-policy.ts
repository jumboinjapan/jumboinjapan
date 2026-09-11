/** Public acquisition analytics: production pages, never administration or guest tokens. */
export function isPublicAnalyticsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.port ||
        !['jumboinjapan.com', 'www.jumboinjapan.com'].includes(url.hostname)) return false
    const path = decodeURIComponent(url.pathname)
    if (/^\/(admin|api|p)(\/|$)/i.test(path)) return false
    // /profile is the public enquiry form; /profile/<token> edits an existing enquiry.
    if (/^\/profile\/.+/i.test(path)) return false
    return true
  } catch {
    return false
  }
}

declare global {
  interface Window { publicAnalyticsExcluded?: boolean }
}

/** Keep a tab that opened private pages out of acquisition reports until it closes. */
export function canCollectPublicAnalytics(): boolean {
  if (typeof window === 'undefined') return false
  const eligible = isPublicAnalyticsUrl(window.location.href)
  const storageKey = 'jj-public-analytics-excluded'
  if (!eligible) window.publicAnalyticsExcluded = true
  try {
    if (!eligible) window.sessionStorage.setItem(storageKey, '1')
    if (window.sessionStorage.getItem(storageKey) === '1') window.publicAnalyticsExcluded = true
  } catch {
    // Storage can be blocked; the document-level exclusion still applies.
  }
  return eligible && !window.publicAnalyticsExcluded
}

/** Never carry a guest token or an authentication URL as the next page's referrer. */
export function publicAnalyticsReferrer(value: string): string {
  if (!value) return ''
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol)) return ''
    if (url.hostname === 'accounts.google.com') return ''
    if (['jumboinjapan.com', 'www.jumboinjapan.com'].includes(url.hostname)) {
      return isPublicAnalyticsUrl(value) ? `${url.origin}${url.pathname}` : ''
    }
    return url.origin
  } catch {
    return ''
  }
}

export function filterAnalyticsEvent<T extends { url: string }>(event: T): T | null {
  if (!isPublicAnalyticsUrl(event.url)) return null
  const url = new URL(event.url)
  return { ...event, url: `${url.origin}${url.pathname}` }
}
