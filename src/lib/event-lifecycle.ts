export const RESOURCE_EVENT_LIFECYCLE_VALUES = ['upcoming', 'live', 'ended'] as const
export type ResourceEventLifecycle = (typeof RESOURCE_EVENT_LIFECYCLE_VALUES)[number]

export function parseEventDateBoundary(value: string, boundary: 'start' | 'end'): Date {
  const normalized = value.trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const suffix = boundary === 'start' ? 'T00:00:00+09:00' : 'T23:59:59+09:00'
    return new Date(`${normalized}${suffix}`)
  }

  return new Date(normalized)
}

export function normalizeEventLifecycle(startsAt: string, endsAt: string, value?: unknown, now = new Date()): ResourceEventLifecycle {
  const start = parseEventDateBoundary(startsAt, 'start')
  const end = parseEventDateBoundary(endsAt, 'end')

  if (Number.isFinite(end.getTime()) && end < now) return 'ended'
  if (Number.isFinite(start.getTime()) && start > now) return 'upcoming'
  if (Number.isFinite(start.getTime()) || Number.isFinite(end.getTime())) return 'live'

  const normalized = (typeof value === 'string' ? value.trim() : '').toLowerCase()
  return RESOURCE_EVENT_LIFECYCLE_VALUES.includes(normalized as ResourceEventLifecycle) ? (normalized as ResourceEventLifecycle) : 'live'
}

