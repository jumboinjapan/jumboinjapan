/**
 * Редактор общего FAQ — слой доступа для админки (/admin/faq).
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ src/lib/faq-general.ts. Публичный слой намеренно не видит
 * служебных полей: «Заметка редактора», «Источник», «Последняя сверка» в типе
 * FaqItem отсутствуют, чтобы поле не могло утечь на страницу по невнимательности.
 * Админке они, наоборот, нужны — значит нужен второй слой, а не ослабление
 * первого. Если однажды захочется «просто добавить поле в FaqItem» — вспомни,
 * что это и есть та дверь, которую мы закрыли.
 *
 * Второе отличие: публичный слой отдаёт только Статус = published, админка —
 * все строки, иначе черновики невозможно найти и дописать.
 *
 * Хранение — таблицы FAQ General (tblJdlQ2xXtULVUBX) и FAQ Sections
 * (tblz7opKLTgbHSFBX) базы Konstructour. Сохранение инвалидирует тег
 * 'airtable:faq', так что правка появляется на сайте сразу, не дожидаясь
 * часового revalidate.
 */

import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import { FAQ_GENERAL_TABLE_NAME, FAQ_SECTIONS_TABLE_NAME } from '@/lib/airtable-schema'
import { FAQ_ATTR_VALUES, type FaqAttr } from '@/lib/faq-general'

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

export const FAQ_STATUS_VALUES = ['published', 'draft', 'hidden'] as const
export type FaqStatus = (typeof FAQ_STATUS_VALUES)[number]

/** Раздел — для выпадающего списка и группировки в редакторе. */
export interface AdminFaqSection {
  id: string
  title: string
  anchor: string
  order: number
  status: FaqStatus
}

/** Вопрос со всеми полями, включая служебные. */
export interface AdminFaqItem {
  id: string
  question: string
  anchor: string
  answer: string
  sectionId: string | null
  order: number
  status: FaqStatus
  attrs: FaqAttr[]
  note: string
  /** Дата последней сверки фактов, ISO yyyy-mm-dd или пустая строка. */
  checkedAt: string
}

function getCredentials() {
  return {
    token: process.env.AIRTABLE_TOKEN?.trim(),
    baseId: process.env.AIRTABLE_BASE_ID?.trim(),
  }
}

function buildUrl(baseId: string, table: string) {
  return `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`
}

function getText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getOrder(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizeStatus(value: unknown): FaqStatus {
  const normalized = getText(value).toLowerCase()
  return FAQ_STATUS_VALUES.includes(normalized as FaqStatus) ? (normalized as FaqStatus) : 'draft'
}

function firstLinkedId(value: unknown): string | null {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null
}

async function fetchAll(table: string): Promise<AirtableRecord[]> {
  const { token, baseId } = getCredentials()
  if (!token || !baseId) return []

  const url = new URL(buildUrl(baseId, table))
  url.searchParams.set('pageSize', '100')

  const all: AirtableRecord[] = []
  let offset: string | undefined

  do {
    if (offset) url.searchParams.set('offset', offset)
    else url.searchParams.delete('offset')

    const response = await fetchAirtableWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error(`Airtable read failed for ${table}: ${response.status} ${await response.text()}`)
    }
    const data = (await response.json()) as { records?: AirtableRecord[]; offset?: string }
    all.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)

  return all
}

function toSection(record: AirtableRecord): AdminFaqSection {
  const f = record.fields
  return {
    id: record.id,
    title: getText(f['Раздел']),
    anchor: getText(f['Якорь']),
    order: getOrder(f['Порядок']),
    status: normalizeStatus(f['Статус']),
  }
}

function toItem(record: AirtableRecord): AdminFaqItem {
  const f = record.fields
  const attrsRaw = Array.isArray(f['Признаки']) ? f['Признаки'] : []
  return {
    id: record.id,
    question: getText(f['Вопрос']),
    anchor: getText(f['Якорь']),
    // Ответ не тримим построчно: пустые строки внутри — границы абзацев.
    answer: typeof f['Ответ'] === 'string' ? f['Ответ'] : '',
    sectionId: firstLinkedId(f['Раздел']),
    order: getOrder(f['Порядок']),
    status: normalizeStatus(f['Статус']),
    attrs: attrsRaw.filter((a): a is FaqAttr => FAQ_ATTR_VALUES.includes(a as FaqAttr)),
    note: typeof f['Заметка редактора'] === 'string' ? f['Заметка редактора'] : '',
    checkedAt: getText(f['Последняя сверка']),
  }
}

/** Всё содержимое FAQ для редактора: разделы по порядку, вопросы по порядку. */
export async function loadAdminFaq(): Promise<{ sections: AdminFaqSection[]; items: AdminFaqItem[] }> {
  const [sectionRecords, itemRecords] = await Promise.all([
    fetchAll(FAQ_SECTIONS_TABLE_NAME),
    fetchAll(FAQ_GENERAL_TABLE_NAME),
  ])

  const sections = sectionRecords.map(toSection).sort((a, b) => a.order - b.order)
  const items = itemRecords.map(toItem).sort((a, b) => a.order - b.order)

  return { sections, items }
}

/** Патч вопроса: обновляются только переданные поля. */
export interface AdminFaqUpdate {
  id: string
  question?: string
  answer?: string
  sectionId?: string | null
  order?: number
  status?: FaqStatus
  attrs?: FaqAttr[]
  note?: string
  checkedAt?: string
}

/**
 * Обновление вопросов. Якорь намеренно НЕ редактируется: он часть публичного
 * URL (/faq#jr-pass), на него ссылаются страницы маршрутов и внешние источники,
 * и смена якоря ломает эти ссылки молча. Менять — только вручную в Airtable,
 * осознанно и с правкой всех ссылок.
 */
export async function updateAdminFaq(updates: AdminFaqUpdate[]): Promise<{ sections: AdminFaqSection[]; items: AdminFaqItem[] }> {
  const { token, baseId } = getCredentials()
  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN и AIRTABLE_BASE_ID обязательны для записи в FAQ General')
  }

  const toPatch = updates
    .map((update) => {
      const fields: Record<string, unknown> = {}
      if (typeof update.question === 'string') fields['Вопрос'] = update.question
      if (typeof update.answer === 'string') fields['Ответ'] = update.answer
      if (update.sectionId !== undefined) fields['Раздел'] = update.sectionId ? [update.sectionId] : []
      if (typeof update.order === 'number' && Number.isFinite(update.order)) fields['Порядок'] = update.order
      if (update.status && FAQ_STATUS_VALUES.includes(update.status)) fields['Статус'] = update.status
      if (Array.isArray(update.attrs)) fields['Признаки'] = update.attrs
      if (typeof update.note === 'string') fields['Заметка редактора'] = update.note
      // Пустая строка = очистить дату; Airtable принимает null.
      if (typeof update.checkedAt === 'string') fields['Последняя сверка'] = update.checkedAt || null
      return Object.keys(fields).length > 0 ? { id: update.id, fields } : null
    })
    .filter((entry): entry is { id: string; fields: Record<string, unknown> } => entry !== null)

  // Airtable принимает до 10 записей за PATCH.
  for (let i = 0; i < toPatch.length; i += 10) {
    const response = await fetchAirtableWithRetry(buildUrl(baseId, FAQ_GENERAL_TABLE_NAME), {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: toPatch.slice(i, i + 10) }),
    })
    if (!response.ok) {
      throw new Error(`Airtable patch failed for ${FAQ_GENERAL_TABLE_NAME}: ${response.status} ${await response.text()}`)
    }
  }

  return loadAdminFaq()
}
