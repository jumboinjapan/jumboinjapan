import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, dependencies) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  vm.runInNewContext(compiled, { exports, Date, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`)
    return dependencies[name]
  } })
  return exports
}

for (const slug of ['day-one', 'day-two', 'hidden-spots']) {
  let seo = null
  const calls = []
  const page = load(`src/app/city-tour/${slug}/page.tsx`, {
    'react/jsx-runtime': {},
    '@/lib/route-content': {}, '@/lib/city-tour-live-stops': {},
    '@/lib/multi-day-builder-storage': { getMultiDayRouteSeoFieldsCached: async value => { calls.push(value); return seo } },
    '@/lib/tour-schema': { buildTourOffer: () => ({}), describeTourDuration: value => value },
    '@/components/sections/CityTourDayPage': {}, '@/lib/schema': {guideRef: {}},
    '@/components/sections/RouteFaq': {}, '@/components/sections/JournalMentions': {},
    '@/lib/typography': { typoDeep: value => value },
    '@/lib/page-metadata': { buildPageMetadata: (path, value) => ({...value, alternates: {canonical: 'https://jumboinjapan.com'+path}}) },
  })
  assert.equal(typeof page.generateMetadata, 'function', `${slug}: metadata must read the editorial source`)
  assert.equal(page.metadata, undefined, `${slug}: no competing static metadata export`)
  const fallback = await page.generateMetadata()
  assert.ok(fallback.title && fallback.description)
  seo = {seoTitle: 'Approved title', seoDescription: 'Approved description', heroImagePath: '/approved-cover.webp'}
  const approved = await page.generateMetadata()
  assert.equal(approved.title, seo.seoTitle)
  assert.equal(approved.description, seo.seoDescription)
  assert.ok(approved.openGraph.title.includes(seo.seoTitle))
  assert.equal(approved.openGraph.description, seo.seoDescription)
  assert.equal(approved.openGraph.images[0].url, seo.heroImagePath)
  assert.equal(approved.alternates.canonical, `https://jumboinjapan.com/city-tour/${slug}`)
  seo = {seoTitle: '', seoDescription: '', heroImagePath: ''}
  assert.deepEqual(await page.generateMetadata(), fallback, `${slug}: empty approved fields preserve fallback`)
  assert.deepEqual(calls, Array(3).fill(`city-tour/${slug}`))
}

let resources = []
const events = load('src/lib/events.ts', {
  '@/lib/resources': {
    eventCategories: [], getCachedEventResources: async () => resources,
    isEventLikeResource: r => Boolean(r.event),
    toEventItem: r => ({ title:r.title, lifecycle:r.event.lifecycle, dateStart:'2026-09-01',dateEnd:'2026-09-30',tags:[] }),
  },
})
const item = (title, lifecycle, status='active') => ({title,status,event:{lifecycle,endsAt:'2026-09-30T12:00:00+09:00'}})
assert.equal((await events.getAllEvents()).length, 0)
resources = [item('Past','ended')]
assert.equal((await events.getAllEvents()).length, 0, 'an all-ended catalogue must stay empty')
assert.equal((await events.getEventLifecycleCounts()).endedNotArchived, 1, 'admin retains archive backlog')
resources = [item('Past','ended'), item('Current','live'), item('Next','upcoming'),item('Archived','live','archived')]
assert.deepEqual(Array.from(await events.getAllEvents(), e=>e.title), ['Current','Next'])
console.log('city metadata and event catalogue regression checks passed')
