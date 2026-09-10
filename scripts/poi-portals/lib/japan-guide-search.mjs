/** Search hints from the source page, never coordinates or a municipal address. */
import { load } from 'cheerio'
import { canonicalPrefecture } from '../../../src/lib/prefectures.ts'
import { namesAgree } from '../../../src/lib/place-resolve.ts'
import {
  canonicalDiscoveryUrl, discoverySourceKey, createRequestPacer, fetchRobots, fetchHtmlPage,
  FETCH_LIMITS, FetchBoundaryError, RobotsError, EncodingGateError,
} from './html-fetch.mjs'
import { NetworkBoundaryError } from './network-boundary.mjs'

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim()

export function parseJapanGuideSearchContext(page, subject) {
  if (page.url !== subject.sourceUrl || discoverySourceKey(page.url) !== subject.sourceKey) throw new Error('searchSourceIdentity: страница другого объекта')
  const $ = load(page.text)
  const titleEn = clean($('div.page_title > h1.page_title__title').first().text())
  if (!titleEn || titleEn.includes('\ufffd') || !namesAgree(subject.nameEn, titleEn)) throw new Error('searchSourceTitle: заголовок страницы не совпал с очередью')
  // Only breadcrumbs in the page header: hotel adverts and linked attractions
  // lower down are not the location of this subject.
  const breadcrumbs = $('nav.breadcrumbs').first().find('li.breadcrumbs__crumb').map((_, el) => clean($(el).text())).get()
  if (breadcrumbs.some(value => !value || value.length > 200 || value.includes('\ufffd'))) throw new Error('searchSourceBreadcrumb: повреждённая география')
  const prefectures = [...new Set(breadcrumbs.map(value => canonicalPrefecture(value)?.en).filter(Boolean))]
  // Only the named article map, with a query matching this page's subject.
  // Its center is a search preference, never an object coordinate or city ID.
  const centers = []
  $('iframe#googlemap').each((_, el) => {
    try {
      const u = new URL($(el).attr('data-src') || $(el).attr('src'))
      if (u.hostname !== 'www.google.com' || !u.pathname.startsWith('/maps/') || !namesAgree(titleEn, (u.searchParams.get('q') ?? '').replace(/\+/g, ' '))) return
      const pair = (u.searchParams.get('center') ?? '').split(',').map(Number)
      if (pair.length === 2 && pair.every(Number.isFinite) && pair[0] >= 24 && pair[0] <= 46 && pair[1] >= 122 && pair[1] <= 146) centers.push({lat:pair[0],lon:pair[1]})
    } catch { /* malformed map is not a search hint */ }
  })
  // A tourist destination is a search hint, NOT Site City or a proven address.
  return {
    sourceUrl: page.url, rawPageDigest: page.rawPageDigest, observedAt: page.observedAt,
    ...(centers.length === 1 ? { mapCenter: centers[0] } : {}),
    titleEn, breadcrumbs, area: breadcrumbs.at(-1) ?? null,
    prefectureEn: prefectures.length === 1 ? prefectures[0] : null,
  }
}

/** Reuses the existing Japan Guide robots, origin, decoding, pacing and budget boundary. */
export async function readJapanGuideSearchContexts(queue, { limit, fetchImpl = fetch, now = () => new Date(), onObservation = async () => {} } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 50) throw new Error('searchSourceLimit: от 0 до 50 страниц')
  const selected = queue.slice(0, limit)
  const seen = new Set()
  for (const row of selected) {
    if (canonicalDiscoveryUrl(row.sourceUrl).url !== row.sourceUrl || discoverySourceKey(row.sourceUrl) !== row.sourceKey || seen.has(row.sourceKey)) throw new Error('searchSourceIdentity: неверный или повторный ключ')
    seen.add(row.sourceKey)
  }
  const limits = { ...FETCH_LIMITS, maxNetworkRequests: selected.length * (FETCH_LIMITS.maxRedirects + 1) + 1 }
  const pacer = createRequestPacer({ limits })
  const shared = { fetchImpl, now, pacer, limits, clock: () => Date.now() }
  const contexts = new Map()
  const failures = []
  if (!selected.length) return { contexts, failures, networkRequests: 0 }
  let robots
  try { robots = await fetchRobots(shared) } catch (error) {
    if (!(error instanceof RobotsError || error instanceof FetchBoundaryError || error instanceof NetworkBoundaryError)) throw error
    return { contexts, failures: selected.map(row => ({ sourceKey: row.sourceKey, reason: error.code ?? 'sourceUnavailable' })), networkRequests: pacer.networkRequests }
  }
  for (const row of selected) {
    try {
      const page = await fetchHtmlPage({ ...shared, robots: robots.policy, url: row.sourceUrl })
      const context = parseJapanGuideSearchContext(page, row)
      contexts.set(row.sourceKey, context)
      await onObservation({ sourceKey: row.sourceKey, context })
    } catch (error) {
      if (!(error instanceof FetchBoundaryError || error instanceof RobotsError || error instanceof EncodingGateError || error instanceof NetworkBoundaryError) && !error.message?.startsWith('searchSource')) throw error
      const failure = { sourceKey: row.sourceKey, reason: error.code ?? error.message.split(':')[0] }
      failures.push(failure)
      await onObservation(failure)
    }
  }
  return { contexts, failures, networkRequests: pacer.networkRequests }
}
