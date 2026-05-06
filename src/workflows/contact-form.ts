/**
 * Contact Form Workflow
 *
 * Durable workflow for processing contact form submissions:
 * 1. Parse and enrich contact data
 * 2. Create Prospect in Airtable
 * 3. Notify Eduard via Telegram
 *
 * Each step has automatic retries and observability.
 */

import { createProspect, parseContactFormToProspect, type ProspectInput } from '@/lib/prospects'
import { notifyNewContact } from '@/lib/notifications/telegram'

export interface ContactFormInput {
  name: string
  contact: string
  travelDate?: string
  groupSize?: string
  interests?: string
}

interface WorkflowResult {
  success: boolean
  prospectId?: string
  airtableRecordId?: string
  notified: boolean
}

/**
 * Main workflow function
 */
export async function handleContactForm(input: ContactFormInput): Promise<WorkflowResult> {
  'use workflow'

  // Step 1: Parse contact form into prospect structure
  const prospectData = await parseContactData(input)

  // Step 2: Create Prospect in Airtable
  const record = await saveProspect(prospectData)

  // Step 3: Notify Eduard
  const notified = await notifyOwner(input, record.prospectId)

  return {
    success: true,
    prospectId: record.prospectId,
    airtableRecordId: record.airtableId,
    notified,
  }
}

/**
 * Step 1: Parse and structure contact form data
 */
async function parseContactData(input: ContactFormInput): Promise<ProspectInput> {
  'use step'

  return parseContactFormToProspect(input)
}

/**
 * Step 2: Create Prospect in Airtable
 * Automatic retries on transient Airtable errors
 */
async function saveProspect(
  data: ProspectInput
): Promise<{ prospectId?: string; airtableId?: string }> {
  'use step'

  const result = await createProspect(data)

  if (!result.success) {
    // Throw to trigger retry for transient errors
    if (result.error?.includes('RATE_LIMIT') || result.error?.includes('502') || result.error?.includes('503')) {
      throw new Error(`Airtable transient error: ${result.error}`)
    }
    // Log but continue for other errors
    console.warn('[workflow] Airtable save failed:', result.error)
    return {}
  }

  return {
    prospectId: result.record?.prospectId,
    airtableId: result.record?.id,
  }
}

/**
 * Step 3: Send Telegram notification
 * Automatic retries on network errors
 */
async function notifyOwner(data: ContactFormInput, prospectId?: string): Promise<boolean> {
  'use step'

  const result = await notifyNewContact({
    name: data.name,
    contact: data.contact,
    travelDate: data.travelDate,
    groupSize: data.groupSize,
    interests: data.interests,
    prospectId,
  })

  return result.success
}
