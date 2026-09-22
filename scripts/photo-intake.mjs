#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DropboxStore } from './photo-intake/dropbox.mjs'
import { AirtableMedia } from './photo-intake/airtable.mjs'
import { prepare, loadBatch, appendJournal, exportWeb, safePath } from './photo-intake/local.mjs'
import { applyBatch, planBatch, validateRegistry, fingerprint, findVariant, LIBRARY } from './photo-intake/core.mjs'

const HELP=`Photo Intake (agent-operated)
  prepare --input /absolute/input.json --out /absolute/new-batch-folder
  plan --batch /absolute/batch [--registry /absolute/registry-snapshot.json]
  doctor
  schema-plan
  schema-apply --batch /absolute/existing-journal-folder --write
  apply --batch /absolute/batch --write
  export --batch /absolute/batch --checkout /absolute/website-checkout --write

prepare: local immutable original + WebP, no cloud writes.
plan: reads registry; never reserves IDs. --registry is explicitly an offline snapshot.
schema-apply: creates missing Photos/PhotoFiles/PhotoUsages; never edits existing fields.
apply: reserves IDs, verifies Dropbox files, upserts Airtable metadata; does not publish.
export: verified web files to public/tours/photo-library; does not deploy/change route fields.
Cloud writes/public export require --write. A failed apply may have persisted a prefix; rerun the same batch.
`
async function environment() {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
  for (const name of ['.env.photo-intake.local','.env.local']) {
    try { process.loadEnvFile(path.join(root,name)) } catch(e) { if(e.code!=='ENOENT') throw e }
  }
}
async function main() {
  const { values:v, positionals }=parseArgs({ allowPositionals:true, strict:true, options:{ input:{type:'string'},out:{type:'string'},batch:{type:'string'},registry:{type:'string'},checkout:{type:'string'},write:{type:'boolean'},help:{type:'boolean'} } })
  if(v.help || !positionals.length){ console.log(HELP);return }
  assert.equal(positionals.length,1,'one command required'); const command=positionals[0]
  const allowed={ prepare:['input','out'],plan:['batch','registry'],doctor:[], 'schema-plan':[], 'schema-apply':['batch','write'],apply:['batch','write'],export:['batch','checkout','write'] }
  assert(Object.hasOwn(allowed,command),'unknown command')
  assert(Object.keys(v).every(k=>allowed[command].includes(k)), 'flag not supported for this command')
  const absolute = name => { assert(v[name] && path.isAbsolute(v[name]),`--${name} requires absolute path`);return v[name] }
  if(command==='prepare') {
    const input=JSON.parse(await fs.readFile(absolute('input'),'utf8')); const batch=await prepare(input,absolute('out'))
    console.log(JSON.stringify({status:'prepared',batchId:batch.batchId,items:batch.items.length},null,2));return
  }
  await environment()
  const archive=new DropboxStore(), metadata=new AirtableMedia()
  if(command==='doctor') {
    const checks={}
    try { const r=await archive.readRegistry();checks.dropbox={ok:true,assets:r.value.assets.length,nextId:r.value.nextId,revision:r.revision} }
    catch(e){checks.dropbox={ok:false,error:e.message}}
    try { const plan=await metadata.schemaPlan();checks.airtable={ok:plan.every(t=>t.operation==='validate-existing'),plan} } catch(e){checks.airtable={ok:false,error:e.message}}
    console.log(JSON.stringify(checks,null,2));if(!checks.dropbox.ok||!checks.airtable.ok)process.exitCode=1;return
  }
  if(command==='schema-plan'){console.log(JSON.stringify(await metadata.schemaPlan(),null,2));return}
  const root=absolute('batch'); await safePath(root,{mustExist:true})
  if(command==='schema-apply') {
    assert(v.write,'schema-apply requires --write')
    // A working archive is required before adding a live metadata schema.
    await archive.readRegistry()
    await metadata.initialize(entry=>appendJournal(root,entry));console.log(JSON.stringify({status:'schema-ready'}));return
  }
  const {batch,buffers}=await loadBatch(root)
  if(command==='plan') {
    const snapshot=v.registry ? {value:JSON.parse(await fs.readFile(absolute('registry'),'utf8')),revision:'offline-snapshot'} : await archive.readRegistry()
    const plan=planBatch(snapshot.value,batch)
    console.log(JSON.stringify({status:'planned',batchId:batch.batchId,registryRevision:snapshot.revision,registryHash:fingerprint(snapshot.value),newAssets:plan.newAssets,newVariants:plan.newVariants,resumed:plan.resumed,files:batch.items.flatMap(x=>x.files).map(f=>{const {asset,variant}=findVariant(plan.registry,f.sha256);return {sha256:f.sha256,bytes:f.bytes,assetId:asset.assetId,variantId:variant.variantId,path:`${LIBRARY}/${variant.relativePath}`}})},null,2));return
  }
  assert(v.write,`${command} requires --write`)
  try {
    if(command==='apply') console.log(JSON.stringify(await applyBatch({batch,buffers,archive,metadata,journal:entry=>appendJournal(root,entry)}),null,2))
    else {
      const r=await archive.readRegistry();validateRegistry(r.value)
      console.log(JSON.stringify(await exportWeb(r.value,batch,buffers,absolute('checkout')),null,2))
    }
  } catch(e) {
    await appendJournal(root,{event:'failed',batchId:batch.batchId,message:e.message})
    throw e
  }
}
main().catch(e=>{console.error(`Photo Intake: ${e.message}`);process.exitCode=1})
