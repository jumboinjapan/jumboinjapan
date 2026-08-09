#!/usr/bin/env node
/**
 * Сторож токенов админки.
 *
 * Ловит два класса ошибок, из-за которых 7 августа на экране POI подписи
 * двух кнопок в дневной теме перестали существовать (контраст 1,16:1 и 1,01:1):
 *
 *   1. Палитра Tailwind вместо токенов --adm-*. Такие цвета подбираются
 *      на глаз в той теме, которая открыта, и живут только в ней.
 *   2. --adm-on-accent на --adm-accent-bg. on-accent рассчитан на СПЛОШНУЮ
 *      заливку --adm-accent; на десятипроцентном тинте он почти сливается
 *      с фоном. Для тинта существует --adm-accent-text.
 *
 * Запуск: node scripts/check-admin-tokens.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOTS = ['src/components/admin', 'src/app/admin']

/** Нейтральные шкалы для рамок и теней допустимы — они не несут текста. */
const PALETTE = /\b(?:text|bg|border|ring|from|to|via)-(rose|red|amber|emerald|green|sky|blue|violet|orange|yellow|teal|indigo|pink|fuchsia|lime|cyan)-\d{2,3}(?:\/\d+)?\b/g
const ON_ACCENT_ON_TINT = /bg-\[var\(--adm-accent-bg\)\][^"'`]*text-\[var\(--adm-on-accent\)\]|text-\[var\(--adm-on-accent\)\][^"'`]*bg-\[var\(--adm-accent-bg\)\]/g

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const problems = []

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue
  for (const file of walk(root)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (line.includes('check-admin-tokens')) return
      for (const match of line.matchAll(PALETTE)) {
        problems.push({ file, line: index + 1, kind: 'палитра Tailwind вместо токена', what: match[0] })
      }
      for (const match of line.matchAll(ON_ACCENT_ON_TINT)) {
        problems.push({ file, line: index + 1, kind: 'on-accent на тинте — нужен accent-text', what: match[0].slice(0, 60) })
      }
    })
  }
}

if (!problems.length) {
  console.log('✓ токены админки: нарушений нет')
  process.exit(0)
}

console.log(`✗ нарушений: ${problems.length}\n`)
for (const p of problems) {
  console.log(`  ${p.file}:${p.line}`)
  console.log(`    ${p.kind} — ${p.what}`)
}
console.log('\nЦвет в админке берётся только из --adm-*: иначе он верен в одной теме и сломан в другой.')
process.exit(1)
