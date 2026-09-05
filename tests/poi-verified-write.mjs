#!/usr/bin/env node
/**
 * Надёжная граница записи в ПРОИЗВОДСТВЕННОЙ композиции (10f-R, P02.2/P09.2/P09.3).
 *
 *   node tests/poi-verified-write.mjs
 *
 * Здесь исполняется production-путь целиком: `runCli` → адаптер → gate →
 * `writeRun` → `withVerifiedWrites` → PRODUCTION-хранилище `createAirtablePoiStore`
 * с подменённым транспортом. Копий логики нет: подменяется только `fetch`.
 *
 * Дефекты до правки (воспроизведены, `tmp/10f-r-repro-OLD-2026-09-05.log`):
 *   • ошибка портала перехватывалась и давала НУЛЕВОЙ код возврата;
 *   • ошибка записи схлопывала отчёт в `{ error }` — поимённые исходы и след
 *     уже созданной записи исчезали, код возврата оставался нулевым;
 *   • исход записи брался из ТЕЛА ответа POST, а `findBySourceKey` отвечал из
 *     кэша, который наполнил тот же writer.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runCli } from '../scripts/poi-portals/collect-pois.mjs'
import { collectFromOpenDataCsv } from '../scripts/poi-portals/lib/opendata-csv.mjs'
import { createAirtablePoiStore } from '../scripts/poi-portals/lib/airtable-store.mjs'
import { createSnapshotStore } from '../scripts/poi-portals/lib/base-snapshot.mjs'
import { classifyWriteOutcome, fieldEquals, verificationFor, withVerifiedWrites, VerifiedWriteError } from '../scripts/poi-portals/lib/verified-write.mjs'
import { DIRECTORY_IO, intentFieldsDigest, openWriteJournal, readWriteJournal, readWriteJournalDetailed } from '../scripts/poi-portals/lib/write-journal.mjs'
import { reconcileWriteJournal, runReconcileCli } from '../scripts/poi-portals/reconcile-writes.mjs'
import { expectedTaxonomyFieldSchema } from '../src/lib/poi-taxonomy-airtable.ts'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'
import { resolvePlace } from '../src/lib/place-resolve.ts'

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
/* Крах сюиты — не «мутация не убита»: накопленные поимённые провалы печатаются
   и здесь, а сам обрыв назван. Код возврата ненулевой. */
process.on('uncaughtException', (e) => {
  bad.push(`сюита оборвана необработанной ошибкой: ${e instanceof Error ? e.message : String(e)}`)
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exit(1)
})
/* Отклонение промиса, которого никто не ждал, — поимённый провал: так
   проявляется хранилище, которое вызвало намерение, но не дождалось его. */
process.on('unhandledRejection', (e) => { bad.push(`необработанное отклонение промиса (эффект не дождался намерения?): ${e instanceof Error ? e.message : String(e)}`) })
/* Журнал production-прогона читается СТРОГОЙ грамматикой; отказ читателя —
   поимённый провал, а не крах сюиты (иначе мутация «намерение без POI ID»
   считалась бы не убитой). */
const readJournal = async (label, file) => {
  if (!file) return []
  try { const entries = await readWriteJournal(file); ok++; return entries } catch (e) { bad.push(`${label}: журнал прогона не читается — ${e instanceof Error ? e.message : String(e)}`); return [] }
}

/* ── Вход источника: тот же формат, что у остальных портальных наборов ─── */
const DESC = '大阪を代表する歴史的建造物であり、天守閣の内部は博物館として公開されています。豊臣秀吉によって築かれた城の歴史や、大坂の陣に関する資料が数多く展示されており、最上階の展望台からは大阪市街を一望することができます。周囲は公園として整備されています。'
const H = 'ID,名称,名称_英語,説明,所在地_都道府県,所在地_市区町村,所在地_連結表記,緯度,経度,URL,利用可能曜日,開始時間,終了時間,連絡先電話番号,アクセス方法'
const OSAKAJO = `"1","大阪城","Osaka Castle","${DESC}","大阪府","大阪市","大阪府大阪市中央区大阪城1-1","34.6873","135.5259","https://example.invalid/1","月曜日","09:00","17:00","06-6941-3044","地下鉄谷町四丁目駅から徒歩15分"`
const CSV = [H, OSAKAJO].join('\n')
const stubFetch = async (u) => {
  const url = String(u)
  if (url.includes('package_show')) {
    return { ok: true, status: 200, json: async () => ({ success: true, result: { license_id: 'cc-by', metadata_modified: '2026-03-30T00:00:00', resources: [{ format: 'CSV', url: 'https://example.invalid/data.csv', last_modified: '2026-03-30T00:00:00' }] } }) }
  }
  if (url.includes('data.csv')) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(CSV).buffer }
  throw new Error(`сеть не предусмотрена: ${url}`)
}
const gplace = { id: 'PID-OSAKAJO', displayName: { text: '大阪城' }, location: { latitude: 34.6873, longitude: 135.5259 }, businessStatus: 'OPERATIONAL', addressComponents: [{ types: ['administrative_area_level_1'], longText: 'Osaka' }] }
const resolver = (input) => resolvePlace(input, { apiKey: 'ключ-фикстуры', fetchImpl: async () => ({ ok: true, json: async () => ({ places: [gplace] }) }) })

const dir = await mkdtemp(path.join(tmpdir(), 'jj-verified-write-'))
const file = async (name, content) => { const p = path.join(dir, name); await writeFile(p, JSON.stringify(content)); return p }
const EXISTING = await file('existing.json', [{ poiId: 'POI-000700', sourceKey: 'bodik-osaka-tourism:700', nameRu: 'Ничего похожего', lat: 35.7, lon: 139.7 }])
const NAMES = await file('names.json', { 'bodik-osaka-tourism:1': { nameRu: 'Замок Осака' } })
const SNAP_ROW = { poiId: 'POI-000700', recordId: 'rec700', nameRu: 'Ничего похожего', nameEn: 'Nothing Alike', siteCity: 'tokyo', lat: 35.7, lon: 139.7, placeId: null, sourceKey: null }
const NOW = new Date('2026-09-05T00:00:00.000Z')
const SOURCE_KEY = 'bodik-osaka-tourism:1'

let runSeq = 0
const run = async ({ argv = [], store = null, adapters = null, placeResolver = resolver, journal = null }) => {
  runSeq += 1
  const printed = []; const errored = []; let persisted = null
  const realLog = console.log; const realErr = console.error; const realWarn = console.warn
  console.log = (v) => printed.push(String(v)); console.error = (...v) => errored.push(v.map(String).join(' ')); console.warn = () => {}
  const target = { exitCode: 0 }
  try {
    await runCli([
      'node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism',
      '--out', path.join(dir, `out-${runSeq}.json`), '--write-journal', path.join(dir, 'journal'), ...argv,
    ], {
      adapters: adapters ?? { 'opendata-csv': (p, o) => collectFromOpenDataCsv(p, { ...o, fetchImpl: stubFetch }) },
      persistReport: async (_p, report) => { persisted = report },
      placeResolver,
      now: NOW,
      resolveCodeIdentity: () => ({ commit: '0'.repeat(40), dirty: false }),
      ...(store ? { store } : {}),
      ...(journal ? { journal } : {}),
    }, target)
  } finally { console.log = realLog; console.error = realErr; console.warn = realWarn }
  return { exitCode: target.exitCode, report: persisted, errored: errored.join('\n') }
}

/** Живое хранилище: production-store, подменён только транспорт. */
const liveStore = ({ onPost = null, onRead = null, dryRun = false } = {}) => {
  const rows = []
  const calls = []
  const schema = [{ name: 'POI ID', type: 'singleLineText' }, ...expectedTaxonomyFieldSchema().map((f) => ({
    name: f.name, type: f.type, options: f.choices ? { choices: f.choices.map((name) => ({ name })) } : undefined,
  }))]
  const store = createAirtablePoiStore({
    token: 'tok', baseId: 'appTEST', dryRun,
    fetchImpl: async (url, init = {}) => {
      const method = init.method ?? 'GET'
      const target = String(url)
      calls.push(`${method} ${target.includes('filterByFormula') ? 'search' : target.split('/').pop()}`)
      if (target.includes('/meta/')) return { ok: true, status: 200, json: async () => ({ tables: [{ id: POI_TABLE_ID, name: 'POI', fields: schema }] }) }
      if (method === 'POST') {
        const fields = JSON.parse(init.body).records[0].fields
        const decided = onPost ? onPost(fields, rows) : null
        if (decided) return decided
        rows.push({ id: 'rec801', fields })
        return { ok: true, status: 200, json: async () => ({ records: [{ id: 'rec801' }] }) }
      }
      if (method === 'PATCH') return { ok: true, status: 200, json: async () => ({ id: 'rec801' }) }
      const decided = onRead ? onRead(target, rows) : null
      if (decided) return decided
      const filtered = target.includes('filterByFormula') && target.includes('Source+Key')
        ? rows.filter((r) => r.fields['Source Key'] === SOURCE_KEY)
        : rows
      /* Как Airtable: записи возвращаются с полями «как есть». */
      return { ok: true, status: 200, json: async () => ({ records: filtered.map((r) => ({ id: r.id, fields: { ...r.fields } })) }) }
    },
  })
  return { store, rows, calls }
}
/** То же живое хранилище в режиме `--dry-write`: POST оно не отправляет. */
const liveStoreDry = () => liveStore({ dryRun: true })

/* ── 0. Эталон для gate: сухой прогон того же входа ────────────────────── */
const reference = await run({ argv: ['--dry-write', '--existing', EXISTING, '--names', NAMES], store: createSnapshotStore([SNAP_ROW]) })
t('эталон: сухой прогон завершается нулевым кодом', reference.exitCode, 0)
t('эталон: сухая запись состоялась', reference.report.write?.outcomes?.created, 1)
/* DRY-RUN: НИ ЖИВЫХ ЭФФЕКТОВ, НИ ЛОЖНОГО ЖУРНАЛА УСПЕХА. */
t('dry-run: журнала нет вовсе', reference.report.write?.evidence, null)
t('dry-run: граница названа режимом, а не «проверено»', reference.report.write?.writeBoundary, 'dry-write')
const REF = await file('reference.json', reference.report)

/* ── 0б. DRY-RUN НА ЖИВОМ ХРАНИЛИЩЕ: ни эффектов, ни журнала ───────────
   Production собирает `createAirtablePoiStore({ dryRun: true })` — хранилище
   живой формы, которое просто не отправляет POST. Именно на нём и надо
   доказывать, что журнала успеха не появляется: снимок отличается от живого
   хранилища тождеством, и проверять на нём — проверять не тот случай. */
{
  const live = liveStoreDry()
  const r = await run({ argv: ['--dry-write', '--existing', EXISTING, '--names', NAMES], store: live.store })
  t('dry-run на живом хранилище: код возврата 0', r.exitCode, 0)
  t('dry-run: POST не отправлялся ни разу', live.calls.filter((c) => c.startsWith('POST')).length, 0)
  t('dry-run: строк в базе не появилось', live.rows.length, 0)
  t('dry-run: журнала нет', r.report.write?.evidence, null)
  t('dry-run: граница названа режимом', r.report.write?.writeBoundary, 'dry-write')
  t('dry-run: сухая запись при этом состоялась', r.report.write?.outcomes?.created, 1)
}

/* ── 1. Успешная запись: исход установлен НЕЗАВИСИМЫМ чтением ──────────── */
{
  const live = liveStore()
  const r = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: live.store })
  t('успех: код возврата 0', r.exitCode, 0)
  t('успех: отказов прогона нет', r.report.runFailures, undefined)
  t('успех: запись создана', r.report.write?.outcomes?.created, 1)
  t('успех: граница — проверяющая', r.report.write?.writeBoundary, 'verified')
  t('успех: исход установлен ЖИВЫМ чтением', r.report.write?.evidence?.verification.join(','), 'liveRead')
  t('успех: состояние — verified', JSON.stringify(r.report.write?.evidence?.byState), '{"verified":1}')
  t('успех: доказанный префикс назван поимённо', r.report.write?.evidence?.verified.length, 1)
  has('  и в нём ключ источника', r.report.write?.evidence?.verified?.[0] ?? '(доказательства нет)', SOURCE_KEY)
  t('успех: к разбору ничего не осталось', r.report.write?.evidence?.recoveryRequired.length, 0)
  /* ПОРЯДОК ОБРАЩЕНИЙ: после POST идёт ОТДЕЛЬНЫЙ поиск по ключу источника. */
  const afterPost = live.calls.slice(live.calls.indexOf('POST tblVCmFcHRpXUT24y') + 1)
  t('успех: после POST база перечитана поиском', afterPost.includes('GET search'), true)
  /* ЖУРНАЛ: намерение до эффекта, исход после. */
  const entries = await readJournal('журнал прогона читается строгой грамматикой', r.report.write?.evidence?.journal)
  t('журнал: роды строк — prepare, create, исход', entries.map((e) => `${e.kind}${e.step ? `:${e.step}` : ''}`).join(','), 'runStarted,intent:prepare,intent:create,outcome,runFinished')
  t('журнал: намерение раньше исхода', entries[2]?.kind === 'intent' && entries[3]?.kind === 'outcome', true)
  t('журнал: исход — verified', entries[3]?.state ?? null, 'verified')
  t('журнал: способ проверки записан', entries[3]?.verification ?? null, 'liveRead')
  /* R1: намерение несёт ОЖИДАЕМЫЕ ЗНАЧЕНИЯ — те самые поля, что ушли в базу. */
  t('журнал: prepare несёт ключ источника значением', entries[1]?.fields?.['Source Key'] ?? null, SOURCE_KEY)
  t('журнал: prepare несёт имя значением', entries[1]?.fields?.['POI Name (RU)'] ?? null, 'Замок Осака')
  /* R2: `create` несёт ПОЛНУЮ нагрузку POST — включая поля, добавленные
     самим хранилищем, которых на входе не было. */
  t('журнал: create несёт POI ID, выбранный хранилищем', entries[2]?.fields?.['POI ID'] ?? null, live.rows[0]?.fields?.['POI ID'] ?? '(нет)')
  t('журнал: create несёт Last Seeded At, поставленный хранилищем', typeof entries[2]?.fields?.['Last Seeded At'], 'string')
  t('журнал: нагрузка create совпадает с тем, что легло в базу, поле в поле',
    Object.entries(entries[2]?.fields ?? {}).every(([k, v]) => fieldEquals(v, live.rows[0]?.fields?.[k])), true)
  t('журнал: и наоборот — в базе нет полей, которых нет в нагрузке',
    Object.keys(live.rows[0]?.fields ?? {}).every((k) => k in (entries[2]?.fields ?? {})), true)
  t('журнал: digest полей сходится с полями', entries[2]?.fieldsDigest ?? null, entries[2]?.fields ? intentFieldsDigest(entries[2].fields) : '(нет)')
  /* И по этому production-журналу поздняя сверка доказывает тождество записи:
     intent-only (prepare + create, без outcome) разрешается по намерению. */
  const intentOnly = path.join(dir, 'intent-only.ndjson')
  await writeFile(intentOnly, entries.slice(0, 3).map((e) => JSON.stringify(e)).join('\n') + '\n')
  const resolved = await reconcileWriteJournal(intentOnly, { read: (k, names) => live.store.readFreshBySourceKey(k, names), readByPoiId: (id) => live.store.readFreshByPoiId(id) })
    .catch((e) => ({ resolved: [{ resolution: `сверка отказала: ${e instanceof Error ? e.message : String(e)}` }] }))
  t('production intent-only журнал разрешён по намерению — verified', resolved.resolved[0]?.resolution ?? null, 'verified')
  t('  и номер взят из базы', resolved.resolved[0]?.poiId ?? null, live.rows[0]?.fields?.['POI ID'] ?? '(нет)')
}

/* ── 2. Эффект применён, ответ потерян ─────────────────────────────────── */
{
  /* POST дошёл до базы (строка появилась), но ответ — отказ транспорта.
     Исход устанавливается ЧТЕНИЕМ: запись найдена и совпала с намерением по
     всем обещанным полям — это `verified`, а не «неизвестно», и номер с id
     берутся из базы. R1: доказательством служит СОДЕРЖАНИЕ намерения. */
  const live = liveStore({ onPost: (fields, rows) => { rows.push({ id: 'rec801', fields: { ...fields, 'POI ID': 'POI-000001' } }); return { ok: false, status: 504, text: async () => 'gateway timeout' } } })
  const r = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: live.store })
  t('ответ потерян: строк в базе — одна', live.rows.length, 1)
  t('ответ потерян, запись совпала с намерением: исход установлен чтением — verified', JSON.stringify(r.report.write?.evidence?.byState), '{"verified":1}')
  t('ответ потерян: и это успех прогона', r.exitCode, 0)
  t('ответ потерян: запись засчитана как созданная', r.report.write?.outcomes?.created, 1)
  has('ответ потерян: номер взят из базы', r.report.write?.evidence?.verified?.[0] ?? '', 'POI-000001')
  const entries = await readJournal('журнал прогона читается строгой грамматикой', r.report.write?.evidence?.journal)
  t('журнал: намерение записано ДО эффекта', entries.some((e) => e.kind === 'intent' && e.step === 'create' && e.sourceKey === SOURCE_KEY), true)
  has('журнал: исход verified объясняет, что writer при этом бросил', entries.find((e) => e.kind === 'outcome')?.reason ?? '', 'writer сообщил об ошибке')
  has('журнал: и что доказательство — совпадение с намерением', entries.find((e) => e.kind === 'outcome')?.reason ?? '', 'совпали с намерением')

  /* Ответ потерян, а в базе — НЕ ТА запись (чужие поля под тем же ключом):
     это mismatch и разбор, а не успех. */
  const alien = liveStore({ onPost: (fields, rows) => { rows.push({ id: 'rec801', fields: { ...fields, 'POI Name (RU)': 'СОВСЕМ ДРУГОЕ', 'POI ID': 'POI-000001' } }); return { ok: false, status: 504, text: async () => 'gateway timeout' } } })
  const r2 = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: alien.store })
  t('ответ потерян, содержание не совпало: код возврата 1', r2.exitCode, 1)
  t('ответ потерян, содержание не совпало: mismatch, а не успех', r2.report.write?.failure?.state, 'mismatch')
  has('  и расходящееся поле названо', r2.report.write?.failure?.reason ?? '', 'POI Name (RU)')
  t('  и строка ушла в разбор', r2.report.write?.evidence?.recoveryRequired?.length, 1)
  t('  и отказ прогона назван', r2.report.runFailures?.[0]?.kind, 'writeUnverified')
  t('  и помечен как требующий восстановления', r2.report.runFailures?.[0]?.recoveryRequired, true)
}

/* ── 3. Эффект НЕ применён ─────────────────────────────────────────────── */
{
  const live = liveStore({ onPost: () => ({ ok: false, status: 422, text: async () => 'invalid field' }) })
  const r = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: live.store })
  t('эффекта не было: строк в базе нет', live.rows.length, 0)
  t('эффекта не было: код возврата 1', r.exitCode, 1)
  t('эффекта не было: состояние notApplied', r.report.write?.failure?.state, 'notApplied')
  t('эффекта не было: восстановление НЕ требуется', r.report.write?.failure?.recoveryRequired, false)
  t('эффекта не было: к разбору ничего не ушло', r.report.write?.evidence?.recoveryRequired.length, 0)
  has('эффекта не было: отказ writer’а назван', r.report.write?.failure?.reason, 'writer сообщил об ошибке')
}

/* ── 4. Свежая сверка недоступна или повреждена ────────────────────────── */
{
  const live = liveStore({ onRead: (target) => (target.includes('filterByFormula') ? { ok: false, status: 503, text: async () => 'read unavailable' } : null) })
  const r = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: live.store })
  t('сверка недоступна: код возврата 1', r.exitCode, 1)
  t('сверка недоступна: исход unknown, а не успех', r.report.write?.failure?.state, 'unknown')
  t('сверка недоступна: требуется восстановление', r.report.write?.failure?.recoveryRequired, true)
  has('сверка недоступна: причина названа', r.report.write?.failure?.reason, 'независимое чтение отказало')
  t('сверка недоступна: эффект при этом состоялся', live.rows.length, 1)
}

/* ── 5. Неоднозначное чтение: две записи под одним ключом ──────────────── */
{
  const live = liveStore({ onRead: (target, rows) => (target.includes('filterByFormula')
    ? { ok: true, status: 200, json: async () => ({ records: [...rows, { id: 'recДВОЙНИК', fields: { 'Source Key': SOURCE_KEY } }] }) }
    : null) })
  const r = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: live.store })
  t('неоднозначно: код возврата 1', r.exitCode, 1)
  t('неоднозначно: состояние ambiguous', r.report.write?.failure?.state, 'ambiguous')
  has('  и названо, сколько нашлось', r.report.write?.failure?.reason, 'нашло 2 записей')
  t('неоднозначно: требуется восстановление', r.report.write?.failure?.recoveryRequired, true)
}

/* ── 6. Сбой сохранения доказательства ─────────────────────────────────── */
{
  /* ДО возможного эффекта: намерение не легло — эффекта не начинаем. */
  const live = liveStore()
  const journal = {
    file: path.join(dir, 'нет.ndjson'),
    async intent() { throw new Error('диск переполнен') },
    async outcome() { throw new Error('не должно вызываться') },
    async finish() {},
  }
  const r = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: live.store })
  t('контроль перед проверкой журнала: обычный прогон пишет', r.exitCode, 0)
  const failing = liveStore()
  const wrapped = withVerifiedWrites(failing.store, { journal })
  has('намерение не записано — эффект не начат', await boom(() => wrapped.create({ 'Source Key': SOURCE_KEY })), 'диск переполнен')
  t('и POST не отправлялся', failing.calls.filter((c) => c.startsWith('POST')).length, 0)

  /* ПОСЛЕ возможного эффекта: исход не лёг — это unknown, а не успех. */
  const afterEffect = liveStore()
  const outcomes = []
  const halfJournal = {
    file: path.join(dir, 'полу.ndjson'),
    async intent() {},
    async outcome() { throw new Error('журнал недоступен') },
    async finish() {},
  }
  const wrapped2 = withVerifiedWrites(afterEffect.store, { journal: halfJournal, onOutcome: (o) => outcomes.push(o) })
  const thrown = await boom(() => wrapped2.create({ 'Source Key': SOURCE_KEY, 'POI Name (RU)': 'Замок' }))
  has('исход не записан после эффекта — unknown', thrown, 'unknown')
  has('  и причина названа', thrown, 'после возможного эффекта')
  t('  и эффект при этом состоялся', afterEffect.rows.length, 1)
  t('  и наблюдателю отдан именно unknown', outcomes[0].state, 'unknown')
}

/* ── 7. Враждебные брошенные значения на новых границах ────────────────── */
{
  const hostile = [null, undefined, 0, Symbol('x'), { get message() { throw new Error('ловушка') } }]
  for (const value of hostile) {
    const live = liveStore()
    const journal = { file: 'x', async intent() {}, async outcome() {}, async finish() {} }
    const store = { ...live.store, readSchemaTables: live.store.readSchemaTables, readFreshBySourceKey: async () => { throw value }, create: async () => { throw value } }
    const wrapped = withVerifiedWrites(store, { journal })
    const message = await boom(() => wrapped.create({ 'Source Key': SOURCE_KEY }))
    t(`брошенное ${String(typeof value)} описано, а не вынесено наружу`, message.includes('unknown'), true)
  }
  /* Ошибка портала с враждебным брошенным значением — тоже провал прогона. */
  const r = await run({
    adapters: { 'opendata-csv': async () => { throw { get message() { throw new Error('ловушка') } } } },
    argv: ['--existing', EXISTING],
  })
  t('портал бросил враждебное значение: код возврата 1', r.exitCode, 1)
  t('  и отказ назван', r.report?.runFailures?.[0]?.kind ?? `(отчёта нет: ${r.errored.slice(0, 120)})`, 'portalFailed')
}

/* ── 8. P02.2: граница «провал прогона» и «терминальный отказ POI» ─────── */
{
  /* Ошибка портала — провал прогона. */
  const failed = await run({ adapters: { 'opendata-csv': async () => { throw new Error('портал упал: HTTP 503') } }, argv: ['--existing', EXISTING] })
  t('ошибка портала: код возврата 1', failed.exitCode, 1)
  has('ошибка портала: названа в отчёте', JSON.stringify(failed.report.runFailures), 'portalFailed')
  t('ошибка портала: отчёт сохранён', Array.isArray(failed.report.portals), true)
  has('ошибка портала: сообщение дошло до stderr', failed.errored, 'HTTP 503')

  /* Терминальный отказ отдельной POI по правилам приёма — НЕ провал прогона.
     Тот же вход, но запись уже заведена: `already_ingested`. */
  const live = liveStore()
  const first = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: live.store })
  t('контроль: первая запись создана', first.report.write?.outcomes?.created, 1)
  const again = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: live.store })
  t('повтор: та же строка уже заведена', again.report.write?.outcomes?.already_ingested, 1)
  t('повтор: код возврата 0 — это штатный исход приёма, а не авария', again.exitCode, 0)
  t('повтор: отказов прогона нет', again.report.runFailures, undefined)
  t('повтор: эффектов не было, журнал пуст', again.report.write?.evidence?.attempts, 0)
}

/* ── 9. Чистые функции границы ─────────────────────────────────────────── */
{
  const EXP = { fields: { 'Source Key': 'p:1', 'POI Name (RU)': 'Замок', Latitude: 34.6, 'POI ID': 'POI-000001' } }
  const row = (over = {}) => ({ recordId: 'rec1', poiId: 'POI-000001', fields: { 'Source Key': 'p:1', 'POI Name (RU)': 'Замок', Latitude: 34.6, 'POI ID': 'POI-000001' }, ...over })
  /* R3: постинвариант уникальности — отдельным чтением по номеру. */
  const UNIQUE = { found: [{ recordId: 'rec1', poiId: 'POI-000001' }], readError: null }
  t('нашлась ровно одна, тот же id, тот же номер, все поля совпали, номер занят только ею — verified',
    classifyWriteOutcome({ claimed: { recordId: 'rec1', poiId: 'POI-000001' }, expected: EXP, found: [row()], readError: null, uniqueness: UNIQUE }).state, 'verified')
  /* НАХОДКА АУДИТА R2-1: совпадение полей созданной строки не устанавливает
     глобальный постинвариант writer'а. */
  const noUnique = classifyWriteOutcome({ claimed: null, expected: EXP, found: [row()], readError: null })
  t('без чтения по номеру — unknown, даже при полном совпадении полей', noUnique.state, 'unknown')
  has('  и причина названа', noUnique.reason, 'постинвариант уникальности POI ID не проверялся')
  const uniqueFailed = classifyWriteOutcome({ claimed: null, expected: EXP, found: [row()], readError: null, uniqueness: { found: null, readError: '503 service unavailable' } })
  t('чтение по номеру отказало — unknown', uniqueFailed.state, 'unknown')
  has('  и отказ назван', uniqueFailed.reason, '503 service unavailable')
  const twoOwners = classifyWriteOutcome({ claimed: null, expected: EXP, found: [row()], readError: null, uniqueness: { found: [{ recordId: 'rec1', poiId: 'POI-000001' }, { recordId: 'recДУБЛЬ', poiId: 'POI-000001' }], readError: null } })
  t('номер занят двумя записями — mismatch', twoOwners.state, 'mismatch')
  t('  и поле названо', twoOwners.differing?.join(','), 'POI ID')
  t('номер принадлежит другой записи — mismatch',
    classifyWriteOutcome({ claimed: null, expected: EXP, found: [row()], readError: null, uniqueness: { found: [{ recordId: 'recДРУГАЯ', poiId: 'POI-000001' }], readError: null } }).state, 'mismatch')
  t('чтения расходятся (по номеру пусто) — unknown',
    classifyWriteOutcome({ claimed: null, expected: EXP, found: [row()], readError: null, uniqueness: { found: [], readError: null } }).state, 'unknown')
  t('чтение по номеру отдало запись без id — unknown',
    classifyWriteOutcome({ claimed: null, expected: EXP, found: [row()], readError: null, uniqueness: { found: [{ poiId: 'POI-000001' }], readError: null } }).state, 'unknown')
  /* R4 (находка аудита R3-2): ответ чтения доказывает себя сам — фильтру сервера не верим. */
  const foreignNumber = classifyWriteOutcome({ claimed: null, expected: EXP, found: [row()], readError: null, uniqueness: { found: [{ recordId: 'rec1', poiId: 'POI-999999' }], readError: null } })
  t('чтение по номеру отдало тот же id с чужим номером — unknown', foreignNumber.state, 'unknown')
  has('  и чужой номер назван', foreignNumber.reason, 'POI-999999')
  t('чтение по номеру отдало тот же id без номера — unknown',
    classifyWriteOutcome({ claimed: null, expected: EXP, found: [row()], readError: null, uniqueness: { found: [{ recordId: 'rec1' }], readError: null } }).state, 'unknown')
  t('номер берётся из сырых полей записи, а не только из проекции',
    classifyWriteOutcome({ claimed: null, expected: EXP, found: [row()], readError: null, uniqueness: { found: [{ recordId: 'rec1', fields: { 'POI ID': 'POI-000001' } }], readError: null } }).state, 'verified')
  const foreignKey = classifyWriteOutcome({ claimed: null, expected: EXP, found: [row({ fields: { ...row().fields, 'Source Key': 'чужой:1' } })], readError: null, uniqueness: UNIQUE })
  t('чтение по ключу отдало запись с чужим ключом — unknown, не mismatch и не ambiguous', foreignKey.state, 'unknown')
  t('  и две записи, одна из них чужая, — тоже unknown, не ambiguous',
    classifyWriteOutcome({ claimed: null, expected: EXP, found: [row(), row({ recordId: 'b', fields: { ...row().fields, 'Source Key': 'чужой:1' } })], readError: null, uniqueness: UNIQUE }).state, 'unknown')
  /* НАХОДКА АУДИТА R2-2: тождество записи — из базы, заявка writer'а его не заменяет. */
  const noId = classifyWriteOutcome({ claimed: { recordId: 'recCLAIMED', poiId: 'POI-000001' }, expected: EXP, found: [{ poiId: 'POI-000001', fields: row().fields }], readError: null, uniqueness: UNIQUE })
  t('строка без recordId при совпадающих полях — unknown, не verified', noId.state, 'unknown')
  t('  и заявленный id НЕ подставлен', noId.recordId, null)
  has('  и причина названа', noId.reason, 'без id')
  t('пустая строка вместо id — тоже тождества нет',
    classifyWriteOutcome({ claimed: { recordId: 'recCLAIMED' }, expected: EXP, found: [{ recordId: '  ', poiId: 'POI-000001', fields: row().fields }], readError: null, uniqueness: UNIQUE }).state, 'unknown')
  t('не нашлось и writer не отчитался — notApplied',
    classifyWriteOutcome({ claimed: null, expected: EXP, found: [], readError: null }).state, 'notApplied')
  t('не нашлось, но writer отчитался — mismatch',
    classifyWriteOutcome({ claimed: { recordId: 'rec1' }, expected: EXP, found: [], readError: null }).state, 'mismatch')
  t('нашлось две — ambiguous',
    classifyWriteOutcome({ claimed: { recordId: 'rec1' }, expected: EXP, found: [row(), row({ recordId: 'b' })], readError: null }).state, 'ambiguous')
  t('нашлась другая запись — mismatch',
    classifyWriteOutcome({ claimed: { recordId: 'rec1' }, expected: EXP, found: [row({ recordId: 'recДРУГАЯ' })], readError: null }).state, 'mismatch')
  t('чтение отказало — unknown, а не «нет записи»',
    classifyWriteOutcome({ claimed: { recordId: 'rec1' }, expected: EXP, found: [], readError: '503' }).state, 'unknown')
  t('чтение отказало важнее любого найденного',
    classifyWriteOutcome({ claimed: null, expected: EXP, found: [row()], readError: '503' }).state, 'unknown')
  /* НАХОДКА АУДИТА 1: содержание сверяется, а не только факт нахождения. */
  const wrongNumber = classifyWriteOutcome({ claimed: { recordId: 'rec1', poiId: 'POI-000002' }, expected: EXP, found: [row()], readError: null, uniqueness: UNIQUE })
  t('тот же recordId, но другой POI ID — НЕ verified', wrongNumber.state, 'mismatch')
  has('  и оба номера названы', wrongNumber.reason, 'POI-000002, в базе POI-000001')
  const wrongFields = classifyWriteOutcome({ claimed: { recordId: 'rec1', poiId: 'POI-000001' }, expected: EXP, found: [row({ fields: { ...row().fields, 'POI Name (RU)': 'СОВСЕМ ДРУГОЕ' } })], readError: null, uniqueness: UNIQUE })
  t('тот же recordId и номер, но чужие поля — НЕ verified', wrongFields.state, 'mismatch')
  t('  и расходящееся поле названо', wrongFields.differing?.join(','), 'POI Name (RU)')
  t('поле, которого в базе нет вовсе, — расхождение', classifyWriteOutcome({ claimed: null, expected: EXP, found: [row({ fields: { 'Source Key': 'p:1', 'POI Name (RU)': 'Замок' } })], readError: null }).state, 'mismatch')
  /* Крушение классификации — тоже провал проверки, а не крушение набора. */
  const safeClassify = (input) => { try { return classifyWriteOutcome(input).state } catch (e) { return `КРУШЕНИЕ: ${e.message}` } }
  t('чтение без полей — unknown, а не «сверять нечего»',
    safeClassify({ claimed: { recordId: 'rec1' }, expected: EXP, found: [{ recordId: 'rec1', poiId: 'POI-000001' }], readError: null }), 'unknown')
  t('без ожидаемых полей — unknown', classifyWriteOutcome({ claimed: { recordId: 'rec1' }, found: [row()], readError: null }).state, 'unknown')
  /* НАХОДКА АУДИТА 2: intent-only разрешается по содержанию намерения. */
  const byIntent = classifyWriteOutcome({ claimed: null, expected: EXP, found: [row()], readError: null, uniqueness: UNIQUE })
  t('writer не отчитался, но запись совпала с намерением — verified по намерению', byIntent.state, 'verified')
  has('  и это сказано', byIntent.reason, 'совпали с намерением')
  t('  и номер взят из базы', byIntent.poiId, 'POI-000001')
  /* Равенство полей: только «отсутствует» нормализуется. */
  t('пустая строка и отсутствие — одно и то же (так хранит Airtable)', fieldEquals('', undefined), true)
  t('число сравнивается точно', fieldEquals(34.6, 34.60001), false)
  t('множественный выбор — без учёта порядка', fieldEquals(['a', 'b'], ['b', 'a']), true)
  t('  но с учётом состава', fieldEquals(['a', 'b'], ['a']), false)
  t('строка сравнивается точно, без подрезки', fieldEquals('Замок', 'Замок '), false)

  /* Любое хранилище за границей ОБЯЗАНО уметь независимое чтение с полями. */
  const live = liveStore()
  t('живое хранилище проверяется живым чтением', verificationFor(live.store).kind, 'liveRead')
  const crippled = { readSchemaTables: async () => [], findBySourceKey: async () => null }
  has('хранилище без независимого чтения — отказ ДО записи',
    await boom(async () => verificationFor(crippled)), 'readFreshBySourceKey')
  has('  и названа причина: кэш наполняет тот же writer',
    await boom(async () => verificationFor(crippled)), 'кэш наполняет тот же writer')
  has('хранилище в памяти за границу не ставится — проекция снимка не видит полей',
    await boom(async () => verificationFor(createSnapshotStore([SNAP_ROW]))), 'readFreshBySourceKey')
  has('хранилище без чтения по номеру — отказ ДО записи (постинвариант установить нечем)',
    await boom(async () => verificationFor({ readSchemaTables: async () => [], readFreshBySourceKey: async () => [] })), 'readFreshByPoiId')
  has('живая запись без журнала не начинается',
    await boom(async () => withVerifiedWrites(live.store, {})), 'без журнала не начинается')
  const noKey = withVerifiedWrites(live.store, { journal: { file: 'x', async intent() {}, async outcome() {}, async finish() {} } })
  has('запись без ключа источника не начинается', await boom(() => noKey.create({ 'POI Name (RU)': 'Без ключа' })), 'независимым чтением её потом не найти')
  t('  и это именно граница записи', (await boom(() => noKey.create({}))).includes('poi-verified-write/v1'), true)
  t('  и POST не отправлялся', live.calls.filter((c) => c.startsWith('POST')).length, 0)
  t('ошибка границы несёт состояние', new VerifiedWriteError({ state: 'unknown', sourceKey: 'p:1', reason: 'r' }).recoveryRequired, true)
  t('  и notApplied восстановления не требует', new VerifiedWriteError({ state: 'notApplied', sourceKey: 'p:1', reason: 'r' }).recoveryRequired, false)
}

/* ── 10. Внутренний PATCH коллизии номера — тоже эффект, и он проверяется ──
   Он живёт ВНУТРИ create и до 10f-R не проверялся вовсе: ответ не читался.
   R1: PATCH, заявивший `POI-000002` при `POI-000001` в базе, давал `verified`.
   R2 (находка аудита 1): PATCH, ответивший 500, ронял `create` — `claimed`
   становился null, сверка шла по ВХОДНЫМ полям без POI ID, и запись с
   дублирующим номером объявлялась `verified`. Теперь хранилище называет
   нагрузку каждого эффекта ДО него, и ожидаемый итог — с новым номером. */
{
  /* Транспорт живого хранилища с коллизией номера: POST создаёт запись с
     POI-000001, проверка коллизии находит вторую с тем же номером, store шлёт
     PATCH → POI-000002. `renameLands` — доходит ли PATCH до базы, `patchOk` —
     что он отвечает. */
  const collisionStore = ({ renameLands, patchOk = true }) => {
    const rows = []
    let patched = 0
    const store = createAirtablePoiStore({
      token: 'tok', baseId: 'appTEST',
      fetchImpl: async (url, init = {}) => {
        const method = init.method ?? 'GET'
        const target = String(url)
        if (target.includes('/meta/')) {
          const schema = [{ name: 'POI ID', type: 'singleLineText' }, ...expectedTaxonomyFieldSchema().map((f) => ({
            name: f.name, type: f.type, options: f.choices ? { choices: f.choices.map((name) => ({ name })) } : undefined,
          }))]
          return { ok: true, status: 200, json: async () => ({ tables: [{ id: POI_TABLE_ID, name: 'POI', fields: schema }] }) }
        }
        if (method === 'POST') {
          rows.push({ id: 'recNEW', fields: { ...JSON.parse(init.body).records[0].fields } })
          return { ok: true, status: 200, json: async () => ({ records: [{ id: 'recNEW' }] }) }
        }
        if (method === 'PATCH') {
          patched += 1
          if (!patchOk) return { ok: false, status: 500, text: async () => 'patch failed' }
          if (renameLands) rows[0].fields['POI ID'] = JSON.parse(init.body).fields['POI ID']
          return { ok: true, status: 200, json: async () => ({ id: 'recNEW' }) }
        }
        if (target.includes('%7BPOI+ID%7D') || target.includes('{POI ID}')) {
          /* Как база: все записи с запрошенным номером — своя и чужая, занявшая POI-000001. */
          const wanted = decodeURIComponent(target.split('filterByFormula=')[1].split('&')[0]).match(/'([^']+)'/)?.[1]
          const all = [...rows, { id: 'recЧУЖАЯ', fields: { 'POI ID': 'POI-000001', 'Source Key': 'чужой:1' } }]
          return { ok: true, status: 200, json: async () => ({ records: all.filter((r) => r.fields['POI ID'] === wanted).map((r) => ({ id: r.id, fields: { ...r.fields } })) }) }
        }
        if (target.includes('Source+Key')) return { ok: true, status: 200, json: async () => ({ records: rows.map((r) => ({ id: r.id, fields: { ...r.fields } })) }) }
        return { ok: true, status: 200, json: async () => ({ records: [] }) }
      },
    })
    return { store, rows, patched: () => patched }
  }
  const journal = () => ({ file: 'x', async intent() {}, async outcome() {}, async finish() {} })
  const FIELDS = { 'Source Key': SOURCE_KEY, 'POI Name (RU)': 'Замок Осака' }

  /* Положительный контроль: переименование дошло до базы. */
  const landed = collisionStore({ renameLands: true })
  const outcomesLanded = []
  const okWrapped = withVerifiedWrites(landed.store, { journal: journal(), onOutcome: (o) => outcomesLanded.push(o) })
  const created = await okWrapped.create(FIELDS).catch((e) => ({ thrown: e instanceof Error ? e.message : String(e) }))
  t('переименование дошло: граница не бросила', created.thrown ?? null, null)
  t('переименование дошло: writer заявил новый номер', created.poiId, 'POI-000002')
  t('переименование дошло: в базе тот же номер', landed.rows[0].fields['POI ID'], 'POI-000002')
  t('переименование дошло: verified', outcomesLanded[0].state, 'verified')

  /* R1: PATCH ответил 200, а база осталась с прежним номером. */
  const lost = collisionStore({ renameLands: false })
  const outcomesLost = []
  const lostWrapped = withVerifiedWrites(lost.store, { journal: journal(), onOutcome: (o) => outcomesLost.push(o) })
  const message = await boom(() => lostWrapped.create(FIELDS))
  t('PATCH заявил POI-000002, база показывает POI-000001: PATCH отправлялся', lost.patched(), 1)
  t('  и это НЕ verified', outcomesLost[0]?.state ?? null, 'mismatch')
  has('  и оба номера названы', message, 'POI-000002, в базе POI-000001')

  /* R2, КОНТРПРИМЕР АУДИТА: PATCH ответил 500, create бросил, в базе остался
     дублирующий POI-000001. Граница обязана дать mismatch и recoveryRequired. */
  const failing = collisionStore({ renameLands: false, patchOk: false })
  const outcomesFailing = []
  const failingWrapped = withVerifiedWrites(failing.store, { journal: journal(), onOutcome: (o) => outcomesFailing.push(o) })
  const failingMessage = await boom(() => failingWrapped.create(FIELDS))
  t('PATCH 500: отправлялся', failing.patched(), 1)
  t('PATCH 500: в базе остался занятый номер', failing.rows[0].fields['POI ID'], 'POI-000001')
  t('PATCH 500: НЕ verified', outcomesFailing[0]?.state ?? null, 'mismatch')
  has('PATCH 500: названо, что ожидался новый номер', failingMessage, 'POI-000002')
  has('PATCH 500: и отказ writer’а тоже назван', outcomesFailing[0]?.reason ?? '', 'Airtable POI rename: 500')
  t('PATCH 500: требуется восстановление', /mismatch/.test(failingMessage) && new VerifiedWriteError({ state: outcomesFailing[0]?.state ?? 'verified', sourceKey: 'x', reason: '' }).recoveryRequired, true)

  /* И через ПРОИЗВОДСТВЕННУЮ композицию: хвост остановлен, код возврата 1. */
  const prod = collisionStore({ renameLands: false, patchOk: false })
  const r = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: prod.store })
  t('production, PATCH 500: код возврата 1', r.exitCode, 1)
  t('production, PATCH 500: mismatch', r.report.write?.failure?.state, 'mismatch')
  t('production, PATCH 500: требуется восстановление', r.report.write?.failure?.recoveryRequired, true)
  t('production, PATCH 500: отказ прогона назван', r.report.runFailures?.[0]?.kind, 'writeUnverified')
  t('production, PATCH 500: запись НЕ засчитана созданной', r.report.write?.outcomes?.created, undefined)
  t('production, PATCH 500: строка ушла в разбор', r.report.write?.evidence?.recoveryRequired?.length, 1)
  const journalEntries = await readJournal('журнал прогона читается строгой грамматикой', r.report.write?.evidence?.journal)
  t('production, PATCH 500: журнал несёт намерение переименования ДО PATCH',
    journalEntries.map((e) => e.step ?? e.kind).join(','), 'runStarted,prepare,create,rename,outcome,runFinished')
  t('production, PATCH 500: намерение переименования называет новый номер', journalEntries.find((e) => e.step === 'rename')?.fields?.['POI ID'] ?? null, 'POI-000002')
  t('production, PATCH 500: исход в журнале — mismatch, не verified', journalEntries.find((e) => e.kind === 'outcome')?.state ?? null, 'mismatch')
  /* И по этому журналу поздняя сверка приходит к тому же: mismatch. */
  const late = await reconcileWriteJournal(r.report.write.evidence.journal, { read: (k, names) => prod.store.readFreshBySourceKey(k, names), readByPoiId: (id) => prod.store.readFreshByPoiId(id) })
    .catch((e) => ({ resolved: [{ resolution: `сверка отказала: ${e instanceof Error ? e.message : String(e)}` }] }))
  t('production, PATCH 500: поздняя сверка тоже даёт mismatch', late.resolved[0]?.resolution ?? null, 'mismatch')
  t('  и называет POI ID расходящимся полем', late.resolved[0]?.differing?.join(',') ?? null, 'POI ID')

  /* Отказ самого PATCH больше не проходит молча на сыром хранилище (R0). */
  const rawFailing = collisionStore({ renameLands: false, patchOk: false })
  const rawMessage = await boom(() => rawFailing.store.create(FIELDS))
  has('сырое хранилище: отказ переименования не проходит молча', rawMessage, 'Airtable POI rename: 500')
}

/* ── 11. Хранилище объявляет эффекты ДО них, и граница им управляет ────── */
{
  const live = liveStore()
  const order = []
  const journal = { file: 'x', async intent(p) { order.push(`intent:${p.step}`) }, async outcome() { order.push('outcome') }, async finish() {} }
  const wrapped = withVerifiedWrites(live.store, { journal })
  await wrapped.create({ 'Source Key': SOURCE_KEY, 'POI Name (RU)': 'Замок Осака' })
  const postAt = live.calls.findIndex((c) => c.startsWith('POST'))
  t('порядок: prepare → create → (POST) → outcome', order.join(','), 'intent:prepare,intent:create,outcome')
  t('POST отправлен', postAt >= 0, true)
  /* R2: хранилище ДОЖИДАЕТСЯ намерения, а не только вызывает его. Намерение
     медленное; если POST ушёл раньше, чем оно завершилось, — эффект без
     зафиксированного намерения. */
  const slow = liveStore()
  let postBeforeIntentDone = false
  const slowJournal = { file: 'x', async intent(p) { if (p.step === 'create') { await new Promise((r) => setTimeout(r, 40)); postBeforeIntentDone = slow.calls.some((c) => c.startsWith('POST')) } }, async outcome() {}, async finish() {} }
  await withVerifiedWrites(slow.store, { journal: slowJournal }).create({ 'Source Key': SOURCE_KEY, 'POI Name (RU)': 'Замок Осака' })
  t('POST не уходит, пока намерение create не зафиксировано', postBeforeIntentDone, false)
  t('  и POST всё же отправлен', slow.calls.filter((c) => c.startsWith('POST')).length, 1)
  /* Намерение create отказало — POST не отправляется. */
  const refusing = liveStore()
  const refusingJournal = { file: 'x', async intent(p) { if (p.step === 'create') throw new Error('диск переполнен на create') }, async outcome() {}, async finish() {} }
  const refusingWrapped = withVerifiedWrites(refusing.store, { journal: refusingJournal })
  has('намерение create не записано — эффект не начат, notApplied', await boom(() => refusingWrapped.create({ 'Source Key': SOURCE_KEY })), 'notApplied')
  t('  и POST не отправлялся', refusing.calls.filter((c) => c.startsWith('POST')).length, 0)
  /* Хранилище, не объявляющее эффектов, за границей не получает verified. */
  const silent = { readSchemaTables: async () => [], readFreshBySourceKey: async () => [{ recordId: 'recS', poiId: 'POI-000009', fields: { 'Source Key': SOURCE_KEY, 'POI ID': 'POI-000009' } }], readFreshByPoiId: async () => [{ recordId: 'recS', poiId: 'POI-000009' }], create: async () => ({ poiId: 'POI-000009', recordId: 'recS' }) }
  const outcomesSilent = []
  const silentWrapped = withVerifiedWrites(silent, { journal: { file: 'x', async intent() {}, async outcome() {}, async finish() {} }, onOutcome: (o) => outcomesSilent.push(o) })
  await boom(() => silentWrapped.create({ 'Source Key': SOURCE_KEY }))
  t('хранилище не объявило эффект, а запись есть — mismatch, не verified', outcomesSilent[0]?.state ?? null, 'mismatch')
  has('  и это сказано', outcomesSilent[0]?.reason ?? '', 'эффект не объявлялся')
}

/* Вход на две записи — общий для секций 12 и 13. */
const SUMIYOSHI = `"2","住吉大社","Sumiyoshi Taisha","${DESC}","大阪府","大阪市","大阪府大阪市住吉区住吉2-9-89","34.6125","135.4930","https://example.invalid/2","月曜日","06:00","17:00","06-6672-0753","南海住吉大社駅から徒歩3分"`
const CSV2 = [H, OSAKAJO, SUMIYOSHI].join('\n')
const stubFetch2 = async (u) => {
  const url = String(u)
  if (url.includes('package_show')) return stubFetch(u)
  if (url.includes('data.csv')) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(CSV2).buffer }
  throw new Error(`сеть не предусмотрена: ${url}`)
}
const adapters2 = { 'opendata-csv': (p, o) => collectFromOpenDataCsv(p, { ...o, fetchImpl: stubFetch2 }) }
const places = {
  '大阪城': gplace,
  '住吉大社': { id: 'PID-SUMIYOSHI', displayName: { text: '住吉大社' }, location: { latitude: 34.6125, longitude: 135.4930 }, businessStatus: 'OPERATIONAL', addressComponents: [{ types: ['administrative_area_level_1'], longText: 'Osaka' }] },
}
const resolver2 = (input) => resolvePlace(input, { apiKey: 'ключ-фикстуры', fetchImpl: async (_u, init) => ({ ok: true, json: async () => ({ places: [places[JSON.parse(init.body).textQuery.split(' ')[0]] ?? gplace] }) }) })

/* ── 12. R3: постинвариант уникальности, тождество из базы, хвост ──────────
   Находки аудита R2 (`tmp/10f-r-r3-repro-OLD-2026-09-05.log`):
   (1) POST состоялся, обязательное чтение уникальности POI ID внутри
       хранилища отказало 503; строка по ключу источника совпала с ожидаемым
       итогом — и граница отдавала `verified`, хотя глобальный постинвариант
       writer'а не установлен;
   (2) независимое чтение отдало строку без recordId — граница отдавала
       `verified` и подставляла recordId из заявки writer'а. */
{
  const isPoiIdRead = (target) => target.includes('%7BPOI+ID%7D') || target.includes('{POI ID}')
  const FIELDS = { 'Source Key': SOURCE_KEY, 'POI Name (RU)': 'Замок Осака', 'POI Category (RU)': ['Замок'] }
  const journal = () => ({ file: 'x', async intent() {}, async outcome() {}, async finish() {} })

  /* (1а) Чтение по номеру отказывает и у хранилища, и у границы: unknown. */
  const down = liveStore({ onRead: (target) => (isPoiIdRead(target) ? { ok: false, status: 503, text: async () => 'service unavailable' } : null) })
  const outcomesDown = []
  const downMessage = await boom(() => withVerifiedWrites(down.store, { journal: journal(), onOutcome: (o) => outcomesDown.push(o) }).create(FIELDS))
  t('постусловие 503, чтение по номеру недоступно: POST состоялся', down.rows.length, 1)
  t('  и строка по ключу источника совпадает с итогом поле в поле', Object.entries(down.rows[0].fields).every(([k, v]) => fieldEquals(v, down.rows[0].fields[k])), true)
  t('  но исход — unknown, а не verified', outcomesDown[0]?.state ?? null, 'unknown')
  has('  и причина — постинвариант уникальности', outcomesDown[0]?.reason ?? '', 'постинвариант уникальности POI ID не установлен')
  has('  и отказ writer’а тоже назван', outcomesDown[0]?.reason ?? '', 'Airtable POI read: 503')
  has('  и граница бросила с состоянием unknown', downMessage, 'unknown')
  t('  и это recoveryRequired', new VerifiedWriteError({ state: outcomesDown[0]?.state ?? 'verified', sourceKey: 'x', reason: '' }).recoveryRequired, true)
  t('  и граница читала по номеру сама, после чтения по ключу', down.calls.slice(down.calls.indexOf('POST tblVCmFcHRpXUT24y') + 1).filter((c) => c === 'GET search').length, 3)

  /* (1б) Отказ только у постусловия хранилища; чтения границы отвечают:
     потерянный ответ устанавливается независимыми чтениями — ДВУМЯ. */
  let poiIdReads = 0
  const once = liveStore({ onRead: (target) => (isPoiIdRead(target) && ++poiIdReads === 1 ? { ok: false, status: 503, text: async () => 'service unavailable' } : null) })
  const outcomesOnce = []
  const onceResult = await withVerifiedWrites(once.store, { journal: journal(), onOutcome: (o) => outcomesOnce.push(o) }).create(FIELDS).catch((e) => ({ thrown: e.message }))
  t('постусловие 503 один раз, чтения границы отвечают: writer бросил', poiIdReads >= 2, true)
  t('  и исход — verified по двум независимым чтениям', outcomesOnce[0]?.state ?? null, 'verified')
  has('  и в причине — номер занят только этой записью', outcomesOnce[0]?.reason ?? '', 'номер занят только ею')
  has('  и отказ writer’а сохранён в причине', outcomesOnce[0]?.reason ?? '', 'Airtable POI read: 503')
  t('  и запись возвращена с id из базы', onceResult.recordId, 'rec801')

  /* (1в) Постусловие отказало, а номер на деле занят двумя записями: mismatch. */
  let dupReads = 0
  const dup = liveStore({ onRead: (target, rows) => {
    if (!isPoiIdRead(target)) return null
    if (++dupReads === 1) return { ok: false, status: 503, text: async () => 'service unavailable' }
    return { ok: true, status: 200, json: async () => ({ records: [...rows.map((r) => ({ id: r.id, fields: { ...r.fields } })), { id: 'recЧУЖАЯ', fields: { 'POI ID': rows[0]?.fields['POI ID'], 'Source Key': 'чужой:9' } }] }) }
  } })
  const outcomesDup = []
  await boom(() => withVerifiedWrites(dup.store, { journal: journal(), onOutcome: (o) => outcomesDup.push(o) }).create(FIELDS))
  t('постусловие 503, номер занят двумя — mismatch', outcomesDup[0]?.state ?? null, 'mismatch')
  has('  и обе записи названы', outcomesDup[0]?.reason ?? '', 'recЧУЖАЯ')
  t('  и поле названо', outcomesDup[0]?.differing?.join(',') ?? null, 'POI ID')

  /* (2) Строка без recordId: тождества нет — unknown, id не подставляется. */
  const noId = liveStore({ onRead: (target, rows) => (target.includes('Source+Key')
    ? { ok: true, status: 200, json: async () => ({ records: rows.map((r) => ({ fields: { ...r.fields } })) }) }
    : null) })
  const outcomesNoId = []
  const noIdResult = await withVerifiedWrites(noId.store, { journal: journal(), onOutcome: (o) => outcomesNoId.push(o) }).create(FIELDS).catch((e) => ({ thrown: e.message }))
  t('чтение без recordId при совпадающих полях — unknown, не verified', outcomesNoId[0]?.state ?? null, 'unknown')
  t('  и recordId в исходе не подставлен из заявки writer’а', outcomesNoId[0]?.recordId ?? null, null)
  has('  и заявка writer’а — в причине, не в тождестве', outcomesNoId[0]?.reason ?? '', 'writer заявил rec801')
  has('  и граница бросила', noIdResult.thrown ?? '', 'unknown')
  /* Тождество возвращается из базы всегда — и при успехе. */
  const plain = liveStore()
  const plainResult = await withVerifiedWrites(plain.store, { journal: journal() }).create(FIELDS)
  t('успех: возвращённое тождество — из базы (то же, что заявил writer, но прочитанное)', `${plainResult.recordId}/${plainResult.poiId}`, 'rec801/POI-000001')

  /* ПРОИЗВОДСТВЕННАЯ КОМПОЗИЦИЯ, ДВЕ ЗАПИСИ: первый исход не подтверждён →
     хвост не исполняется, код возврата 1. */
  const NAMES2 = await file('names2.json', { 'bodik-osaka-tourism:1': { nameRu: 'Замок Осака' }, 'bodik-osaka-tourism:2': { nameRu: 'Сумиёси-тайся' } })
  const ref2 = await run({ argv: ['--dry-write', '--existing', EXISTING, '--names', NAMES2], store: createSnapshotStore([SNAP_ROW]), adapters: adapters2, placeResolver: resolver2 })
  t('две записи, эталон: сухой прогон создал две', ref2.report.write?.outcomes?.created, 2)
  const REF2 = await file('reference2.json', ref2.report)
  /* Живое хранилище на две записи: POST даёт разные id; чтение по ключу — по ключу. */
  const live2 = (onRead) => {
    const rows = []; const calls = []
    const schema = [{ name: 'POI ID', type: 'singleLineText' }, ...expectedTaxonomyFieldSchema().map((f) => ({ name: f.name, type: f.type, options: f.choices ? { choices: f.choices.map((name) => ({ name })) } : undefined }))]
    const store = createAirtablePoiStore({ token: 'tok', baseId: 'appTEST', fetchImpl: async (url, init = {}) => {
      const method = init.method ?? 'GET'; const target = String(url)
      calls.push(`${method} ${target.includes('filterByFormula') ? 'search' : target.split('/').pop()}`)
      if (target.includes('/meta/')) return { ok: true, status: 200, json: async () => ({ tables: [{ id: POI_TABLE_ID, name: 'POI', fields: schema }] }) }
      if (method === 'POST') { const fields = JSON.parse(init.body).records[0].fields; const id = `rec80${rows.length + 1}`; rows.push({ id, fields }); return { ok: true, status: 200, json: async () => ({ records: [{ id }] }) } }
      const decided = onRead ? onRead(target, rows) : null
      if (decided) return decided
      const filter = target.includes('filterByFormula') ? decodeURIComponent(target.split('filterByFormula=')[1].split('&')[0].replace(/\+/g, ' ')) : null
      const wanted = filter?.match(/'([^']+)'/)?.[1]
      const filtered = !filter ? rows : filter.includes('Source Key') ? rows.filter((r) => r.fields['Source Key'] === wanted) : rows.filter((r) => r.fields['POI ID'] === wanted)
      return { ok: true, status: 200, json: async () => ({ records: filtered.map((r) => ({ id: r.id, fields: { ...r.fields } })) }) }
    } })
    return { store, rows, calls }
  }
  const prodDown = live2((target) => (isPoiIdRead(target) ? { ok: false, status: 503, text: async () => 'service unavailable' } : null))
  const r = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES2, '--monitor', REF2], store: prodDown.store, adapters: adapters2, placeResolver: resolver2 })
  t('production, постусловие 503: код возврата 1', r.exitCode, 1)
  t('production, постусловие 503: отказ прогона назван', r.report.runFailures?.[0]?.kind, 'writeUnverified')
  t('production, постусловие 503: состояние unknown', r.report.write?.failure?.state, 'unknown')
  t('production, постусловие 503: требуется восстановление', r.report.write?.failure?.recoveryRequired, true)
  t('production, постусловие 503: ХВОСТ НЕ ИСПОЛНЯЛСЯ — ровно один POST на две записи', prodDown.calls.filter((c) => c.startsWith('POST')).length, 1)
  t('  и в базе одна строка', prodDown.rows.length, 1)
  t('  и отчёт говорит, где остановились', `${r.report.write?.stoppedAfter}/${r.report.write?.notAttempted}`, '1/1')
  t('  и ничего не засчитано созданным', r.report.write?.outcomes?.created, undefined)
  const entries = await readJournal('журнал прогона читается строгой грамматикой', r.report.write?.evidence?.journal)
  t('  и журнал: одна попытка, исход unknown, закрывающая строка выведена', entries.map((e) => e.step ?? (e.kind === 'runFinished' ? `runFinished:${e.attempts}/${e.failed}` : e.kind === 'outcome' ? `outcome:${e.state}` : e.kind)).join(','), 'runStarted,prepare,create,outcome:unknown,runFinished:1/true')
  /* Положительный контроль того же входа: обе записи verified, код 0. */
  const prodOk = live2(null)
  const ok2 = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES2, '--monitor', REF2], store: prodOk.store, adapters: adapters2, placeResolver: resolver2 })
  t('production, контроль на двух записях: код возврата 0', ok2.exitCode, 0)
  t('  и обе verified', JSON.stringify(ok2.report.write?.evidence?.byState), '{"verified":2}')
  t('  и два POST', prodOk.calls.filter((c) => c.startsWith('POST')).length, 2)
  const okEntries = await readJournal('журнал контроля читается строгой грамматикой', ok2.report.write?.evidence?.journal)
  t('  и закрывающая строка: 2 попытки, failed false', okEntries.at(-1)?.attempts + '/' + okEntries.at(-1)?.failed, '2/false')
  /* Production, строка без recordId: unknown, код 1, хвост не исполнялся. */
  const prodNoId = live2((target, rows) => (target.includes('Source+Key') ? { ok: true, status: 200, json: async () => ({ records: rows.map((r) => ({ fields: { ...r.fields } })) }) } : null))
  const r2 = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES2, '--monitor', REF2], store: prodNoId.store, adapters: adapters2, placeResolver: resolver2 })
  t('production, чтение без recordId: код возврата 1', r2.exitCode, 1)
  t('  и состояние unknown', r2.report.write?.failure?.state, 'unknown')
  t('  и recordId в отказе не подставлен', r2.report.write?.failure?.recordId ?? null, null)
  t('  и хвост не исполнялся', prodNoId.calls.filter((c) => c.startsWith('POST')).length, 1)
}

/* ── 13. R4: ответ чтения доказывает себя сам; отказ записи исхода печатает журнал ──
   Находки аудита R3 (`tmp/10f-r-r4-repro-OLD-2026-09-05.log`):
   (2) чтение по номеру POI-000001 вернуло запись с верным recordId, но с
       POI ID = POI-999999 или без POI ID — граница давала `verified`;
   (1) строка `outcome` прошла грамматику, физическая запись отказала до байтов,
       `finish()` дописывал seq 5 с `failed:false` — журнал непригоден для сверки. */
{
  const isPoiIdRead = (target) => target.includes('%7BPOI+ID%7D') || target.includes('{POI ID}')
  const FIELDS = { 'Source Key': SOURCE_KEY, 'POI Name (RU)': 'Замок Осака', 'POI Category (RU)': ['Замок'] }
  const journal = () => ({ file: 'x', async intent() {}, async outcome() {}, async finish() {} })
  const poiIdAnswer = (fieldsOf) => (target, rows) => (isPoiIdRead(target)
    ? { ok: true, status: 200, json: async () => ({ records: rows.map((r) => ({ id: r.id, fields: fieldsOf(r) })) }) }
    : null)

  /* (2а) Тот же recordId, чужой номер в ответе на запрос по номеру. */
  const wrongNumber = liveStore({ onRead: poiIdAnswer((r) => ({ ...r.fields, 'POI ID': 'POI-999999' })) })
  const outcomesWrong = []
  const wrongMessage = await boom(() => withVerifiedWrites(wrongNumber.store, { journal: journal(), onOutcome: (o) => outcomesWrong.push(o) }).create(FIELDS))
  t('чтение по номеру отдало запись с POI-999999: исход — unknown, не verified', outcomesWrong[0]?.state ?? null, 'unknown')
  has('  и причина: фильтру сервера не верим', outcomesWrong[0]?.reason ?? '', 'фильтру сервера не верим')
  has('  и чужой номер назван', outcomesWrong[0]?.reason ?? '', 'POI-999999')
  has('  и граница бросила', wrongMessage, 'unknown')
  /* (2б) Тот же recordId, без номера. */
  const noNumber = liveStore({ onRead: poiIdAnswer((r) => { const f = { ...r.fields }; delete f['POI ID']; return f }) })
  const outcomesNoNumber = []
  await boom(() => withVerifiedWrites(noNumber.store, { journal: journal(), onOutcome: (o) => outcomesNoNumber.push(o) }).create(FIELDS))
  t('чтение по номеру отдало запись без POI ID: исход — unknown', outcomesNoNumber[0]?.state ?? null, 'unknown')
  has('  и это сказано', outcomesNoNumber[0]?.reason ?? '', '(без номера)')
  /* Симметрично для чтения по ключу источника: чужой ключ в ответе. */
  const foreignKey = liveStore({ onRead: (target, rows) => (target.includes('Source+Key')
    ? { ok: true, status: 200, json: async () => ({ records: rows.map((r) => ({ id: r.id, fields: { ...r.fields, 'Source Key': 'чужой:77' } })) }) }
    : null) })
  const outcomesForeign = []
  await boom(() => withVerifiedWrites(foreignKey.store, { journal: journal(), onOutcome: (o) => outcomesForeign.push(o) }).create(FIELDS))
  t('чтение по ключу отдало запись с чужим Source Key: исход — unknown', outcomesForeign[0]?.state ?? null, 'unknown')
  has('  и причина названа', outcomesForeign[0]?.reason ?? '', 'другим ключом источника')
  /* Положительный контроль: честный ответ — verified. */
  const honest = liveStore()
  const outcomesHonest = []
  await withVerifiedWrites(honest.store, { journal: journal(), onOutcome: (o) => outcomesHonest.push(o) }).create(FIELDS)
  t('контроль: честный ответ по номеру — verified', outcomesHonest[0]?.state ?? null, 'verified')

  /* Production, две записи: чужой номер в ответе → unknown, код 1, хвост не исполнялся. */
  const live2 = (onRead) => {
    const rows = []; const calls = []
    const schema = [{ name: 'POI ID', type: 'singleLineText' }, ...expectedTaxonomyFieldSchema().map((f) => ({ name: f.name, type: f.type, options: f.choices ? { choices: f.choices.map((name) => ({ name })) } : undefined }))]
    const store = createAirtablePoiStore({ token: 'tok', baseId: 'appTEST', fetchImpl: async (url, init = {}) => {
      const method = init.method ?? 'GET'; const target = String(url)
      calls.push(`${method} ${target.includes('filterByFormula') ? 'search' : target.split('/').pop()}`)
      if (target.includes('/meta/')) return { ok: true, status: 200, json: async () => ({ tables: [{ id: POI_TABLE_ID, name: 'POI', fields: schema }] }) }
      if (method === 'POST') { const fields = JSON.parse(init.body).records[0].fields; const id = `rec80${rows.length + 1}`; rows.push({ id, fields }); return { ok: true, status: 200, json: async () => ({ records: [{ id }] }) } }
      const decided = onRead ? onRead(target, rows) : null
      if (decided) return decided
      const filter = target.includes('filterByFormula') ? decodeURIComponent(target.split('filterByFormula=')[1].split('&')[0].replace(/\+/g, ' ')) : null
      const wanted = filter?.match(/'([^']+)'/)?.[1]
      const filtered = !filter ? rows : filter.includes('Source Key') ? rows.filter((r) => r.fields['Source Key'] === wanted) : rows.filter((r) => r.fields['POI ID'] === wanted)
      return { ok: true, status: 200, json: async () => ({ records: filtered.map((r) => ({ id: r.id, fields: { ...r.fields } })) }) }
    } })
    return { store, rows, calls }
  }
  const NAMES2 = await file('names2-r4.json', { 'bodik-osaka-tourism:1': { nameRu: 'Замок Осака' }, 'bodik-osaka-tourism:2': { nameRu: 'Сумиёси-тайся' } })
  const REF2 = path.join(dir, 'reference2.json')
  const prodWrong = live2(poiIdAnswer((r) => ({ ...r.fields, 'POI ID': 'POI-999999' })))
  const r = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES2, '--monitor', REF2], store: prodWrong.store, adapters: adapters2, placeResolver: resolver2 })
  t('production, чужой номер в ответе: код возврата 1', r.exitCode, 1)
  t('  и состояние unknown, требуется восстановление', `${r.report.write?.failure?.state}/${r.report.write?.failure?.recoveryRequired}`, 'unknown/true')
  t('  и ХВОСТ НЕ ИСПОЛНЯЛСЯ — один POST на две записи', prodWrong.calls.filter((c) => c.startsWith('POST')).length, 1)

  /* (1) ПРОИЗВОДСТВЕННЫЙ ПРОГОН С НАСТОЯЩИМ ЖУРНАЛОМ, запись исхода отказала
     до появления байтов (инжектированный транспорт файла: отказ на 4-м
     открытии — строка outcome). POST состоялся. */
  let opens = 0
  const sealedJournal = await openWriteJournal({
    dir: path.join(dir, 'journal'), runId: 'run-r4-sealed', now: NOW,
    io: { open: async (f, flags) => { opens += 1; if (opens === 4) { const e = new Error('EACCES: permission denied, open'); e.code = 'EACCES'; throw e } return DIRECTORY_IO.open(f, flags) } },
  })
  const prodSeal = live2(null)
  const rs = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES2, '--monitor', REF2], store: prodSeal.store, adapters: adapters2, placeResolver: resolver2, journal: sealedJournal })
  t('production, запись исхода отказала: код возврата 1', rs.exitCode, 1)
  t('  и отказ прогона — writeUnverified/unknown', `${rs.report.runFailures?.[0]?.kind}/${rs.report.write?.failure?.state}`, 'writeUnverified/unknown')
  has('  и причина — исход не записан после возможного эффекта', rs.report.write?.failure?.reason ?? '', 'исход не записан в журнал после возможного эффекта')
  t('  и журнал запечатан на строке 4 (outcome) — отчёт это показывает', `${rs.report.write?.evidence?.journalSealed?.seq}/${rs.report.write?.evidence?.journalSealed?.kind}`, '4/outcome')
  t('  и POST состоялся один раз, хвост не исполнялся', prodSeal.calls.filter((c) => c.startsWith('POST')).length, 1)
  const sealedRead = await readWriteJournalDetailed(sealedJournal.file).catch((e) => ({ entries: [], tornTail: `отказ: ${e.message}` }))
  t('  и на диске — сплошной префикс без seq 5: runStarted, prepare, create', sealedRead.entries.map((e) => e.step ?? e.kind).join(','), 'runStarted,prepare,create')
  t('  и оборванного хвоста нет (отказ был до байтов)', sealedRead.tornTail, null)
  const sealedReconcile = await reconcileWriteJournal(sealedJournal.file, { read: (k, names) => prodSeal.store.readFreshBySourceKey(k, names), readByPoiId: (id) => prodSeal.store.readFreshByPoiId(id) })
    .catch((e) => ({ resolved: [{ resolution: `сверка отказала: ${e.message}` }] }))
  t('  и поздняя сверка по сохранённому намерению устанавливает исход чтениями — verified', sealedReconcile.resolved[0]?.resolution ?? null, 'verified')
  t('  и id — из базы', sealedReconcile.resolved[0]?.recordId ?? null, 'rec801')
}

/* ── 14. R5: close() после sync, календарно невозможный момент, байты после runFinished ──
   Находки аудита R4 (`tmp/10f-r-r5-repro-OLD-2026-09-05.log`). */
{
  /* (2) fieldEquals — чистая функция и через границу. */
  t('fieldEquals: 3 марта ≠ 31 февраля (Date.parse читал бы их как один момент)', fieldEquals('2026-03-03T12:00:00.000Z', '2026-02-31T12:00:00.000Z'), false)
  t('fieldEquals: 31 февраля не равно даже самому себе — такого момента нет', fieldEquals('2026-02-31T12:00:00.000Z', '2026-02-31T12:00:00.000Z'), false)
  t('fieldEquals: 29 февраля 2026 (не високосный) — невозможен', fieldEquals('2026-02-29T00:00:00.000Z', '2026-03-01T00:00:00.000Z'), false)
  t('fieldEquals: 29 февраля 2024 — возможен и равен себе в другой записи', fieldEquals('2024-02-29T00:00:00Z', '2024-02-29T00:00:00.000Z'), true)
  t('fieldEquals: 24:00:00 — невозможен', fieldEquals('2026-03-03T24:00:00.000Z', '2026-03-04T00:00:00.000Z'), false)
  t('fieldEquals: тот же момент в двух написаниях — равен', fieldEquals('2026-03-03T12:00:00Z', '2026-03-03T12:00:00.000Z'), true)
  t('fieldEquals: разные настоящие моменты — не равны', fieldEquals('2026-03-03T12:00:00.000Z', '2026-03-03T12:00:01.000Z'), false)
  /* Через production-границу: хранилище-фикстура объявляет нагрузку с 3 марта,
     независимое чтение отдаёт 31 февраля. */
  const fixtureStore = (seededAtInBase) => {
    const payload = { 'Source Key': SOURCE_KEY, 'POI Name (RU)': 'Замок Осака', 'POI ID': 'POI-000001', 'Last Seeded At': '2026-03-03T12:00:00.000Z' }
    return {
      readSchemaTables: async () => [],
      readFreshBySourceKey: async () => [{ recordId: 'recF', poiId: 'POI-000001', fields: { ...payload, 'Last Seeded At': seededAtInBase } }],
      readFreshByPoiId: async () => [{ recordId: 'recF', poiId: 'POI-000001' }],
      create: async (_fields, { onEffect }) => { await onEffect({ step: 'create', payload: { ...payload } }); return { poiId: 'POI-000001', recordId: 'recF' } },
    }
  }
  const j = () => ({ file: 'x', async intent() {}, async outcome() {}, async finish() {} })
  const outcomesImpossible = []
  await boom(() => withVerifiedWrites(fixtureStore('2026-02-31T12:00:00.000Z'), { journal: j(), onOutcome: (o) => outcomesImpossible.push(o) }).create({ 'Source Key': SOURCE_KEY }))
  t('граница: в базе 31 февраля при ожидаемом 3 марта — mismatch, не verified', outcomesImpossible[0]?.state ?? null, 'mismatch')
  t('  и поле названо', outcomesImpossible[0]?.differing?.join(',') ?? null, 'Last Seeded At')
  const outcomesFine = []
  await withVerifiedWrites(fixtureStore('2026-03-03T12:00:00Z'), { journal: j(), onOutcome: (o) => outcomesFine.push(o) }).create({ 'Source Key': SOURCE_KEY })
  t('граница: тот же момент без миллисекунд — verified (контроль)', outcomesFine[0]?.state ?? null, 'verified')

  /* (3) Production-журнал успешного прогона + фрагмент после runFinished. */
  const live = liveStore()
  const r = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: live.store })
  t('контроль: прогон успешен, журнал завершён', `${r.exitCode}/${(await readJournal('журнал контроля', r.report.write?.evidence?.journal)).at(-1)?.kind}`, '0/runFinished')
  const damaged = path.join(dir, 'damaged-after-finish.ndjson')
  await writeFile(damaged, `${await readFile(r.report.write.evidence.journal, 'utf8')}{"spec":"poi-write-journal/v1","seq":6,"kind":"outc`)
  has('фрагмент после runFinished production-журнала — отказ читателя', await boom(() => readWriteJournalDetailed(damaged)), 'после runFinished — журнал повреждён')
  const cli = { exitCode: 0 }
  const realLog = console.log; const realErr = console.error; const printed = []
  console.log = (v) => printed.push(String(v)); console.error = (v) => printed.push(String(v))
  try { await runReconcileCli(['n', 'r', damaged], {}, cli) } finally { console.log = realLog; console.error = realErr }
  t('  и poi:reconcile по нему — код возврата 1', cli.exitCode, 1)
  has('  и причина названа', printed.join('\n'), 'после runFinished')
  const intact = { exitCode: 0 }
  console.log = () => {}; console.error = () => {}
  try { await runReconcileCli(['n', 'r', r.report.write.evidence.journal], {}, intact) } finally { console.log = realLog; console.error = realErr }
  t('  а неповреждённый журнал того же прогона — код 0 (контроль)', intact.exitCode, 0)

  /* (1) Production-прогон с настоящим журналом: close() после sync бросает на строке outcome. */
  let opens = 0
  const closeJournal = await openWriteJournal({
    dir: path.join(dir, 'journal'), runId: 'run-r5-close', now: NOW,
    io: { open: async (f, flags) => { opens += 1; const h = await DIRECTORY_IO.open(f, flags); if (opens !== 4) return h; return { writeFile: (t, e) => h.writeFile(t, e), sync: () => h.sync(), close: async () => { await h.close(); throw new Error('EIO: close failed') } } } },
  })
  const prodClose = liveStore()
  const rc = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: prodClose.store, journal: closeJournal })
  t('production, close() бросил после sync: код возврата 1', rc.exitCode, 1)
  t('  и отказ — writeUnverified/unknown', `${rc.report.runFailures?.[0]?.kind}/${rc.report.write?.failure?.state}`, 'writeUnverified/unknown')
  t('  и журнал запечатан на строке 4', `${rc.report.write?.evidence?.journalSealed?.seq}/${rc.report.write?.evidence?.journalSealed?.kind}`, '4/outcome')
  const closeRead = await readWriteJournalDetailed(closeJournal.file).catch((e) => ({ entries: [], tornTail: `отказ: ${e.message}` }))
  t('  и на диске сплошной префикс 1–4 без повтора seq и без runFinished', closeRead.entries.map((e) => e.seq).join(','), '1,2,3,4')
  t('  и последняя строка — исход, записанный до отказа close()', `${closeRead.entries.at(-1)?.kind}:${closeRead.entries.at(-1)?.state}`, 'outcome:verified')
  const closeReconcile = await reconcileWriteJournal(closeJournal.file, { read: (k, n) => prodClose.store.readFreshBySourceKey(k, n), readByPoiId: (id) => prodClose.store.readFreshByPoiId(id) })
    .catch((e) => ({ resolved: [{ resolution: `сверка отказала: ${e.message}` }], byState: null }))
  t('  и поздняя сверка читает журнал: исход уже verified, разбирать нечего', JSON.stringify(closeReconcile.byState), '{"verified":1}')
}

/* ── 15. R6: печать по ЛЮБОМУ брошенному значению; физическая грамматика ──
   Находки аудита R5 (`tmp/10f-r-r6-repro-OLD-2026-09-05.log`):
   (1) `seal` сам разбирал брошенное значение (`instanceof`, `.message`,
       `String`) — отозванный Proxy из `close()` ронял саму печать: `sealed`
       оставался null, `finish()` дописывал строку с тем же seq, журнал
       становился нечитаемым;
   (2) читатель отбрасывал пустые физические строки — лишний `\n` после
       `runFinished` проходил, `poi:reconcile` возвращал код 0. */
{
  const revoked = () => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy }
  /* (1) ПРОИЗВОДСТВЕННЫЙ ПРОГОН: настоящий handle пишет строку и делает sync,
     затем close() закрывает настоящий дескриптор и бросает отозванный Proxy. */
  let opens = 0
  const hostileJournal = await openWriteJournal({
    dir: path.join(dir, 'journal'), runId: 'run-r6-hostile', now: NOW,
    io: { open: async (f, flags) => {
      opens += 1
      const h = await DIRECTORY_IO.open(f, flags)
      if (opens !== 4) return h
      return { writeFile: (t, e) => h.writeFile(t, e), sync: () => h.sync(), close: async () => { await h.close(); throw revoked() } }
    } },
  })
  const prod = liveStore()
  const r = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: prod.store, journal: hostileJournal })
  t('production, close() бросил отозванный Proxy: код возврата 1', r.exitCode, 1)
  t('  и отказ прогона — writeUnverified/unknown', `${r.report.runFailures?.[0]?.kind}/${r.report.write?.failure?.state}`, 'writeUnverified/unknown')
  t('  и журнал запечатан на строке 4 (outcome)', `${r.report.write?.evidence?.journalSealed?.seq}/${r.report.write?.evidence?.journalSealed?.kind}`, '4/outcome')
  t('  и причина печати — непустая строка, а не крушение', typeof r.report.write?.evidence?.journalSealed?.reason === 'string' && r.report.write.evidence.journalSealed.reason.length > 0, true)
  t('  и отчёт сериализуем целиком (враждебное значение в него не попало)', typeof JSON.stringify(r.report), 'string')
  const hostileRead = await readWriteJournalDetailed(hostileJournal.file).catch((e) => ({ entries: [], tornTail: `отказ: ${e.message}` }))
  t('  и на диске сплошной префикс 1–4 без повторного seq', hostileRead.entries.map((e) => e.seq).join(','), '1,2,3,4')
  t('  и последняя строка — исход, записанный до отказа close()', `${hostileRead.entries.at(-1)?.kind}:${hostileRead.entries.at(-1)?.state}`, 'outcome:verified')
  const hostileReconcile = await reconcileWriteJournal(hostileJournal.file, { read: (k, n) => prod.store.readFreshBySourceKey(k, n), readByPoiId: (id) => prod.store.readFreshByPoiId(id) })
    .catch((e) => ({ byState: `отказ: ${e.message}` }))
  t('  и поздняя сверка читает журнал: исход уже verified', JSON.stringify(hostileReconcile.byState), '{"verified":1}')

  /* (2) Физическая грамматика на ПРОИЗВОДСТВЕННОМ журнале успешного прогона. */
  const clean = liveStore()
  const ok = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: clean.store })
  t('контроль: прогон успешен, журнал завершён', `${ok.exitCode}/${(await readJournal('журнал контроля R6', ok.report.write?.evidence?.journal)).at(-1)?.kind}`, '0/runFinished')
  const source = await readFile(ok.report.write.evidence.journal, 'utf8')
  const extraNl = path.join(dir, 'r6-extra-nl.ndjson')
  await writeFile(extraNl, `${source}\n`)
  has('дополнительный \\n после runFinished — именованный отказ', await boom(() => readWriteJournalDetailed(extraNl)), 'после runFinished не может быть никаких байтов')
  const emptyMid = path.join(dir, 'r6-empty-mid.ndjson')
  const parts = source.split('\n')
  await writeFile(emptyMid, [parts[0], parts[1], '', ...parts.slice(2)].join('\n'))
  has('пустая строка внутри production-журнала — именованный отказ', await boom(() => readWriteJournalDetailed(emptyMid)), 'строка 3 пуста')
  const codes = {}
  for (const [label, file] of [['extraNl', extraNl], ['emptyMid', emptyMid], ['intact', ok.report.write.evidence.journal]]) {
    const target = { exitCode: 0 }
    const realLog = console.log; const realErr = console.error
    console.log = () => {}; console.error = () => {}
    try { await runReconcileCli(['n', 'r', file], {}, target) } finally { console.log = realLog; console.error = realErr }
    codes[label] = target.exitCode
  }
  t('poi:reconcile: повреждённые — код 1, неповреждённый — код 0', JSON.stringify(codes), '{"extraNl":1,"emptyMid":1,"intact":0}')
}

/* ── 16. R7: отказ io.open внутри append на production-прогоне ────────────
   Находка аудита R6: `catch` в `append` читал `error?.code`, чтобы отличить
   EEXIST. На отозванном Proxy это ловушка `get`: вторичный TypeError, печати
   нет, `finish()` дописывал `runFinished` — журнал читался как ЗАКОНЧЕННЫЙ,
   хотя исход записан не был (`tmp/10f-r-r7-repro-OLD-2026-09-05.log`). */
{
  const revoked = () => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy }
  let opens = 0
  const openFailJournal = await openWriteJournal({
    dir: path.join(dir, 'journal'), runId: 'run-r7-open', now: NOW,
    io: { open: async (f, flags) => { opens += 1; if (opens === 4) throw revoked(); return DIRECTORY_IO.open(f, flags) } },
  })
  const prod = liveStore()
  const r = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF], store: prod.store, journal: openFailJournal })
  t('production, io.open бросил отозванный Proxy: код возврата 1', r.exitCode, 1)
  t('  и отказ прогона — writeUnverified/unknown', `${r.report.runFailures?.[0]?.kind}/${r.report.write?.failure?.state}`, 'writeUnverified/unknown')
  t('  и журнал запечатан на строке 4 (outcome)', `${r.report.write?.evidence?.journalSealed?.seq}/${r.report.write?.evidence?.journalSealed?.kind}`, '4/outcome')
  t('  и причина печати — непустая строка', typeof r.report.write?.evidence?.journalSealed?.reason === 'string' && r.report.write.evidence.journalSealed.reason.length > 0, true)
  t('  и отчёт сериализуем целиком', typeof JSON.stringify(r.report), 'string')
  const disk = await readWriteJournalDetailed(openFailJournal.file).catch((e) => ({ entries: [], tornTail: `отказ: ${e.message}` }))
  t('  и на диске НЕЗАВЕРШЁННЫЙ префикс 1,2,3 без runFinished', `${disk.entries.map((e) => e.seq).join(',')}/${disk.entries.at(-1)?.kind}`, '1,2,3/intent')
  t('  и закрывающей строки нет — журнал не выдаёт себя за законченный', disk.entries.some((e) => e.kind === 'runFinished'), false)
  const late = await reconcileWriteJournal(openFailJournal.file, { read: (k, n) => prod.store.readFreshBySourceKey(k, n), readByPoiId: (id) => prod.store.readFreshByPoiId(id) })
    .catch((e) => ({ resolved: [{ resolution: `сверка отказала: ${e.message}` }] }))
  t('  и поздняя сверка разбирает сохранённое намерение — verified по чтениям', late.resolved[0]?.resolution ?? null, 'verified')
  t('  и эффект действительно состоялся (POST был)', prod.rows.length, 1)
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ надёжная граница записи POI: ${ok} проверок пройдено`)
}
