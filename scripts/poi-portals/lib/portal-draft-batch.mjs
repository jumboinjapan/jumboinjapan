/** Source-bound preparation for the existing journalled Intake executor.
 * The only supported new source is Visit Hokkaido. This module has no I/O. */
import assert from 'node:assert/strict'
import {canonicalJsonBytes,assertExactKeys,calendarPlusDays} from '../../lib/canonical-contract.mjs'
import {getPortal} from '../registry.mjs'
import {assertHokkaidoBundle,buildHokkaidoIntake,hokkaidoExpectedInput,hokkaidoPracticalProjection,hokkaidoPracticalSubject} from './visit-hokkaido.mjs'
import {portalIntakeCandidates} from './portal-intake-contract.mjs'
import {classifyModelResponse,terminalOutcome,TERMINAL} from './classification-contract.mjs'
import {evaluatePortalCandidates} from '../collect-pois.mjs'
import {prepareIntakeRequest} from './japan-guide-record.mjs'
import {assertDossierEvidence,assertFactsForRequest,dossierCopy} from './japan-guide-facts.mjs'
import {assertCopyReview} from './poi-copywriter.mjs'
import {assertReportDigest} from './enrichment.mjs'
import {operatingStatusFromGoogle} from '../../../src/lib/poi-canon.ts'
import {googleMapCid} from '../../../src/lib/google-map-reference.ts'
import {assertSourceRelations} from './source-relations.mjs'
import {sha256Bytes} from '../../lib/byte-digest.mjs'

export const PORTAL_DRAFT_BATCH_SPEC='poi-portal-draft-batch/v1'
export const PORTAL_SUBJECT_BATCH_SPEC='poi-portal-draft-batch/v2'
/** A reviewed alias may combine a named institution and building. Every proper
 * name part is literal evidence; only punctuation/honorific connectors join it. */
function sourcedSearchNames(input){
  const proofs=input.nameProofs===undefined?[]:input.nameProofs
  assert(Array.isArray(proofs)&&proofs.length<=6,'portalNameProofsShape')
  const names=new Set()
  for(const p of proofs){
    assertExactKeys(p,['name','field','factId','parts'],'portal name proof')
    assert(['nameJa','nameEn'].includes(p.field)&&typeof p.name==='string'&&p.name.trim()&&!names.has(p.field+':'+p.name),'portalNameProofIdentity')
    assert(Array.isArray(p.parts)&&p.parts.length>=2&&p.parts.length<=6,'portalNameProofParts')
    const f=input.dossier.facts.find(f=>f.id===p.factId)
    assert(f?.subject===input.nameRu&&f.category==='identity'&&f.status==='verified'&&f.text.includes(p.name),'portalNameProofSubject')
    let rest=p.name
    for(const part of p.parts){
      assertExactKeys(part,['text','source','blockId'],'portal name part')
      assert(typeof part.text==='string'&&part.text.trim()&&Number.isInteger(part.source),'portalNameProofPart')
      const e=input.evidence[part.source],b=e?.blocks.find(b=>b.id===part.blockId)
      assert(['official','publicAuthority','portal'].includes(e?.role)&&b?.text?.includes(part.text)&&f.references.some(r=>r.source===part.source&&r.blockId===part.blockId),'portalNameProofEvidence')
      const index=rest.indexOf(part.text)
      assert(index>=0&&/^(?:[\s・･、。,.()（）「」【】\[\]\-‐‑‒–—]|さん|の)*$/.test(rest.slice(0,index)),'portalNameProofComposition')
      rest=rest.slice(index+part.text.length)
    }
    assert(/^[\s・･、。,.()（）「」【】\[\]\-‐‑‒–—]*$/.test(rest),'portalNameProofComposition')
    names.add(p.field+':'+p.name)
  }
  return names
}
/**
 * ЧАСЫ КАРТОЧКИ ПОРТАЛА — ЧАСЫ ЕЁ ПРЕДМЕТА ТОЛЬКО ТАМ, ГДЕ ЭТО ВИДНО (HKP-02).
 *
 * Общий контракт уже требует, чтобы основание часов было фактами о самом
 * предмете. Здесь проверяется то, чего общий контракт не видит: откуда эти
 * факты. Если основание опирается на поле расписания карточки, а адаптер не
 * установил, что расписание принадлежит всей карточке (`state !== 'card'`:
 * строка названа парк-гольфом, телефон отнесён к визит-центру, источник
 * молчит), либо запись — дочерний предмет карточки, основание обязано
 * содержать проверенный факт оператора или органа власти. Иначе часы
 * остаются неизвестными — черновику это разрешено. Отказ — до запроса и до
 * любого ввода-вывода.
 */
function assertPortalHoursSubject(input,sourceRow,wholeCard,evidence){
  const v=input.dossier.visit
  if(v.hoursKind==='unknown')return
  assert(v.basis,'factsVisitBasisRequired')
  const subject=hokkaidoPracticalSubject(sourceRow)
  const facts=v.basis.hours.map(id=>input.dossier.facts.find(f=>f.id===id))
  const fromPortalSchedule=facts.some(f=>f.references.some(r=>r.source<sourceRow.cards.length&&['hours','closed'].includes(subject.fieldOfBlock(r.source,r.blockId)?.kind)))
  if(!fromPortalSchedule||(wholeCard&&subject.state==='card'))return
  const confirmed=facts.some(f=>f.status==='verified'&&f.references.some(r=>['official','publicAuthority'].includes(evidence[r.source]?.role)))
  assert(confirmed,`portalDraftHoursSubjectUnresolved: ${input.sourceKey} (${wholeCard?subject.state:'childSubject'})`)
}
export function preparePortalDraftBatch(packet,snapshot,today){
  canonicalJsonBytes(packet,PORTAL_DRAFT_BATCH_SPEC)
  assertExactKeys(packet,['spec','portal','bundle','identification','rows'],'portalDraftBatch')
  assert([PORTAL_DRAFT_BATCH_SPEC,PORTAL_SUBJECT_BATCH_SPEC].includes(packet.spec),'portalDraftBatchVersion')
  const subjects=packet.spec===PORTAL_SUBJECT_BATCH_SPEC
  assert.equal(packet.portal,'visit-hokkaido','portalDraftAdapterUnsupported')
  assertHokkaidoBundle(packet.bundle)
  assert.equal(packet.bundle.counts.incomplete,0,'portalDraftIncompleteSource')
  assert.equal(packet.bundle.counts.absent,0,'portalDraftAbsentSource')
  const portal=getPortal(packet.portal)
  const intake=portalIntakeCandidates(buildHokkaidoIntake(packet.bundle),portal,hokkaidoExpectedInput(packet.bundle))
  assert(Array.isArray(packet.rows)&&packet.rows.length>0&&packet.rows.length<=25,'portalDraftBatchSize')
  const keys=packet.rows.map(r=>r.sourceKey)
  assert.equal(new Set(keys).size,keys.length,'portalDraftDuplicate')
  const origins=packet.rows.map(r=>subjects?r.originKey:r.sourceKey)
  assert.deepEqual([...new Set(origins)].sort(),intake.candidates.map(c=>c.sourceKey).sort(),'portalDraftSourceSet')
  const identification=packet.identification
  assertReportDigest(identification,'poi-place-identification/v1','portal identification')
  assert.equal(identification.portal,portal.id,'portalDraftIdentificationPortal')
  assert.deepEqual(identification.rows.map(r=>r.sourceKey).sort(),[...keys].sort(),'portalDraftIdentificationSet')
  const rows=[],requests=[],candidates=[]
  for(const input of packet.rows){
    assertExactKeys(input,['sourceKey','nameRu','siteCity','proposal','dossier','evidence','subjectAssessment','copyReview',...(Object.hasOwn(input,'matrix')?['matrix']:[]),...(subjects?['originKey','subjectNames','sourceRelations','mapSelection',...(Object.hasOwn(input,'nameProofs')?['nameProofs']:[])]:[])],'portalDraftRow')
    const originKey=subjects?input.originKey:input.sourceKey
    assert(input.sourceKey===originKey||(subjects&&input.sourceKey.startsWith(originKey+'-')&&/^[a-z0-9-]+$/.test(input.sourceKey.slice(originKey.length+1))),'portalDraftChildKey')
    const origin=intake.candidates.find(c=>c.sourceKey===originKey)
    const sourceRow=packet.bundle.rows.find(r=>r.sourceKey===originKey)
    const primary=sourceRow.cards.map(c=>c.evidence),evidence=input.evidence
    assert(Array.isArray(evidence),'portalDraftEvidenceRequired')
    assert.deepEqual(evidence.slice(0,primary.length),primary,'portalDraftPrimaryEvidenceDrift')
    for(const extra of evidence.slice(primary.length)){
      assert(['official','publicAuthority'].includes(extra.role),'portalDraftSupplementAuthority')
      assert.equal(extra.sourceKey,input.sourceKey,'portalDraftSupplementIdentity')
    }
    assert.equal(input.dossier.spec,'poi-facts/v2','portalDraftV2Required')
    assert.equal(input.dossier.sourceKey,input.sourceKey,'portalDraftDossierIdentity')
    assertDossierEvidence(input.dossier,evidence,{allowPortal:true,allowOfficial:true})
    assertCopyReview(input.copyReview,input.dossier)
    assertPortalHoursSubject(input,sourceRow,input.sourceKey===originKey,evidence)
    const sourcedNames=sourcedSearchNames(input)
    if(subjects){
      assertExactKeys(input.subjectNames,['nameJa','nameEn'],'portal subject names')
      for(const name of Object.values(input.subjectNames)){
        assert(name===null||(typeof name==='string'&&name.trim()),'portalDraftSubjectName')
        if(name)assert(input.dossier.facts.some(f=>f.subject===input.nameRu&&['identity','composition'].includes(f.category)&&['reported','verified'].includes(f.status)&&f.text.includes(name)&&f.references.some(r=>evidence[r.source]?.blocks.find(b=>b.id===r.blockId)?.text?.includes(name))),'portalDraftSubjectNameEvidence')
      }
      assert(input.subjectNames.nameJa||input.subjectNames.nameEn,'portalDraftSubjectNameMissing')
      assert(input.sourceRelations===null||Array.isArray(input.sourceRelations),'portalDraftRelationsShape')
      if(input.sourceRelations)assertSourceRelations(input.sourceRelations,{nameRu:input.nameRu,factDossier:input.dossier})
    }
    const source=subjects?{...origin,sourceKey:input.sourceKey,nameJa:input.subjectNames.nameJa??'',nameEn:input.subjectNames.nameEn??''}:origin
    const classified=classifyModelResponse(input.proposal,{sourceKey:input.sourceKey})
    assert(classified.ok,'portalDraftClassification')
    assert.equal(classified.proposal.nameRu,input.nameRu,'portalDraftNameDrift')
    const hit=identification.rows.find(r=>r.sourceKey===input.sourceKey)
    if(subjects&&input.mapSelection!==null){
      const m=input.mapSelection
      assertExactKeys(m,['source','blockId','factId','cid',...(Object.hasOwn(m,'continuation')?['continuation']:[])],'portal map selection')
      const e=evidence[m.source],b=e?.blocks.find(b=>b.id===m.blockId),f=input.dossier.facts.find(f=>f.id===m.factId)
      assert(['official','publicAuthority'].includes(e?.role)&&['iframe','a'].includes(b?.mediaType),'portalMapSelectionAuthority')
      assert(f?.subject===input.nameRu&&f.category==='identity'&&f.status==='verified'&&f.references.some(r=>r.source===m.source&&r.blockId===m.blockId),'portalMapSelectionSubject')
      if(Object.hasOwn(m,'continuation')){
        const c=m.continuation
        assertExactKeys(c,['spec','fromUrl','selectedCid','observedAt','method','author','reviewer','artifactDigest'],'map continuation')
        assert(c.spec==='poi-map-continuation/v1'&&c.method==='browserNavigation','portalMapContinuationMethod')
        let from
        try{from=new URL(c.fromUrl)}catch{assert.fail('portalMapContinuationSource')}
        const fullMap=['google.com','www.google.com','maps.google.com','google.co.jp','www.google.co.jp','maps.google.co.jp'].includes(from.hostname)&&/^\/maps(?:\/|$)/.test(from.pathname)
        const shortMap=(from.hostname==='goo.gl'&&/^\/maps\/[A-Za-z0-9]+$/.test(from.pathname))||(from.hostname==='maps.app.goo.gl'&&/^\/[A-Za-z0-9]+$/.test(from.pathname))
        assert(c.fromUrl===b.url&&from.protocol==='https:'&&!from.username&&!from.password&&!from.port&&(fullMap||shortMap),'portalMapContinuationSource')
        assert(c.selectedCid===m.cid&&googleMapCid('https://maps.google.com/?cid='+c.selectedCid)===m.cid,'portalMapContinuationTarget')
        assert(c.reviewer===input.copyReview.reviewer&&typeof c.author==='string'&&c.author.trim()&&c.author!==c.reviewer,'portalMapContinuationReview')
        const at=Date.parse(c.observedAt),reviewed=Date.parse(input.copyReview.checkedAt)
        assert(Number.isFinite(at)&&at<=reviewed&&reviewed-at<=30*86400000,'portalMapContinuationDate')
        assert(/^sha256:[a-f0-9]{64}$/.test(c.artifactDigest)&&f.conditions.includes(sha256Bytes(canonicalJsonBytes(c,c.spec))),'portalMapContinuationBinding')
      }else assert(m.cid&&googleMapCid(b.url)===m.cid,'portalMapSelectionFeature')
      assert.equal(hit.selectedMapCid,m.cid,'portalMapSelectionIdentification')
    }else assert(hit.selectedMapCid==null,'portalMapSelectionUnproven')
    assert.equal(hit.sourceUrl,source.sourceUrl,'portalDraftIdentificationSource')
    // Identification retains a missing translation as null; Intake uses ''.
    // Normalize only absence, preserving exact comparison of supplied names.
    assert.equal(hit.nameJa??'',source.nameJa??'','portalDraftIdentificationName')
    assert.equal(hit.nameEn??'',source.nameEn??'','portalDraftIdentificationName')
    assert.equal(hit.address,source.address,'portalDraftIdentificationAddress')
    assert.equal(hit.siteCity,input.siteCity,'portalDraftIdentificationCity')
    for(const field of ['nameJaAlternative','nameEnAlternative'])if(hit[field]){
      const alias=hit[field]
      assert(sourcedNames.has(field.replace('Alternative','')+':'+alias)||input.dossier.facts.some(f=>f.subject===input.nameRu&&f.category==='identity'&&['reported','verified'].includes(f.status)
        &&f.text.includes(alias)&&f.references.some(r=>evidence[r.source]?.blocks.find(b=>b.id===r.blockId)?.text?.includes(alias))),'portalDraftAliasEvidence')
    }
    const place=hit.outcome==='resolved'?hit.place:null
    // HKP-03: the adapter's own projection, bound to the whole card subject.
    const practical=hokkaidoPracticalProjection(sourceRow,{wholeCardSubject:input.sourceKey===originKey})
    const candidate={...source,nameRu:input.nameRu,siteCity:input.siteCity,
      descriptionJa:sourceRow.cards[0].evidence.blocks.filter(b=>b.text).map(b=>b.text).join('\n'),
      ...practical,website:input.dossier.website?.url??null,
      lat:place?.coordinates?.lat??null,lon:place?.coordinates?.lon??null}
    candidates.push(candidate)
    const row={sourceKey:input.sourceKey,nameRu:input.nameRu,outcome:'identificationPending',identification:hit.outcome}
    rows.push(row)
    // A closed listing cannot become an apparently available attraction.
    if(place?.businessStatus==='CLOSED_PERMANENTLY'||(place?.businessStatus==='CLOSED_TEMPORARILY'&&input.dossier.visit.status!=='temporaryClosed')){
      row.outcome='closedSourceListing';continue
    }
    if(!place)continue
    const coords=place.coordinates
    assert(coords?.ttlDays===30&&coords.validUntil===calendarPlusDays(coords.observedOn,30),'portalDraftCoordinateRetention')
    const {verdict}=evaluatePortalCandidates(portal,[candidate])[0]
    const terminal=terminalOutcome({classification:classified.classification,blockingReasons:verdict.blockingReasons,
      score:verdict.score,hasCoords:Number.isFinite(candidate.lat)&&Number.isFinite(candidate.lon),importMinScore:verdict.importThreshold})
    if(terminal.outcome!==TERMINAL.POI_ELIGIBLE){row.outcome=terminal.outcome;row.reason=terminal.reason;continue}
    const prepared=prepareIntakeRequest({candidate,row:source,portal,identified:hit,classification:classified.classification,today})
    if(!prepared.ok){row.outcome='intakeIncomplete';row.reason=prepared.refusal;continue}
    const request=prepared.request
    assertFactsForRequest(input,request)
    const copy=dossierCopy(input.dossier)
    request.poi={...request.poi,descriptionRu:copy.ru,descriptionEn:copy.en,factDossier:input.dossier,
      ...(input.dossier.visit.status==='temporaryClosed'?{operatingStatus:operatingStatusFromGoogle('CLOSED_TEMPORARILY')}:{}),
      factEvidence:evidence,factCopyReview:input.copyReview,factSubjectAssessment:input.subjectAssessment,
      ...(Object.hasOwn(input,'matrix')?{matrix:input.matrix}:{}),
      ...(subjects&&input.sourceRelations?{sourceRelations:input.sourceRelations}:{}),
      ...(input.dossier.visit.hoursKind!=='unknown'?{workingHours:input.dossier.visit.hours}:{}),
      ...(input.dossier.website?{website:input.dossier.website.url}:{})}
    row.outcome='writable';requests.push(request)
  }
  return {rows,requests,candidates,airtableRecords:snapshot.length,airtableWithSourceKey:snapshot.filter(r=>r.sourceKey).length}
}
