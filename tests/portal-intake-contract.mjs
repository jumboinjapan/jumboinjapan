/** JA-0: сконструированные данные с формой ключей Japan Guide, не live-read. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildPortalIntakeBatch, readPortalIntakeBatch, PORTAL_INTAKE_SPEC, PORTAL_INTAKE_REFUSALS, PortalIntakeRefused,
} from '../scripts/poi-portals/lib/portal-intake-contract.mjs'
import { evaluatePortalCandidates, evaluatePortalIntakeBatch } from '../scripts/poi-portals/collect-pois.mjs'
import { canonicalJsonBytes } from '../scripts/lib/canonical-contract.mjs'
import { sha256Bytes } from '../scripts/lib/byte-digest.mjs'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/portal-intake/japan-guide-v1.json', import.meta.url), 'utf8'))
const copy = (value) => structuredClone(value)
const fresh = () => copy(fixture)
const expected = { portalId: fixture.portalId, input: fixture.input }
const portal = { id: 'japan-guide', licence: null, regionKeys: [] }
let passed = 0
const failures = []
function check(label, fn) {
  try { fn(); passed++ } catch (error) { failures.push(`${label}: ${error.message}`) }
}
function refused(label, fn, reason = 'portalIntakeInvalid', message) {
  check(label, () => assert.throws(fn, (error) => error instanceof PortalIntakeRefused
    && error.reason === reason && (!message || error.message.includes(message))))
}
const resign = (body) => ({ ...body, batchDigest: sha256Bytes(canonicalJsonBytes(body, PORTAL_INTAKE_SPEC)) })
const batch = buildPortalIntakeBatch(fixture)

check('строитель → публичный читатель', () => assert.deepEqual(readPortalIntakeBatch(batch, expected), batch))
check('контроль точного потока канонических байтов', () => assert.equal(batch.batchDigest, sha256Bytes(canonicalJsonBytes(fixture, PORTAL_INTAKE_SPEC))))
check('исходный объект не заморожен строителем', () => assert.equal(Object.isFrozen(fixture.records[0]), false))
check('глубокая заморозка построенного пакета', () => assert.throws(() => { batch.records[0].hints[0].value = 'changed' }, TypeError))
check('экспорт причин неизменяем', () => assert.throws(() => PORTAL_INTAKE_REFUSALS.push('verified'), TypeError))
check('читатель владеет копией', () => {
  const raw = copy(batch)
  const read = readPortalIntakeBatch(raw, expected)
  raw.records[0].observed.nameJa = 'changed'
  assert.equal(read.records[0].observed.nameJa, fixture.records[0].observed.nameJa)
  assert.throws(() => { read.input.records.pop() }, TypeError)
})

// Не самоподписанное значение, а независимый состав проверенного источника.
for (const [label, mutate] of [
  ['чужой портал', (x) => { x.portalId = 'other' }],
  ['другие байты источника', (x) => { x.input.digest = `sha256:${'1'.repeat(64)}` }],
  ['другой формат источника', (x) => { x.input.spec = 'different/v1' }],
  ['потеря входной записи', (x) => { x.input.records.pop() }],
  ['подмена адреса входной записи', (x) => { x.input.records[0].sourceUrl += '?changed' }],
  ['подмена ключа входной записи', (x) => { x.input.records[0].sourceKey += '-changed' }],
]) {
  const context = copy(expected); mutate(context)
  refused(label, () => readPortalIntakeBatch(batch, context), 'portalIntakeInputMismatch')
}
refused('пересчёт собственного digest не разрешает другой снимок', () => {
  const body = fresh(); body.input.digest = `sha256:${'2'.repeat(64)}`
  return readPortalIntakeBatch(buildPortalIntakeBatch(body), expected)
}, 'portalIntakeInputMismatch')

const invalidBodies = [
  ['лишнее поле пакета', (x) => { x.approved = true }],
  ['чужой ключ записи', (x) => { x.records[0].sourceKey = 'other:123' }],
  ['пустой ключ записи', (x) => { x.records[0].sourceKey = 'japan-guide:' }],
  ['URL с учётными данными', (x) => { x.records[0].sourceUrl = 'https://user:pass@example.org/a' }],
  ['не HTTP URL', (x) => { x.records[0].sourceUrl = 'file:///etc/passwd' }],
  ['подмена provenance', (x) => { x.records[0].sourceUrl += '?changed' }],
  ['повтор ключа результата', (x) => { x.records.push(copy(x.records[0])) }],
  ['повтор ключа входа', (x) => { x.input.records.push(copy(x.input.records[0])) }],
  ['потерян отказ', (x) => { x.records.pop() }],
  ['кандидат без имени', (x) => { x.records[0].observed.nameJa = null; x.records[0].observed.nameEn = null }],
  ['пробельное имя', (x) => { x.records[0].observed.nameJa = '  ' }],
  ['половина пары', (x) => { x.records[0].observed.lat = 35 }],
  ['координаты вне диапазона', (x) => { x.records[0].observed.lat = 91; x.records[0].observed.lon = 139 }],
  ['строка вместо координаты', (x) => { x.records[0].observed.lat = '35'; x.records[0].observed.lon = 139 }],
  ['самостоятельное решение о дубле', (x) => { x.records[0].kind = 'existing' }],
  ['таксономия в данных адаптера', (x) => { x.records[0].observed.poiType = 'museum' }],
  ['внедрённое owner decision', (x) => { x.records[0].coordinateDecision = { kind: 'notApplicable' } }],
  ['внедрённый Place ID', (x) => { x.records[0].observed.placeId = 'claimed' }],
  ['повышенная уверенность hint', (x) => { x.records[0].hints[0].confidence = 'verified' }],
  ['проверенный момент hint', (x) => { x.records[0].hints[0].verifiedAt = '2026-09-06T00:00:00.000Z' }],
  ['неизвестный исход', (x) => { x.records[1].kind = 'ready' }],
  ['причина маршрутизации не принадлежит адаптеру', (x) => { x.records[1].reason = 'routedElsewhere' }],
  ['пустая причина отказа', (x) => { x.records[1].detail = '' }],
  ['пропущенное поле', (x) => { delete x.records[0].observed.cityJa }],
]
for (const [label, mutate] of invalidBodies) {
  const body = fresh(); mutate(body)
  refused(`строитель: ${label}`, () => buildPortalIntakeBatch(body))
  refused(`читатель после пересчёта: ${label}`, () => readPortalIntakeBatch(resign(body), expected))
}

let getterCalls = 0
for (const [label, mutate] of [
  ['скрытое поле', (x) => Object.defineProperty(x.records[0], 'hidden', { value: true })],
  ['symbol-ключ', (x) => { x.records[0][Symbol('hidden')] = true }],
  ['аксессор', (x) => Object.defineProperty(x.records[0].observed, 'nameJa', { enumerable: true, get() { getterCalls++; return 'unsafe' } })],
  ['разреженный массив', (x) => { delete x.records[0] }],
  ['собственное свойство массива', (x) => { x.records.extra = true }],
  ['undefined', (x) => { x.records[0].observed.address = undefined }],
  ['непарный суррогат', (x) => { x.records[0].observed.nameJa = '\ud800' }],
  ['NaN', (x) => { x.records[0].observed.lat = NaN }],
  ['минус ноль', (x) => { x.records[0].observed.lat = -0 }],
  ['цикл', (x) => { x.records[0].hints = x }],
  ['наследуемое поле', (x) => { Object.setPrototypeOf(x.records[0], { approved: true }) }],
]) {
  const raw = copy(batch); mutate(raw)
  refused(`сырой пакет: ${label}`, () => readPortalIntakeBatch(raw, expected))
}
check('аксессор не вызван при проверке', () => assert.equal(getterCalls, 0))
for (const raw of [null, undefined, 0, Symbol('x'), {}, { spec: 'poi-portal-intake/v0' }, Object.create({ spec: PORTAL_INTAKE_SPEC })]) {
  refused('версия прежде состава полей', () => readPortalIntakeBatch(raw, expected), 'portalIntakeVersion')
}
const accessor = Object.defineProperty({}, 'spec', { get() { getterCalls++; return PORTAL_INTAKE_SPEC } })
refused('версия — не getter', () => readPortalIntakeBatch(accessor, expected), 'portalIntakeVersion')
const revoked = Proxy.revocable({}, {}); revoked.revoke()
refused('отозванный Proxy не покидает границу сырым', () => readPortalIntakeBatch(revoked.proxy, expected), 'portalIntakeVersion')
check('getter версии не вызван', () => assert.equal(getterCalls, 0))
refused('устаревший checksum', () => {
  const raw = copy(batch); raw.records[0].observed.nameJa = 'changed'
  return readPortalIntakeBatch(raw, expected)
}, 'portalIntakeInvalid', 'batchDigest')

// Production-композиция с настоящей оценкой, без транспорта и хранилища.
const originalFetch = globalThis.fetch
let fetches = 0
globalThis.fetch = () => { fetches++; throw new Error('сеть запрещена в JA-0') }
try {
  const result = evaluatePortalIntakeBatch(portal, batch, fixture.input)
  check('production: точный закон сохранения', () => assert.deepEqual(result.counts, { input: 2, candidates: 1, refused: 1 }))
  check('production: отказ остаётся полной очередью', () => assert.deepEqual(result.refusedQueue, [fixture.records[1]]))
  check('production: используется общий scorer', () => assert.deepEqual(result.evaluated, evaluatePortalCandidates(portal, result.candidates)))
  check('production: ключ источника сохранён', () => assert.equal(result.evaluated[0].candidate.sourceKey, fixture.records[0].sourceKey))
  check('production: подсказка не заполнила адрес', () => assert.equal(result.evaluated[0].candidate.address, null))
  check('production: hints не переданы в scorer', () => assert.equal(Object.hasOwn(result.evaluated[0].candidate, 'hints'), false))
  check('production: подсказка сохранена в доказательстве', () => assert.deepEqual(result.batch.records[0].hints, fixture.records[0].hints))
  check('production: описание источника не скопировано', () => assert.equal(result.evaluated[0].candidate.descriptionJa, ''))
  let scoringStarts = 0
  const watchedPortal = { ...portal, get regionKeys() { scoringStarts++; return [] } }
  const lateBad = fresh(); lateBad.records[1].reason = 'fake'
  refused('production: плохая последняя строка отказывает всему пакету', () => evaluatePortalIntakeBatch(watchedPortal, resign(lateBad), fixture.input))
  const foreignInput = fresh(); foreignInput.input.digest = `sha256:${'3'.repeat(64)}`
  refused('production: источник задаёт вызывающий, а не адаптер', () => evaluatePortalIntakeBatch(watchedPortal, buildPortalIntakeBatch(foreignInput), fixture.input), 'portalIntakeInputMismatch')
  check('production: ни одной оценки до проверки последней строки', () => assert.equal(scoringStarts, 0))
  const allRefused = fresh()
  allRefused.records[0] = { ...allRefused.records[1], sourceKey: fixture.records[0].sourceKey, sourceUrl: fixture.records[0].sourceUrl }
  const zero = evaluatePortalIntakeBatch(portal, buildPortalIntakeBatch(allRefused), fixture.input)
  check('production: все отказы сохраняются при нуле кандидатов', () => assert.equal(zero.refusedQueue.length, 2))
  check('production: при всех отказах evaluated пуст', () => assert.deepEqual(zero.evaluated, []))
  check('production: при всех отказах пакет сохранён', () => assert.equal(zero.batch.batchDigest, buildPortalIntakeBatch(allRefused).batchDigest))
  const empty = fresh(); empty.input.records = []; empty.records = []
  check('production: действительно пустой источник', () => assert.deepEqual(evaluatePortalIntakeBatch(portal, buildPortalIntakeBatch(empty), empty.input).counts, { input: 0, candidates: 0, refused: 0 }))
  const reversed = fresh(); reversed.records.reverse(); reversed.input.records.reverse()
  check('production: перестановка не переносит ключ на другой объект', () => assert.deepEqual(evaluatePortalIntakeBatch(portal, buildPortalIntakeBatch(reversed), fixture.input).candidates, result.candidates))
  const english = fresh(); english.records[0].observed.nameJa = null
  const englishResult = evaluatePortalIntakeBatch(portal, buildPortalIntakeBatch(english), fixture.input)
  check('production: английское имя представимо без выдуманного японского', () => assert.equal(englishResult.candidates[0].nameJa, ''))
  check('production: scorer не ослаблен ради English-only', () => assert.deepEqual(englishResult.evaluated, evaluatePortalCandidates(portal, englishResult.candidates)))
  check('production: HTTP, Google и Airtable не вызваны', () => assert.equal(fetches, 0))
} finally { globalThis.fetch = originalFetch }

if (failures.length) {
  console.error(`Portal Intake: провалено ${failures.length} из ${passed + failures.length}`)
  for (const failure of failures) console.error(`✗ ${failure}`)
  process.exitCode = 1
} else console.log(`Portal Intake: ${passed} проверок пройдено`)
