# CLAUDE-CODE.md

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

If TypeScript checking exists separately, run it. If it does not exist, do not invent a command; mention that no separate typecheck script is defined.

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

## 11. Collaboration with ChatGPT architecture auditor

ChatGPT may review Claude's work as a systems analyst / architecture auditor.

When handing off to ChatGPT, Claude should provide:

- branch or PR link,
- changed files,
- implementation summary,
- commands run,
- known uncertainties,
- areas where architecture review is requested.

ChatGPT's review should focus on:

- product fit,
- architecture boundaries,
- data safety,
- SEO/schema/canonical risks,
- UX consistency,
- verification quality.

Claude should then fix concrete findings one by one and report the delta.

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

## 13. Known audit points in this repo

When touching related areas, pay attention to:

- Next dependency and `eslint-config-next` version alignment.
- Whether `npm run lint` is compatible with the installed Next version.
- Structured data consistency between global layout and page-level schema.
- Redirect coverage for legacy `/from-tokyo/...` paths.
- Importer decision names and README/docs consistency.
- Airtable lifecycle semantics: active vs archived vs ended.
- Whether public event/resource pages hide archived or ended records correctly.

## 14. Definition of done

A task is done when:

- the requested behavior is implemented,
- the change is scoped and understandable,
- relevant verification was run or honestly explained,
- public copy/product positioning is preserved,
- data writes remain safe,
- docs are updated when behavior changes,
- remaining risks are explicitly listed.
