import assert from 'node:assert/strict'
import fs from 'node:fs'
import {matrixRegistry,matrixProperty,matrixLabel} from '../src/lib/poi-matrix-registry.ts'
import {readPoiCategory} from '../src/lib/poi-category.ts'
import {buildPoiMatrix,assertPoiMatrix,projectPoiMatrix,readPoiMatrix,matchesPoiMatrix,matrixSchemaProposal} from '../scripts/poi-portals/lib/poi-matrix.mjs'
import {deriveMatrixFixtures} from '../scripts/poi-matrix-fixtures.mjs'
import {canonicalJsonBytes} from '../scripts/lib/canonical-contract.mjs'
import {sha256Bytes} from '../scripts/lib/byte-digest.mjs'
import examples from './fixtures/poi-matrix-examples.json' with {type:'json'}
import registryManifest from './fixtures/poi-matrix-registry-manifest.json' with {type:'json'}

let checks=0
function check(name,fn){try{fn();checks++}catch(error){throw new Error(`${name}: ${error.message}`,{cause:error})}}
const clone=value=>JSON.parse(JSON.stringify(value))
const fixture=id=>clone(examples.fixtures.find(f=>f.poiId===id))
const query=(group,codes,mode='any',childAges=[])=>({groups:[{group,codes,mode}],childAges})
const rejects=(fn,code)=>assert.throws(fn,new RegExp(code))
const art=fixture('POI-000927')
const artMatrix=buildPoiMatrix(art.claims,art.context)

check('EXAMPLES bounded real set',()=>{
  assert.equal(examples.fixtures.length,40)
  assert.equal(new Set(examples.fixtures.map(f=>f.poiId)).size,40)
  assert.match(examples.baseDigest,/^sha256:[a-f0-9]{64}$/)
  assert(examples.fixtures.filter(f=>f.kind==='derived-facts').length>=30)
  assert(!JSON.stringify(examples).includes('"recordId"'))
  assert(!JSON.stringify(examples).includes('"Notes"'))
})
for(const f of examples.fixtures){
  check(`EXAMPLE ${f.poiId} existing classification preserved`,()=>{
    if(f.kind==='legacy'){
      const read=readPoiMatrix('',f.context)
      assert.equal(read.state,'missing');assert.deepEqual(read.category,readPoiCategory(f.context.fields))
      assert.equal(matchesPoiMatrix(read.projection,query('functions',['exhibition'])),false)
      return
    }
    const matrix=buildPoiMatrix(f.claims,f.context)
    const view=projectPoiMatrix(matrix,f.context)
    assert.deepEqual(assertPoiMatrix(matrix,f.context),matrix)
    assert.equal(readPoiMatrix(JSON.stringify(matrix),f.context).state,'valid')
    assert.equal(readPoiMatrix(matrix,f.context).state,'valid')
    assert.equal(view.compatibilityType,readPoiCategory(f.context.fields).typeCode)
    for(const claim of f.claims){assert.equal(view.properties.find(p=>p.code===claim.code).state,'supported')}
    assert.equal(view.properties.find(p=>p.code==='children')?.state??'unknown','unknown')
    assert.equal(matchesPoiMatrix(view,query('audience',['children'],'any',[7])),false)
  })
}
for(const property of matrixRegistry.properties){
  check(`REGISTRY ${property.code} bilingual immutable`,()=>{
    assert.equal(matrixProperty(property.code),property)
    assert.equal(matrixLabel(property.code,'ru'),property.labels.ru)
    assert.equal(matrixLabel(property.code,'en'),property.labels.en)
    assert(Object.isFrozen(property)&&Object.isFrozen(property.labels)&&Object.isFrozen(property.factCategories))
  })
}
check('REGISTRY no editor badge or inherited name',()=>{
  assert.equal(matrixProperty('toString'),null);assert.equal(matrixProperty('editors_choice'),null)
  assert.throws(()=>matrixRegistry.properties.push({}))
  assert.deepEqual(matrixSchemaProposal,{name:'POI Matrix',type:'multilineText'})
})
check('REGISTRY v1 exact bytes retained',()=>{
  assert.equal(matrixRegistry.version,registryManifest.version)
  assert.equal(sha256Bytes(fs.readFileSync(new URL('../config/poi-matrix.v1.json',import.meta.url))),registryManifest.sha256)
})
check('MULTIFUNCTION preserves old type and both layers',()=>{
  const s=fixture('POI-001210'),view=projectPoiMatrix(buildPoiMatrix(s.claims,s.context),s.context)
  assert(matchesPoiMatrix(view,{groups:[{group:'functions',codes:['shopping'],mode:'all'},{group:'themes',codes:['history','architecture'],mode:'all'}],childAges:[]}))
  assert.equal(view.compatibilityType,s.context.fields['POI Type'])
})
check('COMPACT only assessed properties; no repeated labels or dossier text',()=>{
  const view=projectPoiMatrix(artMatrix,art.context)
  assert.equal(view.properties.length,art.claims.length)
  assert(view.properties.every(p=>!Object.hasOwn(p,'labels')&&!Object.hasOwn(p,'text')))
})
check('FILTER any/all/group conjunction',()=>{
  const p=projectPoiMatrix(artMatrix,art.context)
  assert(matchesPoiMatrix(p,query('functions',['exhibition','bathing'])))
  assert(!matchesPoiMatrix(p,query('functions',['exhibition','bathing'],'all')))
  assert(!matchesPoiMatrix(p,{groups:[{group:'functions',codes:['exhibition'],mode:'any'},{group:'themes',codes:['geology'],mode:'any'}],childAges:[]}))
  assert(matchesPoiMatrix(null,{groups:[],childAges:[]}))
})
check('MOUNTAIN does not inherit temple or hiking of child',()=>{
  const s=fixture('POI-000977'),p=projectPoiMatrix(buildPoiMatrix(s.claims,s.context),s.context)
  assert(matchesPoiMatrix(p,query('themes',['nature','geology'],'all')))
  assert(!matchesPoiMatrix(p,query('functions',['religious_visit','hiking'])))
  assert.equal(p.compatibilityType,'natural_landmark')
  assert(matchesPoiMatrix(p,query('kinds',['kind_mountain'])))
})
check('AQUARIUM separated from zoo despite same compatible type',()=>{
  const aquarium=fixture('POI-000959'),zoo=fixture('POI-000868')
  for(const [sample,own,other] of [[aquarium,'kind_aquarium','kind_zoo'],[zoo,'kind_zoo','kind_aquarium']]){
    const view=projectPoiMatrix(buildPoiMatrix(sample.claims,sample.context),sample.context)
    assert.equal(view.compatibilityType,'zoo_aquarium')
    assert(matchesPoiMatrix(view,query('kinds',[own])))
    assert(!matchesPoiMatrix(view,query('kinds',[other])))
  }
})
check('EXPIRED function not history and deadline exclusive',()=>{
  const s=fixture('POI-001210'),matrix=buildPoiMatrix(s.claims,s.context)
  s.context.now=matrix.claims.find(c=>c.code==='shopping').validUntil
  const p=projectPoiMatrix(matrix,s.context)
  assert.equal(p.properties.find(v=>v.code==='shopping').state,'expired')
  assert(matchesPoiMatrix(p,query('themes',['history'])))
  assert(!matchesPoiMatrix(p,query('functions',['shopping'])))
})
check('CLOSED exhibition unavailable but art retained',()=>{
  const s=clone(art);s.context.dossier.visit.status='temporaryClosed'
  s.context.dossier.visit.factIds=[s.context.dossier.facts[0].id]
  const p=projectPoiMatrix(buildPoiMatrix(s.claims,s.context),s.context)
  assert(!matchesPoiMatrix(p,query('functions',['exhibition'])))
  assert(matchesPoiMatrix(p,query('themes',['art'])))
})
for(const state of ['refuted','unknown','conflicting'])check(`STATE ${state} never a positive match`,()=>{
  const s=clone(art);s.claims=[s.claims[0]];s.claims[0].state=state
  if(state==='unknown'){s.claims[0].factIds=[];s.claims[0].validUntil=null}
  if(state==='conflicting'){s.context.dossier.facts.find(f=>f.id===s.claims[0].factIds[0]).status='conflicting';s.claims[0].validUntil=null}
  const p=projectPoiMatrix(buildPoiMatrix(s.claims,s.context),s.context)
  assert(!matchesPoiMatrix(p,query(matrixProperty(s.claims[0].code).group,[s.claims[0].code])))
})
check('DRIFT dossier changed under existing matrix',()=>{
  const s=clone(art);s.context.dossier.facts[0].text+=' Changed.'
  rejects(()=>assertPoiMatrix(artMatrix,s.context),'matrixDossierDrift')
})
check('SUBJECT foreign child cannot authorize parent',()=>{
  const s=clone(art);s.context.dossier.facts.find(f=>f.id===s.claims[0].factIds[0]).subject='Другой музей'
  rejects(()=>buildPoiMatrix(s.claims,s.context),'matrixForeignSubject')
})
check('COMPOSITION even same subject cannot authorize function',()=>{
  const s=clone(art);s.claims=s.claims.filter(c=>c.code==='exhibition')
  s.context.dossier.facts.find(f=>f.id===s.claims[0].factIds[0]).category='composition'
  rejects(()=>buildPoiMatrix(s.claims,s.context),'matrixEvidenceKind')
})
for(const status of ['legend','interpretation','unknown','conflicting'])check(`EVIDENCE ${status} not support`,()=>{
  const s=clone(art);s.context.dossier.facts.find(f=>f.id===s.claims[0].factIds[0]).status=status
  rejects(()=>buildPoiMatrix(s.claims,s.context),'matrixEvidenceKind')
})
check('EVIDENCE checked after source observation',()=>{
  const s=clone(art);s.context.dossier.sources[0].observedAt='2099-01-01T00:00:00.000Z'
  rejects(()=>buildPoiMatrix(s.claims,s.context),'matrixEvidenceAfterCheck')
})
for(const [name,edit,error] of [
  ['unknown property',s=>s.claims[0].code='toString','matrixUnknownProperty'],
  ['duplicate property',s=>s.claims.push(clone(s.claims[0])),'matrixDuplicateProperty'],
  ['unknown fact',s=>s.claims[0].factIds=['missing'],'matrixUnknownFact'],
  ['no fact',s=>s.claims[0].factIds=[],'matrixEvidenceRequired'],
  ['extra claim field',s=>s.claims[0].human=true,'matrixClaim'],
  ['future check',s=>s.claims[0].checkedAt='2099-01-01T00:00:00.000Z','matrixFutureCheck'],
  ['record mismatch',s=>s.context.poiId='POI-999999','matrixRecordIdentity'],
  ['record source mismatch',s=>s.context.fields['Source Key']='other:place','matrixRecordSource'],
])check(`REJECT ${name}`,()=>{const s=clone(art);edit(s);rejects(()=>buildPoiMatrix(s.claims,s.context),error)})
for(const [field,value,error] of [['spec','toString','matrixVersion'],['registryVersion','poi-matrix-registry/v0','matrixRegistryVersion'],['assessmentOrigin','human','matrixAuthority'],['compatibilityType','museum','matrixCompatibilityDrift'],['digest','sha256:'+'0'.repeat(64),'matrixDigest']]){
  check(`STORED rejects ${field}`,()=>{
    const matrix=clone(artMatrix);matrix[field]=value
    if(field!=='digest'){
      const body=Object.fromEntries(Object.entries(matrix).filter(([key])=>key!=='digest'))
      matrix.digest=sha256Bytes(canonicalJsonBytes(body,'poi-matrix/v1'))
    }
    rejects(()=>assertPoiMatrix(matrix,art.context),error)
  })
}
check('MALFORMED not a legacy fallback',()=>{
  const read=readPoiMatrix('{',art.context);assert.equal(read.state,'invalid');assert(read.error)
  assert(!matchesPoiMatrix(read.projection,query('themes',['art'])))
})
check('STRICT raw accessors never execute',()=>{
  let calls=0;const value=clone(artMatrix);Object.defineProperty(value,'extra',{enumerable:true,get(){calls++;return true}})
  assert.throws(()=>assertPoiMatrix(value,art.context));assert.equal(calls,0)
})
for(const [name,mutate] of [
  ['symbol',s=>s.claims[Symbol('extra')]=true],
  ['hidden',s=>Object.defineProperty(s.claims[0],'extra',{value:true})],
  ['sparse',s=>delete s.claims[0]],
  ['surrogate',s=>s.claims[0].rationale='\ud800'],
])check(`STRICT rejects ${name}`,()=>{const s=clone(art);mutate(s);assert.throws(()=>buildPoiMatrix(s.claims,s.context))})
check('QUERY unvalidated projection rejected',()=>{
  const p=projectPoiMatrix(artMatrix,art.context)
  rejects(()=>matchesPoiMatrix(clone(p),query('themes',['art'])),'matrixUnvalidatedProjection')
})
check('QUERY malformed and mismatched group rejected',()=>{
  const p=projectPoiMatrix(artMatrix,art.context)
  rejects(()=>matchesPoiMatrix(p,query('themes',['exhibition'])),'matrixQueryWrongGroup')
  rejects(()=>matchesPoiMatrix(p,query('themes',['art'],'some')),'matrixQueryMode')
  rejects(()=>matchesPoiMatrix(p,query('audience',['children'])),'matrixQueryAgesRequired')
})

// Synthetic policy scenario, separate from real sourced examples. It does not
// claim any real POI is suitable for children or authorize production writes.
const family=clone(art)
family.claims=[{code:'children',state:'supported',factIds:['family'],conditionFactIds:['access'],ageRange:{min:6,max:12},checkedAt:family.context.now,validUntil:new Date(Date.parse(family.context.now)+86400000).toISOString(),rationale:'Synthetic explicit suitability and access conditions.'}]
const ref=family.context.dossier.facts[0].references
family.context.dossier.facts.push(
  {id:'family',subject:family.context.nameRu,category:'visiting',status:'verified',text:'Synthetic: activity is designed for children aged 6–12.',conditions:'',references:ref},
  {id:'access',subject:family.context.nameRu,category:'access',status:'verified',text:'Synthetic: children attend with an adult.',conditions:'An accompanying adult is required.',references:ref},
)
check('FAMILY explicit age and conditions are preserved',()=>{
  const p=projectPoiMatrix(buildPoiMatrix(family.claims,family.context),family.context)
  assert(matchesPoiMatrix(p,query('audience',['children'],'all',[6,12])))
  assert(!matchesPoiMatrix(p,query('audience',['children'],'all',[5,12])))
  assert.equal(p.properties.find(x=>x.code==='children').conditionFactIds[0],'access')
})
check('FAMILY child ticket alone is insufficient',()=>{
  const s=clone(family);s.context.dossier.facts.find(f=>f.id==='family').text='Synthetic: a child ticket costs 100 yen.'
  s.claims[0].conditionFactIds=[]
  rejects(()=>buildPoiMatrix(s.claims,s.context),'matrixAgeConditionsRequired')
})
check('FAMILY reported unverified support rejected',()=>{
  const s=clone(family);s.context.dossier.facts.find(f=>f.id==='family').status='reported'
  rejects(()=>buildPoiMatrix(s.claims,s.context),'matrixEvidenceKind')
})
check('FAMILY missing age cannot mean all ages',()=>{
  const s=clone(family);s.claims[0].ageRange=null
  rejects(()=>buildPoiMatrix(s.claims,s.context),'matrixAgeRangeRequired')
})
check('FAMILY cannot reuse support as access conditions',()=>{
  const s=clone(family);s.claims[0].conditionFactIds=['family']
  rejects(()=>buildPoiMatrix(s.claims,s.context),'matrixAgeConditionsRequired')
})
check('DERIVATION original fact objects preserved without I/O',()=>{
  const s=clone(art),before=JSON.stringify(s.context.dossier)
  const dossier=s.context.dossier
  const base={observedAt:s.context.now,rows:[{fields:{...s.context.fields,Notes:'\n[JUMBO_POI_FACTS_V1]\n'+JSON.stringify(dossier)+'\n[/JUMBO_POI_FACTS_V1]\n'}}]}
  const annotations={spec:'poi-matrix-annotations/v1',rows:[{poiId:s.poiId,properties:{art:s.claims[0].factIds}}]}
  const derived=deriveMatrixFixtures(base,annotations,examples.baseDigest)
  assert.equal(JSON.stringify(s.context.dossier),before)
  for(const fact of derived.fixtures[0].context.dossier.facts)assert.deepEqual(fact,dossier.facts.find(f=>f.id===fact.id))
  rejects(()=>deriveMatrixFixtures({...base,rows:[...base.rows,...base.rows]},annotations,examples.baseDigest),'fixtureRecordIdentity')
})
check('NO network used by all matrix operations',()=>{
  const original=globalThis.fetch;let calls=0
  globalThis.fetch=()=>{calls++;throw new Error('unexpected network')}
  try{const matrix=buildPoiMatrix(art.claims,art.context);projectPoiMatrix(matrix,art.context);assert.equal(calls,0)}finally{globalThis.fetch=original}
})
check('SINGLE registry importer',()=>{
  const code=fs.readFileSync(new URL('../scripts/poi-portals/lib/poi-matrix.mjs',import.meta.url),'utf8')
  assert(!code.includes('config/poi-matrix'))
})
console.log(`✓ матрица POI M1: ${checks} проверок пройдено (40 существующих POI)`)
