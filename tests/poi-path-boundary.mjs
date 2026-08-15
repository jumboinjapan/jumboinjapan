/**
 * Физическая граница пути — на НАСТОЯЩЕЙ файловой системе.
 *
 * Строковая проверка здесь ничего не доказывает: весь класс дефектов в том и
 * состоит, что строка верна, а байты оказываются не там. Поэтому каждый
 * сценарий собирается во временном каталоге вне репозитория, со всеми
 * ссылками, каталогами и висячими ссылками, и убирается в `finally`.
 */
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  ARTIFACT_NAMES,
  assertExclusiveJsonTarget,
  assertExistingRegularFile,
  assertPathContainment,
  ensureDirectoryChain,
} from '../scripts/lib/path-boundary.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e.message } }
const NAMES = ARTIFACT_NAMES.journal

const base = await mkdtemp(path.join(tmpdir(), 'poi-path-'))
try {
  /* ── Названия артефактов ─────────────────────────────────────────────── */

  t('таблица имён заморожена', Object.isFrozen(ARTIFACT_NAMES), true)
  for (const key of ['planReport', 'approval', 'journal']) {
    t(`формы имени ${key} заморожены`, Object.isFrozen(ARTIFACT_NAMES[key]), true)
    t(`формы имени ${key} полны`,
      Object.keys(ARTIFACT_NAMES[key]).sort().join(','), 'genitive,nominative,root,subject')
  }

  /* ── assertExclusiveJsonTarget ───────────────────────────────────────── */

  const root = path.join(base, 'root')
  mkdirSync(root)

  t('свободный путь внутри корня проходит',
    boom(() => assertExclusiveJsonTarget(path.join(root, 'a.json'), { insideDir: root, names: NAMES })),
    '(без ошибки)')
  t('отсутствующий корень — не ошибка',
    boom(() => assertExclusiveJsonTarget(
      path.join(base, 'нет-такого', 'a.json'), { insideDir: path.join(base, 'нет-такого'), names: NAMES },
    )), '(без ошибки)')

  for (const name of ['a.bin', 'a.JSON', 'a.Json', 'a', '.json']) {
    t(`расширение ${JSON.stringify(name)} отвергается`,
      /расширение ровно/.test(boom(() => assertExclusiveJsonTarget(
        path.join(root, name), { insideDir: root, names: NAMES },
      ))), true)
  }

  t('путь вне корня отвергается',
    /обязан быть файлом внутри/.test(boom(() => assertExclusiveJsonTarget(
      path.join(base, 'чужой.json'), { insideDir: root, names: NAMES },
    ))), true)
  /* Проверка расширения стоит раньше вложенности, поэтому каталог без «.json»
     отвергается по имени. Само правило «каталог путём быть не может»
     проверяется корнем, имя которого расширению удовлетворяет. */
  t('каталог без .json отвергается по имени',
    /расширение ровно/.test(boom(() => assertExclusiveJsonTarget(
      root, { insideDir: root, names: NAMES },
    ))), true)
  const rootJson = path.join(base, 'корень.json')
  mkdirSync(rootJson)
  t('сам корень путём быть не может',
    /обязан быть файлом внутри/.test(boom(() => assertExclusiveJsonTarget(
      rootJson, { insideDir: rootJson, names: NAMES },
    ))), true)

  writeFileSync(path.join(root, 'занят.json'), '{}')
  t('занятый файлом путь отвергается',
    /уже существует \(файл\)/.test(boom(() => assertExclusiveJsonTarget(
      path.join(root, 'занят.json'), { insideDir: root, names: NAMES },
    ))), true)
  mkdirSync(path.join(root, 'каталог.json'))
  t('занятый каталогом путь отвергается',
    /уже существует \(каталог\)/.test(boom(() => assertExclusiveJsonTarget(
      path.join(root, 'каталог.json'), { insideDir: root, names: NAMES },
    ))), true)
  symlinkSync(path.join(base, 'нет-цели'), path.join(root, 'висячая.json'))
  t('висячая ссылка считается занятым путём',
    /уже существует \(символьная ссылка\)/.test(boom(() => assertExclusiveJsonTarget(
      path.join(root, 'висячая.json'), { insideDir: root, names: NAMES },
    ))), true)
  t('и для stat её не существует — проверка обязана быть lstat',
    existsSync(path.join(root, 'висячая.json')), false)

  const outside = path.join(base, 'снаружи')
  mkdirSync(outside)
  symlinkSync(outside, path.join(root, 'ссылка'))
  t('символьная ссылка в компоненте пути отвергается',
    /символьная ссылка в пути/.test(boom(() => assertExclusiveJsonTarget(
      path.join(root, 'ссылка', 'a.json'), { insideDir: root, names: NAMES },
    ))), true)
  writeFileSync(path.join(root, 'файл-в-пути'), 'x')
  t('не-каталог в компоненте пути отвергается',
    /не каталог/.test(boom(() => assertExclusiveJsonTarget(
      path.join(root, 'файл-в-пути', 'a.json'), { insideDir: root, names: NAMES },
    ))), true)

  const linkedRoot = path.join(base, 'корень-ссылка')
  symlinkSync(outside, linkedRoot)
  t('корень-символьная ссылка отвергается',
    /сам является символьной ссылкой/.test(boom(() => assertExclusiveJsonTarget(
      path.join(linkedRoot, 'a.json'), { insideDir: linkedRoot, names: NAMES },
    ))), true)
  const fileRoot = path.join(base, 'корень-файл')
  writeFileSync(fileRoot, 'x')
  t('корень-файл отвергается',
    /не является каталогом/.test(boom(() => assertExclusiveJsonTarget(
      path.join(fileRoot, 'a.json'), { insideDir: fileRoot, names: NAMES },
    ))), true)

  /* ── Containment БЕЗ требования свободного leaf ──────────────────────── */

  t('containment пропускает ЗАНЯТЫЙ путь — иначе восстановление невозможно',
    boom(() => assertPathContainment(
      path.join(root, 'занят.json'), { insideDir: root, names: NAMES },
    )), '(без ошибки)')
  t('и всё же отвергает ссылку в компоненте',
    /символьная ссылка в пути/.test(boom(() => assertPathContainment(
      path.join(root, 'ссылка', 'journal.jsonl'), { insideDir: root, names: NAMES },
    ))), true)
  t('и путь наружу',
    /обязан быть файлом внутри/.test(boom(() => assertPathContainment(
      path.join(base, 'чужой'), { insideDir: root, names: NAMES },
    ))), true)

  /* ── Leaf обязан быть обычным файлом ─────────────────────────────────── */

  t('обычный файл проходит',
    boom(() => assertExistingRegularFile(path.join(root, 'занят.json'), { names: NAMES })), '(без ошибки)')
  t('отсутствующий файл отвергается',
    /не найден/.test(boom(() => assertExistingRegularFile(
      path.join(root, 'нет.json'), { names: NAMES },
    ))), true)
  t('каталог на месте файла отвергается',
    /каталог/.test(boom(() => assertExistingRegularFile(
      path.join(root, 'каталог.json'), { names: NAMES },
    ))), true)
  t('висячая ссылка на месте файла отвергается',
    /символьная ссылка/.test(boom(() => assertExistingRegularFile(
      path.join(root, 'висячая.json'), { names: NAMES },
    ))), true)
  symlinkSync(path.join(root, 'занят.json'), path.join(root, 'живая-ссылка.json'))
  t('живая ссылка на настоящий файл — тоже отказ',
    /символьная ссылка/.test(boom(() => assertExistingRegularFile(
      path.join(root, 'живая-ссылка.json'), { names: NAMES },
    ))), true)

  /* ── Цепочка каталогов ───────────────────────────────────────────────── */

  const chainBase = path.join(base, 'цепь')
  mkdirSync(chainBase)
  const created = ensureDirectoryChain(chainBase, ['tmp', 'артефакты', 'исполнение'], { names: NAMES })
  t('цепочка создана целиком', lstatSync(created).isDirectory(), true)
  t('каждый уровень — настоящий каталог',
    ['tmp', path.join('tmp', 'артефакты'), path.join('tmp', 'артефакты', 'исполнение')]
      .every((rel) => lstatSync(path.join(chainBase, rel)).isDirectory()), true)
  t('повторный вызов на существующей цепочке проходит',
    boom(() => ensureDirectoryChain(chainBase, ['tmp', 'артефакты'], { names: NAMES })), '(без ошибки)')

  symlinkSync(outside, path.join(chainBase, 'ссылка'))
  t('ссылка в цепочке отвергается',
    /символьная ссылка в пути/.test(boom(() => ensureDirectoryChain(
      chainBase, ['ссылка', 'дальше'], { names: NAMES },
    ))), true)
  t('и каталог за ней не создан', existsSync(path.join(outside, 'дальше')), false)
  writeFileSync(path.join(chainBase, 'файл'), 'x')
  t('не-каталог в цепочке отвергается',
    /не каталог/.test(boom(() => ensureDirectoryChain(chainBase, ['файл', 'дальше'], { names: NAMES }))), true)
  t('база-ссылка отвергается',
    /доверенная база/.test(boom(() => ensureDirectoryChain(linkedRoot, ['x'], { names: NAMES }))), true)

  /* Каталог, созданный цепочкой, физически внутри базы, а не за ссылкой. */
  const fd = openSync(created, 'r')
  closeSync(fd)
  t('созданный каталог лежит внутри базы', created.startsWith(chainBase + path.sep), true)
} finally {
  await rm(base, { recursive: true, force: true })
}

console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ граница пути: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
