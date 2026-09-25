import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const requests = []
let records = []
const dependencies = {
  '@/lib/airtable-retry': { fetchAirtableWithRetry: async (url) => { requests.push(new URL(url)); return { ok: true, json: async () => ({ records }) } } },
  '@/lib/schema': { BASE_URL: 'https://example.test' },
}
function load(file) {
  const source = readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), 'utf8')
  const exports = {}
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {
    exports, URL, process: {env: {AIRTABLE_TOKEN: 'test', AIRTABLE_BASE_ID: 'test'}},
    require: (name) => dependencies[name] ?? {},
  })
  return exports
}
const share = load('program-share')
for (const token of [null, undefined, 42, '', 'a'.repeat(31), 'a'.repeat(33), 'a'.repeat(31) + "'", 'a'.repeat(31) + '\\', ' ' + 'a'.repeat(32), 'a'.repeat(32) + '\n']) {
  assert.equal(await share.resolveSharedProgram(token), null)
}
assert.equal(requests.length, 0, 'invalid tokens must not call Airtable')
records = [{fields: {Slug: 'route', 'Public Label': 'Test'}}]
assert.equal((await share.resolveSharedProgram('A0_-'.repeat(8))).slug, 'route')
assert.equal(requests.length, 1)
records = []
const slug = "route\\'name"
const expected = "{Slug}='route\\\\\\'name'"
await share.getShareState(slug)
assert.equal(requests.at(-1).searchParams.get('filterByFormula'), expected)
const print = load('print-program')
await print.getRouteMeta(slug)
assert.equal(requests.at(-1).searchParams.get('filterByFormula'), expected)
console.log('Share security: invalid tokens perform no I/O; valid token and both formula consumers passed')
