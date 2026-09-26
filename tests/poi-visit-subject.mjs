/**
 * HKP-02 / HKP-03: часы, статус и стоимость привязаны к регистрируемому
 * предмету и к сроку.
 *
 * Классы ошибок партии 25.09.2026 воспроизведены на СИНТЕТИЧЕСКИХ страницах
 * той же разметки: часы визит-центра у гейзера (10502), часы парк-гольфа у
 * парка (11310), часы неясного назначения у святилища (13186), старое
 * объявление о закрытии (10321), закрытое здание при доступном холме (10420).
 * Каждый случай идёт через НАСТОЯЩИЕ `preparePortalDraftBatch`, `ingestPoi` и
 * исполнитель приёма; сеть перехвачена. Структурная проверка не доказывает
 * истинности текста — редакторская сверка с источником остаётся.
 */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { detail, date, page } from './fixtures/visit-hokkaido.mjs'
import { buildHokkaidoBundle, hokkaidoResearchRows, parseHokkaidoDetail, hokkaidoPracticalSubject, hokkaidoPracticalProjection } from '../scripts/poi-portals/lib/visit-hokkaido.mjs'
import { preparePortalDraftBatch, PORTAL_DRAFT_BATCH_SPEC, PORTAL_SUBJECT_BATCH_SPEC } from '../scripts/poi-portals/lib/portal-draft-batch.mjs'
import { buildIdentificationReport, runIdentification } from '../scripts/poi-portals/lib/place-identification.mjs'
import { EDITORIAL_POLICY, getEditorialPolicyDigest } from '../scripts/poi-portals/lib/poi-copywriter.mjs'
import { dossierDigest } from '../scripts/poi-portals/lib/japan-guide-facts.mjs'
import { parsePortalEvidence } from '../scripts/poi-portals/lib/japan-guide-evidence.mjs'
import { runIntakeCli } from '../scripts/poi-portals/intake-japan-guide.mjs'
import { evaluatePoiCandidate } from '../scripts/poi-portals/lib/scoring.mjs'
import { ingestPoi } from '../src/lib/poi-ingest.ts'
import { createSnapshotStore } from '../scripts/poi-portals/lib/base-snapshot.mjs'
import { assertPoiFacts, noticeIsHistorical, noticeIsUpcoming } from '../src/lib/poi-facts.ts'
import { sha256Bytes } from '../scripts/lib/byte-digest.mjs'

let checks = 0
let network = 0
const originalFetch = globalThis.fetch
globalThis.fetch = () => { network++; throw new Error('Unexpected network') }
const test = async (name, f) => {
  try { await f(); checks++; console.log('✓ ' + name) } catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }) }
}

const ADDRESS = '北海道札幌市中央区北一条'
/** A synthetic card in the portal's own layout; only the basic-information list differs. */
function card(locale, { title, titleEn = 'Test place', rows }) {
  const base = detail(locale)
  const dl = `<dl>${rows.map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join('')}</dl>`
  const html = base.html.replace(/<dl>[\s\S]*?<\/dl>/u, dl).replaceAll('札幌資料館', title).replace('>Test museum<', `>${titleEn}<`)
  return page(base.url, html)
}
const common = (ja) => ja
  ? [['所在地', ADDRESS], ['アクセス', 'JR札幌駅から徒歩5分'], ['関連リンク', '<a href="https://place.example.jp/">公式サイト</a>']]
  : [['Address', ADDRESS], ['Directions', '5 minutes on foot from JR Sapporo Station'], ['Website', '<a href="https://place.example.jp/">Official site</a>']]
function pagesFor({ title, titleEn, ja = [], en = [] }) {
  return [card('ja', { title, titleEn, rows: [...common(true), ...ja] }), card('en', { title, titleEn, rows: [...common(false), ...en] })]
}

const seed = [{ recordId: 'rec00000000000001', poiId: 'POI-000001', nameRu: 'Другое место', nameEn: null, siteCity: 'kyoto', lat: 35, lon: 135, placeId: 'fixture-existing', sourceKey: 'japan-guide:existing' }]
const today = date.slice(0, 10)
const fieldBlock = (research, bundle, kind, source = 0) => bundle.rows[0].cards[source].fields.find((f) => f.kind === kind).blockIds.at(-1)

/**
 * A complete packet: every block covered by a reported fact, reviewed copy,
 * identification bound to the same source. `author(d, ctx)` states the visit
 * assessment under test exactly as an agent would.
 */
async function packetFor(pages, { name, author = () => {}, official = null, child = false, businessStatus = 'OPERATIONAL' }) {
  const bundle = buildHokkaidoBundle(pages, pages.map((p) => ({ url: p.url, outcome: 'fetched', detail: '' })))
  const research = hokkaidoResearchRows(bundle)[0]
  const origin = research.sourceKey
  const key = child ? origin + '-hall' : origin
  const d = structuredClone(research.dossier)
  const evidence = structuredClone(research.evidence)
  d.sourceKey = key
  d.facts = evidence.flatMap((e, source) => e.blocks.map((b, i) => ({ id: `s${source}f${i}`, subject: name, category: i === 0 ? 'identity' : 'visiting',
    text: i === 0 ? `${name} — предмет этой карточки.` : 'Сведения карточки портала.', conditions: '', status: 'reported', references: [{ source, blockId: b.id }] })))
  d.coverage = d.coverage.map((c) => ({ ...c, disposition: 'facts', reason: '' }))
  d.copy = { ru: [{ text: 'Музей знакомит с историей города.', factIds: ['s0f0'] }], en: [{ text: 'The museum introduces the history of the town.', factIds: ['s0f0'] }] }
  if (official) {
    const e = parsePortalEvidence({ url: 'https://operator.example.org/visit', text: official, rawPageDigest: sha256Bytes(Buffer.from(official)), observedAt: date },
      { sourceKey: key, rootSelector: 'main', role: 'official' })
    const source = evidence.length
    evidence.push(e)
    d.sources.push({ url: e.sourceUrl, observedAt: e.observedAt, evidenceDigest: e.digest, blocks: e.blocks.map(({ id, kind, locator, section }) => ({ id, kind, locator, section })) })
    d.coverage.push(...e.blocks.map((b) => ({ source, blockId: b.id, disposition: 'facts', reason: '' })))
    d.facts.push({ id: 'official', subject: name, category: 'visiting', text: 'Оператор подтверждает часы 9:00–17:00.', conditions: '', status: 'verified', references: e.blocks.map((b) => ({ source, blockId: b.id })) })
  }
  const cards = bundle.rows[0].cards
  // A child subject proves its own name from the card; the translation is absent.
  if (child) d.facts[0].text += ' ' + cards[0].name
  author(d, { research, bundle, field: (kind, source = 0) => fieldBlock(research, bundle, kind, source) })
  const reviewer = { spec: 'poi-copy-review/v1', dossierDigest: dossierDigest(d), policyDigest: getEditorialPolicyDigest(), author: 'fixture-author', reviewer: 'fixture-editor',
    checkedAt: new Date().toISOString(), checks: Object.fromEntries(EDITORIAL_POLICY.reviewDimensions.map((k) => [k, true])), issues: [] }
  const queue = [{ sourceKey: key, sourceUrl: cards[0].url, nameJa: cards[0].name, nameEn: child ? null : cards[1]?.name ?? null, address: ADDRESS, siteCity: 'sapporo' }]
  const result = await runIdentification({ queue, limit: 1, now: () => new Date(date),
    resolve: async () => ({ outcome: 'resolved', place: { placeId: 'fixture-new', lat: 43.06, lon: 141.35, prefecture: { en: 'Hokkaido', ja: '北海道' }, businessStatus } }) })
  const identification = buildIdentificationReport({ queue, result, limit: 1, priceMicros: 32000, createdAt: date, inputs: { fixture: true }, portal: 'visit-hokkaido' })
  const row = { sourceKey: key, nameRu: name, siteCity: 'sapporo',
    proposal: { entityKind: 'tourist_poi', poiPrimaryType: 'museum', facets: [], confidence: 0.99, reasons: ['Синтетический предмет.'], nameRu: name },
    dossier: d, evidence, subjectAssessment: { role: 'place', nameRu: name, poiPrimaryType: 'museum', factIds: ['s0f0'], reason: 'Самостоятельный предмет карточки.' }, copyReview: reviewer }
  if (child) Object.assign(row, { originKey: origin, subjectNames: { nameJa: cards[0].name, nameEn: null }, sourceRelations: null, mapSelection: null })
  return { spec: child ? PORTAL_SUBJECT_BATCH_SPEC : PORTAL_DRAFT_BATCH_SPEC, portal: 'visit-hokkaido', bundle, identification, rows: [row] }
}
const prepare = (packet) => preparePortalDraftBatch(packet, seed, today)
/** The agent states the hours of this subject from the given facts. */
const statedHours = (name, factIds, hours = '9:00–17:00') => (d) => {
  d.visit = { status: 'open', hoursKind: 'stated', hours, factIds, explanation: 'Часы оценены по основаниям.', basis: { subject: name, hours: factIds, status: factIds } }
}
const hoursFact = (name, kind = 'hours') => (d, ctx) => {
  d.facts.push({ id: 'hours', subject: name, category: 'visiting', text: 'В карточке указаны часы 9:00–17:00.', conditions: '', status: 'reported', references: [{ source: 0, blockId: ctx.field(kind) }] })
}
const both = (...steps) => (d, ctx) => { for (const step of steps) step(d, ctx) }

// ── Извлечение: предмет расписания и метки полей ─────────────────────────
await test('FIELD_LABELS_KEEP_THEIR_MEANING', () => {
  const en = parseHokkaidoDetail(card('en', { title: '記念館', rows: [...common(false), ['Prices', 'Paid'], ['Price', 'Paid'], ['Admission', 'Paid'], ['Other contact details', 'Office']] }))
  assert.deepEqual(en.fields.filter((f) => ['Prices', 'Price', 'Admission'].includes(f.label)).map((f) => f.kind), ['admission', 'admission', 'admission'])
  assert.equal(en.fields.find((f) => f.label === 'Other contact details').kind, 'otherContact')
  const ja = parseHokkaidoDetail(card('ja', { title: '記念館', rows: [...common(true), ['料金', '有料']] }))
  assert.equal(ja.fields.find((f) => f.label === '料金').kind, 'admission')
})

await test('SCHEDULE_CONTEXT_IS_PRESERVED', () => {
  const c = parseHokkaidoDetail(card('ja', { title: '朝日ヶ丘公園', rows: [...common(true), ['営業時間', '8:00-18:00（5月-8月）<br>8:00-17:00（9月-10月：パークゴルフ場の営業時間）<br>※日時は変更する場合あり']] }))
  const hours = c.fields.find((f) => f.kind === 'hours')
  assert.equal(hours.section, '基本情報')
  assert.deepEqual(hours.lines.map((l) => [l.subject, l.continues]), [[null, false], ['パークゴルフ場', false], ['パークゴルフ場', true]])
})

const PARK_GOLF = { title: '朝日ヶ丘公園', titleEn: 'Asahigaoka Park', ja: [['営業時間', '8:00-18:00（5月-8月）<br>8:00-17:00（9月-10月：パークゴルフ場の営業時間）'], ['休業日', '期間中は無休']],
  en: [['Open', '8:00-18:00 (May-August)<br>8:00-17:00 (September-October: Park golf course hours)'], ['Closed', 'No closed days during the period']] }
const GEYSER = { title: '羅臼間歇泉', titleEn: 'Rausu Geyser', ja: [['電話番号', '0153-87-2828（知床羅臼ビジターセンター）'], ['営業時間', '9:00-17:00（5月-10月）<br>10:00-16:00（11月-4月）'], ['休業日', '月曜日（7-9月の月曜日は開館）'], ['駐車場', '30台、無料（知床羅臼ビジターセンター）']] }
const SHRINE = { title: '上川神社', titleEn: 'Kamikawa Shrine', ja: [['電話番号', '0166-65-3151'], ['営業時間', '9:00-17:00（3-10月）<br>9:00-16:30（11-2月）']] }
const MUSEUM = { title: '井上靖記念館', titleEn: 'Inoue Yasushi Memorial Museum', ja: [['営業時間', '9:00-17:00'], ['休業日', '月曜日（祝日の場合開館）'], ['料金', '一般 500円<br>中学生以下 無料']],
  en: [['Open', '9:00-17:00'], ['Prices', 'Adults 500 yen; free for middle school students and younger']] }
const OBSERVATORY = { title: 'フレトイ展望台', titleEn: 'Furetoi Observatory', ja: [['電話番号', '0152-67-5120（小清水町観光協会）'], ['営業時間', '8:30-17:30（5-10月）']] }

await test('ONE_JUDGEMENT_PER_SOURCE_ROW', () => {
  const state = (spec) => hokkaidoPracticalSubject(buildHokkaidoBundle(pagesFor(spec), pagesFor(spec).map((p) => ({ url: p.url, outcome: 'fetched', detail: '' }))).rows[0])
  assert.equal(state(PARK_GOLF).state, 'mixed')
  assert.deepEqual(state(PARK_GOLF).named, ['パークゴルフ場', 'Park golf course'])
  assert.equal(state(GEYSER).state, 'ambiguous')
  assert.deepEqual(state(GEYSER).facilities, ['知床羅臼ビジターセンター'])
  assert.equal(state(SHRINE).state, 'unspecified')
  assert.equal(state(MUSEUM).state, 'card')
  assert.equal(state(OBSERVATORY).state, 'unspecified', 'a contact organisation is not a schedule subject')
  const pages = pagesFor(PARK_GOLF)
  const research = hokkaidoResearchRows(buildHokkaidoBundle(pages, pages.map((p) => ({ url: p.url, outcome: 'fetched', detail: '' }))))[0]
  assert.equal(research.practicalSubject.state, 'mixed', 'the researcher sees the conflict before writing copy')
})

// ── Граница записи: часы чужого предмета не доходят до запроса ────────────
for (const [label, spec, name, reason] of [
  ['PARK_GOLF_HOURS_ARE_NOT_PARK_HOURS', PARK_GOLF, 'Парк Асахигаока', 'mixed'],
  ['VISITOR_CENTRE_HOURS_ARE_NOT_GEYSER_HOURS', GEYSER, 'Гейзер Раусу', 'ambiguous'],
  ['UNSPECIFIED_SCHEDULE_IS_NOT_SHRINE_GROUNDS_HOURS', SHRINE, 'Святилище Камикава', 'unspecified'],
]) {
  await test(label, async () => {
    const bad = await packetFor(pagesFor(spec), { name, author: both(hoursFact(name), statedHours(name, ['hours'])) })
    assert.throws(() => prepare(bad), new RegExp(`portalDraftHoursSubjectUnresolved: .*\\(${reason}\\)`))
    const unknown = await packetFor(pagesFor(spec), { name })
    const ok = prepare(unknown)
    assert.equal(ok.rows[0].outcome, 'writable', 'unknown own hours pass the other checks as usual')
    assert(!Object.hasOwn(ok.requests[0].poi, 'workingHours'))
    const confirmed = await packetFor(pagesFor(spec), { name, official: '<main><p>開園時間 9:00-17:00</p></main>', author: both(hoursFact(name), statedHours(name, ['hours', 'official'])) })
    assert.equal(prepare(confirmed).requests[0].poi.workingHours, '9:00–17:00', 'an operator confirmation binds the schedule')
  })
}

await test('INSTITUTION_CARD_SCHEDULE_REACHES_WORKING_HOURS', async () => {
  const name = 'Мемориальный музей Иноуэ Ясуси'
  const p = await packetFor(pagesFor(MUSEUM), { name, author: both(hoursFact(name), statedHours(name, ['hours'])) })
  const request = prepare(p).requests[0]
  assert.equal(request.poi.workingHours, '9:00–17:00')
  const out = await ingestPoi(request, createSnapshotStore(seed))
  assert.equal(out.outcome, 'created', out.explanation)
  assert.equal(out.fields['Working Hours'], '09:00–17:00', 'the canon only normalises the same hours')
})

await test('CHILD_SUBJECT_DOES_NOT_INHERIT_CARD_HOURS', async () => {
  const name = 'Зал мемориального музея'
  const p = await packetFor(pagesFor(MUSEUM), { name, child: true, author: both(hoursFact(name), statedHours(name, ['hours'])) })
  assert.throws(() => prepare(p), /portalDraftHoursSubjectUnresolved: .*\(childSubject\)/)
})

await test('GENERAL_CONTRACT_BINDS_HOURS_TO_THE_SUBJECT', async () => {
  const name = 'Мемориальный музей Иноуэ Ясуси'
  const foreign = await packetFor(pagesFor(MUSEUM), { name, author: both((d, ctx) => d.facts.push({ id: 'centre', subject: 'Визит-центр', category: 'visiting', text: 'Часы визит-центра 9:00–17:00.', conditions: '', status: 'reported', references: [{ source: 0, blockId: ctx.field('hours') }] }), statedHours(name, ['centre'])) })
  assert.throws(() => prepare(foreign), /hours basis must be visiting facts about the same subject/)
  const unbased = await packetFor(pagesFor(MUSEUM), { name, author: both(hoursFact(name), (d) => { d.visit = { status: 'open', hoursKind: 'stated', hours: '9:00–17:00', factIds: ['hours'], explanation: 'Без оснований.' } }) })
  assert.throws(() => prepare(unbased), /factsVisitBasisRequired/)
  const renamed = await packetFor(pagesFor(MUSEUM), { name, author: both(hoursFact(name), (d) => { statedHours(name, ['hours'])(d); d.visit.basis.subject = 'Другой предмет'; for (const f of d.facts) if (f.id === 'hours') f.subject = 'Другой предмет' }) })
  assert.throws(() => prepare(renamed), /factsVisitBasisSubject/)
  // Status alone also needs its basis; the portal hours check does not apply here.
  const statusOnly = await packetFor(pagesFor(MUSEUM), { name, author: both(hoursFact(name), (d) => { d.visit = { status: 'open', hoursKind: 'unknown', hours: '', factIds: ['hours'], explanation: 'Статус без оснований.' } }) })
  assert.throws(() => prepare(statusOnly), /factsVisitBasisRequired/)
})

await test('WORKING_HOURS_ARE_EXACTLY_THE_ASSESSED_HOURS', async () => {
  const name = 'Мемориальный музей Иноуэ Ясуси'
  const request = prepare(await packetFor(pagesFor(MUSEUM), { name, author: both(hoursFact(name), statedHours(name, ['hours'])) })).requests[0]
  const bad = structuredClone(request)
  bad.poi.workingHours = '8:00–18:00'
  let io = 0
  await assert.rejects(() => ingestPoi(bad, { readSchemaTables: async () => { io++; throw new Error('IO') } }), /factsWorkingHoursUnbound/)
  assert.equal(io, 0, 'refused before any store I/O')
})

await test('FOREIGN_HOURS_NEVER_REACH_THE_NETWORK', async () => {
  const name = 'Гейзер Раусу'
  const bad = await packetFor(pagesFor(GEYSER), { name, author: both(hoursFact(name), statedHours(name, ['hours'])) })
  const temp = await mkdtemp(path.join(os.tmpdir(), 'poi-visit-subject-'))
  try {
    const file = path.join(temp, 'packet.json')
    await writeFile(file, JSON.stringify(bad))
    let calls = 0
    await assert.rejects(() => runIntakeCli(['node', 'cli', '--portal-batch', file, '--write', '--run-id', 'foreign-hours'],
      { repoRoot: temp, now: () => new Date(date), env: { AIRTABLE_TOKEN: 'fixture' }, fetchImpl: () => { calls++; throw new Error('no') }, codeIdentity: { commit: 'a'.repeat(40), dirty: false } }),
    /portalDraftHoursSubjectUnresolved/)
    assert.equal(calls, 0, 'no GET, no POST')
  } finally { await rm(temp, { recursive: true, force: true }) }
})

// ── Срок объявлений ───────────────────────────────────────────────────────
await test('MUSEUM_NAMED_RESTAURANT_IS_A_DIFFERENT_HOURS_SUBJECT', async () => {
  const name = 'Музей'
  for (const [label, expected] of [['札幌資料館レストラン', 'mixed'], ['札幌資料館', 'card']]) {
    const packet = await packetFor(pagesFor({ title: '札幌資料館', ja: [['営業時間', `${label} 11:00-15:00`]] }),
      { name, author: both(hoursFact(name), statedHours(name, ['hours'], '11:00–15:00')) })
    assert.equal(hokkaidoPracticalSubject(packet.bundle.rows[0]).state, expected)
    if (expected === 'mixed') assert.throws(() => prepare(packet), /portalDraftHoursSubjectUnresolved/)
    else assert.equal(prepare(packet).rows[0].outcome, 'writable')
  }
})

await test('UPCOMING_CLOSURE_DOES_NOT_CLOSE_A_PLACE_TODAY', async () => {
  const name = 'Музей'
  const period = { effect: 'closure', from: '2026-12-18', until: '2026-12-19', recurrence: 'oneOff' }
  const future = await packetFor(pagesFor(MUSEUM), { name, author: both(hoursFact(name), statedHours(name, ['hours']), (d, ctx) => {
    d.facts.push({ id: 'future', subject: name, category: 'notice', text: 'Закрыт 18–19 декабря 2026 года.', conditions: '', status: 'reported', references: [{ source: 0, blockId: ctx.field('hours') }], notice: period })
    d.visit.factIds = [...d.visit.factIds, 'future']
  }) })
  assert.equal(prepare(future).rows[0].outcome, 'writable')
  const d = future.rows[0].dossier
  assert.equal(noticeIsUpcoming(d, d.facts.at(-1)), true)
  assert.equal(noticeIsHistorical(d, d.facts.at(-1)), false)
  const unknown = structuredClone(d)
  unknown.visit = { status: 'unknown', hoursKind: 'unknown', hours: '', factIds: ['future'], explanation: 'Будущий ремонт не сообщает текущий статус.' }
  assertPoiFacts(unknown)
  const falseStatus = structuredClone(d)
  falseStatus.visit.basis.status = ['future']
  assert.throws(() => assertPoiFacts(falseStatus), /upcoming notice cannot establish current status/)
  const missingAssessment = structuredClone(future)
  missingAssessment.rows[0].dossier.visit.factIds = ['hours']
  missingAssessment.rows[0].copyReview.dossierDigest = dossierDigest(missingAssessment.rows[0].dossier)
  assert.throws(() => prepare(missingAssessment), /factsNoticeNotAssessed/)
  const startsToday = structuredClone(d)
  startsToday.sources[0].observedAt = '2026-12-17T15:00:00Z'
  assert.equal(noticeIsUpcoming(startsToday, startsToday.facts.at(-1)), false, 'Tokyo day includes the start date')
})

const noticeAuthor = (name, notice, visit) => (d, ctx) => {
  d.facts.push({ id: 'notice', subject: name, category: 'notice', text: 'Объявление о закрытии 18–19 декабря 2025 года.', conditions: '', status: 'reported', references: [{ source: 0, blockId: ctx.field('hours') }], ...(notice ? { notice } : {}) })
  d.visit = { status: 'unknown', hoursKind: 'unknown', hours: '', factIds: ['notice'], explanation: 'Объявление оценено по сроку.', ...(visit ?? {}) }
}
const PAST = { effect: 'closure', from: '2025-12-18', until: '2025-12-19', recurrence: 'oneOff' }
await test('EXPIRED_ONE_OFF_CLOSURE_IS_HISTORY', async () => {
  const name = 'Музей почвы'
  const ok = await packetFor(pagesFor(MUSEUM), { name, author: noticeAuthor(name, PAST) })
  assert.equal(prepare(ok).rows[0].outcome, 'writable', 'history needs no invented status')
  assert.equal(noticeIsHistorical(ok.rows[0].dossier, ok.rows[0].dossier.facts.at(-1)), true)
  for (const [label, notice] of [
    ['no period', null],
    ['ends after observation', { ...PAST, until: '2026-12-19' }],
    ['seasonal rule', { effect: 'closure', from: '2025-11-01', until: '2026-04-30', recurrence: 'recurring' }],
    ['until further notice', { effect: 'closure', from: '2025-09-22', until: null, recurrence: 'untilFurtherNotice' }],
  ]) {
    const active = await packetFor(pagesFor(MUSEUM), { name, author: noticeAuthor(name, notice) })
    assert.throws(() => prepare(active), /factsNoticeNeedsAssessment/, label)
  }
  const basedOnHistory = await packetFor(pagesFor(MUSEUM), { name, author: noticeAuthor(name, PAST, { status: 'open', basis: { subject: name, hours: [], status: ['notice'] } }) })
  assert.throws(() => prepare(basedOnHistory), /historical notice cannot establish current status/)
})

await test('NOTICE_PERIOD_SHAPE_IS_STRICT', () => {
  const d = { spec: 'poi-facts/v2', sourceKey: 'visit-hokkaido:spot-1', updatedAt: date, history: [],
    sources: [{ url: 'https://example.jp/', observedAt: date, evidenceDigest: 'sha256:' + 'a'.repeat(64), blocks: [{ id: 'b1', kind: 'notice', locator: 'p', section: 'article' }] }],
    facts: [{ id: 'n', subject: 'Предмет', category: 'notice', text: 'Закрыто.', conditions: '', status: 'reported', references: [{ source: 0, blockId: 'b1' }], notice: PAST }],
    coverage: [{ source: 0, blockId: 'b1', disposition: 'facts', reason: '' }],
    visit: { status: 'unknown', hoursKind: 'unknown', hours: '', factIds: ['n'], explanation: 'Оценено.' }, website: null, copy: { ru: [], en: [] } }
  assertPoiFacts(d)
  for (const [label, change] of [
    ['one-off needs an end', (x) => { x.facts[0].notice.until = null }],
    ['open-ended has no end', (x) => { x.facts[0].notice.recurrence = 'untilFurtherNotice' }],
    ['dates are calendar days', (x) => { x.facts[0].notice.until = '2025-02-30' }],
    ['invalid month is a named refusal', (x) => { x.facts[0].notice.until = '2025-99-30' }],
    ['start before end', (x) => { x.facts[0].notice.from = '2026-01-01' }],
    ['closed vocabulary', (x) => { x.facts[0].notice.effect = 'maybe' }],
    ['only on notices', (x) => { x.facts[0].category = 'visiting' }],
    ['no extra keys', (x) => { x.facts[0].notice.note = 'x' }],
  ]) { const bad = structuredClone(d); change(bad); assert.throws(() => assertPoiFacts(bad), /poiFacts/, label) }
  const v1 = structuredClone(d); v1.spec = 'poi-facts/v1'; v1.sourceKey = 'japan-guide:e1'; delete v1.history
  assert.throws(() => assertPoiFacts(v1), /unexpected or missing field/, 'the frozen v1 does not grow new fields')
})

await test('CLOSED_BUILDING_IS_NOT_OPENED_BY_THE_HILL', async () => {
  const name = 'Смотровая площадка Фурэтои'
  const closure = { effect: 'closure', from: '2025-09-22', until: null, recurrence: 'untilFurtherNotice' }
  const author = (statusBasis, extra = () => {}) => (d) => {
    d.facts.push({ id: 'closed', subject: name, category: 'notice', text: 'Здание закрыто с 22 сентября 2025 года.', conditions: '', status: 'verified', references: [{ source: d.sources.length - 1, blockId: 'b1' }], notice: closure })
    d.facts.push({ id: 'hill', subject: 'Холм у смотровой площадки', category: 'visiting', text: 'Вид открывается и с холма вокруг здания.', conditions: '', status: 'verified', references: [{ source: d.sources.length - 1, blockId: 'b2' }] })
    extra(d)
    d.visit = { status: 'open', hoursKind: 'unknown', hours: '', factIds: ['closed', 'hill'], explanation: 'Холм доступен.', basis: { subject: name, hours: [], status: statusBasis } }
  }
  const official = '<main><p>展望台は閉館しています。</p><p>丘からの眺望は可能です。</p></main>'
  const viaHill = await packetFor(pagesFor(OBSERVATORY), { name, official, author: author(['hill']) })
  assert.throws(() => prepare(viaHill), /status basis must be facts about the same subject/)
  const relabelled = await packetFor(pagesFor(OBSERVATORY), { name, official, author: author(['closed']) })
  assert.throws(() => prepare(relabelled), /factsActiveClosureContradictsOpen/)
  const closed = await packetFor(pagesFor(OBSERVATORY), { name, official, businessStatus: 'CLOSED_TEMPORARILY',
    author: (d, ctx) => { author(['closed'])(d, ctx); d.visit.status = 'temporaryClosed'; d.visit.explanation = 'Здание закрыто; холм описан отдельно.' } })
  const out = await ingestPoi(prepare(closed).requests[0], createSnapshotStore(seed))
  assert.equal(out.outcome, 'created', out.explanation)
  assert.equal(out.fields['Operating Status'], 'Закрыт временно')
})

// ── Стоимость: проекция в настоящего кандидата и её вклад в оценку ─────────
const withFee = (fee, feeEn = null) => pagesFor({ ...MUSEUM, ja: [['営業時間', '9:00-17:00'], ['料金', fee]], en: feeEn ? [['Prices', feeEn]] : [] })
const candidateOf = async (pages, options = {}) => prepare(await packetFor(pages, { name: 'Мемориальный музей Иноуэ Ясуси', ...options })).candidates[0]
await test('MAIN_FEE_REACHES_THE_CANDIDATE_AND_THE_SCORE', async () => {
  const c = await candidateOf(withFee('一般 500円<br>中学生以下 無料'))
  assert.equal(c.priceLabel, '一般 500円 / 中学生以下 無料', 'conditions stay with the main fee')
  const withPrice = evaluatePoiCandidate(c)
  const without = evaluatePoiCandidate({ ...c, priceLabel: null })
  assert.equal(withPrice.score - without.score, 1)
  assert(withPrice.signals.some((s) => s.code === 'has_price'))
  assert(!without.signals.some((s) => s.code === 'has_price'))
  const en = await candidateOf(pagesFor({ ...MUSEUM, ja: [['営業時間', '9:00-17:00']], en: [['Prices', 'Paid admission; free for middle school students and younger.']] }))
  assert.equal(en.priceLabel, 'Paid admission; free for middle school students and younger.', 'the English «Prices» label is read too')
})

await test('CHILD_OR_SERVICE_FEE_DOES_NOT_REPLACE_THE_MAIN_FEE', async () => {
  for (const fee of ['中学生以下無料', 'カヌー体験 3,000円', 'パークゴルフ場（300円）', '特別展 1,000円']) {
    const c = await candidateOf(withFee(fee))
    assert.equal(c.priceLabel, null, fee)
    assert(!evaluatePoiCandidate(c).signals.some((s) => s.code === 'has_price'), fee)
  }
  const mixed = await candidateOf(withFee('入館料 500円<br>カヌー体験 3,000円'))
  assert.equal(mixed.priceLabel, '入館料 500円', 'a service line is not part of the admission')
})

await test('FEE_OF_ANOTHER_FACILITY_OR_A_CHILD_SUBJECT_IS_NOT_PROJECTED', async () => {
  const geyser = buildHokkaidoBundle(pagesFor({ ...GEYSER, ja: [...GEYSER.ja, ['料金', '無料']] }), pagesFor(GEYSER).map((p) => ({ url: p.url, outcome: 'fetched', detail: '' }))).rows[0]
  assert.equal(hokkaidoPracticalProjection(geyser, { wholeCardSubject: true }).priceLabel, null, 'the card attributes practical values to a visitor centre')
  const museum = buildHokkaidoBundle(withFee('一般 500円'), withFee('一般 500円').map((p) => ({ url: p.url, outcome: 'fetched', detail: '' }))).rows[0]
  assert.equal(hokkaidoPracticalProjection(museum, { wholeCardSubject: false }).priceLabel, null)
  assert.equal(hokkaidoPracticalProjection(museum, { wholeCardSubject: true }).priceLabel, '一般 500円')
  const child = await candidateOf(withFee('一般 500円'), { child: true, name: 'Зал музея' })
  assert.equal(child.priceLabel, null)
})

await test('NO_NETWORK', () => assert.equal(network, 0))
globalThis.fetch = originalFetch
console.log(`${checks} checks passed`)
