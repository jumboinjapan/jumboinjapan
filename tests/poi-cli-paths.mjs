/**
 * Точки входа CLI по РЕАЛЬНОМУ пути файла (дополнение «Астра» A03; дефект
 * `collect-pois.mjs` отложен в R2 10g-C, закрыт здесь).
 *
 * Сравнение `import.meta.url === pathToFileURL(process.argv[1]).href` проходит
 * только при текстуально одинаковых путях. Стоило запустить скрипт из каталога
 * с пробелом или кириллицей, через символическую ссылку или через macOS
 * `/var` вместо `/private/var` — модуль загружался, а main не вызывался:
 * пустой процесс с кодом 0, и никакой проверки не было.
 *
 * Здесь запускаются НАСТОЯЩИЕ дочерние процессы Node в копии дерева, чей путь
 * содержит пробел и кириллицу, а затем та же копия — через символическую
 * ссылку. Признак исполнения — наблюдаемое поведение, а не факт загрузки:
 * неверный флаг обязан дать ненулевой exit code, `--help` — текст помощи,
 * пустой public — штатный отчёт о ссылках, а не ENOENT с `%20`. Импорт всех
 * точек входа из stdin обязан быть тихим: тесты импортируют эти модули.
 */
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { isDirectEntry } from '../scripts/lib/direct-entry.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const copy = mkdtempSync(path.join(tmpdir(), 'poi cli пути '))
const link = `${copy} ссылка`
let checks = 0
const ok = (label, actual, expected) => { checks++; assert.equal(actual, expected, label) }
try {
  for (const directory of ['src', 'scripts', 'config']) cpSync(path.join(root, directory), path.join(copy, directory), { recursive: true })
  cpSync(path.join(root, 'package.json'), path.join(copy, 'package.json'))
  symlinkSync(path.join(root, 'node_modules'), path.join(copy, 'node_modules'), 'dir')
  mkdirSync(path.join(copy, 'public'))
  symlinkSync(copy, link, 'dir')

  /* Единица: сам помощник. Символическая ссылка, пробел и кириллица,
     несуществующий путь, stdin, чужой файл, не-file URL. */
  const self = fileURLToPath(import.meta.url)
  ok('помощник: сам файл — точка входа', isDirectEntry(self, import.meta.url), true)
  ok('помощник: относительный путь к тому же файлу', isDirectEntry(path.relative(process.cwd(), self), import.meta.url), true)
  const linkedCollector = path.join(link, 'scripts/poi-portals/collect-pois.mjs')
  ok('помощник: путь через символическую ссылку равен реальному',
    isDirectEntry(linkedCollector, pathToFileURL(realpathSync(path.join(copy, 'scripts/poi-portals/collect-pois.mjs'))).href), true)
  ok('помощник: URL с процентным кодированием пробела и кириллицы',
    isDirectEntry(path.join(copy, 'package.json'), pathToFileURL(path.join(copy, 'package.json')).href), true)
  ok('помощник: другой файл — нет', isDirectEntry(path.join(copy, 'package.json'), import.meta.url), false)
  ok('помощник: несуществующий путь — нет', isDirectEntry(path.join(copy, 'нет такого.mjs'), import.meta.url), false)
  ok('помощник: stdin («-») — нет', isDirectEntry('-', import.meta.url), false)
  ok('помощник: пустой argv — нет', isDirectEntry(undefined, import.meta.url), false)
  ok('помощник: не file: URL — нет', isDirectEntry(self, 'data:text/javascript,1'), false)
  ok('помощник: URL не строка — нет', isDirectEntry(self, undefined), false)

  const spawn = (base, script, args, options = {}) => spawnSync(process.execPath, [path.join(base, script), ...args], {
    cwd: base, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, AIRTABLE_TOKEN: '', AIRTABLE_BASE_ID: '', GOOGLE_PLACES_API_KEY: '', GOOGLE_MAPS_API_KEY: '' },
    ...options,
  })

  /* Импорт из stdin: ни одна точка входа не стартует. */
  const entrypoints = [
    './scripts/poi-coordinate-decision.mjs',
    './scripts/poi-portals/verify-discovery-baseline.mjs',
    './scripts/poi-portals/lib/weights.mjs',
    './scripts/poi-portals/collect-pois.mjs',
    './scripts/poi-portals/reconcile-writes.mjs',
    './scripts/poi-portals/profile-sources.mjs',
    './scripts/poi-schema/run-taxonomy-schema.mjs',
  ]
  const stdinImport = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd: copy, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, AIRTABLE_TOKEN: '', AIRTABLE_BASE_ID: '' },
    input: entrypoints.map((m) => `await import(${JSON.stringify(m)})`).join('\n'),
  })
  ok('импорт всех точек входа из stdin: exit 0', stdinImport.status, 0)
  ok('импорт из stdin не исполняет CLI (stdout пуст)', stdinImport.stdout, '')

  /* Каждая точка входа — в двух вариантах пути: прямой (пробел + кириллица)
     и через символическую ссылку (на macOS tmpdir сам лежит под /var →
     /private/var, так что прямой вариант уже проходит через ссылку корня). */
  for (const [label, base] of [['путь с пробелом и кириллицей', copy], ['путь через символическую ссылку', link]]) {
    const checked = spawn(base, 'scripts/poi-coordinate-decision.mjs', ['--check'])
    ok(`${label}: coordinate-decision --check exit 0`, checked.status, 0)
    assert.match(checked.stdout, /config\/poi-coordinate-decisions\.v1\.json/, `${label}: --check печатает путь реестра`)
    ok(`${label}: coordinate-decision неверный флаг → 2`, spawn(base, 'scripts/poi-coordinate-decision.mjs', ['--invalid']).status, 2)
    ok(`${label}: verify-discovery-baseline неверный флаг → 1`, spawn(base, 'scripts/poi-portals/verify-discovery-baseline.mjs', ['--invalid']).status, 1)
    const weights = spawn(base, 'scripts/poi-portals/lib/weights.mjs', [])
    ok(`${label}: weights self-test exit 0`, weights.status, 0)
    ok(`${label}: weights печатает таблицу`, weights.stdout.trim().length > 0, true)
    const help = spawn(base, 'scripts/poi-portals/collect-pois.mjs', ['--help'])
    ok(`${label}: collect-pois --help exit 0`, help.status, 0)
    assert.match(help.stdout, /--portal <id>/, `${label}: collect-pois --help печатает флаги`)
    ok(`${label}: collect-pois неверный флаг → 1`, spawn(base, 'scripts/poi-portals/collect-pois.mjs', ['--bogus-flag']).status, 1)
    const reconcile = spawn(base, 'scripts/poi-portals/reconcile-writes.mjs', ['--bogus-flag'])
    ok(`${label}: reconcile-writes неверный аргумент → 1`, reconcile.status, 1)
    assert.match(reconcile.stderr, /Неизвестный аргумент/, `${label}: reconcile-writes отвечает по существу`)
    const images = spawn(base, 'scripts/check-image-refs.mjs', ['--no-airtable'])
    // Пустой public: битые ссылки ожидаемы (exit 1), ENOENT и «%20» — нет.
    ok(`${label}: check-image-refs с пустым public → 1`, images.status, 1)
    assert.match(images.stdout, /public\/:/, `${label}: check-image-refs печатает отчёт`)
    assert.doesNotMatch(images.stderr, /ENOENT|%20/, `${label}: путь public без процентного кодирования`)
  }
  console.log(`✓ точки входа CLI по реальному пути: ${checks} проверок пройдено (пробел, кириллица, символическая ссылка, stdin)`)
} finally {
  rmSync(link, { force: true })
  rmSync(copy, { recursive: true, force: true })
}
