# Independent development monitoring protocol

Use this protocol when Codex reviews another agent or performs a second pass over its own high-risk change.

## Separate authoring from verification

The author owns implementation and first-line tests. The monitor owns falsification, integration claims, and scope control.

Do not let the author's narrative become the monitor's search path. Start from:

- task and explicit non-goals;
- pre-change and post-change commits;
- raw diff;
- current code and canonical docs;
- fixtures, snapshots, and generated reports.

Read the author report after the first independent pass, then convert every statement into a claim card.

## Review checkpoints

### Checkpoint A — before implementation

Require:

- affected source of truth, writers, and consumers;
- risk level;
- proposed invariants and terminal outcomes;
- expected behavior changes versus defects intentionally removed;
- verification plan and owner decisions still open.

This prevents a long implementation from optimizing the wrong invariant.

### Checkpoint B — before commit

Review the unstaged diff and execute the riskiest changed branches. Check:

- validation order relative to I/O;
- authority boundaries;
- multiple candidates and conflicts;
- counter conservation and report semantics;
- partial-failure behavior;
- tests that would remain green after a broken mutation;
- accidental second sources of truth;
- stale names and comments.

Prefer correcting the change before its first commit. Do not create a chain of “done → review → correction” commits when the issue can be caught in the same checkpoint.

### Checkpoint C — after commit

Verify:

- commit contains only declared files;
- canonical status docs changed when implementation state changed;
- user files remain untouched;
- reported commands actually ran at this commit;
- unverified claims are named explicitly.

### Checkpoint D — before production

Repeat the L3 execution card from `verification-matrix.md` against fresh state. A prior dry-run is stale after any database change.

## Cold-review method

When an independent reviewer is available and the user has authorized delegation:

1. Give the reviewer the raw task, commit range, and relevant artifact.
2. Do not provide the suspected defect or intended answer.
3. Ask for correctness findings, missing evidence, and the smallest counterexample.
4. Compare findings with the claim cards.
5. Record misses as review-process evidence, not as proof that no defect exists.

If no independent reviewer is available, perform two passes with different questions:

- Pass 1: “Can the stated contract be false while all current tests pass?”
- Pass 2: “What happens on the second candidate, empty input, conflict, non-empty rare branch, and failure after the first effect?”

Never claim independence for a self-review.

## Control monitoring cost

Use risk-based sampling rather than reviewing every line equally:

- focus first on changed authority, boundaries, writes, counters, and documentation guarantees;
- accept existing pure helpers when unchanged and already covered;
- stop expanding into unrelated debt unless it blocks the task;
- collect adjacent debt separately with evidence;
- pause after repeated corrections and restate the whole contract before more patching.

The goal is fewer escaped defects and fewer corrective loops, not maximum ceremony.

## Review report

Report in this order:

1. Findings by severity, with file and line or executable reproduction.
2. Claims confirmed and the evidence used.
3. Claims not proven.
4. Scope drift and unrelated changes.
5. Required fix before merge or production.
6. Follow-up debt that is explicitly outside the current task.

Do not lead with a summary of effort. Lead with whether the change is safe to proceed.
