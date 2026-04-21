# Multi-Day Route Builder — Canonical Spec

_Last updated: 2026-04-22_

## 1. Core decision

### Airtable split
- **Konstructour** = route/content system
- **CRM OPS** = live client operations
- **Route Builder is not a third Airtable base**
- **Route Builder is a dedicated admin module inside JumboInJapan admin**, backed primarily by Konstructour

### Product split
- Build reusable public and internal route templates in **Konstructour**
- Create client trips / operational records in **CRM OPS**
- When a real client program is needed, CRM OPS references or snapshots a Konstructour route template

---

## 2. Ownership model

### Konstructour owns
- route templates
- route sequencing
- day structure
- POI selection
- overnight city logic
- transport segment structure
- route-level editorial copy
- route/day display metadata for preview/PDF

### CRM OPS owns
- clients
- leads / inquiries
- bookings
- service dates
- traveler counts
- pricing / payment status
- communication log
- follow-ups / operational tasks
- finalized client-specific itinerary instances

### Bridge between them
CRM OPS records must be able to store:
- `sourceRouteId`
- `sourceRouteSlug`
- `sourceRouteVersion`
- optional frozen `programSnapshotJson`

This keeps Konstructour as the route brain and CRM OPS as the client reality.

---

## 3. Konstructour schema

## 3.1 Existing tables to keep using

### `Routes` (existing, expand)
Purpose: top-level route template record.

Required fields:
- `Title`
- `Title (EN)`
- `Slug`
- `Route Type` (`city-tour` | `intercity` | `multi-day`)
- `Status` (`Draft` | `Review` | `Live` | `Archived`)
- `Day Count`
- `Start City`
- `Start City ID`
- `End City`
- `End City ID`
- `Route Intro Draft (RU)`
- `Route Intro Approved (RU)`
- `SEO Title Draft`
- `SEO Title Approved`
- `SEO Description Draft`
- `SEO Description Approved`
- `Editorial Thesis`
- `Route Narrative Arc`
- `Preview Title`
- `Preview Subtitle`
- `Hero Image`
- `Route Version`
- `Last Builder Sync`

### `Route Stops` (existing, narrow role)
Purpose: canonical route skeleton at a macro level.

Required fields:
- `Route`
- `Order`
- `POI`
- `City`
- `Stop Type` (`arrival-anchor` | `poi-anchor` | `overnight-anchor` | `departure-anchor`)
- `Nights`
- `Title Override`
- `Notes`

Rule:
- `Route Stops` stay useful as the high-level route spine
- they do **not** become the only source for detailed multi-day rendering

## 3.2 New tables

### `Route Days`
Purpose: one record per route day.

Required fields:
- `Route`
- `Day Number`
- `Day Type` (`arrival` | `touring` | `departure`)
- `Day Title`
- `Day Summary`
- `Overnight City`
- `Derived Regions`
- `Primary Region Override`
- `Start Location`
- `End Location`
- `Internal Notes`
- `Display Status` (`Generated` | `Edited` | `Locked`)
- `Print Lead`
- `Print Footer Note`

Behavior:
- Day 1 auto-generated as `arrival`
- final day auto-generated as `departure`
- intermediate days default to `touring`

### `Day Items`
Purpose: ordered content blocks inside a day.

Required fields:
- `Route Day`
- `Order`
- `Item Type` (`poi` | `transport` | `hotel` | `meal` | `note` | `arrival` | `departure`)
- `POI`
- `Transport Segment`
- `Display Title`
- `Short Description`
- `Start Time`
- `End Time`
- `Source Mode` (`generated` | `manual`)
- `Locked`
- `Preview Badge`
- `Internal Notes`

Rules:
- every visual block in the admin builder must correspond to a `Day Item`
- avoid free-form itinerary text blobs as the primary structure

### `Transport Segments`
Purpose: structured movement between locations.

Required fields:
- `Route`
- `Route Day`
- `Order`
- `From Location`
- `To Location`
- `Mode` (`walk` | `train` | `shinkansen` | `bus` | `car` | `flight` | `mixed`)
- `Duration Minutes`
- `Estimated Cost Min`
- `Estimated Cost Max`
- `Cost Basis` (`manual` | `heuristic` | `api`)
- `Pricing Provider`
- `Pricing Confidence`
- `Reservation Note`
- `Baggage Note`
- `Display Label`
- `Internal Notes`

Rule:
- transport is a first-class object, not a plain note

---

## 4. CRM OPS additions

If not already present, CRM OPS should hold the operational layer in separate tables:

### `Clients`
- identity and contact data

### `Inquiries`
- origin, request, initial route interest

### `Trips`
- client trip shell
- service dates
- party size
- operational status
- `sourceRouteId`
- `sourceRouteSlug`

### `Trip Programs`
Purpose: client-specific itinerary instance.

Required fields:
- `Trip`
- `Program Version`
- `Based On Route`
- `Snapshot Json`
- `Pdf Url`
- `Client Visible Status`
- `Last Sent At`

This is where customized client-facing programs live, not in Konstructour.

---

## 5. Admin product structure

## 5.1 New admin module
Create:
- `GET /admin/multi-day`

This is a dedicated workspace, separate from:
- `/admin/resources`
- `/admin/seo-llm`
- `/admin/route-stops`

## 5.2 Screen architecture

### A. Utility header
- title
- route status
- save
- duplicate
- preview
- export PDF

### Builder input rules
- editor enters `Title (RU)` and `Title (EN)` separately
- `Slug` is generated from the English title plus the registered day count
- format: `<english-title>-<days>-days`
- start and end cities must be selected from Airtable `Loctaions/Cities`, not typed freehand

### B. Left rail: day outline
Each row shows:
- day number
- day type
- overnight city
- transport count
- warning badge if incomplete

### C. Main canvas
Two layers:

#### Layer 1: route matrix
Compact table for scanning the whole trip:
- day
- type
- cities
- overnight city
- transport
- completeness

#### Layer 2: day accordions
Each day expands into ordered blocks.

Inside a day:
- day header
- overnight city
- derived region chip
- ordered `Day Items`
- `+ Add POI` with Airtable autocomplete by typed prefix (RU or EN)
- `+ Add transport`
- `+ Add note`

### D. Right inspector
Shows details for selected:
- day
- POI item
- transport segment
- notes
- manual override controls

### E. Preview mode
Toggle between:
- internal structure preview
- client-facing itinerary preview
- print layout preview

---

## 6. Generation rules

## 6.1 Skeleton generation
Input:
- route title
- day count
- optional start city
- optional end city
- optional seed route stops

Output:
- `Route` record
- `Route Days` records
- initial `Day Items`
- initial `Transport Segments`

## 6.2 Deterministic defaults
- Day 1 = `arrival`
- Day N = `departure`
- region derives from overnight city or majority of linked POI regions
- overnight city derives from end-of-day location unless manually overridden
- transport suggestions are generated between consecutive locations/items

## 6.3 Critical override rule
Need explicit state on each generated object:
- `generated`
- `manual`
- `locked`

Without this, regeneration will destroy human edits.

---

## 7. Transport pricing strategy

## V1
- manual cost ranges
- heuristic defaults for common routes
- optional generic duration help
- admin override always wins

## V2
Integrate a Japan-specific provider behind a transport service layer.

Primary candidates:
- `NAVITIME`
- `Jorudan`
- `Ekispert`

Rule:
- never couple UI directly to a provider
- the app owns a provider abstraction and caches results into `Transport Segments`

---

## 8. PDF / print strategy

PDF is a first-class output, not a future add-on.

Need two render targets from the same structure:
- builder view
- print / PDF view

Each route/day/item must already contain:
- stable display title
- short description
- order
- item type
- optional print-specific lead/footer text

Recommended future outputs:
- `internal ops preview`
- `client PDF`

Implementation rule:
- print view must render all day accordions as expanded
- do not depend on admin-only UI state for PDF composition

---

## 9. Build phases

## Phase 1 — Schema and builder shell
- expand `Routes`
- add `Route Days`
- add `Day Items`
- add `Transport Segments`
- add `/admin/multi-day`
- route title + day count generator

## Phase 2 — Day builder
- route matrix
- accordion day editor
- inspector panel
- ordered item insertion
- overnight city / region behavior

## Phase 3 — Generation and regeneration safety
- generator rules
- preserve manual edits
- lock state
- reflow logic for day changes

## Phase 4 — Preview and PDF
- client preview renderer
- print stylesheet / HTML print view
- export pipeline

## Phase 5 — CRM OPS bridge
- route template → trip program snapshot
- versioned client program output

---

## 10. Agent execution split

### LLoyd
- product decisions
- scope control
- cross-system arbitration

### Johny
- admin layout quality
- route matrix + accordion composition
- print-friendly UI logic

### Verter
- schema design
- Next.js admin architecture
- data contracts
- transport abstraction
- preview / PDF rendering pathway

### Later if needed
- Pelevin: client-facing itinerary language layer
- Tundra: factual validation for transport copy / route claims
- SEOsha: route-template discoverability layer for public pages

---

## 11. Immediate next build step

Start with:
1. create the new admin page shell `/admin/multi-day`
2. define the TypeScript domain model for `RouteDay`, `DayItem`, `TransportSegment`
3. map existing `Routes` / `Route Stops` into the new builder
4. only then wire Airtable write flows

This keeps the architecture clean and prevents Airtable schema drift from leading the product.
