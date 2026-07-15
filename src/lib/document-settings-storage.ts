import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import { DOCUMENT_SETTINGS_TABLE_NAME } from '@/lib/airtable-schema'

/**
 * Настройки печатного документа — таблица Document Settings в Airtable
 * (tbl3XrbaUSYuc1UKp). Сейчас это глобальные оговорки/дисклеймеры программы
 * тура (черновик / локации не заказаны / изменения на месте). Одна строка =
 * одна оговорка; код ищет по полю Key — не переименовывать.
 *
 * Читается печатным превью и PDF-генератором (только включённые, по Order),
 * правится в админке (/admin/document-settings). В отличие от бренд-реквизитов
 * (`brand.ts`, код) оговорки редактируются владельцем без разработчика.
 */

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

/** Одна настройка-оговорка для редактора админки. */
export interface DisclaimerSetting {
  id: string
  key: string
  title: string
  text: string
  enabled: boolean
  order: number
}

function getCredentials() {
  const token = process.env.AIRTABLE_TOKEN?.trim()
  const baseId = process.env.AIRTABLE_BASE_ID?.trim()
  return { token, baseId }
}

function buildUrl(baseId: string) {
  return `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(DOCUMENT_SETTINGS_TABLE_NAME)}`
}

function toSetting(record: AirtableRecord): DisclaimerSetting {
  const f = record.fields
  const orderRaw = f['Order']
  const order = typeof orderRaw === 'number' ? orderRaw : Number(orderRaw)
  return {
    id: record.id,
    key: typeof f['Key'] === 'string' ? f['Key'] : '',
    title: typeof f['Title'] === 'string' ? f['Title'] : '',
    text: typeof f['Text'] === 'string' ? f['Text'] : '',
    // Airtable опускает checkbox-поле, когда оно снято → отсутствие = false.
    enabled: f['Enabled'] === true,
    order: Number.isFinite(order) ? order : 0,
  }
}

async function fetchRecords(): Promise<AirtableRecord[]> {
  const { token, baseId } = getCredentials()
  if (!token || !baseId) return []

  const response = await fetchAirtableWithRetry(`${buildUrl(baseId)}?pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(
      `Airtable read failed for ${DOCUMENT_SETTINGS_TABLE_NAME}: ${response.status} ${await response.text()}`,
    )
  }
  const data = (await response.json()) as { records?: AirtableRecord[] }
  return data.records ?? []
}

/** Все оговорки, отсортированные по Order — для редактора админки. */
export async function loadDisclaimers(): Promise<DisclaimerSetting[]> {
  const records = await fetchRecords()
  return records
    .map(toSetting)
    .filter((s) => s.key)
    .sort((a, b) => a.order - b.order)
}

/**
 * Тексты включённых оговорок по Order — для печатного документа. Никогда не
 * бросает: недоступность таблицы не должна ронять генерацию программы, поэтому
 * при ошибке возвращается пустой список (документ выходит без блока оговорок).
 */
export async function loadEnabledDisclaimerTexts(): Promise<string[]> {
  try {
    const records = await fetchRecords()
    return records
      .map(toSetting)
      .filter((s) => s.enabled && s.text.trim())
      .sort((a, b) => a.order - b.order)
      .map((s) => s.text.trim())
  } catch (error) {
    console.error('document-settings: failed to load disclaimers, printing document without them:', error)
    return []
  }
}

/** Патч оговорки: обновляемые поля по id записи. */
export interface DisclaimerUpdate {
  id: string
  title?: string
  text?: string
  enabled?: boolean
  order?: number
}

/**
 * Обновление оговорок (Title/Text/Enabled/Order по id). Патчит только
 * переданные поля существующих записей; создание/удаление строк — через
 * Airtable напрямую (набор оговорок меняется редко).
 */
export async function updateDisclaimers(updates: DisclaimerUpdate[]): Promise<DisclaimerSetting[]> {
  const { token, baseId } = getCredentials()
  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required to update Document Settings')
  }

  const toPatch = updates
    .map((update) => {
      const fields: Record<string, unknown> = {}
      if (typeof update.title === 'string') fields['Title'] = update.title
      if (typeof update.text === 'string') fields['Text'] = update.text
      if (typeof update.enabled === 'boolean') fields['Enabled'] = update.enabled
      if (typeof update.order === 'number' && Number.isFinite(update.order)) fields['Order'] = update.order
      return Object.keys(fields).length > 0 ? { id: update.id, fields } : null
    })
    .filter((entry): entry is { id: string; fields: Record<string, unknown> } => entry !== null)

  if (toPatch.length > 0) {
    // Airtable PATCH принимает до 10 записей за запрос.
    for (let i = 0; i < toPatch.length; i += 10) {
      const batch = toPatch.slice(i, i + 10)
      const response = await fetchAirtableWithRetry(buildUrl(baseId), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: batch }),
      })
      if (!response.ok) {
        throw new Error(
          `Airtable patch failed for ${DOCUMENT_SETTINGS_TABLE_NAME}: ${response.status} ${await response.text()}`,
        )
      }
    }
  }

  return loadDisclaimers()
}
