/**
 * Single source of truth for the site's global schema.org entities.
 *
 * Audit finding В-3: the global layout emitted a `TouristInformationCenter`
 * (a poor fit for a one-person private guide service) plus a separate
 * `Person`, and every route/tour page then emitted its OWN full `Person`
 * copy as `TouristTrip.provider` — meaning a page could carry two or more
 * unlinked Person nodes with no way for a search engine to know they're the
 * same entity. The fix: declare Person once here, with a stable `@id`, and
 * have every other schema object (Organization, TouristTrip.provider, etc.)
 * reference it via `{ "@id": GUIDE_ID }` instead of copying the fields.
 *
 * Do not invent new facts here (ratings, prices, addresses) -- only the
 * properties that were already present in the pre-existing per-page schema
 * objects are carried over.
 */

export const BASE_URL = 'https://jumboinjapan.com'
export const GUIDE_ID = `${BASE_URL}/#guide`
export const ORGANIZATION_ID = `${BASE_URL}/#organization`

/** Reference-only pointer to the guide Person node. Use this in any schema
 *  object that needs to say "provided by / author is the guide" instead of
 *  repeating the Person's fields. */
export const guideRef = { '@id': GUIDE_ID }

/** Reference-only pointer to the Organization node. */
export const organizationRef = { '@id': ORGANIZATION_ID }

/**
 * The guide, as the primary entity of the site. Emit this exactly once, in
 * the root layout. Every page-level schema that used to embed its own copy
 * of this Person should use `guideRef` instead.
 */
export function buildGuidePersonSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': GUIDE_ID,
    name: 'Eduard Revidovich',
    alternateName: 'Эдуард Ревидович',
    jobTitle: 'Private Tour Guide',
    url: BASE_URL,
    worksFor: organizationRef,
    knowsAbout: ['Japan', 'Tokyo', 'Japanese culture', 'Private tours'],
    knowsLanguage: ['ru', 'en', 'ja'],
  }
}

/**
 * The business wrapper around the guide. Replaces the old
 * `TouristInformationCenter` (audit finding В-3: that type implies a public
 * walk-in information center, not a private one-person guide service).
 * `LocalBusiness` keeps every field the old object already had (address,
 * geo, openingHours, priceRange) validly typed -- schema.org doesn't define
 * those properties on the plain `Organization` type, and CLAUDE.md's rule
 * against inventing new facts cuts both ways: it also means not silently
 * dropping facts that were already true and already published.
 */
export function buildGuideOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': ORGANIZATION_ID,
    name: 'JumboInJapan',
    description: 'Частные туры по Японии на русском языке для русскоязычных туристов.',
    url: BASE_URL,
    founder: guideRef,
    employee: guideRef,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Tokyo',
      addressCountry: 'JP',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: 35.6762,
      longitude: 139.6503,
    },
    openingHours: 'Mo-Su 09:00-21:00',
    priceRange: '¥¥¥¥',
    knowsLanguage: ['ru', 'en', 'ja'],
    areaServed: 'Japan',
  }
}

/**
 * Convenience builder for the `TouristTrip.provider` field used on every
 * intercity/city-tour/multi-day page. Pages should use this instead of
 * writing out `{ '@type': 'Person', name: 'Eduard Revidovich', url: BASE_URL }`
 * inline, so there's exactly one Person node on the page (the one in the
 * root layout) and this is just a pointer to it.
 */
export function buildTourProviderRef() {
  return guideRef
}
