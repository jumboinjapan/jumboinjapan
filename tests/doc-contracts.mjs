/**
 * Отрицательные ветки сторожа контрактов документации.
 *
 * Положительный прогон доказывает, что сегодня всё сходится, и ничего не
 * говорит о том, поймает ли проверка расхождение завтра. Поэтому здесь
 * предъявляются ровно те три расхождения, ради которых сторож написан:
 * переставленная стадия CI, переменная окружения без записи в `.env.example`
 * и флаг, задокументированный мимо парсера.
 *
 * Фикстуры создаются во ВРЕМЕННОМ каталоге вне репозитория: доказывать
 * отрицательную ветку, ломая настоящий проект, значит менять то, что
 * проверяешь.
 */
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  ciStages,
  compareEnv,
  compareFlags,
  compareStages,
  declaredEnvNames,
  documentedFlags,
  envHelperNames,
  envNamesInSources,
  helpFlags,
  parseSource,
  parserFlags,
  verifyStages,
} from '../scripts/check-doc-contracts.mjs'
import { acceptedFlags, helpText } from '../scripts/poi-portals/collect-pois.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e.message } }

/* ── Стадии verify и CI ────────────────────────────────────────────────── */

const PACKAGE = JSON.stringify({
  scripts: { verify: 'npm run lint && npm test && npm run check:docs && npm run build' },
})
const workflowOf = (commands) => [
  'jobs:', '  verify:', '    steps:',
  '      - name: Установка', '        run: npm ci',
  ...commands.flatMap((command) => ['      - name: шаг', `        run: ${command}`]),
].join('\n')

const STAGES = ['npm run lint', 'npm test', 'npm run check:docs', 'npm run build']
t('положительный контроль: стадии совпадают',
  compareStages(verifyStages(PACKAGE), ciStages(workflowOf(STAGES))).length, 0)
t('установка зависимостей в сравнение не входит',
  ciStages(workflowOf(STAGES)).includes('npm ci'), false)
t('переставленная стадия CI ловится',
  compareStages(verifyStages(PACKAGE), ciStages(workflowOf(
    ['npm run lint', 'npm run check:docs', 'npm test', 'npm run build'],
  ))).length, 1)
t('пропущенная стадия CI ловится',
  compareStages(verifyStages(PACKAGE), ciStages(workflowOf(
    ['npm run lint', 'npm test', 'npm run build'],
  ))).length, 1)
t('лишняя стадия CI ловится тоже',
  compareStages(verifyStages(PACKAGE), ciStages(workflowOf([...STAGES, 'npm run check:poi']))).length, 1)
t('сам check:docs из сравнения не изымается',
  compareStages(verifyStages(PACKAGE), ciStages(workflowOf(
    ['npm run lint', 'npm test', 'npm run build'],
  )))[0].includes('check:docs'), true)
t('блочный run отвергается, а не разбирается наугад',
  /блочный run/.test(boom(() => ciStages(workflowOf(STAGES).replace('run: npm test', 'run: |')))), true)
t('workflow без единого run отвергается',
  /ни одного шага run/.test(boom(() => ciStages('jobs:\n  verify:\n'))), true)
t('package.json без verify отвергается',
  /скрипт verify не найден/.test(boom(() => verifyStages('{"scripts":{}}'))), true)

/* Стадия, не начинающаяся с `npm `, раньше молча исчезала из представления, и
   CI без неё объявлялся равным. Ничего не фильтруется: разбор либо видит все
   команды, либо отказывает. */
const WITH_NODE = JSON.stringify({
  scripts: { verify: 'npm run lint && node scripts/extra.mjs && npm test' },
})
t('стадия node … не исчезает при разборе',
  verifyStages(WITH_NODE).join(' | '), 'npm run lint | node scripts/extra.mjs | npm test')
t('пропуск стадии node … в CI ловится',
  compareStages(verifyStages(WITH_NODE), ciStages(workflowOf(['npm run lint', 'npm test']))).length, 1)
t('и отказ называет пропавшую команду',
  compareStages(verifyStages(WITH_NODE), ciStages(workflowOf(['npm run lint', 'npm test'])))[0]
    .includes('node scripts/extra.mjs'), true)
t('CI с той же стадией node … сходится',
  compareStages(verifyStages(WITH_NODE), ciStages(workflowOf(
    ['npm run lint', 'node scripts/extra.mjs', 'npm test'],
  ))).length, 0)
for (const [label, chain] of [
  ['логическое ИЛИ', 'npm run lint || npm test'],
  ['точка с запятой', 'npm run lint ; npm test'],
  ['конвейер', 'npm run lint | tee log'],
  ['перенаправление', 'npm run lint > log'],
]) {
  t(`неподдерживаемый синтаксис verify отвергается: ${label}`,
    /неподдерживаемый разбором синтаксис/.test(
      boom(() => verifyStages(JSON.stringify({ scripts: { verify: chain } })))), true)
}
t('пустой сегмент между && отвергается',
  /пустой сегмент/.test(boom(
    () => verifyStages(JSON.stringify({ scripts: { verify: 'npm run lint &&  && npm test' } })),
  )), true)

/* ── Полнота .env.example ──────────────────────────────────────────────── */

const workspace = await mkdtemp(path.join(tmpdir(), 'doc-contracts-'))
try {
  await mkdir(path.join(workspace, 'src', 'lib'), { recursive: true })
  await writeFile(path.join(workspace, 'src', 'lib', 'direct.ts'),
    'export const token = process.env.FIXTURE_DIRECT\n', 'utf8')
  await writeFile(path.join(workspace, 'src', 'lib', 'helper.ts'),
    "export const model = getEnv('FIXTURE_HELPER')\n", 'utf8')
  await writeFile(path.join(workspace, 'src', 'lib', 'registry.ts'),
    "export const card = { envVar: 'FIXTURE_REGISTRY' }\n", 'utf8')
  await writeFile(path.join(workspace, 'src', 'lib', 'platform.ts'),
    'export const mode = process.env.NODE_ENV\n', 'utf8')

  /* Четыре формы, которых прежняя версия не видела ни одной: вызов обёртки
     `env`, двойные кавычки у обёртки, обращение по индексу и `envVar` в
     двойных кавычках. Каждая из них — переменная, молча пропавшая из сверки. */
  await writeFile(path.join(workspace, 'src', 'lib', 'wrappers.ts'), [
    'function env(name: string) { return process.env[name]?.trim() ?? null }',
    'function getEnv(name: string) { return process.env[name] }',
    "export const a = env('FIXTURE_WRAPPER_SINGLE')",
    'export const b = getEnv("FIXTURE_WRAPPER_DOUBLE")',
    "export const c = process.env['FIXTURE_INDEX_SINGLE']",
    'export const d = process.env["FIXTURE_INDEX_DOUBLE"]',
    'export const e = { envVar: "FIXTURE_REGISTRY_DOUBLE" }',
  ].join('\n'), 'utf8')

  const found = envNamesInSources([path.join(workspace, 'src')])
  const helpersOf = (code) => envHelperNames([parseSource(code, 'fixture.ts')])
  t('обёртки выводятся из чтения окружения по своему параметру',
    [...helpersOf('function env(n) { return process.env[n] }')].join(','), 'env')
  t('функция без чтения окружения обёрткой не считается',
    helpersOf('function plain(n) { return n.trim() }').size, 0)
  t('чтение окружения по чужому имени обёрткой не делает',
    helpersOf('const key = "X"; function almost(n) { return process.env[key] }').size, 0)
  /* Тело длиннее любого окна: у дерева окна нет. */
  const longBody = `function readEnv(name) {\n${'  // '.padEnd(500, 'наполнитель ')}\n  return process.env[name]\n}`
  t('обёртка с телом длиннее 400 знаков находится',
    [...helpersOf(longBody)].join(','), 'readEnv')
  t('стрелка без скобок вокруг параметра находится',
    [...helpersOf('const readEnv = name => process.env[name]')].join(','), 'readEnv')
  t('стрелка со скобками и блоком тоже',
    [...helpersOf('const readEnv = (name) => { return process.env[name] }')].join(','), 'readEnv')
  t('метод объекта тоже',
    [...helpersOf('const box = { readEnv(name) { return process.env[name] } }')].join(','), 'readEnv')
  t('битый файл — отказ с именем, а не пропуск',
    /fixture\.ts: разбор не удался/.test(boom(() => parseSource('function (', 'fixture.ts'))), true)
  for (const name of [
    'FIXTURE_WRAPPER_SINGLE', 'FIXTURE_WRAPPER_DOUBLE',
    'FIXTURE_INDEX_SINGLE', 'FIXTURE_INDEX_DOUBLE', 'FIXTURE_REGISTRY_DOUBLE',
  ]) {
    t(`форма распознана: ${name}`, found.has(name), true)
  }
  const partialWrappers = declaredEnvNames('FIXTURE_DIRECT=\nFIXTURE_HELPER=\nFIXTURE_REGISTRY=\n')
  const wrapperMissing = compareEnv(found, partialWrappers)
  t('переменные из этих форм попадают в отказ', wrapperMissing.length, 1)
  for (const name of [
    'FIXTURE_WRAPPER_SINGLE', 'FIXTURE_WRAPPER_DOUBLE',
    'FIXTURE_INDEX_SINGLE', 'FIXTURE_INDEX_DOUBLE', 'FIXTURE_REGISTRY_DOUBLE',
  ]) {
    t(`и называются поимённо: ${name}`, wrapperMissing[0].includes(name), true)
  }
  t('находятся все прежние три способа чтения окружения', found.size, 9)
  const full = declaredEnvNames([
    'FIXTURE_DIRECT=', 'FIXTURE_HELPER=', '# комментарий', 'FIXTURE_REGISTRY=значение',
    'FIXTURE_WRAPPER_SINGLE=', 'FIXTURE_WRAPPER_DOUBLE=',
    'FIXTURE_INDEX_SINGLE=', 'FIXTURE_INDEX_DOUBLE=', 'FIXTURE_REGISTRY_DOUBLE=',
  ].join('\n') + '\n')
  t('положительный контроль: .env.example полон', compareEnv(found, full).length, 0)
  t('NODE_ENV не требуется в .env.example', compareEnv(found, full)[0], undefined)

  const partial = declaredEnvNames([
    'FIXTURE_DIRECT=', 'FIXTURE_REGISTRY=',
    'FIXTURE_WRAPPER_SINGLE=', 'FIXTURE_WRAPPER_DOUBLE=',
    'FIXTURE_INDEX_SINGLE=', 'FIXTURE_INDEX_DOUBLE=', 'FIXTURE_REGISTRY_DOUBLE=',
  ].join('\n') + '\n')
  const missing = compareEnv(found, partial)
  t('отсутствующая переменная ловится', missing.length, 1)
  t('и называется поимённо', missing[0].includes('FIXTURE_HELPER'), true)
  t('а лишнего в отказ не попадает', missing[0].includes('FIXTURE_DIRECT'), false)
  t('закомментированная строка объявлением не считается',
    declaredEnvNames('# FIXTURE_DIRECT=\n').size, 0)
} finally {
  await rm(workspace, { recursive: true, force: true })
}

/* ── Флаги коллектора ──────────────────────────────────────────────────── */

/* ── Флаги коллектора ──────────────────────────────────────────────────── */

/* Канонический источник — таблица опций самого CLI. Guard берёт множество
   оттуда, а не выуживает регулярным выражением из текста разбора. */
const CANON = parserFlags()
t('parserFlags берёт множество из таблицы опций CLI',
  [...CANON].sort().join(',') === [...acceptedFlags()].sort().join(','), true)
t('и оно непустое', CANON.size > 0, true)
t('настоящий --help строится из той же таблицы',
  compareFlags(CANON, helpFlags(helpText()), documentedFlags(helpText())).length, 0)

const REAL_HELP = helpFlags(helpText())
const REAL_README = documentedFlags(
  readFileSync(new URL('../scripts/poi-portals/README.md', import.meta.url), 'utf8'),
)
t('положительный контроль всех трёх множеств на настоящем проекте',
  compareFlags(CANON, REAL_HELP, REAL_README).length, 0)

/* Новый флаг добавлен в каноническую таблицу, но забыт в справке и в README —
   ровно тот случай, ради которого сверяются три множества, а не два. */
const WITH_NEW = new Set([...CANON, '--future'])
const missingEverywhere = compareFlags(WITH_NEW, REAL_HELP, REAL_README)
t('новый флаг, отсутствующий и в --help, и в README, даёт два отказа',
  missingEverywhere.length, 2)
t('и оба называют его', missingEverywhere.every((problem) => problem.includes('--future')), true)
t('отказ различает места',
  missingEverywhere[0].includes('--help') && missingEverywhere[1].includes('README'), true)
const onlyHelpGap = compareFlags(WITH_NEW, REAL_HELP, new Set([...REAL_README, '--future']))
t('новый флаг, отсутствующий только в --help, ловится', onlyHelpGap.length, 1)
t('и назван вместе с местом',
  onlyHelpGap[0].includes('--future') && onlyHelpGap[0].includes('--help'), true)
const onlyReadmeGap = compareFlags(WITH_NEW, new Set([...REAL_HELP, '--future']), REAL_README)
t('новый флаг, отсутствующий только в README, ловится', onlyReadmeGap.length, 1)
t('и назван вместе с местом',
  onlyReadmeGap[0].includes('--future') && onlyReadmeGap[0].includes('README'), true)

/* Выдуманный флаг — в обратную сторону. */
t('выдуманный флаг в README ловится',
  compareFlags(CANON, REAL_HELP, new Set([...REAL_README, '--apply']))[0].includes('--apply'), true)
t('выдуманный флаг в --help ловится тоже',
  compareFlags(CANON, new Set([...REAL_HELP, '--apply']), REAL_README)[0].includes('--apply'), true)
t('псевдоним -h перечислять не обязательно', CANON.has('-h') && !REAL_HELP.has('-h'), true)
t('флаги --help извлекаются из вывода, а не из исходника',
  [...helpFlags('  --portal <id>      прогнать один портал')].join(','), '--portal')
t('дефис внутри слова флагом не считается',
  documentedFlags('идентичность кода — commit').has('--commit'), false)

console.log(bad.length
  ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ')
  : `✓ контракты документации: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
