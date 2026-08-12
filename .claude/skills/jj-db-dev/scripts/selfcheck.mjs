#!/usr/bin/env node
/**
 * Проверка самого скилла. Валидатора структуры skills в Claude Code нет,
 * поэтому проверяется здесь:
 *   • frontmatter только из поддерживаемых полей, имя совпадает с каталогом;
 *   • SKILL.md в пределах рекомендованного объёма;
 *   • относительные ссылки разрешаются, вложенность ссылок не глубже одного
 *     уровня (references не ссылаются дальше);
 *   • пути репозитория, упомянутые в скилле, существуют;
 *   • хеши коммитов, на которые ссылается разбор, существуют;
 *   • в скилле нет машинных значений с каноническим источником (digest);
 *   • Last reviewed against commit указывает на реальный коммит;
 *   • скрипты синтаксически корректны.
 *
 * Запуск из корня репозитория. Необязательный аргумент — каталог скилла
 * (по умолчанию .claude/skills/jj-db-dev). Ничего не пишет и не ходит в сеть.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathClaims } from './check-doc-claims.mjs'

const DIR = process.argv[2] ?? '.claude/skills/jj-db-dev'
const ALLOWED_KEYS = new Set([
  'name', 'description', 'when_to_use', 'argument-hint', 'arguments',
  'disable-model-invocation', 'user-invocable', 'allowed-tools', 'disallowed-tools',
  'model', 'effort', 'context', 'agent', 'background', 'hooks', 'paths', 'shell',
  'metadata', 'license', 'compatibility',
])
const FORBIDDEN_FILES = new Set(['README.md', 'CHANGELOG.md', 'NOTES.md'])

const findings = []
const commitExists = (h) => {
  try { execFileSync('git', ['cat-file', '-e', `${h}^{commit}`], { stdio: 'ignore' }); return true } catch { return false }
}

const skillFile = path.join(DIR, 'SKILL.md')
if (!existsSync(skillFile)) {
  console.log(`НАЙДЕНО:\n  • нет ${skillFile}`)
  process.exit(1)
}

const text = readFileSync(skillFile, 'utf8')
const lines = text.split('\n')
if (lines.length > 500) findings.push(`SKILL.md ${lines.length} строк — рекомендованный предел 500`)

// ── frontmatter ───────────────────────────────────────────────────────────
if (!text.startsWith('---\n')) findings.push('SKILL.md не начинается с frontmatter')
const end = text.indexOf('\n---\n', 4)
const front = end === -1 ? '' : text.slice(4, end)
if (!front) findings.push('frontmatter не закрыт')
const keys = {}
for (const line of front.split('\n')) {
  const m = line.match(/^([A-Za-z_-]+):\s*(.*)$/)
  if (!m) continue
  keys[m[1]] = m[2]
  if (!ALLOWED_KEYS.has(m[1])) findings.push(`frontmatter: поле ${m[1]} не поддерживается Claude Code`)
}
if (keys.name !== path.basename(DIR)) findings.push(`frontmatter: name «${keys.name}» не совпадает с каталогом «${path.basename(DIR)}»`)
if (!keys.description) findings.push('frontmatter: нет description — скилл не будет вызван автоматически')
const descLen = (keys.description ?? '').length + (keys.when_to_use ?? '').length
if (descLen > 1536) findings.push(`frontmatter: description + when_to_use ${descLen} символов, предел 1536`)

// ── файлы скилла ──────────────────────────────────────────────────────────
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
const files = walk(DIR)
for (const f of files) {
  if (FORBIDDEN_FILES.has(path.basename(f))) findings.push(`${f}: служебная документация внутри скилла не нужна`)
}

const mdFiles = files.filter((f) => f.endsWith('.md'))
for (const f of mdFiles) {
  const body = readFileSync(f, 'utf8')

  if (body.includes('sha256:')) findings.push(`${f}: digest хранится в скилле — у него есть канонический источник`)

  for (const claim of pathClaims(body)) {
    const target = claim.startsWith('.') ? path.resolve(path.dirname(f), claim) : claim
    if (!existsSync(target)) findings.push(`${f}: несуществующий путь ${claim}`)
  }
  for (const m of body.matchAll(/`(\.claude\/skills\/[A-Za-z0-9._/-]+)`/g)) {
    if (!existsSync(m[1])) findings.push(`${f}: несуществующий путь ${m[1]}`)
  }
  for (const m of body.matchAll(/node (\.claude\/skills\/[A-Za-z0-9._/-]+\.mjs)/g)) {
    if (!existsSync(m[1])) findings.push(`${f}: команда ссылается на несуществующий скрипт ${m[1]}`)
  }
  for (const m of body.matchAll(/`([0-9a-f]{7,40})`/g)) {
    if (!commitExists(m[1])) findings.push(`${f}: коммит ${m[1]} не существует`)
  }
  for (const m of body.matchAll(/\]\(([^)\s#]+)\)/g)) {
    const target = path.resolve(path.dirname(f), m[1])
    if (!existsSync(target)) findings.push(`${f}: битая ссылка ${m[1]}`)
    if (path.dirname(f) !== DIR) findings.push(`${f}: ссылка второго уровня ${m[1]} — references не должны ссылаться дальше`)
  }
}

const reviewed = text.match(/Last reviewed against commit:?[*\s]*`?([0-9a-f]{7,40})`?/)
if (!reviewed) findings.push('в SKILL.md нет строки Last reviewed against commit')
else if (!commitExists(reviewed[1])) findings.push(`Last reviewed against commit ${reviewed[1]} — такого коммита нет`)

for (const f of files.filter((x) => x.endsWith('.mjs'))) {
  try { execFileSync('node', ['--check', f], { stdio: 'ignore' }) } catch { findings.push(`${f}: синтаксическая ошибка`) }
}

if (!findings.length) {
  console.log(`✓ скилл цел: ${files.length} файл(ов), SKILL.md ${lines.length} строк`)
  process.exit(0)
}
console.log('НАЙДЕНО:')
for (const f of findings) console.log(`  • ${f}`)
process.exit(1)
