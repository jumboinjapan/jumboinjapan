/** Pure proposal for the existing copy executor. No store, fetch or arbitrary fields. */
import assert from 'node:assert/strict'
import { assertExactKeys, canonicalJsonBytes, deepFreeze } from '../../lib/canonical-contract.mjs'
import { storePoiFacts } from '../../../src/lib/poi-facts.ts'
import { TAXONOMY_FIELDS, taxonomyRecordFields } from '../../../src/lib/poi-taxonomy-airtable.ts'
import { assertDossierEvidence, assertDossierCanon, assertSubjectAssessment, dossierCopy } from './japan-guide-facts.mjs'
import { classifyModelResponse, isRouteToPoi } from './classification-contract.mjs'
import { legacyAirtableCategory } from './legacy-airtable-category-bridge.mjs'
import { fieldEquals } from './verified-write.mjs'
import { isReviewedParent } from './japan-guide-review.mjs'

export const DRAFT_REVISION_SPEC = 'poi-japan-guide-draft-revision/v1'
export const DRAFT_REVISION_FIELDS = Object.freeze([
  'Description Draft (RU)', 'Description Draft (EN)', 'Notes',
  ...Object.values(TAXONOMY_FIELDS), 'POI Category (RU)',
])
const rowKeys = ['recordId','sourceKey','nameRu','previousFields','dossier','evidence','subjectAssessment','classification']
const fieldsMatch = (left, right) => [...new Set([...Object.keys(left), ...Object.keys(right)])]
  .every(key => fieldEquals(left[key], right[key], key))

function draftIdentity(row, fields) {
  assert(fields && typeof fields === 'object' && !Array.isArray(fields), 'revisionFieldsRequired')
  assert.equal(fields['Source Key'], row.sourceKey, 'revisionSourceDrift')
  assert.equal(fields['POI Name (RU)'], row.nameRu, 'revisionNameDrift')
  assert.equal(fields['Copy Status'], 'Draft', 'revisionDraftRequired')
  assert.equal(fields['Fact Check Status'], 'Todo', 'revisionTodoRequired')
}

function revisionFields(row) {
  assertExactKeys(row, rowKeys, 'draft revision row')
  assert(/^rec[A-Za-z0-9]{14}$/.test(row.recordId), 'revisionRecordId')
  assert(typeof row.sourceKey === 'string' && /^japan-guide:[A-Za-z0-9_-]+$/.test(row.sourceKey), 'revisionSourceKey')
  draftIdentity(row, row.previousFields)
  assertDossierEvidence(row.dossier, row.evidence, {allowOfficial:true})
  assertDossierCanon(row.dossier)
  assert.equal(row.dossier.sourceKey, row.sourceKey, 'revisionDossierIdentity')
  const assessment = assertSubjectAssessment(row.subjectAssessment, row.dossier)
  assert(!isReviewedParent(row.sourceKey) || assessment.role === 'parent', 'subjectAssessmentParentRequired')
  assert.equal(assessment.nameRu, row.nameRu, 'revisionAssessmentName')
  const copy = dossierCopy(row.dossier)
  const fields = {
    'Description Draft (RU)': copy.ru, 'Description Draft (EN)': copy.en,
    Notes: storePoiFacts(row.previousFields.Notes ?? '', row.dossier),
  }
  let primaryType = row.previousFields[TAXONOMY_FIELDS.type]
  if (row.classification !== null) {
    const verdict = classifyModelResponse(row.classification, {sourceKey:row.sourceKey})
    assert(verdict.ok && isRouteToPoi(verdict.classification), 'revisionClassificationRequired')
    assert.equal(row.classification.nameRu, row.nameRu, 'revisionClassificationName')
    const c = verdict.classification
    const taxonomy = taxonomyRecordFields(c)
    assert(taxonomy.ok, 'revisionTaxonomyUnrepresentable')
    // Only optional taxonomy fields have a defined clearing operation here.
    // Airtable omits cleared fields on GET; the approved intent is null, never [].
    Object.assign(fields, Object.fromEntries(Object.entries(taxonomy.fields).map(([key, value]) => [key, value ?? null])))
    primaryType = c.poiPrimaryType
    const legacy = legacyAirtableCategory(primaryType)
    fields['POI Category (RU)'] = legacy.value ? [legacy.value] : null
    if (legacy.reason) {
      const note = `Совместимость старой категории: ${legacy.reason}`
      if (!fields.Notes.includes(note)) fields.Notes += `\n\n${note}`
    }
  }
  assert.equal(assessment.poiPrimaryType, primaryType, 'revisionAssessmentTypeDrift')
  // Include the optional bridge explanation in the shared storage-capacity check.
  fields.Notes = storePoiFacts(fields.Notes, row.dossier)
  return fields
}

export function parseDraftRevisionPacket(raw) {
  canonicalJsonBytes(raw, DRAFT_REVISION_SPEC)
  assertExactKeys(raw, ['spec','rows'], DRAFT_REVISION_SPEC)
  assert.equal(raw.spec, DRAFT_REVISION_SPEC)
  assert(Array.isArray(raw.rows) && raw.rows.length > 0 && raw.rows.length <= 25, 'revisionBatch: 1..25')
  const ids = new Set(), keys = new Set()
  for (const row of raw.rows) {
    revisionFields(row)
    assert(!ids.has(row.recordId) && !keys.has(row.sourceKey), 'revisionDuplicateTarget')
    ids.add(row.recordId); keys.add(row.sourceKey)
  }
  return deepFreeze(raw)
}

export function draftRevisionProposal(row, found) {
  canonicalJsonBytes(row, DRAFT_REVISION_SPEC)
  const proposed = revisionFields(row)
  assert.equal(found?.recordId, row.recordId, 'revisionTargetMissing')
  draftIdentity(row, found.fields)
  const after = {...row.previousFields, ...proposed}
  // Whole-record old or whole-record final: never accept a mixed or foreign edit.
  assert(fieldsMatch(found.fields, row.previousFields) || fieldsMatch(found.fields, after), 'revisionPreviousFieldsDrift')
  return {recordId:row.recordId, proposed}
}
