#!/usr/bin/env node
/**
 * Механически проверяемые утверждения канонической документации.
 *
 * Ловит четыре класса уже случившихся дефектов:
 *   • документ ссылается на файл или команду, которых нет;
 *   • записанный digest разошёлся с байтами реестра;
 *   • Last verified commit указывает на несуществующий коммит;
 *   • нумерация разделов порвалась после вставки нового.
 *
 * Смысловые утверждения (атомарность, место проверки в коде, состав отчёта)
 * механически не проверяются — их сверяет человек или агент по коду.
 *
 * Запуск из корня репозитория. Аргументы — пути документов; без них берётся
 * набор по умолчанию. Ничего не пишет и не ходит в сеть.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const DEFAULT_DOCS = [
  'docs/poi-intake/README.md',
  'docs/poi-intake/runbook.md',
  'docs/poi-intake/change-policy.md',
  'docs/poi-writers-registry.md',
  'docs/poi-intake-contract.md',
]

const ROOT_FILES = new Set(['package.json', 'package-lock.json', 'AGENTS.md', 'CLAUDE.md', '.nvmrc', '.gitignore', 'eslint.config.mjs', 'next.config.ts', 'tsconfig.json'])
const PATH_LIKE = /^(?:docs|src|scripts|config|tests|public)\/[A-Za-z0-9._/-]+$/

/** Ссылки на файлы репозитория: `путь` в обратных кавычках и обычные ссылки. */
export function pathClaims(text) {
  const out = new Set()
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const raw = m[1].trim()
    if (raw.includes('<') || raw.includes('*') || raw.includes('…') || raw.endsWith('/')) continue
    if (PATH_LIKE.test(raw) || ROOT_FILES.has(raw)) out.add(raw)
  }
  for (const m of text.matchAll(/\]\((\.{0,2}\/[^)\s#]+)\)/g)) out.add(m[1])
  return [...out]
}

/** Команды npm, упомянутые в тексте. */
export function npmClaims(text) {
  const out = new Set()
  for (const m of text.matchAll(/npm run ([a-z0-9:-]+)/g)) out.add(m[1])
  if (/npm test\b/.test(text)) out.add('test')
  return [...out]
}

export function sha256OfFile(file) {
  return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`
}

export function checkDoc(file, scripts, findings, notes) {
  const text = readFileSync(file, 'utf8')

  for (const claim of pathClaims(text)) {
    const target = claim.startsWith('.') ? new URL(claim, pathToFileURL(file)).pathname : claim
    if (!existsSync(target)) findings.push(`${file}: ссылается на несуществующий путь ${claim}`)
  }

  for (const cmd of npmClaims(text)) {
    if (!(cmd in scripts)) findings.push(`${file}: команда npm run ${cmd} не объявлена в package.json`)
  }

  // digest: ближайший путь перед хешем в пределах 600 символов
  for (const m of text.matchAll(/sha256:([0-9a-f]{64})/g)) {
    const before = text.slice(Math.max(0, m.index - 600), m.index)
    const paths = [...before.matchAll(/`([A-Za-z0-9._/-]+\.(?:json|md|xlsx))`/g)]
    const near = paths.length ? paths[paths.length - 1][1] : null
    if (!near) { notes.push(`${file}: digest ${m[1].slice(0, 12)}… не привязан к пути — не проверен`); continue }
    if (!existsSync(near)) { notes.push(`${file}: ${near} нет в репозитории — digest не проверен`); continue }
    const actual = sha256OfFile(near)
    if (actual !== `sha256:${m[1]}`) findings.push(`${file}: digest ${near} записан ${m[1].slice(0, 12)}…, фактический ${actual.slice(7, 19)}…`)
  }

  for (const m of text.matchAll(/Last (?:verified|reviewed against) commit:?\s*`?([0-9a-f]{7,40})`?/g)) {
    try {
      execFileSync('git', ['cat-file', '-e', `${m[1]}^{commit}`], { stdio: 'ignore' })
    } catch {
      findings.push(`${file}: Last verified commit ${m[1]} — такого коммита нет`)
    }
  }

  const numbers = [...text.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]))
  for (const [i, n] of numbers.entries()) {
    if (n !== i + 1) { findings.push(`${file}: нумерация разделов порвана — после ${i} идёт ## ${n}.`); break }
  }
}

export function run(docs) {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {}
  const findings = []
  const notes = []
  for (const file of docs) {
    if (!existsSync(file) || !statSync(file).isFile()) { findings.push(`нет документа ${file}`); continue }
    checkDoc(file, scripts, findings, notes)
  }
  return { findings, notes }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const docs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_DOCS
  const { findings, notes } = run(docs)
  for (const n of notes) console.log(`  · ${n}`)
  if (!findings.length) {
    console.log(`✓ утверждения сверены: ${docs.length} документ(ов)`)
    process.exit(0)
  }
  console.log('НАЙДЕНО:')
  for (const f of findings) console.log(`  • ${f}`)
  process.exit(1)
}
