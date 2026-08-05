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

/**
 * Document Settings — глобальные настройки печатного документа (сейчас
 * стандартные оговорки/дисклеймеры). Правятся в админке (/admin/document-settings),
 * читаются печатным превью и PDF-генератором. Одна строка = одна настройка,
 * ключ — поле `Key`. Бренд-реквизиты (email, имя гида, домен) живут в коде
 * (`src/lib/brand.ts`), не здесь.
 */
export const DOCUMENT_SETTINGS_TABLE_NAME = 'Document Settings'

/**
 * Airtable base ID (Konstructour base). Always prefer `process.env.AIRTABLE_BASE_ID`
 * at the call site when it's already read that way (e.g. `getAirtableCredentials()`
 * in airtable.ts, the route-stops admin API routes) — don't replace those with this
 * constant, since adding a hardcoded fallback there would be a behavior change.
 *
 * This export exists only for the handful of call sites that used to inline the
 * literal `'apppwhjFN82N9zNqm'` directly (no env read at all) or already had their
 * own `process.env.AIRTABLE_BASE_ID ?? '...'` fallback duplicated locally. Value
 * confirmed live during the 2026-07-02 audit (`Airtable schema apppwhjFN82N9zNqm`
 * contains every table used by this project) and matches `AIRTABLE_BASE_ID` in
 * `.env.local` — moving these call sites to read env-first changes nothing at
 * runtime today, it just removes the duplicate literal.
 */
export const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID ?? 'apppwhjFN82N9zNqm'

// --- Table IDs (Airtable record IDs — stable even if a table is renamed in the UI) ---

/** Cities table — city directory used by intercity pages and the multi-day builder. */
export const CITIES_TABLE_ID = 'tblHaHc9NV0mA8bSa'
/** POI table — points of interest. Also addressable by name ('POI'); some call
 *  sites use the name directly via `fetchAllRecords('POI', ...)`, which is fine —
 *  Airtable accepts either for the same table. */
export const POI_TABLE_ID = 'tblVCmFcHRpXUT24y'
/** Day Blocks table — reusable day-plan blocks shown in the multi-day builder. */
export const DAY_BLOCKS_TABLE_ID = 'tbl3v4xKDw991yfa8'
/** Route Stops table — per-route stop editor (route-stops admin API). */
export const ROUTE_STOPS_TABLE_ID = 'tblpa3Zof1ZGofAtS'
/** Routes table — intercity route records (route-stops admin "routes" list). */
export const ROUTES_TABLE_ID = 'tblIsgkRfrQZpJawB'
/** Prospects table — contact-form leads captured via the contact workflow. */
export const PROSPECTS_TABLE_ID = 'tblZqFGoJwj1Q6QbY'
