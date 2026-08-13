/**
 * Запись отчёта прогона на диск. Единственное место, где это делается.
 *
 * Режим записи задаётся вызывающим явно и значения по умолчанию не имеет.
 * Причина: два потребителя хотят прямо противоположного, и молчаливое
 * умолчание рано или поздно достанется не тому.
 *
 * `overwrite` — обычный `--out` коллектора. Отчёт прогона перезаписывается,
 * как и раньше: он описывает последний прогон, ссылаться на него по имени
 * никто не обещал.
 *
 * `exclusive` — отчёт с планом модельной классификации. План подписан
 * `planDigest`, и на эту подпись ссылается разрешение владельца на
 * конкретный прогон. Файл, подменённый под тем же именем, делает ссылку
 * ложной, поэтому повтор пути — отказ, а не перезапись.
 */
import { lstatSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Режимы записи. Список закрыт: третьего поведения не предусмотрено. */
export const REPORT_WRITE_MODES = Object.freeze(['overwrite', 'exclusive'])

/**
 * Граница выходного файла для режима `exclusive`. Проверяется ДО работы, а
 * не в момент записи.
 *
 * Четыре отдельные причины отказа, и все обязаны сработать до первого
 * обращения к источнику:
 *
 * 1. Расширение не ровно `.json` в нижнем регистре. Уборка ищет `*.json`;
 *    `.JSON` этому шаблону не соответствует, и файл пережил бы свой срок.
 *    Именно поэтому приведения регистра здесь нет — оно принимало бы имена,
 *    которых уборка не видит.
 * 2. Путь лексически вне отведённого каталога.
 * 3. Путь физически вне каталога. `startsWith` доказывает только лексическое
 *    вложение: `plans/link/x.json` при `plans/link → /куда-то` проходит
 *    строковую проверку, а запись уходит наружу. Поэтому каждый
 *    существующий компонент от корня до родителя обязан быть настоящим
 *    каталогом, а не ссылкой.
 * 4. Путь занят. Проверяется `lstat`, а не `stat`: висячая ссылка на месте
 *    файла для `stat` не существует, а записать по ней нельзя — и она
 *    указывает наружу. Финальный `wx` при этом остаётся: он закрывает гонку
 *    между проверкой и записью, которую проверка закрыть не может.
 */
export function assertExclusiveJsonTarget(outPath, { insideDir } = {}) {
  const target = path.resolve(outPath)
  const root = path.resolve(insideDir)
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
      `${root}: каталог отчётов сам является символьной ссылкой. Физическое нахождение файлов `
      + 'внутри него она не гарантирует, а уборка по сроку внутрь ссылки не заходит.',
    )
  }
  if (rootStat && !rootStat.isDirectory()) {
    throw new Error(`${root}: каталог отчётов не является каталогом.`)
  }

  if (path.extname(target) !== '.json') {
    throw new Error(
      `${target}: отчёт с планом обязан иметь расширение ровно «.json» в нижнем регистре — `
      + 'уборка по сроку ищет «*.json», и файл с другим именем переживёт свой срок незамеченным.',
    )
  }
  if (!target.startsWith(root + path.sep)) {
    throw new Error(
      `${target}: отчёт с планом обязан быть файлом внутри ${root}${path.sep}. `
      + 'Сам каталог путём отчёта быть не может.',
    )
  }

  let entry = null
  try {
    entry = lstatSync(target)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (entry) {
    const kind = entry.isSymbolicLink() ? 'символьная ссылка' : entry.isDirectory() ? 'каталог' : 'файл'
    throw new Error(
      `${target} уже существует (${kind}). `
      + 'Отчёт с планом не перезаписывается: выберите другое имя или разберитесь с прежним путём.',
    )
  }

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
        `${current}: символьная ссылка в пути отчёта. Физическое нахождение файла внутри `
        + `${root} она не гарантирует, а запись ушла бы туда, куда ссылка указывает.`,
      )
    }
    if (!stat.isDirectory()) {
      throw new Error(`${current}: не каталог — путь отчёта через него не проходит.`)
    }
  }
}

export async function writeJsonReport(outPath, report, { mode } = {}) {
  if (!REPORT_WRITE_MODES.includes(mode)) {
    throw new TypeError(
      `writeJsonReport: режим записи обязателен и задаётся явно — ${REPORT_WRITE_MODES.join(' либо ')}; `
      + `получено ${JSON.stringify(mode)}`,
    )
  }
  await mkdir(path.dirname(outPath), { recursive: true })
  try {
    await writeFile(outPath, JSON.stringify(report, null, 2), {
      encoding: 'utf8',
      // 'wx' — создать или отказать; 'w' — прежнее поведение с перезаписью.
      flag: mode === 'exclusive' ? 'wx' : 'w',
    })
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(
        `${outPath} уже существует. Отчёт с планом не перезаписывается: выберите другое имя `
        + 'или удалите прежний файл сами, посмотрев, что в нём.',
      )
    }
    throw error
  }
}
