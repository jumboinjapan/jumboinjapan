#!/usr/bin/env node
/** One idempotent schema addition. POI values still go only through ingestPoi. */
import assert from 'node:assert/strict'
import { mkdir, appendFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isDirectEntry } from '../lib/direct-entry.mjs'
import { AIRTABLE_BASE_ID, POI_TABLE_ID } from '../../src/lib/airtable-schema.ts'
import { MUNICIPALITY_FIELD, MUNICIPALITY_FIELD_DEFINITION, verifyMunicipalitySchemaTable } from '../../src/lib/poi-municipality.ts'
import { findPoiTable } from '../../src/lib/poi-taxonomy-airtable.ts'

export async function ensureMunicipality({ apply = false, token, fetchImpl = fetch, journal = async () => {} }) {
  assert(typeof apply === 'boolean' && typeof token === 'string' && token.trim(), 'municipalitySchemaCredentialsRequired')
  const url = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  async function read() {
    const response = await fetchImpl(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) })
    assert(response.ok, `municipalitySchemaRead: HTTP ${response.status}`)
    const found = findPoiTable((await response.json()).tables)
    assert(found.ok && found.table.id === POI_TABLE_ID, 'municipalitySchemaTableRequired')
    return found.table
  }
  const before = await read()
  const existing = before.fields.find(f => f.name === MUNICIPALITY_FIELD)
  if (existing) {
    verifyMunicipalitySchemaTable(before)
    return { state: 'present', fieldId: existing.id, post: 0 }
  }
  const request = { method: 'POST', url: `${url}/${POI_TABLE_ID}/fields`, body: MUNICIPALITY_FIELD_DEFINITION }
  if (!apply) return { state: 'missing', request, post: 0 }
  // Never retry a POST: ambiguous response is reconciled with a fresh GET.
  await journal({ phase: 'intent', request })
  let responseStatus = null
  try {
    const response = await fetchImpl(request.url, { method: 'POST', headers, body: JSON.stringify(request.body), redirect: 'error', signal: AbortSignal.timeout(30000) })
    responseStatus = response.status
  } catch { /* Fresh schema, not the response, decides the result. */ }
  try {
    const after = await read()
    verifyMunicipalitySchemaTable(after)
    const field = after.fields.find(f => f.name === MUNICIPALITY_FIELD)
    assert(typeof field.id === 'string' && field.id, 'municipalitySchemaFieldIdRequired')
    const result = { state: 'verified', fieldId: field.id, post: 1, responseStatus }
    await journal({ phase: 'verified', ...result })
    return result
  } catch (error) {
    await journal({ phase: 'unverified', post: 1, responseStatus })
    throw new Error('municipalitySchemaUnverified: read the schema before retrying; do not repeat POST', { cause: error })
  }
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  const args = process.argv.slice(2)
  assert(args.every(a => a === '--apply') && args.length <= 1, 'Usage: npm run poi:municipality-schema -- [--apply]')
  process.loadEnvFile('.env.local')
  const dir = new URL('../../tmp/poi-municipality-schema/', import.meta.url)
  await mkdir(dir, { recursive: true })
  const log = new URL(`${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.ndjson`, dir)
  const journal = entry => appendFile(log, JSON.stringify(entry) + '\n', { mode: 0o600 })
  console.log(JSON.stringify(await ensureMunicipality({ apply: args.includes('--apply'), token: process.env.AIRTABLE_TOKEN, journal }), null, 2))
}
