import assert from 'node:assert/strict'
import path from 'node:path'
import { inspectRuntimeTrace } from '../scripts/check-runtime-bundles.mjs'
const root = '/project'
const trace = '/project/.next/server/app/api/telegram/webhook/route.js.nft.json'
const files = values => values.map(v => path.relative(path.dirname(trace), `${root}/${v}`))
for (const target of ['tmp/evidence.json', 'tests/fixtures/sample.json', 'docs/archive/scripts/old.mjs.txt', 'public/photo.jpg', 'scripts/poi-portals/lib/write-journal.mjs']) {
  assert.deepEqual(inspectRuntimeTrace(trace, files([target]), root), [target])
}
assert.deepEqual(inspectRuntimeTrace(trace, files(['src/lib/airtable-field-equality.mjs', 'config/poi-taxonomy.v2.json', 'node_modules/next/package.json']), root), [])
const pdfTrace = '/project/.next/server/app/api/admin/print/pdf/[...slug]/route.js.nft.json'
assert.deepEqual(inspectRuntimeTrace(pdfTrace, ['public/photo.jpg', 'src/assets/fonts/font.ttf'].map(v => path.relative(path.dirname(pdfTrace), `${root}/${v}`)), root), [])
console.log('✓ runtime trace gate rejects operational artifacts and preserves PDF assets')
