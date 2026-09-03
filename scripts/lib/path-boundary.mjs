/**
 * Физическая граница пути локального артефакта.
 *
 * Выделена из `scripts/lib/report-writer.mjs`, потому что потребителей стало
 * трое: отчёт с планом, файл разрешения владельца и журнал исполнения. Две
 * реализации одной проверки расходятся молча, а расходятся они на том, где
 * окажутся байты.
 *
 * Строка описывает намерение, файловая система — результат. `startsWith`
 * доказывает лексическое вложение и ничего не говорит о том, куда уйдёт
 * запись; `stat` не видит висячую ссылку, по которой писать нельзя;
 * приведение регистра расширяет множество принимаемых имён, не расширяя
 * множество обнаруживаемых уборкой. Поэтому проверок несколько и они
 * раздельные.
 *
 * Containment родителей и свобода leaf РАЗДЕЛЕНЫ намеренно: восстановление
 * прерванного журнала обязано открыть уже существующий файл, и слитая
 * проверка сделала бы восстановление невозможным.
 *
 * Гонки этот модуль не закрывает и не обещает закрывать. Между `lstat` и
 * `mkdir` родительский каталог можно подменить, и exclusive-флаги открытия
 * от этого не спасают: `wx` и `ax` атомарны относительно САМОГО ИМЕНИ файла,
 * а не относительно пути к нему. Они закрывают ровно одну гонку — между
 * проверкой занятости leaf и его созданием.
 */
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync } from 'node:fs'
import path from 'node:path'

/**
 * Названия артефактов в сообщениях об ошибке.
 *
 * Русский требует нескольких форм одного слова, поэтому это таблица форм, а
 * не одна строка. Формы у отчёта с планом дословно те же, что были в
 * `report-writer.mjs` до выделения: сообщения этой границы закреплены
 * профильным набором плана, и менять их выделением модуля нельзя.
 */
export const ARTIFACT_NAMES = Object.freeze({
  planReport: Object.freeze({
    root: 'каталог отчётов',
    subject: 'отчёт с планом',
    genitive: 'отчёта',
    nominative: 'Отчёт с планом',
  }),
  planEnvelope: Object.freeze({
    root: 'каталог отчётов',
    subject: 'исполняемый конверт плана',
    genitive: 'конверта плана',
    nominative: 'Конверт плана',
  }),
  approval: Object.freeze({
    root: 'каталог разрешений',
    subject: 'разрешение владельца',
    genitive: 'разрешения',
    nominative: 'Разрешение владельца',
  }),
  journal: Object.freeze({
    root: 'каталог исполнений',
    subject: 'журнал исполнения',
    genitive: 'журнала',
    nominative: 'Журнал исполнения',
  }),
  executionReport: Object.freeze({
    root: 'каталог исполнения',
    subject: 'отчёт исполнения',
    genitive: 'отчёта исполнения',
    nominative: 'Отчёт исполнения',
  }),
})

function assertRootDirectory(root, names) {
  /* Сам корень — тоже часть пути, и канонизировать его нельзя: `realpath`
     разрешил бы ссылку и тем самым узаконил обход. Запись ушла бы наружу, а
     штатная уборка внутрь корневой ссылки не заходит и файла не нашла бы.
     Если каталога ещё нет — это не ошибка: его создаст запись настоящим
     каталогом. */
  let rootStat = null
  try {
    rootStat = lstatSync(root)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (rootStat?.isSymbolicLink()) {
    throw new Error(
      `${root}: ${names.root} сам является символьной ссылкой. Физическое нахождение файлов `
      + 'внутри него она не гарантирует, а уборка по сроку внутрь ссылки не заходит.',
    )
  }
  if (rootStat && !rootStat.isDirectory()) {
    throw new Error(`${root}: ${names.root} не является каталогом.`)
  }
}

function assertLexicalContainment(target, root, names) {
  if (!target.startsWith(root + path.sep)) {
    throw new Error(
      `${target}: ${names.subject} обязан быть файлом внутри ${root}${path.sep}. `
      + 'Сам каталог путём ' + names.genitive + ' быть не может.',
    )
  }
}

function assertRealDirectoryChain(target, root, names) {
  const relative = path.relative(root, path.dirname(target))
  let current = root
  for (const part of relative ? relative.split(path.sep) : []) {
    current = path.join(current, part)
    let stat = null
    try {
      stat = lstatSync(current)
    } catch (error) {
      if (error.code === 'ENOENT') break // дальше ничего не существует — создадим сами
      throw error
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `${current}: символьная ссылка в пути ${names.genitive}. Физическое нахождение файла внутри `
        + `${root} она не гарантирует, а запись ушла бы туда, куда ссылка указывает.`,
      )
    }
    if (!stat.isDirectory()) {
      throw new Error(`${current}: не каталог — путь ${names.genitive} через него не проходит.`)
    }
  }
}

function assertLowercaseJsonName(target, names) {
  if (path.extname(target) !== '.json') {
    throw new Error(
      `${target}: ${names.subject} обязан иметь расширение ровно «.json» в нижнем регистре — `
      + 'уборка по сроку ищет «*.json», и файл с другим именем переживёт свой срок незамеченным.',
    )
  }
}

function assertFreeLeaf(target, names) {
  /* `lstat`, а не `stat`: висячая ссылка на месте файла для `stat` не
     существует, а записать по ней нельзя — и указывает она наружу.

     `ENOTDIR` здесь равносилен `ENOENT`: если один из родителей не каталог,
     leaf не существует и существовать не может. Отказ всё равно будет —
     его выдаст проверка компонентов, и выдаст с честным диагнозом, а не
     системной ошибкой из середины другой проверки. */
  let entry = null
  try {
    entry = lstatSync(target)
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
  }
  if (entry) {
    const kind = entry.isSymbolicLink() ? 'символьная ссылка' : entry.isDirectory() ? 'каталог' : 'файл'
    throw new Error(
      `${target} уже существует (${kind}). `
      + `${names.nominative} не перезаписывается: выберите другое имя или разберитесь с прежним путём.`,
    )
  }
}

/**
 * Граница пути для артефакта, который создаётся один раз и не
 * перезаписывается: имя, вложенность, свобода leaf и настоящие каталоги во
 * всех существующих компонентах.
 *
 * Порядок проверок закреплён и значим: сначала корень, потом имя, потом
 * лексическое вложение, потом занятость, и только затем цепочка компонентов.
 * Он же был в `report-writer.mjs` до выделения.
 */
export function assertExclusiveJsonTarget(target, { insideDir, names } = {}) {
  const resolved = path.resolve(target)
  const root = path.resolve(insideDir)
  assertRootDirectory(root, names)
  assertLowercaseJsonName(resolved, names)
  assertLexicalContainment(resolved, root, names)
  assertFreeLeaf(resolved, names)
  assertRealDirectoryChain(resolved, root, names)
}

/**
 * Только физическая граница, БЕЗ требования свободного leaf.
 *
 * Нужна восстановлению: журнал прерванного исполнения обязан открываться
 * существующим. Слить эту проверку с `assertExclusiveJsonTarget` нельзя —
 * получилось бы, что восстановление возможно только там, где файла нет.
 */
export function assertPathContainment(target, { insideDir, names } = {}) {
  const resolved = path.resolve(target)
  const root = path.resolve(insideDir)
  assertRootDirectory(root, names)
  assertLexicalContainment(resolved, root, names)
  assertRealDirectoryChain(resolved, root, names)
}

/**
 * Leaf обязан быть существующим ОБЫЧНЫМ файлом.
 *
 * Containment родителей этого не даёт: внутри проверенного каталога может
 * лежать ссылка, каталог, FIFO или висячая ссылка с нужным именем. Чтение
 * по ним даёт либо чужие байты, либо блокировку.
 */
export function assertExistingRegularFile(target, { names } = {}) {
  const resolved = path.resolve(target)
  let entry = null
  try {
    entry = lstatSync(resolved)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (!entry) {
    throw new Error(`${resolved}: ${names.subject} не найден.`)
  }
  if (!entry.isFile()) {
    const kind = entry.isSymbolicLink() ? 'символьная ссылка' : entry.isDirectory() ? 'каталог' : 'не обычный файл'
    throw new Error(
      `${resolved}: на месте ${names.genitive} — ${kind}. Читать по нему нельзя: `
      + 'байты придут не оттуда, откуда ожидалось.',
    )
  }
}

/** Синхронизация каталога: создание записи в нём — изменение самого каталога. */
function fsyncDirectory(dir) {
  const fd = openSync(dir, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Цепочка каталогов от ДОВЕРЕННОЙ существующей базы, по одному уровню.
 *
 * `mkdir` с `recursive: true` не годится по двум причинам: он создаёт
 * пропущенные уровни молча, минуя проверку каждого компонента, и не даёт
 * точки, в которой можно синхронизировать родителя только что созданного
 * каталога. Каждый созданный каталог фиксируется `fsync` его родителя;
 * существующий каталог не синхронизируется — лишний вызов ничего не
 * доказывает и мешает читать журнал вызовов.
 */
export function ensureDirectoryChain(base, segments, { names } = {}) {
  let current = path.resolve(base)
  const baseStat = lstatSync(current)
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) {
    throw new Error(`${current}: доверенная база ${names.genitive} не является настоящим каталогом.`)
  }
  for (const segment of segments) {
    const parent = current
    current = path.join(current, segment)
    let stat = null
    try {
      stat = lstatSync(current)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (stat === null) {
      mkdirSync(current)
      fsyncDirectory(parent)
      continue
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `${current}: символьная ссылка в пути ${names.genitive}. Физическое нахождение файла `
        + 'внутри неё не гарантируется, а запись ушла бы туда, куда ссылка указывает.',
      )
    }
    if (!stat.isDirectory()) {
      throw new Error(`${current}: не каталог — путь ${names.genitive} через него не проходит.`)
    }
  }
  return current
}
