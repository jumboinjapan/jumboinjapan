import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { sha256, fingerprint, validateInput, validateBatch, validateRegistry, planBatch, applyBatch, updateRegistry, LIBRARY, REGISTRY } from '../scripts/photo-intake/core.mjs'
import { prepare, loadBatch, safePath, exportWeb, appendJournal } from '../scripts/photo-intake/local.mjs'
import { DropboxStore } from '../scripts/photo-intake/dropbox.mjs'
import { AirtableMedia, mediaSchema, assertMediaSchema } from '../scripts/photo-intake/airtable.mjs'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'

const registry = () => ({schemaVersion:1,nextId:153,reservedDraftIds:'IMG-000001..IMG-000152; never reuse retired aliases',aliasMap:{},assets:[]})
function fixture(label='photo') {
  const buffers=new Map()
  const files=['original','web'].map(role=>{const b=Buffer.from(`${label}-${role}`),hash=sha256(b);buffers.set(hash,b);return {role,file:`${hash}.webp`,sha256:hash,bytes:b.length,width:20,height:10,extension:'webp'}})
  const items=[{input:{file:`/attachments/${label}.jpg`,titleRu:'Тестовый кадр',subjectSlug:'test-photo',collectionTag:'testing',rights:'Test fixture only',poiId:'POI-000001'},files}]
  return {batch:{version:1,items,batchId:fingerprint({version:1,items})},buffers}
}
function memory(initial=registry()) {
  let value=structuredClone(initial),revision=1
  const files=new Map(),events=[]
  const archive={
    files,events,writes:0,
    async readRegistry(){return {value:structuredClone(value),revision:String(revision)}},
    async compareAndSwap(rev,next){if(rev!==String(revision))throw Object.assign(new Error('conflict'),{code:'REVISION_CONFLICT'});value=structuredClone(next);revision++;archive.writes++},
    async ensureFile(p,bytes){if(!files.has(p))files.set(p,{bytes,metadata:{id:`id:${files.size+1}`,rev:'1',size:bytes.length,path_display:p}});return files.get(p).metadata},
    async readFile(p){assert(files.has(p));return files.get(p)},
  }
  const metadata={writes:0,async preflight(){events.push('preflight')},async upsertVerified(){metadata.writes++;return [{tableId:'tblTest',recordId:'recTest',fields:{'Asset ID':'IMG-000153'}}]},async verify(){events.push('verify')}}
  return {archive,metadata,journal:async e=>events.push(e)}
}
const run = (f,m) => applyBatch({...f,...m})

test('strict whole-batch boundary rejects malformed data before effects',async()=>{
  for(const modify of [b=>b.version=2,b=>b.items[0].input.extra=true,b=>b.items[0].input.poiId='',b=>b.items[0].files[0].file='../escape',b=>b.items[0].files[0].width=0]) {
    const f=fixture(),m=memory();modify(f.batch)
    await assert.rejects(run(f,m));assert.equal(m.archive.writes,0);assert.equal(m.archive.events.length,0)
  }
  const input={version:1,items:[]};Object.defineProperty(input,'hidden',{value:true})
  assert.throws(()=>validateInput(input));assert.throws(()=>validateInput({version:1,items:new Array(1)}))
  const f=fixture(),m=memory();f.buffers.set(f.batch.items[0].files[0].sha256,Buffer.from('changed'))
  await assert.rejects(run(f,m),/bytes changed/);assert.equal(m.archive.events.length,0)
})
test('reserved draft IDs, duplicate IDs, paths and aliases fail closed',()=>{
  assert.throws(()=>validateRegistry({...registry(),nextId:152}),/reserved/)
  const r=planBatch(registry(),fixture().batch).registry
  for (const change of [x=>x.nextId=154,x=>x.assets.push(structuredClone(x.assets[0])),x=>x.assets[0].variants[0].relativePath='assets/IMG-000153/../bad',x=>x.aliasMap['IMG-000153']='IMG-000999']) {
    const copy=structuredClone(r);change(copy);assert.throws(()=>validateRegistry(copy))
  }
})
test('dedup reuses IDs and records new provenance; reservation is bound to all bytes',()=>{
  const f=fixture(),p=planBatch(registry(),f.batch)
  assert.equal(p.newAssets,1);assert.equal(p.newVariants,2);assert.equal(p.registry.nextId,155)
  assert.equal(planBatch(p.registry,f.batch).resumed,true)
  const copy=structuredClone(f.batch);copy.items[0].input.file='/attachments/copy.jpg';copy.batchId=fingerprint({version:1,items:copy.items})
  const next=planBatch(p.registry,copy);assert.equal(next.newAssets,0);assert.equal(next.newVariants,0);assert.equal(next.registry.nextId,155)
  assert.equal(next.registry.assets[0].variants[0].sources.length,2)
  const corrupt=structuredClone(p.registry);corrupt.intakeBatches[f.batch.batchId].hashes=[]
  assert.throws(()=>planBatch(corrupt,f.batch),/reservation hash/)
})
test('concurrent registry reservations retry CAS without lost IDs',async()=>{
  const m=memory(),a=fixture('a'),b=fixture('b')
  await Promise.all([updateRegistry(m.archive,r=>planBatch(r,a.batch).registry),updateRegistry(m.archive,r=>planBatch(r,b.batch).registry)])
  const r=(await m.archive.readRegistry()).value
  assert.equal(r.assets.length,2);assert.equal(r.nextId,157);assert.equal(new Set(r.assets.flatMap(x=>x.variants.map(v=>v.variantId))).size,4)
})
test('preflight failure performs no writes; verified completion is read-only on replay',async()=>{
  const f=fixture(),m=memory();m.metadata.preflight=async()=>{throw new Error('missing schema')}
  await assert.rejects(run(f,m),/missing schema/);assert.equal(m.archive.writes,0)
  m.metadata.preflight=async()=>{}
  const result=await run(f,m);assert.equal(result.status,'complete');assert.equal(m.archive.files.size,2)
  const writes=m.archive.writes;await run(f,m);assert.equal(m.archive.writes,writes);assert.equal(m.metadata.writes,1)
})
test('partial upload and timeout after file commit resume with the same IDs',async()=>{
  for(const afterCommit of [false,true]) {
    const f=fixture(),m=memory(),ensure=m.archive.ensureFile;let attempts=0
    m.archive.ensureFile=async(p,b)=>{if(++attempts===2){if(afterCommit)await ensure(p,b);throw new Error('connection lost')}return ensure(p,b)}
    await assert.rejects(run(f,m),/connection lost/);assert.equal(m.metadata.writes,0)
    const nextId=(await m.archive.readRegistry()).value.nextId
    m.archive.ensureFile=ensure;await run(f,m)
    assert.equal((await m.archive.readRegistry()).value.nextId,nextId);assert.equal(m.archive.files.size,2);assert.equal(m.metadata.writes,1)
  }
})
test('metadata failure resumes verified archive; readback mismatch never reports completion',async()=>{
  const f=fixture(),m=memory(),upsert=m.metadata.upsertVerified
  m.metadata.upsertVerified=async()=>{throw new Error('airtable unavailable')}
  await assert.rejects(run(f,m),/airtable unavailable/)
  let r=(await m.archive.readRegistry()).value;assert.equal(r.intakeBatches[f.batch.batchId].status,'archive-verified')
  m.metadata.upsertVerified=upsert;await run(f,m);assert.equal((await m.archive.readRegistry()).value.nextId,r.nextId)
  m.metadata.verify=async()=>{throw new Error('changed record')}
  const writes=m.archive.writes;await assert.rejects(run(f,m),/changed record/);assert.equal(m.archive.writes,writes)
})
test('registry timeout after commit reconciles on next run',async()=>{
  const f=fixture(),m=memory(),cas=m.archive.compareAndSwap;let once=true
  m.archive.compareAndSwap=async(...args)=>{await cas(...args);if(once){once=false;throw new Error('timeout after commit')}}
  await assert.rejects(run(f,m),/timeout/);await run(f,m);assert.equal((await m.archive.readRegistry()).value.nextId,155)
})
test('Dropbox CAS uses strict revision, add-only files, and hash readback',async()=>{
  const calls=[],files=new Map(),env={DROPBOX_ACCESS_TOKEN:'fixture-token'}
  const store=new DropboxStore({env,fetchImpl:async(url,options)=>{
    const args=JSON.parse(options.headers['Dropbox-API-Arg']);calls.push({url,args})
    if(url.endsWith('/upload')) {
      if(args.path===REGISTRY)return new Response(JSON.stringify({error_summary:'path/conflict/...'}),{status:409})
      files.set(args.path,Buffer.from(options.body));return Response.json({id:'id:file'})
    }
    if(!files.has(args.path))return Response.json({error_summary:'path/not_found/...'}, {status:409})
    const bytes=files.get(args.path);return new Response(bytes,{headers:{'Dropbox-API-Result':JSON.stringify({id:'id:file',rev:'abc',size:bytes.length,path_display:args.path}).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))}})
  }})
  await assert.rejects(store.compareAndSwap('abc',registry()),e=>e.code==='REVISION_CONFLICT')
  assert.deepEqual(calls[0].args.mode,{'.tag':'update',update:'abc'});assert.equal(calls[0].args.strict_conflict,true);assert.equal(calls[0].args.autorename,false)
  const p=`${LIBRARY}/assets/IMG-000153/file.webp`,bytes=Buffer.from('fixture')
  await store.ensureFile(p,bytes);await store.ensureFile(p,bytes)
  assert.equal(calls.filter(c=>c.url.endsWith('/upload')&&c.args.path===p).length,1)
  await assert.rejects(store.ensureFile(p,Buffer.from('different')),/different bytes/)
  await assert.rejects(store.readFile('/outside'),/outside/)
  await assert.rejects(new DropboxStore({env:{},fetchImpl:()=>assert.fail('network before credentials')}).readRegistry(),/connection missing/)
})
test('Airtable resolves actual linked table IDs and rejects schema drift',()=>{
  const names=mediaSchema().map((s,i)=>({name:s.name,id:`table${i}`}))
  const tables=mediaSchema(names).map((s,i)=>({...s,id:names[i].id,primaryFieldId:`field${i}-0`,fields:s.fields.map((f,n)=>({...f,id:`field${i}-${n}`}))}))
  assertMediaSchema(tables)
  tables[1].fields.find(f=>f.name==='Photo').options.linkedTableId='wrong'
  assert.throws(()=>assertMediaSchema(tables),/wrong linked/)
  assert.throws(()=>assertMediaSchema([{name:'photos'}],{allowMissing:true}),/ambiguous/)
})
test('Airtable upsert checks unique identity and preserves editorial status on replay',async()=>{
  const rows=new Map(),calls=[]
  const media=new AirtableMedia({env:{AIRTABLE_TOKEN:'fixture',AIRTABLE_BASE_ID:'appFixture'},fetchImpl:async(url,opts)=>{
    const method=opts.method;calls.push(method)
    if(method==='PATCH'){const body=JSON.parse(opts.body),fields=body.records[0].fields;assert.deepEqual(body.performUpsert.fieldsToMergeOn,['Asset ID']);rows.set('rec1',{id:'rec1',fields:{...rows.get('rec1')?.fields,...fields}});return Response.json({records:[rows.get('rec1')]})}
    if(url.includes('?'))return Response.json({records:[...rows.values()]})
    return Response.json(rows.get('rec1'))
  }})
  media.tables=[{name:'Photos',id:'tblPhotos'}]
  const fields={'Asset ID':'IMG-000153',Status:'Archived','Title RU':'Кадр'}
  const result=await media.upsert('Photos','Asset ID',fields,async()=>{})
  rows.get('rec1').fields.Status='Published'
  await media.upsert('Photos','Asset ID',fields,async()=>{});await media.verify([result])
  assert.equal(rows.get('rec1').fields.Status,'Published');assert.equal(calls.filter(x=>x==='PATCH').length,2)
})
test('prepare fully decodes, preserves original, strips web metadata; export checks physical paths',async t=>{
  const temp=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'photo-intake-test-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}))
  const source=path.join(temp,'photo.jpg');await sharp({create:{width:32,height:16,channels:3,background:'#fc0'}}).jpeg().withMetadata({orientation:6}).toFile(source)
  const input={version:1,items:[{file:source,titleRu:'Проверка',subjectSlug:'test',collectionTag:'test',rights:'Test fixture'}]}
  const root=path.join(temp,'batch');await prepare(input,root)
  const f=await loadBatch(root),original=f.batch.items[0].files[0],web=f.batch.items[0].files[1]
  assert.equal(sha256(await fs.readFile(source)),original.sha256);assert.equal(web.width,16);assert.equal(web.height,32)
  const meta=await sharp(f.buffers.get(web.sha256)).metadata();assert.equal(meta.exif,undefined)
  await assert.rejects(prepare(input,root),/already exists/)
  const bad=path.join(temp,'bad.jpg');await fs.writeFile(bad,'not an image')
  await assert.rejects(prepare({version:1,items:[input.items[0],{...input.items[0],file:bad}]},path.join(temp,'bad-batch')))
  await assert.rejects(fs.stat(path.join(temp,'bad-batch')),e=>e.code==='ENOENT')
  const symlink=path.join(temp,'alias');await fs.symlink(root,symlink);await assert.rejects(safePath(symlink),/symlink/)
  const dangling=path.join(temp,'dangling');await fs.symlink(path.join(temp,'absent'),dangling);await assert.rejects(safePath(dangling),/symlink/)
  await appendJournal(root,{event:'test'});assert.equal(JSON.parse((await fs.readFile(path.join(root,'journal.ndjson'),'utf8')).trim()).event,'test')
  const m=memory();await run(f,m);const r=(await m.archive.readRegistry()).value
  const checkout=path.join(temp,'checkout');await fs.mkdir(path.join(checkout,'public'),{recursive:true})
  const exported=await exportWeb(r,f.batch,f.buffers,checkout);assert.equal(exported[0].status,'exported-not-published')
  await exportWeb(r,f.batch,f.buffers,checkout)
  await fs.writeFile(exported[0].file,'occupied');await assert.rejects(exportWeb(r,f.batch,f.buffers,checkout),/occupied/)
  await fs.writeFile(path.join(root,web.file),'changed');await assert.rejects(loadBatch(root),/size changed/)
})
test('batch hash prevents changing metadata after preparation',()=>{
  const f=fixture();validateBatch(f.batch);f.batch.items[0].input.titleRu='Изменено';assert.throws(()=>validateBatch(f.batch),/fingerprint/)
})

test('OAuth uses PKCE, bounded scopes and rejects invalid state before token exchange',async()=>{
  const {authorization,callbackCode,exchange,REDIRECT,SCOPES}=await import('../scripts/photo-intake/oauth.mjs')
  const session=authorization('testappkey123'),url=new URL(session.url)
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('token_access_type'),'offline');assert.equal(url.searchParams.get('scope'),SCOPES)
  assert(!session.url.includes(session.verifier));assert.throws(()=>callbackCode('/dropbox/callback?state=wrong&code=abc',session),/state mismatch/)
  assert.equal(callbackCode(`/dropbox/callback?state=${session.state}&code=abc`,session),'abc')
  const token=await exchange(session,'abc',async(url,options)=>{
    assert.equal(url,'https://api.dropboxapi.com/oauth2/token');assert.equal(options.body.get('redirect_uri'),REDIRECT);assert.equal(options.body.get('code_verifier'),session.verifier)
    return Response.json({refresh_token:'fixture-token',scope:SCOPES})
  });assert.equal(token,'fixture-token')
  await assert.rejects(exchange(session,'abc',async()=>Response.json({refresh_token:'fixture-token',scope:'files.content.read'})),/insufficient scopes/)
})

test('schema setup resumes after an unknown create outcome and validates existing fields before writes',async()=>{
  const tables=[{id:POI_TABLE_ID,name:'POI',fields:[{name:'POI ID',type:'singleLineText'}]}],journal=[];let fail=true
  const media=new AirtableMedia({env:{AIRTABLE_TOKEN:'fixture',AIRTABLE_BASE_ID:'appFixture'}})
  media.request=async(suffix,options={})=>{
    if(options.method==='POST') {
      const spec=options.body,n=tables.length,id=`table${n}`
      tables.push({...spec,id,primaryFieldId:`field${n}-0`,fields:spec.fields.map((f,i)=>({...f,id:`field${n}-${i}`}))})
      if(fail){fail=false;throw new Error('unknown create outcome')}
      return {id}
    }
    return {tables:structuredClone(tables)}
  }
  await assert.rejects(media.initialize(async e=>journal.push(e)),/unknown create/)
  await media.initialize(async e=>journal.push(e));assert.equal(tables.length,4);assertMediaSchema(tables)
  assert.equal(journal[0].event,'schema-preflight');assert.equal(journal[0].tablesBefore.length,1)
  tables[1].fields[0].type='number';await assert.rejects(media.initialize(async()=>{}),/wrong field type/);assert.equal(tables.length,4)
  const wrongBase=new AirtableMedia();wrongBase.request=async()=>({tables:[]})
  await assert.rejects(wrongBase.initialize(async()=>assert.fail('journal before target validation')),/canonical POI/)
})
test('Dropbox corrupted readback never commits verified state or writes Airtable',async()=>{
  const f=fixture(),m=memory(),read=m.archive.readFile
  m.archive.readFile=async p=>({...await read(p),bytes:Buffer.from('corrupt')})
  await assert.rejects(run(f,m),/readback hash mismatch/);assert.equal(m.metadata.writes,0)
  const r=(await m.archive.readRegistry()).value;assert.equal(r.intakeBatches[f.batch.batchId].status,'reserved')
})
