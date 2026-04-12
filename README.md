This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Data imports

### Japan Travel events importer

This repo now includes a deterministic importer for `https://en.japantravel.com/events` that writes into the canonical Airtable-backed resources catalogue:

- core resource fields → `Resources`
- event-specific fields → `Resource Event Details`

Dry run (default):

```bash
npm run import:japantravel-events -- --pages 1 --limit 5 --dry-run
```

Real upsert write:

```bash
set -a
source .env.local
set +a
npm run import:japantravel-events -- --pages 1 --limit 1 --write
```

Useful flags:

- `--pages <n>`: crawl paginated index pages (`?type=event&p=N`)
- `--limit <n>`: cap imported items
- `--include-ended`: keep already-ended events
- `--delay-ms <n>`: polite delay between requests

Importer notes:

- stable identity is the Japan Travel source URL (`Source Key`) with deterministic `Resource ID` format `event-japantravel-<sourceId>`
- `Source URL` is persisted on `Resource Event Details`
- no production writes go through local JSON files
- only `import` decisions are written to Airtable; `review` and `skip` stay in the dry-run/report layer for manual inspection

### Phase 1 intake scoring rules

The Japan Travel importer now runs a deterministic intake evaluator before any write. Goal: route-relevant traveler signal > completeness.

Decision buckets:

- `import`: strong enough for Phase 1 auto-import
- `review`: plausible event, but not strong/clean enough for automatic import
- `skip`: clearly out of window or mostly noise for traveler relevance

Current scoring rules:

#### Positive signals

- `+1` event is inside the active Phase 1 time window
  - not already ended beyond a short grace period
  - not more than ~12 months ahead
- `+2` strong tourist-event keywords
  - examples: `matsuri`, `festival`, `fireworks`, `sakura`, `illumination`, `parade`, `market`, `exhibition`
- `+1` secondary event keywords
  - examples: `concert`, `live music`, `garden event`, `food festival`, `traditional performance`
- `+1` has a non-social official/event URL
- `+1` geography is resolvable enough for routing
  - usable city + region + venue/address
- `+2..+5` authoritative tourist-source corroboration
  - weighted by matched source(s), capped to avoid overweighting link spam
  - multiple distinct corroborating sources get a small bonus

#### Negative / blocking signals

- `-5` outside Phase 1 window
  - too far in the past / future
- `-5` promotional hospitality noise
  - examples: `buffet`, `afternoon tea`, `limited-time menu`, `stay plan`, `room package`, `collaboration cafe`, `campaign`
- `-2` local-only / admin-style noise
  - examples: `residents only`, `community center`, `seminar`, `briefing`, `volunteer`, `training session`
- `-2` press/news-release surfaces
  - example: PR wire or `/press` / `/news` landing pages without stronger corroboration
- `-2` geography too vague to route/geocode reliably
- ended events are forced to `skip` when `--include-ended` is not used

Thresholds:

- `import` => score `>= 4` and no blocking reason
- `review` => score `>= 2` but not strong/clean enough for import
- `skip` => everything else

### Authoritative tourist sources used as positive signals

These are intentionally conservative and configurable in `src/lib/japantravel-event-intake.ts`.

| Source | Domain(s) | Why it qualifies |
| --- | --- | --- |
| JNTO / Japan Travel | `japan.travel` | Official national tourism organization; strongest traveler-facing baseline. |
| Japan Guide | `japan-guide.com` | High-trust independent travel reference widely used by inbound visitors. |
| GO TOKYO | `gotokyo.org` | Official Tokyo Convention & Visitors Bureau guide. |
| Kyoto Travel | `kyoto.travel` | Official Kyoto City tourism portal with strong seasonal/cultural event coverage. |
| Osaka Info | `osaka-info.jp` | Official Osaka tourism bureau guide for visitor-facing event discovery. |
| Visit Hokkaido | `visit-hokkaido.jp` | Official Hokkaido tourism organization guide for major regional seasonal events. |

### Dry-run examples

Show scoring/filter outcomes on sample pages:

```bash
npm run import:japantravel-events -- --pages 1 --limit 8 --dry-run
```

The JSON report now includes:

- `decisions.import`
- `decisions.review`
- `decisions.skip`
- sample rows for each bucket with `score`, matched authoritative sources, blocking reasons, and compact signal traces

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
