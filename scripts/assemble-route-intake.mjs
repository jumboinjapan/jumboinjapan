#!/usr/bin/env node
// JSON to stdout only: redirect to a NEW report file. Never writes Airtable.
import { readFile } from 'node:fs/promises'
import nextEnv from '@next/env'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'
import { assembleRouteIntakePlan, validateRouteIntakePlan } from './lib/route-intake-plan.mjs'
import { fetchJsonResponse } from './poi-portals/lib/network-boundary.mjs'

try {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--input') throw new Error('Usage: npm run --silent route:assemble -- --input plan.json > new-report.json')
  const plan = validateRouteIntakePlan(JSON.parse(await readFile(args[1], 'utf8')))
  // Next env prints a banner; reserve stdout exclusively for the result.
  nextEnv.loadEnvConfig(process.cwd(), undefined, { info() {}, error: console.error })
  const token = process.env.AIRTABLE_TOKEN, base = process.env.AIRTABLE_BASE_ID
  if (!token || !base) throw new Error('Airtable credentials required; no offline approval')
  const report = await assembleRouteIntakePlan(plan, { loadPois: async () => {
    const url = new URL(`https://api.airtable.com/v0/${base}/${POI_TABLE_ID}`)
    for (const f of ['POI ID', 'Source Key', 'POI Name (RU)', 'Description Approved (RU)', 'Description (RU)', 'Is System']) url.searchParams.append('fields[]', f)
    const pois = [], offsets = new Set()
    for (;;) {
      const res = await fetchJsonResponse(fetch, url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`Airtable read failed: ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data.records)) throw new Error('Invalid POI snapshot')
      for (const row of data.records) {
        if (!row.fields) throw new Error('Invalid POI record')
        const f = row.fields
        pois.push({ poiId: f['POI ID'], sourceKey: f['Source Key'], nameRu: f['POI Name (RU)'], approvedRu: f['Description Approved (RU)'], descriptionRu: f['Description (RU)'], isSystem: f['Is System'] === true })
      }
      if (!data.offset) break
      if (typeof data.offset !== 'string' || offsets.has(data.offset)) throw new Error('Invalid pagination')
      offsets.add(data.offset); url.searchParams.set('offset', data.offset)
    }
    return pois
  } })
  console.log(JSON.stringify({ ...report, checkedAt: new Date().toISOString() }, null, 2))
  process.exitCode = report.status === 'ready' ? 0 : 1
} catch (error) {
  console.log(JSON.stringify({ status: 'error', readOnly: true, error: error.message }))
  process.exitCode = 2
}
