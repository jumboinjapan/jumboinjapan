import { AIRTABLE_BASE_ID } from '@/lib/airtable-schema'
import { fetchAirtableWithRetry } from '@/lib/airtable-retry'

/**
 * Чтение first-party воронки (Airtable «Funnel Events») для блока «Воронка»
 * в /admin. Пишет туда публичный POST /api/track (см. его белый список).
 */

const FUNNEL_EVENTS_TABLE = 'Funnel Events'
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN

export interface FunnelEventRecord {
  event: string
  page: string
  href: string
  label: string
  channel: string
  created: string
}

export interface FunnelSummary {
  days: number
  total: number
  countsByEvent: Array<{ event: string; count: number }>
  topCta: Array<{ label: string; page: string; channel: string; count: number }>
  recent: FunnelEventRecord[]
  available: boolean
}

function text(fields: Record<string, unknown>, name: string): string {
  return typeof fields[name] === 'string' ? (fields[name] as string) : ''
}

async function fetchRecentEvents(sinceIso: string): Promise<FunnelEventRecord[] | null> {
  if (!AIRTABLE_TOKEN) return null
  const records: FunnelEventRecord[] = []
  let offset: string | undefined

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(FUNNEL_EVENTS_TABLE)}`,
    )
    url.searchParams.set('filterByFormula', `IS_AFTER({Created}, '${sinceIso}')`)
    url.searchParams.set('pageSize', '100')
    if (offset) url.searchParams.set('offset', offset)

    const res = await fetchAirtableWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      records: Array<{ fields: Record<string, unknown> }>
      offset?: string
    }
    for (const record of data.records) {
      records.push({
        event: text(record.fields, 'Event'),
        page: text(record.fields, 'Page'),
        href: text(record.fields, 'Href'),
        label: text(record.fields, 'Label'),
        channel: text(record.fields, 'Channel'),
        created: text(record.fields, 'Created'),
      })
    }
    offset = data.offset
  } while (offset)

  return records
}

/** Сводка воронки за последние `days` дней. Недоступность Airtable не роняет
 *  админ-обзор — возвращается { available: false }. */
export async function getFunnelSummary(days = 28): Promise<FunnelSummary> {
  const empty: FunnelSummary = {
    days,
    total: 0,
    countsByEvent: [],
    topCta: [],
    recent: [],
    available: false,
  }

  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const events = await fetchRecentEvents(since)
    if (!events) return empty

    const byEvent = new Map<string, number>()
    const byCta = new Map<string, { label: string; page: string; channel: string; count: number }>()
    for (const e of events) {
      byEvent.set(e.event, (byEvent.get(e.event) ?? 0) + 1)
      if (e.event === 'cta_contact_click') {
        const key = `${e.label}|${e.page}|${e.channel}`
        const entry = byCta.get(key) ?? { label: e.label, page: e.page, channel: e.channel, count: 0 }
        entry.count += 1
        byCta.set(key, entry)
      }
    }

    return {
      days,
      total: events.length,
      countsByEvent: [...byEvent.entries()]
        .map(([event, count]) => ({ event, count }))
        .sort((a, b) => b.count - a.count),
      topCta: [...byCta.values()].sort((a, b) => b.count - a.count).slice(0, 8),
      recent: events
        .slice()
        .sort((a, b) => b.created.localeCompare(a.created))
        .slice(0, 10),
      available: true,
    }
  } catch {
    return empty
  }
}
