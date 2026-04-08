import { buildResourcesSeedPayload, RESOURCES_TABLE_NAME, RESOURCE_EVENT_DETAILS_TABLE_NAME, RESOURCE_HOTEL_DETAILS_TABLE_NAME, RESOURCE_SERVICE_DETAILS_TABLE_NAME } from '../src/lib/resources.ts'

const token = process.env.AIRTABLE_TOKEN?.trim()
const baseId = process.env.AIRTABLE_BASE_ID?.trim()

if (!token || !baseId) {
  throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required')
}

async function fetchAllExistingRecords(tableName) {
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`)
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
      throw new Error(`Could not fetch existing records from ${tableName}: ${response.status} ${await response.text()}`)
    }

    const data = await response.json()
    records.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)

  return records
}

async function patchBatch(tableName, records) {
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records }),
  })

  if (!response.ok) {
    throw new Error(`PATCH failed for ${tableName}: ${response.status} ${await response.text()}`)
  }
}

async function createBatch(tableName, records) {
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records }),
  })

  if (!response.ok) {
    throw new Error(`POST failed for ${tableName}: ${response.status} ${await response.text()}`)
  }
}

async function syncTable(tableName, payload, keyField) {
  const existingRecords = await fetchAllExistingRecords(tableName)
  const existingByKey = new Map(existingRecords.map((record) => [record.fields[keyField], record.id]))

  const toUpdate = []
  const toCreate = []

  for (const record of payload) {
    const key = record.fields[keyField]
    const existingId = existingByKey.get(key)

    if (existingId) {
      toUpdate.push({ id: existingId, fields: record.fields })
    } else {
      toCreate.push(record)
    }
  }

  for (let index = 0; index < toUpdate.length; index += 10) {
    await patchBatch(tableName, toUpdate.slice(index, index + 10))
  }

  for (let index = 0; index < toCreate.length; index += 10) {
    await createBatch(tableName, toCreate.slice(index, index + 10))
  }

  return {
    updated: toUpdate.length,
    created: toCreate.length,
    finalCount: (await fetchAllExistingRecords(tableName)).length,
  }
}

async function main() {
  const payload = buildResourcesSeedPayload()

  const [core, serviceDetails, hotelDetails, eventDetails] = await Promise.all([
    syncTable(RESOURCES_TABLE_NAME, payload.core, 'Resource ID'),
    syncTable(RESOURCE_SERVICE_DETAILS_TABLE_NAME, payload.serviceDetails, 'Resource ID'),
    syncTable(RESOURCE_HOTEL_DETAILS_TABLE_NAME, payload.hotelDetails, 'Resource ID'),
    syncTable(RESOURCE_EVENT_DETAILS_TABLE_NAME, payload.eventDetails, 'Resource ID'),
  ])

  console.log(
    JSON.stringify(
      {
        tables: {
          [RESOURCES_TABLE_NAME]: core,
          [RESOURCE_SERVICE_DETAILS_TABLE_NAME]: serviceDetails,
          [RESOURCE_HOTEL_DETAILS_TABLE_NAME]: hotelDetails,
          [RESOURCE_EVENT_DETAILS_TABLE_NAME]: eventDetails,
        },
      },
      null,
      2,
    ),
  )
}

await main()
