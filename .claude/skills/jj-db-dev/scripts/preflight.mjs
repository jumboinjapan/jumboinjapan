#!/usr/bin/env node
/**
 * Границы работы перед правкой слоя данных.
 *
 * Печатает фактическое состояние репозитория и подсвечивает то, из-за чего
 * задача может смешаться с чужой: уже проиндексированные файлы, чужие
 * незакоммиченные правки, оставшийся index.lock, stash.
 *
 * Ничего не меняет. Код возврата 1 означает находку, а не сбой запуска.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch (error) {
    return `(git ${args[0]}: ${String(error.message).split('\n')[0]})`
  }
}

const findings = []
const say = (label, value) => console.log(`${label.padEnd(22)} ${value}`)

const root = git('rev-parse', '--show-toplevel')
say('репозиторий', root)
say('ветка', git('rev-parse', '--abbrev-ref', 'HEAD'))
say('HEAD', `${git('rev-parse', '--short', 'HEAD')}  ${git('log', '-1', '--format=%s')}`)
say('upstream', git('rev-parse', '--abbrev-ref', '@{u}') || '(нет)')

const porcelain = git('status', '--porcelain=v1')
const rows = porcelain ? porcelain.split('\n').filter((l) => l.trim()) : []
const staged = rows.filter((l) => l[0] !== ' ' && l[0] !== '?')
const modified = rows.filter((l) => l[0] === ' ' && l[1] !== ' ')
const untracked = rows.filter((l) => l.startsWith('??'))

console.log('')
console.log(`рабочее дерево: проиндексировано ${staged.length}, изменено ${modified.length}, не отслеживается ${untracked.length}`)
for (const l of rows) console.log(`  ${l}`)

if (staged.length) {
  findings.push(
    `в индексе уже ${staged.length} файл(ов) — определить владельца до любого git add; ` +
      'файлы своей задачи перечислять поимённо, git add -A запрещён',
  )
}
if (modified.length || untracked.length) {
  findings.push(
    'есть незакоммиченные и непрослеженные файлы — назвать владельца каждого; ' +
      'чужое не трогать, не перемещать и в коммит не брать',
  )
}

const stash = git('stash', 'list')
if (stash && !stash.startsWith('(git')) {
  console.log('')
  console.log('stash:')
  for (const l of stash.split('\n')) console.log(`  ${l}`)
  findings.push('в репозитории есть stash — он чужой, пока не доказано обратное; не применять и не сбрасывать')
}

console.log('')
if (existsSync('.git/index.lock')) {
  findings.push(
    '.git/index.lock существует — остановить git-операции. Он может принадлежать работающему процессу: ' +
      'посмотреть активные процессы и возраст файла и удалять только тот lock, который доказанно остался ' +
      'от завершённого. Не доказано — спросить владельца',
  )
}
if (existsSync('_to_delete')) {
  console.log('_to_delete/ существует: в коммит не берётся никогда')
}

console.log('')
if (!findings.length) {
  console.log('✓ границы чисты')
  process.exit(0)
}
console.log('НАЙДЕНО:')
for (const f of findings) console.log(`  • ${f}`)
process.exit(1)
