/**
 * Исполнитель схемной операции по замороженной карточке (10f-P R2).
 *
 * Порядок — и он значим:
 *   1. read-only ПРЕДПОЛЁТ, до журнала: байты карточки → отпечаток; карточка
 *      разбирается, закрытая область и модули цепочки сверяются с диском;
 *      разрешение сверяется с отпечатком, cardId и сроком; живая схема
 *      читается: таблица по каноническому ID и имени, все четыре поля
 *      отсутствуют. Любой отказ — без файла журнала.
 *   2. журнал открывается ЭКСКЛЮЗИВНО (существует — отказ, повтор запрещён).
 *   3. для каждого поля по order: свежее чтение → полное допустимое состояние
 *      четвёрки (префикс есть ровно по одному разу и совпадает, текущее и
 *      суффикс отсутствуют) → запись намерения → один POST → запись факта
 *      отправки → СВЕЖЕЕ ЧТЕНИЕ → исход только по чтению.
 *   4. после ЛЮБОГО отправленного POST — 2xx, 4xx, обрыв, истёкший срок —
 *      исход устанавливается ТОЛЬКО отдельным ограниченным чтением; чтение
 *      недоступно ПО ЛЮБОЙ причине (срок, провод, отказ, ПОВРЕЖДЁННАЯ ФОРМА
 *      ответа) → именованный исход unknown, журнал закрывается unknown,
 *      требуется восстановление; повтора и отката нет (10f-P R3, находки 1–2).
 *   5. первое расхождение — stopped; остальные поля не трогаются.
 *   6. если все четыре поля подтверждены поштучно, но ЗАКЛЮЧИТЕЛЬНАЯ сверка
 *      недоступна, журнал закрывается терминалом pendingFinalWitness — не
 *      «обычной остановкой»: окончательный вердикт даёт позже
 *      `verdictFromJournal` по неизменяемому журналу и новому живому
 *      свидетельству, без повторного POST и без отката (R3, находка 3).
 *
 * Исполнитель не читает окружение и не знает адреса и токена: транспорт и
 * часы инъецируются точкой входа. Удалять и править он не умеет: у
 * транспорта таких методов нет.
 */

import { assertTaxonomySchemaApproval, assertTaxonomySchemaCard, cardDigestOf } from './taxonomy-schema-card.mjs'
import { openSchemaJournal, SCHEMA_JOURNAL_ROOT } from './taxonomy-schema-journal.mjs'
import { assertQuartetState } from './taxonomy-schema-state.mjs'
import { sha256Bytes } from '../lib/byte-digest.mjs'
import { canonicalJsonBytes } from '../lib/canonical-contract.mjs'

export const approvalDigestOf = (approval) => sha256Bytes(canonicalJsonBytes(approval, 'schema-approval'))
export const bodyDigestOf = (body) => sha256Bytes(canonicalJsonBytes(body, 'field'))

/** Формы ответа транспорта, которые исполнитель признаёт (10f-P R4, находка 2). */
const KNOWN_SENT_KINDS = Object.freeze(['applied', 'refused', 'ambiguous'])

/**
 * Безопасное описание брошенного значения. Само НИКОГДА не бросает: значение
 * может быть отозванным Proxy, объектом с бросающими геттерами, не-Error —
 * чем угодно. Возвращает короткую строку.
 */
export function describeThrownSafely(value) {
  try {
    if (value instanceof Error) {
      let name = 'Error'; let message = ''
      try { name = String(value.name ?? 'Error') } catch { name = 'Error' }
      try { message = String(value.message ?? '') } catch { message = '(сообщение недоступно)' }
      return `${name}: ${message}`.slice(0, 300)
    }
  } catch { /* даже instanceof срабатывает на trap отозванного Proxy — падать нельзя */ }
  try { return `${typeof value}: ${String(value)}`.slice(0, 300) } catch { return 'значение недоступно (возможно отозванный Proxy)' }
}

/** Безопасное чтение свойства: объект может быть отозванным Proxy или иметь бросающий геттер. */
const readProp = (obj, key) => { try { return obj == null ? undefined : obj[key] } catch { return undefined } }

/**
 * Безопасная причина отказа чтения (10f-P R5, находка 1). Брошенное значение
 * границы readSchema может быть СЫРЫМ отозванным Proxy — доступ к `.cause`
 * через `?.` всё равно срабатывает на trap и бросает. Читаем через readProp.
 */
const safeCause = (error) => { const c = readProp(error, 'cause'); return typeof c === 'string' && c ? c : 'readFailed' }

/**
 * Нормализует что угодно, полученное или брошенное `transport.createField`, в
 * безопасную запись: { response ∈ KNOWN_SENT_KINDS, status, fieldId, reason,
 * ambiguousEffect }. Любой бросок и любая нераспознанная форма — потенциально
 * неоднозначный эффект (`ambiguousEffect: true`), который разрешает только
 * последующее свежее чтение. Сама не бросает.
 */
export function normalizeSent(raw, threw) {
  if (threw !== undefined) {
    return { response: 'ambiguous', status: null, fieldId: null, reason: `создание поля бросило: ${describeThrownSafely(threw)}`, ambiguousEffect: true }
  }
  const kind = readProp(raw, 'kind')
  const rawStatus = readProp(raw, 'status')
  const status = typeof rawStatus === 'number' && Number.isFinite(rawStatus) ? rawStatus : null
  const rawFieldId = readProp(raw, 'fieldId')
  const fieldId = typeof rawFieldId === 'string' && rawFieldId ? rawFieldId : null
  const rawReason = readProp(raw, 'reason')
  const reason = typeof rawReason === 'string' ? rawReason.slice(0, 300) : null
  if (typeof kind === 'string' && KNOWN_SENT_KINDS.includes(kind)) {
    return { response: kind, status, fieldId, reason, ambiguousEffect: kind === 'ambiguous' }
  }
  return { response: 'ambiguous', status, fieldId, reason: `createField вернул нераспознанную форму (kind=${describeThrownSafely(kind)})`, ambiguousEffect: true }
}

/**
 * Read-only предполёт. Не создаёт ничего; при отказе бросает. Возвращает
 * разобранную карточку, отпечатки и тела полей.
 */
export async function preflightTaxonomySchemaCard({ cardBytes, approval, transport, now, repoRoot }) {
  if (!(cardBytes instanceof Uint8Array)) throw new TypeError('исполнитель схемы: cardBytes должны быть байтами')
  if (typeof now !== 'function') throw new TypeError('исполнитель схемы: now — функция канонического момента')
  if (typeof repoRoot !== 'string' || !repoRoot) throw new TypeError('исполнитель схемы: repoRoot обязателен — модули сверяются с диском')
  const cardDigest = cardDigestOf(cardBytes)
  const card = JSON.parse(Buffer.from(cardBytes).toString('utf8'))
  assertTaxonomySchemaCard(card, { repoRoot })
  assertTaxonomySchemaApproval(approval, { cardDigest, cardId: card.cardId, now: now() })
  const bodies = card.fields.map((f) => f.request.body)
  let tables
  try { tables = await transport.readSchema() } catch (error) {
    throw new Error(`предполёт: живая схема не прочитана (${safeCause(error)}): ${describeThrownSafely(error)}`)
  }
  const state = assertQuartetState(tables, bodies, 0)
  if (!state.ok) throw new Error(`предполёт: живая схема не в исходном состоянии — ${state.reason}`)
  return { card, cardDigest, approvalDigest: approvalDigestOf(approval), bodies, tableId: state.table.id }
}

export async function executeTaxonomySchemaCard({
  cardBytes, approval, transport, now, repoRoot, journalRoot = SCHEMA_JOURNAL_ROOT,
}) {
  const pre = await preflightTaxonomySchemaCard({ cardBytes, approval, transport, now, repoRoot })
  const { card, cardDigest, approvalDigest, bodies } = pre

  const journal = openSchemaJournal({
    cardDigest, now, root: journalRoot,
    opened: { cardId: card.cardId, approvalDigest, fields: card.scope.fieldNames },
  })
  journal.append('preflight', { ok: true, tableId: pre.tableId, appliedCount: 0 })

  const applied = []
  const finish = (outcome, field, reason, extra = {}) => {
    if (outcome !== 'allApplied') journal.append('stopped', { field, reason, ...extra })
    journal.close({ outcome, applied: [...applied], stoppedAt: outcome === 'allApplied' ? null : field, reason: outcome === 'allApplied' ? null : reason })
    return {
      outcome, cardDigest, journal: journal.file, applied: [...applied],
      stoppedAt: outcome === 'allApplied' ? null : field,
      reason: outcome === 'allApplied' ? null : reason,
      recoveryRequired: outcome === 'unknown',
      ...(extra.cause ? { cause: extra.cause } : {}),
    }
  }

  for (const [i, body] of bodies.entries()) {
    const field = body.name
    // Свежее чтение и ПОЛНОЕ допустимое состояние — непосредственно перед POST.
    let before
    try { before = assertQuartetState(await transport.readSchema(), bodies, i) } catch (error) { before = { ok: false, reason: `чтение схемы: ${describeThrownSafely(error)}` } }
    journal.append('stateBefore', { field, appliedCount: i, ok: before.ok, reason: before.reason ?? null })
    if (!before.ok) return finish('stopped', field, `состояние перед POST не допустимо: ${before.reason}`)
    // Намерение — ДО эффекта.
    journal.append('dispatching', { field, bodyDigest: bodyDigestOf(body) })
    // ЛЮБОЕ исключение после входа в границу POST — потенциально неоднозначный
    // эффект, а не крах исполнителя: ловим здесь, безопасно описываем и всё
    // равно устанавливаем исход свежим чтением. Исполнитель не полагается на
    // обещание конкретной реализации транспорта (защита есть и в транспорте).
    let raw; let threw
    try { raw = await transport.createField(body) } catch (error) { threw = error === undefined ? new Error('createField бросил undefined') : error }
    const sent = normalizeSent(raw, threw)
    journal.append('sent', { field, response: sent.response, status: sent.status, fieldId: sent.fieldId, reason: sent.reason, ambiguousEffect: sent.ambiguousEffect })
    // Исход — ТОЛЬКО свежим чтением, каким бы ни был ответ и был ли бросок.
    // Отдельное ограниченное чтение. Любая недоступность — срок, провод,
    // отказ, повреждённая форма ответа, исключение — именованный исход, не исключение.
    let tables
    try { tables = await transport.readSchema() } catch (error) {
      const cause = safeCause(error)
      const detail = describeThrownSafely(error)
      journal.append('outcome', { field, result: 'unknown', establishedBy: 'read', cause, reason: `чтение после POST недоступно (${cause}): ${detail}` })
      return finish('unknown', field, `исход POST неизвестен (${cause}): ${detail}; требуется восстановление, повтор запрещён`, { cause })
    }
    const after = assertQuartetState(tables, bodies, i + 1)
    if (after.ok) {
      journal.append('outcome', { field, result: 'applied', establishedBy: 'read', fieldId: after.fieldIds[i] ?? null })
      applied.push(field)
      continue
    }
    const present = (assertQuartetState(tables, bodies, i).ok)
    if (present) {
      journal.append('outcome', { field, result: 'notApplied', establishedBy: 'read', reason: after.reason })
      return finish('stopped', field, `эффекта не было (по чтению): ${after.reason}; ответ провода: ${sent.response}${sent.status ? ` ${sent.status}` : ''}; повтор запрещён`)
    }
    journal.append('outcome', { field, result: 'mismatch', establishedBy: 'read', reason: after.reason })
    return finish('stopped', field, `состояние после POST не совпадает с карточкой: ${after.reason}`)
  }

  // Заключительная сверка. Её НЕДОСТУПНОСТЬ — не расхождение и не обычная
  // остановка: четыре поля уже подтверждены поштучно свежими чтениями.
  let finalTables
  try { finalTables = await transport.readSchema() } catch (error) {
    const cause = safeCause(error)
    const reason = `четыре поля подтверждены поштучно чтением, но заключительная сверка недоступна (${cause}): ${describeThrownSafely(error)}; `
      + 'окончательный вердикт — verdictFromJournal по этому журналу и новому свидетельству, без повтора POST и без отката'
    journal.close({ outcome: 'pendingFinalWitness', applied: [...applied], stoppedAt: null, reason })
    return { outcome: 'pendingFinalWitness', cardDigest, journal: journal.file, applied: [...applied], stoppedAt: null, reason, recoveryRequired: true, cause }
  }
  const finalState = assertQuartetState(finalTables, bodies, 4)
  if (!finalState.ok) return finish('stopped', null, `итоговая схема не совпадает с реестром: ${finalState.reason}`)
  return finish('allApplied', null, null)
}
