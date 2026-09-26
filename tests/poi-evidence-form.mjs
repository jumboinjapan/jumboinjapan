/**
 * HKP-05: текст внутри обёртки `form` остаётся доказательством; поля ввода,
 * скрытые значения, кнопки и скрипт — нет.
 *
 * Страницы синтетические; разбор — настоящий общий читатель и настоящий
 * адаптер Visit Hokkaido. Сети нет.
 */
import assert from 'node:assert/strict'
import { parsePortalEvidence, parseJapanGuideEvidence, parseOfficialPageEvidence, assertEvidence } from '../scripts/poi-portals/lib/japan-guide-evidence.mjs'
import { buildHokkaidoBundle, hokkaidoResearchRows } from '../scripts/poi-portals/lib/visit-hokkaido.mjs'
import { detail } from './fixtures/visit-hokkaido.mjs'
import { sha256Bytes } from '../scripts/lib/byte-digest.mjs'

let checks = 0
let network = 0
const originalFetch = globalThis.fetch
globalThis.fetch = () => { network++; throw new Error('Unexpected network') }
const test = (name, f) => { try { f(); checks++; console.log('✓ ' + name) } catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }) } }

const NOTICE = '2026年10月1日から休館します。'
const FORM = `<form action="/search" method="post"><p>${NOTICE}</p>`
  + '<label>お名前</label><input type="text" name="q" value="typed-value">'
  + '<input type="hidden" name="csrf" value="SECRET_TOKEN_123">'
  + '<textarea name="t">textarea-content</textarea>'
  + '<select name="s"><option value="1">option-label</option></select>'
  + '<button type="submit">button-label</button><script>form-script()</script></form>'
const page = (html, url = 'https://www.visit-hokkaido.jp/spot/detail_90001.html') =>
  ({ url, text: html, observedAt: '2026-09-25T00:00:00Z', rawPageDigest: sha256Bytes(Buffer.from(html)) })
const html = `<main id="detail"><h2>観光施設</h2><p>展示があります。</p>${FORM}<p>最後の段落。</p></main>`
const parsed = parsePortalEvidence(page(html), { sourceKey: 'visit-hokkaido:spot-90001', rootSelector: '#detail', role: 'portal' })
const texts = parsed.blocks.map((b) => b.text).join('\n')

test('NOTICE_INSIDE_FORM_IS_RETAINED', () => {
  const holders = parsed.blocks.filter((b) => b.text.includes(NOTICE))
  assert.equal(holders.length, 1, 'retained exactly once, not duplicated')
  assert.equal(holders[0].kind, 'article')
  assert.match(holders[0].locator, /form/)
})

test('FORM_CONTROLS_AND_TOKENS_ARE_NOT_EVIDENCE', () => {
  for (const leaked of ['typed-value', 'SECRET_TOKEN_123', 'textarea-content', 'option-label', 'button-label', 'form-script'])
    assert(!texts.includes(leaked), leaked)
  assert(!JSON.stringify(parsed).includes('SECRET_TOKEN_123'), 'hidden value is nowhere in the evidence')
  assert(texts.includes('お名前'), 'a visible label is source text like any other')
})

test('COVERAGE_SEPARATES_TECHNICAL_EXCLUSIONS', () => {
  assert.deepEqual(parsed.coverage.exclusions, { technical: 7, layout: 0 })
  assert.equal(parsed.coverage.excludedElements, 7)
  assert(!parsed.coverage.excludedSelectors.split(',').includes('form'), 'the wrapper itself is not excluded')
  assert.equal(parsed.coverage.truncated, false)
  assertEvidence(parsed, { allowPortal: true })
})

test('LOCATORS_OUTSIDE_THE_FORM_ARE_UNCHANGED', () => {
  const plain = parsePortalEvidence(page('<main id="detail"><h2>観光施設</h2><p>展示があります。</p><div></div><p>最後の段落。</p></main>'),
    { sourceKey: 'visit-hokkaido:spot-90001', rootSelector: '#detail', role: 'portal' })
  const locate = (e, text) => e.blocks.find((b) => b.text === text).locator
  for (const text of ['観光施設', '展示があります。', '最後の段落。']) assert.equal(locate(parsed, text), locate(plain, text), text)
})

test('JAPAN_GUIDE_AND_OFFICIAL_READERS_SHARE_THE_RULE', () => {
  const jgHtml = `<div class="page_body"><h1>Temple</h1><p>Intro.</p>${FORM}<nav><p>menu text</p></nav></div>`
  const jg = parseJapanGuideEvidence({ url: 'https://www.japan-guide.com/e/e9999.html', text: jgHtml, observedAt: '2026-09-25T00:00:00Z', rawPageDigest: sha256Bytes(Buffer.from(jgHtml)) })
  assert(jg.blocks.some((b) => b.text.includes(NOTICE)))
  assert(!jg.blocks.some((b) => b.text.includes('SECRET_TOKEN_123') || b.text.includes('menu text')))
  assert.equal(jg.coverage.exclusions.layout, 1, 'layout boundary is reported separately')
  const official = parseOfficialPageEvidence({ url: 'https://temple.example.jp/visit', text: `<main>${FORM}</main>`, observedAt: '2026-09-25T00:00:00Z', rawPageDigest: 'sha256:' + '0'.repeat(64) },
    { sourceKey: 'japan-guide:e9999', rootSelector: 'main' })
  assert(official.blocks.some((b) => b.text.includes(NOTICE)))
})

test('ADAPTER_PASSES_THE_NOTICE_TO_ASSESSMENT', () => {
  const pages = [detail('ja', '90001', FORM), detail('en', '90001')]
  const bundle = buildHokkaidoBundle(pages, pages.map((p) => ({ url: p.url, outcome: 'fetched', detail: '' })))
  const research = hokkaidoResearchRows(bundle)[0]
  const block = research.evidence[0].blocks.find((b) => b.text.includes(NOTICE))
  assert(block, 'evidence block exists')
  const coverage = research.dossier.coverage.find((c) => c.source === 0 && c.blockId === block.id)
  assert.equal(coverage.disposition, 'unresolved', 'the agent must dispose of it before any write')
})

test('NO_NETWORK', () => assert.equal(network, 0))
globalThis.fetch = originalFetch
console.log(`${checks} checks passed`)
