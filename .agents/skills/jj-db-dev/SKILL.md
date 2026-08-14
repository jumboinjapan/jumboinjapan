---
name: jj-db-dev
description: Guardrails and verification workflow for Jumbo in Japan data-layer development and review. Use whenever Codex changes, debugs, reviews, or documents Airtable schemas and writers, POI Intake, taxonomy, collectors, imports, migrations, deduplication, classifiers, integrity checks, batch operations, reports, or any code that can transform or write production data. Also use when monitoring another agent's work in these areas. Do not use for unrelated UI or editorial-only tasks.
---

# JJ DB DEV

Protect Jumbo in Japan data by making risky behavior explicit, fail-closed, observable, and executable in tests. Treat this as a data pipeline with agents around it, not as an agent society.

## Establish the working truth

1. Read `AGENTS.md` first.
2. Run `git --no-optional-locks status --short --branch` and identify every pre-existing change before editing.
3. For POI work, read `docs/poi-intake/README.md`, then the relevant sections of `change-policy.md`, `runbook.md`, the current ADR, and `poi-writers-registry.md`.
4. Read the affected code and its callers. Do not infer behavior from a handoff, filename, comment, type, test name, or author report.
5. Name the canonical source for each changed concept and inventory every writer and consumer. Search with `rg`.
6. Record the evidence baseline: current HEAD, command inputs, fixture or snapshot, and any skipped verification.

Preserve user files. Never use `git add -A`. Do not absorb unrelated changes into the task.

### Verify persisted state and repository locks

- A tool log, printed `ok`, or zero exit code proves only what the process reported. After any automated edit, re-read the persisted target, inspect `git --no-optional-locks diff`, and assert the exact postconditions that matter. If a multi-step script writes only at the end, an earlier success message can survive in the log even though a later exception prevented every edit from reaching disk.
- Verify Git transitions from Git itself: staged scope with `git --no-optional-locks diff --cached`, commit contents with `git --no-optional-locks show`, and a push with the remote ref (for example, `git --no-optional-locks ls-remote`). Do not report a sandbox file, index, commit, or remote update from an intermediate log.
- Use `git --no-optional-locks` for read-only inspection commands on mounted workspaces so `status` or `diff` does not refresh the index and leave a lock the environment cannot unlink. This does not neutralize a lock that already exists.
- Before touching a `.git/*.lock`, first determine whether the intended operation needs that lock. A push does not require removing index or HEAD locks. If a lock actually blocks a write, establish its owner from the strongest available evidence; absence from `ps` is insufficient when the process view may be namespaced and unable to see host processes. Leave an unproven lock alone and ask the owner.

## Select the risk level

Use the lowest level that covers the change; escalate when evidence shows wider impact.

| Level | Scope | Minimum gate |
|---|---|---|
| L0 | Read-only analysis or prose with no operational claim | Inspect sources, verify links and diff |
| L1 | Pure logic or internal refactor, no writer/schema change | Targeted behavioral tests, typecheck, lint on touched code |
| L2 | Intake boundary, taxonomy, classifier, report, writer, batch, schema, migration code | Full risk matrix, negative tests, runtime branch execution, `npm run verify`, read-only dry-run when available |
| L3 | Production write, destructive action, live schema or migration | L2 plus explicit owner authorization, exact target resolution, backup/reconciliation plan, post-write verification |

Treat a claimed documentation guarantee about writes, rollback, retention, or atomicity as at least L2.

## Write the change contract before code

State briefly:

- the allowed scope and explicit non-goals;
- the error class being prevented;
- inputs and runtime validation boundary;
- terminal outcomes and which layer owns them;
- invariants before and after the change;
- source of truth and all affected consumers;
- behavior after partial failure;
- proof required before the change is accepted.

Do not preserve a baseline merely because it is old. Decide which behavior is contractual and which behavior is the defect being removed.

## Apply the core guardrails

### Validate before effects

- Validate the whole batch before the first network call or write when the contract is batch-wide.
- Put runtime validation at JavaScript/TypeScript and external-data boundaries. Types and comments are not runtime guards.
- Distinguish omitted values from supplied-but-empty or malformed values. Reject the latter unless normalization is explicitly contractual and observable.
- Inject dependencies independently. Substituting a store must not suppress research, resolvers, logging, or other unrelated behavior.

### Bound local artifacts through their full lifecycle

- Treat acceptance, writing, rediscovery, expiry, and deletion as one contract. The writer must not accept a name or location that the retention process cannot later find and remove.
- Prove physical containment, not only a string prefix. Check the configured root, existing parent components, and target separately; cover exact case-sensitive naming, symlinks, dangling symlinks, absent directories, occupied paths, and non-directory components.
- Reject known-invalid destinations before expensive I/O, then keep an exclusive or atomic final write to close the race after preflight.
- Do not substitute filesystem `mtime` for an embedded authoritative deadline. A heuristic may find candidates, but deletion must follow the authoritative field or an explicitly approved policy.

### Make deterministic artifacts unambiguous

- Treat a digest used for approval, replay, or paid/model execution as an authority boundary, not a decorative checksum. Define the exact byte stream, domain-separate its parts, and record the byte counts that were actually hashed.
- Reject runtime representations that collapse to the same JSON or UTF-8 bytes: symbol, non-enumerable, or accessor properties; sparse arrays; non-canonical array keys; and lone UTF-16 surrogates. Validate the complete raw public input before `Object.keys` projection, destructuring, cloning, defaulting, or reading nested values.
- For encoded values, validate both representations: canonical encoded syntax first, then strict decoding without replacement and the same control, whitespace, and structural rules on the decoded value. Reject non-canonical input instead of normalizing it.
- Dispatch contract versions and named policies only through own keys or a `Map`, after validating the selector type. Inherited names such as `toString` and `__proto__` are unknown versions, not table entries.
- Expose validation policy as functions or deeply immutable data, not mutable objects such as `RegExp`; freezing a `RegExp` does not disable `compile()`.
- Bind the artifact to a clean code identity before expensive I/O, then resolve and compare that identity again before signing or persisting the result. Attach a portal or batch fragment only after that unit finishes successfully, require it to match the parent authority/profile identity, and assert set equality between selected and completed units.

### Fail closed without losing evidence

- Route ambiguity, conflict, unknown state, unsupported version, or unrepresentable legacy value to a named stop outcome.
- Never turn `needs_review` into a note on an already-created record.
- Preserve source evidence and the rejected proposal, but do not let them authorize a write.
- Keep machine, rule, and owner authority separate. A machine path cannot accept `human` as caller-controlled input.

### Derive each decision once

- Keep enums, taxonomy, routing policy, labels, and schemas behind their canonical loader.
- Do not add a local list, fallback JSON reader, public test bypass, or parallel decision function.
- Compute a semantic result once and reuse it for counters, queues, write eligibility, and reporting.
- Name intermediate states honestly: eligible before geography is not writable.
- Avoid caches unless the invalidation model and measurable benefit are both demonstrated.

### Account for every record

- Define terminal outcomes as mutually exclusive.
- Assert conservation: every input reaches exactly one terminal outcome, with separately named intermediate counts.
- Compare sets by stable keys, not only counts, when two projections must be identical.
- Keep full queues in the artifact and concise samples in stdout. Report fields must exist in the data they claim to describe.

### Treat writes as non-atomic by default

- Do not infer transactions from a function named `Batch` or a single call site.
- Inspect the implementation for a transaction, rollback, or compensating action before claiming atomicity.
- Define idempotency, partial-success detection, reconciliation, and rerun behavior.
- Treat process exit code, report status, and database state as different signals. Verify the database when it is the source of truth.
- Give every compatibility bridge one importer, one purpose, an explicit failure mode, and a deletion condition.

## Prove behavior, not text

Read [references/verification-matrix.md](references/verification-matrix.md) for the gate matching the change.

At minimum:

1. Execute every changed terminal branch with a non-empty fixture.
2. Add a regression test that fails when the escaped defect is reintroduced.
3. Add counterexamples at the boundary: malformed input, conflicting signals, empty data, second candidate, and partial failure as applicable.
4. Use exhaustive enumeration when the state space is finite and small.
5. Use differential tests when a manual validator duplicates a schema or another implementation.
6. Use mutation checks for critical guards; demonstrate that removing or weakening the guard fails.
7. Search for stale identifiers and old semantic names after refactors, then execute the affected code path. `grep` alone is not proof.
8. Run the relevant targeted suite before the broad suite. For L2, run `npm run verify` unless a documented environmental constraint prevents it.
9. Re-read every persisted artifact changed by automation and assert its required postconditions; intermediate tool output is not evidence of the final file.
10. Run `git --no-optional-locks diff --check`, inspect the final diff, and list exactly what was not tested.

Do not weaken a test to make a change pass until the test's contractual claim has been reviewed.

## Monitor another agent independently

When reviewing Claude or another agent, read [references/review-protocol.md](references/review-protocol.md) completely.

- Inspect the actual HEAD and diff; treat the author's report as a list of claims, not evidence.
- Reproduce each high-risk claim with a command, code path, or fixture.
- Search for counterexamples before suggesting improvements.
- Review before commit when possible. A post-commit correction is evidence that the gate ran too late.
- Do not feed the suspected answer to an independent reviewer. Give raw task, diff, and artifacts.
- Separate product defects, pre-existing debt, owner decisions, and unimplemented target architecture.

## Keep commits and documentation coherent

- Change one contract or consumer per reviewable commit.
- Update the canonical status document in the same commit when implementation state changes.
- Do not copy machine-readable lists into prose. Link to the canonical registry and explain meaning.
- Verify every operational statement against code, especially “atomic”, “all-or-nothing”, “rollback”, “no network”, “does not write”, and report field contents.
- Stage files explicitly. Report the commit hash, changed files, evidence, skipped checks, risks, and next permitted step.

## Stop for owner authority

Stop and ask before any L3 action, live Airtable schema change, production write, destructive deletion, migration execution, retention/licensing decision, product taxonomy semantic choice, or replacement of a human decision with automation.

Do not stop for an ordinary reversible implementation choice that is already fixed by code, ADR, or the user's scope.

## Learn from escaped defects

After a defect escapes the current gate:

1. Fix the product defect and add a regression test first.
2. Identify the general failure pattern and why the previous proof missed it.
3. Update [references/failure-patterns.md](references/failure-patterns.md) only when the lesson generalizes.
4. Prefer an executable project guard over another paragraph.
5. Update this skill in a separate, focused commit when its workflow changes.
6. Remove obsolete or duplicate rules; do not turn the skill into a changelog.

The skill reduces preventable and repeated errors. It never replaces code review, executable tests, production observability, backups, or owner judgment.
