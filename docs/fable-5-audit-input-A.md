# Fable-5 Architecture Audit — Input Data (Prompt A)

> Purpose: raw facts for a separate deep audit. **No conclusions, no recommendations** — only collected/organized facts.
> Repo: `jumboinjapan/jumboinjapan` · Folder: `/Users/jumbo/Projects/jumboinjapan`
> HEAD: `6004dac` — "fix: correct Trip.com affiliate links (Riverte hotelId, Yakushima partner params, sync missing Kyoto/Tokyo links)"
> Working tree: clean except untracked `docs/fable-5-full-site-audit-prompt.md`
> Generated: 2026-07-02
> Stack (from package.json): next `^16.2.0`, react `^19.0.0`, tailwindcss `^4`, eslint-config-next `15.3.3`

## 0. Collection-environment limitations (read before trusting items 4 & 6)

These are facts about the collection run, not judgments about the code.

- **Item 4 (screenshots):** the browser session's tab renders at a fixed layout viewport (`window.innerWidth = 1909`, dpr 2). `resize_window` changes the OS window frame (`outerWidth` dropped to 725) but **not** the tab's rendering viewport, so CSS media queries always evaluate as desktop. Genuine **390px / 768px renders could not be captured**. Only the desktop tier is real. The sandbox cannot reach prod directly (`curl https://jumboinjapan.com` → 000), so headless-browser capture of prod at exact widths was also unavailable.
- **Item 6 (importer dry-run):** the command ran and entered dry-run correctly, but the sandbox network cannot reach `en.japantravel.com` (same allowlist limitation) → `fetch failed`, exit 1. Output is attached verbatim below.

---

## 1. Repository map

One line per file. Trees below cover `src/app`, `src/components`, `src/lib`, `src/data`, `scripts`.

### `src/app` (App Router)

```
src/app/
  layout.tsx                         — root layout: global metadata, Organization/Person JSON-LD, AppShell wrap
  page.tsx                           — homepage (hero, approach, journey formats, FAQ); WebPage+FAQPage+Person JSON-LD
  robots.ts                          — robots.txt generation
  sitemap.ts                         — sitemap route
  llms.txt/route.ts                  — llms.txt endpoint (LLM-facing site description)

  city-tour/
    page.tsx                         — Tokyo city-tour landing (TouristTrip/Offer/Person JSON-LD)
    day-one/page.tsx                 — Tokyo day 1 route page
    day-two/page.tsx                 — Tokyo day 2 route page
    hidden-spots/page.tsx            — hidden spots route page
    mitake/page.tsx                  — Mitake route page
    takao/page.tsx                   — Takao route page
    limousine/page.tsx               — limousine transport format
    private/page.tsx                 — private transport format
    public/page.tsx                  — public transport format

  intercity/
    page.tsx                         — intercity landing (CollectionPage + TouristTrip list JSON-LD)
    hakone|fuji|nikko|kamakura|enoshima|himeji|kanazawa|kyoto-1|kyoto-2|nara|osaka|uji/page.tsx
                                     — 13 day-trip route pages (each ~338 lines, hakone 455); TouristTrip/Offer/Place/ItemList/BreadcrumbList JSON-LD; import @/lib/airtable
    private/page.tsx                 — intercity private transport format
    public/page.tsx                  — intercity public transport format

  multi-day/
    page.tsx                         — multi-day landing (TouristTrip/Offer/Person JSON-LD)
    classic/page.tsx                 — classic multi-day route
    mountain/page.tsx                — mountain multi-day route
    custom/page.tsx                  — custom multi-day builder entry

  resources/
    layout.tsx                       — resources section shell/nav
    page.tsx                         — resources overview (hotels/restaurants/services/events)
    events/page.tsx                  — events listing (dynamic canonical + CollectionPage/Event JSON-LD)
    hotels/page.tsx                  — hotels resource page (imports @/lib/resources)
    restaurants/page.tsx             — restaurants resource page (imports @/lib/resources)
    services/page.tsx                — services resource page (imports @/lib/resources)

  contact/page.tsx                   — contact page (17 lines; NO page-level metadata/schema)
  faq/page.tsx                       — FAQ (UnderConstruction; robots noindex,nofollow)
  events/page.tsx                    — legacy/thin events entry (5 lines)
  journal/page.tsx                   — journal (18 lines)

  admin/                             — internal admin UI (login, dashboards, editors)
    layout.tsx, login/page.tsx, page.tsx, mission-control/page.tsx, multi-day/page.tsx,
    resources/page.tsx, route-stops/page.tsx, seo-llm/page.tsx, services/page.tsx

  api/
    contact/route.ts                 — contact form submission handler
    events/route.ts                  — events API
    revalidate/route.ts              — ISR revalidation endpoint
    airtable/cities/route.ts         — reads cities (base apppwhjFN82N9zNqm, table tblHaHc9NV0mA8bSa)
    airtable/day-blocks/route.ts     — reads day-blocks (base apppwhjFN82N9zNqm, table tbl3v4xKDw991yfa8)
    admin/auth/*                      — Google OAuth start/callback/logout/debug
    admin/resources/route.ts         — admin resources CRUD (463 lines; imports @/lib/resources)
    admin/services/route.ts          — admin services CRUD
    admin/seo-llm/route.ts           — SEO/LLM copy workspace API (imports @/lib/airtable)
    admin/multi-day/{cities,pois,route}/route.ts — multi-day builder data APIs
    admin/route-stops/{routes,stops,stops/[id],reorder}/route.ts — route-stops editor APIs (table tblpa3Zof1ZGofAtS, tblIsgkRfrQZpJawB)

  .well-known/workflow/v1/*          — Vercel Workflow config/manifest/flow/step/webhook routes
```

### `src/components`

```
layout/
  AppShell.tsx                       — top-level shell wrapper
  Header.tsx                         — site header/nav (desktop nav + mobile menu, CTA)
  Footer.tsx                         — site footer
  MobileCtaBar.tsx                   — sticky mobile CTA bar (h-14)

sections/                            — page building blocks (public)
  HeroSection.tsx, PageHero.tsx, AboutSection.tsx, DestinationsSection.tsx,
  ExperiencesGrid.tsx, ExperienceCard.tsx, TestimonialsSection.tsx, TestimonialCard.tsx,
  JournalPreview.tsx, ContactForm.tsx (130), TourPage.tsx, TravelFormatPage.tsx (297),
  CityTourDayPage.tsx (171), IntercitySummaryStrip.tsx, ImageCarousel.tsx (144, raw <img>),
  PoiSection.tsx, PoiCard.tsx, PoiCarousel.tsx, RecommendationCard.tsx,
  MultiDayJourneyTree.tsx, MultiDayRouteCard.tsx, MultiDayRouteLanding.tsx,
  RestaurantCard.tsx, RestaurantsFilter.tsx (159), ServicesFilter.tsx (263),
  HotelCard.tsx, TransportCard.tsx, UnderConstruction.tsx

resources/
  ResourcesSectionShell.tsx, EventsFiltersForm.tsx, HotelsExplorer.tsx (141)

(top-level components)
  IntercityRouteTimeline.tsx (332), PoiSheet.tsx (206, imports @/lib/airtable),
  RoutePointModal.tsx (180), PracticalInfoList.tsx (120), TicketDisplayList.tsx

ui/
  button.tsx (shadcn button, size variants), info-card.tsx

admin/                               — internal admin components (largest files in repo)
  AdminResourcesWorkspace.tsx (1435), AdminOperationsConsole.tsx (1081),
  MultiDayBuilderWorkspace.tsx (1001), MissionControlCommandCenter.tsx (657),
  RouteStopsEditor.tsx (611), AdminOverviewDashboard.tsx (263), CityAutocomplete.tsx (130),
  AdminShell.tsx, AdminWorkspaceNav.tsx
```

### `src/lib`

```
airtable.ts (447)                    — low-level Airtable REST client (env AIRTABLE_TOKEN/BASE_ID); POI/Route Stops/tblHaHc9NV0mA8bSa fetch+update
resources.ts (1004)                  — canonical Resources layer; defines 6 *_TABLE_NAME constants; resource typing/fetch/mapping
events.ts (155)                      — events read/filter, built on resources.ts (getResources/toEventItem)
event-surface-text.ts (112)          — RU/EN surface-text safety/preference helpers
hotels-data.ts (155)                 — hotel typing + loads src/data/hotels-trip.json (partner links)
intercity-pois.ts (281)              — intercity POI seeds/highlights; imports @/lib/airtable types
ticket-display.ts (173)              — builds ticket display lines from Airtable POI data
working-hours.ts (259)               — opening-hours formatting (RU day labels)
text-budgets.ts (98)                 — text-length budget profiles/analysis for copy
prospects.ts (225)                   — Prospects Airtable integration (base apppwhjFN82N9zNqm, table tblZqFGoJwj1Q6QbY, "Konstructour" base per comment)

japantravel-events.ts (1467)         — Japan Travel import pipeline core; defines RESOURCES/RESOURCE_EVENT_DETAILS table names; fetch/parse/import
japantravel-event-intake.ts (384)    — intake scoring/decisions (import|review|reject|duplicate|ended); IMPORT_DEFAULTS
japantravel-event-maintenance.ts (352) — lifecycle maintenance (cleanup-ended etc.); redefines RESOURCES/RESOURCE_EVENT_DETAILS table names

multi-day-builder.ts (295)           — multi-day builder domain types
multi-day-builder-data.ts (124)      — builder data source (tables tblHaHc9NV0mA8bSa, tblVCmFcHRpXUT24y)
multi-day-builder-storage.ts (517)   — saved-route persistence/summaries

admin-auth.ts (299)                  — Google admin auth config/session
admin-resources.ts (317)             — admin resource types/helpers (imports resources.ts)
admin-services.ts (183)              — admin services; aliases SERVICES_TABLE_NAME = RESOURCES_TABLE_NAME
admin-service-records.ts (189)       — service record shaping for admin
admin-draft-generator.ts (371)       — LLM draft/rewrite generation using text-budgets
admin-seo-llm-storage.ts (166)       — SEO/LLM workspace draft storage (imports @/lib/airtable)
admin-workspace.ts (24)              — admin workspace item aggregation
admin-city-label.ts (19)             — city label formatting
notifications/telegram.ts (106)      — Telegram notifications via @Jumbo_in_japan_bot
```

### `src/data`

```
restaurants.json (5821)              — restaurants dataset (cleaned)
restaurants-raw.json (4852)          — restaurants raw source dataset
services.ts (973)                    — services catalog (experience + practical)
hotels-trip.json (410)               — hotels with Trip.com/partner affiliate links
multiDayJourneys.ts (386)            — multi-day journey definitions
tours.ts (193)                       — tour metadata (titles/descriptions for city-tour/intercity/multi-day)
intercitySummaries.ts (80)           — intercity route summary strips
multiDayRouteCards.ts (52)           — multi-day route card data
experiences.ts (38)                  — experiences list
journal.ts (33)                      — journal entries
hakone-ab.ts (15)                    — Hakone A/B variant data
about.ts (10)                        — about section copy
events.json (1)                      — events data stub
```

### `scripts`

```
import-japantravel-events.mjs (276)          — CLI entry for Japan Travel import (loads @next/env, calls importJapanTravelEvents)
import-japantravel-events-batched.mjs (216)  — batched multi-page import wrapper (spawns child processes)
normalize-japantravel-events-ru.mjs (176)    — RU normalization pass over event surface text
backfill-resources-airtable.mjs (263)        — backfill Resources from events.json
seed-resources-airtable.mjs (138)            — seed Resources table
seed-services-airtable.mjs (176)             — seed services from src/data/services.ts
create-resource-schema.mjs (146)             — generate/describe resource schema
```

### Files > 400 lines (Fable structural-review candidates)

| Lines | File |
|------:|------|
| 5821 | `src/data/restaurants.json` |
| 4852 | `src/data/restaurants-raw.json` |
| 1467 | `src/lib/japantravel-events.ts` |
| 1435 | `src/components/admin/AdminResourcesWorkspace.tsx` |
| 1081 | `src/components/admin/AdminOperationsConsole.tsx` |
| 1004 | `src/lib/resources.ts` |
| 1001 | `src/components/admin/MultiDayBuilderWorkspace.tsx` |
| 973  | `src/data/services.ts` |
| 657  | `src/components/admin/MissionControlCommandCenter.tsx` |
| 611  | `src/components/admin/RouteStopsEditor.tsx` |
| 517  | `src/lib/multi-day-builder-storage.ts` |
| 464  | `src/app/page.tsx` |
| 463  | `src/app/api/admin/resources/route.ts` |
| 455  | `src/app/intercity/hakone/page.tsx` |
| 447  | `src/lib/airtable.ts` |
| 410  | `src/data/hotels-trip.json` |

---

## 2. Static analysis (raw output)

### `npx tsc --noEmit`

```
(no output)
___TSC_EXIT:0
```

### `npm run lint` (→ `eslint .`)

```
> jumboinjapan@0.1.0 lint
> eslint .

/…/src/app/.well-known/workflow/v1/flow/route.js
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/…/src/components/admin/AdminOperationsConsole.tsx
  401:6  warning  React Hook useEffect has missing dependencies: 'mutateDraft', 'seededDraftIds', and 'selectedItem'. Either include them or remove the dependency array  react-hooks/exhaustive-deps

/…/src/components/admin/MultiDayBuilderWorkspace.tsx
  512:6  warning  React Hook useEffect has missing dependencies: 'refreshSavedRoutes' and 'route.slug'. …  react-hooks/exhaustive-deps
  543:6  warning  React Hook useEffect has missing dependencies: 'route.endCity', 'route.endCityId', 'route.startCity', and 'route.startCityId'. …  react-hooks/exhaustive-deps
  561:6  warning  React Hook useEffect has missing dependencies: 'route', 'titleEn', and 'titleRu'. …  react-hooks/exhaustive-deps

/…/src/components/sections/ImageCarousel.tsx
  35:9  warning  The 'slides' logical expression could make the dependencies of useMemo Hook (at line 60) change on every render. …  react-hooks/exhaustive-deps
  50:6  warning  React Hook useMemo has an unnecessary dependency: 'page'. …  react-hooks/exhaustive-deps

✖ 7 problems (0 errors, 7 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

___LINT_EXIT:0
```

Note: repo has no separate `typecheck` script; `npx tsc --noEmit` was run directly per prompt.

---

## 3. Metadata & schema.org per page type

| Page | title | description (excerpt) | canonical | schema.org @types |
|------|-------|-----------------------|-----------|-------------------|
| Global (`layout.tsx`) | template: `JumboInJapan — Личный гид по Японии` | "Частные туры по Японии на русском языке. Токио, Хаконэ, Никко… Премиум сопровождение с опытом 10+ лет." | `https://jumboinjapan.com` | TouristInformationCenter, PostalAddress, GeoCoordinates, Person, Organization |
| Home (`page.tsx`) | `Частный гид по Японии на русском` | (RU home description) | `https://jumboinjapan.com` | WebPage, Person, FAQPage, Question, Answer |
| `/city-tour` | `tour.title` (from data) | `tour.description` | **none** (no `alternates.canonical`) | TouristTrip, Person, Offer |
| `/intercity` | `Загородные туры из Токио с гидом на русском` | "Однодневные и многодневные туры из Токио: Хаконэ, Никко, Камакура…" | `https://jumboinjapan.com/intercity` | CollectionPage, TouristTrip |
| `/intercity/hakone` (representative route) | `tour.title` | `tour.description` | `https://jumboinjapan.com/intercity/hakone` | TouristTrip, Person, Offer, Place, PostalAddress, ItemList, ListItem, BreadcrumbList |
| `/multi-day` | `tour.title` | `tour.description` | **none** (no `alternates.canonical`) | TouristTrip, Person, Offer |
| `/resources` | `Ресурсы для поездки по Японии` | (RU resources description) | **none** (no `alternates.canonical`) | (none in page) |
| `/resources/events` | `События — ресурсы для поездки по Японии` | (RU events description) | dynamic `buildCanonicalUrl()` (filters-aware) | CollectionPage, Event, Place, Organization, Offer |
| `/contact` | — (inherits layout) | — (inherits layout) | — (no page metadata) | (none) |
| `/faq` | — (only `robots: index:false, follow:false`) | — | — | (none; UnderConstruction) |

Additional facts:
- Global schema in `layout.tsx` is rendered on every page (TouristInformationCenter + Person + Organization + PostalAddress + GeoCoordinates).
- `FAQPage` schema is emitted on the **homepage** (`page.tsx`), while `/faq` itself is `noindex,nofollow` UnderConstruction.
- 13 intercity route pages each carry TouristTrip + Offer + BreadcrumbList; hakone additionally has Place/PostalAddress/ItemList.
- JSON-LD is rendered in: `layout.tsx`, `page.tsx`, all `city-tour/*`, all `intercity/*`, `multi-day/page.tsx`, `resources/events/page.tsx`, and `src/lib/japantravel-events.ts` (importer-side).
- Repo-wide @type frequency: ListItem×37, TouristTrip×30, Offer×19, Person×20, BreadcrumbList×12, TouristAttraction×4, Place×2, plus single Organization/ItemList/Event/CollectionPage/WebPage/FAQPage/Question/Answer/GeoCoordinates/PostalAddress.

---

## 4. Screenshots — live prod site

See §0: only the desktop tier is genuine; the browser session locked the layout viewport at ~1909px CSS, so 390px and 768px could not be rendered. Below is the factual desktop-tier read of jumboinjapan.com. **No breakage observed** on any page at desktop (no overlapping text, no cut images, contrast readable).

| Page | Desktop (~1440/1909px) — what's visible & breakage |
|------|-----------------------------------------------------|
| `/` | Full-width city hero + heading «Япония в деталях», horizontal nav, two CTAs, city links row. No breakage. |
| `/city-tour` | Hero «Токио — не за один день», gradient overlay, eyebrow «ТУРЫ ПО ТОКИО». No breakage. |
| `/intercity` | Torii hero «Япония за пределами Токио», eyebrow «ЗАГОРОДНЫЕ ТУРЫ · ИЗ ТОКИО». No breakage. |
| `/multi-day` | Snowy village hero «Маршруты по Японии на несколько дней». No breakage. |
| `/resources` | Breadcrumb «Ресурсы / Обзор», filter chips (Отели/Рестораны/Услуги/События), 3 intro cards + 4 category cards. No breakage. |
| `/contact` | Form (Имя, Email/Telegram, dates, «Количество человек» select, interests textarea, submit), footer starting (contact hello@jumboinjapan.com, nav, socials). No breakage. |

**Not captured (needs a working viewport path):** 390px mobile and 768px tablet renders for all pages.

---

## 5. Airtable surface in code

### Table-name constants (`*_TABLE_NAME`) defined in `src/lib`

| Constant | Value | Defined in |
|----------|-------|-----------|
| `RESOURCES_TABLE_NAME` | `Resources` | `resources.ts`, **and re-declared in** `japantravel-events.ts`, `japantravel-event-maintenance.ts` |
| `RESOURCE_SERVICE_DETAILS_TABLE_NAME` | `Resource Service Details` | `resources.ts` |
| `RESOURCE_HOTEL_DETAILS_TABLE_NAME` | `Resource Hotel Details` | `resources.ts` |
| `RESOURCE_HOTEL_PARTNER_LINKS_TABLE_NAME` | `Resource Hotel Partner Links` | `resources.ts` |
| `RESOURCE_EVENT_DETAILS_TABLE_NAME` | `Resource Event Details` | `resources.ts`, **and re-declared in** `japantravel-events.ts`, `japantravel-event-maintenance.ts` |
| `RESOURCE_RESTAURANT_DETAILS_TABLE_NAME` | `Resource Restaurant Details` | `resources.ts` |
| `SERVICES_TABLE_NAME` | = `RESOURCES_TABLE_NAME` (alias) | `admin-services.ts` |
| `SERVICE_DETAILS_TABLE_NAME` | = `RESOURCE_SERVICE_DETAILS_TABLE_NAME` (alias) | `admin-services.ts` |

**Fact:** `RESOURCES_TABLE_NAME` and `RESOURCE_EVENT_DETAILS_TABLE_NAME` are literally re-declared with the same string in three modules (`resources.ts`, `japantravel-events.ts`, `japantravel-event-maintenance.ts`) rather than imported from one source.

### Hard-coded base IDs / table IDs referenced in `src`

| ID | Referenced in |
|----|---------------|
| base `apppwhjFN82N9zNqm` | `api/airtable/cities/route.ts`, `api/airtable/day-blocks/route.ts`, `prospects.ts` |
| table `tblHaHc9NV0mA8bSa` | `airtable.ts:197`, `api/airtable/cities/route.ts`, `multi-day-builder-data.ts` |
| table `tblVCmFcHRpXUT24y` | `AdminOverviewDashboard.tsx`, `multi-day-builder-data.ts` |
| table `tbl3v4xKDw991yfa8` | `api/airtable/day-blocks/route.ts` |
| table `tblpa3Zof1ZGofAtS` | `api/admin/route-stops/{stops,stops/[id],reorder}/route.ts` |
| table `tblIsgkRfrQZpJawB` | `api/admin/route-stops/routes/route.ts` |
| table `tblZqFGoJwj1Q6QbY` (Prospects, "Konstructour" base per comment) | `prospects.ts` |

The low-level REST client (`airtable.ts`) reads `process.env.AIRTABLE_TOKEN` and `process.env.AIRTABLE_BASE_ID`, hitting `https://api.airtable.com/v0/${baseId}/…` with tables `POI`, `Route Stops`, and `tblHaHc9NV0mA8bSa`.

### Modules that touch Airtable OUTSIDE the canonical `resources.ts`

Importers of the low-level `@/lib/airtable` client (bypassing `resources.ts`):
`api/admin/seo-llm/route.ts`, all 13 `intercity/*/page.tsx`, `PoiSheet.tsx`, `admin-seo-llm-storage.ts`, `admin-workspace.ts`, `intercity-pois.ts`, `ticket-display.ts`.

Modules with their **own** direct base/table IDs (not via `resources.ts` and not via `airtable.ts` env base): `api/airtable/cities/route.ts`, `api/airtable/day-blocks/route.ts`, `api/admin/route-stops/*`, `multi-day-builder-data.ts`, `prospects.ts` (different base `apppwhjFN82N9zNqm`).

Importers of the canonical `@/lib/resources`: `api/admin/resources/route.ts`, `resources/{hotels,restaurants,services}/page.tsx`, `admin-resources.ts`, `admin-services.ts`, `events.ts`.

### Airtable field names referenced in `src/lib` (via `fields['…']` bracket access)

```
Agent Notes · Arrival Date · Avoid · Booking URL · CITY ID · Children · Copy Status ·
Days For Tours · Departure Date · Description (EN) · Description (RU) ·
Description Approved (EN) · Description Approved (RU) · Description Draft (EN) · Description Draft (RU) ·
Dinner Price · Duration Minutes · Editor Module · Ends At · Event Category ·
Experience Format · Experience Subcategory · External URL · Eyebrow · First Time Japan ·
Flexible Dates · Google Maps URL · Group Name · Guide Language · HasNonCarSegments ·
Helper Criteria Label · Home City · Home Country · Interests · Is Helper · Is Ryokan ·
Language · Last Seeded At · Lunch Price · Michelin Stars · Mobility · Mobility Notes · Must See ·
Name (EN) · Name (RU) · Name (RU) (from Regions) · Notes · POI Category (RU) · POI ID ·
POI Name (EN) · POI Name (RU) · POI Name Snapshot · Pace · Partner URL · Party Composition ·
Party Size · Photo Alt · Photo Path · Pocket Concierge URL · Price From · Price Label ·
Primary URL · Region Key · Region Label · Resource ID · Resource Slug · Resource Type ·
Route Slug · Route Stop ID · Seed Source · Selling Highlights · Service Class · Service ID ·
Service Kind · Service Name · Service Slug · Site City · Sort Order · Source Key · Source URL ·
Special Occasion · Starts At · Status · Staying Area ·
Stop Description Override Approved (RU) · Stop Title Override · Tags · Ticket ID · Ticket Price ·
Ticket Type · Title JA · Transport Preference · Trip URL · Venue JA · Website · Working Hours ·
stop_type · №
```

(List is from `fields['…']` bracket access in `src/lib`; field names used only as object-literal keys elsewhere may add a few more.)

---

## 6. Japan Travel importer — dry-run output (verbatim)

Command: `npm run import:japantravel-events -- --pages 1 --limit 5 --dry-run`

```
> jumboinjapan@0.1.0 import:japantravel-events
> node scripts/import-japantravel-events.mjs --pages 1 --limit 5 --dry-run

(node:19) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///…/src/lib/japantravel-events.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /…/package.json.
[japantravel-events] Warning: Could not load known resources (dry-run or missing creds?): fetch failed
[japantravel-events] Fetching index page 1: https://en.japantravel.com/events?type=event&p=1
fetch failed
___IMPORT_EXIT:1
```

(Environment fact: the `fetch failed` is because the collection sandbox cannot reach `en.japantravel.com`. Dry-run mode itself engaged as expected. No interpretation of code behavior beyond this.)

---

## 7. Accessibility checklist (factual, yes/no)

Public pages are composed from shared components, so alt/focus/touch-target facts are component-level and applied to the pages that use them.

### Images (`alt` present)

- Raw `<img>`: **2 total** (both in `ImageCarousel.tsx`) — **both have `alt`** (dynamic `imageAlts?.[…] ?? resolveAltText(src, alt)`). YES.
- `next/image` `<Image>`: **12 total** across `page.tsx`(3), `AboutSection`, `CityTourDayPage`, `DestinationsSection`(2), `ExperienceCard`, `HeroSection`, `MultiDayRouteCard`, `PageHero`, `TransportCard` — **all have `alt`**. YES.
- Net: every `<img>`/`<Image>` in the codebase has an `alt` attribute. → **alt: YES for all public pages.**

### Visible `:focus`

- `ui/button.tsx`: explicit `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` (with `outline-none`). → focus ring **YES** on Button.
- `Header.tsx`: nav `<Link>` items and header CTA `<Link>` have **no explicit `focus-visible`/outline class** (rely on UA default). Mobile hamburger `<button>` and mobile-menu `<Link>`s also have no explicit focus style.
- `globals.css` base layer: `* { @apply border-border outline-ring/50; }` sets outline **color** globally but no explicit focus outline width/style rule.
- 29 `focus-visible|focus:|outline-` occurrences repo-wide (concentrated in `ui/` and admin components).
- → **Visible focus: YES on Button component; NOT explicitly defined on Header/Footer nav links and CTAs (UA default only).**

### Minimum touch-target height (mobile)

- `MobileCtaBar` link: `h-14` (56px). YES (≥44px).
- `Header` mobile hamburger `<button>`: `min-h-11 min-w-11` (44px). YES.
- `Header` mobile-menu links: `min-h-11`. YES.
- `Header` desktop CTA link: `min-h-11 px-8 py-4`. YES.
- `ui/button.tsx` size variants: default/`sm`/`xs` are `h-8`/`h-7`/`h-6` and icon `size-8`/`size-6` (32px and below) — **below 44px** (used primarily in admin UI, not public marketing pages).
- → **Touch targets on public header/menu/CTA: YES (≥44px). Generic Button variants: below 44px (admin-facing).**

### Per-page summary

| Page | alt on all images | visible :focus | touch targets ≥44px (mobile) |
|------|:---:|:---:|:---:|
| Home | YES | Partial (Button yes; nav/CTA UA-default) | YES (header/menu/CTA bar) |
| /city-tour (+routes) | YES | Partial | YES |
| /intercity (+routes) | YES | Partial | YES |
| /multi-day | YES | Partial | YES |
| /resources/* | YES | Partial | YES |
| /contact | YES (n/a images) | Partial (form controls rely on UA focus) | YES |

---

*End of input data. Two items are constrained by the collection environment (mobile screenshots in §4; importer network fetch in §6) — both flagged in §0.*
