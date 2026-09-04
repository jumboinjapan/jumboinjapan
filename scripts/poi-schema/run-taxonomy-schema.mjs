#!/usr/bin/env node
/**
 * Точка входа схемной операции — bootstrap (10f-P R2, свойство 2).
 *
 *   node scripts/poi-schema/run-taxonomy-schema.mjs --freeze <card.json>
 *   node scripts/poi-schema/run-taxonomy-schema.mjs --verify <card.json>
 *   node scripts/poi-schema/run-taxonomy-schema.mjs --witness <card.json>
 *   node scripts/poi-schema/run-taxonomy-schema.mjs --execute <card.json> --approval <approval.json>
 *   node scripts/poi-schema/run-taxonomy-schema.mjs --verdict <card.json> --approval <approval.json> [--journal <j.jsonl>]
 *
 * Этот файл импортирует ТОЛЬКО встроенные модули Node. Для любого режима с
 * карточкой он сначала хеширует все модули цепочки — включая себя и CLI — и
 * сверяет с отпечатками карточки, и лишь затем динамически импортирует CLI.
 * Ни один изменяемый модуль цепочки не исполняется до проверки своей
 * идентичности. Изменённая точка входа не совпадает с карточкой: карточка
 * к ней неприменима.
 *
 * Корень доверия — сами байты этого файла: он проверяет себя по карточке, но
 * подменённый bootstrap мог бы и не проверять. Это единственное место
 * цепочки, где тождество удостоверяет не код, а внешняя сверка отпечатка
 * (`--verify` из чистого дерева, аудит), — и это сказано вслух.
 *
 * Список модулей продублирован из taxonomy-schema-card.mjs намеренно: там
 * он нужен для сборки карточки, здесь — до импорта чего-либо. Тождество
 * списков закреплено тестом.
 */

import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BOOTSTRAP_CHAIN_MODULES = Object.freeze([
  'scripts/poi-schema/run-taxonomy-schema.mjs',
  'scripts/poi-schema/taxonomy-schema-cli.mjs',
  'scripts/poi-schema/taxonomy-schema-card.mjs',
  'scripts/poi-schema/taxonomy-schema-state.mjs',
  'scripts/poi-schema/taxonomy-schema-journal.mjs',
  'scripts/poi-schema/taxonomy-schema-transport.mjs',
  'scripts/poi-schema/taxonomy-schema-execute.mjs',
  'scripts/poi-schema/taxonomy-schema-witness.mjs',
  'scripts/poi-schema/taxonomy-schema-gate.mjs',
  'scripts/lib/byte-digest.mjs',
  'scripts/lib/canonical-contract.mjs',
  'src/lib/poi-taxonomy-airtable.ts',
  'src/lib/poi-taxonomy.ts',
  'src/lib/airtable-schema.ts',
  'config/poi-taxonomy.v2.json',
])

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MODES_WITH_CARD = Object.freeze(['--verify', '--witness', '--execute', '--verdict'])

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

/**
 * Сверка модулей цепочки на диске с отпечатками карточки — без импорта
 * чего-либо. Возвращает { ok, problems }.
 */
export function verifyChainAgainstCard(cardBytes, repoRoot = REPO_ROOT) {
  const problems = []
  let card
  try { card = JSON.parse(Buffer.from(cardBytes).toString('utf8')) } catch (error) { return { ok: false, problems: [`карточка не разбирается: ${error.message}`] } }
  const modules = card?.modules
  if (!modules || typeof modules !== 'object') return { ok: false, problems: ['карточка без отпечатков модулей'] }
  const listed = Object.keys(modules).sort()
  const expected = [...BOOTSTRAP_CHAIN_MODULES].sort()
  if (JSON.stringify(listed) !== JSON.stringify(expected)) problems.push(`состав модулей карточки (${listed.join(', ')}) не равен цепочке bootstrap (${expected.join(', ')})`)
  for (const rel of BOOTSTRAP_CHAIN_MODULES) {
    if (!(rel in modules)) continue
    let live
    try { live = sha256(readFileSync(path.join(repoRoot, rel))) } catch (error) { problems.push(`${rel}: не читается (${error.code ?? error.message})`); continue }
    if (live !== modules[rel]) problems.push(`${rel}: на диске ${live}, в карточке ${modules[rel]} — карточка неприменима`)
  }
  return { ok: problems.length === 0, problems }
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const mode = argv[0]
  const error = deps.error ?? console.error
  if (MODES_WITH_CARD.includes(mode)) {
    if (!argv[1]) { error(`использование: ${mode} <card.json>`); return 2 }
    let cardBytes
    try { cardBytes = readFileSync(argv[1]) } catch (e) { error(`[poi-schema] карточка ${argv[1]} не читается: ${e.message}`); return 1 }
    const verdict = verifyChainAgainstCard(cardBytes, deps.repoRoot ?? REPO_ROOT)
    if (!verdict.ok) {
      error(`[poi-schema] bootstrap: цепочка не совпадает с карточкой — ничего не импортировано:\n  ${verdict.problems.join('\n  ')}`)
      return 1
    }
  } else if (mode !== '--freeze') {
    error('использование: --freeze <card.json> | --verify <card.json> | --witness <card.json> | --execute <card.json> --approval <approval.json> | --verdict <card.json> --approval <approval.json> [--journal <journal.jsonl>]')
    return 2
  }
  // Импорт — только после сверки (для --freeze карточки ещё нет, эффекта нет).
  const cli = deps.importCli ?? (() => import('./taxonomy-schema-cli.mjs'))
  const { main: run } = await cli()
  return run(argv, deps)
}

/**
 * Запущен ли этот файл как точка входа (10f-P R3, находка 4).
 *
 * Сравнение `import.meta.url === \`file://${process.argv[1]}\`` ломалось на
 * физически эквивалентных, но текстуально разных путях: символическая ссылка,
 * /var → /private/var, пробел в пути (URL кодирует его как %20), любой
 * URL-кодируемый символ. Молчаливо запускался пустой процесс с кодом 0 —
 * main не вызывался вовсе. Сравниваем РЕАЛЬНЫЕ пути файловой системы:
 * fileURLToPath снимает процентное кодирование, realpathSync — ссылки и
 * эквивалентные корни. Любая ошибка разрешения — не точка входа.
 */
export function isDirectEntry(argv1 = process.argv[1], moduleUrl = import.meta.url) {
  if (typeof argv1 !== 'string' || !argv1) return false
  const real = (p) => { try { return realpathSync(p) } catch { return null } }
  const self = real(fileURLToPath(moduleUrl))
  const entry = real(path.resolve(argv1))
  return self !== null && entry !== null && self === entry
}

if (isDirectEntry()) {
  main().then((code) => { process.exitCode = code }, (error) => {
    console.error(`[poi-schema] ${error.message}`)
    process.exitCode = 1
  })
}
