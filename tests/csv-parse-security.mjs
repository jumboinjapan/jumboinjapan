import assert from 'node:assert/strict'
import { parse } from 'csv-parse/sync'

const [row] = parse('__proto__,__proto__,name\na,b,safe', {
  columns: true,
  group_columns_by_name: true,
})
assert.equal(Object.getPrototypeOf(row), Object.prototype, 'duplicate __proto__ header must not replace the record prototype')
assert.equal(Object.hasOwn(row, '__proto__'), true, 'hostile header remains an ordinary own property')
assert.deepEqual(row.__proto__, ['a', 'b'])
assert.equal(row.name, 'safe')
assert.deepEqual(parse('name,name\na,b', { columns: true, group_columns_by_name: true }), [{ name: ['a', 'b'] }])
assert.equal(Object.prototype.name, undefined, 'global prototype remains unchanged')
console.log('csv-parse prototype-replacement regression passed')
