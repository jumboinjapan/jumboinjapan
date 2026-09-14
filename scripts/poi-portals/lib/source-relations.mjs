/** Evidence-bound relationships for any portal. No store or write implementation. */
import assert from 'node:assert/strict'
import {canonicalJsonBytes,assertExactKeys} from '../../lib/canonical-contract.mjs'

const subjectFields=['recordId','poiId','nameRu','nameEn','siteCity','lat','lon','placeId']
export const relationSubject = row => Object.fromEntries(subjectFields.map(k=>[k,row[k]??null]))

export function assertSourceRelations(relations,poi) {
  if(relations===undefined)return []
  canonicalJsonBytes(relations,'poi-source-relations/v1')
  assert(poi.factDossier?.spec==='poi-facts/v2','sourceRelationsNeedReviewedFacts')
  assert(Array.isArray(relations)&&relations.length>0&&relations.length<=20,'sourceRelationsSize')
  const seen=new Set()
  for(const r of relations){
    assertExactKeys(r,['kind','target','factIds','reason'],'source relation')
    assert(['parent','distinct'].includes(r.kind),'sourceRelationKind')
    assertExactKeys(r.target,subjectFields,'source relation target')
    assert(/^rec[A-Za-z0-9]{14}$/.test(r.target.recordId)&&/^POI-\d{6}$/.test(r.target.poiId),'sourceRelationTarget')
    assert(!seen.has(r.target.recordId),'sourceRelationRepeatedTarget');seen.add(r.target.recordId)
    assert(typeof r.target.nameRu==='string'&&r.target.nameRu.trim(),'sourceRelationTargetName')
    for(const k of ['nameEn','siteCity','placeId'])assert(r.target[k]===null||typeof r.target[k]==='string','sourceRelationTargetField')
    for(const k of ['lat','lon'])assert(r.target[k]===null||Number.isFinite(r.target[k]),'sourceRelationTargetPoint')
    assert(typeof r.reason==='string'&&r.reason.trim(),'sourceRelationReason')
    assert(Array.isArray(r.factIds)&&r.factIds.length&&new Set(r.factIds).size===r.factIds.length,'sourceRelationFacts')
    for(const id of r.factIds){
      const f=poi.factDossier.facts.find(f=>f.id===id)
      assert(f?.subject===poi.nameRu&&f.category==='composition'&&f.status==='verified'&&f.text.includes(r.target.nameRu),'sourceRelationFactSubject')
    }
  }
  assert(relations.filter(r=>r.kind==='parent').length<=1,'sourceRelationSingleParent')
  return relations
}

/** Exact current record binding: a prior conclusion cannot follow a renamed or moved POI. */
export function resolveSourceRelations(relations,poi,existing){
  const rows=assertSourceRelations(relations,poi)
  const distinct=new Set();let parent=null
  for(const r of rows){
    const found=existing.find(p=>p.recordId===r.target.recordId)
    assert(found,'sourceRelationTargetMissing')
    assert.deepEqual(relationSubject(found),r.target,'sourceRelationTargetDrift')
    assert(!found.placeId||found.placeId!==poi.resolved?.placeId,'sourceRelationSameGoogleObject')
    if(r.kind==='parent')parent=found
    distinct.add(found.recordId)
  }
  return {distinct,parent,rows}
}
