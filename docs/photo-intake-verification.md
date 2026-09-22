# Photo Intake v1 verification record

2026-09-22, branch `codex/photo-intake`, based on `origin/main`
`3ba4aebf601d31087e57e431db078d2d9c05069c`. All intake changes are isolated from the
owner's active design/data checkout. Live activation remains pending Dropbox OAuth and pilot.

| Claim | Owner / evidence | Counterexample and outcome | Not proven |
|---|---|---|---|
| Whole batch validated before cloud effects | `core.mjs`, `local.mjs`; `npm run test:photo-intake` | Bad versions/unknown fields/changed bytes/malformed image fail with no cloud writes | Arbitrary hostile concurrent changes to the owner's filesystem |
| IDs and byte identities survive retry | `core.mjs`; same suite | Reserved gaps, duplicate bytes, concurrent CAS, upload failure and timeout after commit exercised | Actual Dropbox service behavior until pilot |
| Metadata and completed status require independent reads | `core.mjs`, `airtable.mjs`; same suite | Corrupted readback, metadata failure, schema drift and unknown table-create outcome fail/resume | Actual Airtable write scopes until activation |
| Intake does not publish website assignments | `photo-intake.mjs`, `local.mjs`; export test | Occupied path rejected; export returns `exported-not-published`; existing editorial status preserved | Correct crop/rights or a future deployment |
| Connection does not expose refresh token in output | `oauth.mjs`, `photo-connect.mjs`; OAuth test | PKCE/state and insufficient scope rejection exercised | Real owner grant, callback and token exchange until connection |

The targeted suite passed all 16 tests. Two mutation checks started from passing isolated
baselines: removing reserved-ID protection fails the named reserved-counter test; weakening
prepared-byte verification fails the named whole-batch test. Both mutations were killed by the
expected assertions, not module-load/environment errors. Production source was not mutated.

A read-only plan against the synced, existing archive processed `IMG-000020`: 83 existing assets,
109 variants, zero new assets, one proposed WebP variant. Existing `nextId` 153 would become 154;
no registry/file/database changes were applied. The snapshot plan does not establish a current
cloud revision or reserve that number.

Private evidence is in `tmp/photo-intake/` in the intake checkout: `targeted-final.log`,
`mutation-checks.json`, `archive-dry-run.json`, `cli-plan.json`, `doctor.json`, `verify.log`, `remaining-gates.log`.
`doctor` reached Airtable metadata successfully and reported missing media tables; Dropbox
credentials were absent. Schema creation, live archive intake and deployment were not run.

Full `npm run verify` exited 1 at live `check:poi`: existing route stop
`intercity/enoshima №1`, `POI-001288` (Benzaiten Nakamise), has no public description.
All preceding stages passed, including the 16 new tests. The photo code does not change this
POI or its publication fields. Remaining gates passed separately: `check:admin-tokens`, live `check:images`
(zero broken paths) and `build` (80 static pages). This is not a green continuous `verify`.
After the final schema-target guard, the targeted suite and touched-file lint passed again.
It uses the configured `.env.local`, not a fabricated offline environment. The authorized live
read stages are `check:copy`, `check:canon`, `check:polivanov`, `check:poi`, `check:images`, `build`;
only GET requests are permitted in these gates. Intake tests use injected fakes and stay offline.
