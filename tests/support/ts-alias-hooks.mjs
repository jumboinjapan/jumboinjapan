/**
 * Хук разрешения модулей для тестов, исполняющих НАСТОЯЩИЕ TS-модули
 * приложения под Node (type-stripping) без сборки Next:
 *
 *   - `@/…`  → `src/…` (как `paths` в tsconfig.json);
 *   - относительный импорт без расширения → `.ts`/`.tsx`/`.mjs`/`.js`/`index.*`;
 *   - `next/server` → `next/server.js` (у пакета нет карты exports для ESM).
 *
 * Подключение:  node --import ./tests/support/ts-alias-register.mjs <тест>
 * или из теста: `register(new URL('./support/ts-alias-hooks.mjs', import.meta.url))`
 * ДО динамического импорта проверяемого модуля.
 *
 * Хук ничего не подменяет по содержанию: он только находит файл, который
 * нашёл бы сборщик. Корень проекта — cwd процесса.
 */
import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const EXT = ['.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts', '/index.js']
const isFile = (p) => { try { return statSync(p).isFile() } catch { return false } }

function withExt(base) {
  if (isFile(base)) return base
  for (const e of EXT) if (isFile(base + e)) return base + e
  return null
}

export async function resolve(specifier, context, next) {
  if (specifier === 'next/server') return next('next/server.js', context)
  if (specifier.startsWith('@/')) {
    const hit = withExt(path.join(ROOT, 'src', specifier.slice(2)))
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const hit = withExt(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier))
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
  }
  return next(specifier, context)
}
