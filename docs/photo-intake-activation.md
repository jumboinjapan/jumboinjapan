# Photo Intake connection and schema activation

2026-09-22. Runtime code: `e88584171c7f39f32066cf2a952b3c9535a5ceb1`,
branch `codex/photo-intake`, [PR #9](https://github.com/jumboinjapan/jumboinjapan/pull/9).

## Verified

- The owner explicitly authorized permanent Full Dropbox read/write access for Intake.
- Dedicated application: `Jumbo in Japan Photo Intake`. OAuth requests only
  `files.metadata.read`, `files.content.read`, `files.content.write` with offline PKCE.
- Connection saved in the intake checkout’s `.env.photo-intake.local`, mode 0600,
  excluded from Git. Do not print, commit or copy its contents into documentation.
- The live registry read succeeded: 83 assets and next ID 153 at verification time.
  Always reread these values for a batch; this is not an allocation.
- The canonical schema writer created `Photos`, `PhotoFiles`, `PhotoUsages`.
  An independent reader verified field types, primary fields and link targets.
  All pre-existing tables and fields were preserved; POI gained only the reciprocal
  `PhotoUsages` link. The three new tables were empty after setup.
- `npm run photo:intake -- doctor` passed for Dropbox and Airtable after creation.

The connection is local to `/Users/jumbo/Projects/jumboinjapan-photo-intake`.
Until PR #9 is merged, run the CLI there. On another host, establish its own authorized
credential setup; neither the Dropbox plugin nor the presence of this document supplies keys.
The Dropbox grant technically covers the whole account; the CLI path allowlist restricts
its file operations to the existing photo-library archive.

## Evidence and recovery

Private setup directory:
`/Users/jumbo/Documents/Jumbo in Japan/Photo Library/intake-setup/`.
It contains owner authorization, activation plan, before/after schema snapshots,
`journal.ndjson`, and `activation-result.json`. CLI logs are in the intake checkout’s
`tmp/photo-intake/doctor-activation.json`, `schema-activation.log`,
`doctor-connected.json`. These files contain operational metadata and stay out of Git.

Do not recreate the app, replace the connection file or repeat table creation blindly.
Start with `doctor` and inspect the journal. Existing tables are resolved by exact canonical
names; incompatible schema stops the writer. No automatic rollback or deletion was performed.

## Remaining acceptance

A new owner-supplied image is needed for the first real intake. Verify original and WebP
uploads, registry commit, Airtable records, replay without duplicate IDs, and the requested
website placement through the runbook. No photograph was uploaded, no registry revision
was changed, and no website photo assignment or deployment was made during this setup.
Do not describe data-record writes, end-to-end publication, or the legacy archive’s Airtable
indexing as verified. The 83-card registry remains in Dropbox; setup did not backfill it.
