import { NextRequest, NextResponse } from 'next/server'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN!
const BASE_ID = process.env.AIRTABLE_BASE_ID!
const STOPS_TABLE = 'tblpa3Zof1ZGofAtS'

export async function GET(request: NextRequest) {
  try {
    const routeSlug = request.nextUrl.searchParams.get('routeSlug')
    if (!routeSlug) {
      return NextResponse.json({ error: 'routeSlug required' }, { status: 400 })
    }
    const formula = encodeURIComponent(`{Route Slug} = "${routeSlug}"`)
    const url = `https://api.airtable.com/v0/${BASE_ID}/${STOPS_TABLE}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=%E2%84%96&sort%5B0%5D%5Bdirection%5D=asc&pageSize=100`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: text }, { status: res.status })
    }
    const data = await res.json()
    const stops = (data.records as Array<{ id: string; fields: Record<string, unknown> }>).map((r) => ({
      id: r.id,
      fields: r.fields,
    }))
    return NextResponse.json(stops)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const records = (body as { records: Array<{ id: string; fields: Record<string, unknown> }> }).records
    if (!records || !Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: 'records array required' }, { status: 400 })
    }

    // Airtable allows max 10 records per PATCH
    const results: Array<{ id: string; fields: Record<string, unknown> }> = []
    for (let i = 0; i < records.length; i += 10) {
      const batch = records.slice(i, i + 10)
      const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${STOPS_TABLE}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: batch }),
      })
      if (!res.ok) {
        const text = await res.text()
        return NextResponse.json({ error: text }, { status: res.status })
      }
      const data = await res.json()
      results.push(...(data.records as Array<{ id: string; fields: Record<string, unknown> }>))
    }
    return NextResponse.json({ records: results })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
