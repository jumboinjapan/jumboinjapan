import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

function violations(source) {
  const ast = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const errors = []
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'dangerouslySetInnerHTML' &&
        node.initializer && /\bJSON\s*\.\s*stringify\s*\(/.test(node.initializer.getText(ast))) {
      errors.push(ast.getLineAndCharacterOfPosition(node.pos).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return errors
}
assert.equal(violations('<script dangerouslySetInnerHTML={{__html: JSON.stringify({text: "x"})}} />').length, 1)
assert.equal(violations('<script dangerouslySetInnerHTML={{__html: serializeTourSchema(value)}} />').length, 0)
const root = new URL('../src/', import.meta.url)
function scan(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name)
    if (item.isDirectory()) scan(file)
    else if (/\.[jt]sx?$/.test(file)) assert.deepEqual(violations(readFileSync(file, 'utf8')), [], file)
  }
}
scan(root.pathname)
const source = readFileSync(new URL('../src/lib/tour-schema.ts', import.meta.url), 'utf8')
const exports = {}
vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, {
  exports, require: () => ({}),
})
const value = { text: '</script><script>alert(1)</script>', nested: ['<', '&', '\u2028'] }
const serialized = exports.serializeTourSchema(value)
assert.equal(serialized.includes('<'), false)
assert.deepEqual(JSON.parse(serialized), value)
console.log('JSON-LD: serializer round trip and all source sinks checked')
