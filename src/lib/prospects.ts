/**
 * Prospects Airtable integration
 * Table: Prospects (tblZqFGoJwj1Q6QbY) in Konstructour base
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN
const BASE_ID = 'apppwhjFN82N9zNqm'
const TABLE_ID = 'tblZqFGoJwj1Q6QbY'

export interface ProspectInput {
  // Contact
  name: string
  contact: string
  language?: 'ru' | 'en'

  // Group
  groupName?: string
  partySize?: number
  partyComposition?: 'solo' | 'couple' | 'family' | 'friends' | 'corporate'
  children?: string // JSON or text: "2 kids, ages 8 and 12"
  mobility?: 'full' | 'limited' | 'wheelchair'
  mobilityNotes?: string

  // Geography
  homeCountry?: string
  homeCity?: string
  stayingArea?: string

  // Dates
  arrivalDate?: string // ISO date
  departureDate?: string // ISO date
  flexibleDates?: boolean
  daysForTours?: number

  // Preferences
  interests?: string[]
  mustSee?: string
  avoid?: string
  pace?: 'relaxed' | 'moderate' | 'active'

  // Service
  serviceClass?: 'budget' | 'standard' | 'premium' | 'luxury'
  transportPreference?: 'public' | 'private' | 'mixed'
  guideLanguage?: 'ru' | 'en' | 'any'

  // Context
  firstTimeJapan?: boolean
  specialOccasion?: 'birthday' | 'anniversary' | 'honeymoon' | 'graduation' | 'retirement'
  notes?: string

  // Meta
  source?: 'website' | 'telegram' | 'referral' | 'repeat'
}

export interface ProspectRecord {
  id: string
  prospectId: string
}

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

/**
 * Generate a prospect ID: PRS-YYYYMMDD-XXXX
 */
function generateProspectId(): string {
  const date = new Date()
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `PRS-${dateStr}-${random}`
}

/**
 * Create a new prospect in Airtable
 */
export async function createProspect(
  input: ProspectInput
): Promise<{ success: boolean; record?: ProspectRecord; error?: string }> {
  if (!AIRTABLE_TOKEN) {
    console.error('[prospects] AIRTABLE_TOKEN not configured')
    return { success: false, error: 'AIRTABLE_TOKEN not configured' }
  }

  const prospectId = generateProspectId()

  // Map input to Airtable fields
  const fields: Record<string, unknown> = {
    'Prospect ID': prospectId,
    'Created At': new Date().toISOString(),
    'Status': 'new',
    'Source': input.source || 'website',

    // Contact
    'Name': input.name,
    'Contact': input.contact,
  }

  // Optional fields - only add if present
  if (input.language) fields['Language'] = input.language
  if (input.groupName) fields['Group Name'] = input.groupName
  if (input.partySize) fields['Party Size'] = input.partySize
  if (input.partyComposition) fields['Party Composition'] = input.partyComposition
  if (input.children) fields['Children'] = input.children
  if (input.mobility) fields['Mobility'] = input.mobility
  if (input.mobilityNotes) fields['Mobility Notes'] = input.mobilityNotes

  if (input.homeCountry) fields['Home Country'] = input.homeCountry
  if (input.homeCity) fields['Home City'] = input.homeCity
  if (input.stayingArea) fields['Staying Area'] = input.stayingArea

  if (input.arrivalDate) fields['Arrival Date'] = input.arrivalDate
  if (input.departureDate) fields['Departure Date'] = input.departureDate
  if (input.flexibleDates !== undefined) fields['Flexible Dates'] = input.flexibleDates
  if (input.daysForTours) fields['Days For Tours'] = input.daysForTours

  if (input.interests?.length) fields['Interests'] = input.interests
  if (input.mustSee) fields['Must See'] = input.mustSee
  if (input.avoid) fields['Avoid'] = input.avoid
  if (input.pace) fields['Pace'] = input.pace

  if (input.serviceClass) fields['Service Class'] = input.serviceClass
  if (input.transportPreference) fields['Transport Preference'] = input.transportPreference
  if (input.guideLanguage) fields['Guide Language'] = input.guideLanguage

  if (input.firstTimeJapan !== undefined) fields['First Time Japan'] = input.firstTimeJapan
  if (input.specialOccasion) fields['Special Occasion'] = input.specialOccasion
  if (input.notes) fields['Notes'] = input.notes

  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`

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
      const errorData = await response.json()
      console.error('[prospects] Airtable error:', errorData)
      return { success: false, error: errorData.error?.message || `HTTP ${response.status}` }
    }

    const data = (await response.json()) as AirtableRecord
    console.log('[prospects] Created:', prospectId)

    return {
      success: true,
      record: {
        id: data.id,
        prospectId,
      },
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[prospects] Request failed:', errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * Parse raw contact form input and extract structured data
 * This is a simple parser - fact-find agent will do deeper analysis
 */
export function parseContactFormToProspect(input: {
  name: string
  contact: string
  travelDate?: string
  groupSize?: string
  interests?: string
}): ProspectInput {
  const prospect: ProspectInput = {
    name: input.name,
    contact: input.contact,
    source: 'website',
  }

  // Detect language from text
  const text = `${input.name} ${input.interests || ''}`
  if (/[а-яёА-ЯЁ]/.test(text)) {
    prospect.language = 'ru'
  } else {
    prospect.language = 'en'
  }

  // Parse group size
  if (input.groupSize) {
    const sizeMap: Record<string, number> = {
      '1': 1,
      '2': 2,
      '3-4': 3,
      '5+': 5,
    }
    prospect.partySize = sizeMap[input.groupSize] || parseInt(input.groupSize) || undefined

    // Infer composition
    if (prospect.partySize === 1) {
      prospect.partyComposition = 'solo'
    } else if (prospect.partySize === 2) {
      prospect.partyComposition = 'couple'
    }
  }

  // Store raw interests in notes for now - fact-find will parse later
  if (input.interests) {
    prospect.notes = input.interests
  }

  // Try to parse travel dates (basic)
  if (input.travelDate) {
    // Store as note if can't parse
    if (!prospect.notes) {
      prospect.notes = `Dates: ${input.travelDate}`
    } else {
      prospect.notes = `Dates: ${input.travelDate}\n\n${prospect.notes}`
    }
  }

  return prospect
}
