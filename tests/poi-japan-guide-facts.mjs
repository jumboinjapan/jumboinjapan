import ts from 'typescript'
import { load } from 'cheerio'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { factsFixture } from './fixtures/japan-guide-facts.mjs'
import { parseJapanGuideEvidence, parseOfficialPageEvidence, assertEvidence, decodeArticleBytes, readJapanGuideEvidence } from '../scripts/poi-portals/lib/japan-guide-evidence.mjs'
import { assertDossierEvidence, parseFactsPacket, assertFactsForCreate, dossierSkeleton, dossierCopy, dossierDigest } from '../scripts/poi-portals/lib/japan-guide-facts.mjs'
import { readPoiFacts, storePoiFacts, assertPoiFacts } from '../src/lib/poi-facts.ts'
import { parseCopyPacket, copyProposal, runCopy, COPY_V2_SPEC, FACTS_BACKFILL_SPEC, factsBackfillProposal } from '../scripts/poi-portals/copy-japan-guide.mjs'
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
test('EVIDENCE compact anchors resolve original nodes and duplicate IDs fall back',()=>{
  const html='<main id="article-root"><div id="duplicate"><p>First</p></div><div id="duplicate"><p>Second</p></div><section id="unique"><p>Third</p><img src="/image.png" alt="View"></section></main>'
  const e=parseJapanGuideEvidence({...page,text:html}),$=load(html)
  for(const block of e.blocks){assert.equal($(block.locator).length,1,block.locator);if(block.text)assert.equal($(block.locator).text()||$(block.locator).attr('alt'),block.text)}
  assert.equal(e.blocks.find(b=>b.text==='Third').locator,'#unique > p:nth-of-type(1)')
  assert(e.blocks.find(b=>b.text==='Second').locator.startsWith('#article-root > div:nth-of-type(2)'))
  assert(!e.blocks.some(b=>b.locator.includes('#duplicate')))
})
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
const backfillRow={recordId:row.recordId,sourceKey:row.sourceKey,nameRu:row.nameRu,...good,previousDossierDigest:null}
const backfillPacket={spec:FACTS_BACKFILL_SPEC,rows:[backfillRow]}
test('BACKFILL canonical prose refuses before network and standalone proposal',()=>{
  for(const [text,expected] of [['В Хакодатэ.',/factsCanonSpelling/],['В Хиросиме.',/factsCanonToponym/]]) {
    const bad=structuredClone(backfillPacket);bad.rows[0].dossier.facts[0].text=text
    assert.throws(()=>parseCopyPacket(bad),expected)
    assert.throws(()=>factsBackfillProposal(bad.rows[0],{recordId:row.recordId,fields:{'Source Key':row.sourceKey,'POI Name (RU)':row.nameRu,Notes:''}}),expected)
  }
})
// Supplementary official pages are opt-in only for existing-record backfill.
// The caller selects the source; the parser makes no claim about its authority.
const officialText='<main><p>The test museum is in Example City.</p></main><aside><p>Another site</p></aside>'
const officialPage={...page,url:'https://museum.example.org/about',text:officialText,rawPageDigest:sha256Bytes(Buffer.from(officialText))}
const official=parseOfficialPageEvidence(officialPage,{sourceKey:row.sourceKey,rootSelector:'main'})
const officialD=dossierSkeleton(official,{allowOfficial:true})
Object.assign(officialD,{facts:[{id:'f1',subject:'Тестовый музей',category:'identity',text:'Тестовый музей находится в городе Пример.',conditions:'',status:'reported',references:[{source:0,blockId:'b1'}]}],coverage:[{source:0,blockId:'b1',disposition:'facts',reason:''}],copy:good.dossier.copy})
const officialRow={...backfillRow,dossier:officialD,evidence:[official]}
test('OFFICIAL default evidence and copy paths reject supplementary sources',()=>{
  assert.throws(()=>assertEvidence(official),/evidenceVersion/)
  assert.throws(()=>dossierSkeleton(official),/evidenceVersion/)
  assert.throws(()=>parseCopyPacket({spec:COPY_V2_SPEC,rows:[{...officialRow,descriptionRu:copy.ru,descriptionEn:copy.en}]}),/evidenceVersion/)
  assert.throws(()=>parseFactsPacket({spec:'poi-japan-guide-facts-batch/v1',rows:[{dossier:officialD,evidence:[official]}]}),/evidenceVersion/)
})
test('OFFICIAL selected container and identity are explicit',()=>{
  assert.equal(official.rootSelector,'main');assert.equal(official.blocks.length,1)
  assert.equal(official.sourceKey,row.sourceKey);assert(!JSON.stringify(official).includes('Another site'))
  assert.throws(()=>parseOfficialPageEvidence(officialPage,{sourceKey:row.sourceKey,rootSelector:'p'}),/SelectorMustResolveOnce/)
  assert.throws(()=>parseOfficialPageEvidence(officialPage,{sourceKey:row.sourceKey,rootSelector:'.missing'}),/SelectorMustResolveOnce/)
  for(const url of ['http://museum.example.org','https://user:secret@museum.example.org','https://museum.example.org/#other']) assert.throws(()=>parseOfficialPageEvidence({...officialPage,url},{sourceKey:row.sourceKey,rootSelector:'main'}),/officialEvidenceUrl/)
})
test('CREATE v2 retains the portal anchor and binds supplementary official facts',()=>{
  const dossier=structuredClone(good.dossier)
  dossier.sources.push(officialD.sources[0])
  dossier.facts.push({...officialD.facts[0],id:'official1',references:[{source:1,blockId:'b1'}]})
  dossier.coverage.push({source:1,blockId:'b1',disposition:'facts',reason:''})
  const packet={spec:'poi-japan-guide-facts-batch/v2',rows:[{dossier,evidence:[good.evidence[0],official]}]}
  parseFactsPacket(packet);assertFactsForCreate(dossier)
  assert.equal(readPoiFacts(storePoiFacts('',dossier)).dossier.sources.length,2)
  const foreign=structuredClone(packet);foreign.rows[0].dossier.sourceKey+='-child'
  assert.throws(()=>parseFactsPacket(foreign),/dossierSourceIdentity/)
  const tampered=structuredClone(packet);tampered.rows[0].evidence[1].blocks[0].text='Changed'
  assert.throws(()=>parseFactsPacket(tampered),/evidenceDigest/)
  assert.throws(()=>parseFactsPacket({spec:packet.spec,rows:[{dossier:officialD,evidence:[official]}]}),/factsPortalEvidenceRequired/)
  dossier.visit={...dossier.visit,status:'temporaryClosed',factIds:['official1']}
  parseFactsPacket(packet)
  assert.throws(()=>assertFactsForCreate(dossier),/factsVisitReviewRequired/)
})
test('OFFICIAL backfill binds exact POI and full evidence bytes',()=>{
  parseCopyPacket({spec:FACTS_BACKFILL_SPEC,rows:[officialRow]})
  const found={recordId:row.recordId,fields:{'Source Key':row.sourceKey,'POI Name (RU)':row.nameRu,Notes:'Older'}}
  assert.equal(readPoiFacts(factsBackfillProposal(officialRow,found).proposed.Notes).dossier.sources[0].url,officialPage.url)
  const changed=structuredClone(officialRow);changed.dossier.sourceKey+='-child';changed.sourceKey+='-child'
  assert.throws(()=>parseCopyPacket({spec:FACTS_BACKFILL_SPEC,rows:[changed]}),/dossierSourceIdentity/)
  const tampered=structuredClone(official);tampered.blocks[0].text='Other city'
  assert.throws(()=>assertEvidence(tampered,{allowOfficial:true}),/evidenceDigest/)
})
test('BACKFILL explicit Notes-only packet cannot carry a text or status write',()=>{
  parseCopyPacket(backfillPacket)
  for(const field of ['descriptionRu','descriptionEn','Copy Status','fields']) {
    const bad=structuredClone(backfillPacket);bad.rows[0][field]='Owner text'
    assert.throws(()=>parseCopyPacket(bad),/лишние поля/)
  }
})
test('BACKFILL standalone proposal retains identity and dossier drift gates',()=>{
  const found={recordId:row.recordId,fields:{'Source Key':row.sourceKey,'POI Name (RU)':row.nameRu,Notes:'Prior','Copy Status':'Synced'}}
  assert.deepEqual(Object.keys(factsBackfillProposal(backfillRow,found).proposed),['Notes'])
  assert.throws(()=>factsBackfillProposal({...backfillRow,sourceKey:'japan-guide:e999'},found),/source mismatch/)
  assert.throws(()=>factsBackfillProposal({...backfillRow,nameRu:'Other'},found),/name drift/)
  const changed=structuredClone(good.dossier);changed.facts[0].text='Owner factual correction'
  const withNotes={...found,fields:{...found.fields,Notes:storePoiFacts('Prior',changed)}}
  assert.throws(()=>factsBackfillProposal(backfillRow,withNotes),/dossier drift/)
  factsBackfillProposal({...backfillRow,previousDossierDigest:dossierDigest(changed)},withNotes)
})
// Separate runtime roots prevent an earlier copy journal from being mistaken for
// the state of this independently reset service.
for(const status of ['Draft','Synced','Approved','Official']) {
  const sub=await mkdtemp(path.join(tmpdir(),'jg-facts-backfill-'))
  const input=path.join(sub,'packet.json');await writeFile(input,JSON.stringify(status === 'Official'?{spec:FACTS_BACKFILL_SPEC,rows:[officialRow]}:backfillPacket))
  const saved={id:row.recordId,fields:{'POI ID':'POI-000001','Source Key':row.sourceKey,'POI Name (RU)':row.nameRu,'Copy Status':status === 'Official'?'Synced':status,'Fact Check Status':'Done',Notes:'Keep this note','Description (RU)':'Public owner text','Description Draft (RU)':'Edited draft','Description Draft (EN)':'Edited English draft',Approved:true,Latitude:35,'Parent POI':['rec00000000000002']}}
  const before=structuredClone(saved.fields);let sent=0
  const transport=async(_,init={})=>{if(init.method==='PATCH'){
    const proposed=JSON.parse(init.body).fields;assert.deepEqual(Object.keys(proposed),['Notes'],'BACKFILL transport contains Notes only');sent++;Object.assign(saved.fields,proposed)
  }return new Response(JSON.stringify(saved),{headers:{'content-type':'application/json'}})}
  let first,replayed;console.log=()=>{}
  try {
    first=await runCopy({packetFile:input,runId:'backfill',write:true},{repoRoot:sub,env:{AIRTABLE_TOKEN:'fake'},fetchImpl:transport})
    replayed=await runCopy({packetFile:input,runId:'again',write:true},{repoRoot:sub,env:{AIRTABLE_TOKEN:'fake'},fetchImpl:transport})
  }finally{console.log=log}
  test(`BACKFILL ${status} full-record preservation and independent verified outcome`,()=>{
    assert.equal(first.exitCode,0,first.report.failure);assert.equal(first.report.rows[0].state,'verified')
    assert.deepEqual({...saved.fields,Notes:before.Notes},before)
    assert.equal(readPoiFacts(saved.fields.Notes).dossier.facts.length,status === 'Official'?1:16)
    assert(saved.fields.Notes.startsWith('Keep this note'))
  })
  test(`BACKFILL ${status} repeat is an observed noChange`,()=>{assert.equal(replayed.exitCode,0,replayed.report.failure);assert.equal(replayed.report.rows[0].state,'noChange');assert.equal(sent,1)})
}
parseFactsPacket({spec:'poi-japan-guide-facts-batch/v1',rows:[good]})
// Execute the actual mapper declaration without loading Next server imports.
// Include the real text helper: its trimming must never touch framed Notes.
const airtableSource=ts.createSourceFile('airtable.ts',await readFile(new URL('../src/lib/airtable.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
const mapper=airtableSource.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='mapPoiRecords')
assert(mapper,'production mapper declaration')
const textHelper=airtableSource.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='getAirtableTextField')
assert(textHelper,'production text helper declaration')
const executable=ts.transpileModule(textHelper.getText(airtableSource)+'\n'+mapper.getText(airtableSource),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const {readPoiCategory}=await import('../src/lib/poi-category.ts')
const mapRecords=new Function('normalizeWorkspaceCopyStatus','readPoiCategory',`${executable};return mapPoiRecords`)(v=>String(v??''),readPoiCategory)
test('PRIVACY public projection never includes internal Notes',()=>{const rows=[{id:'rec00000000000001',fields:{Notes:'PRIVATE_DOSSIER'}}];assert(!Object.hasOwn(mapRecords(rows,new Map())[0],'notes'));assert.equal(mapRecords(rows,new Map(),true)[0].notes,'PRIVATE_DOSSIER')})
test('ADMIN real mapper preserves framed dossier through text normalization',()=>{const notes=storePoiFacts(' Prior notes\n',good.dossier);const [record]=mapRecords([{id:row.recordId,fields:{Notes:notes,'POI Name (RU)':' Музей '}}],new Map(),true);assert.equal(record.nameRu,'Музей');assert.equal(record.notes,notes,'Framed Notes changed by admin mapper');assert.deepEqual(readPoiFacts(record.notes),{dossier:good.dossier,error:null})})
console.log(`poi-japan-guide-facts: ${n} named scenarios passed; sandbox ${root}`)
