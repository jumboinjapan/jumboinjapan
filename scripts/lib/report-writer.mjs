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
 * `exclusive` — отчёт с планом модельной классификации либо итоговый отчёт
 * модельного исполнения. Оба принадлежат конкретному подписанному прогону;
 * файл, подменённый под тем же именем, делает эту принадлежность ложной,
 * поэтому повтор пути — отказ, а не перезапись.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { assertExactKeys, canonicalJsonBytes } from './canonical-contract.mjs'
import { ARTIFACT_NAMES, assertExclusiveJsonTarget as assertExclusiveTarget } from './path-boundary.mjs'

/** Режимы записи. Список закрыт: третьего поведения не предусмотрено. */
export const REPORT_WRITE_MODES = Object.freeze(['overwrite', 'exclusive'])

/**
 * Граница выходного файла для режима `exclusive`. Проверяется ДО работы, а
 * не в момент записи.
 *
 * Сами проверки живут в `path-boundary.mjs`: тех же четырёх причин отказа
 * теперь требуют разрешение владельца и журнал исполнения, а две реализации
 * одной границы расходятся молча. Здесь остаётся подстановка названия
 * артефакта — сообщения об ошибке от выделения не изменились ни на знак.
 *
 * 1. Расширение не ровно `.json` в нижнем регистре. Уборка ищет `*.json`;
 *    `.JSON` этому шаблону не соответствует, и файл пережил бы свой срок.
 * 2. Путь лексически вне отведённого каталога.
 * 3. Путь физически вне каталога: каждый существующий компонент от корня до
 *    родителя обязан быть настоящим каталогом, а не ссылкой.
 * 4. Путь занят. Проверяется `lstat`, а не `stat`. Финальный `wx` при этом
 *    остаётся: он закрывает гонку между проверкой и созданием ЭТОГО ИМЕНИ —
 *    подмену родительского каталога он не закрывает и закрыть не может.
 */
export function assertExclusiveJsonTarget(outPath, { insideDir } = {}) {
  assertExclusiveTarget(outPath, { insideDir, names: ARTIFACT_NAMES.planReport })
}

async function writeJson(outPath, report, { flag, names }) {
  try {
    await writeFile(outPath, JSON.stringify(report, null, 2), {
      encoding: 'utf8',
      flag,
    })
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(
        `${outPath} уже существует. ${names.nominative} не перезаписывается: выберите другое имя `
        + 'или удалите прежний файл сами, посмотрев, что в нём.',
      )
    }
    throw error
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
  await writeJson(outPath, report, {
    // 'wx' — создать или отказать; 'w' — прежнее поведение с перезаписью.
    flag: mode === 'exclusive' ? 'wx' : 'w',
    names: ARTIFACT_NAMES.planReport,
  })
}

/**
 * Эксклюзивный артефакт внутри УЖЕ существующего проверенного каталога.
 *
 * В отличие от legacy-writer выше, эта граница не вызывает recursive mkdir:
 * создание корней принадлежит artifact-store, который проверяет и fsync'ит
 * каждый компонент. Здесь остаются containment, свободный leaf и финальный
 * `wx` от гонки за имя.
 */
export async function writeExclusiveJsonArtifact(outPath, report, options) {
  canonicalJsonBytes(options, 'writeExclusiveJsonArtifact: параметры')
  assertExactKeys(options, ['insideDir', 'names'], 'writeExclusiveJsonArtifact: параметры')
  canonicalJsonBytes(report, 'writeExclusiveJsonArtifact: отчёт')
  const { insideDir, names } = options
  assertExclusiveTarget(outPath, { insideDir, names })
  await writeJson(outPath, report, { flag: 'wx', names })
}
