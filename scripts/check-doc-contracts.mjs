#!/usr/bin/env node
/**
 * Сторож контрактов документации.
 *
 *   npm run check:docs
 *
 * ЗАЧЕМ. Документация расходится с кодом не потому, что её плохо пишут, а
 * потому, что между ней и кодом ничего не стоит. Аудит 2026-08-16 нашёл три
 * расхождения одного класса: CI не выполнял стадию, которую `verify`
 * объявляет обязательной; `.env.example` заявлял полноту и не содержал двух
 * переменных production-кода; README коллектора описывал флаги `--preview` и
 * `--apply`, которых парсер никогда не принимал. Каждое расхождение проверялось
 * глазами — и каждое пережило несколько проверок глазами.
 *
 * Этот прогон и есть то, что стоит между. Он НЕ судит о стиле и не переписывает
 * текст: он сверяет три пары «утверждение — код» механически.
 *
 * Второго списка команд, переменных и флагов здесь нет намеренно. Всё
 * извлекается из настоящих package.json, workflow, исходников и парсера CLI:
 * вручную поддерживаемый дубль разошёлся бы с оригиналом ровно так же, как
 * разошлась документация, только тише.
 *
 * Сети и ключей не требует.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

import { acceptedFlags } from './poi-portals/collect-pois.mjs'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Единственная переменная окружения, которой в `.env.example` быть не должно:
 * её задаёт платформа, а не файл проекта.
 */
export const ENV_IGNORED = Object.freeze(['NODE_ENV'])

/**
 * Аргументы CLI, которые перечислять не обязательно. Список закрыт и
 * объясним: `-h` — псевдоним `--help`, отдельного поведения у него нет.
 */
export const FLAGS_NOT_REQUIRED_IN_DOCS = Object.freeze(['-h'])

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/
const SOURCE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.mjs', '.js'])
const SKIP_DIRECTORIES = Object.freeze(['node_modules', '.next', '.git', 'tmp', '_to_delete'])

/* ── Стадии verify и CI ────────────────────────────────────────────────── */

/**
 * Стадии локального `npm run verify` в порядке выполнения.
 *
 * Разбирается настоящая строка скрипта: перечень стадий живёт в package.json
 * и больше нигде.
 */
export function verifyStages(packageJsonText) {
  const parsed = JSON.parse(packageJsonText)
  const verify = parsed?.scripts?.verify
  if (typeof verify !== 'string' || !verify.trim()) {
    throw new Error('package.json: скрипт verify не найден')
  }
  /* Ничего не отфильтровывается. Прежняя версия оставляла только сегменты,
     начинающиеся с `npm `, и стадия вида `node scripts/…` исчезала из
     сравнения — CI без неё объявлялся равным. Неподдерживаемый синтаксис
     теперь отказ, а не молчаливое сужение: guard, который чего-то не умеет,
     обязан это сказать, а не подтвердить равенство вслепую. */
  const withoutChain = verify.split('&&').join(' ')
  const stray = /[|;&<>]/.exec(withoutChain)
  if (stray) {
    throw new Error(
      `package.json: verify содержит неподдерживаемый разбором синтаксис («${stray[0]}»). `
      + 'Сравнение стадий поддерживает только цепочку через &&.',
    )
  }
  const stages = verify.split('&&').map((part) => part.trim())
  if (stages.some((part) => !part)) {
    throw new Error('package.json: в verify пустой сегмент между &&')
  }
  return stages
}

/**
 * Стадии CI в порядке выполнения, без установки зависимостей.
 *
 * YAML разбирается построчно и намеренно узко: блочный `run: |` не
 * поддерживается и вызывает отказ, потому что молча разобранный многострочный
 * шаг превратил бы несколько команд в одну строку сравнения.
 */
export function ciStages(workflowText) {
  const stages = []
  for (const [index, line] of workflowText.split('\n').entries()) {
    const match = /^\s*run:\s*(.+?)\s*$/.exec(line)
    if (!match) continue
    const command = match[1]
    if (command === '|' || command.startsWith('|') || command.startsWith('>')) {
      throw new Error(`workflow, строка ${index + 1}: блочный run не поддерживается этой проверкой`)
    }
    if (command === 'npm ci') continue
    stages.push(command)
  }
  if (!stages.length) throw new Error('workflow: не найдено ни одного шага run')
  return stages
}

/** Состав и порядок обязаны совпадать. Сам `check:docs` из сравнения не изымается. */
export function compareStages(verify, ci) {
  const problems = []
  if (verify.join(' | ') !== ci.join(' | ')) {
    problems.push(
      'состав или порядок стадий CI не совпадает с npm run verify:\n'
      + `    verify: ${verify.join(' → ')}\n`
      + `    CI:     ${ci.join(' → ')}`,
    )
  }
  return problems
}

/* ── Полнота .env.example ──────────────────────────────────────────────── */

function walkSources(dir, out = []) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries.sort()) {
    if (SKIP_DIRECTORIES.includes(name)) continue
    const full = path.join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) { walkSources(full, out); continue }
    if (SOURCE_EXTENSIONS.includes(path.extname(name))) out.push(full)
  }
  return out
}

/**
 * Разбор файла в AST.
 *
 * Ошибка разбора — ОТКАЗ с именем файла, а не пропуск: файл, который не
 * удалось прочитать, мог содержать ровно ту переменную, которой не хватает.
 */
export function parseSource(text, fileName) {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : undefined
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind)
  const diagnostics = source.parseDiagnostics ?? []
  if (diagnostics.length) {
    const first = diagnostics[0]
    throw new Error(
      `${fileName}: разбор не удался — ${ts.flattenDiagnosticMessageText(first.messageText, ' ')}`,
    )
  }
  return source
}

const eachNode = (node, visit) => {
  visit(node)
  node.forEachChild((child) => eachNode(child, visit))
}

/** `process.env` как выражение, а не как строка. */
const isProcessEnv = (node) => ts.isPropertyAccessExpression(node)
  && ts.isIdentifier(node.expression) && node.expression.text === 'process'
  && node.name.text === 'env'

const literalText = (node) => (node && ts.isStringLiteralLike(node) ? node.text : null)

/** Имя объявления функции или того, чему её присвоили. */
function declaredName(node) {
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) return node.name.text
  const parent = node.parent
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  return null
}

/**
 * Имена функций-обёрток над окружением, ВЫВЕДЕННЫЕ из кода.
 *
 * Обёрткой считается функция, которая читает окружение по СВОЕМУ параметру.
 * Разбор идёт по дереву, а не по тексту: окно в N знаков после объявления
 * теряло обёртку с длинным телом, а шаблон «function имя(» не видел стрелку
 * без скобок. Ни того, ни другого у дерева нет — тело функции есть тело
 * функции, какой бы длины и формы оно ни было.
 */
export function envHelperNames(sources) {
  const helpers = new Set()
  for (const source of sources) {
    eachNode(source, (node) => {
      if (!ts.isFunctionDeclaration(node) && !ts.isFunctionExpression(node)
        && !ts.isArrowFunction(node) && !ts.isMethodDeclaration(node)) return
      const parameters = new Set(
        node.parameters.filter((p) => ts.isIdentifier(p.name)).map((p) => p.name.text),
      )
      if (!parameters.size || !node.body) return
      let readsEnvByParameter = false
      eachNode(node.body, (inner) => {
        if (!ts.isElementAccessExpression(inner) || !isProcessEnv(inner.expression)) return
        const argument = inner.argumentExpression
        if (argument && ts.isIdentifier(argument) && parameters.has(argument.text)) {
          readsEnvByParameter = true
        }
      })
      if (!readsEnvByParameter) return
      const name = declaredName(node)
      if (name) helpers.add(name)
    })
  }
  return helpers
}

/**
 * Имена переменных окружения в настоящих исходниках.
 *
 * Четыре способа, все — по дереву: `process.env.NAME`, `process.env['NAME']`
 * любой кавычкой, `envVar` со строковым литералом и вызов выведенной обёртки
 * со строковым литералом.
 */
export function envNamesInSources(roots) {
  const parsed = []
  for (const root of roots) {
    for (const file of walkSources(root)) {
      parsed.push({ file, source: parseSource(readFileSync(file, 'utf8'), file) })
    }
  }
  const helpers = envHelperNames(parsed.map((entry) => entry.source))
  const found = new Map()
  const remember = (name, file) => {
    if (name && ENV_NAME.test(name) && !found.has(name)) found.set(name, file)
  }
  for (const { file, source } of parsed) {
    eachNode(source, (node) => {
      if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
        remember(node.name.text, file)
        return
      }
      if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression)) {
        remember(literalText(node.argumentExpression), file)
        return
      }
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'envVar') {
        remember(literalText(node.initializer), file)
        return
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && helpers.has(node.expression.text)) {
        remember(literalText(node.arguments[0]), file)
      }
    })
  }
  return found
}

/** Имена, объявленные в `.env.example`. */
export function declaredEnvNames(envExampleText) {
  return new Set(
    envExampleText.split('\n')
      .map((line) => /^([A-Z_][A-Z0-9_]*)=/.exec(line.trim()))
      .filter(Boolean)
      .map((match) => match[1]),
  )
}

export function compareEnv(found, declared) {
  const problems = []
  const missing = [...found.keys()]
    .filter((name) => !ENV_IGNORED.includes(name) && !declared.has(name))
    .sort()
  if (missing.length) {
    problems.push(
      '.env.example не содержит переменных, которые читает код:\n'
      + missing.map((name) => `    ${name}  — ${path.relative(REPO_ROOT, found.get(name))}`).join('\n'),
    )
  }
  return problems
}

/* ── Флаги коллектора POI ──────────────────────────────────────────────── */

/**
 * Флаги, которые парсер действительно принимает.
 *
 * Берутся из ЕДИНСТВЕННОЙ таблицы опций самого CLI, а не выуживаются
 * регулярным выражением из его текста: regex видит одно написание условия
 * (`a === '--x'`) и слепнет на эквивалентном (`['--x'].includes(a)`), после
 * чего guard подтверждает согласие, которого нет.
 */
export function parserFlags() {
  const flags = acceptedFlags()
  if (!(flags instanceof Set) || !flags.size) {
    throw new Error('collect-pois.mjs: таблица опций CLI пуста')
  }
  return flags
}

/** Флаги, упомянутые в README коллектора. */
export function documentedFlags(readmeText) {
  const flags = new Set()
  for (const match of readmeText.matchAll(/(?<![\w-])(--[a-z][a-z0-9-]*)/g)) flags.add(match[1])
  return flags
}

/** Флаги, которые печатает НАСТОЯЩИЙ `--help`, а не его исходный текст. */
export function helpFlags(helpText) {
  const flags = new Set()
  for (const match of helpText.matchAll(/(?<![\w-])(--[a-z][a-z0-9-]*)/g)) flags.add(match[1])
  return flags
}

/**
 * Сверка ТРЁХ множеств: парсер, фактический вывод `--help` и README.
 *
 * Двух мало: README может сойтись с парсером, пока `--help` умалчивает о
 * половине флагов, — а README при этом отсылает читателя именно к `--help`
 * как к полному списку. Сверка идёт в обе стороны по каждой паре: выдуманный
 * флаг заставляет запускать команду, которая упадёт, а умолчанный прячет
 * существующее поведение.
 */
export function compareFlags(parser, help, documented) {
  const problems = []
  const required = [...parser].filter((flag) => !FLAGS_NOT_REQUIRED_IN_DOCS.includes(flag))
  for (const [label, set] of [['--help', help], ['README коллектора', documented]]) {
    const invented = [...set].filter((flag) => !parser.has(flag)).sort()
    if (invented.length) {
      problems.push(`${label} описывает флаги, которых парсер не принимает: ${invented.join(', ')}`)
    }
    const missing = required.filter((flag) => !set.has(flag)).sort()
    if (missing.length) {
      problems.push(`парсер принимает флаги, которых нет в ${label}: ${missing.join(', ')}`)
    }
  }
  return problems
}

/* ── Прогон ────────────────────────────────────────────────────────────── */

export function runChecks(root = REPO_ROOT) {
  const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
  const sections = []

  sections.push(['стадии verify и CI', compareStages(
    verifyStages(read('package.json')),
    ciStages(read('.github/workflows/verify.yml')),
  )])

  sections.push(['полнота .env.example', compareEnv(
    envNamesInSources([path.join(root, 'src'), path.join(root, 'scripts')]),
    declaredEnvNames(read('.env.example')),
  )])

  /* `--help` берётся ИСПОЛНЕНИЕМ, а не чтением исходного текста: сверять
     документацию с той же строкой, из которой она и списана, значит проверять
     совпадение копии с копией. Запуск локальный, сети и ключей не требует. */
  const help = execFileSync(
    process.execPath,
    [path.join(root, 'scripts/poi-portals/collect-pois.mjs'), '--help'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  sections.push(['флаги коллектора POI', compareFlags(
    parserFlags(),
    helpFlags(help),
    documentedFlags(read('scripts/poi-portals/README.md')),
  )])

  return sections
}

function main() {
  console.log('\nКОНТРАКТЫ ДОКУМЕНТАЦИИ\n')
  let bad = 0
  for (const [title, problems] of runChecks()) {
    console.log(`${title}: ${problems.length === 0 ? 'сходится' : `${problems.length} расхождений`}`)
    for (const problem of problems) console.log(`  ${problem}`)
    bad += problems.length
  }
  console.log(bad === 0 ? '\n✓ документация сходится с кодом\n' : `\n✗ расхождений: ${bad}\n`)
  process.exitCode = bad === 0 ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
