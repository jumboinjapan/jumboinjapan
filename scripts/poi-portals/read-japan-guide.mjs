#!/usr/bin/env node
/** Production replacement for ad-hoc paragraph readers. Explicit GET-only mode;
 * each completed page is saved immediately so later failure loses no evidence. */
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isDirectEntry } from '../lib/direct-entry.mjs'
import { dossierSkeleton } from './lib/japan-guide-facts.mjs'
import { sha256Bytes } from '../lib/byte-digest.mjs'
import { readJapanGuideEvidence, parseJapanGuideEvidence, assertEvidence } from './lib/japan-guide-evidence.mjs'
export async function runEvidenceCli(argv = process.argv, deps = {}) {
  const options = {}, seen = new Set()
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i]
    assert(!seen.has(flag), 'Repeated option'); seen.add(flag)
    if (flag === '--live') options.live = true
    else { assert(['--selection','--replay','--out'].includes(flag), `Unknown option ${flag}`); options[flag.slice(2)] = argv[++i] }
  }
  assert(options.out && (options.replay ? !options.live && !options.selection : options.live && options.selection), 'Usage: --selection FILE --out NEW_DIRECTORY --live; or --replay PRIOR_DIRECTORY --out NEW_DIRECTORY (offline)')
  const dir = path.resolve(options.out)
  await mkdir(dir) // never overwrite another run
  const save = async (e, page) => {
    await writeFile(path.join(dir, `${e.sourceKey.replace(':','-')}.html`), page.rawBytes, {flag:'wx'})
    await writeFile(path.join(dir, `${e.sourceKey.replace(':','-')}.json`), JSON.stringify(e,null,2)+'\n', {flag:'wx'})
    await writeFile(path.join(dir, `${e.sourceKey.replace(':','-')}.authoring.json`), JSON.stringify(dossierSkeleton(e),null,2)+'\n', {flag:'wx'})
    console.log(`${e.sourceKey}: ${e.blocks.length} blocks, ${e.blocks.filter(b=>b.kind==='notice').length} notices`)
  }
  let report
  if (options.replay) {
    const previous = JSON.parse(await readFile(path.join(options.replay,'report.json'),'utf8'))
    const rows=[]
    for (const raw of previous.rows) {
      const e=assertEvidence(raw)
      const bytes=await readFile(path.join(options.replay, `${e.sourceKey.replace(':','-')}.html`))
      assert.equal(sha256Bytes(bytes),e.rawPageDigest,'Replay raw bytes changed')
      const page={url:e.sourceUrl,observedAt:e.observedAt,rawPageDigest:e.rawPageDigest,rawBytes:bytes}
      const next=parseJapanGuideEvidence(page);await save(next,page);rows.push(next)
    }
    report={spec:'poi-japan-guide-evidence-batch/v1',rows,failures:previous.failures,networkRequests:0}
  } else {
    const raw = JSON.parse(await readFile(options.selection, 'utf8'))
    const selection = raw.queue ?? raw.rows ?? raw
    assert(Array.isArray(selection), 'Selection must contain a queue')
    const subjects = selection.map(r => ({ sourceKey: r.sourceKey, sourceUrl: r.sourceUrl ?? r.url }))
    report = await readJapanGuideEvidence(subjects, { ...deps, onPage: save })
  }
  await writeFile(path.join(dir, 'report.json'), JSON.stringify(report,null,2)+'\n', {flag:'wx'})
  console.log(JSON.stringify({pages:report.rows.length,failures:report.failures,networkRequests:report.networkRequests,dir}))
  return { report, exitCode: report.failures.length ? 1 : 0 }
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try { process.exitCode = (await runEvidenceCli()).exitCode } catch (e) { console.error(e.message); process.exitCode = 1 }
}
