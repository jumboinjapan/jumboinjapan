/** Offline derivation of bounded public POI facts; never exports raw Notes/recordIds. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {readPoiFacts, assertPoiFacts} from '../src/lib/poi-facts.ts'
import {matrixProperty} from '../src/lib/poi-matrix-registry.ts'
import {canonicalJsonBytes} from './lib/canonical-contract.mjs'
import {sha256Bytes} from './lib/byte-digest.mjs'
import {dossierDigest} from './poi-portals/lib/japan-guide-facts.mjs'
import {buildPoiMatrix} from './poi-portals/lib/poi-matrix.mjs'

export function deriveMatrixFixtures(base,annotations,baseDigest){
  canonicalJsonBytes(annotations,'poi-matrix-annotations/v1')
  assert.equal(annotations.spec,'poi-matrix-annotations/v1')
  assert(new Set(annotations.rows.map(r=>r.poiId)).size===annotations.rows.length,'fixtureDuplicatePoi')
  const now=base.observedAt
  const fixtures=annotations.rows.map(annotation=>{
    const records=base.rows.filter(r=>r.fields['POI ID']===annotation.poiId)
    assert.equal(records.length,1,'fixtureRecordIdentity')
    const original=records[0].fields
    const fields=Object.fromEntries(['POI ID','POI Name (RU)','Source Key','POI Type','POI Facets','Type Source','Taxonomy Version','POI Category (RU)'].filter(k=>Object.hasOwn(original,k)).map(k=>[k,original[k]]))
    const parsed=readPoiFacts(original.Notes??'')
    assert(!parsed.error,'fixtureCorruptDossier')
    if(annotation.properties===null){
      return {poiId:annotation.poiId,kind:'legacy',context:{fields},claims:null,sourceDossierDigest:parsed.dossier?dossierDigest(parsed.dossier):null}
    }
    const source=parsed.dossier
    assert(source,'fixtureDossierMissing')
    const chosen=new Set([...Object.values(annotation.properties).flat(),...source.visit.factIds,...source.facts.filter(f=>f.category==='notice').map(f=>f.id)])
    if(!chosen.size)chosen.add(source.facts.find(f=>f.subject===original['POI Name (RU)']).id)
    for(const id of chosen)assert(source.facts.some(f=>f.id===id),'fixtureUnknownFact')
    const facts=source.facts.filter(f=>chosen.has(f.id))
    const referenced=new Set(facts.flatMap(f=>f.references.map(r=>`${r.source}:${r.blockId}`)))
    const sources=source.sources.map((s,index)=>{
      let blocks=s.blocks.filter(b=>referenced.has(`${index}:${b.id}`))
      if(!blocks.length){
        const unused=s.blocks.find(b=>b.kind!=='notice')
        assert(unused,'fixtureUnusedNoticeSource')
        blocks=[unused]
      }
      return {...s,blocks}
    })
    const dossier=assertPoiFacts({spec:'poi-facts/v2',sourceKey:source.sourceKey,updatedAt:source.updatedAt,history:[],sources,facts,
      coverage:sources.flatMap((s,index)=>s.blocks.map(b=>({source:index,blockId:b.id,disposition:referenced.has(`${index}:${b.id}`)?'facts':'irrelevant',reason:'Derived test fixture; omitted unrelated facts and source blocks.'}))),
      visit:source.visit,website:null,copy:{ru:[],en:[]}})
    const context={poiId:annotation.poiId,sourceKey:dossier.sourceKey,nameRu:original['POI Name (RU)'],fields,dossier,now}
    const claims=Object.entries(annotation.properties).map(([code,factIds])=>{
      const property=matrixProperty(code)
      assert(property,'fixtureUnknownProperty')
      return {code,state:'supported',factIds,conditionFactIds:[],ageRange:null,checkedAt:now,
        // A reproducible test horizon, not a live freshness policy.
        validUntil:property.temporal?new Date(Date.parse(now)+14*86400000).toISOString():null,
        rationale:`Пример M1: свойство «${property.labels.ru}» обосновано указанными фактами о самом месте.`}
    })
    buildPoiMatrix(claims,context)
    return {poiId:annotation.poiId,kind:'derived-facts',context,claims,sourceDossierDigest:dossierDigest(source)}
  })
  return {spec:'poi-matrix-examples/v1',baseDigest,observedAt:now,derivation:'Original fact objects retained; unrelated facts, source blocks, copy and history omitted. Source indexes preserved. Dossier converted to research v2. No live-write authority.',fixtures}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [basePath,annotationPath,outPath,...extra]=process.argv.slice(2)
  assert(basePath&&annotationPath&&outPath&&!extra.length,'Usage: node scripts/poi-matrix-fixtures.mjs <base.json> <annotations.json> <new-output.json>')
  const bytes=await fs.readFile(basePath)
  const result=deriveMatrixFixtures(JSON.parse(bytes),JSON.parse(await fs.readFile(annotationPath,'utf8')),sha256Bytes(bytes))
  await fs.writeFile(outPath,JSON.stringify(result,null,2)+'\n',{flag:'wx'})
  console.log(`matrix examples: ${result.fixtures.length}; no network calls`)
}
