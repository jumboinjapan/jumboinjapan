#!/usr/bin/env node
/** Agent-authored facts + RU/EN copy → existing Japan Guide drafts, under owner VI.
 * Deliberately a batch completion step: no scraper, model or second ingest path. */
import assert from 'node:assert/strict'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, mkdir, open, realpath, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isDirectEntry } from '../lib/direct-entry.mjs'
import { canonicalJsonBytes, assertExactKeys, deepFreeze } from '../lib/canonical-contract.mjs'
import { assertPathContainment } from '../lib/path-boundary.mjs'
import { sha256Bytes } from '../lib/byte-digest.mjs'
import { AIRTABLE_BASE_ID, POI_TABLE_ID } from '../../src/lib/airtable-schema.ts'
import { describeThrownSafely } from '../../src/lib/thrown-value.ts'
import { createAirtablePoiStore } from './lib/airtable-store.mjs'
import { acquireIntakeLock } from './intake-japan-guide.mjs'
import { ensureDurableDirectory, durableDirectory } from './lib/write-journal.mjs'
import { buildUpdateCard, updateCardDigest } from './lib/update-card.mjs'
import { parseUpdateApproval, assertUpdateApprovalApplies, claimUpdateApproval } from './lib/update-approval.mjs'
import { openUpdateJournal } from './lib/update-journal.mjs'
import { withVerifiedUpdates } from './lib/verified-update.mjs'
import { fieldEquals } from './lib/verified-write.mjs'
import { reconcileUpdateJournal } from './reconcile-writes.mjs'
import { parseReviewLinks, reviewLinkProposal, REVIEW_LINK_SPEC } from './lib/japan-guide-review.mjs'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
export const COPY_SPEC = 'poi-japan-guide-copy/v1'
export const COPY_FIELDS = Object.freeze(['Description Draft (RU)','Description Draft (EN)','Notes'])
const encode = v => `${JSON.stringify(v,null,2)}\n`
const nonempty = v => typeof v === 'string' && v.trim() === v && v.length > 0

export function parseCopyPacket(raw) {
  canonicalJsonBytes(raw,COPY_SPEC) // reject accessors, hidden keys, invalid Unicode before projection
  assertExactKeys(raw,['spec','rows'],COPY_SPEC)
  assert.equal(raw.spec,COPY_SPEC,'Unknown copy packet version')
  assert(Array.isArray(raw.rows) && raw.rows.length > 0 && raw.rows.length <= 25,'Copy batch must contain 1..25 rows')
  const ids=new Set(), keys=new Set()
  for (const row of raw.rows) {
    assertExactKeys(row,['recordId','sourceKey','nameRu','descriptionRu','descriptionEn','facts'],'copy row')
    assert(/^rec[A-Za-z0-9]{14}$/.test(row.recordId),'Invalid record ID')
    assert(typeof row.sourceKey === 'string' && /^japan-guide:[A-Za-z0-9_-]+$/.test(row.sourceKey),'Japan Guide source key required')
    assert(!ids.has(row.recordId) && !keys.has(row.sourceKey),'Duplicate copy target')
    ids.add(row.recordId); keys.add(row.sourceKey)
    for (const f of ['nameRu','descriptionRu','descriptionEn']) assert(nonempty(row[f]) && row[f].length <= 2000,`Invalid ${f}`)
    assert(Array.isArray(row.facts) && row.facts.length > 0 && row.facts.length <= 12,'Source facts required')
    for (const fact of row.facts) {
      assertExactKeys(fact,['text','sourceUrl','checkedOn'],'copy fact')
      assert(nonempty(fact.text) && fact.text.length <= 600,'Invalid fact text')
      assert(nonempty(fact.sourceUrl) && /^https:\/\//.test(fact.sourceUrl),'HTTPS fact source required')
      const u=new URL(fact.sourceUrl); assert(!u.username && !u.password && u.hostname,'Invalid fact URL')
      assert(typeof fact.checkedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fact.checkedOn) && new Date(fact.checkedOn).toISOString().slice(0,10) === fact.checkedOn,'Invalid fact date')
    }
  }
  return deepFreeze(raw)
}

export function copyProposal(row,found) {
  assert(found?.recordId === row.recordId && found.fields,'Copy target missing')
  const f=found.fields
  assert.equal(f['Source Key'],row.sourceKey,'Copy source mismatch')
  assert.equal(f['POI Name (RU)'],row.nameRu,'Copy name drift')
  assert.equal(f['Copy Status'],'Draft','Copy target is not Draft')
  assert.equal(f['Fact Check Status'],'Todo','Copy target is not Todo')
  for (const [field,value] of [[COPY_FIELDS[0],row.descriptionRu],[COPY_FIELDS[1],row.descriptionEn]]) {
    assert(!f[field] || f[field] === value,`Existing copy conflict: ${field}`)
  }
  const marker=`FACTS ${COPY_SPEC} ${sha256Bytes(canonicalJsonBytes(row,COPY_SPEC))}`
  const notes=f.Notes ?? ''
  assert(typeof notes === 'string','Notes must be text')
  const block=[marker,...row.facts.map((fact,i)=>`${i+1}. ${fact.text}\nИсточник: ${fact.sourceUrl}\nПроверено: ${fact.checkedOn}`),'END FACTS'].join('\n')
  assert(!notes.includes(marker) || notes.includes(block),'Fact dossier conflict')
  return {recordId:row.recordId,proposed:{[COPY_FIELDS[0]]:row.descriptionRu,[COPY_FIELDS[1]]:row.descriptionEn,Notes:notes.includes(block)?notes:[notes,block].filter(Boolean).join('\n\n')}}
}

export async function runCopy({packetFile,runId=`jg-copy-${randomUUID()}`,write=false},deps={}) {
  assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(runId),'Invalid run ID')
  const bytes=await readFile(packetFile)
  const rawPacket=JSON.parse(bytes.toString('utf8'))
  const links=rawPacket.spec === REVIEW_LINK_SPEC
  const packet=links?parseReviewLinks(rawPacket):parseCopyPacket(rawPacket)
  const fieldsAllowed=links?['Parent POI','Notes']:COPY_FIELDS
  const repo=await realpath(deps.repoRoot??REPO)
  const root=path.join(repo,'tmp','poi-jg-copy-runs'), locks=path.join(repo,'tmp','poi-jg-runs')
  for(const dir of [root,locks]) { assertPathContainment(dir,{insideDir:path.join(repo,'tmp')});await ensureDurableDirectory(dir) }
  const release=await acquireIntakeLock(locks,runId)
  let dir=null,journal=null
  const report={runId,packetDigest:sha256Bytes(bytes),write,rows:packet.rows.map(r=>({recordId:r.recordId,sourceKey:r.sourceKey,nameRu:r.nameRu,state:'notStarted'})),effects:{get:0,patch:0},failure:null}
  try {
    const target=path.join(root,runId);await mkdir(target);await durableDirectory(root);dir=target
    const save=async(name,value)=>{const h=await open(path.join(dir,name),'wx');try{await h.writeFile(encode(value));await h.sync()}finally{await h.close()}await durableDirectory(dir)}
    await save('packet.json',packet)
    const targets=new Map(packet.rows.map(r=>[r.recordId,r]))
    const allowed=new Map()
    const originalsById=new Map()
    let store
    const endpoint=`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${POI_TABLE_ID}/`
    const transport=async(url,init={})=>{
      const u=new URL(url), recordId=u.pathname.split('/').at(-1),method=init.method??'GET'
      assert.equal(u.origin+u.pathname,endpoint+recordId,'Unexpected copy network target')
      assert(targets.has(recordId) || (links && method==='GET' && /^rec[A-Za-z0-9]{14}$/.test(recordId)),'Record outside copy batch')
      if(method==='GET') { u.search=''; report.effects.get++ }
      else {
        assert(write && method==='PATCH','Only explicitly enabled PATCH allowed')
        const fields=JSON.parse(init.body).fields
        assert(allowed.has(recordId),'PATCH not armed or already used')
        assert.deepEqual(fields,allowed.get(recordId),'PATCH differs from approved copy fields')
        assert(Object.keys(fields).every(f=>fieldsAllowed.includes(f)),'Non-copy field forbidden')
        assert(report.effects.patch<packet.rows.length,'Copy PATCH budget exhausted')
        const fresh=await store.readFreshByRecordId(recordId)
        await proposal(targets.get(recordId),fresh)
        assert.deepEqual(fresh.fields,originalsById.get(recordId).fields,'Copy record drift at PATCH')
        allowed.delete(recordId);report.effects.patch++
      }
      return (deps.fetchImpl??fetch)(u,{...init,redirect:'error'})
    }
    store=createAirtablePoiStore({token:(deps.env??process.env).AIRTABLE_TOKEN,baseId:AIRTABLE_BASE_ID,fetchImpl:transport})
    const proposal=async(row,found)=>{
      if(!links)return copyProposal(row,found)
      const parent=await store.readFreshByRecordId(row.parentRecordId)
      const pending=[parent],seen=new Set([row.recordId])
      while(pending.length) {
        const current=pending.pop()
        assert(current?.fields && !seen.has(current.recordId),'Missing parent or parent cycle')
        seen.add(current.recordId);assert(seen.size <= 64,'Parent hierarchy too deep')
        const ids=current.fields['Parent POI']??[];assert(Array.isArray(ids) && ids.every(id=>/^rec[A-Za-z0-9]{14}$/.test(id)),'Invalid parent chain')
        for(const id of ids)pending.push(await store.readFreshByRecordId(id))
      }
      return reviewLinkProposal(row,found,parent)
    }
    // Recovery of this command's prior updates uses the common reconciler, by record ID.
    if(write) for(const previous of await readdir(root,{withFileTypes:true})) {
      if(!previous.isDirectory() || previous.name===runId) continue
      let prior
      try { prior=JSON.parse(await readFile(path.join(root,previous.name,'packet.json'),'utf8')) } catch(e){if(e.code==='ENOENT')continue;throw e}
      if(!prior.rows.some(r=>targets.has(r.recordId)))continue
      const file=path.join(root,previous.name,'journal.ndjson')
      try {
        const recovered=await reconcileUpdateJournal(file,{readByRecordId:(id,fields)=>targets.has(id)?store.readFreshByRecordId(id,fields):null})
        await save(`reconciled-${previous.name}.json`,recovered)
        assert(recovered.resolved.filter(r=>targets.has(r.recordId)).every(r=>['verified','notApplied'].includes(r.resolution)),'Previous copy update needs reconciliation')
      } catch(e){if(e.code!=='ENOENT')throw e}
    }
    const originals=[]
    // Full records retain publication/status evidence without assuming optional schema columns.
    for(const row of packet.rows) {
      const found=await store.readFreshByRecordId(row.recordId)
      await proposal(row,found);originals.push(found);originalsById.set(row.recordId,found)
    }
    await save('before.json',originals)
    const {card,skipped}=buildUpdateCard({scopeId:runId,portal:'japan-guide',createdAt:new Date().toISOString(),note:links?'Owner comments: recorded parent links; public fields unchanged':'Owner VI: fill empty draft copy and preserve sourced facts; no publication',observations:originals,proposals:await Promise.all(packet.rows.map((r,i)=>proposal(r,originals[i])))})
    await save('card.json',card)
    for(const row of report.rows) row.state=skipped.some(s=>s.recordId===row.recordId)?'noChange':'prepared'
    if(write && card) {
      const now=new Date()
      const approval=parseUpdateApproval({spec:'poi-update-approval/v1',scopeId:runId,portal:'japan-guide',issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+3600000).toISOString(),cardDigest:updateCardDigest(card),fields:[...fieldsAllowed].sort(),maxUpdates:card.rows.length,note:links?'Owner comments: apply recorded parent links':'Owner VI and 2026-09-09 request: agent completes draft copy without per-card approval'})
      assertUpdateApprovalApplies({approval,card,now,scopeId:runId,portal:'japan-guide'})
      await save('approval.json',approval);await claimUpdateApproval(repo,approval,{runId,claimedAt:now.toISOString()})
      journal=await openUpdateJournal({dir:root,runId,meta:{cardDigest:updateCardDigest(card)}})
      const verified=withVerifiedUpdates(store,{journal,maxUpdates:card.rows.length,onOutcome:o=>Object.assign(report.rows.find(r=>r.recordId===o.recordId),o)})
      for(const row of card.rows) {
        // Status, identity and previous text/notes rechecked immediately before the common boundary.
        const fresh=await store.readFreshByRecordId(row.recordId)
        const original=originals.find(r=>r.recordId===row.recordId)
        await proposal(targets.get(row.recordId),fresh)
        assert.deepEqual(fresh.fields,original.fields,'Copy record drift before PATCH')
        allowed.set(row.recordId,row.proposed)
        const outcome=await verified.update(row)
        assert(['verified','noChange'].includes(outcome.state),`Copy series stopped: ${outcome.state}`)
        const after=await store.readFreshByRecordId(row.recordId)
        for(const f of new Set([...Object.keys(original.fields),...Object.keys(after.fields)])) {
          assert(fieldEquals(after.fields[f],Object.hasOwn(row.proposed,f)?row.proposed[f]:original.fields[f]),`Post-copy field mismatch: ${f}`)
        }
        await save(`after-${row.recordId}.json`,after)
      }
    }
  } catch(error) {report.failure=describeThrownSafely(error)}
  finally {
    try {
      if(journal) {try{await journal.finish()}catch(e){report.failure=describeThrownSafely(e)}}
      if(dir) {const h=await open(path.join(dir,'report.json'),'wx');try{await h.writeFile(encode(report));await h.sync()}finally{await h.close()}}
    } finally {await release()}
  }
  console.log(encode({dir,...report}))
  return {report,dir,exitCode:report.failure?1:0}
}

if(isDirectEntry(process.argv[1],import.meta.url)) {
  try {
    const argv=process.argv.slice(2), options={};const seen=new Set()
    for(let i=0;i<argv.length;i++) {
      const flag=argv[i];assert(!seen.has(flag),'Repeated flag');seen.add(flag)
      if(flag==='--write')options.write=true
      else {assert(['--packet','--run-id'].includes(flag),`Unknown flag: ${flag}`);const value=argv[++i];assert(value && !value.startsWith('--'),'Missing value');options[flag==='--packet'?'packetFile':'runId']=value}
    }
    assert(options.packetFile,'Usage: npm run poi:jg-copy -- --packet FILE [--write] [--run-id ID]')
    process.loadEnvFile(path.join(REPO,'.env.local'))
    process.exitCode=(await runCopy(options)).exitCode
  } catch(e){console.error(describeThrownSafely(e));process.exitCode=1}
}
