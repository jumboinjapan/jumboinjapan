/** Produces the copywriter's complete local job. It neither invents prose nor calls a model. */
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {isDirectEntry} from '../lib/direct-entry.mjs'
import {buildCopyBrief,assertCopyReview} from './lib/poi-copywriter.mjs'
import {mergePortalFacts} from './lib/poi-fact-sync.mjs'

export async function preparePoiCopy(argv) {
  const [mode,input,output]=argv
  assert(argv.length===3 && ['brief','merge','check'].includes(mode),'Usage: poi:copy-brief -- brief DOSSIER OUTPUT | merge SYNC_ROW OUTPUT | check DOSSIER REVIEW')
  const raw=JSON.parse(await readFile(input,'utf8'))
  const dossier=mode==='merge'?mergePortalFacts(raw).dossier:raw
  if(mode==='check') {assertCopyReview(JSON.parse(await readFile(output,'utf8')),dossier);return {checked:true}}
  const brief=buildCopyBrief(dossier)
  await writeFile(output,JSON.stringify(brief,null,2)+'\n',{flag:'wx'})
  return {output,sourceKey:brief.sourceKey,policy:brief.policy.version}
}
if(isDirectEntry(process.argv[1],import.meta.url)) {
  try {console.log(JSON.stringify(await preparePoiCopy(process.argv.slice(2))))}
  catch(e){console.error(e.message);process.exitCode=1}
}
