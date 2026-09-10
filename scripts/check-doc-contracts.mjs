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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

/* ── Карта сопровождения POI ─────────────────────────────────────────── */

export const POI_CURRENT_DOCUMENTS = Object.freeze([
  'AGENTS.md',
  'docs/poi-intake/README.md',
  'docs/poi-intake/agent-maintenance-guide.md',
  'docs/poi-intake/airtable-canonicalization.md',
  'docs/poi-intake/change-policy.md',
  'docs/poi-intake/portal-adapter-architecture.md',
  'docs/poi-intake/portal-adapter-rollout-plan.md',
  'docs/poi-intake/runbook.md',
  'docs/poi-writers-registry.md',
  'scripts/README.md',
  'scripts/poi-portals/README.md',
])

export const POI_STATE_DOCUMENTS = Object.freeze([
  'docs/adr/0001-poi-taxonomy-v1.md',
  'docs/poi-intake/parser-completion-ledger.md',
  'docs/poi-intake/pilot-completion-ledger.md',
  'docs/poi-intake/pilot-owner-decisions-2026-09-06.md',
  'docs/poi-intake/poi-completion-dag.md',
  'docs/poi-intake/retired-index.md',
])

export const POI_HISTORICAL_DOCUMENTS = Object.freeze([
  'docs/adr/0002-poi-drift-control-v1.md',
  'docs/poi-integrity-audit.md',
  'docs/poi-intake/p06-matching-decisions-2026-09-03.md',
])

export const RETIRED_POI_PATHS = Object.freeze([
  'docs/handoff-poi-intake-v2-2026-08-11.md',
  'docs/handoff-poi-name-en-required.md',
  'docs/poi-fact-strategy.md',
  'docs/poi-intake-agent.md',
  'docs/poi-intake-contract.md',
  'docs/poi-intake/audits/README.md',
  'docs/poi-intake/audits/fable-5.1-full-audit-handoff-2026-09-02.md',
  'docs/poi-intake/audits/fable-5.1-poi-system-audit-2026-09-02.md',
  'docs/poi-intake/audits/fable-5.1-poi-system-audit-2026-09-02-r2.md',
  'docs/poi-intake/drift-roadmap.md',
  'docs/poi-portal-collector.md',
  'docs/poi-roadmap.html',
  'docs/poi-sources-ranking.md',
  'docs/poi-standard.md',
  'scripts/poi-score.mjs',
])

export const POI_FOREIGN_WIRING_TOKENS = Object.freeze([
  'RESOURCE_HOTEL_',
  'hotels-data',
  'hotels-trip',
  'HotelsExplorer',
  'HotelCard',
  '/resources/hotels',
  '/multi-day/hotels',
  'check:hotel',
])

export function compareRetiredPoiArtifacts(existingPaths) {
  return [...existingPaths]
    .filter((name) => RETIRED_POI_PATHS.includes(name))
    .sort()
    .map((name) => `${name}: удалённый POI-артефакт вернулся в рабочее дерево`)
}

/**
 * Индекс удалённого (`retired-index.md`) и список guard'а — один и тот же состав.
 * Индекс делает ссылку на удалённый документ проверяемой (путь, SHA-256, коммит);
 * guard не даёт документу вернуться. Два независимых списка разошлись бы молча:
 * удалили — и не внесли в индекс, или внесли — и не защитили от возврата.
 * Здесь сравниваются множества путей из таблицы индекса и из `RETIRED_POI_PATHS`.
 */
export function compareRetiredIndex(indexText) {
  const indexed = new Set()
  for (const line of indexText.split('\n')) {
    const match = line.match(/^\| `([^`]+)` \| `[0-9a-f]{64}` \| `[0-9a-f]{7,40}` \|/)
    if (match) indexed.add(match[1])
  }
  const problems = []
  for (const name of RETIRED_POI_PATHS) {
    if (!indexed.has(name)) problems.push(`${name}: удалён, но не внесён в retired-index.md`)
  }
  for (const name of indexed) {
    if (!RETIRED_POI_PATHS.includes(name)) problems.push(`${name}: есть в retired-index.md, но не защищён guard'ом от возврата`)
  }
  return problems
}

/**
 * Отель как класс входа остаётся обязательным отрицательным примером: размещение
 * не должно стать POI. Здесь запрещается не слово `hotel`, а wiring чужой системы —
 * её таблицы, компоненты, данные, маршруты и проверки.
 */
export function comparePoiIsolation(sources) {
  const problems = []
  for (const [name, text] of Object.entries(sources)) {
    for (const token of POI_FOREIGN_WIRING_TOKENS) {
      if (text.includes(token)) problems.push(`${name}: POI-контур ссылается на внешний гостиничный wiring «${token}»`)
    }
  }
  return problems
}

const GUIDE_SECTIONS = Object.freeze([
  '## 2. Иерархия источников истины',
  '## 3. Текущее состояние системы',
  '## 4. Production-поток портального приёма',
  '## 6. Полномочия разделены',
  '## 8. Маршруты изменений',
  '## 9. Протокол аудита',
  '## 10. Проверки и сеть',
  '## 11. Локальные артефакты и восстановление',
  '## 13. Изоляция области',
])

const STALE_CURRENT_CLAIMS = Object.freeze([
  'POI-парсер завершён',
  'production-вызова исполнителя нет',
  'реестр решений есть, записей в нём нет',
  'Сбой записи не виден по коду возврата',
])

/**
 * Проверяет не стиль, а пригодность текущей документации к передаче другой
 * модели. Исторические доказательства и ledger сюда намеренно не входят: они
 * не должны становиться инструкцией.
 */
export function comparePoiDocumentation(documents) {
  const problems = []
  const get = (name) => {
    const value = documents[name]
    if (typeof value === 'string') return value
    problems.push(`нет обязательного current-документа: ${name}`)
    return ''
  }

  const current = Object.fromEntries(POI_CURRENT_DOCUMENTS.map((name) => [name, get(name)]))
  const guide = current['docs/poi-intake/agent-maintenance-guide.md']
  for (const heading of GUIDE_SECTIONS) {
    if (!guide.includes(heading)) problems.push(`карта сопровождения не содержит раздел: ${heading}`)
  }

  for (const name of [
    'AGENTS.md',
    'docs/poi-intake/README.md',
    'docs/poi-intake/runbook.md',
    'scripts/README.md',
    'scripts/poi-portals/README.md',
  ]) {
    if (!current[name].includes('agent-maintenance-guide.md')) {
      problems.push(`${name}: нет ссылки на каноническую карту сопровождения`)
    }
  }

  const readme = current['docs/poi-intake/README.md']
  if (!readme.includes('30/30') || !readme.includes('10 из 10')) {
    problems.push('docs/poi-intake/README.md: нет текущего итога 30/30 и 10 из 10')
  }
  if (!/post-completion/i.test(readme)) {
    problems.push('docs/poi-intake/README.md: завершение парсера не отделено от post-completion работ')
  }
  for (const phrase of [
    'Airtable Intake Core принят',
    'Japan Guide используется в живых партиях; импорт всей очереди и объём 100+ за запуск ещё не подтверждены',
  ]) {
    if (!readme.includes(phrase)) {
      problems.push(`docs/poi-intake/README.md: нет точной границы текущего статуса «${phrase}»`)
    }
  }

  const architecture = current['docs/poi-intake/portal-adapter-architecture.md']
  for (const phrase of [
    '# Архитектура POI: Airtable Intake Core и портальные адаптеры',
    '## 3. Контракт Portal Intake Adapter',
    '## 5. Семейства адаптеров',
    '## 6. Japan Guide: что готово и чего нет',
    'Source/Discovery Adapter',
    'Airtable Intake Core',
  ]) {
    if (!architecture.includes(phrase)) {
      problems.push(`portal-adapter-architecture.md: нет обязательной границы «${phrase}»`)
    }
  }

  const rollout = current['docs/poi-intake/portal-adapter-rollout-plan.md']
  for (const phrase of [
    '# План завершения работающего парсера Japan Guide',
    '## 2. Экономическая модель',
    '## 4. Пакеты реализации',
    '## 6. Условия окончательного завершения Japan Guide',
    ...Array.from({ length: 9 }, (_, index) => `JA-${index}`),
    'PA-1',
  ]) {
    if (!rollout.includes(phrase)) {
      problems.push(`portal-adapter-rollout-plan.md: нет обязательного шага или раздела «${phrase}»`)
    }
  }

  for (const [name, text] of Object.entries(current)) {
    if (/^\s*Last verified commit\s*:/m.test(text)) {
      problems.push(`${name}: current-документ фиксирует быстро устаревающий Last verified commit`)
    }
    for (const claim of STALE_CURRENT_CLAIMS) {
      if (text.includes(claim)) problems.push(`${name}: осталось устаревшее утверждение «${claim}»`)
    }
  }

  if (!guide.includes('другие базы, таблицы, настройки, реестры, артефакты и документацию')) {
    problems.push('карта сопровождения не разделяет настройки и полномочия POI и внешних контуров')
  }
  if (!guide.includes('npm run verify') || !guide.includes('.env.local')) {
    problems.push('карта сопровождения не предупреждает о credentialed read при полном verify')
  }

  for (const name of POI_STATE_DOCUMENTS) {
    const text = get(name)
    if (!text.includes('Canonical current status: docs/poi-intake/README.md')) {
      problems.push(`${name}: документ состояния или решения не ведёт к current-статусу`)
    }
  }

  for (const name of POI_HISTORICAL_DOCUMENTS) {
    const text = get(name)
    if (!/^Status:\s*(historical|target)/m.test(text)) {
      problems.push(`${name}: исторический документ не помечен как historical/target`)
    }
    if (!text.includes('Canonical current status: docs/poi-intake/README.md')) {
      problems.push(`${name}: исторический документ не ведёт к каноническому current-статусу`)
    }
  }

  return problems
}

function poiIsolationSources(root) {
  const files = [...walkSources(path.join(root, 'scripts', 'poi-portals'))]
  for (const [dir, prefix] of [
    [path.join(root, 'src', 'lib'), 'poi-'],
    [path.join(root, 'config'), 'poi-'],
  ]) {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name)
      if (name.startsWith(prefix) && statSync(full).isFile()) files.push(full)
    }
  }
  return Object.fromEntries([...new Set(files)].map((file) => [
    path.relative(root, file),
    readFileSync(file, 'utf8'),
  ]))
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

  const poiDocuments = [
    ...POI_CURRENT_DOCUMENTS,
    ...POI_STATE_DOCUMENTS,
    ...POI_HISTORICAL_DOCUMENTS,
  ]
  sections.push(['карта сопровождения POI', comparePoiDocumentation(
    Object.fromEntries(poiDocuments.map((name) => [name, read(name)])),
  )])
  sections.push(['удалённые POI-артефакты', compareRetiredPoiArtifacts(
    RETIRED_POI_PATHS.filter((name) => existsSync(path.join(root, name))),
  )])
  sections.push(['индекс удалённых POI-документов', compareRetiredIndex(read('docs/poi-intake/retired-index.md'))])
  sections.push(['изоляция POI от гостиничного wiring', comparePoiIsolation(
    poiIsolationSources(root),
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
