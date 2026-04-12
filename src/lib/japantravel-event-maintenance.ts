export const RESOURCES_TABLE_NAME = 'Resources'
export const RESOURCE_EVENT_DETAILS_TABLE_NAME = 'Resource Event Details'

const BATCH_SIZE = 10
const JAPAN_TRAVEL_HOST = 'en.japantravel.com'
const JAPAN_TRAVEL_SEED_SOURCE = 'japantravel.com/events importer'
const RECURRING_KEYWORD_PATTERN = /\b(annual|annually|yearly|every year|seasonal|each spring|each summer|each autumn|each fall|each winter)\b/i
const RECURRING_SEASONAL_PATTERN = /\b(sakura|cherry blossom|hanami|autumn leaves|momiji|illumination|christmas market|snow festival|winter festival|summer festival|spring festival|fireworks|hanabi|matsuri|festival|parade|lantern|market)\b/i
const RECURRING_EVENT_TYPE_PATTERN = /\b(festival|matsuri|illumination|market|fireworks|hanabi|parade|fair|exhibition)\b/i

type AirtableRecord = {
  id: string
  fields: Record<string, unknown>
}

type MaintenanceJoinedEvent = {
  resourceRecord: AirtableRecord
  eventRecord: AirtableRecord | null
  resourceId: string
  status: string
  title: string
  summary: string
  description: string
  seedSource: string
  sourceKey: string
  sourceUrl: string
  startsAt: string
  endsAt: string
  lifecycle: string
}

export type JapanTravelCleanupOptions = {
  dryRun?: boolean
  endedBeforeDays?: number
  log?: (message: string) => void
}

export type JapanTravelCleanupResult = {
  dryRun: boolean
  endedBeforeDays: number
  scanned: number
  matched: number
  archived: number
  unchanged: number
  sample: Array<{
    resourceId: string
    title: string
    status: string
    lifecycle: string
    endsAt: string
    sourceUrl: string
  }>
}

export type RecurringCandidate = {
  resourceId: string
  title: string
  status: string
  lifecycle: string
  startsAt: string
  endsAt: string
  sourceUrl: string
  reasons: string[]
  suggestedReviewFrom: string
  suggestedReviewUntil: string
}

export type JapanTravelRecurringReportOptions = {
  status?: 'active' | 'archived' | 'all'
}

export type JapanTravelRecurringReportResult = {
  scanned: number
  candidates: RecurringCandidate[]
}

function getAirtableCredentials() {
  return {
    token: process.env.AIRTABLE_TOKEN?.trim(),
    baseId: process.env.AIRTABLE_BASE_ID?.trim(),
  }
}

function getText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function normalizeHostname(value: string) {
  return value.replace(/^www\./, '').toLowerCase()
}

function hostnameFromUrl(value: string) {
  try {
    return normalizeHostname(new URL(value).hostname)
  } catch {
    return ''
  }
}

function isJapanTravelRecord(fields: Record<string, unknown>) {
  const seedSource = getText(fields['Seed Source'])
  const sourceKey = getText(fields['Source Key'])
  return seedSource === JAPAN_TRAVEL_SEED_SOURCE || hostnameFromUrl(sourceKey) === JAPAN_TRAVEL_HOST
}

function inferLifecycle(startsAt: string, endsAt: string, value: unknown) {
  const stored = getText(value).toLowerCase()
  if (stored === 'upcoming' || stored === 'live' || stored === 'ended') return stored

  const now = new Date()
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  if (Number.isFinite(end.getTime()) && end < now) return 'ended'
  if (Number.isFinite(start.getTime()) && start > now) return 'upcoming'
  return 'live'
}

async function fetchAllAirtableRecords(tableName: string) {
  const { token, baseId } = getAirtableCredentials()
  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required for Airtable maintenance')
  }

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`)
  url.searchParams.set('pageSize', '100')

  const records: AirtableRecord[] = []
  let offset: string | undefined

  do {
    if (offset) {
      url.searchParams.set('offset', offset)
    } else {
      url.searchParams.delete('offset')
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Airtable read failed for ${tableName}: ${response.status} ${await response.text()}`)
    }

    const data = (await response.json()) as { records?: AirtableRecord[]; offset?: string }
    records.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)

  return records
}

async function patchAirtableBatch(tableName: string, records: Array<{ id: string; fields: Record<string, unknown> }>) {
  const { token, baseId } = getAirtableCredentials()
  if (!token || !baseId) throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required for Airtable maintenance')

  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records }),
  })

  if (!response.ok) {
    throw new Error(`Airtable patch failed for ${tableName}: ${response.status} ${await response.text()}`)
  }
}

async function getJapanTravelMaintenanceEvents(): Promise<MaintenanceJoinedEvent[]> {
  const [resourceRecords, eventDetailRecords] = await Promise.all([
    fetchAllAirtableRecords(RESOURCES_TABLE_NAME),
    fetchAllAirtableRecords(RESOURCE_EVENT_DETAILS_TABLE_NAME),
  ])

  const eventDetailsByResourceId = new Map(
    eventDetailRecords.map((record) => [getText(record.fields['Resource ID']), record] as const).filter(([resourceId]) => Boolean(resourceId)),
  )

  return resourceRecords
    .filter((record) => isJapanTravelRecord(record.fields))
    .map((record) => {
      const resourceId = getText(record.fields['Resource ID'])
      const eventRecord = eventDetailsByResourceId.get(resourceId) ?? null
      const startsAt = getText(eventRecord?.fields['Starts At'])
      const endsAt = getText(eventRecord?.fields['Ends At'])

      return {
        resourceRecord: record,
        eventRecord,
        resourceId,
        status: getText(record.fields.Status).toLowerCase() || 'active',
        title: getText(record.fields.Title),
        summary: getText(record.fields.Summary),
        description: getText(record.fields.Description),
        seedSource: getText(record.fields['Seed Source']),
        sourceKey: getText(record.fields['Source Key']),
        sourceUrl: getText(eventRecord?.fields['Source URL']) || getText(record.fields['Primary URL']) || getText(record.fields['Source Key']),
        startsAt,
        endsAt,
        lifecycle: inferLifecycle(startsAt, endsAt, eventRecord?.fields.Lifecycle),
      }
    })
    .filter((event) => Boolean(event.resourceId) && Boolean(event.endsAt))
}

function dateMinusDays(value: string, days: number) {
  const date = new Date(value)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

function datePlusDays(value: string, days: number) {
  const date = new Date(value)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function hasRecurringSeasonalShape(event: MaintenanceJoinedEvent) {
  const haystack = [event.title, event.summary, event.description].join(' ')
  const reasons: string[] = []

  if (RECURRING_KEYWORD_PATTERN.test(haystack)) reasons.push('explicit_recurring_keyword')
  if (RECURRING_SEASONAL_PATTERN.test(haystack)) reasons.push('seasonal_keyword')
  if (RECURRING_EVENT_TYPE_PATTERN.test(event.title)) reasons.push('event_type_keyword')

  const start = new Date(event.startsAt)
  const end = new Date(event.endsAt)
  const durationDays = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
    ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1)
    : Number.POSITIVE_INFINITY

  if (durationDays <= 45) reasons.push('bounded_duration')

  const qualifies =
    reasons.includes('explicit_recurring_keyword') ||
    (reasons.includes('seasonal_keyword') && reasons.includes('event_type_keyword') && reasons.includes('bounded_duration'))

  return {
    qualifies,
    reasons,
  }
}

export async function archiveEndedJapanTravelEvents(options: JapanTravelCleanupOptions = {}): Promise<JapanTravelCleanupResult> {
  const dryRun = options.dryRun ?? true
  const endedBeforeDays = options.endedBeforeDays ?? 0
  const log = options.log ?? (() => {})
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - endedBeforeDays)

  const events = await getJapanTravelMaintenanceEvents()
  const matched = events.filter((event) => {
    if (!event.eventRecord) return false
    if (event.status === 'archived') return false
    if (event.lifecycle !== 'ended') return false
    const end = new Date(event.endsAt)
    return Number.isFinite(end.getTime()) && end <= cutoff
  })

  if (!dryRun && matched.length > 0) {
    log(`Archiving ${matched.length} ended Japan Travel event resources`)

    const seededAt = new Date().toISOString()
    for (let index = 0; index < matched.length; index += BATCH_SIZE) {
      const batch = matched.slice(index, index + BATCH_SIZE)
      await patchAirtableBatch(
        RESOURCES_TABLE_NAME,
        batch.map((event) => ({
          id: event.resourceRecord.id,
          fields: {
            Status: 'archived',
            'Last Seeded At': seededAt,
          },
        })),
      )

      await patchAirtableBatch(
        RESOURCE_EVENT_DETAILS_TABLE_NAME,
        batch.filter((event) => event.eventRecord).map((event) => ({
          id: event.eventRecord!.id,
          fields: {
            Lifecycle: 'ended',
          },
        })),
      )
    }
  }

  return {
    dryRun,
    endedBeforeDays,
    scanned: events.length,
    matched: matched.length,
    archived: dryRun ? 0 : matched.length,
    unchanged: events.length - matched.length,
    sample: matched.slice(0, 20).map((event) => ({
      resourceId: event.resourceId,
      title: event.title,
      status: event.status,
      lifecycle: event.lifecycle,
      endsAt: event.endsAt,
      sourceUrl: event.sourceUrl,
    })),
  }
}

export async function reportRecurringJapanTravelCandidates(
  options: JapanTravelRecurringReportOptions = {},
): Promise<JapanTravelRecurringReportResult> {
  const events = await getJapanTravelMaintenanceEvents()

  const candidates = events
    .filter((event) => {
      if (options.status && options.status !== 'all' && event.status !== options.status) return false
      return event.lifecycle === 'ended'
    })
    .map((event) => {
      const recurring = hasRecurringSeasonalShape(event)
      if (!recurring.qualifies) return null

      return {
        resourceId: event.resourceId,
        title: event.title,
        status: event.status,
        lifecycle: event.lifecycle,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        sourceUrl: event.sourceUrl,
        reasons: recurring.reasons,
        suggestedReviewFrom: dateMinusDays(event.startsAt, 60),
        suggestedReviewUntil: datePlusDays(event.startsAt, 21),
      } satisfies RecurringCandidate
    })
    .filter((candidate): candidate is RecurringCandidate => Boolean(candidate))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))

  return {
    scanned: events.length,
    candidates,
  }
}
