/**
 * Запущен ли модуль как точка входа процесса.
 *
 * Сравнение `import.meta.url === \`file://${process.argv[1]}\`` и даже
 * `import.meta.url === pathToFileURL(process.argv[1]).href` ломались на
 * физически эквивалентных, но текстуально разных путях: символическая ссылка,
 * macOS `/var` → `/private/var`, пробел или кириллица в пути (URL кодирует их
 * процентами). Молчаливо запускался пустой процесс с кодом 0 — main не
 * вызывался вовсе (10f-P R3, находка 4; дефект `collect-pois.mjs` отложен
 * в R2 10g-C и закрыт здесь).
 *
 * Сравниваются РЕАЛЬНЫЕ пути файловой системы обеих сторон: `fileURLToPath`
 * снимает процентное кодирование, `realpathSync` — ссылки и эквивалентные
 * корни. Любая ошибка разрешения, служебный argv `-` (stdin) или пустой argv —
 * не точка входа: импорт модуля из теста или из stdin никогда не должен
 * запускать CLI.
 */
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Оба аргумента передаются явно: `isDirectEntry(process.argv[1], import.meta.url)`.
 * Значения по умолчанию здесь были бы ловушкой — `undefined` молча
 * превращался бы в argv текущего процесса.
 */
export function isDirectEntry(argv1, moduleUrl) {
  if (typeof argv1 !== 'string' || !argv1 || argv1 === '-') return false
  if (typeof moduleUrl !== 'string' || !moduleUrl.startsWith('file:')) return false
  const real = (p) => { try { return realpathSync(p) } catch { return null } }
  const self = real(fileURLToPath(moduleUrl))
  const entry = real(path.resolve(argv1))
  return self !== null && entry !== null && self === entry
}
