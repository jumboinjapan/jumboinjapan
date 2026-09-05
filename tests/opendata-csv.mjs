#!/usr/bin/env node
/**
 * Ключ источника адаптера opendata-csv — тождество, а не позиция (10f-Q, P01.2).
 *
 *   node tests/opendata-csv.mjs
 *
 * Дефект, который это закрывает (воспроизведён на production-адаптере и через
 * production-композицию `main` → `matchAgainstExisting`,
 * tmp/10f-q-r0-repro-p01-OLD-2026-09-04.log): при пустом или отсутствующем
 * идентификаторе адаптер подставлял `row-N`, и после перестановки строк
 * «通天閣» становился `same` с записью базы «Замок Осака» по `source_key` с
 * уверенностью 1 — ключ, а с ним идемпотентность, имя из --names и решение
 * владельца о координатах, переезжал на другой объект. Повтор идентификатора
 * в выгрузке схлопывался в конвейере и всплывал чужим инвариантом «очередь
 * не сходится» при нулевом коде возврата.
 *
 * Здесь исполняется ПРОИЗВОДСТВЕННЫЙ адаптер с подменённым только fetch и
 * производственный `main` с тем же адаптером. Копий логики ключа нет.
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assertHeaderRow, collectFromOpenDataCsv, OPENDATA_CSV_ADAPTER_VERSION, SOURCE_KEY_REFUSALS, sourceKeyRefusalsOf,
} from '../scripts/poi-portals/lib/opendata-csv.mjs'
import { getPortal } from '../scripts/poi-portals/registry.mjs'
import { matchAgainstExisting } from '../scripts/poi-portals/lib/dedupe.mjs'
import { runCli } from '../scripts/poi-portals/collect-pois.mjs'
import { RAW_FILE_BYTES_SPEC } from '../scripts/lib/byte-digest.mjs'

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

/* ── Фикстура источника: две настоящие строки формата 観光施設一覧 ─────── */
const DESC = '大阪を代表する歴史的建造物であり、天守閣の内部は博物館として公開されています。豊臣秀吉によって築かれた城の歴史や、大坂の陣に関する資料が数多く展示されており、最上階の展望台からは大阪市街を一望することができます。周囲は公園として整備されています。'
const H = '名称,名称_英語,説明,所在地_都道府県,所在地_市区町村,所在地_連結表記,緯度,経度,URL,利用可能曜日,開始時間,終了時間,連絡先電話番号,アクセス方法'
const OSAKAJO = `"大阪城","Osaka Castle","${DESC}","大阪府","大阪市","大阪府大阪市中央区大阪城1-1","34.6873","135.5259","https://example.invalid/1","月曜日","09:00","17:00","06-6941-3044","地下鉄谷町四丁目駅から徒歩15分"`
const TSUTEN = `"通天閣","Tsutenkaku","${DESC}","大阪府","大阪市","大阪府大阪市浪速区恵美須東1-18-6","34.6525","135.5063","https://example.invalid/2","毎日","10:00","20:00","06-6641-9555","地下鉄恵美須町駅から徒歩3分"`
const SUMIYOSHI = `"住吉大社","Sumiyoshi Taisha","${DESC}","大阪府","大阪市","大阪府大阪市住吉区住吉2-9-89","34.6125","135.4930","https://example.invalid/3","毎日","06:00","17:00","06-6672-0753","南海住吉大社駅から徒歩3分"`
const csv = (header, ...rows) => [header, ...rows].join('\n')
const withId = (id, row) => `"${id}",${row}`

const stubFetch = (csvText) => async (u) => {
  const url = String(u)
  if (url.includes('package_show')) return { ok: true, status: 200, json: async () => ({ success: true, result: {
    license_id: 'cc-by', metadata_modified: '2026-03-30T00:00:00',
    resources: [{ format: 'CSV', url: 'https://example.invalid/data.csv', last_modified: '2026-03-30T00:00:00' }] } }) }
  if (url.includes('data.csv')) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(csvText).buffer }
  throw new Error(`сеть не предусмотрена: ${url}`)
}
const portal = getPortal('bodik-osaka-tourism')
const collect = (text, options = {}) => collectFromOpenDataCsv(portal, { fetchImpl: stubFetch(text), ...options })
const keysOf = (r) => r.candidates.map((c) => `${c.sourceKey}=${c.nameJa}`)
const refusalsOf = (r) => r.unkeyed.map((u) => `${u.rowIndex}:${u.refusal}${u.collidesWith ? `↔${u.collidesWith.join('/')}` : ''}`)

/* ── 1. Положительный контроль: идентификаторы есть ────────────────────── */
const OK = csv(`ID,${H}`, withId('OSAKA0000001', OSAKAJO), withId('OSAKA0000002', TSUTEN))
{
  const r = await collect(OK)
  t('контроль: два кандидата под ключами источника', keysOf(r).join('|'), 'bodik-osaka-tourism:OSAKA0000001=大阪城|bodik-osaka-tourism:OSAKA0000002=通天閣')
  t('контроль: отказов в ключе нет', r.unkeyed.length, 0)
  t('контроль: версия адаптера объявлена', r.meta.adapter, OPENDATA_CSV_ADAPTER_VERSION)
  t('версия адаптера сдвинута вместе с разбором заголовков', OPENDATA_CSV_ADAPTER_VERSION, 'opendata-csv/v3')
  t('контроль: колонка идентификатора названа', r.meta.sourceIdColumn, 'ID')
  t('контроль: рассмотрено = кандидаты + отказы', r.meta.considered, r.meta.returned + r.meta.unkeyed)
  t('контроль: сырой payload подписан', /^sha256:[0-9a-f]{64}$/.test(r.meta.rawPayload.digest) && r.meta.rawPayload.spec === RAW_FILE_BYTES_SPEC, true)
  t('контроль: размер payload — байты источника', r.meta.rawPayload.bytes, new TextEncoder().encode(OK).byteLength)
  const again = await collect(OK)
  t('контроль: адаптер детерминирован', JSON.stringify(again.candidates), JSON.stringify(r.candidates))
  t('контроль: и подпись payload та же', again.meta.rawPayload.digest, r.meta.rawPayload.digest)
  const other = await collect(csv(`ID,${H}`, withId('OSAKA0000001', OSAKAJO), withId('OSAKA0000002', TSUTEN), withId('OSAKA0000003', SUMIYOSHI)))
  t('иной вход — иная подпись payload', other.meta.rawPayload.digest === r.meta.rawPayload.digest, false)
}

/* ── 2. Перестановка строк: ключ не переезжает ────────────────────────── */
{
  const swapped = await collect(csv(`ID,${H}`, withId('OSAKA0000002', TSUTEN), withId('OSAKA0000001', OSAKAJO)))
  t('с идентификаторами перестановка строк ключей не меняет',
    keysOf(swapped).sort().join('|'), keysOf(await collect(OK)).sort().join('|'))
  /* Без колонки идентификатора — прежний контрпример. */
  const noId = await collect(csv(H, OSAKAJO, TSUTEN))
  const noIdSwapped = await collect(csv(H, TSUTEN, OSAKAJO))
  t('без колонки идентификатора кандидатов нет', noId.candidates.length, 0)
  t('без колонки идентификатора обе строки — именованный отказ', refusalsOf(noId).join('|'), '1:sourceIdColumnMissing|2:sourceIdColumnMissing')
  t('и после перестановки тоже — позиция ключом не становится', refusalsOf(noIdSwapped).join('|'), '1:sourceIdColumnMissing|2:sourceIdColumnMissing')
  t('ни одного ключа вида row-N', JSON.stringify(noId).includes('row-'), false)
  t('строки не потеряны: считаны 2, рассмотрены 2, отказов 2', `${noId.meta.rows}/${noId.meta.considered}/${noId.meta.unkeyed}`, '2/2/2')
  t('колонка идентификатора — null', noId.meta.sourceIdColumn, null)
  /* Композиция с базой: прежде «通天閣» под row-1 совпадал с «Замок Осака» по ключу. */
  const base = [{ poiId: 'POI-000001', sourceKey: 'bodik-osaka-tourism:row-1', nameRu: 'Замок Осака', nameEn: 'Osaka Castle', lat: 34.6873, lon: 135.5259 }]
  t('композиция: кандидата, который совпал бы с чужой записью по ключу, больше нет',
    noIdSwapped.candidates.map((c) => matchAgainstExisting(c, base).verdict).join(','), '')
}

/* ── 3. Пустой, неверный, повторный идентификатор ─────────────────────── */
{
  const blank = await collect(csv(`ID,${H}`, withId('1', OSAKAJO), withId('', TSUTEN)))
  t('пустой идентификатор — отказ одной строки, соседняя с ключом', `${keysOf(blank).join('|')} / ${refusalsOf(blank).join('|')}`, 'bodik-osaka-tourism:1=大阪城 / 2:sourceIdEmpty')
  for (const [label, id] of [['пробел в начале', ' 7'], ['пробел внутри', '7 8'], ['табуляция', '7\t'], ['управляющий символ', '7']]) {
    const r = await collect(csv(`ID,${H}`, withId(id, OSAKAJO), withId('9', TSUTEN)))
    t(`идентификатор с «${label}» — отказ sourceIdInvalid, без подрезки`, refusalsOf(r).join('|'), '1:sourceIdInvalid')
    t(`  и сырое значение сохранено в отказе`, r.unkeyed[0]?.sourceId ?? '(отказа нет)', id)
    t(`  соседняя строка получает ключ`, keysOf(r).join('|'), 'bodik-osaka-tourism:9=通天閣')
  }
  const dup = await collect(csv(`ID,${H}`, withId('7', OSAKAJO), withId('7', TSUTEN), withId('8', SUMIYOSHI)))
  t('повтор идентификатора — отказ ОБЕИМ строкам, третья с ключом',
    `${keysOf(dup).join('|')} / ${refusalsOf(dup).join('|')}`, 'bodik-osaka-tourism:8=住吉大社 / 1:sourceKeyCollision↔2|2:sourceKeyCollision↔1')
  t('в кандидатах нет двух одинаковых ключей', new Set(dup.candidates.map((c) => c.sourceKey)).size, dup.candidates.length)
  const two = await collect(csv(`ID,NO,${H}`, `"1","9",${OSAKAJO}`, `"","2",${TSUTEN}`))
  t('две колонки идентификатора — неоднозначность, отказ всем', refusalsOf(two).join('|'), '1:sourceIdColumnAmbiguous|2:sourceIdColumnAmbiguous')
  const wide = await collect(csv(`ＩＤ,${H}`, withId('OSAKA0000001', OSAKAJO)))
  t('полноширинный заголовок колонки распознаётся', keysOf(wide).join('|'), 'bodik-osaka-tourism:OSAKA0000001=大阪城')
  t('закрытый список отказов — ровно пять', SOURCE_KEY_REFUSALS.join(','), 'sourceIdColumnMissing,sourceIdColumnAmbiguous,sourceIdEmpty,sourceIdInvalid,sourceKeyCollision')
}

/* ── 3б. Неоднозначность заголовков — ДО потери их структуры (10f-Q R1) ──
   `parse(columns: true)` схлопывает одинаковые заголовки: значение первой
   колонки исчезает молча, и `foldWidth` делает то же самое с «ID» и «ＩＤ».
   Воспроизведено на production-адаптере (tmp/10f-q-r1-repro-headers-OLD-…):
   ключ брался из ВТОРОЙ колонки ID, а columns показывал 15 при 16 колонках. */
{
  const boomAsync = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e.message } }
  const dupId = await boomAsync(() => collect(csv(`ID,ID,${H}`, `"7","9",${OSAKAJO}`)))
  has('точный повтор заголовка ID — отказ выгрузки', dupId, 'заголовки выгрузки неоднозначны')
  has('  и названы обе колонки', dupId, 'колонки 1 («ID»), 2 («ID»)')
  const wideId = await boomAsync(() => collect(csv(`ID,ＩＤ,${H}`, `"7","9",${OSAKAJO}`)))
  has('«ID» и полноширинный «ＩＤ» — одна и та же колонка после складывания ширины', wideId, 'заголовки выгрузки неоднозначны')
  has('  и названы обе формы', wideId, '2 («ＩＤ»)')
  const dupName = await boomAsync(() => collect(csv(`ID,名称,${H}`, `"7","ПОДМЕНА",${OSAKAJO}`)))
  has('повтор СОДЕРЖАТЕЛЬНОЙ колонки тоже отказ — иначе значение вытесняется молча', dupName, '«名称»')
  /* Положительный контроль: заголовки различимы — разбор идёт, и колонок
     ровно столько, сколько в файле. */
  const okHeaders = await collect(OK)
  t('различимые заголовки: разбор идёт', okHeaders.candidates.length, 2)
  t('и число колонок равно числу колонок файла', okHeaders.meta.columns, OK.split('\n')[0].split(',').length)
  t('сырые заголовки едут диагностикой в порядке источника', okHeaders.meta.headers.slice(0, 3).join(','), 'ID,名称,名称_英語')
  /* Пустые хвостовые заголовки — обычная форма японских выгрузок и не повод
     для отказа: ключами они не становятся. */
  const trailing = await collect(csv(`ID,${H},,`, `"7",${OSAKAJO},,`))
  t('пустые хвостовые заголовки отказом не являются', trailing.candidates.map((c) => c.sourceKey).join(''), 'bodik-osaka-tourism:7')
  /* Чистая функция: тот же вердикт без сети и разбора. */
  t('assertHeaderRow пропускает различимые', assertHeaderRow(['ID', '名称'], 'p').join(','), 'ID,名称')
  has('assertHeaderRow ловит повтор', await boomAsync(async () => assertHeaderRow(['ID', 'ID'], 'p')), 'неоднозначны')
  has('assertHeaderRow ловит эквивалентность по ширине', await boomAsync(async () => assertHeaderRow(['ID', 'ＩＤ'], 'p')), 'неоднозначны')
  has('пустая строка заголовков — отказ', await boomAsync(async () => assertHeaderRow([], 'p')), 'нет строки заголовков')
}

/* ── 3в. Строка заголовков берётся из ЗАПИСЕЙ, а не из физических строк ──
   Найдено при разборе мутации N12 (10f-Q R1) сравнением с `columns: true`.
   Двухпроходный разбор (`to_line: 1` / `from_line: 2`) считает ФИЗИЧЕСКИЕ
   строки файла: `skip_empty_lines` до них не доходит, а поле с переносом
   внутри кавычек занимает две строки. На обеих законных формах ниже такой
   разбор давал ПУСТУЮ строку заголовков — `assertHeaderRow` не находил в ней
   неоднозначности (проверять было нечего), объекты строк выходили пустыми, и
   вся выгрузка молча превращалась в отказы `sourceIdColumnMissing`. Молчаливое
   «в выгрузке нет ID» — ровно тот класс отказа, который пакет и закрывает. */
{
  /* Отказ адаптера здесь — это ПРОВАЛ проверки, а не крушение прогона:
     иначе мутация убивалась бы исключением, а не поимённой проверкой. */
  const attempt = async (text, options) => {
    try { return await collect(text, options) } catch (e) {
      return { error: e.message, candidates: [], unkeyed: [], meta: { headers: [], rows: 0, columns: 0 } }
    }
  }

  /* Файл начинается с пустой строки — обычный хвост выгрузки из таблицы. */
  const leadingBlank = await attempt(`\n${csv(`ID,${H}`, withId('OSAKA0000001', OSAKAJO))}`)
  t('пустая первая строка файла разбор не роняет', leadingBlank.error ?? null, null)
  t('пустая первая строка файла не съедает заголовки', keysOf(leadingBlank).join('|'), 'bodik-osaka-tourism:OSAKA0000001=大阪城')
  t('  и отказов в ключе не появляется', leadingBlank.unkeyed?.length ?? -1, 0)
  t('  и заголовки прочитаны целиком', leadingBlank.meta.headers[0] ?? null, 'ID')

  /* Заголовок с переносом внутри кавычек: одна ЗАПИСЬ на двух строках файла. */
  const wrapped = await attempt(csv(`"ID","名称\n(和名)",${H.split(',').slice(1).join(',')}`, withId('OSAKA0000002', TSUTEN)))
  t('заголовок с переносом внутри кавычек разбор не роняет', wrapped.error ?? null, null)
  t('заголовок с переносом внутри кавычек — одна запись, а не две строки', wrapped.candidates.length, 1)
  t('  и ключ источника на месте', wrapped.candidates[0]?.sourceKey ?? null, 'bodik-osaka-tourism:OSAKA0000002')
  t('  и перенос сохранён в сырых заголовках', wrapped.meta.headers[1] ?? null, '名称\n(和名)')

  /* Объекты строк построены ПРОВЕРЕННЫМИ заголовками и по позиции: лишние
     поля строки отбрасываются, недостающие ключей не получают. */
  const short = await attempt(csv('ID,名称,緯度', '"7","大阪城"'))
  t('строка короче заголовка: недостающая колонка ключа не получает', short.meta.rows, 1)
  t('  и кандидат собран по имеющимся колонкам', short.candidates[0]?.sourceKey ?? null, 'bodik-osaka-tourism:7')
  t('  и пустой широты нет', short.candidates[0]?.lat ?? null, null)
}

/* ── 4. --limit: коллизия за границей лимита всё равно коллизия ───────── */
{
  const r = await collect(csv(`ID,${H}`, withId('7', OSAKAJO), withId('8', TSUTEN), withId('7', SUMIYOSHI)), { limit: 2 })
  t('лимит 2: рассмотрены две строки', r.meta.considered, 2)
  t('лимит 2: первая строка — коллизия с третьей, за границей лимита', refusalsOf(r).join('|'), '1:sourceKeyCollision↔3')
  t('лимит 2: вторая — с ключом', keysOf(r).join('|'), 'bodik-osaka-tourism:8=通天閣')
  t('лимит 2: рассмотрено = кандидаты + отказы', r.meta.considered, r.meta.returned + r.meta.unkeyed)
}

/* ── 5. Чистая функция ключей: закон сохранения и отсутствие нормализации ── */
{
  const idx = new Map([['ID', 'ID']])
  const keyed = sourceKeyRefusalsOf([{ ID: 'a' }, { ID: 'a' }, { ID: 'b' }, { ID: '' }, { ID: 'c d' }], idx, 'p')
  t('каждая строка — ключ либо отказ, ровно одно', keyed.every((k) => Boolean(k.sourceKey) !== Boolean(k.refusal)), true)
  t('длина сохраняется', keyed.length, 5)
  t('регистр не приводится: «A» и «a» — разные ключи', sourceKeyRefusalsOf([{ ID: 'A' }, { ID: 'a' }], idx, 'p').map((k) => k.sourceKey).join('|'), 'p:A|p:a')
}

/* ── 6. Производственная композиция main: раскладка и отчёт ───────────── */
const dir = await mkdtemp(path.join(tmpdir(), 'jj-opendata-csv-'))
const existing = path.join(dir, 'existing.json')
await writeFile(existing, JSON.stringify([{ poiId: 'POI-000001', sourceKey: 'bodik-osaka-tourism:row-1', nameRu: 'Замок Осака', nameEn: 'Osaka Castle', lat: 34.6873, lon: 135.5259 }]))
const CODE = { commit: '0e1a40536553d7e585e77c06d2036ed6865ae08d', dirty: false }
const runMain = async (text, argv = [], adapterOverride = null) => {
  const printed = []; let persisted = null
  const realLog = console.log; const realErr = console.error
  console.log = (v) => printed.push(String(v)); console.error = () => {}
  const target = { exitCode: 0 }
  try {
    await runCli(['node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism', '--out', path.join(dir, 'r.json'), ...argv], {
      adapters: { 'opendata-csv': adapterOverride ?? ((p, o) => collectFromOpenDataCsv(p, { ...o, fetchImpl: stubFetch(text) })) },
      persistReport: async (_p, report) => { persisted = report },
      now: new Date('2026-09-04T00:00:00.000Z'), resolveCodeIdentity: () => CODE,
    }, target)
  } finally { console.log = realLog; console.error = realErr }
  return { exitCode: target.exitCode, summary: JSON.parse(printed.join('\n')), full: persisted }
}
{
  const r = await runMain(csv(H, TSUTEN, OSAKAJO), ['--existing', existing])
  const p = r.full.portals[0]
  t('main: портал прошёл без отказа', p.error ?? null, null)
  t('main: без идентификаторов — обе строки в sourceKeyRefused', p.finalTally?.sourceKeyRefused ?? '(раскладки нет)', 2)
  t('main: fetched считает и отказы', p.totals?.fetched ?? '(итогов нет)', 2)
  t('main: сумма раскладки = fetched', Object.values(p.finalTally ?? {}).reduce((a, b) => a + b, 0), p.totals?.fetched ?? -1)
  t('main: полная очередь отказов в отчёте --out', (p.sourceKeyRefusedQueue ?? []).map((u) => `${u.rowIndex}:${u.refusal}:${u.nameJa}`).join('|'), '1:sourceIdColumnMissing:通天閣|2:sourceIdColumnMissing:大阪城')
  t('main: в сводке stdout объёмной очереди нет, счётчик есть', 'sourceKeyRefusedQueue' in r.summary.portals[0], false)
  t('main: с базой по позиционному ключу совпадений нет', p.totals?.matchedExistingBase ?? -1, 0)
  t('main: код возврата 0 — все строки разложены именованно', r.exitCode, 0)
  const good = await runMain(OK, ['--existing', existing])
  t('main: контроль — портал без отказа', good.full.portals[0].error ?? null, null)
  t('main: контроль — с идентификаторами отказов нет', good.full.portals[0].finalTally?.sourceKeyRefused ?? '(раскладки нет)', 0)
  t('main: контроль — оба кандидата разложены', good.full.portals[0].totals?.fetched ?? '(итогов нет)', 2)
  t('main: контроль — тождество входа в отчёте портала', /^sha256:/.test(good.full.portals[0].inputIdentity?.rawPayload?.digest ?? ''), true)
}
/* ── 7. Сторож ключей на границе ЛЮБОГО адаптера ───────────────────────── */
{
  const stub = (candidates, unkeyed = []) => async () => ({ candidates, meta: { adapter: 'stub/v1' }, unkeyed })
  const c = (sourceKey, nameJa = 'x') => ({ sourceKey, nameJa, descriptionJa: DESC, lat: 34.68, lon: 135.52, address: '大阪府大阪市中央区' })
  const dup = await runMain('', [], stub([c('bodik-osaka-tourism:7', '大阪城'), c('bodik-osaka-tourism:7', '通天閣')]))
  has('повтор ключа от адаптера — именованный отказ портала, не «очередь не сходится»', dup.full.portals[0].error, 'ключ источника «bodik-osaka-tourism:7» повторяется')
  const empty = await runMain('', [], stub([c('', '大阪城')]))
  has('кандидат без ключа — отказ портала', empty.full.portals[0].error, 'без ключа источника')
  const badUnkeyed = await runMain('', [], stub([c('bodik-osaka-tourism:1')], [{ rowIndex: 2 }]))
  has('отказ в ключе без причины — отказ портала', badUnkeyed.full.portals[0].error, 'без именованной причины')
  const okStub = await runMain('', [], stub([c('bodik-osaka-tourism:1')], [{ rowIndex: 2, refusal: 'sourceIdEmpty', sourceId: '', nameJa: 'y' }]))
  t('заглушка: портал без отказа', okStub.full.portals[0].error ?? null, null)
  t('заглушка с одним отказом: раскладка сходится', okStub.full.portals[0].finalTally?.sourceKeyRefused ?? '(раскладки нет)', 1)
  t('заглушка: fetched = 2', okStub.full.portals[0].totals?.fetched ?? '(итогов нет)', 2)
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ ключ источника opendata-csv: ${ok} проверок пройдено`)
}
