/**
 * Финальный gate и поздний вердикт схемной операции (10f-P R2 свойство 3,
 * 10f-P R3 находка 3).
 *
 * Gate — не «журнал закрыт и свидетель доволен». Он проверяет СТРОГУЮ
 * грамматику журнала против точных байтов карточки и разрешения: opened
 * связан с отпечатками обоих артефактов и четырьмя именами полей; preflight;
 * затем для каждого поля в порядке карточки — stateBefore(ok, appliedCount =
 * i), dispatching с отпечатком тела ИЗ КАРТОЧКИ, sent, outcome(applied,
 * establishedBy = read); затем closed. Ничего сверх, ничего мимо. Журнал из
 * opened + closed(allApplied, applied = []) — отказ.
 *
 * Два терминальных исхода журнала допустимы к вердикту:
 *   • closed(allApplied)          — исполнитель сам подтвердил итоговую сверку;
 *   • closed(pendingFinalWitness) — все четыре поля подтверждены поштучно
 *     свежими чтениями, но ЗАКЛЮЧИТЕЛЬНАЯ сверка была недоступна (срок,
 *     провод, повреждённый ответ). Это не «обычная остановка»: журнал
 *     неизменяем, а окончательный вердикт даёт `verdictFromJournal` — тот же
 *     журнал + НОВОЕ живое свидетельство независимого свидетеля, без
 *     повторного POST и без отката.
 *
 * Вердикт = грамматика ∧ свидетель. Свидетель классифицирует своим кодом
 * (taxonomy-schema-witness.mjs); здесь его результат только читается.
 */

import { cardDigestOf } from './taxonomy-schema-card.mjs'
import { approvalDigestOf, bodyDigestOf } from './taxonomy-schema-execute.mjs'
import { readSchemaJournal } from './taxonomy-schema-journal.mjs'
import { POI_TABLE_ID } from '../../src/lib/airtable-schema.ts'

/**
 * Независимая проверка вердикта свидетеля (10f-P R4, находка 1). Gate не
 * верит одному флагу `verifiedSuccess`: он требует, чтобы свидетель НЕ пометил
 * схему неоднозначной и вернул РОВНО четыре fieldId — по одному на каждое
 * целевое поле. Пять fieldId (лишнее идентичное поле), неоднозначная схема
 * или иное число — отказ. Возвращает строку-причину либо null.
 */
export function witnessProblem(witness) {
  if (!witness || typeof witness !== 'object') return 'свидетеля нет'
  if (witness.ambiguous === true) return `свидетель пометил схему неоднозначной: ${witness.reason ?? 'без причины'}`
  if (witness.verifiedSuccess !== true) return `свидетель не подтвердил: ${witness.reason ?? 'без причины'}`
  // Явная привязка к КАНОНИЧЕСКОЙ таблице (10f-P R5, находка 2): вердикт о
  // чужой таблице gate не принимает, даже если свидетель поставил бы true.
  if (witness.tableId !== POI_TABLE_ID) return `свидетель подтвердил не каноническую таблицу (${witness.tableId ?? 'нет'}), ожидается ${POI_TABLE_ID}`
  if (!Array.isArray(witness.fieldIds) || witness.fieldIds.length !== 4) return `свидетель вернул ${Array.isArray(witness.fieldIds) ? witness.fieldIds.length : 'не массив'} fieldId, ожидается ровно четыре`
  if (new Set(witness.fieldIds).size !== 4) return 'свидетель вернул повторяющиеся fieldId'
  if (witness.fieldIds.some((id) => typeof id !== 'string' || !id)) return 'свидетель вернул пустой fieldId'
  return null
}

/** Терминальные исходы журнала, при которых вердикт может быть положительным. */
export const VERDICT_ELIGIBLE_OUTCOMES = Object.freeze(['allApplied', 'pendingFinalWitness'])

/**
 * Строгая грамматика журнала. Возвращает { ok, problems[], terminal }.
 * `allowPending` — принимать closed(pendingFinalWitness) как терминал для
 * позднего вердикта; по умолчанию (немедленный gate) допустим только allApplied.
 */
export function validateJournalGrammar(records, { cardBytes, approval, allowPending = false }) {
  const problems = []
  const bad = (m) => problems.push(m)
  const card = JSON.parse(Buffer.from(cardBytes).toString('utf8'))
  const cardDigest = cardDigestOf(cardBytes)
  const names = card.scope?.fieldNames ?? []
  const bodies = (card.fields ?? []).map((f) => f.request.body)
  if (names.length !== 4 || bodies.length !== 4) bad('карточка обязана нести ровно четыре поля')
  if (!Array.isArray(records) || records.length === 0) { bad('журнал пуст'); return { ok: false, problems, terminal: null } }
  for (const r of records) if (r.cardDigest !== cardDigest) { bad(`запись ${r.seq}: отпечаток карточки ${r.cardDigest} не совпадает с байтами карточки`); break }
  let i = 0
  const next = () => records[i++]
  const expectKind = (kind) => {
    const r = next()
    if (!r) { bad(`ожидалась запись ${kind}, журнал кончился`); return null }
    if (r.kind !== kind) { bad(`запись ${r.seq}: ожидалась ${kind}, получена ${r.kind}`); return null }
    return r
  }
  const opened = expectKind('opened')
  if (!opened) return { ok: false, problems, terminal: null }
  if (opened.approvalDigest !== approvalDigestOf(approval)) bad('opened: отпечаток разрешения не совпадает с разрешением')
  if (opened.cardId !== card.cardId) bad('opened: cardId не совпадает с карточкой')
  if (JSON.stringify(opened.fields) !== JSON.stringify(names)) bad('opened: имена полей не совпадают с карточкой')
  const pre = expectKind('preflight')
  if (pre && (pre.ok !== true || pre.appliedCount !== 0)) bad('preflight: не ok или appliedCount ≠ 0')
  for (const [k, body] of bodies.entries()) {
    const field = body.name
    const st = expectKind('stateBefore')
    if (!st) return { ok: false, problems, terminal: null }
    if (st.field !== field || st.ok !== true || st.appliedCount !== k) bad(`stateBefore ${field}: поле/ok/appliedCount не по грамматике (получено ${st.field}/${st.ok}/${st.appliedCount})`)
    const d = expectKind('dispatching')
    if (!d) return { ok: false, problems, terminal: null }
    if (d.field !== field) bad(`dispatching: поле ${d.field}, ожидалось ${field}`)
    if (d.bodyDigest !== bodyDigestOf(body)) bad(`dispatching ${field}: отпечаток тела не совпадает с телом из карточки`)
    const s = expectKind('sent')
    if (!s) return { ok: false, problems, terminal: null }
    if (s.field !== field) bad(`sent: поле ${s.field}, ожидалось ${field}`)
    const o = expectKind('outcome')
    if (!o) return { ok: false, problems, terminal: null }
    if (o.field !== field) bad(`outcome: поле ${o.field}, ожидалось ${field}`)
    if (o.result !== 'applied') bad(`outcome ${field}: ${o.result}, ожидалось applied`)
    if (o.establishedBy !== 'read') bad(`outcome ${field}: исход установлен не чтением (${o.establishedBy})`)
  }
  const closed = expectKind('closed')
  if (!closed) return { ok: false, problems, terminal: null }
  const allowed = allowPending ? VERDICT_ELIGIBLE_OUTCOMES : ['allApplied']
  if (!allowed.includes(closed.outcome)) bad(`closed: исход ${closed.outcome}, ожидался ${allowed.join(' | ')}`)
  if (JSON.stringify(closed.applied) !== JSON.stringify(names)) bad('closed: applied не равен четырём именам полей по порядку')
  if (i !== records.length) bad(`после closed есть ещё ${records.length - i} записей`)
  return { ok: problems.length === 0, problems, terminal: closed.outcome ?? null }
}

function recordsOf({ journal, journalFile }) {
  return journal?.records ?? readSchemaJournal(journalFile).records
}

/**
 * Немедленный финальный gate: цепочка журнала ∧ строгая грамматика
 * (closed = allApplied) ∧ независимый свидетель. Любая часть отказывает целиком.
 */
export function finalGate({ cardBytes, approval, journalFile, journal, witness }) {
  let records
  try { records = recordsOf({ journal, journalFile }) } catch (error) {
    return { verifiedSuccess: false, journal: `журнал: ${error.message}`, grammar: null, witness: null }
  }
  const grammar = validateJournalGrammar(records, { cardBytes, approval })
  const wProblem = witnessProblem(witness)
  return {
    verifiedSuccess: grammar.ok && wProblem === null,
    journal: grammar.ok ? 'closed:allApplied по грамматике' : `журнал: ${grammar.problems[0]}`,
    grammar,
    witness: wProblem === null ? 'schema matches (четыре fieldId, без неоднозначности)' : `свидетель: ${wProblem}`,
  }
}

/**
 * Поздний вердикт по НЕИЗМЕНЯЕМОМУ журналу и НОВОМУ живому свидетельству —
 * штатный путь завершить проверку, когда заключительная сверка исполнителя
 * была недоступна. Ничего не пишет ни в базу, ни в журнал: повторного POST и
 * отката здесь нет по построению — у вердикта нет транспорта записи.
 *
 * Положителен только если: журнал целиком по грамматике, все четыре исхода
 * applied установлены чтением, терминал ∈ VERDICT_ELIGIBLE_OUTCOMES, и свежий
 * независимый свидетель видит авторизованное состояние.
 */
export function verdictFromJournal({ cardBytes, approval, journalFile, journal, witness, at = null }) {
  let records
  try { records = recordsOf({ journal, journalFile }) } catch (error) {
    return { verifiedSuccess: false, terminal: null, journal: `журнал: ${error.message}`, grammar: null, witness: null, establishedBy: null, at }
  }
  const grammar = validateJournalGrammar(records, { cardBytes, approval, allowPending: true })
  const wProblem = witnessProblem(witness)
  const last = records[records.length - 1]
  return {
    verifiedSuccess: grammar.ok && wProblem === null,
    terminal: grammar.terminal,
    journal: grammar.ok ? `closed:${grammar.terminal} по грамматике; четыре исхода applied установлены чтением` : `журнал: ${grammar.problems[0]}`,
    journalDigest: last?.recordDigest ?? null,
    grammar,
    witness: wProblem === null ? 'schema matches (свежее чтение свидетеля; четыре fieldId, без неоднозначности)' : `свидетель: ${wProblem}`,
    establishedBy: grammar.ok && wProblem === null ? 'immutableJournal+freshWitness' : null,
    posts: 0,
    at,
  }
}
