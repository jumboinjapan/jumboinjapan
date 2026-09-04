/**
 * CLI схемной операции — исполняется ТОЛЬКО через bootstrap
 * `run-taxonomy-schema.mjs`, после сверки отпечатков всех модулей цепочки.
 *
 * `--execute` — единственный режим с эффектом. Он требует файла разрешения,
 * привязанного к SHA-256 карточки, токена с scope schema.bases:write,
 * read-only предполёта и отсутствия журнала для этого отпечатка. Остальные
 * режимы — чтение (или запись локального файла карточки при --freeze).
 *
 * `--verdict <card> --approval <a> --journal <j>` (10f-P R3, находка 3) —
 * штатный путь ПОЗЖЕ завершить проверку, если заключительная сверка была
 * недоступна: читает неизменяемый журнал, берёт НОВОЕ свидетельство и
 * выносит вердикт. Транспорта записи у него нет: ни повтора POST, ни отката.
 *
 * `--freeze` и `--verify` работают полностью офлайн и окружение не читают:
 * загрузка env и токен нужны только режимам, которые действительно читают
 * живую схему.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nextEnv from '@next/env'
import { assertTaxonomySchemaCard, buildTaxonomySchemaCard, cardDigestOf } from './taxonomy-schema-card.mjs'
import { executeTaxonomySchemaCard } from './taxonomy-schema-execute.mjs'
import { createMetaTransport, DEFAULT_EXCHANGE_DEADLINE_MS } from './taxonomy-schema-transport.mjs'
import { journalPathFor, readSchemaJournal } from './taxonomy-schema-journal.mjs'
import { witnessTaxonomySchema } from './taxonomy-schema-witness.mjs'
import { finalGate, verdictFromJournal } from './taxonomy-schema-gate.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const nowInstant = () => new Date().toISOString()

/** Токен подставляется здесь: свидетель читает сам и учётных данных не знает. */
const withToken = (fetchImpl, token) => (url, init = {}) =>
  fetchImpl(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })

export async function main(argv = process.argv.slice(2), {
  fetchImpl = globalThis.fetch, env = process.env, log = console.log, repoRoot = REPO_ROOT,
  deadlineMs = DEFAULT_EXCHANGE_DEADLINE_MS,
} = {}) {
  const mode = argv[0]
  if (mode === '--freeze' && argv[1]) {
    const target = argv[1]
    if (existsSync(target)) throw new Error(`${target} уже существует: карточка замораживается один раз, правка — новый файл`)
    const card = buildTaxonomySchemaCard({ preparedAt: nowInstant() })
    const bytes = Buffer.from(`${JSON.stringify(card, null, 2)}\n`, 'utf8')
    writeFileSync(target, bytes)
    const digest = cardDigestOf(bytes)
    writeFileSync(`${target}.sha256`, `${digest.replace(/^sha256:/, '')}  ${path.basename(target)}\n`)
    log(`заморожена ${target}: ${digest}`)
    return 0
  }
  if (mode === '--verify' && argv[1]) {
    const bytes = readFileSync(argv[1])
    const card = JSON.parse(bytes.toString('utf8'))
    assertTaxonomySchemaCard(card, { repoRoot })
    log(`карточка ${card.cardId} совпадает с диском: ${cardDigestOf(bytes)}; полей ${card.scope.fieldCount}`)
    return 0
  }
  // Полная КАНОНИЧЕСКАЯ проверка карточки ДО чтения credentials, ДО первого
  // сетевого запроса и ДО построения маршрута witness (10f-P R5, находка 2).
  // База, таблица и поля не могут быть переопределены карточкой, не прошедшей
  // строгий контракт: чужой baseId или чужое имя поля отвергаются здесь,
  // прежде чем окружение вообще загружено.
  const CREDENTIAL_MODES = ['--witness', '--verdict', '--execute']
  if (CREDENTIAL_MODES.includes(mode)) {
    if (!argv[1]) {
      console.error('использование: --freeze <card.json> | --verify <card.json> | --witness <card.json> | --execute <card.json> --approval <approval.json> | --verdict <card.json> --approval <approval.json> [--journal <journal.jsonl>]')
      return 2
    }
    const preCard = JSON.parse(readFileSync(argv[1]).toString('utf8'))
    assertTaxonomySchemaCard(preCard, { repoRoot })
  }
  const { loadEnvConfig } = nextEnv
  loadEnvConfig(repoRoot)
  const token = env.AIRTABLE_TOKEN?.trim()
  if (mode === '--witness' && argv[1]) {
    if (!token) throw new Error('AIRTABLE_TOKEN не задан — свидетелю нечем читать')
    const cardBytes = readFileSync(argv[1])
    // Свидетель читает САМ, своим ограниченным сроком чтением: транспорт
    // исполнителя ему не передаётся (R3, находка 5).
    const witness = await witnessTaxonomySchema({ fetchImpl: withToken(fetchImpl, token), cardBytes, deadlineMs })
    log(JSON.stringify(witness, null, 2))
    return witness.verifiedSuccess ? 0 : 1
  }
  if (mode === '--verdict' && argv[1] && argv[2] === '--approval' && argv[3]) {
    if (!token) throw new Error('AIRTABLE_TOKEN не задан — свидетелю нечем читать')
    const cardBytes = readFileSync(argv[1])
    const approval = JSON.parse(readFileSync(argv[3], 'utf8'))
    const journalFile = argv[4] === '--journal' && argv[5] ? argv[5] : journalPathFor(cardDigestOf(cardBytes))
    const journal = readSchemaJournal(journalFile)
    const witness = await witnessTaxonomySchema({ fetchImpl: withToken(fetchImpl, token), cardBytes, deadlineMs })
    const verdict = verdictFromJournal({ cardBytes, approval, journal, witness, at: nowInstant() })
    log(JSON.stringify(verdict, null, 2))
    return verdict.verifiedSuccess ? 0 : 1
  }
  if (mode === '--execute' && argv[1] && argv[2] === '--approval' && argv[3]) {
    if (!token) throw new Error('AIRTABLE_TOKEN не задан — исполнять нечем')
    const cardBytes = readFileSync(argv[1])
    const approval = JSON.parse(readFileSync(argv[3], 'utf8'))
    const transport = createMetaTransport({ token, fetchImpl, deadlineMs })
    const result = await executeTaxonomySchemaCard({ cardBytes, approval, transport, now: nowInstant, repoRoot })
    const journal = readSchemaJournal(journalPathFor(result.cardDigest))
    const witness = await witnessTaxonomySchema({ fetchImpl: withToken(fetchImpl, token), cardBytes, deadlineMs })
    const gate = finalGate({ cardBytes, approval, journal, witness })
    log(JSON.stringify({ result, gate }, null, 2))
    if (!gate.verifiedSuccess && result.outcome === 'pendingFinalWitness') {
      log('заключительная сверка была недоступна: окончательный вердикт — --verdict по этому журналу и новому свидетельству, без повтора POST')
    }
    return gate.verifiedSuccess ? 0 : 1
  }
  console.error('использование: --freeze <card.json> | --verify <card.json> | --witness <card.json> | --execute <card.json> --approval <approval.json> | --verdict <card.json> --approval <approval.json> [--journal <journal.jsonl>]')
  return 2
}
