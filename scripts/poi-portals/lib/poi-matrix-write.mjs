/** M3 pure proposals. HTTP effects remain in ingestPoi / the existing sync executor. */
import assert from 'node:assert/strict'
import {canonicalJsonBytes,assertExactKeys,assertCanonicalInstant,deepFreeze} from '../../lib/canonical-contract.mjs'
import {sha256Bytes} from '../../lib/byte-digest.mjs'
import {readPoiFacts} from '../../../src/lib/poi-facts.ts'
import {matrixProperty} from '../../../src/lib/poi-matrix-registry.ts'
import {MATRIX_FIELD,MATRIX_WRITE_SPEC,buildPoiMatrix,assertPoiMatrix} from './poi-matrix.mjs'

export const MATRIX_WRITE_POLICY = deepFreeze({spec:'poi-matrix-write-policy/v1',maximumTemporalDays:30,maximumReviewAgeDays:30,maximumBytes:90000,checks:['subject','evidenceMeaning','conditions','preservation']})
export const matrixWritePolicyDigest = () => sha256Bytes(canonicalJsonBytes(MATRIX_WRITE_POLICY,MATRIX_WRITE_POLICY.spec))
export function matrixContext(fields,now) {
  canonicalJsonBytes(fields,'poi-matrix-record/v1')
  assertCanonicalInstant(now,'matrixClock')
  const {dossier,error}=readPoiFacts(fields.Notes??'')
  assert(dossier&&!error,'matrixDossierUnavailable')
  return {poiId:fields['POI ID']??null,sourceKey:dossier.sourceKey,nameRu:fields['POI Name (RU)'],fields,dossier,now}
}
/** Build the exact whole document for independent review, not a write authorization. */
export function buildMatrixWrite(input,context,previousContext=null) {
  canonicalJsonBytes(input,'poi-matrix-assessment/v1')
  canonicalJsonBytes(context,'poi-matrix-context/v1')
  if(previousContext!==null) canonicalJsonBytes(previousContext,'poi-matrix-context/v1')
  assertExactKeys(input,['claims','assessedAt'],'matrix assessment')
  assert(Array.isArray(input.claims)&&input.claims.length>0,'matrixAssessmentEmpty')
  assertCanonicalInstant(input.assessedAt,'matrixAssessmentDate')
  assert(Date.parse(input.assessedAt)<=Date.parse(context.now),'matrixFutureAssessment')
  let old=null
  if(previousContext?.fields[MATRIX_FIELD]) {
    old=assertPoiMatrix(JSON.parse(previousContext.fields[MATRIX_FIELD]),previousContext)
  }
  const seen=new Set()
  for(const claim of input.claims){assert(!seen.has(claim.code),'matrixDuplicateProperty');seen.add(claim.code)}
  // Omission preserves claims, never deletes them. Every retained fact is checked again.
  const claims=[...(old?.claims??[]).filter(c=>!seen.has(c.code)),...input.claims].sort((a,b)=>a.code.localeCompare(b.code))
  const document=buildPoiMatrix(claims,{...context,now:input.assessedAt},MATRIX_WRITE_SPEC)
  for(const claim of document.claims) if(matrixProperty(claim.code).temporal&&['supported','refuted'].includes(claim.state)) {
    assert(Date.parse(claim.validUntil)>Date.parse(context.now),'matrixWriteExpired')
    assert(Date.parse(claim.validUntil)-Date.parse(claim.checkedAt)<=MATRIX_WRITE_POLICY.maximumTemporalDays*86400000,'matrixWriteTtl')
  }
  const serialized=JSON.stringify(document)
  assert(Buffer.byteLength(serialized,'utf8')<=MATRIX_WRITE_POLICY.maximumBytes,'matrixStorageLimit')
  return document
}
export function assertMatrixWriteReview(review,document,now) {
  canonicalJsonBytes(review,'poi-matrix-review/v1')
  canonicalJsonBytes(document,'poi-matrix-document/v1')
  assertCanonicalInstant(now,'matrixClock')
  assertExactKeys(review,['spec','matrixDigest','policyDigest','author','reviewer','checkedAt','checks','issues'],'matrix review')
  assert.equal(review.spec,'poi-matrix-review/v1','matrixReviewVersion')
  assert.equal(review.matrixDigest,document.digest,'matrixReviewDrift')
  assert.equal(review.policyDigest,matrixWritePolicyDigest(),'matrixReviewPolicyDrift')
  assert([review.author,review.reviewer].every(v=>typeof v==='string'&&v.trim()),'matrixReviewActors')
  assert.notEqual(review.author.trim(),review.reviewer.trim(),'matrixIndependentReviewRequired')
  assertCanonicalInstant(review.checkedAt,'matrixReviewDate')
  const age=Date.parse(now)-Date.parse(review.checkedAt)
  assert(age>=0&&age<=MATRIX_WRITE_POLICY.maximumReviewAgeDays*86400000&&Date.parse(review.checkedAt)>=Date.parse(document.assessedAt),'matrixReviewDateOrder')
  assertExactKeys(review.checks,MATRIX_WRITE_POLICY.checks,'matrix review checks')
  assert(MATRIX_WRITE_POLICY.checks.every(k=>review.checks[k]===true),'matrixReviewNotPassed')
  assert(Array.isArray(review.issues)&&review.issues.length===0,'matrixReviewIssues')
  return document
}
export function reviewedMatrixWrite(input,context,previousContext=null) {
  canonicalJsonBytes(input,'poi-matrix-write/v1')
  assertExactKeys(input,['claims','assessedAt','review'],'matrix write')
  return assertMatrixWriteReview(input.review,buildMatrixWrite({claims:input.claims,assessedAt:input.assessedAt},context,previousContext),context.now)
}
export function verifyMatrixSchemaTable(table) {
  canonicalJsonBytes(table,'poi-matrix-schema/v1')
  const fields=table?.fields?.filter(f=>f.name===MATRIX_FIELD)
  assert(fields?.length===1&&fields[0].type==='multilineText','matrixSchemaMissingOrWrongType')
  return {checked:true,field:MATRIX_FIELD}
}
