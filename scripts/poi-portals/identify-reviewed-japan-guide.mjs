#!/usr/bin/env node
/** Recorded owner decisions → the shared Google resolver, with sourced aliases and reuse. */
import assert from 'node:assert/strict'
import {readFile,writeFile,open,appendFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {isDirectEntry} from '../lib/direct-entry.mjs'
import {resolvePlace} from '../../src/lib/place-resolve.ts'
import {reviewIdentificationQueue,reviewCatalogDigest,prepareReviewedIntake} from './lib/japan-guide-review.mjs'
import {runIdentification,buildIdentificationReport,MAX_DIAGNOSTIC_CALLS} from './lib/place-identification.mjs'
import {assertReportDigest} from './lib/enrichment.mjs'
import {describeThrownSafely} from '../../src/lib/thrown-value.ts'

export async function runReviewedIdentification({selectionFile,out,reuseFile=null,limit=20,priceMicros=null,live=false},deps={}) {
  assert(selectionFile && out,'Required: --selection FILE --out FILE')
  assert(Number.isSafeInteger(limit) && limit>=0 && limit<=MAX_DIAGNOSTIC_CALLS,'Limit must be 0..20')
  assert(!live || (Number.isSafeInteger(priceMicros) && priceMicros>=0),'Live lookup needs declared --price-micros')
  const now=deps.now??(()=>new Date()),today=now().toISOString().slice(0,10)
  const selection=JSON.parse(await readFile(selectionFile,'utf8'))
  const queue=reviewIdentificationQueue(selection)
  let reusable=[]
  if(reuseFile) {
    const prior=JSON.parse(await readFile(reuseFile,'utf8'))
    assertReportDigest(prior,'poi-place-identification/v1','reuse report')
    prepareReviewedIntake(selection,prior,[],today) // same subject, catalog, coordinates and retention
    reusable=prior.rows.filter(r=>r.outcome==='resolved' && r.place.coordinates.observedOn<=today && r.place.coordinates.validUntil>=today && queue.some(q=>q.sourceKey===r.sourceKey))
      .map(r=>({...r,attempts:[],called:false,reusedFrom:{file:reuseFile,digest:prior.reportDigest}}))
  }
  const reused=new Map(reusable.map(r=>[r.sourceKey,r]))
  const pending=queue.filter(r=>!reused.has(r.sourceKey))
  if(!live) {
    const result={spec:'poi-japan-guide-reviewed-search-plan/v1',queue:queue.length,reused:reused.size,pending:pending.map(r=>({sourceKey:r.sourceKey,nameJa:r.nameJa,nameJaAlternative:r.nameJaAlternative,siteCity:r.siteCity})),callsAtMost:Math.min(limit,pending.length*4),effects:{google:0}}
    await writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result
  }
  const apiKey=(deps.env??process.env).GOOGLE_PLACES_API_KEY;assert(apiKey?.trim(),'GOOGLE_PLACES_API_KEY required')
  // Claim the final path before paying; a failed/interrupted run preserves both files.
  const output=await open(out,'wx',0o600)
  try {
    const journal=path.resolve(out)+'.attempts.ndjson',handle=await open(journal,'wx',0o600);await handle.close()
    const result=await runIdentification({queue:pending,limit,now,resolve:deps.resolve??(q=>resolvePlace(q,{apiKey})),onAttempt:e=>appendFile(journal,JSON.stringify(e)+'\n')})
    const newRows=new Map(result.rows.map(r=>[r.sourceKey,r]))
    const rows=queue.map(r=>reused.get(r.sourceKey)??newRows.get(r.sourceKey))
    const report=buildIdentificationReport({queue,result:{rows,calls:result.calls},limit,priceMicros,createdAt:now().toISOString(),inputs:{reviewCatalog:{digest:reviewCatalogDigest},selectionFile,reuseFile,actualCharge:null}})
    await output.writeFile(JSON.stringify(report,null,2)+'\n');await output.sync();return report
  }finally{await output.close()}
}
if(isDirectEntry(process.argv[1],import.meta.url)) {
  try {
    const args={},seen=new Set(),flags={'--selection':'selectionFile','--out':'out','--reuse':'reuseFile','--limit':'limit','--price-micros':'priceMicros'}
    for(let i=2;i<process.argv.length;i++) {
      const flag=process.argv[i];assert(!seen.has(flag),'Repeated flag');seen.add(flag)
      if(flag==='--live')args.live=true
      else {assert(flags[flag],'Unknown flag');const value=process.argv[++i];assert(value&&!value.startsWith('--'),'Missing value');args[flags[flag]]=['--limit','--price-micros'].includes(flag)?Number(value):value}
    }
    if(args.live)process.loadEnvFile(fileURLToPath(new URL('../../.env.local',import.meta.url)))
    const result=await runReviewedIdentification(args)
    console.log(JSON.stringify({counts:result.counts??{queue:result.queue,reused:result.reused,pending:result.pending.length},googleCalls:result.spend?.calls??0,actualCharge:null,out:args.out},null,2))
  }catch(error){console.error(describeThrownSafely(error));process.exitCode=1}
}
