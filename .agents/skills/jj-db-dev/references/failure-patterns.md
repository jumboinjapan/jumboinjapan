# Failure patterns observed in JJ data work

Evidence baseline: repository commit `22392ed`. Re-check Git history before extending this file. Commit references are evidence anchors, not current-state guarantees.

Update this reference only for a recurring mechanism. Keep one-off typos in their regression tests.

## 1. A gate reported doubt but still wrote

Evidence: `7416d39`.

- Failure: `needs_review` became a note on a created POI.
- Root cause: the gate produced information but did not control the terminal outcome.
- Guard: make the policy result authoritative; test that storage and field construction are untouched on every stop outcome.

## 2. The first candidate hid later candidates

Evidence: `671f5f8`.

- Failure: a distant namesake ended duplicate analysis before a nearby candidate was considered.
- Root cause: ranked-first was treated as exhaustive.
- Guard: test multi-candidate orderings and continue after a candidate is refuted.

## 3. One injected dependency changed unrelated behavior

Evidence: `b7ed8a0`.

- Failure: substituting `store` silently disabled independent resolvers and made the report lie about missing credentials.
- Root cause: a dependency doubled as a test-mode flag.
- Guard: inject dependencies independently and assert call counts and propagated results.

## 4. Validation existed after effects or only in TypeScript

Evidence: `87fc140`, `17c1ca5`.

- Failure: invalid batch inputs could be found after earlier rows had progressed; `.mjs` callers bypassed compile-time unions.
- Root cause: validation was local to an item and types were mistaken for runtime enforcement.
- Guard: validate the complete external contract before I/O and test with dependencies that throw on any call.

## 5. Silent repair changed the meaning of bad input

Evidence: `b7ed8a0`, `c48ab52`, `7d8e6ea`, `f371879`.

- Failure: empty run IDs, wrong-shaped names files, and invalid model proposals were replaced, accepted, filtered, or deduplicated into plausible data.
- Root cause: convenience normalization hid the producer defect.
- Guard: reject supplied-invalid data; distinguish absence from corruption; require schema parity.

## 6. Geography was guessed from insufficient context

Evidence: `4dee24a`, `c07e4d0`, `e7a9caa`, `17d0df9`.

- Failure: a bare ward such as `中央区` implied Tokyo, and prefecture/municipality conflicts were resolved by precedence rather than surfaced.
- Root cause: administrative parsing and product routing were collapsed into one guess.
- Guard: parse sources independently, compare them, and route conflicts to review; bind destinations to prefecture–municipality pairs.

## 7. Records disappeared because totals were descriptive, not conserved

Evidence: `c48ab52`, `f371879`.

- Failure: deduplicated rows vanished from the accounting, and early “writable” counts overstated actual writes.
- Root cause: buckets were computed in multiple places and no terminal conservation invariant existed.
- Guard: one terminal tally, exact conservation, and stable-key set equality for equivalent projections.

## 8. Multiple sources of truth drifted

Evidence: `a3f2d61` through `d75172a`.

- Failure: canon, prompt, translations, and Airtable options held different category sets.
- Root cause: each consumer copied policy locally.
- Guard: versioned registry, canonical loader, immutable old versions, digest, and a test proving local lists are absent.

## 9. A test was green without testing the claim

Evidence: `ac0f880`, `164a6be`.

- Failure: a tautological condition passed regardless of registry contents; text checks missed a runtime `ReferenceError` in the non-empty collision branch.
- Root cause: test shape resembled proof but did not falsify the requirement.
- Guard: exhaustive cases, non-empty behavioral fixtures, and mutation checks that make the test fail.

## 10. Testability opened a production bypass

Evidence: `2c4395a`, `78683f9`.

- Failure: a public arbitrary-registry function and caller-controlled classification source bypassed frozen policy and owner authority.
- Root cause: the test seam had more authority than production callers should possess.
- Guard: test through narrow public boundaries; share private pure functions; hard-code provenance at trusted boundaries.

## 11. Derived state was named or copied too early

Evidence: `f371879`, `164a6be`.

- Failure: `poiWritable` existed before geography and deduplication; counters were written twice; stale identifiers survived a refactor.
- Root cause: intermediate and terminal semantics were conflated and derived values had multiple owners.
- Guard: honest state names, a single derivation function, one final tally, stale-name scan plus branch execution.

## 12. Documentation inferred guarantees from surface form

Evidence: `22392ed`.

- Failure: one call to `ingestPoiBatch()` was documented as atomic even though it loops over individual writes without rollback.
- Root cause: the monitor verified the call site and narrative, not the implementation and failure path.
- Guard: trace control flow to the storage boundary; require the actual transaction or compensation mechanism before claiming atomicity.

## Monitoring lessons

The monitoring process itself failed when it:

- reviewed the author's summary before reading the diff;
- accepted green tests without asking what mutation would make them red;
- ran after each commit instead of before the risky commit;
- checked a named function but not the branch with realistic non-empty data;
- focused on local correctness while counters, reports, and documentation drifted downstream;
- treated a successful process exit as proof of successful data mutation;
- allowed many corrective commits without pausing to restate the contract and re-audit the whole change set.

Counter these with claim–evidence–counterexample review, risk checkpoints, raw-diff cold review, and end-to-end read-only artifacts.
