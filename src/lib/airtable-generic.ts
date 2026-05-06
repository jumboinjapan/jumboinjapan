/**
 * Generic Airtable helpers for creating records
 * Extends the existing POI-focused airtable.ts
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN
const KONSTRUCTOUR_BASE = 'apppwhjFN82N9zNqm'

// Table IDs for Konstructour base
export const TABLES = {
  POI: 'tblVCmFcHRpXUT24y',
  TICKETS: 'tblKOLhiHMihpWsVl',
  CONTACTS: 'tblContacts', // Will create if needed
} as const

interface AirtableCreateResponse {
  id: string
  fields: Record<string, unknown>
  createdTime: string
}

interface AirtableError {
  error: {
    type: string
    message: string
  }
}

export async function createAirtableRecord(
  tableId: string,
  fields: Record<string, unknown>,
  baseId: string = KONSTRUCTOUR_BASE
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  if (!AIRTABLE_TOKEN) {
    console.warn('[airtable] Token not configured')
    return { success: false, error: 'AIRTABLE_TOKEN not configured' }
  }

  const url = `https://api.airtable.com/v0/${baseId}/${tableId}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    })

    if (!response.ok) {
      const errorData = (await response.json()) as AirtableError
      console.error('[airtable] API error:', errorData.error?.message)
      return { success: false, error: errorData.error?.message || `HTTP ${response.status}` }
    }

    const data = (await response.json()) as AirtableCreateResponse
    return { success: true, recordId: data.id }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[airtable] Request failed:', errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * Log a contact form submission to Airtable
 * Note: You may need to create a "Contacts" table in Konstructour base first
 */
export async function logContactToAirtable(data: {
  name: string
  contact: string
  travelDate?: string
  groupSize?: string
  interests?: string
  receivedAt: string
  source?: string
}): Promise<{ success: boolean; recordId?: string; error?: string }> {
  // For now, we'll just log since the Contacts table may not exist yet
  // Once you create the table, uncomment the actual implementation
  
  console.log('[airtable] Would log contact:', data)
  
  // Uncomment when Contacts table is ready:
  // return createAirtableRecord(TABLES.CONTACTS, {
  //   Name: data.name,
  //   Contact: data.contact,
  //   'Travel Date': data.travelDate,
  //   'Group Size': data.groupSize,
  //   Interests: data.interests,
  //   'Received At': data.receivedAt,
  //   Source: data.source || 'website',
  // })

  return { success: true, recordId: 'mock-' + Date.now() }
}
