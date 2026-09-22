import assert from 'node:assert/strict'
import { PHOTOS_TABLE_NAME, PHOTO_FILES_TABLE_NAME, PHOTO_USAGES_TABLE_NAME, POI_TABLE_ID } from '../../src/lib/airtable-schema.ts'
import { findVariant, validateBatch } from './core.mjs'

const field = (name,type = 'singleLineText',options) => ({ name,type,...(options ? {options} : {}) })
const link = (name,table) => field(name,'multipleRecordLinks',{ linkedTableId:table })
export function mediaSchema(tables = []) {
  const tableId = name => tables.find(t => t.name === name)?.id || `<${name}>`
  return [
    { name:PHOTOS_TABLE_NAME, fields:[field('Asset ID'),field('Title RU'),field('Collection'),field('Rights','multilineText'),field('Status')] },
    { name:PHOTO_FILES_TABLE_NAME, fields:[field('Variant ID'),link('Photo',tableId(PHOTOS_TABLE_NAME)),field('SHA256'),field('Dropbox ID'),field('Dropbox Path','multilineText'),field('Bytes','number',{ precision:0 }),field('Width','number',{ precision:0 }),field('Height','number',{ precision:0 }),field('Role'),field('Status')] },
    { name:PHOTO_USAGES_TABLE_NAME, fields:[field('Usage ID'),link('Photo',tableId(PHOTOS_TABLE_NAME)),link('File',tableId(PHOTO_FILES_TABLE_NAME)),link('POI',POI_TABLE_ID),field('Role'),field('Status'),field('Public Path'),field('Alt RU','multilineText')] },
  ]
}
export function assertMediaSchema(tables, { allowMissing = false } = {}) {
  for (const want of mediaSchema(tables)) {
    assert(!tables.some(t=>t.name.toLowerCase()===want.name.toLowerCase() && t.name!==want.name),'ambiguous media table name')
    const found = tables.filter(t => t.name === want.name)
    if (!found.length && allowMissing) continue
    assert.equal(found.length,1,`${want.name}: table missing or ambiguous; run schema-plan`)
    for (const f of want.fields) {
      const actual = found[0].fields.find(x => x.name === f.name)
      assert(actual?.type === f.type, `${want.name}.${f.name}: missing/wrong field type`)
      if (f.options?.linkedTableId) assert.equal(actual.options?.linkedTableId,f.options.linkedTableId,`${f.name}: wrong linked table`)
    }
    assert.equal(found[0].primaryFieldId,found[0].fields.find(x => x.name === want.fields[0].name)?.id,'unexpected primary key field')
  }
}
export class AirtableMedia {
  constructor({ env = process.env, fetchImpl = fetch } = {}) {
    this.env = env; this.fetch = fetchImpl; this.tables = []; this.poiRecords = new Map(); this.lastRequest = 0
  }
  async request(suffix,{ method='GET', body } = {}) {
    assert(this.env.AIRTABLE_TOKEN && /^app[a-zA-Z0-9]+$/.test(this.env.AIRTABLE_BASE_ID || ''),'Airtable credentials missing')
    const delay = 220 - (Date.now()-this.lastRequest)
    if (delay > 0) await new Promise(resolve => setTimeout(resolve,delay))
    this.lastRequest = Date.now()
    const r = await this.fetch(`https://api.airtable.com/v0/${suffix}`, { method, headers:{ Authorization:`Bearer ${this.env.AIRTABLE_TOKEN}`, 'Content-Type':'application/json' }, ...(body ? { body:JSON.stringify(body) } : {}), signal:AbortSignal.timeout(30000), redirect:'error' })
    assert(r.ok,`Airtable ${method} failed (${r.status}); reconcile before retrying a write`)
    return r.json()
  }
  async schema() { const d = await this.request(`meta/bases/${this.env.AIRTABLE_BASE_ID}/tables`); assert(Array.isArray(d.tables),'invalid Airtable schema'); this.tables=d.tables; return d.tables }
  async schemaPlan() { const current=await this.schema(); assertMediaSchema(current,{allowMissing:true}); return mediaSchema(current).map(t => ({ ...t, operation:current.some(x => x.name===t.name) ? 'validate-existing' : 'create' })) }
  async initialize(journal) {
    const before=await this.schema();assertMediaSchema(before,{allowMissing:true})
    assert(before.find(t=>t.id===POI_TABLE_ID)?.fields.some(f=>f.name==='POI ID' && f.type==='singleLineText'),'target base lacks the canonical POI table/key')
    await journal({event:'schema-preflight',baseId:this.env.AIRTABLE_BASE_ID,tablesBefore:before})
    for (const name of [PHOTOS_TABLE_NAME,PHOTO_FILES_TABLE_NAME,PHOTO_USAGES_TABLE_NAME]) {
      const tables=await this.schema(); const spec=mediaSchema(tables).find(x=>x.name===name)
      if (tables.some(t=>t.name===name)) continue
      assert(!tables.some(t=>t.name.toLowerCase()===name.toLowerCase()),'ambiguous table name')
      await journal({ event:'schema-create-start',spec })
      const created=await this.request(`meta/bases/${this.env.AIRTABLE_BASE_ID}/tables`,{ method:'POST',body:spec })
      const readback=await this.schema(); assert(readback.some(t=>t.id===created.id && t.name===name),'table creation not visible')
      await journal({ event:'schema-created',name,id:created.id })
    }
    assertMediaSchema(await this.schema())
  }
  async preflight(batch) {
    validateBatch(batch); assertMediaSchema(await this.schema())
    for (const poiId of new Set(batch.items.map(x=>x.input.poiId).filter(Boolean))) {
      const query=new URLSearchParams({ filterByFormula:`{POI ID}='${poiId}'`,maxRecords:'2' })
      const d=await this.request(`${this.env.AIRTABLE_BASE_ID}/${POI_TABLE_ID}?${query}`)
      assert(d.records?.length===1,`${poiId}: POI missing or ambiguous`)
      this.poiRecords.set(poiId,d.records[0].id)
    }
    // Check read access to each media table before reserving any Dropbox IDs.
    for (const spec of mediaSchema(this.tables)) await this.request(`${this.env.AIRTABLE_BASE_ID}/${this.tables.find(t=>t.name===spec.name).id}?maxRecords=1`)
  }
  async upsert(name,key,fields,journal) {
    const table=this.tables.find(t=>t.name===name); assert(table,'missing media table')
    assert(/^[A-Z0-9:-]+$/.test(fields[key]),'unsafe media key')
    const query=new URLSearchParams({filterByFormula:`{${key}}='${fields[key]}'`,maxRecords:'2'})
    const existing=await this.request(`${this.env.AIRTABLE_BASE_ID}/${table.id}?${query}`)
    assert(Array.isArray(existing.records) && existing.records.length<=1,'ambiguous media key')
    fields={...fields}
    // Editorial selection can change after intake. Never reset it on a new batch.
    if (existing.records.length) { delete fields.Status; delete fields.Role }
    await journal({ event:'airtable-upsert-start',tableId:table.id,key:fields[key] })
    const d=await this.request(`${this.env.AIRTABLE_BASE_ID}/${table.id}`,{ method:'PATCH',body:{ performUpsert:{ fieldsToMergeOn:[key] }, records:[{fields}], typecast:false } })
    assert(d.records?.length===1 && d.records[0].id,'unexpected upsert response')
    const record={ tableId:table.id,recordId:d.records[0].id,fields }
    await this.verify([record]); await journal({ event:'airtable-upsert-verified',tableId:table.id,recordId:record.recordId })
    const stableFields={...fields}; delete stableFields.Status; delete stableFields.Role
    return {...record,fields:stableFields}
  }
  async verify(records) {
    for (const item of records) {
      const d=await this.request(`${this.env.AIRTABLE_BASE_ID}/${item.tableId}/${item.recordId}`)
      for (const [key,value] of Object.entries(item.fields)) assert.deepEqual(d.fields?.[key] ?? (Array.isArray(value) ? [] : ''),value,`Airtable readback mismatch: ${key}`)
    }
  }
  async upsertVerified(registry,batch,journal) {
    const records=[], photos=new Map(), variants=new Map()
    for (const item of batch.items) {
      for (const f of item.files) {
        const {asset,variant}=findVariant(registry,f.sha256)
        assert.equal(variant.dropbox?.status,'completed','cannot index unverified file')
        if (!photos.has(asset.assetId)) {
          const photo=await this.upsert(PHOTOS_TABLE_NAME,'Asset ID',{ 'Asset ID':asset.assetId,'Title RU':asset.titleRu,Collection:asset.collectionTag,Rights:asset.rightsStatus,Status:'Archived' },journal)
          photos.set(asset.assetId,photo.recordId);records.push(photo)
        }
        if (!variants.has(variant.variantId)) {
          const file=await this.upsert(PHOTO_FILES_TABLE_NAME,'Variant ID',{ 'Variant ID':variant.variantId,Photo:[photos.get(asset.assetId)],SHA256:variant.sha256,'Dropbox ID':variant.dropbox.fileId,'Dropbox Path':variant.dropbox.path,Bytes:variant.bytes,Width:variant.width,Height:variant.height,Role:variant.role,Status:'Verified' },journal)
          variants.set(variant.variantId,file.recordId);records.push(file)
        }
      }
      if (item.input.poiId) {
        const {asset,variant}=findVariant(registry,item.files[1].sha256)
        const key=`${variant.variantId}:${item.input.poiId}`
        if (!records.some(r=>r.fields['Usage ID']===key)) records.push(await this.upsert(PHOTO_USAGES_TABLE_NAME,'Usage ID',{
          'Usage ID':key,Photo:[photos.get(asset.assetId)],File:[variants.get(variant.variantId)],POI:[this.poiRecords.get(item.input.poiId)],Role:'POI candidate',Status:'Ready for selection',
        },journal))
      }
    }
    return records
  }
}
