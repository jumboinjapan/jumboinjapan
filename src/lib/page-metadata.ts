import type { Metadata } from 'next'
import { BASE_URL } from './schema'

/**
 * Single rule for canonical URLs on indexable pages (audit finding В-3):
 * "/intercity and its 13 route pages had canonical, /city-tour and
 * /multi-day (sibling landing pages of the same level) and /resources did
 * not -- this isn't 4 forgotten pages, it's the absence of a rule that every
 * indexable page declares canonical." `buildPageMetadata` is that rule:
 * canonical is always `${BASE_URL}${path}`, computed the same way
 * everywhere, instead of being hand-typed per page (and inevitably drifting).
 *
 * Usage: `export const metadata = buildPageMetadata('/city-tour', { title, description, openGraph: {...} })`.
 * Do not call this on `noindex` pages (faq, journal, admin/**) -- those
 * intentionally opt out of indexing and don't need a canonical.
 */
export function buildPageMetadata(path: string, overrides: Metadata = {}): Metadata {
  return {
    ...overrides,
    alternates: {
      ...overrides.alternates,
      canonical: `${BASE_URL}${path}`,
    },
  }
}
