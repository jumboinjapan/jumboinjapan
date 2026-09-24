import assert from 'node:assert/strict'
import { POI_REVIEW_TABLE_NAME } from '../../src/lib/airtable-schema.ts'
/** Separate in-memory service, with the production Review store's real HTTP protocol. */
export function reviewService() {
  const records = []
  return { records, fetchImpl: async (raw, init = {}) => {
    const url = new URL(raw)
    assert(url.pathname.includes('/' + encodeURIComponent(POI_REVIEW_TABLE_NAME)), 'REVIEW_TRANSPORT_TABLE')
    if (init.method === 'POST') {
      const row = { id: `review${records.length}`, fields: JSON.parse(init.body).records[0].fields }
      records.push(row); return Response.json({ records: [row] })
    }
    assert.equal(init.method ?? 'GET', 'GET', 'REVIEW_APPEND_ONLY')
    const id = url.pathname.split('/').at(-1)
    if (id.startsWith('review')) return Response.json(records.find(r => r.id === id))
    const formula = url.searchParams.get('filterByFormula')
    return Response.json({ records: formula ? records.filter(r => formula.includes(r.fields['Event ID'])) : records })
  } }
}
