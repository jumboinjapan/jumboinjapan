export interface AirtablePoi {
  id: string
  poiId: string
  nameRu: string
  nameEn: string
  descriptionRu: string
  descriptionEn: string
  workingHours: string
  website: string
  category: string[]
}

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

interface AirtableResponse {
  records: AirtableRecord[]
  offset?: string
}

export async function getHakonePois(): Promise<AirtablePoi[]> {
  const token = process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID

  if (!token || !baseId) {
    console.warn('Airtable credentials missing, returning empty POI list')
    return []
  }

  const url = new URL(`https://api.airtable.com/v0/${baseId}/POI`)
  url.searchParams.set('filterByFormula', "SEARCH('Канагава',{Prefecture (RU)})")

  const allRecords: AirtableRecord[] = []
  let offset: string | undefined

  do {
    if (offset) url.searchParams.set('offset', offset)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 3600 },
    })

    if (!res.ok) {
      console.error(`Airtable API error: ${res.status} ${res.statusText}`)
      return []
    }

    const data: AirtableResponse = await res.json()
    allRecords.push(...data.records)
    offset = data.offset
  } while (offset)

  return allRecords.map((r) => ({
    id: r.id,
    poiId: (r.fields['POI ID'] as string) ?? '',
    nameRu: (r.fields['POI Name (RU)'] as string) ?? '',
    nameEn: (r.fields['POI Name (EN)'] as string) ?? '',
    descriptionRu: (r.fields['Description (RU)'] as string) ?? '',
    descriptionEn: (r.fields['Description (EN)'] as string) ?? '',
    workingHours: (r.fields['Working Hours'] as string) ?? '',
    website: (r.fields['Website'] as string) ?? '',
    category: (r.fields['POI Category (RU)'] as string[]) ?? [],
  }))
}
