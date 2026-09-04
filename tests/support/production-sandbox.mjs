/**
 * Песочница-копия production-дерева для тестов, у которых НЕТ и не должно быть
 * канала подмены в коде (10f-P R1, находка 1).
 *
 * Полномочие решений о координатах живёт в файле по каноническому пути
 * `config/poi-coordinate-decisions.v1.json`, который writer читает статическим
 * импортом. Ни `options`, ни `deps`, ни фабрика с аргументом такого канала не
 * дают — иначе он был бы и у production-вызывающего. Поэтому тест композиции
 * не подставляет реестр в код, а кладёт другой ФАЙЛ по тому же пути в копию
 * дерева и запускает там тот же production-код отдельным процессом.
 *
 * Копируются только каталоги, которые импортируют проверяемые модули;
 * `node_modules` — символьная ссылка на настоящие. Репозиторий не трогается.
 */

import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const COPIED = ['src/lib', 'src/data', 'config', 'scripts/lib', 'scripts/poi-portals']

/**
 * @param options.ledger  содержимое реестра решений, которое ляжет по каноническому пути
 * @param options.patch   (file → text) правки модулей — ТОЛЬКО для мутационных контрпримеров
 */
export function createProductionSandbox({ ledger, patch = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jj-production-sandbox-'))
  for (const rel of COPIED) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    cpSync(path.join(REPO, rel), path.join(dir, rel), { recursive: true })
  }
  symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), 'dir')
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
  if (ledger !== undefined) {
    writeFileSync(path.join(dir, 'config', 'poi-coordinate-decisions.v1.json'), `${JSON.stringify(ledger, null, 2)}\n`)
  }
  for (const [rel, text] of Object.entries(patch)) writeFileSync(path.join(dir, rel), text)
  return {
    dir,
    /**
     * Запускает ESM-скрипт с корнем песочницы как cwd. Скрипт печатает в
     * stdout ОДИН JSON; всё прочее (предупреждения) — в stderr.
     */
    run(script) {
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AIRTABLE_TOKEN: '', AIRTABLE_BASE_ID: '', GOOGLE_PLACES_API_KEY: '', GOOGLE_MAPS_API_KEY: '' },
      })
      const trimmed = out.trim()
      return trimmed ? JSON.parse(trimmed.slice(trimmed.lastIndexOf('\n') + 1)) : null
    },
    /** Как run, но брошенное исключение возвращается текстом. */
    tryRun(script) {
      try { return { ok: true, value: this.run(script) } } catch (error) {
        const stderr = String(error.stderr ?? '')
        const line = stderr.split('\n').find((l) => /^\s*\w*Error: /.test(l)) ?? stderr.slice(0, 300)
        return { ok: false, error: line.trim(), stderr }
      }
    },
    dispose() { rmSync(dir, { recursive: true, force: true }) },
  }
}
