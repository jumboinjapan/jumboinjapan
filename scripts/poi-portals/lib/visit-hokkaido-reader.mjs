/** Bounded public GET reader. Shared policy, pacing, robots parser and network
 * deadline are reused; responses retain exact UTF-8 bytes, not a decoded guess. */
import assert from 'node:assert/strict'
import {sha256Bytes} from '../../lib/byte-digest.mjs'
import {canonicalJsonBytes} from '../../lib/canonical-contract.mjs'
import {sourcePolicyFromRobots,policyAllowsPath,openEnrichmentBudget} from './source-policy.mjs'
import {withResponseDeadline,readResponseBytes} from './network-boundary.mjs'
import {USER_AGENT} from './html-fetch.mjs'
import {liveIo,createEnrichmentPacer,isNetworkFailure} from '../enrich-japan-guide.mjs'
import {getPortal} from '../registry.mjs'
import {HOKKAIDO_ORIGIN,HOKKAIDO_VERSION,hokkaidoUrl,hokkaidoPairUrls,parseHokkaidoIndex,parseHokkaidoDetail,buildHokkaidoBundle} from './visit-hokkaido.mjs'

export function openHokkaidoReader({maxPages=100,fetchImpl=globalThis.fetch,now=()=>new Date(),sleep}={}) {
  assert(Number.isSafeInteger(maxPages)&&maxPages>=1&&maxPages<=3000,'hokkaidoPageBudget: 1..3000')
  const portal=getPortal('visit-hokkaido')
  assert(portal.enabled!==false && portal.licence.factExtraction===true && portal.robots.allowsUs!==false,'hokkaidoRegistryDenied')
  const budget=openEnrichmentBudget({objects:0,robotsFetches:1,pageFetches:maxPages})
  const pacer=createEnrichmentPacer({sleep})
  const io=liveIo({fetchImpl,pacer})
  let policy=null,robotsText=null
  async function read(url) {
    assert.equal(hokkaidoUrl(url).url,url,'hokkaidoReadCanonicalUrl')
    if(!policy){
      assert(budget.charge('robotsFetch').granted,'hokkaidoRobotsBudget')
      const r=await io.fetchRobots(HOKKAIDO_ORIGIN,HOKKAIDO_ORIGIN+'/robots.txt')
      policy=sourcePolicyFromRobots({domain:'visit-hokkaido.jp',origin:HOKKAIDO_ORIGIN,robotsUrl:HOKKAIDO_ORIGIN+'/robots.txt',...r,fetchedAt:now().toISOString()})
      robotsText=r.bytes?Buffer.from(r.bytes).toString('utf8'):null
    }
    const allowed=policyAllowsPath(policy,url,robotsText)
    if(!allowed.allowed)return {url,outcome:policy.status==='unknown'?'policyUnknown':'policyDenied',detail:allowed.reason,page:null}
    if(!budget.charge('pageFetch').granted)return {url,outcome:'budgetNotSpent',detail:'page budget exhausted',page:null}
    await pacer.beforeRequest()
    try{
      return await withResponseDeadline(fetchImpl,url,{method:'GET',redirect:'manual',headers:{'user-agent':USER_AGENT,accept:'text/html'}},async(res,signal)=>{
        if(res.url&&res.url!==url)return {url,outcome:'unavailable',detail:'response URL changed',page:null}
        if(res.status===404||res.status===410)return {url,outcome:'absent',detail:`HTTP ${res.status}`,page:null}
        if(!res.ok)return {url,outcome:'unavailable',detail:`HTTP ${res.status}`,page:null}
        const contentType=res.headers.get('content-type')??''
        if(!/^text\/html(?:\s*;|$)/i.test(contentType)||(/charset\s*=/i.test(contentType)&&!/charset\s*=\s*["']?utf-?8(?:["';\s]|$)/i.test(contentType)))
          return {url,outcome:'invalidPage',detail:'expected UTF-8 text/html',page:null}
        const bytes=await readResponseBytes(res,2*1024*1024,signal)
        let html
        try{html=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}
        catch{return {url,outcome:'invalidPage',detail:'invalid UTF-8',page:null}}
        return {url,outcome:'fetched',detail:'',page:{url,html,rawPageDigest:sha256Bytes(bytes),observedAt:now().toISOString()}}
      })
    }catch(error){
      if(!isNetworkFailure(error))throw error
      return {url,outcome:'unavailable',detail:error.code??'network failure',page:null}
    }
  }
  return {read,report:()=>({policy,budget:budget.report()})}
}

export async function readHokkaidoPlaces(urls,options={}) {
  canonicalJsonBytes(urls,HOKKAIDO_VERSION)
  assert(Array.isArray(urls)&&urls.length>0&&urls.length<=100,'hokkaidoSelection: 1..100')
  const pairs=urls.map(hokkaidoPairUrls)
  assert.equal(new Set(pairs.map(p=>p[0])).size,pairs.length,'hokkaidoSelectionDuplicate')
  // Complete selection validated before opening the network boundary.
  const reader=openHokkaidoReader({maxPages:pairs.length*2,...options})
  const pages=[],attempts=[]
  for(const url of pairs.flat()){
    const result=await reader.read(url)
    if(result.page){
      try{parseHokkaidoDetail(result.page)}
      catch(error){
        if(error.code!=='ERR_ASSERTION')throw error
        result.outcome='invalidPage';result.detail=error.message
      }
    }
    const {page,...attempt}=result
    attempts.push(attempt)
    if(attempt.outcome==='fetched')pages.push(page)
    await options.onPage?.(result)
  }
  return {bundle:buildHokkaidoBundle(pages,attempts),network:reader.report()}
}

export async function discoverHokkaido(options={}) {
  const maxPagesPerLocale=options.maxPagesPerLocale??100
  assert(Number.isSafeInteger(maxPagesPerLocale)&&maxPagesPerLocale>=1&&maxPagesPerLocale<=100,'hokkaidoIndexPageLimit: 1..100')
  const reader=openHokkaidoReader({maxPages:2*maxPagesPerLocale,...options})
  const locales=[],byKey=new Map()
  for(const locale of ['ja','en']){
    let url=`${HOKKAIDO_ORIGIN}/${locale==='en'?'en/':''}spot/index.html`
    const indexes=[],seen=new Set(),failures=[]
    while(url&&indexes.length<maxPagesPerLocale){
      const result=await reader.read(url)
      await options.onPage?.(result)
      if(result.outcome!=='fetched'){failures.push({url,outcome:result.outcome,detail:result.detail});break}
      let index
      try{index=parseHokkaidoIndex(result.page)}catch(error){
        if(error.code!=='ERR_ASSERTION')throw error
        failures.push({url,outcome:'invalidPage',detail:error.message});break
      }
      indexes.push(index)
      if(indexes[0].reportedTotal!==index.reportedTotal)failures.push({url,outcome:'catalogueDrift',detail:'reported count changed during traversal'})
      for(const record of index.records){
        if(seen.has(record.sourceKey))failures.push({url,outcome:'catalogueDrift',detail:`duplicate ${record.sourceKey}`})
        seen.add(record.sourceKey)
        const row=byKey.get(record.sourceKey)??{sourceKey:record.sourceKey,ja:null,en:null}
        row[locale]={url:record.url,name:record.name};byKey.set(record.sourceKey,row)
      }
      url=index.next
    }
    const expected=indexes[0]?.reportedTotal??null
    const complete=!url&&!failures.length&&expected===seen.size
    if(!complete&&!failures.length)failures.push({url,outcome:url?'pageLimit':'countMismatch',detail:`observed ${seen.size}; reported ${expected}`})
    locales.push({locale,complete,reportedTotal:expected,observed:seen.size,next:url,indexes,failures})
  }
  const body={spec:'poi-visit-hokkaido-discovery/v1',adapterVersion:HOKKAIDO_VERSION,
    complete:locales.every(l=>l.complete),locales,records:[...byKey.values()].sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey)),network:reader.report()}
  return {...body,digest:sha256Bytes(canonicalJsonBytes(body,body.spec))}
}

/** Existing collector's discovery branch: never returns writable candidates. */
export async function collectHokkaidoDiscovery(portal,{limit=null,...options}={}) {
  assert(portal.id==='visit-hokkaido','hokkaidoPortal')
  assert(limit===null,'hokkaidoUsePageLimit: poi:hokkaido discover OUT_DIR PAGES_PER_LANGUAGE')
  const discovery=await discoverHokkaido(options)
  return {discovery,meta:{adapter:HOKKAIDO_VERSION,complete:discovery.complete,records:discovery.records.length}}
}
