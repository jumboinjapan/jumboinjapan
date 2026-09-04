/**
 * Допустимое состояние целевой четвёрки полей — одна функция на все точки
 * проверки цепочки (10f-P R2, свойства 4–6).
 *
 * Состояние описывается числом уже применённых полей `appliedCount` (0…4):
 *   • таблица найдена по каноническому ID и носит каноническое имя;
 *   • каждое поле префикса [0, appliedCount) присутствует РОВНО ОДИН РАЗ и
 *     совпадает с телом карточки по имени, типу и множеству опций;
 *   • текущее поле и весь суффикс [appliedCount, 4) отсутствуют.
 *
 * Той же функцией проверяются: предполёт (appliedCount = 0), состояние
 * непосредственно перед каждым POST (appliedCount = i), исход после каждого
 * POST (appliedCount = i + 1) и свидетель (appliedCount = 4). Никакой из
 * этих шагов не смотрит на ответ провайдера — только на свежее чтение.
 */

import { findPoiTable } from '../../src/lib/poi-taxonomy-airtable.ts'

/** Одно поле живой схемы против тела запроса: имя, тип, множество опций. */
export function fieldMatchesBody(liveField, body) {
  if (!liveField || liveField.name !== body.name || liveField.type !== body.type) return false
  const want = body.options?.choices?.map((c) => c.name) ?? null
  if (want === null) return true
  const live = (liveField.options?.choices ?? []).map((c) => c.name)
  return live.length === want.length && want.every((c) => live.includes(c))
}

/**
 * @param tables       сырой ответ Meta API
 * @param bodies       тела четырёх полей карточки, в порядке order
 * @param appliedCount сколько первых полей обязаны уже существовать
 * @returns {{ ok: boolean, reason: string|null, table: object|null, fieldIds: string[] }}
 */
export function assertQuartetState(tables, bodies, appliedCount) {
  if (!Array.isArray(bodies) || bodies.length !== 4) return { ok: false, reason: 'карточка обязана нести ровно четыре поля', table: null, fieldIds: [] }
  if (!Number.isInteger(appliedCount) || appliedCount < 0 || appliedCount > 4) return { ok: false, reason: `appliedCount ${appliedCount} вне 0…4`, table: null, fieldIds: [] }
  const found = findPoiTable(tables)
  if (!found.ok) return { ok: false, reason: found.reason, table: null, fieldIds: [] }
  const live = Array.isArray(found.table.fields) ? found.table.fields : []
  const fieldIds = []
  for (const [i, body] of bodies.entries()) {
    const same = live.filter((f) => f?.name === body.name)
    if (i < appliedCount) {
      if (same.length !== 1) {
        return { ok: false, reason: `поле «${body.name}» (применённый префикс) присутствует ${same.length} раз, ожидается ровно один`, table: found.table, fieldIds }
      }
      if (!fieldMatchesBody(same[0], body)) {
        return { ok: false, reason: `поле «${body.name}» (применённый префикс) не совпадает с карточкой`, table: found.table, fieldIds }
      }
      fieldIds.push(same[0].id ?? null)
    } else if (same.length !== 0) {
      return { ok: false, reason: `поле «${body.name}» ${i === appliedCount ? '(текущее)' : '(суффикс)'} уже существует (${same.length})`, table: found.table, fieldIds }
    }
  }
  return { ok: true, reason: null, table: found.table, fieldIds }
}
