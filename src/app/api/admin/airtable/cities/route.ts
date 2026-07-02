import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || ''

  const url = new URL(`https://api.airtable.com/v0/apppwhjFN82N9zNqm/tblHaHc9NV0mA8bSa`)
  url.searchParams.append('fields[]', 'Name (RU)')
  url.searchParams.append('fields[]', 'Name (EN)')
  if (q) {
    url.searchParams.set(
      'filterByFormula',
      `OR(SEARCH(LOWER("${q}"), LOWER({Name (RU)})), SEARCH(LOWER("${q}"), LOWER({Name (EN)})))`
    )
  }
  url.searchParams.set('maxRecords', '8')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
    cache: 'no-store',
  })
  const data = await res.json()

  const cities = (data.records || []).map((r: { id: string; fields: Record<string, string> }) => ({
    id: r.id,
    name: r.fields['Name (RU)'] || '',
    nameEn: r.fields['Name (EN)'] || '',
  }))

  return NextResponse.json(cities)
}
