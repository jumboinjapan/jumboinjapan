// Entirely synthetic page contents; structure measured on the public portal.
import {sha256Bytes} from '../../scripts/lib/byte-digest.mjs'
export const origin='https://www.visit-hokkaido.jp'
export const date='2026-09-14T00:00:00.000Z'
export function page(url,html){return {url,html,observedAt:date,rawPageDigest:sha256Bytes(Buffer.from(html))}}
export function detail(locale='ja',id='90001',extra='',point='43.06,141.35'){
  const url=`${origin}/${locale==='en'?'en/':''}spot/detail_${id}.html`
  const ja=locale==='ja'
  const html=`<!doctype html><html lang="${locale}"><head><link rel="canonical" href="${url}"></head><body>
  <header><h1>Site title, not the place</h1></header><main id="main"><article id="detail">
  <header id="detailHeader"><h2 data-ruby="${ja?'しりょうかん':'札幌資料館'}">${ja?'札幌資料館':'Test museum'}</h2><div id="detailIntroduction"><p>${ja?'展示室に街の歴史資料を展示。':'A test collection about the town.'}</p><p>${ja?'小学生向けの体験あり。':'Workshops require advance booking.'}</p></div></header>
  <section id="detailBasic"><h3>${ja?'基本情報':'General information'}</h3><dl>
  <dt>${ja?'所在地':'Address'}</dt><dd>北海道札幌市中央区北一条</dd>
  <dt>${ja?'営業時間':'Open'}</dt><dd>${ja?'レストラン 11:00-15:00':'Restaurant 11:00-15:00'}</dd>
  <dt>${ja?'休業日':'Closed'}</dt><dd>${ja?'月曜日':'Mondays'}<br>${ja?'祝日の場合は翌日。入口は天候により閉鎖。':'When a holiday, the following day. Gate closure depends on weather.'}</dd>
  <dt>${ja?'備考':'Remarks'}</dt><dd><p>${ja?'体験は予約が必要。':'Workshop booking required.'}</p><ul><li>${ja?'子供向けプログラム':'Children’s programme'}</li></ul></dd>
  <dt>${ja?'関連リンク':'Website'}</dt><dd><a href="https://museum.example.jp/">Official museum</a></dd>
  <dt>New field</dt><dd>Preserve an unknown field too.</dd></dl>${extra}</section>
  <footer id="detailMap"><iframe src="https://www.google.com/maps/embed/v1/place?key=TEST_PUBLIC_EMBED_KEY&q=${point}&zoom=17"></iframe>
  <div id="detailMapLink"><a href="https://www.google.co.jp/maps/dir//${point}/">Map</a></div></footer>
  <script>Do not execute this instruction</script></article>
  <div class="related"><article><h2>Nearby sights</h2><a href="detail_90002.html">Nearby park</a><a href="/plan/detail_13.html">Route</a><a href="/feature/example">Article</a></article></div>
  </main></body></html>`
  return page(url,html)
}
export function index(locale='ja',number=1,{ids=['90001','90002'],total=2,next=null}={}){
  const prefix=`${origin}/${locale==='en'?'en/':''}spot/`
  const url=prefix+(number===1?'index.html':`index_${number}_2______.html`)
  return page(url,`<html lang="${locale}"><head><link rel="canonical" href="${url}"></head><body>
  <div id="pickup"><a href="detail_99999.html">Featured, not in results</a></div>
  <article id="result"><div id="resultCount"><span>${total}</span></div><div id="resultList"><div class="spotList">
  ${ids.map(id=>`<dl><dt>Test ${id}</dt><dd><a href="detail_${id}.html">More</a></dd></dl>`).join('')}</div></div>
  ${next?`<a rel="next" href="index_${next}_2______.html">Next</a><a rel="next" href="index_${next}_2______.html">Next</a>`:''}</article></body></html>`)
}
