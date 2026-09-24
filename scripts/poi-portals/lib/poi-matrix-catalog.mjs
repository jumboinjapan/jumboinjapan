/** Read-only server consumer. Raw record fields never leave this boundary. */
import assert from 'node:assert/strict'
import { readPoiFacts } from '../../../src/lib/poi-facts.ts'
import { MATRIX_FIELD, readPoiMatrix, matchesPoiMatrix } from './poi-matrix.mjs'

export function readMatrixRecord(fields, now) {
  const raw = fields[MATRIX_FIELD]
  if (raw == null || raw === '') return { state:'missing', projection:null, error:null }
  const facts = readPoiFacts(typeof fields.Notes === 'string' ? fields.Notes : '')
  if (!facts.dossier || facts.error) return { state:'invalid', projection:null, error:'matrixDossierUnavailable' }
  try { return readPoiMatrix(raw, {
    poiId:fields['POI ID'], nameRu:fields['POI Name (RU)'],
    sourceKey:facts.dossier.sourceKey, fields, dossier:facts.dossier, now,
  }) } catch { return {state:'invalid',projection:null,error:'matrixRecordInvalid'} }
}

export function assertMatrixQuery(query) {
  matchesPoiMatrix(null, query)
  return query
}

export function matrixCatalog(records, query, now) {
  assertMatrixQuery(query)
  const coverage={valid:0,missing:0,invalid:0}
  const matchedIds=[]
  const seen=new Set()
  const items=records.filter(r=>!r.fields['Is System']).map(record=>{
    assert(typeof record.id==='string'&&!seen.has(record.id),'matrixCatalogDuplicateRecord')
    seen.add(record.id)
    const result=readMatrixRecord(record.fields,now)
    coverage[result.state]++
    if(matchesPoiMatrix(result.projection,query))matchedIds.push(record.id)
    return {id:record.id,poiId:record.fields['POI ID'],state:result.state,
      properties:result.projection?.properties.map(({code,state,ageRange})=>({code,state,ageRange}))??[]}
  })
  return {items,matchedIds,coverage,checkedAt:now}
}

/** Inject reader at the network boundary, never at the predicate. */
export async function searchMatrixCatalog(query, readRecords, now=new Date().toISOString()) {
  assertMatrixQuery(query)
  return matrixCatalog(await readRecords(),query,now)
}
