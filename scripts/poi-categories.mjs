#!/usr/bin/env node
/** Read-only inventory using the same projection as the admin and itinerary builder. */
import { readFile, writeFile } from 'node:fs/promises'
import { summarizePoiCategories } from '../src/lib/poi-category.ts'
import { TAXONOMY_FIELDS } from '../src/lib/poi-taxonomy-airtable.ts'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'

const args = process.argv.slice(2)
const options = {}
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (!['--live', '--fixture', '--out'].includes(arg) || Object.hasOwn(options, arg)) throw Error('Use --live OR --fixture <snapshot.json>, with --out <report.json>')
  if (arg === '--live') options[arg] = true
  else {
    const value = args[++i]
    if (!value || value.startsWith('--')) throw Error(`Missing value for ${arg}`)
    options[arg] = value
  }
}
if (Boolean(options['--live']) === Boolean(options['--fixture']) || !options['--out']) throw Error('Use --live OR --fixture <snapshot.json>, with --out <report.json>')
let rows
let requests = 0
if (options['--fixture']) rows = JSON.parse(await readFile(options['--fixture'], 'utf8'))
else {
  process.loadEnvFile('.env.local')
  const { AIRTABLE_TOKEN: token, AIRTABLE_BASE_ID: baseId } = process.env
  if (!token || !baseId) throw Error('Airtable credentials required')
  rows = []
  let offset
  const seenOffsets = new Set()
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${POI_TABLE_ID}`)
    url.searchParams.set('filterByFormula', 'NOT({Is System})')
    for (const name of ['POI ID', 'POI Name (RU)', 'POI Category (RU)', ...Object.values(TAXONOMY_FIELDS)]) url.searchParams.append('fields[]', name)
    if (offset) url.searchParams.set('offset', offset)
    requests++
    const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw Error(`Airtable category inventory HTTP ${response.status}`)
    const page = await response.json()
    if (!Array.isArray(page.records)) throw Error('Invalid Airtable records')
    rows.push(...page.records.map((r) => ({ recordId: r.id, fields: r.fields })))
    offset = page.offset
    if (offset && (typeof offset !== 'string' || seenOffsets.has(offset))) throw Error('Invalid/repeated Airtable offset')
    if (offset) seenOffsets.add(offset)
  } while (offset)
}
if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.recordId !== 'string' || !r.recordId || !r.fields || typeof r.fields !== 'object' || Array.isArray(r.fields))) throw Error('Expected an array of {recordId, fields}')
if (new Set(rows.map((r) => r.recordId)).size !== rows.length) throw Error('Duplicate recordId')
rows = rows.filter((r) => r.fields['Is System'] !== true)
const report = { source: options['--live'] ? 'live' : options['--fixture'], observedAt: new Date().toISOString(), requests, writes: 0, ...summarizePoiCategories(rows) }
await writeFile(options['--out'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ total: report.total, counts: report.counts, requests, writes: 0, out: options['--out'] }))
