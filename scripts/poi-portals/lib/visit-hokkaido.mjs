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

// Labels measured on the saved JA/EN pages (25.09.2026): the English cards
// use «Prices» and «Other contact details»; both were read as `other` and the
// fee lost its meaning before it reached the shared evaluation (HKP-03).
const fieldKinds=new Map([
  ['所在地','address'],['Address','address'],['営業時間','hours'],['Open','hours'],['休業日','closed'],['Closed','closed'],
  ['料金','admission'],['Price','admission'],['Prices','admission'],['Admission','admission'],['アクセス','access'],['Directions','access'],
  ['駐車場','parking'],['Car Park','parking'],['備考','remarks'],['Remarks','remarks'],
  ['電話番号','phone'],['Telephone Number','phone'],['その他連絡先','otherContact'],['Other contact details','otherContact'],
  ['関連リンク','website'],['Website','website'],['郵便番号','postalCode'],['Postal code','postalCode'],
])

/*
 * ПРЕДМЕТ ПРАКТИЧЕСКИХ СВЕДЕНИЙ (HKP-02). Карточка портала называет одно
 * место, а её часы, выходные и цена могут принадлежать соседнему: визит-центру
 * у гейзера, площадке парк-гольфа в парке, конторе святилища. Извлечение НЕ
 * решает, чьи это часы, — оно сохраняет то, что источник сказал явно:
 *   • строки значения по отдельности, с пометкой продолжения (※, ＊, скобка);
 *   • предмет, названный в самой строке («パークゴルフ場の営業時間»,
 *     «レストラン 11:00-15:00», «(Park golf course hours)»);
 *   • учреждения, к которым карточка прямо относит телефон или парковку
 *     («（知床羅臼ビジターセンター）»); контактные организации (観光協会) — нет;
 *   • признаки учреждения с режимом входа (開館, 入館, 美術館 в названии).
 * Решение принимает `hokkaidoPracticalSubject` — одно на адаптер.
 */
const FACILITY=/(?:センター|ハウス|館|場|所|店|室|園|施設|レストラン|カフェ|ショップ|売店|食堂|ホテル|旅館|温泉|浴場|駅|ロープウェイ|ゴンドラ|リフト|centre|center|house|hall|museum|restaurant|cafe|café|shop|store|hotel|station|course|facility|ropeway|gondola)$/iu
const ORGANIZATION=/(?:観光協会|協会|役場|役所|事務所|事務局|振興局|組合|連盟|財団|課|係|(?:振興|推進|観光|企画|商工|政策)室|association|office|bureau|council|board|department|division)$/iu
// A parking lot named in the parking field says where to park, not whose schedule it is.
const PARKING=/駐車場$|parking(?: lot| area)?$|car park$/iu
const CALENDAR=/^(?:[月火水木金土日祝・、\s]+|平日|休日|土日祝|夏季|冬季|期間中|通年|春|夏|秋|冬|weekdays?|weekends?|holidays?|summer|winter)$/iu
const INSTITUTION_TITLE=/(?:美術館|博物館|記念館|資料館|科学館|文学館|郷土館|民俗館|ミュージアム|ギャラリー|水族館|動物園|植物園|museum|gallery|aquarium|zoo)/iu
const CONDITION=/開館|休館|閉館|入館|場合|除く|以外|のみ|期間|最終|予約/u
const INSTITUTION_TERMS=/開館|休館|閉館|入館|最終入場|入場受付|最終受付|last admission|last entry/iu
const subjectForm=value=>clean(value).normalize('NFKC').toLowerCase().replace(/[\s・･]/g,'')

function lineSubject(line) {
  const ja=/[（(]([^（）()]*?)(?:の)?(?:営業|開館|利用|受付|運行|入場)?時間[）)]/u.exec(line)?.[1]
  const en=/\(([^()]*?)\s*hours?\)/iu.exec(line)?.[1]
  const lead=/^(?:【([^】]+)】|■\s*([^\s：:]+)|([^\s：:（(0-9０-９]{2,24}?)\s*[：:]\s*(?=[0-9０-９])|([^\s：:（(0-9０-９]{2,24}?)\s+(?=[0-9０-９]))/u.exec(line)
  for(const raw of [ja,en,...(lead?lead.slice(1):[])]){
    const label=clean(String(raw??'').split(/[：:]/).at(-1))
    if(label&&FACILITY.test(label)&&!ORGANIZATION.test(label)&&!CALENDAR.test(label))return label
  }
  return null
}
function valueLines(values) {
  const lines=[]
  for(const value of values)for(const text of value.split('\n')){
    const continues=lines.length>0&&/^[※＊*（(]/u.test(text)
    lines.push({text,subject:lineSubject(text)??(continues?lines.at(-1).subject:null),continues})
  }
  return lines
}
function attributedFacilities(values) {
  const found=[]
  for(const value of values)for(const m of value.matchAll(/[（(]([^（）()]{2,40})[）)]/gu)){
    const inner=clean(m[1])
    if(FACILITY.test(inner)&&!ORGANIZATION.test(inner)&&!PARKING.test(inner)&&!CONDITION.test(inner)&&!/[0-9０-９]/u.test(inner)&&!found.includes(inner))found.push(inner)
  }
  return found
}

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
    // Paragraph and list boundaries are line boundaries: a clarification on the
    // next line («※…», a second tariff) must stay separate from the first.
    const values=dd.map((_,e)=>{const clone=$(e).clone();clone.find('br').replaceWith('\n');clone.find('p,li,div,tr').append('\n');return clone.text().split('\n').map(clean).filter(Boolean).join('\n')}).get()
    const blockIds=evidence.blocks.filter(b=>nodes.has($(b.locator).get(0))).map(b=>b.id)
    assert(blockIds.length>0,'hokkaidoFieldEvidenceMissing')
    // Section context: the nearest heading before this list, then the block heading.
    const heading=clean($(dt).closest('dl').prevAll('h1,h2,h3,h4,h5,h6').first().text()||$(dt).closest('#detailBasic').find('h1,h2,h3,h4,h5,h6').first().text())
    fieldRows.push({label,kind:fieldKinds.get(label)??'other',section:heading||null,values,lines:valueLines(values),blockIds,
      scope:'requiresSubjectAssessment',links:dd.find('a[href]').map((_,e)=>safeLink($(e).attr('href'),page.url)).get().filter(Boolean)})
  })
  // Facilities to which the card attributes a contact or parking value. A schedule
  // names its subject only through `lines[].subject`: a condition such as
  // «（祝日の場合開館）» is not a name. The judgement is `hokkaidoPracticalSubject`.
  const subjects={facilities:attributedFacilities(fieldRows.filter(f=>['phone','parking','otherContact'].includes(f.kind)).flatMap(f=>f.values)),
    institution:INSTITUTION_TITLE.test(name)||fieldRows.some(f=>['hours','closed','admission'].includes(f.kind)&&f.values.some(v=>INSTITUTION_TERMS.test(v)))}
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
    name,ruby,fields:fieldRows,subjects,mapDestinations,related:links,evidence})
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

/**
 * ЧЬИ ЭТО ЧАСЫ — ОДНО РЕШЕНИЕ НА СТРОКУ ИСТОЧНИКА (обе языковые карточки).
 *   mixed        строка расписания названа другим предметом (парк-гольф, ресторан);
 *   ambiguous    карточка относит телефон, парковку или режим к другому учреждению;
 *   card         карточка описывает учреждение с режимом входа (開館, 美術館 …);
 *   unspecified  источник не говорит, чьё это расписание.
 * Только `card` позволяет считать расписание портала расписанием самой
 * карточки без подтверждения оператора. Это структурный вывод из формы
 * источника, а не проверка истинности: редакторская сверка остаётся.
 */
export function hokkaidoPracticalSubject(row) {
  const titles=row.cards.flatMap(c=>[c.name,c.ruby]).filter(Boolean).map(subjectForm).filter(Boolean)
  // A restaurant named after its museum is still a different subject.
  const foreign=label=>!titles.includes(subjectForm(label))
  const schedule=row.cards.flatMap(c=>c.fields.filter(f=>['hours','closed'].includes(f.kind)))
  const named=[...new Set(schedule.flatMap(f=>f.lines.map(l=>l.subject)).filter(Boolean).filter(foreign))]
  const facilities=[...new Set(row.cards.flatMap(c=>c.subjects.facilities).filter(foreign))]
  const institution=row.cards.some(c=>c.subjects.institution)
  const state=named.length?'mixed':facilities.length?'ambiguous':institution?'card':'unspecified'
  return {state,named,facilities,institution,foreign,
    /** Field kind of every primary-evidence block, per card index = evidence source. */
    fieldOfBlock:(source,blockId)=>row.cards[source]?.fields.find(f=>f.blockIds.includes(blockId))??null}
}

const CHILD_OR_SPECIAL=/[^、。,;；\n]*?(?:小学生|中学生|高校生|大学生|幼児|未就学|小人|子ども|子供|こども|児童|学生|シニア|高齢者|65歳|団体|障がい|障害|特別展|企画展|children|child|kids|students?|seniors?|groups?|special exhibition)[^、。,;；\n]*/giu
const GENERAL_FEE=/大人|一般|有料|無料|入館料|入場料|入園料|料金|\d+\s*円|¥\s*\d|adults?|general|paid|free|admission|\d+\s*yen/iu
// A leading label before a price names what is paid for. General tariffs and
// visitor categories stay; any other label (カヌー体験, パークゴルフ) is a service.
const FEE_LABEL=/^([^\s：:（(0-9０-９¥￥]{1,24}?)\s*[：:（(]?\s*(?=[0-9０-９¥￥])/u
const CHILD_LABEL=new RegExp(CHILD_OR_SPECIAL.source,'iu') // non-global: test() must not keep state
const GENERAL_LABEL=/^(?:大人|一般|入館料?|入場料?|入園料?|観覧料?|料金|adults?|general|admission|entry)$/iu
/**
 * Практические поля кандидата для общей оценки (HKP-03). Стоимость доходит
 * до `priceLabel` только как стоимость ВСЕЙ карточки: строки, названные другим
 * предметом, отбрасываются; если остались только детский тариф или отдельная
 * выставка, цены основного предмета нет — и её не подменяют. Условия (сезон,
 * детский тариф рядом с общим) сохраняются в той же строке. Дочерний предмет
 * карточки цену родителя не получает. Распознанное поле само по себе не
 * доказывает применимость цены: при чужом учреждении в карточке — `null`.
 */
export function hokkaidoPracticalProjection(row,{wholeCardSubject}) {
  assert.equal(typeof wholeCardSubject,'boolean','hokkaidoProjectionSubject')
  const fields=row.cards.flatMap(c=>c.fields)
  const first=kind=>fields.find(f=>f.kind===kind)??null
  const joined=kind=>first(kind)?.values.join(' / ')??null
  const subject=hokkaidoPracticalSubject(row)
  let priceLabel=null
  const fee=first('admission')
  if(fee&&wholeCardSubject&&subject.state!=='ambiguous'){
    const service=l=>{const label=FEE_LABEL.exec(l.text.normalize('NFKC'))?.[1];return Boolean(label)&&!GENERAL_LABEL.test(label)&&!CHILD_LABEL.test(label)}
    const lines=fee.lines.filter(l=>!(l.subject&&subject.foreign(l.subject))&&!service(l))
    // Thousands separators are part of a number, not a clause boundary («1,000円»).
    const plain=text=>text.normalize('NFKC').replace(/(\d),(?=\d{3}(?!\d))/gu,'$1')
    const general=lines.some(l=>GENERAL_FEE.test(plain(l.text).replace(CHILD_OR_SPECIAL,'')))
    if(general)priceLabel=lines.map(l=>l.text).join(' / ')
  }
  return {access:joined('access'),phone:joined('phone'),priceLabel}
}

/** Explicitly unfinished v2 work template; existing dossier validators own
 * semantic acceptance. Empty facts/copy and unresolved blocks prevent intake. */
export function hokkaidoResearchRows(bundle) {
  assertHokkaidoBundle(bundle)
  return bundle.rows.filter(r=>r.state==='collected').map(r=>{
    const evidence=r.cards.map(c=>c.evidence)
    return {sourceKey:r.sourceKey,task:'extractFactsThenCompareExistingPoi',
      publisherIndependentSources:1,practicalFields:r.cards.map(c=>({locale:c.locale,fields:c.fields})),
      // Early signal for the researcher: whose schedule this is, before any copy is written.
      practicalSubject:(({state,named,facilities,institution})=>({state,named,facilities,institution}))(hokkaidoPracticalSubject(r)),
      related:r.cards.flatMap(c=>c.related),evidence,
      dossier:{spec:'poi-facts/v2',sourceKey:r.sourceKey,updatedAt:evidence.map(e=>e.observedAt).sort().at(-1),history:[],
        sources:evidence.map(e=>({url:e.sourceUrl,observedAt:e.observedAt,evidenceDigest:e.digest,blocks:e.blocks.map(({id,kind,locator,section})=>({id,kind,locator,section}))})),
        facts:[],coverage:evidence.flatMap((e,source)=>e.blocks.map(b=>({source,blockId:b.id,disposition:'unresolved',reason:'Исследователь ещё не разобрал этот блок.'}))),
        visit:{status:'unknown',hoursKind:'unknown',hours:'',factIds:[],explanation:'Нужно проверить предмет, условия и актуальность сведений.'},website:null,copy:{ru:[],en:[]}}}
  })
}
