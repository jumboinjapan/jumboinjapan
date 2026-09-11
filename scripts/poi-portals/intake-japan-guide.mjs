#!/usr/bin/env node
/** Saved JA-3/JA-4 → ordinary Intake. Default is offline; --live-read only GET;
 * --write uses standing owner authority VI for Draft/Todo, never publication.
 * Each invocation preserves a new run directory; old journals are never rewritten. */
import assert from 'node:assert/strict'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, mkdir, readdir, open, unlink, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isDirectEntry } from '../lib/direct-entry.mjs'
import { assertPathContainment } from '../lib/path-boundary.mjs'
import { sha256Bytes } from '../lib/byte-digest.mjs'
import { describeThrownSafely } from '../../src/lib/thrown-value.ts'
import { AIRTABLE_BASE_ID, POI_TABLE_ID } from '../../src/lib/airtable-schema.ts'
import { ingestPoi, ensureTaxonomySchemaForWrite } from '../../src/lib/poi-ingest.ts'
import { createAirtablePoiStore } from './lib/airtable-store.mjs'
import { createSnapshotStore, assertSnapshotRows } from './lib/base-snapshot.mjs'
import { loadNames } from './lib/names-file.mjs'
import { getPortal } from './registry.mjs'
import { assertReportDigest } from './lib/enrichment.mjs'
import { assertAirtableExport, AIRTABLE_EXPORT_SPEC } from './lib/discovery-airtable-match.mjs'
import { runDryRun, buildDryRunReport } from './lib/japan-guide-dry-run.mjs'
import { buildDryRunManifest } from './dry-run-japan-guide.mjs'
import { evaluatePortalCandidates, readCodeSnapshot, assertCodeSnapshotStable, resolveCodeIdentityFromGit } from './collect-pois.mjs'
import { buildRunManifest, fileIdentity, preWriteGate } from './lib/run-manifest.mjs'
import { parseWriteApproval, assertWriteApprovalApplies, claimWriteApproval } from './lib/write-approval.mjs'
import { openWriteJournal, durableDirectory, ensureDurableDirectory } from './lib/write-journal.mjs'
import { withVerifiedWrites } from './lib/verified-write.mjs'
import { reconcileWriteJournal } from './reconcile-writes.mjs'
import { reviewSelection, prepareReviewedIntake, ingestReviewedPoi, isReviewedParent, JG_REVIEW_SPEC } from './lib/japan-guide-review.mjs'

import { parseFactsPacket, assertFactsForRequest, dossierCopy } from './lib/japan-guide-facts.mjs'

export const JG_INTAKE_ENTRY = 'scripts/poi-portals/intake-japan-guide.mjs'
export const JG_INTAKE_SPEC = 'poi-japan-guide-execution/v1'
const REPO = fileURLToPath(new URL('../../', import.meta.url))
const FIELDS = Object.freeze({ poiId: 'POI ID', nameRu: 'POI Name (RU)', nameEn: 'POI Name (EN)', sourceKey: 'Source Key', siteCity: 'Site City', lat: 'Latitude', lon: 'Longitude', placeId: 'Google Place ID', website: 'Website', isSystem: 'Is System' })
const encode = value => `${JSON.stringify(value, null, 2)}\n`
const keyOf = request => `${request.source.id}:${request.source.externalKey}`
const USAGE = `Japan Guide → POI Draft / Todo
npm run poi:jg-intake -- --queues FILE --enrichment FILE --identification FILE --names FILE
  or --review-selection FILE --identification FILE (recorded owner decisions and subplaces)
  --facts FILE                 complete facts packet; mandatory for --write
  --base-file FILE             offline rehearsal; raw [{recordId, fields}] from a prior base.json
  --live-read                  fresh Airtable GET + rehearsal, no POST
  --write                      fresh base + create verified drafts under owner decision VI
  --limit N                    1..25 creates (default 25)
  --run-id ID                  optional unique ID; default generated automatically
Saved reports are reused; Google/model calls: 0. Results: tmp/poi-jg-runs/<ID>/report.json.
Repeat with a NEW run ID to skip existing Source Keys and reconcile earlier uncertain effects.
Never overwrite a run directory or remove active.lock while its process is running.`
async function saveBytes(file, bytes) {
  const handle = await open(file,'wx')
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  await durableDirectory(path.dirname(file))
}

export function parseIntakeArgs(argv) {
  if (argv.length === 3 && argv[2] === '--help') return {help:true}
  const args = { limit: 25, mode: 'offline', runId: `jg-${randomUUID()}` }
  const flags = new Map([['--facts','facts'],['--queues','queues'],['--enrichment','enrichment'],['--identification','identification'],['--names','names'],['--review-selection','reviewSelection'],['--base-file','baseFile'],['--run-id','runId'],['--limit','limit']])
  const seen = new Set()
  for (let i=2; i<argv.length; i++) {
    const flag = argv[i]
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`)
    seen.add(flag)
    if (flag === '--write' || flag === '--live-read') {
      assert.equal(args.mode, 'offline', 'Choose one live mode')
      args.mode = flag === '--write' ? 'write' : 'live-read'
    } else {
      assert(flags.has(flag), `Unknown option: ${flag}`)
      const value = argv[++i]
      assert(value && !value.startsWith('--'), `Missing value: ${flag}`)
      args[flags.get(flag)] = flag === '--limit' ? Number(value) : value
    }
  }
  if (args.reviewSelection) {
    assert(args.identification,'Required: --identification')
    assert(!args.queues && !args.enrichment && !args.names,'Review selection cannot mix ordinary JA inputs')
  } else for (const key of ['queues','enrichment','identification','names']) assert(args[key], `Required: --${key}`)
  assert(Number.isSafeInteger(args.limit) && args.limit >= 1 && args.limit <= 25, 'Create limit must be 1..25')
  assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(args.runId), 'Invalid run ID')
  assert(args.mode === 'offline' ? args.baseFile : !args.baseFile, 'Offline requires --base-file; live modes always read a fresh base')
  assert(args.mode !== 'write' || args.facts, 'Live creation requires --facts: complete evidence, dossier and bilingual copy')
  return args
}

/** Both projections are derived from the same actual fields, never independent files. */
export function projectBase(rows, today) {
  assert(Array.isArray(rows) && rows.length, 'Empty or invalid Airtable base')
  const snapshot = rows.map(({recordId, fields}) => ({ recordId, ...Object.fromEntries(Object.entries(FIELDS).filter(([k]) => !['website','isSystem'].includes(k)).map(([k,f]) => [k, fields[f] ?? (k === 'nameRu' ? '' : null)])) }))
  assertSnapshotRows(snapshot, 'JG live snapshot')
  const exportFields = Object.keys(FIELDS).filter(k => !['lat','lon','placeId'].includes(k))
  const exported = { contractVersion: AIRTABLE_EXPORT_SPEC, note: 'JG execution projection from one field read', baseId: AIRTABLE_BASE_ID, tableId: POI_TABLE_ID, fetchedAt: today, fields: exportFields.sort(), totalRecordCount: rows.length,
    records: rows.map(({recordId,fields}) => ({recordId,...Object.fromEntries(exportFields.filter(k => fields[FIELDS[k]] !== undefined && fields[FIELDS[k]] !== null && fields[FIELDS[k]] !== '').map(k => [k,fields[FIELDS[k]]]))})) }
  assertAirtableExport(exported)
  return { snapshot, exportBytes: Buffer.from(encode(exported)) }
}

/** Same-checkout exclusion. A crash leaves the lock as evidence; never steal it. */
export async function acquireIntakeLock(root, runId) {
  const file = path.join(root, 'active.lock')
  assertPathContainment(file, {insideDir:root})
  const handle = await open(file, 'wx')
  try { await handle.writeFile(encode({runId,pid:process.pid})); await handle.sync() }
  catch (error) { await handle.close(); throw error }
  return async () => { await handle.close(); await unlink(file) }
}

/** Only the common reconciler decides whether a previous uncertain effect is resolved. */
export async function reconcilePrevious(root, store, sourceKeys) {
  const reports = []
  const applied = new Set()
  for (const entry of await readdir(root, {withFileTypes:true})) {
    if (!entry.isDirectory()) continue
    const journal = path.join(root, entry.name, 'journal.ndjson')
    let report
    try { report = await reconcileWriteJournal(journal) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    if (!report.attempts.some(a => sourceKeys.has(a.sourceKey))) continue
    report = await reconcileWriteJournal(journal, {read: store.readFreshBySourceKey,readByPoiId:store.readFreshByPoiId})
    for (const attempt of report.attempts.filter(a => sourceKeys.has(a.sourceKey))) {
      const state = report.resolved.find(r => r.sourceKey === attempt.sourceKey)?.resolution ?? attempt.state
      assert(['verified','notApplied'].includes(state), `Recovery required: ${attempt.sourceKey}: ${state}; ${journal}`)
      if (state !== 'notApplied') applied.add(attempt.sourceKey)
    }
    reports.push(report)
  }
  return { reports, applied }
}

export async function runIntakeCli(argv = process.argv, deps = {}) {
  const args = parseIntakeArgs(argv)
  if (args.help) { console.log(USAGE); return {exitCode:0} }
  const repoRoot = await realpath(deps.repoRoot ?? REPO)
  const now = deps.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const today = startedAt.slice(0,10)
  // Freeze and validate all saved input bytes before opening the live store.
  const inputKeys = args.reviewSelection ? ['reviewSelection','identification'] : ['queues','enrichment','identification','names']
  if (args.facts) inputKeys.push('facts')
  const inputBytes = Object.fromEntries(await Promise.all(inputKeys.map(async k => [k,await readFile(path.resolve(args[k]))])))
  const docs = Object.fromEntries(inputKeys.filter(k=>k!=='names').map(k => [k,JSON.parse(inputBytes[k].toString('utf8'))]))
  const factRows = args.facts ? parseFactsPacket(docs.facts).rows : []
  if (args.reviewSelection) {
    reviewSelection(docs.reviewSelection)
    // Validate identification and prepare all selected rows before live I/O.
    prepareReviewedIntake(docs.reviewSelection,docs.identification,[],today)
  } else {
    assertReportDigest(docs.queues,'poi-japan-guide-queues/v1','queues')
    assertReportDigest(docs.enrichment,'poi-enrichment/v1','enrichment')
  }
  assertReportDigest(docs.identification,'poi-place-identification/v1','identification')
  const runRoot = path.join(repoRoot,'tmp','poi-jg-runs')
  assertPathContainment(runRoot,{insideDir:path.join(repoRoot,'tmp')})
  await ensureDurableDirectory(runRoot)
  const release = await acquireIntakeLock(runRoot,args.runId)
  let journal = null
  let runDir = null
  const report = {spec:JG_INTAKE_SPEC,runId:args.runId,mode:args.mode,startedAt,rows:[],outcomes:[],failure:null,effects:{get:0,post:0,patch:0,delete:0,google:0,model:0}}
  try {
    const newDir = path.join(runRoot,args.runId)
    await mkdir(newDir) // occupied run IDs cannot overwrite evidence or retry an approval
    await durableDirectory(runRoot)
    runDir = newDir
    const save = (name,value) => saveBytes(path.join(runDir,name),encode(value))
    for (const [k,bytes] of Object.entries(inputBytes)) await saveBytes(path.join(runDir,`${k}.json`),bytes)
    const namesLoaded = args.reviewSelection ? null : await loadNames(path.join(runDir,'names.json'))
    const before = await readCodeSnapshot({entry:JG_INTAKE_ENTRY})
    const identity = deps.codeIdentity ?? resolveCodeIdentityFromGit()
    const code = {...identity,...assertCodeSnapshotStable(before,before)}
    const portal = getPortal('japan-guide')
    let allowed = new Set()
    const transport = async (url,init={}) => {
      const u = new URL(url)
      const endpoint = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${POI_TABLE_ID}`
      assert([endpoint,`https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`].includes(u.origin+u.pathname),'Unexpected network target')
      const method = init.method ?? 'GET'
      if (method === 'GET') report.effects.get++
      else {
        assert.equal(args.mode,'write','Writes disabled')
        assert.equal(method,'POST','Only create is authorized')
        assert.equal(u.origin+u.pathname,endpoint)
        const {records} = JSON.parse(init.body)
        assert.equal(records.length,1)
        const fields = records[0].fields
        assert(allowed.has(fields['Source Key']),'Source key outside batch')
        assert(report.effects.post < args.limit,'Create budget exhausted')
        assert.equal(fields['Copy Status'],'Draft')
        assert.equal(fields['Fact Check Status'],'Todo')
        for (const f of ['Description (RU)','Description (EN)','Description Approved (RU)','Description Approved (EN)','Approved']) assert(!(f in fields),`Publication forbidden: ${f}`)
        allowed.delete(fields['Source Key'])
        report.effects.post++ // count before dispatch, including lost responses
      }
      return (deps.fetchImpl ?? fetch)(url,{...init,redirect:'error'})
    }
    const env = deps.env ?? process.env
    if (args.mode !== 'offline') assert(env.AIRTABLE_TOKEN?.trim(),'AIRTABLE_TOKEN required')
    const store = args.mode === 'offline' ? null : createAirtablePoiStore({token:env.AIRTABLE_TOKEN,baseId:AIRTABLE_BASE_ID,fetchImpl:transport})
    const raw = store ? await store.readAllFields(Object.values(FIELDS)) : JSON.parse(await readFile(args.baseFile,'utf8'))
    await save('base.json',raw)
    const {snapshot,exportBytes} = projectBase(raw,today)
    await save('existing-snapshot.json',snapshot)
    await saveBytes(path.join(runDir,'airtable-export.json'),exportBytes)
    const result = args.reviewSelection
      ? prepareReviewedIntake(docs.reviewSelection,docs.identification,snapshot,today)
      : runDryRun({...docs,exportBytes,baseSnapshot:snapshot,portal,evaluate:evaluatePortalCandidates,namesLoaded,today})
    const ingest = args.reviewSelection ? ingestReviewedPoi : ingestPoi
    report.rows = result.rows.map(r => ({...r,execution:r.outcome === 'writable' ? 'notSelected' : 'notOffered'}))
    const memory = createSnapshotStore(snapshot)
    const requests = []
    const proposed = []
    for (let request of result.requests) {
      const row = report.rows.find(r => r.sourceKey === keyOf(request))
      row.nameRu = request.poi.nameRu
      if (requests.length >= args.limit) continue
      if (args.facts) {
        const factRow = factRows.find(f => f.dossier.sourceKey === keyOf(request))
        try {
          assert(factRow, 'factsMissingForSource')
          assertFactsForRequest(factRow, request, {knownParent:isReviewedParent(keyOf(request))})
          assert(args.reviewSelection || factRow.dossier.sources.some(source => source.url === request.source.url), 'factsRequestSourceUrlMismatch')
        } catch (error) { row.execution = 'factsReviewRequired'; row.factsReason = error.message; continue }
        const d = factRow.dossier, copy = dossierCopy(d)
        request = { ...request, poi: { ...request.poi, factDossier: d, descriptionRu: copy.ru, descriptionEn: copy.en,
          ...(d.visit.hoursKind !== 'unknown' ? { workingHours: d.visit.hours } : {}),
          ...(d.website ? { website: d.website.url } : {}) } }
      }
      const rehearsal = await ingest(request,memory,{runId:args.runId})
      if (args.facts && rehearsal.outcome === 'created') {
        assert(rehearsal.fields['Description Draft (RU)'] && rehearsal.fields['Description Draft (EN)'], 'factsCopyDroppedByCanon')
        assert(!request.poi.workingHours || rehearsal.fields['Working Hours'], 'factsHoursDroppedByCanon')
        assert(!request.poi.website || rehearsal.fields.Website, 'factsWebsiteDroppedByCanon')
      }
      row.execution = rehearsal.outcome === 'created' ? 'prepared' : rehearsal.outcome
      row.poiId = rehearsal.poiId ?? null
      if (rehearsal.outcome === 'created') { requests.push(request); proposed.push(rehearsal.fields) }
    }
    // Bind every consumed file, including evidence and authored facts. The
    // former normal path hashed only queues, leaving a changed dossier invisible.
    const executionInputs = Buffer.from(encode(Object.fromEntries(inputKeys.map(k=>[k,{bytes:inputBytes[k].length,base64:inputBytes[k].toString('base64')}]))))
    await saveBytes(path.join(runDir,'execution-inputs.json'),executionInputs)
    const manifest0 = await buildDryRunManifest({startedAt,portal,queuesBytes:executionInputs,exportBytes,result,snapshotBefore:before,deps:{code}})
    const referenceManifest = buildRunManifest({...manifest0,mode:'snapshot',
      ...(args.reviewSelection?{portals:manifest0.portals.map(p=>({...p,adapter:{id:'japan-guide-review',version:JG_REVIEW_SPEC}}))}:{}),
      base:{...manifest0.base,existing:{...fileIdentity('existing-snapshot.json',Buffer.from(encode(snapshot))),records:snapshot.length,withSourceKey:snapshot.filter(r=>r.sourceKey).length}},
      names:args.reviewSelection?null:fileIdentity('names.json',inputBytes.names)})
    const reference = args.reviewSelection
      ? {spec:JG_REVIEW_SPEC,manifest:referenceManifest,rows:report.rows}
      : buildDryRunReport({result,...docs,manifest:referenceManifest,gate:preWriteGate({manifest:referenceManifest,mode:'snapshot'}),createdAt:startedAt,portal})
    await save('reference.json',reference)
    await save('requests.json',requests)
    await save('proposed-fields.json',proposed)
    report.prepared = requests.length
    report.baseRecords = snapshot.length
    if (args.mode === 'write') {
      const recovery = await reconcilePrevious(runRoot,store,new Set(args.reviewSelection?docs.reviewSelection.sourceKeys:docs.queues.queues.candidate.map(r=>r.sourceKey)))
      await save('reconciliation.json',recovery.reports)
      assert(!requests.some(request=>recovery.applied.has(keyOf(request))),'Previously applied source key disappeared from fresh base; reconcile before recreating')
    }
    if (args.mode === 'write' && requests.length) {
      const keys = new Set(requests.map(keyOf))
      await ensureTaxonomySchemaForWrite(store,true)
      const fresh = await store.readAllFields(Object.values(FIELDS))
      const sorted = rows => [...rows].sort((a,b)=>a.recordId.localeCompare(b.recordId))
      assert.deepEqual(sorted(fresh),sorted(raw),'Base drift before write')
      const after = await readCodeSnapshot({entry:JG_INTAKE_ENTRY})
      const currentCode = {...(deps.codeIdentity ?? resolveCodeIdentityFromGit()),...assertCodeSnapshotStable(before,after)}
      assert.equal(currentCode.dirty,false,'Commit verified code before live writes')
      const manifest = buildRunManifest({...referenceManifest,mode:'write',code:currentCode})
      const gate = preWriteGate({manifest,mode:'write',reference})
      assert.equal(gate.state,'PASS',encode(gate))
      const approval = parseWriteApproval({spec:'poi-write-approval/v2',scopeId:args.runId,portal:'japan-guide',issuedAt:now().toISOString(),expiresAt:new Date(now().getTime()+3600000).toISOString(),referenceDigest:sha256Bytes(Buffer.from(encode(reference))),sourceKeys:[...keys].sort(),maxCreates:requests.length,maxRenames:0,note:'Standing owner authorization VI, 2026-09-09: new Draft/Todo POIs; no publication. Agent prepares technical approval.'})
      assertWriteApprovalApplies({approval,now:now(),scopeId:args.runId,portal:'japan-guide',referenceDigest:approval.referenceDigest})
      await save('approval.json',approval)
      await claimWriteApproval(repoRoot,approval,{runId:args.runId,claimedAt:now().toISOString()})
      journal = await openWriteJournal({dir:runRoot,runId:args.runId,meta:{mode:'write',portals:['japan-guide'],attempted:requests.length}})
      allowed = keys
      const verified = withVerifiedWrites(store,{journal,maxRenames:0,onOutcome:row=>report.outcomes.push(row)})
      for (const request of requests) {
        const row = report.rows.find(r => r.sourceKey === keyOf(request))
        row.execution = 'attempting'
        const outcome = await ingest(request,verified,{runId:args.runId})
        row.execution = outcome.outcome
        row.poiId = outcome.poiId ?? null
        row.recordId = outcome.recordId ?? null
      }
    }
  } catch (error) {
    report.failure = describeThrownSafely(error)
    if (args.mode === 'write') for (const row of report.rows) {
      if (row.execution === 'attempting') row.execution = report.outcomes.find(o=>o.sourceKey===row.sourceKey)?.state ?? 'interrupted'
      else if (row.execution === 'prepared') row.execution = 'notAttempted'
    }
  } finally {
    if (journal) { try { await journal.finish() } catch (e) { report.failure = describeThrownSafely(e) } }
    try {
      if (runDir) {
        report.finishedAt = now().toISOString()
        report.counts = Object.fromEntries([...new Set(report.rows.map(r=>r.execution))].map(k=>[k,report.rows.filter(r=>r.execution===k).length]))
        report.candidateCounts = Object.fromEntries([...new Set(report.rows.map(r=>r.outcome))].map(k=>[k,report.rows.filter(r=>r.outcome===k).length]))
        await saveBytes(path.join(runDir,'report.json'),encode(report))
      }
    } finally { await release() }
  }
  const created = report.rows.filter(r=>r.execution==='created').map(r=>({poiId:r.poiId,name:r.nameRu,sourceKey:r.sourceKey}))
  console.log(`Japan Guide: ${encode({runDir,created,candidates:report.candidateCounts,execution:report.counts,effects:report.effects,failure:report.failure}).trim()}`)
  return {report,runDir,exitCode:report.failure ? 1 : 0}
}

if (isDirectEntry(process.argv[1],import.meta.url)) {
  try {
    const args = parseIntakeArgs(process.argv)
    if (['write','live-read'].includes(args.mode)) {
      try { process.loadEnvFile(path.join(REPO,'.env.local')) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const result = await runIntakeCli(); process.exitCode = result.exitCode
  }
  catch (error) { console.error(describeThrownSafely(error)); process.exitCode=1 }
}
