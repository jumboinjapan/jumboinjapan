#!/usr/bin/env node
/**
 * ОТЧЁТ «ЧТО ИЗМЕНИЛОСЬ БЫ» ПО ЧАСАМ РАБОТЫ — режим «только отчёт» пилота
 * автообновлений (10h-C, SC‑005 U3; решения владельца I‑2.1–2.4, I‑4.4).
 *
 *   npm run poi:hours-report -- --portal bodik-osaka-tourism --csv tmp/bodik.csv --base tmp/hours-base.json --out tmp/hours-report.json
 *   npm run poi:hours-report -- --portal bodik-osaka-tourism --live --out tmp/hours-report.json   # живое ЧТЕНИЕ: BODIK (CKAN, CSV) и Airtable (GET)
 *
 * Что делает: читает выгрузку BODIK (файл или живой CKAN — теми же правилами,
 * что прогон коллектора), классифицирует часы каждой строки
 * (`poi-hours-observation/v1`), читает снимок базы (файл `poi-hours-base/v1`
 * или живой GET названных полей) и собирает ПОЛНЫЙ отчёт `old → proposed`
 * (`poi-hours-report/v1`) в файл `--out`; в stdout — только сводка.
 *
 * Чего не делает — по устройству, и это проверяется тестом: ни одного POST,
 * PATCH или DELETE, ни одного платного обращения, ни карточки с разрешением,
 * ни журнала эффектов. Черновик карточки в отчёте — информационный.
 *
 * `--live` — живое чтение с ключами: по правилу владельца II‑5.1 оно требует
 * отдельного разрешения на каждый случай (III‑1 выводит из-под него только
 * стадии `verify`, к которым этот отчёт не относится).
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDirectEntry } from '../lib/direct-entry.mjs'
import { getPortal } from './registry.mjs'
import { collectFromOpenDataCsv, parseOpenDataCsvBuffer } from './lib/opendata-csv.mjs'
import { observeHoursFacts } from './lib/hours-observation.mjs'
import { buildHoursReport, HOURS_BASE_SPEC, parseHoursBase, summarizeHoursReport } from './lib/hours-report.mjs'
import { createAirtablePoiStore } from './lib/airtable-store.mjs'
import { describeThrownSafely } from '../../src/lib/thrown-value.ts'

export const HOURS_REPORT_CLI_SPEC = 'poi-hours-report-cli/v1'
/** Поля, которые живой режим читает из базы — ровно те, что нужны отчёту. */
export const HOURS_BASE_FIELDS = Object.freeze(['POI ID', 'Source Key', 'Working Hours', 'Website'])

export function parseHoursReportArgs(argv) {
  const args = { portal: null, csv: null, base: null, out: null, live: false }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) throw new Error(`${a}: нужен аргумент`); i += 1; return v }
    if (a === '--portal') args.portal = next()
    else if (a === '--csv') args.csv = next()
    else if (a === '--base') args.base = next()
    else if (a === '--out') args.out = next()
    else if (a === '--live') args.live = true
    else throw new Error(`Неизвестный аргумент: ${a}`)
  }
  if (!args.portal) throw new Error('Укажите --portal <id>')
  if (!args.out) throw new Error('Укажите --out <файл отчёта>: полный список old → proposed пишется только в файл')
  if (args.live && (args.csv || args.base)) throw new Error('--live несовместим с --csv/--base: либо файлы, либо живое чтение')
  if (!args.live && (!args.csv || !args.base)) throw new Error('Без --live нужны оба файла: --csv <выгрузка BODIK> и --base <снимок poi-hours-base/v1>')
  return args
}

/** Снимок базы из живого чтения названных полей — форма `poi-hours-base/v1`. */
export function hoursBaseFromRecords(rows, readAt) {
  return {
    spec: HOURS_BASE_SPEC,
    readAt,
    records: rows.map((row) => ({
      recordId: row.recordId,
      poiId: typeof row.fields['POI ID'] === 'string' ? row.fields['POI ID'] : null,
      sourceKey: typeof row.fields['Source Key'] === 'string' ? row.fields['Source Key'] : null,
      workingHours: typeof row.fields['Working Hours'] === 'string' ? row.fields['Working Hours'] : null,
      website: typeof row.fields.Website === 'string' ? row.fields.Website : null,
    })),
  }
}

export async function runHoursReportCli(argv = process.argv, deps = {}, target = process) {
  const now = deps.now ?? (() => new Date())
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  try {
    const args = parseHoursReportArgs(argv)
    const portal = getPortal(args.portal)
    if (!portal || portal.adapter !== 'opendata-csv') throw new Error(`портал ${args.portal} не найден или не является выгрузкой opendata-csv — отчёт часов строится только по BODIK (I‑2.4)`)

    let collected
    let base
    if (args.live) {
      const token = process.env.AIRTABLE_TOKEN?.trim()
      const baseId = process.env.AIRTABLE_BASE_ID?.trim() || 'apppwhjFN82N9zNqm'
      if (!token) throw new Error('--live требует AIRTABLE_TOKEN: живое чтение базы без ключа невозможно; файлы --csv/--base — офлайн-режим')
      console.error(`[poi-hours-report] ЖИВОЕ ЧТЕНИЕ: BODIK ${portal.id} (CKAN + CSV) и Airtable GET полей ${HOURS_BASE_FIELDS.join(', ')} — записей 0 по устройству`)
      collected = await collectFromOpenDataCsv(portal, { fetchImpl })
      const store = deps.store ?? createAirtablePoiStore({ token, baseId, fetchImpl })
      base = parseHoursBase(hoursBaseFromRecords(await store.readAllFields(HOURS_BASE_FIELDS), now().toISOString()))
    } else {
      const csvPath = path.resolve(args.csv)
      const bytes = await readFile(csvPath)
      collected = parseOpenDataCsvBuffer(portal, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { url: `file://${csvPath}`, licenceId: null, dataUpdated: null })
      base = parseHoursBase(JSON.parse(await readFile(path.resolve(args.base), 'utf8')), args.base)
    }
    const observations = observeHoursFacts(collected.hoursFacts)
    const report = buildHoursReport({
      portal,
      observations,
      candidates: collected.candidates,
      base,
      source: { url: collected.meta.url ?? null, dataUpdated: collected.meta.dataUpdated ?? null, rawPayloadDigest: collected.meta.rawPayload?.digest ?? null },
      createdAt: now().toISOString(),
    })
    await writeFile(path.resolve(args.out), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(summarizeHoursReport(report))
    console.log(`полный отчёт: ${path.resolve(args.out)}`)
    target.exitCode = 0
    return target.exitCode
  } catch (thrown) {
    target.exitCode = 1
    try { console.error(`[poi-hours-report] ${describeThrownSafely(thrown)}`) } catch { /* код уже выставлен */ }
    return target.exitCode
  }
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  await runHoursReportCli()
}
