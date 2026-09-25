import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve } from './support/alias-loader.mjs'

// Import the real runtime graph; a pure helper must not pull in the CLI writer/journal.
registerHooks({
  resolve: (s, c, next) => c.parentURL?.includes('/node_modules/') ? next(s, c) : resolve(s, c, next),
  load(url, context, next) {
    assert(!/\/(write-journal|verified-write)\.mjs$/.test(url), `CLI write infrastructure entered runtime Intake: ${url}`)
    return next(url, context)
  },
})
const { intakePoi } = await import('../src/lib/poi-intake.ts')
const { fieldEquals } = await import('../src/lib/airtable-field-equality.mjs')
assert.equal(typeof intakePoi, 'function')
assert(fieldEquals('2026-09-25', '2026-09-25T00:00:00.000Z', 'Coords Checked At'))
assert(!fieldEquals('2026-02-31T00:00:00Z', '2026-02-31T00:00:00Z'))
assert(!fieldEquals('2026-09-25', '2026-09-25T01:00:00Z', 'Coords Checked At'))
assert(fieldEquals(['a', 'b'], ['b', 'a']))
assert(!fieldEquals(['a', 'b'], ['a', 'a']))
assert(fieldEquals(null, ''))
assert(!fieldEquals(false, ''))
console.log('✓ server Intake imports without CLI write journal; field comparison remains strict')
