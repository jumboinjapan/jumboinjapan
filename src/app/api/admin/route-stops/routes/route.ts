import { NextResponse } from 'next/server'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN!
const BASE_ID = process.env.AIRTABLE_BASE_ID!
const ROUTES_TABLE = 'tblIsgkRfrQZpJawB'

const VALID_SLUGS = new Set([
  'intercity/enoshima',
  'intercity/fuji',
  'intercity/hakone',
  'intercity/himeji',
  'intercity/kamakura',
  'intercity/kanazawa',
  'intercity/kyoto-1',
  'intercity/kyoto-2',
  'intercity/nara',
  'intercity/nikko',
  'intercity/osaka',
  'intercity/uji',
  'city-tour/day-one',
  'city-tour/day-two',
  'city-tour/hidden-spots',
  'city-tour/private',
  'city-tour/public',
  'multi-day/classic',
  'multi-day/mountain',
])

export async function GET() {
  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${ROUTES_TABLE}?pageSize=100`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: text }, { status: res.status })
    }
    const data = await res.json()
    const routes = (data.records as Array<{ id: string; fields: Record<string, unknown> }>)
      .map((r) => ({
        id: r.id,
        slug: (r.fields['Slug'] as string) ?? '',
        title: (r.fields['Title'] as string) ?? '',
        routeType: (r.fields['Route Type'] as string) ?? '',
        tourStartTime: (r.fields['Tour Start Time'] as string) ?? '',
        tourEndTime: (r.fields['Tour End Time'] as string) ?? '',
      }))
      .filter((r) => VALID_SLUGS.has(r.slug))
    return NextResponse.json(routes)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
