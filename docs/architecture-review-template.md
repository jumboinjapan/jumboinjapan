# Architecture review template

Use this template when reviewing JumboInJapan pull requests, Claude Code outputs, Open Claw changes, or manual implementation plans.

Copy the relevant sections into the PR review or task response.

---

## 1. Review header

```md
# Architecture review: <PR or task name>

Date: YYYY-MM-DD
Reviewer: ChatGPT / Claude / Open Claw / human
Repository: jumboinjapan/jumboinjapan
Branch or PR: <branch or PR link>
Verdict: Approve / Approve with follow-up / Request changes / Needs product decision
```

## 2. Scope understood

```md
## Scope understood

This change appears to affect:

- [ ] Public page rendering
- [ ] Copy / product positioning
- [ ] SEO metadata / schema / sitemap
- [ ] Routing / redirects / canonical URLs
- [ ] Components / design system
- [ ] Event import pipeline
- [ ] Airtable read/write behavior
- [ ] Dependency / build configuration
- [ ] Docs / developer workflow

Intended goal:
- ...

Non-goals / out of scope:
- ...
```

## 3. Product-fit check

```md
## Product-fit check

Does the change preserve JumboInJapan as a personal private-guide service?

- [ ] Yes
- [ ] Mostly, with notes
- [ ] No / unclear

Notes:
- ...

Risks:
- ...
```

Questions to consider:

- Does this still sound like Eduard / JumboInJapan rather than a generic travel portal?
- Does the page explain why a private guide or planner matters?
- Is the route/service logic concrete enough for real travelers?
- Is SEO copy still human-readable?

## 4. Architecture findings

```md
## Architecture findings

### Finding 1

Severity: blocker / high / medium / low
Area: routing / data / SEO / UI / dependency / content / operations

Finding:
- ...

Why it matters:
- ...

Suggested fix:
- ...

Owner:
- Claude Code / Open Claw / human / follow-up
```

Repeat for each finding.

## 5. Data pipeline checklist

Use when any `scripts/import-*`, `src/lib/japantravel-*`, Airtable, resource lifecycle, or event page logic changes.

```md
## Data pipeline checklist

- [ ] Dry-run remains default.
- [ ] Writes require explicit `--write` or equivalent intent.
- [ ] Stable source identity is preserved.
- [ ] Duplicate handling remains deterministic.
- [ ] Ended/archived lifecycle is preserved.
- [ ] No destructive delete without explicit product approval.
- [ ] Partial failure behavior is acceptable or documented.
- [ ] Scoring/ranking changes include examples.
- [ ] Report/review buckets remain understandable to a human.
- [ ] Airtable field changes include migration/compatibility notes.

Notes:
- ...
```

## 6. SEO and structured data checklist

```md
## SEO / schema checklist

- [ ] Title is page-specific and useful.
- [ ] Description is page-specific and not generic filler.
- [ ] Canonical URL is correct.
- [ ] OpenGraph image exists and matches page intent.
- [ ] H1 matches page intent.
- [ ] Schema.org type matches the real page/entity.
- [ ] Schema claims are supported by visible content.
- [ ] Redirects protect removed or renamed URLs.
- [ ] Russian-language search intent is preserved.
- [ ] Content is understandable to LLMs without relying on images only.

Notes:
- ...
```

## 7. UX and design checklist

```md
## UX / design checklist

- [ ] Mobile layout checked.
- [ ] Desktop layout checked.
- [ ] CTA hierarchy is clear.
- [ ] Visual rhythm matches nearby pages.
- [ ] Images have meaningful alt text.
- [ ] No decorative effect harms readability.
- [ ] Navigation remains understandable.
- [ ] Accessibility basics are preserved.

Notes:
- ...
```

## 8. Dependency / build checklist

```md
## Dependency / build checklist

- [ ] No unnecessary dependency added.
- [ ] Next / React / ESLint / Tailwind versions remain compatible.
- [ ] Build command checked.
- [ ] Lint command checked or known issue documented.
- [ ] Typecheck checked or known issue documented.
- [ ] Vercel/runtime assumptions are clear.
- [ ] No secret-dependent static rendering path introduced.

Commands reviewed:

```bash
npm run lint
npm run build
# add other commands actually run
```

Notes:
- ...
```

## 9. Final recommendation

```md
## Final recommendation

Verdict:
- Approve / Approve with follow-up / Request changes / Needs product decision

Before merge:
- ...

Follow-up after merge:
- ...
```

## 10. Compact review format

Use this when a full audit is too heavy:

```md
Verdict: <...>

Main risk:
- ...

Must fix:
- ...

Should fix later:
- ...

Verification:
- ...
```
