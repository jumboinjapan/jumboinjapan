/**
 * Эксклюзивный журнал схемной операции: append-only JSONL с цепочкой
 * отпечатков, один файл на отпечаток карточки, создание — исключительное.
 *
 * Грамматика записей закрыта (JOURNAL_KINDS) и проверяется финальным gate
 * против точных байтов карточки и разрешения (taxonomy-schema-witness.mjs):
 * связанный по хешам журнал — необходимое, но не достаточное условие.
 *
 *   opened      — отпечатки карточки и разрешения, четыре имени полей
 *   preflight   — read-only предполёт прошёл (до открытия журнала, записан после)
 *   stateBefore — свежее чтение непосредственно перед POST: префикс на месте, текущее и суффикс отсутствуют
 *   dispatching — намерение: поле и отпечаток тела ДО отправки
 *   sent        — что ответил провод (форма ответа); исходом НЕ является
 *   outcome     — исход (result), установленный ТОЛЬКО свежим чтением: applied | notApplied | mismatch | unknown
 *   stopped     — остановка на первом расхождении (без повтора и отката)
 *   closed      — итог: allApplied | stopped | unknown
 */

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import path from 'node:path'
import { sha256Bytes } from '../lib/byte-digest.mjs'
import { assertCanonicalInstant, canonicalJsonBytes, isPlainObject } from '../lib/canonical-contract.mjs'

export const SCHEMA_JOURNAL_SPEC = 'poi-taxonomy-schema-journal/v2'
/** Фиксированный корень журналов схемных операций. */
export const SCHEMA_JOURNAL_ROOT = 'tmp/poi-schema-executions'
export const JOURNAL_KINDS = Object.freeze(['opened', 'preflight', 'stateBefore', 'dispatching', 'sent', 'outcome', 'stopped', 'closed'])
export const OUTCOME_KINDS = Object.freeze(['applied', 'notApplied', 'mismatch', 'unknown'])
export const ZERO_DIGEST = 'sha256:' + '0'.repeat(64)

/** Каталог журнала для отпечатка карточки: `<root>/<hex отпечатка>/journal.jsonl`. */
export function journalPathFor(cardDigest, root = SCHEMA_JOURNAL_ROOT) {
  if (!/^sha256:[0-9a-f]{64}$/.test(String(cardDigest))) throw new TypeError('журнал схемы: отпечаток карточки должен быть sha256')
  return path.join(root, cardDigest.replace(/^sha256:/, ''), 'journal.jsonl')
}

export function recordDigestOf(body) {
  return sha256Bytes(canonicalJsonBytes(body, 'schema-journal-record'))
}

/**
 * Открывает НОВЫЙ журнал. Существующий файл — отказ (`EEXIST`): для того же
 * отпечатка карточки исполнение уже начиналось, и повторять его нельзя;
 * дальше — только чтение журнала, свидетель и восстановление.
 */
export function openSchemaJournal({ cardDigest, now, root = SCHEMA_JOURNAL_ROOT, opened }) {
  const file = journalPathFor(cardDigest, root)
  mkdirSync(path.dirname(file), { recursive: true })
  let fd
  try {
    fd = openSync(file, 'wx')
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`журнал схемы ${file} уже существует: исполнение для этого отпечатка карточки уже начиналось; повтор запрещён — читайте журнал и свидетеля`)
    }
    throw error
  }
  let seq = 0
  let prevDigest = ZERO_DIGEST
  let closed = false
  const append = (kind, payload) => {
    if (closed) throw new Error('журнал схемы закрыт: дозапись запрещена')
    if (!JOURNAL_KINDS.includes(kind)) throw new TypeError(`журнал схемы: неизвестный вид записи ${kind}`)
    if (!isPlainObject(payload)) throw new TypeError('журнал схемы: payload должен быть объектом')
    for (const reserved of ['spec', 'seq', 'at', 'kind', 'cardDigest', 'prevDigest', 'recordDigest']) {
      if (reserved in payload) throw new TypeError(`журнал схемы: поле ${reserved} зарезервировано`)
    }
    if (kind === 'outcome' && !OUTCOME_KINDS.includes(payload.result)) throw new TypeError(`журнал схемы: неизвестный исход ${payload.result}`)
    const at = typeof now === 'function' ? now() : now
    assertCanonicalInstant(at, 'журнал схемы: at')
    seq += 1
    const body = { spec: SCHEMA_JOURNAL_SPEC, seq, at, kind, cardDigest, prevDigest, ...payload }
    const recordDigest = recordDigestOf(body)
    writeSync(fd, `${JSON.stringify({ ...body, recordDigest })}\n`)
    fsyncSync(fd)
    prevDigest = recordDigest
    if (kind === 'closed') { closed = true; closeSync(fd) }
    return recordDigest
  }
  append('opened', opened)
  return {
    file,
    append,
    close: (payload) => append('closed', payload),
    get closed() { return closed },
    get seq() { return seq },
  }
}

/** Читает журнал и проверяет цепочку. Fail-closed: порванная цепочка — ошибка. */
export function readSchemaJournal(file) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const records = []
  let prev = ZERO_DIGEST
  lines.forEach((line, i) => {
    const record = JSON.parse(line)
    const { recordDigest, ...body } = record
    if (body.spec !== SCHEMA_JOURNAL_SPEC) throw new Error(`журнал схемы: строка ${i + 1} чужой спецификации ${body.spec}`)
    if (body.seq !== i + 1) throw new Error(`журнал схемы: строка ${i + 1} несёт seq ${body.seq}`)
    if (body.prevDigest !== prev) throw new Error(`журнал схемы: строка ${i + 1} не продолжает цепочку`)
    if (recordDigest !== recordDigestOf(body)) throw new Error(`журнал схемы: строка ${i + 1} изменена после записи`)
    prev = recordDigest
    records.push(record)
  })
  const last = records[records.length - 1] ?? null
  return {
    file,
    records,
    closed: last?.kind === 'closed',
    outcome: last?.kind === 'closed' ? last.outcome ?? null : null,
    applied: records.filter((r) => r.kind === 'outcome' && r.result === 'applied').map((r) => r.field),
  }
}
