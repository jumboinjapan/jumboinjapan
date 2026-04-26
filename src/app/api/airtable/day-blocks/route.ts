import { NextResponse } from 'next/server'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID ?? 'apppwhjFN82N9zNqm'
const DAY_BLOCKS_TABLE_ID = 'tbl3v4xKDw991yfa8'

export async function GET() {
  try {
    const token = AIRTABLE_TOKEN
    if (!token) {
      return NextResponse.json({ error: 'Airtable token not configured' }, { status: 500 })
    }

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${DAY_BLOCKS_TABLE_ID}?view=Grid+view`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `Airtable error: ${text}` }, { status: res.status })
    }

    const data = (await res.json()) as {
      records: Array<{
        id: string
        fields: {
          'Name RU'?: string
          'Name EN'?: string
          Type?: string
          'Description RU'?: string
          'Description EN'?: string
          Icon?: string
        }
      }>
    }

    const blocks = data.records.map((record) => ({
      id: record.id,
      nameRu: record.fields['Name RU'] ?? '',
      nameEn: record.fields['Name EN'] ?? '',
      type: record.fields['Type'] ?? '',
      descriptionRu: record.fields['Description RU'] ?? '',
      descriptionEn: record.fields['Description EN'] ?? '',
      icon: record.fields['Icon'] ?? '',
    }))

    return NextResponse.json(blocks)
  } catch (err) {
    console.error('[day-blocks] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
