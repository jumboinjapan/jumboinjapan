/** Cross-portal fact reconciliation: pure proposals for the EXISTING update executor.
 * Agents resolve meaning; code binds their evidence, preserves history and rejects drift. */
import assert from 'node:assert/strict'
import { canonicalJsonBytes, assertExactKeys, deepFreeze } from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { assertPoiFacts, isPoiSourceKey, readPoiFacts, storePoiFacts } from '../../../src/lib/poi-facts.ts'
import { assertDossierEvidence } from './japan-guide-facts.mjs'
import { assertCopyReview, assertCurrentReviewDate } from './poi-copywriter.mjs'
import { fieldEquals } from './verified-write.mjs'

export const FACT_SYNC_SPEC = 'poi-fact-sync/v1'
export const FACT_SYNC_FIELDS = Object.freeze(['Notes','Description Draft (RU)','Description Draft (EN)','Working Hours','Website'])
const text = (v, message) => assert(typeof v === 'string' && v.trim(), message)
const equal = (a,b) => [...new Set([...Object.keys(a),...Object.keys(b)])].every(k=>fieldEquals(a[k],b[k],k))
const refKey = r => `${r.source}:${r.blockId}`
const uniqueRefs = refs => [...new Map(refs.map(r=>[refKey(r),r])).values()]
export const incomingFactId = (sourceKey,id) => `f-${sha256Bytes(canonicalJsonBytes({sourceKey,id},'poi-fact-id/v1')).slice(7,31)}`
function targetDossierKey(row) {
  if(row.sourceKey !== null) {assert(isPoiSourceKey(row.sourceKey),'syncTargetSourceKey');return row.sourceKey}
  assert(!row.previousFields['Source Key'] && /^POI-\d{6}$/.test(row.previousFields['POI ID']), 'syncLegacyIdentity')
  return `poi:${row.previousFields['POI ID']}`
}

function verification(v, fact, row, now) {
  assertExactKeys(v, ['reviewer','checkedAt','reason','sourceIndexes','effectiveFrom','effectiveUntil'], 'fact verification')
  text(v.reviewer,'factReviewer'); text(v.reason,'factResolutionReason'); assertCurrentReviewDate(v.checkedAt,now)
  assert(fact.status === 'verified','factCorrectionMustBeVerified')
  assert(Array.isArray(v.sourceIndexes) && v.sourceIndexes.length && new Set(v.sourceIndexes).size === v.sourceIndexes.length,'factVerificationSources')
  for (const i of v.sourceIndexes) {
    assert(Number.isInteger(i) && fact.references.some(r=>r.source===i),'factVerificationNotCited')
    const e = row.evidence[i]
    assert(e && ['official','publicAuthority'].includes(e.role), 'factCorrectionNeedsAuthority')
    assertCurrentReviewDate(e.observedAt, now)
    assert(Date.parse(e.observedAt) <= Date.parse(v.checkedAt), 'factReviewBeforeEvidence')
  }
  assert(v.effectiveFrom === null || (Number.isFinite(Date.parse(v.effectiveFrom)) && Date.parse(v.effectiveFrom) <= now.getTime()), 'factNotEffectiveYet')
  assert(v.effectiveUntil === null || (Number.isFinite(Date.parse(v.effectiveUntil)) && Date.parse(v.effectiveUntil) > now.getTime()), 'factNoLongerEffective')
}

/** Produces a reviewable result before copywriting. No I/O; original notes stay intact. */
export function mergePortalFacts(row, now = new Date()) {
  canonicalJsonBytes(row, FACT_SYNC_SPEC)
  const incoming = assertDossierEvidence(row.incoming,row.evidence,{allowOfficial:true,allowPortal:true})
  assert(Date.parse(incoming.updatedAt)<=now.getTime(),'syncFutureObservation')
  const old = readPoiFacts(row.previousFields.Notes ?? '')
  assert(!old.error,'syncExistingDossierCorrupt')
  const dossierKey=targetDossierKey(row)
  assert(!old.dossier || old.dossier.sourceKey === dossierKey,'syncExistingDossierIdentity')
  assert.equal(row.previousFields['Source Key']||null,row.sourceKey,'syncSourceDrift')
  assert.equal(row.previousFields['POI Name (RU)'],row.nameRu,'syncNameDrift')
  assert(/^rec[A-Za-z0-9]{14}$/.test(row.recordId),'syncRecordId')
  assertExactKeys(row.identity,['reviewer','checkedAt','reason','factIds'],'source-to-record identity')
  text(row.identity.reviewer,'syncIdentityReviewer'); text(row.identity.reason,'syncIdentityReason')
  assertCurrentReviewDate(row.identity.checkedAt,now)
  assert(Array.isArray(row.identity.factIds) && row.identity.factIds.length > 0,'syncIdentityFacts')
  for(const id of row.identity.factIds) {
    const f=incoming.facts.find(f=>f.id===id)
    assert(f && f.subject===row.nameRu && ['identity','composition'].includes(f.category),'syncIdentityWholePlace')
    assert(f.status==='verified','syncIdentityUnverified')
  }
  assert(Array.isArray(row.changes) && row.changes.length===incoming.facts.length,'syncEveryIncomingFact')
  const seen=new Set(), replaced=new Set(), events=[]
  const result=old.dossier ? structuredClone(old.dossier) : {...structuredClone(incoming),sources:[],facts:[],coverage:[],history:[]}
  result.spec='poi-facts/v2'; result.sourceKey=dossierKey; result.history ??= []
  const sourceMap=new Map()
  incoming.sources.forEach((s,i)=>{
    let target=result.sources.findIndex(old=>old.evidenceDigest===s.evidenceDigest && old.url===s.url)
    if(target<0){target=result.sources.length;result.sources.push(structuredClone(s));result.coverage.push(...incoming.coverage.filter(c=>c.source===i).map(c=>({...c,source:target})))}
    sourceMap.set(i,target)
  })
  const ids=new Map()
  for(const change of row.changes) {
    assertExactKeys(change,['incomingId','action','previousId','verification'],'fact change')
    const source=incoming.facts.find(f=>f.id===change.incomingId)
    assert(source && !seen.has(source.id),'syncUnknownOrDuplicateFact');seen.add(source.id)
    assert(['add','corroborate','replace','conflict'].includes(change.action),'syncFactAction')
    const fact=structuredClone(source);fact.references=fact.references.map(r=>({...r,source:sourceMap.get(r.source)}))
    if(change.action==='add') {
      assert(change.previousId===null && change.verification===null,'syncAddCannotReplace')
      const same=result.facts.find(f=>f.subject===fact.subject && f.category===fact.category && f.text===fact.text && f.conditions===fact.conditions && f.status===fact.status)
      if(same) {same.references=uniqueRefs([...same.references,...fact.references]);ids.set(source.id,same.id);events.push({action:'corroborate',id:same.id});continue}
      fact.id=incomingFactId(incoming.sourceKey,source.id)
      assert(!result.facts.some(f=>f.id===fact.id),'syncIncomingIdChangedMeaning')
      result.facts.push(fact);ids.set(source.id,fact.id);events.push({action:'add',id:fact.id});continue
    }
    const index=result.facts.findIndex(f=>f.id===change.previousId), previous=result.facts[index]
    assert(previous && !replaced.has(previous.id),'syncPreviousFactMissingOrRepeated');replaced.add(previous.id)
    assert(previous.subject===fact.subject && previous.category===fact.category,'syncDifferentSubjectOrCategory')
    if(change.action==='corroborate') {
      assert(change.verification===null && previous.text===fact.text && previous.conditions===fact.conditions && previous.status===fact.status,'syncCorroborationDiffers')
      previous.references=uniqueRefs([...previous.references,...fact.references]);ids.set(source.id,previous.id)
    } else if(change.action==='replace') {
      verification(change.verification,source,row,now)
      result.history.push({fact:structuredClone(previous),replacedBy:previous.id,checkedAt:change.verification.checkedAt,reviewer:change.verification.reviewer,reason:change.verification.reason})
      fact.id=previous.id;result.facts[index]=fact;ids.set(source.id,fact.id)
    } else {
      assert(change.verification===null,'syncConflictNotResolved')
      fact.id=incomingFactId(incoming.sourceKey,source.id);fact.status='conflicting'
      assert(!result.facts.some(f=>f.id===fact.id),'syncDuplicateConflict')
      previous.status='conflicting';result.facts.push(fact);ids.set(source.id,fact.id)
    }
    events.push({action:change.action,id:previous.id,old:previous.text,proposed:source.text,reason:change.verification?.reason??null})
  }
  // A researcher may already have resolved conflicting portal versions against
  // an operator. Carry that source history into the target namespace as well as
  // history produced by replacing a fact in the existing record.
  for(const entry of incoming.history??[]) {
    const replacedBy=ids.get(entry.replacedBy)
    assert(replacedBy,'syncIncomingHistoryTarget')
    const fact={...structuredClone(entry.fact),
      id:ids.get(entry.fact.id)??incomingFactId(incoming.sourceKey,entry.fact.id),
      references:entry.fact.references.map(r=>({...r,source:sourceMap.get(r.source)}))}
    const mapped={...structuredClone(entry),fact,replacedBy}
    if(!result.history.some(h=>JSON.stringify(h)===JSON.stringify(mapped)))result.history.push(mapped)
  }
  // Every assessment is explicit: absence in a new source never clears old values.
  assertExactKeys(row.assessments,['visit','website'],'sync assessments')
  const visitChanged=row.changes.some(c=>{
    const f=incoming.facts.find(f=>f.id===c.incomingId)
    return f.category==='notice' && ['add','replace'].includes(c.action)
  })
  assert(!visitChanged || row.assessments.visit==='incoming','syncNoticeNeedsNewAssessment')
  for(const field of ['visit','website']) {
    assert(['keep','incoming'].includes(row.assessments[field]),'syncAssessmentAction')
    if(row.assessments[field]==='keep') {assert(old.dossier,'syncNoPreviousAssessment');continue}
    const assessment=structuredClone(incoming[field])
    if(assessment) assessment.factIds=assessment.factIds.map(id=>ids.get(id))
    result[field]=assessment
  }
  const unresolved=new Set(result.facts.filter(f=>f.status==='conflicting').map(f=>f.id))
  if(result.visit.factIds.some(id=>unresolved.has(id))) {
    result.visit={...result.visit,status:'conflicting',hoursKind:'unknown',hours:'',explanation:'Сведения о посещении противоречат друг другу; агенту нужна дополнительная проверка источников.'}
  }
  if(result.website?.factIds.some(id=>unresolved.has(id))) result.website=null
  assert(result.facts.filter(f=>f.category==='notice').every(f=>result.visit.factIds.includes(f.id)), 'syncNoticeNotAssessed')
  result.updatedAt=incoming.updatedAt
  if(old.dossier) assert(Date.parse(result.updatedAt)>=Date.parse(old.dossier.updatedAt),'syncOlderSnapshot')
  result.copy=row.copy === null ? {ru:[],en:[]} : structuredClone(row.copy)
  assertPoiFacts(result)
  return {dossier:result,changes:events,incomingIds:ids}
}

export function factSyncProposal(row,found,now=new Date()) {
  canonicalJsonBytes(row,FACT_SYNC_SPEC)
  assertExactKeys(row,['recordId','sourceKey','nameRu','previousFields','incoming','evidence','identity','changes','assessments','copy','copyReview','writeDrafts','fieldUpdates'], 'fact sync row')
  const {dossier,changes,incomingIds}=mergePortalFacts(row,now)
  assertCopyReview(row.copyReview,dossier,now)
  assert(typeof row.writeDrafts==='boolean','syncDraftMode')
  const proposed={Notes:storePoiFacts(row.previousFields.Notes??'',dossier)}
  if(row.writeDrafts) {
    assert.equal(row.previousFields['Copy Status'],'Draft','syncDraftRequired')
    assert.equal(row.previousFields['Fact Check Status'],'Todo','syncTodoRequired')
    proposed['Description Draft (RU)']=dossier.copy.ru.map(c=>c.text).join('\n\n')
    proposed['Description Draft (EN)']=dossier.copy.en.map(c=>c.text).join('\n\n')
  }
  assert(Array.isArray(row.fieldUpdates),'syncFieldUpdates')
  const fields=new Set()
  for(const u of row.fieldUpdates) {
    assertExactKeys(u,['field','factId','verification'],'sync operational field')
    assert(['Working Hours','Website'].includes(u.field) && !fields.has(u.field),'syncProtectedOrDuplicateField');fields.add(u.field)
    const source=row.incoming.facts.find(f=>f.id===u.factId)
    assert(source,'syncFieldFactMissing');verification(u.verification,source,row,now)
    const change=row.changes.find(c=>c.incomingId===source.id)
    assert(change && change.action!=='conflict','syncConflictingField')
    const id=incomingIds.get(source.id)
    if(u.field==='Working Hours') {
      assert(row.assessments.visit==='incoming' && dossier.visit.hoursKind!=='unknown' && dossier.visit.factIds.includes(id),'syncHoursUnproven')
      assert(!['conflicting','unknown'].includes(dossier.visit.status),'syncVisitUnproven')
      proposed[u.field]=dossier.visit.hours
    } else {
      assert(row.assessments.website==='incoming' && dossier.website?.factIds.includes(id),'syncWebsiteUnproven')
      proposed[u.field]=dossier.website.url
    }
  }
  assert.equal(found?.recordId,row.recordId,'syncTargetMissing')
  assert(found.fields && (equal(found.fields,row.previousFields)||equal(found.fields,{...row.previousFields,...proposed})),'syncPreviousFieldsDrift')
  return {recordId:row.recordId,proposed,changes,unresolved:dossier.facts.filter(f=>f.status==='conflicting').map(f=>f.id),publicCopyUnchanged:true}
}
export function parseFactSyncPacket(raw,now=new Date()) {
  canonicalJsonBytes(raw,FACT_SYNC_SPEC)
  assertExactKeys(raw,['spec','portal','rows'],FACT_SYNC_SPEC)
  assert.equal(raw.spec,FACT_SYNC_SPEC,'syncVersion')
  assert(typeof raw.portal==='string' && /^[a-z][a-z0-9-]*$/.test(raw.portal),'syncPortal')
  assert(Array.isArray(raw.rows) && raw.rows.length>0 && raw.rows.length<=25,'syncBatch: 1..25')
  const ids=new Set()
  for(const row of raw.rows) {
    assert(row.incoming.sourceKey.startsWith(raw.portal+':'),'syncIncomingPortal')
    factSyncProposal(row,{recordId:row.recordId,fields:row.previousFields},now)
    assert(!ids.has(row.recordId),'syncDuplicateTarget');ids.add(row.recordId)
  }
  return deepFreeze(raw)
}
