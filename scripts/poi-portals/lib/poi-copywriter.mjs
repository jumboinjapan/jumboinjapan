/** Editorial evidence, never a claim that a regex can judge factual truth or style. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canonicalJsonBytes, assertExactKeys, deepFreeze } from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { assertPoiFacts } from '../../../src/lib/poi-facts.ts'
import { COPY_LIMITS } from '../../../src/lib/copy-limits.ts'
import { assertDossierCanon, dossierCopy, dossierDigest } from './japan-guide-facts.mjs'

export const EDITORIAL_POLICY = deepFreeze(JSON.parse(readFileSync(new URL('../../../config/poi-editorial-policy.v1.json', import.meta.url))))
export const COPY_REVIEW_SPEC = 'poi-copy-review/v1'
const loadDocuments = () => ({
  instructions:readFileSync(new URL('../../../docs/poi-intake/poi-copywriter.md', import.meta.url),'utf8'),
  canon:readFileSync(new URL('../../../docs/copy-canon-for-agents.md', import.meta.url),'utf8'),
  strategy:readFileSync(new URL('../../../docs/poi-intake/editorial-geo-seo.md', import.meta.url),'utf8'),
})
export const getEditorialPolicyDigest = () => sha256Bytes(canonicalJsonBytes({policy:EDITORIAL_POLICY,documents:loadDocuments(),limits:COPY_LIMITS}, 'poi-editorial-authority/v1'))
export function assertCurrentReviewDate(value, now = new Date()) {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'reviewDateRequired')
  const age = now.getTime() - Date.parse(value)
  assert(age >= 0 && age <= EDITORIAL_POLICY.maximumVerificationAgeDays * 86400000, 'reviewExpiredOrFuture')
}
export function assertUsableCopy(dossier) {
  canonicalJsonBytes(dossier, 'poi-copy-input/v1')
  assertPoiFacts(dossier)
  assertDossierCanon(dossier)
  assert(dossier.copy.ru.length > 0 && dossier.copy.en.length > 0, 'copyClausesRequired')
  const facts = new Map(dossier.facts.map(f => [f.id, f]))
  for (const locale of ['ru','en']) for (const clause of dossier.copy[locale]) {
    assert(!EDITORIAL_POLICY.forbiddenPhrases.some(s => clause.text.toLowerCase().includes(s)), 'copyEmptyHype')
    for (const id of clause.factIds) {
      const f = facts.get(id)
      assert(f && !['conflicting','unknown'].includes(f.status), 'copyUnsettledFact')
      if (f.status === 'legend') assert((locale === 'ru' ? /легенд|предани|традици/i : /legend|tradition|folklore/i).test(clause.text), 'copyLegendMustBeLabelled')
      if (f.status === 'interpretation') assert((locale === 'ru' ? /по мнению|считает|трактов|интерпретац/i : /according to|interpret|considers/i).test(clause.text), 'copyInterpretationMustBeLabelled')
    }
  }
  return dossierCopy(dossier)
}
export function buildCopyBrief(dossier) {
  canonicalJsonBytes(dossier, 'poi-copy-input/v1'); assertPoiFacts(dossier)
  const basis = structuredClone(dossier)
  delete basis.copy
  return {spec:'poi-copy-brief/v1', sourceKey:dossier.sourceKey,
    basisDigest:sha256Bytes(canonicalJsonBytes(basis, 'poi-copy-basis/v1')),
    policyDigest:getEditorialPolicyDigest(), policy:EDITORIAL_POLICY,
    roleLimits:COPY_LIMITS, facts:basis,
    usableFactIds:dossier.facts.filter(f => !['conflicting','unknown'].includes(f.status)).map(f => f.id),
    requiredNoticeIds:dossier.facts.filter(f => f.category === 'notice').map(f => f.id),
    ...loadDocuments()}
}
export function assertCopyReview(review, dossier, now = new Date()) {
  canonicalJsonBytes(review, COPY_REVIEW_SPEC)
  assertExactKeys(review, ['spec','dossierDigest','policyDigest','author','reviewer','checkedAt','checks','issues'], COPY_REVIEW_SPEC)
  assert.equal(review.spec, COPY_REVIEW_SPEC, 'copyReviewVersion')
  assert.equal(review.dossierDigest, dossierDigest(dossier), 'copyReviewDossierDrift')
  assert.equal(review.policyDigest, getEditorialPolicyDigest(), 'copyReviewPolicyDrift')
  assert(typeof review.author === 'string' && review.author.trim() && typeof review.reviewer === 'string' && review.reviewer.trim(), 'copyReviewActors')
  assert.notEqual(review.author.trim(), review.reviewer.trim(), 'copyIndependentReviewRequired')
  assertCurrentReviewDate(review.checkedAt, now)
  assertExactKeys(review.checks, EDITORIAL_POLICY.reviewDimensions, 'copy checks')
  assert(EDITORIAL_POLICY.reviewDimensions.every(k => review.checks[k] === true), 'copyReviewNotPassed')
  assert(Array.isArray(review.issues) && review.issues.length === 0, 'copyReviewIssuesRemain')
  assertUsableCopy(dossier)
  return review
}
