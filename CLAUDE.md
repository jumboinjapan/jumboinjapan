# CLAUDE.md

_Last reviewed: 2026-07-10 (Tour Constructor / Route Stops admin session; handoff для продолжающих агентов — `docs/handoff-2026-07-10.md`, читать первым — он ссылается на `docs/handoff-2026-07-06.md` вторым)_

This file is the primary operating guide for **Claude Code** when working in `jumboinjapan/jumboinjapan`.

Claude's role in this repository is **implementation-heavy engineering**: inspect the codebase, fix bugs, refactor safely, implement scoped features, run verification, and report clearly what changed. Architecture review may happen, but the default expectation is that Claude can work directly with code.

## 1. Project identity

JumboInJapan is a Russian-language private guide and Japan travel-planning website.

The product should feel like:

- a personal guide service,
- calm and competent,
- route/logistics aware,
- grounded in local Japan context,
- useful for real travelers, not just SEO traffic.

Do not turn the site into a generic travel blog, city directory, or anonymous travel portal.

## 2. Current architecture baseline

Treat this as the current working model unless the code proves otherwise.

- Framework: Next.js App Router.
- UI: React, Tailwind CSS 4, componentized layout under `src/components`.
- Content: mostly Russian public-facing copy in `src/app`, `src/data`, and page-level modules.
- SEO: Next metadata, canonical URLs, OpenGraph, schema.org JSON-LD.
- Analytics: Vercel Analytics.
- Config: `next.config.ts` includes redirects and `withWorkflow(nextConfig)`.
- Data pipeline: Japan Travel event ingestion through `scripts/import-japantravel-events.mjs` and `src/lib/japantravel-*` modules.
- External storage: Airtable is the canonical storage layer for imported resources/events.

Important package scripts:

```bash
npm run dev
npm run build
npm run lint
npm run import:japantravel-events
npm run maintain:japantravel-events
npm run report:japantravel-recurring
```

Note: `npm run lint` runs `eslint .` directly (Next.js 16 removed the `next lint` subcommand — if you see `Invalid project directory provided`, that's the old command resurfacing; `eslint.config.mjs` ignores `.next/**`, `next-env.d.ts`, `node_modules/**`, `public/**`).

## 3. Claude's primary responsibilities

Claude should be able to:

1. Fix TypeScript, React, Next.js, build, routing, metadata, and styling errors.
2. Implement scoped UI/page/component changes.
3. Refactor duplicated or fragile code without changing product behavior accidentally.
4. Improve importer/data-pipeline code only with explicit attention to dry-run/write safety.
5. Add tests or verification scripts when useful and proportional.
6. Update documentation when architecture, commands, or operational behavior changes.
7. Produce small, reviewable PRs or patches.

Claude should not behave only as a commentator. If the task is implementation-oriented, inspect the code, make the change, and verify it.

## 4. First steps for any task

Before editing:

1. Read the user request carefully.
2. Identify the affected area:
   - public page/content,
   - component/design system,
   - route/metadata/SEO,
   - import/data pipeline,
   - build/dependencies,
   - docs/workflow.
3. Inspect the relevant files before proposing a fix.
4. Check nearby patterns and reuse them.
5. Keep the change as small as possible.

Do not start by rewriting large files or introducing new abstractions unless the task clearly requires it.

## 5. Protected areas and extra caution

These areas can break production behavior or search visibility. Treat them as high-risk.

### Routing and deployment

- `next.config.ts`
- redirects
- canonical URLs
- sitemap-related files
- domain redirects between `www.jumboinjapan.com` and `jumboinjapan.com`

Rules:

- Do not remove redirects without a replacement or explicit approval.
- Do not change canonical strategy casually.
- If route paths change, add redirects and document affected URLs.

### Global app shell and SEO

- `src/app/layout.tsx`
- global metadata
- schema.org JSON-LD
- `AppShell`, header, footer, navigation

Rules:

- Schema must match visible page content.
- Metadata must support Russian-language search intent.
- Do not duplicate conflicting schema across pages.

### Homepage and core offer pages

- `src/app/page.tsx`
- `src/app/city-tour/**`
- `src/app/intercity/**`
- `src/app/multi-day/**`
- `src/app/contact/**`

Rules:

- Preserve personal private-guide positioning.
- Keep CTAs clear but not aggressive.
- Do not replace human copy with generic SEO filler.

### Japan Travel / Airtable pipeline

- `scripts/import-japantravel-events.mjs`
- `src/lib/japantravel-events.ts`
- `src/lib/japantravel-event-intake.ts`
- `src/lib/japantravel-event-maintenance.ts`
- Airtable field/state/resource mapping modules

Rules:

- Dry-run must remain the default.
- Writes must require explicit `--write` or equivalent intent.
- Do not introduce destructive delete unless explicitly requested and documented.
- Preserve deterministic IDs and duplicate handling.
- Lifecycle changes must be documented.
- If scoring changes, include examples and rationale.

## 6. Coding rules

### General

- Prefer TypeScript clarity over cleverness.
- Reuse existing utilities/components before adding new ones.
- Keep page-level content readable.
- Avoid unnecessary dependencies.
- Avoid broad formatting churn.
- Do not rename public states, fields, or routes unless required.
- Do not commit secrets, tokens, `.env.local`, logs with credentials, or private API output.

### React / Next.js

- Prefer server components unless client behavior is required.
- Add `'use client'` only when necessary.
- Keep metadata close to the page when page-specific.
- Use `next/image` for local/public images where appropriate.
- Keep alt text meaningful for real users and SEO.
- Do not use `dangerouslySetInnerHTML` except for controlled JSON-LD or already-established patterns.

### Styling

- Use existing Tailwind/CSS variable patterns.
- Preserve visual rhythm between nearby pages.
- Check mobile behavior for any layout change.
- Avoid decorative effects that reduce readability.
- Do not introduce a new design system inside one task.

### Data/import scripts

- Keep command-line behavior explicit and predictable.
- Validate arguments.
- Log enough information for operators to understand decisions.
- Make failures actionable.
- Prefer idempotent writes.
- Keep reports human-readable.

## 7. Verification expectations

Run the strongest relevant verification available for the change.

For most code changes:

```bash
npm run lint
npm run build
```

There is no dedicated `npm run typecheck` script. Use `npx tsc --noEmit` directly — it works fine against the existing `tsconfig.json` and should be run whenever `.ts`/`.tsx` files change.

For UI/page changes:

- Run build.
- Manually inspect affected routes if a browser/dev server is available.
- Check mobile and desktop layout when practical.
- Confirm metadata/canonical/schema changes if touched.

For importer/pipeline changes:

Run at least a dry run, for example:

```bash
npm run import:japantravel-events -- --pages 1 --limit 5 --dry-run
```

If changing maintenance behavior:

```bash
npm run import:japantravel-events -- cleanup-ended --ended-before-days 14 --dry-run
npm run import:japantravel-events -- report-recurring --status all
```

Never perform production writes unless the human explicitly requested it and the required environment is intentionally loaded.

## 8. How to report work

Every implementation response should include:

```md
Summary:
- ...

Changed files:
- ...

Verification:
- Ran: ...
- Not run: ...

Risks / notes:
- ...

Suggested next step:
- ...
```

Be honest. If a command failed, include the failure and what it likely means. Do not claim a check passed if it was not run.

## 9. PR / branch discipline

- Prefer one branch per task.
- Prefer one conceptual change per PR.
- Do not mix dependency upgrades, redesign, copy rewrite, routing, and importer changes unless the task explicitly requires it.
- If a task grows, stop and split into follow-up tasks.
- Keep commits meaningful and scoped.

Good commit examples:

```bash
fix: correct contact page metadata
fix: preserve dry-run behavior in event cleanup
refactor: extract route card component
style: improve mobile spacing on city tour page
docs: document Japan Travel importer workflow
```

Avoid vague commits like:

```bash
update stuff
fix bugs
changes
wip
```

## 10. Architecture escalation rules

Stop and ask for architecture/product confirmation before:

- changing URL strategy,
- changing Airtable schema or field names,
- changing event lifecycle state semantics,
- adding authentication/admin behavior,
- adding a new external service,
- replacing the design system,
- changing the site's core positioning,
- adding paid booking/payment flows,
- making irreversible data operations.

If the task is urgent and no confirmation is available, implement the safest reversible version and document the unresolved decision.

## 11. Collaboration model — three roles

This project uses three distinct AI roles that work together:

### GPT-5.5 — architecture review

GPT-5.5 (running as OpenClaw agents: Verter, Johny, Mason, Porter, and others) reviews architecture decisions, design system choices, and systemic risks.

When handing off to GPT-5.5 for architecture review, Claude should provide:

- branch or PR link,
- changed files,
- implementation summary,
- commands run and their output,
- known uncertainties,
- specific areas where architecture review is requested.

GPT-5.5 architecture review focuses on:

- product fit and positioning,
- architecture boundaries and systemic risk,
- data safety and pipeline integrity,
- SEO/schema/canonical risks,
- UX and design system consistency,
- verification quality.

Claude should fix concrete findings one by one and report the delta.

### Claude — implementation and deep audit

Claude (this agent) handles:

- heavy code implementation: bug fixes, refactors, feature shipping,
- deep audits of specific subsystems (importer pipeline, data integrity, schema),
- TypeScript/build errors, routing, metadata, pipeline logic,
- writing tests and verification scripts,
- producing reviewable PRs with clear changelogs.

### LLoyd (claude-sonnet-5, OpenClaw main agent) — orchestration

LLoyd manages task routing, backlog, agent coordination, and system-level context. LLoyd knows the full operational state of the project: active tasks, open bugs, deployment status, calendar, and team.

When Claude needs project context (what's in backlog, what's blocked, what's already in progress), it can request a summary from LLoyd via the OpenClaw inter-agent system.

LLoyd runs natively on Eduard's machine with a real local working copy and git push credentials. Claude in a Cowork session does not — see below.

### Claude in Cowork mode — environment constraints (learned 2026-07-01)

A Cowork/Claude Desktop session is an isolated sandbox with **no access to this repo by default**. Before it can do anything here, one of two things has to happen:

- Eduard connects the local folder (`/Users/jumbo/Projects/jumboinjapan`) to the session, giving Read/Write/Edit/Grep/Glob access plus a bash mount — this is the same working copy Lloyd uses, so both agents can end up editing it in the same window.
- Or the GitHub connector is authorized for that session, giving API-based repo access instead of a filesystem mount.

Even with the folder connected, **Cowork has no git push credentials** (`git push` fails with `could not read Username for 'https://github.com'`). Cowork can commit locally, but Eduard or Lloyd has to run the actual `git push` from the native machine.

Other quirks specific to the connected-folder mount:

- Stale `.git/index.lock` or `.git/objects/maintenance.lock` files can block git commands with permission errors that look like a concurrency problem but are usually just leftover locks the mount won't let a normal `rm` delete. If a git command fails with `Operation not permitted` on a `.lock` file, request delete permission for that specific file and remove it before retrying.
- Interactive `git rebase` can fail on this mount (missing `.git/rebase-merge/message` mid-rebase, a write-related quirk of the mount, not a real conflict). Prefer `git merge origin/main --no-edit` over rebase when reconciling a diverged branch here — it's a single atomic operation and doesn't depend on writing per-commit state files.
- Before starting work, always check `git status --short --branch` for ahead/behind counts — Lloyd may be actively committing to the same working copy concurrently.

## 12. Product copy rules

Public Russian copy should be:

- natural,
- personal,
- calm,
- specific,
- useful for travel decisions.

Avoid:

- generic AI tone,
- overuse of “уникальный”, “незабываемый”, “премиальный” without proof,
- empty luxury language,
- direct imperative pressure,
- keyword stuffing.

Good direction:

- explain why a route makes sense,
- mention logistics and seasonality,
- give context,
- preserve the feeling of a private guide who knows Japan from the inside.

### Транспортная доктрина (фундаментальное бизнес-правило владельца, 2026-07-06)

Любой публичный текст (страницы, FAQ, метаданные) обязан подавать передвижение так:

- **Внутри города** (Токио, Киото): общественный транспорт уместен, может быть частью опыта.
- **Большие переезды между регионами**: синкансэны и суперэкспрессы — да, комплиментарно, обязательная часть тура и логистики.
- **Вне мегаполисов / в глубинке**: автомобиль с гидом — основной формат (двери-в-двери от отеля, свой темп, вещи в багажнике, остановки по пути).
- **VIP**: лимузин-сервис — упоминать как опцию, когда уместно.
- **Локальные электрички/автобусы между городами**: только справочно, с маркером «для самостоятельных поездок». Никогда — как формат тура с гидом для индивидуалов (так ездят разве что сборные группы).

Нарушение = переписывание. Эталон правильной подачи — FAQ Хаконэ (Airtable Routes.FAQ, живой на /intercity/hakone). Расширенная версия с примерами «было → стало» живёт в Cowork-скилле `jumboinjapan-faq-writer`; суть продублирована здесь, потому что Claude Code скиллы Cowork не видит.

## 13. Known audit points in this repo

Resolved 2026-07-01:

- ~~Next dependency and `eslint-config-next` version alignment~~ — `npm run lint` now calls `eslint .` directly; `eslint-config-next` (15.3.3) still trails `next` (^16.2.0), works fine in practice but bump it if it ever breaks.
- ~~Whether `npm run lint` is compatible with the installed Next version~~ — fixed, see above.
- ~~Orphaned files~~ — removed: duplicate `mockup-intercity-hero.html`, unused `src/data/batch-2..5-input.json`, dead `storage/admin-seo-llm-drafts.json`, 11 unreferenced images in `public/`, one-off migration scripts (`scripts/enrich-restaurants.js`, `fix-prices.js`, `find-trip-hotel-ids.js`, `scrape-restaurants.js`, `src/data/update-batch2..5.js`, `update-descriptions.js`). `public/preview/*.html` design mockups relocated to `docs/design-previews/`.

Still open, pay attention when touching related areas:

- Structured data consistency between global layout and page-level schema.
- Redirect coverage for legacy `/from-tokyo/...` paths.
- Importer decision names and README/docs consistency.
- Airtable lifecycle semantics: active vs archived vs ended.
- Whether public event/resource pages hide archived or ended records correctly.
- ~~`docs/multi-day-route-builder-spec.md` staleness~~ — reconciled 2026-07-01 (independent day type, `/admin/multi-day` shipped status).
- ~~Remaining lint debt (exhaustive-deps × 5, unused eslint-disable)~~ — resolved 2026-07-03: `npx eslint .` is clean except one warning inside the auto-generated, gitignored `.well-known/workflow/v1/flow/route.js`.
- **TODO: split `src/lib/japantravel-events.ts` (1467 lines) into smaller modules** (types/text-geo-dedupe utilities/HTML-JSON-LD parsing/Airtable I/O/orchestrator — see natural seams via `grep -n "^export \(async \)\?function\|^function "`). Network is no longer blocked from Cowork (verified 2026-07-03: `en.japantravel.com` → 200, `api.airtable.com` reachable), but see the next bullet — the dry-run baseline currently returns 0 candidates, so "identical before/after decisions" is not a meaningful refactor check until the index parser is fixed.
- **BROKEN: importer index parsing finds 0 events (found 2026-07-03).** Dry-run (`--pages 1 --limit 5 --dry-run`) runs cleanly — Airtable read OK (366 known IDs), fetch OK, dry-run safety intact — but stops at page 1 with `source-exhausted`. Cause: `en.japantravel.com/events` no longer embeds per-event `Event` JSON-LD in the index page (only a `BreadcrumbList` block); event data now lives in an HTML-escaped hydration payload, and `parseIndexCandidates()` relies solely on `extractEventJsonLd()`. Detail pages still contain `Event` JSON-LD, so `parseDetailPage()` is likely fine. Fix: parse the hydration payload (or the visible event-card markup) on the index page. Not a sandbox artifact — same result with a browser User-Agent.
- ~~Route Builder → live `/multi-day/*` publishing gap~~ — wired up 2026-07-03: fixed a real bug where the publish-status gate checked for a `'Live'` value that never existed in Airtable (the real select option is `'Published'`, so status silently reset to Draft on every read/write); added a Status control to `/admin/multi-day`; added `src/app/multi-day/[slug]/page.tsx` which renders a Route Builder route only when `status === 'Published'`; linked from the `/multi-day` hub. **Verified against live data 2026-07-03** (network to `api.airtable.com` is now open from Cowork): flipped `multi-day/golden-route-7-days` («Золотой Маршрут») to Published in Airtable, dev server rendered `/multi-day/golden-route-7-days` correctly (200, Russian title/canonical/TouristTrip JSON-LD, per-day sections), Draft status correctly 404s both before and after revert; route restored to Draft. Also note: the current live `/multi-day/classic` and `/multi-day/mountain` pages are untouched static content — none of the routes drafted in the builder so far match those slugs, so this doesn't replace them, only adds a way to publish *new* builder-authored routes.

Добавлено 2026-07-06 (сессия GEO/FAQ; детали и указатели — `docs/handoff-2026-07-06.md`):

- **Контентный слой FAQ (главный GEO-рычаг) — каркас готов, контент в работе.** Поле `FAQ` в Routes (`fld5LKJrzDXDUB4C6`, JSON `[{"q":"…","a":"…"}]`) → `RouteFaq` server component (видимый аккордеон + FAQPage JSON-LD из одного массива) на всех 17 маршрутных страницах + шаблоне пакетов. Редактор — `/admin/route-text`, блок «FAQ маршрута». Черновики и статусы — `docs/faq-drafts-batch-1.md`.
- **Кэш-дисциплина при прямых правках Airtable:** записи мимо admin API не сбрасывают кэш сайта (ISR ждёт до часа). Решение: `POST /api/admin/revalidate` (кнопка «Обновить кэш сайта» в Route Texts) или «Сохранить» там же — она активна всегда и тоже сбрасывает кэш.
- Schema: организация теперь `TravelAgency` (было LocalBusiness), `sameAs` начат (`SAME_AS_PROFILES` в `src/lib/schema.ts`) — Instagram есть, слот под Google Business Profile ждёт ссылку владельца.
- robots.ts: явные allow для OAI-SearchBot (поиск ChatGPT) и Bingbot (Copilot); llms.txt синхронизирован с фактами сайта.
- Sitemap не знает о динамических пакетах Б-1 (`intercity/[slug]`, `city-tour/[slug]`, `multi-day/[slug]` со статусом Published) — при следующей работе с sitemap включить.

## 14. Definition of done

A task is done when:

- the requested behavior is implemented,
- the change is scoped and understandable,
- relevant verification was run or honestly explained,
- public copy/product positioning is preserved,
- data writes remain safe,
- docs are updated when behavior changes,
- remaining risks are explicitly listed.
