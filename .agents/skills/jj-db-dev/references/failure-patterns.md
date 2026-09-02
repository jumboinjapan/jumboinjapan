# Failure patterns observed in JJ data work

Evidence baseline: repository commit `1a2262d`. Re-check Git history before extending this file. Commit references are evidence anchors, not current-state guarantees.

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

## 13. An intermediate success message was mistaken for persisted state

Evidence: documentation correction cycle preceding `c48966c`.

- Failure: a script printed success after two in-memory replacements, then a third replacement threw before the single final write. The report claimed both earlier changes, although neither existed on disk.
- Root cause: process narration was treated as a postcondition, and the target file was not re-read before reporting.
- Guard: make writes explicit and bounded; after automation, re-read the persisted artifact, inspect the diff, and check exact required assertions. For Git transitions, verify the index, commit, and remote ref with Git rather than command narration.

## 14. An artifact boundary was checked one stage at a time

Evidence: correction cycle completed in `a63a1d2`.

- Failure: lexical containment allowed writes through symlinks, case-folded extensions admitted files the cleaner did not discover, an occupied path failed only after expensive collection, and `mtime` was treated as equivalent to an embedded expiry.
- Root cause: acceptance, physical writing, rediscovery, expiry, and deletion were reviewed as separate helpers instead of one lifecycle; a path string was mistaken for a physical location.
- Guard: require set equality between accepted and discoverable artifacts; test root, existing parents, and leaf independently; preflight known failures before I/O while retaining a race-safe final write; delete only from the authoritative retention signal.

## 15. A deterministic digest accepted ambiguous runtime state

Evidence: correction cycle completed in `a63a1d2`.

- Failure: canonical serialization ignored hidden or symbolic properties, sparse and non-canonical array shapes could collapse to the same bytes, code identity was checked too late or only once, and partially completed portal work could approach plan assembly.
- Root cause: the digest was reviewed as a hashing helper rather than the authorization boundary for a reproducible execution plan.
- Guard: define and domain-separate exact byte streams; reject ambiguous JavaScript and UTF-16 representations before reading them; verify clean code identity before effects and again before persistence; attach only fully completed units and compare selected versus completed identities as sets.

## 16. Validation checked a projection, not the represented authority

Evidence: final guards and regressions in `845eb7f`, `c1e4972`, `e18d6d7`, and `3fc1223`.

- Failure: hidden, symbolic, or accessor input disappeared before a builder signed its projection; percent escapes represented forbidden controls or path structure after decoding; inherited property names selected version rules; an exported `RegExp` could be recompiled; and a fragment authorized for one provider profile could approach a plan for another.
- Root cause: each validator proved a convenient intermediate representation while authority lived in the complete raw input, decoded meaning, immutable policy, and parent-child binding.
- Guard: validate the complete raw boundary before projection or destructuring; decode strictly and reapply semantic and structural constraints; use own-key or `Map` dispatch; expose validators as functions or deeply immutable data; and bind every child artifact to the same authority identity as its parent before signing.

## 17. The audit and the runtime used different bytes

Evidence: correction cycle completed in `1a2262d`.

- Failure: one side reviewed an older delivered copy and reported 82 mutations while the device already executed a 85-mutation contract.
- Root cause: repository path, HEAD, and persisted file identity were assumed from the handoff instead of bound to the evidence command.
- Guard: resolve the repository root and HEAD at the execution site; after delivery, compare SHA-256 of the critical files and run the assertion on those same bytes.

## 18. The aggregate was stricter than its public child boundary

Evidence: discovery contract corrections completed in `1a2262d`.

- Failure: a standalone order builder and validator accepted source keys and URL families that the containing snapshot rejected later.
- Root cause: the aggregate validator was treated as a repair layer for artifacts already declared valid by a public API.
- Guard: enforce shared policy at the nearest public boundary; test `build → public validate` directly and make the aggregate call that validator instead of copying the rule.

## 19. Version knowledge lived beside the version policy

Evidence: discovery v1/v2 hardening in `1a2262d`.

- Failure: child specs, rejection codes, URL families, and collection rules could drift through parallel tables; version getters also executed caller code.
- Root cause: the version selected a label, not the whole semantics, and validation read a property value before proving it was an own data property.
- Guard: one executable policy owns every versioned decision; mutate every policy field to prove consumption; reject cross-version diff without a migrator; read selectors through own data descriptors.

## 20. Mutation checks targeted a helper instead of the decision

Evidence: Japan Guide link selection and canary acceptance corrections in `1a2262d`.

- Failure: mutations were green against a pure helper or a copied condition while the profiling loop and acceptance module used separate logic.
- Root cause: the test proved the convenient function, not the production consumer whose result governed the outcome.
- Guard: run an unmutated baseline, mutate the real consumer, require exact anchor counts, treat skipped separately, and assert the exact named failure so neighbouring guards cannot hide a missing decision.

## 21. A local verification command silently became a live read

Evidence: live verification after `1a2262d`.

- Failure: `npm run verify` was described as offline because no token was exported in the shell, while several checks loaded `.env.local` automatically and read Airtable.
- Root cause: credential availability was confused with authorization, and effective configuration was not inspected before execution.
- Guard: determine credential-loading behavior before the command; obtain explicit live-read permission when credentials are available; otherwise run fixtures/offline modes and report the skipped full gate without modifying the owner's environment.

## 22. The integrity guard modeled a field the renderer did not use

Evidence: 10e-E2 pre-write audit, 2026-08-25.

- Failure: Route Stops looked protected from empty live text, but the guard read a legacy description field while the page rendered the approved override. Three authorized writes would have created new live failures.
- Root cause: the checker and production consumer derived the same concept from different fields; fixtures disabled the affected branch.
- Guard: trace each integrity rule to the production consumer, use the same field precedence, and execute every publication branch with non-empty fixtures.

## 23. A mutation died because its sandbox was broken

Evidence: 10e-E2 pre-write audit, 2026-08-25.

- Failure: five mutations were initially reported killed because the temporary tree lacked `node_modules`; none reached its intended assertion.
- Root cause: any nonzero exit was treated as a kill.
- Guard: require the unmutated tree to pass in the same environment, provide the same dependencies, and count a kill only when the mutation's named assertion fails.

## 24. Acknowledgement was expanded into production-write authorization

Evidence: 10e-D/10e-E process correction, 2026-08-25.

- Failure: a generic acknowledgement after a question was treated as permission to write live Airtable data.
- Root cause: subject-matter agreement, execution authorization, and scope were collapsed into one conversational signal.
- Guard: present the exact L3 execution card and require an unambiguous reply to that card. During execution, preserve an independently verified prefix and stop the suffix on the first drift; no implicit rollback.

## 25. The request deadline ended at response headers

- Failure: the timeout timer was cleared as soon as `fetch()` resolved with headers, leaving `response.json()` unbounded.
- Root cause: the deadline modeled one network call as two independent events, and the mutation that removed it hung the test instead of failing it.
- Guard: cover the whole operation — headers and body — under one deadline cancelled in `finally`; write the regression as a race against the test's own independent timer. A timeout means the outcome is unknown, never "not applied".

## 26. The write outcome was read from the response

- Failure: the PATCH status code and body were treated as proof that the field changed.
- Root cause: a writer's reply is a claim; in an interrupted batch it cannot separate an applied row from an unapplied one.
- Guard: establish every outcome by independently rereading the affected fields, and reconcile before declaring success.

## 27. An interrupted batch was resumed from its original card

- Failure: a batch killed by the environment after 2 of 20 rows invited a rerun of the same frozen card.
- Root cause: the original card still contains the already-applied rows, so a rerun either rewrites them or hides the divergence.
- Guard: establish the applied prefix by reading the database, then build a separate recovery card for the remaining rows only. Leave the original `.ndjson` journal and card byte-identical, register their digests as stale, forbid the original journal name for the new run, and derive the expected row count from the card instead of hard-coding it. No automatic retry, no automatic rollback.

## 28. Evidence rows were not bound to their source artifact

- Failure: rows proposed for writing carried prose conclusions and a null evidence link, while their evidence actually came from two different immutable artifacts.
- Root cause: the classifier indexed only one artifact and reported the rows as homogeneous.
- Guard: bind every proposed row to its own source — artifact filename, artifact SHA-256, place ID, response SHA-256, evidence type, identity rule and matched value, source URL. Missing or partial binding stops the build. Derive the row's bucket from the anchor the evidence carries, not from the rule used to search for it.

## 29. Verification rewrote the artifact it verified

- Failure: the documented verification command rewrote its own output with a fresh timestamp, so three runs produced three different SHA-256 values.
- Root cause: validation and rebuilding shared one default invocation.
- Guard: validate and print by default; write only under an explicit output flag; derive the timestamp from the source evidence or an explicit value; prove by regression that two builds from identical frozen inputs are byte-identical.

## 30. A host permission prompt was mistaken for owner authorization

Evidence: 10f-K3 final gate, 2026-08-30–31.

- Failure: the owner authorized the exact card from a phone and the writer applied it, but the final gate used a new local command whose host escalation was not preapproved. The mobile client did not surface that local prompt; the task waited almost a day and was incorrectly described as unable to continue without the owner at the Mac.
- Root cause: owner authority and host capability were collapsed into one word, “approval”. Only the writer command had been preflighted; the mandatory post-write gate had not.
- Guard: treat authorization as bound to the card and digest regardless of client device. Before the first effect, preflight the writer and every mandatory post-write command, including narrow host permissions. Wait no more than 60 seconds for a host prompt, then report `hostPermissionPending` and stop waiting. Do not ask for the same card authorization again and do not rerun an applied writer; resume with reconciliation and the gate against the existing journal.

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
