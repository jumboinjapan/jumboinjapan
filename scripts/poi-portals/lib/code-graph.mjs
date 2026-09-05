/**
 * ТОЖДЕСТВО ИСПОЛНЯЕМОГО КОДА — ПО ФАКТИЧЕСКОМУ ГРАФУ ИМПОРТОВ (10f-Q R2).
 *
 * Дефект, который это закрывает. До R2 состав цепочки задавался ПРАВИЛОМ по
 * каталогам (`scripts/poi-portals/**.mjs`, `scripts/lib/**.mjs`, `src/lib/` с
 * перечнем префиксов). Правило — тот же перечень, только записанный иначе, и
 * устаревает оно так же молча: аудит предъявил `src/lib/prefectures.ts` (через
 * него у писателя идёт `canonicalPrefecture`) и
 * `config/poi-coordinate-decisions.v1.json` (реестр решений владельца) —
 * правка обоих сохранила прежний отпечаток и прежние 64 файла
 * (`tmp/10f-q-r2-repro-codetree-OLD-2026-09-04.log`).
 *
 * Поэтому состав больше не объявляется, а ВЫВОДИТСЯ: обход идёт от настоящей
 * точки входа по её собственным импортам, и в отпечаток попадает ровно то, что
 * этот процесс способен загрузить. Новый модуль и новый реестр входят сами —
 * тем, что их кто-то импортировал; забыть внести их в список нельзя, потому
 * что списка нет.
 *
 * Границы обхода названы, а не подразумеваются:
 *   • относительный спецификатор («./», «../») обязан разрешиться в
 *     СУЩЕСТВУЮЩИЙ файл — иначе отказ: недоказанный граф хуже отсутствующего;
 *   • голый спецификатор (`node:fs`, npm-пакет) в отпечаток не входит — он
 *     лежит вне дерева репозитория, его версией управляет `package-lock.json`,
 *     и подписывается он отдельным полем `code.deps`;
 *   • `import()` с нелитеральным аргументом — ОТКАЗ: доказать полноту графа
 *     после него нечем.
 *
 * Чего обход НЕ доказывает: он описывает статический граф, а не порядок
 * исполнения. Модуль, который загрузился, но ни разу не понадобился, в
 * отпечатке будет; ветка, выбранная по данным, отдельного следа не оставит.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Домен digest графа исполняемого кода. */
export const CODE_GRAPH_SPEC = 'poi-code-graph/v1'

/**
 * Готовит исходник к поиску импортов: убирает комментарии и регулярные
 * литералы, обнуляет содержимое строк — кроме позиции спецификатора (сразу
 * после `from`, `import` или `import(`) — и РАЗБИРАЕТ ШАБЛОННЫЕ СТРОКИ.
 *
 * Шаблонная строка — не строка целиком (10f-Q R3, находка аудита 2). Её
 * текстовые куски строками и остаются, а `${…}` — обычный код, который
 * исполняется: `` `${(await import('./hidden.mjs')).h}` `` грузит модуль. В R2
 * содержимое шаблона выбрасывалось целиком, и такой модуль в граф не входил —
 * правка файла отпечаток не двигала (`tmp/10f-q-r3-repro-template-json-OLD-…`).
 * Теперь текст шаблона отбрасывается, а выражения внутри `${…}` разбираются
 * как код, с любой глубиной вложенности.
 *
 * Очистка идёт ДО поиска: искать в неочищенном тексте и отсеивать потом —
 * значит доверять тому, чего не разобрал.
 */
export function stripCommentsAndStrings(source) {
  const out = []
  let i = 0
  const n = source.length
  /* Стек шаблонных строк: каждый элемент — глубина фигурных скобок внутри
     `${…}`. Пустой стек означает «мы в обычном коде». */
  const templates = []
  const prevMeaningful = () => {
    for (let k = out.length - 1; k >= 0; k -= 1) {
      const c = out[k]
      if (c !== ' ' && c !== '\n' && c !== '\t' && c !== '\r') return c
    }
    return ''
  }
  /* Текст шаблона: выбрасывается до `${`, до закрывающей кавычки или до конца. */
  const skipTemplateText = () => {
    while (i < n) {
      if (source[i] === '\\') { i += 2; continue }
      if (source[i] === '`') { i += 1; templates.pop(); out.push(' '); return }
      if (source[i] === '$' && source[i + 1] === '{') {
        i += 2
        templates[templates.length - 1] = 0
        out.push(' ')
        return
      }
      i += 1
    }
  }

  while (i < n) {
    /* Внутри текстовой части шаблона обычные правила не действуют. */
    if (templates.length && templates[templates.length - 1] === null) {
      skipTemplateText()
      continue
    }
    const c = source[i]
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]/.test(prevMeaningful())) {
      /* Регулярный литерал: содержимое выбрасываем целиком. */
      i += 1
      while (i < n && source[i] !== '/' && source[i] !== '\n') {
        if (source[i] === '\\') i += 1
        i += 1
      }
      i += 1
      out.push(' ')
      continue
    }
    if (c === '`') {
      /* Открылась шаблонная строка: текст выбрасываем, `${…}` разберём кодом. */
      templates.push(null)
      i += 1
      out.push(' ')
      continue
    }
    if (templates.length && c === '{') {
      templates[templates.length - 1] += 1
      out.push(c)
      i += 1
      continue
    }
    if (templates.length && c === '}') {
      if (templates[templates.length - 1] === 0) {
        /* Закрылось `${…}` — возвращаемся в текст того же шаблона. */
        templates[templates.length - 1] = null
        out.push(' ')
        i += 1
        continue
      }
      templates[templates.length - 1] -= 1
      out.push(c)
      i += 1
      continue
    }
    if (c === "'" || c === '"') {
      const quote = c
      const body = []
      i += 1
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          body.push(source[i])
          i += 1
          if (i < n) body.push(source[i])
          i += 1
          continue
        }
        body.push(source[i])
        i += 1
      }
      i += 1
      const before = out.join('').trimEnd()
      const inSpecifierPosition = /(?:^|[^A-Za-z0-9_$])(?:from|import)$/.test(before)
        || /(?:^|[^A-Za-z0-9_$])import\s*\($/.test(before)
      out.push(quote, inSpecifierPosition ? body.join('') : '', quote)
      continue
    }
    out.push(c)
    i += 1
  }
  return out.join('')
}

const FROM_RE = /\bfrom\s*(['"`])([^'"`]*)\1/g
const BARE_IMPORT_RE = /\bimport\s*(['"`])([^'"`]*)\1/g
const DYNAMIC_RE = /\bimport\s*\(([^)]*)\)/g
const LITERAL_ARG_RE = /^(['"`])([^'"`]*)\1$/

/**
 * Спецификаторы модулей, объявленные в исходнике. Чистая функция: ни файловой
 * системы, ни разрешения путей — только то, что написано в тексте.
 *
 * Нелитеральный `import()` — отказ с именем файла: полноту графа после него
 * доказать нечем, а молча считать граф полным — ровно та ошибка, которую этот
 * модуль закрывает.
 */
export function scanModuleSpecifiers(source, where) {
  const clean = stripCommentsAndStrings(source)
  const specifiers = []
  for (const re of [FROM_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0
    let m = re.exec(clean)
    while (m) {
      specifiers.push(m[2])
      m = re.exec(clean)
    }
  }
  DYNAMIC_RE.lastIndex = 0
  let dyn = DYNAMIC_RE.exec(clean)
  while (dyn) {
    const arg = dyn[1].trim()
    const literal = LITERAL_ARG_RE.exec(arg)
    if (!literal) {
      throw new Error(
        `${CODE_GRAPH_SPEC}: ${where}: динамический import() с нелитеральным аргументом «${arg.slice(0, 60)}» — `
        + 'полноту графа исполняемого кода доказать нечем. Замените литералом или вынесите в статический импорт.',
      )
    }
    specifiers.push(literal[2])
    dyn = DYNAMIC_RE.exec(clean)
  }
  assertEveryImportAccounted(clean, where)
  return specifiers
}

const IMPORT_TOKEN_RE = /\bimport\b/g
const MODULE_KEYWORD_RE = /\b(?:import|export)\b/g

/**
 * СВЕРКА ПО ХВОСТУ: каждое ключевое слово `import` в очищенном тексте обязано
 * оказаться одной из разобранных конструкций (10f-Q R3, находка аудита 2).
 *
 * Сканер — не полноценный парсер, и молчаливый пропуск незнакомой формы стоит
 * ровно того же, что пропуск файла: модуль исполняется, а отпечаток его не
 * видит. Ровно так и произошло с `import()` внутри шаблонной строки. Разбор
 * шаблонов эту дыру закрыл, но следующую закроет уже не он — поэтому здесь
 * проверяется не форма, а ПОЛНОТА: незнакомый `import` — отказ по имени файла,
 * а не тишина. Цена ошибки при этом падает на прогон, а не на доказательство.
 *
 * Разрешены ровно четыре формы: `import.meta`, `import(…)`, `import '…'` и
 * объявление `import … from '…'` — у последнего `from` обязан найтись раньше
 * следующего `import`/`export`.
 */
function assertEveryImportAccounted(clean, where) {
  const refuse = (position, why) => {
    const around = clean.slice(Math.max(0, position - 20), position + 60).replace(/\s+/g, ' ')
    throw new Error(
      `${CODE_GRAPH_SPEC}: ${where}: не разобранная форма импорта (${why}) около «${around.trim()}» — `
      + 'полноту графа исполняемого кода доказать нечем.',
    )
  }
  IMPORT_TOKEN_RE.lastIndex = 0
  let token = IMPORT_TOKEN_RE.exec(clean)
  while (token) {
    const at = token.index
    const tail = clean.slice(at + 'import'.length)
    const rest = tail.replace(/^\s*/, '')
    if (rest.startsWith('.meta')) {
      /* `import.meta` — не импорт модуля. */
    } else if (rest.startsWith('(') || rest.startsWith("'") || rest.startsWith('"')) {
      /* Динамический импорт и побочный импорт разобраны выше. */
    } else {
      /* Объявление: `from '…'` обязан найтись раньше следующего import/export. */
      MODULE_KEYWORD_RE.lastIndex = at + 'import'.length
      const nextKeyword = MODULE_KEYWORD_RE.exec(clean)
      const limit = nextKeyword ? nextKeyword.index : clean.length
      FROM_RE.lastIndex = at + 'import'.length
      const from = FROM_RE.exec(clean)
      if (!from || from.index >= limit) refuse(at, 'объявление import без спецификатора from')
    }
    token = IMPORT_TOKEN_RE.exec(clean)
  }
}

const isRelative = (specifier) => specifier.startsWith('./') || specifier.startsWith('../')

/**
 * Обходит граф импортов от точки входа и возвращает байты каждого файла графа.
 *
 * @returns {Promise<{files: {path: string, bytes: Buffer}[], external: string[]}>}
 *   `files` — файлы дерева репозитория, отсортированные по пути; `external` —
 *   голые спецификаторы (встроенные модули и npm), отсортированные и без
 *   повторов: в отпечаток они не входят и названы явно.
 */
export async function readCodeGraph(entry, repoRoot) {
  const entryRel = entry.replace(/^\.\//, '')
  const seen = new Map()
  const external = new Set()
  const queue = [entryRel]

  while (queue.length) {
    const rel = queue.shift()
    if (seen.has(rel)) continue
    let bytes
    try {
      bytes = await readFile(path.join(repoRoot, rel))
    } catch (error) {
      throw new Error(`${CODE_GRAPH_SPEC}: файл графа «${rel}» не прочитан — ${error.message}`)
    }
    seen.set(rel, bytes)
    /* JSON-реестры разбирать нечего: импортов в них нет, а байты уже взяты. */
    if (rel.endsWith('.json')) continue
    for (const specifier of scanModuleSpecifiers(bytes.toString('utf8'), rel)) {
      if (!isRelative(specifier)) {
        external.add(specifier)
        continue
      }
      const childRel = path.posix.normalize(path.posix.join(path.posix.dirname(rel), specifier))
      if (childRel.startsWith('..')) {
        throw new Error(
          `${CODE_GRAPH_SPEC}: ${rel} импортирует «${specifier}» за пределами дерева репозитория — `
          + 'тождество такого файла подписать нечем.',
        )
      }
      if (!seen.has(childRel)) queue.push(childRel)
    }
  }

  const files = [...seen.entries()]
    .map(([filePath, bytes]) => ({ path: filePath, bytes }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { files, external: [...external].sort() }
}
