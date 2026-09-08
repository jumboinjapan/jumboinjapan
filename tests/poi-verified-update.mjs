#!/usr/bin/env node
/**
 * Граница проверяемого обновления в ПРОИЗВОДСТВЕННОЙ композиции (10h-B, DAG 2.8).
 *
 *   node tests/poi-verified-update.mjs
 *
 * Исполняется production-хранилище `createAirtablePoiStore` с подменённым
 * транспортом за границей `withVerifiedUpdates`; копий логики нет —
 * подменяется только `fetch`. Доказывается:
 *   • порядок: свежее чтение → observe → update (на диске) → PATCH → чтение → outcome;
 *   • намерение `update` лежит на диске ДО того, как PATCH ушёл в сеть;
 *   • чужая правка (дрейф с момента карточки) и разошедшееся тождество —
 *     `deferred` без PATCH; уже равное предложенному — `noChange` без PATCH;
 *   • потерянный ответ PATCH при состоявшемся эффекте — `verified` чтением;
 *     PATCH 500 без эффекта — `notApplied` и остановка серии; частичное
 *     применение — `mismatch`; отказ чтения после эффекта — `unknown`;
 *   • бюджет PATCH считается на границе, исчерпание — остановка ДО PATCH;
 *   • отказ журнала до эффекта — остановка без эффекта, после — recoveryRequired;
 *   • серия хранит доказанный префикс и не начинает хвост; карточка
 *     восстановления собирается по свежим чтениям без применённых строк;
 *   • dry-run хранилище за границей эффекта не даёт; враждебные брошенные
 *     значения не покидают границу.
 */
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAirtablePoiStore, POI_TABLE_ID } from '../scripts/poi-portals/lib/airtable-store.mjs'
import { openUpdateJournal, readUpdateJournal, summarizeUpdateJournal } from '../scripts/poi-portals/lib/update-journal.mjs'
import { buildUpdateCard, parseUpdateCard, recoveryCardFrom, UPDATE_CARD_SPEC, updateCardDigest } from '../scripts/poi-portals/lib/update-card.mjs'
import { classifyUpdateOutcome, compareObservation, runUpdateSeries, VerifiedUpdateError, withVerifiedUpdates } from '../scripts/poi-portals/lib/verified-update.mjs'
import { reconcileUpdateJournal } from '../scripts/poi-portals/reconcile-writes.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${String(text).slice(0, 260)}» нет «${needle}»`)
}
const boom = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e instanceof Error ? e.message : String(e) } }
process.on('uncaughtException', (e) => {
  bad.push(`сюита оборвана необработанной ошибкой: ${e instanceof Error ? e.message : String(e)}`)
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exit(1)
})
const unhandled = []
process.on('unhandledRejection', (e) => { unhandled.push(e); bad.push(`необработанное отклонение промиса (эффект не дождался намерения?): ${e instanceof Error ? e.message : String(e)}`) })

const NOW = new Date('2026-09-08T12:00:00.000Z')
const REC1 = 'recAAAAAAAAAAAA01'
const REC2 = 'recBBBBBBBBBBBB02'
const REC3 = 'recCCCCCCCCCCCC03'
const HOURS = 'Working Hours'
const dir = await mkdtemp(path.join(tmpdir(), 'jj-verified-update-'))
let runSeq = 0
const revoked = () => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy }

/**
 * Поддельный Airtable: таблица в памяти, GET по id и PATCH по id — с
 * управляемым поведением PATCH. Всё остальное — отказ.
 */
function fakeAirtable({ records, patch = 'apply', onRead = null, onPatch = null } = {}) {
  const table = new Map(Object.entries(records).map(([id, fields]) => [id, { ...fields }]))
  const calls = []
  const timeline = []
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })
  const fetchImpl = async (url, init = {}) => {
    const u = String(url)
    const method = init.method ?? 'GET'
    calls.push({ method, url: u, body: init.body ? JSON.parse(init.body) : null })
    if (!u.includes(`/${POI_TABLE_ID}/`)) throw new Error(`сеть не предусмотрена: ${u}`)
    const m = u.match(/\/(rec[A-Za-z0-9]{14})(?:\?|$)/)
    if (!m) throw new Error(`сеть не предусмотрена: ${u}`)
    const id = m[1]
    if (method === 'GET') {
      timeline.push(`GET ${id}`)
      if (onRead) { const forced = await onRead(id, calls.filter((c) => c.method === 'GET').length); if (forced !== undefined) return forced }
      const row = table.get(id)
      if (!row) return resp(404, { error: { type: 'NOT_FOUND' } })
      const wanted = [...new URL(u).searchParams.getAll('fields[]')]
      const fields = Object.fromEntries(Object.entries(row).filter(([k]) => !wanted.length || wanted.includes(k)))
      return resp(200, { id, fields })
    }
    if (method === 'PATCH') {
      timeline.push(`PATCH ${id}`)
      const incoming = JSON.parse(init.body).fields
      if (onPatch) await onPatch(id, incoming)
      const row = table.get(id)
      if (patch === 'fail500') return resp(500, { error: 'boom' })
      if (patch === 'okNotApplied') return resp(200, { id, fields: { ...row, ...incoming } })
      if (patch === 'throwBeforeApply') throw new Error('сеть оборвалась до отправки')
      if (patch === 'partial') { const [first] = Object.keys(incoming); row[first] = incoming[first]; return resp(200, { id, fields: { ...row } }) }
      Object.assign(row, incoming)
      if (patch === 'applyThenThrow') throw new Error('ответ потерян после эффекта')
      if (patch === 'applyThenHostile') throw revoked()
      return resp(200, { id, fields: { ...row } })
    }
    throw new Error(`сеть не предусмотрена: ${method} ${u}`)
  }
  return {
    fetchImpl, calls, timeline, table,
    get patches() { return calls.filter((c) => c.method === 'PATCH') },
    get gets() { return calls.filter((c) => c.method === 'GET') },
  }
}
const store = (fake, extra = {}) => createAirtablePoiStore({ token: 'tok', baseId: 'appTEST', fetchImpl: fake.fetchImpl, ...extra })
const BASE = { spec: UPDATE_CARD_SPEC, scopeId: 'poi-autoupdate-pilot-v1', portal: 'bodik-osaka-tourism', createdAt: NOW.toISOString(), recoveredFrom: null, note: 'часы' }
const row = (recordId, poiId, over = {}) => ({ recordId, poiId, sourceKey: `bodik:${poiId.slice(-1)}`, expectedOld: { [HOURS]: '9:00–17:00' }, proposed: { [HOURS]: '9:00–18:00' }, ...over })
const RECORDS = {
  [REC1]: { 'POI ID': 'POI-000001', 'Source Key': 'bodik:1', [HOURS]: '9:00–17:00', 'POI Name (RU)': 'Первая' },
  [REC2]: { 'POI ID': 'POI-000002', 'Source Key': 'bodik:2', [HOURS]: '9:00–17:00' },
  [REC3]: { 'POI ID': 'POI-000003', 'Source Key': 'bodik:3', [HOURS]: '9:00–17:00' },
}
const journalFor = async (card, over = {}) => openUpdateJournal({ dir, runId: `run-${++runSeq}`, now: NOW, meta: { cardDigest: updateCardDigest(card) }, ...over })
/* Обёртка журнала, пишущая ленту событий рядом с сетевой лентой хранилища. */
const traced = (journal, timeline) => ({
  ...journal,
  get sealed() { return journal.sealed },
  intent: async (p) => { timeline.push(`intent:${p.step} ${p.recordId}`); return journal.intent(p) },
  outcome: async (p) => { timeline.push(`outcome:${p.state} ${p.recordId}`); return journal.outcome(p) },
})
const outcomes = () => { const list = []; return { list, onOutcome: (o) => list.push(o) } }

/* ── 1. Счастливый путь: порядок, намерение на диске ДО PATCH, verified ── */
{
  const card = parseUpdateCard({ ...BASE, rows: [row(REC1, 'POI-000001')] })
  const journal = await journalFor(card)
  let intentOnDiskBeforePatch = null
  const fake = fakeAirtable({
    records: RECORDS,
    onPatch: async () => {
      const entries = await readUpdateJournal(journal.file)
      intentOnDiskBeforePatch = entries.some((e) => e.kind === 'intent' && e.step === 'update' && e.fields[HOURS] === '9:00–18:00')
    },
  })
  const seen = outcomes()
  const wrapped = withVerifiedUpdates(store(fake), { journal: traced(journal, fake.timeline), maxUpdates: 1, onOutcome: seen.onOutcome })
  const outcome = await wrapped.update(card.rows[0])
  t('исход verified', outcome.state, 'verified')
  t('  тождество из базы', `${outcome.poiId}/${outcome.sourceKey}`, 'POI-000001/bodik:1')
  t('порядок: чтение → observe → update → PATCH → чтение → outcome', fake.timeline.join(' | '), `GET ${REC1} | intent:observe ${REC1} | intent:update ${REC1} | PATCH ${REC1} | GET ${REC1} | outcome:verified ${REC1}`)
  t('намерение update лежало на диске, когда PATCH ушёл в сеть', intentOnDiskBeforePatch, true)
  t('ровно один PATCH и ровно с изменяемым полем', JSON.stringify(fake.patches[0].body), JSON.stringify({ fields: { [HOURS]: '9:00–18:00' } }))
  t('база изменена', fake.table.get(REC1)[HOURS], '9:00–18:00')
  t('наблюдатель получил исход', seen.list.map((o) => o.state).join(','), 'verified')
  await journal.finish()
  const s = summarizeUpdateJournal(await readUpdateJournal(journal.file))
  t('журнал: observe хранит прежнее значение', s.attempts[0].observedFields[HOURS], '9:00–17:00')
  t('журнал: update хранит нагрузку', s.attempts[0].expectedFields[HOURS], '9:00–18:00')
  t('журнал: applied', s.applied.join(','), REC1)
  t('исходное хранилище не мутировано', typeof Object.getOwnPropertyDescriptor(store(fake), 'update').value, 'function')
  has('без журнала граница не ставится', await boom(() => withVerifiedUpdates(store(fake), {})), 'без журнала')
  has('хранилище без чтения по id за границу не ставится', await boom(() => withVerifiedUpdates({ update() {} }, { journal })), 'readFreshByRecordId')
  has('бюджет — целое ≥ 0', await boom(() => withVerifiedUpdates(store(fake), { journal, maxUpdates: -1 })), 'бюджет PATCH')
}

/* ── 2. Без эффекта: дрейф, тождество, noChange, отсутствие записи ─────── */
{
  const card = parseUpdateCard({ ...BASE, rows: [row(REC1, 'POI-000001'), row(REC2, 'POI-000002'), row(REC3, 'POI-000003')] })
  const fake = fakeAirtable({ records: {
    [REC1]: { ...RECORDS[REC1], [HOURS]: '10:00–20:00' }, // чужая правка после карточки
    [REC2]: { ...RECORDS[REC2], [HOURS]: '9:00–18:00' },  // уже равно предложенному
    [REC3]: { ...RECORDS[REC3], 'POI ID': 'POI-000099' }, // тождество разошлось
  } })
  const journal = await journalFor(card)
  const wrapped = withVerifiedUpdates(store(fake), { journal, maxUpdates: 3 })
  const a = await wrapped.update(card.rows[0])
  t('дрейф с момента карточки — deferred', a.state, 'deferred')
  has('  причина называет карточку и базу', a.reason, 'чужая правка не затирается')
  t('  и поле названо', (a.differing ?? []).join(','), HOURS)
  const b = await wrapped.update(card.rows[1])
  t('уже равно предложенному — noChange', b.state, 'noChange')
  const c = await wrapped.update(card.rows[2])
  t('тождество разошлось — deferred', c.state, 'deferred')
  has('  причина называет POI ID', c.reason, 'POI ID')
  t('ни одного PATCH', fake.patches.length, 0)
  t('все три записи прочитаны перед строкой', fake.gets.length, 3)
  await journal.finish()
  const s = summarizeUpdateJournal(await readUpdateJournal(journal.file))
  t('журнал: состояния', JSON.stringify(s.byState), '{"deferred":2,"noChange":1}')
  t('журнал: observe дрейфа несёт значение ИЗ БАЗЫ, не из карточки', s.attempts[0].observedFields[HOURS], '10:00–20:00')
  t('журнал: pending — отложенные', s.pending.join(','), `${REC1},${REC3}`)
  /* Запись исчезла. */
  const gone = fakeAirtable({ records: {} })
  const j2 = await journalFor(card)
  const w2 = withVerifiedUpdates(store(gone), { journal: j2, maxUpdates: 1 })
  const d = await w2.update(card.rows[0])
  t('записи нет — deferred без PATCH', `${d.state}/${gone.patches.length}`, 'deferred/0')
  /* Чтение перед строкой отказало — строка отложена, в журнал не входит, серия продолжается. */
  const flaky = fakeAirtable({ records: RECORDS, onRead: async (id) => (id === REC1 ? (() => { throw new Error('таймаут чтения') })() : undefined) })
  const j3 = await journalFor(card)
  const w3 = withVerifiedUpdates(store(flaky), { journal: j3, maxUpdates: 3 })
  const series = await runUpdateSeries(w3, card)
  t('отказ чтения перед строкой — deferred', series.outcomes[0].state, 'deferred')
  has('  причина: эффект не начат', series.outcomes[0].reason, 'эффект не начат')
  t('  серия продолжилась и применила остальные', series.applied.join(','), `${REC2},${REC3}`)
  t('  PATCH ровно два', flaky.patches.length, 2)
  await j3.finish()
  t('  строка без чтения в журнал не вошла', (await readUpdateJournal(j3.file)).filter((e) => e.kind === 'intent' && e.recordId === REC1).length, 0)
}

/* ── 3. После эффекта: потерянный ответ, 500, не применён, частично, unknown ── */
{
  const card = parseUpdateCard({ ...BASE, rows: [row(REC1, 'POI-000001')] })
  const run = async (patch, extra = {}) => {
    const fake = fakeAirtable({ records: RECORDS, patch, ...extra })
    const journal = await journalFor(card)
    const seen = outcomes()
    const wrapped = withVerifiedUpdates(store(fake), { journal, maxUpdates: 1, onOutcome: seen.onOutcome })
    let thrown = null
    let outcome = null
    try { outcome = await wrapped.update(card.rows[0]) } catch (e) { thrown = e }
    await journal.finish().catch(() => {})
    return { fake, journal, seen, thrown, outcome, entries: await readUpdateJournal(journal.file).catch(() => []) }
  }
  const lost = await run('applyThenThrow')
  t('ответ потерян, эффект состоялся — verified чтением', lost.outcome?.state, 'verified')
  has('  и ошибка writer’а сохранена в причине', lost.entries.find((e) => e.kind === 'outcome')?.reason, 'writer сообщил об ошибке')
  const hostile = await run('applyThenHostile')
  t('враждебное брошенное значение после эффекта — verified, граница не упала', hostile.outcome?.state, 'verified')
  const failed = await run('fail500')
  t('PATCH 500, база прежняя — notApplied', failed.thrown?.state, 'notApplied')
  t('  и это VerifiedUpdateError с остановкой', failed.thrown instanceof VerifiedUpdateError && failed.thrown.stop, true)
  t('  recoveryRequired нет: эффект доказанно не состоялся', failed.thrown?.recoveryRequired, false)
  const notApplied = await run('okNotApplied')
  t('PATCH 200, но база прежняя — notApplied (телу ответа не верим)', notApplied.thrown?.state, 'notApplied')
  const twoField = parseUpdateCard({ ...BASE, rows: [row(REC1, 'POI-000001', { expectedOld: { [HOURS]: '9:00–17:00', 'POI Name (RU)': 'Первая' }, proposed: { [HOURS]: '9:00–18:00', 'POI Name (RU)': 'Вторая' } })] })
  {
    const fake = fakeAirtable({ records: RECORDS, patch: 'partial' })
    const journal = await journalFor(twoField)
    const wrapped = withVerifiedUpdates(store(fake), { journal, maxUpdates: 1 })
    let thrown = null
    try { await wrapped.update(twoField.rows[0]) } catch (e) { thrown = e }
    t('частичное применение — mismatch', thrown?.state, 'mismatch')
    t('  и recoveryRequired', thrown?.recoveryRequired, true)
    await journal.finish()
    const s = summarizeUpdateJournal(await readUpdateJournal(journal.file))
    t('  журнал: recoveryRequired', s.recoveryRequired.map((a) => a.recordId).join(','), REC1)
    /* Поздняя сверка по журналу: чтение показывает частичное — mismatch; после ручного доведения — verified. */
    const later = await reconcileUpdateJournal(journal.file, { readByRecordId: (id, fields) => store(fake).readFreshByRecordId(id, fields) })
    t('  сверка: mismatch по чтению', later.resolved[0].resolution, 'mismatch')
    fake.table.get(REC1)['POI Name (RU)'] = 'Вторая'
    const fixed = await reconcileUpdateJournal(journal.file, { readByRecordId: (id, fields) => store(fake).readFreshByRecordId(id, fields) })
    t('  сверка после доведения руками: verified', fixed.resolved[0].resolution, 'verified')
  }
  const unreadable = await run('apply', { onRead: async (id, n) => (n === 2 ? (() => { throw new Error('чтение после эффекта отказало') })() : undefined) })
  t('чтение после эффекта отказало — unknown', unreadable.thrown?.state, 'unknown')
  t('  recoveryRequired', unreadable.thrown?.recoveryRequired, true)
  t('  а база при этом изменена', unreadable.fake.table.get(REC1)[HOURS], '9:00–18:00')
  const wrongId = await run('apply', { onRead: async (id, n) => (n === 2 ? { ok: true, status: 200, json: async () => ({ id: REC2, fields: { [HOURS]: '9:00–18:00' } }) } : undefined) })
  t('чтение отдало чужой id — unknown (хранилище отвергло ответ)', wrongId.thrown?.state, 'unknown')
  has('  причина называет тождество', wrongId.thrown?.reason, 'тождество')
  t('чистая классификация: запись исчезла после PATCH — mismatch', classifyUpdateOutcome({ recordId: REC1, expected: { proposed: { a: 1 }, observed: { a: 0 } }, found: null, readError: null }).state, 'mismatch')
  t('чистая классификация: без нагрузки — unknown', classifyUpdateOutcome({ recordId: REC1, expected: null, found: { recordId: REC1, fields: {} }, readError: null }).state, 'unknown')
  t('чистое сравнение: карточка без poiId не требует тождества по номеру', compareObservation({ recordId: REC1, poiId: null, sourceKey: null, expectedOld: { a: 1 }, proposed: { a: 2 } }, { recordId: REC1, fields: { a: 1, 'POI ID': 'x' } }).deferred, false)
}

/* ── 4. Бюджет, dry-run, чужая нагрузка хранилища, журнал ─────────────── */
{
  const card = parseUpdateCard({ ...BASE, rows: [row(REC1, 'POI-000001'), row(REC2, 'POI-000002')] })
  {
    const fake = fakeAirtable({ records: RECORDS })
    const journal = await journalFor(card)
    const wrapped = withVerifiedUpdates(store(fake), { journal, maxUpdates: 1 })
    const series = await runUpdateSeries(wrapped, card)
    t('бюджет 1: первая применена', series.applied.join(','), REC1)
    t('бюджет 1: вторая отложена ДО PATCH и серия остановлена', `${series.stoppedAt?.state}/${fake.patches.length}`, 'deferred/1')
    has('  причина: бюджет', series.stoppedAt?.reason, 'бюджет PATCH исчерпан')
    t('  вторая запись не изменена', fake.table.get(REC2)[HOURS], '9:00–17:00')
    await journal.finish()
    const s = summarizeUpdateJournal(await readUpdateJournal(journal.file))
    t('  журнал закрыт: попыток 2, применено 1, failed', JSON.stringify([s.attempts.length, s.applied.length, s.byState.deferred]), '[2,1,1]')
  }
  {
    /* noChange не тратит бюджет. */
    const fake = fakeAirtable({ records: { ...RECORDS, [REC1]: { ...RECORDS[REC1], [HOURS]: '9:00–18:00' } } })
    const journal = await journalFor(card)
    const wrapped = withVerifiedUpdates(store(fake), { journal, maxUpdates: 1 })
    const series = await runUpdateSeries(wrapped, card)
    t('noChange не тратит бюджет: вторая применена', `${series.noChange.join(',')}|${series.applied.join(',')}`, `${REC1}|${REC2}`)
  }
  {
    /* dry-run хранилище: нагрузку не объявляет — эффекта нет, серия стоит. */
    const fake = fakeAirtable({ records: RECORDS })
    const journal = await journalFor(card)
    const wrapped = withVerifiedUpdates(store(fake, { dryRun: true }), { journal, maxUpdates: 2 })
    const series = await runUpdateSeries(wrapped, card)
    t('dry-run за границей: deferred и остановка, PATCH 0', `${series.stoppedAt?.state}/${fake.patches.length}`, 'deferred/0')
    has('  причина: нагрузка не объявлена', series.stoppedAt?.reason, 'не объявило нагрузку')
  }
  {
    /* Хранилище объявило нагрузку не ту, что предложено, — PATCH не начат. */
    const fake = fakeAirtable({ records: RECORDS })
    const base = store(fake)
    const rogue = { ...base, update: (id, fields, opts) => base.update(id, { ...fields, 'Website': 'https://x' }, opts) }
    const journal = await journalFor(card)
    const wrapped = withVerifiedUpdates(rogue, { journal, maxUpdates: 2 })
    const series = await runUpdateSeries(wrapped, card)
    t('чужая нагрузка хранилища — deferred без PATCH', `${series.stoppedAt?.state}/${fake.patches.length}`, 'deferred/0')
    has('  причина', series.stoppedAt?.reason, 'расходится с предложенным')
  }
  {
    /* Хранилище отказывается обновлять поля тождества и требует наблюдателя за границей. */
    const fake = fakeAirtable({ records: RECORDS })
    has('хранилище: поле тождества — отказ', await boom(() => store(fake).update(REC1, { 'POI ID': 'x' })), 'защищённое поле')
    has('хранилище: координаты — отказ до сети (P07)', await boom(() => store(fake).update(REC1, { Latitude: 35, 'Working Hours': 'x' })), 'защищённое поле')
    has('хранилище: чужой id — отказ до сети', await boom(() => store(fake).update('rec1', { a: 1 })), 'не идентификатор')
    has('хранилище: пустая нагрузка — отказ', await boom(() => store(fake).update(REC1, {})), 'непустым объектом')
    t('  и сети не было', fake.calls.length, 0)
    const idJournal = await journalFor(card)
    has('граница: поле тождества в строке — отказ', await boom(() => withVerifiedUpdates(store(fake), { journal: idJournal, maxUpdates: 1 }).update({ recordId: REC1, expectedOld: { 'POI ID': 'a' }, proposed: { 'POI ID': 'b' } })), 'защищённые поля')
  }
  {
    /* Журнал отказал ДО эффекта: наблюдение не записано — серия стоит без PATCH. */
    const fake = fakeAirtable({ records: RECORDS })
    let opens = 0
    const io = { open: async (...args) => { opens += 1; if (opens >= 2) throw new Error('диск отказал'); return (await import('node:fs/promises')).open(...args) } }
    const journal = await journalFor(card, { io })
    const wrapped = withVerifiedUpdates(store(fake), { journal, maxUpdates: 2 })
    const series = await runUpdateSeries(wrapped, card)
    t('журнал отказал до эффекта — deferred, остановка, PATCH 0', `${series.stoppedAt?.state}/${series.stoppedAt?.recoveryRequired}/${fake.patches.length}`, 'deferred/false/0')
    has('  причина: наблюдение не записано', series.stoppedAt?.reason, 'наблюдение не записано')
  }
  {
    /* Журнал отказал ПОСЛЕ эффекта: исход не записан — unknown, recoveryRequired. */
    const fake = fakeAirtable({ records: RECORDS })
    let opens = 0
    const io = { open: async (...args) => { opens += 1; if (opens === 4) throw new Error('диск отказал'); return (await import('node:fs/promises')).open(...args) } }
    const journal = await journalFor(card, { io })
    const seen = outcomes()
    const wrapped = withVerifiedUpdates(store(fake), { journal, maxUpdates: 2, onOutcome: seen.onOutcome })
    const series = await runUpdateSeries(wrapped, card)
    t('журнал отказал после эффекта — unknown, recoveryRequired', `${series.stoppedAt?.state}/${series.stoppedAt?.recoveryRequired}`, 'unknown/true')
    t('  эффект при этом состоялся', fake.table.get(REC1)[HOURS], '9:00–18:00')
    has('  наблюдатель получил unknown с причиной', seen.list[0]?.reason, 'исход не записан в журнал после возможного эффекта')
    const entries = await readUpdateJournal(journal.file)
    t('  на диске — намерения без исхода (главный аварийный случай)', entries.filter((e) => e.kind === 'intent').length, 2)
    const late = await reconcileUpdateJournal(journal.file, { readByRecordId: (id, fields) => store(fake).readFreshByRecordId(id, fields) })
    t('  поздняя сверка по намерению: verified', late.resolved[0].resolution, 'verified')
  }
}

/* ── 5. Серия: доказанный префикс, хвост не начат, карточка восстановления ── */
{
  const card = parseUpdateCard({ ...BASE, rows: [row(REC1, 'POI-000001'), row(REC2, 'POI-000002'), row(REC3, 'POI-000003')] })
  let patches = 0
  const fake = fakeAirtable({ records: RECORDS, patch: 'apply', onPatch: async () => { patches += 1; if (patches === 2) throw new Error('сеть оборвалась до отправки') } })
  const journal = await journalFor(card)
  const wrapped = withVerifiedUpdates(store(fake), { journal, maxUpdates: 3 })
  const series = await runUpdateSeries(wrapped, card)
  t('первая строка применена', series.applied.join(','), REC1)
  t('вторая: PATCH оборвался, база прежняя — notApplied, серия остановлена', series.stoppedAt?.state, 'notApplied')
  t('третья не начата', series.notStarted.join(','), REC3)
  t('PATCH третьей не было', fake.patches.length, 2)
  t('состояния серии', JSON.stringify(series.byState), '{"verified":1,"notApplied":1}')
  /* Та же запись второй раз в том же журнале — грамматика не даст (и PATCH не будет). */
  has('повторная попытка в том же журнале — отказ грамматики до эффекта', await boom(() => wrapped.update(card.rows[0])), 'повторная попытка для')
  t('  и PATCH не прибавилось', fake.patches.length, 2)
  await journal.finish()
  const s = summarizeUpdateJournal(await readUpdateJournal(journal.file))
  t('журнал: попыток 2 (третьей нет), применено 1', JSON.stringify([s.attempts.length, s.applied.length]), '[2,1]')
  /* Карточка восстановления — по свежим чтениям оставшихся строк. */
  const fresh = []
  for (const id of [REC2, REC3]) fresh.push(await store(fake).readFreshByRecordId(id, [HOURS]))
  const rec = recoveryCardFrom(card, { applied: series.applied, noChange: series.noChange, observations: fresh, createdAt: '2026-09-08T13:00:00.000Z', note: 'восстановление' })
  t('карточка восстановления: только вторая и третья', rec.card.rows.map((r) => r.recordId).join(','), `${REC2},${REC3}`)
  t('  привязана к исходной карточке', rec.card.recoveredFrom, updateCardDigest(card))
  t('  прежние значения — по свежему чтению', rec.card.rows.every((r) => r.expectedOld[HOURS] === '9:00–17:00'), true)
  /* Сборка карточки из наблюдений и предложений — на production-чтении. */
  const built = buildUpdateCard({ ...BASE, observations: fresh.map((o) => ({ recordId: o.recordId, poiId: o.poiId, sourceKey: o.sourceKey, fields: o.fields })), proposals: [{ recordId: REC2, proposed: { [HOURS]: '9:00–18:00' } }, { recordId: REC3, proposed: { [HOURS]: '9:00–17:00' } }] })
  t('сборка по production-чтению: неизменная строка выпала', built.skipped.map((x) => x.recordId).join(','), REC3)
  t('  тождество взято из чтения', built.card.rows[0].sourceKey, 'bodik:2')
}

/* ── 6. Чтение по id — самодоказательное; враждебные значения хранилища ── */
{
  const fake = fakeAirtable({ records: RECORDS })
  const fresh = await store(fake).readFreshByRecordId(REC1, [HOURS])
  t('чтение по id отдаёт тождество и поля', `${fresh.recordId}/${fresh.poiId}/${fresh.sourceKey}/${fresh.fields[HOURS]}`, `${REC1}/POI-000001/bodik:1/9:00–17:00`)
  has('  запрошены поля тождества и названные', fake.gets[0].url, 'fields%5B%5D=Working+Hours')
  t('404 — null', await store(fake).readFreshByRecordId('recZZZZZZZZZZZZ99'), null)
  const liar = fakeAirtable({ records: RECORDS, onRead: async () => ({ ok: true, status: 200, json: async () => ({ id: REC2, fields: {} }) }) })
  has('ответ с чужим id — отказ хранилища', await boom(() => store(liar).readFreshByRecordId(REC1)), 'не доказывает тождество')
  has('не-id — отказ до сети', await boom(() => store(fake).readFreshByRecordId('../x')), 'не идентификатор записи')
  /* Враждебное хранилище: бросает отозванный Proxy на чтении перед строкой — строка отложена, сюита жива. */
  const card = parseUpdateCard({ ...BASE, rows: [row(REC1, 'POI-000001')] })
  const hostileStore = { ...store(fake), readFreshByRecordId: async () => { throw revoked() } }
  const journal = await journalFor(card)
  const wrapped = withVerifiedUpdates(hostileStore, { journal, maxUpdates: 1 })
  const outcome = await wrapped.update(card.rows[0])
  t('враждебное чтение перед строкой — deferred, описано безопасно', outcome.state, 'deferred')
  has('  причина описана', outcome.reason, 'чтение перед строкой отказало')
  t('  и ни одного PATCH', fake.patches.length, 0)
  /* Серия с хранилищем, бросающим не-VerifiedUpdateError из update ПОСЛЕ намерения: исход по чтению, а не по броску. */
  const throwing = fakeAirtable({ records: RECORDS, patch: 'throwBeforeApply' })
  const j2 = await journalFor(card)
  const w2 = withVerifiedUpdates(store(throwing), { journal: j2, maxUpdates: 1 })
  const s2 = await runUpdateSeries(w2, card)
  t('fetch бросил до отправки, база прежняя — notApplied по чтению', s2.stoppedAt?.state, 'notApplied')
  has('  и ошибка writer’а в причине', s2.stoppedAt?.reason, 'writer сообщил об ошибке')
  t('журнал на диске читается строгой грамматикой', (await readUpdateJournal(j2.file)).length >= 3, true)
  const raw = await readFile(j2.file, 'utf8')
  has('  intent update записан до исхода', raw.split('\n')[2], '"step":"update"')
}

/* ── 7. Регрессии аудита R1 (10h-B-01…04) ───────────────────────────── */
{
  /* 10h-B-01: проверяется нагрузка, которая уйдёт в сеть, а не переданный объект. */
  const fake = fakeAirtable({ records: RECORDS })
  const viaToJSON = { [HOURS]: '9:00–18:00', toJSON() { return { Latitude: 35.1, Longitude: 139.1, 'Source Key': 'changed' } } }
  has('10h-B-01: toJSON с защищёнными полями — отказ', await boom(() => store(fake).update(REC1, viaToJSON)), 'сериализация добавила поля')
  t('  и PATCH не было', fake.patches.length, 0)
  const viaToJSONHours = { [HOURS]: '9:00–18:00', toJSON() { return { Latitude: 35.1 } } }
  has('10h-B-01: toJSON, подменяющий нагрузку целиком, — отказ', await boom(() => store(fake).update(REC1, viaToJSONHours)), 'сериализация добавила поля')
  const viaGetter = Object.defineProperty({ [HOURS]: '9:00–18:00' }, 'Latitude', { get: () => 35, enumerable: true })
  has('10h-B-01: геттер вместо значения — отказ', await boom(() => store(fake).update(REC1, viaGetter)), 'не значением')
  t('  и PATCH по-прежнему не было', fake.patches.length, 0)
  const applied = await store(fake).update(REC1, { [HOURS]: '9:00–18:00', Website: { toJSON() { return 'https://x' } } })
  t('10h-B-01: обычная нагрузка (toJSON внутри значения) проходит', applied.recordId, REC1)
  t('  тело PATCH — ровно сериализованные поля', JSON.stringify(fake.patches[0].body), JSON.stringify({ fields: { [HOURS]: '9:00–18:00', Website: 'https://x' } }))
  has('10h-B-01: в теле PATCH нет защищённых полей', JSON.stringify(fake.patches[0].body).includes('Latitude') ? 'есть' : 'нет', 'нет')

  /* 10h-B-03 и 10h-B-R2-01: отказ обработчика отчёта — синхронный throw ИЛИ
     отклонённый Promise — не искажает доказанный исход и не обрывает серию. */
  const FAILURES = {
    sync: () => { throw new Error('приёмник отчёта недоступен') },
    async: async () => { throw new Error('приёмник отчёта недоступен') },
    rejected: () => Promise.reject(new Error('приёмник отчёта недоступен')),
  }
  for (const observer of ['onRow', 'onOutcome']) for (const [mode, failing] of Object.entries(FAILURES)) {
    const label = `10h-B-03/R2-01 ${observer} ${mode}`
    const card = parseUpdateCard({ ...BASE, rows: [row(REC1, 'POI-000001'), row(REC2, 'POI-000002')] })
    const f = fakeAirtable({ records: RECORDS })
    const journal = await journalFor(card)
    const rejectionsBefore = unhandled.length
    const wrapped = withVerifiedUpdates(store(f), { journal, maxUpdates: 2, ...(observer === 'onOutcome' ? { onOutcome: failing } : {}) })
    const series = await runUpdateSeries(wrapped, card, observer === 'onRow' ? { onRow: failing } : {})
    await journal.finish()
    const disk = summarizeUpdateJournal(await readUpdateJournal(journal.file))
    t(`${label}: сводка возвращена, applied серии = applied журнала`, series.applied.join(','), disk.applied.join(','))
    t(`${label}: обе строки применены`, series.applied.join(','), `${REC1},${REC2}`)
    t(`${label}: ровно один исход на запись`, series.outcomes.filter((o) => o.recordId === REC1).length, 1)
    t(`${label}: verified не попадает в recoveryRequired`, series.recoveryRequired.length, 0)
    t(`${label}: отказы уведомлений названы отдельно`, series.reportFailures.length, 2)
    has(`${label}: причина отказа уведомления сохранена`, series.reportFailures[0].reason, 'приёмник отчёта недоступен')
    t(`${label}: PATCH ровно два`, f.patches.length, 2)
    await new Promise((resolve) => setImmediate(resolve))
    t(`${label}: необработанных отклонений нет`, unhandled.length - rejectionsBefore, 0)
  }
  for (const [mode, failing] of Object.entries(FAILURES)) {
    /* Отказ onRow на неподтверждённом исходе: остановка сохраняется, исход один — и при async. */
    const card = parseUpdateCard({ ...BASE, rows: [row(REC1, 'POI-000001'), row(REC2, 'POI-000002')] })
    const f = fakeAirtable({ records: RECORDS, patch: 'fail500' })
    const journal = await journalFor(card)
    const wrapped = withVerifiedUpdates(store(f), { journal, maxUpdates: 2 })
    const series = await runUpdateSeries(wrapped, card, { onRow: failing })
    t(`10h-B-03/R2-01 ${mode}: неподтверждённый исход + отказ onRow — серия остановлена на нём`, series.stoppedAt?.state, 'notApplied')
    t(`  ${mode}: исход один, хвост не начат`, `${series.outcomes.length}/${series.notStarted.join(',')}`, `1/${REC2}`)
    t(`  ${mode}: отказ уведомления назван`, series.reportFailures.length, 1)
  }
  {
    /* Отклонённый Promise onOutcome на исходе без эффекта (deferred) и после отказа журнала — тоже дожидается. */
    const card = parseUpdateCard({ ...BASE, rows: [row(REC1, 'POI-000001')] })
    const f = fakeAirtable({ records: { [REC1]: { ...RECORDS[REC1], [HOURS]: '10:00–20:00' } } })
    const journal = await journalFor(card)
    const rejectionsBefore = unhandled.length
    const wrapped = withVerifiedUpdates(store(f), { journal, maxUpdates: 1, onOutcome: FAILURES.async })
    const outcome = await wrapped.update(card.rows[0])
    await new Promise((resolve) => setImmediate(resolve))
    t('R2-01: deferred + отклонённый onOutcome — исход возвращён', outcome.state, 'deferred')
    t('  отказ уведомления записан на границе', wrapped.notificationFailures.length, 1)
    t('  необработанных отклонений нет', unhandled.length - rejectionsBefore, 0)
  }
  /* Структурно: каждый вызов обёрток уведомлений дожидается, обработчики — внутри try с await. */
  {
    const src = await readFile(new URL('../scripts/poi-portals/lib/verified-update.mjs', import.meta.url), 'utf8')
    const code = src.replace(/\/\*[^]*?\*\//g, '')
    t('R2-01: обработчики вызываются с await внутри try', /try \{\s*await onOutcome\(outcome\)/.test(code) && /try \{\s*await onRow\(outcome\)/.test(code), true)
    t('R2-01: ни одного вызова notify без await', (code.match(/(?<!await )\bnotify\(/g) ?? []).length, 0)
    t('R2-01: ни одного вызова report без await', (code.match(/(?<!await )\breport\(/g) ?? []).length, 0)
  }

  /* 10h-B-04: при разошедшемся тождестве журнал хранит фактически прочитанное. */
  {
    const card = parseUpdateCard({ ...BASE, rows: [row(REC1, 'POI-000001')] })
    const f = fakeAirtable({ records: { [REC1]: { ...RECORDS[REC1], 'POI ID': 'POI-000099', [HOURS]: '10:00–20:00' } } })
    const journal = await journalFor(card)
    const series = await runUpdateSeries(withVerifiedUpdates(store(f), { journal, maxUpdates: 1 }), card)
    await journal.finish()
    t('10h-B-04: тождество разошлось — deferred, PATCH 0', `${series.outcomes[0].state}/${f.patches.length}`, 'deferred/0')
    const observations = (await readUpdateJournal(journal.file)).filter((e) => e.kind === 'intent' && e.step === 'observe')
    t('  наблюдение записано', observations.length, 1)
    t('  и несёт СВЕЖЕЕ значение, а не expectedOld карточки', observations[0].fields[HOURS], '10:00–20:00')
    t('  и свежее тождество', observations[0].poiId, 'POI-000099')
  }
  {
    /* Нет наблюдения (запись исчезла / чтение без полей) — deferred без строки в журнале. */
    const card = parseUpdateCard({ ...BASE, rows: [row(REC1, 'POI-000001')] })
    const noFields = fakeAirtable({ records: RECORDS })
    const noFieldsStore = { ...store(noFields), readFreshByRecordId: async () => ({ recordId: REC1, fields: 'мусор' }) }
    for (const [label, f, st] of [
      ['записи нет', fakeAirtable({ records: {} }), null],
      ['чтение без полей', noFields, noFieldsStore],
    ]) {
      const journal = await journalFor(card)
      const series = await runUpdateSeries(withVerifiedUpdates(st ?? store(f), { journal, maxUpdates: 1 }), card)
      await journal.finish()
      t(`10h-B-04 ${label}: deferred без PATCH`, `${series.outcomes[0].state}/${f.patches.length}`, 'deferred/0')
      has(`10h-B-04 ${label}: причина честная`, series.outcomes[0].reason, 'наблюдения нет')
      t(`10h-B-04 ${label}: в журнале нет выдуманного наблюдения`, (await readUpdateJournal(journal.file)).filter((e) => e.kind === 'intent').length, 0)
    }
  }
  {
    /* Ответ без `fields` — это запись с пустыми полями: наблюдение честное (null), тождество пустое → deferred. */
    const card = parseUpdateCard({ ...BASE, rows: [row(REC1, 'POI-000001')] })
    const f = fakeAirtable({ records: RECORDS, onRead: async () => ({ ok: true, status: 200, json: async () => ({ id: REC1 }) }) })
    const journal = await journalFor(card)
    const series = await runUpdateSeries(withVerifiedUpdates(store(f), { journal, maxUpdates: 1 }), card)
    await journal.finish()
    t('10h-B-04 ответ без полей: deferred по тождеству, PATCH 0', `${series.outcomes[0].state}/${f.patches.length}`, 'deferred/0')
    const obs = (await readUpdateJournal(journal.file)).find((e) => e.kind === 'intent' && e.step === 'observe')
    t('  наблюдение записано', obs?.kind, 'intent')
    t('  и несёт прочитанное отсутствие (null), а не значение карточки', obs ? JSON.stringify(obs.fields[HOURS]) : '(нет наблюдения)', 'null')
  }
  /* Структурно: в границе не осталось подстановки expectedOld под видом наблюдения. */
  const boundarySrc = await readFile(new URL('../scripts/poi-portals/lib/verified-update.mjs', import.meta.url), 'utf8')
  t('10h-B-04: граница не подставляет expectedOld как наблюдение', /observed \?\? \{ \.\.\.row\.expectedOld \}|fields: \{ \.\.\.row\.expectedOld \}/.test(boundarySrc), false)
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ проверяемое обновление POI (DAG 2.8): ${ok} проверок пройдено`)
}
