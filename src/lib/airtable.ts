export interface AirtableTicket {
  ticketId: string
  type: string
  price: number
}

export type WorkspaceCopyStatus = 'draft' | 'approved' | 'synced'

type AirtableCopyStatus = 'Draft' | 'Review' | 'Approved' | 'Synced'

export interface AirtablePoiSeoWorkspace {
  id: string
  poiId: string
  workingDraftRu: string
  approvedRu: string
  workingDraftEn: string
  approvedEn: string
  copyStatus: string
}

export interface AirtablePoi extends AirtablePoiSeoWorkspace {
  nameRu: string
  nameEn: string
  descriptionRu: string
  descriptionEn: string
  workingHours: string
  website: string
  category: string[]
  tickets: AirtableTicket[]
  siteCity?: string
}

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

interface AirtableResponse {
  records: AirtableRecord[]
  offset?: string
}

function getAirtableTextField(value: unknown): string {
  if (typeof value === 'string') return value.trim()

  if (Array.isArray(value)) {
    const textValues = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)

    return textValues.join('\n')
  }

  return ''
}

function normalizeWorkspaceCopyStatus(value: unknown): WorkspaceCopyStatus | '' {
  const normalized = getAirtableTextField(value).toLowerCase()

  switch (normalized) {
    case 'draft':
      return 'draft'
    case 'review':
    case 'approved':
      return 'approved'
    case 'synced':
      return 'synced'
    default:
      return ''
  }
}

function toAirtableCopyStatus(status: WorkspaceCopyStatus): AirtableCopyStatus {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'approved':
      return 'Approved'
    case 'synced':
      return 'Synced'
  }
}

function getAirtableCredentials() {
  const token = process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID

  return { token, baseId }
}

async function fetchAllRecords(tableName: string, searchParams?: Record<string, string>) {
  const { token, baseId } = getAirtableCredentials()

  if (!token || !baseId) {
    return null
  }

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableName}`)

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value)
  }

  const allRecords: AirtableRecord[] = []
  let offset: string | undefined

  do {
    if (offset) {
      url.searchParams.set('offset', offset)
    } else {
      url.searchParams.delete('offset')
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    if (!res.ok) {
      console.error(`Airtable API error (${tableName}): ${res.status} ${res.statusText}`)
      return []
    }

    const data: AirtableResponse = await res.json()
    allRecords.push(...data.records)
    offset = data.offset
  } while (offset)

  return allRecords
}

async function getTicketsByPoiRecordId(recordIds: string[]) {
  const ticketsByPoiRecordId = new Map<string, AirtableTicket[]>()

  if (recordIds.length === 0) {
    return ticketsByPoiRecordId
  }

  const ticketRecords = await fetchAllRecords('Tickets')

  if (!ticketRecords) {
    return ticketsByPoiRecordId
  }

  for (const tr of ticketRecords) {
    const poiLinks = tr.fields['POI ID'] as string[] | undefined
    if (!poiLinks) continue

    const ticket: AirtableTicket = {
      ticketId: (tr.fields['Ticket ID'] as string) ?? '',
      type: (tr.fields['Ticket Type'] as string) ?? '',
      price: (tr.fields['Ticket Price'] as number) ?? 0,
    }

    for (const poiRecId of poiLinks) {
      if (!recordIds.includes(poiRecId)) continue

      const existing = ticketsByPoiRecordId.get(poiRecId) ?? []
      existing.push(ticket)
      ticketsByPoiRecordId.set(poiRecId, existing)
    }
  }

  return ticketsByPoiRecordId
}

function mapPoiRecords(records: AirtableRecord[], ticketsByPoiRecordId: Map<string, AirtableTicket[]>) {
  return records.map((r) => ({
    id: r.id,
    poiId: getAirtableTextField(r.fields['POI ID']),
    nameRu: getAirtableTextField(r.fields['POI Name (RU)']),
    nameEn: getAirtableTextField(r.fields['POI Name (EN)']),
    descriptionRu: getAirtableTextField(r.fields['Description (RU)']),
    descriptionEn: getAirtableTextField(r.fields['Description (EN)']),
    workingDraftRu: getAirtableTextField(r.fields['Description Draft (RU)']),
    approvedRu: getAirtableTextField(r.fields['Description Approved (RU)']),
    workingDraftEn: getAirtableTextField(r.fields['Description Draft (EN)']),
    approvedEn: getAirtableTextField(r.fields['Description Approved (EN)']),
    copyStatus: normalizeWorkspaceCopyStatus(r.fields['Copy Status']),
    workingHours: getAirtableTextField(r.fields['Working Hours']),
    website: getAirtableTextField(r.fields['Website']),
    category: (r.fields['POI Category (RU)'] as string[]) ?? [],
    tickets: ticketsByPoiRecordId.get(r.id) ?? [],
    siteCity: getAirtableTextField(r.fields['Site City']),
  }))
}

export async function getCityData(cityId: string): Promise<{ hasNonCarSegments: boolean }> {
  const { token, baseId } = getAirtableCredentials()

  if (!token || !baseId) {
    console.warn('Airtable credentials missing, returning default city data')
    return { hasNonCarSegments: false }
  }

  const url = new URL(`https://api.airtable.com/v0/${baseId}/tblHaHc9NV0mA8bSa`)
  url.searchParams.set('filterByFormula', `{CITY ID}='${cityId}'`)
  url.searchParams.set('maxRecords', '1')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
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
  const records = await fetchAllRecords('POI', {
    filterByFormula: `{Site City}='${citySlug}'`,
  })

  if (!records) {
    console.warn('Airtable credentials missing, returning empty POI list')
    return []
  }

  const ticketsByPoiRecordId = await getTicketsByPoiRecordId(records.map((record) => record.id))
  return mapPoiRecords(records, ticketsByPoiRecordId)
}

export async function getHakonePois(): Promise<AirtablePoi[]> {
  return getPoisByCity('hakone')
}

export async function getAllPois(): Promise<AirtablePoi[]> {
  const records = await fetchAllRecords('POI')

  if (!records) {
    console.warn('Airtable credentials missing, returning empty POI list')
    return []
  }

  const ticketsByPoiRecordId = await getTicketsByPoiRecordId(records.map((record) => record.id))
  return mapPoiRecords(records, ticketsByPoiRecordId)
}

interface UpdateAirtablePoiTextInput {
  recordId: string
  descriptionRu: string
  descriptionEn?: string
}

interface UpdateAirtablePoiTitleInput {
  recordId: string
  nameRu: string
  nameEn?: string
}

interface UpdateAirtablePoiSeoWorkspaceInput {
  recordId: string
  workingDraftRu: string
  approvedRu: string
  workingDraftEn?: string
  approvedEn?: string
  copyStatus: WorkspaceCopyStatus
}

interface SyncAirtablePoiApprovedTextInput {
  recordId: string
  workingDraftRu: string
  approvedRu: string
  workingDraftEn?: string
  approvedEn?: string
}

async function patchAirtablePoiFields(recordId: string, fields: Record<string, unknown>) {
  const { token, baseId } = getAirtableCredentials()

  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID must be configured on the server')
  }

  const response = await fetch(`https://api.airtable.com/v0/${baseId}/POI/${recordId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Airtable update failed: ${response.status} ${errorText}`)
  }

  return response.json()
}

export async function deleteAirtablePoi(recordId: string) {
  const { token, baseId } = getAirtableCredentials()

  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID must be configured on the server')
  }

  const response = await fetch(`https://api.airtable.com/v0/${baseId}/POI/${recordId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Airtable delete failed: ${response.status} ${errorText}`)
  }

  return response.json()
}

export async function updateAirtablePoiText({
  recordId,
  descriptionRu,
  descriptionEn,
}: UpdateAirtablePoiTextInput) {
  return patchAirtablePoiFields(recordId, {
    'Description (RU)': descriptionRu.trim(),
    ...(descriptionEn !== undefined ? { 'Description (EN)': descriptionEn.trim() } : {}),
  })
}

export async function updateAirtablePoiTitle({
  recordId,
  nameRu,
  nameEn,
}: UpdateAirtablePoiTitleInput) {
  return patchAirtablePoiFields(recordId, {
    'POI Name (RU)': nameRu.trim(),
    'POI Name (EN)': nameEn?.trim() ?? '',
  })
}

export async function updateAirtablePoiSeoWorkspace({
  recordId,
  workingDraftRu,
  approvedRu,
  workingDraftEn,
  approvedEn,
  copyStatus,
}: UpdateAirtablePoiSeoWorkspaceInput) {
  return patchAirtablePoiFields(recordId, {
    'Description Draft (RU)': workingDraftRu.trim(),
    'Description Approved (RU)': approvedRu.trim(),
    'Description Draft (EN)': workingDraftEn?.trim() ?? '',
    'Description Approved (EN)': approvedEn?.trim() ?? '',
    'Copy Status': toAirtableCopyStatus(copyStatus),
  })
}

export async function syncAirtablePoiApprovedText({
  recordId,
  workingDraftRu,
  approvedRu,
  workingDraftEn,
  approvedEn,
}: SyncAirtablePoiApprovedTextInput) {
  return patchAirtablePoiFields(recordId, {
    'Description (RU)': approvedRu.trim(),
    'Description (EN)': approvedEn?.trim() ?? '',
    'Description Draft (RU)': workingDraftRu.trim(),
    'Description Approved (RU)': approvedRu.trim(),
    'Description Draft (EN)': workingDraftEn?.trim() ?? '',
    'Description Approved (EN)': approvedEn?.trim() ?? '',
    'Copy Status': toAirtableCopyStatus('synced'),
  })
}
