/** Binds an agent-authored dossier to complete fetched evidence before any write. */
import assert from 'node:assert/strict'
import { canonicalJsonBytes, assertExactKeys } from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { assertPoiFacts } from '../../../src/lib/poi-facts.ts'
import { assertEvidence, OFFICIAL_EVIDENCE_SPEC } from './japan-guide-evidence.mjs'
import { applyCanonSpelling, DECLINED_TOPONYM_FORMS } from '../../../src/lib/polivanov.ts'
import { poiPrimaryTypeCodes } from '../../../src/lib/poi-taxonomy.ts'
export const FACTS_PACKET_SPEC = 'poi-japan-guide-facts-batch/v1'
export const FACTS_WITH_OFFICIAL_SPEC = 'poi-japan-guide-facts-batch/v2'
export const dossierDigest = d => sha256Bytes(canonicalJsonBytes(d, 'poi-facts/v1'))
export const dossierCopy = d => ({ ru: d.copy.ru.map(c => c.text).join('\n\n'), en: d.copy.en.map(c => c.text).join('\n\n') })

/** Shared editorial boundary, not a rewriter. Evidence text and locators stay intact. */
export function assertAuthoredTextCanon(text, where = 'authoredText') {
  assert.equal(typeof text, 'string', `${where}: text required`)
  assert.equal(applyCanonSpelling(text).value, text, `${where}: factsCanonSpelling`)
  for (const [wrong] of DECLINED_TOPONYM_FORMS) {
    assert(!new RegExp(`(^|[^А-Яа-яЁё])${wrong}(?![А-Яа-яЁё])`).test(text), `${where}: factsCanonToponym: ${wrong}`)
  }
}

export function assertDossierCanon(dossier) {
  canonicalJsonBytes(dossier, 'poi-facts/v1')
  assertPoiFacts(dossier)
  const texts = [
    ...dossier.facts.flatMap((f, i) => ['subject','text','conditions'].map(key => [`facts[${i}].${key}`, f[key]])),
    ...dossier.coverage.map((c, i) => [`coverage[${i}].reason`, c.reason]),
    ['visit.hours', dossier.visit.hours], ['visit.explanation', dossier.visit.explanation],
    ...dossier.copy.ru.map((c, i) => [`copy.ru[${i}]`, c.text]),
  ]
  for (const [where, text] of texts) assertAuthoredTextCanon(text, `${dossier.sourceKey}.${where}`)
}

/** Agent judgement about the whole POI, bound to facts and the existing taxonomy. */
export function assertSubjectAssessment(assessment, dossier) {
  canonicalJsonBytes(assessment, 'poi-japan-guide-subject/v1')
  canonicalJsonBytes(dossier, 'poi-facts/v1')
  assertPoiFacts(dossier)
  assertExactKeys(assessment, ['role','nameRu','poiPrimaryType','factIds','reason'], 'subjectAssessment')
  assert(['place','parent'].includes(assessment.role), 'subjectAssessmentRole')
  assert(typeof assessment.nameRu === 'string' && assessment.nameRu.trim(), 'subjectAssessmentName')
  assert(poiPrimaryTypeCodes.includes(assessment.poiPrimaryType), 'subjectAssessmentType')
  assert(typeof assessment.reason === 'string' && assessment.reason.trim(), 'subjectAssessmentReason')
  assertAuthoredTextCanon(assessment.nameRu, 'subjectAssessment.nameRu')
  assertAuthoredTextCanon(assessment.reason, 'subjectAssessment.reason')
  assert(Array.isArray(assessment.factIds) && assessment.factIds.length > 0 && new Set(assessment.factIds).size === assessment.factIds.length, 'subjectAssessmentFacts')
  for (const id of assessment.factIds) {
    const fact = dossier.facts.find(f => f.id === id)
    assert(fact && ['identity','composition'].includes(fact.category) && ['reported','verified'].includes(fact.status), 'subjectAssessmentIdentityFact')
    assert.equal(fact.subject, assessment.nameRu, 'subjectAssessmentWholeSubject')
  }
  return assessment
}

export function assertFactsForRequest(row, request, {knownParent = false} = {}) {
  canonicalJsonBytes(row, FACTS_PACKET_SPEC)
  assertFactsForCreate(row.dossier)
  assert(row.subjectAssessment, 'subjectAssessmentRequired')
  const a = assertSubjectAssessment(row.subjectAssessment, row.dossier)
  assert.equal(a.nameRu, request.poi.nameRu, 'subjectAssessmentNameDrift')
  assert.equal(a.poiPrimaryType, request.poi.taxonomy?.poiPrimaryType, 'subjectAssessmentTypeDrift')
  assert(!knownParent || a.role === 'parent', 'subjectAssessmentParentRequired')
  // Validate every authored RU input that can be retained outside the dossier.
  for (const key of ['nameRu','descriptionRu','workingHours','ticketsNote']) {
    if (request.poi[key] != null) assertAuthoredTextCanon(request.poi[key], `request.${key}`)
  }
  for (const text of request.poi.openQuestions ?? []) assertAuthoredTextCanon(text, 'request.openQuestions')
}

export function assertDossierEvidence(dossier, evidence, {allowOfficial=false}={}) {
  canonicalJsonBytes(dossier, 'poi-facts/v1')
  assertPoiFacts(dossier)
  assert(Array.isArray(evidence) && evidence.length === dossier.sources.length, 'dossierEvidenceCount')
  for (const [i, raw] of evidence.entries()) {
    const e = assertEvidence(raw,{allowOfficial}), s = dossier.sources[i]
    assert.equal(s.evidenceDigest, e.digest, 'dossierEvidenceDigest')
    assert.equal(s.url, e.sourceUrl, 'dossierSourceUrl')
    assert.equal(s.observedAt, e.observedAt, 'dossierObservationDate')
    assert.deepEqual(s.blocks, e.blocks.map(({id,kind,locator,section}) => ({id,kind,locator,section})), 'dossierFullBlockInventory')
    // An owner-selected child can have a derived key while its evidence is
    // the parent article. An unrelated page cannot authorize that child.
    assert(dossier.sourceKey === e.sourceKey || (e.spec !== OFFICIAL_EVIDENCE_SPEC && ['_','-'].some(separator => dossier.sourceKey.startsWith(e.sourceKey + separator))), 'dossierSourceIdentity')
    for (const b of e.blocks) {
      if (!b.encodingIssue) continue
      const disposition = dossier.coverage.find(c => c.source === i && c.blockId === b.id)
      assert.equal(disposition?.disposition, 'unresolved', 'dossierUndecodedEvidence')
    }
  }
  return dossier
}

export function parseFactsPacket(raw) {
  canonicalJsonBytes(raw, FACTS_PACKET_SPEC)
  assert([FACTS_PACKET_SPEC, FACTS_WITH_OFFICIAL_SPEC].includes(raw.spec), 'factsPacketVersion')
  const allowOfficial = raw.spec === FACTS_WITH_OFFICIAL_SPEC
  assert(Array.isArray(raw.rows) && raw.rows.length > 0 && raw.rows.length <= 50, 'factsBatch: 1..50')
  const keys = new Set()
  for (const r of raw.rows) {
    assertDossierEvidence(r.dossier, r.evidence, {allowOfficial})
    assertDossierCanon(r.dossier)
    if (r.subjectAssessment !== undefined) assertSubjectAssessment(r.subjectAssessment, r.dossier)
    // Official notices supplement the portal article; they cannot substitute
    // an unrelated or absent Japan Guide source at the creation boundary.
    if (allowOfficial) assert(r.evidence.some(e => e.spec !== OFFICIAL_EVIDENCE_SPEC), 'factsPortalEvidenceRequired')
    assert(!keys.has(r.dossier.sourceKey), 'factsDuplicateSource'); keys.add(r.dossier.sourceKey)
  }
  return raw
}

/** Creation needs a complete evidence pass. Closed/contradictory observations
 * remain reportable, but never create an apparently available attraction. */
export function assertFactsForCreate(dossier) {
  assertDossierCanon(dossier)
  assert(!dossier.coverage.some(c => c.disposition === 'unresolved'), 'factsUnresolvedEvidence')
  if (dossier.facts.some(f => f.category === 'notice')) {
    assert(dossier.visit.status !== 'unknown', 'factsNoticeNeedsAssessment')
    assert(dossier.facts.filter(f => f.category === 'notice').every(f => dossier.visit.factIds.includes(f.id)), 'factsNoticeNotAssessed')
  }
  assert(!['temporaryClosed','permanentlyClosed','conflicting'].includes(dossier.visit.status), 'factsVisitReviewRequired')
}

/** Agent work packet. Empty facts/copy deliberately cannot pass validation. */
export function dossierSkeleton(evidence, {allowOfficial=false}={}) {
  const e = assertEvidence(evidence,{allowOfficial})
  return {spec:'poi-facts/v1',sourceKey:e.sourceKey,updatedAt:e.observedAt,
    sources:[{url:e.sourceUrl,observedAt:e.observedAt,evidenceDigest:e.digest,blocks:e.blocks.map(({id,kind,locator,section})=>({id,kind,locator,section}))}],
    facts:[],coverage:e.blocks.map(b=>({source:0,blockId:b.id,disposition:'unresolved',reason:'Agent has not reviewed this evidence block'})),
    visit:{status:'unknown',hoursKind:'unknown',hours:'',factIds:[],explanation:'Not assessed'},website:null,copy:{ru:[],en:[]}}
}
