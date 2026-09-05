#!/usr/bin/env node
/**
 * Разбор графа импортов — чистый контракт (10f-Q R2, P08.1).
 *
 *   node tests/poi-code-graph.mjs
 *
 * Состав исполняемой цепочки больше не объявляется правилом по каталогам —
 * он выводится обходом импортов. Значит, цена ошибки переехала в РАЗБОР: если
 * сканер пропустит импорт, файл молча выпадет из отпечатка, и вернётся ровно
 * тот дефект, который аудит предъявил на `src/lib/prefectures.ts` и
 * `config/poi-coordinate-decisions.v1.json`.
 *
 * Поэтому здесь проверяется сам сканер: что он находит, чего не выдумывает и
 * где отказывается. Обход по настоящему дереву — tests/poi-prewrite-gate.mjs.
 */
import { CODE_GRAPH_SPEC, scanModuleSpecifiers, stripCommentsAndStrings } from '../scripts/poi-portals/lib/code-graph.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e.message } }
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${String(text).slice(0, 200)}» нет «${needle}»`)
}
/* Отказ сканера здесь — это ПРОВАЛ проверки, а не крушение набора: иначе
   мутация убивалась бы исключением, а не поимённой проверкой. */
const specs = (source) => {
  try { return scanModuleSpecifiers(source, 'проба').join('|') } catch (e) { return `ОТКАЗ: ${e.message}` }
}

/* ── 1. Формы импорта, которые в этом дереве встречаются ───────────────── */
{
  t('именованный импорт', specs("import { a } from './x.mjs'"), './x.mjs')
  t('импорт по умолчанию', specs("import x from './x.mjs'"), './x.mjs')
  t('импорт пространства имён', specs("import * as x from './x.mjs'"), './x.mjs')
  t('побочный импорт без привязки', specs("import './side.mjs'"), './side.mjs')
  t('реэкспорт', specs("export { a } from './x.mjs'"), './x.mjs')
  t('реэкспорт всего', specs("export * from './x.mjs'"), './x.mjs')
  t('JSON-импорт с атрибутом типа', specs("import r from '../../config/r.json' with { type: 'json' }"), '../../config/r.json')
  t('многострочный список имён', specs("import {\n  a,\n  b,\n} from './x.mjs'"), './x.mjs')
  t('двойные кавычки', specs('import { a } from "./x.mjs"'), './x.mjs')
  t('динамический импорт с литералом', specs("const m = await import('./x.mjs')"), './x.mjs')
  t('несколько импортов в одном файле',
    specs("import { a } from './a.mjs'\nimport b from '../b/c.ts'\nexport * from './d.mjs'\n"), './a.mjs|../b/c.ts|./d.mjs')
  t('голые спецификаторы тоже возвращаются — отсеивает их обход, а не сканер',
    specs("import { readFile } from 'node:fs/promises'\nimport { parse } from 'csv-parse/sync'"), 'node:fs/promises|csv-parse/sync')
}

/* ── 2. Чего сканер выдумывать не должен ───────────────────────────────
   Ложный импорт так же вреден, как пропущенный: он вводит в отпечаток файл,
   которого цепочка не грузит, и любая правка рядом объявляется дрейфом. */
{
  t('строчный комментарий импортом не является', specs("// import { a } from './нет.mjs'\nexport const a = 1"), '')
  t('блочный комментарий импортом не является', specs("/* import { a } from './нет.mjs' */\nexport const a = 1"), '')
  t('спецификатор внутри JSDoc не считается', specs("/**\n * import { x } from './док.mjs'\n */\nexport const a = 1"), '')
  t('строка с текстом «import» импортом не является', specs("const s = \"import { a } from './нет.mjs'\"\n"), '')
  t('слово from в обычной строке ничего не даёт', specs("const s = 'взято from базы'\nexport const a = 1"), '')
  t('шаблонная строка с import() не считается', specs('const s = `await import("./нет.mjs")`\n'), '')
  t('свойство с именем from не считается', specs("const o = { from: './нет.mjs' }\n"), '')
  t('комментарий ПОСЛЕ настоящего импорта его не отменяет',
    specs("import { a } from './есть.mjs' // import { b } from './нет.mjs'\n"), './есть.mjs')
  t('регулярный литерал со слэшами не ломает разбор',
    specs("const re = /from '\\/etc'/\nimport { a } from './есть.mjs'\n"), './есть.mjs')
}

/* ── 2б. Шаблонная строка — не строка целиком (10f-Q R3, находка аудита 2) ──
   `${…}` внутри шаблона — обычный исполняемый код. В R2 содержимое шаблона
   выбрасывалось целиком, и `` `${(await import('./hidden.mjs')).h}` `` грузил
   модуль, которого в графе не было: правка файла отпечаток не двигала
   (`tmp/10f-q-r3-repro-template-json-OLD-2026-09-04.log`). */
{
  t('импорт внутри интерполяции виден',
    specs("export const s = `${(await import('./hidden.mjs')).h}`"), './hidden.mjs')
  t('текст шаблона импортом не является', specs("const s = `взято from './нет.mjs'`"), '')
  t('текст шаблона со словом import тоже', specs('const s = `import { a } from "./нет.mjs"`'), '')
  /* Закрытие `${…}` возвращает разбор В ТЕКСТ ТОГО ЖЕ шаблона, а не в код:
     иначе хвост шаблона читался бы как программа. */
  t('хвост шаблона после интерполяции — по-прежнему текст',
    specs("const s = `${x} import { a } from './нет.mjs'`"), '')
  t('  и это не мешает импорту в самой интерполяции',
    specs("const s = `${(await import('./есть.mjs')).h} from './нет.mjs'`"), './есть.mjs')
  t('вложенный шаблон внутри интерполяции разбирается',
    specs("const s = `a${ `b${ (await import('./deep.mjs')).x }c` }d`"), './deep.mjs')
  t('обычная строка внутри интерполяции остаётся строкой',
    specs("const s = `${ ({ from: './нет.mjs' }) }`"), '')
  t('несколько интерполяций — несколько импортов',
    specs("const s = `${(await import('./a.mjs')).x}${(await import('./b.mjs')).y}`"), './a.mjs|./b.mjs')
  t('шаблон после настоящего импорта его не отменяет',
    specs("import { a } from './есть.mjs'\nconst s = `${a}`"), './есть.mjs')
  t('экранированная обратная кавычка шаблон не закрывает',
    specs("const s = `a\\`b${ (await import('./c.mjs')).x }`"), './c.mjs')
  has('нелитеральный import() внутри шаблона — тот же отказ',
    boom(() => scanModuleSpecifiers('const s = `${ await import(name) }`', 'ф.mjs')), 'нелитеральным аргументом')
}

/* ── 3. Границы названы, а не подразумеваются ──────────────────────────── */
{
  has('нелитеральный import() — отказ', boom(() => scanModuleSpecifiers("await import(name)", 'файл.mjs')), 'нелитеральным аргументом')
  has('  и назван файл', boom(() => scanModuleSpecifiers('await import(name)', 'файл.mjs')), 'файл.mjs')
  has('  и назван домен', boom(() => scanModuleSpecifiers('await import(name)', 'ф.mjs')), CODE_GRAPH_SPEC)
  has('склейка в import() — тоже отказ', boom(() => scanModuleSpecifiers("await import('./' + name)", 'ф.mjs')), 'нелитеральным аргументом')
}

/* ── 3б. Полнота разбора: незнакомый `import` — отказ, а не тишина ───────
   Сканер не парсер, и следующую незнакомую форму разбор шаблонов уже не
   закроет. Поэтому проверяется не форма, а ПОЛНОТА: каждое ключевое слово
   `import` в очищенном тексте обязано оказаться одной из четырёх разобранных
   конструкций. Цена ошибки падает на прогон, а не на доказательство. */
{
  t('import.meta импортом не считается и отказа не вызывает', specs('const d = import.meta.dirname'), '')
  t('  и не мешает настоящему импорту',
    specs("import { a } from './x.mjs'\nconst d = import.meta.dirname"), './x.mjs')
  has('объявление import без from — отказ', boom(() => scanModuleSpecifiers("import { a }\nconst x = 1", 'ф.mjs')), 'не разобранная форма импорта')
  has('  и назван файл', boom(() => scanModuleSpecifiers('import { a }', 'ф.mjs')), 'ф.mjs')
  has('  и показано окружение', boom(() => scanModuleSpecifiers('import { странное }', 'ф.mjs')), 'странное')
  has('«from» за следующим import не засчитывается предыдущему',
    boom(() => scanModuleSpecifiers("import { a }\nimport { b } from './b.mjs'", 'ф.mjs')), 'не разобранная форма импорта')
  t('два законных объявления подряд разбираются оба',
    specs("import { a } from './a.mjs'\nimport { b } from './b.mjs'"), './a.mjs|./b.mjs')
}

/* ── 4. Очистка текста — отдельно проверяемый шаг ──────────────────────── */
{
  t('содержимое комментария выброшено', stripCommentsAndStrings('a // ъ\nb'), 'a \nb')
  t('содержимое блочного комментария выброшено', stripCommentsAndStrings('a /* ъ */ b'), 'a  b')
  t('содержимое обычной строки обнулено, кавычки на месте', stripCommentsAndStrings("const s = 'ъ'"), "const s = ''")
  t('содержимое строки-спецификатора сохранено',
    stripCommentsAndStrings("import { a } from './x.mjs'"), "import { a } from './x.mjs'")
  t('экранированная кавычка строку не закрывает', stripCommentsAndStrings("const s = 'a\\'b'\nconst t = 1"), "const s = ''\nconst t = 1")
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ граф исполняемого кода: ${ok} проверок пройдено`)
}
