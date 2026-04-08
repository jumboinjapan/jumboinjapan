import { experienceServices, practicalServices } from '../src/data/services.ts'

const SERVICES_TABLE_NAME = 'Services'
const token = process.env.AIRTABLE_TOKEN?.trim()
const baseId = process.env.AIRTABLE_BASE_ID?.trim()

if (!token || !baseId) {
  throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required')
}

function buildSeedPayload() {
  const seededAt = new Date().toISOString()

  return [
    ...experienceServices.map((service) => ({
      fields: {
        'Service ID': service.id,
        'Service Name': service.name,
        'Service Kind': 'Experience',
        Status: 'Active',
        City: service.city,
        Region: service.region,
        Description: service.description.trim(),
        Tags: service.tags,
        Partner: service.partner,
        Venue: service.venue?.trim() || null,
        'Partner URL': service.partner_url || null,
        'Booking URL': service.booking_url || null,
        'External URL': null,
        'Experience Format': service.format,
        'Experience Subcategory': service.subcategory,
        'Price From': service.price_from,
        Currency: service.currency,
        'Duration Minutes': service.duration_min,
        'Agent Notes': service.agent_notes.trim() || null,
        'Seed Source': 'src/data/services.ts',
        'Last Seeded At': seededAt,
      },
    })),
    ...practicalServices.map((service) => ({
      fields: {
        'Service ID': service.id,
        'Service Name': service.name,
        'Service Kind': 'Practical',
        Status: 'Active',
        City: service.city,
        Region: null,
        Description: service.description.trim(),
        Tags: service.tags,
        Partner: null,
        Venue: null,
        'Partner URL': null,
        'Booking URL': null,
        'External URL': service.url,
        'Experience Format': null,
        'Experience Subcategory': [],
        'Price From': null,
        Currency: null,
        'Duration Minutes': null,
        'Agent Notes': null,
        'Seed Source': 'src/data/services.ts',
        'Last Seeded At': seededAt,
      },
    })),
  ]
}

async function fetchAllExistingRecords() {
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(SERVICES_TABLE_NAME)}`)
  url.searchParams.set('pageSize', '100')

  const records = []
  let offset

  do {
    if (offset) {
      url.searchParams.set('offset', offset)
    } else {
      url.searchParams.delete('offset')
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      throw new Error(`Could not fetch existing service records: ${response.status} ${await response.text()}`)
    }

    const data = await response.json()
    records.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)

  return records
}

async function patchBatch(records) {
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(SERVICES_TABLE_NAME)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records }),
  })

  if (!response.ok) {
    throw new Error(`PATCH failed: ${response.status} ${await response.text()}`)
  }

  return response.json()
}

async function createBatch(records) {
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(SERVICES_TABLE_NAME)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records }),
  })

  if (!response.ok) {
    throw new Error(`POST failed: ${response.status} ${await response.text()}`)
  }

  return response.json()
}

async function main() {
  const payload = buildSeedPayload()
  const existingRecords = await fetchAllExistingRecords()
  const existingByServiceId = new Map(existingRecords.map((record) => [record.fields['Service ID'], record.id]))

  const toUpdate = []
  const toCreate = []

  for (const record of payload) {
    const serviceId = record.fields['Service ID']
    const existingId = existingByServiceId.get(serviceId)

    if (existingId) {
      toUpdate.push({ id: existingId, fields: record.fields })
    } else {
      toCreate.push(record)
    }
  }

  for (let index = 0; index < toUpdate.length; index += 10) {
    await patchBatch(toUpdate.slice(index, index + 10))
  }

  for (let index = 0; index < toCreate.length; index += 10) {
    await createBatch(toCreate.slice(index, index + 10))
  }

  const finalRecords = await fetchAllExistingRecords()
  console.log(
    JSON.stringify(
      {
        table: SERVICES_TABLE_NAME,
        seeded: payload.length,
        updated: toUpdate.length,
        created: toCreate.length,
        finalCount: finalRecords.length,
        sampleIds: finalRecords.slice(0, 5).map((record) => record.fields['Service ID']),
      },
      null,
      2,
    ),
  )
}

await main()
