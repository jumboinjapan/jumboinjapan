#!/usr/bin/env node
/**
 * Журнал обновлений, карточка обновления и разрешение на серию (10h-B, DAG 2.8).
 *
 *   node tests/poi-update-journal.mjs
 *
 * Что здесь доказывается:
 *   • грамматика `poi-update-journal/v1` — одна у писателя и читателя; каждое
 *     правило отвергается ИМЕНОВАННО: повторное наблюдение, update без
 *     observe, `verified` без эффекта, `deferred` после объявленного эффекта,
 *     поле тождества в нагрузке, закрывающая строка, противоречащая попыткам;
 *   • механика дозаписи — общая с журналом создания: печать после отказа,
 *     оборванный хвост, пустая строка, байты после runFinished;
 *   • карточка: закрытая форма, сортировка и уникальность строк, prежнее
 *     значение для каждого поля, поля тождества не обновляются, строки без
 *     изменения не собираются; карточка восстановления — только по свежим
 *     наблюдениям и без применённого префикса;
 *   • разрешение: версия первой, закрытый состав, полный интервал, привязка к
 *     отпечатку карточки, список полей, потолок, одноразовость по отпечатку.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assertUpdateJournalGrammar, openUpdateJournal, readUpdateJournal, readUpdateJournalDetailed, summarizeUpdateJournal,
  UPDATE_JOURNAL_SPEC, UPDATE_LINE_KEYS, UPDATE_STATES, updateJournalGrammar,
} from '../scripts/poi-portals/lib/update-journal.mjs'
import { intentFieldsDigest, openWriteJournal, WRITE_JOURNAL_SPEC } from '../scripts/poi-portals/lib/write-journal.mjs'
import { buildUpdateCard, parseUpdateCard, recoveryCardFrom, UPDATE_CARD_SPEC, updateCardDigest } from '../scripts/poi-portals/lib/update-card.mjs'
import {
  assertUpdateApprovalApplies, claimUpdateApproval, parseUpdateApproval, readUpdateApprovalFile, UPDATE_APPROVAL_SPEC, updateApprovalDigest,
} from '../scripts/poi-portals/lib/update-approval.mjs'
import { journalSpecOf, reconcileUpdateJournal, runReconcileCli } from '../scripts/poi-portals/reconcile-writes.mjs'

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

const NOW = new Date('2026-09-08T10:00:00.000Z')
const REC1 = 'recAAAAAAAAAAAA01'
const REC2 = 'recBBBBBBBBBBBB02'
const REC3 = 'recCCCCCCCCCCCC03'
const V = 'liveRead'
const OBS = (recordId = REC1, fields = { 'Working Hours': '9:00–17:00' }, over = {}) => ({ recordId, verification: V, step: 'observe', fields, sourceKey: 'bodik:1', poiId: 'POI-000001', ...over })
const UPD = (recordId = REC1, fields = { 'Working Hours': '9:00–18:00' }, over = {}) => ({ recordId, verification: V, step: 'update', fields, sourceKey: 'bodik:1', poiId: 'POI-000001', ...over })
const OUT = (recordId = REC1, state = 'verified', over = {}) => ({ recordId, verification: V, state, reason: 'r', sourceKey: 'bodik:1', poiId: 'POI-000001', differing: [], ...over })
/* Каталог сюиты — после помощников: typescript-estree не разбирает объектную стрелку, за которой сразу идёт блок. */
const dir = await mkdtemp(path.join(tmpdir(), 'jj-update-journal-'))

/* ── 1. Полный цикл: observe → update → outcome → runFinished ─────────── */
{
  const j = await openUpdateJournal({ dir, runId: 'run-full', now: NOW, meta: { cardDigest: 'sha256:' + 'a'.repeat(64) } })
  await j.intent(OBS())
  await j.intent(UPD())
  await j.outcome(OUT())
  await j.intent(OBS(REC2))
  await j.outcome(OUT(REC2, 'deferred'))
  await j.intent(OBS(REC3, { 'Working Hours': '9:00–18:00' }))
  await j.outcome(OUT(REC3, 'noChange'))
  const closing = j.closing
  t('closing: попыток 3', closing.attempts, 3)
  t('closing: применено 1', closing.applied, 1)
  t('closing: failed — есть отложенная строка', closing.failed, true)
  await j.finish()
  const entries = await readUpdateJournal(j.file)
  t('строк 9', entries.length, 9)
  t('каждая строка помечена версией', entries.every((e) => e.spec === UPDATE_JOURNAL_SPEC), true)
  t('первая — runStarted с отпечатком карточки', entries[0].meta.cardDigest, 'sha256:' + 'a'.repeat(64))
  t('последняя — runFinished с выведенными числами', JSON.stringify([entries[8].attempts, entries[8].applied, entries[8].failed]), '[3,1,true]')
  const s = summarizeUpdateJournal(entries)
  t('сводка: состояния', JSON.stringify(s.byState), '{"verified":1,"deferred":1,"noChange":1}')
  t('сводка: applied', s.applied.join(','), REC1)
  t('сводка: pending (карточка восстановления)', s.pending.join(','), REC2)
  t('сводка: recoveryRequired пуст', s.recoveryRequired.length, 0)
  t('сводка: ожидаемые поля — нагрузка update', JSON.stringify(s.attempts[0].expectedFields), '{"Working Hours":"9:00–18:00"}')
  t('сводка: прежние поля — наблюдение', JSON.stringify(s.attempts[0].observedFields), '{"Working Hours":"9:00–17:00"}')
  t('сводка: meta доступна', s.meta.cardDigest, 'sha256:' + 'a'.repeat(64))
  t('журнал обновлений лежит в своём каталоге', j.file.includes(path.join('run-full', 'journal.ndjson')), true)
  has('журнал обновлений открывается только с отпечатком карточки', await boom(() => openUpdateJournal({ dir, runId: 'run-nocard', now: NOW })), 'meta.cardDigest')
  const writeJournal = await openWriteJournal({ dir, runId: 'run-write', now: NOW })
  has('журнал СОЗДАНИЯ этой версией не читается', await boom(() => readUpdateJournal(writeJournal.file)), 'не принадлежит журналу этой версии')
}

/* ── 2. Грамматика — каждое правило именованно ───────────────────────── */
{
  const base = (seq, kind, over = {}) => ({ spec: UPDATE_JOURNAL_SPEC, seq, at: NOW.toISOString(), runId: 'r', kind, ...over })
  const started = base(1, 'runStarted', { meta: {} })
  const withDigest = (line) => (line.kind === 'intent' && line.fieldsDigest === undefined ? { ...line, fieldsDigest: intentFieldsDigest(line.fields) } : line)
  const check = (label, lines, needle) => has(label, (() => { try { assertUpdateJournalGrammar(lines.map(withDigest)); return '(принято)' } catch (e) { return e.message } })(), needle)
  check('update без observe — отказ', [started, base(2, 'intent', UPD())], 'без предшествующего observe')
  check('повторное наблюдение без исхода — отказ', [started, base(2, 'intent', OBS()), base(3, 'intent', OBS())], 'повторное наблюдение')
  check('вторая попытка после исхода — отказ', [started, base(2, 'intent', OBS()), base(3, 'outcome', OUT(REC1, 'deferred')), base(4, 'intent', OBS())], 'вторая попытка в том же журнале запрещена')
  check('verified без эффекта — отказ', [started, base(2, 'intent', OBS()), base(3, 'outcome', OUT())], 'успех без эффекта — не успех')
  check('notApplied без эффекта — отказ', [started, base(2, 'intent', OBS()), base(3, 'outcome', OUT(REC1, 'notApplied'))], 'исход эффекта, которого не было')
  check('deferred ПОСЛЕ объявленного эффекта — отказ', [started, base(2, 'intent', OBS()), base(3, 'intent', UPD()), base(4, 'outcome', OUT(REC1, 'deferred'))], 'эффект мог состояться')
  check('noChange ПОСЛЕ объявленного эффекта — отказ', [started, base(2, 'intent', OBS()), base(3, 'intent', UPD()), base(4, 'outcome', OUT(REC1, 'noChange'))], 'эффект мог состояться')
  check('unknown без эффекта — допустим', [started, base(2, 'intent', OBS()), base(3, 'outcome', OUT(REC1, 'unknown'))], '(принято)')
  check('update трогает POI ID — отказ', [started, base(2, 'intent', OBS()), base(3, 'intent', UPD(REC1, { 'POI ID': 'POI-000009' }))], 'защищённые поля')
  check('update трогает координаты — отказ (P07)', [started, base(2, 'intent', OBS()), base(3, 'intent', UPD(REC1, { Latitude: 1 }))], 'защищённые поля')
  check('update трогает Source Key — отказ', [started, base(2, 'intent', OBS()), base(3, 'intent', UPD(REC1, { 'Source Key': 'x' }))], 'защищённые поля')
  check('второй update — отказ', [started, base(2, 'intent', OBS()), base(3, 'intent', UPD()), base(4, 'intent', UPD())], 'повторный update')
  check('verified без poiId — отказ', [started, base(2, 'intent', OBS()), base(3, 'intent', UPD()), base(4, 'outcome', OUT(REC1, 'verified', { poiId: null }))], 'verified обязан нести poiId')
  check('recordId не той формы — отказ', [started, base(2, 'intent', OBS('rec1'))], 'идентификатора записи допустимой формы')
  check('лишний ключ — отказ', [started, base(2, 'intent', { ...OBS(), extra: 1 })], 'закрытой схеме')
  check('состояние вне списка — отказ', [started, base(2, 'intent', OBS()), base(3, 'outcome', OUT(REC1, 'applied'))], 'вне закрытого списка')
  check('runFinished с чужими числами — отказ', [started, base(2, 'intent', OBS()), base(3, 'intent', UPD()), base(4, 'outcome', OUT()), base(5, 'runFinished', { attempts: 1, applied: 0, failed: false })], 'runFinished.applied 0 противоречит журналу')
  check('runFinished failed=false при deferred — отказ', [started, base(2, 'intent', OBS()), base(3, 'outcome', OUT(REC1, 'deferred')), base(4, 'runFinished', { attempts: 1, applied: 0, failed: false })], 'есть попытка без успешного исхода')
  check('runFinished не последней — отказ', [started, base(2, 'runFinished', { attempts: 0, applied: 0, failed: false }), base(3, 'intent', OBS())], 'только последней строкой')
  check('fieldsDigest не сходится — отказ', [started, { ...base(2, 'intent', OBS()), fieldsDigest: 'sha256:' + 'b'.repeat(64) }], 'fieldsDigest не совпадает')
  check('чужая версия — отказ', [{ ...started, spec: WRITE_JOURNAL_SPEC }], 'не принадлежит журналу этой версии')
  check('sourceKey не строка и не null — отказ', [started, base(2, 'intent', OBS(REC1, undefined, { sourceKey: 5 }))], 'непустая строка или null')
  t('состояний ровно шесть, успех — verified и noChange', UPDATE_STATES.join(','), 'verified,noChange,deferred,notApplied,mismatch,unknown')
  t('закрытая схема outcome содержит differing', UPDATE_LINE_KEYS.outcome.includes('differing'), true)
  /* Писатель — та же грамматика, ДО записи. */
  const j = await openUpdateJournal({ dir, runId: 'run-grammar-writer', now: NOW, meta: { cardDigest: 'sha256:' + 'c'.repeat(64) } })
  await j.intent(OBS())
  has('писатель: verified без update — отказ до записи', await boom(() => j.outcome(OUT())), 'успех без эффекта')
  has('писатель: update с полем тождества — отказ до записи', await boom(() => j.intent(UPD(REC1, { 'POI ID': 'x' }))), 'защищённые поля')
  t('  и ни одна отвергнутая строка не записана', j.entries, 2)
  await j.outcome(OUT(REC1, 'deferred'))
  await j.finish()
  t('  журнал читается', (await readUpdateJournal(j.file)).length, 4)
  const g = updateJournalGrammar('x')
  g.accept({ ...started })
  t('грамматика: closing без попыток', JSON.stringify(g.closing()), '{"attempts":0,"applied":0,"failed":false}')
}

/* ── 3. Общая механика дозаписи: печать, хвост, повреждения ──────────── */
{
  const j = await openUpdateJournal({ dir, runId: 'run-torn', now: NOW, meta: { cardDigest: 'sha256:' + 'd'.repeat(64) } })
  await j.intent(OBS())
  await writeFile(j.file, `${await readFile(j.file, 'utf8')}{"spec":"poi-update-journal/v1","seq":3,"kind":"outc`)
  const detailed = await readUpdateJournalDetailed(j.file)
  t('оборванный хвост назван и не входит в строки', detailed.entries.length, 2)
  t('  и его размер известен', detailed.tornTail?.bytes > 0, true)
  const j2 = await openUpdateJournal({ dir, runId: 'run-empty-line', now: NOW, meta: { cardDigest: 'sha256:' + 'e'.repeat(64) } })
  await writeFile(j2.file, `${await readFile(j2.file, 'utf8')}\n`)
  has('пустая физическая строка — повреждение', await boom(() => readUpdateJournal(j2.file)), 'пуста — журнал повреждён')
  const j3 = await openUpdateJournal({ dir, runId: 'run-after-finish', now: NOW, meta: { cardDigest: 'sha256:' + 'f'.repeat(64) } })
  await j3.finish()
  await writeFile(j3.file, `${await readFile(j3.file, 'utf8')}{"spec":"poi-update-journal/v1"`)
  has('байты после runFinished — повреждение', await boom(() => readUpdateJournal(j3.file)), 'после runFinished')
  has('занятое имя прогона — отказ, не дозапись', await boom(() => openUpdateJournal({ dir, runId: 'run-torn', now: NOW, meta: { cardDigest: 'sha256:' + 'd'.repeat(64) } })), 'уже существует')
  /* Печать после отказа записи — та же процедура ядра. */
  let opens = 0
  const io = { open: async (...args) => { opens += 1; if (opens === 3) throw new Error('диск отказал') ; return (await import('node:fs/promises')).open(...args) } }
  const j4 = await openUpdateJournal({ dir, runId: 'run-seal', now: NOW, meta: { cardDigest: 'sha256:' + '1'.repeat(64) }, io })
  await j4.intent(OBS())
  has('отказ записи — строка не записана', await boom(() => j4.intent(UPD())), 'не записана')
  t('  и журнал запечатан', j4.sealed?.kind, 'intent')
  has('  и следующая строка отказана печатью', await boom(() => j4.outcome(OUT(REC1, 'unknown'))), 'запечатан')
  t('  а сохранённый префикс читается', (await readUpdateJournal(j4.file)).length, 2)
}

/* ── 4. Карточка обновления ──────────────────────────────────────────── */
const ROW = (recordId, over = {}) => ({ recordId, poiId: 'POI-000001', sourceKey: 'bodik:1', expectedOld: { 'Working Hours': '9:00–17:00' }, proposed: { 'Working Hours': '9:00–18:00' }, ...over })
const CARD_BASE = { spec: UPDATE_CARD_SPEC, scopeId: 'poi-autoupdate-pilot-v1', portal: 'bodik-osaka-tourism', createdAt: NOW.toISOString(), recoveredFrom: null, note: 'часы' }
{
  const card = parseUpdateCard({ ...CARD_BASE, rows: [ROW(REC1), ROW(REC2)] })
  t('карточка разбирается и замораживается', Object.isFrozen(card) && Object.isFrozen(card.rows[0].proposed), true)
  t('отпечаток не зависит от порядка ключей', updateCardDigest(card), updateCardDigest({ rows: [ROW(REC1), ROW(REC2)], ...CARD_BASE }))
  has('строки не по порядку — отказ', await boom(() => parseUpdateCard({ ...CARD_BASE, rows: [ROW(REC2), ROW(REC1)] })), 'отсортированы по recordId')
  has('повтор recordId — отказ', await boom(() => parseUpdateCard({ ...CARD_BASE, rows: [ROW(REC1), ROW(REC1)] })), 'повтор recordId')
  has('без прежнего значения — отказ', await boom(() => parseUpdateCard({ ...CARD_BASE, rows: [ROW(REC1, { expectedOld: {} })] })), 'прежнее значение РОВНО каждого')
  has('прежнее равно предложенному — отказ', await boom(() => parseUpdateCard({ ...CARD_BASE, rows: [ROW(REC1, { expectedOld: { 'Working Hours': '9:00–18:00' } })] })), 'нечего применять')
  has('поле тождества — отказ', await boom(() => parseUpdateCard({ ...CARD_BASE, rows: [ROW(REC1, { expectedOld: { 'POI ID': 'a' }, proposed: { 'POI ID': 'b' } })] })), 'защищённое поле')
  has('координаты в карточке — отказ (P07)', await boom(() => parseUpdateCard({ ...CARD_BASE, rows: [ROW(REC1, { expectedOld: { Longitude: 1 }, proposed: { Longitude: 2 } })] })), 'защищённое поле')
  has('лишний ключ строки — отказ', await boom(() => parseUpdateCard({ ...CARD_BASE, rows: [{ ...ROW(REC1), extra: 1 }] })), 'лишние поля')
  has('чужой recordId — отказ', await boom(() => parseUpdateCard({ ...CARD_BASE, rows: [ROW('rec1')] })), 'не идентификатор записи')
  has('пустые строки — отказ', await boom(() => parseUpdateCard({ ...CARD_BASE, rows: [] })), 'непустой список')
  has('чужая версия — отказ', await boom(() => parseUpdateCard({ ...CARD_BASE, spec: 'poi-update-card/v0', rows: [ROW(REC1)] })), 'ожидается poi-update-card/v1')
  has('объект в значении поля — отказ', await boom(() => parseUpdateCard({ ...CARD_BASE, rows: [ROW(REC1, { proposed: { 'Working Hours': { a: 1 } } })] })), 'JSON-скаляром')
  has('recoveredFrom не отпечаток — отказ', await boom(() => parseUpdateCard({ ...CARD_BASE, recoveredFrom: 'x', rows: [ROW(REC1)] })), 'recoveredFrom')
  /* Сборка по наблюдениям. */
  const built = buildUpdateCard({
    ...CARD_BASE,
    observations: [
      { recordId: REC1, poiId: 'POI-000001', sourceKey: 'bodik:1', fields: { 'Working Hours': '9:00–17:00', 'Website': 'https://a' } },
      { recordId: REC2, poiId: 'POI-000002', sourceKey: 'bodik:2', fields: { 'Working Hours': '9:00–18:00' } },
      { recordId: REC3, poiId: 'POI-000003', sourceKey: 'bodik:3', fields: {} },
    ],
    proposals: [
      { recordId: REC2, proposed: { 'Working Hours': '9:00–18:00' } },
      { recordId: REC1, proposed: { 'Working Hours': '9:00–18:00', 'Website': 'https://a' } },
      { recordId: REC3, proposed: { 'Working Hours': '10:00–16:00' } },
    ],
  })
  t('сборка: строки без изменения не попадают', built.skipped.map((s) => s.recordId).join(','), REC2)
  t('сборка: карточка отсортирована', built.card.rows.map((r) => r.recordId).join(','), `${REC1},${REC3}`)
  t('сборка: только изменившиеся поля', JSON.stringify(built.card.rows[0].proposed), '{"Working Hours":"9:00–18:00"}')
  t('сборка: прежнее значение отсутствующего поля — null', built.card.rows[1].expectedOld['Working Hours'], null)
  t('сборка: тождество из наблюдения', built.card.rows[1].poiId, 'POI-000003')
  has('сборка: предложение без наблюдения — отказ', await boom(() => buildUpdateCard({ ...CARD_BASE, observations: [], proposals: [{ recordId: REC1, proposed: { a: 1 } }] })), 'без наблюдения')
  has('сборка: поле тождества — отказ', await boom(() => buildUpdateCard({ ...CARD_BASE, observations: [{ recordId: REC1, fields: {} }], proposals: [{ recordId: REC1, proposed: { 'POI ID': 'x' } }] })), 'защищённое поле')
  t('сборка: всё без изменений — карточки нет', buildUpdateCard({ ...CARD_BASE, observations: [{ recordId: REC1, fields: { a: 1 } }], proposals: [{ recordId: REC1, proposed: { a: 1 } }] }).card, null)
  /* Карточка восстановления — по свежим наблюдениям, без применённого префикса. */
  const rec = recoveryCardFrom(built.card, {
    applied: [REC1],
    observations: [{ recordId: REC3, poiId: 'POI-000003', sourceKey: 'bodik:3', fields: { 'Working Hours': '9:00–12:00' } }],
    createdAt: '2026-09-08T11:00:00.000Z', note: 'восстановление',
  })
  t('восстановление: применённая строка не входит', rec.card.rows.map((r) => r.recordId).join(','), REC3)
  t('восстановление: прежнее значение — СВЕЖЕЕ, не из исходной карточки', rec.card.rows[0].expectedOld['Working Hours'], '9:00–12:00')
  t('восстановление: отпечаток исходной карточки записан', rec.card.recoveredFrom, updateCardDigest(built.card))
  t('восстановление: свежее уже равно предложенному — выпадает как noChange', recoveryCardFrom(built.card, { applied: [REC1], observations: [{ recordId: REC3, fields: { 'Working Hours': '10:00–16:00' } }], createdAt: NOW.toISOString(), note: 'n' }).card, null)
  t('восстановление: всё применено — карточки нет', recoveryCardFrom(built.card, { applied: [REC1, REC3], observations: [], createdAt: NOW.toISOString(), note: 'n' }).card, null)
  has('восстановление без свежих наблюдений — отказ', await boom(() => recoveryCardFrom(built.card, { applied: [], createdAt: NOW.toISOString(), note: 'n' })), 'только по свежим наблюдениям')
}

/* ── 5. Разрешение на серию обновлений ───────────────────────────────── */
{
  const card = parseUpdateCard({ ...CARD_BASE, rows: [ROW(REC1), ROW(REC2)] })
  const digest = updateCardDigest(card)
  const APPROVAL = { spec: UPDATE_APPROVAL_SPEC, scopeId: 'poi-autoupdate-pilot-v1', portal: 'bodik-osaka-tourism', issuedAt: '2026-09-08T09:00:00.000Z', expiresAt: '2026-09-09T09:00:00.000Z', cardDigest: digest, fields: ['Working Hours'], maxUpdates: 2, note: 'часы, две записи' }
  const approval = parseUpdateApproval(APPROVAL)
  t('разрешение разбирается', approval.maxUpdates, 2)
  const reason = async (fn) => { try { await fn(); return '(без отказа)' } catch (e) { return e.reason ?? e.message } }
  t('чужая версия — updateApprovalVersion', await reason(() => parseUpdateApproval({ ...APPROVAL, spec: 'poi-write-approval/v2' })), 'updateApprovalVersion')
  t('лишнее поле — updateApprovalShape', await reason(() => parseUpdateApproval({ ...APPROVAL, extra: 1 })), 'updateApprovalShape')
  t('поле тождества в списке — updateApprovalShape', await reason(() => parseUpdateApproval({ ...APPROVAL, fields: ['POI ID'] })), 'updateApprovalShape')
  t('координатное поле в списке — updateApprovalShape (P07)', await reason(() => parseUpdateApproval({ ...APPROVAL, fields: ['Coordinate Policy'] })), 'updateApprovalShape')
  t('несортированный список полей — updateApprovalShape', await reason(() => parseUpdateApproval({ ...APPROVAL, fields: ['b', 'a'] })), 'updateApprovalShape')
  t('maxUpdates 0 — updateApprovalShape', await reason(() => parseUpdateApproval({ ...APPROVAL, maxUpdates: 0 })), 'updateApprovalShape')
  const applies = (over = {}) => reason(() => assertUpdateApprovalApplies({ approval, now: NOW, scopeId: 'poi-autoupdate-pilot-v1', portal: 'bodik-osaka-tourism', card, cardDigest: digest, ...over }))
  t('применимо', await applies(), '(без отказа)')
  t('другая карточка — updateApprovalCardDrift', await applies({ cardDigest: 'sha256:' + '9'.repeat(64) }), 'updateApprovalCardDrift')
  t('другая область — updateApprovalScope', await applies({ scopeId: 'poi-parser-v1' }), 'updateApprovalScope')
  t('другой портал — updateApprovalPortal', await applies({ portal: 'japan-guide' }), 'updateApprovalPortal')
  t('до выдачи — updateApprovalNotYetValid', await applies({ now: new Date('2026-09-08T08:59:59.000Z') }), 'updateApprovalNotYetValid')
  t('после срока — updateApprovalExpired', await applies({ now: new Date('2026-09-09T09:00:00.000Z') }), 'updateApprovalExpired')
  /* Разрешение выдаётся на РЕАЛЬНО проверяемую карточку (10h-B R1, находка 02):
     отпечаток считается с самой карточки, заявление вызывающего не заменяет его. */
  const wideCard = parseUpdateCard({ ...CARD_BASE, rows: [ROW(REC1, { expectedOld: { 'Working Hours': 'a', 'Website': 'x' }, proposed: { 'Working Hours': 'b', 'Website': 'y' } })] })
  const forCard = (c, over = {}) => parseUpdateApproval({ ...APPROVAL, cardDigest: updateCardDigest(c), ...over })
  t('поле вне списка — updateApprovalFields', await reason(() => assertUpdateApprovalApplies({ approval: forCard(wideCard), now: NOW, scopeId: 'poi-autoupdate-pilot-v1', portal: 'bodik-osaka-tourism', card: wideCard })), 'updateApprovalFields')
  const bigCard = parseUpdateCard({ ...CARD_BASE, rows: [ROW(REC1), ROW(REC2), ROW(REC3)] })
  t('строк больше потолка — updateApprovalCeiling', await reason(() => assertUpdateApprovalApplies({ approval: forCard(bigCard), now: NOW, scopeId: 'poi-autoupdate-pilot-v1', portal: 'bodik-osaka-tourism', card: bigCard })), 'updateApprovalCeiling')
  /* 10h-B-02: чужая карточка с заявленным отпечатком разрешённой — дрейф. */
  const otherCard = parseUpdateCard({ ...CARD_BASE, rows: [ROW(REC3)] })
  t('другая карточка + заявленный отпечаток разрешённой — updateApprovalCardDrift', await reason(() => assertUpdateApprovalApplies({ approval, now: NOW, scopeId: 'poi-autoupdate-pilot-v1', portal: 'bodik-osaka-tourism', card: otherCard, cardDigest: digest })), 'updateApprovalCardDrift')
  t('другая карточка без заявления — updateApprovalCardDrift', await reason(() => assertUpdateApprovalApplies({ approval, now: NOW, scopeId: 'poi-autoupdate-pilot-v1', portal: 'bodik-osaka-tourism', card: otherCard })), 'updateApprovalCardDrift')
  t('своя карточка с ложным заявлением — updateApprovalCardDrift', await reason(() => assertUpdateApprovalApplies({ approval, now: NOW, scopeId: 'poi-autoupdate-pilot-v1', portal: 'bodik-osaka-tourism', card, cardDigest: 'sha256:' + '7'.repeat(64) })), 'updateApprovalCardDrift')
  t('своя карточка без заявления — применимо', await reason(() => assertUpdateApprovalApplies({ approval, now: NOW, scopeId: 'poi-autoupdate-pilot-v1', portal: 'bodik-osaka-tourism', card })), '(без отказа)')
  /* Одноразовость по отпечатку. */
  const root = path.join(dir, 'repo')
  const claimed = await claimUpdateApproval(root, approval, { runId: 'run-1' })
  t('отметка исполнения создана по отпечатку', claimed.identity, updateApprovalDigest(approval))
  t('повтор — updateApprovalAlreadyUsed', await reason(() => claimUpdateApproval(root, approval, { runId: 'run-2' })), 'updateApprovalAlreadyUsed')
  t('копия с другим порядком ключей — тот же отпечаток, тот же отказ', await reason(() => claimUpdateApproval(root, parseUpdateApproval({ note: APPROVAL.note, ...APPROVAL }), { runId: 'run-3' })), 'updateApprovalAlreadyUsed')
  /* Чтение по имени в каноническом каталоге. */
  const approvalsDir = path.join(root, 'tmp', 'poi-update-approvals')
  await (await import('node:fs/promises')).mkdir(approvalsDir, { recursive: true })
  await writeFile(path.join(approvalsDir, 'hours-1.json'), JSON.stringify(APPROVAL))
  const readBack = await readUpdateApprovalFile(root, 'hours-1')
  t('файл разрешения читается по имени', readBack.digest, updateApprovalDigest(approval))
  t('путь вместо имени — updateApprovalShape', await reason(() => readUpdateApprovalFile(root, '../hours-1')), 'updateApprovalShape')
  t('нет файла — updateApprovalMissing', await reason(() => readUpdateApprovalFile(root, 'нет-такого')), 'updateApprovalMissing')
}

/* ── 6. Сверка журнала обновлений и выбор версии в CLI ───────────────── */
{
  const j = await openUpdateJournal({ dir, runId: 'run-reconcile', now: NOW, meta: { cardDigest: 'sha256:' + '2'.repeat(64) } })
  await j.intent(OBS())
  await j.intent(UPD())
  /* исход не записан — главный аварийный случай */
  await j.intent(OBS(REC2))
  /* наблюдение без update — эффекта не было */
  t('версия журнала по первой строке', await journalSpecOf(j.file), UPDATE_JOURNAL_SPEC)
  const dry = await reconcileUpdateJournal(j.file)
  t('сверка без чтения: intent-only с update — unknown', dry.attempts.find((a) => a.recordId === REC1).state, 'unknown')
  t('сверка без чтения: observe без update — deferred (эффекта не было)', dry.attempts.find((a) => a.recordId === REC2).state, 'deferred')
  t('сверка без чтения: notChecked', dry.resolved[0].resolution, 'notChecked')
  t('сверка ничего не пишет', dry.wrote, false)
  t('сверка знает карточку', dry.cardDigest, 'sha256:' + '2'.repeat(64))
  const live = await reconcileUpdateJournal(j.file, { readByRecordId: async (id) => ({ recordId: id, fields: { 'POI ID': 'POI-000001', 'Source Key': 'bodik:1', 'Working Hours': '9:00–18:00' } }) })
  t('сверка с чтением: применено — verified', live.resolved[0].resolution, 'verified')
  const old = await reconcileUpdateJournal(j.file, { readByRecordId: async (id) => ({ recordId: id, fields: { 'Working Hours': '9:00–17:00' } }) })
  t('сверка с чтением: прежнее значение — notApplied', old.resolved[0].resolution, 'notApplied')
  const alien = await reconcileUpdateJournal(j.file, { readByRecordId: async (id) => ({ recordId: id, fields: { 'Working Hours': '10:00–20:00' } }) })
  t('сверка с чтением: чужое значение — mismatch', alien.resolved[0].resolution, 'mismatch')
  const gone = await reconcileUpdateJournal(j.file, { readByRecordId: async () => null })
  t('сверка с чтением: записи нет — mismatch', gone.resolved[0].resolution, 'mismatch')
  const wrongId = await reconcileUpdateJournal(j.file, { readByRecordId: async () => ({ recordId: REC3, fields: { 'Working Hours': '9:00–18:00' } }) })
  t('сверка с чтением: чужой id — unknown (фильтру не верим)', wrongId.resolved[0].resolution, 'unknown')
  const failing = await reconcileUpdateJournal(j.file, { readByRecordId: async () => { throw new Error('сеть') } })
  t('сверка с чтением: отказ чтения — unknown', failing.resolved[0].resolution, 'unknown')
  /* CLI выбирает читателя по версии. */
  const logs = []
  const target = { exitCode: 0 }
  const origLog = console.log
  console.log = (line) => logs.push(line)
  try {
    await runReconcileCli(['node', 'x', j.file], {}, target)
  } finally { console.log = origLog }
  const printed = JSON.parse(logs.join('\n'))
  t('CLI без --resolve: отчёт версии обновлений', printed.spec, 'poi-update-reconcile/v1')
  t('CLI без --resolve: неустановленный исход — код 1', target.exitCode, 1)
  const target2 = { exitCode: 0 }
  console.log = () => {}
  try {
    await runReconcileCli(['node', 'x', j.file, '--resolve'], { readByRecordId: async (id) => ({ recordId: id, fields: { 'POI ID': 'POI-000001', 'Working Hours': '9:00–18:00' } }) }, target2)
  } finally { console.log = origLog }
  t('CLI --resolve с чтением: verified — код 0', target2.exitCode, 0)
  const target3 = { exitCode: 0 }
  const errs = []
  const origErr = console.error
  console.error = (line) => errs.push(String(line))
  const savedToken = process.env.AIRTABLE_TOKEN
  delete process.env.AIRTABLE_TOKEN
  try {
    await runReconcileCli(['node', 'x', j.file, '--resolve'], {}, target3)
  } finally { console.error = origErr; if (savedToken !== undefined) process.env.AIRTABLE_TOKEN = savedToken }
  t('CLI --resolve без токена — отказ с именем', target3.exitCode, 1)
  has('  и причина названа', errs.join('\n'), 'AIRTABLE_TOKEN')
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ журнал обновлений, карточка и разрешение (DAG 2.8): ${ok} проверок пройдено`)
}
