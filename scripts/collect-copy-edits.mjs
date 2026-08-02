#!/usr/bin/env node
/**
 * Сборщик правок владельца: вытаскивает из истории git пары «было → стало»
 * по русским строкам в копирайт-файлах.
 *
 * Зачем. Правки владельца — самый ценный обучающий материал: каждая из них
 * содержит правило, которое иначе останется только в его голове. Держать их
 * в памяти сессии бессмысленно (сессия кончится), а перечитывать всю историю
 * руками никто не будет. Скрипт превращает историю в список пар, из которых
 * человек или агент выписывает правило в docs/copy-canon-for-agents.md,
 * раздел «Уроки правок».
 *
 *   node scripts/collect-copy-edits.mjs                  # за последние 30 дней
 *   node scripts/collect-copy-edits.mjs --since 2026-07-01
 *   node scripts/collect-copy-edits.mjs --limit 40 --md   # готовый markdown
 *
 * Что считается копирайтом: строковые литералы и JSX-текст с кириллицей в
 * src/app, src/data и src/components/sections. Разметка, классы и комментарии
 * отбрасываются — в выдаче остаются только строки, которые видит гость.
 */

import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const SINCE = flag('since', '30.days.ago')
const LIMIT = Number(flag('limit', '60'))
const AS_MD = args.includes('--md')

const PATHS = ['src/app', 'src/data', 'src/components/sections']
const CYRILLIC = /[а-яё]/i
/** Служебные строки: классы, пути, ключи, импорты — не копирайт. */
const NOISE = /className=|https?:|@\/|\.tsx?['"]|\bimport\b|\/\/|\/\*|\*\/|^\s*\*/

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const log = git('log', `--since=${SINCE}`, '--format=%H%x09%ad%x09%s', '--date=short', '--', ...PATHS)
  .split('\n')
  .filter(Boolean)
  .slice(0, LIMIT)

/** Из строки диффа достаём только человеческий текст. */
function humanText(line) {
  const body = line.slice(1)
  if (!CYRILLIC.test(body) || NOISE.test(body)) return null
  // строковый литерал целиком либо JSX-текст между тегами
  const quoted = body.match(/["'`]([^"'`]{12,})["'`]/)
  // Без кавычек оставляем только чистый JSX-текст: строки с фигурными
  // скобками и тегами — это разметка или хвосты комментариев, не копирайт.
  if (!quoted && /[<>{}]/.test(body)) return null
  const text = quoted ? quoted[1] : body.trim()
  return CYRILLIC.test(text) && text.length >= 12 ? text.replace(/ /g, ' ').trim() : null
}

const pairs = []
for (const entry of log) {
  const [sha, date, subject] = entry.split('\t')
  const diff = git('show', sha, '--unified=0', '--format=', '--', ...PATHS)
  const removed = []
  const added = []
  for (const line of diff.split('\n')) {
    if (line.startsWith('---') || line.startsWith('+++')) continue
    const text = line.startsWith('-') || line.startsWith('+') ? humanText(line) : null
    if (!text) continue
    ;(line.startsWith('-') ? removed : added).push(text)
  }
  const count = Math.max(removed.length, added.length)
  for (let i = 0; i < count; i += 1) {
    if (removed[i] === added[i]) continue
    pairs.push({ sha: sha.slice(0, 7), date, subject, before: removed[i], after: added[i] })
  }
}

if (pairs.length === 0) {
  console.log('Правок копирайта за период не нашлось.')
  process.exit(0)
}

if (AS_MD) {
  console.log('| Дата | Было | Стало | Коммит |')
  console.log('|---|---|---|---|')
  for (const p of pairs) {
    const cell = (s) => (s ? s.replace(/\|/g, '\\|').slice(0, 160) : '—')
    console.log(`| ${p.date} | ${cell(p.before)} | ${cell(p.after)} | \`${p.sha}\` |`)
  }
} else {
  let lastSha = null
  for (const p of pairs) {
    if (p.sha !== lastSha) {
      console.log(`\n${p.date}  ${p.sha}  ${p.subject}`)
      lastSha = p.sha
    }
    console.log(`  − ${p.before ?? '(добавлено)'}`)
    console.log(`  + ${p.after ?? '(удалено)'}`)
  }
  console.log(`\nвсего пар: ${pairs.length}`)
}
