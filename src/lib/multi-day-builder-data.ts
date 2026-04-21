export interface MultiDayBuilderCityOption {
  cityId: string
  nameRu: string
  nameEn: string
  regionRu: string
}

export interface MultiDayBuilderPoiOption {
  poiId: string
  nameRu: string
  nameEn: string
  siteCity: string
  categoryRu: string
}

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

interface AirtableResponse {
  records?: AirtableRecord[]
  offset?: string
}

const CITIES_TABLE_ID = 'tblHaHc9NV0mA8bSa'
const POI_TABLE_ID = 'tblVCmFcHRpXUT24y'

function getAirtableText(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .join(', ')
  }
  return ''
}

function getAirtableCredentials() {
  return {
    token: process.env.AIRTABLE_TOKEN?.trim(),
    baseId: process.env.AIRTABLE_BASE_ID?.trim(),
  }
}

async function fetchAllTableRecords(tableId: string) {
  const { token, baseId } = getAirtableCredentials()

  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required for multi-day builder Airtable access')
  }

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`)
  url.searchParams.set('pageSize', '100')

  const records: AirtableRecord[] = []
  let offset: string | undefined

  do {
    if (offset) {
      url.searchParams.set('offset', offset)
    } else {
      url.searchParams.delete('offset')
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Airtable read failed for ${tableId}: ${response.status} ${await response.text()}`)
    }

    const data = (await response.json()) as AirtableResponse
    records.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)

  return records
}

export async function fetchMultiDayBuilderCities(): Promise<MultiDayBuilderCityOption[]> {
  const records = await fetchAllTableRecords(CITIES_TABLE_ID)

  return records
    .map((record) => ({
      cityId: getAirtableText(record.fields['CITY ID']),
      nameRu: getAirtableText(record.fields['Name (RU)']),
      nameEn: getAirtableText(record.fields['Name (EN)']),
      regionRu: getAirtableText(record.fields['Name (RU) (from Regions)']),
    }))
    .filter((city) => city.cityId && (city.nameRu || city.nameEn))
    .sort((left, right) => (left.nameEn || left.nameRu).localeCompare(right.nameEn || right.nameRu, 'en'))
}

export async function searchMultiDayBuilderPois(query: string): Promise<MultiDayBuilderPoiOption[]> {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length < 1) return []

  const records = await fetchAllTableRecords(POI_TABLE_ID)

  return records
    .map((record) => ({
      poiId: getAirtableText(record.fields['POI ID']),
      nameRu: getAirtableText(record.fields['POI Name (RU)']),
      nameEn: getAirtableText(record.fields['POI Name (EN)']),
      siteCity: getAirtableText(record.fields['Site City']),
      categoryRu: getAirtableText(record.fields['POI Category (RU)']),
    }))
    .filter((poi) => {
      const ru = poi.nameRu.toLowerCase()
      const en = poi.nameEn.toLowerCase()
      return ru.startsWith(normalizedQuery) || en.startsWith(normalizedQuery)
    })
    .sort((left, right) => {
      const leftLabel = left.nameRu || left.nameEn || left.poiId
      const rightLabel = right.nameRu || right.nameEn || right.poiId
      return leftLabel.localeCompare(rightLabel, 'ru')
    })
    .slice(0, 12)
}
