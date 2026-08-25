/**
 * Резолвер для тестов, запускаемых голым node: алиас `@/…` и расширения `.ts`.
 *
 * Зачем. Производственная граница `applyCityTourStopOverrides` импортирует
 * `@/data/route-stop-photos.generated.json`, а соседние модули — без
 * расширения. Голый node ни того, ни другого не понимает, и до сих пор
 * тестами покрывалось только чистое слияние: сама граница — проводка
 * файла-подстраховки и выбор по слагу — не проверялась ничем.
 *
 * Хук делает границу загружаемой, НЕ меняя её код: ни один production-файл
 * ради теста не переписан. JSON в ESM требует атрибут импорта; в сборке его
 * подставляет бандлер, здесь — этот хук.
 *
 * Подключается через `registerHooks` (синхронные хуки в том же потоке), а не
 * через `module.register`: последний грузит хуки в отдельный поток и на
 * свежих Node помечен как устаревший для этого применения.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..', '..')
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js']

const asUrl = (absolute) => {
  const url = pathToFileURL(absolute).href
  const json = absolute.endsWith('.json')
  return {
    url,
    shortCircuit: true,
    ...(json ? { format: 'json', importAttributes: { type: 'json' } } : {}),
  }
}

/** Дописывает расширение ТОЛЬКО если файла по указанному пути нет. */
const withExtension = (absolute) => {
  if (existsSync(absolute)) return absolute
  for (const extension of EXTENSIONS) {
    if (existsSync(`${absolute}${extension}`)) return `${absolute}${extension}`
  }
  return absolute
}

export function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    return asUrl(withExtension(path.join(REPO, 'src', specifier.slice(2))))
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parentPath = context.parentURL?.startsWith('file:')
      ? path.dirname(fileURLToPath(context.parentURL))
      : null
    if (parentPath) {
      const candidate = withExtension(path.resolve(parentPath, specifier))
      if (existsSync(candidate)) return asUrl(candidate)
    }
  }
  return next(specifier, context)
}
