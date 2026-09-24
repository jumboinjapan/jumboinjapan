import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as jsx from 'react/jsx-runtime'
import { load } from 'cheerio'
import { typo } from '../src/lib/typography.ts'
import { excerptSentences } from '../src/lib/text-excerpt.ts'

const output = ts.transpileModule(fs.readFileSync('src/components/sections/TourAlbum.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const exports = {}
const dependencies = {
  'react/jsx-runtime': jsx,
  'next/image': { default: () => null },
  'next/link': { default: ({ children, href }) => React.createElement('a', { href }, children) },
  'next/font/google': { Cormorant_Garamond: () => ({ variable: 'album-font' }) },
  'lucide-react': { ArrowRight: () => null },
  '@/lib/typography': { typo },
  '@/lib/text-excerpt': { excerptSentences },
  './TourAlbum.module.css': { default: new Proxy({}, { get: (_, key) => String(key) }) },
}
vm.runInNewContext(output, { exports, require: id => {
  assert(id in dependencies, `Unexpected dependency: ${id}`)
  return dependencies[id]
}})
const render = props => load(renderToStaticMarkup(React.createElement(exports.TourAlbumCover, {
  title: 'Тестовый маршрут', image: '', section: 'intercity',
  stops: [{ title: 'Парк', href: '#park' }], ...props,
})))
const subtitle = 'Краткое знакомство с городом. Посещение музея возможно только после предварительной записи, а закрытые залы заменяются прогулкой по саду.'
let $ = render({ subtitle, intro: 'Авторское описание программы.' })
assert($('header').text().includes(typo(excerptSentences(subtitle, 2).slice(excerptSentences(subtitle).length).trim())), 'long editorial details must survive with stops')
assert($('.coverDescription').text().includes('Авторское описание программы.'))
assert.deepEqual($('nav a').map((_, e) => $(e).attr('href')).get(), ['/', '/intercity'])

const listSubtitle = 'Прогулка по городу. Парк, святилище, исторический музей, смотровая площадка, старая торговая улица и набережная реки.'
$ = render({ subtitle: listSubtitle, subtitleDetailIsStopList: true, summary: 'Комментарий гида.', intro: 'Подробное описание.' })
assert.equal($('.coverLead').length, 0, 'explicit repeated list is removed')
assert($('.coverDescription').text().includes('Комментарий гида.'))
assert($('.coverDescription').text().includes('Подробное описание.'))
assert.equal($('.coverStops li').text(), 'Парк')
$ = render({ subtitle: listSubtitle, subtitleDetailIsStopList: true, stops: [] })
assert($('.coverLead').text().includes('исторический музей'), 'do not remove a list without replacement stops')
$ = render({ subtitle, collection: true, intro: 'Описание каталога.' })
assert.equal($('.coverStops').length, 0)
assert.equal($('nav a').length, 1)
assert($('header').text().includes(typo(subtitle)), 'collection subtitle is not shortened')
console.log('Tour album cover: editorial details, explicit stop lists, empty stops, breadcrumbs and collections passed.')
