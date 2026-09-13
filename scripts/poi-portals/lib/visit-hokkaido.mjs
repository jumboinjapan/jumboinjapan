/** Visit Hokkaido source adapter. Language is evidence provenance, never identity.
 * No source prose becomes authored copy; no observed map point authorizes a write. */
import assert from 'node:assert/strict'
import {load} from 'cheerio'
import {canonicalJsonBytes, assertExactKeys} from '../../lib/canonical-contract.mjs'
import {sha256Bytes} from '../../lib/byte-digest.mjs'
import {parseJapaneseAddress} from '../../../src/lib/jp-address.ts'
import {parsePortalEvidence, assertEvidence} from './japan-guide-evidence.mjs'
import {buildPortalIntakeBatch} from './portal-intake-contract.mjs'

export const HOKKAIDO_ORIGIN = 'https://www.visit-hokkaido.jp'
export const HOKKAIDO_VERSION = 'visit-hokkaido/v1'
export const HOKKAIDO_BUNDLE_SPEC = 'poi-visit-hokkaido-bundle/v1'
const clean = value => String(value ?? '').replace(/\s+/g,' ').trim()
const digest = value => sha256Bytes(canonicalJsonBytes(value, value.spec))
const sign = body => ({...body,digest:digest(body)})

/** Strict lexical family: normalization may not manufacture a source identity. */
export function hokkaidoUrl(value, base = HOKKAIDO_ORIGIN + '/') {
  assert(typeof value === 'string' && value.length && !/[\\%\s?#]/.test(value) && !/(^|\/)\.{1,2}(\/|$)/.test(value), 'hokkaidoUrlSpelling')
  const u = new URL(value, base)
  assert(u.origin === HOKKAIDO_ORIGIN && !u.username && !u.password, 'hokkaidoOrigin')
  const m = /^\/(en\/)?spot\/(?:detail_([1-9]\d*)|index(?:_([1-9]\d*)_2_{6})?)\.html$/.exec(u.pathname)
  assert(m, 'hokkaidoUrlFamily')
  return {url:u.href,locale:m[1]?'en':'ja',kind:m[2]?'detail':'index',
    id:m[2]??null, page:m[2]?null:Number(m[3]??1), sourceKey:m[2]?`visit-hokkaido:spot-${m[2]}`:null}
}

export function hokkaidoPairUrls(value) {
  const u=hokkaidoUrl(value)
  assert(u.kind==='detail','hokkaidoDetailRequired')
  return ['ja','en'].map(locale=>`${HOKKAIDO_ORIGIN}/${locale==='en'?'en/':''}spot/detail_${u.id}.html`)
}

function pageDom(page, kind) {
  canonicalJsonBytes(page,HOKKAIDO_VERSION)
  assertExactKeys(page,['url','html','observedAt','rawPageDigest'],'hokkaidoPage')
  const identity=hokkaidoUrl(page.url)
  assert(identity.kind===kind,'hokkaidoPageKind')
  assert(typeof page.html==='string' && Buffer.byteLength(page.html)<=2*1024*1024 && !page.html.includes('\ufffd'),'hokkaidoHtmlEncodingOrSize')
  assert.equal(sha256Bytes(Buffer.from(page.html)),page.rawPageDigest,'hokkaidoRawDigest')
  assert(typeof page.observedAt==='string' && Number.isFinite(Date.parse(page.observedAt)),'hokkaidoObservationDate')
  const $=load(page.html)
  assert.equal($('link[rel="canonical"]').length,1,'hokkaidoCanonicalRequired')
  assert.equal($('link[rel="canonical"]').attr('href'),identity.url,'hokkaidoCanonicalMismatch')
  assert.equal($('html').attr('lang'),identity.locale,'hokkaidoLanguageMismatch')
  return {$,identity}
}

export function parseHokkaidoIndex(page) {
  const {$,identity}=pageDom(page,'index')
  assert.equal($('#resultList .spotList').length,1,'hokkaidoIndexLayout')
  const count=clean($('#resultCount span').text()).replaceAll(',','')
  assert(/^\d+$/.test(count),'hokkaidoIndexCount')
  const records=[]
  $('#resultList .spotList > dl').each((_,el)=>{
    const links=$(el).find('a[href]')
    assert.equal(links.length,1,'hokkaidoIndexCardLink')
    const u=hokkaidoUrl(links.attr('href'),page.url)
    assert(u.kind==='detail' && u.locale===identity.locale,'hokkaidoIndexCardIdentity')
    const name=clean($(el).children('dt').text())
    assert(name,'hokkaidoIndexName')
    records.push({sourceKey:u.sourceKey,url:u.url,name})
  })
  assert.equal(new Set(records.map(r=>r.sourceKey)).size,records.length,'hokkaidoIndexDuplicate')
  assert(Number(count)===0 || records.length>0,'hokkaidoIndexEmpty')
  const next=[...new Set($('a[rel="next"]').map((_,e)=>hokkaidoUrl($(e).attr('href'),page.url).url).get())]
  assert(next.length<=1,'hokkaidoIndexNextConflict')
  if(next.length) { const n=hokkaidoUrl(next[0]); assert(n.kind==='index' && n.locale===identity.locale && n.page===identity.page+1,'hokkaidoIndexNextSequence') }
  return sign({spec:'poi-visit-hokkaido-index/v1',url:page.url,locale:identity.locale,page:identity.page,
    reportedTotal:Number(count),records,next:next[0]??null,rawPageDigest:page.rawPageDigest,observedAt:page.observedAt})
}

const fieldKinds=new Map([
  ['所在地','address'],['Address','address'],['営業時間','hours'],['Open','hours'],['休業日','closed'],['Closed','closed'],
  ['料金','admission'],['Price','admission'],['Admission','admission'],['アクセス','access'],['Directions','access'],
  ['駐車場','parking'],['Car Park','parking'],['備考','remarks'],['Remarks','remarks'],
  ['電話番号','phone'],['Telephone Number','phone'],['その他連絡先','otherContact'],
  ['関連リンク','website'],['Website','website'],['郵便番号','postalCode'],['Postal code','postalCode'],
])

function safeLink(href, base) {
  try {const u=new URL(href,base);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null
    // Embedded public Maps API credentials are not useful source evidence.
    if(/(^|\.)google\.[a-z.]+$/.test(u.hostname))u.searchParams.delete('key')
    return u.href
  } catch {return null}
}

export function parseHokkaidoDetail(page) {
  const {$,identity}=pageDom(page,'detail')
  assert.equal($('#detail').length,1,'hokkaidoDetailLayout')
  assert.equal($('#detailHeader h2').length,1,'hokkaidoDetailTitle')
  assert.equal($('#detailBasic').length,1,'hokkaidoDetailBasic')
  const title=$('#detailHeader h2'),name=clean(title.text()),ruby=clean(title.attr('data-ruby'))||null
  assert(name,'hokkaidoDetailName')
  const rawEvidence=parsePortalEvidence({url:page.url,text:page.html,observedAt:page.observedAt,rawPageDigest:page.rawPageDigest},
    {sourceKey:identity.sourceKey,rootSelector:'#detail',role:'portal'})
  const body={...rawEvidence}
  delete body.digest
  body.title=name
  body.blocks=body.blocks.map(b=>b.url?{...b,url:safeLink(b.url,page.url)}:b)
  const evidence=sign(body)
  assertEvidence(evidence,{allowPortal:true})
  const fieldRows=[]
  $('#detailBasic dt').each((_,dt)=>{
    const label=clean($(dt).text()),dd=$(dt).nextUntil('dt','dd')
    assert(dd.length>0,'hokkaidoFieldWithoutValue')
    const nodes=new Set(dd.find('*').addBack().toArray())
    nodes.add(dt)
    const values=dd.map((_,e)=>{const clone=$(e).clone();clone.find('br').replaceWith('\n');return clone.text().split('\n').map(clean).filter(Boolean).join('\n')}).get()
    const blockIds=evidence.blocks.filter(b=>nodes.has($(b.locator).get(0))).map(b=>b.id)
    assert(blockIds.length>0,'hokkaidoFieldEvidenceMissing')
    fieldRows.push({label,kind:fieldKinds.get(label)??'other',values,blockIds,
      scope:'requiresSubjectAssessment',links:dd.find('a[href]').map((_,e)=>safeLink($(e).attr('href'),page.url)).get().filter(Boolean)})
  })
  // The page's explicit destination is useful for search. Neither a viewport
  // center nor a nearby marker is accepted, and no Place ID is synthesized.
  const mapDestinations=[]
  $('#detailMap iframe[src],#detailMapLink a[href]').each((_,el)=>{
    const url=safeLink($(el).attr('src')??$(el).attr('href'),page.url)
    if(!url)return
    const u=new URL(url)
    if(!/(^|\.)google\.[a-z.]+$/.test(u.hostname))return
    const pair=u.pathname==='/maps/embed/v1/place'?u.searchParams.get('q'):
      /^\/maps\/dir\/\/([^/]+)\/?$/.exec(u.pathname)?.[1]
    if(!pair || !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(pair))return
    const [lat,lon]=pair.split(',').map(Number)
    if(lat<20.2||lat>45.8||lon<122.5||lon>154)return
    mapDestinations.push({lat,lon,url,meaning:'publisherDestinationUnverified'})
  })
  const links=[]
  $('#main article:not(#detail) a[href]').filter((_,el)=>!$(el).closest('#detail').length).each((_,el)=>{
    const url=safeLink($(el).attr('href'),page.url)
    if(!url || new URL(url).origin!==HOKKAIDO_ORIGIN)return
    const kind=/\/(?:en\/)?plan\//.test(new URL(url).pathname)?'itinerary':/\/feature\//.test(new URL(url).pathname)?'article':/\/spot\/detail_/.test(new URL(url).pathname)?'nearby':'other'
    if(kind!=='other'&&!links.some(l=>l.url===url))links.push({kind,url,relationship:'notEstablished'})
  })
  return sign({spec:'poi-visit-hokkaido-detail/v1',sourceKey:identity.sourceKey,locale:identity.locale,url:page.url,
    name,ruby,fields:fieldRows,mapDestinations,related:links,evidence})
}

/** Rebuild projections from raw pages on reuse: a signed, altered projection
 * cannot substitute another identity/address while keeping its old evidence. */
export function buildHokkaidoBundle(pages, attempts) {
  canonicalJsonBytes({pages,attempts},HOKKAIDO_BUNDLE_SPEC)
  assert(Array.isArray(pages)&&Array.isArray(attempts)&&attempts.length>0,'hokkaidoBundleInput')
  const urls=new Set()
  for(const a of attempts){
    assertExactKeys(a,['url','outcome','detail'],'hokkaidoAttempt')
    const identity=hokkaidoUrl(a.url)
    assert(identity.kind==='detail'&&identity.url===a.url&&!urls.has(a.url),'hokkaidoAttemptIdentity');urls.add(a.url)
    assert(['fetched','absent','unavailable','policyDenied','policyUnknown','budgetNotSpent','invalidPage'].includes(a.outcome),'hokkaidoAttemptOutcome')
    assert(typeof a.detail==='string','hokkaidoAttemptDetail')
  }
  const cards=pages.map(parseHokkaidoDetail)
  assert.equal(new Set(cards.map(c=>c.url)).size,cards.length,'hokkaidoDuplicatePage')
  assert.deepEqual(cards.map(c=>c.url).sort(),attempts.filter(a=>a.outcome==='fetched').map(a=>a.url).sort(),'hokkaidoFetchedSet')
  const rows=[]
  for(const key of [...new Set(attempts.map(a=>hokkaidoUrl(a.url).sourceKey))].sort()){
    const ownAttempts=attempts.filter(a=>hokkaidoUrl(a.url).sourceKey===key)
    assert.equal(ownAttempts.length,2,'hokkaidoBothLocalesAttempted')
    const own=cards.filter(c=>c.sourceKey===key).sort((a,b)=>a.locale==='ja'?-1:b.locale==='ja'?1:0)
    const failed=ownAttempts.some(a=>!['fetched','absent'].includes(a.outcome))
    const state=failed?'incomplete':own.length?'collected':'absent'
    rows.push({sourceKey:key,state,cards:own,attempts:ownAttempts})
  }
  const counts=Object.fromEntries(['collected','incomplete','absent'].map(k=>[k,rows.filter(r=>r.state===k).length]))
  return sign({spec:HOKKAIDO_BUNDLE_SPEC,pages,attempts,rows,counts})
}

export function assertHokkaidoBundle(bundle) {
  canonicalJsonBytes(bundle,HOKKAIDO_BUNDLE_SPEC)
  assert.equal(bundle.spec,HOKKAIDO_BUNDLE_SPEC,'hokkaidoBundleVersion')
  assert.deepEqual(bundle,buildHokkaidoBundle(bundle.pages,bundle.attempts),'hokkaidoBundleProjectionDrift')
  return bundle
}

export function hokkaidoExpectedInput(bundle) {
  assertHokkaidoBundle(bundle)
  return {spec:bundle.spec,digest:bundle.digest,records:bundle.rows.map(r=>({sourceKey:r.sourceKey,sourceUrl:r.cards[0]?.url??r.attempts.find(a=>hokkaidoUrl(a.url).locale==='ja').url}))}
}

export function buildHokkaidoIntake(bundle) {
  const input=hokkaidoExpectedInput(bundle)
  const records=bundle.rows.map((r,i)=>{
    const {sourceKey,sourceUrl}=input.records[i],hints=[]
    const hint=(field,value,url)=>{if(value)hints.push({field,value,sourceUrl:url,confidence:'unverified',verifiedAt:null})}
    if(r.state!=='collected')return {kind:'refused',sourceKey,sourceUrl,reason:'sourceRecordInvalid',detail:r.state,hints}
    const ja=r.cards.find(c=>c.locale==='ja'),en=r.cards.find(c=>c.locale==='en')
    const addresses=r.cards.flatMap(c=>c.fields.filter(f=>f.kind==='address').flatMap(f=>f.values.map(value=>({value,url:c.url}))))
    const address=addresses[0]?.value??null,parts=parseJapaneseAddress(address)
    for(const c of r.cards){
      for(const f of c.fields)for(const value of f.values)hint(f.kind,value,c.url)
      for(const f of c.fields.filter(f=>f.kind==='website'))for(const url of f.links)hint('official_url',url,c.url)
      for(const p of c.mapDestinations)hint('map_destination',`${p.lat},${p.lon}`,c.url)
      hint('evidence_digest',c.evidence.digest,c.url)
    }
    const points=r.cards.flatMap(c=>c.mapDestinations)
    const distinct=new Set(points.map(p=>`${p.lat},${p.lon}`)),point=distinct.size===1?points[0]:null
    if(distinct.size>1)hint('coordinate_conflict','The publisher supplies different destinations; resolve the whole subject.',sourceUrl)
    return {kind:'candidate',sourceKey,sourceUrl,observed:{nameJa:ja?.name??(en?.ruby&&/[\u3040-\u30ff\u4e00-\u9fff]/.test(en.ruby)?en.ruby:null),
      nameKana:ja?.ruby&&/^[\u3040-\u30ff\u30fc\s]+$/.test(ja.ruby)?ja.ruby:null,nameEn:en?.name??null,
      address,prefectureJa:parts.prefecture||null,cityJa:parts.municipality||null,lat:point?.lat??null,lon:point?.lon??null},hints}
  })
  return buildPortalIntakeBatch({spec:'poi-portal-intake/v1',portalId:'visit-hokkaido',adapterVersion:HOKKAIDO_VERSION,input,records})
}

/** Explicitly unfinished v2 work template; existing dossier validators own
 * semantic acceptance. Empty facts/copy and unresolved blocks prevent intake. */
export function hokkaidoResearchRows(bundle) {
  assertHokkaidoBundle(bundle)
  return bundle.rows.filter(r=>r.state==='collected').map(r=>{
    const evidence=r.cards.map(c=>c.evidence)
    return {sourceKey:r.sourceKey,task:'extractFactsThenCompareExistingPoi',
      publisherIndependentSources:1,practicalFields:r.cards.map(c=>({locale:c.locale,fields:c.fields})),
      related:r.cards.flatMap(c=>c.related),evidence,
      dossier:{spec:'poi-facts/v2',sourceKey:r.sourceKey,updatedAt:evidence.map(e=>e.observedAt).sort().at(-1),history:[],
        sources:evidence.map(e=>({url:e.sourceUrl,observedAt:e.observedAt,evidenceDigest:e.digest,blocks:e.blocks.map(({id,kind,locator,section})=>({id,kind,locator,section}))})),
        facts:[],coverage:evidence.flatMap((e,source)=>e.blocks.map(b=>({source,blockId:b.id,disposition:'unresolved',reason:'Исследователь ещё не разобрал этот блок.'}))),
        visit:{status:'unknown',hoursKind:'unknown',hours:'',factIds:[],explanation:'Нужно проверить предмет, условия и актуальность сведений.'},website:null,copy:{ru:[],en:[]}}}
  })
}
