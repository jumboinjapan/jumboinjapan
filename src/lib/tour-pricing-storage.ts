import { fetchAirtableWithRetry } from '@/lib/airtable-retry'

import {
  FALLBACK_PRICING_MATRIX,
  PRICING_RATE_KEYS,
  type TourPricingMatrix,
  type TourPricingRate,
} from '@/lib/tour-pricing'
import type { TourPricingRateKey } from '@/lib/multi-day-builder'

/**
 * Матрица базовых ставок расчёта тура — таблица Pricing в Airtable
 * (tblPZ1EdCuhq6Fhr8). Одна строка = одна ставка, ключ — Rate Key.
 * Читается конструктором и PDF-генератором; Amount правится в админке
 * (блок «Расчёт тура» → «Базовые ставки») или прямо в Airtable.
 */

const PRICING_TABLE = 'Pricing'

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

function getCredentials() {
  const token = process.env.AIRTABLE_TOKEN?.trim()
  const baseId = process.env.AIRTABLE_BASE_ID?.trim()
  return { token, baseId }
}

function buildUrl(baseId: string) {
  return `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(PRICING_TABLE)}`
}

function isRateKey(value: string): value is TourPricingRateKey {
  return (PRICING_RATE_KEYS as string[]).includes(value)
}

async function fetchPricingRecords(): Promise<AirtableRecord[]> {
  const { token, baseId } = getCredentials()
  if (!token || !baseId) return []

  const response = await fetchAirtableWithRetry(`${buildUrl(baseId)}?pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Airtable read failed for ${PRICING_TABLE}: ${response.status} ${await response.text()}`)
  }
  const data = (await response.json()) as { records?: AirtableRecord[] }
  return data.records ?? []
}

/**
 * Матрица ставок из Airtable. Недоступность таблицы или отсутствие строки не
 * роняет расчёт — недостающие ключи добираются из FALLBACK_PRICING_MATRIX
 * (ставки владельца на момент внедрения).
 */
export async function loadTourPricingMatrix(): Promise<TourPricingMatrix> {
  const matrix: TourPricingMatrix = { ...FALLBACK_PRICING_MATRIX }

  let records: AirtableRecord[] = []
  try {
    records = await fetchPricingRecords()
  } catch (error) {
    console.error('tour-pricing: failed to load Pricing matrix, using fallback rates:', error)
    return matrix
  }

  for (const record of records) {
    const key = typeof record.fields['Rate Key'] === 'string' ? record.fields['Rate Key'].trim() : ''
    if (!isRateKey(key)) continue
    const amountRaw = record.fields['Amount']
    const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw)
    if (!Number.isFinite(amount) || amount < 0) continue

    const rate: TourPricingRate = {
      key,
      label: typeof record.fields['Label'] === 'string' && record.fields['Label'] ? record.fields['Label'] : matrix[key].label,
      amount,
      currency:
        typeof record.fields['Currency'] === 'string' && record.fields['Currency'] ? record.fields['Currency'] : 'USD',
      unit: typeof record.fields['Unit'] === 'string' && record.fields['Unit'] ? record.fields['Unit'] : matrix[key].unit,
      notes: typeof record.fields['Notes'] === 'string' ? record.fields['Notes'].trim() : matrix[key].notes,
    }
    matrix[key] = rate
  }

  return matrix
}

/**
 * Обновление ставок матрицы (Amount по Rate Key). Патчит только существующие
 * строки; неизвестные ключи и невалидные суммы игнорируются с ошибкой в ответе.
 */
export async function updateTourPricingMatrix(
  updates: Array<{ key: TourPricingRateKey; amount: number }>,
): Promise<TourPricingMatrix> {
  const { token, baseId } = getCredentials()
  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required to update the Pricing matrix')
  }

  const valid = updates.filter(
    (update) => isRateKey(update.key) && Number.isFinite(update.amount) && update.amount >= 0,
  )
  if (valid.length > 0) {
    const records = await fetchPricingRecords()
    const recordByKey = new Map(
      records
        .map((record) => [typeof record.fields['Rate Key'] === 'string' ? record.fields['Rate Key'].trim() : '', record] as const)
        .filter(([key]) => Boolean(key)),
    )

    const toPatch = valid
      .map((update) => {
        const record = recordByKey.get(update.key)
        return record ? { id: record.id, fields: { Amount: update.amount } } : null
      })
      .filter((entry): entry is { id: string; fields: { Amount: number } } => entry !== null)

    if (toPatch.length > 0) {
      const response = await fetchAirtableWithRetry(buildUrl(baseId), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: toPatch }),
      })
      if (!response.ok) {
        throw new Error(`Airtable patch failed for ${PRICING_TABLE}: ${response.status} ${await response.text()}`)
      }
    }
  }

  return loadTourPricingMatrix()
}
