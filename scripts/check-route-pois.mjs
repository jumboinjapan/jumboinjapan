#!/usr/bin/env node
// Read-only admission for a proposed route, including imports from external links.
import { readFile, writeFile, realpath }  from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import nextEnv from '@next/env'
import { POI_TABLE_ID } from '../src/lib/airtable-schema.ts'
import { routePoiIssues } from '../src/lib/route-poi-readiness.ts'

const args = process.argv.slice(2)
if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--report') {
  console.error('Usage: npm run route:preflight -- --input plan.json --report report.json')
  process.exit(2)
}
try {
  const inputPath = await realpath(args[1])
  const reportPath = await realpath(args[3]).catch(e => { if (e.code !== 'ENOENT') throw e; return path.resolve(args[3]) })
  if (inputPath === reportPath) throw new Error('Input and report must be different files')
  const bytes = await readFile(args[1], 'utf8')
  const inputSha256 = createHash('sha256').update(bytes).digest('hex')
  await writeFile(args[3], JSON.stringify({ status: 'unchecked', inputSha256, readOnly: true }) + '\n')
  const input = JSON.parse(bytes)
  if (input.version !== 1 || typeof input.routeSlug !== 'string' || !input.routeSlug.trim() || !Array.isArray(input.stops) || !input.stops.length) throw new Error('Expected version:1, routeSlug and non-empty stops')
  if (input.stops.some(s => !s || typeof s.key !== 'string' || !s.key.trim())) throw new Error('Every stop requires a key')
  const structural = routePoiIssues(input.stops, []).filter(i => i.code !== 'unknown_poi')
  let issues = structural
  if (!issues.length) {
    nextEnv.loadEnvConfig(process.cwd())
    const token = process.env.AIRTABLE_TOKEN, base = process.env.AIRTABLE_BASE_ID
    if (!token || !base) throw new Error('Airtable credentials required; no offline approval')
    const ids = [...new Set(input.stops.map(s => s.poiId.trim()))], pois = []
    for (let n = 0; n < ids.length; n += 50) {
      const url = new URL(`https://api.airtable.com/v0/${base}/${POI_TABLE_ID}`)
      url.searchParams.set('filterByFormula', `OR(${ids.slice(n,n+50).map(id => `{POI ID}='${id}'`).join(',')})`)
      for (const f of ['POI ID','POI Name (RU)','Description Approved (RU)','Description (RU)','Is System']) url.searchParams.append('fields[]',f)
      let offset
      do {
        if(offset) url.searchParams.set('offset',offset)
        const res = await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)})
        if(!res.ok) throw new Error(`Airtable read failed: ${res.status}`)
        const data=await res.json()
        if(!Array.isArray(data.records)) throw new Error('Invalid Airtable response')
        for(const r of data.records){const f=r.fields;if(!f)throw new Error('Invalid POI');pois.push({poiId:f['POI ID'],nameRu:f['POI Name (RU)'],approvedRu:f['Description Approved (RU)'],descriptionRu:f['Description (RU)'],isSystem:f['Is System']===true})}
        offset=data.offset
      } while(offset)
    }
    issues=routePoiIssues(input.stops,pois)
  }
  const report={version:1,inputSha256,routeSlug:input.routeSlug,checkedAt:new Date().toISOString(),status:issues.length?'blocked':'ready',issues,readOnly:true}
  await writeFile(args[3],JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2));process.exitCode=issues.length?1:0
} catch(error){console.error(`[route:preflight] ${error.message}`);process.exitCode=2}
