// Synthetic prose only. No licensed article archive is needed to prove coverage.
import { parseJapanGuideEvidence } from '../../scripts/poi-portals/lib/japan-guide-evidence.mjs'
import { sha256Bytes } from '../../scripts/lib/byte-digest.mjs'
export function factsFixture(key = 'japan-guide:e70000', extra = '') {
  const text = `<html><body><h1>Test museum</h1><main><section id="section_main_content">${Array.from({length:16},(_,i)=>`<p>Exhibit ${i+1} illustrates the history of this test town.</p>`).join('')}${extra}</section></main></body></html>`
  const evidence = parseJapanGuideEvidence({url:`https://www.japan-guide.com/e/${key.split(':')[1]}.html`,text,rawPageDigest:sha256Bytes(Buffer.from(text)),observedAt:'2026-09-10T00:00:00.000Z'})
  const dossier = {spec:'poi-facts/v1',sourceKey:key,updatedAt:evidence.observedAt,
    sources:[{url:evidence.sourceUrl,observedAt:evidence.observedAt,evidenceDigest:evidence.digest,blocks:evidence.blocks.map(({id,kind,locator,section})=>({id,kind,locator,section}))}],
    facts:evidence.blocks.map((b,i)=>({id:`f${i+1}`,subject:'Тестовый музей',category:b.kind==='notice'?'notice':'history',text:`Экспонат ${i+1} посвящён истории города.`,conditions:'',status:'reported',references:[{source:0,blockId:b.id}]})),
    coverage:evidence.blocks.map(b=>({source:0,blockId:b.id,disposition:'facts',reason:''})),
    visit:{status:'unknown',hoursKind:'unknown',hours:'',factIds:[],explanation:'Источник не сообщает статус и часы.'},website:null,
    copy:{ru:[{text:'Экспозиция музея рассказывает об истории города.',factIds:['f1']}],en:[{text:'The museum introduces the history of the town.',factIds:['f1']}]}}
  return {dossier,evidence:[evidence]}
}
