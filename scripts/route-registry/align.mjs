#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile, mkdir, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { AIRTABLE_BASE_ID, ROUTES_TABLE_ID } from '../../src/lib/airtable-schema.ts'
import { readRegistryRecords, assessRegistryRecords } from '../../src/lib/route-registry-store.ts'
import { executeMigration, validateCard } from './migration.mjs'

const args = process.argv.slice(2)
assert(args.length === 1 || (args.length === 3 && args[1] === '--apply-sha256'), 'Usage: node --env-file=.env.local scripts/route-registry/align.mjs CARD [--apply-sha256 DIGEST]')
const bytes = await readFile(args[0])
const digest = createHash('sha256').update(bytes).digest('hex')
const card = JSON.parse(bytes)
validateCard(card)
assert.equal(card.baseId, AIRTABLE_BASE_ID)
assert.equal(card.tableId, ROUTES_TABLE_ID)
const apply = args.length === 3
if (apply) assert.equal(args[2], digest, 'card_digest_mismatch')
const token = process.env.AIRTABLE_TOKEN
assert(token, 'Airtable credentials required')
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const api = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${ROUTES_TABLE_ID}`
const schemaUrl = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`
const store = {
  readRoutes: () => readRegistryRecords(ROUTES_TABLE_ID),
  assess: assessRegistryRecords,
  async readFields() {
    const res = await fetch(schemaUrl, { headers, redirect: 'error', signal: AbortSignal.timeout(45000) })
    assert(res.ok, `schema_read:${res.status}`)
    const data = await res.json()
    const table = data.tables.find(t => t.id === ROUTES_TABLE_ID)
    assert(table?.name === 'Routes', 'target_table_mismatch')
    return table.fields
  },
  createField: fields => write(`${schemaUrl}/${ROUTES_TABLE_ID}/fields`, 'POST', fields),
  updateRoute: (id, fields) => write(`${api}/${id}`, 'PATCH', { fields }),
  createRoute: fields => write(api, 'POST', { fields }),
}
async function write(url, method, body) {
  await pause(300)
  // No retry, including 429; the executor resolves an uncertain effect by fresh GET.
  const res = await fetch(url, { method, headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(45000) })
  await res.text()
  assert(res.ok, `write_response:${res.status}`)
}
let log
if (apply) {
  await mkdir('tmp/route-registry-alignment', { recursive: true })
  // One execution per exact card. Recovery requires a new card, never a blind replay.
  log = await open(`tmp/route-registry-alignment/${digest}.ndjson`, 'wx', 0o600)
}
async function journal(entry) {
  if (!log) return
  await log.write(JSON.stringify({ at: new Date().toISOString(), cardSha256: digest, ...entry }) + '\n')
  await log.sync()
}
try {
  await journal({ phase: 'start', authority: card.authority })
  const result = await executeMigration(card, store, { apply, journal })
  console.log(JSON.stringify({ ...result, cardSha256: digest }))
} finally { await log?.close() }
