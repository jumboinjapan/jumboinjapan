import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || ''

  const url = new URL(`https://api.airtable.com/v0/tblHaHc9NV0mA8bSa`)
  url.searchParams.set('fields[]', 'Name')
  url.searchParams.set('fields[]', 'Name EN')
  if (q) {
    url.searchParams.set(
      'filterByFormula',
      `OR(SEARCH(LOWER("${q}"), LOWER({Name})), SEARCH(LOWER("${q}"), LOWER({Name EN})))`
    )
  }
  url.searchParams.set('maxRecords', '8')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
    next: { revalidate: 300 },
  })
  const data = await res.json()

  const cities = (data.records || []).map((r: { id: string; fields: { Name?: string; 'Name EN'?: string } }) => ({
    id: r.id,
    name: r.fields['Name'] || '',
    nameEn: r.fields['Name EN'] || '',
  }))

  return NextResponse.json(cities)
}
