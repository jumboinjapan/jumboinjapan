#!/usr/bin/env node
/**
 * Границы работы перед правкой слоя данных.
 *
 * Печатает фактическое состояние репозитория и подсвечивает то, из-за чего
 * задача может смешаться с чужой: уже проиндексированные файлы, чужие
 * незакоммиченные правки, Git-локи (index.lock и HEAD.lock), stash.
 *
 * Ничего не меняет: не удаляет, не переносит и не правит ни один файл,
 * включая Git-локи. Про lock скрипт сообщает факт и метаданные и НЕ судит
 * о том, жив ли его владелец.
 *
 * Код возврата 1 означает находку, а не сбой запуска.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'

/**
 * Флаг read-only обращения к Git. Это ГЛОБАЛЬНАЯ опция Git, и место у неё
 * одно — перед подкомандой. После подкоманды она как глобальная не
 * применяется, а сама подкоманда вправе отвергнуть её как неизвестную:
 * `git status --no-optional-locks` завершается кодом 129 с
 * `error: unknown option`.
 *
 * Зачем. `status`, `diff` и родственные им команды по дороге обновляют
 * индекс и ради этого создают `.git/index.lock` — даже когда их запустили
 * только посмотреть. На файловой системе, где удаление запрещено, такой
 * lock остаётся навсегда, и следующая запись в индекс упирается в файл,
 * созданный проверкой. Проверка границ не имеет права оставлять после себя
 * то, что эти границы закрывает.
 *
 * Чего флаг НЕ делает: уже существующий lock он не обезвреживает и права
 * снимать его не даёт. Правила доказательства владельца ниже не ослабляются.
 */
const READ_ONLY = '--no-optional-locks'

const git = (...args) => {
  try {
    return execFileSync('git', [READ_ONLY, ...args], { encoding: 'utf8' }).trim()
  } catch (error) {
    return `(git ${args[0]}: ${String(error.message).split('\n')[0]})`
  }
}

/** Построчный вывод без обрезки: ведущие пробелы porcelain значащие. */
const gitLines = (...args) => {
  try {
    return execFileSync('git', [READ_ONLY, ...args], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.length > 0)
  } catch {
    return []
  }
}

const findings = []
const say = (label, value) => console.log(`${label.padEnd(22)} ${value}`)

const root = git('rev-parse', '--show-toplevel')
say('репозиторий', root)
say('ветка', git('rev-parse', '--abbrev-ref', 'HEAD'))
say('HEAD', `${git('rev-parse', '--short', 'HEAD')}  ${git('log', '-1', '--format=%s')}`)
say('upstream', git('rev-parse', '--abbrev-ref', '@{u}') || '(нет)')

// ВАЖНО: вывод porcelain читается БЕЗ trim. Общий git() обрезает пробелы,
// а в porcelain=v1 ведущий пробел — значащий символ: ' M file' это правка
// рабочего дерева, 'M  file' — проиндексированная. Обрезав его у первой
// строки, скрипт объявлял чужую правку проиндексированной и требовал
// разобраться с несуществующим содержимым индекса.
const rows = gitLines('status', '--porcelain=v1')
// В porcelain=v1 первая и вторая колонки — НЕЗАВИСИМЫЕ оси: X это состояние
// индекса, Y — состояние рабочего дерева. Одна запись может быть в обеих
// сразу: 'MM' значит «часть правок проиндексирована, часть нет». Прежнее
// условие требовало пробела в X, поэтому у 'MM' рабочее дерево считалось
// чистым, и сводка звала разбираться с индексом там, где правка была ещё
// и на диске.
const tracked = rows.filter((l) => !l.startsWith('??') && !l.startsWith('!!'))
const staged = tracked.filter((l) => l[0] !== ' ')
const modified = tracked.filter((l) => l[1] !== ' ')
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
// ── Git-локи ──────────────────────────────────────────────────────────────
//
// Скрипт СООБЩАЕТ о локе и НЕ делает выводов о его смерти. Отсутствие
// процесса в `ps` доказательством не является: песочница и контейнер могут
// не видеть процессы host-машины, а git-команда может быть запущена другим
// агентом, IDE или GUI вне этого пространства процессов. Нулевой размер и
// возраст файла тоже ничего не доказывают — lock создаётся пустым и живёт
// ровно столько, сколько идёт операция.
const LOCKS = [
  {
    file: '.git/index.lock',
    blocks: 'операции, пишущие индекс: add, rm, mv, checkout, commit, stash, merge',
  },
  {
    file: '.git/HEAD.lock',
    blocks: 'операции, двигающие HEAD: commit, reset, checkout, merge, rebase',
  },
]
const locksSeen = []
for (const { file, blocks } of LOCKS) {
  if (!existsSync(file)) continue
  locksSeen.push(file)
  let size = '?'
  let mtime = '?'
  try {
    const st = statSync(file)
    size = String(st.size)
    mtime = st.mtime.toISOString()
  } catch (error) {
    mtime = `(stat: ${String(error.message).split('\n')[0]})`
  }
  console.log(`lock обнаружен: ${file}`)
  console.log(`  размер:    ${size} байт`)
  console.log(`  изменён:   ${mtime}`)
  console.log(`  блокирует: ${blocks}`)
}
if (locksSeen.length) {
  console.log('  НЕ блокируются: чтение (status, diff, log, show, ls-remote) и push —')
  console.log('  push не пишет ни индекс, ни HEAD, и снимать ради него lock не нужно.')
  findings.push(
    `обнаружены Git-локи (${locksSeen.join(', ')}) — сначала решить, нужен ли заблокированный ` +
      'ими ресурс планируемой операции; если не нужен, работать как есть. Живость владельца ' +
      'скрипт не проверяет и проверить не может: ps показывает только процессы этой песочницы, ' +
      'а нулевой размер и возраст файла смерти не доказывают. Снимать или переносить lock — ' +
      'только при ДОКАЗАННОМ владельце и ДОКАЗАННОМ завершении его команды; не доказано — ' +
      'оставить на месте и запросить решение владельца. Обходные пути (другой GIT_DIR, ' +
      'отдельный индекс, смена протокола или remote) запрещены',
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
