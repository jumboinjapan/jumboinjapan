# JumboInJapan

Русскоязычный сайт частного гида и сервиса планирования путешествий по Японии — [jumboinjapan.com](https://jumboinjapan.com). Личный проект Эдуарда Ревидовича: экскурсии по Токио, поездки между городами, многодневные маршруты по всей стране.

Полный операционный гайд по проекту (архитектура, зоны риска, правила разработки) — в [`CLAUDE.md`](./CLAUDE.md). Спецификация конструктора многодневных маршрутов — в [`docs/multi-day-route-builder-spec.md`](./docs/multi-day-route-builder-spec.md).

## Стек

- Next.js (App Router), React, TypeScript
- Tailwind CSS 4
- Airtable — основное хранилище данных (ресурсы, туры, маршруты, POI, лиды)
- Vercel — хостинг и деплой, Vercel Analytics
- Vercel Workflows — обработка формы контактов

## Быстрый старт

```bash
npm install
npm run dev
```

Открыть [http://localhost:3000](http://localhost:3000).

Для работы с Airtable, админкой и формой контактов нужен `.env.local` (не коммитится) со своими значениями:

```
AIRTABLE_TOKEN=
AIRTABLE_BASE_ID=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ADMIN_AUTH_SECRET=
ADMIN_ALLOWED_EMAILS=
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_CHAT_ID=
REVALIDATE_SECRET=
```

Без этих переменных сайт всё равно соберётся и запустится — просто Airtable-зависимые страницы и админка не будут работать (публичные страницы с собственным контентом в `src/data` работают без Airtable).

## Структура проекта

- `src/app` — страницы (App Router): главная, city-tour, intercity, multi-day, resources, admin, api
- `src/components` — UI-компоненты, включая `admin/` (конструктор маршрутов, управление ресурсами) и `sections/` (публичные блоки страниц)
- `src/lib` — бизнес-логика: Airtable-клиент, конструктор многодневных маршрутов, импортёр Japan Travel, авторизация админки
- `src/data` — статический контент и данные, не завязанные на Airtable
- `scripts` — служебные и одноразовые скрипты (импорт, сид данных, разовые миграции)
- `docs` — спецификации отдельных подсистем

## Основные команды

```bash
npm run dev
npm run build
npm run lint
npm run import:japantravel-events
npm run maintain:japantravel-events
npm run report:japantravel-recurring
```

`npm run lint` вызывает `eslint .` напрямую (в Next.js 16 команда `next lint` убрана).

## Data imports

### Japan Travel events pipeline

This repo now treats the Japan Travel feed as a maintained Airtable pipeline, not a one-off scrape.

Canonical storage stays the same:

- core resource fields → `Resources`
- event-specific fields → `Resource Event Details`

The intake entry point remains:

```bash
npm run import:japantravel-events -- <command?> [flags]
```

If no subcommand is given, it runs the importer.

### Operating model

1. **Import / rerun**
   - crawl `https://en.japantravel.com/events`
   - evaluate each event with deterministic intake scoring
   - only `import` decisions are written to Airtable
   - `review` and `skip` stay report-only for manual inspection
2. **Cleanup ended events**
   - scan existing Japan Travel Airtable resources
   - archive ended events out of the live layer when explicitly run with `--write`
   - no destructive delete is performed by this maintenance layer
3. **Recurring candidate review**
   - scan ended Japan Travel events already in Airtable
   - report conservative recurring/seasonal candidates so they can be re-reviewed on the next cycle

The public events listing now only shows resources with:

- `Status = active`
- `Lifecycle != ended`

So archived/ended Airtable records stop polluting the live site.

### Importer commands

Dry run (default):

```bash
npm run import:japantravel-events -- --pages 1 --limit 5 --dry-run
```

Real upsert write:

```bash
set -a
source .env.local
set +a
npm run import:japantravel-events -- --pages 3 --limit 40 --future-days 240 --past-grace-days 7 --write
```

Useful importer flags:

- `--pages <n>`: crawl paginated index pages (`?type=event&p=N`)
- `--limit <n>`: cap processed items
- `--include-ended`: keep already-ended source events in the report layer
- `--delay-ms <n>`: polite delay between requests
- `--future-days <n>`: override intake horizon for rerun window control
- `--past-grace-days <n>`: override how long recently ended events remain in-window for review/import consideration

Importer notes:

- stable identity is the Japan Travel source URL (`Source Key`) with deterministic `Resource ID` format `evt-japantravel-<sourceId>`
- `Source URL` is persisted on `Resource Event Details`
- `Last Seeded At` is refreshed on write so reruns leave an Airtable audit trail
- incremental scans should start from page 1 every run and stop when the source is exhausted, the page/item limit is hit, or the importer reaches the known horizon (2 fully-known pages in a row)
- no production writes go through local JSON files

### Maintenance commands

Load Airtable credentials first:

```bash
set -a
source .env.local
set +a
```

#### Bimonthly rerun

Safe dry run:

```bash
npm run import:japantravel-events -- --pages 3 --limit 40 --future-days 240 --past-grace-days 7 --dry-run
```

Write run:

```bash
npm run import:japantravel-events -- --pages 3 --limit 40 --future-days 240 --past-grace-days 7 --write
```

This keeps the importer focused on an explicit forward window while allowing a short grace period for just-finished events.

#### Ended-event cleanup / deactivation

Preview what would be removed from the live layer:

```bash
npm run import:japantravel-events -- cleanup-ended --ended-before-days 14 --dry-run
```

Apply cleanup:

```bash
npm run import:japantravel-events -- cleanup-ended --ended-before-days 14 --write
```

Cleanup behavior:

- **archives** matching `Resources` rows by setting `Status = archived`
- keeps `Resource Event Details` rows in place
- ensures event `Lifecycle = ended`
- **does not delete records**

That means cleanup is reversible from Airtable/admin and is safe by default.

#### Recurring / seasonal candidate report

All statuses:

```bash
npm run import:japantravel-events -- report-recurring --status all
```

Only archived candidates:

```bash
npm run import:japantravel-events -- report-recurring --status archived
```

Recurring candidates are identified conservatively from already-ended Japan Travel resources when either:

- the copy contains an explicit recurring phrase such as `annual`, `annually`, `yearly`, `every year`, or
- the event has a seasonal keyword **and** an event-type keyword **and** a bounded duration (45 days or less)

The report returns reason codes plus a suggested review window (`suggestedReviewFrom` / `suggestedReviewUntil`) for reseeding on the next cycle.

### Phase 1 intake scoring rules

The Japan Travel importer runs a deterministic intake evaluator before any write. Goal: route-relevant traveler signal > completeness.

Decision buckets:

- `import`: strong enough for Phase 1 auto-import
- `review`: plausible event, but not strong/clean enough for automatic import
- `skip`: clearly out of window or mostly noise for traveler relevance

Current scoring rules:

#### Positive signals

- `+1` event is inside the active intake window
  - default: not already ended beyond a short grace period
  - default: not more than ~12 months ahead
  - both are overrideable by importer flags for scheduled reruns
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

- `-5` outside intake window
  - too far in the past / future for the configured rerun window
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
