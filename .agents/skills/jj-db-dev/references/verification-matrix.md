# Verification matrix

Use this file for L1–L3 work. Select every row touched by the change; do not run unrelated expensive checks for ceremony.

## Core matrix

| Change | Required proof |
|---|---|
| Runtime boundary or input contract | Valid positive control plus missing, empty, malformed, unknown-version, inherited-name, and conflicting-input cases; validate the complete raw object before projection or destructuring; assert no I/O before rejection |
| Batch intake | Validate all rows before first effect; terminal conservation; duplicate keys; failure after N writes; rerun/reconciliation behavior |
| Matcher or dedup | Candidate order permutations; multiple candidates; missing coordinates; near/far namesakes; part–whole examples |
| Taxonomy or routing | New immutable version when semantic; schema validation; exhaustive entity × type-state × source table; exactly one rule per case; digest verification |
| Model proposal | Strict schema; `additionalProperties: false`; manual/schema differential test; invalid provenance; repeated/oversized values; machine cannot become human |
| Report or counters | Build every queue with non-empty data; exact terminal sum; stable-key equality; full artifact versus stdout sample; field-existence assertions |
| Local artifact or retention boundary | Acceptance set equals cleanup set; exact case-sensitive naming; physical containment at root, parents, and leaf; symlink and dangling-symlink cases; absent, occupied, and non-directory paths; rejection before expensive I/O; race-safe final write; authoritative expiry distinguished from `mtime` |
| Deterministic plan or digest | Exact domain-separated byte streams and byte counts; lone-surrogate rejection; symbols, hidden/accessor properties, sparse arrays, and non-canonical array keys rejected before projection; strict decoding plus decoded semantic/structural checks for encoded values; no mutable validator exports; child/parent authority identity; clean code identity before effects and unchanged identity before persistence; selected/completed set equality; no partial artifact |
| Compatibility bridge | Exactly one production importer; exact mappings only; unsupported values fail before store creation; deletion condition documented |
| Writer or Airtable schema | Writer registry update; field identifiers from canonical schema; dry-run; idempotency; partial failure; audit/reconciliation plan |
| Migration | Read-only proposed mapping first; explicit old → proposed → mode → reason artifact; owner approval; backup; resumability; post-migration integrity check |
| Refactor | Characterization tests for contractual behavior; stale identifier scan; execute changed branches; compare before/after artifact |
| Operational documentation | Trace claim to code; verify commands from `package.json`; verify report fields; inspect error and partial-success paths |

## Proof strength

Prefer the strongest proportional proof:

1. Static presence — useful only for format and forbidden-token checks.
2. Behavioral example — executes the branch once.
3. Negative example — proves rejection and absence of effects.
4. Differential or exhaustive test — compares implementations or covers finite state space.
5. Mutation check — weakens the guard and demonstrates the suite fails.
6. Read-only end-to-end artifact — proves integration with realistic data.
7. Controlled production observation — L3 only, with owner authorization.

Do not report level 1 as if it were level 4 or 6.

## Claim card

For each high-risk claim, write this before declaring completion:

```text
Claim:
Owning code path:
Evidence command or test:
Counterexample attempted:
Observed result:
Not proven:
```

Required claims commonly include:

- invalid input is rejected before network and storage;
- every candidate reaches exactly one terminal outcome;
- report eligibility equals write eligibility by stable key;
- machine output cannot select owner authority;
- a batch can or cannot be partial, with the mechanism named;
- a rerun is idempotent for the intended key;
- no second registry or enum list remains;
- the documented command and report shape match current code.

## Pre-commit sequence

1. Re-read the task contract and non-goals.
2. Inspect `git --no-optional-locks diff --name-only` for scope expansion.
3. Re-read files changed by automation and assert the required persisted values; do not use the script log as evidence.
4. Run the narrowest behavioral test that exercises the new or changed branch.
5. Run negative and mutation checks appropriate to the risk.
6. Produce or compare a read-only artifact when the pipeline shape changed.
7. Run `npm run verify` for L2 unless a specific environmental limitation is recorded.
8. Run `git --no-optional-locks diff --check` and inspect the complete diff.
9. Stage exact files only, then verify the staged set with `git --no-optional-locks diff --cached`.

## Production gate

Before L3, require a written execution card:

```text
Authorized operation:
Exact target and row set:
Expected before/after counts:
Backup or snapshot:
Idempotency key:
Partial-failure signal:
Reconciliation query:
Rollback or manual recovery:
Post-write verification:
```

If rollback does not exist, write “no rollback” and define reconciliation. Never invent a compensating delete during an incident.
