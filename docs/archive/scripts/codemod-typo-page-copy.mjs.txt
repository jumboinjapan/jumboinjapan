#!/usr/bin/env node
/**
 * Разовый codemod: оборачивает копирайт-константы страниц в typoDeep.
 *
 * Третий и последний канал текста (после props компонентов и JSX-разметки):
 * данные, объявленные прямо в page.tsx и отрисованные тут же — карточки,
 * списки, блоки FAQ. Через props они не проходят, в разметке их нет.
 *
 * Не трогаем: metadata (её никто не читает глазами, а трогать SEO-строки
 * без нужды не стоит), константы без кириллицы, уже обёрнутые.
 *
 *   node scripts/codemod-typo-page-copy.mjs           # показать план
 *   node scripts/codemod-typo-page-copy.mjs --write   # применить
 */
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const WRITE = process.argv.includes('--write')
const CYR = /[А-Яа-яЁё]/
const SKIP_NAMES = new Set(['metadata', 'viewport', 'revalidate', 'dynamic'])

const files = []
;(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!/node_modules|\.next|\.well-known|\/admin$|\/api$/.test(p)) walk(p)
      continue
    }
    if (/\.tsx?$/.test(entry.name)) files.push(p)
  }
})('src/app')
;(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) { walk(p); continue }
    if (entry.name.endsWith('.ts')) files.push(p)
  }
})('src/data')

let totalConsts = 0
let totalFiles = 0

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  if (!CYR.test(src)) continue
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits = []
  const names = []

  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || SKIP_NAMES.has(decl.name.text)) continue
      let init = decl.initializer
      if (!init) continue
      // `[...] as const` и `{...} satisfies T` — разворачиваем до литерала,
      // обёртку ставим снаружи всего выражения
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression
      if (!ts.isArrayLiteralExpression(init) && !ts.isObjectLiteralExpression(init)) continue
      const text = decl.initializer.getText(sf)
      if (!CYR.test(text) || text.startsWith('typoDeep(')) continue
      edits.push({ start: decl.initializer.getStart(sf), end: decl.initializer.getEnd(), text: `typoDeep(${text})` })
      names.push(decl.name.text)
    }
  }
  // Массивы-литералы прямо в разметке: {[ … ].map(…)} — на страницах так
  // набраны блоки «Похожие туры» и полоски цифр.
  const visit = node => {
    if (
      ts.isArrayLiteralExpression(node) &&
      node.parent && ts.isPropertyAccessExpression(node.parent) &&
      node.parent.name.text === 'map' &&
      CYR.test(node.getText(sf))
    ) {
      edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `typoDeep(${node.getText(sf)})` })
      names.push('inline-массив')
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (!edits.length) continue

  const lastImport = sf.statements.filter(ts.isImportDeclaration).at(-1)
  const pos = lastImport ? lastImport.getEnd() : 0
  if (!/from ['"]@\/lib\/typography['"]/.test(src)) {
    edits.push({
      start: pos,
      end: pos,
      // в файле без импортов вставка идёт в самое начало — нужен перевод строки после
      text: pos === 0 ? `import { typoDeep } from '@/lib/typography'\n\n` : `\nimport { typoDeep } from '@/lib/typography'`,
    })
  }

  edits.sort((a, b) => b.start - a.start)
  let out = src
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)

  totalFiles++
  totalConsts += names.length
  console.log(`${file}: ${names.join(', ')}`)
  if (WRITE) fs.writeFileSync(file, out)
}
console.log(`\n${WRITE ? 'Обёрнуто' : 'Будет обёрнуто'} констант: ${totalConsts} в ${totalFiles} файлах`)
