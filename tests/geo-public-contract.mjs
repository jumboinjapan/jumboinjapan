#!/usr/bin/env node
/** Standalone GEO regression check: deliberately no changes to the POI test chain. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const modules = new Map()
const allowed = new Set([
  'src/lib/tour-schema.ts', 'src/lib/schema.ts', 'src/lib/typography.ts',
  'src/data/service-terms.ts', 'src/data/tours.ts', 'src/app/llms.txt/route.ts',
])
function load(file) {
  assert(allowed.has(file), `GEO public metadata must not read database/private modules: ${file}`)
  if (modules.has(file)) return modules.get(file)
  const testModule = { exports: {} }
  modules.set(file, testModule.exports)
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText
  const sandbox = {
    module: testModule, exports: testModule.exports, Response,
    require(specifier) {
      assert(specifier.startsWith('@/'), `Unexpected dependency: ${specifier}`)
      return load(`src/${specifier.slice(2)}.ts`)
    },
  }
  vm.runInNewContext(source, sandbox, { filename: file })
  return testModule.exports
}

const { buildTourOffer, describeTourDuration, serializeTourSchema } = load('src/lib/tour-schema.ts')
const { serviceTerms } = load('src/data/service-terms.ts')
const { tours } = load('src/data/tours.ts')
const pageUrl = 'https://jumboinjapan.com/intercity/nikko'
const offer = buildTourOffer(pageUrl)
assert.equal(offer['@id'], `${pageUrl}#offer`)
assert.equal(offer.url, 'https://jumboinjapan.com/contact')
assert.equal(offer.seller['@id'], 'https://jumboinjapan.com/#guide')
assert(offer.description.includes(serviceTerms.pricing))
assert.equal(offer.description, serviceTerms.pricing)
for (const key of ['price', 'priceCurrency', 'availability', 'validFrom', 'priceValidUntil']) {
  assert(!(key in offer), `Inquiry must not invent ${key}`)
}
assert.equal(describeTourDuration('6–8 часов'), 'Продолжительность: 6–8 часов.')
assert.equal(describeTourDuration('Гибкий формат'), 'Продолжительность: Гибкий формат.')

// A route title or stop description cannot break out of JSON-LD into executable HTML.
const malicious = { name: '</script><script>alert(1)</script>', description: 'Япония 日本 & «Токио»' }
const serialized = serializeTourSchema(malicious)
assert(!serialized.includes('<'))
assert.deepEqual(JSON.parse(serialized), malicious)

const { GET } = load('src/app/llms.txt/route.ts')
const response = await GET()
assert.equal(response.status, 200)
assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8')
const content = await response.text()
assert(content.startsWith('# JumboInJapan'))
assert(content.includes(serviceTerms.pricing))
assert(content.includes(serviceTerms.inquiry))
assert(content.includes(serviceTerms.language))
assert(!/English available|InStock|premium private tours/.test(content))
assert(!/https:\/\/jumboinjapan\.com\/(?:admin|api|profile|p)(?:[\/\s)]|$)/.test(content))
for (const line of content.split('\n').filter(line => line.startsWith('- '))) {
  assert.match(line, /^- \[[^\]]+\]\(https:\/\/[^)]+\): /, `Expected a named Markdown link: ${line}`)
}
for (const tour of tours) {
  assert(content.includes(`(${`https://jumboinjapan.com/${tour.slug}`})`))
  assert(content.includes(`${tour.duration}. Регион: ${tour.region}.`))
}
const publicLinks = [...content.matchAll(/\]\((https:\/\/jumboinjapan\.com[^)]*)\)/g)].map(m => m[1])
for (const url of publicLinks) {
  const pathname = new URL(url).pathname
  const target = pathname === '/sitemap.xml' ? 'src/app/sitemap.ts' : `src/app${pathname === '/' ? '' : pathname}/page.tsx`
  assert(fs.existsSync(path.join(root, target)), `Missing public link target: ${url}`)
}
const contact = fs.readFileSync('src/app/contact/page.tsx', 'utf8')
assert(contact.includes('{serviceTerms.pricing} {serviceTerms.inquiry}'))
const footer = fs.readFileSync('src/components/layout/Footer.tsx', 'utf8')
assert(footer.includes('{serviceTerms.pricing}'), 'Offer terms must also be visible on route pages')
console.log(`GEO public contract passed: inquiry semantics, script safety, shared copy, ${publicLinks.length} public links, no database imports.`)
