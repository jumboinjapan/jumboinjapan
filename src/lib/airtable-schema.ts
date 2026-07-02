/**
 * Single source of truth for Airtable table names used across the site, the
 * Japan Travel importer/maintenance jobs, and one-off migration scripts.
 *
 * Why this file exists: several modules used to re-declare the same table
 * name as a local string literal (e.g. `RESOURCES_TABLE_NAME = 'Resources'`
 * independently in resources.ts, japantravel-events.ts and
 * japantravel-event-maintenance.ts). If a table were ever renamed in
 * Airtable, fixing the constant in one file but missing another would let
 * the public site and the write-side importer silently point at different
 * tables — the importer would keep "succeeding" while writing to a table
 * the site no longer reads. Importing from here instead of retyping the
 * string removes that failure mode.
 *
 * Do not add a new hardcoded table-name string literal anywhere else in the
 * codebase — add it here and import it.
 */

export const RESOURCES_TABLE_NAME = 'Resources'
export const RESOURCE_SERVICE_DETAILS_TABLE_NAME = 'Resource Service Details'
export const RESOURCE_HOTEL_DETAILS_TABLE_NAME = 'Resource Hotel Details'
export const RESOURCE_HOTEL_PARTNER_LINKS_TABLE_NAME = 'Resource Hotel Partner Links'
export const RESOURCE_EVENT_DETAILS_TABLE_NAME = 'Resource Event Details'
export const RESOURCE_RESTAURANT_DETAILS_TABLE_NAME = 'Resource Restaurant Details'
