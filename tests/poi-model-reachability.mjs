/**
 * Что остаётся НЕДОСТИЖИМЫМ после коммита 10a.
 *
 * До 10a платный путь держала одна структурная вещь: канонические реестры
 * профилей и цен были пусты, и выбирать было не из чего. С 10a в них по
 * записи, и та защита исчезла. Осталась другая, и этот набор проверяет
 * именно её — не форму контрактов, а отсутствие пути от запуска до
 * оплаченного модельного запроса.
 *
 * Границы набора названы прямо, чтобы он не утверждал больше, чем проверяет.
 * Речь ТОЛЬКО о контрактной цепочке исполнения модельного запроса. У сайта
 * есть отдельная и более ранняя подсистема черновиков POI
 * (`src/lib/poi-intake.ts`), которая ходит в OpenAI своим кодом и своими
 * переменными окружения. Она этим коммитом не затрагивается, к цепочке
 * отношения не имеет, и делать вид, что «в проекте нет вызовов OpenAI», было
 * бы неправдой.
 *
 * ── Что именно доказывается ──────────────────────────────────────────────
 *
 * Утверждение: НИ ОДИН production-исходник не ссылается на модуль
 * исполнителя, и ни одна его модульная ссылка не является нечитаемой.
 * Второе не менее важно первого: ссылка, спецификатор которой вычисляется в
 * рантайме, не опровергает первое утверждение — она делает его недоказуемым.
 * «Недоказуемо» здесь считается отказом, а не разрешением.
 *
 * Отсюда четыре находки, каждая из которых роняет набор ГДЕ УГОДНО в
 * production-дереве, а не только в перечисленных модулях цепочки:
 *
 *   1. ссылка, разрешающаяся в `model-executor.mjs`;
 *   2. непрозрачный спецификатор — не строковый литерал;
 *   3. файл, который не разобрался (parse diagnostics);
 *   4. локальная по виду ссылка, которая никуда не разрешается.
 *
 * Прежняя версия проверяла непрозрачность только у заранее перечисленных
 * модулей цепочки. Обходилось это новым файлом вне списка:
 *
 *     const target = './poi-portals/lib/model-' + 'executor.mjs'
 *     await import(target)
 *
 * Литеральной ссылки нет, файла в списке нет — и набор оставался зелёным.
 *
 * ── Чем разбирается и чем разрешается ────────────────────────────────────
 *
 * Разбор и разрешение — компилятором TypeScript (объявленная зависимость
 * проекта). Разрешение берёт настоящие `compilerOptions` из `tsconfig.json`,
 * поэтому alias `@/*` разрешается в настоящий файл, а не в «непонятную
 * строку». Списка строковых эвристик здесь нет: отдельно обрабатываются
 * только те две формы, которых резолвер модулей не знает по определению —
 * `file:`-URL и абсолютный путь.
 */
import { readFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { PORTALS, SUPPLEMENTARY, ALL_SOURCES } from '../scripts/poi-portals/registry.mjs'
import { acceptedFlags } from '../scripts/poi-portals/collect-pois.mjs'
import {
  buildPortalPlanFragment,
  evaluatePolicy,
  MODEL_INPUT_FIELDS,
  POLICY_STATE_DENIED,
} from '../scripts/poi-portals/lib/model-plan.mjs'
import { PROVIDER_PROFILES } from '../scripts/poi-portals/lib/provider-profile.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rel = (f) => path.relative(repoRoot, f)
const SKIP = new Set(['node_modules', '.next', '.git', '_to_delete', 'dist', 'build', 'coverage', 'tmp'])
const CODE = /\.(mjs|cjs|js|jsx|ts|tsx)$/
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  if (SKIP.has(name) || (name.startsWith('.') && name !== '.github')) return []
  const full = path.join(dir, name)
  return statSync(full).isDirectory() ? walk(full) : [full]
})
const real = (f) => { try { return realpathSync(f) } catch { return path.resolve(f) } }

/* ── Разбор и разрешение ──────────────────────────────────────────────── */

const NODE_BUILTIN = /^node:/

/**
 * Классификация одного спецификатора.
 *
 * `local` — ссылка на файл внутри дерева; `external` — пакет или встроенный
 * модуль; `unresolved` — по виду локальная, но ни во что не разрешается.
 * Последнее — находка, а не пустое место: несуществующий локальный путь
 * означает, что дерево читается неверно, и вывод по нему делать нельзя.
 */
/**
 * Путь → вердикт: обычный существующий файл или «не разрешается».
 *
 * Единственное место, где кандидат превращается в `local`. Раньше две ручные
 * ветки — `file:`-URL и абсолютный путь — возвращали `local` сразу, а
 * `real()` при отсутствии файла молча отдавал `path.resolve`. Из-за этого
 * `import('file:///нет-такого')` и `import('/нет-такого')` не попадали ни в
 * ссылки на исполнитель, ни в неразрешённые: находки не возникало вовсе, и
 * молчание читалось как «всё чисто».
 *
 * Проверяется именно ОБЫЧНЫЙ файл, а не просто существование: каталог, FIFO,
 * сокет и символьное устройство существуют, но модулем не являются, и
 * объявлять их разрешёнными значило бы разрешать то, чего никто не читал.
 *
 * Отдельного `existsSync` здесь нет намеренно. Он тут был и оказался
 * мёртвым: `statSync` на отсутствующем пути бросает, и `catch` ниже уже
 * возвращает `unresolved`. Проверка, которую невозможно провалить, — не
 * проверка, а строка, которая делает вид. Мутация «снять existsSync»
 * выживала именно поэтому: поведение от неё не менялось.
 */
function asExistingFile(candidate) {
  let stats
  /* Отсутствие пути, обрыв символьной ссылки и отказ в доступе — всё это
     «прочитать не удалось», и все три обязаны дать один вердикт. */
  try { stats = statSync(candidate) } catch { return { kind: 'unresolved' } }
  if (!stats.isFile()) return { kind: 'unresolved' }
  return { kind: 'local', file: real(candidate) }
}

function classifySpecifier(fromFile, text, options) {
  if (text.startsWith('file:')) {
    let asPath
    try { asPath = fileURLToPath(text) } catch { return { kind: 'unresolved' } }
    return asExistingFile(asPath)
  }
  if (path.isAbsolute(text)) return asExistingFile(text)
  if (NODE_BUILTIN.test(text)) return { kind: 'external' }
  /* Путь, который существует на диске как обычный файл, разрешён —
     независимо от того, знает ли резолвер модулей это расширение. Так в
     дерево попадают таблицы стилей и прочие не-JS ресурсы: они реальные
     файлы, и объявлять их «ссылкой в никуда» было бы неправдой.
     Не совпало — не отказ: дальше пробует резолвер модулей, который умеет
     достраивать расширение и разрешать alias. */
  if (text.startsWith('.')) {
    const direct = asExistingFile(path.resolve(path.dirname(fromFile), text))
    if (direct.kind === 'local') return direct
  }
  const resolved = ts.resolveModuleName(text, fromFile, options, ts.sys).resolvedModule
  if (resolved) {
    const file = resolved.resolvedFileName
    if (resolved.isExternalLibraryImport || file.includes(`${path.sep}node_modules${path.sep}`)) {
      return { kind: 'external' }
    }
    return { kind: 'local', file: real(file) }
  }
  /* Не разрешилось. Ссылка, начинающаяся с `.`, `/` или `#`, локальна по
     виду, и её неразрешимость — находка. Голое имя — ненайденный пакет. */
  return /^[./#]/.test(text) ? { kind: 'unresolved' } : { kind: 'external' }
}

/**
 * Все модульные ссылки дерева и всё, что помешало их прочитать.
 *
 * Вынесено отдельной функцией не ради красоты: этой же функцией ниже
 * проверяются подставные деревья вне репозитория. Сторож, который умеет
 * проверить только собственный репозиторий, нельзя проверить самому.
 */
export function analyzeTree({ root, dirs, target, options, allowOpaque = [] }) {
  const files = dirs
    .map((d) => path.join(root, d)).filter(existsSync)
    .flatMap((d) => (statSync(d).isDirectory() ? walk(d) : [d]))
    .filter((f) => CODE.test(f))
  const targetReal = target ? real(target) : null
  const findings = { referencesTarget: [], opaque: [], parseFailures: [], unresolvedLocal: [] }
  let literalCount = 0

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(
      file, text, ts.ScriptTarget.ESNext, true,
      /\.tsx$/.test(file) ? ts.ScriptKind.TSX : undefined,
    )
    /* Отсутствие свойства — не «диагностик нет», а «проверить нечем».
       Fail-closed: смена версии компилятора не должна молча выключать
       проверку, которой этот набор доказывает, что файл вообще прочитан.
       Сегодня эта ветка недостижима, и это НЕ предположение: сама
       предпосылка проверяется отдельно ниже — компилятор обязан отдавать
       диагностики массивом. Перестанет отдавать — ветка сработает. */
    if (!Array.isArray(sf.parseDiagnostics)) {
      findings.parseFailures.push(`${path.relative(root, file)}: диагностики разбора недоступны`)
    } else if (sf.parseDiagnostics.length) {
      findings.parseFailures.push(
        `${path.relative(root, file)}: ошибок разбора ${sf.parseDiagnostics.length}`,
      )
    }

    const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
    const handle = (node, kind, owner) => {
      if (node && ts.isStringLiteralLike(node)) {
        literalCount += 1
        const verdict = classifySpecifier(file, node.text, options)
        if (verdict.kind === 'local' && targetReal && verdict.file === targetReal) {
          findings.referencesTarget.push(`${path.relative(root, file)}:${at(node)} ${kind} «${node.text}»`)
        } else if (verdict.kind === 'unresolved') {
          findings.unresolvedLocal.push(`${path.relative(root, file)}:${at(node)} ${kind} «${node.text}»`)
        }
        return
      }
      /* Спецификатор вычисляется. Разрешённые вхождения названы поимённо
         вместе с причиной — молча пропущенных здесь нет. */
      const expression = node ? node.getText(sf).replace(/\s+/g, ' ') : '(аргумента нет)'
      const permitted = allowOpaque.some((a) => path.join(root, a.file) === file
        && a.expression === expression)
      if (!permitted) {
        findings.opaque.push(`${path.relative(root, file)}:${owner ? at(owner) : 0} ${kind} ${expression}`)
      }
    }
    const visit = (node) => {
      if (ts.isImportDeclaration(node)) handle(node.moduleSpecifier, 'import', node)
      else if (ts.isExportDeclaration(node) && node.moduleSpecifier) handle(node.moduleSpecifier, 'export-from', node)
      else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        handle(node.moduleReference.expression, 'import=', node)
      } else if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) handle(node.arguments[0], 'import()', node)
        else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          handle(node.arguments[0], 'require()', node)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return { files, literalCount, ...findings }
}

/* Настоящие compilerOptions проекта: только с ними alias `@/*` разрешается в
   файл, а не остаётся неизвестной строкой. */
const tsconfigPath = path.join(repoRoot, 'tsconfig.json')
const parsedConfig = ts.parseJsonConfigFileContent(
  ts.readConfigFile(tsconfigPath, ts.sys.readFile).config, ts.sys, repoRoot,
)
t('compilerOptions проекта прочитаны и несут alias',
  Boolean(parsedConfig.options.paths && parsedConfig.options.paths['@/*']), true)

/* Предпосылка fail-closed ветки в analyzeTree: диагностики разбора вообще
   существуют и приходят массивом. Без этой проверки ветка была бы догадкой о
   поведении компилятора, а не защитой от его смены. */
t('компилятор отдаёт диагностики разбора массивом',
  Array.isArray(ts.createSourceFile('probe.mjs', 'const x = 1\n', ts.ScriptTarget.ESNext, true).parseDiagnostics),
  true)
t('и наполняет их на битом исходнике',
  ts.createSourceFile('probe.mjs', 'const x = (((\n', ts.ScriptTarget.ESNext, true).parseDiagnostics.length > 0,
  true)

const EXECUTOR = path.join(repoRoot, 'scripts/poi-portals/lib/model-executor.mjs')

/**
 * Разрешённые непрозрачные ссылки — поимённо и с причиной.
 *
 * Не «список исключений», а список мест, про которые проверено, что ссылка
 * файловой быть не может. Строка, собранная из литерала `data:…`, начинается
 * с `data:` при любом значении второго слагаемого, и путём в файловой системе
 * не станет никогда.
 */
const OPAQUE_ALLOWED = [
  {
    file: 'scripts/check-copy-length.mjs',
    expression: "'data:text/javascript;base64,' + Buffer.from(limitsJs).toString('base64')",
    why: 'data:-URL — строка начинается с литерала «data:» и файловым путём быть не может',
  },
]
/* Разрешение обязано быть живым: устаревшее указывает на текст, которого уже
   нет, и молча перестаёт что-либо разрешать. */
for (const entry of OPAQUE_ALLOWED) {
  const full = path.join(repoRoot, entry.file)
  t(`разрешение живо: ${entry.file} — ${entry.why}`,
    existsSync(full) && readFileSync(full, 'utf8').replace(/\s+/g, ' ').includes(entry.expression), true)
}

const REPO = analyzeTree({
  root: repoRoot,
  dirs: ['scripts', 'src', 'app', 'lib', 'components'],
  target: EXECUTOR,
  options: parsedConfig.options,
  allowOpaque: OPAQUE_ALLOWED,
})

/* Разбор обязан что-то находить. Набор, молча не прочитавший ни одной
   ссылки, был бы зелёным по той же причине, что и полностью безопасный. */
t('production-файлов найдено больше сотни', REPO.files.length > 100, true)
t('литеральных модульных ссылок прочитано больше сотни', REPO.literalCount > 100, true)

/* ── Слой 1. РОВНО ОДНА ссылка на исполнитель, и та известна поимённо ───
   До 10f-O здесь стоял пустой список: платного пути не существовало вовсе.
   С 10f-O он существует и закрыт воротами, а не отсутствием кода, — поэтому
   утверждение стало точнее, а не слабее. Ссылка ровно одна, она названа, и
   сравнение идёт по полному списку: ВТОРАЯ ссылка, откуда бы она ни пришла,
   роняет набор так же, как роняла бы первая раньше. Композицию проверяет
   `tests/poi-model-entrypoint.mjs`; здесь — только то, что дверь одна. */
const EXECUTOR_ENTRYPOINT = 'scripts/poi-portals/lib/model-run.mjs'

/* Сравнивается ФАЙЛ, а не строка находки: номер строки и текст спецификатора
   меняются при любой правке импорта, и закреплять их значило бы ломать
   утверждение на переносе строки. Число ссылок при этом закреплено точно. */
t('на model-executor.mjs ссылается ровно один production-файл',
  REPO.referencesTarget.length, 1)
t('и это единственный оркестратор исполнения',
  REPO.referencesTarget[0]?.split(':')[0] ?? '', EXECUTOR_ENTRYPOINT)
t('и пользовательский CLI ссылается на исполнитель не напрямую, а через него',
  REPO.referencesTarget.includes('scripts/poi-portals/collect-pois.mjs'), false)
t('непрозрачных модульных ссылок в production нет',
  REPO.opaque.join('\n  '), '')
t('все production-файлы разобраны без ошибок',
  REPO.parseFailures.join('\n  '), '')
t('локальных ссылок, которые никуда не разрешаются, нет',
  REPO.unresolvedLocal.join('\n  '), '')

/* Транспорт достижим только через исполнителя, а провод приходит параметром. */
const transportSource = readFileSync(path.join(repoRoot, 'scripts/poi-portals/lib/model-transport.mjs'), 'utf8')
t('в транспорте нет своего клиента',
  /from ['"]node:https?['"]|\bfetch\s*\(|require\(['"]node:https?['"]\)/.test(transportSource), false)

/* ── Сторож проверяется на подставных деревьях ────────────────────────── */

/* Каждый случай — рабочий код, а не ухищрение; и каждый обходил прежнюю
   версию этого набора. Деревья строятся во временном каталоге ВНЕ
   репозитория: проверять сторожа на самом репозитории значило бы вносить
   в него заведомо ломающий код. */
const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs')
const { tmpdir } = await import('node:os')

const probeRoot = mkdtempSync(path.join(tmpdir(), 'jj-reach-'))
try {
  mkdirSync(path.join(probeRoot, 'src/lib'), { recursive: true })
  const probeExecutor = path.join(probeRoot, 'src/lib/model-executor.mjs')
  writeFileSync(probeExecutor, 'export function executeModelPlan() {}\n')
  const probeOptions = {
    ...parsedConfig.options,
    paths: { '@/*': ['./src/*'] },
    baseUrl: probeRoot,
  }
  const probe = (name, body) => {
    writeFileSync(path.join(probeRoot, 'src', name), body)
    const out = analyzeTree({
      root: probeRoot, dirs: ['src'], target: probeExecutor, options: probeOptions,
    })
    rmSync(path.join(probeRoot, 'src', name))
    return out
  }

  /* 1. Вычисляемый динамический import в файле ВНЕ цепочки — тот самый
        контрпример, на котором прежняя версия проходила. */
  const computed = probe('unrelated-new-file.mjs',
    "const target = './lib/model-' + 'executor.mjs'\nexport const p = import(target)\n")
  t('вычисляемый import вне цепочки ловится', computed.opaque.length, 1)
  t('и ссылкой на исполнитель при этом не считается', computed.referencesTarget.length, 0)

  /* 2. Литеральный file:-URL на исполнитель. */
  const fileUrl = probe('via-file-url.mjs',
    `export const m = import(${JSON.stringify(`file://${probeExecutor}`)})\n`)
  t('литеральный file:-URL на исполнитель ловится', fileUrl.referencesTarget.length, 1)

  /* 3. Локальный alias и реэкспорт. */
  const alias = probe('via-alias.mjs', "export { executeModelPlan } from '@/lib/model-executor.mjs'\n")
  t('alias с реэкспортом ловится', alias.referencesTarget.length, 1)

  /* 4. Файл, который не разобрался. */
  const broken = probe('broken.mjs', 'export const x = (((\n')
  t('файл с ошибкой разбора ловится', broken.parseFailures.length, 1)

  /* 5. Абсолютный путь — резолвер модулей его не знает по определению. */
  const absolute = probe('via-absolute.mjs',
    `export const m = import(${JSON.stringify(probeExecutor)})\n`)
  t('абсолютный путь на исполнитель ловится', absolute.referencesTarget.length, 1)

  /* 6. Несуществующая локальная ссылка — недоказуемость, а не пустое место. */
  const missing = probe('via-missing.mjs', "export { x } from './нет-такого-файла.mjs'\n")
  t('локальная ссылка в никуда ловится', missing.unresolvedLocal.length, 1)

  /* 7. Чистый файл находок не даёт — иначе сторож ловил бы всё подряд. */
  const clean = probe('clean.mjs', "import path from 'node:path'\nexport const p = path.sep\n")
  t('чистый файл находок не даёт',
    clean.opaque.length + clean.referencesTarget.length
    + clean.parseFailures.length + clean.unresolvedLocal.length, 0)

  /* ── Ручные ветки: file:-URL и абсолютный путь ─────────────────────────
     Обе возвращают `local` только после проверки, что по пути лежит
     ОБЫЧНЫЙ существующий файл. Пока проверки не было, несуществующий путь
     не давал вообще никакой находки: ни ссылки на исполнитель, ни
     неразрешённой ссылки — молчание читалось как «чисто». */

  const missingPath = path.join(probeRoot, 'src/lib/нет-такого-файла.mjs')
  const missingUrl = probe('missing-file-url.mjs',
    `export const m = import(${JSON.stringify(`file://${missingPath}`)})\n`)
  t('несуществующий file:-URL — неразрешённая ссылка', missingUrl.unresolvedLocal.length, 1)
  t('и ссылкой на исполнитель он не считается', missingUrl.referencesTarget.length, 0)

  const missingAbs = probe('missing-absolute.mjs',
    `export const m = import(${JSON.stringify(missingPath)})\n`)
  t('несуществующий абсолютный путь — неразрешённая ссылка', missingAbs.unresolvedLocal.length, 1)
  t('и он тоже не ссылка на исполнитель', missingAbs.referencesTarget.length, 0)

  /* Каталог существует, но модулем не является. */
  const dirPath = path.join(probeRoot, 'src/lib')
  const dirUrl = probe('dir-file-url.mjs',
    `export const m = import(${JSON.stringify(`file://${dirPath}`)})\n`)
  t('file:-URL на каталог — неразрешённая ссылка', dirUrl.unresolvedLocal.length, 1)

  const dirAbs = probe('dir-absolute.mjs',
    `export const m = import(${JSON.stringify(dirPath)})\n`)
  t('абсолютный путь на каталог — неразрешённая ссылка', dirAbs.unresolvedLocal.length, 1)

  /* Положительные формы обязаны остаться положительными: проверка
     существования не должна превратить рабочую ссылку в находку. */
  t('существующий file:-URL по-прежнему ссылка на исполнитель',
    fileUrl.referencesTarget.length, 1)
  t('и неразрешённой при этом не считается', fileUrl.unresolvedLocal.length, 0)
  t('существующий абсолютный путь по-прежнему ссылка на исполнитель',
    absolute.referencesTarget.length, 1)
  t('и неразрешённой при этом не считается', absolute.unresolvedLocal.length, 0)
} finally {
  rmSync(probeRoot, { recursive: true, force: true })
}

/* ── Слой 2. Ни флага, ни переменной окружения, ни расписания ─────────── */

/* Множество флагов берётся у самого разбора, а не выуживается из исходника. */
const MODEL_FLAGS = [...acceptedFlags()].sort()
  .filter((f) => /model|execute|classif|openai|llm|run/i.test(f))
t('модельные флаги CLI известны поимённо',
  MODEL_FLAGS.join(','), '--model-approval,--model-execute,--model-plan,--model-plan-file,--model-provider-profile')

for (const name of ['model-executor', 'model-transport', 'model-serializers', 'provider-profile',
  'model-pricing', 'execution-cost']) {
  const src = readFileSync(path.join(repoRoot, `scripts/poi-portals/lib/${name}.mjs`), 'utf8')
  t(`${name}.mjs не читает окружение`, /process\.env/.test(src), false)
}

const scheduleFiles = walk(repoRoot).filter((f) => /\.(ya?ml|plist|cron)$/.test(f))
t('ни одно расписание не зовёт исполнителя',
  scheduleFiles.filter((f) => /model-executor|executeModelPlan/.test(readFileSync(f, 'utf8')))
    .map(rel).join(','), '')

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
t('в npm-скриптах нет запуска модельного прогона',
  Object.entries(pkg.scripts)
    .filter(([name]) => name !== 'test' && !name.startsWith('test:'))
    .filter(([, cmd]) => /model-executor|executeModelPlan/.test(cmd)).length, 0)

/* ── Слой 3. Все источники запрещают модельную обработку ──────────────── */

const NOW = new Date('2026-08-17T00:00:00Z')
t('порталов в реестре десять', PORTALS.length, 10)
t('дополнительных источников два', SUPPLEMENTARY.length, 2)
t('всего источников двенадцать', ALL_SOURCES.length, 12)
for (const source of ALL_SOURCES) {
  const p = source.modelProcessing
  t(`${source.id}: провайдеров не разрешено`, p.allowedProviders.length, 0)
  t(`${source.id}: решения владельца нет`, p.decisionRef, null)
  t(`${source.id}: сверки нет`, p.reviewedAt, null)
  t(`${source.id}: срока нет`, p.validUntil, null)
  t(`${source.id}: полей не разрешено`, p.fields.length, 0)
  t(`${source.id}: вердикт policy — запрет`,
    evaluatePolicy(p, { now: NOW, requiredFields: MODEL_INPUT_FIELDS }).state, POLICY_STATE_DENIED)
}

const fragment = buildPortalPlanFragment({
  portal: PORTALS.find((p) => p.id === 'japan-guide'),
  evaluated: [], now: NOW, providerProfile: PROVIDER_PROFILES[0],
})
t('фрагмент japan-guide с владельческим профилем неисполним', fragment.executionPermitted, false)
t('и запрещён именно policy источника', fragment.blockedByPolicy, true)
t('причина запрета названа поимённо', fragment.policyReasons.includes('noAllowedProviders'), true)

/* ── Слой 4. Разрешения владельца не существует ───────────────────────── */

t('файла разрешения в репозитории нет',
  walk(repoRoot).filter((f) => /approval.*\.json$/i.test(path.basename(f))).map(rel).join(','), '')

console.log(bad.length
  ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ')
  : `✓ недостижимость платного пути: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
