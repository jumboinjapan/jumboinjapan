#!/usr/bin/env node
/**
 * READ-ONLY СОПОСТАВЛЕНИЕ СНИМКА ОБХОДА С ТАБЛИЦЕЙ POI.
 *
 *   node scripts/poi-portals/match-discovery-to-airtable.mjs \
 *     docs/poi-intake/baselines/japan-guide-v3-2026-08-25.artifact.json.gz \
 *     tmp/airtable-poi-export-2026-08-25.json \
 *     tmp/poi-airtable-match-2026-08-25.json
 *
 * НИ СЕТИ, НИ AIRTABLE. Скрипт не умеет ходить в базу вовсе: выгрузка
 * подаётся файлом, сделанным отдельно и только на чтение. Это не удобство, а
 * граница — инструмент, который «заодно мог бы и записать», однажды запишет.
 *
 * Снимок проверяется контрактом ДО сопоставления: раскладывать по исходам
 * непроверенный снимок значило бы обсуждать состав того, что снимком не
 * является.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDiscoverySnapshot } from './lib/discovery-contract.mjs'
import { readCanonicalGzip, selectPortalSnapshot } from './lib/discovery-baseline.mjs'
import { reconcileDiscoveryWithAirtable } from './lib/discovery-airtable-match.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
/* Портал НАЗЫВАЕТСЯ. Прежде здесь стоял «первый портал, у которого есть
   снимок», и отчёт с двумя порталами молча сопоставлял чужой. */
export const PORTAL_ID = 'japan-guide'
const [reportArg, exportArg, outArg] = process.argv.slice(2)
if (!reportArg || !exportArg) {
  console.error('нужны: <отчёт обхода> <выгрузка Airtable> [<файл результата>]')
  process.exit(2)
}
const bytesOf = (rel) => readFileSync(path.resolve(REPO, rel))
/* Отчёт принимается и сжатым: baseline лежит в репозитории gzip'ом, и
   сопоставление должно уметь работать с ним, а не только с распакованной
   копией в `tmp/`, которой в свежем клоне нет. Вид определяется ПО БАЙТАМ, а
   не по имени: имя файла ничего не гарантирует. */
const reportBytes = (rel) => {
  const bytes = bytesOf(rel)
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? readCanonicalGzip(bytes) : bytes
}

const snapshot = selectPortalSnapshot(
  JSON.parse(reportBytes(reportArg).toString('utf8')), PORTAL_ID)
assertDiscoverySnapshot(snapshot)
/* Байты, а не разобранный объект: отпечаток входа обязан считаться внутри
   границы, иначе он не доказательство, а объявление. */
const report = reconcileDiscoveryWithAirtable(snapshot, bytesOf(exportArg))

if (outArg) {
  writeFileSync(path.resolve(REPO, outArg), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

const { counts } = report
const line = (label, value) => console.log(`  ${label.padEnd(38)}${String(value).padStart(6)}`)
console.log(`\nСОПОСТАВЛЕНИЕ ${report.contractVersion} — только чтение\n`)
line('объектов обхода', counts.discoveryRecords)
line('записей Airtable', counts.airtableRecords)
line('из них служебных (не объекты мира)', counts.airtableSystemRows)
console.log('')
line('связано по Source Key', counts.linkedByKey)
line('связано по адресу страницы', counts.linkedByUrl)
line('кандидаты по имени — решает человек', counts.nameCandidates)
line('конфликты свидетельств — решает человек', counts.conflicts)
line('неоднозначные — решает человек', counts.ambiguous)
line('не найдено соответствий', counts.unmatched)
line('записи портала, не найденные обходом', counts.portalRowsNotFound)
console.log(`\nВходы: снимок ${report.inputs.discovery.snapshotDigest.slice(0, 23)}…`)
console.log(`       выгрузка ${report.inputs.airtable.exportDigest.slice(0, 23)}… `
  + `(${report.inputs.airtable.baseId}/${report.inputs.airtable.tableId}, `
  + `${report.inputs.airtable.fetchedAt})`)
console.log('\nНи одна запись Airtable не изменена: скрипт не умеет писать.')
if (outArg) console.log(`Подробности: ${outArg}`)
