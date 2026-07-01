# Multi-agent collaboration workflow

This document defines how ChatGPT, Claude Code, Open Claw, and human maintainers should collaborate on JumboInJapan.

## Roles

### Human product owner

Owns:

- Business direction.
- Final product voice.
- Approval of public copy, pricing/offer changes, and strategic route/service positioning.
- Approval of irreversible data operations.

### Claude Code

Best used for:

- Implementation.
- Refactoring.
- Component work.
- Script changes.
- Test/build fixes.
- Turning a scoped instruction into a PR.

Claude Code may propose architecture, but should keep implementation changes small and reviewable.

### Open Claw

Best used for:

- Alternative implementation proposals.
- Local code navigation.
- Design-system or refactoring experiments.
- Independent verification of Claude's assumptions.

Open Claw should not duplicate Claude's work in the same files without a clear handoff.

### ChatGPT architecture auditor

Best used for:

- System analysis.
- Architecture review.
- Product-fit review.
- SEO/LLM discoverability review.
- Hidden dependency and workflow risk analysis.
- Turning vague direction into structured tasks for Claude/Open Claw.

ChatGPT should usually not be the only implementer. Its main value is deciding what should be changed, why, and how to evaluate whether it was done safely.

## Recommended workflow

### 1. Problem framing

Before implementation, create a short task note:

```md
Goal:
- ...

Why it matters:
- ...

Affected areas:
- ...

Constraints:
- ...

Non-goals:
- ...

Expected verification:
- ...
```

### 2. Implementation prompt for Claude/Open Claw

Prompts should include:

- Repository name: `jumboinjapan/jumboinjapan`.
- Exact files or areas to inspect when known.
- What not to change.
- Expected output: branch, PR, patch, or explanation.
- Required checks.

Example:

```md
You are working in `jumboinjapan/jumboinjapan`.

Task:
Improve <specific area> without changing <protected area>.

Context:
- JumboInJapan is a Russian-language private-guide site for Japan.
- Preserve personal guide positioning.
- Do not turn copy into a generic travel portal tone.

Files likely involved:
- ...

Constraints:
- Keep the PR small.
- Do not touch Airtable/import scripts unless necessary.
- Preserve redirects and canonical URLs.

Verification:
- Run `npm run lint` if available.
- Run `npm run build`.
- Summarize manual checks.
```

### 3. Implementation report from Claude/Open Claw

Every implementation handoff should include:

```md
Changed files:
- ...

Summary:
- ...

Important decisions:
- ...

Risks / uncertainty:
- ...

Commands run:
- ...

Not run:
- ...

Suggested reviewer focus:
- ...
```

### 4. Architecture audit

Use `docs/architecture-review-template.md`.

The auditor should focus on:

- Product fit.
- Boundaries.
- Data safety.
- SEO/schema/canonical impact.
- UX consistency.
- Build/dependency risk.
- Whether the PR should be split.

### 5. Fix loop

When issues are found:

- Fix one concern at a time if possible.
- Do not expand the PR unless the concern is directly related.
- After each fix, provide a compact delta report.

Recommended delta report:

```md
Fix applied:
- ...

Files changed:
- ...

Verification:
- ...

Remaining known issues:
- ...
```

## PR sizing rules

Good PR:

- One clear goal.
- Small number of files.
- Easy review story.
- Clear test/build evidence.
- Product impact explained.

Risky PR:

- Changes route structure, copy, schema, components, imports, and dependencies at once.
- Introduces new state names without documenting lifecycle.
- Adds data writes without dry-run protection.
- Changes public positioning without product owner approval.
- Removes redirects or canonical URLs without explanation.

## Conflict avoidance

When multiple agents work in parallel:

- Assign non-overlapping areas.
- Avoid simultaneous edits to `src/app/page.tsx`, `next.config.ts`, importer scripts, and shared layout/components.
- Prefer one branch per task.
- Rebase or restart from latest `main` before implementation if another related PR merged.

## Protected areas

Treat these as high-risk:

- `next.config.ts` redirects and `withWorkflow` wrapper.
- Global metadata and structured data in `src/app/layout.tsx`.
- Homepage offer and CTA structure in `src/app/page.tsx`.
- `scripts/import-japantravel-events.mjs`.
- `src/lib/japantravel-*`.
- Airtable field names, state/lifecycle values, and resource IDs.
- Sitemap/canonical behavior.

## Decision log recommendation

For future architectural decisions, add small ADR-style files under `docs/decisions/`:

```md
# ADR: <decision title>

Date: YYYY-MM-DD
Status: proposed / accepted / superseded

## Context

## Decision

## Consequences

## Follow-up
```

Use ADRs for:

- URL strategy.
- Airtable schema changes.
- Importer scoring model changes.
- SEO/schema strategy.
- Major design-system decisions.
- Dependency upgrades that affect architecture.
