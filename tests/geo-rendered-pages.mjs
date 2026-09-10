#!/usr/bin/env node
/** Validate actual HTML: node tests/geo-rendered-pages.mjs http://127.0.0.1:3211 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { load } from 'cheerio'

const origin = process.argv[2]
assert(origin, 'Pass the URL of a running preview explicitly')
assert(['http:', 'https:'].includes(new URL(origin).protocol))
const catalogue = fs.readFileSync('src/data/tours.ts', 'utf8')
const paths = [...catalogue.matchAll(/slug: "([^"]+)"/g)].map(m => '/' + m[1])
paths.push(...['day-one', 'day-two', 'hidden-spots', 'takao', 'mitake'].map(s => '/city-tour/' + s))
const report = []

for (const path of paths) {
  const response = await fetch(new URL(path, origin))
  assert.equal(response.status, 200, path)
  const $ = load(await response.text())
  const nodes = $('script[type="application/ld+json"]').toArray().flatMap(element => {
    const value = JSON.parse($(element).html())
    return Array.isArray(value) ? value : [value]
  })
  const trips = nodes.filter(node => node['@type'] === 'TouristTrip')
  assert.equal(trips.length, 1, path)
  const trip = trips[0]
  assert.equal(trip['@id'], `https://jumboinjapan.com${path}#trip`)
  assert.equal(trip.url, `https://jumboinjapan.com${path}`)
  for (const key of ['duration', 'inLanguage', 'location']) {
    assert(!(key in trip), `${path}: unsupported TouristTrip property ${key}`)
  }
  assert.equal(trip.offers['@type'], 'Offer')
  assert.equal(trip.offers['@id'], `https://jumboinjapan.com${path}#offer`)
  assert.equal(trip.offers.url, 'https://jumboinjapan.com/contact')
  for (const key of ['price', 'priceCurrency', 'availability']) {
    assert(!(key in trip.offers), `${path}: invented ${key}`)
  }
  assert($('footer').text().includes(trip.offers.description), `${path}: invisible offer terms`)
  assert(trip.disambiguatingDescription, `${path}: missing duration text`)
  assert.equal($('html').attr('lang'), 'ru')
  report.push({ path, status: response.status, duration: trip.disambiguatingDescription, offer: trip.offers })
  console.log(`OK ${path}`)
}
fs.mkdirSync('tmp/geo-verification', { recursive: true })
fs.writeFileSync('tmp/geo-verification/rendered-smoke.json', JSON.stringify(report, null, 2))
console.log(`Rendered schema checks passed for ${report.length} tour pages.`)
