/** Owner-reviewed subplaces feed the existing Intake executor, never a second writer. */
import assert from 'node:assert/strict'
import ledger from '../../../config/poi-japan-guide-review.v1.json' with { type: 'json' }
import { canonicalJsonBytes, assertExactKeys, deepFreeze, isStrictCalendarDate, calendarPlusDays } from '../../lib/canonical-contract.mjs'
import { assertReportDigest } from './enrichment.mjs'
import { classifyModelResponse, isRouteToPoi } from './classification-contract.mjs'
import { taxonomyRecordFields } from '../../../src/lib/poi-taxonomy-airtable.ts'
import { legacyAirtableCategory } from './legacy-airtable-category-bridge.mjs'
import { applyCanon } from '../../../src/lib/poi-canon.ts'
import { siteCityAgrees, siteCityDirection } from '../../../src/lib/poi-portal-place.ts'
import { ingestPoi } from '../../../src/lib/poi-ingest.ts'
import { screenNewPoi } from '../../../src/lib/poi-matching.ts'
import { canonicalPrefecture } from '../../../src/lib/prefectures.ts'
import { loadCoordinateDecisions } from '../../../src/lib/poi-coordinate-decision.ts'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { operatingStatusFromGoogle } from '../../../src/lib/poi-canon.ts'

export const JG_REVIEW_SPEC = 'poi-japan-guide-review/v1'
const filled = s => typeof s === 'string' && s.trim() === s && s.length > 0
const keyShape = /^japan-guide:e\d+(?:-[a-z0-9]+)*$/
const fieldKeys = ['sourceKey','originKey','decisionRef','subject','sourceUrl','parentKey','existingPoiId','distinctFrom','proposal','facts','descriptionRu','descriptionEn','ticketsNote','searchAliases']
canonicalJsonBytes(ledger,JG_REVIEW_SPEC)
assertExactKeys(ledger,['spec','rows'],JG_REVIEW_SPEC)
assert.equal(ledger.spec,JG_REVIEW_SPEC)
assert(Array.isArray(ledger.rows),'Review rows required')
const decisions = new Map()
for (const row of ledger.rows) {
  assertExactKeys(row,fieldKeys,'review row')
  assert(keyShape.test(row.sourceKey) && keyShape.test(row.originKey),'Stable source key required')
  assert(!decisions.has(row.sourceKey),'Duplicate reviewed source key')
  assert(filled(row.decisionRef),'Owner decision reference required')
  assertExactKeys(row.subject,['nameRu','nameEn','nameJa','siteCity'],'review subject')
  assert(Object.values(row.subject).every(filled),'Reviewed names and city required')
  assert(new URL(row.sourceUrl).protocol === 'https:','HTTPS source required')
  assert(row.parentKey === null || keyShape.test(row.parentKey) || /^POI-\d{6}$/.test(row.parentKey),'Invalid parent key')
  assert(row.parentKey !== row.sourceKey,'Self parent forbidden')
  assert(row.existingPoiId === null || /^POI-\d{6}$/.test(row.existingPoiId),'Invalid existing record binding')
  assert(Array.isArray(row.distinctFrom),'Named distinct objects required')
  for (const other of row.distinctFrom) {
    assertExactKeys(other,['key','nameRu','nameEn','siteCity'],'distinct object')
    assert(Object.values(other).every(filled),'Distinct object subject required')
  }
  assert(Array.isArray(row.facts) && row.facts.length > 0 && row.facts.length <= 12,'Sourced facts required')
  for (const f of row.facts) {
    assertExactKeys(f,['text','sourceUrl','checkedOn'],'review fact')
    assert(filled(f.text) && f.text.length <= 600 && new URL(f.sourceUrl).protocol === 'https:' && isStrictCalendarDate(f.checkedOn),'Invalid sourced fact')
  }
  assert(filled(row.descriptionRu) && filled(row.descriptionEn),'Both draft descriptions required')
  assert(typeof row.ticketsNote === 'string','Visit note must be text')
  assert(Array.isArray(row.searchAliases) && row.searchAliases.length <= 2,'At most two sourced aliases')
  for (const alias of row.searchAliases) {
    assertExactKeys(alias,['language','name','sourceUrl'],'search alias')
    assert(['ja','en'].includes(alias.language) && filled(alias.name) && new URL(alias.sourceUrl).protocol === 'https:','Invalid sourced alias')
  }
  const classified = classifyModelResponse(row.proposal,{sourceKey:row.sourceKey})
  assert(classified.ok && isRouteToPoi(classified.classification),'Proposal must route to POI')
  assert.equal(row.proposal.nameRu,row.subject.nameRu,'Proposal subject mismatch')
  decisions.set(row.sourceKey,deepFreeze(row))
}
function visit(key,stack = new Set()) {
  assert(!stack.has(key),'Parent cycle forbidden')
  const parent = decisions.get(key)?.parentKey
  if (parent?.startsWith('japan-guide:')) {
    assert(decisions.has(parent),'Unknown reviewed parent')
    visit(parent,new Set([...stack,key]))
  }
}
for (const key of decisions.keys()) visit(key)
export const reviewCatalogDigest = sha256Bytes(canonicalJsonBytes(ledger,JG_REVIEW_SPEC))

export const isReviewedParent = key => ledger.rows.some(row => row.parentKey === key)

// Shared by intake and the retrospective integrity check. A decision binds
// both named subjects and their keys; proximity or a shared parent is insufficient.
export function reviewedDistinctSubject(sourceKey, subject, otherKey, other) {
  const item = decisions.get(sourceKey)
  const fields = ['nameRu','nameEn','siteCity']
  if (!item || !fields.every(field => item.subject[field] === subject[field])) return false
  return item.distinctFrom.some(named => named.key === otherKey &&
    fields.every(field => named[field] === other[field]))
}

export function reviewSelection(raw) {
  canonicalJsonBytes(raw,JG_REVIEW_SPEC)
  assertExactKeys(raw,['spec','sourceKeys'],JG_REVIEW_SPEC)
  assert.equal(raw.spec,JG_REVIEW_SPEC)
  assert(Array.isArray(raw.sourceKeys) && raw.sourceKeys.length > 0 && raw.sourceKeys.length <= 50,'Select 1..50 reviewed objects')
  assert(new Set(raw.sourceKeys).size === raw.sourceKeys.length,'Duplicate selection')
  for (const key of raw.sourceKeys) assert(decisions.has(key),'Unknown reviewed object')
  const selected = new Set(raw.sourceKeys), ordered = [], seen = new Set()
  const add = key => {
    if (seen.has(key)) return
    const parent = decisions.get(key).parentKey
    if (selected.has(parent)) add(parent)
    seen.add(key);ordered.push(decisions.get(key))
  }
  raw.sourceKeys.forEach(add)
  return ordered
}

/** Sourced full names precede the shortened editorial label; neither is inferred from a neighbour. */
export function reviewIdentificationQueue(selection) {
  return reviewSelection(selection).filter(item=>!item.existingPoiId && !loadCoordinateDecisions().get(item.sourceKey)).map(item=>{
    const ja = item.searchAliases.find(alias=>alias.language === 'ja')
    const en = item.searchAliases.find(alias=>alias.language === 'en')
    const direction = siteCityDirection(item.subject.siteCity)
    assert(direction.ok,'Review search direction missing')
    return {sourceKey:item.sourceKey,sourceUrl:item.sourceUrl,nameJa:ja?.name??item.subject.nameJa,
      nameJaAlternative:item.subject.nameJa,nameEn:item.subject.nameEn,nameEnAlternative:en?.name??null,
      siteCity:item.subject.siteCity,searchArea:item.subject.siteCity,prefectureEn:direction.expected.en,
      address:null,locationBias:null,enrichedFrom:null}
  })
}

export function prepareReviewedIntake(selection,identification,snapshot,today) {
  const selected = reviewSelection(selection)
  assertReportDigest(identification,'poi-place-identification/v1','review identification')
  assert.equal(identification.inputs?.reviewCatalog?.digest,reviewCatalogDigest,'Reviewed catalog drift')
  assert(isStrictCalendarDate(today),'Calendar date required')
  const hits = new Map()
  for (const row of identification.rows) { assert(!hits.has(row.sourceKey),'Repeated identification');hits.set(row.sourceKey,row) }
  const rows = [], requests = [], candidates = []
  const coordinateDecisions = loadCoordinateDecisions()
  for (const item of selected) {
    const key = item.sourceKey, hit = hits.get(key), place = hit?.outcome === 'resolved' ? hit.place : null
    const ownerPoint = coordinateDecisions.get(key)
    const base = {sourceKey:key,nameRu:item.subject.nameRu,originKey:item.originKey,decisionRef:item.decisionRef}
    const known = snapshot.find(r=>r.sourceKey === key || (item.existingPoiId && r.poiId === item.existingPoiId))
    if (known && item.existingPoiId) for (const field of ['nameRu','nameEn','siteCity']) assert.equal(known[field],item.subject[field],'Existing subject drift')
    if (known) { rows.push({...base,outcome:'already_ingested',poiId:known.poiId});continue }
    if (!place && !ownerPoint) { rows.push({...base,outcome:'identificationPending'});continue }
    if (place?.businessStatus === 'CLOSED_PERMANENTLY') { rows.push({...base,outcome:'closedSourceListing'});continue }
    let coords
    if (ownerPoint) {
      assert.equal(ownerPoint.decision,'representativePoint','Reviewed area needs a representative point')
      coords = ownerPoint.point // Intake independently binds the decision to all declared subject fields.
    } else {
      assert.equal(hit.nameEn,item.subject.nameEn,'Identification name mismatch')
      assert.equal(hit.siteCity,item.subject.siteCity,'Identification city mismatch')
      assert.equal(hit.sourceUrl,item.sourceUrl,'Identification source mismatch')
      coords = place.coordinates
      assert(filled(place.placeId),'Place ID required')
      assert(coords?.ttlDays === 30 && isStrictCalendarDate(coords.observedOn) && coords.validUntil === calendarPlusDays(coords.observedOn,30),'Invalid coordinate retention')
      if (today > coords.validUntil || today < coords.observedOn) { rows.push({...base,outcome:'coordinatesExpired'});continue }
      assert(siteCityAgrees(item.subject.siteCity,canonicalPrefecture(place.prefecture?.en)).ok,'Identification prefecture mismatch')
    }
    assert(Number.isFinite(coords?.lat) && Number.isFinite(coords?.lon),'Coordinate pair required')
    const classification = classifyModelResponse(item.proposal,{sourceKey:key}).classification
    const taxonomy = {poiPrimaryType:classification.poiPrimaryType,facets:classification.facets,classificationSource:classification.classificationSource,taxonomyVersion:classification.taxonomyVersion}
    assert(taxonomyRecordFields(taxonomy).ok,'Taxonomy unrepresentable')
    const legacy = legacyAirtableCategory(taxonomy.poiPrimaryType)
    const poi = {...item.subject,sourceName:item.subject.nameJa,machineNamed:false,
      lat:coords.lat,lon:coords.lon,taxonomy,categoriesRu:legacy.value?[legacy.value]:[],
      ...(new URL(item.sourceUrl).hostname !== 'www.japan-guide.com'?{website:item.sourceUrl}:{}),
      descriptionRu:item.descriptionRu,descriptionEn:item.descriptionEn,
      ticketsNote:item.ticketsNote,
      ...(place?{operatingStatus:operatingStatusFromGoogle(place.businessStatus)}:{}),
      sources:[...new Set([item.sourceUrl,...item.facts.map(f=>f.sourceUrl)])],
      openQuestions:[`OWNER REVIEW ${item.decisionRef}; исходная очередь ${item.originKey}.`,...(legacy.reason?[`Совместимость старой категории: ${legacy.reason}`]:[]),...item.facts.map(f=>`${f.text} Источник: ${f.sourceUrl}; проверено ${f.checkedOn}.`)],
      resolved:{nameJa:item.subject.nameJa,...(!ownerPoint?{placeId:place.placeId,lat:coords.lat,lon:coords.lon,coordsCheckedAt:coords.observedOn,prefectureEn:place.prefecture.en,prefectureRu:place.prefecture.ru}:{})},
    }
    // Source Name carries JA; nameJa is not an input field of the shared canon.
    delete poi.nameJa
    assert(!applyCanon(poi).issues.some(i=>i.level==='error'),'Reviewed candidate fails canon')
    requests.push({source:{kind:'external-agent',id:'japan-guide',externalKey:key.slice('japan-guide:'.length),url:item.sourceUrl},poi})
    candidates.push({sourceKey:key,...item.subject,lat:coords.lat,lon:coords.lon})
    rows.push({...base,outcome:'writable'})
  }
  return {rows,requests,candidates,airtableRecords:snapshot.length,airtableWithSourceKey:snapshot.filter(r=>r.sourceKey).length}
}

/** Applies only recorded pair decisions. Unknown neighbours and same Place ID still stop. */
export async function ingestReviewedPoi(request,store,options = {}) {
  const key = `${request.source.id}:${request.source.externalKey}`, item = decisions.get(key)
  assert(item,'Unknown reviewed request')
  for (const field of ['nameRu','nameEn','siteCity']) assert.equal(request.poi[field],item.subject[field],'Reviewed subject drift')
  const existing = await store.listExisting()
  // PoiLike deliberately omits Source Key. Resolve keys through the store's
  // identity index, including parents created earlier in this same batch.
  const byKey = async wanted => wanted?.startsWith('japan-guide:')
    ? await store.findBySourceKey(wanted)
    : existing.find(r=>r.poiId === wanted) ?? null
  const parentAlias = decisions.get(item.parentKey)?.existingPoiId
  const parent = item.parentKey ? await byKey(parentAlias ?? item.parentKey) : null
  if (item.parentKey && !parent) return {outcome:'parentUnavailable',poiId:null,recordId:null,fields:null}
  const prepared = {...request,poi:{...request.poi,...(parent?{parentNameRu:parent.nameRu,parentNameEn:parent.nameEn}:{})}}
  const preview = await ingestPoi(prepared,store,{...options,dryRun:true,force:false,existing})
  let force = false
  if (['blocked_duplicate','needs_review'].includes(preview.outcome)) {
    if (existing.some(r=>r.placeId && r.placeId === request.poi.resolved?.placeId)) return preview
    const distinctIds = new Set()
    for (const other of item.distinctFrom) {
      const found = await byKey(other.key)
      if (found && reviewedDistinctSubject(item.sourceKey,request.poi,other.key,found)) distinctIds.add(found.recordId)
    }
    const remaining = existing.filter(r=>!distinctIds.has(r.recordId))
    const residual = screenNewPoi(request.poi,remaining,{})
    force = remaining.length < existing.length && residual.verdict === 'clear'
    if (!force) return preview
  } else if (preview.outcome !== 'created') return preview
  const check = force ? await ingestPoi(prepared,store,{...options,dryRun:true,force,existing}) : preview
  if (parent) assert.deepEqual(check.fields?.['Parent POI'],[parent.recordId],'Required parent link missing before write')
  const outcome = await ingestPoi(prepared,store,{...options,force,existing})
  if (outcome.outcome === 'created' && parent) assert.deepEqual(outcome.fields?.['Parent POI'],[parent.recordId],'Parent link lost')
  return outcome
}

export const REVIEW_LINK_SPEC = 'poi-japan-guide-review-links/v1'
export function parseReviewLinks(raw) {
  canonicalJsonBytes(raw,REVIEW_LINK_SPEC)
  assertExactKeys(raw,['spec','rows'],REVIEW_LINK_SPEC)
  assert.equal(raw.spec,REVIEW_LINK_SPEC)
  assert(Array.isArray(raw.rows) && raw.rows.length > 0 && raw.rows.length <= 25,'Link batch must contain 1..25 rows')
  const seen = new Set()
  for (const row of raw.rows) {
    assertExactKeys(row,['sourceKey','recordId','parentRecordId'],'review link')
    const item = decisions.get(row.sourceKey)
    assert(item?.existingPoiId && item.parentKey,'Existing link is not recorded by owner')
    assert(/^rec[A-Za-z0-9]{14}$/.test(row.recordId) && /^rec[A-Za-z0-9]{14}$/.test(row.parentRecordId),'Invalid link record ID')
    assert(row.recordId !== row.parentRecordId && !seen.has(row.recordId),'Self or repeated link')
    seen.add(row.recordId)
  }
  return deepFreeze(raw)
}

/** A packet chooses recorded edges only; fresh identity and ancestry are verified by the executor. */
export function reviewLinkProposal(row,found,parent) {
  const item = decisions.get(row.sourceKey)
  assert(item?.existingPoiId && item.parentKey,'Unknown existing link')
  assert.equal(found?.recordId,row.recordId,'Child record missing')
  assert.equal(parent?.recordId,row.parentRecordId,'Parent record missing')
  assert.equal(found.fields['POI ID'],item.existingPoiId,'Child identity drift')
  for (const [key,field] of [['nameRu','POI Name (RU)'],['nameEn','POI Name (EN)'],['siteCity','Site City']]) assert.equal(found.fields[field],item.subject[key],'Child subject drift')
  const parentItem = decisions.get(item.parentKey)
  const parentId = parentItem?.existingPoiId ?? (item.parentKey.startsWith('POI-') ? item.parentKey : null)
  assert.equal(parent.fields[parentId ? 'POI ID' : 'Source Key'],parentId ?? item.parentKey,'Parent identity drift')
  if (parentItem) for (const [key,field] of [['nameRu','POI Name (RU)'],['nameEn','POI Name (EN)'],['siteCity','Site City']]) assert.equal(parent.fields[field],parentItem.subject[key],'Parent subject drift')
  const old = found.fields['Parent POI'] ?? []
  assert(Array.isArray(old) && (old.length === 0 || (old.length === 1 && old[0] === row.parentRecordId)),'Existing parent conflict')
  const note = `PARENT ${item.decisionRef}: ${parent.fields['POI ID']}. Редакционная связь для маршрутов; не утверждение об административной границе или общей территории.`
  const notes = found.fields.Notes ?? ''
  assert(typeof notes === 'string','Notes must be text')
  return {recordId:row.recordId,proposed:{'Parent POI':[row.parentRecordId],Notes:notes.includes(note)?notes:[notes,note].filter(Boolean).join('\n\n')}}
}
