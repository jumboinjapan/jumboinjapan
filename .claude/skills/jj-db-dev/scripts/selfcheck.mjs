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
 *   • подсчёт состояний porcelain в preflight ИСПОЛНЯЕТСЯ на временном
 *     репозитории со всеми четырьмя состояниями сразу;
 *   • ветка Git-локов в preflight ИСПОЛНЯЕТСЯ на временном git-каталоге:
 *     видит все три лока, включая ВЛОЖЕННЫЙ objects/maintenance.lock,
 *     показывает их метаданные, не объявляет их мёртвыми и ничего не удаляет;
 *   • ветка остатков tmp_obj_* ИСПОЛНЯЕТСЯ там же: preflight их считает,
 *     называет среду небезопасной для записи и ничего не удаляет;
 *   • SKILL.md несёт правило небезопасной для записи среды и разделяет
 *     чужой lock, свой lock и остатки tmp_obj_*;
 *   • каждое обращение preflight к Git ИСПОЛНЯЕТСЯ через подставной `git`
 *     и обязано нести `--no-optional-locks` перед подкомандой;
 *   • shell-команды `git status` и `git diff` в SKILL.md несут тот же флаг;
 *   • скрипты синтаксически корректны.
 *
 * Запуск из корня репозитория. Необязательный аргумент — каталог скилла
 * (по умолчанию .claude/skills/jj-db-dev). Репозиторий не меняет и в сеть не
 * ходит; для регрессии ниже создаёт временную фикстуру и сам её удаляет.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { checkDoc, isRelativeClaim, pathClaims } from './check-doc-claims.mjs'

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
    const target = isRelativeClaim(claim) ? path.resolve(path.dirname(f), claim) : claim
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

// ── Регрессия: корневой файл с точкой не резолвится как относительный ────
/* Дефект, из-за которого документ правили под проверку: `.gitignore`,
   упомянутый в файле из подкаталога, считался относительным путём и не
   находился. Ветка исполняется на временной паре «документ в подкаталоге +
   корневой файл», а не проверяется чтением исходника. */
{
  const dir = mkdtempSync(path.join(tmpdir(), 'claims-'))
  const sub = path.join(dir, 'docs', 'adr')
  mkdirSync(sub, { recursive: true })
  writeFileSync(path.join(dir, '.gitignore'), 'tmp/\n', 'utf8')
  writeFileSync(path.join(dir, 'package.json'), '{"scripts":{}}', 'utf8')
  const doc = path.join(sub, 'a.md')
  writeFileSync(doc, 'Каталог упомянут только в `.gitignore`, а рядом лежит [сосед](./b.md).\n', 'utf8')

  const here = process.cwd()
  const found = []
  const notes = []
  try {
    process.chdir(dir)
    checkDoc(path.relative(dir, doc), {}, found, notes)
  } finally {
    // Каталог убирается здесь же: проверка, оставляющая мусор во временной
    // папке, перестаёт быть безобидной после сотого прогона.
    process.chdir(here)
    rmSync(dir, { recursive: true, force: true })
  }
  const aboutGitignore = found.filter((f) => f.includes('.gitignore'))
  const aboutRelative = found.filter((f) => f.includes('./b.md'))
  if (aboutGitignore.length) findings.push(`корневой .gitignore принят за относительный путь: ${aboutGitignore[0]}`)
  if (!aboutRelative.length) findings.push('битая относительная ссылка ./b.md не поймана — проверка ослабла')
}

// ── Регрессия: X и Y в porcelain — независимые оси ───────────────────────
/* Первая колонка porcelain=v1 описывает индекс, вторая — рабочее дерево, и
   запись бывает в обеих сразу. Прежнее условие `l[0] === ' ' && l[1] !== ' '`
   требовало пробела в X, поэтому 'MM' считалось «проиндексировано 1,
   изменено 0»: сводка звала разбираться с индексом там, где та же правка
   лежала ещё и на диске. Ветка ИСПОЛНЯЕТСЯ на временном репозитории со
   всеми четырьмя состояниями сразу, и проверяется фактическая строка сводки,
   а не текст функции. */
{
  const preflight = path.resolve(DIR, 'scripts', 'preflight.mjs')
  const dir = mkdtempSync(path.join(tmpdir(), 'preflight-porcelain-'))
  const g = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
  })
  let summary = ''
  let states = ''
  try {
    g('init', '-q')
    for (const name of ['staged.txt', 'worktree.txt', 'both.txt']) {
      writeFileSync(path.join(dir, name), 'v1\n', 'utf8')
    }
    g('add', 'staged.txt', 'worktree.txt', 'both.txt')
    g('commit', '-q', '-m', 'init')

    writeFileSync(path.join(dir, 'staged.txt'), 'v2\n', 'utf8')     // → 'M '
    g('add', 'staged.txt')
    writeFileSync(path.join(dir, 'worktree.txt'), 'v2\n', 'utf8')   // → ' M'
    writeFileSync(path.join(dir, 'both.txt'), 'v2\n', 'utf8')       // → 'MM'
    g('add', 'both.txt')
    writeFileSync(path.join(dir, 'both.txt'), 'v3\n', 'utf8')
    writeFileSync(path.join(dir, 'untracked.txt'), 'v1\n', 'utf8')  // → '??'

    states = g('status', '--porcelain=v1')
    try {
      summary = execFileSync('node', [preflight], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      summary = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  // Сначала убеждаемся, что фикстура действительно построила все четыре
  // состояния: иначе тест проверял бы не то, что заявляет.
  for (const [needle, message] of [
    ['M  staged.txt', "фикстура не дала состояние 'M ' (только индекс)"],
    [' M worktree.txt', "фикстура не дала состояние ' M' (только рабочее дерево)"],
    ['MM both.txt', "фикстура не дала состояние 'MM' (обе оси)"],
    ['?? untracked.txt', "фикстура не дала состояние '??'"],
  ]) {
    if (!states.includes(needle)) findings.push(`${message}; porcelain вернул:\n${states.trim()}`)
  }

  const line = summary.split('\n').find((l) => l.startsWith('рабочее дерево:')) ?? '(строки сводки нет)'
  const expected = 'рабочее дерево: проиндексировано 2, изменено 2, не отслеживается 1'
  if (line !== expected) {
    findings.push(`сводка preflight считает оси неверно:\n    ожидалось: ${expected}\n    получено:  ${line}`)
  }
}

// ── Регрессия: preflight видит ОБА лока и не судит об их смерти ───────────
/* Ветка про Git-локи — единственное место скилла, где ошибка стоит дороже
   всего: неверный вывод «lock мёртв» ведёт к удалению чужого файла. Поэтому
   она не читается глазами, а ИСПОЛНЯЕТСЯ на временном git-каталоге со всеми
   тремя локами. Мутация «проверять только index.lock» роняет утверждение про
   .git/HEAD.lock; мутация «объявить lock мёртвым» роняет утверждение про
   оговорку о ps; мутация «не смотреть вложенные локи» роняет утверждение про
   .git/objects/maintenance.lock — именно её пропустила прежняя редакция, и
   настоящий maintenance.lock пролежал в репозитории незамеченным. */
{
  const preflight = path.resolve(DIR, 'scripts', 'preflight.mjs')
  const dir = mkdtempSync(path.join(tmpdir(), 'preflight-locks-'))
  let out = ''
  let locksSurvived = false
  try {
    execFileSync('git', ['init', '-q', dir], { stdio: 'ignore' })
    for (const name of ['index.lock', 'HEAD.lock']) {
      writeFileSync(path.join(dir, '.git', name), '', 'utf8')
    }
    /* Вложенный лок кладётся В СВОЙ каталог: проверка, смотрящая только в
       корень `.git`, обязана его не найти и провалить утверждение ниже. */
    mkdirSync(path.join(dir, '.git', 'objects'), { recursive: true })
    writeFileSync(path.join(dir, '.git', 'objects', 'maintenance.lock'), '', 'utf8')
    try {
      // stderr перехватывается, а не наследуется: в свежем репозитории git
      // ругается на отсутствие коммитов, и этот шум не должен течь в вывод.
      out = execFileSync('node', [preflight], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      // Находки дают код возврата 1 — это норма, нас интересует вывод.
      out = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
    // Скрипт объявлен read-only: оба лока обязаны пережить прогон.
    locksSurvived = ['index.lock', 'HEAD.lock', 'objects/maintenance.lock']
      .every((n) => existsSync(path.join(dir, '.git', n)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const must = [
    ['.git/index.lock', 'preflight не назвал .git/index.lock'],
    ['.git/HEAD.lock', 'preflight не назвал .git/HEAD.lock — проверяется только один лок'],
    ['.git/objects/maintenance.lock',
      'preflight не назвал .git/objects/maintenance.lock — вложенные локи не проверяются'],
    ['размер:', 'preflight не показал размер лока'],
    ['изменён:', 'preflight не показал время изменения лока'],
    ['ps показывает только процессы этой песочницы', 'preflight не оговорил ограниченность ps'],
    ['НЕ блокируются', 'preflight не разделил «lock обнаружен» и «операция заблокирована»'],
    ['ДОКАЗАННОМ владельце', 'preflight не требует доказанного владельца перед снятием лока'],
  ]
  for (const [needle, message] of must) {
    if (!out.includes(needle)) findings.push(`${message} (искали «${needle}»)`)
  }
  // Обе метаданные должны быть у КАЖДОГО лока, а не у одного.
  const sizes = (out.match(/размер:/g) ?? []).length
  const times = (out.match(/изменён:/g) ?? []).length
  if (sizes < 3 || times < 3) {
    findings.push(`метаданные показаны не у каждого лока: размеров ${sizes}, времён ${times}, ожидалось по 3`)
  }
  for (const claim of ['мёртв', 'можно удалить', 'безопасно удалить']) {
    if (out.includes(claim)) findings.push(`preflight утверждает про lock «${claim}» — он этого не знает`)
  }
  if (!locksSurvived) findings.push('preflight удалил или перенёс lock — он обязан быть read-only')
}

// ── Регрессия: остатки tmp_obj_* и правило небезопасной для записи среды ──
/* Прямое свидетельство того, что среда не убирает за Git: временный объект,
   который Git пишет перед переименованием и обычно удаляет сразу. Оставшийся
   файл означает либо запрет на unlink, либо упавший процесс — в обоих случаях
   следующая запись оставит lock, который тоже не убрать.

   Ветка ИСПОЛНЯЕТСЯ, а не читается: мутация «не считать остатки» роняет
   утверждение про число, мутация «удалять найденное» роняет утверждение про
   выживание файлов. Скрипт обязан остаться read-only и здесь. */
{
  const preflight = path.resolve(DIR, 'scripts', 'preflight.mjs')
  const dir = mkdtempSync(path.join(tmpdir(), 'preflight-residue-'))
  let out = ''
  let residuesSurvived = false
  const residueFiles = [
    path.join(dir, '.git', 'objects', 'ac', 'tmp_obj_AAaa11'),
    path.join(dir, '.git', 'objects', '04', 'tmp_obj_BBbb22'),
  ]
  try {
    execFileSync('git', ['init', '-q', dir], { stdio: 'ignore' })
    for (const file of residueFiles) {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, '', 'utf8')
    }
    /* Настоящий объект рядом: сканер обязан отличать `tmp_obj_*` от обычного
       содержимого каталога объектов, а не считать всё подряд. */
    writeFileSync(path.join(dir, '.git', 'objects', 'ac', '0123456789abcdef'), '', 'utf8')
    try {
      out = execFileSync('node', [preflight], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      out = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
    residuesSurvived = residueFiles.every((f) => existsSync(f))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const mustResidue = [
    ['tmp_obj_*', 'preflight не назвал остатки tmp_obj_*'],
    ['НЕБЕЗОПАСНЫМ ДЛЯ ЗАПИСИ', 'preflight не назвал среду небезопасной для записи при остатках'],
    ['передать нужный Git-переход хосту', 'preflight не передал Git-переход способному хосту'],
    ['не удалять и не переносить', 'preflight не запретил трогать остатки'],
  ]
  for (const [needle, message] of mustResidue) {
    if (!out.includes(needle)) findings.push(`${message} (искали «${needle}»)`)
  }
  if (!/осталось 2 файлов tmp_obj_\*/.test(out)) {
    findings.push('preflight посчитал остатки tmp_obj_* неверно — ожидалось ровно 2, обычный объект в счёт не идёт')
  }
  if (!residuesSurvived) findings.push('preflight удалил остатки tmp_obj_* — он обязан быть read-only')
}

// ── Правило небезопасной для записи среды записано в SKILL.md ────────────
/* Guard в скрипте без правила в тексте — половина защиты: скрипт сообщит, а
   инструкция не скажет, что делать. Проверяются три РАЗНЫХ утверждения, а не
   одно: условие, запрет на записи и разделение «чужой lock / свой lock /
   остатки». Мутация, выкинувшая любое из трёх, роняет своё утверждение. */
{
  const mustSkill = [
    ['.git/objects/maintenance.lock', 'SKILL.md не называет вложенный maintenance.lock в списке локов'],
    ['теряет право на Git-записи', 'SKILL.md не вводит правило небезопасной для записи среды'],
    ['разовое восстановление', 'SKILL.md не отделяет разовое восстановление своего лока от разрешения писать дальше'],
    ['Чужой lock не переносить никогда', 'SKILL.md не запрещает переносить чужой lock'],
    ['tmp_obj_*', 'SKILL.md не говорит про остатки tmp_obj_*'],
  ]
  for (const [needle, message] of mustSkill) {
    if (!text.includes(needle)) findings.push(`${message} (искали «${needle}»)`)
  }
}

// ── Регрессия: read-only Git не создаёт новых lock-файлов ────────────────
/* `git status` и `git diff` по дороге обновляют индекс и ради этого создают
   .git/index.lock — даже когда их запустили только посмотреть. Там, где
   удаление запрещено, такой lock остаётся навсегда и блокирует следующую
   запись в индекс: проверка границ закрывает собой те самые границы.
   Лечится глобальной опцией `--no-optional-locks` ПЕРЕД подкомандой: после
   подкоманды она как глобальная не применяется, а сама подкоманда вправе
   отвергнуть её как неизвестную (`git status --no-optional-locks` — код 129,
   `unknown option`).

   Проверяется исполнением, а не чтением исходника: в начало PATH кладётся
   подставной `git`, который записывает полученный argv и отвечает ровно
   тем минимумом, который preflight потребляет. Потом настоящий preflight
   запускается как CLI, и каждый записанный вызов проверяется на флаг. */
{
  const preflight = path.resolve(DIR, 'scripts', 'preflight.mjs')
  const dir = mkdtempSync(path.join(tmpdir(), 'preflight-nolocks-'))
  const binDir = path.join(dir, 'bin')
  const logFile = path.join(dir, 'calls.log')
  const workDir = path.join(dir, 'work')
  let calls = []
  let ran = ''
  try {
    mkdirSync(binDir, { recursive: true })
    mkdirSync(path.join(workDir, '.git'), { recursive: true })
    /* Подставной git: пишет argv в лог и отдаёт минимальные ответы. Ответы
       намеренно бедные — задача сторожа не в разборе вывода, а в том, с
       какими аргументами preflight вообще обращается к Git. */
    writeFileSync(path.join(binDir, 'git'), [
      '#!/usr/bin/env node',
      "const { appendFileSync } = require('node:fs')",
      'const argv = process.argv.slice(2)',
      `appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(argv) + '\\n')`,
      "const has = (...needles) => needles.every((n) => argv.includes(n))",
      "if (has('--show-toplevel')) process.stdout.write('/tmp/fake-repo\\n')",
      "else if (has('--abbrev-ref', 'HEAD')) process.stdout.write('main\\n')",
      "else if (has('--abbrev-ref', '@{u}')) process.stdout.write('origin/main\\n')",
      "else if (has('--short', 'HEAD')) process.stdout.write('abc1234\\n')",
      "else if (has('log')) process.stdout.write('тема коммита\\n')",
      "else if (has('status')) process.stdout.write('M  a.txt\\n M b.txt\\n?? c.txt\\n')",
      "else if (has('stash')) process.stdout.write('')",
      'else process.stdout.write("")',
      '',
    ].join('\n'), { encoding: 'utf8', mode: 0o755 })

    try {
      ran = execFileSync('node', [preflight], {
        cwd: workDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
      })
    } catch (error) {
      // Находки дают код возврата 1 — это норма.
      ran = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
    calls = existsSync(logFile)
      ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : []
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  // Пустой лог прошёл бы проверку «все вызовы с флагом» вхолостую.
  if (calls.length < 5) {
    findings.push(`подставной git получил ${calls.length} вызов(ов) — preflight до него не дошёл, сторож бесполезен`)
  }
  if (!ran.includes('рабочее дерево:')) {
    findings.push('preflight не отработал на подставном git — сторож ничего не проверил')
  }
  for (const argv of calls) {
    if (argv[0] !== '--no-optional-locks') {
      findings.push(`обращение к Git без --no-optional-locks перед подкомандой: git ${argv.join(' ')}`)
      break
    }
    if (argv.length < 2 || argv[1].startsWith('-')) {
      findings.push(`после --no-optional-locks нет подкоманды: git ${argv.join(' ')}`)
      break
    }
  }
}

// ── Структурный сторож: операционные команды в SKILL.md ──────────────────
/* Инструкция, которая велит запускать `git status` без `--no-optional-locks`,
   сама учит оставлять lock — правило в тексте и команда рядом с ним
   расходятся. Проверяются ТОЛЬКО shell-блоки: упоминания в прозе описывают
   в том числе поведение без флага, и требовать флаг там бессмысленно. */
{
  const blocks = [...text.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1])
  for (const block of blocks) {
    for (const raw of block.split('\n')) {
      const line = raw.trim()
      if (!/^git\s+(status|diff)\b/.test(line)) continue
      findings.push(
        `SKILL.md: команда «${line}» без --no-optional-locks перед подкомандой — ` +
          'read-only проверка создаст .git/index.lock',
      )
    }
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
