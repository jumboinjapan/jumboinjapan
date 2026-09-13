/** Offline, bytes-first adapter entry. Fetching remains behind the shared source policy. */
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {isDirectEntry} from '../lib/direct-entry.mjs'
import {sha256Bytes} from '../lib/byte-digest.mjs'
import {parsePortalEvidence} from './lib/japan-guide-evidence.mjs'

export async function readPortalEvidence(argv) {
  assert(argv.length===2,'Usage: poi:evidence -- INPUT_MANIFEST OUTPUT')
  const config=JSON.parse(await readFile(argv[0],'utf8'))
  const {file,url,observedAt,sourceKey,rootSelector,role}=config
  const rawBytes=await readFile(file)
  const evidence=parsePortalEvidence({url,observedAt,rawBytes,rawPageDigest:sha256Bytes(rawBytes)},{sourceKey,rootSelector,role})
  await writeFile(argv[1],JSON.stringify(evidence,null,2)+'\n',{flag:'wx'})
  return {sourceKey,blocks:evidence.blocks.length,output:argv[1]}
}
if(isDirectEntry(process.argv[1],import.meta.url)) {
  try {console.log(JSON.stringify(await readPortalEvidence(process.argv.slice(2))))}
  catch(e){console.error(e.message);process.exitCode=1}
}
