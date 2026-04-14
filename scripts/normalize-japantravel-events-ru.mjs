import { normalizeEventSurfaceText } from '../src/lib/event-surface-text.ts'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN?.trim()
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID?.trim()
const RESOURCES_TABLE_NAME = 'Resources'
const RESOURCE_EVENT_DETAILS_TABLE_NAME = 'Resource Event Details'
const BATCH_SIZE = 10
const CONCURRENCY = 8

if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
  throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required')
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function sameFieldValue(left, right) {
  if ((left ?? null) === (right ?? null)) return true
  if ((left === undefined || left === null) && right === '') return true
  if ((right === undefined || right === null) && left === '') return true
  return false
}

async function fetchAllRecords(tableName, formula) {
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`)
  url.searchParams.set('pageSize', '100')
  if (formula) url.searchParams.set('filterByFormula', formula)

  const records = []
  let offset

  do {
    if (offset) {
      url.searchParams.set('offset', offset)
    } else {
      url.searchParams.delete('offset')
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Airtable read failed for ${tableName}: ${response.status} ${await response.text()}`)
    }

    const payload = await response.json()
    records.push(...(payload.records ?? []))
    offset = payload.offset
  } while (offset)

  return records
}

async function patchBatch(tableName, records) {
  const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records }),
  })

  if (!response.ok) {
    throw new Error(`Airtable patch failed for ${tableName}: ${response.status} ${await response.text()}`)
  }
}

async function processRecord(resource, detail) {
  const localized = await normalizeEventSurfaceText({
    title: text(resource.fields.Title),
    titleJa: text(detail.fields['Title JA']),
    summary: text(resource.fields.Summary),
    description: text(resource.fields.Description),
    city: text(resource.fields.City),
    venue: text(detail.fields.Venue),
    venueJa: text(detail.fields['Venue JA']),
    neighborhood: text(detail.fields.Neighborhood),
  })

  const nextResourceFields = {
    Title: localized.title || text(resource.fields.Title),
    Summary: localized.summary || null,
    Description: localized.description || null,
    City: localized.city || null,
  }

  const changedResourceFields = Object.fromEntries(
    Object.entries(nextResourceFields).filter(([key, value]) => !sameFieldValue(resource.fields[key], value)),
  )

  const nextDetailFields = {
    Venue: localized.venue || text(detail.fields.Venue),
    Neighborhood: localized.neighborhood || null,
  }

  const changedDetailFields = Object.fromEntries(
    Object.entries(nextDetailFields).filter(([key, value]) => !sameFieldValue(detail.fields[key], value)),
  )

  return {
    resourcePatch: Object.keys(changedResourceFields).length > 0 ? { id: resource.id, fields: changedResourceFields } : null,
    detailPatch: Object.keys(changedDetailFields).length > 0 ? { id: detail.id, fields: changedDetailFields } : null,
  }
}

async function main() {
  const formula = "FIND('japantravel.com/events importer', {Seed Source})"
  const [resources, eventDetails] = await Promise.all([
    fetchAllRecords(RESOURCES_TABLE_NAME, formula),
    fetchAllRecords(RESOURCE_EVENT_DETAILS_TABLE_NAME),
  ])

  const detailByResourceId = new Map(
    eventDetails.map((record) => [text(record.fields['Resource ID']), record]).filter(([resourceId]) => resourceId),
  )

  const resourcePatches = []
  const detailPatches = []
  let reviewed = 0
  let skipped = 0

  const joined = []
  for (const resource of resources) {
    const resourceId = text(resource.fields['Resource ID'])
    const detail = detailByResourceId.get(resourceId)
    if (!detail) {
      skipped += 1
      continue
    }

    reviewed += 1
    joined.push({ resource, detail })
  }

  for (let index = 0; index < joined.length; index += CONCURRENCY) {
    const chunk = joined.slice(index, index + CONCURRENCY)
    const results = await Promise.all(chunk.map(({ resource, detail }) => processRecord(resource, detail)))
    for (const result of results) {
      if (result.resourcePatch) resourcePatches.push(result.resourcePatch)
      if (result.detailPatch) detailPatches.push(result.detailPatch)
    }
    if ((index / CONCURRENCY) % 5 === 0) {
      console.error(`normalized ${Math.min(index + chunk.length, joined.length)}/${joined.length}`)
    }
  }

  for (let index = 0; index < resourcePatches.length; index += BATCH_SIZE) {
    await patchBatch(RESOURCES_TABLE_NAME, resourcePatches.slice(index, index + BATCH_SIZE))
  }

  for (let index = 0; index < detailPatches.length; index += BATCH_SIZE) {
    await patchBatch(RESOURCE_EVENT_DETAILS_TABLE_NAME, detailPatches.slice(index, index + BATCH_SIZE))
  }

  console.log(
    JSON.stringify(
      {
        reviewed,
        skipped,
        updatedResources: resourcePatches.length,
        updatedEventDetails: detailPatches.length,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
