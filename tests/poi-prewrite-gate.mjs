#!/usr/bin/env node
/**
 * Pre-write drift gate в ПРОИЗВОДСТВЕННОЙ композиции (10f-Q, P08.3):
 * main → адаптер (production opendata-csv, подменён только fetch) → манифест →
 * gate → writeRun → resolvePortalPlace → ingestPoiBatch → store.
 *
 *   node tests/poi-prewrite-gate.mjs
 *
 * Контрпример до правки (tmp/10f-q-r0-repro-p08-OLD-2026-09-04.json): при
 * `--monitor` с прежним снимком, где вход отличался и политика была иной,
 * прогон сначала записывал (`write.outcomes.created = 1`), а потом сообщал о
 * дрейфе. Здесь дрейф каждого компонента ПО ОТДЕЛЬНОСТИ обязан остановить
 * прогон до создания store и до первого обращения к резолверу; положительный
 * контроль обязан дойти до writer'а.
 *
 * «Не дошли до store» доказывается хранилищем и резолвером, которые падают на
 * ЛЮБОМ вызове: заглушка с пустым ответом порядок не проверяет.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { readCodeGraph } from '../scripts/poi-portals/lib/code-graph.mjs'
import { createProductionSandbox } from './support/production-sandbox.mjs'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { collectFromOpenDataCsv } from '../scripts/poi-portals/lib/opendata-csv.mjs'
import {
  assertCodeSnapshotStable, CODE_GRAPH_ENTRY, collectRegistryIdentities, readCodeGraphIdentity, runCli,
} from '../scripts/poi-portals/collect-pois.mjs'
import { createSnapshotStore } from '../scripts/poi-portals/lib/base-snapshot.mjs'
import { buildRunManifest, codeGraphIdentity, registryValueIdentity } from '../scripts/poi-portals/lib/run-manifest.mjs'
import { resolvePlace } from '../src/lib/place-resolve.ts'
import { isMemoryPoiStore } from '../src/lib/poi-memory-store.ts'

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

/* ── Вход источника ────────────────────────────────────────────────────── */
const DESC = '大阪を代表する歴史的建造物であり、天守閣の内部は博物館として公開されています。豊臣秀吉によって築かれた城の歴史や、大坂の陣に関する資料が数多く展示されており、最上階の展望台からは大阪市街を一望することができます。周囲は公園として整備されています。'
const H = 'ID,名称,名称_英語,説明,所在地_都道府県,所在地_市区町村,所在地_連結表記,緯度,経度,URL,利用可能曜日,開始時間,終了時間,連絡先電話番号,アクセス方法'
const OSAKAJO = `"1","大阪城","Osaka Castle","${DESC}","大阪府","大阪市","大阪府大阪市中央区大阪城1-1","34.6873","135.5259","https://example.invalid/1","月曜日","09:00","17:00","06-6941-3044","地下鉄谷町四丁目駅から徒歩15分"`
const TSUTEN = `"2","通天閣","Tsutenkaku","${DESC}","大阪府","大阪市","大阪府大阪市浪速区恵美須東1-18-6","34.6525","135.5063","https://example.invalid/2","毎日","10:00","20:00","06-6641-9555","地下鉄恵美須町駅から徒歩3分"`
const CSV_A = [H, OSAKAJO, TSUTEN].join('\n')
const CSV_B = [H, OSAKAJO, TSUTEN.replace('20:00', '21:00')].join('\n')
/* Третья строка БЕЗ идентификатора: в кандидаты она не попадает (отказ в ключе),
   но входом быть не перестаёт. Два входа ниже различаются только её именем —
   тождество входа обязано это видеть, иначе «источник изменился» останется
   незамеченным ровно там, где адаптер отказал в ключе. */
const NO_ID = (name) => `"","${name}","Sumiyoshi","${DESC}","大阪府","大阪市","大阪府大阪市住吉区住吉2-9-89","34.6125","135.4930","https://example.invalid/3","毎日","06:00","17:00","06-6672-0753","南海住吉大社駅から徒歩3分"`
const CSV_UNKEYED_A = [H, OSAKAJO, TSUTEN, NO_ID('住吉大社')].join('\n')
const CSV_UNKEYED_B = [H, OSAKAJO, TSUTEN, NO_ID('住吉大社（仮）')].join('\n')
const stubFetch = (csvText) => async (u) => {
  const url = String(u)
  if (url.includes('package_show')) return { ok: true, status: 200, json: async () => ({ success: true, result: {
    license_id: 'cc-by', metadata_modified: '2026-03-30T00:00:00',
    resources: [{ format: 'CSV', url: 'https://example.invalid/data.csv', last_modified: '2026-03-30T00:00:00' }] } }) }
  if (url.includes('data.csv')) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(csvText).buffer }
  throw new Error(`сеть не предусмотрена: ${url}`)
}
const gplace = { id: 'PID-OSAKAJO', displayName: { text: '大阪城' }, location: { latitude: 34.6873, longitude: 135.5259 }, businessStatus: 'OPERATIONAL', addressComponents: [{ types: ['administrative_area_level_1'], longText: 'Osaka' }] }
/** Канонический resolvePlace с подменённым fetch — production-резолвер. */
const resolverOf = (calls) => (input) => { calls.resolver += 1; return resolvePlace(input, { apiKey: 'ключ-фикстуры', fetchImpl: async () => ({ ok: true, json: async () => ({ places: [gplace] }) }) }) }
/** Падает на ЛЮБОМ обращении: если до него дошли — это провал теста. */
const exploding = (label, calls) => new Proxy({}, { get: (_t, prop) => { if (prop === 'then') return undefined; calls.store += 1; throw new Error(`${label}: обращение к хранилищу «${String(prop)}» до gate`) } })

const dir = await mkdtemp(path.join(tmpdir(), 'jj-prewrite-gate-'))
const file = async (name, content) => { const p = path.join(dir, name); await writeFile(p, typeof content === 'string' ? content : JSON.stringify(content)); return p }
const EXISTING_A = await file('existing-a.json', [{ poiId: 'POI-000700', sourceKey: 'bodik-osaka-tourism:700', nameRu: 'Ничего похожего', lat: 35.7, lon: 139.7 }])
const EXISTING_B = await file('existing-b.json', [{ poiId: 'POI-000701', sourceKey: 'bodik-osaka-tourism:701', nameRu: 'Другая база', lat: 35.7, lon: 139.7 }])
const NAMES_A = await file('names-a.json', { 'bodik-osaka-tourism:1': { nameRu: 'Замок Осака' }, 'bodik-osaka-tourism:2': { nameRu: 'Башня Цутэнкаку' } })
const NAMES_B = await file('names-b.json', { 'bodik-osaka-tourism:1': { nameRu: 'Осакский замок' }, 'bodik-osaka-tourism:2': { nameRu: 'Башня Цутэнкаку' } })
const SNAPSHOT = await file('snapshot.json', [{ poiId: 'POI-000700', recordId: 'rec700', nameRu: 'Ничего похожего', nameEn: 'Nothing Alike', siteCity: 'tokyo', lat: 35.7, lon: 139.7, placeId: null, sourceKey: null }])
const SNAP_ROW = { poiId: 'POI-000700', recordId: 'rec700', nameRu: 'Ничего похожего', nameEn: 'Nothing Alike', siteCity: 'tokyo', lat: 35.7, lon: 139.7, placeId: null, sourceKey: null }
const CODE = { commit: '0e1a40536553d7e585e77c06d2036ed6865ae08d', dirty: false }
const NOW = new Date('2026-09-04T00:00:00.000Z')

const run = async ({ csv = CSV_A, argv = [], store, resolver = null, calls = { store: 0, resolver: 0 } }) => {
  const printed = []; const errored = []; let persisted = null
  const realLog = console.log; const realErr = console.error
  console.log = (v) => printed.push(String(v)); console.error = (...v) => errored.push(v.map(String).join(' '))
  const target = { exitCode: 0 }
  try {
    await runCli(['node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism', '--out', path.join(dir, 'out.json'), ...argv], {
      adapters: { 'opendata-csv': (p, o) => collectFromOpenDataCsv(p, { ...o, fetchImpl: stubFetch(csv) }) },
      persistReport: async (_p, report) => { persisted = report },
      now: NOW, resolveCodeIdentity: () => CODE,
      placeResolver: resolver ? resolverOf(calls) : null,
      ...(store ? { store } : {}),
    }, target)
  } finally { console.log = realLog; console.error = realErr }
  /* Прогон, не напечатавший сводку, — это отказ ДО печати: сводки нет, и
     подставлять вместо неё пустой объект честно, а не ронять набор на JSON. */
  const summary = printed.length ? JSON.parse(printed.join('\n')) : { gate: null, write: null, printed: false }
  return { exitCode: target.exitCode, summary, full: persisted, calls, errored: errored.join('\n') }
}
const gateOf = (r) => `${r.summary.gate?.state}:${r.summary.gate?.reason}${r.summary.gate?.drift?.length ? ':' + r.summary.gate.drift.map((d) => d.kind).join('+') : ''}`

/* ── 1. Эталон: сухой прогон того же входа ─────────────────────────────── */
const reference = await run({ argv: ['--dry-write', '--existing', EXISTING_A, '--names', NAMES_A], store: createSnapshotStore([SNAP_ROW]), resolver: true })
t('эталон: сухой прогон завершается кодом 0', reference.exitCode, 0)
t('эталон: манифест собран', reference.full.manifest?.contractVersion, 'run-manifest/v2')
t('эталон: режим dry-write', reference.full.manifest?.mode, 'dry-write')
t('эталон: gate не взведён — эталона ещё нет', gateOf(reference), 'NOT_ARMED:referenceMissing')
t('эталон: вход подписан сырыми байтами', /^sha256:/.test(reference.full.manifest?.portals[0]?.input?.rawPayload?.digest ?? ''), true)
t('эталон: база и имена подписаны', [reference.full.manifest?.base?.existing?.digest, reference.full.manifest?.names?.digest].every((d) => /^sha256:/.test(d ?? '')), true)
/* Из двух строк до записи доходит одна: «通天閣» уходит в awaitingClassification. */
t('эталон: сухая запись состоялась', reference.summary.write?.outcomes?.created, 1)
const REF = await file('reference.json', reference.full)

/* ── 2. Положительный контроль: живая запись по эталону ────────────────── */
{
  const store = createSnapshotStore([SNAP_ROW])
  const r = await run({ argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', REF], store, resolver: true })
  t('контроль: gate PASS', gateOf(r), 'PASS:null')
  t('контроль: код возврата 0', r.exitCode, 0)
  t('контроль: writer дошёл до хранилища — запись создана', r.summary.write?.outcomes?.created, 1)
  t('контроль: резолвер вызван для записываемой строки', r.calls.resolver, 1)
  t('контроль: эталон назван digest\'ом', r.summary.gate?.reference?.manifestDigest, reference.full.manifest.manifestDigest.value)
  t('контроль: хранилище — память (не Airtable)', isMemoryPoiStore(store), true)
  t('контроль: post-run сравнение по-прежнему в отчёте', typeof r.summary.monitor, 'object')
}

/* ── 3. Контрпримеры дрейфа — каждый отдельно; store и резолвер падают на любом вызове ── */
const blocked = async (label, { csv = CSV_A, argv, expect }) => {
  const calls = { store: 0, resolver: 0 }
  const r = await run({ csv, argv, store: exploding(label, calls), resolver: true, calls })
  t(`${label}: BLOCK с именованным дрейфом`, gateOf(r), expect)
  t(`${label}: к хранилищу не обращались`, calls.store, 0)
  t(`${label}: к резолверу не обращались`, calls.resolver, 0)
  t(`${label}: writeRun не вызван — запись отказана gate`, r.summary.write?.refused, 'preWriteGate')
  t(`${label}: код возврата процесса ненулевой`, r.exitCode, 1)
  t(`${label}: отчёт всё равно сохранён — с gate внутри`, r.full?.gate?.state, 'BLOCK')
  return r
}
/* Изменившиеся байты источника меняют и канонический набор: обе оси названы. */
await blocked('дрейф входа', { csv: CSV_B, argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', REF], expect: 'BLOCK:drift:inputDrift+canonicalDrift' })
await blocked('дрейф базы', { argv: ['--write', '--existing', EXISTING_B, '--names', NAMES_A, '--monitor', REF], expect: 'BLOCK:drift:baseDrift' })
await blocked('дрейф имён', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_B, '--monitor', REF], expect: 'BLOCK:drift:namesDrift' })
{
  /* Дрейф политики и таксономии: эталон, собранный тем же производителем под другую политику / другой реестр. */
  /* Тело эталонного манифеста без подписи: пересобираем его тем же
     производителем под другую политику / реестр / коммит — так эталон
     остаётся законным артефактом, а не подделкой с чужим digest. */
  const body = Object.fromEntries(Object.entries(reference.full.manifest).filter(([key]) => key !== 'manifestDigest'))
  const otherPolicy = await file('reference-policy.json', { ...reference.full, manifest: buildRunManifest({ ...body, matcherPolicy: { ...body.matcherPolicy, digest: `sha256:${'0'.repeat(64)}` } }) })
  await blocked('дрейф политики', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', otherPolicy], expect: 'BLOCK:drift:policyDrift' })
  /* РЕЕСТРЫ — ПО ЗНАЧЕНИЮ И КАЖДЫЙ СВОЕЙ ЗАПИСЬЮ (10f-Q R2, находка аудита 2).
     До R2 реестр решений владельца о координатах компоненты не имел вовсе. */
  const withRegistry = (id, over) => buildRunManifest({
    ...body,
    registries: body.registries.map((r) => (r.id === id ? { ...r, ...over } : r)),
  })
  const otherTaxonomy = await file('reference-taxonomy.json', { ...reference.full, manifest: withRegistry('poi-taxonomy', { valueDigest: `sha256:${'1'.repeat(64)}` }) })
  await blocked('дрейф реестра таксономии', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', otherTaxonomy], expect: 'BLOCK:drift:registryDrift' })
  const otherDecisions = await file('reference-decisions.json', { ...reference.full, manifest: withRegistry('poi-coordinate-decisions', { valueDigest: `sha256:${'2'.repeat(64)}` }) })
  await blocked('дрейф реестра решений владельца о координатах', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', otherDecisions], expect: 'BLOCK:drift:registryDrift' })
  const droppedRegistry = await file('reference-registry-set.json', { ...reference.full, manifest: buildRunManifest({ ...body, registries: body.registries.filter((r) => r.id !== 'poi-coordinate-decisions') }) })
  await blocked('исчезнувший реестр — другой состав, а не «совпало»', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', droppedRegistry], expect: 'BLOCK:drift:registrySetDrift' })
  const otherCode = await file('reference-code.json', { ...reference.full, manifest: buildRunManifest({ ...body, code: { ...body.code, commit: '9'.repeat(40) } }) })
  await blocked('дрейф кода: другой коммит', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', otherCode], expect: 'BLOCK:drift:codeDrift' })
  /* Тот же коммит, изменённые байты цепочки (10f-Q R1, находка аудита 2):
     прежде такой прогон проходил gate, потому что сравнивался только коммит. */
  const otherGraph = await file('reference-graph.json', { ...reference.full, manifest: buildRunManifest({ ...body, code: { ...body.code, graph: { ...body.code.graph, digest: `sha256:${'7'.repeat(64)}` } } }) })
  await blocked('дрейф кода: тот же коммит, другие байты production-цепочки', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', otherGraph], expect: 'BLOCK:drift:codeGraphDrift' })
  const otherDeps = await file('reference-deps.json', { ...reference.full, manifest: buildRunManifest({ ...body, code: { ...body.code, deps: { ...body.code.deps, digest: `sha256:${'8'.repeat(64)}` } } }) })
  await blocked('дрейф кода: другой замок зависимостей', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', otherDeps], expect: 'BLOCK:drift:codeDepsDrift' })
  const otherDirty = await file('reference-dirty.json', { ...reference.full, manifest: buildRunManifest({ ...body, code: { ...body.code, dirty: true } }) })
  await blocked('дрейф кода: эталон снят на грязном дереве', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', otherDirty], expect: 'BLOCK:drift:codeDirtyDrift' })
  /* Одинаковый сырой payload, другой канонический набор (находка аудита 3):
     раньше canonical не сравнивался вовсе, если байты совпали. */
  const otherCanonical = await file('reference-canonical.json', { ...reference.full, manifest: buildRunManifest({ ...body, portals: body.portals.map((p) => ({ ...p, input: { ...p.input, canonical: { ...p.input.canonical, digest: `sha256:${'5'.repeat(64)}` } } })) }) })
  const canonicalRun = await blocked('одинаковые байты входа, другой канонический набор', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', otherCanonical], expect: 'BLOCK:drift:canonicalDrift' })
  t('и сырые байты при этом признаны совпавшими', canonicalRun.summary.gate.drift.some((d) => d.kind === 'inputDrift'), false)
  /* Два дрейфа сразу — оба названы. */
  await blocked('дрейф входа и базы', { csv: CSV_B, argv: ['--write', '--existing', EXISTING_B, '--names', NAMES_A, '--monitor', REF], expect: 'BLOCK:drift:inputDrift+canonicalDrift+baseDrift' })
}

/* ── 3б. Дрейф в строке, которой отказано в ключе ──────────────────────── */
{
  const refUnkeyed = await run({ csv: CSV_UNKEYED_A, argv: ['--dry-write', '--existing', EXISTING_A, '--names', NAMES_A], store: createSnapshotStore([SNAP_ROW]), resolver: true })
  t('эталон с неключевой строкой: отказ в ключе учтён', refUnkeyed.full.portals[0].finalTally.sourceKeyRefused, 1)
  const refFile = await file('reference-unkeyed.json', refUnkeyed.full)
  const same = await run({ csv: CSV_UNKEYED_A, argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', refFile], store: createSnapshotStore([SNAP_ROW]), resolver: true })
  t('тот же вход целиком — PASS', gateOf(same), 'PASS:null')
  await blocked('дрейф ТОЛЬКО в строке без ключа', { csv: CSV_UNKEYED_B, argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', refFile], expect: 'BLOCK:drift:inputDrift+canonicalDrift' })
}

/* ── 4. Эталон негодный, отсутствует, неполный ─────────────────────────── */
{
  await blocked('живая запись без эталона', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A], expect: 'BLOCK:referenceMissing' })
  await blocked('живая запись без файла базы', { argv: ['--write', '--names', NAMES_A, '--monitor', REF], expect: 'BLOCK:baseIdentityMissing' })
  const noManifest = await file('reference-old.json', { startedAt: '2026-08-11T00:00:00.000Z', dryRun: true, portals: reference.full.portals })
  await blocked('эталон старого формата без манифеста', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', noManifest], expect: 'BLOCK:referenceInvalid' })
  const corrupted = JSON.parse(JSON.stringify(reference.full)); corrupted.manifest.base.existing.records = 99
  await blocked('эталон повреждён после подписи', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', await file('reference-corrupt.json', corrupted)], expect: 'BLOCK:referenceInvalid' })
  const incomplete = JSON.parse(JSON.stringify(reference.full)); delete incomplete.manifest.portals
  await blocked('эталон неполный', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', await file('reference-incomplete.json', incomplete)], expect: 'BLOCK:referenceInvalid' })
  const extra = JSON.parse(JSON.stringify(reference.full)); extra.manifest.extra = 1
  await blocked('эталон с лишним полем', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', await file('reference-extra.json', extra)], expect: 'BLOCK:referenceInvalid' })
  const unknown = JSON.parse(JSON.stringify(reference.full)); unknown.manifest.contractVersion = 'run-manifest/v7'
  await blocked('эталон неизвестной версии', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', await file('reference-unknown.json', unknown)], expect: 'BLOCK:referenceInvalid' })
  await blocked('эталон не читается', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', path.join(dir, 'нет.json')], expect: 'BLOCK:referenceInvalid' })
  await blocked('эталон не разбирается', { argv: ['--write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', await file('reference-broken.json', '{сломано')], expect: 'BLOCK:referenceInvalid' })
}

/* ── 4б. Одно проверенное содержимое: подмена файла после подписи не доходит до writer'а ──
   Находка аудита 1 (10f-Q R1). Файл --names подменяется В ХОДЕ прогона — после
   того, как манифест снял с него digest, но до того, как writer применит имена.
   Точка подмены — `resolveCodeIdentity`: main зовёт её при сборке манифеста,
   уже подписав имена. До правки writer читал файл второй раз и применял
   подменённое содержимое при `gate: PASS`
   (`tmp/10f-q-r1-repro-toctou-OLD-2026-09-04.log`: siteCity «kyoto» из подмены). */
{
  const NAMES_SWAP = await file('names-swap.json', { 'bodik-osaka-tourism:1': { nameRu: 'Замок Осака' }, 'bodik-osaka-tourism:2': { nameRu: 'Башня Цутэнкаку' } })
  const refSwap = await run({ argv: ['--dry-write', '--existing', EXISTING_A, '--names', NAMES_SWAP], store: createSnapshotStore([SNAP_ROW]), resolver: true })
  const refSwapFile = await file('reference-swap.json', refSwap.full)
  let swapped = false
  const store = createSnapshotStore([SNAP_ROW])
  const printed = []
  const realLog = console.log; const realErr = console.error
  console.log = (v) => printed.push(String(v)); console.error = () => {}
  const target = { exitCode: 0 }
  const calls = { store: 0, resolver: 0 }
  try {
    await runCli(['node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism', '--out', path.join(dir, 'out-swap.json'),
      '--write', '--existing', EXISTING_A, '--names', NAMES_SWAP, '--monitor', refSwapFile], {
      adapters: { 'opendata-csv': (p, o) => collectFromOpenDataCsv(p, { ...o, fetchImpl: stubFetch(CSV_A) }) },
      persistReport: async () => {}, now: NOW, store,
      placeResolver: resolverOf(calls),
      resolveCodeIdentity: () => {
        if (!swapped) {
          swapped = true
          writeFileSync(NAMES_SWAP, JSON.stringify({ 'bodik-osaka-tourism:1': { nameRu: 'ПОДМЕНЁННОЕ ИМЯ', siteCity: 'kyoto' } }))
        }
        return CODE
      },
    }, target)
  } finally { console.log = realLog; console.error = realErr }
  const swapSummary = JSON.parse(printed.join('\n'))
  t('подмена файла имён произошла в ходе прогона', swapped, true)
  t('gate прошёл по подписанным байтам', swapSummary.gate?.state, 'PASS')
  t('writer применил ИСХОДНОЕ имя, а не подменённое', swapSummary.write?.outcomes?.created, 1)
  t('и город записи остался осакским — подменённый siteCity не применён', swapSummary.write?.placeUnresolved, 0)
  t('второго чтения файла имён не было: покрытие считает подписанные ключи', swapSummary.write?.names?.matched, 1)
  t('и файл в отчёте — тот, что подписан манифестом', swapSummary.write?.names?.file, NAMES_SWAP)
  t('прогон завершился нулевым кодом', target.exitCode, 0)
}

/* ── 5. Сухие режимы: без эталона gate не взведён, с эталоном — сверяет ── */
{
  const dry = await run({ argv: ['--dry-write', '--existing', EXISTING_A, '--names', NAMES_A], store: createSnapshotStore([SNAP_ROW]), resolver: true })
  t('dry-write без эталона: NOT_ARMED, запись идёт', `${gateOf(dry)} / ${dry.summary.write?.outcomes?.created}`, 'NOT_ARMED:referenceMissing / 1')
  const snap = await run({ argv: ['--base-snapshot', SNAPSHOT, '--names', NAMES_A], resolver: true })
  t('snapshot без эталона: NOT_ARMED, режим snapshot', `${gateOf(snap)} / ${snap.full.manifest.mode}`, 'NOT_ARMED:referenceMissing / snapshot')
  t('snapshot: тождество снимка в манифесте', /^sha256:/.test(snap.full.manifest.base.snapshot?.digest ?? ''), true)
  const dryDrift = await blocked('dry-write с эталоном и дрейфом входа', { csv: CSV_B, argv: ['--dry-write', '--existing', EXISTING_A, '--names', NAMES_A, '--monitor', REF], expect: 'BLOCK:drift:inputDrift+canonicalDrift' })
  t('dry-write с эталоном: режим в манифесте dry-write', dryDrift.full.manifest.mode, 'dry-write')
  const ro = await run({ argv: ['--existing', EXISTING_A, '--monitor', REF] })
  t('read-only: gate не применяется, отчёт без gate', 'gate' in ro.summary, false)
  t('read-only: манифест есть — им можно стать эталоном', ro.full.manifest?.mode, 'read-only')
  t('read-only: код 0', ro.exitCode, 0)
}

/* ── 6. Отпечаток кода — по ФАКТИЧЕСКОМУ ГРАФУ ИМПОРТОВ ─────────────────
   Находка аудита 1 (10f-Q R2): состав цепочки задавался ПРАВИЛОМ по каталогам,
   и правило устаревало молча. Аудитор предъявил `src/lib/prefectures.ts` и
   `config/poi-coordinate-decisions.v1.json` — правка обоих сохраняла прежний
   отпечаток и прежние 64 файла. Правило заменено обходом графа импортов от
   настоящей точки входа: объявлять состав больше нечего.

   Игрушечное дерево делает утверждение независимым от текущего состава
   репозитория; настоящее дерево проверяется отдельно и предъявленными
   файлами. */
{
  const graphRoot = await mkdtemp(path.join(tmpdir(), 'jj-graph-'))
  const put = async (rel, text) => {
    await mkdir(path.join(graphRoot, path.dirname(rel)), { recursive: true })
    await writeFile(path.join(graphRoot, rel), text, 'utf8')
  }
  const ENTRY = 'scripts/poi-portals/collect-pois.mjs'
  await put(ENTRY, [
    "import { b } from '../lib/canonical-contract.mjs'",
    "import { c } from '../../src/lib/poi-matching.ts'",
    "import registry from '../../config/poi-registry.json' with { type: 'json' }",
    "import { readFile } from 'node:fs/promises'",
    'export const a = 1',
    '', ].join('\n'))
  await put('scripts/lib/canonical-contract.mjs', "import { deep } from '../../src/lib/prefectures.ts'\nexport const b = 1\n")
  await put('src/lib/poi-matching.ts', 'export const c = 1\n')
  await put('src/lib/prefectures.ts', 'export const deep = 1\n')
  await put('config/poi-registry.json', '{"version":"v1"}\n')
  /* Никем не импортированные файлы: рядом лежат, но эта цепочка их не грузит. */
  await put('scripts/poi-portals/probe-page.mjs', 'export const unused = 1\n')
  await put('src/lib/telegram-bot.ts', 'export const d = 1\n')

  /* Игрушечное дерево обходится от СВОЕЙ точки входа: предмет этого раздела —
     обход, а не выбор точки входа (её проверяет раздел по настоящему дереву). */
  const graphOf = async () => codeGraphIdentity((await readCodeGraph(ENTRY, graphRoot)).files)
  const walk = await readCodeGraph(ENTRY, graphRoot)
  const paths = walk.files.map((f) => f.path)
  t('в граф вошло ровно то, что импортировано', paths.length, 5)
  t('и транзитивный модуль тоже — глубина обхода не ограничена', paths.includes('src/lib/prefectures.ts'), true)
  t('и JSON-реестр, привезённый импортом', paths.includes('config/poi-registry.json'), true)
  t('не импортированный сосед в граф не входит', paths.includes('scripts/poi-portals/probe-page.mjs'), false)
  t('голые спецификаторы названы отдельно и не хешируются', walk.external.join(','), 'node:fs/promises')

  const base = await graphOf()
  t('спецификация отпечатка объявлена', base.spec, 'poi-code-graph/v1')

  /* Правка КАЖДОГО узла графа обязана сдвинуть отпечаток по отдельности. */
  const shifts = [
    ['точка входа', ENTRY, "import { b } from '../lib/canonical-contract.mjs'\nimport { c } from '../../src/lib/poi-matching.ts'\nimport registry from '../../config/poi-registry.json' with { type: 'json' }\nimport { readFile } from 'node:fs/promises'\nexport const a = 2\n"],
    ['узел scripts/lib', 'scripts/lib/canonical-contract.mjs', "import { deep } from '../../src/lib/prefectures.ts'\nexport const b = 2\n"],
    ['узел src/lib', 'src/lib/poi-matching.ts', 'export const c = 2\n'],
    ['ТРАНЗИТИВНЫЙ узел (prefectures.ts — контрпример аудита)', 'src/lib/prefectures.ts', 'export const deep = 2\n'],
    ['JSON-РЕЕСТР в графе (контрпример аудита)', 'config/poi-registry.json', '{"version":"v2"}\n'],
  ]
  let previous = base
  for (const [label, rel, text] of shifts) {
    await put(rel, text)
    const next = await graphOf()
    t(`правка «${label}» сдвигает отпечаток`, next.digest !== previous.digest, true)
    previous = next
  }
  t('и состав графа при этом не изменился', previous.files, 5)

  /* Обратная сторона: то, что цепочка не грузит, отпечаток не двигает. */
  await put('scripts/poi-portals/probe-page.mjs', 'export const unused = 2\n')
  await put('src/lib/telegram-bot.ts', 'export const d = 2\n')
  t('не импортированные соседи отпечаток не двигают', (await graphOf()).digest, previous.digest)

  /* Границы обхода названы, а не подразумеваются. */
  const boomAsync = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e.message } }
  await put('src/lib/poi-matching.ts', "import { missing } from './нет-такого.ts'\nexport const c = 3\n")
  const missing = await boomAsync(() => readCodeGraph(ENTRY, graphRoot))
  t('импорт несуществующего файла — отказ, а не молчаливый пропуск', missing.includes('не прочитан'), true)
  await put('src/lib/poi-matching.ts', 'const name = process.env.X\nawait import(name)\nexport const c = 3\n')
  const dynamic = await boomAsync(() => readCodeGraph(ENTRY, graphRoot))
  t('нелитеральный import() — отказ: полноту графа доказать нечем', dynamic.includes('нелитеральным аргументом'), true)

  /* ДВЕ ОСИ — ДВА РАЗНЫХ ВОПРОСА, И ЭТО ОБЪЯВЛЕНО (10f-Q R3, находка аудита 3).
     `code.graph` — БАЙТОВОЕ тождество всего, что цепочка способна загрузить:
     переформатирование файла его двигает, и это правильный fail-closed —
     байты цепочки изменились, значит прогон уже не тот. `registries` —
     ЦЕННОСТНОЕ тождество загруженного реестра: переформатирование его не
     двигает, потому что решения принимались по значению. Обе семантики
     объявлены, и ни одна не выдаёт себя за другую. */
  await put('src/lib/poi-matching.ts', 'export const c = 4\n')
  const pretty = '{\n  "version": "v1"\n}\n'
  const compact = '{"version":"v1"}\n'
  await put('config/poi-registry.json', pretty)
  const prettyGraph = (await graphOf()).digest
  await put('config/poi-registry.json', compact)
  const compactGraph = (await graphOf()).digest
  t('переформатирование JSON-реестра ДВИГАЕТ байтовый отпечаток графа', prettyGraph !== compactGraph, true)
  t('и НЕ двигает ценностное тождество реестра',
    registryValueIdentity({ id: 'r', version: 'v1', value: JSON.parse(pretty), entries: 0 }).valueDigest,
    registryValueIdentity({ id: 'r', version: 'v1', value: JSON.parse(compact), entries: 0 }).valueDigest)

  /* НАСТОЯЩЕЕ ДЕРЕВО: оба предъявленных аудитом файла обязаны быть в графе. */
  const realWalk = await readCodeGraph(CODE_GRAPH_ENTRY, path.resolve(import.meta.dirname, '..'))
  const realPaths = realWalk.files.map((f) => f.path)
  t('production-граф: src/lib/prefectures.ts (контрпример аудита)', realPaths.includes('src/lib/prefectures.ts'), true)
  t('production-граф: реестр решений владельца о координатах', realPaths.includes('config/poi-coordinate-decisions.v1.json'), true)
  t('production-граф: реестр таксономии', realPaths.includes('config/poi-taxonomy.v2.json'), true)
  /* Точка входа — сам коллектор, и это проверяется по достижимому из неё, а не
     по объявлению: от чужой точки входа граф не содержал бы ни манифеста, ни
     приёма POI, и «отпечаток цепочки» описывал бы другую цепочку. */
  t('production-граф: точка входа входит в собственный граф', realPaths.includes(CODE_GRAPH_ENTRY), true)
  for (const reachableOnlyFromCollector of [
    'scripts/poi-portals/lib/run-manifest.mjs', 'scripts/poi-portals/lib/code-graph.mjs',
    'src/lib/poi-ingest.ts', 'src/lib/poi-coordinate-decision.ts', 'src/lib/place-resolve.ts',
  ]) {
    t(`production-граф: ${reachableOnlyFromCollector}`, realPaths.includes(reachableOnlyFromCollector), true)
  }
  const real = await readCodeGraphIdentity()
  t('на настоящем дереве отпечаток непуст', real.files > 40, true)
  t('и он воспроизводим', (await readCodeGraphIdentity()).digest, real.digest)
}

/* ── 7. Реестры подписаны ЗНАЧЕНИЕМ, которое загрузил процесс ───────────
   Находка аудита 2: реестр решений владельца компоненты не имел вовсе, а байты
   таксономии читались отдельным поздним чтением файла — подписан мог быть не
   тот экземпляр, по которому уже приняты решения. */
{
  const registries = collectRegistryIdentities()
  t('реестров ровно два и они отсортированы', registries.map((r) => r.id).join(','), 'poi-coordinate-decisions,poi-taxonomy')
  for (const registry of registries) {
    t(`${registry.id}: подписан digest значения`, /^sha256:[0-9a-f]{64}$/.test(registry.valueDigest), true)
    t(`${registry.id}: версия названа`, registry.version.length > 0, true)
  }
  t('подпись реестров воспроизводима', collectRegistryIdentities().map((r) => r.valueDigest).join(','), registries.map((r) => r.valueDigest).join(','))
  /* Значения берутся у загрузчиков, а не перечитыванием файлов: манифест
     прогона несёт ровно эти записи. */
  const inManifest = reference.full.manifest.registries.map((r) => `${r.id}@${r.valueDigest}`).join(',')
  t('манифест прогона несёт те же подписи реестров', inManifest, registries.map((r) => `${r.id}@${r.valueDigest}`).join(','))
}

/* ── 8. Код не менялся, пока шёл прогон ────────────────────────────────
   Находка аудита 1 (10f-Q R3): снимок графа снимался один раз и поздно, после
   адаптеров. Процесс загружает модули в начале, поэтому подмена файла между
   загрузкой и снимком давала манифест, удостоверяющий НЕ ТОТ код
   (`tmp/10f-q-r3-repro-graph-toctou-OLD-2026-09-04.log`). Теперь снимков два —
   до первого адаптера и перед gate, — и расхождение останавливает прогон. */
{
  const boomSync = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e.message } }
  const snap = (graphDigest, files, depsDigest) => ({
    graph: { spec: 'poi-code-graph/v1', digest: graphDigest, files },
    deps: { file: 'package-lock.json', digest: depsDigest, bytes: 10 },
  })
  const a = snap(`sha256:${'a'.repeat(64)}`, 55, `sha256:${'d'.repeat(64)}`)
  t('совпавшие снимки — прогон идёт, возвращается второй',
    assertCodeSnapshotStable(a, a).graph.digest, a.graph.digest)
  t('первого снимка нет — сравнивать нечего, второй возвращается как есть',
    assertCodeSnapshotStable(null, a).graph.digest, a.graph.digest)
  const movedGraph = boomSync(() => assertCodeSnapshotStable(a, snap(`sha256:${'b'.repeat(64)}`, 55, a.deps.digest)))
  has('байты цепочки изменились во время прогона — отказ', movedGraph, 'изменились ПОКА ШЁЛ ПРОГОН')
  has('  и названа именно ось графа', movedGraph, 'граф исполняемого кода')
  has('  и объяснено, почему это не «просто дрейф»', movedGraph, 'какой код отработал, сказать нечем')
  const movedDeps = boomSync(() => assertCodeSnapshotStable(a, snap(a.graph.digest, 55, `sha256:${'e'.repeat(64)}`)))
  has('замок зависимостей изменился во время прогона — отказ', movedDeps, 'замок зависимостей')
  const movedBoth = boomSync(() => assertCodeSnapshotStable(a, snap(`sha256:${'b'.repeat(64)}`, 54, `sha256:${'e'.repeat(64)}`)))
  has('обе оси названы по отдельности (1)', movedBoth, 'граф исполняемого кода')
  has('обе оси названы по отдельности (2)', movedBoth, 'замок зависимостей')

  /* И это работает в ПРОИЗВОДСТВЕННОЙ композиции, а не только на объектах.
     Контрпример исполняется В ПЕСОЧНИЦЕ-КОПИИ: править рабочий файл и
     восстанавливать его в `finally` нельзя — прерванный процесс оставил бы
     подмену в дереве владельца, а параллельная правка была бы затёрта
     (находка аудита R3 по тестам). Здесь меняется файл копии; рабочее дерево
     не трогается ни при каком исходе. */
  const counterexample = await readFile(path.resolve(import.meta.dirname, 'support/code-swap-counterexample.mjs'), 'utf8')
  const sandbox = createProductionSandbox({ patch: { 'code-swap-counterexample.mjs': counterexample } })
  const RUN_IN_SANDBOX = "await import('./code-swap-counterexample.mjs')"
  let quiet
  let sabotaged
  try {
    /* Положительный контроль: без подмены тот же прогон собирает манифест. */
    process.env.JJ_SABOTAGE = '0'
    quiet = sandbox.run(RUN_IN_SANDBOX)
    process.env.JJ_SABOTAGE = '1'
    sabotaged = sandbox.run(RUN_IN_SANDBOX)
  } finally {
    delete process.env.JJ_SABOTAGE
    sandbox.dispose()
  }
  t('production (песочница): без подмены манифест собран', quiet.hasManifest, true)
  t('production (песочница): и граф в нём непуст', quiet.graphFiles > 40, true)
  t('production (песочница): без подмены код возврата нулевой', quiet.exitCode, 0)
  t('production (песочница): подмена модуля во время прогона — ненулевой код возврата', sabotaged.exitCode, 1)
  has('production (песочница): причина названа', sabotaged.errored, 'изменились ПОКА ШЁЛ ПРОГОН')
  has('production (песочница): названа ось графа', sabotaged.errored, 'граф исполняемого кода')
  t('production (песочница): манифест не собран', sabotaged.hasManifest, false)
  t('production (песочница): к хранилищу не обращались', sabotaged.calls.store, 0)
  t('production (песочница): к резолверу не обращались', sabotaged.calls.resolver, 0)

  /* И главное: рабочий файл контрпримером не тронут. */
  const victim = path.resolve(import.meta.dirname, '../src/lib/prefectures.ts')
  t('рабочий файл цепочки контрпримером не изменён',
    (await readFile(victim, 'utf8')).includes('PODMENA'), false)
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ pre-write gate в production-композиции: ${ok} проверок пройдено`)
}
