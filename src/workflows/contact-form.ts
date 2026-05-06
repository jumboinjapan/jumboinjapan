/**
 * Contact Form Workflow
 * 
 * Durable workflow for processing contact form submissions:
 * 1. Enrich contact data (locale detection, priority)
 * 2. Log to Airtable
 * 3. Notify Eduard via Telegram
 * 
 * Each step has automatic retries and observability.
 */

import { logContactToAirtable } from '@/lib/airtable-generic'
import { notifyNewContact } from '@/lib/notifications/telegram'

export interface ContactFormInput {
  name: string
  contact: string
  travelDate?: string
  groupSize?: string
  interests?: string
}

interface EnrichedContact extends ContactFormInput {
  receivedAt: string
  locale: 'ru' | 'en' | 'ja' | 'unknown'
  priority: 'high' | 'normal'
  source: string
}

interface WorkflowResult {
  success: boolean
  recordId?: string
  notified: boolean
}

/**
 * Main workflow function
 */
export async function handleContactForm(input: ContactFormInput): Promise<WorkflowResult> {
  'use workflow'

  // Step 1: Enrich the contact data
  const enriched = await enrichContactData(input)

  // Step 2: Log to Airtable
  const record = await saveToAirtable(enriched)

  // Step 3: Notify Eduard
  const notified = await notifyOwner(enriched)

  return {
    success: true,
    recordId: record.recordId,
    notified,
  }
}

/**
 * Step 1: Enrich contact data with metadata
 */
async function enrichContactData(input: ContactFormInput): Promise<EnrichedContact> {
  'use step'

  const text = `${input.name} ${input.contact} ${input.interests || ''}`
  
  return {
    ...input,
    receivedAt: new Date().toISOString(),
    locale: detectLocale(text),
    priority: input.travelDate || input.groupSize ? 'high' : 'normal',
    source: 'jumboinjapan.com',
  }
}

/**
 * Step 2: Save to Airtable
 * Automatic retries on transient Airtable errors
 */
async function saveToAirtable(
  data: EnrichedContact
): Promise<{ recordId?: string }> {
  'use step'

  const result = await logContactToAirtable(data)
  
  if (!result.success) {
    // Non-fatal: log but continue workflow
    console.warn('[workflow] Airtable save failed:', result.error)
  }

  return { recordId: result.recordId }
}

/**
 * Step 3: Send Telegram notification
 * Automatic retries on network errors
 */
async function notifyOwner(data: EnrichedContact): Promise<boolean> {
  'use step'

  const result = await notifyNewContact({
    name: data.name,
    contact: data.contact,
    travelDate: data.travelDate,
    groupSize: data.groupSize,
    interests: data.interests,
  })

  return result.success
}

/**
 * Detect locale from text content
 */
function detectLocale(text: string): 'ru' | 'en' | 'ja' | 'unknown' {
  // Cyrillic characters
  if (/[а-яёА-ЯЁ]/.test(text)) return 'ru'
  
  // Japanese characters (hiragana, katakana, kanji)
  if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text)) return 'ja'
  
  // Latin characters (assume English)
  if (/[a-zA-Z]/.test(text)) return 'en'
  
  return 'unknown'
}
