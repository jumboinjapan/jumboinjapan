#!/usr/bin/env node
/**
 * Regression gate: unchanged tests/fixtures/poi-names.json (394 owner names).
 * Live Airtable corpus: editorial diagnostic, not a fixed-code regression sample.
 * See docs/polivanov-check.md. The 45% threshold is unchanged.
 */
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import nextEnv from '@next/env'
import { poiNameToRu } from '../src/lib/polivanov.ts'
import { normalizeName } from '../src/lib/poi-matching.ts'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'

const MIN_EXACT_SHARE = 0.45
const BASELINE = new URL('../tests/fixtures/poi-names.json', import.meta.url)

async function loadCorpus(fixture) {
  if (fixture) {
    return JSON.parse(await readFile(fixture, 'utf8'))
  }
  const token = process.env.AIRTABLE_TOKEN?.trim()
  const baseId = process.env.AIRTABLE_BASE_ID?.trim() || 'apppwhjFN82N9zNqm'
  if (!token) {
    // Без токена берём снимок корпуса из репозитория. Прогон должен
    // работать везде, где работает git: проверка на регрессию, которая
    // требует доступа к живой базе, не запускается, а значит бесполезна.
    console.log('AIRTABLE_TOKEN не задан — сверка идёт по снимку tests/fixtures/poi-names.json')
    return JSON.parse(await readFile('tests/fixtures/poi-names.json', 'utf8'))
  }

  const out = []
  let offset
  try {
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${POI_TABLE_ID}`)
    url.searchParams.set('pageSize', '100')
    for (const f of ['POI ID', 'POI Name (RU)', 'POI Name (EN)']) url.searchParams.append('fields[]', f)
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    if (!res.ok) throw new Error(`Airtable: ${res.status} ${await res.text()}`)
    const data = await res.json()
    out.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)
  } catch (error) {
    // Сети может не быть — тогда сверяемся со снимком, а не падаем.
    // Проверка на регрессию обязана работать в том числе офлайн, иначе
    // её перестанут запускать.
    console.log(`База недоступна (${error.message}) — сверка по снимку tests/fixtures/poi-names.json`)
    return JSON.parse(await readFile('tests/fixtures/poi-names.json', 'utf8'))
  }

  return out
    .map((r) => ({ id: r.fields['POI ID'], ru: r.fields['POI Name (RU)'], en: r.fields['POI Name (EN)'] }))
    .filter((p) => typeof p.ru === 'string' && typeof p.en === 'string' && p.ru.trim() && p.en.trim())
}


export function measureCorpus(pairs) {
  const key = s => normalizeName(s)
  const bag = s => key(s).split(' ').sort().join(' ')
  let exact = 0, reordered = 0, flagged = 0
  const diverged = []
  for (const p of pairs) {
    const r = poiNameToRu(p.en)
    if (!r.nameRu || r.confidence < 0.95 || r.keptLatin.length) { flagged++; continue }
    if (key(r.nameRu) === key(p.ru)) exact++
    else if (bag(r.nameRu) === bag(p.ru)) reordered++
    else diverged.push([p.id, p.en, p.ru, r.nameRu, r.warnings])
  }
  const auto = exact + reordered + diverged.length
  return { total: pairs.length, auto, exact, reordered, flagged, diverged, share: auto ? exact / auto : 0 }
}
export function auditCorpora(baselinePairs, livePairs) {
  const baseline = measureCorpus(baselinePairs)
  const live = livePairs === null ? null : measureCorpus(livePairs)
  return { baseline, live, passed: baseline.auto > 0 && baseline.share >= MIN_EXACT_SHARE }
}
function report(label, result, show) {
  console.log(`\n${label} — ${result.total} пар имён`)
  console.log(`  собрано без вмешательства   ${result.auto}`)
  console.log(`    совпало с эталоном        ${result.exact} (${(result.share * 100).toFixed(2)}%)`)
  console.log(`    разошёлся порядок слов    ${result.reordered}`)
  console.log(`    разошлось                 ${result.diverged.length}`)
  console.log(`  отдано человеку             ${result.flagged}`)
  for (const [id, en, ru, got] of result.diverged.slice(0, show)) {
    console.log(`  ${id} ${en}\n    эталон: ${ru}\n    собрано: ${got}`)
  }
}
async function main() {
  nextEnv.loadEnvConfig(process.cwd())
  const argv = process.argv.slice(2)
  const show = argv.includes('--show') ? Number(argv[argv.indexOf('--show') + 1]) || 40 : 0
  const fixtureIndex = argv.indexOf('--fixture')
  const explicitFixture = fixtureIndex >= 0 ? argv[fixtureIndex + 1] : null
  if (fixtureIndex >= 0 && !explicitFixture) throw new Error('--fixture requires a path')
  const baselinePairs = JSON.parse(await readFile(explicitFixture || BASELINE, 'utf8'))
  const livePairs = explicitFixture ? null : await loadCorpus(null)
  const result = auditCorpora(baselinePairs, livePairs)
  report('РЕГРЕССИЯ: неизменный контрольный корпус', result.baseline, explicitFixture ? show : 0)
  if (result.live) {
    report('ДИАГНОСТИКА: текущий корпус (не ворота регрессии)', result.live, show)
    if (result.live.share < MIN_EXACT_SHARE) console.warn('⚠ Доля совпадений в текущем корпусе ниже 45%. Требуется редакторская сверка; это не доказательство регрессии кода.')
  }
  if (!result.passed) {
    console.error('✗ Регрессия на контрольном корпусе: порог 45% не пройден.')
    process.exitCode = 1
  } else console.log('✓ Контрольный корпус: порог 45% пройден.')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`[check-polivanov] ${error.message}`); process.exitCode = 2 })
}
