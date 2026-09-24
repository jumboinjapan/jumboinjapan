#!/usr/bin/env node
/** Source reads also register the selected work in Review. Discovery/replay remain read-only/offline. */
import assert from 'node:assert/strict'
import {registerSourceSelection,finishSourceSelection} from './lib/review-selection.mjs'
import path from 'node:path'
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises'
import {isDirectEntry} from '../lib/direct-entry.mjs'
import {getPortal} from './registry.mjs'
import {evaluatePortalIntakeBatch,readCodeSnapshot,assertCodeSnapshotStable} from './collect-pois.mjs'
import {readHokkaidoPlaces,discoverHokkaido} from './lib/visit-hokkaido-reader.mjs'
import {buildHokkaidoBundle,buildHokkaidoIntake,hokkaidoExpectedInput,hokkaidoResearchRows,hokkaidoPairUrls,hokkaidoUrl} from './lib/visit-hokkaido.mjs'

const ENTRY='scripts/poi-portals/read-visit-hokkaido.mjs'
const usage='poi:hokkaido -- discover OUT_DIR [PAGES_PER_LANGUAGE] | read URLS_JSON OUT_DIR | replay BUNDLE_JSON OUT_DIR'
export async function runHokkaidoCli(argv,deps={}){
  const [mode,input,output,limit]=argv
  assert(['discover','read','replay'].includes(mode),usage)
  assert(mode==='discover'?(argv.length===2||argv.length===3):argv.length===3,usage)
  assert(!limit,usage)
  const maxPagesPerLocale=mode==='discover'?Number(output??100):null
  if(mode==='discover')assert(Number.isSafeInteger(maxPagesPerLocale)&&maxPagesPerLocale>0&&maxPagesPerLocale<=100,'hokkaidoIndexPageLimit')
  const data=mode==='discover'?null:JSON.parse(await readFile(input,'utf8'))
  if(mode==='read'){
    assert(Array.isArray(data)&&data.length>0&&data.length<=100,'hokkaidoSelection')
    assert.equal(new Set(data.map(u=>hokkaidoPairUrls(u)[0])).size,data.length,'hokkaidoSelectionDuplicate')
  }
  const target=path.resolve(mode==='discover'?input:output)
  const parent=await realpath(path.dirname(target))
  const out=path.join(parent,path.basename(target))
  // Exclusive reservation before any network; no overwrite or recursive deletion.
  await mkdir(out)
  const save=(name,doc)=>writeFile(path.join(out,name),JSON.stringify(doc,null,2)+'\n',{flag:'wx'})
  const before=await readCodeSnapshot({entry:ENTRY})
  let review = null
  let pageNumber=0
  const onPage=async result=>{await save(`page-${String(++pageNumber).padStart(4,'0')}.json`,result)}
  try{
    if(mode==='discover'){
      const discovery=await discoverHokkaido({...deps,maxPagesPerLocale,onPage})
      const code=assertCodeSnapshotStable(before,await readCodeSnapshot({entry:ENTRY}))
      await save('discovery.json',discovery);await save('code.json',code)
      return {out,complete:discovery.complete,records:discovery.records.length,locales:discovery.locales.map(({locale,observed,reportedTotal,complete})=>({locale,observed,reportedTotal,complete}))}
    }
    if(mode==='read') review=await registerSourceSelection(data.map(url=>({sourceKey:hokkaidoUrl(url).sourceKey,sourceUrl:url})),out,deps)
    const result=mode==='read'?await readHokkaidoPlaces(data,{...deps,onPage}):{bundle:buildHokkaidoBundle(data.pages,data.attempts),network:null}
    if(mode==='replay')assert.deepEqual(result.bundle,data,'hokkaidoReplayProjectionDrift')
    const batch=buildHokkaidoIntake(result.bundle)
    const evaluation=evaluatePortalIntakeBatch(getPortal('visit-hokkaido'),batch,hokkaidoExpectedInput(result.bundle))
    const code=assertCodeSnapshotStable(before,await readCodeSnapshot({entry:ENTRY}))
    await save('bundle.json',result.bundle)
    await save('intake.json',batch)
    await save('research.json',{spec:'poi-visit-hokkaido-research/v1',bundleDigest:result.bundle.digest,rows:hokkaidoResearchRows(result.bundle)})
    await save('evaluation.json',evaluation)
    if(mode==='read') {
      const finished=await finishSourceSelection(result.bundle.rows.map(r=>({sourceKey:r.sourceKey,name:r.cards.find(c=>c.locale==='en')?.name||r.cards[0]?.name,ok:r.state==='collected',reason:r.attempts.filter(a=>a.outcome!=='fetched').map(a=>`${a.url}: ${a.outcome}${a.detail ? ' — '+a.detail : ''}`).join('; ')})),out,deps)
      review={selected:review.selected,verified:review.verified+finished.verified}
    }
    await save('run.json',{spec:'poi-visit-hokkaido-run/v1',code,network:result.network,counts:result.bundle.counts,review,effects:{airtableReviewEvents:review?.verified??0,poiWrites:0,googleApi:0,model:0},readyForWrite:false})
    return {out,counts:result.bundle.counts,intake:evaluation.counts,readyForWrite:false}
  }catch(error){await save('failure.json',{message:error.message,pagesSaved:pageNumber});throw error}
}
if(isDirectEntry(process.argv[1],import.meta.url)){
  try{
    if(process.argv[2]==='--help')console.log(usage)
    else {
      if(process.argv[2]==='read')process.loadEnvFile('.env.local')
      const result=await runHokkaidoCli(process.argv.slice(2))
      console.log(JSON.stringify(result,null,2))
      if(result.complete===false || result.counts?.incomplete>0)process.exitCode=2
    }
  }
  catch(error){console.error(error.message);process.exitCode=1}
}
