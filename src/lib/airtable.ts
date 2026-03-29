export interface AirtableTicket {
  ticketId: string
  type: string
  price: number
}

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
  tickets: AirtableTicket[]
}

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

interface AirtableResponse {
  records: AirtableRecord[]
  offset?: string
}

export async function getCityData(cityId: string): Promise<{ hasNonCarSegments: boolean }> {
  const token = process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID

  if (!token || !baseId) {
    console.warn('Airtable credentials missing, returning default city data')
    return { hasNonCarSegments: false }
  }

  const url = new URL(`https://api.airtable.com/v0/${baseId}/tblHaHc9NV0mA8bSa`)
  url.searchParams.set('filterByFormula', `{CITY ID}='${cityId}'`)
  url.searchParams.set('maxRecords', '1')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 3600 },
  })

  if (!res.ok) {
    console.error(`Airtable Cities API error: ${res.status} ${res.statusText}`)
    return { hasNonCarSegments: false }
  }

  const data: AirtableResponse = await res.json()
  const record = data.records[0]

  return {
    hasNonCarSegments: record ? Boolean(record.fields['HasNonCarSegments']) : false,
  }
}

export async function getPoisByCity(citySlug: string): Promise<AirtablePoi[]> {
  const token = process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID

  if (!token || !baseId) {
    console.warn('Airtable credentials missing, returning empty POI list')
    return []
  }

  const url = new URL(`https://api.airtable.com/v0/${baseId}/POI`)
  url.searchParams.set('filterByFormula', `{Site City}='${citySlug}'`)

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

  const recordIds = allRecords.map((r) => r.id)
  const ticketsByPoiRecordId = new Map<string, AirtableTicket[]>()

  if (recordIds.length > 0) {
    const ticketRecords: AirtableRecord[] = []
    let ticketOffset: string | undefined

    do {
      const tUrl = new URL(`https://api.airtable.com/v0/${baseId}/Tickets`)
      if (ticketOffset) tUrl.searchParams.set('offset', ticketOffset)

      const tRes = await fetch(tUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 3600 },
      })

      if (tRes.ok) {
        const tData: AirtableResponse = await tRes.json()
        ticketRecords.push(...tData.records)
        ticketOffset = tData.offset
      } else {
        console.error(`Airtable Tickets API error: ${tRes.status}`)
        break
      }
    } while (ticketOffset)

    for (const tr of ticketRecords) {
      const poiLinks = tr.fields['POI ID'] as string[] | undefined
      if (!poiLinks) continue
      const ticket: AirtableTicket = {
        ticketId: (tr.fields['Ticket ID'] as string) ?? '',
        type: (tr.fields['Ticket Type'] as string) ?? '',
        price: (tr.fields['Ticket Price'] as number) ?? 0,
      }
      for (const poiRecId of poiLinks) {
        const existing = ticketsByPoiRecordId.get(poiRecId) ?? []
        existing.push(ticket)
        ticketsByPoiRecordId.set(poiRecId, existing)
      }
    }
  }

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
    tickets: ticketsByPoiRecordId.get(r.id) ?? [],
  }))
}

export async function getHakonePois(): Promise<AirtablePoi[]> {
  const token = process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID

  if (!token || !baseId) {
    console.warn('Airtable credentials missing, returning empty POI list')
    return []
  }

  const url = new URL(`https://api.airtable.com/v0/${baseId}/POI`)
  url.searchParams.set('filterByFormula', "{Site City}='hakone'")

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

  // Fetch tickets for these POIs
  const recordIds = allRecords.map((r) => r.id)
  const ticketsByPoiRecordId = new Map<string, AirtableTicket[]>()

  if (recordIds.length > 0) {
    // Fetch all tickets, filter client-side by POI link field
    const ticketRecords: AirtableRecord[] = []
    let ticketOffset: string | undefined

    do {
      const tUrl = new URL(`https://api.airtable.com/v0/${baseId}/Tickets`)
      if (ticketOffset) tUrl.searchParams.set('offset', ticketOffset)

      const tRes = await fetch(tUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 3600 },
      })

      if (tRes.ok) {
        const tData: AirtableResponse = await tRes.json()
        ticketRecords.push(...tData.records)
        ticketOffset = tData.offset
      } else {
        console.error(`Airtable Tickets API error: ${tRes.status}`)
        break
      }
    } while (ticketOffset)

    for (const tr of ticketRecords) {
      const poiLinks = tr.fields['POI ID'] as string[] | undefined
      if (!poiLinks) continue
      const ticket: AirtableTicket = {
        ticketId: (tr.fields['Ticket ID'] as string) ?? '',
        type: (tr.fields['Ticket Type'] as string) ?? '',
        price: (tr.fields['Ticket Price'] as number) ?? 0,
      }
      for (const poiRecId of poiLinks) {
        const existing = ticketsByPoiRecordId.get(poiRecId) ?? []
        existing.push(ticket)
        ticketsByPoiRecordId.set(poiRecId, existing)
      }
    }
  }

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
    tickets: ticketsByPoiRecordId.get(r.id) ?? [],
  }))
}
