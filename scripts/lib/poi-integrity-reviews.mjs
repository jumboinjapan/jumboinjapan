/** Evidence-bound retrospective audit decisions; never authority for an Intake write. */
import assert from 'node:assert/strict'
import reviews from '../../config/poi-integrity-reviews.v1.json' with { type: 'json' }

assert.equal(reviews.spec, 'poi-integrity-reviews/v1')
const stopFields = ['stopId', 'routeSlug', 'poiId', 'order', 'nameSnapshot', 'titleOverride', 'descriptionOverride']
const subjectFields = ['recordId', 'poiId', 'sourceKey', 'nameRu', 'nameEn', 'siteCity', 'coordinatePolicy']
const filled = value => typeof value === 'string' && value.trim().length > 0
for (const row of [...reviews.revisits, ...reviews.distinctPairs]) {
  assert(filled(row.id) && filled(row.reason) && /^\d{4}-\d{2}-\d{2}$/.test(row.checkedOn))
  assert.equal(new URL(row.evidenceUrl).protocol, 'https:')
}
for (const row of reviews.revisits) {
  assert.equal(row.stops.length, 2)
  for (const stop of row.stops) {
    assert(stopFields.filter(key => key !== 'order').every(key => filled(stop[key])))
    assert(Number.isInteger(stop.order) && stop.order > 0)
  }
  assert.equal(row.stops[0].routeSlug, row.stops[1].routeSlug)
  assert.equal(row.stops[0].poiId, row.stops[1].poiId)
  for (const key of ['stopId', 'order', 'descriptionOverride']) assert.notEqual(row.stops[0][key], row.stops[1][key])
}
for (const row of reviews.distinctPairs) {
  assert.equal(row.subjects.length, 2)
  for (const subject of row.subjects) {
    assert(subjectFields.every(key => filled(subject[key])))
    assert(Array.isArray(subject.parentPoi) && subject.parentPoi.length === 1 && filled(subject.parentPoi[0]))
  }
  for (const key of ['recordId', 'poiId', 'sourceKey']) assert.notEqual(row.subjects[0][key], row.subjects[1][key])
}
const matches = (actual, expected, fields) => fields.every(key => actual[key] === expected[key])

export function reviewedRevisit(stops) {
  return reviews.revisits.find(row => stops.length === row.stops.length && row.stops.every(expected =>
    stops.filter(stop => matches(stop, expected, stopFields)).length === 1)) ?? null
}

export function reviewedIntegrityDistinctPair(a, b, pois) {
  // An equal external identity outranks a historic review; duplicate keys also invalidate it.
  if (a.placeId && a.placeId === b.placeId) return null
  const matchSubject = (actual, expected) => matches(actual, expected, subjectFields)
    && Array.isArray(actual.parentPoi) && actual.parentPoi.length === expected.parentPoi.length
    && expected.parentPoi.every(id => actual.parentPoi.includes(id))
    && ['recordId', 'poiId', 'sourceKey'].every(key => pois.filter(p => p[key] === expected[key]).length === 1)
  return reviews.distinctPairs.find(row =>
    (matchSubject(a, row.subjects[0]) && matchSubject(b, row.subjects[1]))
    || (matchSubject(b, row.subjects[0]) && matchSubject(a, row.subjects[1]))) ?? null
}
