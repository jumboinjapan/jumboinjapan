#!/usr/bin/env node
/**
 * Решения владельца о политике координат: проставить контрольную сумму
 * черновика и проверить реестр.
 *
 *   node scripts/poi-coordinate-decision.mjs --stamp draft.json
 *   node scripts/poi-coordinate-decision.mjs --check
 *
 * Скрипт ничего не пишет: `--stamp` печатает запись с пересчитанным
 * `integrityDigest` в stdout, владелец сам кладёт её в
 * config/poi-coordinate-decisions.v1.json и коммитит; `--check` читает реестр
 * тем же loader'ом, что и production, и отказывает тем же текстом. Airtable и
 * сеть не трогаются вовсе.
 *
 * `integrityDigest` — контрольная сумма целостности, не подпись. Она и
 * статический импорт реестра не доказывают авторство: пересчитать сумму
 * может кто угодно. Полномочие задаётся процессом owner review — правка
 * реестра попадает в main только через ревью владельца.
 */

import { readFileSync } from 'node:fs'
import {
  COORDINATE_DECISIONS_LEDGER_PATH,
  coordinateDecisionIntegrityDigest,
  coordinateDecisionIssues,
  loadCoordinateDecisions,
} from '../src/lib/poi-coordinate-decision.ts'

export function stampDraft(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('черновик решения: ожидается объект')
  // Контрольная сумма из черновика не доверяется и не читается: она пересчитывается.
  const entry = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'integrityDigest'))
  const stamped = { ...entry, integrityDigest: coordinateDecisionIntegrityDigest(entry) }
  const issues = coordinateDecisionIssues(stamped, 'черновик')
  if (issues.length) throw new Error(issues.join('\n'))
  return stamped
}

export function main(argv = process.argv.slice(2)) {
  if (argv[0] === '--stamp' && argv[1]) {
    const stamped = stampDraft(JSON.parse(readFileSync(argv[1], 'utf8')))
    process.stdout.write(`${JSON.stringify(stamped, null, 2)}\n`)
    return 0
  }
  if (argv[0] === '--check' && argv.length === 1) {
    const ledger = loadCoordinateDecisions()
    console.log(`✓ ${COORDINATE_DECISIONS_LEDGER_PATH}: ${ledger.size} решений, все с верной контрольной суммой`)
    for (const key of ledger.keys()) {
      const d = ledger.get(key)
      console.log(`  ${key} → ${d.decision} (${d.decisionRef}); предмет: ${d.subject.siteCity} / ${d.subject.nameJa ?? d.subject.nameEn ?? d.subject.nameRu}`)
    }
    return 0
  }
  console.error('использование: --stamp <draft.json> | --check')
  return 2
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(`[poi-coordinate-decision] ${error.message}`)
    process.exitCode = 1
  }
}
