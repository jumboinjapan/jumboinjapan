import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
const testUrl = new URL('./poi-airtable-match.mjs', import.meta.url).href
const program = `
  import http from 'node:http';
  import https from 'node:https';
  import net from 'node:net';
  import { syncBuiltinESMExports } from 'node:module';
  const denied = () => { throw new Error('offline fixture attempted network access') };
  globalThis.fetch = denied;
  http.request = http.get = https.request = https.get = net.connect = net.createConnection = denied;
  syncBuiltinESMExports();
  await import(${JSON.stringify(testUrl)});
`
for (const value of [undefined, '', 'appUnrelatedTestBase']) {
  const env = { ...process.env }
  for (const key of ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'GOOGLE_PLACES_API_KEY']) delete env[key]
  if (value !== undefined) env.AIRTABLE_BASE_ID = value
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], { env, encoding: 'utf8', timeout: 30000 })
  assert.equal(result.status, 0, `offline fixture must ignore caller base ${JSON.stringify(value)}: ${result.stderr}`)
  assert.match(result.stdout, /проверок пройдено/, 'the complete identity fixture suite executed')
}
console.log('Offline identity fixtures pass with unset, empty and unrelated base IDs; network disabled')
