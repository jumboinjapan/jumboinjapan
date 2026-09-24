/** M1: pure proposal validation and projection. No storage or network effects.
 * A structurally valid proposal is NOT an approval to write or proof of truth. */
import assert from 'node:assert/strict'
import {canonicalJsonBytes, assertExactKeys, assertCanonicalInstant, deepFreeze} from '../../lib/canonical-contract.mjs'
import {sha256Bytes} from '../../lib/byte-digest.mjs'
import {matrixRegistry, matrixProperty} from '../../../src/lib/poi-matrix-registry.ts'
import {assertPoiFacts} from '../../../src/lib/poi-facts.ts'
import {readPoiCategory} from '../../../src/lib/poi-category.ts'
import {dossierDigest} from './japan-guide-facts.mjs'

export const MATRIX_SPEC = matrixRegistry.documentSpec
// Vocabulary stays v1; v2 changes document identity only, not property semantics.
export const MATRIX_WRITE_SPEC = 'poi-matrix/v2'
export const MATRIX_FIELD = matrixRegistry.fieldName
const digest = value => sha256Bytes(canonicalJsonBytes(value, value.spec))
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const instant = (value, where) => { assertCanonicalInstant(value, where); return Date.parse(value) }
const projections = new WeakSet()

function contextOf(context, sourceBound = false) {
  canonicalJsonBytes(context, 'poi-matrix-context/v1')
  assertExactKeys(context, ['poiId','sourceKey','nameRu','fields','dossier','now'], 'matrixContext')
  assert((sourceBound && context.poiId === null) || /^POI-\d{6}$/.test(context.poiId), 'matrixPoiId')
  if(sourceBound) assert(nonempty(context.fields['Source Key']) && context.fields['Source Key'] === context.sourceKey, 'matrixSourceKeyRequired')
  assert(nonempty(context.nameRu), 'matrixSubjectRequired')
  instant(context.now, 'matrixClock')
  const dossier = assertPoiFacts(context.dossier)
  assert.equal(dossier.sourceKey, context.sourceKey, 'matrixDossierIdentity')
  // The caller must bind this context to the fresh record at the future writer.
  assert.equal(context.fields['POI ID'], context.poiId, 'matrixRecordIdentity')
  assert.equal(context.fields['POI Name (RU)'], context.nameRu, 'matrixRecordSubject')
  if(context.fields['Source Key']!=null&&context.fields['Source Key']!==''){
    // Shared fact sync binds legacy dossiers to the immutable POI ID.
    // A later source key does not change that dossier's subject.
    assert(context.fields['Source Key'] === context.sourceKey ||
      (typeof context.poiId === 'string' && context.sourceKey === `poi:${context.poiId}`), 'matrixRecordSource')
  }
  return {dossier, category:readPoiCategory(context.fields)}
}

/** Input is agent assessment only; no caller-selectable human/editor authority. */
export function buildPoiMatrix(claims, context, spec = MATRIX_SPEC) {
  canonicalJsonBytes(claims, MATRIX_SPEC)
  canonicalJsonBytes(context, 'poi-matrix-context/v1')
  assert([MATRIX_SPEC,MATRIX_WRITE_SPEC].includes(spec),'matrixVersion')
  const {dossier,category} = contextOf(context, spec === MATRIX_WRITE_SPEC && context.poiId === null)
  const body = {
    spec, registryVersion:matrixRegistry.version,
    poiId:context.poiId, sourceKey:context.sourceKey, subject:context.nameRu,
    dossierDigest:dossierDigest(dossier), compatibilityType:category.typeCode,
    assessmentOrigin:'agent', assessedAt:context.now, claims,
  }
  return assertPoiMatrix({...body,digest:digest(body)},context)
}

export function assertPoiMatrix(value, context) {
  // Validate the complete raw value before destructuring/digest projection.
  canonicalJsonBytes(value, MATRIX_SPEC)
  assertExactKeys(value,['spec','registryVersion','poiId','sourceKey','subject','dossierDigest','compatibilityType','assessmentOrigin','assessedAt','claims','digest'],'matrix')
  assert([MATRIX_SPEC,MATRIX_WRITE_SPEC].includes(value.spec),'matrixVersion')
  const sourceBound = value.spec === MATRIX_WRITE_SPEC && value.poiId === null
  const {dossier,category} = contextOf(context, sourceBound)
  assert.equal(value.registryVersion,matrixRegistry.version,'matrixRegistryVersion')
  if(!sourceBound) assert.equal(value.poiId,context.poiId,'matrixIdentity')
  assert.equal(value.sourceKey,context.sourceKey,'matrixSourceIdentity')
  assert.equal(value.subject,context.nameRu,'matrixSubjectDrift')
  assert.equal(value.dossierDigest,dossierDigest(dossier),'matrixDossierDrift')
  assert.equal(value.compatibilityType,category.typeCode,'matrixCompatibilityDrift')
  assert.equal(value.assessmentOrigin,'agent','matrixAuthority')
  const assessedAt=instant(value.assessedAt,'matrixAssessedAt')
  assert(assessedAt<=Date.parse(context.now),'matrixFutureAssessment')
  const {digest:provided,...body}=value
  assert.equal(provided,digest(body),'matrixDigest')
  assert(Array.isArray(value.claims),'matrixClaims')
  const seen=new Set()
  for(const claim of value.claims){
    assertExactKeys(claim,['code','state','factIds','conditionFactIds','ageRange','checkedAt','validUntil','rationale'],'matrixClaim')
    const property=matrixProperty(claim.code)
    assert(property,'matrixUnknownProperty')
    assert(!seen.has(claim.code),'matrixDuplicateProperty');seen.add(claim.code)
    assert(matrixRegistry.states.includes(claim.state),'matrixClaimState')
    assert(nonempty(claim.rationale),'matrixRationale')
    const checkedAt=instant(claim.checkedAt,'matrixCheckedAt')
    assert(checkedAt<=assessedAt,'matrixFutureCheck')
    const references=(ids,label)=>{
      assert(Array.isArray(ids)&&new Set(ids).size===ids.length,label)
      return ids.map(id=>{
        const fact=dossier.facts.find(f=>f.id===id)
        assert(fact,'matrixUnknownFact')
        assert.equal(fact.subject,context.nameRu,'matrixForeignSubject')
        for(const reference of fact.references){
          assert(Date.parse(dossier.sources[reference.source].observedAt)<=checkedAt,'matrixEvidenceAfterCheck')
        }
        return fact
      })
    }
    const facts=references(claim.factIds,'matrixFactIds')
    const conditions=references(claim.conditionFactIds,'matrixConditionFactIds')
    const decided=['supported','refuted'].includes(claim.state)
    if(decided){
      assert(facts.length>0,'matrixEvidenceRequired')
      assert(facts.every(f=>property.factCategories.includes(f.category)&&property.factStatuses.includes(f.status)),'matrixEvidenceKind')
      assert(conditions.every(f=>['reported','verified'].includes(f.status)),'matrixConditionEvidence')
      // A fact naming a component is not an assertion about the whole POI.
      // Composition facts intentionally cannot authorize self functions.
      if(property.requiresAgeRange){
        assert(claim.ageRange&&typeof claim.ageRange==='object','matrixAgeRangeRequired')
        assertExactKeys(claim.ageRange,['min','max'],'matrixAgeRange')
        assert(Number.isInteger(claim.ageRange.min)&&Number.isInteger(claim.ageRange.max)&&claim.ageRange.min>=0&&claim.ageRange.max<=17&&claim.ageRange.min<=claim.ageRange.max,'matrixAgeRange')
        assert(conditions.length>0&&conditions.every(f=>f.status==='verified'&&nonempty(f.conditions)&&!claim.factIds.includes(f.id)),'matrixAgeConditionsRequired')
      }else assert.equal(claim.ageRange,null,'matrixUnexpectedAgeRange')
      if(property.temporal){
        const until=instant(claim.validUntil,'matrixValidUntil')
        assert(until>checkedAt,'matrixValidityOrder')
      }else assert.equal(claim.validUntil,null,'matrixStaticExpiry')
    }else{
      assert.equal(claim.ageRange,null,'matrixUndecidedAge')
      assert.equal(claim.validUntil,null,'matrixUndecidedExpiry')
      if(claim.state==='conflicting') assert(facts.length>=2||facts.some(f=>f.status==='conflicting'),'matrixConflictEvidence')
    }
  }
  return deepFreeze(JSON.parse(JSON.stringify(value)))
}

/** Full evidence validation stays server-side; future UIs consume this projection. */
export function projectPoiMatrix(value,context){
  const matrix=assertPoiMatrix(value,context)
  const visitUnavailable=['temporaryClosed','permanentlyClosed','conflicting'].includes(context.dossier.visit.status)
  const projection=deepFreeze({poiId:context.poiId,digest:matrix.digest,compatibilityType:matrix.compatibilityType,
    properties:matrix.claims.map(claim=>{
      const property=matrixProperty(claim.code)
      let state=claim.state
      if(claim.validUntil&&Date.parse(claim.validUntil)<=Date.parse(context.now))state='expired'
      if(visitUnavailable&&property.group==='functions'&&state==='supported')state='unavailable'
      return {code:property.code,state,ageRange:claim.ageRange,
        factIds:claim.factIds,conditionFactIds:claim.conditionFactIds}
    })})
  projections.add(projection)
  return projection
}

/** Missing and malformed are distinct. Invalid matrix never silently passes filters. */
export function readPoiMatrix(raw,context){
  canonicalJsonBytes(context,'poi-matrix-context/v1')
  if(raw==null||raw==='')return {state:'missing',category:readPoiCategory(context.fields),projection:null,error:null}
  try{
    const value=typeof raw==='string'?JSON.parse(raw):raw
    return {state:'valid',category:readPoiCategory(context.fields),projection:projectPoiMatrix(value,context),error:null}
  }catch(error){return {state:'invalid',category:readPoiCategory(context.fields),projection:null,error:error.message}}
}

/** One predicate: OR (default) / explicit AND inside groups, AND between groups.
 * Consume a projection created above, not an unvalidated request payload. */
export function matchesPoiMatrix(projection,query){
  canonicalJsonBytes(query,'poi-matrix-query/v1')
  assertExactKeys(query,['groups','childAges'],'matrixQuery')
  assert(Array.isArray(query.groups)&&new Set(query.groups.map(g=>g.group)).size===query.groups.length,'matrixQueryGroups')
  assert(Array.isArray(query.childAges)&&query.childAges.every(age=>Number.isInteger(age)&&age>=0&&age<=17),'matrixQueryAges')
  for(const group of query.groups){
    assertExactKeys(group,['group','codes','mode'],'matrixQueryGroup')
    assert(matrixRegistry.groups.some(g=>g.code===group.group),'matrixQueryUnknownGroup')
    assert(['any','all'].includes(group.mode),'matrixQueryMode')
    assert(Array.isArray(group.codes)&&group.codes.length>0&&new Set(group.codes).size===group.codes.length,'matrixQueryCodes')
    assert(group.codes.every(code=>matrixProperty(code)?.group===group.group),'matrixQueryWrongGroup')
    if(group.codes.some(code=>matrixProperty(code).requiresAgeRange))assert(query.childAges.length>0,'matrixQueryAgesRequired')
  }
  if(!query.groups.length)return true
  if(!projection)return false
  assert(projections.has(projection),'matrixUnvalidatedProjection')
  return query.groups.every(group=>{
    const matches=group.codes.map(code=>{
      const property=projection.properties.find(p=>p.code===code)
      return property?.state==='supported'&&(!matrixProperty(code).requiresAgeRange||query.childAges.every(age=>property.ageRange&&age>=property.ageRange.min&&age<=property.ageRange.max))
    })
    return group.mode==='all'?matches.every(Boolean):matches.some(Boolean)
  })
}

/** M3 schema proposal only. No live-schema mutation is implemented by M1. */
export const matrixSchemaProposal=deepFreeze({name:MATRIX_FIELD,type:'multilineText'})
