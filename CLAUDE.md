# JumboInJapan agent instructions

This repository is the public website for **JumboInJapan**: a Russian-language private guide / travel-planning site for Japan. The current implementation is a Next.js App Router project with a maintained Japan Travel event-import pipeline backed by Airtable.

These instructions are shared by Claude Code, Open Claw, ChatGPT, and future coding agents.

## Product direction

JumboInJapan should feel like a personal, trustworthy guide service, not a generic travel portal.

Primary audience:

- Russian-speaking travelers planning Japan trips.
- People who need context, logistics, route design, and practical local interpretation.
- Travelers who may compare private guiding, itinerary planning, day trips from Tokyo, and multi-day travel support.

Product tone:

- Human, calm, knowledgeable.
- No exaggerated luxury language unless the specific page requires it.
- Prefer concrete route logic, seasonal context, logistics, and personal guidance.
- Avoid random SEO stuffing, generic travel clichés, and overpromising.

## Current technical baseline

Known architecture at the time this file was added:

- Next.js App Router.
- React 19.
- Next 16 dependency in `package.json`, with `eslint-config-next` still pinned to a 15.x package.
- Tailwind CSS 4.
- Vercel Analytics.
- `workflow/next` wrapper in `next.config.ts`.
- Static and semi-static Russian content under `src/app`, `src/data`, and related components.
- Japan Travel event ingestion through `scripts/import-japantravel-events.mjs` and `src/lib/japantravel-*` modules.
- Airtable is the canonical storage layer for imported travel resources and event details.

## Working rules for all agents

1. **Do not silently change product positioning.**
   - Any change to homepage, route pages, SEO metadata, schema, navigation, or contact flow must preserve the private-guide positioning.
   - When changing copy, preserve a personal guide voice rather than converting the site into an impersonal travel magazine.

2. **Treat Airtable/event import logic as data infrastructure, not page copy.**
   - Importer changes must be reviewed for data quality, idempotency, lifecycle behavior, and rollback safety.
   - Dry-run behavior must remain the default for import/maintenance scripts.
   - Production writes must require explicit `--write` style intent.

3. **Keep lifecycle semantics explicit.**
   - `active`, `archived`, `ended`, `review`, `reject`, `duplicate`, and similar states must not be casually renamed.
   - Any schema/state change must include a migration or compatibility note.

4. **Prefer small, reviewable PRs.**
   - One conceptual change per PR.
   - Do not bundle design, copy, dependency, importer, and routing changes together unless the task explicitly requires it.

5. **Every non-trivial PR should include verification.**
   - At minimum: lint/typecheck/build when available.
   - Importer changes: include at least one dry-run command and summarize observed counts or expected behavior.
   - SEO/schema changes: explain affected URLs and structured data types.

6. **Never commit secrets or local credentials.**
   - `.env.local` is local only.
   - Airtable credentials, Vercel tokens, analytics credentials, and private API keys must never appear in code, docs, tests, logs, or examples.

7. **Preserve redirects and canonical URLs unless explicitly changing URL strategy.**
   - Redirect changes can affect search traffic and existing external links.
   - Any route removal must include a redirect or a clear reason.

8. **Use English for technical docs and commit messages.**
   - Russian is appropriate for public-facing copy because the site is Russian-language.
   - Internal engineering documentation should remain English for agent/tool compatibility.

## Collaboration model

Claude Code and Open Claw may act as programmers and architecture co-designers. ChatGPT is used primarily as a systems analyst and architecture auditor.

Expected handoff pattern:

1. Claude/Open Claw proposes or implements a change.
2. ChatGPT audits architecture, product fit, risks, hidden dependencies, and verification quality.
3. Claude/Open Claw applies focused fixes.
4. ChatGPT reviews the diff again before merge.

Use `docs/architecture-auditor.md` for the audit role definition and `docs/architecture-review-template.md` for repeatable reviews.
