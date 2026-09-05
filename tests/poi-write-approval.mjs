#!/usr/bin/env node
/**
 * Разрешение владельца на ограниченную живую запись (10f-S, P10.2).
 *
 *   node tests/poi-write-approval.mjs
 *
 * Предмет: состав эффектов назван ЗАРАНЕЕ, потолок известен ДО исполнения, а
 * само разрешение относится к ТОМУ результату, который владелец видел, и
 * исполняется ОДИН раз.
 *
 * Контрпримеры, по которым написан каждый раздел (все воспроизведены через
 * production-границы, `tmp/10f-s-r1-repro-OLD-2026-09-05.log`):
 *   1. Подмена русских имён вместе с пересборкой эталона проходила по ТОМУ ЖЕ
 *      разрешению: привязки к результату не было (была привязка к сырым
 *      байтам выгрузки, в которые имена не входят).
 *   2. Повторный прогон с тем же разрешением снова писал и снова платил:
 *      одноразовости не было вовсе.
 *   3. Разрешение, выданное будущим числом, действовало: проверялся только
 *      верхний край срока.
 *   4. Внутренний PATCH переименования номера не входил ни в один потолок,
 *      хотя текст разрешения обещал «только создание».
 *   5. Сюита подставляла готовое разрешение через `deps`, поэтому чтение
 *      файла, разбор формы и одноразовость не проверялись ничем; а
 *      `readWriteApprovalFile` на пустом имени выпускал сырой `TypeError`.
 *
 * Композиция здесь НАСТОЯЩАЯ: `--allow <имя>` → каталог разрешений →
 * однократное чтение → разбор → ворота → отметка исполнения → writer.
 * Подставлены только адаптер, резолвер, хранилище и — для прогонов в этом
 * процессе — КОРЕНЬ каталога разрешений (среда не может удалять файлы в
 * рабочем дереве). Полный канонический путь, с корнем настоящего репозитория,
 * проверяется отдельным разделом в песочнице-копии production-дерева.
 */
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runCli } from '../scripts/poi-portals/collect-pois.mjs'
import { collectFromOpenDataCsv } from '../scripts/poi-portals/lib/opendata-csv.mjs'
import { createAirtablePoiStore } from '../scripts/poi-portals/lib/airtable-store.mjs'
import { createSnapshotStore } from '../scripts/poi-portals/lib/base-snapshot.mjs'
import { withVerifiedWrites } from '../scripts/poi-portals/lib/verified-write.mjs'
import { expectedTaxonomyFieldSchema } from '../src/lib/poi-taxonomy-airtable.ts'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'
import { resolvePlace } from '../src/lib/place-resolve.ts'
import { sha256Bytes } from '../scripts/lib/byte-digest.mjs'
import {
  assertWriteApprovalApplies, claimWriteApproval, parseWriteApproval, readWriteApprovalFile,
  WRITE_APPROVAL_KEYS, WRITE_APPROVAL_PRIOR_SPECS, WRITE_APPROVAL_REFUSALS, WRITE_APPROVAL_ROOT_SEGMENTS,
  WRITE_APPROVAL_SPEC, WRITE_APPROVAL_USED_SEGMENT, WriteApprovalRefused, writeApprovalDigest,
} from '../scripts/poi-portals/lib/write-approval.mjs'
import { writeApprovalFixture } from './support/write-approval-fixture.mjs'
import { createProductionSandbox } from './support/production-sandbox.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${String(text).slice(0, 200)}» нет «${needle}»`)
}
const refusal = async (fn) => {
  try { await fn(); return { reason: '(без отказа)', message: '(без отказа)' } } catch (e) {
    if (e instanceof WriteApprovalRefused) return { reason: e.reason, message: e.message }
    return { reason: `(чужая ошибка) ${e?.constructor?.name}`, message: e instanceof Error ? e.message : String(e) }
  }
}
const exists = async (p) => { try { await stat(p); return true } catch { return false } }
process.on('uncaughtException', (e) => {
  bad.push(`сюита оборвана необработанной ошибкой: ${e instanceof Error ? e.message : String(e)}`)
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exit(1)
})

const NOW = new Date('2026-09-05T00:00:00.000Z')
const REF_DIGEST = `sha256:${'a'.repeat(64)}`
const base = (over = {}) => ({
  spec: WRITE_APPROVAL_SPEC,
  scopeId: 'poi-parser-v1',
  portal: 'bodik-osaka-tourism',
  issuedAt: '2026-09-05T00:00:00.000Z',
  expiresAt: '2026-09-12T00:00:00.000Z',
  referenceDigest: REF_DIGEST,
  sourceKeys: ['bodik-osaka-tourism:1', 'bodik-osaka-tourism:2'],
  maxCreates: 2,
  maxRenames: 0,
  note: 'canary 10f-S',
  ...over,
})

/* ── 1. Форма разрешения — закрытая ────────────────────────────────────── */
{
  const good = parseWriteApproval(base())
  t('исправное разрешение разбирается', good.sourceKeys.length, 2)
  t('и заморожено', Object.isFrozen(good), true)
  t('состав ключей закрыт', WRITE_APPROVAL_KEYS.join(','),
    'spec,scopeId,portal,issuedAt,expiresAt,referenceDigest,sourceKeys,maxCreates,maxRenames,note')
  t('отпечаток не зависит от порядка ключей объекта',
    writeApprovalDigest(base()), writeApprovalDigest({ note: 'canary 10f-S', ...base() }))
  t('и меняется от состава строк',
    writeApprovalDigest(base()) === writeApprovalDigest(base({ sourceKeys: ['bodik-osaka-tourism:1'], maxCreates: 1 })), false)
  t('и меняется от потолка переименований',
    writeApprovalDigest(base()) === writeApprovalDigest(base({ maxRenames: 1 })), false)
  const cases = [
    ['лишний ключ', { ...base(), extra: 1 }, 'writeApprovalShape'],
    ['чужая версия', base({ spec: 'poi-write-approval/v9' }), 'writeApprovalVersion'],
    ['пустой список строк', base({ sourceKeys: [] }), 'writeApprovalShape'],
    ['повтор строки', base({ sourceKeys: ['a', 'a'], maxCreates: 2 }), 'writeApprovalShape'],
    ['несортированный список', base({ sourceKeys: ['b', 'a'] }), 'writeApprovalShape'],
    ['потолок меньше состава', base({ maxCreates: 1 }), 'writeApprovalShape'],
    ['потолок ноль', base({ maxCreates: 0 }), 'writeApprovalShape'],
    ['срок раньше выдачи', base({ expiresAt: '2026-09-04T00:00:00.000Z' }), 'writeApprovalShape'],
    ['невозможный момент', base({ expiresAt: '2026-02-31T00:00:00.000Z' }), 'writeApprovalShape'],
    ['чужой отпечаток эталона', base({ referenceDigest: 'md5:1' }), 'writeApprovalShape'],
    ['без потолка переименований', (() => { const raw = base(); delete raw.maxRenames; return raw })(), 'writeApprovalShape'],
    ['дробный потолок переименований', base({ maxRenames: 0.5 }), 'writeApprovalShape'],
    ['отрицательный потолок переименований', base({ maxRenames: -1 }), 'writeApprovalShape'],
    ['переименований больше, чем созданий', base({ maxRenames: 3 }), 'writeApprovalShape'],
    ['не объект', 'строка', 'writeApprovalShape'],
  ]
  for (const [label, raw, reason] of cases) {
    const got = await refusal(() => parseWriteApproval(raw))
    t(`${label} — отказ ${reason}`, got.reason, reason)
  }
  t('список причин отказа закрыт', WRITE_APPROVAL_REFUSALS.length, 11)

  /* ВЕРСИЯ ПРОВЕРЯЕТСЯ РАНЬШЕ СОСТАВА ПОЛЕЙ (10f-S R2, находка 3). Разрешение
     прошлой эпохи обязано отвергаться КАК ПРЕЖНЯЯ ВЕРСИЯ, а не как
     повреждённый текущий формат: это разные диагнозы и разные действия. */
  t('текущая версия контракта', WRITE_APPROVAL_SPEC, 'poi-write-approval/v2')
  t('прежняя версия названа поимённо', WRITE_APPROVAL_PRIOR_SPECS.join(','), 'poi-write-approval/v1')
  const v1 = {
    spec: 'poi-write-approval/v1', scopeId: 'poi-parser-v1', portal: 'bodik-osaka-tourism',
    issuedAt: '2026-09-05T00:00:00.000Z', expiresAt: '2026-09-12T00:00:00.000Z',
    rawPayloadDigest: REF_DIGEST, sourceKeys: ['bodik-osaka-tourism:1'], maxCreates: 1, note: 'R0',
  }
  const old1 = await refusal(() => parseWriteApproval(v1))
  t('разрешение R0 (v1) — отказ по ВЕРСИИ', old1.reason, 'writeApprovalVersion')
  has('  и названо прежней версией', old1.message, 'прежней версии poi-write-approval/v1')
  has('  и сказано, что читается только текущая', old1.message, 'Читается только poi-write-approval/v2')
  t('  и это НЕ отказ по составу полей', old1.message.includes('нет обязательных полей'), false)
  const v1WithNewFields = { ...v1, referenceDigest: REF_DIGEST, maxRenames: 0 }
  delete v1WithNewFields.rawPayloadDigest
  t('состав полей текущей формы под прежней версией не спасает',
    (await refusal(() => parseWriteApproval(v1WithNewFields))).reason, 'writeApprovalVersion')
  t('а текущая версия с недостающим полем — отказ по составу',
    (await refusal(() => parseWriteApproval((() => { const raw = base(); delete raw.maxRenames; return raw })())).then((r) => r.reason)), 'writeApprovalShape')
  t('версия читается собственным значением, а не из прототипа',
    (await refusal(() => parseWriteApproval(Object.assign(Object.create({ spec: WRITE_APPROVAL_SPEC }), (() => { const raw = base(); delete raw.spec; return raw })())))).reason, 'writeApprovalVersion')
  has('чужая причина не заводится', await refusal(() => { throw new WriteApprovalRefused('выдумка', 'x') }).then((r) => r.message), 'не из закрытого списка')
}

/* ── 2. Применимость к прогону: область, портал, ПОЛНЫЙ интервал, эталон ─ */
{
  const approval = parseWriteApproval(base())
  const applies = (over = {}) => assertWriteApprovalApplies({
    approval, now: NOW, scopeId: 'poi-parser-v1', portal: 'bodik-osaka-tourism', referenceDigest: REF_DIGEST, ...over,
  })
  t('разрешение применимо', applies().sourceKeys.length, 2)
  t('чужая область — отказ', (await refusal(() => applies({ scopeId: 'другая' }))).reason, 'writeApprovalScope')
  t('чужой портал — отказ', (await refusal(() => applies({ portal: 'bodik-kyoto-tourism' }))).reason, 'writeApprovalPortal')
  /* ПОЛНЫЙ ИНТЕРВАЛ: issuedAt <= now < expiresAt. Оба края проверены с обеих
     сторон — иначе «проверка срока» доказывает только половину. */
  t('ровно в момент выдачи — действует', (await refusal(() => applies({ now: new Date('2026-09-05T00:00:00.000Z') }))).reason, '(без отказа)')
  const early = await refusal(() => applies({ now: new Date('2026-09-04T23:59:59.999Z') }))
  t('за миллисекунду ДО выдачи — отказ', early.reason, 'writeApprovalNotYetValid')
  has('  и сказано, что оно ещё не действует', early.message, 'ещё не действует')
  t('за миллисекунду до истечения — действует', (await refusal(() => applies({ now: new Date('2026-09-11T23:59:59.999Z') }))).reason, '(без отказа)')
  t('ровно в момент истечения — отказ', (await refusal(() => applies({ now: new Date('2026-09-12T00:00:00.000Z') }))).reason, 'writeApprovalExpired')
  const drift = await refusal(() => applies({ referenceDigest: `sha256:${'b'.repeat(64)}` }))
  t('другой эталонный прогон — отказ', drift.reason, 'writeApprovalReferenceDrift')
  has('  и сказано, что владелец видел другой результат', drift.message, 'владелец видел другой результат')
  t('эталона нет вовсе — тоже отказ', (await refusal(() => applies({ referenceDigest: null }))).reason, 'writeApprovalReferenceDrift')
}

/* ── 3. Одноразовость — по ИДЕНТИЧНОСТИ разрешения, и долговечно ────────
   Находка 2 круга R1 (одноразовости не было вовсе) и находки 1–2 круга R2:
   тождеством было ИМЯ ФАЙЛА, поэтому копия того же разрешения исполнялась
   второй раз; отметка не была долговечной по имени, а отказ close молча
   проглатывался. */
{
  const root = await mkdtemp(path.join(tmpdir(), 'jj-approval-claim-'))
  const usedDir = path.join(root, ...WRITE_APPROVAL_ROOT_SEGMENTS, WRITE_APPROVAL_USED_SEGMENT)
  const approval = parseWriteApproval(base())
  const identity = writeApprovalDigest(approval)
  const first = await claimWriteApproval(root, approval, { note: 'первый' })
  t('первая отметка создана', await exists(first.path), true)
  t('  и названа ОТПЕЧАТКОМ разрешения, а не именем файла',
    path.basename(first.path), `${identity.slice(identity.indexOf(':') + 1)}.json`)
  t('  и лежит в отдельном каталоге отметок', path.dirname(first.path), usedDir)
  t('  и несёт тождество внутри', JSON.parse(await readFile(first.path, 'utf8')).identity, identity)
  t('  каталог отметок создан claim-ом', await exists(usedDir), true)

  /* КОНТРПРИМЕР R2 (находка 1): та же ЦЕННОСТЬ, другой порядок ключей и другое
     форматирование — то есть другой файл и другие байты. */
  const shuffled = parseWriteApproval({ note: base().note, maxRenames: 0, ...base() })
  t('копия того же разрешения имеет тот же отпечаток', writeApprovalDigest(shuffled), identity)
  const again = await refusal(() => claimWriteApproval(root, shuffled, { note: 'второй' }))
  t('копия того же разрешения — отказ', again.reason, 'writeApprovalAlreadyUsed')
  has('  и названо, что тождество — отпечаток, а не имя файла', again.message, 'а не имя файла')
  t('  и содержимое первой отметки не переписано', JSON.parse(await readFile(first.path, 'utf8')).note, 'первый')

  /* РАЗЛИЧАЮЩИЙ КОНТРПРИМЕР: ДРУГОЕ разрешение проходит — отказ выше вызван
     тождеством, а не тем, что «claim уже звали». */
  const other = parseWriteApproval(base({ note: 'другое разрешение' }))
  const second = await claimWriteApproval(root, other, { note: 'другое' })
  t('другое разрешение исполняется', await exists(second.path), true)
  t('  и его отметка — другая', second.path === first.path, false)

  /* ДОЛГОВЕЧНОСТЬ (находка 2): цепочка каталогов, fsync файла и fsync
     КАТАЛОГА, в котором появилось новое имя. */
  {
    const fresh = await mkdtemp(path.join(tmpdir(), 'jj-approval-durable-'))
    const synced = []
    const created = []
    const io = {
      durableDirectory: async (dir) => { synced.push(dir) },
      mkdir: async (dir) => { created.push(dir); await mkdir(dir) },
    }
    let fileSynced = 0
    const realOpen = (await import('node:fs/promises')).open
    io.open = async (target, flags) => {
      const handle = await realOpen(target, flags)
      return new Proxy(handle, { get: (t, k) => (k === 'sync' ? async () => { fileSynced += 1; await t.sync() } : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) })
    }
    const mark = await claimWriteApproval(fresh, approval, { note: 'долговечность' }, io)
    t('каталоги отметок создаются по одному', created.length >= 2, true)
    t('  и после каждого синхронизируется каталог, где появилось имя', synced.length >= created.length, true)
    t('  байты отметки сброшены fsync', fileSynced, 1)
    t('  и каталог отметки синхронизирован ПОСЛЕ создания файла',
      synced[synced.length - 1], path.dirname(mark.path))
  }

  /* Каждый отказ цепочки — именованный отказ прогона, а не падение. */
  const cases = [
    ['открытие', { open: async () => { throw new Error('ФС отказала на открытии') } }, 'ФС отказала на открытии'],
    ['запись', { open: async () => ({ writeFile: async () => { throw new Error('диск переполнен') }, sync: async () => {}, close: async () => {} }) }, 'диск переполнен'],
    ['sync', { open: async () => ({ writeFile: async () => {}, sync: async () => { throw new Error('sync отказал') }, close: async () => {} }) }, 'sync отказал'],
    ['close', { open: async () => ({ writeFile: async () => {}, sync: async () => {}, close: async () => { throw new Error('отложенная ошибка на close') } }) }, 'отложенная ошибка на close'],
    ['синхронизация каталога', { durableDirectory: async () => { throw new Error('fsync каталога отказал') } }, 'fsync каталога отказал'],
  ]
  for (const [label, io, needle] of cases) {
    const fresh = await mkdtemp(path.join(tmpdir(), 'jj-approval-io-'))
    const got = await refusal(() => claimWriteApproval(fresh, approval, {}, io))
    t(`отказ ${label} — именованный отказ`, got.reason, 'writeApprovalClaimFailed')
    has(`  и причина названа (${label})`, got.message, needle)
  }
  const hostileRoot = await mkdtemp(path.join(tmpdir(), 'jj-approval-io-'))
  const hostile = await refusal(() => claimWriteApproval(hostileRoot, approval, {},
    { open: async () => { throw new Proxy({}, { get() { throw new Error('ловушка') } }) } }))
  t('враждебное брошенное значение не выносится наружу', hostile.reason, 'writeApprovalClaimFailed')
}

/* ── 4. Чтение файла разрешения crash-proof (находка 5) ────────────────── */
{
  const root = await mkdtemp(path.join(tmpdir(), 'jj-approval-read-'))
  const dirApprovals = path.join(root, ...WRITE_APPROVAL_ROOT_SEGMENTS)
  await mkdir(dirApprovals, { recursive: true })
  await writeFile(path.join(dirApprovals, 'ok.json'), JSON.stringify(base()), 'utf8')
  await writeFile(path.join(dirApprovals, 'broken.json'), '{ не json', 'utf8')
  const read = await readWriteApprovalFile(root, 'ok')
  t('исправный файл читается по имени без расширения', read.approval.maxCreates, 2)
  t('  и отпечаток совпадает с каноническим', read.digest, writeApprovalDigest(parseWriteApproval(base())))
  const cases = [
    ['пустое имя', '', 'writeApprovalShape'],
    ['не строка', 42, 'writeApprovalShape'],
    ['символ', Symbol('x'), 'writeApprovalShape'],
    ['путь вместо имени', '../secrets.json', 'writeApprovalShape'],
    ['обратная косая', 'a\\b.json', 'writeApprovalShape'],
    ['точка', '.', 'writeApprovalShape'],
    ['враждебное имя с бросающим toString', { toString() { throw new Error('ловушка') } }, 'writeApprovalShape'],
    ['несуществующий файл', 'нет-такого', 'writeApprovalMissing'],
    ['сломанный JSON', 'broken', 'writeApprovalShape'],
  ]
  for (const [label, name, reason] of cases) {
    const got = await refusal(() => readWriteApprovalFile(root, name))
    t(`${label} — именованный отказ ${reason}`, got.reason, reason)
  }
  const hostileRead = await refusal(() => readWriteApprovalFile(root, 'ok', { readFile: async () => { throw new Proxy({}, { get() { throw new Error('ловушка') } }) } }))
  t('враждебное значение из чтения — именованный отказ', hostileRead.reason, 'writeApprovalMissing')
  const canonical = await refusal(() => readWriteApprovalFile(path.resolve(import.meta.dirname, '..'), 'заведомо-нет-такого-разрешения'))
  t('умолчание — КАНОНИЧЕСКИЙ каталог репозитория', canonical.reason, 'writeApprovalMissing')
  has('  и он назван в отказе', canonical.message, path.join('tmp', 'poi-write-approvals'))
}

/* ── 5. Бюджет переименований — часть бюджета эффектов (находка 4) ─────── */
{
  /* Хранилище с коллизией номера: POST создаёт POI-000001, чтение по номеру
     показывает, что номер занят чужой записью, и production-хранилище идёт на
     PATCH. Считается, дошёл ли PATCH до транспорта. */
  const collisionStore = () => {
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
          rows[0].fields['POI ID'] = JSON.parse(init.body).fields['POI ID']
          return { ok: true, status: 200, json: async () => ({ id: 'recNEW' }) }
        }
        if (target.includes('%7BPOI+ID%7D') || target.includes('{POI ID}')) {
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
  const FIELDS = { 'Source Key': 'bodik-osaka-tourism:1', 'POI Name (RU)': 'Замок Осака' }

  /* Бюджет НОЛЬ — то, что обещает текст разрешения канареечного прогона. */
  const zero = collisionStore()
  const zeroOutcomes = []
  const zeroWrapped = withVerifiedWrites(zero.store, { journal: journal(), maxRenames: 0, onOutcome: (o) => zeroOutcomes.push(o) })
  const zeroResult = await zeroWrapped.create(FIELDS).catch((e) => ({ thrown: e instanceof Error ? e.message : String(e) }))
  t('бюджет 0: PATCH НЕ отправлялся', zero.patched(), 0)
  t('  и запись осталась с занятым номером', zero.rows[0].fields['POI ID'], 'POI-000001')
  t('  и исход не verified', zeroOutcomes[0]?.state ?? null, 'mismatch')
  t('  и запись названа поимённо', zeroOutcomes[0]?.sourceKey ?? null, 'bodik-osaka-tourism:1')
  has('  и бюджет назван причиной', zeroOutcomes[0]?.reason ?? '', 'бюджет переименований исчерпан (0)')
  has('  и граница остановила прогон', zeroResult.thrown ?? '', 'mismatch')

  /* Различающий контрпример: тот же прогон с бюджетом 1 — PATCH уходит. */
  const one = collisionStore()
  const oneOutcomes = []
  const oneWrapped = withVerifiedWrites(one.store, { journal: journal(), maxRenames: 1, onOutcome: (o) => oneOutcomes.push(o) })
  const oneResult = await oneWrapped.create(FIELDS).catch((e) => ({ thrown: e instanceof Error ? e.message : String(e) }))
  t('бюджет 1: PATCH отправлен ровно один раз', one.patched(), 1)
  t('  и номер переименован', one.rows[0].fields['POI ID'], 'POI-000002')
  t('  и исход verified', oneOutcomes[0]?.state ?? null, 'verified')
  t('  и граница не бросила', oneResult.thrown ?? null, null)

  /* Бюджет — обязательное целое: незаявленный бюджет не значит «сколько угодно». */
  const badBudget = await refusal(() => withVerifiedWrites(one.store, { journal: journal(), maxRenames: 1.5 }))
  has('дробный бюджет отвергается формой', badBudget.message, 'целым не меньше нуля')

  /* Текст разрешения и исполняемый контракт считают ОДНО И ТО ЖЕ число. */
  const source = await readFile(new URL('../scripts/poi-portals/collect-pois.mjs', import.meta.url), 'utf8')
  t('бюджет переименований приходит в границу записи из разрешения',
    /maxRenames: approval \? approval\.approval\.maxRenames : 0/.test(source), true)
}

/* ── 6. ПРОИЗВОДСТВЕННАЯ КОМПОЗИЦИЯ ───────────────────────────────────── */
const DESC = '大阪を代表する歴史的建造物であり、天守閣の内部は博物館として公開されています。豊臣秀吉によって築かれた城の歴史や、大坂の陣に関する資料が数多く展示されており、最上階の展望台からは大阪市街を一望することができます。周囲は公園として整備されています。'
const H = 'ID,名称,名称_英語,説明,所在地_都道府県,所在地_市区町村,所在地_連結表記,緯度,経度,URL,利用可能曜日,開始時間,終了時間,連絡先電話番号,アクセス方法'
const row = (id, name, lat, lon) => `"${id}","${name}","${name} EN","${DESC}","大阪府","大阪市","大阪府大阪市中央区大阪城1-1","${lat}","${lon}","https://example.invalid/${id}","月曜日","09:00","17:00","06-6941-3044","徒歩15分"`
const CSV = [H, row('1', '大阪城', '34.6873', '135.5259'), row('2', '四天王寺', '34.6543', '135.5164')].join('\n')
const stubFetch = async (u) => {
  const url = String(u)
  if (url.includes('package_show')) {
    return { ok: true, status: 200, json: async () => ({ success: true, result: { license_id: 'cc-by', metadata_modified: '2026-03-30T00:00:00', resources: [{ format: 'CSV', url: 'https://example.invalid/data.csv', last_modified: '2026-03-30T00:00:00' }] } }) }
  }
  if (url.includes('data.csv')) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(CSV).buffer }
  throw new Error(`сеть не предусмотрена: ${url}`)
}
const dir = await mkdtemp(path.join(tmpdir(), 'jj-write-approval-'))
const NAMES = path.join(dir, 'names.json')
const NAMES_HONEST = {
  'bodik-osaka-tourism:1': { nameRu: 'Замок Осака' },
  'bodik-osaka-tourism:2': { nameRu: 'Ситэнно-дзи' },
}
await writeFile(NAMES, JSON.stringify(NAMES_HONEST))
const EXISTING = path.join(dir, 'existing.json')
await writeFile(EXISTING, JSON.stringify([{ poiId: 'POI-000700', sourceKey: 'bodik-osaka-tourism:700', nameRu: 'Ничего похожего', lat: 35.7, lon: 139.7 }]))
const SNAP = [{ poiId: 'POI-000700', recordId: 'rec700', nameRu: 'Ничего похожего', nameEn: 'Nothing Alike', siteCity: 'tokyo', lat: 35.7, lon: 139.7, placeId: null, sourceKey: null }]
/* Резолвер — НАСТОЯЩИЙ; подменён только транспорт: платных обращений в
   офлайн-наборе быть не может. Число обращений считается: отказ обязан стоить
   не только ноль эффектов, но и ноль денег. */
const PLACES = {
  大阪城: { id: 'PID-OSAKAJO', displayName: { text: '大阪城' }, location: { latitude: 34.6873, longitude: 135.5259 }, businessStatus: 'OPERATIONAL', addressComponents: [{ types: ['administrative_area_level_1'], longText: 'Osaka' }] },
  四天王寺: { id: 'PID-SHITENNOJI', displayName: { text: '四天王寺' }, location: { latitude: 34.6543, longitude: 135.5164 }, businessStatus: 'OPERATIONAL', addressComponents: [{ types: ['administrative_area_level_1'], longText: 'Osaka' }] },
}
let placeCalls = 0
const resolver = (input) => resolvePlace(input, {
  apiKey: 'ключ-фикстуры',
  fetchImpl: async (_u, init) => {
    placeCalls += 1
    const query = JSON.parse(init.body).textQuery
    const hit = Object.entries(PLACES).find(([name]) => query.includes(name))?.[1] ?? PLACES['大阪城']
    return { ok: true, json: async () => ({ places: [hit] }) }
  },
})

let runSeq = 0
const run = async ({ argv = [], store = null }) => {
  runSeq += 1
  const printed = []; const errored = []
  let persisted = null
  const realLog = console.log; const realErr = console.error; const realWarn = console.warn
  console.log = (v) => printed.push(String(v)); console.error = (...v) => errored.push(v.map(String).join(' ')); console.warn = () => {}
  const target = { exitCode: 0 }
  /* Хранилище НЕ оборачивается: обёртка ломает тождество «хранилище в
     памяти», которым приём отличает сухой путь от живого. Число эффектов
     считается по отчёту — там же, где его читает человек. */
  const snapshotStore = store ?? createSnapshotStore(SNAP)
  try {
    await runCli(['node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism', '--out', path.join(dir, `out-${runSeq}.json`), ...argv], {
      approvalRoot: dir,
      adapters: { 'opendata-csv': (p, o) => collectFromOpenDataCsv(p, { ...o, fetchImpl: stubFetch }) },
      persistReport: async (_p, r) => { persisted = r },
      placeResolver: resolver,
      now: NOW,
      resolveCodeIdentity: () => ({ commit: '0'.repeat(40), dirty: false }),
      store: snapshotStore,
    }, target)
  } finally { console.log = realLog; console.error = realErr; console.warn = realWarn }
  return { exitCode: target.exitCode, report: persisted, errored: errored.join('\n'), creates: persisted?.write?.outcomes?.created ?? 0 }
}
const live = (allow) => ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF, ...(allow ? ['--allow', allow] : [])]

/* Эталон для ворот и для разрешения — сухой прогон того же входа. */
const reference = await run({ argv: ['--dry-write', '--existing', EXISTING, '--names', NAMES] })
t('эталон: сухой прогон без разрешения проходит — живых эффектов нет', reference.exitCode, 0)
if (!reference.report?.write?.outcomes) console.error('ДИАГНОСТИКА эталона:', reference.errored.slice(0, 800))
t('  и обе строки сухо созданы', reference.report.write?.outcomes?.created, 2)
const REF = path.join(dir, 'reference.json')
await writeFile(REF, JSON.stringify(reference.report))
const REF_BYTES_DIGEST = sha256Bytes(await readFile(REF))

/* 6.1. Живая запись без разрешения. */
{
  const nothing = await run({ argv: live(null) })
  t('живая запись без --allow: код возврата 1', nothing.exitCode, 1)
  t('  и отказ назван в отчёте', nothing.report.write?.refused, 'writeApprovalMissing')
  has('  и сказано, чего не хватает', nothing.errored, 'разрешение владельца называет допустимые Source Key')
  t('  и ХРАНИЛИЩЕ НЕ ТРОНУТО — ноль эффектов', nothing.creates, 0)
  t('  и writeRun не дошёл до исходов', nothing.report.write?.outcomes ?? null, null)
  t('  и ворота при этом пройдены — отказ именно авторизации', nothing.report.gate?.state, 'PASS')
}

/* 6.2. --allow без эталона: привязывать не к чему. */
{
  const noRef = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--allow', 'что-угодно'] })
  t('--allow без --monitor: код возврата 1', noRef.exitCode, 1)
  has('  и причина названа до сети', noRef.errored, '--allow требует --monitor')
  t('  и ноль эффектов', noRef.creates, 0)
}

/* 6.3. Разрешена ОДНА строка из двух — и разрешение исполняется один раз. */
{
  await writeApprovalFixture({ root: dir, name: 'одна', portal: 'bodik-osaka-tourism', reference: REF, now: NOW, sourceKeys: ['bodik-osaka-tourism:1'] })
  const one = await run({ argv: live('одна') })
  t('разрешена одна строка: код возврата 0', one.exitCode, 0)
  t('  и создана ровно одна', one.report.write?.outcomes?.created, 1)
  t('  и это именно разрешённая строка', (one.report.write?.created ?? []).join(';').includes('Замок Осака'), true)
  t('  и вторая получила СВОЙ терминальный исход', one.report.write?.notAllowed, 1)
  t('  и она названа в очереди', (one.report.write?.notAllowedQueue ?? [])[0]?.sourceKey, 'bodik-osaka-tourism:2')
  t('  и разрешение названо в отчёте', one.report.writeApproval?.sourceKeys?.join(','), 'bodik-osaka-tourism:1')
  t('  и файл разрешения — настоящий, прочитанный по имени',
    one.report.writeApproval?.file, path.join(dir, ...WRITE_APPROVAL_ROOT_SEGMENTS, 'одна.json'))
  t('  и отпечаток эталона в отчёте — байты того самого файла', one.report.writeApproval?.referenceDigest, REF_BYTES_DIGEST)
  t('  и оба потолка объявлены', `${one.report.writeApproval?.maxCreates}/${one.report.writeApproval?.maxRenames}`, '1/0')
  t('  и отметка исполнения поставлена', await exists(one.report.writeApproval?.claimed ?? ''), true)
  t('  и названа отпечатком разрешения в каталоге отметок',
    path.dirname(one.report.writeApproval?.claimed ?? ''), path.join(dir, ...WRITE_APPROVAL_ROOT_SEGMENTS, WRITE_APPROVAL_USED_SEGMENT))

  /* КОНТРПРИМЕР 10f-S R1 (находка 2): повтор того же разрешения. */
  const callsBefore = placeCalls
  const repeat = await run({ argv: live('одна') })
  t('повтор того же разрешения: код возврата 1', repeat.exitCode, 1)
  t('  и причина названа', repeat.report.write?.refused, 'writeApprovalAlreadyUsed')
  t('  и НОЛЬ новых эффектов', repeat.creates, 0)
  t('  и ноль новых платных обращений', placeCalls - callsBefore, 0)
  t('  и writeRun не дошёл до исходов', repeat.report.write?.outcomes ?? null, null)
}

/* 6.3а. Разрешение не допускает НИ ОДНОЙ входной строки. Контрпример
   финального аудита 10f-S: ранний возврат `writeRun` сообщал `attempted: 0`,
   но терял `notAllowed`, очередь и сведения о разрешении — две терминально
   отказанные строки выглядели как отсутствие входа. */
{
  await writeApprovalFixture({
    root: dir,
    name: 'ни-одной',
    portal: 'bodik-osaka-tourism',
    reference: REF,
    now: NOW,
    sourceKeys: ['bodik-osaka-tourism:999'],
  })
  const effects = []
  const callsBefore = placeCalls
  const none = await run({
    argv: live('ни-одной'),
    store: createSnapshotStore(SNAP, { observe: (effect) => effects.push(effect) }),
  })
  t('ни одна входная строка не разрешена: код возврата 0', none.exitCode, 0)
  t('  и попыток записи ноль', none.report.write?.attempted, 0)
  t('  и обе строки получили терминальный исход notAllowed', none.report.write?.notAllowed, 2)
  t('  и очередь называет обе строки',
    (none.report.write?.notAllowedQueue ?? []).map((row) => row.sourceKey).join(','),
    'bodik-osaka-tourism:1,bodik-osaka-tourism:2')
  t('  и отчёт называет применённое разрешение',
    none.report.write?.approval?.sourceKeys?.join(','), 'bodik-osaka-tourism:999')
  t('  и потолок создания сохранён в отчёте', none.report.write?.approval?.maxCreates, 1)
  t('  и терминальная сумма сходится',
    (none.report.write?.attempted ?? 0) + (none.report.write?.notAllowed ?? 0), 2)
  t('  и резолвер не вызывался', placeCalls - callsBefore, 0)
  t('  и хранилище не произвело эффектов', effects.length, 0)
}

/* 6.3б. КОНТРПРИМЕР 10f-S R2 (находка 1): копия разрешения под другим именем.
   До R2 одноразовость держалась на имени файла: копия тех же байтов
   исполнялась второй раз и второй раз платила
   (`tmp/10f-s-r2-repro-OLD-2026-09-05.log`: код 0, создано 1, обращение к
   Google 1). Тождество разрешения — его отпечаток, поэтому копия, переименование
   и переформатирование упираются в ту же отметку. */
{
  const source = path.join(dir, ...WRITE_APPROVAL_ROOT_SEGMENTS, 'одна.json')
  const raw = JSON.parse(await readFile(source, 'utf8'))
  /* Другое имя И другое форматирование: совпасть обязана ЦЕННОСТЬ, не байты. */
  await writeFile(path.join(dir, ...WRITE_APPROVAL_ROOT_SEGMENTS, 'одна-копия.json'), JSON.stringify(raw), 'utf8')
  const callsBefore = placeCalls
  const copy = await run({ argv: live('одна-копия') })
  t('копия исполненного разрешения под другим именем: код возврата 1', copy.exitCode, 1)
  t('  и причина названа', copy.report.write?.refused, 'writeApprovalAlreadyUsed')
  has('  и сказано, что тождество — отпечаток, а не имя файла', copy.errored, 'а не имя файла')
  t('  и ноль эффектов', copy.creates, 0)
  t('  и ноль платных обращений', placeCalls - callsBefore, 0)
  t('  и отметка не переставлена', copy.report.writeApproval?.claimed ?? null, null)

  /* РАЗЛИЧАЮЩИЙ КОНТРПРИМЕР: другое по содержанию разрешение проходит. */
  await writeApprovalFixture({
    root: dir, name: 'вторая-строка', portal: 'bodik-osaka-tourism', reference: REF, now: NOW,
    sourceKeys: ['bodik-osaka-tourism:2'],
  })
  const another = await run({ argv: live('вторая-строка') })
  t('другое разрешение исполняется: код 0', another.exitCode, 0)
  t('  и пишет свою строку', another.report.write?.outcomes?.created, 1)
  t('  и это Ситэнно-дзи, а не Замок Осака', (another.report.write?.created ?? []).join(';').includes('Ситэнно-дзи'), true)
}

/* 6.4. КОНТРПРИМЕР 10f-S R1 (находка 1): подмена имён + пересборка эталона.
   До R1 разрешение было привязано к сырым байтам выгрузки, в которые русские
   имена не входят: подменив имена и пересобрав эталон, тот же файл разрешения
   проходил и записывал ДРУГОЕ имя. Теперь разрешение привязано к байтам
   эталона — того результата, который владелец рассматривал. */
{
  await writeApprovalFixture({ root: dir, name: 'подмена', portal: 'bodik-osaka-tourism', reference: REF, now: NOW, sourceKeys: ['bodik-osaka-tourism:1'] })
  await writeFile(NAMES, JSON.stringify({ 'bodik-osaka-tourism:1': { nameRu: 'ПОДМЕНЁННОЕ ИМЯ' } }))
  /* Эталон пересобирается ПОД ПОДМЕНУ — ровно то, что снимало отказ ворот. */
  const rebuilt = await run({ argv: ['--dry-write', '--existing', EXISTING, '--names', NAMES] })
  const REF2 = path.join(dir, 'reference-2.json')
  await writeFile(REF2, JSON.stringify(rebuilt.report))
  const callsBefore = placeCalls
  const swapped = await run({ argv: ['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF2, '--allow', 'подмена'] })
  t('подмена имён с пересборкой эталона: ворота проходят', swapped.report.gate?.state, 'PASS')
  t('  но разрешение НЕ проходит', swapped.report.write?.refused, 'writeApprovalReferenceDrift')
  t('  код возврата 1', swapped.exitCode, 1)
  t('  и ноль эффектов', swapped.creates, 0)
  t('  и ноль платных обращений', placeCalls - callsBefore, 0)
  t('  и отметка исполнения НЕ поставлена', swapped.report.writeApproval?.claimed ?? null, null)
  /* Различающий контрпример: то же разрешение с ИСХОДНЫМ эталоном и исходными
     именами проходит — значит отказ выше вызван именно подменой. */
  await writeFile(NAMES, JSON.stringify(NAMES_HONEST))
  const honest = await run({ argv: live('подмена') })
  t('то же разрешение с исходным эталоном: код 0', honest.exitCode, 0)
  t('  и записана строка с ОДОБРЕННЫМ именем', (honest.report.write?.created ?? []).join(';').includes('Замок Осака'), true)
}

/* 6.5. Разрешение, выданное будущим числом (находка 3). */
{
  await writeApprovalFixture({
    root: dir, name: 'будущее', portal: 'bodik-osaka-tourism', reference: REF, now: NOW,
    sourceKeys: ['bodik-osaka-tourism:1'],
    overrides: { issuedAt: '2026-12-01T00:00:00.000Z', expiresAt: '2026-12-08T00:00:00.000Z' },
  })
  const callsBefore = placeCalls
  const future = await run({ argv: live('будущее') })
  t('разрешение «на декабрь», прогон в сентябре: код возврата 1', future.exitCode, 1)
  t('  и причина названа', future.report.write?.refused, 'writeApprovalNotYetValid')
  t('  и ноль эффектов', future.creates, 0)
  t('  и ноль платных обращений', placeCalls - callsBefore, 0)
}

/* 6.6. Чужой портал, истёкший срок, сломанный файл — ноль эффектов. */
{
  await writeApprovalFixture({ root: dir, name: 'киото', portal: 'bodik-kyoto-tourism', reference: REF, now: NOW, sourceKeys: ['bodik-osaka-tourism:1'] })
  const alien = await run({ argv: live('киото') })
  t('разрешение на чужой портал: код 1', alien.exitCode, 1)
  t('  и причина названа', alien.report.write?.refused, 'writeApprovalPortal')
  t('  и ноль эффектов', alien.creates, 0)

  await writeApprovalFixture({
    root: dir, name: 'вчерашнее', portal: 'bodik-osaka-tourism', reference: REF, now: NOW,
    sourceKeys: ['bodik-osaka-tourism:1'],
    overrides: { issuedAt: '2026-08-01T00:00:00.000Z', expiresAt: '2026-08-02T00:00:00.000Z' },
  })
  const expired = await run({ argv: live('вчерашнее') })
  t('истёкшее разрешение: код 1', expired.exitCode, 1)
  t('  и причина названа', expired.report.write?.refused, 'writeApprovalExpired')
  t('  и ноль эффектов', expired.creates, 0)

  await writeFile(path.join(dir, ...WRITE_APPROVAL_ROOT_SEGMENTS, 'сломано.json'), '{ не json', 'utf8')
  const broken = await run({ argv: live('сломано') })
  t('сломанный файл разрешения: код 1', broken.exitCode, 1)
  t('  и причина названа', broken.report.write?.refused, 'writeApprovalShape')
  t('  и ноль эффектов', broken.creates, 0)

  const missing = await run({ argv: live('такого-файла-нет') })
  t('разрешения с таким именем нет: код 1', missing.exitCode, 1)
  t('  и причина названа', missing.report.write?.refused, 'writeApprovalMissing')
  t('  и ноль эффектов', missing.creates, 0)
}

/* 6.7. Разрешение НЕ расширяет: строка вне выборки писателя им не появляется. */
{
  await writeApprovalFixture({
    root: dir, name: 'шире', portal: 'bodik-osaka-tourism', reference: REF, now: NOW,
    sourceKeys: ['bodik-osaka-tourism:1', 'bodik-osaka-tourism:404'],
  })
  const ghost = await run({ argv: live('шире') })
  t('разрешение шире выборки: код 0', ghost.exitCode, 0)
  t('  и создана только реально существующая строка', ghost.report.write?.outcomes?.created, 1)
}

/* ── 7. Сторож на самой границе записи — структурно ────────────────────
   Фильтр выше уже отсеивает неразрешённое, поэтому поведенческого различия у
   этого сторожа при исправном фильтре нет: он существует ровно на случай
   дефекта в фильтре. Проверяется его НАЛИЧИЕ и место — как у прочих
   структурных сторожей проекта. */
{
  const source = await readFile(new URL('../scripts/poi-portals/collect-pois.mjs', import.meta.url), 'utf8')
  t('состав корзины сверяется с разрешением перед первым эффектом',
    /const foreign = requests\.map\(\(r\) => buildSourceKey\(r\.source\)\)\.filter\(\(key\) => !allowSet\.has\(key\)\)/.test(source), true)
  t('  и потолок проверяется числом запросов', /requests\.length > approval\.approval\.maxCreates/.test(source), true)
  t('  и сторож стоит ДО ingestPoiBatch', source.indexOf('const foreign = requests.map') < source.indexOf('await ingestPoiBatch(requests, writeStore)'), true)
  t('подстановки готового разрешения в код больше нет — только в объяснении, почему её нет',
    (source.match(/deps\.writeApproval/g) ?? []).length === 1 && /Прежняя редакция[\s\S]{0,120}deps\.writeApproval/.test(source), true)
  t('отметка исполнения ставится ДО сборки резолвера и хранилища',
    source.indexOf('await claimWriteApproval(') < source.indexOf('canonicalPortalPlaceResolver(process.env.GOOGLE_PLACES_API_KEY)'), true)
}

/* ── 8. НАСТОЯЩИЙ DIRECT-ENTRY: канонический каталог, отдельный процесс ──
   Здесь не подставлено ничего, кроме адаптера, резолвера и хранилища: корень
   репозитория — корень песочницы-копии production-дерева, разрешение лежит по
   каноническому пути `tmp/poi-write-approvals/`, читает его production-код. */
{
  const sandbox = createProductionSandbox()
  try {
    const script = `
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './scripts/poi-portals/collect-pois.mjs'
import { collectFromOpenDataCsv } from './scripts/poi-portals/lib/opendata-csv.mjs'
import { createSnapshotStore } from './scripts/poi-portals/lib/base-snapshot.mjs'
import { resolvePlace } from './src/lib/place-resolve.ts'
import { sha256Bytes } from './scripts/lib/byte-digest.mjs'
const P = ${JSON.stringify({ CSV, NAMES: NAMES_HONEST, SNAP, PLACES, NOW: NOW.toISOString(), SPEC: WRITE_APPROVAL_SPEC })}
const stubFetch = async (u) => {
  const url = String(u)
  if (url.includes('package_show')) return { ok: true, status: 200, json: async () => ({ success: true, result: { license_id: 'cc-by', metadata_modified: '2026-03-30T00:00:00', resources: [{ format: 'CSV', url: 'https://example.invalid/data.csv', last_modified: '2026-03-30T00:00:00' }] } }) }
  if (url.includes('data.csv')) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(P.CSV).buffer }
  throw new Error('сеть не предусмотрена')
}
let placeCalls = 0
const resolver = (input) => resolvePlace(input, { apiKey: 'ключ-фикстуры', fetchImpl: async (_u, init) => {
  placeCalls += 1
  const query = JSON.parse(init.body).textQuery
  const hit = Object.entries(P.PLACES).find(([name]) => query.includes(name))?.[1] ?? Object.values(P.PLACES)[0]
  return { ok: true, json: async () => ({ places: [hit] }) }
} })
const NOW = new Date(P.NOW)
const work = path.resolve('tmp/direct-entry')
await mkdir(work, { recursive: true })
const NAMES = path.join(work, 'names.json')
await writeFile(NAMES, JSON.stringify(P.NAMES))
const EXISTING = path.join(work, 'existing.json')
await writeFile(EXISTING, JSON.stringify([{ poiId: 'POI-000700', sourceKey: 'bodik-osaka-tourism:700', nameRu: 'Ничего похожего', lat: 35.7, lon: 139.7 }]))
let seq = 0
const run = async (argv) => {
  seq += 1
  let persisted = null
  const target = { exitCode: 0 }
  const realLog = console.log; const realErr = console.error; const realWarn = console.warn
  console.log = () => {}; console.error = () => {}; console.warn = () => {}
  try {
    await runCli(['node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism', '--out', path.join(work, 'out-' + seq + '.json'), ...argv], {
      adapters: { 'opendata-csv': (p, o) => collectFromOpenDataCsv(p, { ...o, fetchImpl: stubFetch }) },
      persistReport: async (_p, r) => { persisted = r },
      placeResolver: resolver,
      now: NOW,
      resolveCodeIdentity: () => ({ commit: '0'.repeat(40), dirty: false }),
      store: createSnapshotStore(P.SNAP),
    }, target)
  } finally { console.log = realLog; console.error = realErr; console.warn = realWarn }
  return { exitCode: target.exitCode, report: persisted }
}
const reference = await run(['--dry-write', '--existing', EXISTING, '--names', NAMES])
const REF = path.join(work, 'reference.json')
await writeFile(REF, JSON.stringify(reference.report))
/* Разрешение кладётся по КАНОНИЧЕСКОМУ пути внутри песочницы — тому самому,
   который production-код собирает сам из корня репозитория. */
const approvalsDir = path.resolve('tmp/poi-write-approvals')
await mkdir(approvalsDir, { recursive: true })
const approval = {
  spec: P.SPEC,
  scopeId: 'poi-parser-v1',
  portal: 'bodik-osaka-tourism',
  issuedAt: new Date(NOW.getTime() - 60000).toISOString(),
  expiresAt: new Date(NOW.getTime() + 3600000).toISOString(),
  referenceDigest: sha256Bytes(await readFile(REF)),
  sourceKeys: ['bodik-osaka-tourism:1'],
  maxCreates: 1,
  maxRenames: 0,
  note: 'direct-entry',
}
await writeFile(path.join(approvalsDir, 'canary.json'), JSON.stringify(approval, null, 2))
const first = await run(['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF, '--allow', 'canary'])
const callsAfterFirst = placeCalls
const second = await run(['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF, '--allow', 'canary'])
/* КОПИЯ ТОГО ЖЕ РАЗРЕШЕНИЯ ПОД ДРУГИМ ИМЕНЕМ — и с другим форматированием,
   чтобы совпадали не байты, а ценность (10f-S R2, находка 1). */
await writeFile(path.join(approvalsDir, 'canary-copy.json'), JSON.stringify(approval))
const copy = await run(['--write', '--existing', EXISTING, '--names', NAMES, '--monitor', REF, '--allow', 'canary-copy'])
const used = await readFile(first.report?.writeApproval?.claimed ?? '/нет', 'utf8').then((x) => JSON.parse(x), () => null)
console.log(JSON.stringify({
  firstExit: first.exitCode,
  firstCreated: first.report?.write?.outcomes?.created ?? 0,
  firstNotAllowed: first.report?.write?.notAllowed ?? null,
  approvalFile: first.report?.writeApproval?.file ?? null,
  claimed: first.report?.writeApproval?.claimed ?? null,
  usedIdentity: used?.identity ?? null,
  usedSourceKeys: used?.sourceKeys ?? null,
  secondExit: second.exitCode,
  secondRefused: second.report?.write?.refused ?? null,
  secondCreated: second.report?.write?.outcomes?.created ?? 0,
  copyExit: copy.exitCode,
  copyRefused: copy.report?.write?.refused ?? null,
  copyCreated: copy.report?.write?.outcomes?.created ?? 0,
  copyBytesDiffer: JSON.stringify(approval) !== JSON.stringify(approval, null, 2),
  extraPlaceCalls: placeCalls - callsAfterFirst,
}))
`
    const got = sandbox.tryRun(script)
    if (!got.ok) bad.push(`direct-entry: прогон в песочнице упал — ${got.error}`)
    else {
      const r = got.value
      t('direct-entry: первый прогон завершается кодом 0', r.firstExit, 0)
      t('  и создана ровно одна разрешённая строка', r.firstCreated, 1)
      t('  и неразрешённая получила свой терминальный исход', r.firstNotAllowed, 1)
      t('  и разрешение прочитано из КАНОНИЧЕСКОГО каталога',
        typeof r.approvalFile === 'string' && r.approvalFile.endsWith(path.join('tmp', 'poi-write-approvals', 'canary.json')), true)
      t('  и отметка исполнения создана в каноническом каталоге отметок',
        typeof r.claimed === 'string' && r.claimed.includes(path.join('tmp', 'poi-write-approvals', WRITE_APPROVAL_USED_SEGMENT)), true)
      t('  и названа отпечатком разрешения', /[0-9a-f]{64}\.json$/.test(r.claimed ?? ''), true)
      t('  и отметка называет исполненное тождество', typeof r.usedIdentity, 'string')
      t('  и состав разрешённых строк', (r.usedSourceKeys ?? []).join(','), 'bodik-osaka-tourism:1')
      t('direct-entry: повтор того же разрешения — код 1', r.secondExit, 1)
      t('  и причина названа', r.secondRefused, 'writeApprovalAlreadyUsed')
      t('  и ноль новых эффектов', r.secondCreated, 0)
      t('direct-entry: КОПИЯ разрешения под другим именем — код 1', r.copyExit, 1)
      t('  и байты копии другие (совпадает ценность, не файл)', r.copyBytesDiffer, true)
      t('  и причина та же', r.copyRefused, 'writeApprovalAlreadyUsed')
      t('  и ноль эффектов', r.copyCreated, 0)
      t('  и ноль новых платных обращений за оба повтора', r.extraPlaceCalls, 0)
    }
  } finally { sandbox.dispose() }
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ разрешение владельца на ограниченную запись: ${ok} проверок пройдено`)
}
