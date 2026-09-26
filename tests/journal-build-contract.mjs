import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, dependencies, globals = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  vm.runInNewContext(compiled, { exports, Date, ...globals, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`)
    return dependencies[name]
  } })
  return exports
}
let articles = []
const journal = { getPublishedJournalArticles: async () => articles }
const page = load('src/app/journal/page.tsx', {
  'react/jsx-runtime': {}, 'next/link': {}, '@/lib/journal': journal,
  '@/lib/typography': { typoDeep: v => v }, '@/components/sections/UnderConstruction': {},
})
const sitemap = load('src/app/sitemap.ts', {
  '@/data/tours': { staticPages: [{ url: '/', priority: 1, changeFrequency: 'weekly' }] },
  '@/lib/route-registry': { listRouteRegistry: async () => [] },
  '@/lib/route-publication': { isIndexableRoute: () => true, isRouteSlug: () => false },
  '@/lib/journal': journal,
})
assert.equal(typeof page.generateMetadata, 'function', 'journal indexing depends on published articles')
assert.equal((await page.generateMetadata()).robots.index, false, 'empty journal is noindex')
assert.ok(!(await sitemap.default()).some(r => r.url.includes('/journal')), 'empty journal is absent from sitemap')
articles = [{ slug: 'test-story', title: 'Story', publishedDate: '2026-09-27' }]
assert.equal((await page.generateMetadata()).robots.index, true, 'first published article enables indexing')
assert.deepEqual(Array.from(await sitemap.default(), r => r.url), ['https://jumboinjapan.com/', 'https://jumboinjapan.com/journal', 'https://jumboinjapan.com/journal/test-story'])
articles = []
assert.equal((await page.generateMetadata()).robots.index, false, 'unpublishing the last article disables indexing again')
assert.ok(!(await sitemap.default()).some(r => r.url.includes('/journal')))
let requests = 0
const registry = load('src/lib/route-registry-store.ts', {
  './airtable-retry.ts': { fetchAirtableWithRetry: async () => { requests++; throw Error('unexpected request') } },
  './airtable-schema.ts': {}, './route-publication.ts': {},
}, { process: { env: {} } })
await assert.rejects(registry.readRouteRegistry(), /Route registry requires Airtable credentials/)
assert.equal(requests, 0, 'missing credentials fail closed before network, never produce an empty published registry')
console.log('Journal indexing and credential-required route build contract passed')
