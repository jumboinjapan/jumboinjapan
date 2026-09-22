# Photo Intake v1 change contract

2026-09-22. Risk: L2 implementation; live setup/pilot is L3 and must pass preflight.

Owner request: configure the previously agreed chat → Dropbox → metadata → website workflow.
Implement an agent-operated CLI: prepare immutable originals/WebP variants, plan against the
archive registry, reserve IMG IDs by Dropbox revision-checked update, upload/verify files,
commit registry state, and upsert metadata/POI usage into dedicated Airtable tables.
Website delivery stays in `public/`; exporting files prepares a reviewed deployment and never
silently publishes a route change. No deletion, public Dropbox sharing, background automation,
or bulk import of the legacy client archive.

Canonical archive: existing `catalog/registry.json`, schema v1 with additive `intakeBatches`.
Canonical Airtable names: `src/lib/airtable-schema.ts`. Existing routes/POIs remain unchanged.
Input: strictly validated JSON file manifest plus image bytes. Unknown fields/versions,
changed bytes, unsafe paths, conflicting IDs and invalid image data fail before cloud writes.

Prevent ID reuse, duplicate byte storage, overwriting newer registry revisions, partial writes
reported as complete, and published paths referring to undeployed files. Reserve a whole batch
in one registry CAS before uploads; reservation is not archive completion. Persist journals.
Files are add-only and read back by hash. Complete registry entries after verification. Airtable
upserts use stable keys and independent reads; linkage is metadata, not website publication.

Terminal CLI outcomes: prepared, planned, complete, failed (with persisted progress). Cloud
statuses distinguish reserved, archive-verified, complete. A failed batch may have a committed
prefix; rerun the identical batch to reconcile by stable IDs/hashes. No automatic rollback/delete.
Do not start live writes when required credentials/schema/readback are unavailable.

Proof: offline boundary, malformed input, symlink/path containment, ID collision, concurrent CAS,
duplicate import, partial upload, timeout-after-commit and metadata failure/resume tests; actual
archive read-only plan; full repository verify; separate credentialed pilot only after connector
setup. API references: Dropbox files/upload update mode and OAuth guide; Airtable create-table
and update-multiple-records APIs. Never treat mocked tests as a live pilot.
