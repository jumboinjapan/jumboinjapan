/**
 * Общий FAQ (/faq) — чтение из Airtable.
 *
 * ИСТОЧНИК ПРАВДЫ — таблицы FAQ General и FAQ Sections в базе Konstructour.
 * Формулировка вопроса, текст ответа, раздел, порядок и признаки правятся в
 * Airtable и приезжают на сайт без деплоя. Массив в src/data/faq-general.ts
 * оставлен только как аварийный сид (см. ниже) — редактировать контент там
 * бессмысленно, Airtable его перекроет.
 *
 * ЧТО НЕ ВЫЕЗЖАЕТ НА ФРОНТЭНД. В таблице есть рабочие поля: «Заметка
 * редактора» (что сверить, откуда брать цифры), «Источник» — связь с темами
 * форумов в таблице Questions, и «Последняя сверка». Они нужны редактору и
 * агентам мониторинга, но в типе FaqItem их нет и mapFaqRecord их не читает.
 * Это не забывчивость, а конструкция: чтобы поле утекло на страницу, его
 * придётся сначала явно добавить в тип — случайно это не произойдёт.
 *
 * ПОЧЕМУ ОСТАЁТСЯ СИД. Пустая /faq — это не «страница без данных», а потеря
 * проиндексированного документа: краулер и языковая модель, придя в момент
 * протухшего токена, увидят пустышку и переиндексируют её как таковую. Тот
 * же приём, что в resources.ts: Airtable выигрывает всегда, когда доступен,
 * сид включается только когда ответа нет вовсе.
 *
 * КЭШ. cache() снимает повторные вызовы внутри одного рендера, unstable_cache
 * держит результат час и слушает тег 'airtable:faq' — по нему правку из
 * Airtable можно вкатить точечно через revalidateTag, не трогая остальное.
 */

import { cache } from 'react'
import { unstable_cache } from 'next/cache'

import { FAQ_GENERAL_SEED } from '@/data/faq-general'
import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import { FAQ_GENERAL_TABLE_NAME, FAQ_SECTIONS_TABLE_NAME } from '@/lib/airtable-schema'

/** Признаки читателя. Значение легально, только если ему соответствует поле
 *  в Prospects (First Trip, Children, Mobility) — иначе фильтр на сайте не с
 *  чем сопоставить в CRM, и признак становится украшением. */
export const FAQ_ATTR_VALUES = ['первая поездка', 'с детьми', 'мобильность'] as const
export type FaqAttr = (typeof FAQ_ATTR_VALUES)[number]

export type FaqItem = {
  /** Стабильный якорь: /faq#jr-pass */
  id: string
  q: string
  /** Абзацы ответа. Пустой массив — ответ ещё не написан. */
  a: string[]
  attrs: FaqAttr[]
}

export type FaqSection = {
  id: string
  title: string
  items: FaqItem[]
}

type AirtableRecord = { id: string; fields: Record<string, unknown> }
type AirtableResponse = { records: AirtableRecord[]; offset?: string }

/** Якорь попадает в публичный URL. Кириллица, пробел или пустая строка ломают
 *  ссылку молча, поэтому такую запись мы не публикуем вовсе. */
const ANCHOR_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function getAirtableCredentials() {
  return {
    token: process.env.AIRTABLE_TOKEN?.trim(),
    baseId: process.env.AIRTABLE_BASE_ID?.trim(),
  }
}

async function fetchAllRecords(tableName: string): Promise<AirtableRecord[] | null> {
  const { token, baseId } = getAirtableCredentials()
  if (!token || !baseId) return null

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`)
  url.searchParams.set('pageSize', '100')

  const all: AirtableRecord[] = []
  let offset: string | undefined

  do {
    if (offset) {
      url.searchParams.set('offset', offset)
    } else {
      url.searchParams.delete('offset')
    }

    const response = await fetchAirtableWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Airtable read failed for ${tableName}: ${response.status} ${await response.text()}`)
    }

    const data = (await response.json()) as AirtableResponse
    all.push(...data.records)
    offset = data.offset
  } while (offset)

  return all
}

function getText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Без «Порядка» строка уезжает в конец своего раздела, а не наверх: забытое
 *  поле не должно менять порядок уже расставленных вопросов. */
function getOrder(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

function isPublished(value: unknown): boolean {
  return getText(value).toLowerCase() === 'published'
}

/** Абзац = блок, отделённый пустой строкой. Одиночные переводы строки внутри
 *  блока склеиваются пробелом: в поле Airtable их ставят при наборе, границей
 *  абзаца они не являются. */
function toParagraphs(value: unknown): string[] {
  return getText(value)
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean)
}

function toAttrs(value: unknown): FaqAttr[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is FaqAttr => FAQ_ATTR_VALUES.includes(item as FaqAttr))
}

function firstLinkedId(value: unknown): string | null {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null
}

export async function getFaqGeneral(): Promise<FaqSection[]> {
  try {
    const [sectionRecords, itemRecords] = await Promise.all([
      fetchAllRecords(FAQ_SECTIONS_TABLE_NAME),
      fetchAllRecords(FAQ_GENERAL_TABLE_NAME),
    ])

    if (!sectionRecords || !itemRecords) return FAQ_GENERAL_SEED

    const sections = sectionRecords
      .filter((record) => isPublished(record.fields['Статус']))
      .map((record) => ({
        recordId: record.id,
        id: getText(record.fields['Якорь']),
        title: getText(record.fields['Раздел']),
        order: getOrder(record.fields['Порядок']),
      }))
      .filter((section) => section.title && ANCHOR_PATTERN.test(section.id))
      .sort((left, right) => left.order - right.order)

    const itemsBySection = new Map<string, Array<FaqItem & { order: number }>>()

    for (const record of itemRecords) {
      if (!isPublished(record.fields['Статус'])) continue

      const sectionRecordId = firstLinkedId(record.fields['Раздел'])
      const id = getText(record.fields['Якорь'])
      const q = getText(record.fields['Вопрос'])
      if (!sectionRecordId || !q || !ANCHOR_PATTERN.test(id)) continue

      const bucket = itemsBySection.get(sectionRecordId) ?? []
      bucket.push({
        id,
        q,
        a: toParagraphs(record.fields['Ответ']),
        attrs: toAttrs(record.fields['Признаки']),
        order: getOrder(record.fields['Порядок']),
      })
      itemsBySection.set(sectionRecordId, bucket)
    }

    const hydrated = sections
      .map((section) => ({
        id: section.id,
        title: section.title,
        items: (itemsBySection.get(section.recordId) ?? [])
          .sort((left, right) => left.order - right.order)
          .map((item) => ({ id: item.id, q: item.q, a: item.a, attrs: item.attrs })),
      }))
      // Раздел без единого опубликованного вопроса не рисуем: пустой заголовок
      // в рельсе читается как «здесь ничего нет», а не как «раздел готовится».
      .filter((section) => section.items.length > 0)

    return hydrated.length > 0 ? hydrated : FAQ_GENERAL_SEED
  } catch (error) {
    console.error('FAQ General repository fallback activated:', error)
    return FAQ_GENERAL_SEED
  }
}

export const getCachedFaqGeneral = cache(
  unstable_cache(getFaqGeneral, ['faq-general'], { tags: ['airtable:faq'], revalidate: 3600 }),
)

/** Плоский список вопросов с готовым ответом — для FAQPage-разметки. Вопрос
 *  без ответа отрендерится на странице с заглушкой, но в схему не попадёт:
 *  разметка обязана совпадать с видимым текстом. */
export function answeredFaqItems(sections: FaqSection[]): FaqItem[] {
  return sections.flatMap((section) => section.items).filter((item) => item.a.length > 0)
}
