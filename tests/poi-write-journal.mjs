#!/usr/bin/env node
/**
 * Журнал эффектов записи и поздняя сверка — чистый контракт (10f-R, P09.2).
 *
 *   node tests/poi-write-journal.mjs
 *
 * Предмет: доказательство намерения и исхода переживает прогон, читается
 * обратно СТРОГО (грамматика последовательности и формы), устойчиво до эффекта
 * (fsync), несёт ожидаемые значения, а поздняя сверка устанавливает состояние
 * ЧТЕНИЕМ и ничего не повторяет, не откатывает и не удаляет. Производственная
 * композиция (main → граница записи → журнал) — tests/poi-verified-write.mjs.
 *
 * R1 (05.09.2026) закрывает три находки аудита: intent без значений, читатель
 * fail-open, отсутствие fsync. R2 (05.09.2026): полный ожидаемый итог
 * (шаги prepare → create → rename*, поля хранилища), закрытые схемы строк,
 * календарно строгий момент, синхронизация каталогов при создании журнала.
 * R3 (05.09.2026): семантическая грамматика (одна попытка на ключ, verified
 * только после эффекта, закрывающая строка выводится), постинвариант
 * уникальности номера и тождество из базы при сверке, полная цепочка
 * долговечности при первом запуске.
 */
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as journalModule from '../scripts/poi-portals/lib/write-journal.mjs'
import {
  assertWriteJournalGrammar, intentFieldsDigest, isCanonicalInstant, LINE_KEYS, openWriteJournal, readWriteJournal, RECOVERY_STATES,
  summarizeWriteJournal, VERIFICATION_KINDS, WRITE_JOURNAL_FILE, WRITE_JOURNAL_SPEC, WRITE_STATES,
} from '../scripts/poi-portals/lib/write-journal.mjs'
import { reconcileWriteJournal, parseReconcileArgs, runReconcileCli } from '../scripts/poi-portals/reconcile-writes.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${String(text).slice(0, 220)}» нет «${needle}»`)
}
const boom = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e instanceof Error ? e.message : String(e) } }
/* Крах сюиты — не «мутация не убита»: накопленные поимённые провалы печатаются
   и здесь, а сам обрыв назван. Код возврата ненулевой. */
process.on('uncaughtException', (e) => {
  bad.push(`сюита оборвана необработанной ошибкой: ${e instanceof Error ? e.message : String(e)}`)
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exit(1)
})

const dir = await mkdtemp(path.join(tmpdir(), 'jj-write-journal-'))
const NOW = new Date('2026-09-05T00:00:00.000Z')
const open = (runId, over = {}) => openWriteJournal({ dir, runId, now: NOW, ...over })
const FIELDS = { 'Source Key': 'p:1', 'POI Name (RU)': 'Замок Осака', Latitude: 34.6873 }
/* Момент — 3 марта: у него есть невозможный двойник по Date.parse, 31 февраля (R5). */
const PAYLOAD = { ...FIELDS, 'POI ID': 'POI-000001', 'Last Seeded At': '2026-03-03T12:00:00.000Z' }
const INTENT = (sourceKey = 'p:1', fields = FIELDS) => ({ sourceKey, verification: 'liveRead', step: 'prepare', fields })
const CREATE = (sourceKey = 'p:1', fields = PAYLOAD) => ({ sourceKey, verification: 'liveRead', step: 'create', fields })
const RENAME = (sourceKey = 'p:1', to = 'POI-000002') => ({ sourceKey, verification: 'liveRead', step: 'rename', fields: { 'POI ID': to }, recordId: 'rec1', from: 'POI-000001' })
const OUTCOME = (sourceKey, state, over = {}) => ({ sourceKey, state, reason: 'проба', verification: 'liveRead', recordId: null, poiId: null, ...over })
const quiet = async (fn) => {
  const realLog = console.log; const realErr = console.error
  const out = []
  console.log = (v) => out.push(String(v)); console.error = (v) => out.push(String(v))
  try { return { value: await fn(), out: out.join('\n') } } finally { console.log = realLog; console.error = realErr }
}

/* ── 1. Форма и дозапись ───────────────────────────────────────────────── */
{
  has('журнал открывается, первая строка подтверждена ровно один раз', await boom(() => open('run-0')), '(без ошибки)')
  const journal = await open('run-1')
  t('файл журнала — внутри каталога прогона', path.basename(journal.file), WRITE_JOURNAL_FILE)
  t('открытие уже записало строку', journal.entries, 1)
  await journal.intent(INTENT())
  await journal.intent(CREATE())
  await journal.outcome(OUTCOME('p:1', 'verified', { recordId: 'rec1', poiId: 'POI-000001' }))
  await journal.finish()
  const entries = await readWriteJournal(journal.file)
  t('прочитано столько же строк, сколько записано', entries.length, 5)
  t('роды строк в порядке записи', entries.map((e) => `${e.kind}${e.step ? `:${e.step}` : ''}`).join(','), 'runStarted,intent:prepare,intent:create,outcome,runFinished')
  t('порядковые номера сплошные', entries.map((e) => e.seq).join(','), '1,2,3,4,5')
  t('каждая строка — ровно закрытая схема своего рода', entries.every((e) => Object.keys(e).sort().join() === [...LINE_KEYS[e.kind]].sort().join()), true)
  t('каждая строка помечена версией', entries.every((e) => e.spec === WRITE_JOURNAL_SPEC), true)
  t('намерение раньше исхода', entries.findIndex((e) => e.kind === 'intent') < entries.findIndex((e) => e.kind === 'outcome'), true)
  /* R1: намерение несёт ожидаемые значения, а не только имена полей. */
  t('prepare несёт входные поля целиком', JSON.stringify(entries[1].fields), JSON.stringify(FIELDS))
  t('create несёт полную нагрузку — с полями хранилища', JSON.stringify(entries[2].fields), JSON.stringify(PAYLOAD))
  t('и их канонический digest', entries[2].fieldsDigest, intentFieldsDigest(PAYLOAD))
  t('digest не зависит от порядка ключей', intentFieldsDigest({ Latitude: 34.6873, 'POI Name (RU)': 'Замок Осака', 'Source Key': 'p:1' }), intentFieldsDigest(FIELDS))
  t('и меняется от значения', intentFieldsDigest({ ...FIELDS, Latitude: 34.7 }) === intentFieldsDigest(FIELDS), false)
  has('после закрытия дозапись отказана', await boom(() => journal.intent(INTENT('p:2'))), 'уже закрыт')
  const bytes = await readFile(journal.file, 'utf8')
  has('журнал того же прогона уже есть — отказ',
    await boom(() => openWriteJournal({ dir, runId: 'run-1', now: NOW })), 'уже существует')
  t('и чужой журнал не тронут', await readFile(journal.file, 'utf8'), bytes)
}

/* ── 2. Отказы формы — по имени, а не догадкой ─────────────────────────── */
{
  has('пустой runId — отказ', await boom(() => openWriteJournal({ dir, runId: '', now: NOW })), 'runId обязателен')
  has('runId с путём — отказ: журнал адресуется путём',
    await boom(() => openWriteJournal({ dir, runId: '../побег', now: NOW })), 'недопустимые символы')
  const journal = await open('run-2')
  has('намерение без полей — отказ', await boom(() => journal.intent({ sourceKey: 'p:1', verification: 'liveRead', step: 'prepare' })), 'ожидаемые поля записи целиком')
  has('намерение с пустыми полями — отказ', await boom(() => journal.intent({ sourceKey: 'p:1', verification: 'liveRead', step: 'prepare', fields: {} })), 'ожидаемые поля')
  has('намерение без шага — отказ', await boom(() => journal.intent({ sourceKey: 'p:1', verification: 'liveRead', fields: FIELDS })), 'intent.step')
  has('намерение с чужим способом проверки — отказ', await boom(() => journal.intent({ ...INTENT(), verification: 'trusted-cache' })), 'intent.verification')
  has('исход с чужим способом проверки — отказ', await boom(() => journal.outcome({ ...OUTCOME('p:1', 'verified'), verification: 'trusted-cache' })), 'outcome.verification')
  t('способ проверки — закрытый список из одного значения', VERIFICATION_KINDS.join(','), 'liveRead')
  has('чужой digest в намерении — отказ', await boom(() => journal.intent({ ...INTENT(), fieldsDigest: 'sha256:' + '0'.repeat(64) })), 'fieldsDigest не совпадает')
  has('неизвестное состояние исхода — отказ',
    await boom(() => journal.outcome({ sourceKey: 'p:1', state: 'ok' })), 'ожидается один из')
  has('  и назван закрытый список', await boom(() => journal.outcome({ sourceKey: 'p:1', state: 'ok' })), WRITE_STATES.join(', '))
  t('успех в списке ровно один', WRITE_STATES.filter((s) => s === 'verified').length, 1)
  t('состояния восстановления — закрытый список', RECOVERY_STATES.join(','), 'ambiguous,mismatch,unknown')
}

/* ── 3. Читатель fail-closed: грамматика последовательности и формы ──────
   Находка аудита 3: журнал из одной строки `outcome verified` с `seq: 999`,
   без `runStarted`, `intent` и `runFinished`, принимался сверкой с кодом 0. */
{
  const write = async (name, lines) => { const f = path.join(dir, name); await writeFile(f, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n'); return f }
  const base = (seq, kind) => ({ spec: WRITE_JOURNAL_SPEC, seq, at: NOW.toISOString(), runId: 'r', kind })
  const line = (seq, kind, over = {}) => {
    const defaults = { runStarted: { meta: {} }, runFinished: { attempts: 0, failed: false } }[kind] ?? {}
    return { ...base(seq, kind), ...defaults, ...over }
  }
  const intent = (seq, sourceKey = 'p:1', over = {}) => ({ ...base(seq, 'intent'), sourceKey, verification: 'liveRead', step: 'prepare', fields: FIELDS, fieldsDigest: intentFieldsDigest(FIELDS), recordId: null, from: null, ...over })
  const create = (seq, sourceKey = 'p:1', over = {}) => intent(seq, sourceKey, { step: 'create', fields: PAYLOAD, fieldsDigest: intentFieldsDigest(PAYLOAD), ...over })
  const rename = (seq, sourceKey = 'p:1', over = {}) => intent(seq, sourceKey, { step: 'rename', fields: { 'POI ID': 'POI-000002' }, fieldsDigest: intentFieldsDigest({ 'POI ID': 'POI-000002' }), recordId: 'rec1', from: 'POI-000001', ...over })
  const outcome = (seq, sourceKey = 'p:1', state = 'verified', over = {}) => ({ ...base(seq, 'outcome'), sourceKey, state, verification: 'liveRead', reason: 'проба', recordId: state === 'verified' ? 'rec1' : null, poiId: state === 'verified' ? 'POI-000001' : null, differing: [], ...over })
  const fin = (seq, attempts, failed) => line(seq, 'runFinished', { attempts, failed })

  has('битая строка — отказ с номером', await boom(async () => readWriteJournal(await write('broken.ndjson', [line(1, 'runStarted'), 'это не json']))), 'строка 2 не разбирается')
  has('чужая версия — отказ', await boom(async () => readWriteJournal(await write('alien.ndjson', [{ spec: 'чужой/v1', kind: 'runStarted', seq: 1 }]))), 'не принадлежит журналу этой версии')
  has('неизвестный род строки — отказ', await boom(async () => readWriteJournal(await write('kind.ndjson', [line(1, 'runStarted'), { ...base(2, 'выдумка') }]))), 'неизвестный род')
  /* R6: пустой ФАЙЛ — пустой журнал; файл из одного перевода строки — уже
     повреждение: в нём есть пустая физическая строка. */
  has('пустой файл — отказ «журнал пуст»', await boom(async () => { await writeFile(path.join(dir, 'empty.ndjson'), ''); return readWriteJournal(path.join(dir, 'empty.ndjson')) }), 'журнал пуст')
  has('файл из одного перевода строки — отказ по физической грамматике', await boom(async () => readWriteJournal(await write('empty.ndjson', []))), 'строка 1 пуста')

  /* Контрпример аудита дословно. */
  const forged = await write('forged.ndjson', [{ spec: WRITE_JOURNAL_SPEC, seq: 999, kind: 'outcome', sourceKey: 'p:1', state: 'verified' }])
  has('одинокий outcome/verified с seq 999 — отказ (R2: сначала закрытая схема)', await boom(() => readWriteJournal(forged)), 'не соответствует закрытой схеме')
  has('  тот же контрпример в полной закрытой форме — отказ по нумерации', await boom(async () => readWriteJournal(await write('forged2.ndjson', [outcome(999)]))), 'нарушает сплошную нумерацию')
  has('  и с seq 1 — отказ: не runStarted', await boom(async () => readWriteJournal(await write('forged3.ndjson', [outcome(1)]))), 'обязан начинаться с runStarted')
  const forgedCli = { exitCode: 0 }
  await quiet(() => runReconcileCli(['n', 'r', forged], {}, forgedCli))
  t('  и сверка по нему завершается ненулевым кодом', forgedCli.exitCode, 1)

  has('журнал не с runStarted — отказ', await boom(async () => readWriteJournal(await write('g1.ndjson', [intent(1)]))), 'обязан начинаться с runStarted')
  has('второй runStarted — отказ', await boom(async () => readWriteJournal(await write('g2.ndjson', [line(1, 'runStarted'), line(2, 'runStarted')]))), 'только первой строкой')
  has('дыра в seq — отказ', await boom(async () => readWriteJournal(await write('g3.ndjson', [line(1, 'runStarted'), intent(3)]))), 'сплошную нумерацию')
  has('повтор seq — отказ', await boom(async () => readWriteJournal(await write('g4.ndjson', [line(1, 'runStarted'), intent(1)]))), 'сплошную нумерацию')
  has('чужой runId посреди файла — отказ', await boom(async () => readWriteJournal(await write('g5.ndjson', [line(1, 'runStarted'), { ...intent(2), runId: 'другой' }]))), 'runId')
  has('неканонический момент — отказ', await boom(async () => readWriteJournal(await write('g6.ndjson', [{ ...line(1, 'runStarted'), at: '2026-09-05' }]))), 'канонический момент')
  has('outcome без предшествующего intent — отказ', await boom(async () => readWriteJournal(await write('g7.ndjson', [line(1, 'runStarted'), outcome(2)]))), 'без предшествующего intent')
  has('outcome с состоянием вне списка — отказ', await boom(async () => readWriteJournal(await write('g8.ndjson', [line(1, 'runStarted'), intent(2), outcome(3, 'p:1', 'ok')]))), 'вне закрытого списка')
  has('второе намерение без исхода первого — отказ', await boom(async () => readWriteJournal(await write('g9.ndjson', [line(1, 'runStarted'), intent(2), intent(3)]))), 'повторное намерение')
  has('intent без ключа fields — отказ по закрытой схеме', await boom(async () => readWriteJournal(await write('g10.ndjson', [line(1, 'runStarted'), line(2, 'intent', { sourceKey: 'p:1', verification: 'liveRead' })]))), 'закрытой схеме')
  has('intent с пустыми полями (digest верный) — отказ', await boom(async () => readWriteJournal(await write('g10b.ndjson', [line(1, 'runStarted'), intent(2, 'p:1', { fields: {}, fieldsDigest: intentFieldsDigest({}) })]))), 'без ожидаемых полей')
  has('intent с подменёнными полями (digest не сходится) — отказ', await boom(async () => readWriteJournal(await write('g11.ndjson', [line(1, 'runStarted'), { ...intent(2), fields: { ...FIELDS, Latitude: 0 } }]))), 'fieldsDigest не совпадает')
  has('runFinished не последней строкой — отказ', await boom(async () => readWriteJournal(await write('g12.ndjson', [line(1, 'runStarted'), line(2, 'runFinished'), intent(3)]))), 'только последней строкой')
  has('intent без способа проверки — отказ', await boom(async () => readWriteJournal(await write('g13.ndjson', [line(1, 'runStarted'), { ...intent(2), verification: '' }]))), 'вне закрытого списка')

  /* R2 (находка аудита 2): закрытые схемы, закрытый способ, строгий момент. */
  const weirdAt = '2026-02-31T25:61:61.999Z'
  has('verification: trusted-cache при верной последовательности — отказ',
    await boom(async () => readWriteJournal(await write('r2a.ndjson', [line(1, 'runStarted'), intent(2, 'p:1', { verification: 'trusted-cache' }), create(3), outcome(4)]))), 'вне закрытого списка (liveRead)')
  has('невозможный момент 2026-02-31T25:61:61.999Z — отказ',
    await boom(async () => readWriteJournal(await write('r2b.ndjson', [{ ...line(1, 'runStarted'), at: weirdAt }]))), 'не календарно строгий')
  t('isCanonicalInstant отвергает 31 февраля', isCanonicalInstant('2026-02-31T00:00:00.000Z'), false)
  t('isCanonicalInstant отвергает 25:61:61', isCanonicalInstant(weirdAt), false)
  t('isCanonicalInstant принимает настоящий момент', isCanonicalInstant('2026-09-05T00:00:00.000Z'), true)
  has('лишний ключ в строке — отказ по закрытой схеме',
    await boom(async () => readWriteJournal(await write('r2c.ndjson', [{ ...line(1, 'runStarted'), extra: 1 }]))), 'закрытой схеме')
  has('недостающий ключ в строке — отказ по закрытой схеме',
    await boom(async () => readWriteJournal(await write('r2d.ndjson', [line(1, 'runStarted'), (() => { const i = intent(2); delete i.from; return i })()]))), 'закрытой схеме')
  has('способ проверки исхода отличается от намерения — отказ',
    await boom(async () => readWriteJournal(await write('r2e.ndjson', [line(1, 'runStarted'), intent(2), create(3), outcome(4, 'p:1', 'verified', { verification: 'liveRead ' })]))), 'вне закрытого списка')
  has('rename без create — отказ',
    await boom(async () => readWriteJournal(await write('r2f.ndjson', [line(1, 'runStarted'), intent(2), rename(3)]))), 'без предшествующего create')
  has('create без prepare — отказ',
    await boom(async () => readWriteJournal(await write('r2g.ndjson', [line(1, 'runStarted'), create(2)]))), 'без предшествующего prepare')
  has('create без POI ID в нагрузке — отказ',
    await boom(async () => readWriteJournal(await write('r2h.ndjson', [line(1, 'runStarted'), intent(2), create(3, 'p:1', { fields: FIELDS, fieldsDigest: intentFieldsDigest(FIELDS) })]))), 'обязан нести POI ID')
  has('rename с двумя полями — отказ',
    await boom(async () => readWriteJournal(await write('r2i.ndjson', [line(1, 'runStarted'), intent(2), create(3), rename(4, 'p:1', { fields: { 'POI ID': 'x', y: 1 }, fieldsDigest: intentFieldsDigest({ 'POI ID': 'x', y: 1 }) })]))), 'ровно одно поле')
  has('runFinished с небулевым failed — отказ',
    await boom(async () => readWriteJournal(await write('r2j.ndjson', [line(1, 'runStarted'), line(2, 'runFinished', { failed: 'нет' })]))), 'failed — булево')
  /* R3 (находка аудита 3): семантически невозможные журналы. Контрпримеры
     аудита дословно — на байтах R2 все три принимались
     (`tmp/10f-r-r3-repro-OLD-2026-09-05.log`). */
  has('verified после одного prepare без create — отказ',
    await boom(async () => readWriteJournal(await write('r3a.ndjson', [line(1, 'runStarted'), intent(2), outcome(3), fin(4, 1, false)]))), 'без объявленного эффекта')
  has('verified без recordId/poiId из базы — отказ',
    await boom(async () => readWriteJournal(await write('r3a2.ndjson', [line(1, 'runStarted'), intent(2), create(3), outcome(4, 'p:1', 'verified', { recordId: null })]))), 'обязан нести recordId и poiId из базы')
  has('две завершённые попытки одного ключа — отказ',
    await boom(async () => readWriteJournal(await write('r3b.ndjson', [line(1, 'runStarted'), intent(2), create(3), outcome(4, 'p:1', 'mismatch'), intent(5), create(6), outcome(7), fin(8, 2, false)]))), 'повторная попытка для p:1')
  has('  и сводка по строкам со вторым исходом одного ключа (мимо читателя) отказывает',
    await boom(async () => summarizeWriteJournal([line(1, 'runStarted'), intent(2), create(3), outcome(4, 'p:1', 'mismatch'), outcome(5)])), 'второй исход для p:1')
  has('  и сводка по таким строкам (мимо читателя) отказывает, а не скрывает первую',
    await boom(async () => summarizeWriteJournal([line(1, 'runStarted'), intent(2), create(3), outcome(4, 'p:1', 'mismatch'), intent(5), create(6), outcome(7)])), 'повторная попытка для p:1')
  has('runFinished.attempts 0 при одной попытке — отказ',
    await boom(async () => readWriteJournal(await write('r3c.ndjson', [line(1, 'runStarted'), intent(2), create(3), outcome(4, 'p:1', 'mismatch'), fin(5, 0, false)]))), 'runFinished.attempts 0 противоречит журналу: намерений prepare — 1')
  has('runFinished.failed false при mismatch — отказ',
    await boom(async () => readWriteJournal(await write('r3c2.ndjson', [line(1, 'runStarted'), intent(2), create(3), outcome(4, 'p:1', 'mismatch'), fin(5, 1, false)]))), 'runFinished.failed false противоречит журналу: есть попытка без исхода verified')
  has('runFinished.failed true при одном verified — отказ',
    await boom(async () => readWriteJournal(await write('r3c3.ndjson', [line(1, 'runStarted'), intent(2), create(3), outcome(4), fin(5, 1, true)]))), 'runFinished.failed true противоречит журналу: все попытки verified')
  has('runFinished.attempts 7 — отказ',
    await boom(async () => readWriteJournal(await write('r3d.ndjson', [line(1, 'runStarted'), intent(2), create(3), outcome(4), fin(5, 7, true)]))), 'runFinished.attempts 7 противоречит')
  has('runFinished.failed false при намерении без исхода — отказ',
    await boom(async () => readWriteJournal(await write('r3e.ndjson', [line(1, 'runStarted'), intent(2), create(3), fin(4, 1, false)]))), 'есть попытка без исхода verified')
  t('намерение без исхода + failed true — законно', (await readWriteJournal(await write('r3ok.ndjson', [line(1, 'runStarted'), intent(2), create(3), fin(4, 1, true)]))).length, 4)
  t('грамматика — инкрементальна: writer и reader пользуются одной (journalGrammar экспортирован)', typeof journalModule.journalGrammar, 'function')
  t('prepare → create → rename → rename → outcome — законно',
    (await readWriteJournal(await write('r2ok.ndjson', [line(1, 'runStarted'), intent(2), create(3), rename(4), rename(5, 'p:1', { fields: { 'POI ID': 'POI-000003' }, fieldsDigest: intentFieldsDigest({ 'POI ID': 'POI-000003' }) }), outcome(6)]))).length, 6)

  /* Законные формы: полный прогон и ОБОРВАННЫЙ (без runFinished). */
  t('полный журнал принимается', (await readWriteJournal(await write('ok1.ndjson', [line(1, 'runStarted'), intent(2), create(3), outcome(4), fin(5, 1, false)]))).length, 5)
  t('оборванный журнал (intent без исхода, без runFinished) — законен', (await readWriteJournal(await write('ok2.ndjson', [line(1, 'runStarted'), intent(2), create(3)]))).length, 3)
  t('два ключа подряд — законны', (await readWriteJournal(await write('ok3.ndjson', [line(1, 'runStarted'), intent(2, 'p:1'), create(3, 'p:1'), outcome(4, 'p:1'), intent(5, 'p:2')]))).length, 5)
  t('грамматика — чистая функция над строками', assertWriteJournalGrammar([line(1, 'runStarted')]).length, 1)
}

/* ── 4. Устойчивость: намерение сброшено на диск ДО эффекта ─────────────
   Находка аудита 4 (R0): `appendFile` без `fsync` возвращает управление, когда
   байты ушли в страничный кэш; сбой питания между ним и эффектом оставил бы
   эффект без намерения. Доказательство двухслойное: структурно — каждая
   строка проходит через `durable(handle)`, и это `handle.sync()`, а других
   путей записи в модуле нет; поведением — намерение читается обратно из
   файла сразу после вызова, до какого-либо эффекта. */
{
  const source = await readFile(new URL('../scripts/poi-portals/lib/write-journal.mjs', import.meta.url), 'utf8')
  t('модуль не пишет через appendFile/writeFile из fs/promises', /\bappendFile\(|\bwriteFile\(/.test(source.replace(/handle\.writeFile/g, '')), false)
  t('строка пишется через дескриптор и сразу durable(handle)', /await handle\.writeFile\(text, 'utf8'\)\s*\n\s*await durable\(handle\)/.test(source), true)
  t('durable — это handle.sync(), без условий', /export async function durable\(handle\) \{\s*await handle\.sync\(\)\s*\}/.test(source), true)
  t('durable экспортирован — его вызов наблюдаем, а не подразумеваем', typeof journalModule.durable, 'function')
  t('дескриптор закрывается всегда, а отказ записи, sync ИЛИ close — печать (R5)', /await durable\(handle\)\s*\n\s*\} catch \(error\) \{\s*\n\s*failed = true\s*\n\s*failure = error\s*\n\s*\}\s*\n\s*try \{\s*\n\s*await handle\.close\(\)\s*\n\s*\} catch \(error\) \{\s*\n\s*if \(!failed\) \{[^]*?\}\s*\n\s*\}\s*\n\s*if \(failed\) throw seal\(failure\)/.test(source), true)
  /* R6: признак отказа — факт, а не истинность брошенного значения. */
  t('  и отказ опознаётся флагом, а не истинностью значения', /if \(failure\) throw seal/.test(source), false)
  t('  и подтверждение строки — после close()', source.indexOf("grammar.accept(line, { last: kind === 'runFinished' })") > source.indexOf('if (failed) throw seal(failure)'), true)
  /* R6: причина строится ЕДИНСТВЕННЫМ безопасным описателем проекта, а не
     собственной копией: `instanceof`/`.message`/`String()` в модуле нет. */
  t('причина печати строится describeThrownSafely', /const reason = describeThrownSafely\(thrown\)/.test(source), true)
  t('  и импортированы общие безопасные процедуры, а не заведены вторые копии', /import \{ describeThrownSafely, thrownCode \} from '\.\.\/\.\.\/\.\.\/src\/lib\/thrown-value\.ts'/.test(source), true)
  /* R7: код ошибки нигде не читается напрямую — ни в append, ни в цепочке каталогов. */
  t('код ошибки читается только безопасной процедурой', /\?\.code|\.code ===|\.code !==/.test(source.replace(/\/\*[^]*?\*\//g, '').replace(/thrownCode\(error\)/g, '')), false)
  t('  и он читается ровно тремя вызовами thrownCode', (source.match(/thrownCode\(error\)/g) ?? []).length, 3)
  t('  и модуль не рефлексирует брошенное значение сам (в коде, не в комментариях)',
    /instanceof Error|\bString\(thrown\)|thrown\.message/.test(source.replace(/\/\*[^]*?\*\//g, '')), false)
  t('  и наружу уходит обычная Error с устойчивым текстом', /return new Error\(`\$\{WRITE_JOURNAL_SPEC\}: \$\{file\}, строка \$\{line\.seq\} \(\$\{kind\}\) не записана: \$\{reason\}`\)/.test(source), true)
  /* R2 (находка аудита 3): fsync файла не фиксирует запись о нём в каталоге. */
  t('durableDirectory экспортирован', typeof journalModule.durableDirectory, 'function')
  t('durableDirectory — открыть каталог и sync(), без условий', /export async function durableDirectory\(dirPath\) \{\s*const handle = await open\(dirPath, 'r'\)\s*try \{\s*await handle\.sync\(\)\s*\} finally \{\s*await handle\.close\(\)\s*\}\s*\}/.test(source), true)
  t('каталог прогона синхронизируется после строки, создавшей файл', /if \(!created\) \{\s*\n(\s*\/\*[^]*?\*\/\s*\n)?\s*try \{\s*\n\s*await io\.durableDirectory\(runDir\)\s*\n\s*\} catch \(error\) \{\s*\n\s*throw seal\(error\)\s*\n\s*\}\s*\n\s*\}/.test(source), true)
  /* R4: строка подтверждается (грамматика, seq) ТОЛЬКО после долговечной записи и синхронизации каталога. */
  t('подтверждение строки — после записи, sync и синхронизации каталога', source.indexOf("grammar.accept(line, { last: kind === 'runFinished' })") > source.indexOf('await io.durableDirectory(runDir)'), true)
  t('  и seq растёт только там', (source.match(/seq \+= 1/g) ?? []).length === 1 && source.indexOf('seq += 1') > source.indexOf("grammar.accept(line, { last: kind === 'runFinished' })"), true)
  t('  а проверка до записи — без применения состояния', /grammar\.accept\(line, \{ last: kind === 'runFinished', apply: false \}\)/.test(source), true)
  t('  и отказ открытия файла тоже печатает журнал', /throw seal\(error\)/.test(source.slice(source.indexOf('handle = await io.open('), source.indexOf('await handle.writeFile(text'))), true)
  t('и это после durable(handle) и закрытия файла — байты раньше имени', source.indexOf('await io.durableDirectory(runDir)') > source.indexOf("await handle.writeFile(text, 'utf8')"), true)
  t('durableDirectory принимает каталог и завершается', await journalModule.durableDirectory(dir).then(() => 'ok', (e) => e.message), 'ok')
  has('durableDirectory на несуществующем пути — отказ (до эффекта)', await boom(() => journalModule.durableDirectory(path.join(dir, 'нет-такого-каталога'))), 'ENOENT')

  /* R3 (находка аудита 4): ПЕРВЫЙ ЗАПУСК — корня журналов нет. На байтах R2
     `mkdir(runDir, { recursive: true })` создавал несколько уровней разом, а
     синхронизировался только родитель каталога прогона: записи о lvl1, lvl2,
     о самом корне в содержащем его каталоге оставались незафиксированными
     (strace: пять mkdir, два fsync). Теперь — по одному уровню, и после каждого
     создания синхронизируется каталог, в котором появилось новое имя. */
  t('модуль не пользуется recursive mkdir (в коде, не в комментариях)', /mkdir\([^)]*recursive/.test(source.replace(/\/\*[^]*?\*\//g, '')), false)
  t('каталог прогона создаётся цепочкой ensureDurableDirectory(runDir, io)', /await ensureDurableDirectory\(runDir, io\)/.test(source), true)
  {
    const root = path.join(dir, 'first-run', 'lvl1', 'lvl2', 'poi-write-journal')
    const calls = []
    const io = {
      stat: (p) => { calls.push(`stat ${path.relative(dir, p) || '.'}`); return journalModule.DIRECTORY_IO.stat(p) },
      mkdir: (p, opts) => { calls.push(`mkdir ${path.relative(dir, p)}${opts ? ' ' + JSON.stringify(opts) : ''}`); return journalModule.DIRECTORY_IO.mkdir(p, opts) },
      durableDirectory: (p) => { calls.push(`sync ${path.relative(dir, p) || '.'}`); return journalModule.DIRECTORY_IO.durableDirectory(p) },
    }
    const journal = await openWriteJournal({ dir: root, runId: 'run-1', now: NOW, io })
    const chain = calls.filter((c) => !c.startsWith('stat'))
    t('первый запуск: каждое новое имя создано по одному и зафиксировано в содержащем каталоге — сверху вниз',
      chain.join(' | '),
      'mkdir first-run | sync . | mkdir first-run/lvl1 | sync first-run | mkdir first-run/lvl1/lvl2 | sync first-run/lvl1 | mkdir first-run/lvl1/lvl2/poi-write-journal | sync first-run/lvl1/lvl2 | mkdir first-run/lvl1/lvl2/poi-write-journal/run-1 | sync first-run/lvl1/lvl2/poi-write-journal | sync first-run/lvl1/lvl2/poi-write-journal/run-1')
    t('  и ни одного recursive mkdir', calls.some((c) => c.includes('recursive')), false)
    t('  и последняя синхронизация — каталог прогона после первой строки (файл получил имя)', chain[chain.length - 1], 'sync first-run/lvl1/lvl2/poi-write-journal/run-1')
    t('  и журнал на месте', (await readFile(journal.file, 'utf8')).split('\n').filter(Boolean).length, 1)
    /* Второй прогон в существующем корне: создаётся только каталог прогона,
       синхронизируется только корень (и каталог прогона после файла). */
    calls.length = 0
    await openWriteJournal({ dir: root, runId: 'run-2', now: NOW, io })
    t('второй запуск: существующие каталоги не создаются и не синхронизируются',
      calls.filter((c) => !c.startsWith('stat')).join(' | '),
      'mkdir first-run/lvl1/lvl2/poi-write-journal/run-2 | sync first-run/lvl1/lvl2/poi-write-journal | sync first-run/lvl1/lvl2/poi-write-journal/run-2')
    /* Чистая цепочка: возвращает созданные каталоги; существующий файл на пути — отказ. */
    const made = await journalModule.ensureDurableDirectory(path.join(dir, 'chain', 'a', 'b'))
    t('ensureDurableDirectory возвращает созданные каталоги сверху вниз', made.map((p) => path.relative(dir, p)).join(','), 'chain,chain/a,chain/a/b')
    t('  повторный вызов ничего не создаёт', (await journalModule.ensureDurableDirectory(path.join(dir, 'chain', 'a', 'b'))).length, 0)
    await writeFile(path.join(dir, 'chain', 'file'), 'x')
    has('  файл на месте каталога — отказ', await boom(() => journalModule.ensureDurableDirectory(path.join(dir, 'chain', 'file', 'x'))), 'лежит файл, а не каталог')
    has('  файл вместо целевого каталога — отказ', await boom(() => journalModule.ensureDurableDirectory(path.join(dir, 'chain', 'file'))), 'не является каталогом')
    has('  отказ синхронизации родителя — отказ цепочки (до эффекта)',
      await boom(() => journalModule.ensureDurableDirectory(path.join(dir, 'chain', 'c'), { ...journalModule.DIRECTORY_IO, durableDirectory: async () => { throw new Error('EIO: sync failed') } })), 'EIO')
  }
  const journal = await open('run-durable')
  await journal.intent(INTENT())
  const afterIntent = await readFile(journal.file, 'utf8')
  t('намерение читается обратно сразу после вызова — до какого-либо эффекта', afterIntent.split('\n').filter(Boolean).length, 2)
  has('  и это именно intent с полями', afterIntent, '"kind":"intent"')
  has('  и с digest полей', afterIntent, '"fieldsDigest":"sha256:')
}

/* ── 4б. R4 (находка аудита 1): строка существует, когда её байты долговечны ──
   На байтах R3 грамматика и seq подтверждали строку ДО записи: отказ дозаписи
   `outcome` (EACCES до появления байтов) оставлял seq 1,2,3, а `finish()`
   писал seq 5 с `failed:false` — журнал с сохранённым намерением становился
   непригоден для сверки (`tmp/10f-r-r4-repro-OLD-2026-09-05.log`). */
{
  const OUT = (over = {}) => OUTCOME('p:1', 'verified', { recordId: 'rec1', poiId: 'POI-000001', ...over })
  /* Транспорт файла инжектируем: отказ на N-м открытии, частичная запись, отказ sync. */
  const failingIo = ({ failOpenAt = null, tornAt = null, failSyncAt = null } = {}) => {
    let opens = 0
    return {
      ...journalModule.DIRECTORY_IO,
      open: async (file, flags) => {
        opens += 1
        if (opens === failOpenAt) { const e = new Error('EACCES: permission denied, open'); e.code = 'EACCES'; throw e }
        const handle = await journalModule.DIRECTORY_IO.open(file, flags)
        if (opens === tornAt) {
          return { writeFile: async (text) => { await handle.writeFile(text.slice(0, 25), 'utf8'); throw new Error('ENOSPC: no space left on device') }, sync: () => handle.sync(), close: () => handle.close() }
        }
        if (opens === failSyncAt) {
          return { writeFile: (t, enc) => handle.writeFile(t, enc), sync: async () => { throw new Error('EIO: fsync failed') }, close: () => handle.close() }
        }
        return handle
      },
    }
  }
  const lines = async (file) => (await readFile(file, 'utf8')).split('\n').filter(Boolean).length
  /* Отказ читателя — поимённый провал, не крах. */
  const readDetailed = async (label, file) => {
    try { return await journalModule.readWriteJournalDetailed(file) } catch (e) { bad.push(`${label}: журнал не читается — ${e instanceof Error ? e.message : String(e)}`); return { entries: [], tornTail: undefined } }
  }
  const unique = async () => [{ recordId: 'rec1', poiId: 'POI-000001' }]
  const inBase = { recordId: 'rec1', poiId: 'POI-000001', fields: { ...PAYLOAD } }

  /* (а) Отказ ДО появления байтов — контрпример аудита. */
  const a = await openWriteJournal({ dir, runId: 'run-seal-a', now: NOW, io: failingIo({ failOpenAt: 4 }) })
  await a.intent(INTENT()); await a.intent(CREATE())
  t('до отказа: три строки подтверждены', a.entries, 3)
  has('outcome: запись отказала', await boom(() => a.outcome(OUT())), 'EACCES')
  t('после отказа: seq НЕ подтвердил строку', a.entries, 3)
  t('после отказа: грамматика НЕ подтвердила исход — закрывающая строка знает попытку без verified', JSON.stringify(a.closing), '{"attempts":1,"failed":true}')
  t('после отказа: журнал запечатан на строке 4 (outcome)', `${a.sealed?.seq}/${a.sealed?.kind}`, '4/outcome')
  has('finish() после отказа — отказ, а не seq 5', await boom(() => a.finish()), 'запечатан после отказа записи строки 4 (outcome)')
  has('  и названо, что сохранённые строки читаются', await boom(() => a.finish()), 'сохранённые строки 1–3 читаются')
  t('на диске ровно три строки', await lines(a.file), 3)
  const aRead = await readDetailed('(а) префикс после отказа до байтов', a.file)
  t('читатель принимает сохранённый префикс', aRead.entries.map((e) => e.step ?? e.kind).join(','), 'runStarted,prepare,create')
  t('  без оборванного хвоста', aRead.tornTail, null)
  const aRes = await reconcileWriteJournal(a.file, { read: async () => [inBase], readByPoiId: unique }).catch((e) => ({ resolved: [{ resolution: `сверка отказала: ${e.message}` }] }))
  t('и сверка разбирает сохранённое намерение — verified по чтениям', aRes.resolved[0]?.resolution, 'verified')
  has('повторная дозапись после печати — тот же отказ', await boom(() => a.intent(INTENT('p:2'))), 'запечатан')

  /* (б) Частичная запись: обрывок на диске — оборванный хвост, не повреждение. */
  const b = await openWriteJournal({ dir, runId: 'run-seal-b', now: NOW, io: failingIo({ tornAt: 4 }) })
  await b.intent(INTENT()); await b.intent(CREATE())
  has('outcome: запись оборвалась', await boom(() => b.outcome(OUT())), 'ENOSPC')
  t('обрывок на диске есть', (await readFile(b.file, 'utf8')).endsWith('\n'), false)
  has('finish() — отказ (печать)', await boom(() => b.finish()), 'запечатан')
  const bRead = await readDetailed('(б) префикс с оборванным хвостом', b.file)
  t('читатель: три строки', bRead.entries.length, 3)
  t('  и оборванный хвост назван', bRead.tornTail?.bytes, 25)
  has('  с началом обрывка', bRead.tornTail?.preview ?? '', '{"spec":"poi-write-journa')
  const bRes = await reconcileWriteJournal(b.file, { read: async () => [inBase], readByPoiId: unique }).catch((e) => ({ resolved: [{ resolution: `сверка отказала: ${e.message}` }], tornTail: undefined }))
  t('сверка по такому журналу работает', bRes.resolved[0]?.resolution, 'verified')
  t('  и называет оборванный хвост в отчёте', bRes.tornTail?.bytes, 25)

  /* (в) Отказ sync после полной записи: строка на диске может быть — и она правдива. */
  const c = await openWriteJournal({ dir, runId: 'run-seal-c', now: NOW, io: failingIo({ failSyncAt: 4 }) })
  await c.intent(INTENT()); await c.intent(CREATE())
  has('outcome: sync отказал', await boom(() => c.outcome(OUT())), 'EIO')
  t('seq не подтверждён', c.entries, 3)
  has('finish() — отказ (печать)', await boom(() => c.finish()), 'запечатан')
  t('читатель принимает то, что легло на диск', (await readDetailed('(в) префикс после отказа sync', c.file)).entries.length >= 3, true)

  /* (г) Читатель: обрывок ПОСРЕДИ файла — отказ; полная строка без \n в конце — хвост, не строка. */
  const base = (seq, kind, over = {}) => ({ spec: WRITE_JOURNAL_SPEC, seq, at: NOW.toISOString(), runId: 'r', kind, ...over })
  const started = JSON.stringify(base(1, 'runStarted', { meta: {} }))
  const prep = JSON.stringify({ ...base(2, 'intent'), sourceKey: 'p:1', verification: 'liveRead', step: 'prepare', fields: FIELDS, fieldsDigest: intentFieldsDigest(FIELDS), recordId: null, from: null })
  const mid = path.join(dir, 'torn-mid.ndjson'); await writeFile(mid, `${started}\n{"spec":"poi-w${prep}\n`)
  has('обрывок посреди файла — отказ', await boom(() => readWriteJournal(mid)), 'строка 2 не разбирается')
  const noNl = path.join(dir, 'torn-end.ndjson'); await writeFile(noNl, `${started}\n${prep}`)
  const noNlRead = await journalModule.readWriteJournalDetailed(noNl)
  t('полная строка без завершающего перевода строки — оборванный хвост, не строка', noNlRead.entries.length, 1)
  t('  и это названо', noNlRead.tornTail !== null, true)
  const dup = path.join(dir, 'torn-glued.ndjson'); await writeFile(dup, `${started}\n${prep.slice(0, 30)}${prep}\n`)
  has('обрывок, к которому приклеена следующая строка, — отказ', await boom(() => readWriteJournal(dup)), 'не разбирается')

  /* (д) Без инъекции — настоящая файловая система: файл журнала read-only. */
  const e = await openWriteJournal({ dir, runId: 'run-seal-e', now: NOW })
  await e.intent(INTENT()); await e.intent(CREATE())
  await chmod(e.file, 0o444)
  const eErr = await boom(() => e.outcome(OUT()))
  await chmod(e.file, 0o644)
  has('настоящий EACCES: outcome отказал', eErr, 'EACCES')
  has('  finish() — отказ, seq 5 не появляется', await boom(() => e.finish()), 'запечатан')
  t('  на диске три строки, читаются', (await readDetailed('(д) настоящий EACCES', e.file)).entries.length, 3)

  /* (е) R5, находка 1: запись и sync удались, close() бросил. Строка на диске
     полная, но писатель её не подтверждает и печатает журнал — иначе следующая
     строка получила бы тот же seq (на байтах R4: seq 1,2,3,4,4, журнал нечитаем). */
  let closeOpens = 0
  const closeIo = { ...journalModule.DIRECTORY_IO, open: async (file, flags) => {
    closeOpens += 1
    const handle = await journalModule.DIRECTORY_IO.open(file, flags)
    if (closeOpens !== 4) return handle
    return { writeFile: (t, enc) => handle.writeFile(t, enc), sync: () => handle.sync(), close: async () => { await handle.close(); throw new Error('EIO: close failed') } }
  } }
  const f = await openWriteJournal({ dir, runId: 'run-seal-f', now: NOW, io: closeIo })
  await f.intent(INTENT()); await f.intent(CREATE())
  has('close() после sync бросил — outcome отказал', await boom(() => f.outcome(OUT())), 'EIO: close failed')
  t('  и seq не подтверждён', f.entries, 3)
  t('  и журнал запечатан на строке 4', `${f.sealed?.seq}/${f.sealed?.kind}`, '4/outcome')
  has('  и finish() — отказ, а не вторая строка с тем же seq', await boom(() => f.finish()), 'запечатан')
  const fRead = await readDetailed('(е) префикс после отказа close', f.file)
  t('  и на диске полная строка outcome, seq сплошной 1–4', fRead.entries.map((e) => e.seq).join(','), '1,2,3,4')
  t('  и это законный незавершённый журнал (без runFinished)', fRead.entries.at(-1)?.kind, 'outcome')

  /* (ж) R5, находка 3: байты после законного runFinished — повреждение, не хвост. */
  const g = await openWriteJournal({ dir, runId: 'run-after-finish', now: NOW })
  await g.intent(INTENT()); await g.intent(CREATE()); await g.outcome(OUT()); await g.finish()
  await writeFile(g.file, `${await readFile(g.file, 'utf8')}{"spec":"poi-write-journal/v1","seq":6,"kind":"outc`)
  has('фрагмент после runFinished — отказ читателя, не tornTail', await boom(() => journalModule.readWriteJournalDetailed(g.file)), 'после runFinished — журнал повреждён')
  const gCli = { exitCode: 0 }
  const gOut = await quiet(() => runReconcileCli(['n', 'r', g.file], {}, gCli))
  t('  и poi:reconcile — код возврата 1', gCli.exitCode, 1)
  has('  и причина названа', gOut.out, 'после runFinished')
  /* Даже полная строка без \n после runFinished — повреждение. */
  const g2 = await openWriteJournal({ dir, runId: 'run-after-finish-2', now: NOW })
  await g2.intent(INTENT()); await g2.intent(CREATE()); await g2.outcome(OUT()); await g2.finish()
  await writeFile(g2.file, `${await readFile(g2.file, 'utf8')}{"spec":"poi-write-journal/v1"}`)
  has('полная строка без \\n после runFinished — тоже повреждение', await boom(() => journalModule.readWriteJournalDetailed(g2.file)), 'после runFinished')
  /* А хвост НЕЗАВЕРШЁННОГО журнала по-прежнему допустим — см. (б) выше. */
  t('хвост незавершённого журнала по-прежнему допустим', bRead.entries.length === 3 && bRead.tornTail?.bytes === 25, true)

  /* (з) R6, находка 1: close() бросает ОТОЗВАННЫЙ Proxy после настоящих
     write + sync + close. На байтах R5 `seal` сам падал на `instanceof`,
     печати не было, `finish()` дописывал строку с тем же seq, журнал
     становился нечитаемым (`tmp/10f-r-r6-repro-OLD-2026-09-05.log`).
     Свойство, а не форма значения: причина строится безопасным описателем
     проекта, поэтому враждебность значения на неё не влияет. */
  const revoked = () => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy }
  const hostileValues = [
    ['отозванный Proxy', revoked],
    ['Proxy с бросающими ловушками', () => new Proxy({}, { get() { throw new Error('ловушка get') }, getOwnPropertyDescriptor() { throw new Error('ловушка gOPD') }, getPrototypeOf() { throw new Error('ловушка gPO') } })],
    ['объект с бросающим message', () => ({ get message() { throw new Error('ловушка message') } })],
    ['Symbol', () => Symbol('журнал')],
    ['null', () => null],
    ['undefined', () => undefined],
    ['число', () => 0],
  ]
  /* Брошенное значение описывается безопасно и НЕ покидает журнал: наружу
     выходит обычная Error с устойчивым текстом. */
  const safeThrow = async (fn) => {
    try { await fn(); return { escaped: '(без ошибки)' } } catch (e) {
      /* Рефлексия самого брошенного значения тоже может отказать (отозванный
         Proxy): проверка обязана это ПЕРЕЖИТЬ и назвать, а не уронить сюиту. */
      let isError = false
      let message = '(значение не описывается)'
      try { isError = e instanceof Error } catch { isError = false }
      try {
        const own = typeof e === 'object' && e !== null ? Object.getOwnPropertyDescriptor(e, 'message') : null
        if (own && 'value' in own) message = String(own.value)
      } catch { message = '(значение не описывается)' }
      return { escaped: null, isError, message }
    }
  }
  for (const [label, make] of hostileValues) {
    let hostileOpens = 0
    const io = { ...journalModule.DIRECTORY_IO, open: async (file, flags) => {
      hostileOpens += 1
      const handle = await journalModule.DIRECTORY_IO.open(file, flags)
      if (hostileOpens !== 4) return handle
      return { writeFile: (t, enc) => handle.writeFile(t, enc), sync: () => handle.sync(), close: async () => { await handle.close(); throw make() } }
    } }
    const h = await openWriteJournal({ dir, runId: `run-hostile-${hostileValues.findIndex(([l]) => l === label)}`, now: NOW, io })
    await h.intent(INTENT()); await h.intent(CREATE())
    const escapeCheck = await safeThrow(() => h.outcome(OUT()))
    t(`${label} из close(): наружу выходит обычная Error, а не само значение`, escapeCheck.isError === true, true)
    has(`  и текст устойчив — назван журнал и строка`, escapeCheck.message ?? '', 'строка 4 (outcome) не записана')
    t(`  и журнал ЗАПЕЧАТАН`, `${h.sealed?.seq}/${h.sealed?.kind}`, '4/outcome')
    t(`  и причина — непустая строка`, typeof h.sealed?.reason === 'string' && h.sealed.reason.length > 0, true)
    t(`  и seq не подтверждён`, h.entries, 3)
    const finCheck = await safeThrow(() => h.finish())
    t(`  и finish() отказал`, finCheck.escaped, null)
    has(`  и назвал печать`, finCheck.message ?? '', 'запечатан после отказа записи строки 4')
    const seqs = (await readDetailed(`(з) ${label}`, h.file)).entries.map((e) => e.seq)
    t(`  и на диске нет повторного seq: 1,2,3,4`, seqs.join(','), '1,2,3,4')
    const dozapis = await safeThrow(() => h.intent(INTENT('p:2')))
    has(`  и дальнейшая дозапись запрещена`, dozapis.message ?? '', 'запечатан')
  }
  /* Несколько враждебных значений подряд в ОДНОМ прогоне: описание одного не
     ломает описание следующего, печать ставится на первом же. */
  {
    let n = 0
    const io = { ...journalModule.DIRECTORY_IO, open: async (file, flags) => {
      n += 1
      const handle = await journalModule.DIRECTORY_IO.open(file, flags)
      if (n < 4) return handle
      const values = [revoked(), Symbol('x'), { get message() { throw new Error('ловушка') } }]
      return { writeFile: (t, enc) => handle.writeFile(t, enc), sync: () => handle.sync(), close: async () => { await handle.close(); throw values[(n - 4) % values.length] } }
    } }
    const multi = await openWriteJournal({ dir, runId: 'run-hostile-multi', now: NOW, io })
    await multi.intent(INTENT()); await multi.intent(CREATE())
    const first = await safeThrow(() => multi.outcome(OUT()))
    t('несколько враждебных значений подряд: первый отказ — обычная Error', first.isError, true)
    t('  и печать поставлена сразу', multi.sealed?.seq, 4)
    const second = await safeThrow(() => multi.outcome(OUT()))
    has('  и следующая попытка отказана печатью, а не новым падением', second.message ?? '', 'запечатан')
    const third = await safeThrow(() => multi.finish())
    has('  и finish() тоже', third.message ?? '', 'запечатан')
    t('  и на диске по-прежнему сплошной префикс', (await readDetailed('(з) несколько значений', multi.file)).entries.map((e) => e.seq).join(','), '1,2,3,4')
  }

  /* (к) R7: отказ САМОГО io.open — тот же класс, что отказ close(). На байтах
     R6 `catch` читал `error?.code`, чтобы отличить EEXIST, и на отозванном
     Proxy это была ловушка `get`: вторичный TypeError, `sealed` null,
     `finish()` дописывал runFinished — на диске [1,2,3,4] с закрывающей
     строкой, журнал читался как ЗАКОНЧЕННЫЙ и лгал
     (`tmp/10f-r-r7-repro-OLD-2026-09-05.log`). */
  const openFailures = [
    ['отозванный Proxy', revoked],
    ['объект с бросающим getter code', () => ({ get code() { throw new Error('ловушка code') }, get message() { throw new Error('ловушка message') } })],
    ['Proxy с бросающей ловушкой get', () => new Proxy({}, { get() { throw new Error('ловушка get') } })],
    ['Symbol', () => Symbol('open')],
    ['null', () => null],
  ]
  for (const [label, make] of openFailures) {
    let n = 0
    const io = { ...journalModule.DIRECTORY_IO, open: async (file, flags) => {
      n += 1
      if (n === 4) throw make()
      return journalModule.DIRECTORY_IO.open(file, flags)
    } }
    const k = await openWriteJournal({ dir, runId: `run-open-${openFailures.findIndex(([l]) => l === label)}`, now: NOW, io })
    await k.intent(INTENT()); await k.intent(CREATE())
    const attempt = await safeThrow(() => k.outcome(OUT()))
    t(`io.open бросил ${label}: наружу — обычная Error`, attempt.isError === true, true)
    has('  и текст устойчив', attempt.message ?? '', 'строка 4 (outcome) не записана')
    t('  и журнал ЗАПЕЧАТАН на отказавшей строке', `${k.sealed?.seq}/${k.sealed?.kind}`, '4/outcome')
    t('  и seq не подтверждён', k.entries, 3)
    const fin = await safeThrow(() => k.finish())
    has('  и finish() запрещён', fin.message ?? '', 'запечатан после отказа записи строки 4')
    has('  и дальнейшая дозапись запрещена', (await safeThrow(() => k.intent(INTENT('p:9')))).message ?? '', 'запечатан')
    const disk = await readDetailed(`(к) ${label}`, k.file)
    t('  и на диске читаемый НЕЗАВЕРШЁННЫЙ префикс без повторного seq', `${disk.entries.map((e) => e.seq).join(',')}/${disk.entries.at(-1)?.kind}`, '1,2,3/intent')
  }
  /* (л) R8: ДЛИННЫЙ ПУТЬ не стирает признаки диагностики. Вложенная причина
     проходит через обрезку описателя (200 кодовых точек); повтор полного пути
     в ней съедал бюджет, и на длинном каталоге терялись и «уже существует», и
     «дозапись в чужой журнал запрещена» (на macOS — 369/370 при 370/370 с
     `TMPDIR=/tmp`). Каталог здесь строится намеренно длинным ВНУТРИ обычного
     временного каталога сюиты. Число сегментов выводится из фактической длины
     базового пути, поэтому проверка не зависит от TMPDIR и среды CI. */
  {
    let deep = dir
    while (path.join(deep, 'run-long', WRITE_JOURNAL_FILE).length <= 240) {
      deep = path.join(deep, 'п'.repeat(60))
    }
    await journalModule.ensureDurableDirectory(deep)
    const filePath = path.join(deep, 'run-long', WRITE_JOURNAL_FILE)
    t('длинный путь действительно длинный — контроль самой проверки', filePath.length > 240, true)
    const first = await openWriteJournal({ dir: deep, runId: 'run-long', now: NOW })
    t('  и журнал на длинном пути открывается', first.entries, 1)
    const busyLong = await boom(() => openWriteJournal({ dir: deep, runId: 'run-long', now: NOW }))
    has('длинный путь: признак «уже существует» сохранён', busyLong, 'уже существует')
    has('  и признак «дозапись в чужой журнал запрещена» сохранён', busyLong, 'дозапись в чужой журнал запрещена')
    has('  и прогон назван', busyLong, 'run-long')
    has('  и файл назван во внешнем тексте печати', busyLong, filePath)
    t('  и полный путь во вложенной причине НЕ повторяется', busyLong.split(filePath).length - 1, 1)
    has('  и обрезки нет', busyLong.includes('(обрезано)') ? '(обрезано)' : 'без обрезки', 'без обрезки')
    t('  и чужой журнал не тронут', (await readDetailed('(л) длинный путь', first.file)).entries.length, 1)
    /* Тот же случай внутри append (файл занят между строками) на длинном пути. */
    let n = 0
    const io = { ...journalModule.DIRECTORY_IO, open: async (file, flags) => {
      n += 1
      if (n !== 4) return journalModule.DIRECTORY_IO.open(file, flags)
      const e = new Error('EEXIST: file already exists, open'); e.code = 'EEXIST'; throw e
    } }
    const ex = await openWriteJournal({ dir: deep, runId: 'run-long-append', now: NOW, io })
    await ex.intent(INTENT()); await ex.intent(CREATE())
    const attempt = await safeThrow(() => ex.outcome(OUT()))
    has('длинный путь, EEXIST в append: признак сохранён', attempt.message ?? '', 'уже существует')
    has('  и запрет дозаписи назван', attempt.message ?? '', 'дозапись в чужой журнал запрещена')
    t('  и журнал запечатан', `${ex.sealed?.seq}/${ex.sealed?.kind}`, '4/outcome')
    has('  и причина печати несёт признак', ex.sealed?.reason ?? '', 'дозапись в чужой журнал запрещена')
  }

  /* Обычный EEXIST сохраняет ИМЕННУЮ диагностику — безопасное чтение кода не
     стёрло различение штатного случая. */
  const busy = await open('run-busy')
  has('журнал того же прогона уже есть — прежняя именная диагностика',
    await boom(() => openWriteJournal({ dir, runId: 'run-busy', now: NOW })), 'уже существует')
  has('  и названо, что дозапись в чужой журнал запрещена',
    await boom(() => openWriteJournal({ dir, runId: 'run-busy', now: NOW })), 'дозапись в чужой журнал запрещена')
  t('  и чужой журнал не тронут', (await readDetailed('(к) EEXIST', busy.file)).entries.length, 1)
  {
    /* EEXIST внутри append (файл занят между строками) — тоже именно EEXIST. */
    let n = 0
    const io = { ...journalModule.DIRECTORY_IO, open: async (file, flags) => {
      n += 1
      if (n !== 4) return journalModule.DIRECTORY_IO.open(file, flags)
      const e = new Error('EEXIST: file already exists, open'); e.code = 'EEXIST'; throw e
    } }
    const ex = await openWriteJournal({ dir, runId: 'run-eexist-append', now: NOW, io })
    await ex.intent(INTENT()); await ex.intent(CREATE())
    const attempt = await safeThrow(() => ex.outcome(OUT()))
    has('EEXIST в append: именная диагностика сохранена', attempt.message ?? '', 'уже существует')
    t('  и журнал всё равно запечатан', `${ex.sealed?.seq}/${ex.sealed?.kind}`, '4/outcome')
  }
  /* Враждебные stat/mkdir в цепочке каталогов: наружу — обычная Error,
     эффектов нет (каталог не создан). */
  {
    const target = path.join(dir, 'hostile-chain', 'a', 'b')
    const statOut = await safeThrow(() => journalModule.ensureDurableDirectory(target, { ...journalModule.DIRECTORY_IO, stat: async () => { throw revoked() } }))
    t('hostile stat в цепочке: наружу — обычная Error', statOut.isError === true, true)
    has('  и текст устойчив', statOut.message ?? '', 'проверка каталога')
    t('  и эффектов нет — каталог не создан', await journalModule.DIRECTORY_IO.stat(target).then(() => 'создан', () => 'нет'), 'нет')
    const mkdirTarget = path.join(dir, 'hostile-chain-2', 'a')
    const mkdirOut = await safeThrow(() => journalModule.ensureDurableDirectory(mkdirTarget, { ...journalModule.DIRECTORY_IO, mkdir: async () => { throw revoked() } }))
    t('hostile mkdir в цепочке: наружу — обычная Error', mkdirOut.isError === true, true)
    has('  и текст устойчив', mkdirOut.message ?? '', 'создание каталога')
    t('  и эффектов нет', await journalModule.DIRECTORY_IO.stat(mkdirTarget).then(() => 'создан', () => 'нет'), 'нет')
    /* Открытие журнала на таком io отказывает ДО первой строки — журнала нет. */
    const failedOpen = await safeThrow(() => openWriteJournal({ dir: path.join(dir, 'hostile-chain-3'), runId: 'run-x', now: NOW, io: { ...journalModule.DIRECTORY_IO, mkdir: async () => { throw revoked() } } }))
    t('openWriteJournal на враждебном mkdir: обычная Error до первой строки', failedOpen.isError === true, true)
    t('  и файла журнала не появилось', await journalModule.DIRECTORY_IO.stat(path.join(dir, 'hostile-chain-3', 'run-x', WRITE_JOURNAL_FILE)).then(() => 'есть', () => 'нет'), 'нет')
    /* Штатные коды по-прежнему различаются. */
    has('файл на месте каталога — прежняя именная диагностика (ENOTDIR)', await boom(() => journalModule.ensureDurableDirectory(path.join(dir, 'chain', 'file', 'x'))), 'лежит файл, а не каталог')
  }

  /* (и) R6, находка 2: физическая NDJSON-грамматика fail-closed. */
  const finished = async (runId) => {
    const j2 = await openWriteJournal({ dir, runId, now: NOW })
    await j2.intent(INTENT()); await j2.intent(CREATE()); await j2.outcome(OUT()); await j2.finish()
    return j2
  }
  const nl = await finished('run-extra-nl')
  await writeFile(nl.file, `${await readFile(nl.file, 'utf8')}\n`)
  has('дополнительный \\n после runFinished — именованный отказ', await boom(() => journalModule.readWriteJournalDetailed(nl.file)), 'после runFinished не может быть никаких байтов')
  has('  и назван номер пустой строки', await boom(() => journalModule.readWriteJournalDetailed(nl.file)), 'строка 6 пуста')
  const nlCli = { exitCode: 0 }
  const nlOut = await quiet(() => runReconcileCli(['n', 'r', nl.file], {}, nlCli))
  t('  и poi:reconcile — код возврата 1', nlCli.exitCode, 1)
  has('  и причина напечатана', nlOut.out, 'пуста')
  const emptyMid = await finished('run-empty-mid')
  const emptyMidLines = (await readFile(emptyMid.file, 'utf8')).split('\n')
  await writeFile(emptyMid.file, [emptyMidLines[0], emptyMidLines[1], '', ...emptyMidLines.slice(2)].join('\n'))
  has('пустая строка ВНУТРИ журнала — именованный отказ', await boom(() => journalModule.readWriteJournalDetailed(emptyMid.file)), 'строка 3 пуста')
  has('  и сказано, что каждая строка обязана быть одной JSON-записью', await boom(() => journalModule.readWriteJournalDetailed(emptyMid.file)), 'одной JSON-записью')
  const midCli = { exitCode: 0 }
  await quiet(() => runReconcileCli(['n', 'r', emptyMid.file], {}, midCli))
  t('  и poi:reconcile — код возврата 1', midCli.exitCode, 1)
  /* Прежние законные формы остаются зелёными. */
  const intact = await finished('run-intact')
  const intactRead = await readDetailed('(и) неповреждённый журнал', intact.file)
  t('полный журнал по-прежнему принимается', `${intactRead.entries.length}/${intactRead.entries.at(-1).kind}/${intactRead.tornTail}`, '5/runFinished/null')
  const intactCli = { exitCode: 0 }
  await quiet(() => runReconcileCli(['n', 'r', intact.file], {}, intactCli))
  t('  и сверка по нему — код 0', intactCli.exitCode, 0)
  t('законный tornTail незавершённого журнала по-прежнему допустим', `${bRead.entries.length}/${bRead.tornTail?.bytes}`, '3/25')

  /* Положительный контроль: тот же инжектируемый транспорт без отказов. */
  const ok = await openWriteJournal({ dir, runId: 'run-seal-ok', now: NOW, io: failingIo({}) })
  await ok.intent(INTENT()); await ok.intent(CREATE()); await ok.outcome(OUT()); await ok.finish()
  t('контроль: без отказов — пять строк, seq сплошной, печати нет', `${(await readDetailed('контроль', ok.file)).entries.map((l) => l.seq).join(',')}/${ok.sealed}`, '1,2,3,4,5/null')
}

/* ── 5. Сводка: намерение без исхода — «неизвестно», а не «ничего» ─────── */
{
  const journal = await open('run-3')
  await journal.intent(INTENT('p:1'))
  await journal.intent(CREATE('p:1'))
  await journal.outcome(OUTCOME('p:1', 'verified', { recordId: 'rec1', poiId: 'POI-000001' }))
  await journal.intent(INTENT('p:2'))
  await journal.intent(CREATE('p:2', { ...PAYLOAD, 'Source Key': 'p:2' }))
  await journal.outcome(OUTCOME('p:2', 'unknown'))
  await journal.intent(INTENT('p:3'))
  await journal.intent(CREATE('p:3', { ...PAYLOAD, 'Source Key': 'p:3' }))
  await journal.intent(RENAME('p:3', 'POI-000002'))
  const summary = summarizeWriteJournal(await readWriteJournal(journal.file))
  t('попыток три', summary.attempts.length, 3)
  const p3 = summary.attempts.find((a) => a.sourceKey === 'p:3')
  t('намерение без исхода — unknown', p3.state, 'unknown')
  has('  и причина названа', p3.reason, 'исход — нет')
  t('  и эффект объявлен', p3.effectIntended, true)
  t('  и ожидаемые поля — ПОЛНАЯ нагрузка create с номером ПОСЛЕДНЕГО rename', JSON.stringify(p3.expectedFields), JSON.stringify({ ...PAYLOAD, 'Source Key': 'p:3', 'POI ID': 'POI-000002' }))
  t('  и recordId — из rename', p3.recordId, 'rec1')
  t('раскладка по состояниям', JSON.stringify(summary.byState), '{"verified":1,"unknown":2}')
  t('к разбору — только неустановленные', summary.recoveryRequired.map((a) => a.sourceKey).join(','), 'p:2,p:3')
  /* R3: писатель — та же грамматика. Повторная попытка, verified без эффекта,
     противоречивая закрывающая строка не записываются вовсе. */
  has('писатель: повторный prepare для завершённого ключа — отказ до записи', await boom(() => journal.intent(INTENT('p:1'))), 'повторная попытка для p:1')
  has('писатель: verified без create — отказ до записи', await boom(async () => { const j = await open('run-3c'); await j.intent(INTENT('p:9')); await j.outcome(OUTCOME('p:9', 'verified', { recordId: 'r', poiId: 'P' })) }), 'без объявленного эффекта')
  t('писатель: закрывающая строка выводится из попыток', JSON.stringify(journal.closing), '{"attempts":3,"failed":true}')
  const fin = await journal.finish({ attempts: 0, failed: false }).catch((e) => ({ attempts: `отказ: ${e.message}`, failed: '' }))
  t('  и сообщённые вызывающим значения не принимаются', `${fin.attempts}/${fin.failed}`, '3/true')
  t('  и читатель принимает то, что записал писатель', (await readWriteJournal(journal.file)).length, 11)
  /* Только prepare: хранилище не назвало нагрузку, эффекта быть не могло. */
  const prepOnly = await open('run-3b')
  await prepOnly.intent(INTENT('p:9'))
  const p9 = summarizeWriteJournal(await readWriteJournal(prepOnly.file)).attempts[0]
  t('только prepare — эффект не объявлен', p9.effectIntended, false)
  t('  и ожидаемого итога нет', p9.expectedFields, null)
  t('  но состояние всё же unknown, а не «ничего»', p9.state, 'unknown')
}

/* ── 6. Поздняя сверка: устанавливает ЧТЕНИЕМ и ничего не пишет ────────── */
{
  const journal = await open('run-4')
  await journal.intent(INTENT('p:1'))
  await journal.intent(CREATE('p:1'))
  await journal.outcome(OUTCOME('p:1', 'unknown', { recordId: 'rec1' }))
  await journal.intent(INTENT('p:2'))
  await journal.intent(CREATE('p:2', { ...PAYLOAD, 'Source Key': 'p:2' }))
  await journal.outcome(OUTCOME('p:2', 'unknown'))
  await journal.finish()
  const bytesBefore = await readFile(journal.file, 'utf8')
  const inBase = { recordId: 'rec1', poiId: 'POI-000001', fields: { ...PAYLOAD } }
  /* Чтение по номеру: по умолчанию — ровно та же запись. */
  const unique = async (poiId) => (poiId === 'POI-000001' ? [{ recordId: 'rec1', poiId }] : [])

  const reads = []
  const read = async (sourceKey, fieldNames) => {
    reads.push(`${sourceKey}[${fieldNames.join('|')}]`)
    return sourceKey === 'p:1' ? [inBase] : []
  }
  const byPoiId = []
  const result = await reconcileWriteJournal(journal.file, { read, readByPoiId: async (poiId) => { byPoiId.push(poiId); return unique(poiId) } })
  t('сверка прочитала обе неустановленные строки', reads.map((r) => r.split('[')[0]).join(','), 'p:1,p:2')
  has('  и запросила ОБЕЩАННЫЕ поля', reads[0], 'POI Name (RU)')
  has('  включая добавленные хранилищем', reads[0], 'Last Seeded At')
  t('  и прочитала по ожидаемому номеру (постинвариант уникальности)', byPoiId.join(','), 'POI-000001,POI-000001')
  t('эффект применён и совпал с намерением — установлено чтением', result.resolved.find((r) => r.sourceKey === 'p:1').resolution, 'verified')
  t('эффект не применён — тоже установлено чтением', result.resolved.find((r) => r.sourceKey === 'p:2').resolution, 'notApplied')
  t('сверка объявляет себя не пишущей', result.wrote, false)
  t('и журнал побайтово тот же', await readFile(journal.file, 'utf8'), bytesBefore)

  /* Без живого чтения сверка не выдумывает исход. */
  const offline = await reconcileWriteJournal(journal.file, {})
  t('без --resolve исход не устанавливается', offline.resolved.every((r) => r.resolution === 'notChecked'), true)
  has('  и причина названа', offline.resolved[0].reason, 'не запрашивалось')
  has('одно чтение без другого — отказ сверки', await boom(() => reconcileWriteJournal(journal.file, { read })), 'обоих чтений')

  const ambiguous = await reconcileWriteJournal(journal.file, { read: async () => [inBase, { ...inBase, recordId: 'recB' }], readByPoiId: unique })
  t('две записи под одним ключом — ambiguous, а не «нашлось»', ambiguous.resolved[0].resolution, 'ambiguous')
  const failing = await reconcileWriteJournal(journal.file, { read: async () => { throw new Error('502 bad gateway') }, readByPoiId: unique })
  t('отказ чтения — unknown', failing.resolved[0].resolution, 'unknown')
  has('  и причина названа', failing.resolved[0].reason, '502 bad gateway')
  const other = await reconcileWriteJournal(journal.file, { read: async (k) => (k === 'p:1' ? [{ ...inBase, recordId: 'recЧУЖАЯ' }] : []), readByPoiId: unique })
  t('чужая запись под тем же ключом — mismatch', other.resolved.find((r) => r.sourceKey === 'p:1').resolution, 'mismatch')
  /* R1: содержание сверяется — та же запись, но не те поля. */
  const alienContent = await reconcileWriteJournal(journal.file, { read: async (k) => (k === 'p:1' ? [{ ...inBase, fields: { ...inBase.fields, 'POI Name (RU)': 'ДРУГОЕ' } }] : []), readByPoiId: unique })
  t('тот же recordId, чужие поля — mismatch', alienContent.resolved.find((r) => r.sourceKey === 'p:1').resolution, 'mismatch')
  t('  и поле названо', alienContent.resolved.find((r) => r.sourceKey === 'p:1').differing?.join(','), 'POI Name (RU)')
  /* R2: поле, добавленное хранилищем, сверяется наравне со входными. */
  const alienStamp = await reconcileWriteJournal(journal.file, { read: async (k) => (k === 'p:1' ? [{ ...inBase, fields: { ...inBase.fields, 'Last Seeded At': '2020-01-01T00:00:00.000Z' } }] : []), readByPoiId: unique })
  t('чужая метка Last Seeded At — mismatch', alienStamp.resolved.find((r) => r.sourceKey === 'p:1').resolution, 'mismatch')
  t('  и поле названо', alienStamp.resolved.find((r) => r.sourceKey === 'p:1').differing?.join(','), 'Last Seeded At')

  /* R3 (находка 1): постинвариант уникальности — своим чтением. */
  const dupNumber = await reconcileWriteJournal(journal.file, { read, readByPoiId: async () => [{ recordId: 'rec1', poiId: 'POI-000001' }, { recordId: 'recДУБЛЬ', poiId: 'POI-000001' }] })
  t('номер занят двумя записями — mismatch, не verified', dupNumber.resolved.find((r) => r.sourceKey === 'p:1').resolution, 'mismatch')
  has('  и причина называет обе', dupNumber.resolved.find((r) => r.sourceKey === 'p:1').reason, 'recДУБЛЬ')
  const noUnique = await reconcileWriteJournal(journal.file, { read, readByPoiId: async () => { throw new Error('503 service unavailable') } })
  t('чтение по номеру отказало — unknown при полном совпадении полей', noUnique.resolved.find((r) => r.sourceKey === 'p:1').resolution, 'unknown')
  has('  и причина названа', noUnique.resolved.find((r) => r.sourceKey === 'p:1').reason, '503 service unavailable')
  const otherOwner = await reconcileWriteJournal(journal.file, { read, readByPoiId: async () => [{ recordId: 'recДРУГАЯ', poiId: 'POI-000001' }] })
  t('номер принадлежит другой записи — mismatch', otherOwner.resolved.find((r) => r.sourceKey === 'p:1').resolution, 'mismatch')
  /* R5 (находка 2): невозможный календарный момент не подтверждает поле. */
  const impossible = await reconcileWriteJournal(journal.file, { read: async (k) => (k === 'p:1' ? [{ ...inBase, fields: { ...inBase.fields, 'Last Seeded At': '2026-02-31T12:00:00.000Z' } }] : []), readByPoiId: unique })
  t('ожидалось 3 марта, в базе 31 февраля (Date.parse читал бы как 3 марта) — mismatch', impossible.resolved.find((r) => r.sourceKey === 'p:1').resolution, 'mismatch')
  t('  и поле названо', impossible.resolved.find((r) => r.sourceKey === 'p:1').differing?.join(','), 'Last Seeded At')
  /* R4: ответ чтения по номеру обязан нести запрошенный номер. */
  const foreignNumber = await reconcileWriteJournal(journal.file, { read, readByPoiId: async () => [{ recordId: 'rec1', poiId: 'POI-999999' }] })
  t('чтение по номеру отдало тот же id с чужим номером — unknown', foreignNumber.resolved.find((r) => r.sourceKey === 'p:1').resolution, 'unknown')
  has('  и это сказано', foreignNumber.resolved.find((r) => r.sourceKey === 'p:1').reason, 'фильтру сервера не верим')
  t('чтение по номеру отдало запись без номера — unknown', (await reconcileWriteJournal(journal.file, { read, readByPoiId: async () => [{ recordId: 'rec1' }] })).resolved.find((r) => r.sourceKey === 'p:1').resolution, 'unknown')
  t('отчёт сверки называет оборванный хвост (здесь его нет)', result.tornTail, null)
  /* R3 (находка 2): строка без recordId — тождества нет, id из журнала не подставляется. */
  const noId = await reconcileWriteJournal(journal.file, { read: async (k) => (k === 'p:1' ? [{ poiId: 'POI-000001', fields: { ...PAYLOAD } }] : []), readByPoiId: unique })
  t('чтение отдало строку без recordId — unknown, не verified', noId.resolved.find((r) => r.sourceKey === 'p:1').resolution, 'unknown')
  t('  и recordId из журнала не подставлен', noId.resolved.find((r) => r.sourceKey === 'p:1').recordId, null)
  has('  и причина названа', noId.resolved.find((r) => r.sourceKey === 'p:1').reason, 'без id')

  /* R2: только prepare (эффект не объявлялся) — запись под ключом чужая. */
  const prepOnly = await open('run-4b')
  await prepOnly.intent(INTENT('p:1'))
  await prepOnly.outcome(OUTCOME('p:1', 'unknown'))
  const prepNone = await reconcileWriteJournal(prepOnly.file, { read: async () => [], readByPoiId: unique })
  t('prepare без create, записи нет — notApplied', prepNone.resolved[0].resolution, 'notApplied')
  const prepFound = await reconcileWriteJournal(prepOnly.file, { read: async () => [inBase], readByPoiId: unique })
  t('prepare без create, запись есть — mismatch, не verified', prepFound.resolved[0].resolution, 'mismatch')
  has('  и сказано, что эффект не объявлялся', prepFound.resolved[0].reason, 'эффект не объявлялся')
}

/* ── 7. ГЛАВНЫЙ АВАРИЙНЫЙ СЛУЧАЙ: intent-only после состоявшегося эффекта ──
   Находка аудита 2 (R0). Эффект состоялся, `outcome` не записался. Сверка
   находит запись и ОБЯЗАНА доказать, что это задуманный результат, — по
   сохранённому намерению, а не по факту нахождения. */
{
  const journal = await open('run-intent-only')
  await journal.intent(INTENT('p:1'))
  await journal.intent(CREATE('p:1'))
  /* …и здесь процесс умер: POST мог уйти. */
  const entries = await readWriteJournal(journal.file)
  t('intent-only журнал читается (оборванный прогон законен)', entries.map((e) => `${e.kind}${e.step ? `:${e.step}` : ''}`).join(','), 'runStarted,intent:prepare,intent:create')
  const inBase = { recordId: 'recX', poiId: 'POI-000001', fields: { ...PAYLOAD } }
  const unique = async () => [{ recordId: 'recX', poiId: 'POI-000001' }]
  const resolved = await reconcileWriteJournal(journal.file, { read: async () => [inBase], readByPoiId: unique })
  t('запись найдена и совпала с намерением по всем полям — verified', resolved.resolved[0].resolution, 'verified')
  has('  и это сказано', resolved.resolved[0].reason, 'совпали с намерением')
  t('  и номер взят из базы', resolved.resolved[0].poiId, 'POI-000001')
  t('  и id взят из базы', resolved.resolved[0].recordId, 'recX')
  const cli = { exitCode: 0 }
  await quiet(() => runReconcileCli(['n', 'r', journal.file, '--resolve'], { read: async () => [inBase], readByPoiId: unique }, cli))
  t('  и код возврата сверки — 0', cli.exitCode, 0)
  /* А если в базе под этим ключом — не то, что обещано: */
  const wrong = await reconcileWriteJournal(journal.file, { read: async () => [{ ...inBase, fields: { ...inBase.fields, Latitude: 35.0 } }], readByPoiId: unique })
  t('запись найдена, но поле не совпало — mismatch', wrong.resolved[0].resolution, 'mismatch')
  t('  и поле названо', wrong.resolved[0].differing?.join(','), 'Latitude')
  const none = await reconcileWriteJournal(journal.file, { read: async () => [], readByPoiId: unique })
  t('записи нет — notApplied (эффект не состоялся)', none.resolved[0].resolution, 'notApplied')

  /* R2 (находка аудита 1) на уровне журнала: create → rename, процесс умер
     после PATCH. Итог — номер ПОСЛЕ переименования; старый номер в базе —
     mismatch по POI ID, а не verified «по совпадению остальных полей». */
  const renamed = await open('run-rename-only')
  await renamed.intent(INTENT('p:1'))
  await renamed.intent(CREATE('p:1'))
  await renamed.intent(RENAME('p:1', 'POI-000002'))
  const stale = { recordId: 'rec1', poiId: 'POI-000001', fields: { ...PAYLOAD } }
  const unique2 = async (poiId) => (poiId === 'POI-000002' ? [{ recordId: 'rec1', poiId }] : [])
  const staleRes = await reconcileWriteJournal(renamed.file, { read: async () => [stale], readByPoiId: unique2 })
  t('rename в намерении, в базе старый номер — mismatch', staleRes.resolved[0].resolution, 'mismatch')
  t('  и названо поле POI ID', staleRes.resolved[0].differing?.join(','), 'POI ID')
  has('  и в причине — ожидание и факт', staleRes.resolved[0].reason, 'ожидалось "POI-000002", в базе "POI-000001"')
  const fresh = { recordId: 'rec1', poiId: 'POI-000002', fields: { ...PAYLOAD, 'POI ID': 'POI-000002' } }
  t('в базе новый номер — verified', (await reconcileWriteJournal(renamed.file, { read: async () => [fresh], readByPoiId: unique2 })).resolved[0].resolution, 'verified')
  t('чужой recordId под новым номером — mismatch', (await reconcileWriteJournal(renamed.file, { read: async () => [{ ...fresh, recordId: 'recДРУГАЯ' }], readByPoiId: unique2 })).resolved[0].resolution, 'mismatch')
}

/* ── 8. CLI сверки: разбор аргументов и код возврата ───────────────────── */
{
  t('журнал — позиционный аргумент', parseReconcileArgs(['n', 'r', 'j.ndjson']).journal, 'j.ndjson')
  t('--resolve выключен по умолчанию', parseReconcileArgs(['n', 'r', 'j.ndjson']).resolve, false)
  t('--resolve включается явно', parseReconcileArgs(['n', 'r', 'j.ndjson', '--resolve']).resolve, true)
  has('неизвестный флаг — отказ', await boom(async () => parseReconcileArgs(['n', 'r', '--что-то'])), 'Неизвестный аргумент')
  has('без журнала — отказ', await boom(async () => parseReconcileArgs(['n', 'r'])), 'Укажите файл журнала')
  has('два журнала — отказ', await boom(async () => parseReconcileArgs(['n', 'r', 'a', 'b'])), 'один раз')

  const journal = await open('run-5')
  await journal.intent(INTENT('p:1'))
  await journal.intent(CREATE('p:1'))
  await journal.outcome(OUTCOME('p:1', 'unknown', { recordId: 'rec1' }))
  const inBase = { recordId: 'rec1', poiId: 'POI-000001', fields: { ...PAYLOAD } }
  const unique = async () => [{ recordId: 'rec1', poiId: 'POI-000001' }]
  const unresolved = { exitCode: 0 }
  await quiet(() => runReconcileCli(['n', 'r', journal.file, '--resolve'], { read: async () => { throw new Error('сеть недоступна') }, readByPoiId: unique }, unresolved))
  t('неустановленный исход после сверки — код возврата 1', unresolved.exitCode, 1)
  const resolved = { exitCode: 0 }
  const printed = await quiet(() => runReconcileCli(['n', 'r', journal.file, '--resolve'], { read: async () => [inBase], readByPoiId: unique }, resolved))
  t('установленный исход — код возврата 0', resolved.exitCode, 0)
  has('  и сводка напечатана', printed.out, '"resolution": "verified"')
  const halfDeps = { exitCode: 0 }
  const halfOut = await quiet(() => runReconcileCli(['n', 'r', journal.file, '--resolve'], { read: async () => [inBase] }, halfDeps))
  t('только одно чтение из двух — код возврата 1', halfDeps.exitCode, 1)
  has('  и причина названа', halfOut.out, 'обоих чтений')
  const missing = { exitCode: 0 }
  const err = await quiet(() => runReconcileCli(['n', 'r', path.join(dir, 'нет-такого.ndjson')], {}, missing))
  t('отсутствующий журнал — код возврата 1', missing.exitCode, 1)
  has('  и причина названа', err.out, 'poi-reconcile')
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ журнал эффектов записи и поздняя сверка: ${ok} проверок пройдено`)
}
