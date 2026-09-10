/** Complete article evidence, separate from the deliberately small discovery snapshot.
 * No paragraph/fact truncation. Text is evidence for an agent, never published copy.
 * Shared HTTP boundary owns robots, pacing, redirects and response byte limits. */
import assert from 'node:assert/strict'
import { load } from 'cheerio'
import { canonicalJsonBytes } from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { canonicalDiscoveryUrl, discoverySourceKey, createRequestPacer, fetchRobots, fetchHtmlPage, FETCH_LIMITS, FetchBoundaryError, EncodingGateError, RobotsError } from './html-fetch.mjs'
import { NetworkBoundaryError } from './network-boundary.mjs'

export const EVIDENCE_SPEC = 'poi-japan-guide-evidence/v1'
export const OFFICIAL_EVIDENCE_SPEC = 'poi-official-page-evidence/v1'
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const hash = v => sha256Bytes(canonicalJsonBytes(v, v.spec))
const excluded = 'script,style,nav,footer,header,noscript,.advertisement,.adsbygoogle,[data-ad-slot],.page_feedback,.page_related,.page_hotels,.ad_spot,.booking,.related_stories,#section_hotels,#section_restaurants,#section_activities,#section_forum_link,form,datalist'

/** Decode non-ASCII byte runs, UTF-8 first, then strict Shift_JIS. A recovery
 * is disclosed; neither encoding recovery nor text extraction verifies a fact.
 * ASCII HTML delimiters are never rewritten. Undecodable runs remain visible. */
export function decodeArticleBytes(bytes) {
  const utf8 = new TextDecoder('utf-8', { fatal: true })
  const sjis = new TextDecoder('shift_jis', { fatal: true })
  let text = '', recoveredRuns = 0, undecodableRuns = 0
  for (let i = 0; i < bytes.length;) {
    if (bytes[i] < 128) { text += String.fromCharCode(bytes[i++]); continue }
    let end = i + 1
    // Shift_JIS trail bytes may be ASCII; decode a complete text/attribute
    // fragment as fallback, rather than splitting a Japanese character in half.
    while (end < bytes.length && ![60,62,34,39,10,13].includes(bytes[end])) end++
    const fragment = bytes.subarray(i, end)
    try { text += utf8.decode(fragment) }
    catch {
      try { text += sjis.decode(fragment); recoveredRuns++ }
      catch { text += new TextDecoder('utf-8').decode(fragment); undecodableRuns++ }
    }
    i = end
  }
  return { text, recoveredRuns, undecodableRuns }
}

function locator(node, $) {
  const parts = []
  for (let n = node; n?.type === 'tag'; n = n.parent) {
    // A unique, selector-safe ID is an exact anchor in the original DOM. It
    // avoids repeating long layout prefixes in every persisted evidence block.
    const id=n.attribs?.id
    if(id && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id) && $(`#${id}`).length === 1) {
      parts.unshift(`#${id}`)
      break
    }
    const siblings = n.parent?.children?.filter(c => c.type === 'tag' && c.name === n.name) ?? [n]
    parts.unshift(`${n.name}:nth-of-type(${siblings.indexOf(n) + 1})`)
    if (n.name === 'body') break
  }
  return parts.join(' > ')
}
function sectionOf($, el) {
  const section = $(el).closest('section')
  return clean(section.attr('id') || section.find('h2,h3').first().text()) || 'article'
}
function kindOf($, el) {
  if ($(el).closest('.alert,[role="alert"]').length) return 'notice'
  const section = sectionOf($, el)
  if (/admission|hours|closed|ticket/i.test(section)) return 'visiting'
  if (/access|getting|get_there|transport/i.test(section)) return 'access'
  if (/links/i.test(section)) return 'links'
  if (/^h[1-6]$/.test(el.name)) return 'heading'
  if (el.name === 'tr') return 'table'
  if (el.name === 'figcaption') return 'caption'
  return 'article'
}
function safeUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null
  try { const u = new URL(value, base); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null; for (const key of ['key','api_key','token']) u.searchParams.delete(key); return u.href } catch { return null }
}

export function parseJapanGuideEvidence(page) {
  const url = canonicalDiscoveryUrl(page.url).url
  return parseArticleEvidence(page,{url,sourceKey:discoverySourceKey(url),spec:EVIDENCE_SPEC})
}

/** Offline parsing of an explicitly fetched official source for an existing POI.
 * No discovery, identity resolution or network permission is implied here. The
 * selector is recorded; coverage describes that container, not the whole site. */
export function parseOfficialPageEvidence(page,{sourceKey,rootSelector}) {
  const u=new URL(page.url)
  assert(u.protocol === 'https:' && !u.username && !u.password && !u.hash,'officialEvidenceUrl')
  assert(/^japan-guide:[A-Za-z0-9_-]+$/.test(sourceKey),'officialEvidenceIdentity')
  assert(typeof rootSelector === 'string' && rootSelector.trim(),'officialEvidenceSelector')
  return parseArticleEvidence(page,{url:u.href,sourceKey,spec:OFFICIAL_EVIDENCE_SPEC,rootSelector})
}

function parseArticleEvidence(page,{url,sourceKey,spec,rootSelector}) {
  const decoded = page.rawBytes ? decodeArticleBytes(page.rawBytes) : { text: page.text, recoveredRuns: 0, undecodableRuns: page.text.includes('\ufffd') ? 1 : 0 }
  const $ = load(decoded.text)
  const root = rootSelector ? $(rootSelector) : $('.page_body').first().length ? $('.page_body').first() : $('main').first()
  if(rootSelector) assert.equal(root.length,1,'officialEvidenceSelectorMustResolveOnce')
  assert(root.length, 'evidenceArticleMissing: no article container; do not treat a layout change as an empty page')
  // Capture locators in the original DOM: removing an advert must not shift
  // nth-of-type indices in evidence links.
  const locators = new Map(root.find('*').toArray().map(el => [el, locator(el,$)]))
  const excludedElements = root.find(excluded).length
  root.find(excluded).remove()
  const groups = new Map()
  const semantic = '.alert,[role="alert"],p,li,tr,dt,dd,figcaption,h1,h2,h3,h4,h5,h6'
  function walk(node) {
    if (node.type === 'text' && clean(node.data)) {
      const owner = $(node.parent).closest('.alert,[role="alert"]').get(0)
        ?? $(node.parent).closest(semantic).get(0)
        ?? $(node.parent).closest('div,section,article,main,figure').get(0) ?? node.parent
      if (!groups.has(owner)) groups.set(owner, [])
      groups.get(owner).push(node.data)
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(root.get(0))
  const blocks = []
  const add = data => blocks.push({ id: `b${blocks.length + 1}`, ...data })
  for (const [el, pieces] of groups) {
    const text = clean(pieces.join(' '))
    add({ kind: kindOf($, el), section: sectionOf($, el), locator: locators.get(el) ?? locator(el,$), text,
      // Dates and component headings stay with the evidence; an agent must
      // resolve their meaning, not inherit the global page footer date.
      textDigest: sha256Bytes(Buffer.from(text)), encodingIssue: text.includes('\ufffd') })
  }
  root.find('a[href],img,iframe,svg,canvas').each((_, el) => {
    const tag = el.name
    // Inline icons inside a labeled link have no separate source content.
    if (tag === 'svg' && $(el).closest('a').length && !$(el).find('text,title,desc').length) return
    const target = safeUrl(($(el).attr(tag === 'a' ? 'href' : 'src') || $(el).attr('data-src')), url)
    const label = clean($(el).text() || $(el).attr('alt') || $(el).attr('title'))
    let map = null
    if (target) {
      const u = new URL(target)
      if (/^(www\.)?google\.[a-z.]+$/.test(u.hostname) && u.pathname.includes('/maps')) {
        const center = (u.searchParams.get('center') ?? '').split(',').map(Number)
        map = { query: u.searchParams.get('q') ?? null,
          viewCenter: center.length === 2 && center.every(Number.isFinite) ? {lat:center[0],lon:center[1]} : null,
          coordinateMeaning: 'viewportOnlyNotObjectPoint' }
      }
    }
    // Retain every article link/map/image reference, including unlabeled maps.
    add({ kind: tag === 'a' ? 'link' : 'media', section: sectionOf($, el), locator: locators.get(el) ?? locator(el,$),
      text: label, url: target, mediaType: tag, encodingIssue: label.includes('\ufffd'),
      requiresVisualReview: tag !== 'a', ...(map ? { map } : {}) })
  })
  assert(blocks.some(b => b.text), 'evidenceArticleEmpty: no substantive text')
  const body = { spec, sourceKey, sourceUrl: url,
    ...(rootSelector?{rootSelector}:{}),
    observedAt: page.observedAt, rawPageDigest: page.rawPageDigest,
    title: clean($('.page_title__title').first().text() || $('h1').first().text()),
    decoding: { recoveredRuns: decoded.recoveredRuns, undecodableRuns: decoded.undecodableRuns },
    coverage: { textNodes: [...groups.values()].reduce((n, v) => n + v.length, 0), textBlocks: groups.size,
      excludedElements, excludedSelectors: excluded, blockCount: blocks.length, truncated: false }, blocks }
  return { ...body, digest: hash(body) }
}

export function assertEvidence(raw,{allowOfficial=false}={}) {
  canonicalJsonBytes(raw, EVIDENCE_SPEC)
  const { digest, ...body } = raw
  const official=allowOfficial && body.spec === OFFICIAL_EVIDENCE_SPEC
  assert(body.spec === EVIDENCE_SPEC || official, 'evidenceVersion')
  assert.equal(digest, hash(body), 'evidenceDigest')
  if(official) {
    const u=new URL(body.sourceUrl)
    assert(u.protocol === 'https:' && !u.username && !u.password && !u.hash,'officialEvidenceUrl')
    assert(/^japan-guide:[A-Za-z0-9_-]+$/.test(body.sourceKey),'officialEvidenceIdentity')
    assert(typeof body.rootSelector === 'string' && body.rootSelector.trim(),'officialEvidenceSelector')
  } else assert.equal(discoverySourceKey(body.sourceUrl), body.sourceKey, 'evidenceIdentity')
  assert.equal(body.coverage.truncated, false, 'evidenceTruncated')
  assert(body.blocks.length > 0 && body.coverage.blockCount === body.blocks.length, 'evidenceCounts')
  assert.equal(new Set(body.blocks.map(b => b.id)).size, body.blocks.length, 'evidenceDuplicateBlock')
  return raw
}

export async function readJapanGuideEvidence(subjects, { fetchImpl = fetch, now = () => new Date(), onPage = async () => {}, sleep } = {}) {
  assert(Array.isArray(subjects) && subjects.length > 0 && subjects.length <= 50, 'evidenceBatch: 1..50 pages')
  const keys = new Set()
  for (const s of subjects) {
    assert.equal(canonicalDiscoveryUrl(s.sourceUrl).url, s.sourceUrl, 'evidenceCanonicalUrl')
    assert.equal(discoverySourceKey(s.sourceUrl), s.sourceKey, 'evidenceSourceIdentity')
    assert(!keys.has(s.sourceKey), 'evidenceDuplicateSource'); keys.add(s.sourceKey)
  }
  const limits = { ...FETCH_LIMITS, maxNetworkRequests: subjects.length * (FETCH_LIMITS.maxRedirects + 1) + 1 }
  const pacer = createRequestPacer({ limits, sleep })
  const shared = { fetchImpl, now, pacer, limits, clock: () => Date.now() }
  const rows = [], failures = []
  const robots = await fetchRobots(shared)
  for (const subject of subjects) {
    try {
      const page = await fetchHtmlPage({ ...shared, robots: robots.policy, url: subject.sourceUrl, includeBytes: true })
      assert.equal(page.url, subject.sourceUrl, 'evidenceRedirectIdentity: redirected page needs separate identity review')
      const evidence = parseJapanGuideEvidence(page)
      await onPage(evidence, page)
      rows.push(evidence)
    } catch (e) {
      if (!(e instanceof FetchBoundaryError || e instanceof EncodingGateError || e instanceof RobotsError || e instanceof NetworkBoundaryError) && !e.message?.startsWith('evidence')) throw e
      failures.push({ sourceKey: subject.sourceKey, reason: e.code ?? e.message })
    }
  }
  return { spec: 'poi-japan-guide-evidence-batch/v1', rows, failures, networkRequests: pacer.networkRequests }
}
