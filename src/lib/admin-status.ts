/**
 * Один словарь состояний на всю панель.
 *
 * До этого файла каждое рабочее место называло одно и то же по-своему:
 * SEO-консоль писала Draft / Approved / Synced по-английски, ЧАВО —
 * «На сайте / Черновик / Скрыт», конструктор — «Опубликован / В архиве»,
 * остановки маршрута показывали сырое Active / Inactive из Airtable.
 * Одно состояние — одно слово и один цвет, на каком бы экране оно ни встретилось.
 *
 * ВАЖНО: здесь только ПОДПИСИ. Значения, которые уходят в Airtable, не меняются —
 * resolveAdminStatus() принимает сырое значение как есть и ничего не переписывает.
 */

export type AdminStatusKey = 'draft' | 'review' | 'approved' | 'published' | 'hidden' | 'archived'

export type AdminStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export const ADMIN_STATUS_LABELS: Record<AdminStatusKey, string> = {
  draft: 'Черновик',
  review: 'На проверке',
  approved: 'Утверждён',
  published: 'На сайте',
  hidden: 'Скрыт',
  archived: 'В архиве',
}

export const ADMIN_STATUS_TONES: Record<AdminStatusKey, AdminStatusTone> = {
  draft: 'warning',
  review: 'info',
  approved: 'info',
  published: 'success',
  hidden: 'neutral',
  archived: 'neutral',
}

/**
 * Сырое значение из Airtable или из локального состояния → канонический ключ.
 * Регистр не важен: 'Draft', 'draft' и 'DRAFT' — одно и то же.
 */
const RAW_TO_KEY: Record<string, AdminStatusKey> = {
  // черновик
  draft: 'draft',
  черновик: 'draft',
  // на проверке
  review: 'review',
  'ready for review': 'review',
  'in review': 'review',
  // утверждён владельцем, но ещё не на сайте
  approved: 'approved',
  // на сайте
  published: 'published',
  synced: 'published',
  active: 'published',
  live: 'published',
  // скрыт
  hidden: 'hidden',
  inactive: 'hidden',
  // архив
  archived: 'archived',
  archive: 'archived',
}

export type ResolvedAdminStatus = {
  key: AdminStatusKey | null
  label: string
  tone: AdminStatusTone
}

/**
 * Незнакомое значение не выдумывается и не прячется: показываем как есть,
 * нейтральным. Молча подставить «Черновик» вместо неизвестного статуса —
 * это соврать про состояние записи.
 */
export function resolveAdminStatus(raw: string | null | undefined): ResolvedAdminStatus {
  const normalized = (raw ?? '').trim()
  if (!normalized) return { key: null, label: '—', tone: 'neutral' }

  const key = RAW_TO_KEY[normalized.toLowerCase()]
  if (!key) return { key: null, label: normalized, tone: 'neutral' }

  return { key, label: ADMIN_STATUS_LABELS[key], tone: ADMIN_STATUS_TONES[key] }
}

export function adminStatusLabel(raw: string | null | undefined): string {
  return resolveAdminStatus(raw).label
}

export function adminStatusTone(raw: string | null | undefined): AdminStatusTone {
  return resolveAdminStatus(raw).tone
}

/**
 * Варианты для <select>: значение уходит в базу сырым, подпись — человеческая.
 */
export function adminStatusOptions<T extends string>(rawValues: readonly T[]): { value: T; label: string }[] {
  return rawValues.map((value) => ({ value, label: adminStatusLabel(value) }))
}
