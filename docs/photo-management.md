# Photo management: agent entry point

Maintained operational guide. Updated 2026-09-22: verified archive plus Photo Intake v1 implementation.
Activation status (2026-09-22): dedicated Dropbox OAuth connection and live Airtable media schema are verified on the owner’s Mac. The first owner-supplied-photo pilot remains pending; do not report end-to-end intake/publication as proven.
Read this before importing, selecting, replacing, renaming, linking, or deleting Jumbo in Japan images.
This guide is shared across agents; it does not depend on the original conversation.

## 1. What exists, and what does not

| Layer | Implemented state |
|---|---|
| Archive | Dropbox `photo-library`, with immutable image variants and a JSON registry |
| Initial import | 83 asset cards, 109 image files, 8 catalogue/provenance files; all 117 files verified after Dropbox sync by SHA-256 on 2026-09-22 |
| Website delivery | Existing repository `public/` files and Next Image; archive import did not change website URLs |
| Website assignments | Existing Airtable fields and code fallbacks, as described in [photo-storage.md](photo-storage.md) |
| Agent-operated photo intake | CLI implemented: `npm run photo:intake`; [setup and runbook](photo-intake.md). No chat watcher/service |
| Dedicated Airtable media tables | Live `Photos`, `PhotoFiles`, `PhotoUsages` created and independently verified; tables are empty until the first intake |
| Vercel Blob / separate image CDN | Proposed, not connected by this work |
| Registry writer | Revision-checked Dropbox API writer implemented/tested. Dedicated OAuth connection verified on the owner’s Mac; live registry writes await the pilot. Run one full intake operator at a time; CAS protects ID reservations from conflicting writers |

These counts describe the initial import, not a permanent current total. Read the current registry before every batch.
An archived photograph is not automatically published, licensed for every use, or geographically verified.

## 2. Locate the current data

| Resource | Location |
|---|---|
| Dropbox library | `/GS/Проекты/Jumboinjapan/photo-library` |
| Dropbox namespace path | `ns:30497063//GS/Проекты/Jumboinjapan/photo-library` |
| Library folder ID | `id:vF7NJsU8TbQAAAAAABR18w` |
| Current asset registry | `<library>/catalog/registry.json` |
| Initial human-readable index | `<library>/catalog/registry.csv` and `index.html`; import snapshots, not refreshed by Intake v1 |
| Archive notes and provenance | `<library>/catalog/README.md`, `<library>/catalog/provenance/` |
| Owner's local Dropbox mount | `/Users/jumbo/Library/CloudStorage/Dropbox` |
| Initial import evidence | `/Users/jumbo/Documents/Jumbo in Japan/Photo Library/2026-09-22/` |

The Dropbox registry is the authority for archive identity, paths and committed state. Read its latest revision through the Dropbox API writer before writes. Synced copies are allowed only for explicitly offline plans; they cannot establish a current cloud revision. A local dated preparation directory is a historical snapshot, not an independent current registry.

On a different machine, use the Dropbox path/ID; do not assume the owner's filesystem exists. If the archive cannot be accessed, state that limitation. Never reconstruct the registry from filenames or a previous chat summary.

The repository owns workflow documentation and runtime code. The archive registry owns asset inventory. Airtable owns the website assignments listed in `photo-storage.md`. A documentation change alone changes none of those assignments.

## 3. Identity and filenames

```text
photo-library/
  assets/
    IMG-000020/
      IMG-000020__ginza-six__1280x959__3f57f80406d3.jpg
      IMG-000020__ginza-six__6230x4672__9424e09ef7f9.png
  catalog/
    registry.json
    registry.csv
    index.html
    README.md
    provenance/
```

- **Asset:** one photograph, with a permanent `assetId`. Graphics use `kind: graphic`.
- **Variant:** a distinct byte sequence, identified by full SHA-256. Resizing, recompression and cropping create variants; all originals remain available.
- **Source:** where that file came from. Multiple old filenames or website paths may refer to the same bytes.
- **Usage:** where an image is used. A POI, route, cover, page, gallery or social post is not the identity of the photograph.

Filename: `<assetId>__<subject-slug>__<width>x<height>__<first-12-SHA256>.<ext>`.
Use lowercase Latin kebab-case for the subject and lowercase extension. The full hash in the registry, not the 12-character filename fragment, is the integrity check. If two proposed destinations collide, stop and resolve explicitly; never overwrite or silently autorename.

Keep assigned IDs and existing paths stable. Correcting a title, location or route does not require renaming a file. Preserve original camera/attachment names in source metadata. Do not infer the original capture date from filesystem dates, or identify the largest file as the camera original without evidence.

Cities, directions, prefectures, POIs and routes are metadata/relations. Do not create a second physical copy for each route or turn `collectionTag` into a new geography taxonomy.

## 4. Registry v1: read the actual fields

This describes the archive JSON schema; Airtable uses separate linked tables.

| Field | Meaning / handling |
|---|---|
| `schemaVersion` | Currently `1`; do not silently change structure |
| `nextId` | Next available numeric IMG identity; read fresh before allocation |
| `reservedDraftIds` | Import-reserved range; gaps are not free IDs |
| `aliasMap` | Historical variant/draft IMG ID → canonical asset ID |
| `assets[].assetId` | Stable photo identity |
| `titleRu`, `subjectSlug`, `kind` | Human label, filename subject, photo/graphic classification |
| `collectionTag`, `locationStatus` | Catalogue context and its confidence, not verified coordinates |
| `rightsStatus` | Rights may still be unknown; consult source evidence |
| `variants[]` | `variantId`, full `sha256`, bytes, width, height, relative path, role, sources, Dropbox result |
| `variants[].sources[]` | Collection and old logical path, and Dropbox source ID/revision where available |
| `variants[].dropbox` | Actual file ID, returned path, namespace path, transfer status and hash verification |
| `usages[]` | Snapshot of code paths and Airtable references from the audit |
| `poiUsageEvidence[]` | Existing POI-to-photo fallback assignment in code; **not proof of shooting location** |
| `provenanceDocuments`, `exceptions`, `verification` | Evidence, exclusions and verification of the import |
| `intakeBatches` | Additive v1 operation ledger: batch fingerprint, hashes, reserved/archive-verified/complete state and verified Airtable record bindings |

The import used the IMG namespace for both asset and variant IDs. Preserve that convention in v1. At import completion `nextId` was **153**, and `IMG-000001` through `IMG-000152` were reserved, including retired aliases and inventory-only legacy entries. Always re-read the current number; never hard-code 153 for a later batch.

Under coordinated manual allocation, a new photograph uses the next IMG ID for both its asset and first variant, with a self-alias. A new variant of an existing photograph uses a newly allocated IMG ID as `variantId`, maps it to the existing asset in `aliasMap`, and keeps the existing asset ID in its folder/filename. Advance the counter for every newly allocated ID. An exact byte duplicate needs no new ID.

Use `scripts/photo-intake/core.mjs` and `dropbox.mjs` for allocation. They reserve the whole batch using Dropbox `rev`, retry revision conflicts against fresh state, and never overwrite an unknown newer revision. Do not edit the synced registry manually. Coordinate one operator for the complete Dropbox/Airtable workflow: the two services do not form a transaction.

## 5. Find and select an existing image

1. Read the current registry. Search labels, collection tags, source paths, known asset IDs and usage evidence. Resolve aliases to the canonical asset.
2. Inspect the image itself. Similar filenames, visual similarity and a route association are candidate evidence, not proof that a particular POI is depicted.
3. Check source/provenance, rights and resolution for the intended use. Preserve required credit and license links. Unknown information stays unknown.
4. Reuse the appropriate variant. If a new crop/encoding is needed, preserve the source and register a separate variant; avoid upscaling without a specific reason.
5. For a website change, follow section 7 and the actual target checkout. A preview-only assignment is not a production assignment.

Do not claim a registry's `usages` snapshot is a fresh inventory of the live site. Check the current code, data and deployment when replacing or removing an image.

## 6. Receive/import files: agent-operated Intake

Use the [Photo Intake runbook](photo-intake.md) and its CLI once connection/schema preflight passes. The list below is the operational contract, not an alternative manual writer.

Prepare the whole batch before requesting any confirmation the active tool actually requires. Use authorization already supplied for the same concrete action; do not repeat it. The initial import approval covered its recorded 117-file plan, not future deletions, shares, schema migrations or publication of arbitrary photographs.

1. Save the supplied file outside the live archive as a working input. Record attachment/source name, supplied caption, intended use, and any authorship/license statement. Inspect format, dimensions, orientation, bytes and full SHA-256. Keep the source unchanged.
2. Compare its full hash to all registered variants. For an exact duplicate, reuse the existing variant and record the additional provenance when the registry can be safely updated. For visually related crops/encodings, inspect before grouping. Different overlays/text may be meaningful variants; never discard them automatically.
3. Establish the subject and intended POI using supplied context and existing records. If uncertain, keep it unassigned and ask only for the missing information needed for that use. Never invent a POI ID from a filename.
4. Coordinate one registry writer, allocate IDs from the latest registry and prepare a bounded manifest: old registry revision/hash, input hashes, exact destinations, proposed metadata/relations, operations and verification method. Preserve the pre-change registry and append an operation journal.
5. Execute only the authorized batch through available tools. For Dropbox copy/move/create, obey the connector's exact-plan confirmation requirement; source/destination paths, copy vs move and folder creation must be explicit. Approval of that plan is sufficient for its remaining steps. Do not bypass a required confirmation by writing through the local sync folder.
6. Check each asynchronous job and each batch entry. Read back the resulting file, verify full SHA-256, path and size, and record its returned Dropbox ID. Record `pending` or `failed` honestly until verification succeeds.
7. Commit verified metadata to the current registry through a supported, authorized update mechanism with a fresh revision/hash check. Re-read it, verify IDs/relations/counters and preserve earlier evidence. The imported CSV/HTML remain dated snapshots; use the JSON registry for new files. A file uploaded without a safely committed registry is **uploaded-unregistered**, not a completed intake.
8. Perform website assignment only when requested and authorized, using the existing website contract below. Report archive registration, database assignment and publication separately.

**Registry update limitation:** the Dropbox plugin's `upload_file` creates a new file and reports `ALREADY_EXISTS` for an existing destination. It is not a registry upsert. The separate Intake API writer now implements revision checks; it needs a dedicated Dropbox OAuth connection. The plugin connection is not a server credential. Run `doctor` before claiming intake can complete. Do not delete/re-upload the registry, invent an overwrite parameter, or create a second “current” registry as a workaround. If safe update is unavailable, keep the prepared batch/journal and identify this specific remaining step.

The legacy `inventory.py` and `prepare_library.py` in the dated import directory are one-time preparation tools. They are **not intake commands**. Re-running the inventory reassigns draft IDs from source order. The preparation script is deliberately blocked when a transfer journal exists. Never rebuild the live archive with them.

## 7. Connect a photo to the website today

Read [photo-storage.md](photo-storage.md) and the target checkout's `AGENTS.md`. For data writes, apply that agent's `jj-db-dev` guardrails and existing project authorization. The POI draft permission is not blanket permission to rewrite published route assignments.

Current delivery remains `public/` in the website repository. Use the existing public-path naming convention there; archive filenames do not require migrating every public URL. Preserve a relation from archive variant to the actual public file/path in the operation evidence.

Order matters:

1. Identify the authoritative assignment: `Route Stops` → `Photo Path` / `Photo Alt`; `Routes` → `Hero Image Path`; or the specific code-owned hero/card/metadata fallback.
2. Save the requested web variant at a **new public URL** when bytes change. Prepare required credits and a factual alt text for this actual image.
3. Commit/deploy through the project's normal workflow. Verify the new file is accessible on the intended environment **before** putting that path into live Airtable. A preview URL does not establish availability on production.
4. Make only the authorized assignment, preserve the old values in the journal, re-read it, and use the existing cache-refresh mechanism. A code fallback normally does not override a selected Airtable photo.
5. Regenerate the fallback with the existing command when the assignment changes. Verify the resulting page and crop in the intended deployment.

Existing commands, run from the website checkout:

```sh
# Read-only code/filesystem check; explicitly excludes Airtable.
node scripts/check-image-refs.mjs --no-airtable --json tmp/photo-check-offline.json

# Code + public files + live Airtable, when credentials are configured.
npm run check:images -- --json tmp/photo-check-live.json

# Reads Airtable and WRITES the generated fallback JSON in the checkout.
npm run sync:photo-fallback
```

Read-only `check:images` is covered by the project's standing verification permission; log whether live Airtable was actually read. `sync:photo-fallback` is a separate read-and-local-write command, not automatically covered by that read-only exception; use the photo assignment task's authorization or resolve the actual missing authority. Never hand-edit `src/data/route-stop-photos.generated.json`.

Run the checks required by the changed code/data scope in `AGENTS.md`. A successful image-reference check does not prove correct subject, crop, license or live cache refresh. Do not delete files because a text search found no references; assignments can live in Airtable and other deployments.

## 8. Dropbox operations and recovery

- Discover the currently available Dropbox tools and read their schemas. Tool availability and argument adapters can change.
- Use returned `path_display` when available; otherwise preserve the exact namespace path or ID. Never remove the `ns:30497063//` prefix from a returned namespace path. Normalize requested names to Unicode NFC.
- List direct children for browsing; paginate until `has_more` is false. Bound recursive verification to the approved library/batch; do not scan unrelated client folders.
- Prefer server-side `copy` for files already in Dropbox. Use local-file upload only with the supported file adapter; do not construct source URLs or print credentials.
- A copy may create missing parents. `create_folder` and `upload_file` need existing parents. Default to conflict failure, not autorename.
- Copy/move jobs use `check_job_status`; upload jobs use `check_upload_file_status`. Retain the returned operation token exactly and respect polling/backoff hints.
- Check `isError`, human-readable error text and nested results. In the initial transfer, the adapter sometimes reduced rate-limit/deadline errors to generic `INVALID_ARGUMENT`; the accompanying error text identified the cause.
- A timeout is an **unknown outcome**. Inspect the existing job/destination before retrying. Retry only uncompleted entries; preserve successful paths/IDs and compare bytes before considering an existing destination a success.
- Independent verification: read Dropbox metadata/listing, then download/read synced bytes and compare full SHA-256 to the prepared input. Dropbox API content-hash, if available, is not ordinary whole-file SHA-256; do not compare those algorithms directly.
- Metadata success, local staging success and visible website publication are different outcomes. Keep them separate in the report.

The initial transfer preserved every source. Undo would remove only the newly created library after separate explicit deletion authorization; it is not an automatic failure handler. Do not clean up originals, client photographs or older site assets as part of a normal import.

## 9. Initial audit boundaries and evidence

The import covered direct image files from `/GS/Проекты/Jumboinjapan`, the production-code snapshot and the tour-design snapshot. It did not import the 43 immediately listed images in `/GS/Eduard Personal/Jumboinjapan` or scan its client subfolders. Do not describe this as an audit of all Dropbox photographs.

Known exclusions/uncertainties are in `registry.json.exceptions`: an empty `Tokyo sky .png`, and an existing cable-car photo assignment requiring location review, among others. A source tagged `archive-source-unverified-original` is not an authenticated camera original.

Evidence directory on the owner's machine:

```text
/Users/jumbo/Documents/Jumbo in Japan/Photo Library/2026-09-22/
  migration-plan.json             approved initial plan; preserve
  execution-plan.json             executed plan, including final catalogue hashes
  transfer-journal.json           outcomes, IDs, transient errors and final inventory
  completed-files.csv             exact returned paths, IDs, bytes, SHA-256
  created-folders.csv             all 87 created folders, including library root
  final-hash-verification.json    117 verified files
  prepared-library/              local mirror at transfer completion, not live authority
```

Do not commit raw inventories, personal Dropbox metadata, photo binaries, credentials or operation tokens into source-control documentation. Link to private evidence instead.

## 10. Implementation and remaining activation

The operating instructions are [photo-intake.md](photo-intake.md), with boundary and verification
requirements in [photo-intake-contract.md](photo-intake-contract.md). This guide remains the entry point.

Implemented: original/WebP preparation, immutable batch manifest, offline/live planning, revision-checked
registry reservation, add-only file upload with SHA-256 readback, Airtable schema/upsert verification,
resume journal, OAuth PKCE connection helper and website file export.

Connection/schema completed on 2026-09-22 after explicit owner authorization: Full Dropbox with
file metadata read, content read/write, PKCE and a local refresh token; `doctor` passes against
the live 83-asset archive and all three media tables. Existing fields were preserved; POI gained
only the reciprocal `PhotoUsages` link. Evidence: [activation record](photo-intake-activation.md).

Pending acceptance: a credentialed one-photo pilot using a new owner-supplied image. Website selection/deployment remains agent-operated under section 7;
`apply` registers archive/database metadata, and `export` only prepares website files.

Not implemented: background chat listener, automatic website assignment/deployment, a media selection UI,
CDN migration, and automatic regeneration of the initial CSV/HTML indexes. These are not prerequisites
for using the agent-operated intake after its live pilot passes.
