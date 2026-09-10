import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseJapanGuideSearchContext, readJapanGuideSearchContexts } from '../scripts/poi-portals/lib/japan-guide-search.mjs'
import { identificationQueueFrom, runIdentification, buildIdentificationReport } from '../scripts/poi-portals/lib/place-identification.mjs'
import { resolvePlace } from '../src/lib/place-resolve.ts'
import { siteCityAgrees } from '../src/lib/poi-portal-place.ts'
import { canonicalPrefecture } from '../src/lib/prefectures.ts'
import { canonicalCity } from '../src/lib/poi-canon.ts'
import { runIdentifyCli } from '../scripts/poi-portals/identify-japan-guide.mjs'
import { canonicalJsonBytes } from '../scripts/lib/canonical-contract.mjs'
import { sha256Bytes } from '../scripts/lib/byte-digest.mjs'

const now = () => new Date('2026-09-10T00:00:00.000Z')
const subject = { sourceKey: 'japan-guide:e3529', sourceUrl: 'https://www.japan-guide.com/e/e3529.html', nameEn: 'Onsenji Temple' }
const html = `<meta charset="utf-8"><div class="page_title"><h1 class="page_title__title">Onsenji Temple</h1></div>
<nav class="breadcrumbs"><ul><li class="breadcrumbs__crumb">Kansai</li><li class="breadcrumbs__crumb">Hyogo</li><li class="breadcrumbs__crumb">Kinosaki</li></ul></nav>
<section><p>Other locations: Gifu, Shizuoka.</p><nav class="breadcrumbs"><li class="breadcrumbs__crumb">Tokyo</li></nav></section>`
const page = { url: subject.sourceUrl, text: html, observedAt: now().toISOString(), rawPageDigest: `sha256:${'a'.repeat(64)}` }
const enrichment = (outcome = 'noFacts') => ({ rows: [{ ...subject, outcome, facts: [], conflicts: [] }] })
const rawPlace = (id, name, prefecture = 'Hyogo') => ({ id, displayName: { text: name }, location: { latitude: 35.62, longitude: 134.8 }, addressComponents: [{ types: ['administrative_area_level_1'], longText: prefecture }] })
const report = result => buildIdentificationReport({ queue: result.rows, result, limit: 20, priceMicros: 32000, createdAt: now().toISOString(), inputs: {} })

test('Onsenji retains source breadcrumbs; other places and adverts never become geography', () => {
  const context = parseJapanGuideSearchContext(page, subject)
  assert.equal(context.prefectureEn, 'Hyogo')
  assert.equal(context.area, 'Kinosaki')
  assert.equal(context.sourceUrl, subject.sourceUrl)
  assert.equal(context.rawPageDigest, page.rawPageDigest)
  assert(!JSON.stringify(context).includes('Shizuoka'))
  assert.throws(() => parseJapanGuideSearchContext({ ...page, url: 'https://www.japan-guide.com/e/e3937.html' }, subject), /searchSourceIdentity/)
  assert.throws(() => parseJapanGuideSearchContext({ ...page, text: html.replace('Onsenji Temple', 'Kinosaki Art Museum') }, subject), /searchSourceTitle/)
  assert.throws(() => parseJapanGuideSearchContext({ ...page, text: html.replace('Hyogo', '\ufffd') }, subject), /searchSourceBreadcrumb/)
})

test('official-site failures allow Google; conflicting facts and untouched rows remain excluded', () => {
  for (const outcome of ['policyUnknown', 'policyDenied', 'pageUnavailable', 'noOfficialUrl', 'hintUnusable']) assert.equal(identificationQueueFrom(enrichment(outcome)).length, 1, outcome)
  for (const outcome of ['factsConflict', 'budgetNotSpent']) assert.equal(identificationQueueFrom(enrichment(outcome)).length, 0, outcome)
})

test('source geography reaches every language attempt through the real resolver', async () => {
  const context = parseJapanGuideSearchContext(page, subject)
  const queue = identificationQueueFrom(enrichment('policyUnknown'), { contexts: new Map([[subject.sourceKey, context]]), namesLoaded: { names: { [subject.sourceKey]: { nameJa: '温泉寺' } } } })
  const bodies = []
  const result = await runIdentification({ queue, limit: 20, now, resolve: input => resolvePlace(input, { apiKey: 'fake', fetchImpl: async (_, init) => {
    const body = JSON.parse(init.body); bodies.push(body)
    return Response.json({ places: body.languageCode === 'ja' ? [rawPlace('wrong', '温泉寺', 'Gifu')] : [rawPlace('right', 'Onsenji Temple')] })
  } }) })
  assert.equal(result.calls, 2, 'every alias consumes a call')
  assert.equal(result.rows[0].place.placeId, 'right')
  assert.match(bodies[0].textQuery, /兵庫県 Kinosaki 温泉寺/)
  assert.match(bodies[1].textQuery, /Onsenji Temple, Kinosaki, Hyogo/)
  assert.equal(result.rows[0].attempts[0].diagnostics.rejected.prefectureMismatch, 1)
  assert.equal(report(result).spend.calls, 2)
})

test('name variants stay strict; an ambiguous response and a provider failure stop retries', async () => {
  const queue = [{ ...subject, nameJa: '温泉寺', prefectureEn: 'Hyogo' }]
  let calls = 0
  const ambiguous = await runIdentification({ queue, limit: 20, now, resolve: input => resolvePlace(input, { apiKey: 'fake', fetchImpl: async () => { calls++; return Response.json({ places: [rawPlace('a', '温泉寺'), rawPlace('b', '温泉寺')] }) } }) })
  assert.equal(calls, 1, 'ambiguity must not be retried into a single answer')
  assert.equal(ambiguous.rows[0].outcome, 'ambiguous')
  assert.equal(ambiguous.rows[0].place, null)
  const failed = await runIdentification({ queue: [...queue, { ...queue[0], sourceKey: 'japan-guide:e999' }], limit: 20, now, resolve: async () => ({ outcome: 'providerError', place: null }) })
  assert.equal(failed.calls, 1)
  assert.equal(failed.rows[1].outcome, 'notAttempted')
})

test('budget exhaustion after one unsuccessful alias is not falsely labelled notFound', async () => {
  const intents = []
  const result = await runIdentification({ queue: [{ ...subject, nameJa: '温泉寺' }], limit: 1, now,
    onAttempt: e => intents.push(e), resolve: async () => ({ outcome: 'notFound', place: null }) })
  assert.equal(result.calls, 1)
  assert.equal(result.rows[0].outcome, 'notAttempted')
  assert.equal(result.rows[0].attempts.length, 1)
  assert.equal(intents[0].phase, 'intent')
  assert.equal(intents[1].phase, 'outcome')
  assert.equal(report(result).spend.calls, 1)
})

test('notFound distinguishes empty results from rejected names and never stores Google names', async () => {
  let index = 0
  const result = await runIdentification({ queue: [{ ...subject, nameJa: '温泉寺' }], limit: 20, now,
    resolve: input => resolvePlace(input, { apiKey: 'fake', fetchImpl: async () => Response.json({ places: index++ === 0 ? [rawPlace('x', 'Private Google Display Name')] : [] }) }) })
  assert.equal(result.rows[0].outcome, 'notFound')
  assert.match(result.rows[0].detail, /nameMismatch 1/)
  assert(!JSON.stringify(report(result)).includes('Private Google Display Name'))
  const empty = await runIdentification({ queue: [subject], limit: 20, now, resolve: input => resolvePlace(input, { apiKey: 'fake', fetchImpl: async () => Response.json({}) }) })
  assert.match(empty.rows[0].detail, /пустую выдачу/)
})

test('verified Otsu beats Kyoto tourist breadcrumb; added cities keep prefecture checks', () => {
  const queue = identificationQueueFrom(enrichment(), { namesLoaded: { names: { [subject.sourceKey]: { siteCity: 'otsu' } } }, contexts: new Map([[subject.sourceKey, { area: 'Kyoto', prefectureEn: 'Kyoto' }]]) })
  assert.equal(queue[0].prefectureEn, 'Shiga')
  assert.equal(queue[0].searchArea, 'otsu')
  for (const [city, prefecture] of [['otsu', 'Shiga'], ['toyooka', 'Hyogo'], ['hirosaki', 'Aomori']]) {
    assert.equal(canonicalCity(city), city)
    assert.equal(siteCityAgrees(city, canonicalPrefecture(prefecture)).ok, true)
    assert.equal(siteCityAgrees(city, canonicalPrefecture('Tokyo')).ok, false)
  }
})

test('source reader checks all target identities before any network call', async () => {
  let calls = 0
  await assert.rejects(readJapanGuideSearchContexts([subject, { ...subject, sourceKey: 'japan-guide:e99' }], { limit: 2, fetchImpl: async () => { calls++ } }), /searchSourceIdentity/)
  assert.equal(calls, 0)
})

test('live CLI reads portal geography and uses it with failed official enrichment, entirely on fake transports', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'jg-search-cli-'))
  const sign = body => ({ ...body, reportDigest: sha256Bytes(canonicalJsonBytes({ ...body, createdAt: null }, body.spec)) })
  const queues = sign({ spec: 'poi-japan-guide-queues/v1', queues: { candidate: [{ ...subject, url: subject.sourceUrl }], review: [] } })
  const enriched = sign({ spec: 'poi-enrichment/v1', ...enrichment('policyUnknown'), inputs: { queues: { digest: queues.reportDigest } } })
  const q = path.join(dir, 'queues.json'), e = path.join(dir, 'enrichment.json'), out = path.join(dir, 'out.json')
  await writeFile(q, JSON.stringify(queues)); await writeFile(e, JSON.stringify(enriched))
  const sourceCalls = [], googleQueries = []
  const target = { exitCode: 0 }
  await runIdentifyCli(['node', 'x', '--queues', q, '--enrichment', e, '--out', out, '--decisions', path.join(dir, 'decisions.json'), '--live', '--limit', '2', '--price-micros', '32000'], {
    now,
    sourceFetch: async (url, init) => {
      sourceCalls.push(String(url)); assert.equal(init.method, 'GET')
      return new Response(String(url).endsWith('robots.txt') ? 'User-agent: *\nAllow: /\n' : html, { headers: { 'content-type': String(url).endsWith('robots.txt') ? 'text/plain' : 'text/html; charset=shift-jis' } })
    },
    resolve: query => { googleQueries.push(query); return resolvePlace(query, { apiKey: 'fake', fetchImpl: async () => Response.json({ places: [rawPlace('found', 'Onsenji Temple')] }) }) },
  }, target, { GOOGLE_PLACES_API_KEY: 'fake' })
  assert.equal(target.exitCode, 0)
  assert.equal(sourceCalls.length, 2)
  assert.equal(googleQueries[0].prefectureEn, 'Hyogo')
  assert.equal(googleQueries[0].searchArea, 'Kinosaki')
  const result = JSON.parse(await readFile(out, 'utf8'))
  assert.equal(result.rows[0].outcome, 'resolved')
  assert.equal(result.inputs.sourceLookup.networkRequests, 2)
  assert.equal(result.rows[0].searchContext.sourceUrl, subject.sourceUrl)
  assert((await readFile(out + '.attempts.ndjson', 'utf8')).includes('"phase":"intent"'))
  let repeatedCalls = 0
  const rerun = { exitCode: 0 }
  await runIdentifyCli(['node', 'x', '--queues', q, '--enrichment', e, '--out', out, '--decisions', path.join(dir, 'new-decisions.json'), '--live', '--limit', '2', '--price-micros', '32000'], {
    sourceRead: async () => { repeatedCalls++; throw new Error('unexpected source call') },
    resolve: async () => { repeatedCalls++; throw new Error('unexpected paid call') },
  }, rerun, { GOOGLE_PLACES_API_KEY: 'fake' })
  assert.equal(rerun.exitCode, 1)
  assert.equal(repeatedCalls, 0, 'existing evidence stops repeated network work')
})


test('report checks attempt accounting, selected keys and the call ceiling', async () => {
  const result = await runIdentification({ queue: [{ ...subject, nameJa: '温泉寺' }], limit: 2, now, resolve: async () => ({ outcome: 'notFound', place: null }) })
  assert.equal(report(result).spend.calls, 2)
  assert.throws(() => report({ ...result, calls: 1 }), /учёт не сходится/)
  assert.throws(() => buildIdentificationReport({ queue: [subject], result, limit: 1, priceMicros: 1 }), /потолок вызовов/)
  assert.throws(() => buildIdentificationReport({ queue: [{ ...subject, sourceKey: 'japan-guide:e999' }], result, limit: 2, priceMicros: 1 }), /состав исходов/)
})


test('article map center reaches search only; unrelated map never becomes a location', async () => {
  const markup = '<iframe id="googlemap" data-src="https://www.google.com/maps/embed/v1/place?q=Onsenji%2BTemple&amp;center=35.62,134.8&amp;key=not-retained"></iframe>'
  const context = parseJapanGuideSearchContext({...page,text:html+markup},subject)
  assert.deepEqual(context.mapCenter,{lat:35.62,lon:134.8})
  assert(!JSON.stringify(context).includes('not-retained'))
  const queue = identificationQueueFrom(enrichment(),{contexts:new Map([[subject.sourceKey,context]])})
  assert.deepEqual(queue[0].locationBias,context.mapCenter)
  let body
  await runIdentification({queue,limit:1,now,resolve:input=>resolvePlace(input,{apiKey:'fake',fetchImpl:async(_,init)=>{body=JSON.parse(init.body);return Response.json({places:[]})}})})
  assert.equal(body.locationBias.circle.radius,500)
  assert.equal(body.locationRestriction,undefined)
  assert.equal(parseJapanGuideSearchContext({...page,text:html+markup.replace('Onsenji%2BTemple','Other%2BTemple')},subject).mapCenter,undefined)
})
