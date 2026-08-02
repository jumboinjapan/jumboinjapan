#!/usr/bin/env node
/**
 * Выжимка канона текста под конкретного агента.
 *
 * Зачем. Правила про заголовки бесполезны тому, кто пишет ответы FAQ, и
 * наоборот — а держать пять отдельных файлов нельзя: сквозных правил больше
 * половины, и копии разойдутся через месяц. Поэтому файл один
 * (docs/copy-canon-for-agents.md), уроки помечены ролью, а этот скрипт
 * печатает блок для вставки в промпт нужного агента.
 *
 *   npm run copy-canon -- --roles              какие роли есть
 *   npm run copy-canon -- --role faq           сквозные + правила FAQ
 *   npm run copy-canon -- --role заголовки     сквозные + правила заголовков
 *   npm run copy-canon -- --role faq --full    то же плюс разделы 1–4 целиком
 *
 * Разделы 1–4 (лимиты, типографика, каноны, формат сдачи) — общие для всех,
 * поэтому по умолчанию печатается только раздел уроков; --full добавляет их.
 */

import fs from 'node:fs'
import path from 'node:path'

const DOC = path.join(process.cwd(), 'docs/copy-canon-for-agents.md')
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? null : args[i + 1]
}

const text = fs.readFileSync(DOC, 'utf8')
const lessonsStart = text.indexOf('## 5. Уроки правок владельца')
if (lessonsStart === -1) {
  console.error('В каноне нет раздела «Уроки правок владельца» — проверьте docs/copy-canon-for-agents.md')
  process.exit(1)
}
const lessonsEnd = text.indexOf('\n---\n', lessonsStart)
const lessonsBlock = text.slice(lessonsStart, lessonsEnd === -1 ? undefined : lessonsEnd)

/** Урок = абзац, начинающийся с `[роль]`; следующая строка со стрелкой — пример. */
const lessons = []
const lines = lessonsBlock.split('\n')
for (let i = 0; i < lines.length; i += 1) {
  const m = lines[i].match(/^`\[([^\]]+)\]`\s*(.+)$/)
  if (!m) continue
  const example = lines[i + 1]?.trim().startsWith('→') ? lines[i + 1].trim() : null
  lessons.push({ role: m[1].toLowerCase(), rule: m[2].trim(), example })
}

if (lessons.length === 0) {
  console.error('Уроков с метками ролей не найдено. Метка ставится в начале строки: `[все]` Правило…')
  process.exit(1)
}

if (args.includes('--roles') || args.length === 0) {
  const counts = new Map()
  for (const l of lessons) counts.set(l.role, (counts.get(l.role) ?? 0) + 1)
  console.log('Роли и число уроков:\n')
  for (const [role, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${role.padEnd(14)} ${n}`)
  }
  console.log('\nВыжимка: npm run copy-canon -- --role <роль>')
  process.exit(0)
}

const role = (flag('role') ?? '').toLowerCase()
if (!role) {
  console.error('Укажите роль: --role faq | заголовки | кнопки | …  (список: --roles)')
  process.exit(1)
}

const known = new Set(lessons.map((l) => l.role))
if (!known.has(role) && role !== 'все') {
  console.error(`Роли «${role}» в каноне нет. Есть: ${[...known].join(', ')}`)
  process.exit(1)
}

const picked = lessons.filter((l) => l.role === 'все' || l.role === role)

if (args.includes('--full')) {
  const commonStart = text.indexOf('## 1. Длина')
  console.log(text.slice(commonStart, lessonsStart).trimEnd())
  console.log()
}

console.log(`## Уроки правок владельца — роль «${role}»\n`)
console.log('Сквозные правила действуют всегда, ролевые — для этого типа текста.\n')
for (const l of picked) {
  console.log(`- ${l.role === 'все' ? '' : `(${l.role}) `}${l.rule}`)
  if (l.example) console.log(`  ${l.example}`)
}
console.log(`\nВсего правил: ${picked.length} (сквозных ${picked.filter((l) => l.role === 'все').length}).`)
console.log('Источник: docs/copy-canon-for-agents.md — правится там, не в скилле.')
