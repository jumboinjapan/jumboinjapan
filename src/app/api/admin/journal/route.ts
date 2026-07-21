import { NextRequest, NextResponse } from 'next/server'

import { requireAdminSession } from '@/lib/admin-guard'
import { AIRTABLE_BASE_ID } from '@/lib/airtable-schema'
import { fetchAirtableWithRetry } from '@/lib/airtable-retry'

/**
 * Очередь Журнала для агента-копирайтера (таблица Journal в Airtable).
 * GET  — все записи с их статусами для /admin/journal;
 * POST { title?, sourceNotes } — новый черновик из MD-заметок владельца:
 *   Status=Draft, Agent Status=Queued. Дальше очередь разбирает Cowork-агент
 *   (Клод со скиллами копирайтера): исследование темы → Body в стиле владельца
 *   → Agent Status=Ready for Review. Публикация — руками владельца
 *   (Status=Published) после вычитки.
 */

export const dynamic = 'force-dynamic'

const JOURNAL_TABLE = 'Journal'
const TOKEN = process.env.AIRTABLE_TOKEN

function airtableUrl(): string {
  return `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(JOURNAL_TABLE)}`
}

export async function GET(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied
  if (!TOKEN) return NextResponse.json({ error: 'AIRTABLE_TOKEN not configured' }, { status: 500 })

  try {
    const records: Array<{
      id: string
      title: string
      slug: string
      status: string
      agentStatus: string
      publishedDate: string
      hasSourceNotes: boolean
      hasBody: boolean
    }> = []
    let offset: string | undefined
    do {
      const url = new URL(airtableUrl())
      url.searchParams.set('pageSize', '100')
      if (offset) url.searchParams.set('offset', offset)
      const res = await fetchAirtableWithRetry(url.toString(), {
        headers: { Authorization: `Bearer ${TOKEN}` },
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`Airtable ${res.status}`)
      const data = (await res.json()) as {
        records: Array<{ id: string; fields: Record<string, unknown> }>
        offset?: string
      }
      for (const r of data.records) {
        const f = r.fields
        const text = (name: string) => (typeof f[name] === 'string' ? (f[name] as string) : '')
        records.push({
          id: r.id,
          title: text('Title'),
          slug: text('Slug'),
          status: text('Status'),
          agentStatus: text('Agent Status'),
          publishedDate: text('Published Date'),
          hasSourceNotes: Boolean(text('Source Notes').trim()),
          hasBody: Boolean(text('Body').trim()),
        })
      }
      offset = data.offset
    } while (offset)

    return NextResponse.json({ records })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied
  if (!TOKEN) return NextResponse.json({ error: 'AIRTABLE_TOKEN not configured' }, { status: 500 })

  try {
    const body = (await request.json()) as { title?: unknown; sourceNotes?: unknown }
    const sourceNotes = typeof body.sourceNotes === 'string' ? body.sourceNotes.trim() : ''
    if (!sourceNotes) {
      return NextResponse.json({ error: 'sourceNotes is required' }, { status: 400 })
    }

    // Заголовок: явный из формы, иначе первая "# ..." строка из MD, иначе первая строка.
    let title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) {
      const heading = sourceNotes.match(/^#\s+(.+)$/m)
      title = (heading?.[1] ?? sourceNotes.split('\n')[0] ?? '').trim().slice(0, 120)
    }

    const res = await fetchAirtableWithRetry(airtableUrl(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [
          {
            fields: {
              Title: title || 'Без названия',
              Status: 'Draft',
              'Agent Status': 'Queued',
              'Source Notes': sourceNotes,
            },
          },
        ],
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Airtable ${res.status}: ${detail.slice(0, 200)}`)
    }
    const data = (await res.json()) as { records: Array<{ id: string }> }
    return NextResponse.json({ ok: true, id: data.records[0]?.id })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
