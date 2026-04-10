import fs from 'node:fs'

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1)]
    }),
)

const token = env.AIRTABLE_TOKEN?.trim()
const baseId = env.AIRTABLE_BASE_ID?.trim()
if (!token || !baseId) throw new Error('Missing Airtable env')

const RESOURCE_TYPE_VALUES = ['service', 'hotel', 'restaurant', 'event', 'exhibition', 'concert']
const RESOURCE_STATUS_VALUES = ['active', 'draft', 'archived']
const ADMIN_SERVICE_FORMAT_VALUES = ['masterclass', 'ceremony', 'performance', 'activity']
const ADMIN_SERVICE_SUBCATEGORY_VALUES = ['cooking', 'crafts', 'martial_arts', 'theater', 'traditional', 'entertainment']
const ADMIN_SERVICE_TAG_VALUES = ['addable_to_tour', 'booking_required', 'indoor', 'outdoor', 'family_friendly', 'adult_only', 'group_min_2', 'solo_ok']
const ADMIN_RESOURCE_HOTEL_TIER_VALUES = ['luxury-center', 'luxury-other', 'premium', 'economy-premium']
const ADMIN_RESOURCE_REGION_KEY_VALUES = ['tokyo', 'kyoto', 'hakone', 'fuji']
const eventCategories = ['art', 'festival', 'market', 'nature', 'food', 'music']
const RESOURCE_EVENT_LIFECYCLE_VALUES = ['upcoming', 'live', 'ended']

const colors = ['blueLight2', 'greenLight2', 'yellowLight2', 'purpleLight2', 'pinkLight2', 'cyanLight2', 'orangeLight2', 'grayLight2', 'tealLight2', 'redLight2']
const choice = (name, idx = 0) => ({ name, color: colors[idx % colors.length] })

async function api(path, init = {}) {
  const response = await fetch(`https://api.airtable.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(data)}`)
  return data
}

const singleLineText = (name) => ({ name, type: 'singleLineText' })
const multilineText = (name) => ({ name, type: 'multilineText' })
const url = (name) => ({ name, type: 'url' })
const number = (name, precision = 0) => ({ name, type: 'number', options: { precision } })
const checkbox = (name) => ({ name, type: 'checkbox', options: { icon: 'check', color: 'greenBright' } })
const dateTime = (name) => ({ name, type: 'dateTime', options: { dateFormat: { name: 'local', format: 'l' }, timeFormat: { name: '24hour', format: 'HH:mm' }, timeZone: 'Asia/Tokyo' } })
const singleSelect = (name, values) => ({ name, type: 'singleSelect', options: { choices: values.map((v, i) => choice(v, i)) } })
const multipleSelects = (name, values) => ({ name, type: 'multipleSelects', options: { choices: values.map((v, i) => choice(v, i)) } })

const tableDefs = [
  {
    name: 'Resources',
    fields: [
      singleLineText('Resource ID'),
      singleLineText('Resource Slug'),
      singleSelect('Resource Type', RESOURCE_TYPE_VALUES),
      singleSelect('Status', RESOURCE_STATUS_VALUES),
      singleLineText('Title'),
      singleLineText('City'),
      singleLineText('Region Label'),
      multilineText('Summary'),
      multilineText('Description'),
      multipleSelects('Tags', ADMIN_SERVICE_TAG_VALUES),
      url('Primary URL'),
      singleSelect('Editor Module', ['service', 'hotel', 'restaurant', 'event']),
      singleLineText('Source Key'),
      singleLineText('Seed Source'),
      dateTime('Last Seeded At'),
    ],
  },
  {
    name: 'Resource Service Details',
    fields: [
      singleLineText('Resource ID'),
      singleSelect('Service Kind', ['experience', 'practical']),
      singleLineText('Partner'),
      singleLineText('Venue'),
      url('Partner URL'),
      url('Booking URL'),
      url('External URL'),
      singleSelect('Experience Format', ADMIN_SERVICE_FORMAT_VALUES),
      multipleSelects('Experience Subcategory', ADMIN_SERVICE_SUBCATEGORY_VALUES),
      number('Price From', 0),
      singleLineText('Currency'),
      number('Duration Minutes', 0),
      multilineText('Agent Notes'),
    ],
  },
  {
    name: 'Resource Hotel Details',
    fields: [
      singleLineText('Resource ID'),
      singleSelect('Tier', ADMIN_RESOURCE_HOTEL_TIER_VALUES),
      singleSelect('Region Key', ADMIN_RESOURCE_REGION_KEY_VALUES),
      url('Trip URL'),
      url('Booking URL'),
      checkbox('Is Ryokan'),
    ],
  },
  {
    name: 'Resource Restaurant Details',
    fields: [
      singleLineText('Resource ID'),
      singleLineText('Cuisine'),
      singleLineText('Area'),
      singleLineText('Lunch Price'),
      singleLineText('Dinner Price'),
      url('Pocket Concierge URL'),
      url('Google Maps URL'),
      number('Michelin Stars', 0),
    ],
  },
  {
    name: 'Resource Event Details',
    fields: [
      singleLineText('Resource ID'),
      singleSelect('Event Category', eventCategories),
      singleLineText('Title JA'),
      singleLineText('Venue'),
      singleLineText('Venue JA'),
      singleLineText('Neighborhood'),
      dateTime('Starts At'),
      dateTime('Ends At'),
      singleLineText('Price Label'),
      url('Source URL'),
      checkbox('Featured'),
      singleSelect('Lifecycle', RESOURCE_EVENT_LIFECYCLE_VALUES),
    ],
  },
]

const existing = await api(`/v0/meta/bases/${baseId}/tables`)
const existingNames = new Set(existing.tables.map((t) => t.name))
for (const table of tableDefs) {
  if (existingNames.has(table.name)) {
    console.log(`exists: ${table.name}`)
    continue
  }
  const created = await api(`/v0/meta/bases/${baseId}/tables`, { method: 'POST', body: JSON.stringify(table) })
  console.log(`created: ${created.name}`)
}
