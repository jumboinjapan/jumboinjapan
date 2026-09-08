#!/usr/bin/env node
/**
 * Наблюдение часов BODIK и отчёт «что изменилось бы» (10h-C, SC‑005 U3).
 *
 *   node tests/poi-hours-report.mjs
 *
 * Доказывается:
 *   • наблюдение: пустой, частичный, противоречивый и временный факт НЕ
 *     становится `stated`; предложенная строка — та же `composeWorkingHours`,
 *     что и при создании; тождество — только Source Key;
 *   • отчёт: закон сохранения по базе и по источнику; каждая запись ровно в
 *     одной корзине; записи без Source Key и чужого портала — вне области;
 *     расхождения по прочим полям — только очередь просмотра; черновик
 *     карточки сходится с `proposed` и имеет отпечаток; эффектов 0;
 *   • CLI в production-композиции (настоящий адаптер на сохранённой
 *     выгрузке, настоящий разбор снимка): полный список в файле, сводка в
 *     stdout, ни одного сетевого вызова, ни одного POST/PATCH/DELETE;
 *     `--live` без ключа — отказ с именем; структурно — модуль отчёта не
 *     импортирует границу обновления и разрешение.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { composeWorkingHours, parseOpenDataCsvBuffer } from '../scripts/poi-portals/lib/opendata-csv.mjs'
import { HOURS_OBSERVATION_KINDS, observeHoursFacts, observeWorkingHours, parseClockMinutes, TEMPORARY_MARKERS } from '../scripts/poi-portals/lib/hours-observation.mjs'
import { buildHoursReport, HOURS_BASE_SPEC, HOURS_BUCKETS, parseHoursBase, summarizeHoursReport } from '../scripts/poi-portals/lib/hours-report.mjs'
import { parseUpdateCard, updateCardDigest } from '../scripts/poi-portals/lib/update-card.mjs'
import { hoursBaseFromRecords, parseHoursReportArgs, runHoursReportCli } from '../scripts/poi-portals/report-hours.mjs'
import { createAirtablePoiStore } from '../scripts/poi-portals/lib/airtable-store.mjs'
import { getPortal } from '../scripts/poi-portals/registry.mjs'

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

const NOW = new Date('2026-09-08T15:00:00.000Z')
const PORTAL = getPortal('bodik-osaka-tourism')
const P = PORTAL.id
const fact = (sourceKey, over = {}) => ({ sourceKey, rowIndex: 1, openDays: '', openFrom: '', openTo: '', openNote: '', ...over })
/* Помощники записей — до блоков: typescript-estree не разбирает объектную стрелку, за которой сразу идёт блок. */
const R = (n) => `rec${String(n).padStart(14, '0')}`
const rec = (n, sourceKey, workingHours = null, over = {}) => ({ recordId: R(n), poiId: `POI-${String(n).padStart(6, '0')}`, sourceKey, workingHours, website: null, ...over })

/* ── 1. Наблюдение: роды ─────────────────────────────────────────────── */
{
  t('родов ровно пять', HOURS_OBSERVATION_KINDS.join(','), 'stated,absent,partial,contradictory,temporary')
  const stated = observeWorkingHours(fact(`${P}:1`, { openDays: '月曜日〜金曜日', openFrom: '09:00', openTo: '17:00' }))
  t('полный факт — stated', stated.kind, 'stated')
  t('  строка — та же composeWorkingHours', stated.hours, composeWorkingHours({ openDays: '月曜日〜金曜日', openFrom: '09:00', openTo: '17:00', openNote: '' }))
  t('  и типографика создания (короткое тире)', stated.hours, '09:00–17:00. 月曜日〜金曜日')
  t('секунды в источнике не мешают', observeWorkingHours(fact(`${P}:1`, { openFrom: '09:00:00', openTo: '17:30:00' })).hours, '09:00–17:30')
  t('пусто — absent', observeWorkingHours(fact(`${P}:1`)).kind, 'absent')
  t('только дни — partial', observeWorkingHours(fact(`${P}:1`, { openDays: '毎日' })).kind, 'partial')
  t('только начало — partial', observeWorkingHours(fact(`${P}:1`, { openFrom: '09:00' })).kind, 'partial')
  t('только конец — partial', observeWorkingHours(fact(`${P}:1`, { openTo: '17:00' })).kind, 'partial')
  t('только примечание — partial', observeWorkingHours(fact(`${P}:1`, { openNote: '年末年始休業' })).kind, 'partial')
  t('конец раньше начала — contradictory', observeWorkingHours(fact(`${P}:1`, { openFrom: '17:00', openTo: '09:00' })).kind, 'contradictory')
  t('конец равен началу — contradictory', observeWorkingHours(fact(`${P}:1`, { openFrom: '09:00', openTo: '09:00' })).kind, 'contradictory')
  t('время не разбирается — contradictory', observeWorkingHours(fact(`${P}:1`, { openFrom: '午前9時', openTo: '17:00' })).kind, 'contradictory')
  t('25:00 — contradictory', observeWorkingHours(fact(`${P}:1`, { openFrom: '09:00', openTo: '25:00' })).kind, 'contradictory')
  for (const marker of TEMPORARY_MARKERS) {
    t(`маркер «${marker}» в примечании — temporary, а не stated`, observeWorkingHours(fact(`${P}:1`, { openFrom: '09:00', openTo: '17:00', openNote: `${marker}のため` })).kind, 'temporary')
  }
  t('маркер в ячейке времени — temporary', observeWorkingHours(fact(`${P}:1`, { openFrom: '09:00', openTo: '17:00（変更）' })).kind, 'temporary')
  t('temporary не несёт hours', observeWorkingHours(fact(`${P}:1`, { openFrom: '09:00', openTo: '17:00', openNote: '臨時' })).hours, null)
  t('contradictory не несёт hours', observeWorkingHours(fact(`${P}:1`, { openFrom: '17:00', openTo: '09:00' })).hours, null)
  t('наблюдение хранит сырые ячейки', JSON.stringify(observeWorkingHours(fact(`${P}:1`, { openDays: ' 毎日 ' })).raw), '{"openDays":"毎日","openFrom":"","openTo":"","openNote":""}')
  has('без ключа — отказ', await boom(() => observeWorkingHours({ openFrom: '09:00' })), 'без ключа источника')
  has('повтор ключа — отказ', await boom(() => observeHoursFacts([fact(`${P}:1`), fact(`${P}:1`)])), 'дважды')
  t('parseClockMinutes: 24:00 допустимо', parseClockMinutes('24:00'), 1440)
  t('parseClockMinutes: 9:5 — не время', parseClockMinutes('9:5'), null)
}

/* ── 2. Отчёт: корзины и закон сохранения ────────────────────────────── */
{
  const base = parseHoursBase({ spec: HOURS_BASE_SPEC, readAt: NOW.toISOString(), records: [
    rec(1, `${P}:1`, '09:00–17:00'),           // источник: 09:00–18:00 → proposed
    rec(2, `${P}:2`, '09:00–17:00'),           // источник: то же → noChange
    rec(3, `${P}:3`, '09:00–17:00'),           // источник: temporary → needsReview
    rec(4, `${P}:4`, null),                    // источник: absent → absentBoth
    rec(5, `${P}:5`, '10:00–16:00'),           // источник: нет строки → needsReview missingInSource
    rec(6, null, '09:00–17:00'),               // без ключа → вне области
    rec(7, 'japan-guide:x', '09:00–17:00'),    // чужой портал → вне области
    rec(8, `${P}:8`, '09:00–17:00', { website: 'https://old' }), // источник: те же часы, другой сайт → noChange + otherFieldReview
    rec(9, `${P}:9`, null),                    // источник: partial → needsReview (в базе пусто, источник что-то говорит)
  ] })
  const facts = [
    fact(`${P}:1`, { rowIndex: 1, openFrom: '09:00', openTo: '18:00' }),
    fact(`${P}:2`, { rowIndex: 2, openFrom: '09:00', openTo: '17:00' }),
    fact(`${P}:3`, { rowIndex: 3, openFrom: '09:00', openTo: '17:00', openNote: '臨時休業あり' }),
    fact(`${P}:4`, { rowIndex: 4 }),
    fact(`${P}:8`, { rowIndex: 5, openFrom: '09:00', openTo: '17:00' }),
    fact(`${P}:9`, { rowIndex: 6, openDays: '毎日' }),
    fact(`${P}:99`, { rowIndex: 7, openFrom: '09:00', openTo: '17:00' }), // нет в базе → unmatchedSource
  ]
  const observations = observeHoursFacts(facts)
  const candidates = [{ sourceKey: `${P}:8`, website: 'https://new' }, { sourceKey: `${P}:1`, website: '' }]
  const report = buildHoursReport({ portal: PORTAL, observations, candidates, base, source: { url: 'file://x', dataUpdated: '2026-09-01', rawPayloadDigest: 'sha256:' + 'a'.repeat(64) }, createdAt: NOW.toISOString() })
  t('корзины', JSON.stringify(report.counts), JSON.stringify({ proposed: 1, noChange: 2, needsReview: 3, absentBoth: 1, legacyWithoutSourceKey: 1, otherPortal: 1, unmatchedSource: 1, otherFieldReview: 1 }))
  t('proposed: old → proposed', `${report.proposed[0].old} → ${report.proposed[0].proposed}`, '09:00–17:00 → 09:00–18:00')
  t('proposed: тождество и строка источника', `${report.proposed[0].recordId}/${report.proposed[0].poiId}/${report.proposed[0].rowIndex}`, `${R(1)}/POI-000001/1`)
  t('needsReview: причины', report.needsReview.map((r) => `${r.recordId}:${r.reason}`).join(','), `${R(3)}:temporary,${R(5)}:missingInSource,${R(9)}:partial`)
  t('needsReview temporary несёт сырые ячейки', report.needsReview[0].observed.openNote, '臨時休業あり')
  t('прочие поля — только очередь просмотра', JSON.stringify(report.otherFieldReview[0]), JSON.stringify({ recordId: R(8), poiId: 'POI-000008', sourceKey: `${P}:8`, field: 'website', base: 'https://old', source: 'https://new' }))
  t('пустой сайт источника расхождением не считается', report.otherFieldReview.some((r) => r.recordId === R(1)), false)
  t('черновик карточки: одна строка, отпечаток', `${report.draftCard.rows}/${report.draftCard.digest.slice(0, 7)}`, '1/sha256:')
  t('черновик карточки разбирается как карточка обновления и не несёт разрешения', parseUpdateCard(report.draftCard.card).rows[0].proposed['Working Hours'], '09:00–18:00')
  t('черновик карточки: отпечаток совпадает с вычисленным', updateCardDigest(parseUpdateCard(report.draftCard.card)), report.draftCard.digest)
  t('карточка: только Working Hours', Object.keys(report.draftCard.card.rows[0].proposed).join(','), 'Working Hours')
  t('эффектов 0', JSON.stringify(report.effects), '{"post":0,"patch":0,"delete":0}')
  t('каждая запись ровно в одной корзине', HOURS_BUCKETS.reduce((n, b) => n + report[b].length, 0), base.records.length)
  has('сводка называет режим и нули', summarizeHoursReport(report), 'эффектов 0')
  has('сводка называет черновик', summarizeHoursReport(report), 'черновик карточки: 1 строк')
  const empty = buildHoursReport({ portal: PORTAL, observations: [], base: parseHoursBase({ spec: HOURS_BASE_SPEC, readAt: NOW.toISOString(), records: [] }), source: {}, createdAt: NOW.toISOString() })
  t('пустой вход — пустой отчёт без карточки', empty.draftCard, null)
  /* Снимок базы: форма. */
  has('снимок: повтор ключа — отказ', await boom(() => parseHoursBase({ spec: HOURS_BASE_SPEC, readAt: 'x', records: [rec(1, 'a:1'), rec(2, 'a:1')] })), 'у двух записей')
  has('снимок: лишнее поле — отказ', await boom(() => parseHoursBase({ spec: HOURS_BASE_SPEC, readAt: 'x', records: [{ ...rec(1, 'a:1'), lat: 1 }] })), 'лишние поля')
  has('снимок: чужая версия — отказ', await boom(() => parseHoursBase({ spec: 'x', readAt: 'x', records: [] })), 'poi-hours-base/v1')
  has('отчёт: наблюдение чужой формы — отказ', await boom(() => buildHoursReport({ portal: PORTAL, observations: [{ sourceKey: 'a' }], base, source: {}, createdAt: NOW.toISOString() })), 'чужой формы')
  /* Закон сохранения — проверяется, а не обещается: подложный снимок с записью в двух корзинах невозможен по построению, а расхождение счёта ловится. */
  const forged = { ...base, records: [...base.records, base.records[0]] }
  has('закон сохранения: повторная запись в снимке — отказ', await boom(() => buildHoursReport({ portal: PORTAL, observations, base: forged, source: {}, createdAt: NOW.toISOString() })), 'в двух корзинах')

  const websiteGaps = buildHoursReport({
    portal: PORTAL,
    observations: observeHoursFacts([
      fact(`${P}:10`, { openFrom: '09:00', openTo: '17:00' }),
      fact(`${P}:11`, { openFrom: '09:00', openTo: '17:00' }),
    ]),
    candidates: [
      { sourceKey: `${P}:10`, website: '' },
      { sourceKey: `${P}:11`, website: 'https://new.example' },
    ],
    base: parseHoursBase({ spec: HOURS_BASE_SPEC, readAt: NOW.toISOString(), records: [
      rec(10, `${P}:10`, '09:00–17:00', { website: 'https://old.example' }),
      rec(11, `${P}:11`, '09:00–17:00'),
    ] }),
    source: {},
    createdAt: NOW.toISOString(),
  })
  t('прочие поля: исчезнувший сайт остаётся в очереди', JSON.stringify(websiteGaps.otherFieldReview[0]), JSON.stringify({ recordId: R(10), poiId: 'POI-000010', sourceKey: `${P}:10`, field: 'website', base: 'https://old.example', source: null }))
  t('прочие поля: новый сайт при пустой базе остаётся в очереди', JSON.stringify(websiteGaps.otherFieldReview[1]), JSON.stringify({ recordId: R(11), poiId: 'POI-000011', sourceKey: `${P}:11`, field: 'website', base: null, source: 'https://new.example' }))
}

/* ── 3. CLI в production-композиции: настоящий адаптер на сохранённой выгрузке ── */
{
  const dir = await mkdtemp(path.join(tmpdir(), 'jj-hours-report-'))
  const H = 'ID,名称,名称_英語,説明,所在地_都道府県,所在地_市区町村,所在地_連結表記,緯度,経度,URL,利用可能曜日,開始時間,終了時間,利用可能日時特記事項,連絡先電話番号,アクセス方法'
  const rows = [
    '"1","大阪城","Osaka Castle","説明","大阪府","大阪市","大阪府大阪市中央区","34.6873","135.5259","https://example.invalid/1","","09:00","18:00","","06-1","徒歩"',
    '"2","公園","Park","説明","大阪府","大阪市","住所","34.6","135.5","","","","","","",""',
    '"3","博物館","Museum","説明","大阪府","大阪市","住所","34.6","135.5","","","09:30","17:00","臨時休館あり","",""',
    '"4","神社","Shrine","説明","大阪府","大阪市","住所","34.6","135.5","","毎日","10:00","16:00","","",""',
  ]
  const csvPath = path.join(dir, 'bodik.csv')
  await writeFile(csvPath, [H, ...rows].join('\n'), 'utf8')
  const basePath = path.join(dir, 'base.json')
  await writeFile(basePath, JSON.stringify({ spec: HOURS_BASE_SPEC, readAt: NOW.toISOString(), records: [
    rec(1, `${P}:1`, '09:00–17:00'),
    rec(2, `${P}:2`, null),
    rec(3, `${P}:3`, '09:30–17:00'),
    rec(4, `${P}:4`, '10:00–16:00. 毎日'),
    rec(6, null, '09:00–17:00'),
  ] }))
  const outPath = path.join(dir, 'report.json')
  const logs = []
  const errs = []
  const origLog = console.log
  const origErr = console.error
  console.log = (line) => logs.push(String(line))
  console.error = (line) => errs.push(String(line))
  let fetchCalls = 0
  const target = { exitCode: 0 }
  try {
    await runHoursReportCli(['node', 'x', '--portal', P, '--csv', csvPath, '--base', basePath, '--out', outPath], { now: () => NOW, fetchImpl: async () => { fetchCalls += 1; throw new Error('сеть запрещена') } }, target)
  } finally { console.log = origLog; console.error = origErr }
  t('CLI офлайн: код 0', target.exitCode, 0)
  t('CLI офлайн: сети не было', fetchCalls, 0)
  const report = JSON.parse(await readFile(outPath, 'utf8'))
  t('CLI: версия отчёта', report.spec, 'poi-hours-report/v1')
  t('CLI: адаптер настоящий — наблюдений 4', report.source.observations, 4)
  t('CLI: корзины', JSON.stringify(report.counts), JSON.stringify({ proposed: 1, noChange: 1, needsReview: 1, absentBoth: 1, legacyWithoutSourceKey: 1, otherPortal: 0, unmatchedSource: 0, otherFieldReview: 1 }))
  t('CLI: новый сайт при пустой базе не потерян', report.otherFieldReview[0].source, 'https://example.invalid/1')
  t('CLI: полный список old → proposed в файле', `${report.proposed[0].old} → ${report.proposed[0].proposed}`, '09:00–17:00 → 09:00–18:00')
  t('CLI: временный факт — в очередь, не в карточку', report.needsReview[0].reason, 'temporary')
  t('CLI: отпечаток выгрузки записан', report.source.rawPayloadDigest?.startsWith('sha256:'), true)
  has('CLI: stdout — сводка', logs.join('\n'), 'предложено изменить: 1')
  has('CLI: stdout называет файл полного отчёта', logs.join('\n'), outPath)
  t('CLI: эффектов 0', JSON.stringify(report.effects), '{"post":0,"patch":0,"delete":0}')
  /* Разбор аргументов. */
  has('без --out — отказ', await boom(() => parseHoursReportArgs(['n', 'x', '--portal', P, '--csv', 'a', '--base', 'b'])), '--out')
  has('--live с файлами — отказ', await boom(() => parseHoursReportArgs(['n', 'x', '--portal', P, '--live', '--csv', 'a', '--out', 'o'])), 'несовместим')
  has('без файлов и без --live — отказ', await boom(() => parseHoursReportArgs(['n', 'x', '--portal', P, '--out', 'o'])), 'нужны оба файла')
  /* --live без ключа — отказ с именем, сети нет. */
  const saved = process.env.AIRTABLE_TOKEN
  delete process.env.AIRTABLE_TOKEN
  const target2 = { exitCode: 0 }
  console.error = (line) => errs.push(String(line))
  try {
    await runHoursReportCli(['node', 'x', '--portal', P, '--live', '--out', outPath], { fetchImpl: async () => { fetchCalls += 1; throw new Error('сеть запрещена') } }, target2)
  } finally { console.error = origErr; if (saved !== undefined) process.env.AIRTABLE_TOKEN = saved }
  t('--live без AIRTABLE_TOKEN — код 1', target2.exitCode, 1)
  has('  причина названа', errs.join('\n'), 'AIRTABLE_TOKEN')
  t('  сети не было', fetchCalls, 0)
  /* Чужой портал — отказ до всего. */
  const target3 = { exitCode: 0 }
  console.error = (line) => errs.push(String(line))
  try { await runHoursReportCli(['node', 'x', '--portal', 'japan-guide', '--csv', csvPath, '--base', basePath, '--out', outPath], { fetchImpl: async () => { fetchCalls += 1 } }, target3) } finally { console.error = origErr }
  t('портал не BODIK — код 1', target3.exitCode, 1)
  has('  причина: только BODIK', errs.join('\n'), 'только по BODIK')
  /* Живой режим с подменённым транспортом: чтение базы — GET, форма снимка. */
  const gets = []
  const fakeFetch = async (url, init = {}) => {
    const u = String(url)
    gets.push(init.method ?? 'GET')
    if (u.includes('package_show')) return { ok: true, status: 200, json: async () => ({ success: true, result: { license_id: 'cc-by-40-intl', metadata_modified: '2026-09-01T00:00:00', resources: [{ format: 'CSV', url: 'https://data.bodik.jp/dataset/test/resource/test/download/data.csv', last_modified: '2026-09-01T00:00:00' }] } }) }
    if (u.includes('data.csv')) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode([H, ...rows].join('\n')).buffer }
    if (u.includes('api.airtable.com')) return { ok: true, status: 200, json: async () => ({ records: [{ id: R(1), fields: { 'POI ID': 'POI-000001', 'Source Key': `${P}:1`, 'Working Hours': '09:00–17:00' } }] }) }
    throw new Error(`сеть не предусмотрена: ${u}`)
  }
  process.env.AIRTABLE_TOKEN = 'tok-test'
  const target4 = { exitCode: 0 }
  console.log = () => {}
  console.error = (line) => errs.push(String(line))
  try {
    await runHoursReportCli(['node', 'x', '--portal', P, '--live', '--out', outPath], { now: () => NOW, fetchImpl: fakeFetch, store: createAirtablePoiStore({ token: 'tok-test', baseId: 'appX', fetchImpl: fakeFetch }) }, target4)
  } finally { console.log = origLog; console.error = origErr; if (saved !== undefined) process.env.AIRTABLE_TOKEN = saved; else delete process.env.AIRTABLE_TOKEN }
  t('--live (подменённый транспорт): код 0', target4.exitCode, 0)
  t('  только GET', [...new Set(gets)].join(','), 'GET')
  has('  живое чтение объявлено в stderr', errs.join('\n'), 'ЖИВОЕ ЧТЕНИЕ')
  const live = JSON.parse(await readFile(outPath, 'utf8'))
  t('  снимок базы из живого чтения — 1 запись, proposed 1', `${live.base.records}/${live.counts.proposed}`, '1/1')
  t('hoursBaseFromRecords: форма снимка', parseHoursBase(hoursBaseFromRecords([{ recordId: R(1), fields: { 'POI ID': 'POI-000001' } }], NOW.toISOString())).records[0].sourceKey, null)
  /* Структурно: отчёт не пишет и не импортирует границу обновления/разрешение. */
  const src = await readFile(new URL('../scripts/poi-portals/report-hours.mjs', import.meta.url), 'utf8')
  const lib = await readFile(new URL('../scripts/poi-portals/lib/hours-report.mjs', import.meta.url), 'utf8')
  t('CLI не импортирует verified-update / update-approval / write-journal', /verified-update|update-approval|write-journal|update-journal/.test(src + lib), false)
  t('CLI и библиотека не содержат POST/PATCH/DELETE', /method: '(POST|PATCH|DELETE)'/.test(src + lib), false)
  /* Настоящий адаптер на тех же байтах: hoursFacts параллельны кандидатам и не меняют состав кандидата. */
  const bytes = new TextEncoder().encode([H, ...rows].join('\n')).buffer
  const parsed = parseOpenDataCsvBuffer(PORTAL, bytes, { url: 'file://x', licenceId: null, dataUpdated: null })
  t('адаптер: hoursFacts по каждому кандидату', parsed.hoursFacts.map((f) => f.sourceKey).join(','), parsed.candidates.map((c) => c.sourceKey).join(','))
  t('адаптер: кандидат не получил новых ключей', 'hoursFacts' in parsed.candidates[0] || 'openFrom' in parsed.candidates[0], false)
  t('адаптер: сырые ячейки', `${parsed.hoursFacts[2].openFrom}/${parsed.hoursFacts[2].openNote}`, '09:30/臨時休館あり')
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ наблюдение часов BODIK и отчёт «что изменилось бы» (U3): ${ok} проверок пройдено`)
}
