# Photo Intake v1: operating instructions

2026-09-22. Entry point: [photo-management.md](photo-management.md). Code implemented;
**live activation pending Dropbox OAuth and a credentialed pilot**. Do not describe this as an
active chat listener or automatic website publisher. An agent receives attachments, identifies
the subject/rights, prepares a manifest and runs these commands.

## Connection and first activation

Use Node >=22.18 and `npm ci`. Keep credentials server-side, never `NEXT_PUBLIC_*`, Git or chat.
The Dropbox plugin's credentials cannot be reused by this CLI. Create a dedicated scoped Dropbox
app for this owner's archive. Existing library folders require **Full Dropbox** access; Dropbox's
App folder scope cannot reach `/GS/Проекты/Jumboinjapan/photo-library`. This grant is broader than
the script's path allowlist: the token could access other folders if used by other software.
Owner confirmation of this new access is required by the browser workflow.

In the Dropbox App Console, enable only `files.metadata.read`, `files.content.read`,
`files.content.write`, and register `http://localhost:8768/dropbox/callback` as redirect URI.
Do not enable sharing/team/member permissions. The owner's application name is
`Jumbo in Japan Photo Intake`; do not reuse unrelated existing applications.

```sh
npm run photo:connect -- --app-key APP_KEY_FROM_APP_CONSOLE --write
```

The command prints an OAuth link, waits up to five minutes on loopback port 8768, validates
OAuth state and exchanges a PKCE code. Owner approval in Dropbox saves the refresh token in
`.env.photo-intake.local`, mode 0600, ignored by Git. It does not print tokens and refuses to
replace an existing connection file. App key is a public client identifier, not an app secret.
The helper requests persistent/offline access. OAuth denial or expiry does not enable intake.
Alternatively provision `DROPBOX_APP_KEY` + `DROPBOX_REFRESH_TOKEN` securely; an app-secret-based
connection also uses `DROPBOX_APP_SECRET`. `DROPBOX_ACCESS_TOKEN` is a temporary diagnostic option.
A supplied access token takes precedence over refresh credentials; remove an expired override.

Airtable credentials are the existing `AIRTABLE_TOKEN` / `AIRTABLE_BASE_ID` in `.env.local`.
Required scopes: `schema.bases:read`, `schema.bases:write` for initial setup, and
`data.records:read`, `data.records:write` for subsequent intake. The token's owner also needs
permission to create tables. Presence of credentials is not proof of these capabilities.

```sh
npm run photo:intake -- doctor
npm run photo:intake -- schema-plan
npm run photo:intake -- schema-apply --batch /absolute/existing-private-setup-folder --write
npm run photo:intake -- doctor
```

`doctor` fails when the Dropbox registry is unavailable or the media schema is missing/incompatible.
The schema command first reads the live Dropbox registry, then validates existing media tables,
journals a before-schema snapshot, creates only missing tables and rereads their actual IDs/types.
It never changes an incompatible existing field. Linking `PhotoUsages` to the existing POI table
also lets Airtable create its reciprocal link field; existing descriptions/routes/photo paths are
not rewritten. Schema names live in `src/lib/airtable-schema.ts`; live table IDs are resolved from
metadata, never guessed. Interrupted creation resumes by exact table name, failing on ambiguity.

The setup/pilot has not yet run. Current private setup evidence is under
`/Users/jumbo/Documents/Jumbo in Japan/Photo Library/intake-setup/` on the owner's machine.
After connection, start with one owner-supplied photo and verify every stage before reporting live
activation. Preserve registry/schema snapshots and journal; do not import a legacy archive as a pilot.

## Intake from a chat attachment

Save the attachment in a private working directory outside the live Dropbox library. Inspect the
image; do not infer POI, authorship or rights from filename. Ask only for missing information that
blocks the intended use. Record unknown rights literally; unknown rights permit private archiving,
not publication. Input JSON:

```json
{
  "version": 1,
  "items": [{
    "file": "/absolute/attachments/source.jpg",
    "titleRu": "Улица Бэндзайтэн Накамисэ",
    "subjectSlug": "benzaiten-nakamise",
    "collectionTag": "enoshima",
    "rights": "Owner-supplied; confirm permission before publication"
  }]
}
```

Optional `poiId` must be a real existing `POI-000000`-shaped ID resolved from Airtable. It adds a
candidate relation, not a published website assignment. Optional `assetId` groups a crop/encoding
under an existing photograph after visual verification. Omit it for a new photo. Collection is
catalogue context, not a replacement geography taxonomy. Support is 1–20 items; each source is
up to 100 MiB / 80 MP. Animated/multipage inputs and undecodable files fail before cloud writes.

```sh
npm run photo:intake -- prepare --input /absolute/input.json --out /absolute/new-batch-folder
npm run photo:intake -- plan --batch /absolute/new-batch-folder
npm run photo:intake -- apply --batch /absolute/new-batch-folder --write
```

`prepare` preserves exact source bytes and creates an oriented sRGB WebP within 1800×1800,
quality 88, without enlargement or source metadata. It validates/decodes the full batch before
creating a new output directory. A compressed chat attachment remains that attachment; do not
call it a camera original. `intake-original` means the unchanged received input.

The immutable `batch.json` binds metadata, original and web hashes, dimensions and byte counts.
Do not edit it after preparation. Keep its referenced files and append-only `journal.ndjson`
together. A different metadata manifest is a new batch and can reuse existing file identities.
An exact-byte duplicate reuses its asset/variant IDs; visual similarity is never automatic dedup.

`plan` reads the registry and prints proposed IDs, full hashes, byte counts and exact Dropbox paths;
it reserves nothing. For local preparation without credentials, add
`--registry /absolute/registry-snapshot.json`. Output explicitly identifies `offline-snapshot`;
this does not prove current cloud state. `apply` always plans from a fresh live revision.

## Persistence and recovery contract

1. Validate all prepared bytes and registry; preflight media schema and every supplied POI ID.
2. Journal the before-registry snapshot/hash/revision. Reserve all IDs and variants with a single
   revision-checked registry upload. Conflict retries reread and recompute; no guessed free gaps.
3. Upload files add-only. Existing destination must match full SHA-256; no overwrite/autorename.
   Download and verify bytes, size, path and ID before marking each registry variant completed.
4. Mark archive verification, then upsert `Photos`, `PhotoFiles`, optional `PhotoUsages` using stable
   keys. Reread each record. Editorial `Status`/`Role` are not reset on an existing record.
5. Mark the batch complete only after metadata verification and final registry readback.

Run one complete operator at a time. Dropbox CAS protects reservations, but Dropbox and Airtable
are not a transaction; Airtable has no database unique constraint here. Unexpected duplicate keys
fail rather than selecting the first record. `Photos` describes the image, `PhotoFiles` stores
Dropbox IDs/paths/hashes/dimensions (no attachments), and `PhotoUsages` connects a web variant to POI.
The archive remains authoritative for asset/variant metadata. Do not independently edit matching
identity/title/rights fields in Airtable and expect a later archive sync to preserve that drift.

After error, preserve the package and journal and rerun the **same** `apply` command. A timeout is
an unknown outcome. The next attempt reconciles the same paths/IDs; it does not allocate a new batch
or delete a committed prefix. A completed replay only reads/verifies external state and appends a
local readback event. Drift stops replay rather than silently repairing it. Registry/API loss or
incompatible schema requires repair before more writes. No automatic rollback or deletions.

The private journal contains before snapshots and operation evidence. It is not a public log;
keep permissions private. There is no automated retention/deletion policy. Dropbox version history
may assist manual recovery, but never replace the latest registry with an old snapshot if other
batches have committed since. Reconcile their IDs/files first.

## Website selection and publication

```sh
npm run photo:intake -- export --batch /absolute/new-batch-folder --checkout /absolute/website-checkout --write
```

This exports only archived/verified WebP bytes at a new hash-bearing URL under
`public/tours/photo-library/`, preserving existing URLs. It rejects occupied paths with different
bytes and symlinks. It does **not** deploy, set public path fields in Airtable, or publish a POI.

Follow [photo-management.md §7](photo-management.md#7-connect-a-photo-to-the-website-today):
choose a specific stop/hero, prepare factual alt/credit and authorize that intended use, deploy
files first, verify their production URLs, then update the authoritative website assignment and
refresh caches. Record the deployed URL, selected variant, route/stop and previous assignment in
operation evidence. `PhotoUsages.Public Path` and `Alt RU` may then record verified usage; the site
continues to read its established Route Stops/Routes fields. No second photo picker is wired here.

Report three outcomes separately: archived, indexed/linked in Airtable, published on website.
A `complete` intake result explicitly says `website: not-published`.

## Verification and references

`npm run test:photo-intake` is offline: malformed input, reserved ID reuse, duplicate bytes,
CAS conflicts, partial file writes, unknown outcomes, metadata failure/resume, independent readback,
image processing, path/symlink restrictions, editorial status preservation and OAuth PKCE.
`npm run verify` includes this suite plus the existing repository gates. Mock results prove code
behavior only; connection and the credentialed one-photo pilot are separate activation gates.

Implementation evidence and activation limits: [photo-intake-verification.md](photo-intake-verification.md).

Primary API contracts: [Dropbox OAuth](https://docs.dropboxapi.com/dropbox-api/docs/oauth),
[Dropbox upload](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/upload),
[Airtable create table](https://airtable.com/developers/web/api/create-table),
[Airtable upsert](https://airtable.com/developers/web/api/update-multiple-records).
