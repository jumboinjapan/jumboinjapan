import { NextRequest, NextResponse } from 'next/server'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN!
const BASE_ID = process.env.AIRTABLE_BASE_ID!
const STOPS_TABLE = 'tblpa3Zof1ZGofAtS'

interface ReorderItem {
  id: string
  order: number
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const items: ReorderItem[] = body?.items

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items array required' }, { status: 400 })
    }

    const results: unknown[] = []
    for (let i = 0; i < items.length; i += 10) {
      const batch = items.slice(i, i + 10)
      const records = batch.map(({ id, order }) => ({ id, fields: { '№': order } }))
      const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${STOPS_TABLE}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records }),
      })
      if (!res.ok) {
        const text = await res.text()
        return NextResponse.json({ error: text }, { status: res.status })
      }
      const data = await res.json()
      results.push(...(data.records ?? []))
    }

    return NextResponse.json({ ok: true, updated: results.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
