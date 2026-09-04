#!/usr/bin/env node
/**
 * Execution-grade цепочка схемной операции «четыре поля таксономии v2»
 * (10f-P R2): bootstrap сверяет ВСЕ модули цепочки до импорта; read-only
 * предполёт до журнала; полное допустимое состояние четвёрки перед каждым
 * POST; исход после любого POST — только свежим чтением; строгая грамматика
 * журнала против байтов карточки и разрешения; независимый свидетель.
 *
 *   node tests/poi-schema-chain.mjs
 *
 * Сеть подменена целиком; Airtable не трогается; журналы — во временном
 * каталоге и удаляются. Каждая находка R1-аудита имеет процессный
 * контрпример ниже (§1, §2, §3, §4, §5, §6).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, cpSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import {
  assertTaxonomySchemaApproval, assertTaxonomySchemaCard, buildTaxonomySchemaCard, cardDigestOf,
  CHAIN_MODULES, CANONICAL_BASE_ID, META_FIELDS_PATH, moduleDigests, TAXONOMY_SCHEMA_APPROVAL_SPEC,
} from '../scripts/poi-schema/taxonomy-schema-card.mjs'
import { describeThrownSafely, normalizeSent, approvalDigestOf, bodyDigestOf, executeTaxonomySchemaCard, preflightTaxonomySchemaCard } from '../scripts/poi-schema/taxonomy-schema-execute.mjs'
import { createMetaTransport, DEFAULT_EXCHANGE_DEADLINE_MS, parseSchemaTables, READ_FAILURE_CAUSES, SchemaReadError } from '../scripts/poi-schema/taxonomy-schema-transport.mjs'
import { journalPathFor, openSchemaJournal, readSchemaJournal, JOURNAL_KINDS } from '../scripts/poi-schema/taxonomy-schema-journal.mjs'
import { assertQuartetState, fieldMatchesBody } from '../scripts/poi-schema/taxonomy-schema-state.mjs'
import { witnessTaxonomySchema, classifyWitness, shapeProblem } from '../scripts/poi-schema/taxonomy-schema-witness.mjs'
import { finalGate, validateJournalGrammar, verdictFromJournal, VERDICT_ELIGIBLE_OUTCOMES, witnessProblem } from '../scripts/poi-schema/taxonomy-schema-gate.mjs'
import { BOOTSTRAP_CHAIN_MODULES, isDirectEntry, main as bootstrap, verifyChainAgainstCard } from '../scripts/poi-schema/run-taxonomy-schema.mjs'
import { main as cli } from '../scripts/poi-schema/taxonomy-schema-cli.mjs'
import { expectedTaxonomyFieldSchema } from '../src/lib/poi-taxonomy-airtable.ts'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${String(text).slice(0, 240)}» нет «${needle}»`)
}
const boom = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e.message } }
/** Значение выражения либо текст его отказа: мутация обязана провалить УТВЕРЖДЕНИЕ, а не процесс. */
const safe = async (fn, fallback = null) => { try { return await fn() } catch (e) { return fallback && typeof fallback === 'object' ? { ...fallback, thrown: e } : (fallback ?? `(отказ: ${e.message})`) } }
/** Обещание либо метка «не завершилось»: зависший обмен не должен вешать набор. */
const settled = async (promise, ms = 1500) => {
  let timer
  const late = new Promise((r) => { timer = setTimeout(() => r('НЕ ЗАВЕРШИЛОСЬ'), ms) })
  try { return await Promise.race([promise.then((v) => ({ value: v }), (e) => ({ error: e })), late]) } finally { clearTimeout(timer) }
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AT = '2026-09-03T00:00:00.000Z'
const NOW = '2026-09-03T12:00:00.000Z'
const clock = (start = '2026-09-03T10:00:00.000Z') => {
  let ms = Date.parse(start)
  return () => { ms += 1000; return new Date(ms).toISOString() }
}
const cardBytesOf = (card) => Buffer.from(`${JSON.stringify(card, null, 2)}\n`, 'utf8')
const approvalFor = (bytes, card, over = {}) => ({
  contractVersion: TAXONOMY_SCHEMA_APPROVAL_SPEC,
  cardDigest: cardDigestOf(bytes),
  cardId: card.cardId,
  decisionRef: 'owner/2026-09-03#schema',
  approver: 'владелец',
  approvedAt: '2026-09-03T09:00:00.000Z',
  validUntil: '2026-09-10T00:00:00.000Z',
  ...over,
})
const card = buildTaxonomySchemaCard({ preparedAt: AT })
const bytes = cardBytesOf(card)
const bodies = card.fields.map((f) => f.request.body)
const NAMES = card.scope.fieldNames
const liveFieldOf = (body, id) => ({ id, name: body.name, type: body.type, ...(body.options ? { options: { choices: body.options.choices.map((c) => ({ name: c.name })) } } : {}) })

/* Никогда не разрешающееся обещание — «зависание» обмена на фикстуре. */
const NEVER = new Promise(() => {})
/* Управляемые часы для срока обмена: таймеры срабатывают по команде теста, время не тратится. */
function fakeTimers() {
  const pending = new Map()
  let id = 0
  return {
    setTimeoutImpl: (fn) => { id += 1; pending.set(id, fn); return id },
    clearTimeoutImpl: (t) => pending.delete(t),
    get armed() { return pending.size },
    fireAll() { const fns = [...pending.values()]; pending.clear(); for (const fn of fns) fn() },
  }
}

/* Подменный Airtable: схема в памяти; поведение POST и чтения переключаемо. */
function fakeAirtable({
  tableId = POI_TABLE_ID, tableName = 'POI', initialFields = [], onPost = () => 'applied',
  readFails = () => false, afterRead = () => {}, corruptRead = () => null, description = (b) => b.description,
  timers = null, deadlineMs = DEFAULT_EXCHANGE_DEADLINE_MS,
} = {}) {
  const calls = []
  const state = { fields: [...initialFields], nextId: 1 }
  const born = (body, id) => ({ ...liveFieldOf(body, id), description: description(body) })
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ method, url: String(url), signal: init.signal ?? null })
    if (method === 'GET') {
      const mode = readFails(calls, state)
      if (mode === 'hangHeaders') return NEVER
      if (mode === 'hangBody') return { ok: true, status: 200, text: () => NEVER, json: () => NEVER }
      if (mode) throw new Error('read ECONNRESET')
      // Снимок схемы берётся В МОМЕНТ чтения; порча после чтения (afterRead) его не меняет.
      const tables = [{ id: tableId, name: tableName, fields: state.fields.map((f) => JSON.parse(JSON.stringify(f))) }, { id: 'tblX', name: 'Route Stops', fields: [] }]
      const corrupt = corruptRead(calls, state)
      if (corrupt) corrupt(tables)
      const payload = { tables }
      afterRead(calls, state)
      return { ok: true, status: 200, text: async () => JSON.stringify(payload), json: async () => payload }
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body)
      const mode = onPost(body, state, calls)
      if (mode === 'hangHeaders') return NEVER
      if (mode === 'hangBody') { state.fields.push(born(body, `fld${state.nextId++}`)); return { ok: true, status: 200, text: () => NEVER, json: () => NEVER } }
      if (mode === 'refused') return { ok: false, status: 422, text: async () => 'INVALID_REQUEST' }
      if (mode === 'appliedButRefused') { state.fields.push(born(body, `fld${state.nextId++}`)); return { ok: false, status: 422, text: async () => 'INVALID_REQUEST' } }
      if (mode === 'throw') throw new Error('socket hang up')
      if (mode === 'throwAfterApply') { state.fields.push(born(body, `fld${state.nextId++}`)); throw new Error('read ECONNRESET') }
      if (mode === 'notAppliedBut2xx') return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'fldGHOST' }) }
      if (mode === 'applyWrongType') { state.fields.push({ ...born(body, `fld${state.nextId++}`), type: 'singleLineText', options: undefined }); return { ok: true, status: 200, text: async () => JSON.stringify({ id: `fld${state.nextId - 1}` }) } }
      if (mode === 'applyTwice') { state.fields.push(born(body, `fld${state.nextId++}`)); state.fields.push(born(body, `fld${state.nextId++}`)); return { ok: true, status: 200, text: async () => JSON.stringify({ id: `fld${state.nextId - 2}` }) } }
      if (mode === 'status500') return { ok: false, status: 500, text: async () => 'server' }
      const id = `fld${state.nextId++}`
      state.fields.push(born(body, id))
      return { ok: true, status: 200, text: async () => JSON.stringify({ id }) }
    }
    throw new Error(`подменный Airtable: неожиданный метод ${method}`)
  }
  const transport = createMetaTransport({ token: 'tok', fetchImpl, deadlineMs, ...(timers ? { setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl } : {}) })
  return { calls, state, fetchImpl, transport, timers }
}
const posts = (fx) => fx.calls.filter((c) => c.method === 'POST').length
const dir = mkdtempSync(path.join(tmpdir(), 'jj-schema-chain-'))
const run = (fx, over = {}) => executeTaxonomySchemaCard({
  cardBytes: over.cardBytes ?? bytes, approval: over.approval ?? approvalFor(bytes, card), transport: over.transport ?? fx.transport,
  now: over.now ?? clock(), repoRoot: REPO, journalRoot: over.journalRoot ?? path.join(dir, `j-${Math.random().toString(36).slice(2)}`),
})

try {
  /* ── 1. Карточка: детерминизм, закрытая область, ВСЕ модули цепочки ─── */
  {
    t('карточка детерминирована', cardDigestOf(cardBytesOf(buildTaxonomySchemaCard({ preparedAt: AT }))), cardDigestOf(bytes))
    t('карточка заморожена и не исполнена', card.status, 'FROZEN_NOT_EXECUTED')
    t('ровно четыре поля', card.fields.length, 4)
    t('поля — из loader’а', NAMES.join(','), expectedTaxonomyFieldSchema().map((f) => f.name).join(','))
    t('каждый запрос — POST в поля канонической таблицы', card.fields.every((f) => f.request.method === 'POST' && f.request.path === META_FIELDS_PATH), true)
    t('путь полей несёт канонический ID таблицы', META_FIELDS_PATH.endsWith(`/tables/${POI_TABLE_ID}/fields`), true)
    t('база каноническая', card.base.baseId, CANONICAL_BASE_ID)
    t('список модулей bootstrap = список карточки (побайтно)', JSON.stringify(BOOTSTRAP_CHAIN_MODULES), JSON.stringify(CHAIN_MODULES))
    for (const rel of ['scripts/poi-schema/run-taxonomy-schema.mjs', 'scripts/poi-schema/taxonomy-schema-cli.mjs', 'scripts/poi-schema/taxonomy-schema-state.mjs', 'scripts/lib/byte-digest.mjs', 'scripts/lib/canonical-contract.mjs', 'src/lib/poi-taxonomy.ts', 'src/lib/airtable-schema.ts', 'config/poi-taxonomy.v2.json']) {
      t(`точка входа и зависимости в карточке: ${rel}`, rel in card.modules, true)
    }
    t('отпечатки модулей — с диска', JSON.stringify(card.modules), JSON.stringify(moduleDigests(REPO)))
    t('годная карточка проходит проверку с диском', await safe(() => assertTaxonomySchemaCard(card, { repoRoot: REPO })), true)
    has('исход — только чтением (политика карточки)', card.effectPolicy.outcome, 'ТОЛЬКО свежим чтением')
    has('чтение недоступно — unknown и восстановление', card.effectPolicy.readUnavailable, 'unknown')
    const mutate = (fn) => { const c = JSON.parse(JSON.stringify(card)); fn(c); return c }
    has('пятое поле — отказ', await boom(() => assertTaxonomySchemaCard(mutate((c) => { c.fields.push({ ...c.fields[0], order: 5 }); c.scope.fieldCount = 5 }))), 'ожидается ровно 4')
    has('чужая опция — отказ', await boom(() => assertTaxonomySchemaCard(mutate((c) => c.fields[0].request.body.options.choices.push({ name: 'castle_x' })))), 'не совпадает с ожидаемой схемой')
    has('переставленные поля — отказ', await boom(() => assertTaxonomySchemaCard(mutate((c) => { [c.fields[0], c.fields[1]] = [c.fields[1], c.fields[0]] }))), 'order нарушен')
    has('чужая таблица — отказ', await boom(() => assertTaxonomySchemaCard(mutate((c) => { c.base.poiTableId = 'tblOTHER' }))), 'не каноническая')
    has('модуль пропущен — отказ', await boom(() => assertTaxonomySchemaCard(mutate((c) => { delete c.modules['scripts/poi-schema/run-taxonomy-schema.mjs'] }))), 'состав модулей')
    has('отпечаток точки входа не с диска — отказ', await boom(() => assertTaxonomySchemaCard(mutate((c) => { c.modules['scripts/poi-schema/run-taxonomy-schema.mjs'] = 'sha256:' + 'a'.repeat(64) }), { repoRoot: REPO })), 'карточка устарела')
  }

  /* ── 2. Bootstrap: сверка ДО импорта; изменённый runner делает карточку неприменимой ── */
  {
    const v = verifyChainAgainstCard(bytes, REPO)
    t('bootstrap: годная карточка совпадает с диском', v.ok, true)
    const stale = JSON.parse(JSON.stringify(card)); stale.modules['scripts/poi-schema/taxonomy-schema-execute.mjs'] = 'sha256:' + 'c'.repeat(64)
    const sv = verifyChainAgainstCard(cardBytesOf(stale), REPO)
    t('bootstrap: чужой отпечаток исполнителя — отказ', sv.ok, false)
    has('bootstrap: отказ называет модуль', sv.problems.join(' | '), 'taxonomy-schema-execute.mjs')
    const fewer = JSON.parse(JSON.stringify(card)); delete fewer.modules['scripts/poi-schema/run-taxonomy-schema.mjs']
    has('bootstrap: карточка без точки входа — отказ', verifyChainAgainstCard(cardBytesOf(fewer), REPO).problems.join(' | '), 'состав модулей')
    // Процессный контрпример: копия дерева, изменённый runner и исполнитель с побочным эффектом при импорте.
    const sb = mkdtempSync(path.join(tmpdir(), 'jj-chain-bootstrap-'))
    try {
      for (const rel of ['src/lib', 'config', 'scripts/lib', 'scripts/poi-schema']) { mkdirSync(path.dirname(path.join(sb, rel)), { recursive: true }); cpSync(path.join(REPO, rel), path.join(sb, rel), { recursive: true }) }
      symlinkSync(path.join(REPO, 'node_modules'), path.join(sb, 'node_modules'), 'dir')
      writeFileSync(path.join(sb, 'package.json'), '{"type":"module"}')
      const cardPath = path.join(sb, 'card.json')
      // Точка входа запускается как отдельный процесс; падение процесса — именованный провал, не крах теста.
      const boot = (args, env = {}) => {
        try {
          const stdout = execFileSync(process.execPath, ['scripts/poi-schema/run-taxonomy-schema.mjs', ...args], { cwd: sb, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })
          return { code: 0, stdout, stderr: '' }
        } catch (e) { return { code: e.status ?? -1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') } }
      }
      const frozenRun = boot(['--freeze', cardPath])
      t('песочница: --freeze завершается кодом 0', frozenRun.code, 0)
      t('песочница: карточка записана', existsSync(cardPath), true)
      const frozen = existsSync(cardPath) ? JSON.parse(readFileSync(cardPath, 'utf8')) : { modules: {} }
      t('песочница: замороженная карточка содержит точку входа', 'scripts/poi-schema/run-taxonomy-schema.mjs' in frozen.modules, true)
      t('песочница: состав модулей карточки = список bootstrap', JSON.stringify(Object.keys(frozen.modules).sort()), JSON.stringify([...BOOTSTRAP_CHAIN_MODULES].sort()))
      const okVerify = boot(['--verify', cardPath])
      t('песочница: свежая карточка проходит --verify (код 0)', okVerify.code, 0)
      has('песочница: --verify подтверждает совпадение с диском', okVerify.stdout, 'совпадает с диском')
      // Изменённый runner.
      const runner = path.join(sb, 'scripts/poi-schema/run-taxonomy-schema.mjs')
      writeFileSync(runner, `${readFileSync(runner, 'utf8')}\n// MUTATED RUNNER\n`)
      const mutated = boot(['--verify', cardPath])
      t('изменённый runner: --verify отказывает', mutated.code, 1)
      has('изменённый runner: отказ называет сам runner', mutated.stderr, 'run-taxonomy-schema.mjs: на диске')
      has('изменённый runner: ничего не импортировано', mutated.stderr, 'ничего не импортировано')
      // Изменённый исполнитель с побочным эффектом при импорте — не исполняется до сверки.
      const exec = path.join(sb, 'scripts/poi-schema/taxonomy-schema-execute.mjs')
      writeFileSync(exec, `console.error('EXECUTOR MODULE EVALUATED')\n${readFileSync(exec, 'utf8')}`)
      const approvalPath = path.join(sb, 'approval.json')
      writeFileSync(approvalPath, JSON.stringify(approvalFor(existsSync(cardPath) ? readFileSync(cardPath) : Buffer.from(''), frozen)))
      const executed = boot(['--execute', cardPath, '--approval', approvalPath], { AIRTABLE_TOKEN: 'fake' })
      t('изменённый исполнитель: --execute отказывает', executed.code, 1)
      t('изменённый исполнитель: НЕ исполнен до сверки', /EXECUTOR MODULE EVALUATED/.test(executed.stderr + executed.stdout), false)
      has('изменённый исполнитель: отказ bootstrap', executed.stderr, 'цепочка не совпадает с карточкой')
      // Нетронутая цепочка, но чужая карточка (stale отпечаток) — CLI тоже не импортируется.
      writeFileSync(runner, readFileSync(path.join(REPO, 'scripts/poi-schema/run-taxonomy-schema.mjs')))
      const stalePath = path.join(sb, 'stale.json')
      writeFileSync(stalePath, cardBytesOf(stale))
      const staleRun = boot(['--witness', stalePath])
      t('устаревшая карточка: --witness отказывает до импорта CLI', staleRun.code, 1)
      has('устаревшая карточка: отказ называет исполнителя', staleRun.stderr, 'taxonomy-schema-execute.mjs')
    } finally { rmSync(sb, { recursive: true, force: true }) }
  }

  /* ── 3. Разрешение ─────────────────────────────────────────────────── */
  {
    const digest = cardDigestOf(bytes)
    const good = approvalFor(bytes, card)
    t('годное разрешение принято', assertTaxonomySchemaApproval(good, { cardDigest: digest, cardId: card.cardId, now: NOW }), true)
    has('чужой отпечаток карточки — отказ', await boom(() => assertTaxonomySchemaApproval(approvalFor(bytes, card, { cardDigest: 'sha256:' + 'b'.repeat(64) }), { cardDigest: digest, cardId: card.cardId, now: NOW })), 'не совпадает с байтами карточки')
    has('правка карточки после разрешения — отказ', await boom(() => assertTaxonomySchemaApproval(good, { cardDigest: cardDigestOf(Buffer.from(bytes.toString('utf8') + ' ')), cardId: card.cardId, now: NOW })), 'не совпадает с байтами карточки')
    has('истёкшее разрешение — отказ', await boom(() => assertTaxonomySchemaApproval(good, { cardDigest: digest, cardId: card.cardId, now: '2026-09-11T00:00:00.000Z' })), 'истекло')
  }

  /* ── 4. Состояние четвёрки — одна функция на все точки ────────────── */
  {
    const live = (n) => bodies.slice(0, n).map((b, i) => liveFieldOf(b, `f${i}`))
    t('исходное состояние: все отсутствуют', assertQuartetState([{ id: POI_TABLE_ID, name: 'POI', fields: [] }], bodies, 0).ok, true)
    t('после двух: префикс из двух', assertQuartetState([{ id: POI_TABLE_ID, name: 'POI', fields: live(2) }], bodies, 2).ok, true)
    has('после двух, ожидали одно: суффикс присутствует', assertQuartetState([{ id: POI_TABLE_ID, name: 'POI', fields: live(2) }], bodies, 1).reason, 'уже существует')
    has('после одного, ожидали два: префикс отсутствует', assertQuartetState([{ id: POI_TABLE_ID, name: 'POI', fields: live(1) }], bodies, 2).reason, 'присутствует 0 раз')
    has('поле префикса дважды — отказ', assertQuartetState([{ id: POI_TABLE_ID, name: 'POI', fields: [...live(1), ...live(1)] }], bodies, 1).reason, 'присутствует 2 раз')
    const drifted = live(1); drifted[0].options.choices.pop()
    has('поле префикса не совпадает — отказ', assertQuartetState([{ id: POI_TABLE_ID, name: 'POI', fields: drifted }], bodies, 1).reason, 'не совпадает с карточкой')
    has('чужой ID таблицы — отказ', assertQuartetState([{ id: 'tblFOREIGN000000', name: 'POI', fields: [] }], bodies, 0).reason, 'чужой ID tblFOREIGN000000')
    has('чужое имя при каноническом ID — отказ', assertQuartetState([{ id: POI_TABLE_ID, name: 'POI 2', fields: [] }], bodies, 0).reason, 'называется «POI 2»')
    t('все четыре: свидетель', assertQuartetState([{ id: POI_TABLE_ID, name: 'POI', fields: live(4) }], bodies, 4).ok, true)
    t('fieldMatchesBody: порядок опций не важен', fieldMatchesBody({ ...liveFieldOf(bodies[0], 'f'), options: { choices: [...bodies[0].options.choices].reverse() } }, bodies[0]), true)
    t('fieldMatchesBody: лишняя опция — расхождение', fieldMatchesBody({ ...liveFieldOf(bodies[0], 'f'), options: { choices: [...bodies[0].options.choices, { name: 'x' }] } }, bodies[0]), false)
  }

  /* ── 5. Предполёт — read-only, ДО журнала ───────────────────────────── */
  {
    const fx = fakeAirtable({ initialFields: [liveFieldOf(bodies[2], 'fldOLD')] })
    const jr = path.join(dir, 'j-pre')
    has('поле суффикса уже есть — отказ предполёта', await boom(() => run(fx, { journalRoot: jr })), 'предполёт: живая схема не в исходном состоянии')
    t('отказ предполёта: ни одного POST', posts(fx), 0)
    t('отказ предполёта: журнал не создан', existsSync(journalPathFor(cardDigestOf(bytes), jr)), false)
    const fx2 = fakeAirtable()
    const jr2 = path.join(dir, 'j-pre2')
    has('разрешение на другие байты — отказ предполёта', await boom(() => run(fx2, { approval: approvalFor(Buffer.from('other'), card), journalRoot: jr2 })), 'не совпадает с байтами карточки')
    t('чужое разрешение: сети не было', fx2.calls.length, 0)
    t('чужое разрешение: журнал не создан', existsSync(journalPathFor(cardDigestOf(bytes), jr2)), false)
    const fx3 = fakeAirtable({ tableId: 'tblFOREIGN000000' })
    has('чужой ID таблицы — отказ предполёта', await boom(() => run(fx3, { journalRoot: path.join(dir, 'j-pre3') })), 'чужой ID tblFOREIGN000000')
    t('чужой ID: ни одного POST', posts(fx3), 0)
    const pre = await preflightTaxonomySchemaCard({ cardBytes: bytes, approval: approvalFor(bytes, card), transport: fakeAirtable().transport, now: clock(), repoRoot: REPO })
    t('предполёт возвращает отпечатки', pre.cardDigest === cardDigestOf(bytes) && pre.approvalDigest === approvalDigestOf(approvalFor(bytes, card)), true)
  }

  /* ── 6. Счастливый путь: грамматика, свидетель, gate ─────────────────── */
  {
    const fx = fakeAirtable()
    const r = await run(fx)
    t('счастливый путь: allApplied', r.outcome, 'allApplied')
    t('счастливый путь: четыре поля', r.applied.join(','), NAMES.join(','))
    t('счастливый путь: ровно четыре POST', posts(fx), 4)
    t('порядок: предполётное чтение, затем на каждое поле чтение-POST-чтение, затем итоговое чтение', fx.calls.map((c) => c.method[0]).join(''), 'G' + 'GPG'.repeat(4) + 'G')
    t('ни PATCH, ни DELETE', fx.calls.some((c) => !['GET', 'POST'].includes(c.method)), false)
    const journal = readSchemaJournal(r.journal)
    t('журнал закрыт allApplied', journal.outcome, 'allApplied')
    t('журнал: грамматика — opened, preflight, 4×(stateBefore, dispatching, sent, outcome), closed',
      journal.records.map((x) => x.kind).join(','), ['opened', 'preflight', ...NAMES.flatMap(() => ['stateBefore', 'dispatching', 'sent', 'outcome']), 'closed'].join(','))
    t('журнал: каждый исход установлен чтением', journal.records.filter((x) => x.kind === 'outcome').every((x) => x.establishedBy === 'read' && x.result === 'applied'), true)
    const approval = approvalFor(bytes, card)
    const witness = await witnessTaxonomySchema({ fetchImpl: fx.fetchImpl, cardBytes: bytes })
    t('свидетель видит совпадающую схему', witness.verifiedSuccess, true)
    t('свидетель — по каноническому ID', witness.tableId, POI_TABLE_ID)
    const gate = finalGate({ cardBytes: bytes, approval, journal, witness })
    t('финальный gate — verifiedSuccess', gate.verifiedSuccess, true)
    t('gate: грамматика без замечаний', gate.grammar.problems.length, 0)
    // Дрейф ПОСЛЕ исполнения: журнал годен, свидетель — нет.
    fx.state.fields[0].options.choices.pop()
    const drifted = await witnessTaxonomySchema({ fetchImpl: fx.fetchImpl, cardBytes: bytes })
    t('gate при годном журнале и дрейфе у свидетеля — отказ', finalGate({ cardBytes: bytes, approval, journal, witness: drifted }).verifiedSuccess, false)
    has('повтор для того же отпечатка — отказ до первого запроса', await boom(() => run(fakeAirtable(), { journalRoot: path.dirname(path.dirname(r.journal)) })), 'уже существует')
  }

  /* ── 7. Gate: строгая грамматика — контрпримеры ──────────────────────── */
  {
    const approval = approvalFor(bytes, card)
    const goodWitness = { verifiedSuccess: true, tableId: POI_TABLE_ID, reason: null, fieldIds: ['fld1', 'fld2', 'fld3', 'fld4'], ambiguous: false }
    const jroot = path.join(dir, 'j-forged')
    // (а) opened + closed(allApplied, applied=[]) — связанный по хешам, но пустой.
    const j = openSchemaJournal({ cardDigest: cardDigestOf(bytes), now: clock(), root: jroot, opened: { cardId: card.cardId, approvalDigest: approvalDigestOf(approval), fields: NAMES } })
    j.close({ outcome: 'allApplied', applied: [] })
    const forged = readSchemaJournal(j.file)
    t('подделка: цепочка отпечатков цела', forged.closed && forged.outcome === 'allApplied', true)
    const g = finalGate({ cardBytes: bytes, approval, journal: forged, witness: goodWitness })
    t('подделка opened+closed: gate ОТКАЗЫВАЕТ', g.verifiedSuccess, false)
    has('подделка: причина — грамматика', g.journal, 'ожидалась preflight')
    // (б) Сборка журналов по частям: генератор годной последовательности с точечными искажениями.
    const record = (kind, payload) => ({ kind, ...payload })
    const goodRecords = () => [
      record('opened', { cardId: card.cardId, approvalDigest: approvalDigestOf(approval), fields: NAMES }),
      record('preflight', { ok: true, appliedCount: 0 }),
      ...bodies.flatMap((b, k) => [
        record('stateBefore', { field: b.name, appliedCount: k, ok: true }),
        record('dispatching', { field: b.name, bodyDigest: bodyDigestOf(b) }),
        record('sent', { field: b.name }),
        record('outcome', { field: b.name, result: 'applied', establishedBy: 'read' }),
      ]),
      record('closed', { outcome: 'allApplied', applied: NAMES }),
    ].map((r, i) => ({ seq: i + 1, cardDigest: cardDigestOf(bytes), ...r }))
    const grammar = (records) => validateJournalGrammar(records, { cardBytes: bytes, approval })
    t('годная последовательность проходит грамматику', grammar(goodRecords()).ok, true)
    const drop = (pred) => goodRecords().filter((r) => !pred(r))
    has('три поля вместо четырёх — отказ', grammar(drop((r) => r.field === 'Type Source')).problems.join(' | '), 'ожидалась stateBefore')
    has('без намерения перед POST — отказ', grammar(drop((r) => r.kind === 'dispatching' && r.field === 'POI Facets')).problems.join(' | '), 'ожидалась dispatching')
    const reordered = goodRecords(); const a = reordered.findIndex((r) => r.kind === 'stateBefore' && r.field === 'POI Type'); const b = reordered.findIndex((r) => r.kind === 'stateBefore' && r.field === 'POI Facets')
    const swapped = goodRecords(); for (let k = 0; k < 4; k++) [swapped[a + k], swapped[b + k]] = [swapped[b + k], swapped[a + k]]
    has('переставленные поля — отказ', grammar(swapped).problems.join(' | '), 'stateBefore POI Type')
    const wrongBody = goodRecords(); wrongBody.find((r) => r.kind === 'dispatching').bodyDigest = 'sha256:' + 'e'.repeat(64)
    has('отпечаток тела не из карточки — отказ', grammar(wrongBody).problems.join(' | '), 'отпечаток тела не совпадает с телом из карточки')
    const byResponse = goodRecords(); byResponse.find((r) => r.kind === 'outcome').establishedBy = 'response'
    has('исход не чтением — отказ', grammar(byResponse).problems.join(' | '), 'установлен не чтением')
    const notApplied = goodRecords(); notApplied.filter((r) => r.kind === 'outcome')[3].result = 'notApplied'
    has('исход notApplied — отказ', grammar(notApplied).problems.join(' | '), 'ожидалось applied')
    const wrongApproval = goodRecords(); wrongApproval[0].approvalDigest = 'sha256:' + 'f'.repeat(64)
    has('журнал не связан с разрешением — отказ', grammar(wrongApproval).problems.join(' | '), 'отпечаток разрешения не совпадает')
    const wrongCard = goodRecords().map((r) => ({ ...r, cardDigest: 'sha256:' + 'd'.repeat(64) }))
    has('журнал не связан с байтами карточки — отказ', grammar(wrongCard).problems.join(' | '), 'не совпадает с байтами карточки')
    const extra = goodRecords(); extra.push({ seq: 99, cardDigest: cardDigestOf(bytes), kind: 'outcome', field: 'POI Type', result: 'applied', establishedBy: 'read' })
    has('записи после closed — отказ', grammar(extra).problems.join(' | '), 'после closed')
    const partial = goodRecords(); partial[partial.length - 1].applied = NAMES.slice(0, 3)
    has('closed.applied не четыре — отказ', grammar(partial).problems.join(' | '), 'applied не равен четырём именам')
    const stateWrong = goodRecords(); stateWrong.find((r) => r.kind === 'stateBefore' && r.field === 'POI Facets').appliedCount = 0
    has('stateBefore с неверным appliedCount — отказ', grammar(stateWrong).problems.join(' | '), 'stateBefore POI Facets')
    t('gate без свидетеля — отказ', finalGate({ cardBytes: bytes, approval, journal: { records: goodRecords() }, witness: null }).verifiedSuccess, false)
    t('gate с годными журналом и свидетелем — успех', finalGate({ cardBytes: bytes, approval, journal: { records: goodRecords() }, witness: goodWitness }).verifiedSuccess, true)
  }

  /* ── 8. Исход после POST — только чтением ─────────────────────────────── */
  {
    // 4xx, но поле создалось: исход — applied по чтению, исполнение продолжается.
    const fx = fakeAirtable({ onPost: (b) => (b.name === 'POI Type' ? 'appliedButRefused' : 'applied') })
    const r = await run(fx)
    t('4xx при фактическом эффекте: исход по чтению — applied, allApplied', r.outcome, 'allApplied')
    const j = readSchemaJournal(r.journal)
    t('4xx при эффекте: sent зафиксировал отказ провода', j.records.some((x) => x.kind === 'sent' && x.field === 'POI Type' && x.response === 'refused' && x.status === 422), true)
    t('4xx при эффекте: outcome applied по чтению', j.records.some((x) => x.kind === 'outcome' && x.field === 'POI Type' && x.result === 'applied' && x.establishedBy === 'read'), true)
    t('4xx при эффекте: POST не повторялся', posts(fx), 4)
    // 4xx без эффекта: notApplied по чтению, остановка, без повтора.
    const fx2 = fakeAirtable({ onPost: (b) => (b.name === 'POI Facets' ? 'refused' : 'applied') })
    const r2 = await run(fx2)
    t('4xx без эффекта: stopped', r2.outcome, 'stopped')
    t('4xx без эффекта: остановлено на втором поле', r2.stoppedAt, 'POI Facets')
    t('4xx без эффекта: два POST, без повтора', posts(fx2), 2)
    has('4xx без эффекта: причина — по чтению', r2.reason, 'эффекта не было (по чтению)')
    t('4xx без эффекта: outcome notApplied', readSchemaJournal(r2.journal).records.some((x) => x.kind === 'outcome' && x.result === 'notApplied'), true)
    // 2xx, но эффекта нет: ответу не верим — notApplied, остановка.
    const fx3 = fakeAirtable({ onPost: (b) => (b.name === 'POI Type' ? 'notAppliedBut2xx' : 'applied') })
    const r3 = await run(fx3)
    t('2xx без эффекта: stopped на первом поле', r3.stoppedAt, 'POI Type')
    t('2xx без эффекта: один POST', posts(fx3), 1)
    t('2xx без эффекта: outcome notApplied по чтению', readSchemaJournal(r3.journal).records.some((x) => x.kind === 'outcome' && x.result === 'notApplied' && x.establishedBy === 'read'), true)
    // Обрыв после эффекта: чтение видит поле — applied.
    const fx4 = fakeAirtable({ onPost: (b) => (b.name === 'POI Facets' ? 'throwAfterApply' : 'applied') })
    const r4 = await run(fx4)
    t('обрыв после эффекта: чтение видит поле — allApplied', r4.outcome, 'allApplied')
    t('обрыв после эффекта: POST не повторялся', posts(fx4), 4)
    // Обрыв без эффекта: notApplied, остановка.
    const fx5 = fakeAirtable({ onPost: (b) => (b.name === 'POI Facets' ? 'throw' : 'applied') })
    const r5 = await run(fx5)
    t('обрыв без эффекта: stopped на втором поле', r5.stoppedAt, 'POI Facets')
    t('обрыв без эффекта: два POST', posts(fx5), 2)
    // Чтение недоступно ПОСЛЕ POST: исход unknown, восстановление, без повтора.
    const fx6 = fakeAirtable({ readFails: (calls) => calls.filter((c) => c.method === 'POST').length >= 1 })
    const r6 = await safe(() => run(fx6), {})
    t('чтение после POST недоступно: исход именованный, а не исключение', typeof r6.outcome, 'string')
    t('чтение после POST недоступно: outcome unknown', r6.outcome, 'unknown')
    t('чтение недоступно: требуется восстановление', r6.recoveryRequired, true)
    t('чтение недоступно: один POST, без повтора', posts(fx6), 1)
    const j6 = await safe(() => readSchemaJournal(r6.journal), { outcome: null, records: [] })
    t('чтение недоступно: журнал закрыт unknown', j6.outcome, 'unknown')
    t('чтение недоступно: outcome unknown записан', j6.records.some((x) => x.kind === 'outcome' && x.result === 'unknown'), true)
    // Двойное создание (2 копии) — расхождение состояния, остановка.
    const fx7 = fakeAirtable({ onPost: (b) => (b.name === 'POI Type' ? 'applyTwice' : 'applied') })
    const r7 = await run(fx7)
    t('поле создано дважды: stopped', r7.outcome, 'stopped')
    has('поле создано дважды: причина', r7.reason, 'присутствует 2 раз')
    // Расхождение типа после эффекта.
    const fx8 = fakeAirtable({ onPost: (b) => (b.name === 'Type Source' ? 'applyWrongType' : 'applied') })
    const r8 = await run(fx8)
    t('расхождение после эффекта: stopped на третьем поле', r8.stoppedAt, 'Type Source')
    t('расхождение после эффекта: четвёртое поле не тронуто', fx8.state.fields.some((f) => f.name === 'Taxonomy Version'), false)
    t('расхождение после эффекта: outcome mismatch', readSchemaJournal(r8.journal).records.some((x) => x.kind === 'outcome' && x.result === 'mismatch'), true)
  }

  /* ── 9. Полное состояние перед КАЖДЫМ POST ───────────────────────────── */
  {
    // Первое поле изменено (параллельная правка) после его подтверждения — второй POST не отправляется.
    let tampered = false
    const fx = fakeAirtable({ afterRead: (calls, state) => {
      const p = calls.filter((c) => c.method === 'POST').length
      const g = calls.filter((c) => c.method === 'GET').length
      // GET-и: 1 предполёт, 2 перед POST#1, 3 после POST#1 (исход), 4 — перед POST#2: портим ПОСЛЕ третьего чтения.
      if (p === 1 && g === 3 && !tampered) { state.fields.find((f) => f.name === 'POI Type').options.choices.pop(); tampered = true }
    } })
    const r = await run(fx)
    t('первое поле изменено перед вторым POST: второй POST не отправлен', posts(fx), 1)
    t('первое поле изменено: stopped на втором поле', r.stoppedAt, 'POI Facets')
    has('первое поле изменено: причина — префикс не совпадает', r.reason, 'применённый префикс) не совпадает')
    const j = readSchemaJournal(r.journal)
    t('первое поле изменено: stateBefore записан с ok=false', j.records.some((x) => x.kind === 'stateBefore' && x.field === 'POI Facets' && x.ok === false), true)
    t('первое поле изменено: dispatching для второго поля НЕ записан', j.records.some((x) => x.kind === 'dispatching' && x.field === 'POI Facets'), false)
    // Чужое поле суффикса появилось между POST — второй POST не отправляется.
    let injected = false
    const fx2 = fakeAirtable({ afterRead: (calls, state) => {
      const p = calls.filter((c) => c.method === 'POST').length
      const g = calls.filter((c) => c.method === 'GET').length
      if (p === 1 && g === 3 && !injected) { state.fields.push(liveFieldOf(bodies[3], 'fldALIEN')); injected = true }
    } })
    const r2 = await run(fx2)
    t('поле суффикса появилось между POST: второй POST не отправлен', posts(fx2), 1)
    has('поле суффикса появилось: причина', r2.reason, '(суффикс) уже существует')
    // Первое поле исчезло между POST — префикс не на месте.
    let removed = false
    const fx3 = fakeAirtable({ afterRead: (calls, state) => {
      const p = calls.filter((c) => c.method === 'POST').length
      const g = calls.filter((c) => c.method === 'GET').length
      if (p === 1 && g === 3 && !removed) { state.fields.length = 0; removed = true }
    } })
    const r3 = await run(fx3)
    t('первое поле исчезло между POST: второй POST не отправлен', posts(fx3), 1)
    has('первое поле исчезло: причина', r3.reason, 'присутствует 0 раз')
  }

  /* ── 10. Журнал: эксклюзивность и грамматика видов ───────────────────── */
  {
    const jroot = path.join(dir, 'journals')
    const digest = cardDigestOf(Buffer.from('some card'))
    const j = openSchemaJournal({ cardDigest: digest, now: clock(), root: jroot, opened: { cardId: 'x' } })
    has('второе открытие для того же отпечатка — отказ', await boom(() => openSchemaJournal({ cardDigest: digest, now: clock(), root: jroot, opened: {} })), 'уже существует')
    has('зарезервированное поле в payload — отказ', await boom(() => j.append('sent', { kind: 'x' })), 'зарезервировано')
    has('неизвестный исход — отказ', await boom(() => j.append('outcome', { field: 'x', result: 'rolledBack' })), 'неизвестный исход')
    has('неизвестный вид записи — отказ', await boom(() => j.append('verified', {})), 'неизвестный вид записи')
    t('виды записей закрыты', JOURNAL_KINDS.join(','), 'opened,preflight,stateBefore,dispatching,sent,outcome,stopped,closed')
    j.close({ outcome: 'stopped' })
    const tampered = readFileSync(j.file, 'utf8').replace('"cardId":"x"', '"cardId":"y"')
    writeFileSync(j.file, tampered)
    has('правка записи рвёт цепочку', await boom(() => readSchemaJournal(j.file)), 'изменена после записи')
  }

  /* ── 11. CLI через bootstrap: заморозка и проверка — без сети ────────── */
  {
    const target = path.join(dir, 'card.json')
    const logs = []
    t('--freeze через bootstrap: код 0', await bootstrap(['--freeze', target], { log: (l) => logs.push(l), error: () => {} }), 0)
    t('--freeze: файл и .sha256 созданы', existsSync(target) && existsSync(`${target}.sha256`), true)
    const frozen = JSON.parse(readFileSync(target, 'utf8'))
    t('--freeze: карточка проходит проверку с диском', assertTaxonomySchemaCard(frozen, { repoRoot: REPO }), true)
    t('--freeze: sha256-файл совпадает с байтами', readFileSync(`${target}.sha256`, 'utf8').split(' ')[0], cardDigestOf(readFileSync(target)).replace('sha256:', ''))
    has('--freeze: повторная заморозка в тот же файл — отказ', await boom(() => cli(['--freeze', target], { log: () => {} })), 'уже существует')
    const vlogs = []
    t('--verify через bootstrap: код 0', await bootstrap(['--verify', target], { log: (l) => vlogs.push(l), error: () => {} }), 0)
    has('--verify: печатает отпечаток', vlogs.join('\n'), cardDigestOf(readFileSync(target)))
    let imported = 0
    const errs = []
    const stale = JSON.parse(readFileSync(target, 'utf8')); stale.modules['scripts/poi-schema/taxonomy-schema-cli.mjs'] = 'sha256:' + 'a'.repeat(64)
    const stalePath = path.join(dir, 'stale.json'); writeFileSync(stalePath, JSON.stringify(stale))
    t('bootstrap с устаревшей карточкой: код 1', await bootstrap(['--execute', stalePath, '--approval', 'x'], { error: (l) => errs.push(l), importCli: async () => { imported += 1; return { main: async () => 0 } } }), 1)
    t('bootstrap с устаревшей карточкой: CLI не импортирован', imported, 0)
    has('bootstrap: отказ называет CLI', errs.join('\n'), 'taxonomy-schema-cli.mjs: на диске')
    t('bootstrap без режима — код 2', await bootstrap([], { error: () => {} }), 2)
  }

  /* ── 12. R3-1: единый срок на весь обмен — заголовки И тело ──────────── */
  {
    const tick = () => new Promise((r) => setImmediate(r))
    // (а) Успешный обмен: срок ставится один раз и снимается — таймеров не остаётся.
    const timers = fakeTimers()
    const okFx = fakeAirtable({ timers })
    await okFx.transport.readSchema()
    t('успешный обмен: срок снят, таймеров не осталось', timers.armed, 0)
    t('срок обмена задан и положителен', okFx.transport.deadlineMs, DEFAULT_EXCHANGE_DEADLINE_MS)
    has('нулевой срок — отказ конструктора', await boom(() => createMetaTransport({ token: 't', fetchImpl: okFx.fetchImpl, deadlineMs: 0 })), 'deadlineMs')
    // (б) GET зависает ДО заголовков: срок обрывает обмен именованной причиной.
    const t1 = fakeTimers()
    const fxH = fakeAirtable({ timers: t1, readFails: () => 'hangHeaders' })
    const pH = settled(fxH.transport.readSchema())
    await tick()
    t('GET висит до заголовков: срок взведён', t1.armed, 1)
    t1.fireAll()
    const rH = await pH
    t('GET до заголовков: обмен завершился, процесс не удержан', rH !== 'НЕ ЗАВЕРШИЛОСЬ', true)
    const eH = rH?.error ?? {}
    t('GET до заголовков: отказ — SchemaReadError', eH instanceof SchemaReadError, true)
    t('GET до заголовков: причина readTimeout', eH.cause, 'readTimeout')
    has('GET до заголовков: сказано, что срок истёк до заголовков', eH.message ?? '', 'до заголовков')
    t('GET до заголовков: обмен прерван сигналом', fxH.calls[0].signal?.aborted, true)
    // (в) GET зависает НА ТЕЛЕ: тот же срок покрывает и чтение тела.
    const t2 = fakeTimers()
    const fxB = fakeAirtable({ timers: t2, readFails: () => 'hangBody' })
    const pB = settled(fxB.transport.readSchema())
    await tick(); await tick()
    t2.fireAll()
    const rB = await pB
    t('GET на теле: обмен завершился', rB !== 'НЕ ЗАВЕРШИЛОСЬ', true)
    const eB = rB?.error ?? {}
    t('GET на теле: отказ — SchemaReadError', eB instanceof SchemaReadError, true)
    t('GET на теле: причина readTimeout', eB.cause, 'readTimeout')
    has('GET на теле: срок покрывает чтение тела', eB.message ?? '', 'на теле')
    // (г) POST зависает до заголовков: неопределённость, а не отказ и не успех.
    const t3 = fakeTimers()
    const fxP = fakeAirtable({ timers: t3, onPost: () => 'hangHeaders' })
    const pP = settled(fxP.transport.createField(bodies[0]))
    await tick()
    t3.fireAll()
    const wrP = await pP
    t('POST до заголовков: обмен завершился, процесс не удержан', wrP !== 'НЕ ЗАВЕРШИЛОСЬ', true)
    const rP = wrP?.value ?? {}
    t('POST до заголовков: kind ambiguous', rP.kind, 'ambiguous')
    has('POST до заголовков: исход устанавливается только чтением', rP.reason ?? '', 'эффект устанавливается только чтением')
    // (д) POST зависает на теле: тоже неопределённость.
    const t4 = fakeTimers()
    const fxPB = fakeAirtable({ timers: t4, onPost: () => 'hangBody' })
    const pPB = settled(fxPB.transport.createField(bodies[0]))
    await tick(); await tick()
    t4.fireAll()
    const wrPB = await pPB
    t('POST на теле: обмен завершился, процесс не удержан', wrPB !== 'НЕ ЗАВЕРШИЛОСЬ', true)
    t('POST на теле: kind ambiguous', wrPB?.value?.kind, 'ambiguous')
    // (е) Полный прогон: истёкший POST без эффекта — notApplied по чтению, без повтора.
    const fxRun = fakeAirtable({ deadlineMs: 5, onPost: (b) => (b.name === 'POI Facets' ? 'hangHeaders' : 'applied') })
    const wRun = await settled(run(fxRun, { transport: fxRun.transport }), 8000)
    t('истёкший POST без эффекта: прогон завершился', wRun !== 'НЕ ЗАВЕРШИЛОСЬ', true)
    const rRun = wRun?.value ?? {}
    t('истёкший POST без эффекта: stopped на втором поле', rRun.stoppedAt, 'POI Facets')
    t('истёкший POST без эффекта: два POST, без повтора', posts(fxRun), 2)
    t('истёкший POST: исход установлен чтением (notApplied)', (await safe(() => readSchemaJournal(rRun.journal).records, [])).some((x) => x.kind === 'outcome' && x.field === 'POI Facets' && x.result === 'notApplied' && x.establishedBy === 'read'), true)
    // (ж) Истёкший POST, но эффект БЫЛ (зависло на теле): чтение видит поле — applied, исполнение идёт дальше.
    const fxRun2 = fakeAirtable({ deadlineMs: 5, onPost: (b) => (b.name === 'POI Facets' ? 'hangBody' : 'applied') })
    const wRun2 = await settled(run(fxRun2, { transport: fxRun2.transport }), 8000)
    t('истёкший POST при эффекте: прогон завершился', wRun2 !== 'НЕ ЗАВЕРШИЛОСЬ', true)
    const rRun2 = wRun2?.value ?? {}
    t('истёкший POST при фактическом эффекте: allApplied по чтению', rRun2.outcome, 'allApplied')
    t('истёкший POST при эффекте: POST не повторялся', posts(fxRun2), 4)
    // (з) Зависшее чтение ПОСЛЕ отправленного POST: именованный unknown, не вечное ожидание.
    const fxRun3 = fakeAirtable({ deadlineMs: 5, readFails: (calls) => (calls.filter((c) => c.method === 'POST').length >= 1 ? 'hangHeaders' : false) })
    const wRun3 = await settled(run(fxRun3, { transport: fxRun3.transport }), 8000)
    t('зависшее чтение после POST: прогон завершился именованным исходом, а не исключением', typeof wRun3?.value, 'object')
    const rRun3 = wRun3?.value ?? {}
    t('зависшее чтение после POST: outcome unknown', rRun3.outcome, 'unknown')
    t('зависшее чтение после POST: требуется восстановление', rRun3.recoveryRequired, true)
    t('зависшее чтение после POST: причина названа readTimeout', rRun3.cause, 'readTimeout')
    t('зависшее чтение после POST: журнал закрыт unknown', (await safe(() => readSchemaJournal(rRun3.journal).outcome)), 'unknown')
  }

  /* ── 13. R3-2: форма ответа схемы проверяется до использования ────────── */
  {
    const good = { tables: [{ id: POI_TABLE_ID, name: 'POI', fields: [{ id: 'fld1', name: 'POI Type', type: 'singleSelect', options: { choices: [{ name: 'castle' }] } }] }] }
    t('годный ответ разбирается', parseSchemaTables(good)[0].fields[0].name, 'POI Type')
    t('разбор возвращает только ожидаемую форму', JSON.stringify(parseSchemaTables({ tables: [{ id: 'tbl1', name: 'X', fields: [], secret: 1 }] })), JSON.stringify([{ id: 'tbl1', name: 'X', fields: [] }]))
    const corrupt = [
      ['корень не объект', 'ожидается объект', null],
      ['tables не массив', 'tables: ожидается массив', { tables: {} }],
      ['таблица не объект', 'tables[0]: ожидается объект', { tables: ['x'] }],
      ['таблица без id', 'tables[0].id', { tables: [{ name: 'POI', fields: [] }] }],
      ['fields не массив', 'tables[0].fields: ожидается массив', { tables: [{ id: 'a', name: 'POI', fields: 'нет' }] }],
      ['поле без типа', 'fields[0].type', { tables: [{ id: 'a', name: 'POI', fields: [{ id: 'f', name: 'n' }] }] }],
      ['options не объект', 'options: ожидается объект', { tables: [{ id: 'a', name: 'POI', fields: [{ id: 'f', name: 'n', type: 'singleSelect', options: 7 }] }] }],
      ['options.choices не массив', 'options.choices: ожидается массив', { tables: [{ id: 'a', name: 'POI', fields: [{ id: 'f', name: 'n', type: 'singleSelect', options: { choices: 'corrupt' } }] }] }],
      ['опция без name', 'options.choices[0]', { tables: [{ id: 'a', name: 'POI', fields: [{ id: 'f', name: 'n', type: 'singleSelect', options: { choices: [{}] } }] }] }],
      ['description не строка', 'description: ожидается строка', { tables: [{ id: 'a', name: 'POI', fields: [{ id: 'f', name: 'n', type: 'singleSelect', description: 5 }] }] }],
    ]
    for (const [label, needle, payload] of corrupt) {
      const err = await boom(() => parseSchemaTables(payload))
      has(`повреждение «${label}» названо адресно`, err, needle)
    }
    t('повреждение — SchemaReadError с причиной schemaCorrupt', (() => { try { parseSchemaTables({ tables: {} }) } catch (e) { return e instanceof SchemaReadError && e.cause === 'schemaCorrupt' } })(), true)
    // Повреждение приходит ПОСЛЕ первого отправленного POST: именованный исход, закрытый журнал, без исключения наружу.
    const fx = fakeAirtable({ corruptRead: (calls) => (calls.filter((c) => c.method === 'POST').length >= 1 ? (tables) => { tables[0].fields[0].options = { choices: 'corrupt' } } : null) })
    let thrown = null
    let r = null
    try { r = await run(fx, { transport: fx.transport }) } catch (e) { thrown = e }
    t('повреждение после POST: исключение наружу НЕ выброшено', thrown, null)
    t('повреждение после POST: исход unknown', r?.outcome, 'unknown')
    t('повреждение после POST: причина schemaCorrupt', r?.cause, 'schemaCorrupt')
    t('повреждение после POST: требуется восстановление', r?.recoveryRequired, true)
    t('повреждение после POST: один POST, без повтора', posts(fx), 1)
    const j = await safe(() => readSchemaJournal(r?.journal ?? journalPathFor(cardDigestOf(bytes), path.join(dir, 'нет'))), { closed: false, outcome: null, records: [] })
    t('повреждение после POST: журнал закрыт (терминальное состояние есть)', j.closed, true)
    t('повреждение после POST: журнал закрыт unknown', j.outcome, 'unknown')
    t('повреждение после POST: outcome unknown записан с причиной', (j.records ?? []).some((x) => x.kind === 'outcome' && x.result === 'unknown' && x.cause === 'schemaCorrupt'), true)
    // Повреждение ДО первого POST — отказ предполёта, без журнала и без POST.
    const fx2 = fakeAirtable({ corruptRead: () => (tables) => { tables[0].fields = 'нет' } })
    const jr = path.join(dir, 'j-corrupt-pre')
    has('повреждение до POST: отказ предполёта', await boom(() => run(fx2, { transport: fx2.transport, journalRoot: jr })), 'предполёт: живая схема не прочитана (schemaCorrupt)')
    t('повреждение до POST: ни одного POST', posts(fx2), 0)
    t('повреждение до POST: журнал не создан', existsSync(journalPathFor(cardDigestOf(bytes), jr)), false)
  }

  /* ── 14. R3-3: четыре подтверждены, недоступна ТОЛЬКО последняя сверка ── */
  {
    // GET-и при полном прогоне: 1 предполёт, затем на каждое поле «до» и «после» (8), затем 10-й — заключительная сверка.
    const fx = fakeAirtable({ readFails: (calls) => calls.filter((c) => c.method === 'GET').length === 10 })
    const r = await safe(() => run(fx, { transport: fx.transport }), {})
    t('недоступна только последняя сверка: терминал pendingFinalWitness', r.outcome, 'pendingFinalWitness')
    t('недоступна только последняя сверка: это НЕ обычная остановка', r.outcome === 'stopped', false)
    t('недоступна только последняя сверка: требуется восстановление', r.recoveryRequired, true)
    t('недоступна только последняя сверка: четыре поля подтверждены', r.applied.join(','), NAMES.join(','))
    t('недоступна только последняя сверка: четыре POST, без повтора', posts(fx), 4)
    has('терминал объясняет путь завершения', r.reason, 'verdictFromJournal')
    const journal = await safe(() => readSchemaJournal(r.journal), { records: [], outcome: null })
    t('журнал закрыт терминалом pendingFinalWitness', journal.outcome, 'pendingFinalWitness')
    t('журнал: все четыре исхода applied установлены чтением', journal.records.filter((x) => x.kind === 'outcome' && x.result === 'applied' && x.establishedBy === 'read').length, 4)
    t('журнал: записи «stopped» нет', journal.records.some((x) => x.kind === 'stopped'), false)
    const approval = approvalFor(bytes, card)
    // Немедленный gate такой журнал не принимает: заключительная сверка не проведена.
    t('немедленный gate: pendingFinalWitness не принимается', finalGate({ cardBytes: bytes, approval, journal, witness: { verifiedSuccess: true } }).verifiedSuccess, false)
    has('немедленный gate называет причину', finalGate({ cardBytes: bytes, approval, journal, witness: { verifiedSuccess: true } }).journal, 'ожидался allApplied')
    // ПОЗЖЕ: тот же неизменяемый журнал + НОВОЕ живое свидетельство → вердикт, без единого POST.
    const postsBefore = posts(fx)
    const witness = await witnessTaxonomySchema({ fetchImpl: fx.fetchImpl, cardBytes: bytes })
    const verdict = verdictFromJournal({ cardBytes: bytes, approval, journal, witness, at: NOW })
    t('поздний вердикт: verifiedSuccess', verdict.verifiedSuccess, true)
    t('поздний вердикт: терминал назван', verdict.terminal, 'pendingFinalWitness')
    t('поздний вердикт: установлен журналом и новым свидетелем', verdict.establishedBy, 'immutableJournal+freshWitness')
    t('поздний вердикт: ни одного нового POST', posts(fx) - postsBefore, 0)
    t('поздний вердикт: журнал не дописан', (await safe(() => readSchemaJournal(r.journal).records.length)), journal.records.length)
    t('терминалы, допустимые к вердикту', VERDICT_ELIGIBLE_OUTCOMES.join(','), 'allApplied,pendingFinalWitness')
    // Вердикт отказывает, если свежий свидетель видит дрейф.
    fx.state.fields[0].options.choices.pop()
    const drifted = await witnessTaxonomySchema({ fetchImpl: fx.fetchImpl, cardBytes: bytes })
    t('поздний вердикт при дрейфе у свидетеля — отказ', verdictFromJournal({ cardBytes: bytes, approval, journal, witness: drifted }).verifiedSuccess, false)
    // Вердикт отказывает подделанному журналу даже при годном свидетеле.
    const forgedRoot = path.join(dir, 'j-verdict-forged')
    const fj = openSchemaJournal({ cardDigest: cardDigestOf(bytes), now: clock(), root: forgedRoot, opened: { cardId: card.cardId, approvalDigest: approvalDigestOf(approval), fields: NAMES } })
    fj.close({ outcome: 'pendingFinalWitness', applied: NAMES })
    const forged = readSchemaJournal(fj.file)
    t('поздний вердикт: подделка opened+closed(pending) — отказ', verdictFromJournal({ cardBytes: bytes, approval, journal: forged, witness: { verifiedSuccess: true } }).verifiedSuccess, false)
    // Вердикт отказывает, если терминал — обычная остановка.
    const stoppedFx = fakeAirtable({ onPost: (b) => (b.name === 'POI Facets' ? 'refused' : 'applied') })
    const rs = await safe(() => run(stoppedFx, { transport: stoppedFx.transport }), {})
    t('поздний вердикт: терминал stopped — отказ', (await safe(() => verdictFromJournal({ cardBytes: bytes, approval, journalFile: rs.journal, witness: { verifiedSuccess: true } }).verifiedSuccess)), false)
  }

  /* ── 15. R3-4: точка входа — ссылки, пробелы, URL-кодирование ─────────── */
  {
    const runner = path.join(REPO, 'scripts/poi-schema/run-taxonomy-schema.mjs')
    t('isDirectEntry: сам файл — точка входа', isDirectEntry(runner), true)
    t('isDirectEntry: другой файл — нет', isDirectEntry(path.join(REPO, 'package.json')), false)
    t('isDirectEntry: пустой argv1 — нет', isDirectEntry(undefined), false)
    t('isDirectEntry: несуществующий путь — нет', isDirectEntry(path.join(REPO, 'нет-такого.mjs')), false)
    {
      // Физически эквивалентные, но текстуально разные пути: ссылка на сам файл,
      // относительный путь, путь с точечными сегментами. Проверяются ОБЕ стороны
      // сравнения: и argv, и URL самого модуля.
      const linkDir = mkdtempSync(path.join(tmpdir(), 'jj-entry-link-'))
      try {
        const linked = path.join(linkDir, 'runner link.mjs')
        symlinkSync(runner, linked, 'file')
        t('isDirectEntry: ссылка на сам файл (и пробел в имени) — точка входа', isDirectEntry(linked), true)
        t('isDirectEntry: URL модуля через ссылку — точка входа', isDirectEntry(runner, pathToFileURL(linked).href), true)
        t('isDirectEntry: путь с ../ — точка входа', isDirectEntry(path.join(REPO, 'scripts', '..', 'scripts/poi-schema/run-taxonomy-schema.mjs')), true)
      } finally { rmSync(linkDir, { recursive: true, force: true }) }
    }
    const sb = mkdtempSync(path.join(tmpdir(), 'jj-entry-'))
    try {
      const real = path.join(sb, 'tree')
      for (const rel of ['src/lib', 'config', 'scripts/lib', 'scripts/poi-schema']) { mkdirSync(path.dirname(path.join(real, rel)), { recursive: true }); cpSync(path.join(REPO, rel), path.join(real, rel), { recursive: true }) }
      writeFileSync(path.join(real, 'package.json'), '{"type":"module"}')
      symlinkSync(path.join(REPO, 'node_modules'), path.join(real, 'node_modules'), 'dir')
      const link = path.join(sb, 'link'); symlinkSync(real, link, 'dir')
      const spaced = path.join(sb, 'дерево с пробелом и %20'); cpSync(real, spaced, { recursive: true, verbatimSymlinks: true })
      const probe = (base) => {
        const entry = path.join(base, 'scripts/poi-schema/run-taxonomy-schema.mjs')
        try {
          execFileSync(process.execPath, [entry], { cwd: base, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
          return { code: 0, err: '' }
        } catch (e) { return { code: e.status ?? -1, err: String(e.stderr ?? '') } }
      }
      for (const [label, base] of [['обычный путь', real], ['символическая ссылка', link], ['пробел и %20 в пути', spaced]]) {
        const p = probe(base)
        t(`${label}: main вызван — код относится к проверке аргументов, а не к пустому процессу`, p.code, 2)
        has(`${label}: main напечатал использование`, p.err, 'использование:')
      }
      // Тот же путь с настоящей карточкой: --verify через ссылку доходит до сверки цепочки.
      const cardPath = path.join(real, 'card.json')
      execFileSync(process.execPath, [path.join(link, 'scripts/poi-schema/run-taxonomy-schema.mjs'), '--freeze', cardPath], { cwd: link, stdio: 'pipe' })
      t('через ссылку: --freeze дошёл до CLI и записал карточку', existsSync(cardPath), true)
      const out = execFileSync(process.execPath, [path.join(link, 'scripts/poi-schema/run-taxonomy-schema.mjs'), '--verify', cardPath], { cwd: link, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      has('через ссылку: --verify выполнил настоящую сверку', out, 'совпадает с диском')
    } finally { rmSync(sb, { recursive: true, force: true }) }
  }

  /* ── 16. R3-5: независимый свидетель и контракт description ───────────── */
  {
    const witnessSrc = readFileSync(path.join(REPO, 'scripts/poi-schema/taxonomy-schema-witness.mjs'), 'utf8')
    t('свидетель не импортирует классификацию исполнителя (state)', /from\s+['"][^'"]*taxonomy-schema-state/.test(witnessSrc), false)
    t('свидетель не импортирует исполнителя', /from\s+['"][^'"]*taxonomy-schema-execute/.test(witnessSrc), false)
    t('свидетель не читает транспортом исполнителя', /createMetaTransport/.test(witnessSrc), false)
    t('свидетель классифицирует своим кодом (classifyWitness, счётом вхождений)', /classifyWitness/.test(witnessSrc) && !/assertQuartetState/.test(witnessSrc), true)
    t('свидетель требует собственный fetchImpl', typeof (await boom(() => witnessTaxonomySchema({ cardBytes: bytes }))), 'string')
    has('свидетель без fetchImpl — отказ', await boom(() => witnessTaxonomySchema({ cardBytes: bytes })), 'свидетель читает сам')
    // Согласованная ошибка ОБЩЕЙ функции классификации: в копии дерева fieldMatchesBody перестаёт смотреть на опции.
    const sb = mkdtempSync(path.join(tmpdir(), 'jj-shared-bug-'))
    try {
      for (const rel of ['src/lib', 'config', 'scripts/lib', 'scripts/poi-schema']) { mkdirSync(path.dirname(path.join(sb, rel)), { recursive: true }); cpSync(path.join(REPO, rel), path.join(sb, rel), { recursive: true }) }
      writeFileSync(path.join(sb, 'package.json'), '{"type":"module"}')
      symlinkSync(path.join(REPO, 'node_modules'), path.join(sb, 'node_modules'), 'dir')
      const stateFile = path.join(sb, 'scripts/poi-schema/taxonomy-schema-state.mjs')
      const src = readFileSync(stateFile, 'utf8')
      const weak = src.replace('const want = body.options?.choices?.map((c) => c.name) ?? null', 'const want = null')
      t('якорь общей функции классификации найден', weak !== src, true)
      writeFileSync(stateFile, weak)
      writeFileSync(path.join(sb, 'probe.mjs'), `
        import { pathToFileURL } from 'node:url'
        const m = (p) => import(pathToFileURL(process.cwd() + '/' + p).href)
        const cardMod = await m('scripts/poi-schema/taxonomy-schema-card.mjs')
        const execMod = await m('scripts/poi-schema/taxonomy-schema-execute.mjs')
        const trMod = await m('scripts/poi-schema/taxonomy-schema-transport.mjs')
        const jMod = await m('scripts/poi-schema/taxonomy-schema-journal.mjs')
        const wMod = await m('scripts/poi-schema/taxonomy-schema-witness.mjs')
        const gMod = await m('scripts/poi-schema/taxonomy-schema-gate.mjs')
        const card = cardMod.buildTaxonomySchemaCard({ preparedAt: '2026-09-03T00:00:00.000Z' })
        const cardBytes = Buffer.from(JSON.stringify(card, null, 2) + '\\n', 'utf8')
        const approval = { contractVersion: cardMod.TAXONOMY_SCHEMA_APPROVAL_SPEC, cardDigest: cardMod.cardDigestOf(cardBytes), cardId: card.cardId, decisionRef: 'owner/2026-09-03#schema', approver: 'владелец', approvedAt: '2026-09-03T09:00:00.000Z', validUntil: '2026-09-10T00:00:00.000Z' }
        let ms = Date.parse('2026-09-03T10:00:00.000Z'); const now = () => { ms += 1000; return new Date(ms).toISOString() }
        const state = { fields: [], nextId: 1 }
        const fetchImpl = async (url, init = {}) => {
          const method = init.method ?? 'GET'
          if (method === 'GET') { const payload = { tables: [{ id: '${POI_TABLE_ID}', name: 'POI', fields: JSON.parse(JSON.stringify(state.fields)) }] }; return { ok: true, status: 200, text: async () => JSON.stringify(payload) } }
          const body = JSON.parse(init.body); const id = 'fld' + state.nextId++
          state.fields.push({ id, name: body.name, type: body.type, description: body.description, ...(body.options ? { options: { choices: [{ name: 'wrong_option' }] } } : {}) })
          return { ok: true, status: 200, text: async () => JSON.stringify({ id }) }
        }
        const transport = trMod.createMetaTransport({ token: 'tok', fetchImpl })
        const r = await execMod.executeTaxonomySchemaCard({ cardBytes, approval, transport, now, repoRoot: process.cwd(), journalRoot: process.argv[2] })
        const journal = jMod.readSchemaJournal(r.journal)
        const witness = await wMod.witnessTaxonomySchema({ fetchImpl, cardBytes })
        const gate = gMod.finalGate({ cardBytes, approval, journal, witness })
        console.log(JSON.stringify({ executor: r.outcome, witness: witness.verifiedSuccess, gate: gate.verifiedSuccess, reason: witness.reason }))
      `)
      const out = execFileSync(process.execPath, ['probe.mjs', path.join(sb, 'journal')], { cwd: sb, encoding: 'utf8' })
      const res = JSON.parse(out.trim().split('\n').pop())
      t('согласованная ошибка: ослабленный исполнитель доводит до конца', res.executor, 'allApplied')
      t('согласованная ошибка: НЕЗАВИСИМЫЙ свидетель её ловит', res.witness, false)
      t('согласованная ошибка: gate отказывает', res.gate, false)
      has('согласованная ошибка: свидетель называет расхождение опций', res.reason, 'wrong_option')
    } finally { rmSync(sb, { recursive: true, force: true }) }
    // Контракт description: объявлен явно и НЕ входит в проверяемое состояние.
    t('карточка называет проверяемые свойства', Array.isArray(card.scope.verifiedProperties) && card.scope.verifiedProperties.length > 0, true)
    t('карточка называет непроверяемые свойства', Array.isArray(card.scope.unverifiedProperties), true)
    t('description объявлен непроверяемым', card.scope.unverifiedProperties.some((x) => /description/.test(x)), true)
    t('description не объявлен проверяемым', card.scope.verifiedProperties.some((x) => /description/.test(x)), false)
    has('карточка объясняет границу без «точного совпадения»', card.scope.unverifiedProperties.join(' '), 'не обещается')
    has('карточка: description посылается при создании', card.fields[0].request.body.description, 'реестра таксономии')
    // Живой description разошёлся с карточкой: состояние остаётся авторизованным — и это сказано явно.
    const fxD = fakeAirtable({ description: () => 'кто-то переписал подпись в интерфейсе' })
    const rD = await run(fxD, { transport: fxD.transport })
    t('чужой description: исполнитель доводит до allApplied', rD.outcome, 'allApplied')
    const wD = await witnessTaxonomySchema({ fetchImpl: fxD.fetchImpl, cardBytes: bytes })
    t('чужой description: свидетель подтверждает — description вне состояния', wD.verifiedSuccess, true)
    t('чужой description: gate подтверждает', finalGate({ cardBytes: bytes, approval: approvalFor(bytes, card), journal: readSchemaJournal(rD.journal), witness: wD }).verifiedSuccess, true)
    // А вот опции — внутри состояния, и их подмена вердикт роняет.
    const fxO = fakeAirtable({ description: (b) => b.description })
    const rO = await run(fxO, { transport: fxO.transport })
    fxO.state.fields[1].options.choices.push({ name: 'самовольная_опция' })
    const wO = await witnessTaxonomySchema({ fetchImpl: fxO.fetchImpl, cardBytes: bytes })
    t('лишняя опция: свидетель отказывает (опции — внутри состояния)', wO.verifiedSuccess, false)
    has('лишняя опция названа', wO.reason, 'самовольная_опция')
    t('лишняя опция: gate отказывает', finalGate({ cardBytes: bytes, approval: approvalFor(bytes, card), journal: readSchemaJournal(rO.journal), witness: wO }).verifiedSuccess, false)
  }

  /* ── 17. R4-1: свидетель проверяет форму сам, считает вхождения; gate не верит флагу ── */
  {
    // Свидетель, читающий подменный fetchImpl, отдающий произвольные таблицы.
    const witnessOn = (tables) => witnessTaxonomySchema({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ tables }) }), cardBytes: bytes })
    const full = () => [{ id: POI_TABLE_ID, name: 'POI', fields: bodies.map((b, i) => liveFieldOf(b, `fld${i}`)) }]
    // Годная схема: четыре fieldId, без неоднозначности.
    const wGood = await witnessOn(full())
    t('годная схема: verifiedSuccess', wGood.verifiedSuccess, true)
    t('годная схема: ровно четыре fieldId', wGood.fieldIds.length, 4)
    t('годная схема: не неоднозначна', wGood.ambiguous, false)
    // Находка: ПОСЛЕ allApplied появился второй идентичный POI Type — пять полей.
    const dupField = full(); dupField[0].fields.push({ ...JSON.parse(JSON.stringify(dupField[0].fields[0])), id: 'fldDUP' })
    const wDup = await witnessOn(dupField)
    t('дубль POI Type: verifiedSuccess=false', wDup.verifiedSuccess, false)
    t('дубль POI Type: помечено неоднозначным', wDup.ambiguous, true)
    t('дубль POI Type: НЕ пять fieldId', wDup.fieldIds.length, 0)
    has('дубль POI Type: причина названа', wDup.reason, 'присутствует 2 раза')
    // finalGate по журналу настоящего исполнителя + этот свидетель — ОТКАЗ (даже если бы флаг лгал).
    const fxRun = fakeAirtable()
    const rRun = await run(fxRun, { transport: fxRun.transport })
    const journal = readSchemaJournal(rRun.journal)
    const approval = approvalFor(bytes, card)
    t('gate: пять полей (дубль) — отказ', finalGate({ cardBytes: bytes, approval, journal, witness: wDup }).verifiedSuccess, false)
    // Подделанный флаг: verifiedSuccess=true, но fieldIds=5 — gate independently ловит.
    const lyingFive = { verifiedSuccess: true, tableId: POI_TABLE_ID, reason: null, ambiguous: false, fieldIds: ['a', 'b', 'c', 'd', 'e'] }
    t('gate: свидетель врёт «true» при пяти fieldId — отказ', finalGate({ cardBytes: bytes, approval, journal, witness: lyingFive }).verifiedSuccess, false)
    has('gate: причина — не четыре fieldId', finalGate({ cardBytes: bytes, approval, journal, witness: lyingFive }).witness, 'ожидается ровно четыре')
    const lyingAmbiguous = { verifiedSuccess: true, tableId: POI_TABLE_ID, reason: 'дубль', ambiguous: true, fieldIds: ['a', 'b', 'c', 'd'] }
    t('gate: свидетель врёт «true» при ambiguous — отказ', finalGate({ cardBytes: bytes, approval, journal, witness: lyingAmbiguous }).verifiedSuccess, false)
    t('witnessProblem: пять fieldId — проблема', typeof witnessProblem(lyingFive), 'string')
    t('witnessProblem: ambiguous — проблема', typeof witnessProblem(lyingAmbiguous), 'string')
    t('witnessProblem: годный свидетель — null', witnessProblem(wGood), null)
    // Дубль КАНОНИЧЕСКОЙ таблицы по ID — неоднозначность.
    const dupTable = [...full(), { ...JSON.parse(JSON.stringify(full()[0])) }]
    const wDupT = await witnessOn(dupTable)
    t('дубль таблицы по ID: verifiedSuccess=false', wDupT.verifiedSuccess, false)
    t('дубль таблицы по ID: неоднозначно', wDupT.ambiguous, true)
    has('дубль таблицы: причина', wDupT.reason, 'присутствует 2 раза')
    // Дубль ИМЕНИ таблицы (чужой ID) — неоднозначность.
    const dupName = [...full(), { id: 'tblOTHER', name: 'POI', fields: [] }]
    const wDupN = await witnessOn(dupName)
    t('дубль имени таблицы: неоднозначно', wDupN.ambiguous, true)
    has('дубль имени таблицы: причина', wDupN.reason, 'носят 2 таблицы')
    // Дубль ID поля в таблице — неоднозначность.
    const dupId = full(); dupId[0].fields.push({ ...dupId[0].fields[1], id: dupId[0].fields[0].id })
    const wDupId = await witnessOn(dupId)
    t('дубль ID поля: неоднозначно', wDupId.ambiguous, true)
    has('дубль ID поля: причина', wDupId.reason, 'ID полей повторяются')
    // Дубль select-опции — неоднозначность (Set бы схлопнул).
    const dupOpt = full(); dupOpt[0].fields[0].options.choices.push({ name: dupOpt[0].fields[0].options.choices[0].name })
    const wDupOpt = await witnessOn(dupOpt)
    t('дубль опции: verifiedSuccess=false', wDupOpt.verifiedSuccess, false)
    t('дубль опции: неоднозначно', wDupOpt.ambiguous, true)
    has('дубль опции: причина — повтор опции', wDupOpt.reason, 'опции повторяются')
    // classifyWitness — чистая функция: Set сравнил бы длины и принял дубль. Счёт — нет.
    t('classifyWitness: дубль опции ловится счётом, а не Set', classifyWitness(dupOpt, card).ambiguous, true)
    t('classifyWitness: годная схема принята', classifyWitness(full(), card).verifiedSuccess, true)
    // Malformed response — ИМЕНОВАННЫЙ отрицательный вердикт, не исключение.
    const malformedCases = [
      ['корень не объект', 42, 'корень'],
      ['tables не массив', { tables: 'нет' }, 'tables: ожидается массив'],
      ['fields не массив', { tables: [{ id: 'a', name: 'POI', fields: 7 }] }, 'fields: ожидается массив'],
      ['опция без name', { tables: [{ id: POI_TABLE_ID, name: 'POI', fields: [{ id: 'f', name: 'POI Type', type: 'singleSelect', options: { choices: [{}] } }] }] }, 'options.choices[0]'],
      ['choices не массив', { tables: [{ id: POI_TABLE_ID, name: 'POI', fields: [{ id: 'f', name: 'POI Type', type: 'singleSelect', options: { choices: 'x' } }] }] }, 'options.choices: ожидается массив'],
    ]
    for (const [label, data, needle] of malformedCases) {
      const w = await safe(() => witnessTaxonomySchema({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(data) }), cardBytes: bytes }), { threw: true })
      t(`malformed «${label}»: НЕ исключение`, w.threw ? 'исключение' : 'вердикт', 'вердикт')
      t(`malformed «${label}»: verifiedSuccess=false`, w.verifiedSuccess, false)
      has(`malformed «${label}»: причина названа адресно`, w.reason ?? '', needle)
      has(`shapeProblem «${label}» называет адрес`, shapeProblem(data) ?? '', needle)
    }
    t('shapeProblem: годная форма — null', shapeProblem({ tables: full() }), null)
    // Свидетель НИКОГДА не бросает, даже если fetchImpl отдаёт мусор.
    const wThrows = await safe(() => witnessTaxonomySchema({ fetchImpl: async () => { throw new Error('провод лёг') }, cardBytes: bytes }), { threw: true })
    t('свидетель при броске провода: именованный вердикт, не исключение', wThrows.threw ? 'исключение' : 'вердикт', 'вердикт')
    t('свидетель при броске провода: verifiedSuccess=false', wThrows.verifiedSuccess, false)
  }

  /* ── 17б. R4-2: защита НА УРОВНЕ ТРАНСПОРТА — враждебный fetchImpl не выпускает исключение ── */
  {
    const revoked = () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy }
    const hostileFetches = [
      ['fetch бросает', async () => { throw new Error('провод лёг') }],
      ['fetch бросает не-Error', async () => { throw 7 }],
      ['fetch возвращает отозванный Proxy', async () => revoked()],
      ['ответ с бросающим геттером status', async () => ({ get status() { throw new Error('status бросил') }, text: async () => '{}' })],
      ['ответ, чей text() отклоняется', async () => ({ status: 200, text: async () => { throw new Error('тело лопнуло') } })],
      ['ответ, чей text() — отозванный Proxy', async () => ({ status: 200, text: async () => revoked() })],
    ]
    for (const [label, fetchImpl] of hostileFetches) {
      const transport = createMetaTransport({ token: 'tok', fetchImpl, deadlineMs: 500 })
      const r = await safe(() => transport.createField(bodies[0]), { threw: true })
      t(`транспорт: createField при «${label}» НЕ бросает`, r.threw ? 'исключение' : 'значение', 'значение')
      t(`транспорт: createField при «${label}» → ambiguous`, r.kind, 'ambiguous')
      // readSchema тоже не выпускает СЫРОЕ исключение — только именованный SchemaReadError с причиной.
      const rr = await safe(() => transport.readSchema(), { threw: true })
      t(`транспорт: readSchema при «${label}» бросает только SchemaReadError`, rr.threw && rr.thrown instanceof SchemaReadError && READ_FAILURE_CAUSES.includes(rr.thrown.cause), true)
    }
  }

  /* ── 18. R4-2: любое исключение после входа в границу POST — не покидает executor ── */
  {
    // Транспорт, у которого createField ведёт себя враждебно на ВТОРОМ поле; readSchema настоящий.
    const hostileOn = (secondFieldName, createFieldForSecond, { effect = false } = {}) => {
      const fx = fakeAirtable()
      return {
        fx,
        transport: {
          readSchema: () => fx.transport.readSchema(),
          createField: async (body) => {
            if (body.name === secondFieldName) {
              if (effect) await fx.transport.createField(body) // эффект произошёл, но ответ враждебен
              return createFieldForSecond(body)
            }
            return fx.transport.createField(body)
          },
        },
      }
    }
    const revoked = () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy }
    const hostiles = [
      ['отклонение отозванным Proxy', () => { throw revoked() }],
      ['возврат отозванного Proxy', () => revoked()],
      ['отклонение не-Error числом', () => { throw 7 }],
      ['отклонение undefined', () => { throw undefined }],
      ['возврат null', () => null],
      ['возврат объекта с бросающим геттером kind', () => ({ get kind() { throw new Error('kind бросил') } })],
      ['возврат нераспознанного kind', () => ({ kind: 'teleported' })],
    ]
    for (const [label, createFieldForSecond] of hostiles) {
      // Без эффекта: свежее чтение видит, что поля нет → notApplied → stopped, без повтора.
      const h = hostileOn('POI Facets', createFieldForSecond)
      const r = await safe(() => run(h.fx, { transport: h.transport }), { threw: true })
      t(`${label}: исключение НЕ покинуло executor`, r.threw ? 'исключение' : `исход ${r.outcome}`, 'исход stopped')
      t(`${label}: остановлено на втором поле`, r.stoppedAt, 'POI Facets')
      t(`${label}: один POST (враждебный createField провода не достиг), без повтора`, posts(h.fx), 1)
      const j = await safe(() => readSchemaJournal(r.journal), { closed: false, records: [] })
      t(`${label}: журнал закрыт (терминальное состояние)`, j.closed, true)
      t(`${label}: журнал НЕ открыт на dispatching`, j.records.at(-1)?.kind, 'closed')
      t(`${label}: sent помечен ambiguousEffect`, j.records.some((x) => x.kind === 'sent' && x.field === 'POI Facets' && x.ambiguousEffect === true), true)
      t(`${label}: outcome установлен чтением (notApplied)`, j.records.some((x) => x.kind === 'outcome' && x.field === 'POI Facets' && x.result === 'notApplied' && x.establishedBy === 'read'), true)
    }
    // Враждебный ответ, но эффект БЫЛ: свежее чтение видит поле → applied, исполнение идёт дальше.
    const hEffect = hostileOn('POI Facets', () => { throw revoked() }, { effect: true })
    const rEffect = await safe(() => run(hEffect.fx, { transport: hEffect.transport }), { threw: true })
    t('враждебный ответ + фактический эффект: allApplied по чтению', rEffect.outcome, 'allApplied')
    t('враждебный ответ + эффект: POST не повторялся', posts(hEffect.fx), 4)
    // Враждебный ответ ПОСЛЕ фактического POST И чтение после POST недоступно: unknown + recovery, без повтора.
    const fxU = fakeAirtable({ readFails: (calls) => calls.filter((c) => c.method === 'POST').length >= 1 })
    const transportU = { readSchema: () => fxU.transport.readSchema(), createField: async (body) => { await fxU.transport.createField(body); throw revoked() } }
    const rU = await safe(() => run(fxU, { transport: transportU }), { threw: true })
    t('враждебный ответ + чтение недоступно: исключение не покинуло executor', rU.threw ? 'исключение' : `исход ${rU.outcome}`, 'исход unknown')
    t('враждебный ответ + чтение недоступно: recovery', rU.recoveryRequired, true)
    t('враждебный ответ + чтение недоступно: журнал закрыт unknown', (await safe(() => readSchemaJournal(rU.journal).outcome)), 'unknown')
    // describeThrownSafely и normalizeSent — модульные регрессии.
    t('describeThrownSafely: отозванный Proxy не роняет', typeof describeThrownSafely(revoked()), 'string')
    t('describeThrownSafely: не-Error', describeThrownSafely(7), 'number: 7')
    t('describeThrownSafely: Error', describeThrownSafely(new Error('x')).startsWith('Error: x'), true)
    t('normalizeSent: бросок → ambiguousEffect', normalizeSent(undefined, new Error('boom')).ambiguousEffect, true)
    t('normalizeSent: null → ambiguousEffect', normalizeSent(null, undefined).ambiguousEffect, true)
    t('normalizeSent: нераспознанный kind → ambiguousEffect', normalizeSent({ kind: 'x' }, undefined).ambiguousEffect, true)
    t('normalizeSent: applied распознан', normalizeSent({ kind: 'applied', fieldId: 'fld1' }, undefined).response, 'applied')
    t('normalizeSent: отозванный Proxy → ambiguousEffect', normalizeSent(revoked(), undefined).ambiguousEffect, true)
  }

  /* ── 19. R5-1: СЫРОЕ брошенное значение на границе readSchema не покидает executor ── */
  {
    const revoked = () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy }
    const rawThrows = [
      ['отозванный Proxy', () => revoked()],
      ['не-Error число', () => 42],
      ['null', () => null],
      ['undefined', () => undefined],
      ['объект с бросающим геттером cause/message', () => ({ get cause() { throw new Error('cause бросил') }, get message() { throw new Error('message бросил') } })],
    ]
    // Инъецированный транспорт: readSchema отклоняется СЫРЫМ значением на N-м чтении,
    // createField — настоящий POST (эффект состоялся). Исполнитель на обёртку readSchema не полагается.
    const injected = (throwOnGet, make) => {
      const state = { fields: [], nextId: 1 }
      let gets = 0
      return {
        state,
        transport: {
          readSchema: async () => { gets += 1; if (gets >= throwOnGet) { throw make() } return state.fields.map((f) => JSON.parse(JSON.stringify(f))).length ? [{ id: POI_TABLE_ID, name: 'POI', fields: state.fields }] : [{ id: POI_TABLE_ID, name: 'POI', fields: [] }] },
          createField: async (body) => { const id = `fld${state.nextId++}`; state.fields.push(liveFieldOf(body, id)); return { kind: 'applied', fieldId: id } },
        },
      }
    }
    for (const [label, make] of rawThrows) {
      // Первый POST состоялся, обязательное чтение ПОСЛЕ него (3-е чтение) отклонено сырым значением → unknown.
      const inj = injected(3, make)
      const r = await safe(() => run({ transport: inj.transport }, { transport: inj.transport }), { threw: true })
      t(`readSchema после POST бросает «${label}»: исключение НЕ покинуло executor`, r.threw ? 'исключение' : `исход ${r.outcome}`, 'исход unknown')
      t(`readSchema после POST «${label}»: recoveryRequired`, r.recoveryRequired, true)
      const j = await safe(() => readSchemaJournal(r.journal), { closed: false, records: [] })
      t(`readSchema после POST «${label}»: журнал ЗАКРЫТ (не открыт на sent)`, j.records.at(-1)?.kind, 'closed')
      t(`readSchema после POST «${label}»: журнал закрыт unknown`, j.outcome, 'unknown')
      t(`readSchema после POST «${label}»: причина названа readFailed`, r.cause, 'readFailed')
    }
    // Предполётное чтение бросает сырое значение → предполёт отказывает БЕЗ журнала, без краха.
    const injPre = injected(1, () => revoked())
    const rp = await safe(() => run({ transport: injPre.transport }, { transport: injPre.transport, journalRoot: path.join(dir, 'j-r5pre') }), { threw: true })
    t('предполётное чтение бросает сырое значение: отказ предполёта (не крах)', rp.threw && /предполёт: живая схема не прочитана/.test(rp.thrown?.message ?? ''), true)
    t('предполёт бросил: журнал не создан', existsSync(journalPathFor(cardDigestOf(bytes), path.join(dir, 'j-r5pre'))), false)
    // Заключительное чтение бросает сырое значение (все четыре поля applied) → pendingFinalWitness, безопасно.
    const injFinal = injected(10, () => revoked())
    const rf = await safe(() => run({ transport: injFinal.transport }, { transport: injFinal.transport }), { threw: true })
    t('заключительное чтение бросает сырое значение: pendingFinalWitness (не крах)', rf.threw ? 'исключение' : rf.outcome, 'pendingFinalWitness')
    t('заключительное чтение бросило: recoveryRequired', rf.recoveryRequired, true)
    // sent.response в диагностике остановки (P2): не «undefined».
    const fxNoEffect = fakeAirtable({ onPost: (b) => (b.name === 'POI Facets' ? 'notAppliedBut2xx' : 'applied') })
    const rNo = await run(fxNoEffect)
    has('диагностика остановки печатает sent.response (нормализованную форму)', rNo.reason, 'ответ провода: applied')
    t('диагностика остановки не печатает «ответ провода: undefined»', /ответ провода: undefined/.test(rNo.reason ?? ''), false)
  }

  /* ── 20. R5-2: чужая карточка с валидными отпечатками модулей отвергается ДО запроса ── */
  {
    // Bootstrap проверяет только отпечатки модулей — чужой baseId/поле их не меняют.
    const foreign = JSON.parse(JSON.stringify(card))
    foreign.base.baseId = 'appFOREIGN000000'
    foreign.fields[0].request.body.name = 'Foreign Field'
    foreign.scope.fieldNames[0] = 'Foreign Field'
    const foreignBytes = cardBytesOf(foreign)
    t('bootstrap принимает чужую карточку по одним отпечаткам модулей', verifyChainAgainstCard(foreignBytes, REPO).ok, true)
    // Свидетель: канонический контракт ДО маршрута → отказ, СЕТИ НЕ БЫЛО.
    let requested = null
    const recording = async (url) => { requested = String(url); return { ok: true, status: 200, text: async () => JSON.stringify({ tables: [{ id: POI_TABLE_ID, name: 'POI', fields: foreign.fields.map((f, i) => liveFieldOf(f.request.body, `fld${i}`)) }] }) } }
    const w = await witnessTaxonomySchema({ fetchImpl: recording, cardBytes: foreignBytes })
    t('свидетель: чужая карточка — verifiedSuccess=false', w.verifiedSuccess, false)
    t('свидетель: чужой карточке credentialed GET НЕ отправлен', requested, null)
    has('свидетель: причина — канонический контракт', w.reason, 'канонический контракт')
    // Даже чужой baseId при прочих канонических полях: URL строится из КОНСТАНТЫ, база не переопределяется.
    const foreignBaseOnly = JSON.parse(JSON.stringify(card)); foreignBaseOnly.base.baseId = 'appFOREIGN000000'
    const wB = await witnessTaxonomySchema({ fetchImpl: recording, cardBytes: cardBytesOf(foreignBaseOnly) })
    t('свидетель: чужой baseId отвергнут контрактом до сети', requested, null)
    t('свидетель: чужой baseId — verifiedSuccess=false', wB.verifiedSuccess, false)
    // Годная карточка: свидетель строит URL из КОНСТАНТЫ канонической базы.
    let goodUrl = null
    const good = fakeAirtable()
    for (const b of bodies) good.state.fields.push(liveFieldOf(b, `f${b.name}`))
    const goodFetch = async (url) => { goodUrl = String(url); return { ok: true, status: 200, text: async () => JSON.stringify({ tables: [{ id: POI_TABLE_ID, name: 'POI', fields: good.state.fields }] }) } }
    const wGood = await witnessTaxonomySchema({ fetchImpl: goodFetch, cardBytes: bytes })
    t('свидетель: годная карточка — verifiedSuccess', wGood.verifiedSuccess, true)
    t('свидетель: URL из КОНСТАНТЫ канонической базы', /bases\/apppwhjFN82N9zNqm\/tables$/.test(goodUrl), true)
    t('свидетель: годная таблица — канонический ID', wGood.tableId, POI_TABLE_ID)
    // classifyWitness ищет таблицу по КОНСТАНТЕ POI_TABLE_ID, а не по card.base.poiTableId:
    // карточка не может переопределить целевую таблицу (независимо от канонического гейта выше).
    const foreignTableCard = JSON.parse(JSON.stringify(card)); foreignTableCard.base.poiTableId = 'tblFOREIGN000000'
    const canonTables = [{ id: POI_TABLE_ID, name: 'POI', fields: bodies.map((b, i) => liveFieldOf(b, `f${i}`)) }]
    t('classifyWitness ищет таблицу по КОНСТАНТЕ, игнорируя card.base.poiTableId', classifyWitness(canonTables, foreignTableCard).verifiedSuccess, true)
    t('classifyWitness: подтверждённая таблица — канонический ID', classifyWitness(canonTables, foreignTableCard).tableId, POI_TABLE_ID)
    // Если бы таблица бралась из card.base.poiTableId (чужой ID), канонической таблицы бы «не нашлось».
    const foreignTables = [{ id: 'tblFOREIGN000000', name: 'POI', fields: bodies.map((b, i) => liveFieldOf(b, `f${i}`)) }]
    t('classifyWitness: чужая таблица по КОНСТАНТЕ не находится', classifyWitness(foreignTables, foreignTableCard).verifiedSuccess, false)
    // Gate: свидетель, подтвердивший ЧУЖУЮ таблицу, не принимается.
    const fxRun = fakeAirtable(); const rRun = await run(fxRun, { transport: fxRun.transport })
    const journal = readSchemaJournal(rRun.journal); const approval = approvalFor(bytes, card)
    const foreignTableWitness = { verifiedSuccess: true, tableId: 'tblFOREIGN000000', reason: null, ambiguous: false, fieldIds: ['a', 'b', 'c', 'd'] }
    t('gate: свидетель о ЧУЖОЙ таблице — отказ', finalGate({ cardBytes: bytes, approval, journal, witness: foreignTableWitness }).verifiedSuccess, false)
    has('gate: причина — не каноническая таблица', finalGate({ cardBytes: bytes, approval, journal, witness: foreignTableWitness }).witness, 'не каноническую таблицу')
    // CLI: чужая карточка отвергается ДО чтения credentials и ДО сети.
    const foreignPath = path.join(dir, 'foreign-card.json'); writeFileSync(foreignPath, foreignBytes)
    let cliFetched = false
    const cliRes = await safe(() => cli(['--witness', foreignPath], { env: {}, repoRoot: REPO, fetchImpl: async () => { cliFetched = true; return { ok: true, status: 200, text: async () => '{}' } }, log: () => {} }), { threw: true })
    t('CLI: чужая карточка отвергнута (не 0)', cliRes.threw ? 'отказ' : (cliRes === 0 ? 'принято' : 'отказ'), 'отказ')
    t('CLI: чужой карточке сеть НЕ вызвана', cliFetched, false)
    has('CLI: отказ — канонический контракт карточки', cliRes.thrown?.message ?? '', 'не канонич')
  }

  /* ── 21. R5-3: транспорт сам не выпускает неизвестное исключение ──────── */
  {
    const revoked = () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy }
    const cases = [
      ['fetchImpl отклоняется отозванным Proxy', async () => { throw revoked() }],
      ['fetchImpl возвращает отозванный Proxy', async () => revoked()],
      ['fetchImpl отклоняется не-Error числом', async () => { throw 7 }],
      ['fetchImpl отклоняется объектом с бросающим геттером message', async () => { throw { get message() { throw new Error('m') } } }],
    ]
    for (const [label, fetchImpl] of cases) {
      const transport = createMetaTransport({ token: 'tok', fetchImpl, deadlineMs: 500 })
      const rc = await safe(() => transport.createField(bodies[0]), { threw: true })
      t(`транспорт: createField при «${label}» НЕ бросает`, rc.threw ? 'исключение' : 'значение', 'значение')
      t(`транспорт: createField при «${label}» → ambiguous`, rc.kind, 'ambiguous')
      const rr = await safe(() => transport.readSchema(), { threw: true })
      t(`транспорт: readSchema при «${label}» бросает только SchemaReadError`, rr.threw && rr.thrown instanceof SchemaReadError && READ_FAILURE_CAUSES.includes(rr.thrown.cause), true)
    }
  }

} catch (error) {
  // Набор обязан ДОКЛАДЫВАТЬ, а не падать: крах процесса скрыл бы, какой
  // именно сторож сработал, и мутация выглядела бы выжившей.
  bad.push(`НЕОБРАБОТАННЫЙ ОТКАЗ набора (сторож сработал вне утверждения): ${error?.message ?? String(error)}`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (bad.length) {
  console.error(`✗ цепочка схемной операции: провалено ${bad.length} из ${ok + bad.length}`)
  for (const line of bad) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`✓ цепочка схемной операции: ${ok} проверок пройдено`)
