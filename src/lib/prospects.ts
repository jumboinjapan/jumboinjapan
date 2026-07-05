/**
 * Prospects Airtable integration
 * Table: Prospects (see PROSPECTS_TABLE_ID in airtable-schema.ts) in Konstructour base
 */

import { AIRTABLE_BASE_ID, PROSPECTS_TABLE_ID } from '@/lib/airtable-schema'
import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import {
  PROSPECT_STAGES,
  PROSPECT_TOUR_TYPES,
  type ProspectSource,
  type ProspectStage,
  type ProspectTourType,
} from '@/lib/prospect-labels'
import { BASE_URL } from '@/lib/schema'
import {
  denormalizeProfile,
  parseStoredProfile,
  type TouristProfilePayload,
} from '@/lib/tourist-profile'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN
const BASE_ID = AIRTABLE_BASE_ID
const TABLE_ID = PROSPECTS_TABLE_ID

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
  source?: ProspectSource
}

export type { ProspectSource, ProspectStage, ProspectTourType } from '@/lib/prospect-labels'
export {
  PROSPECT_STAGES,
  PROSPECT_TOUR_TYPES,
  STAGE_LABELS,
  SOURCE_LABELS,
  TOUR_TYPE_LABELS,
} from '@/lib/prospect-labels'

export interface ProspectRecord {
  id: string
  prospectId: string
  /** Токен персональной ссылки на опросник «Профиль туриста». */
  factFindToken: string
  /** Полный URL опросника (/profile/[token]). */
  factFindUrl: string
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
 * Токен персональной ссылки на опросник. Генерируется при создании prospect
 * (решение владельца: ссылка доступна сразу, из Telegram-уведомления и с
 * экрана «спасибо» формы /contact). Хранится в `Fact Find Token`.
 */
function generateFactFindToken(): string {
  return crypto.randomUUID()
}

export function buildFactFindUrl(token: string): string {
  return `${BASE_URL}/profile/${token}`
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
  const factFindToken = generateFactFindToken()
  const factFindUrl = buildFactFindUrl(factFindToken)

  // Map input to Airtable fields
  const fields: Record<string, unknown> = {
    'Prospect ID': prospectId,
    'Created At': new Date().toISOString(),
    'Stage': 'received',
    'Source': input.source || 'website',
    'Fact Find Token': factFindToken,
    'Fact Find Link': factFindUrl,

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
    const response = await fetchAirtableWithRetry(url, {
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
        factFindToken,
        factFindUrl,
      },
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[prospects] Request failed:', errorMessage)
    return { success: false, error: errorMessage }
  }
}

export interface ProspectOverviewItem {
  recordId: string
  prospectId: string
  name: string
  stage: ProspectStage | ''
  tourType: ProspectTourType | ''
  source: string
  createdAt: string | null
  arrivalDate: string | null
  departureDate: string | null
  partySize: number | null
  partyComposition: string | null
  children: string | null
  daysForTours: number | null
  factFindCompletedAt: string | null
  factFindToken: string | null
  stageUpdatedAt: string | null
}

const OVERVIEW_FIELDS = [
  'Prospect ID',
  'Name',
  'Stage',
  'Tour Type',
  'Source',
  'Created At',
  'Arrival Date',
  'Departure Date',
  'Party Size',
  'Party Composition',
  'Children',
  'Days For Tours',
  'Fact Find Completed At',
  'Fact Find Token',
  'Stage Updated At',
] as const

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asTextOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Read all prospects with the lightweight field set used by the admin
 * overview / funnel surfaces. Always fresh (no-store): CRM reads must
 * not lag behind Airtable.
 */
export async function listProspectsForOverview(): Promise<ProspectOverviewItem[]> {
  if (!AIRTABLE_TOKEN) return []

  const items: ProspectOverviewItem[] = []
  let offset: string | undefined

  try {
    do {
      const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`)
      for (const field of OVERVIEW_FIELDS) url.searchParams.append('fields[]', field)
      if (offset) url.searchParams.set('offset', offset)

      const response = await fetchAirtableWithRetry(url.toString(), {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) {
        console.error('[prospects] list failed:', response.status)
        return items
      }

      const data = (await response.json()) as { records: AirtableRecord[]; offset?: string }
      for (const record of data.records) {
        const f = record.fields
        items.push({
          recordId: record.id,
          prospectId: asText(f['Prospect ID']),
          name: asText(f['Name']),
          stage: asText(f['Stage']) as ProspectOverviewItem['stage'],
          tourType: asText(f['Tour Type']) as ProspectOverviewItem['tourType'],
          source: asText(f['Source']),
          createdAt: asTextOrNull(f['Created At']),
          arrivalDate: asTextOrNull(f['Arrival Date']),
          departureDate: asTextOrNull(f['Departure Date']),
          partySize: asNumberOrNull(f['Party Size']),
          partyComposition: asTextOrNull(f['Party Composition']),
          children: asTextOrNull(f['Children']),
          daysForTours: asNumberOrNull(f['Days For Tours']),
          factFindCompletedAt: asTextOrNull(f['Fact Find Completed At']),
          factFindToken: asTextOrNull(f['Fact Find Token']),
          stageUpdatedAt: asTextOrNull(f['Stage Updated At']),
        })
      }
      offset = data.offset
    } while (offset)
  } catch (error) {
    console.error('[prospects] list request failed:', error instanceof Error ? error.message : 'unknown')
  }

  return items
}

// ─── Чтение одного prospect (карточка клиента, опросник по токену) ───────────

/**
 * Полная карточка prospect для админ-CRM и публичного опросника.
 * `factFindAnswers` — распарсенный JSON-канон опросника (null, если анкета
 * не заполнена или JSON повреждён).
 */
export interface ProspectDetail {
  recordId: string
  prospectId: string
  name: string
  contact: string
  language: string | null
  stage: ProspectStage | ''
  tourType: ProspectTourType | ''
  source: string
  createdAt: string | null
  stageUpdatedAt: string | null
  convertedAt: string | null
  factFindToken: string | null
  factFindCompletedAt: string | null
  factFindAnswers: TouristProfilePayload | null
  arrivalDate: string | null
  departureDate: string | null
  flexibleDates: boolean
  partySize: number | null
  children: string | null
  notes: string | null
  linkedRoutes: string[]
}

function mapRecordToDetail(record: AirtableRecord): ProspectDetail {
  const f = record.fields
  const linkedRoutesRaw = asTextOrNull(f['Linked Routes'])
  return {
    recordId: record.id,
    prospectId: asText(f['Prospect ID']),
    name: asText(f['Name']),
    contact: asText(f['Contact']),
    language: asTextOrNull(f['Language']),
    stage: asText(f['Stage']) as ProspectDetail['stage'],
    tourType: asText(f['Tour Type']) as ProspectDetail['tourType'],
    source: asText(f['Source']),
    createdAt: asTextOrNull(f['Created At']),
    stageUpdatedAt: asTextOrNull(f['Stage Updated At']),
    convertedAt: asTextOrNull(f['Converted At']),
    factFindToken: asTextOrNull(f['Fact Find Token']),
    factFindCompletedAt: asTextOrNull(f['Fact Find Completed At']),
    factFindAnswers: parseStoredProfile(asTextOrNull(f['Fact Find Answers'])),
    arrivalDate: asTextOrNull(f['Arrival Date']),
    departureDate: asTextOrNull(f['Departure Date']),
    flexibleDates: f['Flexible Dates'] === true,
    partySize: asNumberOrNull(f['Party Size']),
    children: asTextOrNull(f['Children']),
    notes: asTextOrNull(f['Notes']),
    linkedRoutes: linkedRoutesRaw
      ? linkedRoutesRaw.split('\n').map((line) => line.trim()).filter(Boolean)
      : [],
  }
}

const TOKEN_PATTERN = /^[A-Za-z0-9-]{10,64}$/

/**
 * Найти prospect по токену опросника. Публичное чтение — без кэша.
 * Невалидный формат токена отклоняется до похода в Airtable (заодно
 * закрывает инъекцию в filterByFormula).
 */
export async function getProspectByToken(token: string): Promise<ProspectDetail | null> {
  if (!AIRTABLE_TOKEN || !TOKEN_PATTERN.test(token)) return null

  try {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`)
    url.searchParams.set('filterByFormula', `{Fact Find Token} = "${token}"`)
    url.searchParams.set('maxRecords', '1')

    const response = await fetchAirtableWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      console.error('[prospects] getByToken failed:', response.status)
      return null
    }

    const data = (await response.json()) as { records: AirtableRecord[] }
    return data.records.length > 0 ? mapRecordToDetail(data.records[0]) : null
  } catch (error) {
    console.error('[prospects] getByToken request failed:', error instanceof Error ? error.message : 'unknown')
    return null
  }
}

/**
 * Найти prospect по Airtable record id (`rec...`) или по Prospect ID
 * (`PRS-...`). Админ-чтение — всегда свежее.
 */
export async function getProspectById(id: string): Promise<ProspectDetail | null> {
  if (!AIRTABLE_TOKEN || !id) return null

  try {
    if (/^rec[A-Za-z0-9]{14}$/.test(id)) {
      const response = await fetchAirtableWithRetry(
        `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${id}`,
        {
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        }
      )
      if (!response.ok) return null
      return mapRecordToDetail((await response.json()) as AirtableRecord)
    }

    if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) return null
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`)
    url.searchParams.set('filterByFormula', `{Prospect ID} = "${id}"`)
    url.searchParams.set('maxRecords', '1')
    const response = await fetchAirtableWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { records: AirtableRecord[] }
    return data.records.length > 0 ? mapRecordToDetail(data.records[0]) : null
  } catch (error) {
    console.error('[prospects] getById request failed:', error instanceof Error ? error.message : 'unknown')
    return null
  }
}

// ─── Запись ───────────────────────────────────────────────────────────────────

async function patchProspect(
  recordId: string,
  fields: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  if (!AIRTABLE_TOKEN) return { success: false, error: 'AIRTABLE_TOKEN not configured' }

  try {
    const response = await fetchAirtableWithRetry(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${recordId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      }
    )
    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      const message = (errorData as { error?: { message?: string } } | null)?.error?.message
      console.error('[prospects] patch failed:', response.status, message ?? '')
      return { success: false, error: message || `HTTP ${response.status}` }
    }
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[prospects] patch request failed:', message)
    return { success: false, error: message }
  }
}

/**
 * Записать ответы опросника «Профиль туриста» по токену.
 * Пишет JSON-канон в `Fact Find Answers`, денормализованные колонки
 * (whitelist по построению — см. denormalizeProfile) и
 * `Fact Find Completed At`. Стадию НЕ трогает — гид двигает сам
 * (канон prospects-crm-spec).
 */
export async function updateProspectFactFind(
  token: string,
  payload: TouristProfilePayload
): Promise<{ success: boolean; recordId?: string; prospectId?: string; error?: string }> {
  const prospect = await getProspectByToken(token)
  if (!prospect) return { success: false, error: 'not_found' }

  const fields: Record<string, unknown> = {
    ...denormalizeProfile(payload),
    'Fact Find Answers': JSON.stringify(payload, null, 2),
    'Fact Find Completed At': new Date().toISOString(),
  }

  const result = await patchProspect(prospect.recordId, fields)
  if (!result.success) return { success: false, error: result.error }

  console.log('[prospects] fact-find updated:', prospect.prospectId)
  return { success: true, recordId: prospect.recordId, prospectId: prospect.prospectId }
}

/**
 * Создать prospect из общего лендинга опросника (/profile без токена).
 * Submit создаёт запись сразу с заполненным профилем; Source — из
 * `?src=` (whitelist), иначе website. Стадия — received, как у любой заявки.
 */
export async function createProspectFromProfile(
  payload: TouristProfilePayload,
  source?: string
): Promise<{ success: boolean; record?: ProspectRecord; error?: string }> {
  if (!AIRTABLE_TOKEN) return { success: false, error: 'AIRTABLE_TOKEN not configured' }

  const allowedSources: ProspectSource[] = ['website', 'telegram', 'social', 'referral', 'repeat', 'agency', 'other_guide']
  const resolvedSource: ProspectSource = allowedSources.includes(source as ProspectSource)
    ? (source as ProspectSource)
    : 'website'

  const prospectId = generateProspectId()
  const factFindToken = generateFactFindToken()
  const factFindUrl = buildFactFindUrl(factFindToken)

  const fields: Record<string, unknown> = {
    'Prospect ID': prospectId,
    'Created At': new Date().toISOString(),
    'Stage': 'received',
    'Source': resolvedSource,
    'Fact Find Token': factFindToken,
    'Fact Find Link': factFindUrl,
    'Language': 'ru',
    ...denormalizeProfile(payload),
    'Fact Find Answers': JSON.stringify(payload, null, 2),
    'Fact Find Completed At': new Date().toISOString(),
  }

  try {
    const response = await fetchAirtableWithRetry(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      const message = (errorData as { error?: { message?: string } } | null)?.error?.message
      console.error('[prospects] createFromProfile failed:', response.status, message ?? '')
      return { success: false, error: message || `HTTP ${response.status}` }
    }
    const data = (await response.json()) as AirtableRecord
    console.log('[prospects] Created from profile:', prospectId)
    return { success: true, record: { id: data.id, prospectId, factFindToken, factFindUrl } }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[prospects] createFromProfile request failed:', message)
    return { success: false, error: message }
  }
}

/**
 * Смена стадии воронки. Каждая смена пишет `Stage Updated At = now` —
 * это основа метрики «застрявшие» на дашборде.
 */
export async function updateProspectStage(
  recordId: string,
  stage: ProspectStage
): Promise<{ success: boolean; error?: string }> {
  if (!PROSPECT_STAGES.includes(stage)) return { success: false, error: 'invalid_stage' }
  return patchProspect(recordId, {
    'Stage': stage,
    'Stage Updated At': new Date().toISOString(),
  })
}

export async function updateProspectTourType(
  recordId: string,
  tourType: ProspectTourType
): Promise<{ success: boolean; error?: string }> {
  if (!PROSPECT_TOUR_TYPES.includes(tourType)) return { success: false, error: 'invalid_tour_type' }
  return patchProspect(recordId, { 'Tour Type': tourType })
}

export async function updateProspectNotes(
  recordId: string,
  notes: string
): Promise<{ success: boolean; error?: string }> {
  return patchProspect(recordId, { 'Notes': notes.slice(0, 10000) })
}

/**
 * Дописать slug маршрута в `Linked Routes` (по одному на строку,
 * без дублей). Связка CRM ↔ конструктор маршрутов.
 */
export async function appendLinkedRoute(
  recordId: string,
  slug: string
): Promise<{ success: boolean; error?: string }> {
  const cleaned = slug.trim()
  if (!cleaned || cleaned.length > 200) return { success: false, error: 'invalid_slug' }

  const prospect = await getProspectById(recordId)
  if (!prospect) return { success: false, error: 'not_found' }
  if (prospect.linkedRoutes.includes(cleaned)) return { success: true }

  const next = [...prospect.linkedRoutes, cleaned].join('\n')
  return patchProspect(recordId, { 'Linked Routes': next })
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
