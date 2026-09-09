#!/usr/bin/env node
/** Agent access to the same private queue the owner sees in /admin/poi-review. */
import { readFile, mkdir, appendFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createReviewStore, REVIEW_TABLE_DEFINITION } from '../src/lib/poi-review-storage.ts'
import { validateReviewItem, validateReviewEvent } from '../src/lib/poi-review.ts'

const [command = 'list', ...args] = process.argv.slice(2)
const flag = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
if (command === '--help') {
  console.log('poi:review list [--needs-reply] | schema [--apply] | comment <sourceKey> --file <text> | status <sourceKey> <status> | import --file <items.json>')
  process.exit(0)
}
process.loadEnvFile('.env.local')
const store = createReviewStore()
const auditDirectory = new URL('../tmp/poi-review-operations/', import.meta.url)
await mkdir(auditDirectory, { recursive: true })
const log = new URL(`${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.ndjson`, auditDirectory)
async function journal(value) { await appendFile(log, JSON.stringify(value) + '\n', { mode: 0o600 }) }
async function append(event) {
  await journal({ phase: 'intent', event })
  const saved = await store.append(event)
  await journal({ phase: 'verified', event: saved })
  console.log(JSON.stringify({ saved: saved.id, sourceKey: saved.sourceKey, kind: saved.kind }))
}

if (command === 'list') {
  let rows = await store.load()
  if (args.includes('--needs-reply')) rows = rows.filter(row => row.needsAgentReply)
  console.log(JSON.stringify(rows, null, 2))
} else if (command === 'schema') {
  const token = process.env.AIRTABLE_TOKEN
  const base = process.env.AIRTABLE_BASE_ID
  if (!token || !base) throw Error('Airtable credentials required')
  const url = `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(base)}/tables`
  const request = async (init = {}) => {
    const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw Error(`Review schema HTTP ${response.status}`)
    return response.json()
  }
  const schema = await request()
  function verify(table) {
    if (!table || REVIEW_TABLE_DEFINITION.fields.some(expected => !table.fields?.some(field => field.name === expected.name && field.type === expected.type))) throw Error('Review table schema does not match; existing fields were not changed')
  }
  const existing = schema.tables.find(table => table.name === REVIEW_TABLE_DEFINITION.name)
  if (existing) { verify(existing); console.log('Review table exists; schema verified') }
  else if (!args.includes('--apply')) console.log(JSON.stringify({ plan: 'create one new review table; no existing tables changed', definition: REVIEW_TABLE_DEFINITION }, null, 2))
  else {
    await journal({ phase: 'schema-intent', base, definition: REVIEW_TABLE_DEFINITION })
    const created = await request({ method: 'POST', body: JSON.stringify(REVIEW_TABLE_DEFINITION) })
    const observed = (await request()).tables.find(table => table.id === created.id)
    verify(observed)
    await journal({ phase: 'schema-verified', table: observed })
    console.log(JSON.stringify({ created: observed.name, verified: true }))
  }
} else if (command === 'comment' || command === 'status') {
  const event = validateReviewEvent({
    id: flag('--event-id') ?? randomUUID(), sourceKey: args[0], actor: 'agent', at: new Date().toISOString(),
    kind: command,
    ...(command === 'comment' ? { text: await readFile(flag('--file'), 'utf8') } : { status: args[1] }),
  })
  await append(event)
} else if (command === 'import') {
  const input = JSON.parse(await readFile(flag('--file'), 'utf8'))
  if (!Array.isArray(input)) throw Error('Expected an array of review items')
  const items = input.map(validateReviewItem)
  if (!items.length) { console.log('No items to import'); process.exit(0) }
  if (new Set(items.map(item => item.sourceKey)).size !== items.length) throw Error('Duplicate source keys in import')
  const old = new Map((await store.load()).map(row => [row.sourceKey, validateReviewItem(Object.fromEntries(Object.keys(items[0] ?? {}).map(key => [key, row[key]])))]))
  for (const item of items) {
    if (JSON.stringify(old.get(item.sourceKey)) === JSON.stringify(item)) continue
    await append({ id: randomUUID(), sourceKey: item.sourceKey, actor: 'agent', at: new Date().toISOString(), kind: 'item', item })
  }
} else throw Error('Unknown command; use --help')
