import ts from 'typescript'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { factsFixture } from './fixtures/japan-guide-facts.mjs'
import { parseJapanGuideEvidence, assertEvidence, decodeArticleBytes, readJapanGuideEvidence } from '../scripts/poi-portals/lib/japan-guide-evidence.mjs'
import { assertDossierEvidence, parseFactsPacket, assertFactsForCreate, dossierCopy } from '../scripts/poi-portals/lib/japan-guide-facts.mjs'
import { readPoiFacts, storePoiFacts, assertPoiFacts } from '../src/lib/poi-facts.ts'
import { parseCopyPacket, copyProposal, runCopy, COPY_V2_SPEC } from '../scripts/poi-portals/copy-japan-guide.mjs'
import { identificationQueries } from '../scripts/poi-portals/lib/place-identification.mjs'
import { sha256Bytes } from '../scripts/lib/byte-digest.mjs'
let n=0
const test=(name,fn)=>{try{fn();n++}catch(e){throw Error(`${name}: ${e.message}`,{cause:e})}}
const good=factsFixture()
test('FACTS over twelve facts and late paragraphs survive',()=>{assertDossierEvidence(good.dossier,good.evidence);assert.equal(good.dossier.facts.length,16);assert(good.evidence[0].blocks.at(-1).text.includes('16'))})
const html='<main><aside class="alert"><h3>Important Notice</h3><div>August 1, 2026: both buildings are closed.</div></aside><p>Short.</p><table><tr><td>Reservations</td><td>Required</td></tr></table><section id="section_admission"><h3>North hall</h3><div>09:00–17:00</div><h3>South hall</h3><div>10:00–16:00</div></section><a href="https://example.org/map">Entrance map</a><img src="/map.png" alt="East entrance"><nav>Other cities</nav></main>'
const page={url:'https://www.japan-guide.com/e/e70000.html',text:html,rawPageDigest:sha256Bytes(Buffer.from(html)),observedAt:'2026-09-10T00:00:00Z'}
const parsed=parseJapanGuideEvidence(page)
test('EVIDENCE div alert retains its own date',()=>{assert(parsed.blocks.find(b=>b.kind==='notice')?.text.includes('August 1, 2026'));assert(parsed.blocks.find(b=>b.kind==='notice')?.text.includes('closed'))})
test('EVIDENCE tables short text components and map survive',()=>{const text=parsed.blocks.map(b=>b.text).join(' ');for(const s of ['Short.','Reservations','North hall','South hall','09:00','10:00','Entrance'])assert(text.includes(s));assert(!text.includes('Other cities'));assert(parsed.blocks.some(b=>b.kind==='media'&&b.requiresVisualReview))})
test('EVIDENCE inline conditions remain in their sentence',()=>{const p=parseJapanGuideEvidence({...page,text:'<main><div>From 8:00 on weekends and <a href="/e/e2062.html">public holidays</a>.</div></main>'});assert(p.blocks.some(b=>b.text==='From 8:00 on weekends and public holidays .'))})
test('EVIDENCE map center is only a hint and provider key is removed',()=>{const p=parseJapanGuideEvidence({...page,text:'<main><p>Museum</p><iframe data-src="https://www.google.com/maps/embed/v1/place?key=do-not-store&amp;q=Museum&amp;center=35,135"></iframe></main>'});const map=p.blocks.find(b=>b.map);assert.equal(map.map.coordinateMeaning,'viewportOnlyNotObjectPoint');assert.equal(map.map.query,'Museum');assert(!JSON.stringify(p).includes('do-not-store'))})
test('EVIDENCE original locator survives advert removal',()=>{const p=parseJapanGuideEvidence({...page,text:'<main><section id="section_hotels">Advert</section><section><p>Article</p></section></main>'});assert.match(p.blocks[0].locator,/section:nth-of-type\(2\)/);assert(!p.blocks.some(b=>b.text==='Advert'))})
test('EVIDENCE strict Japanese recovery',()=>{assert.equal(decodeArticleBytes(Buffer.from([0x93,0x8c,0x8b,0x9e])).text,'東京');assert.equal(decodeArticleBytes(Buffer.from('京都')).text,'京都')})
test('EVIDENCE changed body rejects before use',()=>{const e=structuredClone(parsed);e.blocks.pop();assert.throws(()=>assertEvidence(e),/evidenceDigest/)})
test('FACTS omitted block rejects even with valid dossier structure',()=>{const x=structuredClone(good);x.dossier.sources[0].blocks.pop();x.dossier.coverage.pop();x.dossier.facts.pop();assert.throws(()=>assertDossierEvidence(x.dossier,x.evidence),/dossierFullBlockInventory/)})
test('FACTS derived child retains parent article provenance',()=>{const x=structuredClone(good);x.dossier.sourceKey+='-child';assertDossierEvidence(x.dossier,x.evidence)})
test('FACTS foreign source rejects',()=>{const x=structuredClone(good);x.dossier.sourceKey='japan-guide:e70001';assert.throws(()=>assertDossierEvidence(x.dossier,x.evidence),/dossierSourceIdentity/)})
test('FACTS uncovered block rejects',()=>{const d=structuredClone(good.dossier);d.coverage.pop();assert.throws(()=>assertPoiFacts(d),/every evidence block/)})
test('FACTS unsupported copy claim rejects',()=>{const d=structuredClone(good.dossier);d.copy.ru[0].factIds=['missing'];assert.throws(()=>assertPoiFacts(d),/fact reference/)})
test('FACTS unknown hours cannot mean 24 hours',()=>{const d=structuredClone(good.dossier);d.visit.hours='Круглосуточно';assert.throws(()=>assertPoiFacts(d),/unknown hours/)})
test('FACTS legend stays distinguishable',()=>{const d=structuredClone(good.dossier);d.facts[0].status='legend';assert.equal(assertPoiFacts(d).facts[0].status,'legend')})
test('FACTS alert cannot be discarded as irrelevant',()=>{const d=factsFixture('japan-guide:e70000','<aside class="alert">Closed until further notice</aside>').dossier;d.coverage.at(-1).disposition='irrelevant';d.coverage.at(-1).reason='Decoration';assert.throws(()=>assertPoiFacts(d),/notice must be retained/)})
test('CREATE notice needs explicit operational assessment',()=>{const d=factsFixture('japan-guide:e70000','<aside class="alert">Closed</aside>').dossier;assert.throws(()=>assertFactsForCreate(d),/factsNoticeNeedsAssessment/)})
test('CREATE unresolved and closed cannot be offered to intake',()=>{const d=structuredClone(good.dossier);d.coverage[0]={...d.coverage[0],disposition:'unresolved',reason:'Map not readable'};assert.throws(()=>assertFactsForCreate(d),/factsUnresolvedEvidence/);d.coverage=good.dossier.coverage;d.visit={...d.visit,status:'temporaryClosed',factIds:['f1']};assert.throws(()=>assertFactsForCreate(d),/factsVisitReviewRequired/)})
test('STORAGE preserves older notes and round-trips JSON',()=>{const notes=storePoiFacts('Original notes',good.dossier);assert(notes.startsWith('Original notes'));assert.deepEqual(readPoiFacts(notes).dossier,good.dossier);assert.equal(storePoiFacts(notes,good.dossier),notes)})
test('STORAGE corrupt block fails visibly',()=>{const notes=storePoiFacts('',good.dossier).replace('"facts":','"broken":');assert(readPoiFacts(notes).error);assert.throws(()=>storePoiFacts(notes,good.dossier),/corrupt dossier/)})
test('STORAGE capacity rejects without truncation',()=>assert.throws(()=>storePoiFacts('x'.repeat(90000),good.dossier),/storage capacity/))
test('SEARCH source address reaches the existing resolver',()=>assert.equal(identificationQueries({nameEn:'Museum',address:'Hanazono 1'})[0].address,'Hanazono 1'))
const copy=dossierCopy(good.dossier)
const row={recordId:'rec00000000000001',sourceKey:good.dossier.sourceKey,nameRu:'Музей',descriptionRu:copy.ru,descriptionEn:copy.en,...good,previousDossierDigest:null}
const packet={spec:COPY_V2_SPEC,rows:[row]}
test('COPY v2 validates evidence and independent clauses',()=>parseCopyPacket(packet))
test('COPY tampered evidence rejects before network',()=>{const p=structuredClone(packet);p.rows[0].evidence[0].blocks[0].text='Changed';assert.throws(()=>parseCopyPacket(p),/evidenceDigest/)})
test('COPY only owned fields proposed',()=>{const p=copyProposal(row,{recordId:row.recordId,fields:{'Source Key':row.sourceKey,'POI Name (RU)':row.nameRu,'Copy Status':'Draft','Fact Check Status':'Todo',Notes:'Older'}});assert.deepEqual(Object.keys(p.proposed).sort(),['Description Draft (EN)','Description Draft (RU)','Notes']);assert.equal(readPoiFacts(p.proposed.Notes).dossier.facts.length,16)})
let calls=0
await assert.rejects(readJapanGuideEvidence([{sourceKey:'japan-guide:e70001',sourceUrl:page.url}],{fetchImpl:()=>{calls++;throw Error('Network')}}),/evidenceSourceIdentity/)
test('NETWORK invalid batch rejected before first GET',()=>assert.equal(calls,0))
// Real production update store and journal with fake HTTP: verify persisted dossier,
// public fields, replay and the unknown-outcome boundary in the adjacent copy suite.
const root=await mkdtemp(path.join(tmpdir(),'jg-facts-test-'))
const file=path.join(root,'packet.json');await writeFile(file,JSON.stringify(packet))
const state={id:row.recordId,fields:{'POI ID':'POI-000001','Source Key':row.sourceKey,'POI Name (RU)':row.nameRu,'Copy Status':'Draft','Fact Check Status':'Todo',Notes:'Prior','Description (RU)':'Public'}}
let patches=0
const fetchImpl=async(_,init={})=>{if(init.method==='PATCH'){patches++;Object.assign(state.fields,JSON.parse(init.body).fields)}return new Response(JSON.stringify(state),{headers:{'content-type':'application/json'}})}
const log=console.log;console.log=()=>{}
let result,repeat
try {result=await runCopy({packetFile:file,runId:'facts',write:true},{repoRoot:root,env:{AIRTABLE_TOKEN:'fake'},fetchImpl});repeat=await runCopy({packetFile:file,runId:'replay',write:true},{repoRoot:root,env:{AIRTABLE_TOKEN:'fake'},fetchImpl})} finally {console.log=log}
test('COPY real store persists sixteen facts without publication',()=>{assert.equal(result.exitCode,0,result.report.failure);assert.equal(readPoiFacts(state.fields.Notes).dossier.facts.length,16);assert.equal(state.fields['Description (RU)'],'Public');assert.equal(state.fields['Copy Status'],'Draft')})
test('COPY replay does not append or PATCH again',()=>{assert.equal(repeat.exitCode,0,repeat.report.failure);assert.equal(patches,1)})
parseFactsPacket({spec:'poi-japan-guide-facts-batch/v1',rows:[good]})
// Execute the actual mapper declaration without loading Next server imports.
// Include the real text helper: its trimming must never touch framed Notes.
const airtableSource=ts.createSourceFile('airtable.ts',await readFile(new URL('../src/lib/airtable.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
const mapper=airtableSource.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='mapPoiRecords')
assert(mapper,'production mapper declaration')
const textHelper=airtableSource.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='getAirtableTextField')
assert(textHelper,'production text helper declaration')
const executable=ts.transpileModule(textHelper.getText(airtableSource)+'\n'+mapper.getText(airtableSource),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const mapRecords=new Function('normalizeWorkspaceCopyStatus',`${executable};return mapPoiRecords`)(v=>String(v??''))
test('PRIVACY public projection never includes internal Notes',()=>{const rows=[{id:'rec00000000000001',fields:{Notes:'PRIVATE_DOSSIER'}}];assert(!Object.hasOwn(mapRecords(rows,new Map())[0],'notes'));assert.equal(mapRecords(rows,new Map(),true)[0].notes,'PRIVATE_DOSSIER')})
test('ADMIN real mapper preserves framed dossier through text normalization',()=>{const notes=storePoiFacts(' Prior notes\n',good.dossier);const [record]=mapRecords([{id:row.recordId,fields:{Notes:notes,'POI Name (RU)':' Музей '}}],new Map(),true);assert.equal(record.nameRu,'Музей');assert.equal(record.notes,notes,'Framed Notes changed by admin mapper');assert.deepEqual(readPoiFacts(record.notes),{dossier:good.dossier,error:null})})
console.log(`poi-japan-guide-facts: ${n} named scenarios passed; sandbox ${root}`)
