/** Render the preview against the public route's resolved program, offline. */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { load as parseHtml } from 'cheerio'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const normal = (value) => value.replace(/\s+/g, ' ').trim()
const expectedIds = ['ginza', 'hamarikyu', 'tsukiji', 'meiji', 'harajuku', 'shibuya']

async function scenario({ overrides = [], failed = false, environment = 'preview' } = {}) {
  const cache = new Map()
  const reads = []
  const env = { VERCEL_ENV: environment }
  const DayPage = () => null
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    if (file.endsWith('.json')) return JSON.parse(readFileSync(path.join(root, file), 'utf8'))
    const output = { exports: {} }
    cache.set(file, output.exports)
    const compiled = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
      fileName: file,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    vm.runInNewContext(compiled, {
      exports: output.exports, module: output, process: { env },
      require(specifier) {
        if (specifier === '@/lib/airtable') return { getIntercityRouteStopsCached: async (slug) => {
          reads.push(slug)
          if (failed) throw Error('offline')
          return overrides
        } }
        if (specifier === '@/components/sections/CityTourDayPage') return { CityTourDayPage: DayPage }
        if (specifier === '@/components/sections/RouteFaq') return { RouteFaq: () => null }
        if (specifier === '@/components/sections/JournalMentions') return { JournalMentions: () => null }
        if (specifier === 'next/navigation') return { notFound() { throw Error('NOT_FOUND') } }
        if (specifier === 'next/image') return { default: ({ src, alt }) => createElement('img', { src, alt }) }
        if (specifier.endsWith('.module.css')) return { default: new Proxy({}, { get: (_, key) => key }) }
        if (specifier.startsWith('@/') || specifier.startsWith('./')) {
          const stem = specifier.startsWith('@/') ? `src/${specifier.slice(2)}` : path.join(path.dirname(file), specifier)
          const resolved = [stem, `${stem}.ts`, `${stem}.tsx`].find((candidate) => existsSync(path.join(root, candidate)))
          assert(resolved, specifier)
          return load(resolved)
        }
        assert(['react/jsx-runtime', 'lucide-react'].includes(specifier), `Unexpected dependency: ${specifier}`)
        return require(specifier)
      },
    }, { filename: file })
    return output.exports
  }
  const preview = load('src/app/preview/tokyo-day-one/page.tsx')
  if (environment === 'production') {
    await assert.rejects(preview.default, /NOT_FOUND/)
    assert.equal(reads.length, 0, 'production must not fetch preview data')
    return
  }
  const page = load('src/app/city-tour/day-one/page.tsx')
  const publicTree = await page.default()
  const publicProps = publicTree.props.children.find((child) => child?.type === DayPage).props
  const { typo } = load('src/lib/typography.ts')
  const $ = parseHtml(renderToStaticMarkup(await preview.default()))
  const rows = $('#itinerary > ol > li').toArray()
  assert.equal(rows.length, publicProps.stops.length, 'every public stop has its own block')
  assert.equal(rows.length, expectedIds.length)
  assert.deepEqual(Array.from(publicProps.stops, (stop) => stop.id).sort(), [...expectedIds].sort())
  rows.forEach((row, index) => {
    const stop = publicProps.stops[index]
    assert.equal($(row).attr('id'), `stop-${stop.id}`, 'order and independent anchor preserved')
    assert.equal($(row).find('h3').text(), typo(stop.title))
    assert.equal($(row).find('.chapterTime').text(), typo(stop.number))
    assert.equal($(row).find('.stopDuration').text(), typo(stop.duration))
    assert.deepEqual($(row).find('.stopDescription p').toArray().map((p) => normal($(p).text())),
      Array.from(stop.text.split('\n\n'), (p) => normal(p)), 'all paragraphs remain unabridged')
    assert.equal($(row).find('img').attr('src'), stop.photo)
    if (stop.photo) assert.equal($(row).find('img').attr('alt'), stop.alt ?? stop.title)
    assert.equal($(`nav[aria-label="Остановки маршрута"] a[href="#stop-${stop.id}"]`).length, 1)
  })
  assert.equal(normal($('#itinerary > .programIntro').text()), normal(publicProps.program.description))
  assert.equal($('#transport article').length, publicProps.logistics.options.length)
  assert.equal(preview.metadata.robots.index, false)
  assert.deepEqual(reads, ['city-tour/day-one', 'city-tour/day-one'])
  return { stops: publicProps.stops }
}

const baseline = await scenario()
await scenario({ overrides: baseline.stops.map((stop, index) => ({
  poiNameSnapshot: stop.title, titleOverride: `${stop.title} — редакция`,
  descriptionOverride: `Полный первый абзац для ${stop.id}.\n\nВторой абзац, который нельзя потерять: ${stop.id}.`,
  photoPath: `/test/${stop.id}.jpg`, photoAlt: `Фото ${stop.id}`,
  order: baseline.stops.length - index, status: 'Active',
})) })
await scenario({ failed: true })
await scenario({ environment: 'production' })
console.log('Tour preview: complete public program, overrides, ordering, photos, fallback and production guard passed')
