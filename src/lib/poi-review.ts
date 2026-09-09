/** Discussion state only. These statuses grant no authority to the POI writer. */
export const REVIEW_STATUSES = {
  needs_fix: 'Исправить',
  needs_decision: 'Нужен выбор',
  in_progress: 'В работе',
  ready: 'Можно продолжать',
  deferred: 'Отложено',
  done: 'Завершено',
} as const
export type ReviewStatus = keyof typeof REVIEW_STATUSES
export interface ReviewItem {
  sourceKey: string
  nameRu: string
  nameEn: string
  sourceUrl: string
  googleUrl: string
  problem: string
  nextStep: string
  ownerDecision: string
  batch: string
  initialStatus: ReviewStatus
}
export interface ReviewEvent {
  id: string
  sourceKey: string
  kind: 'comment' | 'status' | 'item'
  actor: 'owner' | 'agent'
  at: string
  text?: string
  status?: ReviewStatus
  item?: ReviewItem
}
export interface ReviewRow extends ReviewItem {
  status: ReviewStatus
  history: ReviewEvent[]
  needsAgentReply: boolean
}

export class ReviewInputError extends Error {}
function fail(message: string): never { throw new ReviewInputError(message) }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Ожидается объект')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('Неизвестное поле запроса')
}
function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`Проверьте поле «${label}»`)
  return value.trim()
}
export function reviewKey(value: unknown): string {
  if (typeof value !== 'string' || !/^japan-guide:e\d+(?:_[a-z0-9]+)*(?::[a-z0-9-]+)?$/.test(value)) fail('Некорректный ключ Japan Guide')
  return value
}
export function reviewStatus(value: unknown): ReviewStatus {
  if (typeof value !== 'string' || !Object.hasOwn(REVIEW_STATUSES, value)) fail('Неизвестный статус разбора')
  return value as ReviewStatus
}
function safeLink(value: unknown, empty = false): string {
  const raw = text(value, 'ссылка', 2048, empty)
  if (!raw && empty) return ''
  let url: URL
  try { url = new URL(raw) } catch { return fail('Некорректная ссылка') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('Нужна обычная ссылка на сайт')
  return raw
}
export function validateReviewItem(value: unknown): ReviewItem {
  const v = object(value)
  keys(v, ['sourceKey', 'nameRu', 'nameEn', 'sourceUrl', 'googleUrl', 'problem', 'nextStep', 'ownerDecision', 'batch', 'initialStatus'])
  return {
    sourceKey: reviewKey(v.sourceKey), nameRu: text(v.nameRu, 'название', 300),
    nameEn: text(v.nameEn, 'английское название', 300, true),
    sourceUrl: safeLink(v.sourceUrl), googleUrl: safeLink(v.googleUrl, true),
    problem: text(v.problem, 'причина', 10000), nextStep: text(v.nextStep, 'следующий шаг', 10000),
    ownerDecision: text(v.ownerDecision, 'решение владельца', 10000, true),
    batch: text(v.batch, 'партия', 150), initialStatus: reviewStatus(v.initialStatus),
  }
}
export function validateReviewEvent(value: unknown): ReviewEvent {
  const v = object(value)
  keys(v, ['id', 'sourceKey', 'kind', 'actor', 'at', 'text', 'status', 'item'])
  if (typeof v.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.id)) fail('Некорректный идентификатор изменения')
  if (v.actor !== 'owner' && v.actor !== 'agent') fail('Неизвестный автор')
  if (typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at)) || new Date(v.at).toISOString() !== v.at) fail('Некорректная дата изменения')
  const base = { id: v.id, sourceKey: reviewKey(v.sourceKey), actor: v.actor, at: v.at } as const
  if (v.kind === 'comment' && !Object.hasOwn(v, 'item') && !Object.hasOwn(v, 'status')) return { ...base, kind: v.kind, text: text(v.text, 'комментарий', 10000) }
  if (v.kind === 'status' && !Object.hasOwn(v, 'item') && !Object.hasOwn(v, 'text')) return { ...base, kind: v.kind, status: reviewStatus(v.status) }
  if (v.kind === 'item' && v.actor === 'agent' && !Object.hasOwn(v, 'status') && !Object.hasOwn(v, 'text')) {
    const item = validateReviewItem(v.item)
    if (item.sourceKey !== base.sourceKey) fail('Ключ карточки не совпадает с изменением')
    return { ...base, kind: v.kind, item }
  }
  return fail('Неизвестное действие разбора')
}

/** Owner and agent append independent events: replacing a batch never deletes comments. */
export function projectReview(seed: unknown[], input: ReviewEvent[]): ReviewRow[] {
  const rows = new Map<string, ReviewRow>()
  for (const raw of seed) {
    const item = validateReviewItem(raw)
    if (rows.has(item.sourceKey)) fail('Повтор ключа в начальной очереди')
    rows.set(item.sourceKey, { ...item, status: item.initialStatus, history: [], needsAgentReply: false })
  }
  const seen = new Map<string, string>()
  const events = input.map(validateReviewEvent).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  // Materialize new items first, so equal provider timestamps cannot orphan a comment.
  for (const e of events) if (e.kind === 'item' && !rows.has(e.sourceKey)) {
    rows.set(e.sourceKey, { ...e.item!, status: e.item!.initialStatus, history: [], needsAgentReply: false })
  }
  for (const e of events) {
    const serialized = JSON.stringify({ ...e, at: '' })
    if (seen.has(e.id)) {
      if (seen.get(e.id) !== serialized) fail('Два разных изменения имеют один идентификатор')
      continue
    }
    seen.set(e.id, serialized)
    const row = rows.get(e.sourceKey)
    if (!row) fail(`Изменение относится к отсутствующей карточке ${e.sourceKey}`)
    if (e.kind === 'item') Object.assign(row, e.item, { status: row.status })
    if (e.kind === 'status') row.status = e.status!
    row.history.push(e)
    if (e.actor === 'owner') row.needsAgentReply = true
    else if (e.kind !== 'item') row.needsAgentReply = false
  }
  return [...rows.values()]
}

export function ownerReviewEvent(value: unknown, at = new Date().toISOString()): ReviewEvent {
  const v = object(value)
  keys(v, ['id', 'sourceKey', 'kind', 'text', 'status'])
  if (v.kind !== 'comment' && v.kind !== 'status') fail('Это действие недоступно в обсуждении')
  return validateReviewEvent({ ...v, actor: 'owner', at })
}
