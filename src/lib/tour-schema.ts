import { serviceTerms } from '@/data/service-terms'
import { BASE_URL, guideRef } from '@/lib/schema'

/** An inquiry about a private tour is not live bookable inventory.
 * Keep price, currency and availability absent until an actual tariff and
 * availability source exists. This module has no database dependency. */
export function buildTourOffer(pageUrl: string) {
  return {
    '@type': 'Offer',
    '@id': `${pageUrl}#offer`,
    url: `${BASE_URL}/contact`,
    seller: guideRef,
    description: serviceTerms.pricing,
  }
}

/** TouristTrip does not define duration. Preserve the visible duration as
 * descriptive text rather than inventing an ISO duration or a departure date. */
export function describeTourDuration(duration: string) {
  return `Продолжительность: ${duration}.`
}

/** JSON-LD is embedded in a script element; escape markup from route copy. */
export function serializeTourSchema(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
